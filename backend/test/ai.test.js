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
