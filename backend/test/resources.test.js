import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { OpenAIQueryParser } from '../src/ai.js';
import { Sessions } from '../src/sessions.js';
import { catalog } from './fixtures.js';

async function serve(t, options = {}) {
  const server = createApp(catalog, options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return async (path, body, { sessionId, headers = {}, raw = false } = {}) => {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(sessionId && { 'X-Session-Id': sessionId }), ...headers },
      ...(body !== undefined && { body: raw ? body : JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json(), retryAfter: response.headers.get('Retry-After'), allowOrigin: response.headers.get('Access-Control-Allow-Origin') };
  };
}

const filters = { poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10, quantity: 8 };
function parserWithProvider(counter) {
  return new OpenAIQueryParser({
    url: 'https://example.org/responses', model: 'demo', apiKey: 'test-key', maxCalls: 20,
    fetcher: async () => {
      counter.calls += 1;
      return new Response(JSON.stringify({ status: 'completed', output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(filters) }] },
      ] }));
    },
  });
}

test('session capacity preserves active carts and recovers only expired slots', () => {
  let now = 0;
  const sessions = new Sessions(catalog, { maxSessions: 2, sessionIdleTtlMs: 100, now: () => now });
  const active = sessions.create();
  const idle = sessions.create();
  sessions.cart(active).add({ sku: 'EXACT', quantity: 1, confirmed: true, confirmationId: 'retained' });
  assert.throws(() => sessions.create(), { code: 'SESSION_CAPACITY' });
  assert.equal(sessions.cart(active).snapshot().items[0].quantity, 1);
  now = 90;
  sessions.context(active);
  now = 100;
  const replacement = sessions.create();
  assert.throws(() => sessions.context(idle), { code: 'SESSION_REQUIRED' });
  assert.equal(sessions.cart(active).snapshot().items[0].quantity, 1);
  assert.deepEqual(sessions.cart(replacement).snapshot().items, []);
  now = 201;
  assert.throws(() => sessions.cart(active), { code: 'SESSION_REQUIRED' });
  assert.doesNotThrow(() => sessions.create());
});

test('repeated session allocation stays bounded and rejects invalid resource settings', () => {
  const sessions = new Sessions(catalog, { maxSessions: 4 });
  const retained = Array.from({ length: 4 }, () => sessions.create());
  for (let attempt = 0; attempt < 100; attempt += 1) assert.throws(() => sessions.create(), { code: 'SESSION_CAPACITY' });
  for (const sessionId of retained) assert.deepEqual(sessions.cart(sessionId).snapshot().items, []);
  assert.throws(() => new Sessions(catalog, { maxSessions: 0 }), /positive safe integer/);
  assert.throws(() => createApp(catalog, { resourceLimits: { windowMs: -1 } }), /positive safe integer/);
});

test('both search modes reject whitespace and oversized inputs before invoking AI', async (t) => {
  let calls = 0;
  const api = await serve(t, { queryParser: { extract: () => { calls++; }, reply: () => { calls++; } } });
  for (const conversation of [false, true]) {
    for (const query of ['   ', 'x'.repeat(4001)]) {
      const response = await api('/api/search', { query, conversation });
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'INVALID_BODY');
    }
  }
  assert.equal(calls, 0);
});

test('JSON size, charset and encoding failures remain client errors with CORS headers', async (t) => {
  const api = await serve(t);
  for (const [body, headers, status, code] of [
    [JSON.stringify({ query: 'x'.repeat(110000) }), {}, 413, 'BODY_TOO_LARGE'],
    ['{}', { 'Content-Encoding': 'unsupported' }, 415, 'UNSUPPORTED_ENCODING'],
    ['{}', { 'Content-Type': 'application/json; charset=unsupported' }, 415, 'UNSUPPORTED_ENCODING'],
    ['{', {}, 400, 'INVALID_JSON'],
  ]) {
    const response = await api('/api/search', body, { headers, raw: true });
    assert.equal(response.status, status);
    assert.equal(response.body.error.code, code);
    assert.equal(response.allowOrigin, '*');
  }
  assert.equal((await api('/api/health')).status, 200);
});

