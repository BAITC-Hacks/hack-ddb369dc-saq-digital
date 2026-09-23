import assert from 'node:assert/strict';
import test from 'node:test';
import { canFulfill, parsePartialQuery, parseQuantity, parseQuery, parseRestrictions, searchCatalog } from '../src/search.js';
import { catalog } from './fixtures.js';

test('parses the demo request with comma decimals and case insensitive units', () => {
  assert.deepEqual(parseQuery('Нужен автомат 3p c16, 10,5 KA, 8 штук'), {
    poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10.5, quantity: 8,
  });
});

test('parses Cyrillic electrical notation', () => {
  assert.deepEqual(parseQuery('Автомат 3Р С16, 10 кА, 8 шт.'), {
    poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10, quantity: 8,
  });
});

test('parses singular quantity and fractional breaking capacity', () => {
  assert.deepEqual(parseQuery('Нужен автомат 1P C16, 4.5 kA, 1 штука'), {
    poles: 1, curve: 'C', amps: 16, breakingCapacityKa: 4.5, quantity: 1,
  });
});

test('rejects missing and invalid specifications', () => {
  assert.throws(() => parseQuery('нужен автомат'), { code: 'MISSING_SPECIFICATIONS' });
  assert.throws(() => parseQuery('3P C16, 10 kA, 0 штук'), { code: 'INVALID_SPECIFICATIONS' });
});

test('returns insufficient exact stock and only compatible stocked alternatives', () => {
  const result = searchCatalog(catalog, parseQuery('3P C16, 10 kA, 8 штук'));
  assert.equal(result.exactMatch.product.sku, 'EXACT');
  assert.equal(result.exactMatch.canFulfill, false);
  assert.deepEqual(result.alternatives.map(({ product }) => product.sku), ['ALT-15', 'ALT-20']);
  assert.match(result.alternatives[0].reason, /15 kA/);
});

test('returns a sufficient exact match without alternatives', () => {
  const result = searchCatalog(catalog, parseQuery('3P C16, 10 kA, 2 штуки'));
  assert.equal(result.exactMatch.canFulfill, true);
  assert.deepEqual(result.alternatives, []);
});

test('returns an empty result for an unknown specification', () => {
  const result = searchCatalog(catalog, parseQuery('3P D63, 10 kA, 1 шт'));
  assert.equal(result.exactMatch, null);
  assert.deepEqual(result.alternatives, []);
});

test('rejects invalid explicit amounts without selecting a numeric suffix', () => {
  for (const amount of ['-8', '−8', '- 8', '1.5', '1,5', '9007199254740993', '1 50', 'минус восемь', 'восемь восемь']) {
    assert.throws(() => parseQuantity(`${amount} штук`), { code: 'INVALID_QUANTITY' }, amount);
  }
  for (const capacity of ['-10', '−10', '- 10', '1 50']) {
    assert.throws(() => parseQuery(`3P C16, ${capacity} kA, 8 штук`), { code: 'INVALID_SPECIFICATIONS' }, capacity);
  }
  assert.throws(() => parseQuery('3P C1.5, 10 kA, 8 штук'), { code: 'INVALID_SPECIFICATIONS' });
  assert.throws(() => parseQuery('3P C-16, 10 kA, 8 штук'), { code: 'INVALID_SPECIFICATIONS' });
});

test('preserves leading fractional zero and explicitly grouped quantities', () => {
  assert.equal(parseQuery('3P C16, .5 kA, 8 штук').breakingCapacityKa, 0.5);
  assert.equal(parseQuery('3P C16, ,5 кА, 8 штук').breakingCapacityKa, 0.5);
  assert.equal(parseQuantity('1 500 штук'), 1500);
  assert.equal(parseQuantity('1\u202f500 штук'), 1500);
});

