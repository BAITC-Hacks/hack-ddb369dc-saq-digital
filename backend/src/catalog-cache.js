import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { validateCatalog } from './catalog.js';

function validateSnapshot(snapshot, sourceKey) {
  if (!snapshot || snapshot.version !== 1 || typeof sourceKey !== 'string' || !sourceKey
    || snapshot.sourceKey !== sourceKey || typeof snapshot.loadedAt !== 'string') {
    throw new Error('Incompatible catalog cache');
  }

  const loadedAt = Date.parse(snapshot.loadedAt);
  if (!Number.isFinite(loadedAt) || new Date(loadedAt).toISOString() !== snapshot.loadedAt
    || loadedAt > Date.now() + 60_000) {
    throw new Error('Invalid catalog cache timestamp');
  }

  const catalog = validateCatalog(snapshot.catalog);
  if (catalog.length === 0 || catalog.some((product) => !product.id)) {
    throw new Error('Catalog cache must contain partner products');
  }
  return { catalog, loadedAt: snapshot.loadedAt };
}

export async function readCatalogCache(path, sourceKey) {
  try {
    return validateSnapshot(JSON.parse(await readFile(path, 'utf8')), sourceKey);
  } catch {
    // A cache is optional: missing, unreadable or incompatible files trigger a fresh import.
    return null;
  }
}

export async function writeCatalogCache(path, sourceKey, snapshot) {
  const validated = validateSnapshot({ ...snapshot, version: 1, sourceKey }, sourceKey);
  const content = JSON.stringify({ version: 1, sourceKey, ...validated });
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { flag: 'wx', mode: 0o600 });
    // Replace only a completely written snapshot; readers never see a partial JSON file.
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}
