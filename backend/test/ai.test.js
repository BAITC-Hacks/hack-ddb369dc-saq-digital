import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAIQueryParser } from '../src/ai.js';

const filters = { poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10, quantity: 8 };
const settings = { url: 'https://example.org/responses', model: 'demo', apiKey: 'dummy', maxOutputTokens: 256, maxCalls: 1 };

function completed(text = JSON.stringify(filters)) {
  return {
    status: 'completed',
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
    ],
  };
}

function response(payload) {
  return { ok: true, json: async () => payload };
}

test('sends a Responses API schema, shares concurrent requests, and enforces the call budget', async () => {
  let requests = 0;
  const parser = new OpenAIQueryParser({
    ...settings,
    fetcher: async (url, options) => {
      requests += 1;
      assert.equal(url, settings.url);
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer dummy');
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.ok(options.signal instanceof AbortSignal);
      const body = JSON.parse(options.body);
      assert.equal(body.model, settings.model);
      assert.equal(body.max_output_tokens, 256);
      assert.equal(body.stream, false);
      assert.equal(body.store, false);
      assert.deepEqual(body.input, [{ role: 'user', content: '  Нужен  3P C16 ' }]);
      assert.equal(body.text.format.type, 'json_schema');
      assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.schema.additionalProperties, false);
      assert.deepEqual(body.text.format.schema.required, Object.keys(filters));
      assert.equal(body.text.format.schema.properties.poles.anyOf[1].type, 'null');
      return response(completed());
    },
  });
  const first = parser.extract('  Нужен  3P C16 ');
  const second = parser.extract('нужен 3p c16');
  assert.equal(first, second);
  assert.deepEqual(await first, filters);
  assert.deepEqual(await parser.extract('НУЖЕН 3P C16'), filters);
  assert.equal(requests, 1);
  assert.equal(parser.calls, 1);
  assert.equal(parser.cache.size, 1);
  assert.throws(() => parser.extract('другой запрос'), /limit/);
  assert.equal(requests, 1);
});

test('rejects invented product data, missing fields, invalid ranges, and malformed JSON', async (t) => {
  const invalid = [
    ['SKU', JSON.stringify({ ...filters, sku: 'MADE-UP' })],
    ['price', JSON.stringify({ ...filters, priceKzt: 100 })],
    ['stock', JSON.stringify({ ...filters, stock: 100 })],
    ['unknown specification', JSON.stringify({ ...filters, poles: null })],
    ['missing specification', JSON.stringify({ curve: 'C', quantity: 8 })],
    ['invalid poles', JSON.stringify({ ...filters, poles: 5 })],
    ['invalid curve', JSON.stringify({ ...filters, curve: 'A' })],
    ['zero current', JSON.stringify({ ...filters, amps: 0 })],
    ['negative capacity', JSON.stringify({ ...filters, breakingCapacityKa: -1 })],
    ['fractional quantity', JSON.stringify({ ...filters, quantity: 1.5 })],
    ['string quantity', JSON.stringify({ ...filters, quantity: '8' })],
    ['JSON', 'not json'],
  ];
  for (const [name, text] of invalid) {
    await t.test(name, async () => {
      const parser = new OpenAIQueryParser({ ...settings, fetcher: async () => response(completed(text)) });
      await assert.rejects(parser.extract('нужен автомат'));
      assert.equal(parser.cache.size, 0);
      assert.equal(parser.calls, 1);
    });
  }
});

test('rejects incomplete, failed, refused, and empty responses', async (t) => {
  const invalid = [
    { ...completed(), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    { status: 'failed', error: { message: 'Upstream error' } },
    { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'Declined' }] }] },
    { status: 'completed', output: [] },
    { status: 'completed' },
    { status: 'completed', output: [{ type: 'message', role: 'assistant' }] },
    null,
  ];
  for (const payload of invalid) {
    await t.test(JSON.stringify(payload), async () => {
      const parser = new OpenAIQueryParser({ ...settings, fetcher: async () => response(payload) });
      await assert.rejects(parser.extract('нужен автомат'), /OpenAI/);
      assert.equal(parser.cache.size, 0);
    });
  }
});

