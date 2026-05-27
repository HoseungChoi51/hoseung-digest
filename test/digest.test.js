import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySubredditFilters,
  dedupePosts,
  filterPostsForDate,
  rankPosts
} from '../src/lib/digest.js';

const config = {
  timezone: 'Asia/Seoul',
  subreddits: {
    include: ['programming', 'javascript'],
    exclude: ['javascript'],
    pinned: ['programming']
  },
  ranking: {
    score_weight: 1,
    comment_weight: 3,
    comments_per_hour_weight: 25,
    score_per_hour_weight: 8,
    recency_weight: 30,
    pinned_boost: 500
  }
};

test('filters subreddits with include and exclude lists', () => {
  assert.deepEqual(
    applySubredditFilters(['programming', 'javascript', 'news'], config),
    ['programming']
  );
});

test('dedupes posts by reddit fullname', () => {
  const posts = dedupePosts([
    { name: 't3_a', title: 'first' },
    { name: 't3_a', title: 'duplicate' },
    { name: 't3_b', title: 'second' }
  ]);

  assert.deepEqual(posts.map((post) => post.title), ['first', 'second']);
});

test('filters and ranks posts for a local day', () => {
  const posts = [
    {
      post_id: 'a',
      subreddit: 'programming',
      score: 1,
      numComments: 0,
      published: '2026-05-26T16:00:00Z'
    },
    {
      post_id: 'b',
      subreddit: 'news',
      score: 100,
      numComments: 0,
      published: '2026-05-25T12:00:00Z'
    }
  ];

  const filtered = filterPostsForDate(posts, '2026-05-27', 'Asia/Seoul');
  assert.equal(filtered.length, 1);

  const ranked = rankPosts(filtered, config, '2026-05-27');
  assert.equal(ranked[0].post_id, 'a');
  assert.ok(ranked[0].rank > 500);
});
