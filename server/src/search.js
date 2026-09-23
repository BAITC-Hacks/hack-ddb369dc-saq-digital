import { ApiError } from './errors.js';

const number = '(\\d+(?:[.,]\\d+)?)';

export function parseQuery(query) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new ApiError(400, 'INVALID_QUERY', 'Введите технический запрос.');
  }

  const poles = query.match(/\b([1-4])\s*(?:p|р|ф)(?=$|[^\p{L}])/iu)?.[1];
  const rating = query.match(/(?<!\p{L})([BCDВСД])\s*(\d{1,3})(?=$|[^\p{L}\p{N}])/iu);
  const breakingCapacity = query.match(new RegExp(`${number}\\s*(?:kA|кА)(?=$|[^\\p{L}])`, 'iu'))?.[1];
  const quantity = query.match(/(?:^|\D)(\d+)\s*(?:шт\.?|штук|штуки|штука|единиц)(?=$|[^\p{L}])/iu)?.[1];

  if (!poles || !rating || !breakingCapacity || !quantity) {
    throw new ApiError(422, 'MISSING_SPECIFICATIONS', 'Укажите полюса, характеристику и номинал, отключающую способность и количество. Например: 3P C16, 10 kA, 8 штук.');
  }

  const filters = {
    poles: Number(poles),
    curve: ({ 'В': 'B', 'С': 'C', 'Д': 'D' })[rating[1].toUpperCase()] ?? rating[1].toUpperCase(),
    amps: Number(rating[2]),
    breakingCapacityKa: Number(breakingCapacity.replace(',', '.')),
    quantity: Number(quantity),
  };

  if (filters.amps <= 0 || filters.breakingCapacityKa <= 0 || filters.quantity <= 0) {
    throw new ApiError(422, 'INVALID_SPECIFICATIONS', 'Номинал, отключающая способность и количество должны быть больше нуля.');
  }
  return filters;
}

export function searchCatalog(catalog, filters) {
  const sameRating = catalog.filter((product) =>
    product.poles === filters.poles &&
    product.curve === filters.curve &&
    product.amps === filters.amps,
  );
  const exact = sameRating
    .filter((product) => product.breakingCapacityKa === filters.breakingCapacityKa)
    .sort((left, right) => Number(right.stock >= filters.quantity) - Number(left.stock >= filters.quantity) || left.priceKzt - right.priceKzt)[0] ?? null;
  const alternatives = sameRating
    .filter((product) => product.breakingCapacityKa > filters.breakingCapacityKa && product.stock >= filters.quantity)
    .sort((left, right) => left.breakingCapacityKa - right.breakingCapacityKa || left.priceKzt - right.priceKzt)
    .slice(0, 2)
    .map((product) => ({
      product,
      reason: `Совпадают ${filters.poles}P ${filters.curve}${filters.amps}; отключающая способность ${product.breakingCapacityKa} kA не ниже требуемых ${filters.breakingCapacityKa} kA. Остальные параметры проверьте перед покупкой.`,
    }));

  return {
    filters,
    exactMatch: exact && { product: exact, canFulfill: exact.stock >= filters.quantity },
    alternatives: exact?.stock >= filters.quantity ? [] : alternatives,
  };
}
