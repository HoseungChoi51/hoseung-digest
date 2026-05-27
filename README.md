# Reddit Digest

A local, Markdown-first web app for turning selected subreddit RSS feeds into a daily digest without Reddit's web feed distractions.

The durable source of truth is `content/digests/YYYY-MM-DD.md`. Runtime state such as seen posts and temporary fetch cache lives under `.data/`.

## Requirements

- Node.js 22 or newer
- A manually maintained subreddit list in `config/reddit-digest.yml`
- Optional OpenAI API key for summaries

## Setup

1. Copy `.env.example` to `.env.local`.
2. Optional: set `REDDIT_USER_AGENT`.
3. Optional: set `OPENAI_API_KEY` to enable filtering, clustering, and summaries.
4. Adjust `config/reddit-digest.yml` with the subreddits you want to follow.

No Reddit OAuth app is required. The app polls public RSS feeds such as `https://www.reddit.com/r/programming/new/.rss?limit=100`.

## Poll RSS

Poll configured subreddit RSS feeds and store seen posts locally:

```sh
npm run poll
```

## Generate A Digest

Generate today's digest:

```sh
npm run digest:today
```

Generate a digest for a specific local date:

```sh
npm run digest -- --date 2026-05-27
```

The web app also has a generate button that invokes the same digest generator.

## Content Format

Each digest is a Markdown file with frontmatter and repeated post entries. Entries include metadata, comments-per-hour, score-per-hour, optional AI cluster/summary, notes, follow-up checkboxes, Reddit/external links, and an `Original` link at the end.

RSS/JSON responses are only temporary inputs. The local post store keeps lightweight metadata in `.data/posts.json`; Markdown digests remain the durable human-readable record.

## Tests

```sh
npm test
```

## References

- Reddit RSS feeds are consumed from subreddit `/new/.rss` endpoints.
- OpenAI API docs: <https://developers.openai.com/api>
