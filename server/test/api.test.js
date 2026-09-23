import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { catalog } from './fixtures.js';

async function withServer(run, options) {
  const server = createApp(catalog, options).listen(0);
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
