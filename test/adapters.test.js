import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHackerNewsSource } from '../src/lib/adapters.js';

function jsonResponse(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body
  };
}

test('fetches Hacker News stories with discussion links and source relevance filters', async () => {
  const source = {
    id: 'hackernews_top',
    name: 'Hacker News Top',
    tab: 'dev',
    adapter: 'hackernews',
    feed: 'topstories',
    priority: 0.7,
    include_terms: ['CUDA'],
    exclude_terms: ['celebrity', 'coupon'],
    min_score: 10,
    min_comments: 2
  };
  const config = {
    poll: { hn_limit: 4 },
    reddit: { user_agent: 'test-agent' }
  };
  const items = new Map([
    [1, { id: 1, type: 'story', title: 'CUDA kernels get easier', url: 'https://example.com/cuda', by: 'ada', time: 1_800_000_000, score: 42, descendants: 7 }],
    [2, { id: 2, type: 'story', title: 'CUDA coupon roundup', url: 'https://example.com/coupon', by: 'bob', time: 1_800_000_000, score: 40, descendants: 5 }],
    [3, { id: 3, type: 'story', title: 'A general lifestyle essay', url: 'https://example.com/life', by: 'cal', time: 1_800_000_000, score: 500, descendants: 100 }],
    [4, { id: 4, type: 'story', title: 'CUDA note with no discussion', url: 'https://example.com/quiet', by: 'dee', time: 1_800_000_000, score: 50, descendants: 0 }]
  ]);
  const fetchImpl = async (url) => {
    if (url.endsWith('/topstories.json')) return jsonResponse([1, 2, 3, 4]);
    const id = Number(url.match(/\/item\/(\d+)\.json/)?.[1]);
    return jsonResponse(items.get(id));
  };

  const result = await fetchHackerNewsSource(source, config, {
    fetchImpl,
    now: '2026-05-27T00:00:00.000Z'
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'CUDA kernels get easier');
  assert.equal(result.items[0].canonical_url, 'https://news.ycombinator.com/item?id=1');
  assert.equal(result.items[0].discussion_url, 'https://news.ycombinator.com/item?id=1');
  assert.equal(result.items[0].original_url, 'https://example.com/cuda');
  assert.equal(result.items[0].domain, 'example.com');
});
