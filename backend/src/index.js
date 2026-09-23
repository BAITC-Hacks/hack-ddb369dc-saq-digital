import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadCatalog } from './catalog.js';
import { PartnerClient, loadPartnerCatalog } from './partner.js';
import { OpenAIQueryParser } from './ai.js';
import { readCatalogCache, writeCatalogCache } from './catalog-cache.js';

const serverDirectory = fileURLToPath(new URL('..', import.meta.url));
const configuration = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
const purchaseTerms = JSON.parse(await readFile(new URL('../purchase-terms.json', import.meta.url), 'utf8'));
const usePartner = process.env.APP_MODE === 'live' && process.env.EKT_API_USERNAME && process.env.EKT_API_PASSWORD;
const client = usePartner ? new PartnerClient({
  detailUrl: process.env.EKT_PRODUCT_DETAIL_URL || configuration.partnerDetailUrl,
  productsUrl: configuration.partnerProductsUrl,
  username: process.env.EKT_API_USERNAME,
  password: process.env.EKT_API_PASSWORD,
  timeoutMs: configuration.partner?.timeoutMs,
}) : undefined;
const cachePath = process.env.EKT_CATALOG_CACHE_PATH || resolve(serverDirectory, configuration.partner?.cache?.path || '.cache/ekt-catalog.json');
const cacheMaxAgeMs = configuration.partner?.cache?.maxAgeMs ?? 3600000;
if (!Number.isSafeInteger(cacheMaxAgeMs) || cacheMaxAgeMs < 1000) throw new Error('Partner cache maxAgeMs must be at least 1000.');
const sourceKey = client && createHash('sha256').update(JSON.stringify([client.detailUrl, client.productsUrl, process.env.EKT_API_USERNAME])).digest('hex');
const cached = client ? await readCatalogCache(cachePath, sourceKey) : null;
const catalog = usePartner ? cached?.catalog ?? [] : await loadCatalog(process.env.CATALOG_PATH || resolve(serverDirectory, configuration.catalogPath));
const catalogState = {
  status: usePartner && !cached ? 'loading' : 'ready', source: usePartner ? 'partner' : 'local', products: catalog.length,
  ...(usePartner && { cached: Boolean(cached), refreshing: false, stale: Boolean(cached && Date.now() - Date.parse(cached.loadedAt) >= cacheMaxAgeMs) }),
  ...(cached && { loadedAt: cached.loadedAt }),
};
if (cached) console.log(`EKT catalog restored from disk: ${catalog.length} products, snapshot ${cached.loadedAt}. Search is available immediately.`);
const port = Number(process.env.PORT || configuration.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const queryParser = process.env.APP_MODE === 'live' && process.env.OPENAI_API_KEY
  ? new OpenAIQueryParser({
    url: process.env.OPENAI_RESPONSES_URL || configuration.openai.responsesUrl,
    model: process.env.OPENAI_MODEL || configuration.openai.model,
    apiKey: process.env.OPENAI_API_KEY,
    maxOutputTokens: configuration.openai.maxOutputTokens,
    maxCalls: configuration.openai.maxCalls,
    windowMs: configuration.openai.windowMs,
    maxConcurrent: configuration.openai.maxConcurrent,
    cacheTtlMs: configuration.openai.cacheTtlMs,
    maxCacheEntries: configuration.openai.maxCacheEntries,
    timeoutMs: configuration.openai.timeoutMs,
  })
  : undefined;
let staticDirectory = resolve(serverDirectory, process.env.FRONTEND_DIST_PATH || configuration.frontendDistPath || '../frontend/dist');
try {
  await access(resolve(staticDirectory, 'index.html'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  staticDirectory = undefined;
}
createApp(catalog, { cartUrl: process.env.CART_URL || configuration.cartUrl, purchaseTerms, queryParser, uploads: configuration.uploads, partnerClient: client, staticDirectory, catalogState }).listen(port, () => console.log(`EKT assistant is listening on port ${port}${staticDirectory ? ' (API + frontend)' : ' (API)'}`));

if (usePartner) {
  const scheduleRefresh = (delayMs) => setTimeout(() => void updateCatalog(), delayMs).unref();
  async function updateCatalog() {
    if (catalogState.refreshing) return;
    Object.assign(catalogState, { refreshing: true, stale: catalog.length > 0 });
    delete catalogState.refreshError;
    for (const key of ['pages', 'listed', 'completed', 'failed']) delete catalogState[key];
    console.log('Updating the EKT catalog in the background. A saved catalog remains available during the import.');
    try {
      const result = await loadPartnerCatalog(client, {
        ...configuration.partner,
        onProgress: ({ stage, pages, total, completed, failed }) => {
          Object.assign(catalogState, stage === 'list' ? { pages, listed: total } : { completed, failed });
          if (stage === 'list' && pages % 50 === 0) console.log(`EKT catalog: ${pages} pages, ${total} product IDs.`);
          if (stage === 'details' && (completed % 100 === 0 || completed === total)) console.log(`EKT details: ${completed}/${total}, unavailable: ${failed}.`);
        },
      });
      // A transient detail failure must not replace a usable snapshot with a smaller subset.
      if (catalog.length && result.failed > 0) throw new Error('Incomplete partner refresh');
      // Keep the same array for sessions and upload jobs; publish only a complete import.
      catalog.length = 0;
      for (const product of result.catalog) catalog.push(product);
      const loadedAt = new Date().toISOString();
      Object.assign(catalogState, { status: 'ready', products: catalog.length, failed: result.failed, loadedAt, cached: false, stale: false });
      try {
        await writeCatalogCache(cachePath, sourceKey, { catalog, loadedAt });
        catalogState.cacheSaved = true;
      } catch {
        catalogState.cacheSaved = false;
        console.warn('EKT catalog is ready, but its disk cache could not be saved. Check cache directory permissions.');
      }
      console.log(`EKT catalog ready: ${catalog.length} real products; excluded: ${result.failed}.`);
    } catch {
      catalogState.status = catalog.length ? 'ready' : 'failed';
      catalogState.refreshError = 'CATALOG_REFRESH_FAILED';
      // Keep the previous complete snapshot and never log credentials/provider payloads.
      console.error(catalog.length ? 'EKT refresh failed. The previous catalog snapshot remains available.' : 'EKT catalog could not be loaded. Chat and purchase terms remain available.');
    } finally {
      catalogState.refreshing = false;
      scheduleRefresh(cacheMaxAgeMs);
    }
  }
  if (cached && !catalogState.stale) scheduleRefresh(Math.max(1, cacheMaxAgeMs - (Date.now() - Date.parse(cached.loadedAt))));
  else void updateCatalog();
}
