import configuration from '../../config.json'
import type { ApiProduct } from '../types'
import type { UploadCandidate, UploadCapabilities, UploadJob, UploadLine } from '../uploadTypes'
import { apiBaseUrl, ApiError } from './api'

type JsonObject = Record<string, unknown>
export type UploadFileError = 'EMPTY_FILE' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_FILE_TYPE' | 'INVALID_FILE'
const requestTimeoutMs = configuration.requestTimeoutMs ?? 35000
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'
const nonempty = (value: unknown): value is string => text(value) && value.trim().length > 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const positive = (value: unknown): value is number => finite(value) && value > 0
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0
const integer = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value)
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text)
const nullableText = (value: unknown): value is string | null => value === null || text(value)
const nullablePositive = (value: unknown): value is number | null => value === null || positive(value)
const curve = (value: unknown): value is 'B' | 'C' | 'D' | null => value === null || value === 'B' || value === 'C' || value === 'D'

function invalidResponse(status: number): never {
  throw new ApiError('Некорректный ответ сервера.', status, 'INVALID_RESPONSE')
}

function parseCapabilities(value: unknown, status: number): UploadCapabilities {
  if (!object(value) || typeof value.enabled !== 'boolean'
    || ![value.maxFiles, value.maxFileBytes, value.maxItems, value.resultTtlSeconds, value.pollIntervalMs].every((entry) => integer(entry) && entry > 0)
    || !Array.isArray(value.formats) || !value.formats.length) return invalidResponse(status)
  const formats = value.formats.map((format: unknown) => {
    if (!object(format) || !strings(format.extensions) || !format.extensions.length
      || !format.extensions.every((extension) => /^\.[a-z0-9]+$/.test(extension)) || !nonempty(format.mimeType)) return invalidResponse(status)
    return { extensions: [...format.extensions], mimeType: format.mimeType }
  })
  return {
    enabled: value.enabled, maxFiles: value.maxFiles as number, maxFileBytes: value.maxFileBytes as number,
    maxItems: value.maxItems as number, resultTtlSeconds: value.resultTtlSeconds as number,
    pollIntervalMs: value.pollIntervalMs as number, formats,
  }
}

function parseProduct(value: unknown, status: number): ApiProduct {
  if (!object(value) || !nonempty(value.sku) || !nonempty(value.name) || !nonnegative(value.priceKzt) || !nonnegative(value.stock)) return invalidResponse(status)
  for (const key of ['poles', 'amps', 'breakingCapacityKa'] as const) {
    if (value[key] !== undefined && !nullablePositive(value[key])) return invalidResponse(status)
  }
  if (value.curve !== undefined && !curve(value.curve)) return invalidResponse(status)
  if (value.minimumOrderQuantity !== undefined && (!integer(value.minimumOrderQuantity) || value.minimumOrderQuantity === 0)) return invalidResponse(status)
  if (value.brand !== undefined && !text(value.brand)) return invalidResponse(status)
  if (value.technicalIssue !== undefined && !text(value.technicalIssue)) return invalidResponse(status)
  if (value.properties !== undefined && !object(value.properties)) return invalidResponse(status)
  if (value.stores !== undefined && (!Array.isArray(value.stores) || !value.stores.every((entry: unknown) => object(entry)
    && finite(entry.id) && Number.isSafeInteger(entry.id) && text(entry.name) && nonnegative(entry.quantity)))) return invalidResponse(status)
  if (value.certificates !== undefined && (!Array.isArray(value.certificates) || !value.certificates.every((entry: unknown) => object(entry) && text(entry.name) && text(entry.url)))) return invalidResponse(status)
  return {
    sku: value.sku, name: value.name, priceKzt: value.priceKzt, stock: value.stock,
    ...(value.poles !== undefined && { poles: value.poles as number | null }),
    ...(value.amps !== undefined && { amps: value.amps as number | null }),
    ...(value.breakingCapacityKa !== undefined && { breakingCapacityKa: value.breakingCapacityKa as number | null }),
    ...(value.curve !== undefined && { curve: value.curve as ApiProduct['curve'] }),
    ...(value.minimumOrderQuantity !== undefined && { minimumOrderQuantity: value.minimumOrderQuantity as number }),
    ...(value.brand !== undefined && { brand: value.brand as string }),
    ...(value.technicalIssue !== undefined && { technicalIssue: value.technicalIssue as string }),
    ...(value.properties !== undefined && { properties: { ...value.properties as JsonObject } }),
    ...(value.stores !== undefined && { stores: (value.stores as NonNullable<ApiProduct['stores']>).map(({ id, name, quantity }) => ({ id, name, quantity })) }),
    ...(value.certificates !== undefined && { certificates: (value.certificates as { name: string; url: string }[]).map(({ name, url }) => ({ name, url })) }),
  }
}

