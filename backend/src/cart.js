import { ApiError } from './errors.js';

export class Cart {
  constructor(catalog) {
    this.catalogSource = catalog;
    this.catalog = new Map();
    this.items = new Map();
    this.confirmations = new Map();
  }

  snapshot() {
    const items = [...this.items].map(([sku, quantity]) => {
      const product = this.catalog.get(sku);
      return { sku, name: product.name, quantity, unitPriceKzt: product.priceKzt, lineTotalKzt: product.priceKzt * quantity };
    });
    return { items, totalPriceKzt: items.reduce((total, item) => total + item.lineTotalKzt, 0) };
  }

  add({ sku, quantity, confirmed, confirmationId }) {
    if (confirmed !== true) {
      throw new ApiError(400, 'CONFIRMATION_REQUIRED', 'Товар добавляется только после явного подтверждения.');
    }
    if (typeof confirmationId !== 'string' || !confirmationId.trim() || confirmationId.length > 256) {
      throw new ApiError(400, 'CONFIRMATION_ID_REQUIRED', 'Укажите идентификатор подтверждения длиной до 256 символов.');
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new ApiError(400, 'INVALID_QUANTITY', 'Количество должно быть положительным целым числом.');
    }
    const previous = this.confirmations.get(confirmationId);
    if (previous) {
      if (previous.sku !== sku || previous.quantity !== quantity) {
        throw new ApiError(409, 'CONFIRMATION_CONFLICT', 'Это подтверждение уже использовано для другого товара или количества.');
      }
      return this.snapshot();
    }

    const product = this.catalogSource.find((item) => item.sku === sku);
    if (!product) {
      throw new ApiError(404, 'SKU_NOT_FOUND', 'Товар не найден в каталоге.');
    }
    const nextQuantity = (this.items.get(sku) ?? 0) + quantity;
    if (product.minimumOrderQuantity && quantity % product.minimumOrderQuantity !== 0) {
      throw new ApiError(409, 'INVALID_ORDER_MULTIPLE', `Количество должно быть кратно ${product.minimumOrderQuantity}.`);
    }
    if (nextQuantity > product.stock) {
      throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Запрошенное количество превышает доступный остаток.');
    }
    this.catalog.set(sku, { ...product });
    this.items.set(sku, nextQuantity);
    this.confirmations.set(confirmationId, { sku, quantity });
    return this.snapshot();
  }
}
