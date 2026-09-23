export type Product = {
  id: string
  sku: string
  name: string
  poles?: string
  curve?: 'B' | 'C' | 'D'
  amperage?: number
  breakingCapacity?: string
  stock: number
  price: number
  isExactMatch: boolean
  recommendation: string
  certificateUrl?: string
  certificates?: { name: string; url: string }[]
  properties?: Record<string, unknown>
  technicalIssue?: string
  minimumOrderQuantity?: number
}

export type SearchResult = {
  interpretedQuery: string
  quantity: number
  products: Product[]
  message: string
  answerKind: 'product' | 'alternatives' | 'purchase-terms'
  sourceUrl?: string
}

export type ApiProduct = {
  sku: string
  name: string
  brand?: string
  poles?: number | null
  curve?: 'B' | 'C' | 'D' | null
  amps?: number | null
  breakingCapacityKa?: number | null
  priceKzt: number
  stock: number
  certificates?: { name: string; url: string }[]
  minimumOrderQuantity?: number
  properties?: Record<string, unknown>
  technicalIssue?: string
}

export type ApiSearchResult = {
  intent: 'specifications' | 'product' | 'purchase_terms'
  answer: string
  quantity?: number
  filters: { poles: number; curve: 'B' | 'C' | 'D'; amps: number; breakingCapacityKa: number; quantity: number } | null
  exactMatch: { product: ApiProduct; canFulfill: boolean } | null
  alternatives: { product: ApiProduct; reason: string }[]
  sourceUrl?: string
}

export type Cart = {
  items: { sku: string; name: string; quantity: number; unitPriceKzt: number; lineTotalKzt: number }[]
  totalPriceKzt: number
  cartUrl?: string
}
