import { existsSync, readFileSync } from 'node:fs';
import { CONFIG_PATH } from './paths.js';
import { loadEnvFiles } from './env.js';
import { parseYaml } from './simple-yaml.js';

const DEFAULT_CONFIG = {
  timezone: 'Asia/Seoul',
  reddit: {
    user_agent: 'linux:hoseung-digest:v0.2.0'
  },
  poll: {
    rss_limit: 100
  },
  digest: {
    max_posts_per_day: 25,
    poll_first: true
  },
  subreddits: {
    include: [],
    exclude: [],
    pinned: []
  },
  ranking: {
    score_weight: 1,
    comment_weight: 2,
    comments_per_hour_weight: 25,
    score_per_hour_weight: 8,
    recency_weight: 30,
    pinned_boost: 500
  },
  enrichment: {
    enabled: true,
    max_new_posts: 50
  },
  summary: {
    enabled: true,
    model: 'gpt-5.4-mini',
    max_posts: 10
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

export function loadConfig(configPath = CONFIG_PATH) {
  loadEnvFiles();

  const fileConfig = existsSync(configPath)
    ? parseYaml(readFileSync(configPath, 'utf8'))
    : {};

  const config = mergeDeep(DEFAULT_CONFIG, fileConfig);

  config.subreddits.include = normalizeArray(config.subreddits.include);
  config.subreddits.exclude = normalizeArray(config.subreddits.exclude);
  config.subreddits.pinned = normalizeArray(config.subreddits.pinned);

  config.digest.max_posts_per_day = Number(config.digest.max_posts_per_day || 25);
  config.digest.poll_first = config.digest.poll_first !== false;
  config.poll.rss_limit = Number(config.poll.rss_limit || 100);
  config.enrichment.max_new_posts = Number(config.enrichment.max_new_posts || 0);
  config.summary.max_posts = Number(config.summary.max_posts || 0);
  config.cache.ttl_hours = Number(config.cache.ttl_hours || 48);
  config.server.port = Number(process.env.PORT || config.server.port || 3847);
  config.reddit.user_agent = process.env.REDDIT_USER_AGENT || config.reddit.user_agent;

  if (process.env.OPENAI_MODEL) {
    config.summary.model = process.env.OPENAI_MODEL;
  }

  return config;
}
