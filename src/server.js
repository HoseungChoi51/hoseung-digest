#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './lib/config.js';
import { generateDigest } from './lib/digest.js';
import { listDigests, readDigest } from './lib/markdown.js';
import { pollSources } from './lib/poller.js';
import { itemStoreStats, queryStoredItems, readItemStore, setItemFeedback, sourceHealthList } from './lib/item-store.js';
import { deletePreference, preferenceStats, readPreferenceStore, upsertPreference } from './lib/preference-store.js';
import { PUBLIC_DIR } from './lib/paths.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const config = loadConfig();
let server = null;

function send(response, status, body, headers = {}) {
  response.writeHead(status, headers);
  response.end(body);
}

function json(response, status, body) {
  send(response, status, JSON.stringify(body, null, 2), {
    'Content-Type': 'application/json; charset=utf-8'
  });
}

function isLocalRequest(request) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
}

function scheduleServerStop() {
  const timer = setTimeout(() => {
    const forceExit = setTimeout(() => process.exit(0), 1000);
    forceExit.unref?.();
    server?.close(() => process.exit(0));
  }, 50);
  timer.unref?.();
}

function preferenceFeedbackPatch(label) {
  if (['must_read', 'useful'].includes(label)) {
    return { saved: true, hidden: false };
  }
  if (label === 'not_for_me') {
    return { hidden: true };
  }
  return null;
}

async function applyPreferenceFeedback(id, label) {
  const patch = preferenceFeedbackPatch(label);
  if (!patch) return null;

  try {
    return await setItemFeedback(id, patch);
  } catch (error) {
    if (error.message?.startsWith('Unknown item:')) return null;
    throw error;
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1_000_000) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === 'GET' && url.pathname === '/api/status') {
      const store = await readItemStore();
      const preferences = await readPreferenceStore();
      const configuredSourceIds = new Set(config.sources.map((source) => source.id));
      json(response, 200, {
        sources: {
          configured: config.sources.length,
          tabs: [...new Set(config.sources.map((source) => source.tab))],
          enrichmentEnabled: config.enrichment.enabled
        },
        openai: { configured: Boolean(process.env.OPENAI_API_KEY) },
        itemStore: itemStoreStats(store),
        preferences: preferenceStats(preferences),
        sourceHealth: sourceHealthList(store).filter((source) => configuredSourceIds.has(source.id)),
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

    if (request.method === 'POST' && url.pathname === '/api/shutdown') {
      if (!isLocalRequest(request)) {
        json(response, 403, { error: 'Shutdown is only available from localhost' });
        return;
      }
      json(response, 200, { stopping: true });
      scheduleServerStop();
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/preferences') {
      const preferences = await readPreferenceStore();
      json(response, 200, {
        preferences: preferences.items,
        stats: preferenceStats(preferences)
      });
      return;
    }

    if (request.method === 'POST' && url.pathname.startsWith('/api/preferences/')) {
      const id = decodeURIComponent(url.pathname.split('/').slice(3).join('/'));
      if (!id) {
        json(response, 404, { error: 'Unknown preference item' });
        return;
      }
      const payload = await readJsonBody(request);
      const result = await upsertPreference(id, payload);
      const item = await applyPreferenceFeedback(id, result.preference.label);
      json(response, 200, {
        preference: result.preference,
        item,
        stats: preferenceStats(result.store)
      });
      return;
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/api/preferences/')) {
      const id = decodeURIComponent(url.pathname.split('/').slice(3).join('/'));
      if (!id) {
        json(response, 404, { error: 'Unknown preference item' });
        return;
      }
      const result = await deletePreference(id);
      json(response, 200, {
        preference: result.preference,
        deleted: result.deleted,
        stats: preferenceStats(result.store)
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

    if (request.method === 'GET' && url.pathname === '/api/items') {
      const store = await readItemStore();
      const preferences = await readPreferenceStore();
      const result = queryStoredItems(store, {
        preferences: preferences.items,
        view: url.searchParams.get('view') || 'all',
        query: url.searchParams.get('q') || '',
        source: url.searchParams.get('source') || '',
        tab: url.searchParams.get('tab') || '',
        limit: url.searchParams.get('limit') || 100,
        offset: url.searchParams.get('offset') || 0
      });
      json(response, 200, {
        ...result,
        stats: {
          items: itemStoreStats(store),
          preferences: preferenceStats(preferences)
        }
      });
      return;
    }

    if (request.method === 'POST' && url.pathname.startsWith('/api/items/')) {
      const parts = url.pathname.split('/');
      const id = decodeURIComponent(parts[3] || '');
      const action = parts[4] || '';
      if (!id || !['save', 'unsave', 'hide', 'unhide'].includes(action)) {
        json(response, 404, { error: 'Unknown item action' });
        return;
      }
      const patch = {};
      if (action === 'save') patch.saved = true;
      if (action === 'unsave') patch.saved = false;
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
      const digest = await readDigest(date);
      const store = await readItemStore();
      digest.entries = digest.entries.map((entry) => ({
        ...entry,
        saved: Boolean(store.items?.[entry.id]?.saved),
        hidden: Boolean(store.items?.[entry.id]?.hidden)
      }));
      json(response, 200, digest);
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

server = createServer((request, response) => {
  route(request, response);
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`Daily Tech Digest running at http://${config.server.host}:${config.server.port}`);
});
