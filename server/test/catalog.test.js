import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog, normalizePartnerProduct, validateCatalog } from '../src/catalog.js';
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
