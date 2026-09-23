import { ApiError } from './errors.js';

const numericToken = '[+\\-−]?(?:\\d[\\d., \\u00a0\\u202f]*|[.,]\\d+)';
const numericBoundary = '(?<![\\p{L}\\p{N}.,+\\-−])';
const quantityUnit = '(?:штук(?:а|и)?|шт\\.?|единиц(?:а|ы)?|дана|pieces?|units?|pcs\\.?)';
const wordNumbers = {
  ноль: 0, один: 1, одна: 1, одно: 1, два: 2, две: 2, три: 3, четыре: 4,
  пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14,
  пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60,
  семьдесят: 70, восемьдесят: 80, девяносто: 90,
  сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500,
  шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
  нөл: 0, бір: 1, екі: 2, үш: 3, төрт: 4, бес: 5, алты: 6, жеті: 7,
  сегіз: 8, тоғыз: 9, он: 10, жиырма: 20, отыз: 30, қырық: 40,
  елу: 50, алпыс: 60, жетпіс: 70, сексен: 80, тоқсан: 90, жүз: 100,
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const numberWords = Object.keys(wordNumbers).sort((a, b) => b.length - a.length).join('|');
const wordToken = `(?:(?:${numberWords})[\\s-]+)*(?:${numberWords})`;
const negationBefore = /(?:^|[^\p{L}])(?:не(?:\s+(?:нужен|нужно|надо|хочу|подходит))?|кроме|без|за\s+исключением|not)\s*$/iu;

function isNegated(query, match) {
  return negationBefore.test(query.slice(0, match.index)) || /^\s*не\s+(?:нужен|нужно|надо|подходит)(?=$|[^\p{L}])/iu.test(query.slice(match.index + match[0].length));
}

function numericValue(text) {
  const token = text.trim().replace('−', '-');
  // Spaces are allowed only as complete thousands groups, never as a suffix match.
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?)$/.test(token)) return NaN;
  return Number(token.replace(/[ \u00a0\u202f]/g, '').replace(',', '.'));
}

function wordValue(text) {
  let last = Infinity;
  let value = 0;
  for (const word of text.toLocaleLowerCase('ru').split(/[\s-]+/)) {
    const current = wordNumbers[word];
    if (current === undefined || current >= last || last < 20 || (last >= 20 && last < 100 && current >= 10) || (last >= 100 && current >= 100 && last !== Infinity)) return NaN;
    value += current;
    last = current;
  }
  return value;
}

function valuesWithUnit(query, unit) {
  const numeric = [...query.matchAll(new RegExp(`${numericBoundary}(${numericToken})\\s*${unit}(?=$|[^\\p{L}])`, 'giu'))];
  const words = [...query.matchAll(new RegExp(`(?<![\\p{L}])(${wordToken})\\s*${unit}(?=$|[^\\p{L}])`, 'giu'))];
  const matches = [
    ...numeric.map((match) => ({ value: numericValue(match[1]), index: match.index, negated: isNegated(query, match) })),
    ...words.map((match) => ({ value: wordValue(match[1]), index: match.index, negated: isNegated(query, match) })),
  ];
  const positive = matches.filter(({ negated }) => !negated);
  const values = positive.map(({ value, index }) => /(?:минус|minus|[−-])\s*$/iu.test(query.slice(0, index)) ? -value : value);
  if (matches.length && !positive.length) values.push(NaN);
  // An unsupported larger or fractional numeral must not collapse to its final word.
  if (new RegExp(`(?:тысяч\\p{L}*|миллион\\p{L}*|миллиард\\p{L}*|полтор\\p{L}*|половин\\p{L}*|thousand|million|half|мың|миллион)(?:\\s+(?:${wordToken}|${numericToken}))?\\s*${unit}(?=$|[^\\p{L}])`, 'iu').test(query)) values.push(NaN);
  return values;
}

function uniqueValue(values, code, message, integer = false) {
  if (!values.length) return null;
  if (values.some((value) => !Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) || new Set(values).size !== 1) {
    throw new ApiError(422, code, message);
  }
  return values[0];
}

export function parseQuantity(query, { allowBare = false } = {}) {
  const values = valuesWithUnit(query, quantityUnit);
  if (allowBare && !values.length) {
    const text = query.trim().replace(/[.!?]$/, '').trim().replace(/^([+\-−])\s+/, '$1');
    if (new RegExp(`^${numericToken}$`, 'u').test(text)) values.push(numericValue(text));
    else if (new RegExp(`^${wordToken}$`, 'iu').test(text)) values.push(wordValue(text));
    else if (new RegExp(`^(?:минус|minus)\\s+(?:${wordToken}|${numericToken})$`, 'iu').test(text)) values.push(NaN);
  }
  return uniqueValue(values, 'INVALID_QUANTITY', 'Количество должно быть одним положительным целым числом без потери точности.', true);
}

function normalizeBrand(value) {
  return value.trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
}

