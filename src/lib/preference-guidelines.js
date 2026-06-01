import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, ensureDir } from './paths.js';
import { listStoredItems, readItemStore } from './item-store.js';
import { readPreferenceStore, preferenceStats } from './preference-store.js';
import { normalizeTitle, urlDomain } from './normalizer.js';

export const PREFERENCE_GUIDELINE_MARKDOWN_PATH = path.join(DATA_DIR, 'preference-guidelines.md');
export const PREFERENCE_GUIDELINE_JSON_PATH = path.join(DATA_DIR, 'preference-guidelines.json');

const POSITIVE_LABELS = new Set(['must_read', 'useful']);
const NEGATIVE_LABELS = new Set(['not_for_me']);
const MAX_EXAMPLES_PER_SIGNAL = 4;
const MAX_DYNAMIC_RULES_PER_GROUP = 18;
const IGNORED_TAGS = new Set(['reddit']);

const STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'also',
  'among',
  'announced',
  'announces',
  'appeared',
  'because',
  'been',
  'being',
  'between',
  'could',
  'actual',
  'actually',
  'article',
  'asks',
  'author',
  'available',
  'comments',
  'coming',
  'described',
  'describes',
  'detail',
  'details',
  'discusses',
  'does',
  'first',
  'from',
  'have',
  'handle',
  'indicates',
  'into',
  'item',
  'just',
  'launch',
  'link',
  'like',
  'mentions',
  'more',
  'most',
  'only',
  'other',
  'over',
  'post',
  'posted',
  'project',
  'reports',
  'says',
  'some',
  'source',
  'snippet',
  'submitted',
  'than',
  'that',
  'their',
  'there',
  'these',
  'this',
  'through',
  'title',
  'user',
  'using',
  'with',
  'without',
  'would',
  'your'
]);

