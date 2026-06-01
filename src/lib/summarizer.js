import { readPreferenceGuidelinePrompt } from './preference-guidelines.js';

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

function summaryInput(post) {
  return {
    item_id: post.id,
    source: post.source_name,
    tab_hint: post.tab,
    title: post.title,
    domain: post.domain,
    score: post.score,
    comment_count: post.comment_count,
    comments_per_hour: Number(post.comments_per_hour || 0).toFixed(2),
    score_per_hour: Number(post.score_per_hour || 0).toFixed(2),
    watchlist_hits: post.watchlist_hits || [],
    preference_boost: Number(post.preference_boost || 0).toFixed(2),
    preference_reasons: post.preference_reasons || [],
    published_at: post.published_at,
    url: post.canonical_url,
    summary_snippet: post.raw_summary || ''
  };
}

function curationUserPrompt(posts, guidelineText = '') {
  const guidelineSection = guidelineText
    ? `Preference filtering guideline. Use the rule IDs from this document for filter_rule_ids:\n\n${guidelineText}\n\n`
    : '';

  return (
    `Return JSON for these items. Mark skip=true for low-signal, duplicate, promotional, or irrelevant items. ` +
    `Use preference_boost and preference_reasons as personal relevance hints, but do not let them override clearly low-quality or off-topic evidence. ` +
    `Use filter_rule_ids and filter_reason to make every filtering decision debuggable. ` +
    `When the guideline applies, cite stable rule IDs from it. ` +
    `Classify each item into one of: hw, reddit, dev, ai_agent. ` +
    `Importance is 1-5. Summary should be 1-2 concise sentences that explain what happened and include the most specific useful entities from the title/snippet. ` +
    `If the snippet is empty, summarize only what can be known from the title/source/domain. ` +
    `why_it_matters should be one concise sentence for a technical reader; use an empty string if there is no clear technical relevance.\n\n` +
    guidelineSection +
    JSON.stringify(posts.map(summaryInput), null, 2)
  );
}

export function buildAnalysisRequestBody(posts, config, guidelineText = '') {
  return {
    model: config.summary.model,
    input: [
      {
        role: 'system',
        content:
          'Curate technical news metadata for a personal daily digest. Use only the provided title, source, URL/domain, metrics, feed snippet, and preference guideline. Prefer technical relevance over hype. Write self-contained summaries, but do not infer facts that are not supported by the input.'
      },
      {
        role: 'user',
        content: curationUserPrompt(posts, guidelineText)
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'daily_digest_curation',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['entries'],
          properties: {
            entries: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'item_id',
                  'tab',
                  'importance',
                  'summary',
                  'why_it_matters',
                  'entities',
                  'tags',
                  'skip',
                  'skip_reason',
                  'filter_rule_ids',
                  'filter_reason'
                ],
                properties: {
                  item_id: { type: 'string' },
                  tab: { type: 'string', enum: ['hw', 'reddit', 'dev', 'ai_agent'] },
                  importance: { type: 'integer', minimum: 1, maximum: 5 },
                  summary: { type: 'string' },
                  why_it_matters: { type: 'string' },
                  entities: { type: 'array', items: { type: 'string' } },
                  tags: { type: 'array', items: { type: 'string' } },
                  skip: { type: 'boolean' },
                  skip_reason: { type: 'string' },
                  filter_rule_ids: { type: 'array', items: { type: 'string' } },
                  filter_reason: { type: 'string' }
                }
              }
            }
          }
        },
        strict: true
      }
    }
  };
}

function normalizeRuleIds(value) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

export function applyCurationEntry(post, entry) {
  if (!entry) return { ...post };
  const filterRuleIds = normalizeRuleIds(entry.filter_rule_ids);
  const filterReason = entry.filter_reason || entry.skip_reason || '';

  return {
    ...post,
    tab: entry.tab || post.tab,
    llm_importance: entry.importance,
    llm_summary: entry.summary || '',
    llm_reason: entry.why_it_matters || '',
    llm_tags: entry.tags || [],
    llm_entities: entry.entities || [],
    llm_skip: Boolean(entry.skip),
    llm_skip_reason: entry.skip_reason || '',
    llm_filter_rule_ids: filterRuleIds,
    llm_filter_reason: filterReason
  };
}

export async function analyzePosts(posts, config) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const guidelineText = await readPreferenceGuidelinePrompt();

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildAnalysisRequestBody(posts, config, guidelineText))
  });

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { error: bodyText };
  }

  if (!response.ok) {
    throw new Error(`OpenAI digest analysis failed: ${response.status} ${JSON.stringify(body)}`);
  }

  const text = extractResponseText(body);
  return JSON.parse(text);
}

export async function summarizePosts(posts, config, options = {}) {
  if (!posts.length) {
    return { status: 'skipped_no_posts', posts };
  }

  if (!config.summary.enabled) {
    return { status: 'disabled', posts };
  }

  if (!process.env.OPENAI_API_KEY) {
    return { status: 'skipped_missing_openai_key', posts };
  }

  const limit = Math.min(config.summary.max_posts, posts.length);
  if (limit === 0) {
    return { status: 'skipped_no_summary_budget', posts };
  }

  const forceRefresh = Boolean(options.forceRefresh || config.summary.force_refresh);
  const candidateIndexes = posts
    .slice(0, limit)
    .map((post, index) => ({ post, index }))
    .filter(({ post }) =>
      forceRefresh ||
      !post.llm_summary ||
      post.llm_summary === '_Summary failed._' ||
      post.llm_importance === null
    );
  const candidates = candidateIndexes.map(({ post }) => post);

  if (!candidates.length) {
    return { status: 'reused_cached_summaries', posts };
  }

  try {
    const analysis = await analyzePosts(candidates, config);
    const byId = new Map((analysis?.entries || []).map((entry) => [entry.item_id, entry]));
    const nextPosts = [...posts];

    for (const { post, index } of candidateIndexes) {
      const entry = byId.get(post.id);
      const next = applyCurationEntry(post, entry);
      nextPosts[index] = next;
    }

    return {
      status: 'completed',
      posts: nextPosts
    };
  } catch (error) {
    for (const post of candidates) {
      post.llm_summary = post.llm_summary || '_Summary failed._';
      post.llm_reason = error.message;
    }

    return {
      status: 'completed_with_summary_error',
      posts
    };
  }
}
