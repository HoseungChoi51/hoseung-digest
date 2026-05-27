import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { DATA_DIR, ITEM_STORE_PATH, POST_STORE_PATH, ensureDir } from './paths.js';
import { canonicalizeUrl, createItem } from './normalizer.js';

function emptyStore() {
  return {
    version: 2,
    last_poll_at: null,
    items: {},
    sources: {}
  };
}

function migratePost(post) {
  const source = {
    id: `reddit_${String(post.subreddit || 'unknown').toLowerCase()}`,
    name: `r/${post.subreddit || 'unknown'}`,
    tab: 'reddit',
    adapter: 'reddit_rss',
    priority: 0.75,
    subreddit: post.subreddit || ''
  };

  return createItem(
    source,
    {
      external_id: post.post_id,
      reddit_post_id: post.post_id,
      title: post.title,
      canonical_url: post.url,
      original_url: post.url,
      author: post.author,
      published_at: post.published,
      fetched_at: post.seen_at,
      raw_summary: post.snippet,
      score: post.score,
      comment_count: post.numComments,
      domain: post.domain,
      subreddit: post.subreddit
    },
    post.seen_at || new Date().toISOString()
  );
}

async function migrateLegacyPostStore() {
  if (!existsSync(POST_STORE_PATH)) return emptyStore();

  const legacy = JSON.parse(await readFile(POST_STORE_PATH, 'utf8'));
  const store = emptyStore();
  store.last_poll_at = legacy.last_poll_at || null;

  for (const post of Object.values(legacy.posts || {})) {
    const item = migratePost(post);
    store.items[item.id] = {
      ...item,
      first_seen_at: post.first_seen_at || post.seen_at || item.fetched_at,
      last_seen_at: post.last_seen_at || item.fetched_at
    };
  }

  return store;
}

export async function readItemStore(storePath = ITEM_STORE_PATH) {
  if (!existsSync(storePath)) {
    if (storePath !== ITEM_STORE_PATH) return emptyStore();
    return migrateLegacyPostStore();
  }

  const parsed = JSON.parse(await readFile(storePath, 'utf8'));
  return {
    ...emptyStore(),
    ...parsed,
    items: parsed.items || {},
    sources: parsed.sources || {}
  };
}

export async function writeItemStore(store, storePath = ITEM_STORE_PATH) {
  await ensureDir(DATA_DIR);
  await writeFile(storePath, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

export function listStoredItems(store) {
  return Object.values(store.items || {});
}

export function itemStoreStats(store) {
  const items = listStoredItems(store);
  const sources = Object.values(store.sources || {});
  return {
    lastPollAt: store.last_poll_at || null,
    totalItems: items.length,
    savedItems: items.filter((item) => item.saved).length,
    hiddenItems: items.filter((item) => item.hidden).length,
    sourceCount: sources.length,
    healthySources: sources.filter((source) => source.last_success_at).length,
    errorSources: sources.filter((source) => source.last_error).length
  };
}

export function sourceHealthList(store) {
  return Object.values(store.sources || {}).sort((a, b) => a.id.localeCompare(b.id));
}

export async function upsertItems(items, options = {}) {
  const storePath = options.storePath || ITEM_STORE_PATH;
  const store = options.store || (await readItemStore(storePath));
  const now = options.now || new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  const newItems = [];

  for (const item of items) {
    if (!item?.id) continue;

    const existing = store.items[item.id];
    if (!existing) {
      const saved = {
        ...item,
        canonical_url: canonicalizeUrl(item.canonical_url),
        fetched_at: item.fetched_at || now,
        first_seen_at: item.first_seen_at || item.fetched_at || now,
        last_seen_at: now
      };
      store.items[item.id] = saved;
      newItems.push(saved);
      inserted += 1;
      continue;
    }

    store.items[item.id] = {
      ...existing,
      ...item,
      canonical_url: canonicalizeUrl(item.canonical_url || existing.canonical_url),
      first_seen_at: existing.first_seen_at || existing.fetched_at,
      fetched_at: existing.fetched_at || item.fetched_at || now,
      last_seen_at: now,
      saved: existing.saved || Boolean(item.saved),
      hidden: existing.hidden || Boolean(item.hidden),
      llm_summary: item.llm_summary || existing.llm_summary || '',
      llm_reason: item.llm_reason || existing.llm_reason || '',
      llm_tags: item.llm_tags?.length ? item.llm_tags : existing.llm_tags || [],
      llm_entities: item.llm_entities?.length ? item.llm_entities : existing.llm_entities || [],
      llm_importance: item.llm_importance ?? existing.llm_importance ?? null
    };
    updated += 1;
  }

  store.last_poll_at = now;
  await writeItemStore(store, storePath);

  return { store, inserted, updated, newItems };
}

export async function updateSourceHealth(source, patch, options = {}) {
  const storePath = options.storePath || ITEM_STORE_PATH;
  const store = options.store || (await readItemStore(storePath));
  store.sources[source.id] = {
    id: source.id,
    name: source.name,
    tab: source.tab,
    adapter: source.adapter,
    url: source.url || source.feed || source.subreddit || '',
    priority: source.priority,
    poll_minutes: source.poll_minutes,
    ...(store.sources[source.id] || {}),
    ...patch
  };
  await writeItemStore(store, storePath);
  return store;
}

export async function setItemFeedback(id, feedback, options = {}) {
  const storePath = options.storePath || ITEM_STORE_PATH;
  const store = await readItemStore(storePath);
  if (!store.items[id]) {
    throw new Error(`Unknown item: ${id}`);
  }
  store.items[id] = {
    ...store.items[id],
    ...feedback
  };
  await writeItemStore(store, storePath);
  return store.items[id];
}
