import assert from 'node:assert/strict';
import test from 'node:test';
import { answerConversation, answerQuery } from '../src/assistant.js';
import { catalog } from './fixtures.js';

const terms = { sourceUrl: 'https://example.org/terms', payment: 'Оплата картой.', delivery: 'Доставка по условиям.', minimumOrder: 'Минимальная партия не указана.' };

test('answers article inquiry with stock, specifications, and certificate', () => {
  const result = answerQuery(catalog, 'Есть артикул SKU-EXACT, 8 штук?', terms);
  assert.equal(result.intent, 'product');
  assert.equal(result.exactMatch.canFulfill, false);
  assert.deepEqual(result.alternatives.map(({ product }) => product.sku), ['ALT-15', 'ALT-20']);
  assert.match(result.answer, /https:\/\/example.org\/certificate.pdf/);
  assert.equal(result.exactMatch.product.amps, 16);
});

test('answers payment, delivery and minimum batch from sourced terms', () => {
  const result = answerQuery(catalog, 'Какая оплата, доставка и минимальная партия?', terms);
  assert.equal(result.intent, 'purchase_terms');
  assert.match(result.answer, /Оплата картой/);
  assert.match(result.answer, /Доставка по условиям/);
  assert.match(result.answer, /Минимальная партия не указана/);
  assert.equal(result.sourceUrl, terms.sourceUrl);
});

test('article inquiry rejects a zero quantity', () => {
  assert.throws(() => answerQuery(catalog, 'Артикул SKU-EXACT, 0 штук', terms), { code: 'INVALID_QUANTITY' });
});

test('combines a product answer with requested delivery information', () => {
  const result = answerQuery(catalog, 'Артикул SKU-EXACT: наличие и доставка?', terms);
  assert.equal(result.intent, 'product');
  assert.match(result.answer, /В наличии 2 шт/);
  assert.match(result.answer, /Доставка по условиям/);
  assert.equal(result.sourceUrl, terms.sourceUrl);
});

test('new specifications replace remembered product while incomplete specifications ask for details', () => {
  const context = { lastSku: 'EXACT' };
  const result = answerQuery(catalog, '1P B10, 6 kA, 4 штуки', terms, context);
  assert.equal(result.intent, 'specifications');
  assert.equal(result.filters.poles, 1);
  assert.equal(result.exactMatch, null);
  assert.throws(() => answerQuery(catalog, '1P B10, 4 штуки', terms, context), { code: 'MISSING_SPECIFICATIONS' });
});

test('product inquiries preserve requested quantity when technical ratings are unknown', () => {
  const products = [{ sku: 'PARTNER-ITEM', name: 'Товар', priceKzt: 500, stock: 10 }];
  const result = answerQuery(products, 'PARTNER-ITEM, 3 штуки', terms);
  assert.equal(result.filters, null);
  assert.equal(result.quantity, 3);
  assert.equal(result.exactMatch.canFulfill, true);
});

const noFilters = { poles: null, curve: null, amps: null, breakingCapacityKa: null, quantity: null };

test('large partner catalogs use bounded relevant AI context and identify their real source', async () => {
  const products = Array.from({ length: 500 }, (_, i) => ({ ...catalog[0], id: i + 1, sku: `ITEM-${i}`, article: `ITEM-${i}`, name: `Товар ${i}` }));
  products[499].name = 'Прожектор уличный';
  await answerConversation(products, 'Какие прожекторы есть?', terms, { lastSku: 'ITEM-498' }, {
    reply: async (_query, facts) => {
      assert.equal(facts.catalogSize, 500);
      assert.equal(facts.catalog.length, 20);
      assert.equal(facts.catalog[0].sku, 'ITEM-498');
      assert.match(facts.site, /API ekt.kz/);
      assert.doesNotMatch(facts.site, /каталог синтетический/);
      return { kind: 'answer', answer: 'Уточните артикул.', filters: noFilters };
    },
  });
  await answerConversation(products, 'Нужен прожектор', terms, {}, {
    reply: async (_query, facts) => {
      assert.equal(facts.catalog[0].sku, 'ITEM-499');
      return { kind: 'answer', answer: 'Есть прожектор.', filters: noFilters };
    },
  });
  const withoutAi = await answerConversation(products, 'что есть', terms);
  assert.match(withoutAi.answer, /AI-диалог сейчас отключён/);
  assert.doesNotMatch(withoutAi.answer, /локальный режим|позиций автоматических выключателей/);
});

