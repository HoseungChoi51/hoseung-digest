import crypto from 'node:crypto';

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid'
]);

function hash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 16);
}

export function canonicalizeUrl(value = '') {
  if (!value) return '';

  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_') || TRACKING_PARAMS.has(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase();
    const text = url.toString();
    return text.endsWith('/') ? text.slice(0, -1) : text;
  } catch {
    return String(value).trim();
  }
}

export function urlDomain(value = '') {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function normalizeTitle(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/^ask hn:\s*/i, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stableItemId(sourceId, externalId, canonicalUrl, title) {
  return `${sourceId}:${hash(externalId || canonicalUrl || normalizeTitle(title))}`;
}

export function createItem(source, raw, fetchedAt = new Date().toISOString()) {
  const canonicalUrl = canonicalizeUrl(raw.canonical_url || raw.url || raw.link || '');
  const externalId = String(raw.external_id || raw.id || canonicalUrl || raw.title || '').trim();

  return {
    id: raw.id || stableItemId(source.id, externalId, canonicalUrl, raw.title),
    source_id: source.id,
    source_name: source.name,
    adapter: source.adapter,
    external_id: externalId,
    canonical_url: canonicalUrl,
    title: String(raw.title || '(untitled)').replace(/\s+/g, ' ').trim(),
    author: raw.author || '',
    published_at: raw.published_at || raw.published || raw.updated_at || fetchedAt,
    fetched_at: fetchedAt,
    raw_summary: raw.raw_summary || raw.summary || raw.snippet || '',
    tab: raw.tab || source.tab || 'dev',
    score: raw.score ?? null,
    comment_count: raw.comment_count ?? raw.numComments ?? null,
    comments_per_hour: raw.comments_per_hour ?? null,
    score_per_hour: raw.score_per_hour ?? null,
    hotness: raw.hotness ?? null,
    llm_importance: raw.llm_importance ?? null,
    llm_summary: raw.llm_summary || '',
    llm_reason: raw.llm_reason || '',
    llm_tags: raw.llm_tags || [],
    llm_entities: raw.llm_entities || [],
    cluster_id: raw.cluster_id || '',
    hidden: Boolean(raw.hidden),
    saved: Boolean(raw.saved),
    source_priority: Number(source.priority ?? raw.source_priority ?? 0.5),
    subreddit: raw.subreddit || source.subreddit || '',
    reddit_post_id: raw.reddit_post_id || raw.post_id || '',
    domain: raw.domain || urlDomain(canonicalUrl),
    original_url: raw.original_url || raw.url || canonicalUrl,
    discussion_url: raw.discussion_url || raw.comments_url || ''
  };
}
