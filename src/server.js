#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './lib/config.js';
import { generateDigest } from './lib/digest.js';
import { listDigests, readDigest } from './lib/markdown.js';
import { pollSources } from './lib/poller.js';
import { itemStoreStats, readItemStore, setItemFeedback, sourceHealthList } from './lib/item-store.js';
import { PUBLIC_DIR } from './lib/paths.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const config = loadConfig();

function send(response, status, body, headers = {}) {
  response.writeHead(status, headers);
  response.end(body);
}

function json(response, status, body) {
  send(response, status, JSON.stringify(body, null, 2), {
    'Content-Type': 'application/json; charset=utf-8'
  });
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
      const store = await readItemStore();
      json(response, 200, {
        sources: {
          configured: config.sources.length,
          tabs: [...new Set(config.sources.map((source) => source.tab))],
          enrichmentEnabled: config.enrichment.enabled
        },
        openai: { configured: Boolean(process.env.OPENAI_API_KEY) },
        itemStore: itemStoreStats(store),
        sourceHealth: sourceHealthList(store),
        config: {
          timezone: config.timezone,
          maxPostsPerDay: config.digest.max_posts_per_day,
          summariesEnabled: config.summary.enabled,
          summaryModel: config.summary.model,
          summaryBudget: config.summary.max_posts
        }
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/poll') {
      const result = await pollSources(config);
      json(response, 200, {
        sources: result.sources.length,
        fetched: result.fetched,
        inserted: result.inserted,
        updated: result.updated,
        enriched: result.enriched,
        enrichmentErrors: result.enrichmentErrors,
        notModified: result.notModified,
        errors: result.errors,
        itemStore: itemStoreStats(result.store)
      });
      return;
    }

    if (request.method === 'POST' && url.pathname.startsWith('/api/items/')) {
      const parts = url.pathname.split('/');
      const id = decodeURIComponent(parts[3] || '');
      const action = parts[4] || '';
      if (!id || !['save', 'hide', 'unhide'].includes(action)) {
        json(response, 404, { error: 'Unknown item action' });
        return;
      }
      const patch = {};
      if (action === 'save') patch.saved = true;
      if (action === 'hide') patch.hidden = true;
      if (action === 'unhide') patch.hidden = false;
      const item = await setItemFeedback(id, patch);
      json(response, 200, { item });
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
      const result = await generateDigest({
        date,
        config,
        refreshSummaries: url.searchParams.get('refreshSummaries') === '1'
      });
      json(response, 200, {
        date: result.digest.date,
        filePath: result.filePath,
        postCount: result.digest.posts.length,
        summaryStatus: result.digest.summaryStatus
      });
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
  console.log(`Daily Tech Digest running at http://${config.server.host}:${config.server.port}`);
});