function compact(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function scoreBucket(record) {
  if (POSITIVE_LABELS.has(record.label) || Number(record.score || 0) > 0) return 'positive';
  if (NEGATIVE_LABELS.has(record.label) || Number(record.score || 0) < 0) return 'negative';
  return 'neutral';
}

function scoreValue(preference) {
  const score = Number(preference.score);
  if (Number.isFinite(score)) return score;
  if (preference.label === 'must_read') return 2;
  if (preference.label === 'useful') return 1;
  if (preference.label === 'not_for_me') return -1;
  return 0;
}

function itemUrl(item = {}, preference = {}) {
  return (
    preference.original_url ||
    preference.canonical_url ||
    preference.links?.article ||
    preference.links?.original ||
    item.original_url ||
    item.canonical_url ||
    item.url ||
    ''
  );
}

function recordForPreference(preference, item = {}) {
  const tags = normalizeList(preference.tags?.length ? preference.tags : item.llm_tags);
  const entities = normalizeList(preference.entities?.length ? preference.entities : item.llm_entities);
  const source = compact(preference.source, item.source_name || item.source_id);
  const url = itemUrl(item, preference);

  return {
    item_id: preference.item_id || item.id || '',
    label: compact(preference.label, 'neutral'),
    score: scoreValue(preference),
    title: compact(preference.title, item.title || '(untitled)'),
    source,
    source_id: compact(item.source_id),
    tab: compact(preference.tab, item.tab || 'dev'),
    domain: compact(preference.domain, item.domain || urlDomain(url)),
    summary: compact(preference.summary, item.llm_summary || item.raw_summary),
    tags,
    entities,
    url
  };
}

function tokenTerms(record) {
  const text = normalizeTitle(`${record.title} ${record.summary}`);
  const tokens = text.split(/\s+/).filter((token) => {
    if (token.length < 4 || token.length > 28) return false;
    if (STOPWORDS.has(token)) return false;
    if (/^\d+$/.test(token)) return false;
    return true;
  });
  return [...new Set(tokens)].slice(0, 24);
}

function slug(value) {
  const text = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || 'signal';
}

function signalKey(kind, value) {
  return `${kind}:${String(value).trim().toLowerCase()}`;
}

function featureSignals(record) {
  const signals = [];
  if (record.tab) signals.push({ kind: 'tab', value: record.tab });
  if (record.source) signals.push({ kind: 'source', value: record.source });
  if (record.domain) signals.push({ kind: 'domain', value: record.domain });
  for (const tag of record.tags) {
    if (!IGNORED_TAGS.has(tag.toLowerCase())) signals.push({ kind: 'tag', value: tag });
  }
  for (const entity of record.entities) signals.push({ kind: 'entity', value: entity });
  for (const term of tokenTerms(record)) signals.push({ kind: 'term', value: term });
  return signals;
}

function preferenceExample(record) {
  return {
    item_id: record.item_id,
    label: record.label,
    score: record.score,
    title: record.title,
    source: record.source,
    domain: record.domain,
    tags: record.tags.slice(0, 6)
  };
}

function addSignal(stats, signal, record) {
  const key = signalKey(signal.kind, signal.value);
  if (!stats.has(key)) {
    stats.set(key, {
      key,
      kind: signal.kind,
      value: String(signal.value).trim(),
      score_sum: 0,
      positive_count: 0,
      negative_count: 0,
      neutral_count: 0,
      labels: {},
      examples: []
    });
  }

  const stat = stats.get(key);
  const bucket = scoreBucket(record);
  stat.score_sum += record.score;
  stat.labels[record.label] = (stat.labels[record.label] || 0) + 1;
  stat[`${bucket}_count`] += 1;

  if (stat.examples.length < MAX_EXAMPLES_PER_SIGNAL) {
    stat.examples.push(preferenceExample(record));
  }
}

function rankSignal(stat) {
  return Math.abs(stat.score_sum) * 4 + stat.positive_count * 2 + stat.negative_count * 2;
}

function actionForRule(type) {
  if (type === 'prefer') return 'keep_or_raise';
  if (type === 'reject') return 'skip_when_primary_signal';
  return 'require_concrete_evidence';
}

function ruleText(type, stat) {
  if (type === 'prefer') {
    return `Treat ${stat.kind} "${stat.value}" as a positive preference signal when the item has concrete technical detail.`;
  }
  if (type === 'reject') {
    return `Treat ${stat.kind} "${stat.value}" as a negative preference signal unless the item has unusually strong direct relevance.`;
  }
  return `Treat ${stat.kind} "${stat.value}" as mixed evidence; do not keep or reject solely on this signal.`;
}

function ruleFromStat(type, stat) {
  return {
    id: `${type}-${slug(stat.kind)}-${slug(stat.value)}-001`,
    type,
    kind: stat.kind,
    value: stat.value,
    action: actionForRule(type),
    description: ruleText(type, stat),
    evidence: {
      positive_count: stat.positive_count,
      negative_count: stat.negative_count,
      neutral_count: stat.neutral_count,
      score_sum: Number(stat.score_sum.toFixed(2)),
      labels: stat.labels
    },
    examples: stat.examples
  };
}

function promoteSignals(stats, options = {}) {
  const minSupport = Number(options.minSupport || 2);
  const minMixedSupport = Number(options.minMixedSupport || 3);
  const allStats = [...stats.values()].filter((stat) => stat.positive_count + stat.negative_count >= minSupport);
  const prefer = [];
  const reject = [];
  const caution = [];

  for (const stat of allStats) {
    const support = stat.positive_count + stat.negative_count;
    const hardSignal = stat.kind !== 'term';
    if (hardSignal && stat.positive_count >= minSupport && stat.negative_count === 0 && stat.score_sum > 0) {
      prefer.push(stat);
    } else if (hardSignal && stat.negative_count >= minSupport && stat.positive_count === 0 && stat.score_sum < 0) {
      reject.push(stat);
    } else if (
      support >= minMixedSupport &&
      stat.positive_count > 0 &&
      stat.negative_count > 0 &&
      Math.abs(stat.score_sum) >= 1
    ) {
      caution.push(stat);
    }
  }

  const byRank = (a, b) => rankSignal(b) - rankSignal(a) || a.key.localeCompare(b.key);
  return {
    prefer: prefer.sort(byRank).slice(0, MAX_DYNAMIC_RULES_PER_GROUP).map((stat) => ruleFromStat('prefer', stat)),
    reject: reject.sort(byRank).slice(0, MAX_DYNAMIC_RULES_PER_GROUP).map((stat) => ruleFromStat('reject', stat)),
    caution: caution.sort(byRank).slice(0, MAX_DYNAMIC_RULES_PER_GROUP).map((stat) => ruleFromStat('caution', stat))
  };
}

function baselineRules() {
  return [
    {
      id: 'quality-low-signal-001',
      type: 'reject',
      kind: 'quality',
      value: 'low-signal',
      action: 'skip_when_primary_signal',
      description:
        'Skip items whose title/snippet lacks concrete technical claims, named systems, implementation detail, benchmark context, release detail, or clear operator value.',
      evidence: { source: 'static_quality_rule' },
      examples: []
    },
    {
      id: 'quality-promotional-001',
      type: 'reject',
      kind: 'quality',
      value: 'promotional',
      action: 'skip_when_primary_signal',
      description:
        'Skip coupons, sales, thin launches, generic product marketing, celebrity/business hype, and broad consumer-tech stories unless they directly affect AI, systems, hardware, or developer workflows.',
      evidence: { source: 'static_quality_rule' },
      examples: []
    },
    {
      id: 'quality-duplicate-001',
      type: 'reject',
      kind: 'quality',
      value: 'duplicate',
      action: 'skip_when_primary_signal',
      description:
        'Skip duplicate coverage when a clearer or more technical source about the same event is available.',
      evidence: { source: 'static_quality_rule' },
      examples: []
    },
    {
      id: 'decision-uncertain-low-evidence-001',
      type: 'caution',
      kind: 'decision',
      value: 'uncertain-low-evidence',
      action: 'require_concrete_evidence',
      description:
        'When no preference rule applies, keep only items with specific technical substance; otherwise skip with this rule ID.',
      evidence: { source: 'static_quality_rule' },
      examples: []
    }
  ];
}

function sourceSummary(records) {
  const counts = new Map();
  for (const record of records) {
    const key = record.source || record.domain || 'unknown';
    const existing = counts.get(key) || { source: key, positive: 0, negative: 0, score_sum: 0 };
    if (scoreBucket(record) === 'positive') existing.positive += 1;
    if (scoreBucket(record) === 'negative') existing.negative += 1;
    existing.score_sum += record.score;
    counts.set(key, existing);
  }
  return [...counts.values()]
    .sort((a, b) => Math.abs(b.score_sum) - Math.abs(a.score_sum) || b.positive + b.negative - (a.positive + a.negative))
    .slice(0, 12);
}

function extractResponseText(responseBody) {
  if (responseBody.output_text) return responseBody.output_text;

  const chunks = [];
  for (const item of responseBody.output || []) {
    for (const content of item.content || []) {
      if (content.text) chunks.push(content.text);
    }
  }

  return chunks.join('\n').trim();
}

function signalSummary(stat) {
  return {
    key: stat.key,
    kind: stat.kind,
    value: stat.value,
    positive_count: stat.positive_count,
    negative_count: stat.negative_count,
    neutral_count: stat.neutral_count,
    score_sum: Number(stat.score_sum.toFixed(2)),
    labels: stat.labels,
    examples: stat.examples
  };
}

function evidenceRecords(itemStore, preferenceStore) {
  const itemsById = new Map(listStoredItems(itemStore).map((item) => [item.id, item]));
  const preferences = Object.values(preferenceStore.items || {});
  return preferences
    .map((preference) => recordForPreference(preference, itemsById.get(preference.item_id) || {}))
    .filter((record) => record.item_id && (POSITIVE_LABELS.has(record.label) || NEGATIVE_LABELS.has(record.label)));
}

function evidenceStats(records) {
  const stats = new Map();
  for (const record of records) {
    for (const signal of featureSignals(record)) {
      addSignal(stats, signal, record);
    }
  }
  return stats;
}

function signalCandidates(stats) {
  const allStats = [...stats.values()];
  const byRank = (a, b) => rankSignal(b) - rankSignal(a) || a.key.localeCompare(b.key);
  const support = (stat) => stat.positive_count + stat.negative_count;

  return {
    positive: allStats
      .filter((stat) => stat.score_sum > 0 && stat.positive_count > 0 && support(stat) >= 2)
      .sort(byRank)
      .slice(0, 40)
      .map(signalSummary),
    negative: allStats
      .filter((stat) => stat.score_sum < 0 && stat.negative_count > 0 && support(stat) >= 2)
      .sort(byRank)
      .slice(0, 40)
      .map(signalSummary),
    mixed: allStats
      .filter((stat) => stat.positive_count > 0 && stat.negative_count > 0 && support(stat) >= 3)
      .sort(byRank)
      .slice(0, 40)
      .map(signalSummary)
  };
}

function compactEvidenceRecord(record) {
  return {
    item_id: record.item_id,
    label: record.label,
    score: record.score,
    title: record.title,
    source: record.source,
    tab: record.tab,
    domain: record.domain,
    tags: record.tags.slice(0, 8),
    entities: record.entities.slice(0, 8),
    summary: record.summary.slice(0, 500)
  };
}

export function buildPreferenceGuidelineEvidence({
  itemStore = {},
  preferenceStore = {},
  now = new Date().toISOString()
} = {}) {
  const records = evidenceRecords(itemStore, preferenceStore);
  const stats = evidenceStats(records);

  return {
    version: 1,
    generated_at: now,
    item_count: listStoredItems(itemStore).length,
    preference_counts: preferenceStats(preferenceStore),
    labeled_item_count: records.length,
    source_summary: sourceSummary(records),
    baseline_rules: baselineRules(),
    signal_candidates: signalCandidates(stats),
    labeled_examples: records.map(compactEvidenceRecord).slice(0, 120)
  };
}

export function buildPreferenceGuidelines({ itemStore = {}, preferenceStore = {}, now = new Date().toISOString(), options = {} } = {}) {
  const records = evidenceRecords(itemStore, preferenceStore);
  const stats = evidenceStats(records);

  const dynamicRules = promoteSignals(stats, options);
  const rules = [
    ...baselineRules(),
    ...dynamicRules.prefer,
    ...dynamicRules.reject,
    ...dynamicRules.caution
  ];

  return {
    version: 1,
    generated_by: 'deterministic_fallback',
    generated_at: now,
    item_count: listStoredItems(itemStore).length,
    preference_counts: preferenceStats(preferenceStore),
    labeled_item_count: records.length,
    source_summary: sourceSummary(records),
    rule_counts: {
      total: rules.length,
      prefer: rules.filter((rule) => rule.type === 'prefer').length,
      reject: rules.filter((rule) => rule.type === 'reject').length,
      caution: rules.filter((rule) => rule.type === 'caution').length
    },
    rules
  };
}

function guidelineModel(options = {}) {
  return options.model || options.config?.summary?.model || process.env.OPENAI_MODEL || 'gpt-5.4-mini';
}

function analysisRequestBody(evidence, previousGuidelines, options = {}) {
  return {
    model: guidelineModel(options),
    input: [
      {
        role: 'system',
        content:
          'You maintain an evolving personal article-filtering rubric for first-stage LLM news curation. Synthesize semantic, debuggable guidelines from preference evidence. Do not reduce preferences to brittle keyword filters. Generalize across article forms and future topics, preserve useful previous rule IDs, and retire or soften stale rules.'
      },
      {
        role: 'user',
        content:
          `Create an updated filtering guideline from the evidence below. Rules are fuzzy heuristics for another LLM, not deterministic filters. ` +
          `Prefer semantic criteria such as practical operator value, implementation depth, hardware/system relevance, topic novelty, or low-signal forms. ` +
          `Avoid hard reject rules based only on a broad entity, source, tag, or product name when evidence is mixed. ` +
          `Keep the static quality rules unless they are superseded. Preserve prior rule IDs when the rule meaning remains the same. ` +
          `Return concise rule descriptions that can be cited later through filter_rule_ids.\n\n` +
          JSON.stringify(
            {
              previous_guidelines: previousGuidelines || null,
              evidence
            },
            null,
            2
          )
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'preference_guideline_synthesis',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['rules', 'notes'],
          properties: {
            rules: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'type',
                  'kind',
                  'value',
                  'action',
                  'description',
                  'evidence_summary',
                  'confidence',
                  'example_item_ids'
                ],
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string', enum: ['prefer', 'reject', 'caution'] },
                  kind: { type: 'string' },
                  value: { type: 'string' },
                  action: {
                    type: 'string',
                    enum: ['keep_or_raise', 'skip_when_primary_signal', 'require_concrete_evidence']
                  },
                  description: { type: 'string' },
                  evidence_summary: { type: 'string' },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                  example_item_ids: { type: 'array', items: { type: 'string' } }
                }
              }
            },
            notes: { type: 'array', items: { type: 'string' } }
          }
        },
        strict: true
      }
    }
  };
}

