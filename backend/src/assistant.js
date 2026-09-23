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

function conversationalAnswer(answer, extra = {}) {
  return { intent: 'conversation', answer, filters: null, exactMatch: null, alternatives: [], ...extra };
}

function remember(context, query, result, retainHistory = true) {
  if (retainHistory) {
    context.history = [...(context.history ?? []),
      { role: 'user', content: query },
      { role: 'assistant', content: result.answer },
    ].slice(-8);
  }
  context.lastConversation = result.notice ? null : { query: query.trim(), result };
  return result;
}

function conversationCatalog(catalog, query, context) {
  const words = query.toLocaleLowerCase('ru').match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const ranked = catalog.map((product, index) => {
    const text = `${product.name} ${product.brand ?? ''}`.toLocaleLowerCase('ru');
    const score = Number(product.sku === context.lastSku) * 100 + words.filter((word) => text.includes(word)).length;
    return { product, index, score };
  });
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 20).map(({ product }) => product);
}

export async function answerConversation(catalog, query, terms, context = {}, queryParser) {
  if (query.length > 4000) throw new ApiError(400, 'QUERY_TOO_LONG', 'Сократите сообщение до 4000 символов.');
  if (context.lastConversation?.query === query.trim()) return context.lastConversation.result;
  let clarification;
  try {
    // A pending selection must not be interpreted as a question about the previous SKU.
    const localContext = context.pendingFilters ? undefined : context;
    const result = answerQuery(catalog, query, terms, localContext);
    if (result.intent !== 'purchase_terms') {
      context.pendingFilters = null;
      if (result.exactMatch) context.lastSku = result.exactMatch.product.sku;
    }
    return remember(context, query, result);
  } catch (error) {
    if (error.code !== 'MISSING_SPECIFICATIONS') throw error;
    clarification = error.message;
  }

  if (queryParser) {
    try {
      const reply = await queryParser.reply(query, {
        site: `EKT Match — помощник магазина электротехники. ${catalog.length && catalog.every((product) => product.id) ? 'Данные товаров загружены из API ekt.kz при запуске сервера.' : 'Используется локальный каталог.'} Можно искать товары и добавлять их в локальную корзину после кнопки подтверждения. Реальных заказов, оплаты, личного кабинета и резервирования склада в прототипе нет. Цены в тенге. Передан только фрагмент каталога: отсутствие товара в этом фрагменте не означает его отсутствие в магазине. Категории витрины без товаров в переданных данных не подтверждают их наличие.`,
        catalogSize: catalog.length,
        catalog: conversationCatalog(catalog, query, context).map(({ sku, name, brand, poles, curve, amps, breakingCapacityKa, priceKzt, stock, certificates }) =>
          ({ sku, name, brand, poles, curve, amps, breakingCapacityKa, priceKzt, stock, certificates })),
        purchaseTerms: terms ?? null,
        currentProduct: context.lastSku ?? null,
        knownFilters: context.pendingFilters ?? null,
        history: context.history ?? [],
      });
      if (reply.kind === 'out_of_scope') {
        return remember(context, query, conversationalAnswer('Я помогаю с товарами и возможностями этого сайта: ассортиментом, характеристиками, наличием, ценами, корзиной, оплатой и доставкой. Какой вопрос по магазину вас интересует?'), false);
      }
      if (reply.kind === 'search') {
        if (Object.values(reply.filters).every((value) => value !== null)) {
          const result = answerQuery(catalog, query, terms, undefined, reply.filters);
          context.pendingFilters = null;
          if (result.exactMatch) context.lastSku = result.exactMatch.product.sku;
          return remember(context, query, result);
        }
        context.pendingFilters = reply.filters;
        const labels = { poles: 'число полюсов', curve: 'характеристику срабатывания (B, C или D)', amps: 'номинальный ток в амперах', breakingCapacityKa: 'отключающую способность в kA', quantity: 'количество штук' };
        const missing = Object.entries(reply.filters).filter(([, value]) => value === null).map(([name]) => labels[name]);
        return remember(context, query, conversationalAnswer(`Для подбора осталось уточнить: ${missing.join(', ')}. Напишите недостающие параметры, остальные я запомнил.`));
      }
      if (!reply.answer.trim()) throw new Error('Empty assistant answer');
      return remember(context, query, conversationalAnswer(reply.answer.trim()));
    } catch (error) {
      // Never log the key, user input, provider response body, or entire error object.
      const code = error.code === 'AI_CALL_LIMIT' ? 'AI_CALL_LIMIT' : 'AI_UNAVAILABLE';
      const reason = ['ZodError', 'SyntaxError', 'TimeoutError', 'TypeError'].includes(error.name) ? error.name : 'Invalid response';
      console.warn(`Assistant request failed: ${code} (${Number.isInteger(error.status) ? `HTTP ${error.status}` : reason}).`);
      const message = code === 'AI_CALL_LIMIT'
        ? 'Лимит AI-запросов для этого запуска исчерпан. Локальный поиск по артикулу и характеристикам продолжает работать.'
        : 'Не удалось получить ответ AI-помощника. Попробуйте ещё раз или воспользуйтесь локальным поиском по артикулу и характеристикам.';
      return remember(context, query, conversationalAnswer(`${message} ${clarification}`, { notice: code }));
    }
  }

  return remember(context, query, conversationalAnswer(`AI-диалог сейчас отключён. В доступном каталоге ${catalog.length} товаров. Могу проверить артикул, подобрать автомат по характеристикам и показать условия оплаты или доставки. ${clarification}`, { notice: 'AI_OFFLINE' }));
}
