import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadCatalog } from './catalog.js';
import { PartnerClient, loadPartnerCatalog } from './partner.js';
import { OpenAIQueryParser } from './ai.js';

const serverDirectory = fileURLToPath(new URL('..', import.meta.url));
const configuration = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
const purchaseTerms = JSON.parse(await readFile(new URL('../purchase-terms.json', import.meta.url), 'utf8'));
const usePartner = process.env.APP_MODE === 'live' && process.env.EKT_API_USERNAME && process.env.EKT_API_PASSWORD;
const catalog = usePartner ? [] : await loadCatalog(process.env.CATALOG_PATH || resolve(serverDirectory, configuration.catalogPath));
const catalogState = { status: usePartner ? 'loading' : 'ready', source: usePartner ? 'partner' : 'local', products: catalog.length };
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
createApp(catalog, { cartUrl: process.env.CART_URL || configuration.cartUrl, purchaseTerms, queryParser, uploads: configuration.uploads, staticDirectory, catalogState }).listen(port, () => console.log(`EKT assistant is listening on port ${port}${staticDirectory ? ' (API + frontend)' : ' (API)'}`));

if (usePartner) {
  const client = new PartnerClient({
    detailUrl: process.env.EKT_PRODUCT_DETAIL_URL || configuration.partnerDetailUrl,
    productsUrl: configuration.partnerProductsUrl,
    username: process.env.EKT_API_USERNAME,
    password: process.env.EKT_API_PASSWORD,
    timeoutMs: configuration.partner?.timeoutMs,
  });
  console.log('Loading the EKT catalog: product pages, then individual details. This can take several minutes.');
  loadPartnerCatalog(client, {
    ...configuration.partner,
    onProgress: ({ stage, pages, total, completed, failed }) => {
      Object.assign(catalogState, stage === 'list' ? { pages, listed: total } : { completed, failed });
      if (stage === 'list' && pages % 50 === 0) console.log(`EKT catalog: ${pages} pages, ${total} product IDs.`);
      if (stage === 'details' && (completed % 100 === 0 || completed === total)) console.log(`EKT details: ${completed}/${total}, unavailable: ${failed}.`);
    },
  }).then((result) => {
    for (const product of result.catalog) catalog.push(product);
    Object.assign(catalogState, { status: 'ready', products: catalog.length, failed: result.failed, loadedAt: new Date().toISOString() });
    console.log(`EKT catalog ready: ${catalog.length} real products; excluded: ${result.failed}.`);
  }).catch(() => {
    catalogState.status = 'failed';
    // Do not log provider responses or errors that may contain credentials.
    console.error('EKT catalog could not be loaded. Check API availability and credentials, then restart. Demo data was not substituted.');
  });
}
