import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createApp } from '../src/app.js';
import { loadCatalog } from '../src/catalog.js';
import { Sessions } from '../src/sessions.js';

const catalog = await loadCatalog(fileURLToPath(new URL('../../data/catalog.json', import.meta.url)));
if (process.argv.includes('--memory-worker')) {
  const sessions = new Sessions(catalog);
  let rejected = 0;
  for (let count = 1; count <= 20000; count++) {
    try { sessions.create(); } catch (error) {
      assert.equal(error.code, 'SESSION_CAPACITY');
      rejected += 1;
    }
    if (count % 1000 === 0) console.log(JSON.stringify({ attempts: count, sessions: sessions.sessions.size, rejected, heapMiB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) }));
  }
  assert.equal(sessions.sessions.size, 1000);
  assert.equal(rejected, 19000);
  process.exit(0);
}

if (!process.argv[2]) throw new Error('Pass a JSON result file path.');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8', windowsHide: true }).trim();
const report = { revision, date: new Date().toISOString(), scope: 'Isolated server; no OpenAI or partner requests', controls: [] };
const terms = JSON.parse(await readFile(new URL('../purchase-terms.json', import.meta.url), 'utf8'));
const listener = await new Promise((resolve) => {
  const instance = createApp(catalog, { purchaseTerms: terms }).listen(0, '127.0.0.1', () => resolve(instance));
});
const origin = `http://127.0.0.1:${listener.address().port}`;
const request = async (path, body, sessionId) => {
  const start = performance.now();
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(sessionId && { 'X-Session-Id': sessionId }) },
    ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(3000),
  });
  return { status: response.status, body: await response.json(), elapsedMs: performance.now() - start, allowOrigin: response.headers.get('Access-Control-Allow-Origin') };
};
async function batch(count, concurrency, run) {
  let next = 0;
  const results = [];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < count) results.push(await run(next++));
  }));
  const timings = results.map(r => r.elapsedMs).sort((a, b) => a - b);
  return { count, concurrency, statuses: results.reduce((out, r) => { out[r.status] = (out[r.status] ?? 0) + 1; return out; }, {}), p50Ms: Math.round(timings[Math.floor(count * 0.5)]), p95Ms: Math.round(timings[Math.floor(count * 0.95)]), results };
}
try {
  const sessions = await batch(1000, 32, () => request('/api/session', {}));
  report.sessionLoad = { ...sessions, results: undefined };
  assert.equal(sessions.statuses[201], 30);
  assert.equal(sessions.statuses[429], 970);
  const created = sessions.results.filter(result => result.status === 201);
  const id = created[0].body.sessionId;
  const other = created[1].body.sessionId;
  report.controls.push('1000 session requests created 30 sessions and safely rate-limited 970');
  const search = await batch(400, 16, () => request('/api/search', { query: '3P C16, 10 kA, 8 штук', conversation: true }, id));
  report.searchLoad = { ...search, results: undefined };
  assert.equal(search.statuses[200], 400);
  assert.deepEqual((await request('/api/cart', undefined, id)).body.items, []);
  report.controls.push('400 concurrent-batch searches did not change the cart');
  const repeat = await batch(32, 16, () => request('/api/cart', { sku: 'DEMO-MCB-003', quantity: 1, confirmed: true, confirmationId: 'same-confirmation' }, id));
  assert.equal(repeat.statuses[200], 32);
  assert.equal((await request('/api/cart', undefined, id)).body.items[0].quantity, 1);
  report.controls.push('32 concurrent identical confirmations added exactly one unit');
  assert.deepEqual((await request('/api/cart', undefined, other)).body.items, []);
  report.controls.push('Independent session cart remained empty');
  const distinct = await batch(20, 10, (index) => request('/api/cart', { sku: 'DEMO-MCB-003', quantity: 1, confirmed: true, confirmationId: `distinct-${index}` }, other));
  assert.equal(distinct.statuses[200], 12);
  assert.equal(distinct.statuses[409], 8);
  assert.equal((await request('/api/cart', undefined, other)).body.items[0].quantity, 12);
  report.controls.push('20 concurrent distinct cart writes respected stock=12');
  let malformed = 0;
  for (const body of [null, [], {}, { query: 8 }, { query: {} }, { query: '' }, { query: 'x', role: 'system' }, { query: 'x', conversation: 'yes' }]) {
    assert.equal((await request('/api/search', body)).status, 400); malformed++;
  }
  for (const quantity of [-1, 0, 0.5, '8', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await request('/api/cart', { sku: 'DEMO-MCB-003', quantity, confirmed: true, confirmationId: 'bad' }, id)).status, 400); malformed++;
  }
  assert.equal((await request('/api/cart', { sku: 'DEMO-MCB-003', quantity: 1, confirmed: false, confirmationId: 'unconfirmed' }, id)).status, 400);
  assert.equal((await request('/api/cart', undefined, 'unknown-session')).status, 401);
  assert.equal((await request('/api/not-a-route')).status, 404);
  assert.equal((await request('/api/health')).status, 200);
  report.controls.push(`${malformed} malformed bodies rejected; missing confirmation, unknown session and endpoint also rejected`);
  report.anonymousCors = (await request('/api/health')).allowOrigin;
} finally {
  listener.closeAllConnections();
  await new Promise(resolve => listener.close(resolve));
}

// A separate child has a 64 MiB old-space limit and a 15-second deadline.
// Only synthetic session state is allocated; running Docker services are untouched.
report.memory = await new Promise((resolve) => execFile(process.execPath,
  ['--max-old-space-size=64', fileURLToPath(import.meta.url), '--memory-worker'],
  { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true },
  (error, stdout, stderr) => resolve({
    oldSpaceLimitMiB: 64, timeoutMs: 15000, exitCode: error?.code ?? 0,
    killed: error?.killed ?? false, exhausted: /heap out of memory/i.test(stderr),
    samples: stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line)),
  })));
assert.equal(report.memory.exitCode, 0);
assert.equal(report.memory.exhausted, false);
assert.equal(report.memory.samples.at(-1).sessions, 1000);
report.controls.push('20000 allocations under a 64 MiB old-space limit retained 1000 sessions without exhaustion');
await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
