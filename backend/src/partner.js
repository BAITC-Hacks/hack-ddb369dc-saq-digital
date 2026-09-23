import { z } from 'zod';
import { normalizePartnerProduct, validateCatalog } from './catalog.js';

const pageSchema = z.object({
  page: z.number().int().positive(),
  per_page: z.number().int().positive(),
  count: z.number().int().nonnegative(),
  items: z.array(z.object({ id: z.number().int().positive() })),
});

export class PartnerClient {
  constructor({ detailUrl, productsUrl, username, password, timeoutMs = 5000, fetcher = fetch }) {
    this.detailUrl = detailUrl;
    this.productsUrl = productsUrl || new URL('.', detailUrl).href.replace(/\/$/, '');
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    this.timeoutMs = timeoutMs;
    this.fetcher = fetcher;
  }

  async request(url) {
    const response = await this.fetcher(url, {
      headers: { Authorization: this.authorization },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw Object.assign(new Error(`Partner API returned HTTP ${response.status}`), { code: 'PARTNER_HTTP_ERROR', status: response.status });
    return response.json();
  }

  async page(number) {
    const url = new URL(this.productsUrl);
    url.searchParams.set('page', String(number));
    const page = pageSchema.parse(await this.request(url));
    if (page.page !== number || page.count !== page.items.length || page.count > page.per_page) {
      throw new Error('Partner API returned inconsistent pagination');
    }
    return page;
  }

  async detail(id) {
    const url = new URL(this.detailUrl);
    url.searchParams.set('id', String(id));
    const product = normalizePartnerProduct(await this.request(url));
    if (product.id !== Number(id)) throw new Error('Partner API returned a different product');
    return product;
  }
}

export async function refreshCatalog(catalog, client, { keepUnavailable = true, concurrency = 4, onProgress = () => {} } = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error('Partner concurrency must be between 1 and 16');
  }
  const updated = new Array(catalog.length);
  let failed = 0;
  let nextIndex = 0;
  let completed = 0;
  async function worker() {
    while (nextIndex < catalog.length) {
      const index = nextIndex++;
      const product = catalog[index];
      if (!product.id) {
        updated[index] = product;
        continue;
      }
      try {
        updated[index] = await client.detail(product.id);
      } catch {
        if (keepUnavailable) updated[index] = product;
        failed += 1;
      }
      completed += 1;
      onProgress({ stage: 'details', completed, total: catalog.length, failed });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, catalog.length) }, worker));
  return { catalog: updated.filter(Boolean), failed };
}

export async function loadPartnerCatalog(client, { maxPages = 2000, concurrency = 4, onProgress = () => {} } = {}) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error('Partner maxPages must be positive');
  const products = new Map();
  const signatures = new Set();
  let firstPage;
  let pages = 0;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error('Partner concurrency must be between 1 and 16');
  }
  let finished = false;
  for (let start = 1; !finished; start += concurrency) {
    if (start > maxPages) throw new Error('Partner pagination limit reached before the end of the catalog');
    const batch = await Promise.allSettled(Array.from({ length: Math.min(concurrency, maxPages - start + 1) }, (_, index) => client.page(start + index)));
    for (const result of batch) {
      if (result.status === 'rejected') throw result.reason;
      const page = result.value;
      const signature = page.items.map(({ id }) => id).sort((a, b) => a - b).join(',');
      // EKT repeats page one when the requested page is beyond the catalog.
      if (pages > 0 && signature === firstPage) { finished = true; break; }
      if (page.items.length && signatures.has(signature)) throw new Error('Partner pagination repeated a non-first page');
      signatures.add(signature);
      firstPage ??= signature;
      for (const product of page.items) products.set(product.id, product);
      pages += 1;
      onProgress({ stage: 'list', pages, total: products.size });
      if (page.items.length < page.per_page) { finished = true; break; }
    }
  }

  const result = await refreshCatalog([...products.values()], client, { keepUnavailable: false, concurrency, onProgress });
  const skuCounts = new Map();
  for (const product of result.catalog) skuCounts.set(product.sku, (skuCounts.get(product.sku) ?? 0) + 1);
  // The public cart contract uses SKU: ambiguous articles cannot safely be sold.
  const unique = result.catalog.filter((product) => skuCounts.get(product.sku) === 1);
  const failed = result.failed + result.catalog.length - unique.length;
  if (!unique.length) throw new Error('Partner catalog has no usable product details');
  return { catalog: validateCatalog(unique), failed, listed: products.size, pages };
}
