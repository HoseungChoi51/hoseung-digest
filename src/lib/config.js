import { existsSync, readFileSync } from 'node:fs';
import { CONFIG_PATH } from './paths.js';
import { loadEnvFiles } from './env.js';
import { parseYaml } from './simple-yaml.js';

const DEFAULT_CONFIG = {
  timezone: 'Asia/Seoul',
  digest: {
    max_posts_per_day: 25,
    candidate_limit: 100,
    pages_per_chunk: 2,
    chunk_size: 25
  },
  subreddits: {
    include: [],
    exclude: [],
    pinned: []
  },
  ranking: {
    score_weight: 1,
    comment_weight: 3,
    recency_weight: 30,
    pinned_boost: 500
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
  config.digest.candidate_limit = Number(config.digest.candidate_limit || 100);
  config.digest.pages_per_chunk = Number(config.digest.pages_per_chunk || 1);
  config.digest.chunk_size = Number(config.digest.chunk_size || 25);
  config.summary.max_posts = Number(config.summary.max_posts || 0);
  config.cache.ttl_hours = Number(config.cache.ttl_hours || 48);
  config.server.port = Number(process.env.PORT || config.server.port || 3847);

  if (process.env.OPENAI_MODEL) {
    config.summary.model = process.env.OPENAI_MODEL;
  }

  return config;
}

export function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function redditEnv() {
  return {
    clientId: getRequiredEnv('REDDIT_CLIENT_ID'),
    clientSecret: getRequiredEnv('REDDIT_CLIENT_SECRET'),
    redirectUri: getRequiredEnv('REDDIT_REDIRECT_URI'),
    userAgent: getRequiredEnv('REDDIT_USER_AGENT')
  };
}