export function parseRestrictions(query, catalog = []) {
  const restrictions = {};
  const brandMatch = query.match(/(?:^|[^\p{L}])(?:только(?:\s+(?:бренд|марка))?|бренд(?:а)?|марк[аиу]|производител[ья])(?:\s*:\s*|\s+)[«"']?([\p{L}][\p{L}\p{N}&.+-]*(?:\s+[\p{L}][\p{L}\p{N}&.+-]*)*)/iu);
  const explicitBrand = brandMatch?.[1];
  const brands = [...new Set(catalog.map((product) => product.brand).filter(Boolean))];
  const mentionedBrands = brands.filter((brand) => {
    const escaped = brand.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(query);
  });
  if (explicitBrand) {
    const brand = explicitBrand.split(/\s+(?:не|до|за|и|или|с|на|автомат|автоматы|нужен|нужно|номинал)(?=\s|$)/iu)[0].trim().replace(/[.]+$/, '');
    if (negationBefore.test(query.slice(0, brandMatch.index).trimEnd()) || /^(?:не|кроме|без)\s/iu.test(brand)) throw new ApiError(422, 'AMBIGUOUS_RESTRICTIONS', 'Укажите желаемый бренд для подбора.');
    if (!/^(?:автомат|товар|достав|цен|налич|сертификат|в\s+налич|сейчас|эти|этот|новый)/iu.test(brand)) {
      if (!brand || /^(?:из|с|по)$/iu.test(brand)) throw new ApiError(422, 'AMBIGUOUS_RESTRICTIONS', 'Уточните ограничение по бренду.');
      restrictions.brand = brands.find((candidate) => normalizeBrand(candidate) === normalizeBrand(brand)) ?? brand;
    }
  } else if (mentionedBrands.length === 1) {
    const brand = mentionedBrands[0];
    const before = query.slice(0, query.toLocaleLowerCase('ru').indexOf(brand.toLocaleLowerCase('ru')));
    if (/(?:не|кроме)\s*$/iu.test(before)) throw new ApiError(422, 'AMBIGUOUS_RESTRICTIONS', 'Укажите желаемый бренд для подбора.');
    restrictions.brand = brand;
  }
  if (mentionedBrands.length > 1 || (restrictions.brand && /(?:бренд|марки|только)[^:;.!?]*\sили\s/iu.test(query))) {
    throw new ApiError(422, 'AMBIGUOUS_RESTRICTIONS', 'Для одного подбора укажите один бренд.');
  }

  const prices = [...query.matchAll(new RegExp(`(?:не\\s+дороже|не\\s+более|до|максимум|бюджет(?:ом)?)\\s*(${numericToken})\\s*(?:₸|тенге|тг\\.?|KZT)(?=$|[^\\p{L}])`, 'giu'))];
  if (prices.length) {
    const values = prices.map((match) => numericValue(match[1]));
    if (values.some((value) => !Number.isFinite(value) || value < 0) || new Set(values).size !== 1 || /общ(?:ий|его)\s+бюджет|за\s+вс[её]|на\s+весь\s+заказ|всего\s+до/iu.test(query)) {
      throw new ApiError(422, 'AMBIGUOUS_RESTRICTIONS', 'Укажите максимальную цену за одну штуку в тенге.');
    }
    restrictions.maxPriceKzt = values[0];
  } else if (/не\s+дороже|(?:максимальн\p{L}*|предельн\p{L}*)\s+цен|бюджет/iu.test(query)) {
    throw new ApiError(422, 'AMBIGUOUS_RESTRICTIONS', 'Укажите максимальную цену за одну штуку в тенге.');
  }
  return restrictions;
}

export function parsePartialQuery(query) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new ApiError(400, 'INVALID_QUERY', 'Введите технический запрос.');
  }
  const polesValues = valuesWithUnit(query, '(?:p|р|ф|полюс(?:а|ов|ті|ты)?|poles?)');
  const allPoleWords = [...query.matchAll(/(?<![\p{L}])(одно|двух|тр[её]х|четыр[её]х)полюсн\p{L}*/giu)];
  const poleWords = allPoleWords.filter((match) => !isNegated(query, match));
  if (allPoleWords.length && !poleWords.length) polesValues.push(NaN);
  polesValues.push(...poleWords.map((match) => ({ одно: 1, двух: 2, трех: 3, трёх: 3, четырех: 4, четырёх: 4 })[match[1].toLocaleLowerCase('ru')]));
  const englishPoles = [...query.matchAll(/\b(single|one|two|three|four)[\s-]+pole(?:s)?\b/giu)];
  polesValues.push(...englishPoles.map((match) => ({ single: 1, one: 1, two: 2, three: 3, four: 4 })[match[1].toLowerCase()]));
  const poles = uniqueValue(polesValues, 'INVALID_SPECIFICATIONS', 'Укажите от одного до четырёх полюсов.', true);
  if (poles !== null && poles > 4) throw new ApiError(422, 'INVALID_SPECIFICATIONS', 'Укажите от одного до четырёх полюсов.');
  const allRatings = [...query.matchAll(/(?<![\p{L}\p{N}])([BCDВСД])\s*([+\-−]?\d+(?:[.,]\d+)?)(?![\p{L}\p{N}]|[.,]\d)/giu)];
  const ratings = allRatings.filter((match) => !isNegated(query, match));
  if (allRatings.length && !ratings.length) throw new ApiError(422, 'AMBIGUOUS_SPECIFICATIONS', 'Укажите желаемый номинал и характеристику срабатывания.');
  const curves = ratings.map((match) => match[1].toUpperCase());
  const allCurves = [...query.matchAll(/(?:характеристик\p{L}*|крив\p{L}*|сипаттамас\p{L}*|curve|characteristic)\s+([BCDВСД])(?=$|[^\p{L}\p{N}])/giu)];
  const selectedCurves = allCurves.filter((match) => !isNegated(query, match));
  if (allCurves.length && !selectedCurves.length && !curves.length) throw new ApiError(422, 'AMBIGUOUS_SPECIFICATIONS', 'Укажите желаемую характеристику срабатывания.');
  curves.push(...selectedCurves.map((match) => match[1].toUpperCase()));
  const normalizedCurves = [...new Set(curves.map((curve) => ({ В: 'B', С: 'C', Д: 'D' })[curve] ?? curve))];
  if (normalizedCurves.length > 1) throw new ApiError(422, 'AMBIGUOUS_SPECIFICATIONS', 'Укажите одну характеристику срабатывания.');
  const amps = uniqueValue([...ratings.map((match) => numericValue(match[2])), ...valuesWithUnit(query, '(?:A|А|ампер(?:а|ов)?|amperes?|amps?)')], 'INVALID_SPECIFICATIONS', 'Укажите один положительный целый номинал в амперах.', true);
  const breakingCapacityKa = uniqueValue(valuesWithUnit(query, '(?:kA|кА|килоампер(?:а|ов)?|kiloamperes?)'), 'INVALID_SPECIFICATIONS', 'Укажите одну положительную отключающую способность в kA.');
  return { poles, curve: normalizedCurves[0] ?? null, amps, breakingCapacityKa, quantity: parseQuantity(query) };
}

