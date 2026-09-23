import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerClient, refreshCatalog, loadPartnerCatalog } from '../src/partner.js';
import { catalog } from './fixtures.js';

test('fetches partner detail using Basic Auth without leaking credentials into URL', async () => {
  const client = new PartnerClient({
    detailUrl: 'https://example.org/detail', username: 'user', password: 'secret',
    fetcher: async (url, options) => {
      assert.equal(url.searchParams.get('id'), '515291');
      assert.equal(url.username, '');
      assert.match(options.headers.Authorization, /^Basic /);
      return { ok: true, json: async () => ({
        id: 515291, name: 'Автомат 3P C16 10ka', article: 'ARTICLE-1', price: 12000, quantity: 4,
        properties: { KOLICHESTVO_POLYUSOV: '3', NOMINALNYY_TOK: '16 А', NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST: '10кА' },
      }) };
    },
  });
  const product = await client.detail(515291);
  assert.equal(product.article, 'ARTICLE-1');
  assert.equal(product.stock, 4);
});

test('falls back to local item when partner detail is unavailable', async () => {
  const local = { ...catalog[0], id: 515291 };
  const result = await refreshCatalog([local], { detail: async () => { throw new Error('unavailable'); } });
  assert.deepEqual(result.catalog, [local]);
  assert.equal(result.failed, 1);
});

const product = (id) => ({ ...catalog[0], id, sku: `REAL-${id}`, article: `REAL-${id}` });
const page = (number, ids, size = 2) => ({ page: number, per_page: size, count: ids.length, items: ids.map((id) => ({ id })) });

test('reads paginated product IDs from the detail endpoint sibling using Basic Auth', async () => {
  const client = new PartnerClient({
    detailUrl: 'https://example.org/api/products/detail', username: 'user', password: 'secret',
    fetcher: async (url, options) => {
      assert.equal(url.href, 'https://example.org/api/products?page=2');
      assert.equal(options.headers.Authorization, `Basic ${Buffer.from('user:secret').toString('base64')}`);
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => page(2, [3]) };
    },
  });
  assert.deepEqual((await client.page(2)).items, [{ id: 3 }]);
});

test('rejects unavailable or inconsistent pages and mismatched product details', async () => {
  const options = { detailUrl: 'https://example.org/detail', username: 'user', password: 'secret' };
  await assert.rejects(new PartnerClient({ ...options, fetcher: async () => ({ ok: false, status: 401 }) }).page(1), /HTTP 401/);
  for (const payload of [page(2, [1]), { ...page(1, [1]), count: 20 }, { ...page(1, [1]), items: [{}] }]) {
    await assert.rejects(new PartnerClient({ ...options, fetcher: async () => ({ ok: true, json: async () => payload }) }).page(1));
  }
  const client = new PartnerClient({ ...options, fetcher: async () => ({ ok: true, json: async () => ({ id: 2, article: 'other', name: 'Other', price: 100, quantity: 2 }) }) });
  await assert.rejects(client.detail(1), /different product/);
});

test('imports every page, deduplicates IDs, hydrates details with bounded concurrency and never mixes demo data', async () => {
  const requestedPages = []; const requestedIds = []; const progress = [];
  let active = 0; let peak = 0;
  const result = await loadPartnerCatalog({
    page: async (number) => { requestedPages.push(number); return [page(1, [1, 2]), page(2, [2, 3]), page(3, [4])][number - 1]; },
    detail: async (id) => {
      requestedIds.push(id); peak = Math.max(peak, ++active);
      await new Promise((resolve) => setImmediate(resolve)); active--;
      return product(id);
    },
  }, { concurrency: 2, onProgress: (event) => progress.push(event) });
  assert.deepEqual(requestedPages, [1, 2, 3, 4]);
  assert.deepEqual(requestedIds.sort(), [1, 2, 3, 4]);
  assert.equal(peak, 2);
  assert.deepEqual(result.catalog.map((item) => item.sku), ['REAL-1', 'REAL-2', 'REAL-3', 'REAL-4']);
  assert.equal(result.failed, 0); assert.equal(result.listed, 4);
  assert.equal(progress.at(-1).completed, 4);
});

test('stops on a short/empty page or the first page repeated by EKT beyond the last page', async () => {
  for (const terminal of [page(3, []), page(3, [1, 2])]) {
    let pages = 0;
    const result = await loadPartnerCatalog({
      page: async (number) => { pages++; return [page(1, [1, 2]), page(2, [3, 4]), terminal][number - 1]; },
      detail: async (id) => product(id),
    }, { concurrency: 1 });
    assert.equal(pages, 3); assert.equal(result.catalog.length, 4);
  }
});

test('does not publish a partially read index after a page failure, loop or safety limit', async () => {
  let details = 0;
  const detail = async (id) => { details++; return product(id); };
  await assert.rejects(loadPartnerCatalog({ page: async (number) => { if (number === 2) throw new Error('offline'); return page(1, [1, 2]); }, detail }), /offline/);
  await assert.rejects(loadPartnerCatalog({ page: async (number) => page(number, number === 1 ? [1, 2] : [3, 4]), detail }), /non-first/);
  await assert.rejects(loadPartnerCatalog({ page: async (number) => page(number, [number * 2, number * 2 + 1]), detail }, { maxPages: 2 }), /limit/);
  assert.equal(details, 0);
});

test('excludes unavailable details and ambiguous SKUs rather than inventing stock or keeping index entries', async () => {
  const result = await loadPartnerCatalog({
    page: async () => page(1, [1, 2, 3, 4], 5),
    detail: async (id) => { if (id === 1) throw new Error('unavailable'); return { ...product(id), sku: id <= 3 ? 'DUPLICATE' : 'UNIQUE' }; },
  });
  assert.deepEqual(result.catalog.map((item) => item.sku), ['UNIQUE']);
  assert.equal(result.failed, 3);
});

test('fails explicitly for empty catalogs, entirely failed details and invalid import limits', async () => {
  const client = { page: async () => page(1, [1]), detail: async () => { throw new Error('offline'); } };
  await assert.rejects(loadPartnerCatalog(client), /no usable/);
  await assert.rejects(loadPartnerCatalog({ ...client, page: async () => page(1, []) }), /no usable/);
  await assert.rejects(loadPartnerCatalog(client, { maxPages: 0 }), /maxPages/);
  await assert.rejects(loadPartnerCatalog(client, { concurrency: 0 }), /concurrency/);
});
