import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingTerms, passesSourceFilters } from '../src/lib/relevance.js';

test('matches relevance terms as tokens or phrases instead of loose substrings', () => {
  const item = {
    title: 'The user is visibly frustrated',
    source_name: 'Hacker News Best',
    domain: 'example.com'
  };

  assert.deepEqual(matchingTerms(item, ['Rust', 'AI']), []);
  assert.equal(
    passesSourceFilters(item, {
      include_terms: ['Rust'],
      min_score: 0,
      min_comments: 0
    }),
    false
  );
});

test('matches configured phrases and hyphenated terms', () => {
  const item = {
    title: 'A self-hosted LLM inference service for Linux',
    source_name: 'Hacker News Best',
    domain: 'example.com'
  };

  assert.deepEqual(matchingTerms(item, ['self-hosted', 'LLM inference', 'GPU']), [
    'self-hosted',
    'LLM inference'
  ]);
});
