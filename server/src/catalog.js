import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

export const productSchema = z.strictObject({
  sku: z.string().min(1),
  name: z.string().min(1),
  poles: z.number().int().min(1).max(4),
  curve: z.enum(['B', 'C', 'D']),
  amps: z.number().int().positive(),
  breakingCapacityKa: z.number().positive(),
  priceKzt: z.number().nonnegative(),
  stock: z.number().int().nonnegative(),
});

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
  return catalogSchema.parse(input);
}

export async function loadCatalog(path) {
  const content = await readFile(resolve(path), 'utf8');
  return validateCatalog(JSON.parse(content));
}
