// Audit-only reproductions. These assert desired behavior and intentionally fail
// on the audited revision. Run explicitly; they are outside the default suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { answerConversation } from '../src/assistant.js';
import { OpenAIQueryParser } from '../src/ai.js';
import { loadCatalog, normalizePartnerProduct } from '../src/catalog.js';
import { parseQuery, searchCatalog } from '../src/search.js';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/catalog.json', import.meta.url)));
const terms = JSON.parse(await readFile(new URL('../purchase-terms.json', import.meta.url), 'utf8'));
const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
const unknown = { poles: null, curve: null, amps: null, breakingCapacityKa: null, quantity: null };
const answer = { kind: 'answer', answer: 'В каталоге есть автоматы.', filters: unknown };
const envelope = (reply) => new Response(JSON.stringify({ status: 'completed', output: [
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(reply) }] },
] }));

async function server(t, options = {}) {
  const app = createApp(catalog, { purchaseTerms: terms, ...options });
  const listener = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => { listener.closeAllConnections(); listener.close(resolve); }));
  const origin = `http://127.0.0.1:${listener.address().port}`;
  return async (path, body, headers = {}, raw = false) => {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body !== undefined && { body: raw ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(3000),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
}

for (const query of [
  '3P C16, 10 kA, -8 штук',
  '3P C16, 10 kA, 1.5 штуки',
  '3P C16, -10 kA, 8 штук',
  '3P C16, 10 kA, 9007199254740993 штук',
]) {
  test(`AUD-01: reject ambiguous or invalid numbers: ${query}`, () => {
    assert.throws(() => parseQuery(query), 'Invalid input must not silently become another valid quantity/capacity.');
  });
}

test('AUD-01: a fractional capacity without a leading zero must not become ten times larger', () => {
  assert.equal(parseQuery('3P C16, .5 kA, 8 штук').breakingCapacityKa, 0.5);
});

test('AUD-02: a SKU with a quantity in words must preserve that quantity', async () => {
  const result = await answerConversation(catalog, 'DEMO-MCB-003, восемь штук', terms);
  assert.equal(result.quantity, 8);
});

test('AUD-02: a certificate follow-up must preserve the selected quantity', async () => {
  const context = {};
  await answerConversation(catalog, 'DEMO-MCB-003, 8 штук', terms, context);
  const result = await answerConversation(catalog, 'Сертификат есть?', terms, context);
  assert.equal(result.quantity, 8);
});

test('AUD-03: an unknown SKU must not be replaced with the previous product', async () => {
  const context = {};
  await answerConversation(catalog, 'DEMO-MCB-003', terms, context);
  const result = await answerConversation(catalog, 'Сколько стоит DEMO-MCB-999?', terms, context);
  assert.equal(result.exactMatch, null);
});

test('AUD-03: an unsuccessful new selection must not reuse an old product', async () => {
  const context = {};
  await answerConversation(catalog, 'DEMO-MCB-003', terms, context);
  await answerConversation(catalog, '4P D63, 15 kA, 1 штука', terms, context);
  const result = await answerConversation(catalog, 'Сколько стоит?', terms, context);
  assert.equal(result.exactMatch, null);
});

test('AUD-03: an explicit fresh selection in words must clear the previous product', async () => {
  const context = {};
  await answerConversation(catalog, 'DEMO-MCB-001, 8 штук', terms, context);
  const result = await answerConversation(catalog, 'Теперь совершенно новый подбор с нуля: однополюсный автомат с характеристикой B. Остальное ещё не выбрал.', terms, context);
  assert.equal(result.exactMatch, null);
});

test('AUD-04: an explicit brand restriction must not return products of other brands', async () => {
  const result = await answerConversation(catalog, 'Только Schneider: 3P C16, 10 kA, 8 штук', terms);
  assert.ok(result.alternatives.every(({ product }) => product.brand === 'Schneider'));
});

test('AUD-04: an explicit price ceiling must not be ignored', async () => {
  const result = await answerConversation(catalog, '3P C16, 10 kA, 8 штук, не дороже 1000 тенге за штуку', terms);
  assert.ok(result.alternatives.every(({ product }) => product.priceKzt <= 1000));
});

test('AUD-04: a correction must not select the negated rating', async () => {
  const result = await answerConversation(catalog, 'Нужен 3P, не C16, а C25, 10 kA, 8 штук', terms);
  assert.equal(result.filters?.amps, 25);
});

test('AUD-05: comparison of two SKUs must address both products', async () => {
  const result = await answerConversation(catalog, 'Сравни DEMO-MCB-003 и DEMO-MCB-004', terms, {}, {
    reply: async () => ({ ...answer, answer: 'DEMO-MCB-003 и DEMO-MCB-004 отличаются ценой и остатком.' }),
  });
  assert.ok(result.answer.includes('DEMO-MCB-003') && result.answer.includes('DEMO-MCB-004'));
});

test('AUD-05: a combined selection and delivery question must still return the selection', async () => {
  const result = await answerConversation(catalog, '3P C16, 10 kA, 8 штук. Какова доставка?', terms);
  assert.equal(result.filters?.quantity, 8);
});

test('AUD-06: legacy search must not bypass the conversation input limit', async (t) => {
  let calls = 0;
  const api = await server(t, { queryParser: { extract: async () => { calls++; throw new Error('stub'); } } });
  const result = await api('/api/search', { query: 'x'.repeat(5000) });
  assert.equal(calls, 0, `Oversized legacy input reached AI; HTTP ${result.status}.`);
});

test('AUD-07: anonymous traffic must not exhaust AI for an independent new session', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const parser = new OpenAIQueryParser({ ...config.openai, url: config.openai.responsesUrl, apiKey: 'audit-fake-key', fetcher: async () => envelope(answer) });
  const api = await server(t, { queryParser: parser });
  for (let index = 0; index < config.openai.maxCalls; index++) {
    await api('/api/search', { query: `Расскажи об ассортименте: ${index}`, conversation: true });
  }
  const session = await api('/api/session', {});
  const result = await api('/api/search', { query: 'Здравствуйте! Что у вас есть?', conversation: true }, { 'X-Session-Id': session.body.sessionId });
  assert.equal(result.body.notice, undefined, 'One anonymous caller exhausted the shared process quota.');
});

