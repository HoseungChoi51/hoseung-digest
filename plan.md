# RSS-First Reddit Digest Migration Plan

## Summary

Move the project away from Reddit Data API/OAuth for development convenience. The app will use public subreddit RSS feeds as the primary ingestion source, keep a manual subreddit list in config, store locally seen post metadata, optionally enrich only new posts with public Reddit JSON, and generate Markdown digests from lightweight metadata.

## Key Changes

- Make `config/reddit-digest.yml` the source of truth for the manually maintained subreddit list.
- Poll `https://www.reddit.com/r/{subreddit}/new/.rss?limit=100` for each configured subreddit.
- Store local post state under `.data/posts.json` with `post_id`, `subreddit`, `title`, `url`, `published`, `seen_at`, snippet, score/comment metadata, and derived velocity fields.
- Remove Reddit OAuth from the default setup, UI, status endpoint, and README.
- Add best-effort JSON enrichment for new posts only, using public Reddit JSON URLs to fetch `score` and `num_comments`.
- Compute `comments_per_hour` and `score_per_hour` from post age and enrichment data.
- Send only title/snippet/metadata to the LLM for filtering, clustering, and summaries.
- Keep Markdown digests as the durable, human-readable knowledge-base source.

## Implementation Notes

- Add RSS parsing utilities with no external dependencies.
- Add a local post store module for read/write/upsert/count operations.
- Replace OAuth Reddit client code with RSS polling and optional JSON enrichment.
- Update digest generation to poll first, persist seen posts, rank posts for the requested date, summarize selected posts, and write Markdown.
- Add a `npm run poll` command for manual polling without generating a digest.
- Replace the UI’s “Connect Reddit” action with status for configured subreddit count, stored post count, last poll time, and OpenAI availability.

## Test Plan

- RSS parser tests using fixture XML.
- Post ID extraction tests for Reddit links.
- Post store upsert tests that preserve first `seen_at`.
- Enrichment tests for success and failure behavior.
- Ranking tests for comments-per-hour and date filtering.
- Markdown tests confirming each entry keeps an `Original` link.
- Server/status tests that do not require Reddit OAuth environment variables.

## Assumptions

- The first version uses a manual list of about ten subreddits.
- RSS polling is the primary ingestion path.
- JSON enrichment is best-effort and non-fatal.
- No full linked article bodies or full comment threads are sent to the LLM.
- Existing Data API/OAuth code can be removed from the default product path.
