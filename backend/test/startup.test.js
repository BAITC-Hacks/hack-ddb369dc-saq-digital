import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('failed initial import retries automatically and publishes recovered catalog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ekt-recovery-'));
  let unavailable = true;
  const partner = createServer((request, response) => {
    if (unavailable) { response.writeHead(503).end(); return; }
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(url.pathname.endsWith('/detail')
      ? { id: 1, article: 'RECOVERED-1', name: 'Recovered product', price: 1500, quantity: 3 }
      : { page: Number(url.searchParams.get('page')), per_page: 20, count: 1, items: [{ id: 1 }] }));
  }).listen(0);
  await once(partner, 'listening');
  const reservation = createServer().listen(0);
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/index.js', import.meta.url))], {
    env: { ...process.env, PORT: String(port), APP_MODE: 'live', OPENAI_API_KEY: '',
      EKT_API_USERNAME: 'test', EKT_API_PASSWORD: 'test',
      EKT_PRODUCT_DETAIL_URL: `http://127.0.0.1:${partner.address().port}/api/products/detail`,
      EKT_CATALOG_CACHE_PATH: join(directory, 'catalog.json') }, stdio: 'ignore',
  });
  const closed = once(child, 'close');
  try {
    const base = `http://127.0.0.1:${port}`;
    const failed = await waitForHealth(base, (health) => health.catalog.status === 'failed');
    assert.equal(failed.catalog.upstreamStatus, 503);
    const remaining = Date.parse(failed.catalog.nextRetryAt) - Date.now();
    assert.ok(remaining > 0 && remaining <= 30000);
    unavailable = false;
    await delay(remaining + 100);
    const recovered = await waitForHealth(base, (health) => health.catalog.cacheSaved);
    assert.equal(recovered.catalog.status, 'ready');
    assert.equal(recovered.catalog.products, 1);
    assert.equal(recovered.catalog.refreshError, undefined);
    assert.equal(recovered.catalog.nextRetryAt, undefined);
    const saved = JSON.parse(await readFile(join(directory, 'catalog.json'), 'utf8'));
    assert.equal(saved.catalog[0].sku, 'RECOVERED-1');
  } finally {
    child.kill(); await closed;
    partner.closeAllConnections();
    await new Promise((resolve) => partner.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('actual entrypoint starts during import and uses partner data even with no local catalog file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ekt-startup-'));
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
      EKT_CATALOG_CACHE_PATH: join(directory, 'catalog.json'),
    },
    stdio: 'ignore',
  });
  const closed = once(child, 'close');
  try {
    const base = `http://127.0.0.1:${port}`;
    const loading = await waitForHealth(base, (health) => health.catalog.status === 'loading');
    assert.equal(loading.catalog.source, 'partner');
    const session = await fetch(`${base}/api/session`, { method: 'POST' });
    assert.equal(session.status, 201);
    releaseDetail();
    const ready = await waitForHealth(base, (health) => health.catalog.status === 'ready' && health.catalog.cacheSaved);
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
    await rm(directory, { recursive: true, force: true });
  }
});

