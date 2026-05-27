import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DIGEST_DIR, ensureDir } from './paths.js';
import { parseYaml } from './simple-yaml.js';

function yamlValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => JSON.stringify(String(item))).join(', ')}]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'null';
  return JSON.stringify(String(value));
}

function frontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${yamlValue(value)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function oneLine(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function markdownLink(url) {
  return url ? `<${url}>` : '';
}

function renderList(items) {
  const list = (items || []).map(oneLine).filter(Boolean);
  if (!list.length) return '- ';
  return list.map((item) => `- ${item}`).join('\n');
}

function compactTags(items) {
  const list = (items || []).map(oneLine).filter(Boolean);
  return list.length ? list.join(', ') : '';
}

const TAB_LABELS = {
  top: 'Top 10',
  hw: 'HW News',
  reddit: 'Reddit',
  dev: 'Dev',
  ai_agent: 'AI / Agent'
};

function renderEntry(post) {
  const originalUrl = post.original_url || post.canonical_url;
  const lines = [
    `### ${oneLine(post.title, '(untitled)')}`,
    '',
    `- Item ID: ${post.id}`,
    `- Score: ${post.score ?? 0}`,
    `- Comments: ${post.comment_count ?? 0}`,
    `- Comments/hour: ${Number(post.comments_per_hour || 0).toFixed(2)}`,
    `- Score/hour: ${Number(post.score_per_hour || 0).toFixed(2)}`,
    `- Hotness: ${Number(post.hotness || 0).toFixed(2)}`,
    `- Published: ${post.published_at || post.fetched_at}`,
    `- Source: ${oneLine(post.source_name, post.source_id)}`,
    `- Tab: ${oneLine(post.tab, 'dev')}`,
    `- Domain: ${oneLine(post.domain, 'reddit.com')}`,
    `- Author: ${post.author || 'unknown'}`,
    `- Importance: ${post.llm_importance ?? ''}`,
    `- Tags: ${compactTags(post.llm_tags || [])}`,
    '',
    '#### LLM Summary',
    '',
    post.llm_summary || '_No LLM summary generated._',
    '',
    '#### Why It Matters',
    '',
    post.llm_reason || '- ',
    '',
    '#### Entities',
    '',
    renderList(post.llm_entities || []),
    '',
    '#### Source Snippet',
    '',
    post.raw_summary || '_No source snippet._',
    '',
    '#### Notes',
    '',
    '<!-- Add personal notes here. -->',
    '',
    '#### Followups',
    '',
    '- [ ] ',
    '',
    '#### Links',
    '',
    `- Open: ${markdownLink(post.canonical_url)}`,
  ];

  if (post.adapter === 'reddit_rss' && post.original_url && post.original_url !== post.canonical_url) {
    lines.push(`- Reddit: ${markdownLink(post.original_url)}`);
  }

  lines.push(`- Original: ${markdownLink(originalUrl)}`);
  lines.push('');

  return lines.join('\n');
}

export function renderDigestMarkdown(digest) {
  const fields = {
    date: digest.date,
    generated_at: digest.generatedAt,
    timezone: digest.timezone,
    source: digest.sourceAccount || 'reddit-rss',
    configured_source_count: digest.configuredSourceCount || digest.configuredSubredditCount || 0,
    post_count: digest.posts.length,
    summary_status: digest.summaryStatus || 'skipped',
    generator: 'reddit-digest/0.1.0'
  };

  const groups = digest.groups || {
    top: digest.posts.slice(0, 10),
    byTab: digest.posts.reduce((map, post) => {
      if (!map.has(post.tab)) map.set(post.tab, []);
      map.get(post.tab).push(post);
      return map;
    }, new Map())
  };
  const sections = [
    ['top', groups.top || []],
    ['hw', groups.byTab?.get?.('hw') || []],
    ['reddit', groups.byTab?.get?.('reddit') || []],
    ['dev', groups.byTab?.get?.('dev') || []],
    ['ai_agent', groups.byTab?.get?.('ai_agent') || []]
  ];

  return [
    frontmatter(fields),
    '',
    `# Daily Tech Digest - ${digest.date}`,
    '',
    ...sections.flatMap(([tab, posts]) => [
      `## ${TAB_LABELS[tab]}`,
      '',
      ...(posts.length ? posts.map(renderEntry) : ['_No items._']),
      ''
    ])
  ].join('\n').trimEnd() + '\n';
}

export async function writeDigestMarkdown(digest, digestDir = DIGEST_DIR) {
  await ensureDir(digestDir);
  const filePath = path.join(digestDir, `${digest.date}.md`);
  await writeFile(filePath, renderDigestMarkdown(digest), 'utf8');
  return filePath;
}

export async function listDigests(digestDir = DIGEST_DIR) {
  if (!existsSync(digestDir)) return [];
  const files = await readdir(digestDir);
  return files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
    .map((file) => file.slice(0, -3))
    .sort()
    .reverse();
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) {
    return [{}, markdown];
  }

  const end = markdown.indexOf('\n---', 4);
  if (end === -1) return [{}, markdown];

  const raw = markdown.slice(4, end);
  const body = markdown.slice(end + 4).replace(/^\r?\n/, '');
  return [parseYaml(raw), body];
}

function sectionBody(block, heading) {
  const match = new RegExp(`^#### ${heading}\\s*$`, 'm').exec(block);
  if (!match) return '';
  const start = match.index + match[0].length;
  const rest = block.slice(start);
  const next = /^#### /m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function metadataValue(block, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^- ${escaped}:\\s*(.*)$`, 'mi').exec(block);
  return match ? match[1].trim() : '';
}

function parseLinks(block) {
  const links = {};
  const section = sectionBody(block, 'Links');
  for (const line of section.split(/\r?\n/)) {
    const match = /^- ([^:]+):\s*<?([^>]+)>?\s*$/.exec(line.trim());
    if (match) {
      links[match[1].toLowerCase()] = match[2];
    }
  }
  return links;
}

export function parseDigestMarkdown(markdown) {
  const [metadata, body] = parseFrontmatter(markdown);
  const sections = body.split(/^## /m).slice(1);
  const blocks = [];

  for (const section of sections) {
    const [sectionTitleLine, ...rest] = section.split(/\r?\n/);
    const sectionTitle = sectionTitleLine.trim();
    const entries = rest.join('\n').split(/^### /m).slice(1).map((block) => `### ${block}`);
    for (const entry of entries) {
      blocks.push({ sectionTitle, block: entry });
    }
  }

  const entries = blocks.map(({ sectionTitle, block }) => {
    const firstLine = block.split(/\r?\n/, 1)[0].replace(/^### /, '').trim();
    return {
      heading: firstLine,
      section: sectionTitle,
      id: metadataValue(block, 'Item ID'),
      subreddit: metadataValue(block, 'Source').startsWith('r/')
        ? metadataValue(block, 'Source').replace(/^r\//, '')
        : '',
      source: metadataValue(block, 'Source'),
      tab: metadataValue(block, 'Tab'),
      title: firstLine,
      summary: sectionBody(block, 'LLM Summary'),
      whyItMayMatter: [sectionBody(block, 'Why It Matters')].filter(Boolean),
      researchQuestions: [],
      entities: sectionBody(block, 'Entities')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2).trim()),
      cluster: metadataValue(block, 'Tab') || sectionTitle,
      sourceSnippet: sectionBody(block, 'Source Snippet'),
      notes: sectionBody(block, 'Notes'),
      followups: sectionBody(block, 'Followups'),
      links: parseLinks(block)
    };
  });

  return { metadata, entries, markdown };
}

export async function readDigest(date, digestDir = DIGEST_DIR) {
  const filePath = path.join(digestDir, `${date}.md`);
  const markdown = await readFile(filePath, 'utf8');
  return parseDigestMarkdown(markdown);
}
