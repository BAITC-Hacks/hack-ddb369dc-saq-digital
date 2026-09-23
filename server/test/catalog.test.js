import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCatalog } from '../src/catalog.js';
import { catalog } from './fixtures.js';

test('accepts demo catalog and rejects duplicate or invalid products', () => {
  assert.equal(validateCatalog(catalog).length, catalog.length);
  assert.throws(() => validateCatalog([...catalog, catalog[0]]));
  assert.throws(() => validateCatalog([{ ...catalog[0], stock: -1 }]));
});
