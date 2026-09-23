import assert from 'node:assert/strict';
import test from 'node:test';
import { Cart } from '../src/cart.js';
import { catalog } from './fixtures.js';

test('adds only after confirmation and calculates total', () => {
  const cart = new Cart(catalog);
  assert.throws(() => cart.add({ sku: 'ALT-15', quantity: 8, confirmed: false, confirmationId: 'a' }), { code: 'CONFIRMATION_REQUIRED' });
  assert.deepEqual(cart.snapshot(), { items: [], totalPriceKzt: 0 });
  const result = cart.add({ sku: 'ALT-15', quantity: 8, confirmed: true, confirmationId: 'a' });
  assert.equal(result.items[0].quantity, 8);
  assert.equal(result.totalPriceKzt, 112000);
});

test('retries are idempotent and conflicting IDs are rejected', () => {
  const cart = new Cart(catalog);
  const request = { sku: 'ALT-15', quantity: 3, confirmed: true, confirmationId: 'a' };
  cart.add(request);
  cart.add(request);
  assert.equal(cart.snapshot().items[0].quantity, 3);
  assert.throws(() => cart.add({ ...request, quantity: 2 }), { code: 'CONFIRMATION_CONFLICT' });
  assert.equal(cart.snapshot().items[0].quantity, 3);
});

test('rejects overstock without mutating cart', () => {
  const cart = new Cart(catalog);
  cart.add({ sku: 'EXACT', quantity: 2, confirmed: true, confirmationId: 'a' });
  assert.throws(() => cart.add({ sku: 'EXACT', quantity: 1, confirmed: true, confirmationId: 'b' }), { code: 'INSUFFICIENT_STOCK' });
  assert.equal(cart.snapshot().items[0].quantity, 2);
});
