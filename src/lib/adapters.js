import { createItem } from './normalizer.js';
import { extractPostId, fetchSubredditRss, parseFeedEntries, subredditFeedUrl } from './rss.js';

export function sourceUrl(source, config) {
  if (source.adapter === 'reddit_rss') {
    return source.url || subredditFeedUrl(source.subreddit, config.poll.rss_limit);
  }
  if (source.adapter === 'hackernews') {
    return `https://hacker-news.firebaseio.com/v0/${source.feed || 'topstories'}.json`;
  }
  return source.url;
}

function responseHeader(response, name) {
  return response.headers?.get?.(name) || '';
}

export async function fetchGenericRssSource(source, config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const sourceState = options.sourceState || {};
  const headers = {
    Accept: 'application/atom+xml, application/rss+xml, text/xml',
    'User-Agent': config.reddit.user_agent
  };

  if (sourceState.etag) headers['If-None-Match'] = sourceState.etag;
  if (sourceState.last_modified) headers['If-Modified-Since'] = sourceState.last_modified;

  const response = await fetchImpl(sourceUrl(source, config), { headers });

  if (response.status === 304) {
    return {
      items: [],
      notModified: true,
      etag: sourceState.etag || '',
      lastModified: sourceState.last_modified || ''
    };
  }

  if (!response.ok) {
    throw new Error(`RSS fetch failed for ${source.id}: ${response.status}`);
  }

  const fetchedAt = options.now || new Date().toISOString();
  const xml = await response.text();
  const entries = parseFeedEntries(xml, fetchedAt);

  return {
    items: entries.map((entry) => createItem(source, entry, fetchedAt)),
    notModified: false,
    etag: responseHeader(response, 'etag'),
    lastModified: responseHeader(response, 'last-modified')
  };
}

export async function fetchRedditRssSource(source, config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const fetchedAt = options.now || new Date().toISOString();
  const subreddit = source.subreddit || source.name.replace(/^r\//, '');
  const posts = await fetchSubredditRss(subreddit, config, fetchImpl);

  return {
    items: posts.map((post) =>
      createItem(
        source,
        {
          external_id: post.post_id,
          reddit_post_id: post.post_id,
          title: post.title,
          canonical_url: post.url,
          original_url: post.url,
          author: post.author,
          published_at: post.published,
          fetched_at: fetchedAt,
          raw_summary: post.snippet,
          subreddit
        },
        fetchedAt
      )
    ),
    notModified: false,
    etag: '',
    lastModified: ''
  };
}

function hnItemUrl(id) {
  return `https://news.ycombinator.com/item?id=${id}`;
}

export async function fetchHackerNewsSource(source, config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const fetchedAt = options.now || new Date().toISOString();
  const feed = source.feed || 'topstories';
  const listResponse = await fetchImpl(`https://hacker-news.firebaseio.com/v0/${feed}.json`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': config.reddit.user_agent
    }
  });

  if (!listResponse.ok) {
    throw new Error(`HN feed fetch failed for ${source.id}: ${listResponse.status}`);
  }

  const ids = (await listResponse.json()).slice(0, config.poll.hn_limit);
  const items = [];

  for (const id of ids) {
    const response = await fetchImpl(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': config.reddit.user_agent
      }
    });

    if (!response.ok) continue;
    const item = await response.json();
    if (!item || item.deleted || item.dead || item.type !== 'story') continue;

    items.push(
      createItem(
        source,
        {
          external_id: String(item.id),
          title: item.title,
          canonical_url: item.url || hnItemUrl(item.id),
          original_url: item.url || hnItemUrl(item.id),
          author: item.by || '',
          published_at: item.time ? new Date(item.time * 1000).toISOString() : fetchedAt,
          fetched_at: fetchedAt,
          raw_summary: '',
          score: item.score || 0,
          comment_count: item.descendants || 0
        },
        fetchedAt
      )
    );
  }

  return { items, notModified: false, etag: '', lastModified: '' };
}

function postJsonUrl(item) {
  if (item.original_url && item.original_url.includes('/comments/')) {
    return `${item.original_url.replace(/\/$/, '')}.json?raw_json=1`;
  }
  return `https://www.reddit.com/comments/${item.reddit_post_id}.json?raw_json=1`;
}

export async function enrichRedditItem(item, config, fetchImpl = fetch) {
  const postId = item.reddit_post_id || extractPostId(item.original_url || item.canonical_url);
  if (!postId) return null;

  const response = await fetchImpl(postJsonUrl({ ...item, reddit_post_id: postId }), {
    headers: {
      Accept: 'application/json',
      'User-Agent': config.reddit.user_agent
    }
  });

  if (!response.ok) {
    throw new Error(`JSON enrichment failed for ${postId}: ${response.status}`);
  }

  const json = await response.json();
  const child = json?.[0]?.data?.children?.[0]?.data;
  if (!child) return null;

  return {
    ...item,
    reddit_post_id: child.id || postId,
    score: Number(child.score || 0),
    comment_count: Number(child.num_comments || 0),
    domain: child.domain || item.domain,
    original_url: item.original_url || item.canonical_url,
    canonical_url: item.canonical_url,
    enriched_at: new Date().toISOString(),
    enrichment_error: ''
  };
}

export async function fetchSource(source, config, options = {}) {
  if (source.adapter === 'reddit_rss') return fetchRedditRssSource(source, config, options);
  if (source.adapter === 'hackernews') return fetchHackerNewsSource(source, config, options);
  return fetchGenericRssSource(source, config, options);
}
