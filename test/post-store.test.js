import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { postStoreStats, readPostStore, upsertPosts } from '../src/lib/post-store.js';

async function tempStorePath() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'reddit-digest-store-'));
  return path.join(dir, 'posts.json');
}

test('upserts posts while preserving first seen_at', async () => {
  const storePath = await tempStorePath();

  await upsertPosts(
    [
      {
        post_id: 'abc',
        subreddit: 'programming',
        title: 'First',
        url: 'https://www.reddit.com/r/programming/comments/abc/first/',
        published: '2026-05-27T00:00:00Z',
        seen_at: '2026-05-27T01:00:00Z'
      }
    ],
    { storePath, now: '2026-05-27T01:00:00Z' }
  );

  await upsertPosts(
    [
      {
        post_id: 'abc',
        subreddit: 'programming',
        title: 'First updated',
        url: 'https://www.reddit.com/r/programming/comments/abc/first/',
        published: '2026-05-27T00:00:00Z',
        score: 10,
        numComments: 5
      }
    ],
    { storePath, now: '2026-05-27T02:00:00Z' }
  );

  const store = await readPostStore(storePath);
  assert.equal(store.posts.abc.title, 'First updated');
  assert.equal(store.posts.abc.seen_at, '2026-05-27T01:00:00Z');
  assert.equal(store.posts.abc.last_seen_at, '2026-05-27T02:00:00Z');
  assert.equal(store.posts.abc.score, 10);
  assert.deepEqual(postStoreStats(store), {
    lastPollAt: '2026-05-27T02:00:00Z',
    totalPosts: 1,
    enrichedPosts: 0
  });
});
