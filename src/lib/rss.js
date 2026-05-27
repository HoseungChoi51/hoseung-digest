const ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
};

export function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, name) => ENTITY_MAP[name] || `&${name};`);
}

function stripHtml(value = '') {
  return decodeXmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagContent(block, tagName) {
  const match = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(block);
  return match ? decodeXmlEntities(match[1]).trim() : '';
}

function allEntryBlocks(xml) {
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
}

function linkHref(block) {
  const alternate = /<link\b(?=[^>]*\brel=["']alternate["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/i.exec(block);
  if (alternate) return decodeXmlEntities(alternate[1]);

  const first = /<link\b(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/i.exec(block);
  return first ? decodeXmlEntities(first[1]) : '';
}

export function extractPostId(value = '') {
  const text = String(value);
  const fullname = /\bt3_([a-z0-9]+)\b/i.exec(text);
  if (fullname) return fullname[1];

  const comments = /\/comments\/([a-z0-9]+)(?:\/|$)/i.exec(text);
  if (comments) return comments[1];

  return '';
}

export function parseRedditRss(xml, subreddit, seenAt = new Date().toISOString()) {
  return allEntryBlocks(xml)
    .map((block) => {
      const idSource = tagContent(block, 'id');
      const url = linkHref(block);
      const postId = extractPostId(idSource) || extractPostId(url);
      const rawContent = tagContent(block, 'content') || tagContent(block, 'summary');

      if (!postId || !url) return null;

      return {
        post_id: postId,
        subreddit,
        title: tagContent(block, 'title') || '(untitled)',
        url,
        published: tagContent(block, 'published') || tagContent(block, 'updated') || seenAt,
        updated: tagContent(block, 'updated') || '',
        author: tagContent(tagContent(block, 'author'), 'name').replace(/^\/?u\//i, ''),
        snippet: stripHtml(rawContent).slice(0, 700),
        seen_at: seenAt,
        source: 'rss'
      };
    })
    .filter(Boolean);
}

export function subredditFeedUrl(subreddit, limit = 100) {
  return `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new/.rss?limit=${limit}`;
}

export async function fetchSubredditRss(subreddit, config, fetchImpl = fetch) {
  const response = await fetchImpl(subredditFeedUrl(subreddit, config.poll.rss_limit), {
    headers: {
      Accept: 'application/atom+xml, application/rss+xml, text/xml',
      'User-Agent': config.reddit.user_agent
    }
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed for r/${subreddit}: ${response.status}`);
  }

  const xml = await response.text();
  return parseRedditRss(xml, subreddit);
}
