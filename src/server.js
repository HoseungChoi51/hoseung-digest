#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from './lib/config.js';
import { generateDigest } from './lib/digest.js';
import { listDigests, readDigest } from './lib/markdown.js';
import { buildAuthUrl, exchangeAuthorizationCode, tokenStatus } from './lib/reddit.js';
import { PUBLIC_DIR } from './lib/paths.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const config = loadConfig();
const oauthStates = new Set();

function send(response, status, body, headers = {}) {
  response.writeHead(status, headers);
  response.end(body);
}

function json(response, status, body) {
  send(response, status, JSON.stringify(body, null, 2), {
    'Content-Type': 'application/json; charset=utf-8'
  });
}

function redirect(response, location) {
  send(response, 302, '', { Location: location });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const normalized = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    send(response, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  const ext = path.extname(filePath);
  send(response, 200, await readFile(filePath), {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
  });
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === 'GET' && url.pathname === '/api/status') {
      json(response, 200, {
        reddit: await tokenStatus(),
        openai: { configured: Boolean(process.env.OPENAI_API_KEY) },
        config: {
          timezone: config.timezone,
          maxPostsPerDay: config.digest.max_posts_per_day,
          summariesEnabled: config.summary.enabled
        }
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/digests') {
      json(response, 200, { digests: await listDigests() });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/digests/')) {
      const date = url.pathname.split('/').pop();
      json(response, 200, await readDigest(date));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/generate') {
      const date = url.searchParams.get('date') || undefined;
      const result = await generateDigest({ date, config });
      json(response, 200, {
        date: result.digest.date,
        filePath: result.filePath,
        postCount: result.digest.posts.length,
        summaryStatus: result.digest.summaryStatus
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/oauth/reddit/start') {
      const state = crypto.randomBytes(16).toString('hex');
      oauthStates.add(state);
      const auth = buildAuthUrl(state);
      redirect(response, auth.url);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/oauth/reddit/callback') {
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) throw new Error(`Reddit OAuth returned: ${error}`);
      if (!state || !oauthStates.has(state)) throw new Error('Invalid OAuth state.');
      if (!code) throw new Error('Missing OAuth code.');

      oauthStates.delete(state);
      await exchangeAuthorizationCode(code);
      redirect(response, '/?auth=reddit-ok');
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    json(response, 500, { error: error.message });
  }
}

const server = createServer((request, response) => {
  route(request, response);
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`Reddit Digest running at http://${config.server.host}:${config.server.port}`);
});
