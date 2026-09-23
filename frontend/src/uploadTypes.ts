import type { ApiProduct } from './types'

export type UploadCapabilities = {
  enabled: boolean
  maxFiles: number
  maxFileBytes: number
  maxItems: number
  resultTtlSeconds: number
  pollIntervalMs: number
  formats: { extensions: string[]; mimeType: string }[]
}

export type UploadCandidate = {
  product: ApiProduct
  reason: string
  canFulfill: boolean | null
  canAddToCart: boolean
}

export type UploadLine = {
  lineId: string
  description: string
  article: string | null
  quantity: number | null
  unit: string | null
  sourceText: string
  specifications: {
    poles: number | null
    curve: 'B' | 'C' | 'D' | null
    amps: number | null
    breakingCapacityKa: number | null
  }
  matchStatus: 'matched' | 'ambiguous' | 'not_found'
  matchCount: number
  candidates: UploadCandidate[]
  warnings: string[]
  requiresReview: boolean
}

export type UploadJob = {
  uploadId: string
  requestId: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  file: { name: string; mimeType: string; sizeBytes: number }
  createdAt: string
  expiresAt: string
  items: UploadLine[]
  warnings: string[]
  truncated: boolean
  error: { code: string; message: string } | null
}
