function normalizeTerms(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function itemSearchText(item) {
  return [
    item.title,
    item.raw_summary,
    item.domain,
    item.source_name,
    item.canonical_url,
    item.original_url
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termMatches(text, term) {
  const normalized = String(term || '').trim().toLowerCase();
  if (!normalized) return false;

  const startsWithWord = /^[a-z0-9]/.test(normalized);
  const endsWithWord = /[a-z0-9]$/.test(normalized);
  const pattern = `${startsWithWord ? '(?<![a-z0-9])' : ''}${escapeRegExp(normalized)}${
    endsWithWord ? '(?![a-z0-9])' : ''
  }`;

  return new RegExp(pattern, 'i').test(text);
}

export function matchingTerms(item, terms) {
  const text = itemSearchText(item);
  return normalizeTerms(terms).filter((term) => termMatches(text, term));
}

export function passesSourceFilters(item, source = {}) {
  const minScore = optionalNumber(source.min_score);
  const minComments = optionalNumber(source.min_comments);
  const score = Number(item.score || 0);
  const commentCount = Number(item.comment_count || 0);

  if (minScore !== null && score < minScore) return false;
  if (minComments !== null && commentCount < minComments) return false;

  const includeTerms = normalizeTerms(source.include_terms);
  if (includeTerms.length && !matchingTerms(item, includeTerms).length) return false;

  const excludeTerms = normalizeTerms(source.exclude_terms);
  if (excludeTerms.length && matchingTerms(item, excludeTerms).length) return false;

  return true;
}
