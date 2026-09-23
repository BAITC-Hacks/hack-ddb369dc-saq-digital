import { canFulfill, parsePartialQuery, parseQuantity, parseQuery, parseRestrictions, searchCatalog } from './search.js';
import { ApiError } from './errors.js';
import configuration from '../config.json' with { type: 'json' };

function matchingProducts(catalog, query) {
  const normalized = query.toLocaleLowerCase('ru');
  return catalog.filter((product) => [product.sku, product.article].some((identifier) => {
    if (!identifier) return false;
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(normalized);
  }));
}

function productAnswer(product, quantity) {
  const stock = product.stock < quantity
    ? `На складе ${product.stock} шт., запрошено ${quantity} шт.`
    : quantity % (product.minimumOrderQuantity ?? 1) !== 0
      ? `В наличии ${product.stock} шт., но заказ должен быть кратен ${product.minimumOrderQuantity} шт.`
      : `В наличии ${product.stock} шт.`;
  const certificate = product.certificates?.length
    ? `Сертификаты: ${product.certificates.map((item) => `${item.name}: ${item.url}`).join('; ')}.`
    : 'Сертификат в доступных данных не указан.';
  return `${product.name}. Артикул ${product.article ?? product.sku}. Цена ${product.priceKzt} ₸. ${stock} ${certificate}${product.technicalIssue ? ` ${product.technicalIssue}` : ''}`;
}

const newSelection = /(?:нов(?:ый|ая|ое)\s+подбор|с\s+нуля|заново|вместо\s+(?:этого|предыдущего)|друг(?:ой|ую|ое)\s+автомат|new\s+selection|from\s+scratch|жаңа\s+таңдау|басынан)/iu;
const technicalQuestion = /(?:чем\s+отлича\w*|разниц\w*|что\s+знач\w*|объясн\w*|как\s+работа\w*|difference\s+between)[^.!?]*(?:характеристик\w*|крив\w*|\b[BCD]\b)/iu;
const cartQuestion = /корзин\w*|себет\w*|\bcart\b/iu;
const dangerousSelection = /(?:выбер\p{L}*|подбер\p{L}*|посовет\p{L}*|рекоменду\p{L}*|какой|какую|which|choose|recommend|pick|select|таңда\p{L}*|ұсын\p{L}*)[^.!?]*(?:автомат|выключател|breaker|квартир|дом|щит|apartment|пәтер)|(?:автомат|breaker|пәтер)[^.!?]*(?:выбер\p{L}*|подбер\p{L}*|посовет\p{L}*|recommend|choose|pick|таңда\p{L}*|ұсын\p{L}*)/iu;
const unknownSku = /\b(?:DEMO-MCB-\d+|[\p{L}\p{N}]+-[\p{L}\p{N}]+-\d+)\b/giu;

function language(query) {
  if (/[әіңғүұқөһ]/iu.test(query)) return 'kk';
  if (/[а-яё]/iu.test(query)) return 'ru';
  if (/\b(?:what|which|how|do|does|can|is|are|have|show|tell|products|cart)\b/iu.test(query)) return 'en';
  return 'ru';
}

