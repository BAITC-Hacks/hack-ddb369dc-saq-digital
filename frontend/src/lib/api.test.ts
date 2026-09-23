import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import configuration from '../../config.json'
import { startBackend } from '../test/backend'

const nativeFetch = globalThis.fetch
let backend: Awaited<ReturnType<typeof startBackend>>
let transport: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(async () => {
  vi.resetModules()
  window.sessionStorage.clear()
  backend = await startBackend()
  transport = vi.fn<typeof fetch>((input, options) => nativeFetch(new URL(String(input), backend.url), options))
  vi.stubGlobal('fetch', transport)
})
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await backend?.close()
})

it('shares session creation between parallel reads and translates backend units', async () => {
  const api = await import('./api')
  const [cart, result] = await Promise.all([api.getCart(), api.searchCatalog('1P C16, 4.5 kA, 2 штуки')])
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith('/session'))).toHaveLength(1)
  expect(cart.items).toEqual([])
  expect(result.quantity).toBe(2)
  expect(result.products[0]).toMatchObject({ sku: 'DEMO-MCB-040', poles: '1P', curve: 'C', amperage: 16, breakingCapacity: '4.5 kA', price: 900, stock: 100 })
})

it('recovers a stored session after a server restart and preserves it across client reloads', async () => {
  window.sessionStorage.setItem(configuration.sessionStorageKey, 'expired-session')
  const api = await import('./api')
  expect((await api.getCart()).items).toEqual([])
  expect(window.sessionStorage.getItem(configuration.sessionStorageKey)).not.toBe('expired-session')
  await api.addToCart('DEMO-MCB-003', 8, 'persisted-confirmation')
  vi.resetModules()
  const reloaded = await import('./api')
  const cart = await reloaded.getCart()
  expect(cart.items[0].quantity).toBe(8)
  expect(cart.totalPriceKzt).toBe(63200)
})

it('propagates validation errors without retrying cart mutations', async () => {
  const api = await import('./api')
  await expect(api.addToCart('DEMO-MCB-003', 13, 'overstock')).rejects.toMatchObject({ status: 409, code: 'INSUFFICIENT_STOCK' })
  expect(transport.mock.calls.filter(([url, options]) => String(url).endsWith('/cart') && options?.method === 'POST')).toHaveLength(1)
  expect((await api.getCart()).items).toEqual([])
})

it('accepts only local cart routes, including custom paths, and rejects unsafe API links', async () => {
  const api = await import('./api')
  expect(api.frontendCartUrl('/checkout-cart?step=1')).toBe('/checkout-cart?step=1')
  for (const route of ['//example.com/cart', '/\\example.com/cart', 'javascript:alert(1)']) {
    expect(() => api.frontendCartUrl(route)).toThrow('Некорректная ссылка')
  }
  transport.mockImplementation((input, options) => String(input).endsWith('/cart')
    ? Promise.resolve(new Response(JSON.stringify({ items: [], totalPriceKzt: 0, cartUrl: '//example.com/cart' }), { headers: { 'Content-Type': 'application/json' } }))
    : nativeFetch(new URL(String(input), backend.url), options))
  await expect(api.getCart()).rejects.toMatchObject({ code: 'INVALID_CART_URL' })
})

it('accepts both API origins and full API prefixes without duplicating api in the URL', async () => {
  for (const value of [backend.url, backend.url + '/api/']) {
    vi.stubEnv('VITE_API_BASE_URL', value)
    vi.resetModules()
    transport.mockClear()
    const api = await import('./api')
    expect((await api.getCart()).items).toEqual([])
    expect(transport.mock.calls.some(([url]) => url === backend.url + '/api/cart')).toBe(true)
    expect(transport.mock.calls.some(([url]) => String(url).includes('/api/api/'))).toBe(false)
  }
})

it('opts into conversation responses and does not convert them into empty product searches', async () => {
  const api = await import('./api')
  const result = await api.searchCatalog('что по товарам есть')
  expect(result.answerKind).toBe('conversation')
  expect(result.products).toEqual([])
  const [, options] = transport.mock.calls.find(([url]) => String(url).endsWith('/search'))!
  expect(JSON.parse(String(options?.body))).toEqual({ query: 'что по товарам есть', conversation: true })
})

