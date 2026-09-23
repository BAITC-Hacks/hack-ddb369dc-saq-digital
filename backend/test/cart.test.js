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

test('enforces a known minimum order multiple', () => {
  const cart = new Cart([{ ...catalog[0], stock: 10, minimumOrderQuantity: 5 }]);
  assert.throws(() => cart.add({ sku: 'EXACT', quantity: 3, confirmed: true, confirmationId: 'a' }), { code: 'INVALID_ORDER_MULTIPLE' });
  assert.deepEqual(cart.snapshot().items, []);
  assert.equal(cart.add({ sku: 'EXACT', quantity: 5, confirmed: true, confirmationId: 'a' }).items[0].quantity, 5);
});

test('a cart created before catalog load can add products published later', () => {
  const products = [];
  const cart = new Cart(products);
  const request = { sku: 'EXACT', quantity: 1, confirmed: true, confirmationId: 'after-load' };
  assert.throws(() => cart.add(request), { code: 'SKU_NOT_FOUND' });
  assert.deepEqual(cart.snapshot(), { items: [], totalPriceKzt: 0 });
  products.push(...catalog);
  assert.equal(cart.add(request).items[0].sku, 'EXACT');
});

test('refreshes use new stock and price for additions while preserving accepted cart snapshots on failure', () => {
  const products = catalog.map((product) => ({ ...product }));
  const cart = new Cart(products);
  const request = { sku: 'EXACT', quantity: 1, confirmed: true, confirmationId: 'original' };
  const original = cart.add(request);
  const product = products.find((item) => item.sku === 'EXACT');
  product.priceKzt += 100;
  product.stock = 1;
  assert.deepEqual(cart.snapshot(), original, 'An in-place refresh cannot silently change accepted prices');
  assert.throws(() => cart.add({ ...request, confirmationId: 'new' }), { code: 'INSUFFICIENT_STOCK' });
  assert.deepEqual(cart.snapshot(), original);
  assert.deepEqual(cart.add(request), original);
  const refreshed = { ...product, stock: 10 };
  products.splice(0, products.length, refreshed);
  const added = cart.add({ ...request, confirmationId: 'new' });
  assert.equal(added.items[0].quantity, 2);
  assert.equal(added.items[0].unitPriceKzt, refreshed.priceKzt);
});

test('successful confirmation retries survive a removed product and conflict before current catalog lookup', () => {
  const products = [...catalog];
  const cart = new Cart(products);
  const request = { sku: 'EXACT', quantity: 1, confirmed: true, confirmationId: 'accepted' };
  const original = cart.add(request);
  products.splice(0, products.length);
  assert.deepEqual(cart.add(request), original);
  assert.throws(() => cart.add({ ...request, sku: 'another' }), { code: 'CONFIRMATION_CONFLICT' });
  assert.throws(() => cart.add({ ...request, confirmationId: 'new' }), { code: 'SKU_NOT_FOUND' });
  assert.deepEqual(cart.snapshot(), original);
});
