import { dateRangeForLocalDay } from './dates.js';
import { normalizeTitle } from './normalizer.js';

const TAB_HALF_LIFE_HOURS = {
  hw: 36,
  reddit: 12,
  dev: 24,
  ai_agent: 18
};

function lowerTerms(items = []) {
  return items.map((item) => String(item).toLowerCase()).filter(Boolean);
}

function termHits(item, terms) {
  const haystack = `${item.title} ${item.raw_summary} ${item.source_name}`.toLowerCase();
  return terms.filter((term) => haystack.includes(term));
}

export function deriveItemMetrics(item, referenceDate = new Date()) {
  const publishedMs = Date.parse(item.published_at || item.fetched_at || referenceDate.toISOString());
  const ageHours = Math.max(0.25, (referenceDate.getTime() - publishedMs) / 3_600_000);
  const score = Number(item.score || 0);
  const commentCount = Number(item.comment_count || 0);
  const commentsPerHour = commentCount / ageHours;
  const scorePerHour = score / ageHours;

  return {
    ...item,
    score,
    comment_count: commentCount,
    comments_per_hour: commentsPerHour,
    score_per_hour: scorePerHour,
    age_hours: ageHours
  };
}

export function filterItemsForDate(items, dateString, timeZone) {
  const { start, end } = dateRangeForLocalDay(dateString, timeZone);
  const startMs = start.getTime();
  const endMs = end.getTime();

  return items.filter((item) => {
    if (item.hidden) return false;
    const publishedMs = Date.parse(item.published_at || item.fetched_at);
    return publishedMs >= startMs && publishedMs < endMs;
  });
}

export function dedupeItems(items) {
  const seenUrls = new Set();
  const seenExternal = new Set();
  const seenTitles = new Set();
  const result = [];

  for (const item of items) {
    const canonicalUrl = item.canonical_url || '';
    const externalKey = `${item.source_id}:${item.external_id || ''}`;
    const titleKey = normalizeTitle(item.title);

    if (canonicalUrl && seenUrls.has(canonicalUrl)) continue;
    if (item.external_id && seenExternal.has(externalKey)) continue;
    if (titleKey && seenTitles.has(titleKey)) continue;

    if (canonicalUrl) seenUrls.add(canonicalUrl);
    if (item.external_id) seenExternal.add(externalKey);
    if (titleKey) seenTitles.add(titleKey);
    result.push(item);
  }

  return result;
}

export function rankItems(items, config, dateString) {
  const { end } = dateRangeForLocalDay(dateString, config.timezone);
  const positiveTerms = lowerTerms(config.watchlist.high_priority);
  const negativeTerms = lowerTerms(config.watchlist.negative_or_low_priority);

  return items
    .map((item) => {
      const metrics = deriveItemMetrics(item, end);
      const halfLife = TAB_HALF_LIFE_HOURS[metrics.tab] || 24;
      const recency = Math.exp(-metrics.age_hours / halfLife);
      const engagement =
        Math.log(metrics.score + 1) +
        Math.log(metrics.comment_count + 1) +
        metrics.comments_per_hour;
      const watchlistHits = termHits(metrics, positiveTerms);
      const negativeHits = termHits(metrics, negativeTerms);
      const llmBoost = Number(metrics.llm_importance || 0) * 25;
      const hotness =
        Number(metrics.source_priority || 0.5) * Number(config.ranking.source_priority_weight || 0) +
        metrics.score * Number(config.ranking.score_weight || 0) +
        metrics.comment_count * Number(config.ranking.comment_weight || 0) +
        metrics.comments_per_hour * Number(config.ranking.comments_per_hour_weight || 0) +
        metrics.score_per_hour * Number(config.ranking.score_per_hour_weight || 0) +
        recency * Number(config.ranking.recency_weight || 0) +
        engagement * 10 +
        watchlistHits.length * Number(config.ranking.watchlist_boost || 0) -
        negativeHits.length * Number(config.ranking.negative_keyword_penalty || 0) +
        llmBoost;

      return {
        ...metrics,
        hotness,
        watchlist_hits: watchlistHits,
        negative_hits: negativeHits
      };
    })
    .sort((a, b) => b.hotness - a.hotness);
}

export function groupDigestItems(items, config) {
  const top = items.slice(0, config.digest.top_items);
  const byTab = new Map();

  for (const item of items) {
    if (!byTab.has(item.tab)) byTab.set(item.tab, []);
    const tabItems = byTab.get(item.tab);
    if (tabItems.length < config.digest.max_items_per_tab) {
      tabItems.push(item);
    }
  }

  return { top, byTab };
}
