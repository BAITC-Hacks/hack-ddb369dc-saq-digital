import type { Product, SearchResult } from '../types'

const productCatalog: Product[] = [
  {
    id: 'av-3p-c16-10ka-08',
    sku: 'EKT-AV-3P-C16-10K',
    name: 'Автоматический выключатель 3P C16, 10 kA',
    poles: '3P',
    curve: 'C',
    amperage: 16,
    breakingCapacity: '10 kA',
    stock: 3,
    price: 12490,
    isExactMatch: true,
    recommendation: 'Точное совпадение по всем параметрам, но доступно только 3 из 8 штук.',
  },
  {
    id: 'av-3p-c16-10ka-31',
    sku: 'EKT-SF-3P-C16-10K',
    name: 'Автоматический выключатель SafeLine 3P C16, 10 kA',
    poles: '3P',
    curve: 'C',
    amperage: 16,
    breakingCapacity: '10 kA',
    stock: 31,
    price: 13150,
    isExactMatch: false,
    recommendation: 'Полностью совместимый аналог: те же 3P, C16 и 10 kA; в наличии весь объём.',
  },
  {
    id: 'av-3p-c16-6ka-18',
    sku: 'EKT-PM-3P-C16-6K',
    name: 'Автоматический выключатель ProMax 3P C16, 6 kA',
    poles: '3P',
    curve: 'C',
    amperage: 16,
    breakingCapacity: '6 kA',
    stock: 18,
    price: 10800,
    isExactMatch: false,
    recommendation: 'Экономичный вариант с теми же 3P и C16. Подходит только если проект допускает 6 kA.',
  },
]

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))

export async function searchDemoCatalog(query: string): Promise<SearchResult> {
  await delay(680)

  if (query.toLocaleLowerCase().includes('c63')) {
    return {
      interpretedQuery: '3P · C63 · 10 kA · количество не определено',
      products: [],
      message: 'В demo-каталоге нет подходящих позиций. Попробуйте изменить номинал или запросить помощь менеджера.',
    }
  }

  return {
    interpretedQuery: '3P · C16 · 10 kA · 8 шт.',
    products: productCatalog,
    message: 'Нашёл точную позицию и два варианта замены. Для заказа 8 штук рекомендую SafeLine.',
  }
}
