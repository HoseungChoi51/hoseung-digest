import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { canonicalizeUrl, normalizeTitle, urlDomain } from './normalizer.js';
import { DATA_DIR, PREFERENCE_STORE_PATH, ensureDir } from './paths.js';

const LABEL_SCORES = {
  must_read: 2,
  useful: 1,
  neutral: 0,
  not_for_me: -1
};

function emptyStore() {
  return {
    version: 1,
    updated_at: null,
    items: {},
    events: []
  };
}

function normalizeScore(value, label = 'neutral') {
  if (value === undefined || value === null || value === '') {
    return LABEL_SCORES[label] ?? 0;
  }

  const score = Number(value);
  if (!Number.isFinite(score)) return LABEL_SCORES[label] ?? 0;
  return Math.max(-2, Math.min(2, Math.round(score)));
}

function normalizeLabel(value, score) {
  const label = String(value || '').trim();
  if (Object.hasOwn(LABEL_SCORES, label)) return label;
  if (score >= 2) return 'must_read';
  if (score >= 1) return 'useful';
  if (score <= -1) return 'not_for_me';
  return 'neutral';
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function compact(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function entryUrl(entry = {}) {
  return (
    entry.links?.article ||
    entry.links?.original ||
    entry.links?.open ||
    entry.original_url ||
    entry.canonical_url ||
    entry.url ||
    ''
  );
}

function entryOpenUrl(entry = {}) {
  return entry.links?.open || entry.canonical_url || entry.url || '';
}

function inferDomain(entry = {}) {
  return entry.domain || urlDomain(entryUrl(entry)) || urlDomain(entryOpenUrl(entry));
}

export async function readPreferenceStore(storePath = PREFERENCE_STORE_PATH) {
  if (!existsSync(storePath)) return emptyStore();
  const parsed = JSON.parse(await readFile(storePath, 'utf8'));
  return {
    ...emptyStore(),
    ...parsed,
    items: parsed.items || {},
    events: parsed.events || []
  };
}

export async function writePreferenceStore(store, storePath = PREFERENCE_STORE_PATH) {
  await ensureDir(DATA_DIR);
  await writeFile(storePath, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

export function preferenceStats(store) {
  const items = Object.values(store.items || {});
  return {
    total: items.length,
    mustRead: items.filter((item) => item.label === 'must_read').length,
    useful: items.filter((item) => item.label === 'useful').length,
    neutral: items.filter((item) => item.label === 'neutral').length,
    notForMe: items.filter((item) => item.label === 'not_for_me').length,
    lastUpdatedAt: store.updated_at || null
  };
}

export async function upsertPreference(itemId, payload = {}, options = {}) {
  const storePath = options.storePath || PREFERENCE_STORE_PATH;
  const store = options.store || (await readPreferenceStore(storePath));
  const now = options.now || new Date().toISOString();
  const entry = payload.entry || {};
  const existing = store.items[itemId] || {};
  const score = normalizeScore(payload.score, payload.label);
  const label = normalizeLabel(payload.label, score);
  const openUrl = canonicalizeUrl(entryOpenUrl(entry));
  const originalUrl = canonicalizeUrl(entryUrl(entry));
  const preference = {
    ...existing,
    item_id: itemId,
    label,
    score,
    title: compact(entry.title, existing.title),
    source: compact(entry.source, existing.source),
    tab: compact(entry.tab, existing.tab),
    section: compact(entry.section, existing.section),
    domain: compact(inferDomain(entry), existing.domain),
    canonical_url: openUrl || existing.canonical_url || '',
    original_url: originalUrl || existing.original_url || openUrl || '',
    links: entry.links || existing.links || {},
    summary: compact(entry.summary, existing.summary),
    entities: normalizeList(entry.entities?.length ? entry.entities : existing.entities),
    tags: normalizeList(entry.tags?.length ? entry.tags : existing.tags),
    note: compact(payload.note, existing.note),
    first_marked_at: existing.first_marked_at || now,
    updated_at: now
  };

  store.items[itemId] = preference;
  store.events.push({
    item_id: itemId,
    label,
    score,
    title: preference.title,
    source: preference.source,
    domain: preference.domain,
    created_at: now
  });
  store.updated_at = now;
  await writePreferenceStore(store, storePath);

  return { store, preference };
}

export async function deletePreference(itemId, options = {}) {
  const storePath = options.storePath || PREFERENCE_STORE_PATH;
  const store = options.store || (await readPreferenceStore(storePath));
  const now = options.now || new Date().toISOString();
  const existing = store.items[itemId] || null;

  if (existing) {
    delete store.items[itemId];
    store.events.push({
      item_id: itemId,
      label: 'cleared',
      score: 0,
      title: existing.title || '',
      source: existing.source || '',
      domain: existing.domain || '',
      created_at: now
    });
    store.updated_at = now;
    await writePreferenceStore(store, storePath);
  }

  return { store, preference: null, deleted: Boolean(existing) };
}

function average(items) {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + Number(item.score || 0), 0) / items.length;
}

function overlapScore(itemTerms, preferenceTerms, score) {
  const itemSet = new Set(itemTerms.map((term) => term.toLowerCase()));
  const overlap = preferenceTerms.filter((term) => itemSet.has(term.toLowerCase()));
  return overlap.length ? score * Math.min(3, overlap.length) : 0;
}

export function preferenceBoostForItem(item, store = emptyStore()) {
  const preferences = Object.values(store.items || {}).filter((preference) =>
    Number.isFinite(Number(preference.score))
  );
  if (!preferences.length) return { score: 0, reasons: [] };

  const exact = store.items?.[item.id];
  const itemDomain = item.domain || urlDomain(item.original_url || item.canonical_url);
  const itemSource = item.source_name || item.source_id;
  const itemTerms = [
    ...normalizeList(item.llm_tags),
    ...normalizeList(item.llm_entities),
    ...normalizeTitle(item.title).split(/\s+/).filter((term) => term.length >= 3)
  ];
  const domainMatches = itemDomain
    ? preferences.filter((preference) => preference.domain === itemDomain)
    : [];
  const sourceMatches = itemSource
    ? preferences.filter((preference) => preference.source === itemSource)
    : [];
  const tagScore = preferences.reduce(
    (sum, preference) =>
      sum + overlapScore(itemTerms, [...normalizeList(preference.tags), ...normalizeList(preference.entities)], preference.score),
    0
  );
  const reasons = [];
  let score = 0;

  if (exact) {
    score += Number(exact.score || 0) * 160;
    reasons.push(`exact:${exact.score}`);
  }
  if (domainMatches.length) {
    const domainAverage = average(domainMatches);
    score += domainAverage * 24 * Math.min(3, Math.log1p(domainMatches.length));
    reasons.push(`domain:${itemDomain}:${domainAverage.toFixed(2)}`);
  }
  if (sourceMatches.length) {
    const sourceAverage = average(sourceMatches);
    score += sourceAverage * 12 * Math.min(3, Math.log1p(sourceMatches.length));
    reasons.push(`source:${itemSource}:${sourceAverage.toFixed(2)}`);
  }
  if (tagScore) {
    score += tagScore * 12;
    reasons.push(`terms:${tagScore.toFixed(2)}`);
  }

  return { score, reasons };
}
