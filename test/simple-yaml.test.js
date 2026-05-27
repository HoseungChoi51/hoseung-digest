import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../src/lib/simple-yaml.js';

test('parses nested objects and arrays', () => {
  const parsed = parseYaml(`
timezone: "Asia/Seoul"
subreddits:
  include:
    - javascript
    - programming
  exclude: []
summary:
  enabled: true
  max_posts: 5
`);

  assert.equal(parsed.timezone, 'Asia/Seoul');
  assert.deepEqual(parsed.subreddits.include, ['javascript', 'programming']);
  assert.deepEqual(parsed.subreddits.exclude, []);
  assert.equal(parsed.summary.enabled, true);
  assert.equal(parsed.summary.max_posts, 5);
});
