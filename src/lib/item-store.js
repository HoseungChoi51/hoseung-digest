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

function itemTimestamp(item) {
  return Date.parse(item.published_at || item.first_seen_at || item.fetched_at || item.last_seen_at || '') || 0;
}

function compact(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function itemLinks(item) {
  const links = {};
  const originalUrl = item.original_url || item.canonical_url || '';
  const openUrl = item.adapter === 'hackernews' && item.discussion_url
    ? item.discussion_url
    : item.canonical_url || originalUrl;

  if (openUrl) links.open = openUrl;
  if (originalUrl && originalUrl !== openUrl) links.original = originalUrl;
  if (item.discussion_url && item.discussion_url !== openUrl) links.discussion = item.discussion_url;

  return links;
}

export function libraryEntryForItem(item, preference = null) {
  return {
    id: item.id,
    title: compact(item.title, '(untitled)'),
    source: compact(item.source_name, item.source_id),
    sourceId: item.source_id || '',
    tab: compact(item.tab, 'dev'),
    section: compact(item.domain),
    domain: compact(item.domain),
    summary: compact(item.llm_summary || item.raw_summary, 'No summary generated.'),
    whyItMayMatter: compact(item.llm_reason) ? [compact(item.llm_reason)] : [],
    entities: normalizeList(item.llm_entities),
    tags: normalizeList(item.llm_tags),
    filterRuleIds: normalizeList(item.llm_filter_rule_ids),
    filterReason: compact(item.llm_filter_reason),
    links: itemLinks(item),
    saved: Boolean(item.saved),
    hidden: Boolean(item.hidden),
    preference,
    score: item.score ?? null,
    commentCount: item.comment_count ?? null,
    hotness: item.hotness ?? null,
    importance: item.llm_importance ?? null,
    publishedAt: item.published_at || null,
    firstSeenAt: item.first_seen_at || null,
    lastSeenAt: item.last_seen_at || null,
    fetchedAt: item.fetched_at || null
  };
}

function itemSearchText(item, preference = null) {
  return [
    item.title,
    item.source_name,
    item.source_id,
    item.tab,
    item.domain,
    item.raw_summary,
    item.llm_summary,
    item.llm_reason,
    ...(item.llm_tags || []),
    ...(item.llm_entities || []),
    preference?.label,
    preference?.note
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function itemMatchesLibraryView(item, preference, view) {
  if (view === 'saved') return Boolean(item.saved);
  if (view === 'hidden') return Boolean(item.hidden);
  if (view === 'preferred') return ['must_read', 'useful'].includes(preference?.label);
  return true;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

export function queryStoredItems(store, options = {}) {
  const preferences = options.preferences || {};
  const view = options.view || 'all';
  const query = String(options.query || '').trim().toLowerCase();
  const source = String(options.source || '').trim();
  const tab = String(options.tab || '').trim();
  const limit = boundedNumber(options.limit ?? 100, 100, 1, 500);
  const offset = boundedNumber(options.offset ?? 0, 0, 0, Number.MAX_SAFE_INTEGER);
  const allItems = listStoredItems(store);
  const sources = [...new Set(allItems.map((item) => item.source_name || item.source_id).filter(Boolean))].sort();
  const tabs = [...new Set(allItems.map((item) => item.tab).filter(Boolean))].sort();
  const filtered = allItems
    .filter((item) => {
      const preference = preferences[item.id] || null;
      if (!itemMatchesLibraryView(item, preference, view)) return false;
      if (source && (item.source_name || item.source_id) !== source) return false;
      if (tab && item.tab !== tab) return false;
      if (query && !itemSearchText(item, preference).includes(query)) return false;
      return true;
    })
    .sort((a, b) => itemTimestamp(b) - itemTimestamp(a));

  return {
    items: filtered.slice(offset, offset + limit).map((item) => libraryEntryForItem(item, preferences[item.id] || null)),
    total: filtered.length,
    offset,
    limit,
    sources,
    tabs
  };
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
    ...(store.sources[source.id] || {}),
    id: source.id,
    name: source.name,
    tab: source.tab,
    adapter: source.adapter,
    url: source.url || source.feed || source.subreddit || '',
    priority: source.priority,
    poll_minutes: source.poll_minutes,
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
