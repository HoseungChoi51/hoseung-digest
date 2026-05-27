import { purgeExpiredCache } from './cache.js';
import { loadConfig } from './config.js';
import { dateRangeForLocalDay, formatDateTime, todayInTimeZone } from './dates.js';
import { fetchCandidatePosts, getCurrentUser, getSubscribedSubreddits } from './reddit.js';
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

export function dedupePosts(posts) {
  const seen = new Set();
  const result = [];

  for (const post of posts) {
    const key = post.name || post.id || post.permalink;
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
    const createdMs = post.createdUtc * 1000;
    return createdMs >= startMs && createdMs < endMs && !post.stickied;
  });
}

export function rankPosts(posts, config, dateString) {
  const pinned = lowerSet(config.subreddits.pinned);
  const { end } = dateRangeForLocalDay(dateString, config.timezone);
  const endMs = end.getTime();

  return [...posts]
    .map((post) => {
      const ageHoursFromEnd = Math.max(0, (endMs - post.createdUtc * 1000) / 3_600_000);
      const recency = Math.max(0, 24 - ageHoursFromEnd) / 24;
      const rank =
        post.score * config.ranking.score_weight +
        post.numComments * config.ranking.comment_weight +
        recency * config.ranking.recency_weight +
        (pinned.has(String(post.subreddit).toLowerCase()) ? config.ranking.pinned_boost : 0);

      return { ...post, rank };
    })
    .sort((a, b) => b.rank - a.rank);
}

export async function generateDigest(options = {}) {
  const config = options.config || loadConfig();
  const date = options.date || todayInTimeZone(config.timezone);

  await purgeExpiredCache(config.cache.ttl_hours);

  const [sourceAccount, subscribed] = await Promise.all([
    getCurrentUser(config),
    getSubscribedSubreddits(config)
  ]);

  const selectedSubreddits = applySubredditFilters(subscribed, config);
  if (!selectedSubreddits.length) {
    throw new Error('No subreddits selected after include/exclude filtering.');
  }

  const fetchedPosts = await fetchCandidatePosts(selectedSubreddits, config);
  const selectedPosts = rankPosts(
    dedupePosts(filterPostsForDate(fetchedPosts, date, config.timezone)),
    config,
    date
  ).slice(0, config.digest.max_posts_per_day);

  const summarized = await summarizePosts(selectedPosts, config);
  const digest = {
    date,
    generatedAt: formatDateTime(new Date()),
    timezone: config.timezone,
    sourceAccount,
    subscribedSubredditCount: subscribed.length,
    summaryStatus: summarized.status,
    posts: summarized.posts
  };

  const filePath = await writeDigestMarkdown(digest);
  return { digest, filePath };
}