async function readExistingGuidelines(jsonPath) {
  const pathToRead = jsonPath || PREFERENCE_GUIDELINE_JSON_PATH;
  if (!existsSync(pathToRead)) return null;
  try {
    return JSON.parse(await readFile(pathToRead, 'utf8'));
  } catch {
    return null;
  }
}

function evidenceExampleMap(evidence) {
  const examples = new Map();
  for (const example of evidence.labeled_examples || []) {
    examples.set(example.item_id, example);
  }
  return examples;
}

function normalizeLlmRule(rule, index, examplesById) {
  const type = ['prefer', 'reject', 'caution'].includes(rule.type) ? rule.type : 'caution';
  const kind = compact(rule.kind, 'semantic');
  const value = compact(rule.value, `rule-${index + 1}`);
  const action = ['keep_or_raise', 'skip_when_primary_signal', 'require_concrete_evidence'].includes(rule.action)
    ? rule.action
    : actionForRule(type);
  const fallbackId = `${type}-${slug(kind)}-${slug(value)}-001`;
  const id = compact(rule.id, fallbackId);
  const exampleIds = normalizeList(rule.example_item_ids).slice(0, MAX_EXAMPLES_PER_SIGNAL);

  return {
    id,
    type,
    kind,
    value,
    action,
    description: compact(rule.description, ruleText(type, { kind, value })),
    evidence: {
      source: 'llm_synthesis',
      summary: compact(rule.evidence_summary),
      confidence: Number.isFinite(Number(rule.confidence)) ? Number(rule.confidence) : 0.5
    },
    examples: exampleIds.map((itemId) => examplesById.get(itemId)).filter(Boolean)
  };
}

