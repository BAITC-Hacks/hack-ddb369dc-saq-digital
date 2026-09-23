import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import configuration from '../../config.json'
import type { UploadCapabilities, UploadJob } from '../uploadTypes'
import { createUpload, createUploadSession, deleteUpload, getUpload, getUploadCapabilities, validateUploadFile } from './uploads'

const requestId = 'c09e79ac-5cf2-4b49-b34b-6d4f004699dc'
const sessionId = 'pinned-session'
const capabilities: UploadCapabilities = {
  enabled: true, maxFiles: 1, maxFileBytes: 10, maxItems: 50,
  resultTtlSeconds: 900, pollIntervalMs: 1000,
  formats: [{ extensions: ['.jpg', '.jpeg'], mimeType: 'image/jpeg' }, { extensions: ['.pdf'], mimeType: 'application/pdf' }],
}
const job: UploadJob = {
  uploadId: '3a67a7f5-f45f-4fd2-897b-658fb973795b', requestId, status: 'queued',
  file: { name: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 4 },
  createdAt: '2026-09-23T12:00:00.000Z', expiresAt: '2026-09-23T12:15:00.000Z',
  items: [], warnings: [], truncated: false, error: null,
}
const completed: UploadJob = {
  ...job, status: 'completed', items: [{
    lineId: '1', description: 'Автомат', article: null, quantity: null, unit: null,
    sourceText: '<script>untrusted</script>',
    specifications: { poles: null, curve: null, amps: null, breakingCapacityKa: null },
    matchStatus: 'matched', matchCount: 1, warnings: [], requiresReview: true,
    candidates: [{ product: { sku: 'DEMO-MCB-003', name: 'Автомат', priceKzt: 7900, stock: 12 }, reason: 'Артикул', canFulfill: null, canAddToCart: false }],
  }],
}

class FakeXhr {
  static instances: FakeXhr[] = []
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null
  timeout = 0
  withCredentials = false
  responseText = ''
  status = 0
  open = vi.fn()
  setRequestHeader = vi.fn()
  send = vi.fn()
  abort = vi.fn(() => this.onabort?.())
  constructor() { FakeXhr.instances.push(this) }
  respond(status: number, payload: unknown) {
    this.status = status
    this.responseText = typeof payload === 'string' ? payload : JSON.stringify(payload)
    this.onload?.()
  }
}

