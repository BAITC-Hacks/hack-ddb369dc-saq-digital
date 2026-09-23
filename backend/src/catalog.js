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
  amps: z.number().int().positive().nullable().optional(),
  breakingCapacityKa: z.number().positive().nullable().optional(),
  priceKzt: z.number().nonnegative(),
  stock: z.number().int().nonnegative(),
  description: z.string().nullable().optional(),
  url: z.url().nullable().optional(),
  image: z.url().nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  stores: z.array(z.object({ id: z.number().int(), name: z.string(), quantity: z.number().int().nonnegative() })).optional(),
  certificates: z.array(z.object({ name: z.string(), url: z.url() })).optional(),
  minimumOrderQuantity: z.number().int().positive().optional(),
  technicalIssue: z.string().optional(),
});

const partnerDetailSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  article: z.string().min(1),
  price: z.number().nonnegative(),
  quantity: z.number().int().nonnegative(),
  description: z.string().nullable().optional(),
  url: z.url().nullable().optional(),
  image: z.url().nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  stores: z.array(z.object({ id: z.number().int(), name: z.string(), quantity: z.number().int().nonnegative() })).optional(),
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

export function normalizePartnerProduct(input) {
  const raw = partnerDetailSchema.parse(input);
  const properties = raw.properties ?? {};
  const namePoles = readNumber(raw.name.match(/\b([1-4])\s*(?:[pр]|ф)(?=$|[^\p{L}])/iu)?.[1]);
  const propertyPoles = readNumber(properties.KOLICHESTVO_POLYUSOV);
  const nameRating = raw.name.match(/(?<!\p{L})([BCDВСД])\s*(\d{1,3})(?=$|[^\p{L}\p{N}])/iu);
  const nameAmps = readNumber(nameRating?.[2] ?? raw.name.match(/\b(\d{1,4})\s*[АA](?=$|[^\p{L}])/iu)?.[1]);
  const propertyAmps = readNumber(properties.NOMINALNYY_TOK);
  const nameCapacity = readNumber(raw.name.match(/(\d+(?:[.,]\d+)?)\s*(?:kA|кА)(?=$|[^\p{L}])/iu)?.[1]);
  const propertyCapacity = readNumber(properties.NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST);
  const poles = consistentValue(namePoles, propertyPoles);
  const amps = consistentValue(nameAmps, propertyAmps);
  const breakingCapacityKa = consistentValue(nameCapacity, propertyCapacity);
  const technicalIssue = [
    namePoles !== null && propertyPoles !== null && namePoles !== propertyPoles,
    nameAmps !== null && propertyAmps !== null && nameAmps !== propertyAmps,
    nameCapacity !== null && propertyCapacity !== null && nameCapacity !== propertyCapacity,
  ].some(Boolean) ? 'Характеристики в названии и свойствах расходятся; совместимость требует проверки.' : undefined;
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
