import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCurationEntry, buildAnalysisRequestBody } from '../src/lib/summarizer.js';

const config = {
  summary: {
    model: 'test-model'
  }
};

test('builds LLM curation requests with preference guideline debug fields', () => {
  const body = buildAnalysisRequestBody(
    [
      {
        id: 'item:one',
        source_name: 'Lab Feed',
        tab: 'hw',
        title: 'GPU inference update',
        domain: 'example.com',
        score: 10,
        comment_count: 2,
        raw_summary: 'Concrete implementation detail.'
      }
    ],
    config,
    '# Guideline\n- prefer-tag-gpu-001: Keep GPU implementation detail.'
  );
  const content = body.input.map((item) => item.content).join('\n');
  const entrySchema = body.text.format.schema.properties.entries.items;

  assert.equal(body.model, 'test-model');
  assert.match(content, /prefer-tag-gpu-001/);
  assert.ok(entrySchema.required.includes('filter_rule_ids'));
  assert.ok(entrySchema.required.includes('filter_reason'));
  assert.equal(entrySchema.properties.filter_rule_ids.type, 'array');
});

test('applies compact LLM filter trace fields to curated posts', () => {
  const next = applyCurationEntry(
    { id: 'item:one', tab: 'dev', title: 'GPU inference update' },
    {
      item_id: 'item:one',
      tab: 'hw',
      importance: 4,
      summary: 'A concrete GPU inference update.',
      why_it_matters: 'It affects local inference operators.',
      entities: ['GPU'],
      tags: ['inference'],
      skip: false,
      skip_reason: '',
      filter_rule_ids: ['prefer-tag-gpu-001'],
      filter_reason: 'Matches the positive GPU implementation preference.'
    }
  );

  assert.equal(next.tab, 'hw');
  assert.deepEqual(next.llm_filter_rule_ids, ['prefer-tag-gpu-001']);
  assert.equal(next.llm_filter_reason, 'Matches the positive GPU implementation preference.');
});
