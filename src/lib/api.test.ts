import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { addToCart, frontendCartUrl, getCart, searchCatalog } from './api'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('assistant API client', () => {
  it('creates a session before search and passes X-Session-Id on subsequent requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ sessionId: 'session-1' }, 201))
      .mockResolvedValueOnce(json({ intent: 'purchase_terms', answer: 'Оплата при заказе', filters: null, exactMatch: null, alternatives: [] }))
      .mockResolvedValueOnce(json({ items: [], totalPriceKzt: 0, cartUrl: '/cart' }))
    vi.stubGlobal('fetch', fetchMock)

    await searchCatalog('Как оплатить заказ?')
    await getCart()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/session')
    expect(fetchMock.mock.calls[1][1].headers['X-Session-Id']).toBe('session-1')
    expect(fetchMock.mock.calls[2][1].headers['X-Session-Id']).toBe('session-1')
  })

  it('posts the confirmed SKU, quantity and stable confirmation ID', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ sessionId: 'session-2' }, 201))
      .mockResolvedValueOnce(json({ items: [{ sku: 'ALT-15', name: 'Автомат', quantity: 8, unitPriceKzt: 7000, lineTotalKzt: 56000 }], totalPriceKzt: 56000, cartUrl: '/cart' }))
    vi.stubGlobal('fetch', fetchMock)

    const cart = await addToCart('ALT-15', 8, 'confirmation-123')

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ sku: 'ALT-15', quantity: 8, confirmed: true, confirmationId: 'confirmation-123' })
    expect(fetchMock.mock.calls[1][1].headers['X-Session-Id']).toBe('session-2')
    expect(cart.cartUrl).toBe('/cart')
  })

  it('recreates an expired session once after HTTP 401', async () => {
    sessionStorage.setItem('ekt-assistant-session-id', 'expired')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: { code: 'SESSION_NOT_FOUND', message: 'Сессия не найдена.' } }, 401))
      .mockResolvedValueOnce(json({ sessionId: 'fresh' }, 201))
      .mockResolvedValueOnce(json({ items: [], totalPriceKzt: 0, cartUrl: '/cart' }))
    vi.stubGlobal('fetch', fetchMock)

    await getCart()

    expect(fetchMock.mock.calls[2][1].headers['X-Session-Id']).toBe('fresh')
    expect(sessionStorage.getItem('ekt-assistant-session-id')).toBe('fresh')
  })

  it('accepts only local frontend cart routes', () => {
    expect(frontendCartUrl('/cart')).toBe('/cart')
    expect(() => frontendCartUrl('//example.com/cart')).toThrow('Некорректная ссылка')
    expect(() => frontendCartUrl('javascript:alert(1)')).toThrow('Некорректная ссылка')
  })
})
