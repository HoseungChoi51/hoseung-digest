import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDigestMarkdown, renderDigestMarkdown } from '../src/lib/markdown.js';

test('renders markdown digest with original link at the end of each entry', () => {
  const markdown = renderDigestMarkdown({
    date: '2026-05-27',
    generatedAt: '2026-05-27T00:00:00Z',
    timezone: 'Asia/Seoul',
    sourceAccount: 'rss-hn-reddit',
    configuredSourceCount: 1,
    summaryStatus: 'completed',
    posts: [
      {
        id: 'reddit_programming:abc',
        source_id: 'reddit_programming',
        source_name: 'r/programming',
        adapter: 'reddit_rss',
        tab: 'reddit',
        subreddit: 'programming',
        title: 'Interesting post',
        score: 10,
        comment_count: 2,
        comments_per_hour: 1.5,
        score_per_hour: 7.5,
        hotness: 42,
        published_at: '2026-05-27T00:00:00Z',
        domain: 'example.com',
        author: 'someone',
        canonical_url: 'https://www.reddit.com/r/programming/comments/abc/post/',
        original_url: 'https://www.reddit.com/r/programming/comments/abc/post/',
        llm_summary: 'A short summary.',
        llm_reason: 'It is useful.',
        llm_entities: ['Linux'],
        llm_importance: 4
      }
    ]
  });

  assert.match(markdown, /## Top 10/);
  assert.match(markdown, /## Reddit/);
  assert.match(markdown, /- Open: <https:\/\/www\.reddit\.com\/r\/programming\/comments\/abc\/post\/>/);
  assert.match(markdown, /- Original: <https:\/\/www\.reddit\.com\/r\/programming\/comments\/abc\/post\/>/);

  const parsed = parseDigestMarkdown(markdown);
  assert.equal(parsed.metadata.date, '2026-05-27');
  assert.equal(parsed.entries[0].id, 'reddit_programming:abc');
  assert.equal(parsed.entries[0].subreddit, 'programming');
  assert.equal(parsed.entries[0].tab, 'reddit');
  assert.equal(parsed.entries[0].links.original, 'https://www.reddit.com/r/programming/comments/abc/post/');
});