for (const [label, body, headers, expected] of [
  ['oversized JSON', JSON.stringify({ query: 'x'.repeat(110000) }), {}, 413],
  ['unsupported encoding', '{}', { 'Content-Encoding': 'unsupported-audit-encoding' }, 415],
]) {
  test(`AUD-08: ${label} must return a client error, not HTTP 500`, async (t) => {
    t.mock.method(console, 'error', () => {});
    const api = await server(t);
    const result = await api('/api/search', body, headers, true);
    assert.equal(result.status, expected);
  });
}

test('AUD-09: simultaneous identical requests must not duplicate conversation history', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const parser = new OpenAIQueryParser({ ...config.openai, url: config.openai.responsesUrl, apiKey: 'audit-fake-key', fetcher: async () => { calls++; await gate; return envelope(answer); } });
  const context = {};
  const first = answerConversation(catalog, 'Что есть в каталоге?', terms, context, parser);
  const duplicate = answerConversation(catalog, 'Что есть в каталоге?', terms, context, parser);
  release();
  await Promise.all([first, duplicate]);
  assert.equal(calls, 1);
  assert.equal(context.history.length, 2);
});

test('AUD-09: late older replies must not overwrite newer conversation state', async () => {
  const pending = new Map();
  const parser = { reply: (query) => new Promise((resolve) => pending.set(query, resolve)) };
  const context = {};
  const firstQuery = 'Первая заявка: 3P C16';
  const secondQuery = 'Вторая заявка: 1P C25';
  const first = answerConversation(catalog, firstQuery, terms, context, parser);
  const second = answerConversation(catalog, secondQuery, terms, context, parser);
  pending.get(secondQuery)({ kind: 'search', answer: '', filters: { ...unknown, poles: 1, curve: 'C', amps: 25 } });
  await second;
  pending.get(firstQuery)({ kind: 'search', answer: '', filters: { ...unknown, poles: 3, curve: 'C', amps: 16 } });
  await first;
  assert.equal(context.pendingFilters.amps, 25);
});

test('AUD-10: partner breaking capacity supplied in amperes must be converted to kA', () => {
  const product = normalizePartnerProduct({
    id: 1, article: 'AUDIT-UNITS', name: 'Автомат 1P C16', price: 100, quantity: 10,
    properties: { NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST: '6000 A' },
  });
  assert.equal(product.breakingCapacityKa, 6);
});

test('AUD-11: matching must account for the minimum order multiple', () => {
  const product = { ...catalog[0], stock: 20, minimumOrderQuantity: 3 };
  const result = searchCatalog([product], { poles: product.poles, curve: product.curve, amps: product.amps, breakingCapacityKa: product.breakingCapacityKa, quantity: 8 });
  assert.equal(result.exactMatch.canFulfill, false);
});
