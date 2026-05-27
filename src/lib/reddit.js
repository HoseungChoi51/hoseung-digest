import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { URLSearchParams } from 'node:url';
import crypto from 'node:crypto';
import { TOKEN_PATH, ensureDir, DATA_DIR } from './paths.js';
import { redditEnv } from './config.js';
import { cachedJson } from './cache.js';

const REDDIT_AUTH_BASE = 'https://www.reddit.com/api/v1';
const REDDIT_API_BASE = 'https://oauth.reddit.com';
const SCOPES = ['identity', 'mysubreddits', 'read'];

async function readToken() {
  if (!existsSync(TOKEN_PATH)) return null;
  return JSON.parse(await readFile(TOKEN_PATH, 'utf8'));
}

async function writeToken(token) {
  await ensureDir(DATA_DIR);
  await writeFile(TOKEN_PATH, JSON.stringify(token, null, 2));
}

function basicAuth(clientId, clientSecret) {
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

async function requestToken(params) {
  const env = redditEnv();
  const response = await fetch(`${REDDIT_AUTH_BASE}/access_token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(env.clientId, env.clientSecret)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': env.userAgent
    },
    body: new URLSearchParams(params)
  });

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { error: bodyText };
  }

  if (!response.ok || body.error) {
    throw new Error(`Reddit OAuth failed: ${response.status} ${JSON.stringify(body)}`);
  }

  return body;
}

export function buildAuthUrl(state = crypto.randomBytes(16).toString('hex')) {
  const env = redditEnv();
  const params = new URLSearchParams({
    client_id: env.clientId,
    response_type: 'code',
    state,
    redirect_uri: env.redirectUri,
    duration: 'permanent',
    scope: SCOPES.join(' ')
  });

  return {
    state,
    url: `${REDDIT_AUTH_BASE}/authorize?${params.toString()}`
  };
}

export async function exchangeAuthorizationCode(code) {
  const env = redditEnv();
  const token = await requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.redirectUri
  });

  const saved = {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    token_type: token.token_type,
    scope: token.scope,
    expires_at: Date.now() + token.expires_in * 1000,
    updated_at: new Date().toISOString()
  };

  await writeToken(saved);
  return saved;
}

async function refreshAccessToken(token) {
  if (!token?.refresh_token) {
    throw new Error('No Reddit refresh token found. Run npm run auth:reddit first.');
  }

  const refreshed = await requestToken({
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token
  });

  const saved = {
    ...token,
    access_token: refreshed.access_token,
    token_type: refreshed.token_type || token.token_type,
    scope: refreshed.scope || token.scope,
    expires_at: Date.now() + refreshed.expires_in * 1000,
    updated_at: new Date().toISOString()
  };

  await writeToken(saved);
  return saved;
}

export async function tokenStatus() {
  const token = await readToken();
  return {
    configured: Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET),
    authenticated: Boolean(token?.refresh_token || token?.access_token),
    expiresAt: token?.expires_at ? new Date(token.expires_at).toISOString() : null,
    scopes: token?.scope || null
  };
}

async function ensureAccessToken() {
  const token = await readToken();
  if (!token) {
    throw new Error('Reddit is not authenticated. Run npm run auth:reddit or use Connect Reddit in the app.');
  }

  if (token.access_token && token.expires_at > Date.now() + 60_000) {
    return token.access_token;
  }

  const refreshed = await refreshAccessToken(token);
  return refreshed.access_token;
}

export async function redditGet(pathname, params = {}, config = null, options = {}) {
  const env = redditEnv();
  const accessToken = await ensureAccessToken();
  const url = new URL(`${REDDIT_API_BASE}${pathname}`);

  for (const [key, value] of Object.entries({ raw_json: 1, ...params })) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const run = async () => {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': env.userAgent
      }
    });

    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }

    if (!response.ok) {
      throw new Error(`Reddit API failed: ${response.status} ${JSON.stringify(body)}`);
    }

    return body;
  };

  if (options.cacheKey && config) {
    return cachedJson(options.cacheKey, config.cache.ttl_hours, run, {
      reuse: Boolean(config.cache.reuse)
    });
  }

  return run();
}

export async function getCurrentUser(config) {
  const data = await redditGet('/api/v1/me', {}, config, { cacheKey: 'me' });
  return data?.name ? `u/${data.name}` : 'unknown';
}

export async function getSubscribedSubreddits(config) {
  const names = [];
  let after = null;

  do {
    const data = await redditGet(
      '/subreddits/mine/subscriber',
      { limit: 100, after },
      config,
      { cacheKey: `subreddits:${after || 'first'}` }
    );

    const children = data?.data?.children || [];
    for (const child of children) {
      const name = child?.data?.display_name;
      if (name) names.push(name);
    }
    after = data?.data?.after || null;
  } while (after);

  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizePost(child) {
  const data = child?.data || {};
  const permalink = data.permalink
    ? `https://www.reddit.com${data.permalink}`
    : `https://www.reddit.com/comments/${data.id}`;

  return {
    id: data.id,
    name: data.name || data.id,
    subreddit: data.subreddit,
    title: data.title || '(untitled)',
    author: data.author,
    score: Number(data.score || 0),
    numComments: Number(data.num_comments || 0),
    createdUtc: Number(data.created_utc || 0),
    createdAt: new Date(Number(data.created_utc || 0) * 1000).toISOString(),
    permalink,
    externalUrl: data.url && data.url !== permalink ? data.url : null,
    domain: data.domain || 'reddit.com',
    isSelf: Boolean(data.is_self),
    stickied: Boolean(data.stickied),
    over18: Boolean(data.over_18),
    selftextExcerpt: data.selftext ? String(data.selftext).slice(0, 1200) : ''
  };
}

export async function fetchCandidatePosts(subredditNames, config) {
  const all = [];
  const requestChunks = chunk(subredditNames, config.digest.chunk_size);

  for (const names of requestChunks) {
    const joined = names.map(encodeURIComponent).join('+');
    let after = null;

    for (let page = 0; page < config.digest.pages_per_chunk; page += 1) {
      const data = await redditGet(
        `/r/${joined}/new`,
        { limit: config.digest.candidate_limit, after },
        config,
        { cacheKey: `new:${joined}:${after || 'first'}` }
      );

      for (const child of data?.data?.children || []) {
        all.push(normalizePost(child));
      }

      after = data?.data?.after || null;
      if (!after) break;
    }
  }

  return all;
}