const phrases = {
  ru: {
    overview: 'В доступном каталоге есть автоматические выключатели. Могу показать товары, наличие и цены, помочь с подбором и условиями покупки.',
    missing: 'Для этого вопроса в доступных данных нет подтверждённого ответа. Уточните артикул или технические параметры.',
    noCart: 'Я не вижу содержимое вашей корзины без сессии. Откройте корзину на этом сайте.',
    emptyCart: 'В вашей корзине пока нет товаров.',
    cart: (items, total) => `В корзине: ${items.map((item) => `${item.sku} — ${item.quantity} шт., ${item.lineTotalKzt} ₸`).join('; ')}. Итого ${total} ₸.`,
    guidance: 'Без данных об электроустановке нельзя надёжно выбрать параметры защиты. Укажите параметры проекта или уточните выбор у квалифицированного специалиста.',
    technical: 'У миниатюрных автоматов характеристика B соответствует магнитному срабатыванию при токе примерно 3–5 номиналов, C — 5–10 номиналов. Это не диапазоны тепловой защиты при перегрузке. Выбор зависит от параметров цепи и документации производителя.',
    account: 'В этой демоверсии личный кабинет и регистрация недоступны. Могу помочь с каталогом и локальной корзиной.',
    noCartAction: 'Я не могу добавить товар в корзину сообщением. Выберите карточку товара и подтвердите действие кнопкой.',
  },
  kk: {
    overview: 'Қолжетімді каталогта автоматты ажыратқыштар бар. Тауарларды, қалдық пен бағаны көрсетіп, таңдауға және сатып алу шарттарына көмектесе аламын.',
    missing: 'Бұл сұраққа қатысты расталған дерек жоқ. Артикулды немесе техникалық сипаттамаларды нақтылаңыз.',
    noCart: 'Сессиясыз себетіңізді көре алмаймын. Осы сайттағы себетті ашыңыз.',
    emptyCart: 'Себетіңізде әзірге тауар жоқ.',
    cart: (items, total) => `Себетте: ${items.map((item) => `${item.sku} — ${item.quantity} дана, ${item.lineTotalKzt} ₸`).join('; ')}. Барлығы ${total} ₸.`,
    guidance: 'Электр қондырғысы туралы дерексіз қорғаныс параметрлерін сенімді таңдау мүмкін емес. Жоба деректерін беріңіз немесе білікті маманмен кеңесіңіз.',
    technical: 'Шағын автоматты ажыратқыштарда B сипаттамасының магниттік іске қосылу аралығы шамамен 3–5, C үшін 5–10 еселік номиналды токқа тең. Бұл жылулық артық жүктеме аралықтары емес. Таңдау тізбек деректеріне және өндіруші құжаттарына байланысты.',
    account: 'Бұл демода жеке кабинет пен тіркелу жоқ. Каталог пен жергілікті себет бойынша көмектесе аламын.',
    noCartAction: 'Хабарлама арқылы тауарды себетке қоса алмаймын. Тауарды таңдап, әрекетті түймемен растаңыз.',
  },
  en: {
    overview: 'The available catalog contains miniature circuit breakers. I can show products, stock and prices, help with selection, and explain purchase terms.',
    missing: 'The available site data does not confirm an answer to that question. Please provide a product code or technical specifications.',
    noCart: 'I cannot see your cart without a session. Open the cart on this site.',
    emptyCart: 'Your cart is empty.',
    cart: (items, total) => `Your cart contains ${items.map((item) => `${item.sku}: ${item.quantity} units, ${item.lineTotalKzt} ₸`).join('; ')}. Total: ${total} ₸.`,
    guidance: 'Protection ratings cannot be chosen reliably without installation details. Provide the project specifications or consult a qualified specialist.',
    technical: 'For miniature circuit breakers, type B describes magnetic tripping at about 3–5 times rated current, and type C at 5–10 times. These are not the thermal overload ranges. Selection depends on the circuit and manufacturer documentation.',
    account: 'Account registration is unavailable in this demo. I can help with the catalog and local cart.',
    noCartAction: 'I cannot add an item to your cart from a message. Choose a product card and confirm with the button.',
  },
};

function cartAnswer(query, context) {
  const text = phrases[language(query)];
  if (/добав|полож|add\b|қос/iu.test(query)) return text.noCartAction;
  if (!context.cart) return text.noCart;
  if (!context.cart.items.length) return text.emptyCart;
  return text.cart(context.cart.items, context.cart.totalPriceKzt);
}

