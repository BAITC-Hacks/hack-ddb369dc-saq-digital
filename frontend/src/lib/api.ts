import configuration from '../../config.json'
import type { ApiProduct, ApiSearchResult, Cart, Product, SearchResult } from '../types'

const configuredUrl = (import.meta.env.VITE_API_BASE_URL ?? configuration.apiBaseUrl).replace(/\/+$/, '')
const baseUrl = configuredUrl.endsWith('/api') ? configuredUrl : `${configuredUrl}/api`
let sessionId: string | undefined
let sessionRequest: Promise<string> | undefined

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
  }
}

async function request<T>(path: string, body?: unknown, session?: string): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), configuration.requestTimeoutMs ?? 35000)
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(session && { 'X-Session-Id': session }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
    const payload = await response.json().catch((error) => {
      if (controller.signal.aborted) throw error
      return null
    })
    if (!payload || typeof payload !== 'object') throw new ApiError('Некорректный ответ сервера.', response.status, 'INVALID_RESPONSE')
    if (!response.ok) throw new ApiError(payload.error?.message ?? 'Не удалось выполнить запрос.', response.status, payload.error?.code ?? 'REQUEST_FAILED')
    return payload as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (controller.signal.aborted) throw new ApiError('Помощник не ответил вовремя. Повторите запрос.', 0, 'REQUEST_TIMEOUT')
    throw new ApiError('Сервер помощника недоступен. Повторите запрос.', 0, 'NETWORK_ERROR')
  } finally {
    clearTimeout(timeout)
  }
}

export function ensureSession(): Promise<string> {
  sessionId ??= window.sessionStorage.getItem(configuration.sessionStorageKey) ?? undefined
  if (sessionId) return Promise.resolve(sessionId)
  sessionRequest ??= request<{ sessionId: string }>('/session', {})
    .then((result) => {
      if (!result.sessionId) throw new ApiError('Сервер не создал сессию.', 0, 'INVALID_SESSION')
      sessionId = result.sessionId
      window.sessionStorage.setItem(configuration.sessionStorageKey, sessionId)
      return sessionId
    })
    .finally(() => { sessionRequest = undefined })
  return sessionRequest
}

async function sessionRequestFor<T>(path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const currentSession = await ensureSession()
    try {
      return await request<T>(path, body, currentSession)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || attempt > 0) throw error
      // A restarted server rejects the old session before it can mutate the cart.
      if (sessionId === currentSession) {
        sessionId = undefined
        window.sessionStorage.removeItem(configuration.sessionStorageKey)
      }
    }
  }
}

function displayProduct(product: ApiProduct, isExactMatch: boolean, recommendation: string): Product {
  return {
    id: product.sku,
    sku: product.sku,
    name: product.name,
    poles: product.poles == null ? undefined : `${product.poles}P`,
    curve: product.curve ?? undefined,
    amperage: product.amps ?? undefined,
    breakingCapacity: product.breakingCapacityKa == null ? undefined : `${product.breakingCapacityKa} kA`,
    price: product.priceKzt,
    stock: product.stock,
    isExactMatch,
    recommendation,
    certificateUrl: product.certificates?.[0]?.url,
    certificates: product.certificates,
    properties: product.properties,
    technicalIssue: product.technicalIssue,
    minimumOrderQuantity: product.minimumOrderQuantity,
  }
}

export async function searchCatalog(query: string): Promise<SearchResult> {
  const result = await sessionRequestFor<ApiSearchResult>('/search', { query, conversation: true })
  const quantity = result.quantity ?? result.filters?.quantity ?? (result.intent === 'purchase_terms' ? 0 : 1)
  const products: Product[] = []
  if (result.exactMatch) {
    const { product, canFulfill } = result.exactMatch
    products.push(displayProduct(product, true, canFulfill
      ? 'Товар есть в запрошенном количестве.'
      : `На складе ${product.stock} шт., запрошено ${quantity} шт.`))
  }
  products.push(...result.alternatives.map(({ product, reason }) => displayProduct(product, false, reason)))
  return {
    quantity,
    products,
    message: result.answer,
    answerKind: result.intent === 'conversation' ? 'conversation' : result.intent === 'purchase_terms' ? 'purchase-terms' : result.alternatives.length ? 'alternatives' : 'product',
    interpretedQuery: result.filters
      ? `${result.filters.poles}P · ${result.filters.curve}${result.filters.amps} · ${result.filters.breakingCapacityKa} kA · ${quantity} шт.`
      : '',
    sourceUrl: result.sourceUrl,
  }
}

export function frontendCartUrl(cartUrl = configuration.cartPath): string {
  if (!cartUrl.startsWith('/') || cartUrl.startsWith('//')) throw new ApiError('Некорректная ссылка на корзину.', 0, 'INVALID_CART_URL')
  const url = new URL(cartUrl, window.location.origin)
  if (url.origin !== window.location.origin) throw new ApiError('Некорректная ссылка на корзину.', 0, 'INVALID_CART_URL')
  return `${url.pathname}${url.search}${url.hash}`
}

export async function getCart(): Promise<Cart> {
  const cart = await sessionRequestFor<Cart>('/cart')
  return { ...cart, cartUrl: frontendCartUrl(cart.cartUrl) }
}

export async function addToCart(sku: string, quantity: number, confirmationId: string): Promise<Cart> {
  const cart = await sessionRequestFor<Cart>('/cart', { sku, quantity, confirmed: true, confirmationId })
  return { ...cart, cartUrl: frontendCartUrl(cart.cartUrl) }
}
