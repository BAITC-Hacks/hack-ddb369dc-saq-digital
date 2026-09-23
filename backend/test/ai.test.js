import assert from 'node:assert/strict';
import test from 'node:test';
import { NvidiaQueryParser } from '../src/ai.js';

test('validates model filters, limits calls, and caches normalized requests', async () => {
  let requests = 0;
  const parser = new NvidiaQueryParser({
    url: 'https://example.org/chat', model: 'demo', apiKey: 'dummy', maxOutputTokens: 180, maxCalls: 1,
    fetcher: async (_url, options) => {
      requests += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.max_tokens, 180);
      assert.equal(body.stream, false);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"poles":3,"curve":"C","amps":16,"breakingCapacityKa":10,"quantity":8}' } }] }) };
    },
  });
  const first = await parser.extract('  Нужен  3P C16 ');
  const second = await parser.extract('нужен 3p c16');
  assert.deepEqual(second, first);
  assert.equal(requests, 1);
  assert.throws(() => parser.extract('другой запрос'), /limit/);
});

test('rejects AI output that invents a SKU', async () => {
  const parser = new NvidiaQueryParser({
    url: 'https://example.org/chat', model: 'demo', apiKey: 'dummy', maxOutputTokens: 180, maxCalls: 1,
    fetcher: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"poles":3,"curve":"C","amps":16,"breakingCapacityKa":10,"quantity":8,"sku":"MADE-UP"}' } }] }) }),
  });
  await assert.rejects(parser.extract('нужен автомат'));
});