export function parseQuery(query) {
  let filters;
  try { filters = parsePartialQuery(query); }
  catch (error) {
    if (error.code !== 'INVALID_QUANTITY') throw error;
    throw new ApiError(422, 'INVALID_SPECIFICATIONS', error.message);
  }
  if (Object.values(filters).some((value) => value === null)) {
    throw new ApiError(422, 'MISSING_SPECIFICATIONS', 'Укажите полюса, характеристику и номинал, отключающую способность и количество. Например: 3P C16, 10 kA, 8 штук.');
  }
  return { ...filters, ...parseRestrictions(query) };
}

export function canFulfill(product, quantity) {
  return Number.isSafeInteger(quantity) && quantity > 0 && product.stock >= quantity && quantity % (product.minimumOrderQuantity ?? 1) === 0;
}

export function searchCatalog(catalog, filters) {
  if (!Number.isSafeInteger(filters.quantity) || filters.quantity <= 0) throw new ApiError(422, 'INVALID_QUANTITY', 'Количество должно быть положительным целым числом.');
  const sameRating = catalog.filter((product) =>
    product.poles === filters.poles &&
    product.curve === filters.curve &&
    product.amps === filters.amps &&
    (!filters.brand || (product.brand && normalizeBrand(product.brand) === normalizeBrand(filters.brand))) &&
    (filters.maxPriceKzt === undefined || product.priceKzt <= filters.maxPriceKzt),
  );
  const exact = sameRating
    .filter((product) => product.breakingCapacityKa === filters.breakingCapacityKa)
    .sort((left, right) => Number(canFulfill(right, filters.quantity)) - Number(canFulfill(left, filters.quantity)) || left.priceKzt - right.priceKzt)[0] ?? null;
  const alternatives = sameRating
    .filter((product) => product.breakingCapacityKa > filters.breakingCapacityKa && canFulfill(product, filters.quantity))
    .sort((left, right) => left.breakingCapacityKa - right.breakingCapacityKa || left.priceKzt - right.priceKzt)
    .slice(0, 2)
    .map((product) => ({
      product,
      reason: `Совпадают ${filters.poles}P ${filters.curve}${filters.amps}; отключающая способность ${product.breakingCapacityKa} kA не ниже требуемых ${filters.breakingCapacityKa} kA. Остальные параметры проверьте перед покупкой.`,
    }));

  return {
    filters,
    exactMatch: exact && { product: exact, canFulfill: canFulfill(exact, filters.quantity) },
    alternatives: exact && canFulfill(exact, filters.quantity) ? [] : alternatives,
  };
}
