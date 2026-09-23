import configuration from '../../config.json'
import type { ApiProduct, ApiSearchResult, Cart, CartSnapshot, SearchResponse } from '../types'

const configuredUrl = (import.meta.env.VITE_API_BASE_URL ?? configuration.apiBaseUrl).replace(/\/+$/, '')
export const apiBaseUrl = configuredUrl.endsWith('/api') ? configuredUrl : `${configuredUrl}/api`
let chatSessions: Readonly<Record<string, Promise<string> | undefined>> = {}
let sessionId: string | undefined
let sessionRequest: Promise<string> | undefined
let rejectedStoredSession: string | undefined
const pendingStorageKey = `${configuration.sessionStorageKey}:pending-confirmations`
let pendingSession: string | undefined
let pendingConfirmations = new Map<string, string>()

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
  }
}

function readStorage(key: string): string | null {
  try { return window.sessionStorage.getItem(key) } catch { return null }
}

function writeStorage(key: string, value?: string): void {
  try {
    if (value === undefined) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, value)
  } catch { /* The current tab continues with its in-memory session and confirmations. */ }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const optionalString = (value: unknown): boolean => value === undefined || typeof value === 'string'
const optionalPositive = (value: unknown): boolean => value == null || (nonnegative(value) && value > 0)
const curve = (value: unknown): boolean => value === 'B' || value === 'C' || value === 'D'

function invalidResponse(): never {
  throw new ApiError('Некорректный ответ сервера.', 0, 'INVALID_RESPONSE')
}

function validProduct(value: unknown): value is ApiProduct {
  if (!record(value)) return false
  return text(value.sku) && text(value.name) && nonnegative(value.priceKzt)
    && nonnegative(value.stock)
    && optionalString(value.brand) && optionalString(value.technicalIssue)
    && (value.poles == null || positiveInteger(value.poles))
    && (value.curve == null || curve(value.curve)) && optionalPositive(value.amps) && optionalPositive(value.breakingCapacityKa)
    && (value.minimumOrderQuantity === undefined || positiveInteger(value.minimumOrderQuantity))
    && (value.properties === undefined || record(value.properties))
    && (value.certificates === undefined || (Array.isArray(value.certificates) && value.certificates.every((certificate) => record(certificate) && text(certificate.name) && text(certificate.url))))
}

function parseSearch(value: unknown): ApiSearchResult {
  if (!record(value) || typeof value.intent !== 'string' || !['specifications', 'product', 'purchase_terms', 'conversation'].includes(value.intent)
    || !text(value.answer) || !Array.isArray(value.alternatives) || !optionalString(value.sourceUrl)
    || (value.quantity !== undefined && (!nonnegative(value.quantity) || !Number.isSafeInteger(value.quantity)))
    || (value.notice !== undefined && (typeof value.notice !== 'string' || !['AI_OFFLINE', 'AI_UNAVAILABLE', 'AI_CALL_LIMIT', 'AI_RATE_LIMIT', 'CATALOG_LOADING', 'CATALOG_UNAVAILABLE'].includes(value.notice)))) invalidResponse()
  const filters = value.filters
  if (filters !== null && (!record(filters) || !positiveInteger(filters.poles) || !curve(filters.curve)
    || !nonnegative(filters.amps) || filters.amps <= 0 || !nonnegative(filters.breakingCapacityKa) || filters.breakingCapacityKa <= 0
    || !positiveInteger(filters.quantity))) invalidResponse()
  const exact = value.exactMatch
  if (exact !== null && (!record(exact) || !validProduct(exact.product) || typeof exact.canFulfill !== 'boolean')) invalidResponse()
  if (!value.alternatives.every((alternative) => record(alternative) && validProduct(alternative.product) && typeof alternative.reason === 'string')) invalidResponse()
  return value as ApiSearchResult
}

function parseCart(value: unknown): CartSnapshot {
  if (!record(value) || !Array.isArray(value.items) || !nonnegative(value.totalPriceKzt) || !optionalString(value.cartUrl)) invalidResponse()
  const seen = new Set<string>()
  let total = 0
  for (const item of value.items) {
    if (!record(item) || !text(item.sku) || !text(item.name) || !positiveInteger(item.quantity)
      || !nonnegative(item.unitPriceKzt) || !nonnegative(item.lineTotalKzt) || seen.has(item.sku)
      || Math.abs(item.unitPriceKzt * item.quantity - item.lineTotalKzt) > 0.000001) invalidResponse()
    seen.add(item.sku)
    total += item.lineTotalKzt
  }
  if (!nonnegative(total) || Math.abs(total - value.totalPriceKzt) > 0.000001) invalidResponse()
  return { ...(value as Cart), cartUrl: frontendCartUrl(value.cartUrl as string | undefined) }
}

function parseSession(value: unknown): { sessionId: string } {
  if (!record(value) || !text(value.sessionId) || value.sessionId.length > 256 || /[\r\n]/.test(value.sessionId)) invalidResponse()
  return { sessionId: value.sessionId }
}

