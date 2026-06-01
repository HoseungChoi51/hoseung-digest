import { purgeExpiredCache } from './cache.js';
import { loadConfig } from './config.js';
import { formatDateTime, todayInTimeZone } from './dates.js';
import { pollSources } from './poller.js';
import { listStoredItems, readItemStore, upsertItems } from './item-store.js';
import {
  dedupeItems,
  filterItemsBySourceConfig,
  filterItemsForDate,
  groupDigestItems,
  rankItems
} from './ranker.js';
import { readPreferenceStore } from './preference-store.js';
import { summarizePosts } from './summarizer.js';
import { writeDigestMarkdown } from './markdown.js';

function lowerSet(items) {
  return new Set((items || []).map((item) => String(item).toLowerCase()));
}

function hasPositivePreference(item, preferenceStore) {
  return ['must_read', 'useful'].includes(preferenceStore.items?.[item.id]?.label);
}

function retainPositivePreferences(items, maxItems, preferenceStore) {
  const retained = [];
  const regular = [];
  const seen = new Set();

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (hasPositivePreference(item, preferenceStore)) {
      retained.push(item);
    } else {
      regular.push(item);
    }
  }

  return [...retained, ...regular.slice(0, Math.max(0, maxItems - retained.length))];
}

export function applySubredditFilters(subreddits, config) {
  const include = lowerSet(config.subreddits.include);
  const exclude = lowerSet(config.subreddits.exclude);

  return subreddits.filter((name) => {
    const lower = name.toLowerCase();
    if (include.size && !include.has(lower)) return false;
    return !exclude.has(lower);
  });
}

export async function generateDigest(options = {}) {
  const config = options.config || loadConfig();
  const date = options.date || todayInTimeZone(config.timezone);

  await purgeExpiredCache(config.cache.ttl_hours);

  let pollResult = null;
  if (config.digest.poll_first && !options.skipPoll) {
    pollResult = await pollSources(config);
  }

  let store = pollResult?.store || (await readItemStore());
  const preferenceStore = await readPreferenceStore();
  if (!config.sources.length) {
    throw new Error('No sources configured. Add source records to config/sources.yml.');
  }

  const selectedItems = rankItems(
    dedupeItems(
      filterItemsBySourceConfig(filterItemsForDate(listStoredItems(store), date, config.timezone), config)
    ),
    config,
    date,
    preferenceStore
  );

  const summarized = await summarizePosts(selectedItems.slice(0, config.summary.max_posts), config, {
    forceRefresh: Boolean(options.refreshSummaries)
  });
  if (summarized.posts.length) {
    const updated = await upsertItems(summarized.posts, { store, now: new Date().toISOString() });
    store = updated.store;
  }

  const summarizedById = new Map(summarized.posts.map((item) => [item.id, item]));
  const visibleItems = selectedItems
    .map((item) => summarizedById.get(item.id) || item)
    .filter((item) => item.llm_skip !== true || hasPositivePreference(item, preferenceStore));
  const finalItems = retainPositivePreferences(
    visibleItems,
    Math.max(config.digest.max_posts_per_day, config.digest.top_items),
    preferenceStore
  );
  const groups = groupDigestItems(finalItems, config);
  const digest = {
    date,
    generatedAt: formatDateTime(new Date()),
    timezone: config.timezone,
    sourceAccount: 'rss-hn-reddit',
    configuredSourceCount: config.sources.length,
    pollResult,
    summaryStatus: summarized.status,
    posts: finalItems,
    groups
  };

  const filePath = await writeDigestMarkdown(digest);
  return { digest, filePath };
}
