const boundary = '(?=$|[^\\p{L}\\p{N}])';

export function queryKind(text) {
  if (/кабель[-\s]?канал|наконечник|ламподержател/iu.test(text)) return null;
  if (/светильник|прожектор|светодиодн[\p{L}]*\s+панел/iu.test(text)) return 'luminaire';
  if (/(?<!\p{L})ламп(?:а|ы|у|е|ой|ами|ах)?(?!\p{L})/iu.test(text)) return 'lamp';
  if (/освещени|(?<!\p{L})свет(?!\p{L})/iu.test(text)) return 'lighting';
  if (/(?<!\p{L})(?:кабел[ьяюеий]|провод(?:а|ов|ы)?|шнур)(?!\p{L})/iu.test(text)) return 'cable';
  if (/(?<!\p{L})(?:А?ВВГ(?:нг)?(?:[-\s]?\(?LS\)?)?|ПВС|ШВВП|NYM)(?!\p{L})/iu.test(text)) return 'cable';
  if (/(?<!\p{L})автомат(?:а|ы|ов|у|ом|ами|ах)?(?!\p{L})|автоматическ.{0,15}выключател|\b[1-4]\s*[pр](?=$|[^\p{L}])|(?<!\p{L})[BCDВСД]\s*\d/iu.test(text)) return 'breaker';
  return null;
}

export function productKind(product) {
  // Accessory names must not be mistaken for the electrical product they mention.
  if (/^\s*(?:кабель[-\s]?канал|наконечник|держател|патрон|корпус|креплен|крепёж|крепеж|рассеивател|драйвер|комплектующ|соединител)/iu.test(product.name)) return null;
  const kind = queryKind(product.name);
  if (kind) return kind;
  return product.poles && product.curve && product.amps && product.breakingCapacityKa ? 'breaker' : null;
}

export function categoryClarification(kind) {
  if (kind === 'breaker') return 'Для автомата уточните число полюсов, характеристику срабатывания, номинальный ток, отключающую способность и количество.';
  if (kind === 'lamp') return 'Для лампы уточните цоколь, мощность, напряжение, цветовую температуру и количество.';
  if (kind === 'luminaire') return 'Для светильника уточните назначение и способ монтажа, мощность, цветовую температуру, степень защиты IP и количество.';
  if (kind === 'lighting') return 'Нужна лампа или светильник? Уточните назначение, мощность, цветовую температуру и количество.';
  if (kind === 'cable') return 'Для кабеля уточните марку, материал и число жил, сечение, условия прокладки и требуемую длину. Единицу продажи нужно проверить в карточке.';
  return 'Уточните тип товара или артикул: например, автомат, лампа, светильник или кабель.';
}

function numeric(text, expression) {
  const match = text.match(expression);
  return match ? Number(match[1].replace(',', '.')) : null;
}

export function categoryParameters(text, kind) {
  const decimal = '(\\d+(?:[.,]\\d+)?)';
  const result = {};
  if (kind === 'lamp' || kind === 'luminaire') {
    result.power = numeric(text, new RegExp(`${decimal}\\s*(?:W|Вт)${boundary}`, 'iu'));
    result.temperature = numeric(text, new RegExp(`${decimal}\\s*(?:K|К)${boundary}`, 'iu'));
    result.voltage = numeric(text, new RegExp(`${decimal}\\s*(?:V|В)${boundary}`, 'iu'));
    result.ip = text.match(/(?<!\p{L})IP\s*(\d{2})(?!\d)/iu)?.[1] ?? null;
    result.socket = text.match(/(?<![\p{L}\p{N}])((?:E|GU|G)\s*\d+(?:[.,]\d+)?)(?![\p{L}\p{N}])/iu)?.[1]?.replace(/\s/g, '').toUpperCase() ?? null;
  }
  if (kind === 'cable') {
    const dimensions = text.match(/(?<!\d)(\d{1,2})\s*[xх×*]\s*(\d+(?:[.,]\d+)?)(?=$|[^\d])/iu);
    result.cores = dimensions ? Number(dimensions[1]) : null;
    result.section = dimensions ? Number(dimensions[2].replace(',', '.')) : null;
    result.mark = text.match(/(?<!\p{L})(ВВГ(?:нг)?(?:[-\s]?\(?LS\)?)?|АВВГ(?:нг)?|ПВС|ШВВП|NYM|КГ)(?!\p{L})/iu)?.[1]?.replace(/\s/g, '').toUpperCase() ?? null;
  }
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== null));
}

function productParameters(product, kind) {
  const properties = Object.values(product.properties ?? {}).filter((value) => typeof value === 'string' || typeof value === 'number');
  const result = {};
  const conflicts = new Set();
  for (const source of [product.name, ...properties]) {
    for (const [key, value] of Object.entries(categoryParameters(String(source), kind))) {
      if (Object.hasOwn(result, key) && result[key] !== value) conflicts.add(key);
      result[key] = value;
    }
  }
  for (const key of conflicts) delete result[key];
  return result;
}

export function categoryCandidates(catalog, kind, query, quantity, target, knownParameters = {}, excludedSkus = []) {
  const required = { ...knownParameters, ...(target && productParameters(target, kind)), ...categoryParameters(query, kind) };
  const labels = { power: 'мощность, Вт', temperature: 'цветовая температура, K', voltage: 'напряжение, В', ip: 'IP', socket: 'цоколь', cores: 'число жил', section: 'сечение, мм²', mark: 'марка кабеля' };
  const verified = Object.entries(required).map(([key, value]) => `${labels[key]}: ${value}`).join('; ');
  const alternatives = catalog
    .filter((product) => product.sku !== target?.sku && !excludedSkus.includes(product.sku) && !product.technicalIssue && productKind(product) === kind && product.stock >= quantity)
    .filter((product) => {
      const actual = productParameters(product, kind);
      return Object.entries(required).every(([key, value]) => actual[key] === value);
    })
    .sort((left, right) => left.priceKzt - right.priceKzt || left.sku.localeCompare(right.sku))
    .slice(0, 3)
    .map((product) => ({
      product,
      reason: `${verified ? `В данных совпадают ${verified}.` : 'Товар относится к той же категории.'} Кандидат для проверки: совместимость, размеры, монтаж и единицу продажи нужно сверить перед покупкой.`,
    }));
  return { alternatives, hasParameters: Object.keys(required).length > 0, parameters: required };
}
