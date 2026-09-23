import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadCatalog } from './catalog.js';

const serverDirectory = fileURLToPath(new URL('..', import.meta.url));
const configuration = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
const catalog = await loadCatalog(process.env.CATALOG_PATH ?? resolve(serverDirectory, configuration.catalogPath));
const port = Number(process.env.PORT ?? configuration.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
createApp(catalog).listen(port, () => console.log(`EKT assistant API is listening on port ${port}`));