test('restart uses disk cache without partner calls; stale cache stays usable through refresh and failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ekt-restart-'));
  const cachePath = join(directory, 'catalog.json');
  let calls = 0;
  let fail = false;
  let partial = false;
  let release;
  let block;
  let price = 1500;
  let running;
  const partner = createServer(async (request, response) => {
    calls += 1;
    const url = new URL(request.url, 'http://localhost');
    if (fail) { response.writeHead(503).end(); return; }
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/detail')) {
      if (partial && url.searchParams.get('id') === '2') { response.writeHead(503).end(); return; }
      if (block) await block;
      response.end(JSON.stringify({ id: 1, article: 'LIVE-1', name: 'Live product', price, quantity: 3 }));
    } else response.end(JSON.stringify({ page: Number(url.searchParams.get('page')), per_page: 20, count: partial ? 2 : 1, items: partial ? [{ id: 1 }, { id: 2 }] : [{ id: 1 }] }));
  }).listen(0);
  await once(partner, 'listening');
  async function start() {
    const reservation = createServer().listen(0);
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/index.js', import.meta.url))], {
      env: { ...process.env, PORT: String(port), APP_MODE: 'live', OPENAI_API_KEY: '', EKT_API_USERNAME: 'test-user', EKT_API_PASSWORD: 'test-password',
        EKT_PRODUCT_DETAIL_URL: `http://127.0.0.1:${partner.address().port}/api/products/detail`, EKT_CATALOG_CACHE_PATH: cachePath }, stdio: 'ignore',
    });
    const closed = once(child, 'close');
    running = { base: `http://127.0.0.1:${port}`, stop: async () => { child.kill(); await closed; running = undefined; } };
    return running;
  }
  async function search(base, sessionId) {
    return (await fetch(`${base}/api/search`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(sessionId && { 'X-Session-Id': sessionId }) }, body: JSON.stringify({ query: 'LIVE-1', conversation: true }) })).json();
  }
  async function ageCache() {
    const saved = JSON.parse(await readFile(cachePath, 'utf8'));
    saved.loadedAt = new Date(Date.now() - 7200000).toISOString();
    await writeFile(cachePath, JSON.stringify(saved));
  }
  try {
    const first = await start();
    await waitForHealth(first.base, (health) => health.catalog.cacheSaved);
    await first.stop();
    const originalCalls = calls;
    const second = await start();
    const restored = await waitForHealth(second.base, (health) => health.catalog.status === 'ready');
    assert.equal(restored.catalog.cached, true);
    assert.equal(restored.catalog.refreshing, false);
    assert.equal((await search(second.base)).exactMatch.product.priceKzt, 1500);
    assert.equal(calls, originalCalls);
    await second.stop();

    await ageCache();
    price = 2000;
    block = new Promise((resolve) => { release = resolve; });
    const third = await start();
    const refreshing = await waitForHealth(third.base, (health) => health.catalog.refreshing);
    assert.equal(refreshing.catalog.status, 'ready');
    assert.equal(refreshing.catalog.stale, true);
    const { sessionId } = await (await fetch(`${third.base}/api/session`, { method: 'POST' })).json();
    const saved = await search(third.base, sessionId);
    assert.equal(saved.exactMatch.product.priceKzt, 1500);
    release();
    await waitForHealth(third.base, (health) => health.catalog.cacheSaved && !health.catalog.refreshing);
    // The same session/query must see the replacement, rather than its last cached answer.
    assert.equal((await search(third.base, sessionId)).exactMatch.product.priceKzt, 2000);
    const cart = await (await fetch(`${third.base}/api/cart`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId }, body: JSON.stringify({ sku: 'LIVE-1', quantity: 1, confirmed: true, confirmationId: 'after-refresh' }) })).json();
    assert.equal(cart.items[0].unitPriceKzt, 2000);
    await third.stop();

    await ageCache();
    partial = true;
    price = 2500;
    const incomplete = await start();
    await waitForHealth(incomplete.base, (health) => health.catalog.refreshError);
    assert.equal((await search(incomplete.base)).exactMatch.product.priceKzt, 2000);
    assert.equal(JSON.parse(await readFile(cachePath, 'utf8')).catalog[0].priceKzt, 2000);
    await incomplete.stop();
    partial = false;
    fail = true;
    const fourth = await start();
    const failedRefresh = await waitForHealth(fourth.base, (health) => health.catalog.refreshError);
    assert.equal(failedRefresh.catalog.status, 'ready');
    assert.equal((await search(fourth.base)).exactMatch.product.priceKzt, 2000);
    assert.equal(JSON.parse(await readFile(cachePath, 'utf8')).catalog[0].priceKzt, 2000);
    await fourth.stop();
  } finally {
    release?.();
    if (running) await running.stop();
    partner.closeAllConnections();
    await new Promise((resolve) => partner.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