test('failed requests can be retried, and still consume the call budget', async () => {
  let requests = 0;
  const parser = new OpenAIQueryParser({
    ...settings, maxCalls: 2,
    fetcher: async () => ++requests === 1 ? { ok: false, status: 429 } : response(completed()),
  });
  await assert.rejects(parser.extract('автомат'), /OpenAI API returned HTTP 429/);
  assert.equal(parser.cache.size, 0);
  assert.deepEqual(await parser.extract('автомат'), filters);
  assert.equal(parser.calls, 2);
  assert.equal(requests, 2);
  assert.throws(() => parser.extract('ещё один'), /limit/);
});

test('network failure evicts the rejected cache entry', async () => {
  const parser = new OpenAIQueryParser({
    ...settings, fetcher: async () => { throw new TypeError('fetch failed'); },
  });
  await assert.rejects(parser.extract('автомат'), /fetch failed/);
  assert.equal(parser.cache.size, 0);
  assert.throws(() => parser.extract('автомат'), /limit/);
});

test('aborts a stalled request after the configured timeout', async () => {
  const parser = new OpenAIQueryParser({
    ...settings, timeoutMs: 10,
    fetcher: (_url, { signal }) => new Promise((_resolve, reject) => {
      // Keep the loop alive: AbortSignal.timeout uses an unreferenced timer.
      const timer = setTimeout(() => reject(new Error('Request was not aborted')), 1000);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    }),
  });
  await assert.rejects(parser.extract('автомат'), { name: 'TimeoutError' });
  assert.equal(parser.cache.size, 0);
});

test('a zero call budget never sends a request', () => {
  const parser = new OpenAIQueryParser({
    ...settings, maxCalls: 0, fetcher: async () => assert.fail('Unexpected request'),
  });
  assert.throws(() => parser.extract('автомат'), /limit/);
  assert.equal(parser.calls, 0);
});

test('dialogue sends site facts and bounded session history, with a context-aware cache', async () => {
  const unknown = Object.fromEntries(Object.keys(filters).map((key) => [key, null]));
  const context = {
    catalog: [{ sku: 'LOCAL', priceKzt: 500, stock: 2 }],
    history: [{ role: 'user', content: 'Нужен автомат' }, { role: 'assistant', content: 'Какие параметры?' }],
    knownFilters: { ...unknown, poles: 3 },
  };
  let calls = 0;
  const parser = new OpenAIQueryParser({ ...settings, maxCalls: 3, fetcher: async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.text.format.name, 'site_assistant');
    assert.deepEqual(body.text.format.schema.required, ['kind', 'answer', 'filters', 'topic', 'productSkus', 'termSections', 'technicalTopic']);
    assert.equal(body.input[0].role, 'developer');
    assert.match(body.input[0].content, /LOCAL/);
    assert.equal(body.input[1].content, 'Нужен автомат');
    assert.equal(body.input.at(-1).content, 'Что есть?');
    assert.match(body.instructions, /out_of_scope/);
    assert.equal(body.store, false);
    return response(completed(JSON.stringify({ kind: 'answer', answer: 'Есть товары из каталога.', filters: unknown })));
  } });
  assert.equal((await parser.reply('Что есть?', context)).kind, 'answer');
  await parser.reply('Что есть?', context);
  assert.equal(calls, 1);
  await parser.reply('Что есть?', { ...context, knownFilters: null });
  assert.equal(calls, 2, 'Different conversation context must not reuse an answer');
});

test('dialogue accepts partial parameters but rejects invalid actions and invented fields', async () => {
  const partial = { ...filters, quantity: null };
  for (const payload of [
    { kind: 'search', answer: 'Сколько штук нужно?', filters: partial },
    { kind: 'add_to_cart', answer: 'Добавлено', filters },
    { kind: 'search', answer: 'Готово', filters, sku: 'MADE-UP' },
    { kind: 'search', answer: 'Готово', filters: { ...filters, quantity: -1 } },
  ]) {
    const parser = new OpenAIQueryParser({ ...settings, fetcher: async () => response(completed(JSON.stringify(payload))) });
    if (payload.filters.quantity === null) assert.deepEqual((await parser.reply('нужен автомат', {})).filters, partial);
    else await assert.rejects(parser.reply('нужен автомат', {}));
  }
});

