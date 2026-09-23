import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadCatalog, validateCatalog } from './catalog.js';
import { PartnerClient, refreshCatalog } from './partner.js';
import { NvidiaQueryParser } from './ai.js';

const serverDirectory = fileURLToPath(new URL('..', import.meta.url));
const configuration = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
const purchaseTerms = JSON.parse(await readFile(new URL('../purchase-terms.json', import.meta.url), 'utf8'));
let catalog = await loadCatalog(process.env.CATALOG_PATH ?? resolve(serverDirectory, configuration.catalogPath));
if (process.env.APP_MODE === 'live' && process.env.EKT_API_USERNAME && process.env.EKT_API_PASSWORD) {
  const client = new PartnerClient({
    detailUrl: process.env.EKT_PRODUCT_DETAIL_URL ?? configuration.partnerDetailUrl,
    username: process.env.EKT_API_USERNAME,
    password: process.env.EKT_API_PASSWORD,
  });
  const refreshed = await refreshCatalog(catalog, client);
  catalog = validateCatalog(refreshed.catalog);
  if (refreshed.failed) console.warn(`Partner API unavailable for ${refreshed.failed} products; using local catalog entries.`);
}
const port = Number(process.env.PORT ?? configuration.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const queryParser = process.env.APP_MODE === 'live' && process.env.NVIDIA_API_KEY
  ? new NvidiaQueryParser({
    url: process.env.NVIDIA_CHAT_COMPLETIONS_URL ?? configuration.nvidia.chatCompletionsUrl,
    model: process.env.NVIDIA_MODEL ?? configuration.nvidia.model,
    apiKey: process.env.NVIDIA_API_KEY,
    maxOutputTokens: configuration.nvidia.maxOutputTokens,
    maxCalls: configuration.nvidia.maxCalls,
  })
  : undefined;
createApp(catalog, { cartUrl: process.env.CART_URL ?? configuration.cartUrl, purchaseTerms, queryParser }).listen(port, () => console.log(`EKT assistant API is listening on port ${port}`));
