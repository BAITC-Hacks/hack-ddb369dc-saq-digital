import configuration from '../../config.json'
import type { CartSnapshot, SearchResponse } from '../types'

const sessionKey = configuration.sessionStorageKey
const configuredUrl = (import.meta.env.VITE_API_BASE_URL ?? configuration.apiBaseUrl).replace(/\/+$/, '')
export const apiBaseUrl = configuredUrl.endsWith('/api') ? configuredUrl : `${configuredUrl}/api`
const requestTimeoutMs = configuration.requestTimeoutMs ?? 35000
let sessionRequest: Promise<string> | null = null
let chatSessions: Readonly<Record<string, Promise<string> | undefined>> = {}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}, sessionId?: string): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: 'GET',
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
    if (!body || typeof body !== 'object') throw new ApiError('Некорректный ответ сервера.', response.status, 'INVALID_RESPONSE')
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
        if (!sessionId) throw new ApiError('Сервер не создал сессию.', 0, 'INVALID_SESSION')
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

function ensureChatSession(chatId: string): Promise<string> {
  const saved = Object.hasOwn(chatSessions, chatId) ? chatSessions[chatId] : undefined
  if (saved) return saved
  const pending = request<{ sessionId: string }>('/session', { method: 'POST', body: '{}' })
    .then(({ sessionId }) => {
      if (!sessionId) throw new ApiError('Сервер не создал сессию.', 0, 'INVALID_SESSION')
      return sessionId
    })
    .catch((error: unknown) => {
      if (chatSessions[chatId] === pending) chatSessions = { ...chatSessions, [chatId]: undefined }
      throw error
    })
  chatSessions = { ...chatSessions, [chatId]: pending }
  return pending
}

async function withChatSession<T>(chatId: string, operation: (sessionId: string) => Promise<T>): Promise<T> {
  const pending = ensureChatSession(chatId)
  const sessionId = await pending
  try {
    return await operation(sessionId)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error
    if (chatSessions[chatId] === pending) chatSessions = { ...chatSessions, [chatId]: undefined }
    return operation(await ensureChatSession(chatId))
  }
}

export function searchCatalog(query: string, chatId?: string): Promise<SearchResponse> {
  const search = (sessionId: string) => request<SearchResponse>('/search', {
    method: 'POST', body: JSON.stringify({ query, conversation: true }),
  }, sessionId)
  // Dialog context is isolated in memory; cart operations keep their existing shared session.
  return chatId === undefined ? withSession(search) : withChatSession(chatId, search)
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

export function frontendCartUrl(cartUrl = configuration.cartPath): string {
  if (!cartUrl.startsWith('/') || cartUrl.startsWith('//')) throw new ApiError('Некорректная ссылка на корзину.', 0, 'INVALID_CART_URL')
  const url = new URL(cartUrl, window.location.origin)
  if (url.origin !== window.location.origin) throw new ApiError('Некорректная ссылка на корзину.', 0, 'INVALID_CART_URL')
  return `${url.pathname}${url.search}${url.hash}`
}
