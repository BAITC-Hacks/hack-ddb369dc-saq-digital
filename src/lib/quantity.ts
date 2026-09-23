type Limits = { stock: number; minimumOrderQuantity?: number }

function validLimits({ stock, minimumOrderQuantity = 1 }: Limits): boolean {
  return Number.isSafeInteger(stock) && stock >= 0 && Number.isSafeInteger(minimumOrderQuantity) && minimumOrderQuantity > 0
}

export function quantityError(raw: string, product: Limits): 'invalidQuantity' | 'quantityStock' | 'quantityMultiple' | null {
  const quantity = Number(raw)
  if (!validLimits(product) || !/^\d+$/.test(raw) || !Number.isSafeInteger(quantity) || quantity <= 0) return 'invalidQuantity'
  if (quantity > product.stock) return 'quantityStock'
  if (quantity % (product.minimumOrderQuantity ?? 1) !== 0) return 'quantityMultiple'
  return null
}

export function stepQuantity(raw: string, product: Limits, direction: -1 | 1): number | null {
  if (!validLimits(product)) return null
  const step = product.minimumOrderQuantity ?? 1
  const max = Math.floor(product.stock / step) * step
  if (max < step) return null
  const parsed = Number(raw)
  const current = Number.isFinite(parsed) ? parsed : 0
  const next = (direction === 1 ? Math.floor(current / step) + 1 : Math.ceil(current / step) - 1) * step
  return Math.max(step, Math.min(max, next))
}