it('aborts stalled requests and allows a later retry without automatic duplicate writes', async () => {
  const api = await import('./api')
  await api.getCart()
  vi.useFakeTimers()
  try {
    transport.mockImplementation((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const pending = expect(api.searchCatalog('что есть')).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(configuration.requestTimeoutMs)
    await pending
  } finally {
    vi.useRealTimers()
  }
  transport.mockImplementation((input, options) => nativeFetch(new URL(String(input), backend.url), options))
  expect((await api.searchCatalog('1P C16, 4.5 kA, 2 штуки')).products[0].sku).toBe('DEMO-MCB-040')
  expect((await api.getCart()).items).toEqual([])
})

it('aborts a stalled cart write once and preserves the session for an explicit retry', async () => {
  const api = await import('./api')
  await api.getCart()
  const session = sessionStorage.getItem(configuration.sessionStorageKey)
  vi.useFakeTimers()
  transport.mockClear()
  let requestSignal: AbortSignal | null | undefined
  transport.mockImplementation((_input, options) => new Promise((_resolve, reject) => {
    requestSignal = options?.signal
    requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  const pending = expect(api.addToCart('DEMO-MCB-003', 8, 'timeout-confirmation')).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
  await vi.advanceTimersByTimeAsync(configuration.requestTimeoutMs)
  await pending
  expect(requestSignal?.aborted).toBe(true)
  expect(transport).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
  expect(sessionStorage.getItem(configuration.sessionStorageKey)).toBe(session)
})

it('keeps the timeout active while consuming a stalled response body', async () => {
  const api = await import('./api')
  await api.getCart()
  vi.useFakeTimers()
  transport.mockClear()
  transport.mockImplementation((_input, options) => Promise.resolve({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }),
  } as Response))
  const pending = expect(api.getCart()).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
  await vi.advanceTimersByTimeAsync(configuration.requestTimeoutMs)
  await pending
  expect(transport).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('clears the timeout after success without later aborting the completed request', async () => {
  const api = await import('./api')
  await api.getCart()
  vi.useFakeTimers()
  transport.mockClear()
  transport.mockResolvedValue(new Response(JSON.stringify({ items: [], totalPriceKzt: 0, cartUrl: '/cart' })))
  await api.getCart()
  await vi.advanceTimersByTimeAsync(configuration.requestTimeoutMs)
  expect(vi.getTimerCount()).toBe(0)
  expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(false)
})

it('reports network failures during body consumption and clears the timeout', async () => {
  const api = await import('./api')
  await api.getCart()
  vi.useFakeTimers()
  transport.mockClear()
  transport.mockResolvedValue({ ok: true, json: () => Promise.reject(new TypeError('Connection lost')) } as Response)
  await expect(api.getCart()).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
  expect(transport).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it.each([
  { items: null, totalPriceKzt: 0 },
  { items: [null], totalPriceKzt: 0 },
  { items: [{ sku: 'x', name: 'Product', quantity: -1, unitPriceKzt: 2, lineTotalKzt: -2 }], totalPriceKzt: -2 },
  { items: [{ sku: 'x', name: 'Product', quantity: 2, unitPriceKzt: 3, lineTotalKzt: 6 }], totalPriceKzt: 4 },
  { items: [], totalPriceKzt: '0' },
  { items: [], totalPriceKzt: 0, cartUrl: {} },
])('rejects a damaged cart response before rendering: %j', async (body) => {
  const api = await import('./api')
  await api.ensureSession()
  transport.mockResolvedValue(new Response(JSON.stringify(body)))
  await expect(api.getCart()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it.each([null, [], {}, { sessionId: {} }, { sessionId: '' }, { sessionId: 'bad\r\nheader' }])('rejects an invalid session without persisting it: %j', async (body) => {
  const api = await import('./api')
  transport.mockResolvedValue(new Response(JSON.stringify(body)))
  await expect(api.ensureSession()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  expect(sessionStorage.getItem(configuration.sessionStorageKey)).toBeNull()
  expect(transport).toHaveBeenCalledTimes(1)
})

it.each([
  { alternatives: null }, { alternatives: [{ product: {}, reason: 'test' }] }, { exactMatch: { product: null, canFulfill: true } },
  { answer: {} }, { filters: { poles: 1, curve: 'C', amps: 16, breakingCapacityKa: 6, quantity: -1 } },
  { notice: {} }, { notice: ['AI_UNAVAILABLE'] }, { intent: ['conversation'] },
])('rejects a malformed search payload: %j', async (partial) => {
  const api = await import('./api')
  await api.ensureSession()
  const body = { intent: 'conversation', answer: 'Уточните запрос.', filters: null, exactMatch: null, alternatives: [], ...partial }
  transport.mockResolvedValue(new Response(JSON.stringify(body)))
  await expect(api.searchCatalog('товары')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('continues with a shared in-memory session when storage reads and writes are blocked', async () => {
  for (const method of ['getItem', 'setItem', 'removeItem'] as const) vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
  const api = await import('./api')
  await api.getCart()
  await api.addToCart('DEMO-MCB-040', 2, 'memory-confirmation')
  expect((await api.getCart()).items[0].quantity).toBe(2)
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith('/session'))).toHaveLength(1)
  await backend.close()
  backend = await startBackend()
  expect((await api.getCart()).items).toEqual([])
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith('/session'))).toHaveLength(2)
})

it('replaces an expired stored session even when storage writes and removals fail', async () => {
  sessionStorage.setItem(configuration.sessionStorageKey, 'expired-session')
  for (const method of ['setItem', 'removeItem'] as const) vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
  const api = await import('./api')
  expect((await api.getCart()).items).toEqual([])
  await api.addToCart('DEMO-MCB-040', 2, 'read-only-storage')
  expect((await api.getCart()).items[0].quantity).toBe(2)
  expect(sessionStorage.getItem(configuration.sessionStorageKey)).toBe('expired-session')
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith('/session'))).toHaveLength(1)
})

it('recovers an uncertain cart write across reload and clears its ID after acknowledged success', async () => {
  const api = await import('./api')
  await api.ensureSession()
  const normal = transport.getMockImplementation()!
  transport.mockImplementation(async (input, options) => {
    const response = await normal(input, options)
    if (String(input).endsWith('/cart') && options?.method === 'POST') throw new TypeError('Response lost')
    return response
  })
  await expect(api.addToCart('DEMO-MCB-040', 2, 'reload-confirmation')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  vi.resetModules()
  transport.mockImplementation(normal)
  const reloaded = await import('./api')
  expect((await reloaded.getCart()).items[0].quantity).toBe(2)
  expect(reloaded.pendingConfirmationId('DEMO-MCB-040', 2)).toBe('reload-confirmation')
  expect(reloaded.pendingConfirmationId('DEMO-MCB-040', 3)).toBeUndefined()
  expect((await reloaded.addToCart('DEMO-MCB-040', 2, reloaded.pendingConfirmationId('DEMO-MCB-040', 2)!)).items[0].quantity).toBe(2)
  expect(reloaded.pendingConfirmationId('DEMO-MCB-040', 2)).toBeUndefined()
  expect((await reloaded.addToCart('DEMO-MCB-040', 2, 'new-intent')).items[0].quantity).toBe(4)
})

it('does not reuse pending cart confirmations in a replacement session', async () => {
  const api = await import('./api')
  await api.ensureSession()
  transport.mockRejectedValueOnce(new TypeError('Response lost'))
  await expect(api.addToCart('DEMO-MCB-040', 2, 'old-confirmation')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  expect(api.pendingConfirmationId('DEMO-MCB-040', 2)).toBe('old-confirmation')
  await backend.close()
  backend = await startBackend()
  expect((await api.getCart()).items).toEqual([])
  expect(api.pendingConfirmationId('DEMO-MCB-040', 2)).toBeUndefined()
})

it('keeps the pending confirmation when a successful write response does not contain the requested item', async () => {
  const api = await import('./api')
  await api.ensureSession()
  const normal = transport.getMockImplementation()!
  transport.mockImplementation(async (input, options) => {
    const response = await normal(input, options)
    return String(input).endsWith('/cart') && options?.method === 'POST'
      ? new Response(JSON.stringify({ items: [], totalPriceKzt: 0 })) : response
  })
  await expect(api.addToCart('DEMO-MCB-040', 2, 'damaged-write')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  expect(api.pendingConfirmationId('DEMO-MCB-040', 2)).toBe('damaged-write')
  transport.mockImplementation(normal)
  expect((await api.addToCart('DEMO-MCB-040', 2, 'damaged-write')).items[0].quantity).toBe(2)
})
