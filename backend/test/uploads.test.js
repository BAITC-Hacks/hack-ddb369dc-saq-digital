import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/app.js';
import { Uploads } from '../src/uploads.js';
import { catalog } from './fixtures.js';

const extraction = { items: [{ description: 'Breaker', article: 'EXACT', quantity: 2, unit: 'шт', sourceText: 'EXACT 2 шт', specifications: { poles: null, curve: null, amps: null, breakingCapacityKa: null } }], warnings: [], truncated: false };
const input = (requestId = randomUUID()) => ({ requestId, file: { name: 'fixture.pdf', mimeType: 'application/pdf', sizeBytes: 5, bytes: Buffer.from('%PDF-') } });

async function waitFor(predicate) {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail('Timed out waiting for job state');
}

test('queue bounds concurrency, deduplicates submissions, releases bytes and isolates sessions', async (t) => {
  const pending = [];
  const uploads = new Uploads(catalog, { extractAttachment: (file) => new Promise((resolve) => pending.push({ resolve, file })) }, { maxConcurrent: 1, maxJobs: 3, maxJobsPerSession: 2 });
  t.after(() => { for (const job of uploads.jobs.values()) uploads.remove(job.sessionId, job.uploadId); });
  const requestId = randomUUID();
  const first = uploads.submit('A', input(requestId));
  assert.equal(first.status, 'queued');
  assert.deepEqual(uploads.submit('A', input(requestId)), first);
  assert.throws(() => uploads.submit('A', { ...input(requestId), file: { ...input().file, name: 'other.pdf' } }), { code: 'UPLOAD_CONFLICT' });
  const second = uploads.submit('A', input());
  const third = uploads.submit('B', input(requestId));
  assert.notEqual(third.uploadId, first.uploadId);
  assert.throws(() => uploads.submit('A', input()), { code: 'UPLOAD_LIMIT' });
  assert.throws(() => uploads.submit('C', input()), { code: 'UPLOAD_LIMIT' });
  await waitFor(() => pending.length === 1);
  assert.equal(uploads.get('A', first.uploadId).status, 'processing');
  assert.equal(uploads.get('A', second.uploadId).status, 'queued');
  assert.throws(() => uploads.get('B', first.uploadId), { code: 'UPLOAD_NOT_FOUND' });
  uploads.remove('B', first.uploadId);
  assert.equal(uploads.get('A', first.uploadId).status, 'processing');
  pending[0].resolve(extraction);
  await waitFor(() => pending.length === 2);
  const completed = uploads.get('A', first.uploadId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.items[0].candidates[0].product.sku, 'EXACT');
  assert.equal(pending[0].file.bytes, undefined);
  assert.deepEqual(uploads.submit('A', input(requestId)), completed);
  uploads.remove('A', second.uploadId);
  await waitFor(() => pending.length === 3);
  pending[1].resolve(extraction); // A late response cannot restore the deleted job.
  assert.throws(() => uploads.get('A', second.uploadId), { code: 'UPLOAD_NOT_FOUND' });
  pending[2].resolve(extraction);
  await waitFor(() => uploads.active === 0);
  assert.equal(uploads.requests.size, 2);
});

test('expiry and cancellation remove queued and active payloads, results and idempotency entries', async () => {
  let signal;
  const uploads = new Uploads(catalog, { extractAttachment: (_file, options) => { signal = options.signal; return new Promise(() => {}); } }, { resultTtlMs: 30, maxConcurrent: 1 });
  const first = uploads.submit('A', input());
  const second = uploads.submit('A', input());
  const queuedFile = uploads.jobs.get(second.uploadId).file;
  await waitFor(() => signal);
  uploads.remove('A', second.uploadId);
  uploads.remove('A', second.uploadId);
  assert.equal(queuedFile.bytes, undefined);
  await waitFor(() => uploads.jobs.size === 0 && uploads.active === 0);
  assert.ok(signal.aborted);
  assert.equal(uploads.requests.size, 0);
  assert.throws(() => uploads.get('A', first.uploadId), { code: 'UPLOAD_NOT_FOUND' });
});

test('timeouts, malformed results and provider failures are sanitized and release the queue', async () => {
  for (const [processor, code] of [
    [() => new Promise(() => {}), 'UPLOAD_TIMEOUT'],
    [() => { throw Object.assign(new Error('secret provider body'), { code: 'AI_CALL_LIMIT' }); }, 'AI_CALL_LIMIT'],
    [() => { throw new Error('secret file content'); }, 'UPLOAD_PROCESSING_FAILED'],
    [() => ({ ...extraction, items: [{ price: 1 }] }), 'UPLOAD_PROCESSING_FAILED'],
  ]) {
    const uploads = new Uploads(catalog, { extractAttachment: processor }, { timeoutMs: 20 });
    const job = uploads.submit('A', input());
    await waitFor(() => uploads.get('A', job.uploadId).status === 'failed');
    const failed = uploads.get('A', job.uploadId);
    assert.equal(failed.error.code, code);
    assert.deepEqual(failed.items, []);
    assert.doesNotMatch(JSON.stringify(failed), /secret/);
    assert.equal(uploads.active, 0);
    assert.equal(uploads.jobs.get(job.uploadId).file.bytes, undefined);
    uploads.remove('A', job.uploadId);
  }
  assert.throws(() => new Uploads([], null, { timeoutMs: 0 }), /configuration/);
});

