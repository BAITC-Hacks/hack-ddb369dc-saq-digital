import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

export const productSchema = z.strictObject({
  sku: z.string().min(1),
  id: z.number().int().positive().optional(),
  article: z.string().min(1).optional(),
  name: z.string().min(1),
  brand: z.string().min(1).optional(),
  poles: z.number().int().min(1).max(4).nullable().optional(),
  curve: z.enum(['B', 'C', 'D']).nullable().optional(),
  amps: z.number().positive().nullable().optional(),
  breakingCapacityKa: z.number().positive().nullable().optional(),
  priceKzt: z.number().nonnegative(),
  stock: z.number().nonnegative(),
  description: z.string().nullable().optional(),
  url: z.url().nullable().optional(),
  image: z.url().nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  stores: z.array(z.object({ id: z.number().int(), name: z.string(), quantity: z.number().nonnegative() })).optional(),
  certificates: z.array(z.object({ name: z.string(), url: z.url() })).optional(),
  minimumOrderQuantity: z.number().int().positive().optional(),
  technicalIssue: z.string().optional(),
});

const partnerDetailSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  article: z.string().min(1),
  price: z.number().nonnegative(),
  quantity: z.number().nonnegative(),
  description: z.string().nullable().optional(),
  url: z.url().nullable().optional(),
  image: z.url().nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  stores: z.array(z.object({ id: z.number().int(), name: z.string(), quantity: z.number().nonnegative() })).optional(),
  certificates: z.array(z.object({ name: z.string(), url: z.url() })).optional(),
}).passthrough();

const demoProductSchema = z.strictObject({
  sku: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().min(1),
  poles: z.number().int().min(1).max(4),
  curve: z.enum(['B', 'C', 'D']),
  amps: z.number().int().positive(),
  breakingCapacity: z.number().positive(),
  price: z.number().nonnegative(),
  currency: z.literal('KZT'),
  stock: z.number().int().nonnegative(),
});

export function normalizeDemoProduct(input) {
  const demo = demoProductSchema.parse(input);
  return productSchema.parse({
    sku: demo.sku,
    name: demo.name,
    brand: demo.brand,
    poles: demo.poles,
    curve: demo.curve,
    amps: demo.amps,
    breakingCapacityKa: demo.breakingCapacity,
    priceKzt: demo.price,
    stock: demo.stock,
  });
}

function readNumber(value) {
  const match = String(value ?? '').match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')) : null;
}

function consistentValue(first, second) {
  return first !== null && second !== null && first !== second ? null : first ?? second;
}

function readCapacity(value) {
  if (value === undefined || value === null || value === '') return { value: null, unknown: false };
  const match = String(value).trim().match(/^([+\-−]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*(kA|кА|A|А)$/iu);
  if (!match) return { value: null, unknown: true };
  const parsed = Number(match[1].replace('−', '-').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) return { value: null, unknown: true };
  return { value: /^[kк]/iu.test(match[2]) ? parsed : parsed / 1000, unknown: false };
}

export function normalizePartnerProduct(input) {
  const raw = partnerDetailSchema.parse(input);
  const properties = raw.properties ?? {};
  const namePoles = readNumber(raw.name.match(/\b([1-4])\s*(?:[pр]|ф)(?=$|[^\p{L}])/iu)?.[1]);
  const propertyPoles = readNumber(properties.KOLICHESTVO_POLYUSOV);
  const nameRating = raw.name.match(/(?<!\p{L})([BCDВСД])\s*(\d{1,3}(?:[.,]\d+)?)(?=$|[^\p{L}\p{N}])/iu);
  const nameAmps = readNumber(nameRating?.[2] ?? raw.name.match(/\b(\d{1,4}(?:[.,]\d+)?)\s*[АA](?=$|[^\p{L}])/iu)?.[1]);
  const propertyAmps = readNumber(properties.NOMINALNYY_TOK);
  const nameCapacities = [...raw.name.matchAll(/(?<![\p{L}\p{N}.,+\-−])([+\-−]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*(?:kA|кА)(?=$|[^\p{L}])/giu)].map((match) => readCapacity(match[0]));
  const nameCapacity = nameCapacities[0]?.value ?? null;
  const capacityProperty = readCapacity(properties.NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST);
  const propertyCapacity = capacityProperty.value;
  const ambiguousCapacity = capacityProperty.unknown || nameCapacities.some((entry) => entry.unknown || entry.value !== nameCapacity);
  const poles = consistentValue(namePoles, propertyPoles);
  const parsedAmps = consistentValue(nameAmps, propertyAmps);
  const amps = parsedAmps > 0 ? parsedAmps : null;
  const breakingCapacityKa = ambiguousCapacity ? null : consistentValue(nameCapacity, propertyCapacity);
  const technicalIssue = [
    namePoles !== null && propertyPoles !== null && namePoles !== propertyPoles,
    nameAmps !== null && propertyAmps !== null && nameAmps !== propertyAmps,
    nameCapacity !== null && propertyCapacity !== null && nameCapacity !== propertyCapacity,
  ].some(Boolean) ? 'Характеристики в названии и свойствах расходятся; совместимость требует проверки.'
    : parsedAmps !== null && parsedAmps <= 0 ? 'Не удалось определить положительный номинальный ток; совместимость требует проверки.'
    : ambiguousCapacity ? 'Единицы или значение отключающей способности неоднозначны; совместимость требует проверки.' : undefined;
  const minimumOrderQuantity = readNumber(properties.KRATNOST_MIN);

  return productSchema.parse({
    sku: raw.article,
    id: raw.id,
    article: raw.article,
    name: raw.name,
    poles,
    curve: nameRating ? (({ 'В': 'B', 'С': 'C', 'Д': 'D' })[nameRating[1].toUpperCase()] ?? nameRating[1].toUpperCase()) : null,
    amps,
    breakingCapacityKa,
    priceKzt: raw.price,
    stock: raw.quantity,
    description: raw.description ?? null,
    url: raw.url ?? null,
    image: raw.image ?? null,
    properties,
    stores: raw.stores ?? [],
    certificates: raw.certificates ?? [],
    ...(minimumOrderQuantity > 0 && Number.isInteger(minimumOrderQuantity) && { minimumOrderQuantity }),
    ...(technicalIssue && { technicalIssue }),
  });
}

const catalogSchema = z.array(productSchema).superRefine((products, context) => {
  const seen = new Set();
  for (const [index, product] of products.entries()) {
    if (seen.has(product.sku)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate SKU: ${product.sku}`,
        path: [index, 'sku'],
      });
    }
    seen.add(product.sku);
  }
});

export function validateCatalog(input) {
  const products = z.array(z.unknown()).parse(input).map((product) => {
    if (product && typeof product === 'object') {
      if ('breakingCapacity' in product && 'price' in product) return normalizeDemoProduct(product);
      if ('article' in product && 'quantity' in product) return normalizePartnerProduct(product);
    }
    return productSchema.parse(product);
  });
  return catalogSchema.parse(products);
}

export async function loadCatalog(path) {
  const content = await readFile(resolve(path), 'utf8');
  return validateCatalog(JSON.parse(content));
}
