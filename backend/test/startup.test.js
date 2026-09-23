import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

async function waitForHealth(base, predicate) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      const health = await response.json();
      if (predicate(health)) return health;
    } catch { /* The child may still be starting. */ }
    await delay(50);
  }
  assert.fail('Backend did not reach the expected catalog state');
}

test('actual entrypoint starts during import and uses partner data even with no local catalog file', async () => {
  let releaseDetail;
  const detailReady = new Promise((resolve) => { releaseDetail = resolve; });
  const partner = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Basic ${Buffer.from('test-user:test-password').toString('base64')}`);
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/detail')) {
      await detailReady;
      response.end(JSON.stringify({ id: 1, article: 'LIVE-1', name: 'Live product', price: 1500, quantity: 3 }));
    } else {
      const page = Number(url.searchParams.get('page'));
      response.end(JSON.stringify({ page, per_page: 20, count: 1, items: [{ id: 1 }] }));
    }
  }).listen(0);
  await once(partner, 'listening');
  const portReservation = createServer().listen(0);
  await once(portReservation, 'listening');
  const port = portReservation.address().port;
  await new Promise((resolve) => portReservation.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/index.js', import.meta.url))], {
    env: {
      ...process.env, PORT: String(port), APP_MODE: 'live', OPENAI_API_KEY: '',
      EKT_API_USERNAME: 'test-user', EKT_API_PASSWORD: 'test-password',
      EKT_PRODUCT_DETAIL_URL: `http://127.0.0.1:${partner.address().port}/api/products/detail`,
      CATALOG_PATH: fileURLToPath(new URL('./missing-local-catalog.json', import.meta.url)),
    },
    stdio: 'ignore',
  });
  const closed = once(child, 'close');
  try {
    const base = `http://127.0.0.1:${port}`;
    const loading = await waitForHealth(base, (health) => health.catalog.status === 'loading');
    assert.equal(loading.catalog.source, 'partner');
    const unavailable = await fetch(`${base}/api/session`, { method: 'POST' });
    assert.equal(unavailable.status, 503);
    releaseDetail();
    const ready = await waitForHealth(base, (health) => health.catalog.status === 'ready');
    assert.equal(ready.catalog.products, 1);
    assert.ok(ready.catalog.loadedAt);
    const response = await fetch(`${base}/api/search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'LIVE-1' }),
    });
    const result = await response.json();
    assert.equal(result.exactMatch.product.priceKzt, 1500);
    assert.equal(result.exactMatch.product.stock, 3);
  } finally {
    releaseDetail();
    child.kill();
    await closed;
    partner.closeAllConnections();
    await new Promise((resolve) => partner.close(resolve));
  }
});