function safeModelAnswer(catalog, query, terms, context, reply) {
  const text = phrases[language(query)];
  const topic = reply.topic ?? (/каталог|товар|ассортимент|product/iu.test(query) ? 'overview' : 'capabilities');
  if (cartQuestion.test(query) || topic === 'cart') return cartAnswer(query, context);
  if (dangerousSelection.test(query) || topic === 'selection_guidance') return text.guidance;
  if (/личн\w*\s+кабинет|регистр|account|тіркел/iu.test(query) || topic === 'account') return text.account;
  if (technicalQuestion.test(query) || topic === 'technical') return reply.technicalTopic === 'trip_curves' || /характеристик\w*\s*[BCDВСД]\b|\b[BCD]\s*(?:и|and|мен)\s*[BCD]/iu.test(query) ? text.technical : text.missing;
  if (topic === 'purchase_terms') {
    const parts = (reply.termSections?.length ? reply.termSections : ['payment', 'delivery', 'minimumOrder']).map((key) => terms?.[key]).filter(Boolean);
    return parts.length ? parts.join(' ') : text.missing;
  }
  if (topic === 'products' || topic === 'comparison') {
    const products = (reply.productSkus ?? []).map((sku) => catalog.find((item) => item.sku === sku)).filter(Boolean);
    return products.length ? products.map((item) => productAnswer(item, 1)).join(' ') : text.missing;
  }
  if (topic === 'unavailable') return text.missing;
  return text.overview;
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
  const mentioned = matchingProducts(catalog, query);
  const specified = parsePartialQuery(query);
  const explicitSku = [...query.matchAll(unknownSku)].some((match) => !mentioned.some((item) => item.sku.toUpperCase() === match[0].toUpperCase()));
  if (explicitSku) return { intent: 'product', quantity: 1, answer: 'Указанный артикул не найден в доступном каталоге.', filters: null, exactMatch: null, alternatives: [] };
  if (mentioned.length > 1) {
    return { intent: 'conversation', answer: mentioned.map((item) => `${item.sku}: ${productAnswer(item, 1)}`).join(' '), filters: null, exactMatch: null, alternatives: [] };
  }
  const specifiesProduct = Object.entries(specified).some(([key, value]) => key !== 'quantity' && value !== null) || newSelection.test(query);
  const product = mentioned[0] ?? (
    !specifiesProduct && context?.lastSku && /налич|сертификат|цен|сколько\s+стоит|описани|шт\.?|штук/i.test(query)
      ? catalog.find((item) => item.sku === context.lastSku)
      : null
  );
  if (product) {
    const explicitQuantity = parseQuantity(query);
    const quantity = explicitQuantity ?? (mentioned.length ? 1 : context?.lastQuantity ?? 1);
    if (context) { context.lastSku = product.sku; context.lastQuantity = quantity; }
    const filters = product.poles && product.curve && product.amps && product.breakingCapacityKa
      ? { poles: product.poles, curve: product.curve, amps: product.amps, breakingCapacityKa: product.breakingCapacityKa, quantity }
      : null;
    const alternatives = filters && !canFulfill(product, quantity) ? searchCatalog(catalog, filters).alternatives : [];
    return {
      intent: 'product',
      quantity,
      answer: `${productAnswer(product, quantity)}${alternatives.length ? ' Есть варианты по указанным техническим параметрам.' : ''}${termsText ? ` ${termsText}` : ''}`,
      ...(termsText && { sourceUrl: terms.sourceUrl }),
      filters,
      exactMatch: { product, canFulfill: canFulfill(product, quantity) },
      alternatives,
    };
  }

  if (termsText && !specifiesProduct) {
    return { intent: 'purchase_terms', answer: termsText, sourceUrl: terms.sourceUrl, filters: null, exactMatch: null, alternatives: [] };
  }

  const filters = filtersOverride ? { ...filtersOverride, ...parseRestrictions(query, catalog) } : { ...parseQuery(query), ...parseRestrictions(query, catalog) };
  const result = searchCatalog(catalog, filters);
  if (context) { context.lastSku = result.exactMatch?.product.sku ?? null; context.lastQuantity = filters.quantity; }
  const answer = result.exactMatch?.canFulfill
    ? 'Точный товар найден и есть в нужном количестве.'
    : result.alternatives.length
      ? 'Точного товара в нужном количестве нет. Найдены варианты по указанным техническим параметрам.'
      : 'По заданным характеристикам товар в нужном количестве не найден.';
  return { intent: 'specifications', answer: `${answer}${termsText ? ` ${termsText}` : ''}`, ...(termsText && { sourceUrl: terms.sourceUrl }), ...result };
}

