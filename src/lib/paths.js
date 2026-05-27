import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..', '..');
export const CONFIG_PATH = path.join(ROOT_DIR, 'config', 'reddit-digest.yml');
export const DATA_DIR = path.join(ROOT_DIR, '.data');
export const FETCH_CACHE_DIR = path.join(DATA_DIR, 'fetch-cache');
export const POST_STORE_PATH = path.join(DATA_DIR, 'posts.json');
export const DIGEST_DIR = path.join(ROOT_DIR, 'content', 'digests');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

export function resolveRoot(...parts) {
  return path.join(ROOT_DIR, ...parts);
}

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}
