import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPreferenceGuidelines,
  formatPreferenceGuidelinesMarkdown,
  generatePreferenceGuidelines
} from '../src/lib/preference-guidelines.js';

function item(id, title, tags = []) {
  return {
    id,
    title,
    source_name: 'Lab Feed',
    tab: 'hw',
    domain: 'example.com',
    llm_tags: tags,
    llm_entities: tags,
    raw_summary: `${title} with concrete implementation detail.`
  };
}

function preference(itemId, label, title, tags = []) {
  const score = label === 'must_read' ? 2 : label === 'useful' ? 1 : -1;
  return {
    item_id: itemId,
    label,
    score,
    title,
    source: 'Lab Feed',
    tab: 'hw',
    domain: 'example.com',
    tags,
    entities: tags,
    summary: `${title} summary.`
  };
}

test('builds stable preference guideline rules from labeled history', () => {
  const itemStore = {
    items: {
      a: item('a', 'GPU inference compiler update', ['gpu', 'inference']),
      b: item('b', 'GPU memory runtime release', ['gpu', 'memory']),
      c: item('c', 'Thin benchmark announcement', ['benchmark']),
      d: item('d', 'Generic benchmark roundup', ['benchmark']),
      e: item('e', 'Detailed benchmark method', ['benchmark'])
    }
  };
  const preferenceStore = {
    items: {
      a: preference('a', 'useful', 'GPU inference compiler update', ['gpu', 'inference']),
      b: preference('b', 'must_read', 'GPU memory runtime release', ['gpu', 'memory']),
      c: preference('c', 'not_for_me', 'Thin benchmark announcement', ['benchmark']),
      d: preference('d', 'not_for_me', 'Generic benchmark roundup', ['benchmark']),
      e: preference('e', 'useful', 'Detailed benchmark method', ['benchmark'])
    }
  };

  const guidelines = buildPreferenceGuidelines({
    itemStore,
    preferenceStore,
    now: '2026-06-01T00:00:00.000Z'
  });
  const ids = guidelines.rules.map((rule) => rule.id);

  assert.ok(ids.includes('prefer-tag-gpu-001'));
  assert.ok(ids.includes('caution-tag-benchmark-001'));
  assert.equal(guidelines.rules.some((rule) => rule.type === 'reject' && rule.value === 'benchmark'), false);
  assert.equal(guidelines.preference_counts.mustRead, 1);
  assert.equal(guidelines.labeled_item_count, 5);
});

test('formats markdown with rule IDs and debugging contract', () => {
  const guidelines = buildPreferenceGuidelines({
    itemStore: { items: { a: item('a', 'GPU inference compiler update', ['gpu']) } },
    preferenceStore: { items: { a: preference('a', 'useful', 'GPU inference compiler update', ['gpu']) } },
    now: '2026-06-01T00:00:00.000Z',
    options: { minSupport: 1 }
  });
  const markdown = formatPreferenceGuidelinesMarkdown(guidelines);

  assert.match(markdown, /First-Stage Article Filtering Guideline/);
  assert.match(markdown, /prefer-tag-gpu-001/);
  assert.match(markdown, /filter_rule_ids/);
});

test('uses LLM synthesis when an API key is configured', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  let requestBody = null;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async text() {
        return JSON.stringify({
          output_text: JSON.stringify({
            rules: [
              {
                id: 'prefer-semantic-operator-value-001',
                type: 'prefer',
                kind: 'semantic',
                value: 'operator-value',
                action: 'keep_or_raise',
                description: 'Prefer articles with practical operator value and implementation detail.',
                evidence_summary: 'Positive examples emphasize concrete GPU and inference operations.',
                confidence: 0.82,
                example_item_ids: ['a']
              }
            ],
            notes: ['Generalized beyond exact tags.']
          })
        });
      }
    };
  };

  try {
    const result = await generatePreferenceGuidelines({
      itemStore: { items: { a: item('a', 'GPU inference compiler update', ['gpu']) } },
      preferenceStore: { items: { a: preference('a', 'useful', 'GPU inference compiler update', ['gpu']) } },
      now: '2026-06-01T00:00:00.000Z',
      write: false,
      config: { summary: { model: 'test-model' } }
    });

    assert.equal(requestBody.model, 'test-model');
    assert.equal(result.guidelines.generated_by, 'llm_synthesis');
    assert.ok(result.guidelines.rules.some((rule) => rule.id === 'prefer-semantic-operator-value-001'));
    assert.deepEqual(result.guidelines.synthesis_notes, ['Generalized beyond exact tags.']);
  } finally {
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
    global.fetch = originalFetch;
  }
});
