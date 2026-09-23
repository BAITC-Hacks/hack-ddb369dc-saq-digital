import type { Language } from '../i18n'
import type { ApiProduct, SearchResponse } from '../types'
import { safeLink } from './links'

export type UiError = { key: 'shortQuery' | 'longQuery' | 'requestFailed' | 'requestTimeout' | 'serverUnavailable'; detail?: string }
export type ChatTurn = {
  id: string
  query: string
  language: Language
  status: 'loading' | 'complete' | 'error'
  response?: SearchResponse
  error?: UiError
  restored?: boolean
}
export type Chat = { id: string; draft: string; turns: ChatTurn[] }
export const createChat = (): Chat => ({ id: crypto.randomUUID(), draft: '', turns: [] })
export const HISTORY_KEY = 'ekt-assistant-chat-history'

// Limits reject oversized histories explicitly; never silently discard older messages.
const MAX_BYTES = 2 * 1024 * 1024
const MAX_TEXT = 100_000
const MAX_DRAFT = 10_000
const MAX_CHATS = 100
const MAX_TURNS = 500

function invalid(): never { throw new Error('Invalid chat history') }
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : invalid()
}
function text(value: unknown, max = MAX_TEXT, nonempty = false): string {
  return typeof value === 'string' && value.length <= max && (!nonempty || value.trim().length > 0) ? value : invalid()
}
function number(value: unknown, minimum = 0, integer = false): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && (!integer || Number.isSafeInteger(value)) ? value : invalid()
}
function boolean(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid() }
function list(value: unknown, limit: number): unknown[] { return Array.isArray(value) && value.length <= limit ? value : invalid() }
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  return typeof value === 'string' && options.includes(value as T) ? value as T : invalid()
}
function link(value: unknown): string {
  const url = text(value, 4096, true)
  return safeLink(url) ? url : invalid()
}

function properties(value: unknown): Record<string, unknown> {
  const entries = Object.entries(record(value))
  if (entries.length > 100) return invalid()
  return Object.fromEntries(entries.map(([key, item]) => {
    text(key, 256, true)
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return invalid()
    if (item === null || typeof item === 'boolean') return [key, item]
    if (typeof item === 'number' && Number.isFinite(item)) return [key, item]
    return [key, text(item, MAX_DRAFT)]
  }))
}

function product(value: unknown): ApiProduct {
  const item = record(value)
  return {
    sku: text(item.sku, 256, true), name: text(item.name, MAX_DRAFT, true),
    stock: number(item.stock), priceKzt: number(item.priceKzt),
    ...(item.brand === undefined ? {} : { brand: text(item.brand, 1000) }),
    ...(item.poles === undefined ? {} : { poles: item.poles === null ? null : number(item.poles, 1, true) }),
    ...(item.curve === undefined ? {} : { curve: item.curve === null ? null : choice(item.curve, ['B', 'C', 'D'] as const) }),
    ...(item.amps === undefined ? {} : { amps: item.amps === null ? null : number(item.amps) }),
    ...(item.breakingCapacityKa === undefined ? {} : { breakingCapacityKa: item.breakingCapacityKa === null ? null : number(item.breakingCapacityKa) }),
    ...(item.minimumOrderQuantity === undefined ? {} : { minimumOrderQuantity: number(item.minimumOrderQuantity, 1, true) }),
    ...(item.technicalIssue === undefined ? {} : { technicalIssue: text(item.technicalIssue, MAX_DRAFT) }),
    ...(item.properties === undefined ? {} : { properties: properties(item.properties) }),
    ...(item.stores === undefined ? {} : { stores: list(item.stores, 100).map((value) => {
      const store = record(value)
      return { id: number(store.id, Number.MIN_SAFE_INTEGER, true), name: text(store.name, 1000), quantity: number(store.quantity) }
    }) }),
    ...(item.certificates === undefined ? {} : { certificates: list(item.certificates, 100).map((value) => {
      const certificate = record(value)
      return { name: text(certificate.name, 1000, true), url: link(certificate.url) }
    }) }),
  }
}