function conversationalAnswer(answer, extra = {}) {
  return { intent: 'conversation', answer, filters: null, exactMatch: null, alternatives: [], ...extra };
}

export function answerWithoutCatalog(query, terms, loading) {
  if (query.length > 4000) throw new ApiError(400, 'QUERY_TOO_LONG', 'Сократите сообщение до 4000 символов.');
  const termsText = termsAnswer(query, terms);
  if (termsText) {
    return { intent: 'purchase_terms', answer: termsText, sourceUrl: terms.sourceUrl, filters: null, exactMatch: null, alternatives: [] };
  }
  const greeting = /^(?:здравствуй(?:те)?|привет|добрый\s+(?:день|вечер)|доброе\s+утро)[!.,\s]*$/iu.test(query.trim())
    ? 'Здравствуйте! Я помощник EKT. '
    : '';
  const status = loading
    ? 'Каталог ekt.kz загружается в первый раз. Поиск товаров, цены и остатки станут доступны после загрузки.'
    : 'Каталог ekt.kz сейчас недоступен. Пока не могу проверить товары, цены и остатки.';
  return conversationalAnswer(`${greeting}${status} Уже могу рассказать об оплате, доставке и условиях покупки.`, {
    notice: loading ? 'CATALOG_LOADING' : 'CATALOG_UNAVAILABLE',
  });
}

function groundedFilters(query, replyFilters, knownFilters) {
  const explicit = parsePartialQuery(query);
  if (knownFilters && explicit.quantity === null && Object.values(knownFilters).filter((value) => value === null).length === 1 && knownFilters.quantity === null) {
    explicit.quantity = parseQuantity(query, { allowBare: true });
  }
  return Object.fromEntries(Object.keys(explicit).map((key) => [key,
    replyFilters?.[key] !== null && replyFilters?.[key] !== undefined &&
    (replyFilters[key] === explicit[key] || (explicit[key] === null && replyFilters[key] === knownFilters?.[key]))
      ? replyFilters[key] : explicit[key] ?? (explicit[key] === null ? knownFilters?.[key] ?? null : null),
  ]));
}

const inFlight = new WeakMap();

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

