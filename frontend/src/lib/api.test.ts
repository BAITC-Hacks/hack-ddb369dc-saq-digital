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
