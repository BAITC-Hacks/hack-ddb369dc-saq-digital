import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerClient, refreshCatalog } from '../src/partner.js';
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