function response(value: unknown): SearchResponse {
  const item = record(value)
  const exact = item.exactMatch === null ? null : record(item.exactMatch)
  return {
    intent: choice(item.intent, ['product', 'specifications', 'purchase_terms', 'conversation'] as const),
    answer: text(item.answer),
    ...(item.quantity === undefined ? {} : { quantity: number(item.quantity, 0, true) }),
    ...(item.notice === undefined ? {} : { notice: choice(item.notice, ['AI_OFFLINE', 'AI_UNAVAILABLE', 'AI_CALL_LIMIT'] as const) }),
    ...(item.sourceUrl === undefined ? {} : { sourceUrl: link(item.sourceUrl) }),
    filters: item.filters === null ? null : { quantity: number(record(item.filters).quantity, 1, true) },
    exactMatch: exact === null ? null : { product: product(exact.product), canFulfill: boolean(exact.canFulfill) },
    alternatives: list(item.alternatives, 100).map((value) => {
      const alternative = record(value)
      return { product: product(alternative.product), reason: text(alternative.reason) }
    }),
  }
}

function error(value: unknown): UiError {
  const item = record(value)
  return {
    key: choice(item.key, ['shortQuery', 'longQuery', 'requestFailed', 'requestTimeout', 'serverUnavailable'] as const),
    ...(item.detail === undefined ? {} : { detail: text(item.detail, MAX_DRAFT) }),
  }
}

function turn(value: unknown, restoring: boolean): ChatTurn {
  const item = record(value)
  const status = choice(item.status, ['loading', 'complete', 'error'] as const)
  const base = {
    id: text(item.id, 256, true), query: text(item.query, MAX_DRAFT, true),
    language: choice(item.language, ['ru', 'kk'] as const),
    ...(restoring || item.restored === true ? { restored: true } : {}),
  }
  if (item.restored !== undefined) boolean(item.restored)
  // A page reload cannot establish whether an in-flight request completed.
  if (status === 'loading' && restoring) return { ...base, status: 'error', error: { key: 'requestFailed' } }
  return {
    ...base, status,
    ...(status === 'complete' ? { response: response(item.response) } : {}),
    ...(status === 'error' ? { error: error(item.error) } : {}),
  }
}

function uniqueIds<T extends { id: string }>(items: T[]): T[] {
  return new Set(items.map((item) => item.id)).size === items.length ? items : invalid()
}

function payload(value: unknown, restoring: boolean): { chats: Chat[]; selectedChatId: string } {
  const item = record(value)
  if (item.version !== 1) return invalid()
  const chats = uniqueIds(list(item.chats, MAX_CHATS).map((value) => {
    const chat = record(value)
    return {
      id: text(chat.id, 256, true), draft: text(chat.draft, MAX_DRAFT),
      turns: uniqueIds(list(chat.turns, MAX_TURNS).map((value) => turn(value, restoring))),
    }
  }))
  const selectedChatId = text(item.selectedChatId, 256, true)
  if (!chats.some((chat) => chat.id === selectedChatId)) return invalid()
  return { chats, selectedChatId }
}

export function loadChatHistory(): { chats: Chat[]; selectedChatId: string | null; storageError: boolean } {
  try {
    const stored = window.localStorage.getItem(HISTORY_KEY)
    if (stored === null) return { chats: [createChat()], selectedChatId: null, storageError: false }
    if (stored.length * 2 > MAX_BYTES) return invalid()
    return { ...payload(JSON.parse(stored), true), storageError: false }
  } catch {
    return { chats: [createChat()], selectedChatId: null, storageError: true }
  }
}

export function saveChatHistory(chats: Chat[], selectedChatId: string): boolean {
  try {
    const safe = payload({ version: 1, chats, selectedChatId }, false)
    const serialized = JSON.stringify({ version: 1, ...safe })
    if (serialized.length * 2 > MAX_BYTES) return false
    window.localStorage.setItem(HISTORY_KEY, serialized)
    return true
  } catch {
    return false
  }
}
