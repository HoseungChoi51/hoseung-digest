import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDigestMarkdown, renderDigestMarkdown } from '../src/lib/markdown.js';

test('renders markdown digest with original link at the end of each entry', () => {
  const markdown = renderDigestMarkdown({
    date: '2026-05-27',
    generatedAt: '2026-05-27T00:00:00Z',
    timezone: 'Asia/Seoul',
    sourceAccount: 'u/example',
    subscribedSubredditCount: 1,
    summaryStatus: 'completed',
    posts: [
      {
        subreddit: 'programming',
        title: 'Interesting post',
        score: 10,
        numComments: 2,
        createdAt: '2026-05-27T00:00:00Z',
        isSelf: false,
        domain: 'example.com',
        author: 'someone',
        permalink: 'https://www.reddit.com/r/programming/comments/abc/post/',
        externalUrl: 'https://example.com/post',
        summary: {
          summary: 'A short summary.',
          why_it_may_matter: ['It is useful.']
        }
      }
    ]
  });

  const entryTail = markdown.trim().split('\n').slice(-3);
  assert.deepEqual(entryTail, [
    '- Reddit: <https://www.reddit.com/r/programming/comments/abc/post/>',
    '- External: <https://example.com/post>',
    '- Original: <https://www.reddit.com/r/programming/comments/abc/post/>'
  ]);

  const parsed = parseDigestMarkdown(markdown);
  assert.equal(parsed.metadata.date, '2026-05-27');
  assert.equal(parsed.entries[0].subreddit, 'programming');
  assert.equal(parsed.entries[0].links.original, 'https://www.reddit.com/r/programming/comments/abc/post/');
});
