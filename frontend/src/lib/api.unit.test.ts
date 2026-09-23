import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { addToCart, frontendCartUrl, getCart, searchCatalog } from './api'
import configuration from '../../config.json'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

beforeEach(() => sessionStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('assistant API client', () => {
  it('isolates A/B/A chat searches while retaining the global cart session', async () => {
    sessionStorage.setItem('ekt-assistant-session-id', 'global-cart')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ sessionId: 'chat-a' }, 201))
      .mockResolvedValueOnce(json({ answer: 'A' }))
      .mockResolvedValueOnce(json({ sessionId: 'chat-b' }, 201))
      .mockResolvedValueOnce(json({ answer: 'B' }))
      .mockResolvedValueOnce(json({ answer: 'A follow-up' }))
      .mockResolvedValueOnce(json({ items: [], totalPriceKzt: 0, cartUrl: '/cart' }))
      .mockResolvedValueOnce(json({ items: [], totalPriceKzt: 0, cartUrl: '/cart' }))
    vi.stubGlobal('fetch', fetchMock)

    await searchCatalog('Автомат', 'isolated-a')
    await searchCatalog('Кабель', 'isolated-b')
    await searchCatalog('А 12 штук?', 'isolated-a')
    await getCart()
    await addToCart('SKU-A', 1, 'confirmed-a')

    expect(fetchMock.mock.calls.map(([, init]) => init.headers['X-Session-Id'])).toEqual([
      undefined, 'chat-a', undefined, 'chat-b', 'chat-a', 'global-cart', 'global-cart',
    ])
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({ query: 'А 12 штук?', conversation: true })
    expect(sessionStorage.getItem('ekt-assistant-session-id')).toBe('global-cart')
    expect(sessionStorage.length).toBe(1)
  })

  it('recreates only the expired chat session and retries once', async () => {
    sessionStorage.setItem('ekt-assistant-session-id', 'retained-cart')
    const unauthorized = () => json({ error: { code: 'SESSION_NOT_FOUND' } }, 401)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ sessionId: 'retained-b' }, 201))
      .mockResolvedValueOnce(json({ answer: 'B' }))
      .mockResolvedValueOnce(json({ sessionId: 'expired-a' }, 201))
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(json({ sessionId: 'fresh-a' }, 201))
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(json({ answer: 'B follow-up' }))
    vi.stubGlobal('fetch', fetchMock)

    await searchCatalog('Кабель', 'expiry-b')
    await expect(searchCatalog('Автомат', 'expiry-a')).rejects.toMatchObject({ status: 401 })
    await searchCatalog('А 12 метров?', 'expiry-b')

    expect(fetchMock).toHaveBeenCalledTimes(7)
    expect(fetchMock.mock.calls[3][1].headers['X-Session-Id']).toBe('expired-a')
    expect(fetchMock.mock.calls[5][1].headers['X-Session-Id']).toBe('fresh-a')
    expect(fetchMock.mock.calls[6][1].headers['X-Session-Id']).toBe('retained-b')
    expect(sessionStorage.getItem('ekt-assistant-session-id')).toBe('retained-cart')
  })

  it('shares session creation for concurrent first searches in the same chat', async () => {
    let resolveSession!: (response: Response) => void
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveSession = resolve }))
      .mockResolvedValueOnce(json({ answer: 'First' }))
      .mockResolvedValueOnce(json({ answer: 'Second' }))
    vi.stubGlobal('fetch', fetchMock)

    const first = searchCatalog('Первый запрос', 'concurrent-chat')
    const second = searchCatalog('Второй запрос', 'concurrent-chat')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveSession(json({ sessionId: 'shared-chat' }, 201))
    await Promise.all([first, second])

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.slice(1).map(([, init]) => init.headers['X-Session-Id'])).toEqual(['shared-chat', 'shared-chat'])
    expect(sessionStorage.length).toBe(0)
  })

  it('allows retrying a chat after session creation fails', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Offline'))
      .mockResolvedValueOnce(json({ sessionId: 'recovered-chat' }, 201))
      .mockResolvedValueOnce(json({ answer: 'Recovered' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchCatalog('Вопрос', 'recovering-chat')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    await searchCatalog('Повторный вопрос', 'recovering-chat')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2][1].headers['X-Session-Id']).toBe('recovered-chat')
    expect(sessionStorage.length).toBe(0)
  })

  it('sends follow-up queries unchanged in the same session without resending history', async () => {
    const response = { intent: 'specifications', answer: 'Есть в наличии.', filters: { quantity: 12 }, exactMatch: null, alternatives: [] }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ sessionId: 'conversation-session' }, 201))
      .mockResolvedValueOnce(json(response))
      .mockResolvedValueOnce(json(response))
    vi.stubGlobal('fetch', fetchMock)

    await searchCatalog('Нужен автомат C16, 8 штук')
    await searchCatalog('А есть 12 штук?')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][1].headers['X-Session-Id']).toBe('conversation-session')
    expect(fetchMock.mock.calls[2][1].headers['X-Session-Id']).toBe('conversation-session')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ query: 'Нужен автомат C16, 8 штук', conversation: true })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ query: 'А есть 12 штук?', conversation: true })
  })

  it('aborts a stalled cart request after the configured timeout without retrying the mutation', async () => {
    vi.useFakeTimers()
    sessionStorage.setItem('ekt-assistant-session-id', 'session-timeout')
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init.signal as AbortSignal
      requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = expect(addToCart('ALT-15', 8, 'confirmation-timeout')).rejects.toMatchObject({
      status: 0, code: 'REQUEST_TIMEOUT',
    })
    await vi.advanceTimersByTimeAsync(configuration.requestTimeoutMs)
    await result

    expect(requestSignal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(sessionStorage.getItem('ekt-assistant-session-id')).toBe('session-timeout')
  })

  it('keeps the timeout active while consuming a stalled response body', async () => {
    vi.useFakeTimers()
    sessionStorage.setItem('ekt-assistant-session-id', 'session-body-timeout')
    const fetchMock = vi.fn((_url: string, init: RequestInit) => Promise.resolve({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = expect(getCart()).rejects.toMatchObject({ status: 0, code: 'REQUEST_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(configuration.requestTimeoutMs)
    await result

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the timeout after a successful response', async () => {
    vi.useFakeTimers()
    sessionStorage.setItem('ekt-assistant-session-id', 'session-success')
    const fetchMock = vi.fn().mockResolvedValue(json({ items: [], totalPriceKzt: 0, cartUrl: '/cart' }))
    vi.stubGlobal('fetch', fetchMock)

    await getCart()

    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(configuration.requestTimeoutMs)
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false)
  })

  it('reports network failures with a stable error code and clears the timeout', async () => {
    vi.useFakeTimers()
    sessionStorage.setItem('ekt-assistant-session-id', 'session-network')
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCart()).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

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
    expect(() => frontendCartUrl('/\\example.com/cart')).toThrow('Некорректная ссылка')
    expect(() => frontendCartUrl('javascript:alert(1)')).toThrow('Некорректная ссылка')
  })

  it('rejects an unsafe cartUrl returned by the API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ sessionId: 'session-3' }, 201))
      .mockResolvedValueOnce(json({ items: [], totalPriceKzt: 0, cartUrl: '//example.com/cart' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCart()).rejects.toThrow('Некорректная ссылка')
  })
})