function countRules(rules) {
  return {
    total: rules.length,
    prefer: rules.filter((rule) => rule.type === 'prefer').length,
    reject: rules.filter((rule) => rule.type === 'reject').length,
    caution: rules.filter((rule) => rule.type === 'caution').length
  };
}

async function synthesizePreferenceGuidelinesWithLlm(evidence, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const previousGuidelines = options.previousGuidelines ?? (await readExistingGuidelines(options.jsonPath));
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(analysisRequestBody(evidence, previousGuidelines, options))
  });
  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { error: bodyText };
  }

  if (!response.ok) {
    throw new Error(`OpenAI preference guideline synthesis failed: ${response.status} ${JSON.stringify(body)}`);
  }

  const parsed = JSON.parse(extractResponseText(body));
  const examplesById = evidenceExampleMap(evidence);
  const staticIds = new Set(baselineRules().map((rule) => rule.id));
  const llmRules = (parsed.rules || [])
    .map((rule, index) => normalizeLlmRule(rule, index, examplesById))
    .filter((rule) => !staticIds.has(rule.id));
  const rules = [...baselineRules(), ...llmRules];

  return {
    version: 2,
    generated_by: 'llm_synthesis',
    generated_at: evidence.generated_at,
    item_count: evidence.item_count,
    preference_counts: evidence.preference_counts,
    labeled_item_count: evidence.labeled_item_count,
    source_summary: evidence.source_summary,
    synthesis_notes: normalizeList(parsed.notes),
    rule_counts: countRules(rules),
    rules
  };
}