function loadPendingConfirmations(currentSession: string): void {
  if (pendingSession === currentSession) return
  pendingSession = currentSession
  pendingConfirmations = new Map()
  try {
    const saved: unknown = JSON.parse(readStorage(pendingStorageKey) ?? 'null')
    if (!record(saved) || saved.sessionId !== currentSession || !Array.isArray(saved.entries)) return
    for (const entry of saved.entries) {
      if (Array.isArray(entry) && entry.length === 2 && text(entry[0]) && text(entry[1])) pendingConfirmations.set(entry[0], entry[1])
    }
  } catch { /* Ignore obsolete or damaged browser state. */ }
}

function savePendingConfirmation(currentSession: string, sku: string, quantity: number, confirmationId?: string): void {
  loadPendingConfirmations(currentSession)
  const key = JSON.stringify([sku, quantity])
  if (confirmationId) pendingConfirmations.set(key, confirmationId)
  else pendingConfirmations.delete(key)
  writeStorage(pendingStorageKey, JSON.stringify({ sessionId: currentSession, entries: [...pendingConfirmations] }))
}

export function pendingConfirmationId(sku: string, quantity: number): string | undefined {
  if (!sessionId) return undefined
  loadPendingConfirmations(sessionId)
  return pendingConfirmations.get(JSON.stringify([sku, quantity]))
}

async function request<T>(path: string, parse: (value: unknown) => T, body?: unknown, session?: string): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), configuration.requestTimeoutMs ?? 35000)
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(session && { 'X-Session-Id': session }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
    const payload = await response.json().catch((error) => {
      if (controller.signal.aborted || !(error instanceof SyntaxError)) throw error
      return null
    })
    if (!record(payload)) invalidResponse()
    if (!response.ok) {
      const error = record(payload.error) ? payload.error : {}
      throw new ApiError(text(error.message) ? error.message : 'Не удалось выполнить запрос.', response.status, text(error.code) ? error.code : 'REQUEST_FAILED')
    }
    return parse(payload)
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (controller.signal.aborted) throw new ApiError('Помощник не ответил вовремя. Повторите запрос.', 0, 'REQUEST_TIMEOUT')
    throw new ApiError('Сервер помощника недоступен. Повторите запрос.', 0, 'NETWORK_ERROR')
  } finally {
    clearTimeout(timeout)
  }
}

export function ensureSession(): Promise<string> {
  const stored = readStorage(configuration.sessionStorageKey)
  sessionId ??= text(stored) && stored !== rejectedStoredSession && stored.length <= 256 && !/[\r\n]/.test(stored) ? stored : undefined
  if (sessionId) {
    loadPendingConfirmations(sessionId)
    return Promise.resolve(sessionId)
  }
  sessionRequest ??= request('/session', parseSession, {})
    .then((result) => {
      sessionId = result.sessionId
      writeStorage(configuration.sessionStorageKey, sessionId)
      loadPendingConfirmations(sessionId)
      return sessionId
    })
    .finally(() => { sessionRequest = undefined })
  return sessionRequest
}

async function sessionRequestFor<T>(path: string, parse: (value: unknown) => T, body?: unknown, beforeRequest?: (session: string) => void): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const currentSession = await ensureSession()
    try {
      beforeRequest?.(currentSession)
      return await request(path, parse, body, currentSession)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || attempt > 0) throw error
      // A restarted server rejects the old session before it can mutate the cart.
      if (sessionId === currentSession) {
        rejectedStoredSession = currentSession
        sessionId = undefined
        writeStorage(configuration.sessionStorageKey)
        writeStorage(pendingStorageKey)
        pendingSession = undefined
        pendingConfirmations.clear()
      }
    }
  }
}

function ensureChatSession(chatId: string): Promise<string> {
  const saved = Object.hasOwn(chatSessions, chatId) ? chatSessions[chatId] : undefined
  if (saved) return saved
  const pending = request('/session', parseSession, {})
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
  const body = { query, conversation: true }
  return chatId === undefined
    ? sessionRequestFor('/search', parseSearch, body)
    : withChatSession(chatId, (session) => request('/search', parseSearch, body, session))
}

export function frontendCartUrl(cartUrl = configuration.cartPath): string {
  if (!cartUrl.startsWith('/') || cartUrl.startsWith('//')) throw new ApiError('Некорректная ссылка на корзину.', 0, 'INVALID_CART_URL')
  const url = new URL(cartUrl, window.location.origin)
  if (url.origin !== window.location.origin) throw new ApiError('Некорректная ссылка на корзину.', 0, 'INVALID_CART_URL')
  return `${url.pathname}${url.search}${url.hash}`
}

export async function getCart(): Promise<CartSnapshot> {
  return sessionRequestFor('/cart', parseCart)
}

export async function addToCart(sku: string, quantity: number, confirmationId: string, expectedUnitPriceKzt?: number): Promise<CartSnapshot> {
  let writeSession: string | undefined
  const cart = await sessionRequestFor('/cart', parseCart, { sku, quantity, confirmed: true, confirmationId, ...(expectedUnitPriceKzt !== undefined && { expectedUnitPriceKzt }) }, (currentSession) => {
    writeSession = currentSession
    savePendingConfirmation(currentSession, sku, quantity, confirmationId)
  })
  if (!cart.items.some((item) => item.sku === sku && item.quantity >= quantity)) invalidResponse()
  if (writeSession) savePendingConfirmation(writeSession, sku, quantity)
  return cart
}
