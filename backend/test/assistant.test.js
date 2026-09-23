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

test('new specifications replace remembered product while incomplete specifications ask for details', () => {
  const context = { lastSku: 'EXACT' };
  const result = answerQuery(catalog, '1P B10, 6 kA, 4 штуки', terms, context);
  assert.equal(result.intent, 'specifications');
  assert.equal(result.filters.poles, 1);
  assert.equal(result.exactMatch, null);
  assert.throws(() => answerQuery(catalog, '1P B10, 4 штуки', terms, context), { code: 'MISSING_SPECIFICATIONS' });
});

test('product inquiries preserve requested quantity when technical ratings are unknown', () => {
  const products = [{ sku: 'PARTNER-ITEM', name: 'Товар', priceKzt: 500, stock: 10 }];
  const result = answerQuery(products, 'PARTNER-ITEM, 3 штуки', terms);
  assert.equal(result.filters, null);
  assert.equal(result.quantity, 3);
  assert.equal(result.exactMatch.canFulfill, true);
});