async function serverFor(t, options = {}) {
  const server = createApp(catalog, options).listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = async () => (await (await fetch(`${base}/api/session`, { method: 'POST' })).json()).sessionId;
  const sessionId = options.catalogState ? undefined : await session();
  const call = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { ...(sessionId && { 'X-Session-Id': sessionId }), ...options.headers } });
  return { call, session };
}

function form(requestId = randomUUID(), file = new File(['%PDF-fixture'], 'fixture.pdf', { type: 'application/pdf' })) {
  const body = new FormData();
  body.append('file', file);
  body.append('requestId', requestId);
  return body;
}

test('HTTP upload/poll/retry/delete preserve cart state and session privacy', async (t) => {
  let calls = 0;
  const { call, session } = await serverFor(t, { queryParser: { extractAttachment: async () => { calls += 1; return extraction; } } });
  const capabilities = await (await call('/api/uploads/capabilities')).json();
  assert.equal(capabilities.enabled, true);
  assert.equal(capabilities.maxFileBytes, 921600);
  const requestId = randomUUID();
  const posted = await call('/api/uploads', { method: 'POST', body: form(requestId) });
  assert.equal(posted.status, 202);
  assert.equal(posted.headers.get('cache-control'), 'no-store');
  const job = await posted.json();
  const path = `/api/uploads/${job.uploadId}`;
  let completed;
  for (let i = 0; i < 20; i += 1) {
    completed = await (await call(path)).json();
    if (completed.status === 'completed') break;
    await delay(5);
  }
  assert.equal(completed.status, 'completed');
  assert.equal(completed.items[0].quantity, 2);
  const retry = await call('/api/uploads', { method: 'POST', body: form(requestId) });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).uploadId, job.uploadId);
  assert.equal(calls, 1);
  const other = await session();
  assert.equal((await call(path, { headers: { 'X-Session-Id': other } })).status, 404);
  assert.equal((await call(path, { method: 'DELETE', headers: { 'X-Session-Id': other } })).status, 204);
  assert.equal((await call(path)).status, 200);
  assert.deepEqual((await (await call('/api/cart')).json()).items, []);
  assert.equal((await call(path, { method: 'DELETE' })).status, 204);
  assert.equal((await call(path, { method: 'DELETE' })).status, 204);
  assert.equal((await call(path)).status, 404);
  assert.deepEqual((await (await call('/api/cart')).json()).items, []);
});

test('HTTP validation, body limits, session requirements, offline mode and catalog readiness', async (t) => {
  const { call } = await serverFor(t, { queryParser: { extractAttachment: async () => extraction }, uploads: { maxFileBytes: 20 } });
  for (const [options, status, code] of [
    [{ headers: { 'X-Session-Id': 'invalid' }, body: form() }, 401, 'SESSION_REQUIRED'],
    [{ body: 'text' }, 415, 'UNSUPPORTED_FILE_TYPE'],
    [{ body: form('not-uuid') }, 400, 'INVALID_UPLOAD'],
    [{ body: form(randomUUID(), new File(['%PDF-' + 'x'.repeat(20)], 'large.pdf')) }, 413, 'FILE_TOO_LARGE'],
    [{ body: form(randomUUID(), new File(['%PDF-' + 'x'.repeat(20000)], 'large.pdf')) }, 413, 'FILE_TOO_LARGE'],
    [{ headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: 'broken' }, 400, 'INVALID_UPLOAD'],
  ]) {
    const response = await call('/api/uploads', { method: 'POST', ...options });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
  const offline = await serverFor(t);
  assert.equal((await (await offline.call('/api/uploads/capabilities')).json()).enabled, false);
  assert.equal((await offline.call('/api/uploads', { method: 'POST', body: form() })).status, 503);
  const loading = await serverFor(t, { catalogState: { status: 'loading' } });
  assert.equal((await loading.call('/api/uploads/capabilities')).status, 200);
  assert.equal((await loading.call('/api/uploads', { method: 'POST', body: form() })).status, 503);
  const preflight = await call('/api/uploads', { method: 'OPTIONS' });
  assert.match(preflight.headers.get('access-control-allow-methods'), /DELETE/);
});
