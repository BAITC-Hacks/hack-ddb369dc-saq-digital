export type Product = {
  id: string
  sku: string
  name: string
  poles: '3P'
  curve: 'C'
  amperage: number
  breakingCapacity: string
  stock: number
  price: number
  isExactMatch: boolean
  recommendation: string
  certificateUrl?: string
}

export type SearchResult = {
  interpretedQuery: string
  quantity: number
  products: Product[]
  message: string
  answerKind: 'product' | 'alternatives' | 'purchase-terms'
}

export type ApiProduct = {
  sku: string
  name: string
  brand?: string
  poles?: number | null
  curve?: 'B' | 'C' | 'D' | null
  amps?: number | null
  breakingCapacityKa?: number | null
  stock: number
  priceKzt: number
  properties?: Record<string, unknown>
  certificates?: { name: string; url: string }[]
  minimumOrderQuantity?: number
  technicalIssue?: string
}

export type SearchResponse = {
  intent: 'product' | 'specifications' | 'purchase_terms'
  answer: string
  sourceUrl?: string
  filters: { quantity: number } | null
  exactMatch: { product: ApiProduct; canFulfill: boolean } | null
  alternatives: { product: ApiProduct; reason: string }[]
}

export type CartSnapshot = {
  items: { sku: string; name: string; quantity: number; unitPriceKzt: number; lineTotalKzt: number }[]
  totalPriceKzt: number
  cartUrl: string
}
