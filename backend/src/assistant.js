import { parseQuery, searchCatalog } from './search.js';
import { ApiError } from './errors.js';

function matchingProduct(catalog, query) {
  const normalized = query.toLocaleLowerCase('ru');
  return catalog.find((product) => [product.sku, product.article].some((identifier) => {
    if (!identifier) return false;
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(normalized);
  }));
}

function productAnswer(product, quantity) {
  const stock = product.stock >= quantity
    ? `В наличии ${product.stock} шт.`
    : `На складе ${product.stock} шт., запрошено ${quantity} шт.`;
  const certificate = product.certificates?.length
    ? `Сертификаты: ${product.certificates.map((item) => `${item.name}: ${item.url}`).join('; ')}.`
    : 'Сертификат в доступных данных не указан.';
  return `${product.name}. Артикул ${product.article ?? product.sku}. Цена ${product.priceKzt} ₸. ${stock} ${certificate}${product.technicalIssue ? ` ${product.technicalIssue}` : ''}`;
}

function termsAnswer(query, terms) {
  if (!terms) return null;
  const sections = [];
  if (/оплат|рассроч|платеж|платёж/i.test(query)) sections.push(terms.payment);
  if (/достав|самовывоз/i.test(query)) sections.push(terms.delivery);
  if (/парт|минимальн|кратност/i.test(query)) sections.push(terms.minimumOrder);
  return sections.length ? sections.join(' ') : null;
}

export function answerQuery(catalog, query, terms, context, filtersOverride) {
  const termsText = termsAnswer(query, terms);
  const specifiesProduct = /\b[1-4]\s*(?:[pр]|ф)(?=$|[^\p{L}])|(?<!\p{L})[BCDВСД]\s*\d/iu.test(query);
  const product = matchingProduct(catalog, query) ?? (
    !specifiesProduct && context?.lastSku && /налич|сертификат|цен|характеристик|сколько|описани|шт\.?|штук/i.test(query)
      ? catalog.find((item) => item.sku === context.lastSku)
      : null
  );
  if (product) {
    const quantityMatch = query.match(/(?:^|\D)(\d+)\s*(?:шт\.?|штук|штуки|штука|единиц)(?=$|[^\p{L}])/iu);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new ApiError(422, 'INVALID_QUANTITY', 'Количество должно быть положительным целым числом.');
    }
    if (context) context.lastSku = product.sku;
    const filters = product.poles && product.curve && product.amps && product.breakingCapacityKa
      ? { poles: product.poles, curve: product.curve, amps: product.amps, breakingCapacityKa: product.breakingCapacityKa, quantity }
      : null;
    const alternatives = filters && product.stock < quantity ? searchCatalog(catalog, filters).alternatives : [];
    return {
      intent: 'product',
      quantity,
      answer: `${productAnswer(product, quantity)}${alternatives.length ? ' Есть варианты по указанным техническим параметрам.' : ''}${termsText ? ` ${termsText}` : ''}`,
      ...(termsText && { sourceUrl: terms.sourceUrl }),
      filters,
      exactMatch: { product, canFulfill: product.stock >= quantity },
      alternatives,
    };
  }

  if (termsText) {
    return { intent: 'purchase_terms', answer: termsText, sourceUrl: terms.sourceUrl, filters: null, exactMatch: null, alternatives: [] };
  }

  const filters = filtersOverride ?? parseQuery(query);
  const result = searchCatalog(catalog, filters);
  if (context && result.exactMatch) context.lastSku = result.exactMatch.product.sku;
  const answer = result.exactMatch?.canFulfill
    ? 'Точный товар найден и есть в нужном количестве.'
    : result.alternatives.length
      ? 'Точного товара в нужном количестве нет. Найдены варианты по указанным техническим параметрам.'
      : 'По заданным характеристикам товар в нужном количестве не найден.';
  return { intent: 'specifications', answer, ...result };
}
