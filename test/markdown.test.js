import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDigestMarkdown, renderDigestMarkdown } from '../src/lib/markdown.js';

test('renders markdown digest with original link at the end of each entry', () => {
  const markdown = renderDigestMarkdown({
    date: '2026-05-27',
    generatedAt: '2026-05-27T00:00:00Z',
    timezone: 'Asia/Seoul',
    sourceAccount: 'u/example',
    configuredSubredditCount: 1,
    summaryStatus: 'completed',
    posts: [
      {
        post_id: 'abc',
        subreddit: 'programming',
        title: 'Interesting post',
        score: 10,
        numComments: 2,
        commentsPerHour: 1.5,
        scorePerHour: 7.5,
        createdAt: '2026-05-27T00:00:00Z',
        isSelf: false,
        domain: 'example.com',
        author: 'someone',
        cluster: 'Software',
        permalink: 'https://www.reddit.com/r/programming/comments/abc/post/',
        externalUrl: 'https://example.com/post',
        summary: {
          summary: 'A short summary.',
          why_it_may_matter: ['It is useful.'],
          research_questions: ['What changed?']
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
  assert.equal(parsed.entries[0].cluster, 'Software');
  assert.equal(parsed.entries[0].links.original, 'https://www.reddit.com/r/programming/comments/abc/post/');
});
