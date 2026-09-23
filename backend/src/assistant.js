import { canFulfill, parsePartialQuery, parseQuantity, parseQuery, parseRestrictions, searchCatalog } from './search.js';
import { ApiError } from './errors.js';
import configuration from '../config.json' with { type: 'json' };
import { categoryCandidates, categoryClarification, categoryParameters, productKind, queryKind } from './product-kind.js';
import { assertNoPaymentData, redactPaymentData, sanitizeConversation } from './privacy.js';

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

function requestedQuantity(query, fallback = 1) {
  return parseQuantity(query) ?? fallback;
}

export function answerQuery(catalog, query, terms, context, filtersOverride) {
  assertNoPaymentData(query);
  const termsText = termsAnswer(query, terms);
  const mentioned = matchingProducts(catalog, query);
  const specified = parsePartialQuery(query);
  const explicitSku = [...query.matchAll(unknownSku)].some((match) => !mentioned.some((item) => item.sku.toUpperCase() === match[0].toUpperCase()));
  if (explicitSku) return { intent: 'product', quantity: 1, answer: 'Указанный артикул не найден в доступном каталоге.', filters: null, exactMatch: null, alternatives: [] };
  if (mentioned.length > 1) {
    return { intent: 'conversation', answer: mentioned.map((item) => `${item.sku}: ${productAnswer(item, 1)}`).join(' '), filters: null, exactMatch: null, alternatives: [] };
  }
  const specifiesProduct = Object.entries(specified).some(([key, value]) => key !== 'quantity' && value !== null) || newSelection.test(query);
  const explicitKind = queryKind(query);
  const asksAlternative = /аналог|замен|друг(?:ое|ой|ую|ие|ого)|похож|подбери|подберите/iu.test(query);
  const categoryFollowUp = Object.keys(categoryParameters(query, context?.lastCategory)).length > 0;
  const previous = context?.lastSku ? catalog.find((item) => item.sku === context.lastSku) : null;
  const sameKind = !explicitKind || !previous || explicitKind === productKind(previous);
  const identified = mentioned[0];
  const product = identified ?? (
    !specifiesProduct && !categoryFollowUp && sameKind && previous && (asksAlternative || /налич|сертификат|цен|характеристик|сколько|описани|шт\.?|штук/i.test(query))
      ? previous
      : null
  );
  if (product) {
    const quantity = requestedQuantity(query, product.sku === previous?.sku ? context?.lastQuantity ?? 1 : 1);
    const kind = productKind(product);
    const alreadyShown = context?.lastCategory === kind && (!identified || identified.sku === previous?.sku) ? context?.offeredSkus ?? [] : [];
    if (context) {
      context.lastSku = product.sku;
      context.lastCategory = kind;
      context.categoryParameters = null;
      context.lastQuantity = quantity;
    }
    const filters = !product.technicalIssue && kind === 'breaker' && product.poles && product.curve && product.amps && product.breakingCapacityKa
      ? { poles: product.poles, curve: product.curve, amps: product.amps, breakingCapacityKa: product.breakingCapacityKa, quantity }
      : null;
    const seekAlternatives = !canFulfill(product, quantity) || asksAlternative;
    const alternatives = !seekAlternatives ? [] : filters
      ? searchCatalog(catalog, filters, { targetSku: product.sku, includeAlternatives: asksAlternative, excludedSkus: asksAlternative ? alreadyShown : [] }).alternatives
      : ['lamp', 'luminaire', 'cable'].includes(kind)
        ? categoryCandidates(catalog, kind, query, quantity, product, {}, asksAlternative ? alreadyShown : []).alternatives
        : [];
    if (context) context.offeredSkus = [...new Set([...(asksAlternative ? alreadyShown : []), ...alternatives.map((item) => item.product.sku)])].slice(-100);
    const extra = alternatives.length
      ? ' Есть кандидаты по данным каталога; проверьте указанные параметры и совместимость перед покупкой.'
      : seekAlternatives && !filters ? ` ${categoryClarification(kind)}` : '';
    return {
      intent: 'product',
      quantity,
      answer: `${productAnswer(product, quantity)}${extra}${termsText ? ` ${termsText}` : ''}`,
      ...(termsText && { sourceUrl: terms.sourceUrl }),
      filters,
      exactMatch: { product, canFulfill: canFulfill(product, quantity) },
      alternatives,
    };
  }

  if (termsText && !specifiesProduct) {
    return { intent: 'purchase_terms', answer: termsText, sourceUrl: terms.sourceUrl, filters: null, exactMatch: null, alternatives: [] };
  }

  const category = explicitKind ?? ((asksAlternative || categoryFollowUp || /\d+\s*(?:шт|штук)/iu.test(query)) ? context?.lastCategory : null);
  if (['lamp', 'luminaire', 'cable'].includes(category)) {
    const quantity = requestedQuantity(query, context?.lastCategory === category ? context.lastQuantity ?? 1 : 1);
    const knownParameters = context?.lastCategory === category ? context.categoryParameters ?? {} : {};
    const target = asksAlternative && categoryFollowUp && previous && productKind(previous) === category ? previous : undefined;
    const alreadyShown = context?.lastCategory === category && asksAlternative ? context.offeredSkus ?? [] : [];
    const { alternatives, hasParameters, parameters } = categoryCandidates(catalog, category, query, quantity, target, knownParameters, alreadyShown);
    if (context) {
      context.lastCategory = category;
      context.lastSku = alternatives.length === 1 ? alternatives[0].product.sku : null;
      context.categoryParameters = parameters;
      context.lastQuantity = quantity;
      context.offeredSkus = [...new Set([...alreadyShown, ...alternatives.map((item) => item.product.sku)])].slice(-100);
    }
    const answer = alternatives.length
      ? `Найдены кандидаты ${hasParameters ? 'по указанным параметрам' : 'в этой категории'} из доступного каталога. Требуется проверка совместимости перед покупкой.`
      : 'В доступном каталоге не найдены позиции с подтверждёнными указанными параметрами и нужным остатком.';
    return { intent: 'specifications', quantity, answer: `${answer} ${categoryClarification(category)}`, filters: null, exactMatch: null, alternatives };
  }

  const filters = filtersOverride ? { ...filtersOverride, ...parseRestrictions(query, catalog) } : { ...parseQuery(query), ...parseRestrictions(query, catalog) };
  const result = searchCatalog(catalog, filters);
  if (context) {
    context.lastCategory = 'breaker';
    context.categoryParameters = null;
    context.lastQuantity = filters.quantity;
    context.offeredSkus = result.alternatives.map((item) => item.product.sku);
    context.lastSku = result.exactMatch?.product.sku ?? null;
  }
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
  assertNoPaymentData(query);
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
  result = { ...result, answer: redactPaymentData(result.answer) };
  if (retainHistory) {
    context.history = redactPaymentData([...(context.history ?? []),
      { role: 'user', content: redactPaymentData(query) },
      { role: 'assistant', content: result.answer },
    ].slice(-8));
  }
  context.lastConversation = result.notice ? null : { query: redactPaymentData(query.trim()), result };
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

async function processConversation(catalog, query, terms, context, queryParser, catalogStatus) {
  if (query.length > 4000) throw new ApiError(400, 'QUERY_TOO_LONG', 'Сократите сообщение до 4000 символов.');
  assertNoPaymentData(query);
  sanitizeConversation(context);
  if (newSelection.test(query)) {
    context.pendingFilters = null;
    context.lastSku = null;
    context.lastQuantity = null;
    context.lastCategory = null;
    context.categoryParameters = null;
    context.offeredSkus = [];
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
  const anotherSelection = /аналог|замен|друг(?:ое|ой|ую|ие|ого)|похож/iu.test(query);
  if (context.lastConversation?.query === query.trim() && !anotherSelection) return context.lastConversation.result;
  let clarification;
  const unavailable = catalogStatus === 'loading' || catalogStatus === 'failed';
  if (unavailable) {
    const local = answerWithoutCatalog(query, terms, catalogStatus === 'loading');
    if (local.intent === 'purchase_terms') return remember(context, query, local);
    clarification = local.answer;
  } else try {
    // A pending selection must not be interpreted as a question about the previous SKU.
    const explicitKind = queryKind(query);
    const localContext = context.pendingFilters && (!explicitKind || explicitKind === 'breaker') ? undefined : context;
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

  const previousProduct = catalog.find((product) => product.sku === context.lastSku);
  const suppliedRatings = Object.entries(parsePartialQuery(query)).some(([key, value]) => key !== 'quantity' && value !== null);
  const kind = queryKind(query) ?? (context.pendingFilters || suppliedRatings ? 'breaker' : productKind(previousProduct ?? { name: '' }) ?? context.lastCategory);
  if (kind !== 'breaker') clarification = categoryClarification(kind);

  if (queryParser) {
    try {
      const reply = await queryParser.reply(query, {
        site: `EKT Match — помощник магазина электротехники. ${catalog.length && catalog.every((product) => product.id) ? 'Данные товаров загружены из API ekt.kz при запуске сервера.' : 'Используется локальный каталог.'} Можно искать товары и добавлять их в локальную корзину после кнопки подтверждения. Реальных заказов, оплаты, личного кабинета и резервирования склада в прототипе нет. Цены в тенге. Передан только фрагмент каталога: отсутствие товара в этом фрагменте не означает его отсутствие в магазине. Категории витрины без товаров в переданных данных не подтверждают их наличие.`,
        catalogSize: catalog.length,
        catalogStatus: catalogStatus ?? 'ready',
        catalog: conversationCatalog(catalog, query, context).map(({ sku, name, brand, poles, curve, amps, breakingCapacityKa, priceKzt, stock, certificates }) =>
          ({ sku, name, brand, poles, curve, amps, breakingCapacityKa, priceKzt, stock, certificates })),
        purchaseTerms: terms ?? null,
        currentProduct: context.lastSku ?? null,
        cart: context.cart ?? null,
        knownFilters: context.pendingFilters ?? null,
        productCategory: kind ?? null,
        history: context.history ?? [],
      });
      if (reply.kind === 'out_of_scope') {
        return remember(context, query, conversationalAnswer('Я помогаю с товарами и возможностями этого сайта: ассортиментом, характеристиками, наличием, ценами, корзиной, оплатой и доставкой. Какой вопрос по магазину вас интересует?'), false);
      }
      if (reply.kind === 'search') {
        if (unavailable) return remember(context, query, answerWithoutCatalog(query, terms, catalogStatus === 'loading'));
        if (kind !== 'breaker') {
          context.pendingFilters = null;
          return remember(context, query, conversationalAnswer(categoryClarification(kind)));
        }
        context.lastCategory = 'breaker';
        context.categoryParameters = null;
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
      if (unavailable && !['cart', 'purchase_terms', 'technical', 'selection_guidance', 'account', 'capabilities'].includes(reply.topic)) {
        return remember(context, query, answerWithoutCatalog(query, terms, catalogStatus === 'loading'));
      }
      if (unavailable && reply.topic === 'capabilities') {
        return remember(context, query, conversationalAnswer('Здравствуйте! Я помощник EKT. Могу объяснить характеристики товаров и условия оплаты или доставки. Проверка цен и наличия станет доступна после восстановления каталога.'));
      }
      return remember(context, query, conversationalAnswer(safeModelAnswer(catalog, query, terms, context, reply)));
    } catch (error) {
      // Never log the key, user input, provider response body, or entire error object.
      const code = ['AI_CALL_LIMIT', 'AI_RATE_LIMIT'].includes(error.code) ? error.code : 'AI_UNAVAILABLE';
      const reason = ['ZodError', 'SyntaxError', 'TimeoutError', 'TypeError'].includes(error.name) ? error.name : 'Invalid response';
      console.warn(`Assistant request failed: ${code} (${Number.isInteger(error.status) ? `HTTP ${error.status}` : reason}).`);
      const message = code === 'AI_CALL_LIMIT' || code === 'AI_RATE_LIMIT'
        ? `Слишком много AI-запросов. Повторите${Number.isFinite(error.retryAfterSeconds) ? ` через ${Math.max(1, Math.ceil(error.retryAfterSeconds))} сек.` : ' позже.'} Поиск по артикулу и характеристикам продолжает работать.`
        : 'Не удалось получить ответ AI-помощника. Попробуйте ещё раз или воспользуйтесь локальным поиском по артикулу и характеристикам.';
      return remember(context, query, conversationalAnswer(`${message} ${clarification}`, { notice: code }));
    }
  }

  if (unavailable) return remember(context, query, answerWithoutCatalog(query, terms, catalogStatus === 'loading'));
  const modeMessage = catalog.length && catalog.every((product) => product.id)
    ? 'AI-диалог сейчас отключён.'
    : 'Сейчас включён локальный режим.';
  return remember(context, query, conversationalAnswer(`${modeMessage} В доступном каталоге ${catalog.length} товаров. Могу проверить артикул, подобрать автомат по характеристикам и показать условия оплаты или доставки. ${clarification}`, { notice: 'AI_OFFLINE' }));
}

export function answerConversation(catalog, query, terms, context = {}, queryParser, catalogStatus) {
  // A duplicate request shares its pending work. Other replies update the session
  // only when they are still its newest request.
  const state = inFlight.get(context) ?? { sequence: 0, requests: new Map() };
  inFlight.set(context, state);
  const key = JSON.stringify([query.trim(), context.cart ?? null, catalogStatus ?? 'ready']);
  if (state.requests.has(key)) return state.requests.get(key);
  const sequence = ++state.sequence;
  const working = { ...context, history: context.history ? [...context.history] : undefined };
  const promise = processConversation(catalog, query, terms, working, queryParser, catalogStatus).then((result) => {
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
