import { existsSync } from 'node:fs';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { FETCH_CACHE_DIR, ensureDir } from './paths.js';

function cacheFileForKey(key) {
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return path.join(FETCH_CACHE_DIR, `${hash}.json`);
}

export async function cachedJson(key, ttlHours, fetcher, options = {}) {
  await ensureDir(FETCH_CACHE_DIR);
  const filePath = cacheFileForKey(key);
  const now = Date.now();
  const ttlMs = ttlHours * 60 * 60 * 1000;

  if (options.reuse && existsSync(filePath)) {
    const cached = JSON.parse(await readFile(filePath, 'utf8'));
    if (now - Date.parse(cached.fetched_at) < ttlMs) {
      return cached.data;
    }
  }

  const data = await fetcher();
  await writeFile(
    filePath,
    JSON.stringify({ fetched_at: new Date(now).toISOString(), key, data }, null, 2)
  );
  return data;
}

export async function purgeExpiredCache(ttlHours) {
  await ensureDir(FETCH_CACHE_DIR);
  const now = Date.now();
  const ttlMs = ttlHours * 60 * 60 * 1000;
  const files = await readdir(FETCH_CACHE_DIR);
  let removed = 0;

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(FETCH_CACHE_DIR, file);
    const info = await stat(filePath);
    if (now - info.mtimeMs > ttlMs) {
      await rm(filePath, { force: true });
      removed += 1;
    }
  }

  return removed;
}
