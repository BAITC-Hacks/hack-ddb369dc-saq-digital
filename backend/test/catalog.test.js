import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog, normalizeDemoProduct, normalizePartnerProduct, validateCatalog } from '../src/catalog.js';
import { catalog } from './fixtures.js';

test('accepts demo catalog and rejects duplicate or invalid products', () => {
  assert.equal(validateCatalog(catalog).length, catalog.length);
  assert.throws(() => validateCatalog([...catalog, catalog[0]]));
  assert.throws(() => validateCatalog([{ ...catalog[0], stock: -1 }]));
});

test('normalizes partner detail and excludes conflicting electrical ratings', () => {
  const product = normalizePartnerProduct({
    id: 515291, name: 'Автомат 3ф 160А 18ka', article: '200300285_', price: 64920, quantity: 23,
    properties: { KOLICHESTVO_POLYUSOV: '3', NOMINALNYY_TOK: '250 А', NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST: '18кА', KRATNOST_MIN: '1' },
  });
  assert.equal(product.sku, '200300285_');
  assert.equal(product.stock, 23);
  assert.equal(product.poles, 3);
  assert.equal(product.breakingCapacityKa, 18);
  assert.equal(product.amps, null);
  assert.match(product.technicalIssue, /расходятся/);
  assert.equal(product.minimumOrderQuantity, 1);
});

test('loads a local JSON catalog for offline mode', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ekt-catalog-'));
  const path = join(directory, 'catalog.json');
  try {
    await writeFile(path, JSON.stringify(catalog));
    const loaded = await loadCatalog(path);
    assert.equal(loaded[0].sku, 'EXACT');
    assert.equal(loaded.length, catalog.length);
  } finally {
    await unlink(path);
    await rmdir(directory);
  }
});

test('maps the data team demo fields into backend fields', () => {
  const product = normalizeDemoProduct({
    sku: 'DEMO-MCB-003', name: 'Автомат Demo Power 3P C16 15 kA', brand: 'Demo Power',
    poles: 3, curve: 'C', amps: 16, breakingCapacity: 15, price: 7900, currency: 'KZT', stock: 12,
  });
  assert.equal(product.breakingCapacityKa, 15);
  assert.equal(product.priceKzt, 7900);
  assert.equal(product.brand, 'Demo Power');
  assert.equal(product.stock, 12);
});

test('converts only explicit breaking capacity units and reconciles names in kA', () => {
  const raw = { id: 1, article: 'UNIT-TEST', name: 'Автомат 1P C16 6 kA', price: 100, quantity: 10 };
  for (const value of ['6000 A', '6000 А', '6 kA', '6кА']) {
    const product = normalizePartnerProduct({ ...raw, properties: { NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST: value } });
    assert.equal(product.breakingCapacityKa, 6, value);
    assert.equal(product.technicalIssue, undefined, value);
  }
  assert.equal(normalizePartnerProduct({ ...raw, name: 'Автомат 1P C16', properties: { NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST: '6000 A' } }).breakingCapacityKa, 6);
  assert.equal(normalizePartnerProduct({ ...raw, name: 'Автомат 1P C16 .5 kA' }).breakingCapacityKa, 0.5);
});

test('excludes missing, unknown, negative or conflicting partner capacity values from matching', () => {
  const raw = { id: 1, article: 'UNIT-TEST', name: 'Автомат 1P C16 6 kA', price: 100, quantity: 10 };
  for (const value of ['6000', 6000, '6000 V', '6 kA / 10 kA', '-6000 A', '0 kA', '6 A kA', '10000 A']) {
    const product = normalizePartnerProduct({ ...raw, properties: { NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST: value } });
    assert.equal(product.breakingCapacityKa, null, String(value));
    assert.ok(product.technicalIssue, String(value));
  }
  for (const name of ['Автомат 1P C16 -6 kA', 'Автомат 1P C16 6 kA / 10 kA']) {
    const product = normalizePartnerProduct({ ...raw, name });
    assert.equal(product.breakingCapacityKa, null, name);
    assert.ok(product.technicalIssue, name);
  }
  const absent = normalizePartnerProduct({ ...raw, name: 'Автомат 1P C16' });
  assert.equal(absent.breakingCapacityKa, null);
});
