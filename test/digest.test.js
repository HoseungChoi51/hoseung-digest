import test from 'node:test';
import assert from 'node:assert/strict';
import { applySubredditFilters } from '../src/lib/digest.js';
import { dedupeItems, filterItemsForDate, rankItems } from '../src/lib/ranker.js';

const config = {
  timezone: 'Asia/Seoul',
  subreddits: {
    include: ['programming', 'javascript'],
    exclude: ['javascript'],
    pinned: ['programming']
  },
  ranking: {
    source_priority_weight: 100,
    score_weight: 1,
    comment_weight: 3,
    comments_per_hour_weight: 25,
    score_per_hour_weight: 8,
    recency_weight: 30,
    pinned_boost: 500,
    watchlist_boost: 120,
    negative_keyword_penalty: 120
  },
  watchlist: {
    high_priority: ['Linux'],
    negative_or_low_priority: ['coupon']
  }
};

test('filters subreddits with include and exclude lists', () => {
  assert.deepEqual(
    applySubredditFilters(['programming', 'javascript', 'news'], config),
    ['programming']
  );
});

test('dedupes items by canonical url and normalized title', () => {
  const items = dedupeItems([
    { id: 'a', source_id: 'one', canonical_url: 'https://example.com/a', title: 'Linux news!' },
    { id: 'b', source_id: 'two', canonical_url: 'https://example.com/a', title: 'duplicate url' },
    { id: 'c', source_id: 'three', canonical_url: 'https://example.com/c', title: 'Linux news' }
  ]);

  assert.deepEqual(items.map((item) => item.id), ['a']);
});

test('filters and ranks normalized items for a local day', () => {
  const items = [
    {
      id: 'a',
      source_id: 'hn',
      source_name: 'Hacker News',
      tab: 'dev',
      title: 'Linux kernel update',
      source_priority: 0.9,
      score: 1,
      comment_count: 10,
      published_at: '2026-05-26T16:00:00Z'
    },
    {
      id: 'b',
      source_id: 'news',
      source_name: 'News',
      tab: 'dev',
      title: 'Old item',
      source_priority: 0.9,
      score: 100,
      comment_count: 0,
      published_at: '2026-05-25T12:00:00Z'
    }
  ];

  const filtered = filterItemsForDate(items, '2026-05-27', 'Asia/Seoul');
  assert.equal(filtered.length, 1);

  const ranked = rankItems(filtered, config, '2026-05-27');
  assert.equal(ranked[0].id, 'a');
  assert.ok(ranked[0].comments_per_hour > 0);
  assert.ok(ranked[0].hotness > 100);
});
