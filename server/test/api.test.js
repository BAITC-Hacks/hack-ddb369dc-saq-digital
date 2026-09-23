import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { catalog } from './fixtures.js';

async function withServer(run) {
  const server = createApp(catalog).listen(0);
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('search leaves cart untouched, confirmation adds once', async () => {
  await withServer(async (base) => {
    const search = await post(base, '/api/search', { query: '3P C16, 10 kA, 8 штук' });
    assert.equal(search.status, 200);
    assert.equal(search.body.alternatives[0].product.sku, 'ALT-15');
    assert.deepEqual(await (await fetch(`${base}/api/cart`)).json(), { items: [], totalPriceKzt: 0 });

    const request = { sku: 'ALT-15', quantity: 8, confirmed: true, confirmationId: 'click-1' };
    const first = await post(base, '/api/cart', request);
    const retry = await post(base, '/api/cart', request);
    assert.equal(first.status, 200);
    assert.deepEqual(retry.body, first.body);
    assert.equal(retry.body.items[0].quantity, 8);
  });
});

test('API rejects missing confirmation and malformed query', async () => {
  await withServer(async (base) => {
    const cart = await post(base, '/api/cart', { sku: 'EXACT', quantity: 1, confirmed: false, confirmationId: 'click-2' });
    assert.equal(cart.status, 400);
    const search = await post(base, '/api/search', { query: 'автомат' });
    assert.equal(search.status, 422);
    assert.deepEqual(await (await fetch(`${base}/api/cart`)).json(), { items: [], totalPriceKzt: 0 });
  });
});
