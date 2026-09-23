import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQuery, searchCatalog } from '../src/search.js';
import { catalog } from './fixtures.js';

test('parses the demo request with comma decimals and case insensitive units', () => {
  assert.deepEqual(parseQuery('Нужен автомат 3p c16, 10,5 KA, 8 штук'), {
    poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10.5, quantity: 8,
  });
});

test('parses Cyrillic electrical notation', () => {
  assert.deepEqual(parseQuery('Автомат 3Р С16, 10 кА, 8 шт.'), {
    poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10, quantity: 8,
  });
});

test('parses singular quantity and fractional breaking capacity', () => {
  assert.deepEqual(parseQuery('Нужен автомат 1P C16, 4.5 kA, 1 штука'), {
    poles: 1, curve: 'C', amps: 16, breakingCapacityKa: 4.5, quantity: 1,
  });
});

test('rejects missing and invalid specifications', () => {
  assert.throws(() => parseQuery('нужен автомат'), { code: 'MISSING_SPECIFICATIONS' });
  assert.throws(() => parseQuery('3P C16, 10 kA, 0 штук'), { code: 'INVALID_SPECIFICATIONS' });
});

test('returns insufficient exact stock and only compatible stocked alternatives', () => {
  const result = searchCatalog(catalog, parseQuery('3P C16, 10 kA, 8 штук'));
  assert.equal(result.exactMatch.product.sku, 'EXACT');
  assert.equal(result.exactMatch.canFulfill, false);
  assert.deepEqual(result.alternatives.map(({ product }) => product.sku), ['ALT-15', 'ALT-20']);
  assert.match(result.alternatives[0].reason, /15 kA/);
});

test('returns a sufficient exact match without alternatives', () => {
  const result = searchCatalog(catalog, parseQuery('3P C16, 10 kA, 2 штуки'));
  assert.equal(result.exactMatch.canFulfill, true);
  assert.deepEqual(result.alternatives, []);
});

test('returns an empty result for an unknown specification', () => {
  const result = searchCatalog(catalog, parseQuery('3P D63, 10 kA, 1 шт'));
  assert.equal(result.exactMatch, null);
  assert.deepEqual(result.alternatives, []);
});
