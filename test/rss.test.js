import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPostId, parseFeedEntries, parseRedditRss, subredditFeedUrl } from '../src/lib/rss.js';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <id>t3_abcd12</id>
    <title>Example &amp; post</title>
    <author><name>/u/example</name></author>
    <content type="html">&lt;p&gt;Snippet text&lt;/p&gt;</content>
    <link href="https://www.reddit.com/r/programming/comments/abcd12/example_post/" />
    <updated>2026-05-27T01:00:00+00:00</updated>
    <published>2026-05-27T01:00:00+00:00</published>
  </entry>
</feed>`;

test('extracts reddit post ids from fullnames and urls', () => {
  assert.equal(extractPostId('t3_abcd12'), 'abcd12');
  assert.equal(
    extractPostId('https://www.reddit.com/r/programming/comments/abcd12/example_post/'),
    'abcd12'
  );
});

test('parses reddit atom feed entries into post records', () => {
  const posts = parseRedditRss(FEED, 'programming', '2026-05-27T02:00:00Z');

  assert.equal(posts.length, 1);
  assert.equal(posts[0].post_id, 'abcd12');
  assert.equal(posts[0].subreddit, 'programming');
  assert.equal(posts[0].title, 'Example & post');
  assert.equal(posts[0].author, 'example');
  assert.equal(posts[0].snippet, 'Snippet text');
  assert.equal(posts[0].seen_at, '2026-05-27T02:00:00Z');
});

test('builds subreddit rss urls', () => {
  assert.equal(
    subredditFeedUrl('MachineLearning', 100),
    'https://www.reddit.com/r/MachineLearning/new/.rss?limit=100'
  );
});

test('parses generic rss item entries', () => {
  const xml = `<rss><channel><item><guid>item-1</guid><title>RSS item</title><link>https://example.com/a</link><description><![CDATA[<p>Summary</p>]]></description><pubDate>Wed, 27 May 2026 01:00:00 GMT</pubDate></item></channel></rss>`;
  const entries = parseFeedEntries(xml, '2026-05-27T02:00:00Z');

  assert.equal(entries.length, 1);
  assert.equal(entries[0].external_id, 'item-1');
  assert.equal(entries[0].title, 'RSS item');
  assert.equal(entries[0].raw_summary, 'Summary');
});