test('parses quantities in words and interprets bare replies only when explicitly requested', () => {
  assert.equal(parseQuantity('Нужно восемь штук'), 8);
  assert.equal(parseQuantity('двадцать пять штук'), 25);
  assert.equal(parseQuantity('двести сорок одна штука'), 241);
  assert.equal(parseQuantity('восемь'), null);
  assert.equal(parseQuantity('восемь', { allowBare: true }), 8);
  assert.equal(parseQuantity('25.', { allowBare: true }), 25);
  assert.throws(() => parseQuantity('ноль штук'), { code: 'INVALID_QUANTITY' });
  assert.throws(() => parseQuantity('8 штук или 10 штук'), { code: 'INVALID_QUANTITY' });
});

test('partial parsing grounds only supplied fields including Russian technical words', () => {
  assert.deepEqual(parsePartialQuery('трёхполюсный автомат с характеристикой C, шестнадцать ампер, десять килоампер'), {
    poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10, quantity: null,
  });
  assert.deepEqual(parsePartialQuery('Теперь новый однополюсный автомат с характеристикой B'), {
    poles: 1, curve: 'B', amps: null, breakingCapacityKa: null, quantity: null,
  });
  assert.deepEqual(parsePartialQuery('Выбери автомат в квартиру сам'), {
    poles: null, curve: null, amps: null, breakingCapacityKa: null, quantity: null,
  });
  assert.throws(() => parsePartialQuery('5P C16'), { code: 'INVALID_SPECIFICATIONS' });
  assert.throws(() => parsePartialQuery('1P или 3P'), { code: 'INVALID_SPECIFICATIONS' });
  assert.throws(() => parsePartialQuery('C16 или B16'), { code: 'AMBIGUOUS_SPECIFICATIONS' });
});

test('selects the positive correction and rejects unresolved rating alternatives', () => {
  assert.equal(parseQuery('Нужен 3P, не C16, а C25, 10 kA, 8 штук').amps, 25);
  assert.throws(() => parseQuery('3P C16 или C25, 10 kA, 8 штук'), { code: 'INVALID_SPECIFICATIONS' });
});

test('filters both exact products and alternatives by explicit brand and unit price', () => {
  const products = catalog.map((product, index) => ({ ...product, brand: index === 1 ? 'Schneider' : 'Other' }));
  const restrictions = parseRestrictions('Только Schneider: 3P C16, 10 kA, 8 штук, не дороже 15000 тенге за штуку', products);
  assert.deepEqual(restrictions, { brand: 'Schneider', maxPriceKzt: 15000 });
  const filters = { ...parseQuery('3P C16, 10 kA, 8 штук'), ...restrictions };
  const result = searchCatalog(products, filters);
  assert.equal(result.exactMatch, null);
  assert.deepEqual(result.alternatives.map(({ product }) => product.sku), ['ALT-15']);
  assert.deepEqual(searchCatalog(products, { ...filters, maxPriceKzt: 1000 }).alternatives, []);
  assert.deepEqual(parseRestrictions('Нужен Schneider 3P C16', products), { brand: 'Schneider' });
  assert.deepEqual(parseRestrictions('Только в наличии'), {});
  assert.deepEqual(parseRestrictions('Только Schneider.', products), { brand: 'Schneider' });
});

test('clarifies ambiguous price or brand restrictions rather than ignoring them', () => {
  for (const query of ['не дороже тысячи', 'не дороже -1000 тенге', 'общий бюджет 1000 тенге за все', 'до 1000 тенге или до 2000 тенге', 'только Schneider или ABB']) {
    assert.throws(() => parseRestrictions(query), { code: 'AMBIGUOUS_RESTRICTIONS' }, query);
  }
  assert.throws(() => parseRestrictions('не Schneider', [{ brand: 'Schneider' }]), { code: 'AMBIGUOUS_RESTRICTIONS' });
  assert.deepEqual(parseRestrictions('до 1 500 ₸ за штуку'), { maxPriceKzt: 1500 });
});

