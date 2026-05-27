import { purgeExpiredCache } from './cache.js';
import { loadConfig } from './config.js';
import { formatDateTime, todayInTimeZone } from './dates.js';
import { pollSources } from './poller.js';
import { listStoredItems, readItemStore, upsertItems } from './item-store.js';
import { dedupeItems, filterItemsForDate, groupDigestItems, rankItems } from './ranker.js';
import { summarizePosts } from './summarizer.js';
import { writeDigestMarkdown } from './markdown.js';

function lowerSet(items) {
  return new Set((items || []).map((item) => String(item).toLowerCase()));
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
  if (!config.sources.length) {
    throw new Error('No sources configured. Add source records to config/sources.yml.');
  }

  const selectedItems = rankItems(
    dedupeItems(filterItemsForDate(listStoredItems(store), date, config.timezone)),
    config,
    date
  );

  const summarized = await summarizePosts(selectedItems.slice(0, config.summary.max_posts), config, {
    forceRefresh: Boolean(options.refreshSummaries)
  });
  if (summarized.posts.length) {
    const updated = await upsertItems(summarized.posts, { store, now: new Date().toISOString() });
    store = updated.store;
  }

  const summarizedById = new Map(summarized.posts.map((item) => [item.id, item]));
  const finalItems = selectedItems
    .map((item) => summarizedById.get(item.id) || item)
    .filter((item) => item.llm_skip !== true)
    .slice(0, Math.max(config.digest.max_posts_per_day, config.digest.top_items));
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
