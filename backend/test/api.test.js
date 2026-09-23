import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { loadCatalog } from '../src/catalog.js';
import { fileURLToPath } from 'node:url';
import { catalog } from './fixtures.js';

async function withServer(run, options, products = catalog) {
  const server = createApp(products, options).listen(0);
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function post(base, path, body, sessionId) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(sessionId && { 'X-Session-Id': sessionId }) }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function getCart(base, sessionId) {
  return (await fetch(`${base}/api/cart`, { headers: { 'X-Session-Id': sessionId } })).json();
}

test('search leaves cart untouched, confirmation adds once', async () => {
  await withServer(async (base) => {
    const { body: { sessionId } } = await post(base, '/api/session', {});
    const search = await post(base, '/api/search', { query: '3P C16, 10 kA, 8 штук' });
    assert.equal(search.status, 200);
    assert.equal(search.body.alternatives[0].product.sku, 'ALT-15');
    assert.deepEqual(await getCart(base, sessionId), { items: [], totalPriceKzt: 0 });

    const request = { sku: 'ALT-15', quantity: 8, confirmed: true, confirmationId: 'click-1' };
    const first = await post(base, '/api/cart', request, sessionId);
    const retry = await post(base, '/api/cart', request, sessionId);
    assert.equal(first.status, 200);
    assert.deepEqual(retry.body, first.body);
    assert.equal(retry.body.items[0].quantity, 8);
  });
});

test('API rejects missing confirmation and malformed query', async () => {
  await withServer(async (base) => {
    const { body: { sessionId } } = await post(base, '/api/session', {});
    const cart = await post(base, '/api/cart', { sku: 'EXACT', quantity: 1, confirmed: false, confirmationId: 'click-2' }, sessionId);
    assert.equal(cart.status, 400);
    const search = await post(base, '/api/search', { query: 'автомат' });
    assert.equal(search.status, 422);
    assert.deepEqual(await getCart(base, sessionId), { items: [], totalPriceKzt: 0 });
  });
});

test('cart state is isolated by session', async () => {
  await withServer(async (base) => {
    const { body: { sessionId: first } } = await post(base, '/api/session', {});
    const { body: { sessionId: second } } = await post(base, '/api/session', {});
    await post(base, '/api/cart', { sku: 'EXACT', quantity: 1, confirmed: true, confirmationId: 'click-3' }, first);
    assert.equal((await getCart(base, first)).items.length, 1);
    assert.deepEqual(await getCart(base, second), { items: [], totalPriceKzt: 0 });
    const missingSession = await fetch(`${base}/api/cart`);
    assert.equal(missingSession.status, 401);
  });
});

test('product context is available only in the same session', async () => {
  await withServer(async (base) => {
    const { body: { sessionId: first } } = await post(base, '/api/session', {});
    const { body: { sessionId: second } } = await post(base, '/api/session', {});
    await post(base, '/api/search', { query: 'Артикул SKU-EXACT' }, first);
    const followUp = await post(base, '/api/search', { query: 'А сертификат есть?' }, first);
    assert.equal(followUp.status, 200);
    assert.match(followUp.body.answer, /certificate.pdf/);
    const otherSession = await post(base, '/api/search', { query: 'А сертификат есть?' }, second);
    assert.equal(otherSession.status, 422);
  });
});

test('uses validated AI filters only to search local catalog', async () => {
  let calls = 0;
  await withServer(async (base) => {
    const result = await post(base, '/api/search', { query: 'Нужны восемь таких автоматов' });
    assert.equal(result.status, 200);
    assert.equal(result.body.alternatives[0].product.sku, 'ALT-15');
    assert.equal(calls, 1);
  }, { queryParser: { extract: async () => {
    calls += 1;
    return { poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10, quantity: 8 };
  } } });
});

test('cart response includes the configured frontend cart route', async () => {
  await withServer(async (base) => {
    const { body: { sessionId } } = await post(base, '/api/session', {});
    const result = await post(base, '/api/cart', {
      sku: 'EXACT', quantity: 1, confirmed: true, confirmationId: 'cart-link-1',
    }, sessionId);
    assert.equal(result.status, 200);
    assert.equal(result.body.cartUrl, '/cart');
    assert.equal(result.body.items[0].quantity, 1);
  }, { cartUrl: '/cart' });
});

test('team catalog supports all ten demo queries in one session and confirmed checkout', async () => {
  const products = await loadCatalog(fileURLToPath(new URL('../../data/catalog.json', import.meta.url)));
  const scenarios = [
    ['3P C16, 10 kA, 8 штук', ['DEMO-MCB-003', 'DEMO-MCB-004']],
    ['1P B10, 6 kA, 4 штуки', ['DEMO-MCB-013']],
    ['3P C16, 10 kA, 3 штуки', ['DEMO-MCB-001']],
    ['3P C16, 10 kA, 12 штук', ['DEMO-MCB-003']],
    ['3P C16, 10 kA, 13 штук', []],
    ['1P C25, 6 kA, 1 штука', []],
    ['3P C32, 10 kA, 10 штук', ['DEMO-MCB-035']],
    ['1P C16, 4.5 kA, 2 штуки', ['DEMO-MCB-040']],
    ['3P B16, 10 kA, 2 штуки', ['DEMO-MCB-006']],
    ['4P D63, 15 kA, 1 штука', []],
  ];
  await withServer(async (base) => {
    const { body: { sessionId } } = await post(base, '/api/session', {});
    for (const [query, expected] of scenarios) {
      const result = await post(base, '/api/search', { query }, sessionId);
      assert.equal(result.status, 200, query);
      assert.equal(result.body.intent, 'specifications', query);
      const available = result.body.exactMatch?.canFulfill
        ? [result.body.exactMatch.product.sku]
        : result.body.alternatives.map(({ product }) => product.sku);
      assert.deepEqual(available, expected, query);
      assert.deepEqual((await getCart(base, sessionId)).items, []);
    }
    const confirmation = { sku: 'DEMO-MCB-003', quantity: 8, confirmed: true, confirmationId: 'team-demo-confirmation' };
    assert.equal((await post(base, '/api/cart', { ...confirmation, confirmed: false }, sessionId)).status, 400);
    assert.deepEqual((await getCart(base, sessionId)).items, []);
    const added = await post(base, '/api/cart', confirmation, sessionId);
    assert.equal(added.status, 200);
    assert.equal(added.body.items[0].quantity, 8);
    assert.equal(added.body.totalPriceKzt, 63200);
    assert.equal(added.body.cartUrl, '/cart');
    assert.deepEqual((await post(base, '/api/cart', confirmation, sessionId)).body, added.body);
    const excess = await post(base, '/api/cart', { ...confirmation, confirmationId: 'too-many' }, sessionId);
    assert.equal(excess.status, 409);
    assert.deepEqual(await getCart(base, sessionId), added.body);
  }, { cartUrl: '/cart' }, products);
});

test('serves the frontend and cart route while unknown API routes stay JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ekt-frontend-'));
  try {
    await writeFile(join(directory, 'index.html'), '<main>EKT frontend</main>');
    await withServer(async (base) => {
      for (const path of ['/', '/cart', '/cart/']) {
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /text\/html/);
        assert.match(await response.text(), /EKT frontend/);
      }
      const response = await fetch(`${base}/api/unknown`);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error.code, 'NOT_FOUND');
    }, { staticDirectory: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
