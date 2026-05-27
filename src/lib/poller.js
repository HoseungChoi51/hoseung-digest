import { fetchSubredditRss, extractPostId } from './rss.js';
import { readPostStore, upsertPosts } from './post-store.js';

function selectedSubreddits(config) {
  const excluded = new Set(config.subreddits.exclude.map((name) => name.toLowerCase()));
  return config.subreddits.include.filter((name) => !excluded.has(name.toLowerCase()));
}

function postJsonUrl(post) {
  if (post.url && post.url.includes('/comments/')) {
    return `${post.url.replace(/\/$/, '')}.json?raw_json=1`;
  }
  return `https://www.reddit.com/comments/${post.post_id}.json?raw_json=1`;
}

function readListingPost(json, fallbackPostId) {
  const child = json?.[0]?.data?.children?.[0]?.data;
  if (!child) return null;

  return {
    post_id: child.id || fallbackPostId,
    score: Number(child.score || 0),
    numComments: Number(child.num_comments || 0),
    domain: child.domain || '',
    externalUrl: child.url || '',
    isSelf: Boolean(child.is_self),
    over18: Boolean(child.over_18),
    enriched_at: new Date().toISOString(),
    enrichment_error: ''
  };
}

export async function enrichPost(post, config, fetchImpl = fetch) {
  const response = await fetchImpl(postJsonUrl(post), {
    headers: {
      Accept: 'application/json',
      'User-Agent': config.reddit.user_agent
    }
  });

  if (!response.ok) {
    throw new Error(`JSON enrichment failed for ${post.post_id}: ${response.status}`);
  }

  const json = await response.json();
  return readListingPost(json, post.post_id);
}

export async function pollSubreddits(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date().toISOString();
  const store = options.store || (await readPostStore(options.storePath));
  const subreddits = selectedSubreddits(config);
  const fetched = [];
  const errors = [];

  if (!subreddits.length) {
    throw new Error('No subreddits configured. Add names to subreddits.include in config/reddit-digest.yml.');
  }

  for (const subreddit of subreddits) {
    try {
      const posts = await fetchSubredditRss(subreddit, config, fetchImpl);
      fetched.push(...posts.map((post) => ({ ...post, seen_at: now })));
    } catch (error) {
      errors.push({ subreddit, error: error.message });
    }
  }

  const firstPass = await upsertPosts(fetched, { store, storePath: options.storePath, now });
  const postsToEnrich = config.enrichment.enabled
    ? firstPass.newPosts.slice(0, config.enrichment.max_new_posts)
    : [];

  const enriched = [];
  for (const post of postsToEnrich) {
    try {
      const metadata = await enrichPost(post, config, fetchImpl);
      if (metadata) enriched.push({ ...metadata, post_id: extractPostId(metadata.post_id) || metadata.post_id });
    } catch (error) {
      enriched.push({
        post_id: post.post_id,
        enrichment_error: error.message,
        enriched_at: new Date().toISOString()
      });
    }
  }

  const finalPass = enriched.length
    ? await upsertPosts(enriched, { store: firstPass.store, storePath: options.storePath, now })
    : firstPass;

  return {
    store: finalPass.store,
    subreddits,
    fetched: fetched.length,
    inserted: firstPass.inserted,
    updated: firstPass.updated,
    enriched: enriched.filter((post) => !post.enrichment_error).length,
    enrichmentErrors: enriched.filter((post) => post.enrichment_error).length,
    errors
  };
}
