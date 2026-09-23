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
}

export type SearchResult = {
  interpretedQuery: string
  products: Product[]
  message: string
}