function parseCandidate(value: unknown, status: number): UploadCandidate {
  if (!object(value) || !text(value.reason) || (value.canFulfill !== null && typeof value.canFulfill !== 'boolean')
    || typeof value.canAddToCart !== 'boolean') return invalidResponse(status)
  return { product: parseProduct(value.product, status), reason: value.reason, canFulfill: value.canFulfill, canAddToCart: value.canAddToCart }
}

function parseLine(value: unknown, status: number): UploadLine {
  if (!object(value) || !nonempty(value.lineId) || !text(value.description) || !nullableText(value.article)
    || !nullablePositive(value.quantity) || !nullableText(value.unit) || !text(value.sourceText)
    || !object(value.specifications) || !nullablePositive(value.specifications.poles) || !curve(value.specifications.curve)
    || !nullablePositive(value.specifications.amps) || !nullablePositive(value.specifications.breakingCapacityKa)
    || !['matched', 'ambiguous', 'not_found'].includes(String(value.matchStatus))
    || !integer(value.matchCount) || !Array.isArray(value.candidates) || value.candidates.length > 3
    || !strings(value.warnings) || typeof value.requiresReview !== 'boolean') return invalidResponse(status)
  const candidates = value.candidates.map((candidate: unknown) => parseCandidate(candidate, status))
  if ((value.matchStatus === 'not_found' && (value.matchCount !== 0 || candidates.length !== 0))
    || (value.matchStatus === 'matched' && (value.matchCount !== 1 || candidates.length !== 1))
    || (value.matchStatus === 'ambiguous' && (value.matchCount < 2 || candidates.length < 2))
    || candidates.length > value.matchCount) return invalidResponse(status)
  return {
    lineId: value.lineId, description: value.description, article: value.article, quantity: value.quantity,
    unit: value.unit, sourceText: value.sourceText,
    specifications: { poles: value.specifications.poles, curve: value.specifications.curve, amps: value.specifications.amps, breakingCapacityKa: value.specifications.breakingCapacityKa },
    matchStatus: value.matchStatus as UploadLine['matchStatus'], matchCount: value.matchCount,
    candidates, warnings: [...value.warnings], requiresReview: value.requiresReview,
  }
}

function parseJob(value: unknown, status: number): UploadJob {
  if (!object(value) || !nonempty(value.uploadId) || !nonempty(value.requestId)
    || !['queued', 'processing', 'completed', 'failed'].includes(String(value.status))
    || !object(value.file) || !nonempty(value.file.name) || !nonempty(value.file.mimeType) || !integer(value.file.sizeBytes)
    || !text(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))
    || !text(value.expiresAt) || !Number.isFinite(Date.parse(value.expiresAt))
    || !Array.isArray(value.items) || !strings(value.warnings) || typeof value.truncated !== 'boolean'
    || !(value.error === null || (object(value.error) && nonempty(value.error.code) && text(value.error.message)))) return invalidResponse(status)
  if ((value.status === 'failed') !== (value.error !== null) || (value.status !== 'completed' && value.items.length > 0)) return invalidResponse(status)
  return {
    uploadId: value.uploadId, requestId: value.requestId, status: value.status as UploadJob['status'],
    file: { name: value.file.name, mimeType: value.file.mimeType, sizeBytes: value.file.sizeBytes },
    createdAt: value.createdAt, expiresAt: value.expiresAt, items: value.items.map((item: unknown) => parseLine(item, status)),
    warnings: [...value.warnings], truncated: value.truncated,
    error: value.error === null ? null : { code: value.error.code as string, message: value.error.message as string },
  }
}

function responseError(status: number, payload: unknown): ApiError {
  if (status === 413) return new ApiError('Превышен допустимый размер файла.', status, 'FILE_TOO_LARGE')
  const error = object(payload) && object(payload.error) ? payload.error : null
  return new ApiError(error && text(error.message) ? error.message : 'Не удалось выполнить запрос.', status,
    error && nonempty(error.code) ? error.code : 'REQUEST_FAILED')
}

function transportError(code: 'REQUEST_ABORTED' | 'REQUEST_TIMEOUT' | 'NETWORK_ERROR'): ApiError {
  const message = code === 'REQUEST_ABORTED' ? 'Запрос отменён.'
    : code === 'REQUEST_TIMEOUT' ? 'Сервер не ответил вовремя. Повторите запрос.' : 'Сервер недоступен. Повторите запрос.'
  return new ApiError(message, 0, code)
}

function requireSession(sessionId: string): void {
  if (!sessionId.trim()) throw new ApiError('Нужна действующая сессия.', 401, 'SESSION_REQUIRED')
}

