import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deletePreference,
  preferenceBoostForItem,
  preferenceStats,
  readPreferenceStore,
  upsertPreference
} from '../src/lib/preference-store.js';

async function tempPreferenceStorePath() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'reddit-digest-preferences-'));
  return path.join(dir, 'preferences.json');
}

test('stores item preferences as a durable JSON preference DB', async () => {
  const storePath = await tempPreferenceStorePath();
  await upsertPreference(
    'hackernews_top:abc',
    {
      label: 'must_read',
      entry: {
        id: 'hackernews_top:abc',
        title: 'A sleep-like consolidation mechanism for LLMs',
        source: 'Hacker News Top',
        tab: 'dev',
        domain: 'arxiv.org',
        links: {
          open: 'https://news.ycombinator.com/item?id=123',
          article: 'https://arxiv.org/abs/2605.26099'
        },
        entities: ['LLMs'],
        tags: ['machine-learning']
      }
    },
    { storePath, now: '2026-05-27T00:00:00.000Z' }
  );

  const store = await readPreferenceStore(storePath);
  assert.equal(store.items['hackernews_top:abc'].score, 2);
  assert.equal(store.items['hackernews_top:abc'].domain, 'arxiv.org');
  assert.equal(store.events.length, 1);
  assert.equal(preferenceStats(store).mustRead, 1);
});

test('computes soft ranking boosts from domain, source, and terms', async () => {
  const storePath = await tempPreferenceStorePath();
  const { store } = await upsertPreference(
    'source:one',
    {
      label: 'useful',
      entry: {
        title: 'Linux LLM inference',
        source: 'Hacker News Top',
        domain: 'example.com',
        entities: ['Linux', 'LLM'],
        tags: ['inference']
      }
    },
    { storePath, now: '2026-05-27T00:00:00.000Z' }
  );

  const boost = preferenceBoostForItem(
    {
      id: 'source:two',
      title: 'Linux inference update',
      source_name: 'Hacker News Top',
      domain: 'example.com',
      llm_entities: ['Linux'],
      llm_tags: ['inference']
    },
    store
  );

  assert.ok(boost.score > 0);
  assert.ok(boost.reasons.some((reason) => reason.startsWith('domain:')));
});

test('deletes item preferences when clearing a preference', async () => {
  const storePath = await tempPreferenceStorePath();
  await upsertPreference(
    'source:one',
    {
      label: 'useful',
      entry: {
        title: 'Linux LLM inference',
        source: 'Hacker News Top',
        domain: 'example.com'
      }
    },
    { storePath, now: '2026-05-27T00:00:00.000Z' }
  );

  const result = await deletePreference('source:one', {
    storePath,
    now: '2026-05-27T01:00:00.000Z'
  });
  const store = await readPreferenceStore(storePath);

  assert.equal(result.deleted, true);
  assert.equal(store.items['source:one'], undefined);
  assert.equal(preferenceStats(store).total, 0);
  assert.equal(store.events.at(-1).label, 'cleared');
});
