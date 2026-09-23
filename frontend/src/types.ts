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