async function readRequest<T>(path: string, parse: (value: unknown, status: number) => T, sessionId?: string, signal?: AbortSignal, method = 'GET', body?: unknown): Promise<T> {
  if (signal?.aborted) throw transportError('REQUEST_ABORTED')
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: { ...(sessionId && { 'X-Session-Id': sessionId }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      credentials: 'same-origin', signal: controller.signal,
    })
    if (response.status === 413) throw responseError(response.status, null)
    if (method === 'DELETE' && response.status === 204) return undefined as T
    const payload: unknown = await response.json().catch((error: unknown) => {
      if (error instanceof SyntaxError) return null
      throw error
    })
    if (!response.ok) throw responseError(response.status, payload)
    return parse(payload, response.status)
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (controller.signal.aborted) throw transportError(signal?.aborted ? 'REQUEST_ABORTED' : 'REQUEST_TIMEOUT')
    throw transportError('NETWORK_ERROR')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

export function getUploadCapabilities(signal?: AbortSignal): Promise<UploadCapabilities> {
  return readRequest('/uploads/capabilities', parseCapabilities, undefined, signal)
}

export function createUploadSession(signal?: AbortSignal): Promise<string> {
  return readRequest('/session', (value, status) => {
    if (!object(value) || !nonempty(value.sessionId)) return invalidResponse(status)
    return value.sessionId
  }, undefined, signal, 'POST', {})
}

export async function getUpload(uploadId: string, sessionId: string, signal?: AbortSignal): Promise<UploadJob> {
  requireSession(sessionId)
  return readRequest(`/uploads/${encodeURIComponent(uploadId)}`, (value, status) => {
    const job = parseJob(value, status)
    if (job.uploadId !== uploadId) return invalidResponse(status)
    return job
  }, sessionId, signal)
}

export async function deleteUpload(uploadId: string, sessionId: string, signal?: AbortSignal): Promise<void> {
  requireSession(sessionId)
  return readRequest(`/uploads/${encodeURIComponent(uploadId)}`, (_value, status) => invalidResponse(status), sessionId, signal, 'DELETE')
}

export async function createUpload(file: File, requestId: string, sessionId: string, onProgress?: (percent: number | null) => void, signal?: AbortSignal): Promise<UploadJob> {
  requireSession(sessionId)
  if (signal?.aborted) throw transportError('REQUEST_ABORTED')
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = xhr.upload.onprogress = null
    }
    const fail = (error: unknown) => { cleanup(); reject(error) }
    const onAbort = () => { cleanup(); xhr.abort(); reject(transportError('REQUEST_ABORTED')) }
    xhr.onload = () => {
      try {
        let payload: unknown = null
        try { payload = JSON.parse(xhr.responseText) } catch { /* HTTP errors can contain a proxy's HTML page. */ }
        if (xhr.status < 200 || xhr.status >= 300) throw responseError(xhr.status, payload)
        const job = parseJob(payload, xhr.status)
        // The backend canonicalizes UUID request IDs to lowercase.
        if (job.requestId.toLowerCase() !== requestId.toLowerCase()) return invalidResponse(xhr.status)
        cleanup()
        resolve(job)
      } catch (error) { fail(error) }
    }
    xhr.onerror = () => fail(transportError('NETWORK_ERROR'))
    xhr.ontimeout = () => fail(transportError('REQUEST_TIMEOUT'))
    xhr.onabort = () => fail(transportError('REQUEST_ABORTED'))
    xhr.upload.onprogress = (event) => onProgress?.(event.lengthComputable && event.total > 0
      ? Math.min(100, Math.max(0, Math.round(event.loaded / event.total * 100))) : null)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      xhr.open('POST', `${apiBaseUrl}/uploads`, true)
      xhr.timeout = requestTimeoutMs
      xhr.setRequestHeader('X-Session-Id', sessionId)
      const form = new FormData()
      form.append('file', file)
      form.append('requestId', requestId)
      xhr.send(form)
    } catch { fail(transportError('NETWORK_ERROR')) }
  })
}

export function validateUploadFile(file: File, capabilities: UploadCapabilities): UploadFileError | null {
  if (!file.name || file.name.length > 255 || /[\x00-\x1f\x7f]/.test(file.name)) return 'INVALID_FILE'
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  const format = capabilities.formats.find((entry) => entry.extensions.includes(extension))
  if (!format) return 'UNSUPPORTED_FILE_TYPE'
  if (file.type && file.type !== 'application/octet-stream' && file.type !== format.mimeType) return 'INVALID_FILE'
  if (file.size === 0) return 'EMPTY_FILE'
  if (file.size > capabilities.maxFileBytes) return 'FILE_TOO_LARGE'
  return null
}
