import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadCatalog, validateCatalog } from './catalog.js';
import { PartnerClient, refreshCatalog } from './partner.js';
import { OpenAIQueryParser } from './ai.js';
import { trustedProxyFor } from './trusted-proxy.js';

const serverDirectory = fileURLToPath(new URL('..', import.meta.url));
const configuration = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
const purchaseTerms = JSON.parse(await readFile(new URL('../purchase-terms.json', import.meta.url), 'utf8'));
let catalog = await loadCatalog(process.env.CATALOG_PATH || resolve(serverDirectory, configuration.catalogPath));
if (process.env.APP_MODE === 'live' && process.env.EKT_API_USERNAME && process.env.EKT_API_PASSWORD) {
  const client = new PartnerClient({
    detailUrl: process.env.EKT_PRODUCT_DETAIL_URL || configuration.partnerDetailUrl,
    username: process.env.EKT_API_USERNAME,
    password: process.env.EKT_API_PASSWORD,
  });
  const refreshed = await refreshCatalog(catalog, client);
  catalog = validateCatalog(refreshed.catalog);
  if (refreshed.failed) console.warn(`Partner API unavailable for ${refreshed.failed} products; using local catalog entries.`);
}
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
    budgetWindowMs: configuration.openai.budgetWindowMs,
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
const proxy = configuration.trustedProxyHost ? trustedProxyFor(configuration.trustedProxyHost) : undefined;
if (proxy) {
  await proxy.refresh();
  setInterval(() => void proxy.refresh(), 30000).unref();
}
createApp(catalog, { cartUrl: process.env.CART_URL || configuration.cartUrl, purchaseTerms, queryParser, staticDirectory, resourceLimits: configuration.resourceLimits, trustProxy: proxy?.isTrusted || configuration.trustProxy }).listen(port, () => console.log(`EKT assistant is listening on port ${port}${staticDirectory ? ' (API + frontend)' : ' (API)'}`));