test('session creation rate recovers and cannot be bypassed using an untrusted forwarded header', async (t) => {
  let now = 0;
  const api = await serve(t, { now: () => now, resourceLimits: { sessionCreationsPerIp: 2, windowMs: 1000 } });
  assert.equal((await api('/api/session', {})).status, 201);
  assert.equal((await api('/api/session', {})).status, 201);
  const denied = await api('/api/session', {}, { headers: { 'X-Forwarded-For': '203.0.113.42' } });
  assert.equal(denied.status, 429);
  assert.equal(denied.body.error.code, 'SESSION_RATE_LIMIT');
  assert.equal(denied.retryAfter, '1');
  now = 1000;
  assert.equal((await api('/api/session', {})).status, 201);
});

test('session API reports bounded capacity without invalidating an existing cart', async (t) => {
  const api = await serve(t, { resourceLimits: { maxSessions: 1 } });
  const { body: { sessionId } } = await api('/api/session', {});
  await api('/api/cart', { sku: 'EXACT', quantity: 1, confirmed: true, confirmationId: 'capacity' }, { sessionId });
  const denied = await api('/api/session', {});
  assert.equal(denied.status, 503);
  assert.equal(denied.body.error.code, 'SESSION_CAPACITY');
  const cart = await api('/api/cart', undefined, { sessionId });
  assert.equal(cart.body.items[0].quantity, 1);
});

test('AI quotas charge provider attempts only, retain cache and local search, and recover by window', async (t) => {
  let now = 0;
  const counter = { calls: 0 };
  const parser = parserWithProvider(counter);
  const api = await serve(t, { queryParser: parser, now: () => now, resourceLimits: { anonymousAiCallsPerIp: 1, windowMs: 1000 } });
  assert.equal((await api('/api/search', { query: 'Нужны подходящие автоматы, первый запрос' })).status, 200);
  assert.equal(counter.calls, 1);
  assert.equal((await api('/api/search', { query: 'Нужны подходящие автоматы, первый запрос' })).status, 200);
  assert.equal(counter.calls, 1, 'Cached responses consume no new quota');
  assert.equal((await api('/api/search', { query: '3P C16, 10 kA, 8 штук' })).status, 200);
  assert.equal(counter.calls, 1, 'Deterministic search consumes no new quota');
  const denied = await api('/api/search', { query: 'Второй вопрос о подборе' });
  assert.equal(denied.status, 429);
  assert.equal(denied.body.error.code, 'AI_RATE_LIMIT');
  assert.equal(counter.calls, 1, 'Rate-limited requests never reach the provider');
  now = 1000;
  assert.equal((await api('/api/search', { query: 'Второй вопрос о подборе' })).status, 200);
  assert.equal(counter.calls, 2);
});

test('rotating sessions cannot bypass the IP AI budget and anonymous calls leave session capacity', async (t) => {
  const counter = { calls: 0 };
  const api = await serve(t, { queryParser: parserWithProvider(counter), resourceLimits: { anonymousAiCallsPerIp: 1, aiCallsPerSession: 1, aiCallsPerIp: 2 } });
  assert.equal((await api('/api/search', { query: 'Анонимный подбор номер один' })).status, 200);
  assert.equal((await api('/api/search', { query: 'Анонимный подбор номер два' })).status, 429);
  const ids = [];
  for (let index = 0; index < 3; index++) ids.push((await api('/api/session', {})).body.sessionId);
  assert.equal((await api('/api/search', { query: 'Подбор для первого посетителя' }, { sessionId: ids[0] })).status, 200);
  assert.equal((await api('/api/search', { query: 'Повторный подбор первого посетителя' }, { sessionId: ids[0] })).status, 429);
  assert.equal((await api('/api/search', { query: 'Подбор для второго посетителя' }, { sessionId: ids[1] })).status, 200);
  assert.equal((await api('/api/search', { query: 'Подбор с новой сессией того же адреса' }, { sessionId: ids[2] })).status, 429);
  assert.equal(counter.calls, 3);
});

test('the rate limiter rejects new identities when full and recovers after their windows', async (t) => {
  let now = 0;
  const api = await serve(t, { now: () => now, trustProxy: 'loopback', resourceLimits: { maxRateLimitClients: 1, windowMs: 1000 } });
  assert.equal((await api('/api/session', {}, { headers: { 'X-Forwarded-For': '203.0.113.1' } })).status, 201);
  assert.equal((await api('/api/session', {}, { headers: { 'X-Forwarded-For': '203.0.113.2' } })).status, 429);
  now = 1000;
  assert.equal((await api('/api/session', {}, { headers: { 'X-Forwarded-For': '203.0.113.2' } })).status, 201);
});
