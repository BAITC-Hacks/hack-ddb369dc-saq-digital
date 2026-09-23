import { ApiError } from './errors.js';

export class Cart {
  constructor(catalog) {
    this.catalogSource = catalog;
    this.catalog = new Map();
    this.items = new Map();
    this.confirmations = new Map();
    this.quotes = new Map();
    this.pending = Promise.resolve();
  }

  snapshot() {
    const items = [...this.items].map(([sku, quantity]) => {
      const product = this.catalog.get(sku);
      return { sku, name: product.name, quantity, unitPriceKzt: product.priceKzt, lineTotalKzt: product.priceKzt * quantity };
    });
    return { items, totalPriceKzt: items.reduce((total, item) => total + item.lineTotalKzt, 0) };
  }

  rememberQuote(product) {
    this.quotes.delete(product.sku);
    this.quotes.set(product.sku, product.priceKzt);
    if (this.quotes.size > 200) this.quotes.delete(this.quotes.keys().next().value);
  }

  validateRequest({ quantity, confirmed, confirmationId }) {
    if (confirmed !== true) {
      throw new ApiError(400, 'CONFIRMATION_REQUIRED', 'Товар добавляется только после явного подтверждения.');
    }
    if (typeof confirmationId !== 'string' || !confirmationId.trim()) {
      throw new ApiError(400, 'CONFIRMATION_ID_REQUIRED', 'Укажите идентификатор подтверждения.');
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new ApiError(400, 'INVALID_QUANTITY', 'Количество должно быть положительным целым числом.');
    }
  }

  addVerified(input, verifyProduct) {
    // Serialize confirmation attempts so retries cannot race against stock/price checks.
    const operation = this.pending.then(async () => {
      this.validateRequest(input);
      if (this.confirmations.has(input.confirmationId)) return this.add(input);
      const product = this.catalogSource.find((item) => item.sku === input.sku);
      if (!product) throw new ApiError(404, 'SKU_NOT_FOUND', 'Товар не найден в каталоге.');
      const expectedPrice = input.expectedUnitPriceKzt ?? this.quotes.get(input.sku) ?? product.priceKzt;
      const fresh = await verifyProduct(product);
      if (fresh.sku !== input.sku || fresh.id !== product.id) {
        throw new ApiError(409, 'PRODUCT_CHANGED', 'Карточка товара изменилась. Повторите поиск и выбор товара.');
      }
      if (fresh.priceKzt !== expectedPrice) {
        throw new ApiError(409, 'PRODUCT_PRICE_CHANGED', `Цена товара изменилась: сейчас ${fresh.priceKzt} ₸. Повторите поиск по артикулу ${fresh.sku} и подтвердите новую цену. Корзина не изменена.`);
      }
      return this.add(input, fresh);
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  add({ sku, quantity, confirmed, confirmationId }, verifiedProduct) {
    this.validateRequest({ quantity, confirmed, confirmationId });
    const previous = this.confirmations.get(confirmationId);
    if (previous) {
      if (previous.sku !== sku || previous.quantity !== quantity) {
        throw new ApiError(409, 'CONFIRMATION_CONFLICT', 'Это подтверждение уже использовано для другого товара или количества.');
      }
      return this.snapshot();
    }

    const product = verifiedProduct ?? this.catalogSource.find((item) => item.sku === sku);
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