let transport: ReturnType<typeof vi.fn<typeof fetch>>
beforeEach(() => {
  transport = vi.fn<typeof fetch>()
  FakeXhr.instances = []
  vi.stubGlobal('fetch', transport)
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('upload file validation', () => {
  it('accepts case-insensitive extensions, empty MIME and generic binary MIME', () => {
    expect(validateUploadFile(new File(['pdf'], 'SPEC.PDF'), capabilities)).toBeNull()
    expect(validateUploadFile(new File(['pdf'], 'spec.pdf', { type: 'application/octet-stream' }), capabilities)).toBeNull()
    expect(validateUploadFile(new File(['jpg'], 'spec.jpeg', { type: 'image/jpeg' }), capabilities)).toBeNull()
  })
  it('rejects empty, oversized, unsupported and mismatched files', () => {
    expect(validateUploadFile(new File([], 'spec.pdf'), capabilities)).toBe('EMPTY_FILE')
    expect(validateUploadFile(new File(['x'.repeat(11)], 'spec.pdf'), capabilities)).toBe('FILE_TOO_LARGE')
    expect(validateUploadFile(new File(['text'], 'spec.txt'), capabilities)).toBe('UNSUPPORTED_FILE_TYPE')
    expect(validateUploadFile(new File(['text'], 'spec.pdf', { type: 'text/plain' }), capabilities)).toBe('INVALID_FILE')
    expect(validateUploadFile(new File(['text'], 'bad\u0000.pdf'), capabilities)).toBe('INVALID_FILE')
  })
})

it('loads and validates capabilities without creating or sending a session', async () => {
  transport.mockResolvedValue(new Response(JSON.stringify({ ...capabilities, unknown: true })))
  expect(await getUploadCapabilities()).toEqual(capabilities)
  expect(transport).toHaveBeenCalledOnce()
  expect(transport.mock.calls[0][0]).toBe('/api/uploads/capabilities')
  expect(transport.mock.calls[0][1]?.headers).toEqual({})
  transport.mockResolvedValue(new Response(JSON.stringify({ ...capabilities, pollIntervalMs: 0 })))
  await expect(getUploadCapabilities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('creates a fresh upload session with an explicit JSON POST without persisting or reusing it', async () => {
  const existing = sessionStorage.getItem(configuration.sessionStorageKey)
  sessionStorage.setItem(configuration.sessionStorageKey, 'cart-session')
  try {
    transport.mockResolvedValueOnce(new Response(JSON.stringify({ sessionId: 'upload-session-one' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessionId: 'upload-session-two' })))
    expect(await createUploadSession()).toBe('upload-session-one')
    expect(await createUploadSession()).toBe('upload-session-two')
    for (const [url, options] of transport.mock.calls) {
      expect(url).toBe('/api/session')
      expect(options).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    }
    expect(sessionStorage.getItem(configuration.sessionStorageKey)).toBe('cart-session')
  } finally {
    if (existing === null) sessionStorage.removeItem(configuration.sessionStorageKey)
    else sessionStorage.setItem(configuration.sessionStorageKey, existing)
  }
})

it('rejects invalid session responses and does not retry errors or pre-aborted creation', async () => {
  for (const sessionId of ['', ' ', null, 123]) {
    transport.mockResolvedValue(new Response(JSON.stringify({ sessionId })))
    await expect(createUploadSession()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  }
  transport.mockResolvedValue(new Response('{"error":{"code":"BACKEND_UNAVAILABLE","message":"Offline"}}', { status: 503 }))
  await expect(createUploadSession()).rejects.toMatchObject({ status: 503, code: 'BACKEND_UNAVAILABLE' })
  await expect(createUploadSession(AbortSignal.abort())).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
  expect(transport).toHaveBeenCalledTimes(5)
})

it('posts exactly one file and stable request ID with pinned session and real transfer progress', async () => {
  const file = new File(['data'], 'spec.pdf', { type: 'application/pdf' })
  const progress = vi.fn()
  const result = createUpload(file, requestId, sessionId, progress)
  const xhr = FakeXhr.instances[0]
  expect(xhr.open).toHaveBeenCalledWith('POST', '/api/uploads', true)
  expect(xhr.setRequestHeader.mock.calls).toEqual([['X-Session-Id', sessionId]])
  expect(xhr.timeout).toBe(configuration.requestTimeoutMs)
  const form = xhr.send.mock.calls[0][0] as FormData
  expect([...form.keys()]).toEqual(['file', 'requestId'])
  expect(form.get('file')).toBe(file)
  expect(form.get('requestId')).toBe(requestId)
  xhr.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 } as ProgressEvent)
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 } as ProgressEvent)
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 4 } as ProgressEvent)
  xhr.respond(202, job)
  expect(await result).toEqual(job)
  expect(progress.mock.calls.map(([value]) => value)).toEqual([null, 50, 100])
  expect(xhr.upload.onprogress).toBeNull()
  expect(xhr.onload).toBeNull()
  expect(transport).not.toHaveBeenCalled()
})

it('preserves request IDs for explicit retries and never refreshes sessions on 401', async () => {
  const file = new File(['data'], 'spec.pdf')
  const first = createUpload(file, requestId, sessionId)
  FakeXhr.instances[0].respond(401, { error: { code: 'SESSION_REQUIRED', message: 'Expired' } })
  await expect(first).rejects.toMatchObject({ status: 401, code: 'SESSION_REQUIRED' })
  expect(FakeXhr.instances).toHaveLength(1)
  expect(transport).not.toHaveBeenCalled()
  const retry = createUpload(file, requestId, sessionId)
  expect((FakeXhr.instances[1].send.mock.calls[0][0] as FormData).get('requestId')).toBe(requestId)
  FakeXhr.instances[1].respond(200, completed)
  expect((await retry).items[0].quantity).toBeNull()
})

it('normalizes non-JSON proxy 413, rejects malformed successful JSON and distinguishes network failures', async () => {
  for (const [status, body, code] of [[413, '<html>large</html>', 'FILE_TOO_LARGE'], [202, '{}', 'INVALID_RESPONSE']] as const) {
    const result = createUpload(new File(['data'], 'spec.pdf'), requestId, sessionId)
    FakeXhr.instances.at(-1)!.respond(status, body)
    await expect(result).rejects.toMatchObject({ status, code })
  }
  const result = createUpload(new File(['data'], 'spec.pdf'), requestId, sessionId)
  FakeXhr.instances.at(-1)!.onerror?.()
  await expect(result).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
})

