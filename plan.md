# Daily Tech Digest Implementation Plan

## Summary

Expand the RSS-first Reddit digest into a broader technical digest while keeping the existing Node.js app. The app uses normalized source adapters for generic RSS, Reddit RSS, and Hacker News, stores lightweight item metadata locally, ranks and deduplicates before LLM curation, and writes Markdown digests grouped by tabs.

## Implemented Direction

- Keep the Node.js dependency-light architecture instead of rewriting to Python/FastAPI.
- Use `config/sources.yml` for general RSS and Hacker News sources.
- Keep `config/reddit-digest.yml` for subreddit lists, ranking, watchlist terms, digest limits, and runtime settings.
- Store normalized items in `.data/items.json`.
- Preserve migration compatibility with older `.data/posts.json`.
- Generate Markdown digests under `content/digests/YYYY-MM-DD.md`.

## Source Adapters

- `rss`: generic RSS/Atom feed parser with ETag and Last-Modified support.
- `reddit_rss`: per-subreddit `/new/.rss?limit=100` ingestion with best-effort JSON enrichment for new posts.
- `hackernews`: Hacker News Firebase API ingestion for top/new stories.

All adapters emit a normalized item shape with source, tab, canonical URL, title, timestamps, snippet, score/comment metadata, and user feedback fields.

## Ranking And Curation

- Deduplicate by canonical URL, external ID, then normalized title.
- Rank by source priority, recency, score, comment count, comments/hour, score/hour, watchlist boosts, negative keyword penalties, and stored LLM importance.
- Send only compact metadata to the LLM after ranking.
- Store LLM importance, summary, reason, entities, tags, and skip decisions back into the item store.

## UI And Digest

- Web UI has polling, generation, source filter, tab filter, tab shortcuts, raw Markdown view, save/hide, preference labels, and a historical Library view for stored, saved, hidden, and preferred items.
- Markdown digest sections are `Top 10`, `HW News`, `Reddit`, `Dev`, and `AI / Agent`.
- Entries keep source metadata, summary/snippet, why-it-matters, notes, follow-ups, and original links.

## Tests

- RSS and Reddit feed parsing.
- Normalized item store upsert and feedback persistence.
- Date filtering, deduplication, ranking, and watchlist boosts.
- Markdown rendering/parsing with original links.
- Syntax checks for server and CLI entrypoints.

## Next Milestones

- Add source health UI in Settings.
- Add source-level feedback and preference summaries.
- Add OPML export/import for RSS sources.
- Add SQLite once `.data/items.json` becomes too large or slow.
