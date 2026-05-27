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
    subreddit: post.subreddit,
    title: post.title,
    type: post.isSelf ? 'text' : 'link',
    domain: post.domain,
    score: post.score,
    comments: post.numComments,
    reddit_url: post.permalink,
    external_url: post.externalUrl,
    selftext_excerpt: post.selftextExcerpt || ''
  };
}

export async function summarizePost(post, config) {
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
            'Summarize Reddit posts for a personal daily digest. Be concise, factual, and avoid inventing details that are not present in the input.'
        },
        {
          role: 'user',
          content:
            `Return JSON for this post. The summary should be 1-2 sentences. ` +
            `The why_it_may_matter list should contain 1-3 short bullets.\n\n` +
            JSON.stringify(summaryInput(post), null, 2)
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'reddit_post_summary',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['summary', 'why_it_may_matter'],
            properties: {
              summary: { type: 'string' },
              why_it_may_matter: {
                type: 'array',
                minItems: 1,
                maxItems: 3,
                items: { type: 'string' }
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
    throw new Error(`OpenAI summary failed: ${response.status} ${JSON.stringify(body)}`);
  }

  const text = extractResponseText(body);
  const parsed = JSON.parse(text);

  return {
    summary: parsed.summary,
    why_it_may_matter: parsed.why_it_may_matter
  };
}

export async function summarizePosts(posts, config) {
  if (!config.summary.enabled) {
    return { status: 'disabled', posts };
  }

  if (!process.env.OPENAI_API_KEY) {
    return { status: 'skipped_missing_openai_key', posts };
  }

  const limit = Math.min(config.summary.max_posts, posts.length);
  let failed = 0;

  for (let index = 0; index < limit; index += 1) {
    try {
      posts[index].summary = await summarizePost(posts[index], config);
    } catch (error) {
      failed += 1;
      posts[index].summary = {
        summary: '_Summary failed._',
        why_it_may_matter: [error.message]
      };
    }
  }

  return {
    status: failed ? `completed_with_${failed}_summary_errors` : 'completed',
    posts
  };
}
