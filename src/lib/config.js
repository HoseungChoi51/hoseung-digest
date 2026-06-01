import { existsSync, readFileSync } from 'node:fs';
import { CONFIG_PATH, SOURCES_CONFIG_PATH } from './paths.js';
import { loadEnvFiles } from './env.js';
import { parseYaml } from './simple-yaml.js';

const DEFAULT_CONFIG = {
  timezone: 'Asia/Seoul',
  reddit: {
    user_agent: 'linux:hoseung-digest:v0.2.0'
  },
  poll: {
    rss_limit: 100,
    hn_limit: 40
  },
  digest: {
    max_posts_per_day: 25,
    max_items_per_tab: 20,
    top_items: 10,
    poll_first: true
  },
  subreddits: {
    include: [],
    exclude: [],
    pinned: []
  },
  ranking: {
    source_priority_weight: 100,
    score_weight: 1,
    comment_weight: 2,
    comments_per_hour_weight: 25,
    score_per_hour_weight: 8,
    recency_weight: 30,
    pinned_boost: 500,
    watchlist_boost: 120,
    negative_keyword_penalty: 120
  },
  enrichment: {
    enabled: true,
    max_new_posts: 50
  },
  summary: {
    enabled: true,
    model: 'gpt-5.4-mini',
    max_posts: 40,
    force_refresh: false
  },
  watchlist: {
    high_priority: [],
    negative_or_low_priority: []
  },
  cache: {
    ttl_hours: 48,
    reuse: false
  },
  server: {
    host: '127.0.0.1',
    port: 3847
  }
};

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, override) {
  const result = { ...base };

  for (const [key, value] of Object.entries(override || {})) {
    if (isObject(value) && isObject(base[key])) {
      result[key] = mergeDeep(base[key], value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return [String(value)];
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function loadConfig(configPath = CONFIG_PATH) {
  loadEnvFiles();

  const fileConfig = existsSync(configPath)
    ? parseYaml(readFileSync(configPath, 'utf8'))
    : {};

  const config = mergeDeep(DEFAULT_CONFIG, fileConfig);
  const sourceConfig = existsSync(SOURCES_CONFIG_PATH)
    ? parseYaml(readFileSync(SOURCES_CONFIG_PATH, 'utf8'))
    : {};

  config.subreddits.include = normalizeArray(config.subreddits.include);
  config.subreddits.exclude = normalizeArray(config.subreddits.exclude);
  config.subreddits.pinned = normalizeArray(config.subreddits.pinned);
  config.watchlist.high_priority = normalizeArray(config.watchlist.high_priority);
  config.watchlist.negative_or_low_priority = normalizeArray(config.watchlist.negative_or_low_priority);

  config.digest.max_posts_per_day = Number(config.digest.max_posts_per_day || 25);
  config.digest.max_items_per_tab = Number(config.digest.max_items_per_tab || 20);
  config.digest.top_items = Number(config.digest.top_items || 10);
  config.digest.poll_first = config.digest.poll_first !== false;
  config.poll.rss_limit = Number(config.poll.rss_limit || 100);
  config.poll.hn_limit = Number(config.poll.hn_limit || 40);
  config.enrichment.max_new_posts = Number(config.enrichment.max_new_posts || 0);
  config.summary.max_posts = Number(config.summary.max_posts || 0);
  config.summary.force_refresh = config.summary.force_refresh === true;
  config.cache.ttl_hours = Number(config.cache.ttl_hours || 48);
  config.server.port = Number(process.env.PORT || config.server.port || 3847);
  config.reddit.user_agent = process.env.REDDIT_USER_AGENT || config.reddit.user_agent;

  if (process.env.OPENAI_MODEL) {
    config.summary.model = process.env.OPENAI_MODEL;
  }

  config.sources = normalizeSources(sourceConfig.sources || {}, config);

  return config;
}

function sourceObjectToArray(sourceMap) {
  if (Array.isArray(sourceMap)) return sourceMap;
  return Object.entries(sourceMap || {}).map(([id, source]) => ({ id, ...source }));
}

function redditSources(config) {
  const excluded = new Set(config.subreddits.exclude.map((name) => name.toLowerCase()));
  const pinned = new Set(config.subreddits.pinned.map((name) => name.toLowerCase()));

  return config.subreddits.include
    .filter((name) => !excluded.has(name.toLowerCase()))
    .map((name) => ({
      id: `reddit_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      name: `r/${name}`,
      tab: 'reddit',
      adapter: 'reddit_rss',
      subreddit: name,
      url: `https://www.reddit.com/r/${encodeURIComponent(name)}/new/.rss?limit=${config.poll.rss_limit}`,
      priority: pinned.has(name.toLowerCase()) ? 0.95 : 0.75,
      poll_minutes: 30,
      enabled: true
    }));
}

export function normalizeSources(sourceMap, config) {
  const explicit = sourceObjectToArray(sourceMap);
  const merged = new Map();

  for (const source of [...explicit, ...redditSources(config)]) {
    if (!source?.id) continue;
    const minScore = optionalNumber(source.min_score);
    const minComments = optionalNumber(source.min_comments);

    merged.set(source.id, {
      id: String(source.id),
      name: String(source.name || source.id),
      tab: String(source.tab || 'dev'),
      adapter: String(source.adapter || 'rss'),
      url: source.url ? String(source.url) : '',
      feed: source.feed ? String(source.feed) : '',
      subreddit: source.subreddit ? String(source.subreddit) : '',
      priority: Number(source.priority ?? 0.5),
      poll_minutes: Number(source.poll_minutes || 60),
      enabled: normalizeBoolean(source.enabled, true),
      include_terms: normalizeArray(source.include_terms),
      exclude_terms: normalizeArray(source.exclude_terms),
      ...(minScore !== undefined ? { min_score: minScore } : {}),
      ...(minComments !== undefined ? { min_comments: minComments } : {})
    });
  }

  return [...merged.values()].filter((source) => source.enabled);
}