it('aborts upload once and removes cancellation listeners after success', async () => {
  const controller = new AbortController()
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  const result = createUpload(new File(['data'], 'spec.pdf'), requestId, sessionId, undefined, controller.signal)
  const xhr = FakeXhr.instances[0]
  controller.abort()
  await expect(result).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
  expect(xhr.abort).toHaveBeenCalledOnce()
  expect(remove).toHaveBeenCalled()
  const secondController = new AbortController()
  const success = createUpload(new File(['data'], 'spec.pdf'), requestId, sessionId, undefined, secondController.signal)
  const secondXhr = FakeXhr.instances[1]
  secondXhr.respond(202, job)
  await success
  secondController.abort()
  expect(secondXhr.abort).not.toHaveBeenCalled()
})

it('reports upload timeouts and does not dispatch pre-aborted requests', async () => {
  const result = createUpload(new File(['data'], 'spec.pdf'), requestId, sessionId)
  FakeXhr.instances[0].ontimeout?.()
  await expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
  const signal = AbortSignal.abort()
  await expect(createUpload(new File(['data'], 'spec.pdf'), requestId, sessionId, undefined, signal)).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
  await expect(getUpload(job.uploadId, sessionId, signal)).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
  expect(FakeXhr.instances).toHaveLength(1)
  expect(transport).not.toHaveBeenCalled()
})

it('polls and deletes using the original session, supporting 204 without a JSON body', async () => {
  transport.mockResolvedValueOnce(new Response(JSON.stringify(completed))).mockResolvedValueOnce(new Response(null, { status: 204 }))
  expect(await getUpload(job.uploadId, sessionId)).toEqual(completed)
  await expect(deleteUpload(job.uploadId, sessionId)).resolves.toBeUndefined()
  for (const [, options] of transport.mock.calls) expect(options?.headers).toEqual({ 'X-Session-Id': sessionId })
  expect(transport.mock.calls.map(([, options]) => options?.method)).toEqual(['GET', 'DELETE'])
  expect(transport.mock.calls[0][0]).toBe(`/api/uploads/${job.uploadId}`)
})

it('preserves HTTP errors on polling without retrying or replacing the session', async () => {
  for (const [status, body, code] of [[401, '{"error":{"code":"SESSION_REQUIRED","message":"Expired"}}', 'SESSION_REQUIRED'], [413, '<html>large</html>', 'FILE_TOO_LARGE'], [503, '{"error":{"code":"BACKEND_UNAVAILABLE","message":"Offline"}}', 'BACKEND_UNAVAILABLE']] as const) {
    transport.mockResolvedValue(new Response(body, { status }))
    await expect(getUpload(job.uploadId, sessionId)).rejects.toMatchObject({ status, code })
  }
  expect(transport).toHaveBeenCalledTimes(3)
})

