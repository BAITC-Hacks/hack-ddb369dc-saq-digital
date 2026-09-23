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
