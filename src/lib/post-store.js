import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { POST_STORE_PATH, DATA_DIR, ensureDir } from './paths.js';

function emptyStore() {
  return {
    version: 1,
    last_poll_at: null,
    posts: {}
  };
}

export async function readPostStore(storePath = POST_STORE_PATH) {
  if (!existsSync(storePath)) return emptyStore();
  const parsed = JSON.parse(await readFile(storePath, 'utf8'));
  return {
    ...emptyStore(),
    ...parsed,
    posts: parsed.posts || {}
  };
}

export async function writePostStore(store, storePath = POST_STORE_PATH) {
  await ensureDir(DATA_DIR);
  await writeFile(storePath, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

export function listStoredPosts(store) {
  return Object.values(store.posts || {});
}

export function postStoreStats(store) {
  const posts = listStoredPosts(store);
  const enriched = posts.filter((post) => post.enriched_at).length;
  return {
    lastPollAt: store.last_poll_at || null,
    totalPosts: posts.length,
    enrichedPosts: enriched
  };
}

export async function upsertPosts(posts, options = {}) {
  const storePath = options.storePath || POST_STORE_PATH;
  const store = options.store || (await readPostStore(storePath));
  const now = options.now || new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  const newPosts = [];

  for (const post of posts) {
    if (!post.post_id) continue;

    const existing = store.posts[post.post_id];
    if (!existing) {
      const saved = {
        ...post,
        seen_at: post.seen_at || now,
        first_seen_at: post.seen_at || now,
        last_seen_at: now
      };
      store.posts[post.post_id] = saved;
      newPosts.push(saved);
      inserted += 1;
      continue;
    }

    store.posts[post.post_id] = {
      ...existing,
      ...post,
      seen_at: existing.seen_at,
      first_seen_at: existing.first_seen_at || existing.seen_at,
      last_seen_at: now,
      score: post.score ?? existing.score,
      numComments: post.numComments ?? existing.numComments,
      enriched_at: post.enriched_at || existing.enriched_at,
      enrichment_error: post.enrichment_error || existing.enrichment_error
    };
    updated += 1;
  }

  store.last_poll_at = now;
  await writePostStore(store, storePath);

  return { store, inserted, updated, newPosts };
}