function evidenceText(rule) {
  const evidence = rule.evidence || {};
  if (evidence.summary) {
    const confidence = Number.isFinite(Number(evidence.confidence))
      ? `, confidence ${Number(evidence.confidence).toFixed(2)}`
      : '';
    return `${evidence.summary}${confidence}`;
  }
  if (evidence.source) return evidence.source;
  return `+${evidence.positive_count || 0} / -${evidence.negative_count || 0}, score ${evidence.score_sum || 0}`;
}

function formatRule(rule) {
  const examples = (rule.examples || [])
    .slice(0, 2)
    .map((example) => `${example.label}: ${example.title}`)
    .join(' | ');
  return `- ${rule.id}: ${rule.description} Evidence: ${evidenceText(rule)}.${examples ? ` Examples: ${examples}.` : ''}`;
}

export function formatPreferenceGuidelinesMarkdown(guidelines) {
  const rules = guidelines.rules || [];
  const prefer = rules.filter((rule) => rule.type === 'prefer');
  const reject = rules.filter((rule) => rule.type === 'reject');
  const caution = rules.filter((rule) => rule.type === 'caution');
  const counts = guidelines.preference_counts || {};
  const sourceLines = (guidelines.source_summary || [])
    .map((source) => `- ${source.source}: +${source.positive} / -${source.negative}, score ${Number(source.score_sum || 0).toFixed(1)}`)
    .join('\n');

  return [
    '# First-Stage Article Filtering Guideline',
    '',
    `Generated at: ${guidelines.generated_at}`,
    `Generated by: ${guidelines.generated_by || 'unknown'}`,
    `Stored items analyzed: ${guidelines.item_count}`,
    `Preference labels analyzed: ${guidelines.labeled_item_count} (${counts.mustRead || 0} must_read, ${counts.useful || 0} useful, ${counts.notForMe || 0} not_for_me)`,
    guidelines.llm_error ? `LLM synthesis error: ${guidelines.llm_error}` : '',
    guidelines.synthesis_notes?.length ? `Synthesis notes: ${guidelines.synthesis_notes.join(' ')}` : '',
    '',
    '## Decision Policy',
    '',
    '- Use this guideline to decide whether a retrieved raw article should survive first-stage LLM curation.',
    '- Prefer specific technical substance over popularity, hype, generic product news, or broad discussion.',
    '- Positive preference signals should raise importance only when the item is concrete and technically useful.',
    '- Negative and quality rules can justify `skip=true`; cite matching `filter_rule_ids` for every skip when possible.',
    '- Mixed evidence rules are not hard filters. Use them to demand stronger concrete detail before keeping an item.',
    '',
    '## Source Preference Summary',
    '',
    sourceLines || '- No labeled source evidence yet.',
    '',
    '## Keep Or Raise',
    '',
    prefer.length ? prefer.map(formatRule).join('\n') : '- No dynamic positive rules have enough unambiguous support yet.',
    '',
    '## Reject Or Skip',
    '',
    reject.map(formatRule).join('\n'),
    '',
    '## Caution / Mixed Evidence',
    '',
    caution.length ? caution.map(formatRule).join('\n') : '- No mixed evidence rules have enough support yet.',
    '',
    '## Debugging Contract',
    '',
    '- Return `filter_rule_ids` as stable rule IDs from this document.',
    '- Return `filter_reason` as one concise sentence explaining the applied evidence.',
    '- If no rule applies, use `decision-uncertain-low-evidence-001` only when skipping for weak evidence.'
  ].join('\n');
}

