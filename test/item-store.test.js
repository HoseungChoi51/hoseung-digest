import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { itemStoreStats, readItemStore, setItemFeedback, upsertItems } from '../src/lib/item-store.js';

async function tempStorePath() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'reddit-digest-store-'));
  return path.join(dir, 'items.json');
}

test('upserts items while preserving first_seen_at', async () => {
  const storePath = await tempStorePath();

  await upsertItems(
    [
      {
        id: 'source:abc',
        source_id: 'source',
        source_name: 'Source',
        title: 'First',
        canonical_url: 'https://example.com/first?utm_source=x',
        published_at: '2026-05-27T00:00:00Z',
        fetched_at: '2026-05-27T01:00:00Z'
      }
    ],
    { storePath, now: '2026-05-27T01:00:00Z' }
  );

  await upsertItems(
    [
      {
        id: 'source:abc',
        source_id: 'source',
        source_name: 'Source',
        title: 'First updated',
        canonical_url: 'https://example.com/first',
        published_at: '2026-05-27T00:00:00Z',
        score: 10,
        comment_count: 5
      }
    ],
    { storePath, now: '2026-05-27T02:00:00Z' }
  );

  await setItemFeedback('source:abc', { saved: true }, { storePath });

  const store = await readItemStore(storePath);
  assert.equal(store.items['source:abc'].title, 'First updated');
  assert.equal(store.items['source:abc'].first_seen_at, '2026-05-27T01:00:00Z');
  assert.equal(store.items['source:abc'].last_seen_at, '2026-05-27T02:00:00Z');
  assert.equal(store.items['source:abc'].score, 10);
  assert.equal(store.items['source:abc'].saved, true);
  assert.equal(itemStoreStats(store).totalItems, 1);
});
