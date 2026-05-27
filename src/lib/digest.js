import { purgeExpiredCache } from './cache.js';
import { loadConfig } from './config.js';
import { dateRangeForLocalDay, formatDateTime, todayInTimeZone } from './dates.js';
import { pollSubreddits } from './poller.js';
import { listStoredPosts, readPostStore } from './post-store.js';
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

function selectedSubreddits(config) {
  return applySubredditFilters(config.subreddits.include, config);
}

export function dedupePosts(posts) {
  const seen = new Set();
  const result = [];

  for (const post of posts) {
    const key = post.name || post.id || post.post_id || post.permalink || post.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(post);
  }

  return result;
}

export function filterPostsForDate(posts, dateString, timeZone) {
  const { start, end } = dateRangeForLocalDay(dateString, timeZone);
  const startMs = start.getTime();
  const endMs = end.getTime();

  return posts.filter((post) => {
    const createdMs = Date.parse(post.published || post.createdAt || post.seen_at);
    return createdMs >= startMs && createdMs < endMs && !post.stickied;
  });
}

export function derivePostMetrics(post, referenceDate) {
  const publishedMs = Date.parse(post.published || post.createdAt || post.seen_at || referenceDate.toISOString());
  const ageHours = Math.max(0.25, (referenceDate.getTime() - publishedMs) / 3_600_000);
  const numComments = Number(post.numComments ?? post.num_comments ?? 0);
  const score = Number(post.score ?? 0);

  return {
    ...post,
    score,
    numComments,
    commentsPerHour: numComments / ageHours,
    scorePerHour: score / ageHours,
    ageHours
  };
}

function safeDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'reddit.com';
  }
}

function toDigestPost(post) {
  return {
    ...post,
    id: post.post_id,
    name: `t3_${post.post_id}`,
    createdAt: post.published || post.seen_at,
    permalink: post.url,
    externalUrl: post.externalUrl && post.externalUrl !== post.url ? post.externalUrl : null,
    domain: post.domain || safeDomain(post.url),
    isSelf: Boolean(post.isSelf),
    selftextExcerpt: post.snippet || ''
  };
}

export function rankPosts(posts, config, dateString) {
  const pinned = lowerSet(config.subreddits.pinned);
  const { end } = dateRangeForLocalDay(dateString, config.timezone);
  const endMs = end.getTime();

  return [...posts]
    .map((post) => {
      const metrics = derivePostMetrics(post, end);
      const publishedMs = Date.parse(post.published || post.createdAt || post.seen_at);
      const ageHoursFromEnd = Math.max(0, (endMs - publishedMs) / 3_600_000);
      const recency = Math.max(0, 24 - ageHoursFromEnd) / 24;
      const rank =
        metrics.score * Number(config.ranking.score_weight || 0) +
        metrics.numComments * Number(config.ranking.comment_weight || 0) +
        metrics.commentsPerHour * Number(config.ranking.comments_per_hour_weight || 0) +
        metrics.scorePerHour * Number(config.ranking.score_per_hour_weight || 0) +
        recency * Number(config.ranking.recency_weight || 0) +
        (pinned.has(String(post.subreddit).toLowerCase()) ? Number(config.ranking.pinned_boost || 0) : 0);

      return { ...metrics, rank };
    })
    .sort((a, b) => b.rank - a.rank);
}

export async function generateDigest(options = {}) {
  const config = options.config || loadConfig();
  const date = options.date || todayInTimeZone(config.timezone);

  await purgeExpiredCache(config.cache.ttl_hours);

  let pollResult = null;
  if (config.digest.poll_first && !options.skipPoll) {
    pollResult = await pollSubreddits(config);
  }

  const store = pollResult?.store || (await readPostStore());
  const configuredSubreddits = selectedSubreddits(config);
  const storedPosts = listStoredPosts(store);
  const selectedSubreddits = new Set(configuredSubreddits.map((name) => name.toLowerCase()));
  if (!configuredSubreddits.length) {
    throw new Error('No subreddits configured. Add names to subreddits.include in config/reddit-digest.yml.');
  }

  const selectedPosts = rankPosts(
    dedupePosts(
      filterPostsForDate(
        storedPosts.filter((post) => selectedSubreddits.has(String(post.subreddit).toLowerCase())),
        date,
        config.timezone
      )
    ).map(toDigestPost),
    config,
    date
  ).slice(0, config.digest.max_posts_per_day);

  const summarized = await summarizePosts(selectedPosts, config);
  const digest = {
    date,
    generatedAt: formatDateTime(new Date()),
    timezone: config.timezone,
    sourceAccount: 'reddit-rss',
    configuredSubredditCount: configuredSubreddits.length,
    pollResult,
    summaryStatus: summarized.status,
    posts: summarized.posts
  };

  const filePath = await writeDigestMarkdown(digest);
  return { digest, filePath };
}
