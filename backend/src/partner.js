import { normalizePartnerProduct } from './catalog.js';

export class PartnerClient {
  constructor({ detailUrl, username, password, fetcher = fetch }) {
    this.detailUrl = detailUrl;
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    this.fetcher = fetcher;
  }

  async detail(id) {
    const url = new URL(this.detailUrl);
    url.searchParams.set('id', String(id));
    const response = await this.fetcher(url, {
      headers: { Authorization: this.authorization },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Partner API returned HTTP ${response.status}`);
    return normalizePartnerProduct(await response.json());
  }
}

export async function refreshCatalog(catalog, client) {
  const updated = new Array(catalog.length);
  let failed = 0;
  let nextIndex = 0;
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
        updated[index] = product;
        failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, catalog.length) }, worker));
  return { catalog: updated, failed };
}
