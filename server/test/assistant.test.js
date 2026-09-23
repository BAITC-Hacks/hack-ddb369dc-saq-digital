import assert from 'node:assert/strict';
import test from 'node:test';
import { answerQuery } from '../src/assistant.js';
import { catalog } from './fixtures.js';

const terms = { sourceUrl: 'https://example.org/terms', payment: 'Оплата картой.', delivery: 'Доставка по условиям.', minimumOrder: 'Минимальная партия не указана.' };

test('answers article inquiry with stock, specifications, and certificate', () => {
  const result = answerQuery(catalog, 'Есть артикул SKU-EXACT, 8 штук?', terms);
  assert.equal(result.intent, 'product');
  assert.equal(result.exactMatch.canFulfill, false);
  assert.deepEqual(result.alternatives.map(({ product }) => product.sku), ['ALT-15', 'ALT-20']);
  assert.match(result.answer, /https:\/\/example.org\/certificate.pdf/);
  assert.equal(result.exactMatch.product.amps, 16);
});

test('answers payment, delivery and minimum batch from sourced terms', () => {
  const result = answerQuery(catalog, 'Какая оплата, доставка и минимальная партия?', terms);
  assert.equal(result.intent, 'purchase_terms');
  assert.match(result.answer, /Оплата картой/);
  assert.match(result.answer, /Доставка по условиям/);
  assert.match(result.answer, /Минимальная партия не указана/);
  assert.equal(result.sourceUrl, terms.sourceUrl);
});

test('article inquiry rejects a zero quantity', () => {
  assert.throws(() => answerQuery(catalog, 'Артикул SKU-EXACT, 0 штук', terms), { code: 'INVALID_QUANTITY' });
});

test('combines a product answer with requested delivery information', () => {
  const result = answerQuery(catalog, 'Артикул SKU-EXACT: наличие и доставка?', terms);
  assert.equal(result.intent, 'product');
  assert.match(result.answer, /В наличии 2 шт/);
  assert.match(result.answer, /Доставка по условиям/);
  assert.equal(result.sourceUrl, terms.sourceUrl);
});