it('fails closed on malformed jobs and nonfinite product facts while preserving nullable fields and text', async () => {
  for (const malformed of [{ ...completed, items: {} }, { ...completed, status: 'unknown' }, { ...completed, file: null }, { ...completed, items: [{ ...completed.items[0], quantity: '2' }] }, { ...completed, items: [{ ...completed.items[0], candidates: [{ ...completed.items[0].candidates[0], product: { sku: 'sku', name: 'name', priceKzt: '7900', stock: 2 } }] }] }]) {
    transport.mockResolvedValue(new Response(JSON.stringify(malformed)))
    await expect(getUpload(job.uploadId, sessionId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  }
  transport.mockResolvedValue(new Response(JSON.stringify(completed).replace('7900', '1e999')))
  await expect(getUpload(job.uploadId, sessionId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  transport.mockResolvedValue(new Response(JSON.stringify(completed)))
  expect((await getUpload(job.uploadId, sessionId)).items[0].sourceText).toBe('<script>untrusted</script>')
})

it('cancels and bounds polls while clearing timers and external signal listeners', async () => {
  vi.useFakeTimers()
  transport.mockImplementation((_input, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  const controller = new AbortController()
  const removed = vi.spyOn(controller.signal, 'removeEventListener')
  const abortResult = expect(getUpload(job.uploadId, sessionId, controller.signal)).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
  controller.abort()
  await abortResult
  expect(removed).toHaveBeenCalled()
  const timeoutResult = expect(getUpload(job.uploadId, sessionId)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
  await vi.advanceTimersByTimeAsync(configuration.requestTimeoutMs)
  await timeoutResult
  expect(vi.getTimerCount()).toBe(0)
  expect(transport).toHaveBeenCalledTimes(2)
})

it('keeps polling timeouts active while consuming the body and cleans up after success', async () => {
  vi.useFakeTimers()
  transport.mockImplementation((_input, options) => Promise.resolve({
    status: 200, ok: true,
    json: () => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }),
  } as Response))
  const stalled = expect(getUpload(job.uploadId, sessionId)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
  await vi.advanceTimersByTimeAsync(configuration.requestTimeoutMs)
  await stalled
  expect(vi.getTimerCount()).toBe(0)
  transport.mockResolvedValue(new Response(JSON.stringify(job)))
  const controller = new AbortController()
  const removed = vi.spyOn(controller.signal, 'removeEventListener')
  await getUpload(job.uploadId, sessionId, controller.signal)
  const signal = transport.mock.calls.at(-1)?.[1]?.signal
  controller.abort()
  await vi.advanceTimersByTimeAsync(configuration.requestTimeoutMs)
  expect(vi.getTimerCount()).toBe(0)
  expect(removed).toHaveBeenCalled()
  expect(signal?.aborted).toBe(false)
})

it('returns processing failures as jobs and validates capabilities before exposing them', async () => {
  const failed: UploadJob = { ...job, status: 'failed', error: { code: 'UPLOAD_TIMEOUT', message: 'Не удалось распознать.' } }
  transport.mockResolvedValue(new Response(JSON.stringify(failed)))
  expect(await getUpload(job.uploadId, sessionId)).toEqual(failed)
  for (const malformed of [null, { ...capabilities, formats: [] }, { ...capabilities, formats: [{ extensions: ['pdf'], mimeType: 'application/pdf' }] }, { ...capabilities, maxFileBytes: '10' }]) {
    transport.mockResolvedValue(new Response(JSON.stringify(malformed)))
    await expect(getUploadCapabilities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  }
})

it('rejects missing pinned sessions without creating a replacement or sending requests', async () => {
  await expect(createUpload(new File(['data'], 'spec.pdf'), requestId, '')).rejects.toMatchObject({ code: 'SESSION_REQUIRED' })
  await expect(getUpload(job.uploadId, '')).rejects.toMatchObject({ code: 'SESSION_REQUIRED' })
  await expect(deleteUpload(job.uploadId, '')).rejects.toMatchObject({ code: 'SESSION_REQUIRED' })
  expect(FakeXhr.instances).toHaveLength(0)
  expect(transport).not.toHaveBeenCalled()
})

it('preserves fractional warehouse availability and rejects malformed warehouse facts', async () => {
  const candidate = completed.items[0].candidates[0]
  const withStores = (stores: unknown) => ({
    ...completed,
    items: [{ ...completed.items[0], candidates: [{ ...candidate, product: { ...candidate.product, stock: 2.75, stores } }] }],
  })
  const stores = [{ id: 4, name: 'Алматы', quantity: 2.5 }, { id: 7, name: 'Астана', quantity: 0.25 }]
  transport.mockResolvedValue(new Response(JSON.stringify(withStores(stores))))
  expect((await getUpload(job.uploadId, sessionId)).items[0].candidates[0].product).toMatchObject({ stock: 2.75, stores })
  for (const invalid of [null, {}, [{ id: 1.5, name: 'Алматы', quantity: 1 }], [{ id: 4, name: 10, quantity: 1 }], [{ id: 4, name: 'Алматы', quantity: -1 }], [{ id: 4, name: 'Алматы', quantity: '2.5' }]]) {
    transport.mockResolvedValue(new Response(JSON.stringify(withStores(invalid))))
    await expect(getUpload(job.uploadId, sessionId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  }
  transport.mockResolvedValue(new Response(JSON.stringify(withStores(stores)).replace('"quantity":2.5', '"quantity":1e999')))
  await expect(getUpload(job.uploadId, sessionId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('rejects an upload response belonging to a different request and polling response for a different upload', async () => {
  const result = createUpload(new File(['data'], 'spec.pdf'), requestId, sessionId)
  FakeXhr.instances[0].respond(202, { ...job, requestId: 'c09e79ac-5cf2-4b49-b34b-6d4f004699da' })
  await expect(result).rejects.toMatchObject({ status: 202, code: 'INVALID_RESPONSE' })
  transport.mockResolvedValue(new Response(JSON.stringify({ ...completed, uploadId: '3a67a7f5-f45f-4fd2-897b-658fb973795c' })))
  await expect(getUpload(job.uploadId, sessionId)).rejects.toMatchObject({ status: 200, code: 'INVALID_RESPONSE' })
})

it('accepts the server-normalized lowercase UUID for an uppercase upload request ID', async () => {
  const result = createUpload(new File(['data'], 'spec.pdf'), requestId.toUpperCase(), sessionId)
  FakeXhr.instances[0].respond(202, job)
  expect(await result).toEqual(job)
})