test('fulfilment and alternatives respect order multiples and stock', () => {
  const products = catalog.map((product) => ({ ...product, stock: 20, minimumOrderQuantity: product.sku === 'ALT-20' ? 2 : 3 }));
  const result = searchCatalog(products, parseQuery('3P C16, 10 kA, 8 штук'));
  assert.equal(result.exactMatch.canFulfill, false);
  assert.deepEqual(result.alternatives.map(({ product }) => product.sku), ['ALT-20']);
  assert.equal(canFulfill(products[0], 9), true);
  assert.equal(canFulfill(products[0], 21), false);
  assert.equal(canFulfill(products[0], -3), false);
  assert.throws(() => searchCatalog(products, { quantity: 0 }), { code: 'INVALID_QUANTITY' });
});

test('partial parsing respects positive corrections without treating exclusions as requested values', () => {
  assert.equal(parsePartialQuery('НЕ C16 а C25').amps, 25);
  assert.equal(parsePartialQuery('не нужен C16, нужен C25').amps, 25);
  assert.equal(parsePartialQuery('C16 не подходит, нужен C25').amps, 25);
  assert.equal(parsePartialQuery('не 16 ампер, а 25 ампер').amps, 25);
  assert.equal(parsePartialQuery('не характеристика B, а характеристика C').curve, 'C');
  assert.equal(parsePartialQuery('не однополюсный, а трёхполюсный').poles, 3);
  assert.equal(parseQuantity('не 8 штук, а 5 штук'), 5);
  for (const query of ['не C16', 'не нужен C16', 'C16 не подходит', 'кроме C16', 'без C16', 'не 16 ампер', 'не характеристика B', 'не однополюсный']) {
    assert.throws(() => parsePartialQuery(query), { status: 422 }, query);
  }
  assert.throws(() => parseQuantity('не 8 штук'), { code: 'INVALID_QUANTITY' });
  assert.throws(() => parseQuantity('8 штук не нужно'), { code: 'INVALID_QUANTITY' });
  assert.throws(() => parseQuantity('- 8', { allowBare: true }), { code: 'INVALID_QUANTITY' });
  assert.throws(() => parseQuantity('минус восемь', { allowBare: true }), { code: 'INVALID_QUANTITY' });
});

test('unsupported or malformed word amounts never turn into a smaller numeric suffix', () => {
  for (const query of ['одна тысяча восемь штук', 'тысяча штук', 'полторы тысячи восемь штук', 'две с половиной штуки', 'девяносто двадцать штук', 'двадцать десять штук']) {
    assert.throws(() => parseQuantity(query), { code: 'INVALID_QUANTITY' }, query);
  }
  assert.equal(parseQuantity('девятьсот девяносто девять штук'), 999);
  assert.throws(() => parsePartialQuery('одна тысяча восемь ампер'), { code: 'INVALID_SPECIFICATIONS' });
});

test('unknown explicit brands remain restrictions and negative brand clauses require clarification', () => {
  for (const query of ['бренд: Schneider', 'бренд:Schneider', 'марка Schneider', 'производитель Schneider']) {
    assert.deepEqual(parseRestrictions(query), { brand: 'Schneider' }, query);
  }
  for (const query of ['не бренд Schneider', 'не только Schneider', 'только не Schneider', 'кроме марки Schneider']) {
    assert.throws(() => parseRestrictions(query), { code: 'AMBIGUOUS_RESTRICTIONS' }, query);
  }
});

test('explicit Kazakh and English word quantities remain grounded across AI selection', () => {
  assert.deepEqual(parsePartialQuery('үш полюсті автомат C16, он килоампер, сегіз дана'), {
    poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10, quantity: 8,
  });
  assert.deepEqual(parsePartialQuery('three pole breaker C16, ten kiloamperes, eight pieces'), {
    poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10, quantity: 8,
  });
  assert.equal(parseQuantity('twenty-one units'), 21);
  assert.throws(() => parseQuantity('one thousand eight pieces'), { code: 'INVALID_QUANTITY' });
});
