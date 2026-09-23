import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCatalogCache, writeCatalogCache } from '../src/catalog-cache.js';

const sourceKey = 'test-source-hash';
const catalog = [{ id: 1, sku: 'PARTNER-1', name: 'Partner product', priceKzt: 1500, stock: 3.5 }];

async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'ekt-catalog-cache-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, path: join(directory, 'catalog.json') };
}

function snapshot(overrides = {}) {
  return { version: 1, sourceKey, catalog, loadedAt: new Date().toISOString(), ...overrides };
}

test('persists a validated partner snapshot and creates parent directories', async (context) => {
  const { directory } = await fixture(context);
  const path = join(directory, 'nested', 'catalog.json');
  const input = snapshot();
  await writeCatalogCache(path, sourceKey, input);
  assert.deepEqual(await readCatalogCache(path, sourceKey), { catalog, loadedAt: input.loadedAt });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), input);
  assert.deepEqual(await readdir(join(directory, 'nested')), ['catalog.json']);
});

test('replaces a prior snapshot only after successful validation and writing', async (context) => {
  const { directory, path } = await fixture(context);
  const initial = snapshot();
  await writeCatalogCache(path, sourceKey, initial);
  await assert.rejects(writeCatalogCache(path, sourceKey, snapshot({ catalog: [...catalog, ...catalog] })));
  assert.deepEqual(await readCatalogCache(path, sourceKey), { catalog, loadedAt: initial.loadedAt });
  const updated = snapshot({ catalog: [{ ...catalog[0], stock: 10 }] });
  await writeCatalogCache(path, sourceKey, updated);
  assert.deepEqual(await readCatalogCache(path, sourceKey), { catalog: updated.catalog, loadedAt: updated.loadedAt });
  assert.deepEqual(await readdir(directory), ['catalog.json']);
});

test('ignores missing, unreadable and malformed cache files', async (context) => {
  const { directory, path } = await fixture(context);
  assert.equal(await readCatalogCache(path, sourceKey), null);
  assert.equal(await readCatalogCache(directory, sourceKey), null);
  for (const content of ['{', 'null', '[]', '42']) {
    await writeFile(path, content);
    assert.equal(await readCatalogCache(path, sourceKey), null);
  }
});

test('rejects incompatible sources, versions, timestamps and invalid or demo catalogs', async (context) => {
  const { path } = await fixture(context);
  const invalid = [
    { version: 2 },
    { sourceKey: 'another-partner' },
    { loadedAt: null },
    { loadedAt: 'invalid' },
    { loadedAt: '2026-02-31T00:00:00.000Z' },
    { loadedAt: new Date(Date.now() + 120_000).toISOString() },
    { catalog: [] },
    { catalog: [...catalog, ...catalog] },
    { catalog: [{ ...catalog[0], stock: -1 }] },
    { catalog: [{ sku: 'DEMO', name: 'Demo', priceKzt: 1, stock: 1 }] },
  ];
  for (const overrides of invalid) {
    await writeFile(path, JSON.stringify(snapshot(overrides)));
    assert.equal(await readCatalogCache(path, sourceKey), null, JSON.stringify(overrides));
  }
  await writeFile(path, JSON.stringify(snapshot()));
  assert.equal(await readCatalogCache(path, ''), null);
});

test('retains an old valid snapshot for immediate startup and accepts small clock skew', async (context) => {
  const { path } = await fixture(context);
  for (const loadedAt of ['2020-01-01T00:00:00.000Z', new Date(Date.now() + 30_000).toISOString()]) {
    await writeCatalogCache(path, sourceKey, { catalog, loadedAt });
    assert.equal((await readCatalogCache(path, sourceKey)).loadedAt, loadedAt);
  }
});

test('propagates write failures and removes temporary files when replacement fails', async (context) => {
  const { directory, path } = await fixture(context);
  await mkdir(path);
  await assert.rejects(writeCatalogCache(path, sourceKey, snapshot()));
  assert.deepEqual(await readdir(directory), ['catalog.json']);
  assert.deepEqual(await readdir(path), []);
  const blockedParent = join(directory, 'not-a-directory');
  await writeFile(blockedParent, 'unchanged');
  await assert.rejects(writeCatalogCache(join(blockedParent, 'catalog.json'), sourceKey, snapshot()));
  assert.equal(await readFile(blockedParent, 'utf8'), 'unchanged');
});
