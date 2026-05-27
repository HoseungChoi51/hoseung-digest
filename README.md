# Reddit Digest

A local, Markdown-first web app for turning your subscribed Reddit posts into a daily digest without Reddit's web feed distractions.

The durable source of truth is `content/digests/YYYY-MM-DD.md`. Runtime state such as OAuth tokens and temporary fetch cache lives under `.data/`.

## Requirements

- Node.js 22 or newer
- A Reddit OAuth web app from <https://www.reddit.com/prefs/apps>
- Optional OpenAI API key for summaries

## Setup

1. Copy `.env.example` to `.env.local`.
2. Fill in `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REDIRECT_URI`, and `REDDIT_USER_AGENT`.
3. Keep the redirect URI in Reddit's app settings identical to `REDDIT_REDIRECT_URI`.
4. Optional: set `OPENAI_API_KEY` to enable summaries.
5. Adjust `config/reddit-digest.yml` for subreddit filters, ranking, and digest size.

## Authenticate Reddit

Run the local app:

```sh
npm run dev
```

Open <http://127.0.0.1:3847>, then use **Connect Reddit**.

You can also authenticate from the terminal:

```sh
npm run auth:reddit
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

Each digest is a Markdown file with frontmatter and repeated post entries. Entries include metadata, optional AI summary, notes, follow-up checkboxes, Reddit/external links, and an `Original` link at the end.

Raw Reddit API responses are only temporary cache. By default, new digest runs fetch fresh data, write a short-lived cache copy, and purge cache files older than 48 hours. Set `cache.reuse: true` only when you intentionally want to reuse recent cached responses.

## Tests

```sh
npm test
```

## References

- Reddit Data API Wiki: <https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki>
- Reddit API docs: <https://www.reddit.com/dev/api/>
- Reddit OAuth2 wiki: <https://github.com/reddit-archive/reddit/wiki/OAuth2>
- OpenAI API docs: <https://developers.openai.com/api>