test('provider budget recovers at the window boundary and lifetime telemetry stays cumulative', async () => {
  let now = 0;
  let requests = 0;
  const parser = new OpenAIQueryParser({
    ...settings, maxCalls: 2, budgetWindowMs: 1000, now: () => now,
    fetcher: async () => { requests++; return response(completed()); },
  });
  await parser.extract('first');
  await parser.extract('second');
  assert.throws(() => parser.extract('third'), { code: 'AI_CALL_LIMIT' });
  now = 999;
  assert.throws(() => parser.extract('third'), { code: 'AI_CALL_LIMIT' });
  now = 1000;
  assert.deepEqual(await parser.extract('third'), filters);
  assert.equal(requests, 3);
  assert.equal(parser.calls, 3);
  assert.equal(parser.windowCalls, 1);
});

test('expired cached responses refresh while valid cache hits spend no client or provider quota', async () => {
  let now = 0;
  let requests = 0;
  let charges = 0;
  const parser = new OpenAIQueryParser({
    ...settings, budgetWindowMs: 1000, now: () => now,
    fetcher: async () => { requests++; return response(completed()); },
  });
  const policy = { beforeRequest: () => { charges++; } };
  await parser.extract('cached', policy);
  now = 999;
  await parser.extract('cached', policy);
  assert.equal(requests, 1);
  assert.equal(charges, 1);
  now = 1000;
  await parser.extract('cached', policy);
  assert.equal(requests, 2);
  assert.equal(charges, 2);
  assert.equal(parser.cache.size, 1);
});

test('completed cache entries remain bounded and evicted responses can be fetched again', async () => {
  let requests = 0;
  const parser = new OpenAIQueryParser({
    ...settings, maxCalls: 10, maxCacheEntries: 2,
    fetcher: async () => { requests++; return response(completed()); },
  });
  await parser.extract('first');
  await parser.extract('second');
  await parser.extract('third');
  assert.equal(parser.cache.size, 2);
  await parser.extract('second');
  assert.equal(requests, 3, 'A retained answer remains available without a provider call');
  await parser.extract('first');
  assert.equal(requests, 4);
  assert.equal(parser.cache.size, 2);
});

test('in-flight responses stay deduplicated across windows and cache capacity rejects extra provider work', async () => {
  let now = 0;
  let release;
  let requests = 0;
  let charges = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const parser = new OpenAIQueryParser({
    ...settings, maxCalls: 10, maxCacheEntries: 1, budgetWindowMs: 1000, now: () => now,
    fetcher: async () => { requests++; await gate; return response(completed()); },
  });
  const policy = { beforeRequest: () => { charges++; } };
  const first = parser.extract('pending', policy);
  now = 1000;
  assert.equal(parser.extract('pending', policy), first);
  assert.throws(() => parser.extract('other', policy), { code: 'AI_RATE_LIMIT' });
  assert.equal(requests, 1);
  assert.equal(charges, 1);
  release();
  await first;
  assert.deepEqual(await parser.extract('other', policy), filters);
  assert.equal(requests, 2);
  assert.equal(charges, 2);
  assert.equal(parser.cache.size, 1);
});

test('a denied request policy preserves cached answers and spends no provider budget', async () => {
  let requests = 0;
  const parser = new OpenAIQueryParser({
    ...settings, maxCalls: 10, maxCacheEntries: 1,
    fetcher: async () => { requests++; return response(completed()); },
  });
  await parser.extract('retained');
  const denied = { beforeRequest: () => { throw Object.assign(new Error('Client limit'), { code: 'AI_RATE_LIMIT' }); } };
  assert.throws(() => parser.extract('denied', denied), { code: 'AI_RATE_LIMIT' });
  assert.equal(parser.calls, 1);
  assert.equal(parser.windowCalls, 1);
  assert.equal(parser.cache.size, 1);
  assert.deepEqual(await parser.extract('retained', denied), filters);
  assert.equal(requests, 1, 'Denied traffic must not evict a previously cached answer');
});

test('invalid resource settings fail before any provider request', () => {
  for (const options of [{ maxCalls: -1 }, { maxCalls: 1.5 }, { budgetWindowMs: 0 }, { maxCacheEntries: 0 }, { timeoutMs: -1 }, { maxOutputTokens: 0 }]) {
    assert.throws(() => new OpenAIQueryParser({ ...settings, ...options }), /safe integer/);
  }
});