async function processConversation(catalog, query, terms, context, queryParser) {
  if (query.length > 4000) throw new ApiError(400, 'QUERY_TOO_LONG', 'Сократите сообщение до 4000 символов.');
  if (newSelection.test(query)) {
    context.pendingFilters = null;
    context.lastSku = null;
    context.lastQuantity = null;
    context.history = [];
    context.lastConversation = null;
  }
  if (cartQuestion.test(query)) return remember(context, query, conversationalAnswer(cartAnswer(query, context)));
  if (dangerousSelection.test(query) && Object.values(parsePartialQuery(query)).every((value) => value === null)) {
    return remember(context, query, conversationalAnswer(phrases[language(query)].guidance));
  }
  if (technicalQuestion.test(query) && /\b[BВ]\b[^.!?]*\b[CС]\b|\b[CС]\b[^.!?]*\b[BВ]\b/iu.test(query)) {
    return remember(context, query, conversationalAnswer(phrases[language(query)].technical, { sourceUrl: configuration.assistantReference?.tripCurvesUrl }));
  }
  if (/личн\w*\s+кабинет|регистр|account|тіркел/iu.test(query)) return remember(context, query, conversationalAnswer(phrases[language(query)].account));
  if (context.lastConversation?.query === query.trim()) return context.lastConversation.result;
  let clarification;
  try {
    // A pending selection must not be interpreted as a question about the previous SKU.
    const localContext = context.pendingFilters ? undefined : context;
    const result = answerQuery(catalog, query, terms, localContext);
    if (result.intent !== 'purchase_terms') {
      context.pendingFilters = null;
      if (result.exactMatch) context.lastSku = result.exactMatch.product.sku;
      else if (result.intent === 'product') context.lastSku = null;
    }
    return remember(context, query, result);
  } catch (error) {
    if (error.code === 'INVALID_QUANTITY' && /\b[1-4]\s*[pрф]\b/iu.test(query) && /(?:kA|кА)/iu.test(query)) {
      throw new ApiError(422, 'INVALID_SPECIFICATIONS', error.message);
    }
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
        cart: context.cart ?? null,
        knownFilters: context.pendingFilters ?? null,
        history: context.history ?? [],
      });
      if (reply.kind === 'out_of_scope') {
        return remember(context, query, conversationalAnswer('Я помогаю с товарами и возможностями этого сайта: ассортиментом, характеристиками, наличием, ценами, корзиной, оплатой и доставкой. Какой вопрос по магазину вас интересует?'), false);
      }
      if (reply.kind === 'search') {
        const filters = groundedFilters(query, reply.filters, context.pendingFilters);
        if (Object.values(filters).every((value) => value !== null)) {
          const result = answerQuery(catalog, query, terms, undefined, filters);
          context.pendingFilters = null;
          context.lastSku = result.exactMatch?.product.sku ?? null;
          context.lastQuantity = filters.quantity;
          return remember(context, query, result);
        }
        context.pendingFilters = filters;
        const labels = { poles: 'число полюсов', curve: 'характеристику срабатывания (B, C или D)', amps: 'номинальный ток в амперах', breakingCapacityKa: 'отключающую способность в kA', quantity: 'количество штук' };
        const missing = Object.entries(filters).filter(([, value]) => value === null).map(([name]) => labels[name]);
        return remember(context, query, conversationalAnswer(`Для подбора осталось уточнить: ${missing.join(', ')}. Напишите недостающие параметры, остальные я запомнил.`));
      }
      if (!reply.answer?.trim()) throw new Error('Empty assistant answer');
      return remember(context, query, conversationalAnswer(safeModelAnswer(catalog, query, terms, context, reply)));
    } catch (error) {
      // Never log the key, user input, provider response body, or entire error object.
      const code = ['AI_CALL_LIMIT', 'AI_RATE_LIMIT'].includes(error.code) ? error.code : 'AI_UNAVAILABLE';
      const reason = ['ZodError', 'SyntaxError', 'TimeoutError', 'TypeError'].includes(error.name) ? error.name : 'Invalid response';
      console.warn(`Assistant request failed: ${code} (${Number.isInteger(error.status) ? `HTTP ${error.status}` : reason}).`);
      const message = code === 'AI_CALL_LIMIT' || code === 'AI_RATE_LIMIT'
        ? 'Лимит AI-запросов временно исчерпан. Попробуйте позже. Локальный поиск по артикулу и характеристикам продолжает работать.'
        : 'Не удалось получить ответ AI-помощника. Попробуйте ещё раз или воспользуйтесь локальным поиском по артикулу и характеристикам.';
      return remember(context, query, conversationalAnswer(`${message} ${clarification}`, { notice: code }));
    }
  }

  const modeMessage = catalog.length && catalog.every((product) => product.id)
    ? 'AI-диалог сейчас отключён.'
    : 'Сейчас включён локальный режим.';
  return remember(context, query, conversationalAnswer(`${modeMessage} В доступном каталоге ${catalog.length} товаров. Могу проверить артикул, подобрать автомат по характеристикам и показать условия оплаты или доставки. ${clarification}`, { notice: 'AI_OFFLINE' }));
}

export function answerConversation(catalog, query, terms, context = {}, queryParser) {
  // A duplicate request shares its pending work. Other replies update the session
  // only when they are still its newest request.
  const state = inFlight.get(context) ?? { sequence: 0, requests: new Map() };
  inFlight.set(context, state);
  const key = JSON.stringify([query.trim(), context.cart ?? null]);
  if (state.requests.has(key)) return state.requests.get(key);
  const sequence = ++state.sequence;
  const working = { ...context, history: context.history ? [...context.history] : undefined };
  const promise = processConversation(catalog, query, terms, working, queryParser).then((result) => {
    if (sequence === state.sequence) {
      const latestCart = context.cart;
      Object.assign(context, working);
      context.cart = latestCart;
    }
    return result;
  }).finally(() => { if (state.requests.get(key) === promise) state.requests.delete(key); });
  state.requests.set(key, promise);
  return promise;
}
