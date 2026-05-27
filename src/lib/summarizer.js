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
    post_id: post.post_id || post.id,
    subreddit: post.subreddit,
    title: post.title,
    type: post.isSelf ? 'text' : 'link',
    domain: post.domain,
    score: post.score,
    comments: post.numComments,
    comments_per_hour: Number(post.commentsPerHour || 0).toFixed(2),
    score_per_hour: Number(post.scorePerHour || 0).toFixed(2),
    published: post.createdAt || post.published,
    reddit_url: post.permalink,
    external_url: post.externalUrl,
    snippet: post.selftextExcerpt || post.snippet || ''
  };
}

export async function analyzePosts(posts, config) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.summary.model,
      input: [
        {
          role: 'system',
          content:
            'Filter, cluster, and summarize Reddit post metadata for a personal daily digest. Use only the provided metadata. Be concise and do not invent facts.'
        },
        {
          role: 'user',
          content:
            `Return JSON for these posts. Mark include=false for low-signal posts. ` +
            `Use short cluster labels. Summaries should be 1 sentence per included post. ` +
            `why_it_may_matter should contain 1-3 short bullets.\n\n` +
            JSON.stringify(posts.map(summaryInput), null, 2)
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'reddit_digest_analysis',
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
                    'post_id',
                    'include',
                    'cluster',
                    'summary',
                    'why_it_may_matter',
                    'research_questions'
                  ],
                  properties: {
                    post_id: { type: 'string' },
                    include: { type: 'boolean' },
                    cluster: { type: 'string' },
                    summary: { type: 'string' },
                    why_it_may_matter: {
                      type: 'array',
                      minItems: 0,
                      maxItems: 3,
                      items: { type: 'string' }
                    },
                    research_questions: {
                      type: 'array',
                      minItems: 0,
                      maxItems: 3,
                      items: { type: 'string' }
                    }
                  }
                }
              }
            }
          },
          strict: true
        }
      }
    })
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

export async function summarizePosts(posts, config) {
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

  const candidates = posts.slice(0, limit);

  try {
    const analysis = await analyzePosts(candidates, config);
    const byId = new Map((analysis?.entries || []).map((entry) => [entry.post_id, entry]));
    const analyzed = candidates
      .map((post) => {
        const entry = byId.get(post.post_id || post.id);
        if (!entry) return { ...post, cluster: 'Unclustered' };
        return {
          ...post,
          cluster: entry.cluster || 'Unclustered',
          summary: {
            summary: entry.summary || '_No summary generated._',
            why_it_may_matter: entry.why_it_may_matter || [],
            research_questions: entry.research_questions || []
          },
          llmIncluded: entry.include !== false
        };
      })
      .filter((post) => post.llmIncluded !== false);

    return {
      status: 'completed',
      posts: analyzed.concat(posts.slice(limit))
    };
  } catch (error) {
    for (const post of candidates) {
      post.cluster = 'Unclustered';
      post.summary = {
        summary: '_Summary failed._',
        why_it_may_matter: [error.message],
        research_questions: []
      };
    }

    return {
      status: 'completed_with_summary_error',
      posts
    };
  }
}