test('free-form catalogue questions use site context instead of demanding specifications', async () => {
  const context = {};
  let calls = 0;
  const parser = { reply: async (query, facts) => {
    calls += 1;
    assert.equal(query, 'что по товарам есть');
    assert.equal(facts.catalog[0].sku, catalog[0].sku);
    assert.equal(facts.catalog[0].priceKzt, catalog[0].priceKzt);
    assert.deepEqual(facts.purchaseTerms, terms);
    assert.deepEqual(facts.history, []);
    return { kind: 'answer', answer: 'В каталоге есть автоматические выключатели. Какие вас интересуют?', filters: noFilters };
  } };
  const result = await answerConversation(catalog, 'что по товарам есть', terms, context, parser);
  assert.equal(result.intent, 'conversation');
  assert.match(result.answer, /выключатели/);
  assert.deepEqual(result.alternatives, []);
  assert.equal(context.history.length, 2);
  assert.equal(context.history[0].content, 'что по товарам есть');
  assert.deepEqual(await answerConversation(catalog, 'что по товарам есть', terms, context, parser), result);
  assert.equal(context.history.length, 2, 'Retry must not duplicate conversation state');
  assert.equal(calls, 1);
});

test('partial parameters persist across turns and completed searches use real catalogue data', async () => {
  const context = { lastSku: 'EXACT' };
  let calls = 0;
  const parser = { reply: async (_query, facts) => {
    calls += 1;
    if (calls === 1) return { kind: 'search', answer: 'Сколько штук нужно?', filters: { poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10, quantity: null } };
    assert.equal(facts.knownFilters.amps, 16);
    assert.equal(facts.history.length, 2);
    return { kind: 'search', answer: 'Выдуманная цена 1 тенге.', filters: { ...facts.knownFilters, quantity: 8 } };
  } };
  const clarification = await answerConversation(catalog, '3P C16, 10 kA', terms, context, parser);
  assert.equal(clarification.intent, 'conversation');
  assert.match(clarification.answer, /количество штук/);
  assert.doesNotMatch(clarification.answer, /число полюсов/);
  const result = await answerConversation(catalog, '8 штук', terms, context, parser);
  assert.equal(result.intent, 'specifications');
  assert.equal(result.alternatives[0].product.sku, 'ALT-15');
  assert.doesNotMatch(result.answer, /Выдуманная/);
  assert.equal(context.pendingFilters, null);
  assert.equal(context.lastSku, 'EXACT');
  assert.equal(context.history.length, 4);
});

test('off-topic responses are replaced by a site-only redirect', async () => {
  const context = {};
  const result = await answerConversation(catalog, 'расскажи про футбол', terms, context, {
    reply: async () => ({ kind: 'out_of_scope', answer: 'Unrelated model text', filters: noFilters }),
  });
  assert.match(result.answer, /вопрос по магазину/);
  assert.doesNotMatch(result.answer, /Unrelated/);
  assert.equal(result.exactMatch, null);
  assert.equal(context.history, undefined, 'Off-topic input must not contaminate later model context');
});

test('offline, empty AI answers and provider failures give visible fallback messages', async () => {
  const offline = await answerConversation(catalog, 'что есть', terms);
  assert.equal(offline.notice, 'AI_OFFLINE');
  for (const failure of [new Error('Provider failed'), Object.assign(new Error('limit'), { code: 'AI_CALL_LIMIT' }), null]) {
    const context = { pendingFilters: { ...noFilters, poles: 3 } };
    const result = await answerConversation(catalog, 'восемь', terms, context, { reply: async () => {
      if (failure) throw failure;
      return { kind: 'answer', answer: '  ', filters: noFilters };
    } });
    assert.equal(result.intent, 'conversation');
    assert.ok(result.notice);
    assert.equal(context.pendingFilters.poles, 3);
    assert.equal(context.lastConversation, null, 'Failures must allow another attempt');
  }
});

test('conversation retains only recent history and local searches do not need AI', async () => {
  const context = {};
  for (let quantity = 1; quantity < 8; quantity += 1) {
    const result = await answerConversation(catalog, `3P C16, 10 kA, ${quantity} штук`, terms, context, { reply: () => assert.fail('Local search called AI') });
    assert.equal(result.filters.quantity, quantity);
  }
  assert.equal(context.history.length, 8);
  await assert.rejects(answerConversation(catalog, 'a'.repeat(4001), terms), { code: 'QUERY_TOO_LONG' });
  await assert.rejects(answerConversation(catalog, '3P C16, 10 kA, 0 штук', terms), { code: 'INVALID_SPECIFICATIONS' });
});
