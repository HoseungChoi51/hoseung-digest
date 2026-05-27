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

function renderEntry(post) {
  const originalUrl = post.permalink;
  const lines = [
    `## r/${post.subreddit} - ${oneLine(post.title, '(untitled)')}`,
    '',
    `- Score: ${post.score ?? 0}`,
    `- Comments: ${post.numComments ?? 0}`,
    `- Comments/hour: ${Number(post.commentsPerHour || 0).toFixed(2)}`,
    `- Score/hour: ${Number(post.scorePerHour || 0).toFixed(2)}`,
    `- Created: ${post.createdAt}`,
    `- Type: ${post.isSelf ? 'text' : 'link'}`,
    `- Domain: ${oneLine(post.domain, 'reddit.com')}`,
    `- Author: ${post.author ? `u/${post.author}` : 'unknown'}`,
    `- Cluster: ${oneLine(post.cluster, 'Unclustered')}`,
    '- Tags: ',
    '',
    '### Summary',
    '',
    post.summary?.summary || '_No summary generated._',
    '',
    '### Why It May Matter',
    '',
    renderList(post.summary?.why_it_may_matter || []),
    '',
    '### Research Questions',
    '',
    renderList(post.summary?.research_questions || []),
    '',
    '### Notes',
    '',
    '<!-- Add personal notes here. -->',
    '',
    '### Followups',
    '',
    '- [ ] ',
    '',
    '### Links',
    '',
    `- Reddit: ${markdownLink(post.permalink)}`,
  ];

  if (post.externalUrl && post.externalUrl !== post.permalink) {
    lines.push(`- External: ${markdownLink(post.externalUrl)}`);
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
    configured_subreddit_count: digest.configuredSubredditCount || 0,
    post_count: digest.posts.length,
    summary_status: digest.summaryStatus || 'skipped',
    generator: 'reddit-digest/0.1.0'
  };

  return [
    frontmatter(fields),
    '',
    `# Reddit Digest - ${digest.date}`,
    '',
    ...digest.posts.map(renderEntry)
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
  const match = new RegExp(`^### ${heading}\\s*$`, 'm').exec(block);
  if (!match) return '';
  const start = match.index + match[0].length;
  const rest = block.slice(start);
  const next = /^### /m.exec(rest);
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
  const blocks = body.split(/^## /m).slice(1).map((block) => `## ${block}`);

  const entries = blocks.map((block) => {
    const firstLine = block.split(/\r?\n/, 1)[0].replace(/^## /, '').trim();
    const titleMatch = /^r\/([^-]+) - (.*)$/.exec(firstLine);
    return {
      heading: firstLine,
      subreddit: titleMatch ? titleMatch[1].trim() : '',
      title: titleMatch ? titleMatch[2].trim() : firstLine,
      summary: sectionBody(block, 'Summary'),
      whyItMayMatter: sectionBody(block, 'Why It May Matter')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2).trim()),
      researchQuestions: sectionBody(block, 'Research Questions')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2).trim()),
      cluster: metadataValue(block, 'Cluster') || 'Unclustered',
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
