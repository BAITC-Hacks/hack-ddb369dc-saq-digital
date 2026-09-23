import type { CartSnapshot, SearchResponse } from '../types'

const sessionKey = 'ekt-assistant-session-id'
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const requestTimeoutMs = 15_000
let sessionRequest: Promise<string> | null = null

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}, sessionId?: string): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
  try {
    const response = await fetch(`${baseUrl}/api${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
        ...init.headers,
      },
    })

    const body: unknown = await response.json().catch((error: unknown) => {
      if (controller.signal.aborted || !(error instanceof SyntaxError)) throw error
      return null
    })
    if (!response.ok) {
      const error = body as { error?: { code?: string; message?: string } } | null
      throw new ApiError(error?.error?.message ?? 'Не удалось выполнить запрос. Повторите попытку.', response.status, error?.error?.code)
    }
    return body as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (controller.signal.aborted) {
      throw new ApiError('Сервер не ответил вовремя. Проверьте состояние корзины перед повторной попыткой.', 0, 'REQUEST_TIMEOUT')
    }
    throw new ApiError('Сервер помощника недоступен. Проверьте подключение и повторите запрос.', 0, 'NETWORK_ERROR')
  } finally {
    clearTimeout(timeout)
  }
}

export async function ensureSession(): Promise<string> {
  const saved = sessionStorage.getItem(sessionKey)
  if (saved) return saved
  if (!sessionRequest) {
    sessionRequest = request<{ sessionId: string }>('/session', { method: 'POST', body: '{}' })
      .then(({ sessionId }) => {
        if (!sessionId) throw new ApiError('Сервер не создал сессию.', 0)
        sessionStorage.setItem(sessionKey, sessionId)
        return sessionId
      })
      .finally(() => { sessionRequest = null })
  }
  return sessionRequest
}

async function withSession<T>(operation: (sessionId: string) => Promise<T>): Promise<T> {
  const sessionId = await ensureSession()
  try {
    return await operation(sessionId)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error
    if (sessionStorage.getItem(sessionKey) === sessionId) sessionStorage.removeItem(sessionKey)
    return operation(await ensureSession())
  }
}

export function searchCatalog(query: string): Promise<SearchResponse> {
  return withSession((sessionId) => request('/search', {
    method: 'POST', body: JSON.stringify({ query }),
  }, sessionId))
}

export async function getCart(): Promise<CartSnapshot> {
  const cart = await withSession<CartSnapshot>((sessionId) => request('/cart', {}, sessionId))
  frontendCartUrl(cart.cartUrl)
  return cart
}

export async function addToCart(sku: string, quantity: number, confirmationId: string): Promise<CartSnapshot> {
  const cart = await withSession<CartSnapshot>((sessionId) => request('/cart', {
    method: 'POST', body: JSON.stringify({ sku, quantity, confirmed: true, confirmationId }),
  }, sessionId))
  frontendCartUrl(cart.cartUrl)
  return cart
}

export function frontendCartUrl(cartUrl: string): string {
  if (!cartUrl.startsWith('/') || cartUrl.startsWith('//')) throw new ApiError('Некорректная ссылка на корзину.', 0)
  const url = new URL(cartUrl, window.location.origin)
  if (url.origin !== window.location.origin) throw new ApiError('Некорректная ссылка на корзину.', 0)
  return `${url.pathname}${url.search}${url.hash}`
}