export async function writePreferenceGuidelines(guidelines, options = {}) {
  const markdownPath = options.markdownPath || PREFERENCE_GUIDELINE_MARKDOWN_PATH;
  const jsonPath = options.jsonPath || PREFERENCE_GUIDELINE_JSON_PATH;
  await ensureDir(path.dirname(markdownPath));
  await ensureDir(path.dirname(jsonPath));
  await writeFile(markdownPath, formatPreferenceGuidelinesMarkdown(guidelines) + '\n', 'utf8');
  await writeFile(jsonPath, JSON.stringify(guidelines, null, 2) + '\n', 'utf8');
  return { markdownPath, jsonPath };
}

export async function generatePreferenceGuidelines(options = {}) {
  const itemStore = options.itemStore || (await readItemStore(options.itemStorePath));
  const preferenceStore = options.preferenceStore || (await readPreferenceStore(options.preferenceStorePath));
  const now = options.now || new Date().toISOString();
  const evidence = buildPreferenceGuidelineEvidence({ itemStore, preferenceStore, now });
  let guidelines = null;

  if (options.useLlm !== false) {
    try {
      guidelines = await synthesizePreferenceGuidelinesWithLlm(evidence, options);
    } catch (error) {
      guidelines = buildPreferenceGuidelines({ itemStore, preferenceStore, now, options });
      guidelines.llm_error = error.message;
    }
  }

  if (!guidelines) {
    guidelines = buildPreferenceGuidelines({ itemStore, preferenceStore, now, options });
    if (options.useLlm !== false) {
      guidelines.llm_error = 'OPENAI_API_KEY is not configured; wrote deterministic fallback guideline.';
    }
  }

  const paths = options.write === false ? {} : await writePreferenceGuidelines(guidelines, options);
  return { guidelines, ...paths };
}

export async function readPreferenceGuidelinePrompt(markdownPath = PREFERENCE_GUIDELINE_MARKDOWN_PATH) {
  if (!existsSync(markdownPath)) return '';
  return readFile(markdownPath, 'utf8');
}
