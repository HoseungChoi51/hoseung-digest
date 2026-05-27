# Daily Tech Digest Aggregator Plan

## 1. Goal

Build a one-page, scrollable web app that aggregates updates from selected tech/news/RSS sources, Reddit, and Hacker News, then produces a curated daily digest with a few tabs:

- **HW News**: hardware, Linux, HPC, semiconductors, systems, infrastructure
- **Reddit**: selected subreddits, ranked by freshness and discussion activity
- **Dev**: developer news, software engineering, cloud-native, tooling
- **AI / Agent**: AI research, agent frameworks, LLM tooling, AI industry news

The app should reduce browsing friction by converting many active feeds into a concise, ranked, deduplicated digest.

---

## 2. High-Level Architecture

```text
RSS / APIs / Reddit
        |
        v
+-------------------+
| Source Fetchers   |
| RSS, HN API,      |
| Reddit RSS/API    |
+-------------------+
        |
        v
+-------------------+
| Normalizer        |
| canonical URL,    |
| title, time, tab  |
+-------------------+
        |
        v
+-------------------+
| Storage           |
| SQLite/Postgres   |
+-------------------+
        |
        v
+-------------------+
| Ranking + Dedup   |
| hotness, recency, |
| source priority   |
+-------------------+
        |
        v
+-------------------+
| LLM Curator       |
| classify, summarize,
| explain relevance |
+-------------------+
        |
        v
+-------------------+
| Web App           |
| daily digest tabs |
+-------------------+
```

Recommended MVP stack:

```text
Backend:     Python + FastAPI
Fetcher:     httpx + feedparser + APScheduler
Database:    SQLite for MVP, Postgres later
Frontend:    React / Next.js or simple server-rendered HTML
LLM layer:   OpenAI API or local model, called only on top-ranked items
Deployment:  Docker Compose on local server, NAS, cloud VM, or home lab
```

---

## 3. Source Coverage

### 3.1 Initial Feed List

These feed URLs should be smoke-tested because publishers occasionally change endpoints or block unusual clients.

```yaml
# HW / Linux / HPC
- id: phoronix_all
  name: Phoronix
  tab: hw
  url: https://www.phoronix.com/phoronix-rss.php
  priority: 0.95
  poll_minutes: 30

- id: phoronix_news
  name: Phoronix News
  tab: hw
  url: https://www.phoronix.com/rss/rss_news.php
  priority: 0.90
  poll_minutes: 30

- id: hpcwire
  name: HPCwire
  tab: hw
  url: https://www.hpcwire.com/feed/
  priority: 0.85
  poll_minutes: 60

- id: next_platform
  name: The Next Platform
  tab: hw
  url: https://www.nextplatform.com/feed/
  priority: 0.90
  poll_minutes: 60

- id: toms_hardware
  name: Tom's Hardware
  tab: hw
  url: https://www.tomshardware.com/feeds.xml
  priority: 0.75
  poll_minutes: 60

# General tech / consumer tech / industry
- id: techcrunch
  name: TechCrunch
  tab: ai_agent
  url: https://techcrunch.com/feed/
  priority: 0.65
  poll_minutes: 60

- id: the_verge
  name: The Verge
  tab: ai_agent
  url: https://www.theverge.com/rss/index.xml
  priority: 0.65
  poll_minutes: 60

- id: engadget
  name: Engadget
  tab: ai_agent
  url: https://www.engadget.com/rss.xml
  priority: 0.55
  poll_minutes: 60

- id: wired_top
  name: WIRED Top Stories
  tab: ai_agent
  url: https://www.wired.com/feed/rss
  priority: 0.65
  poll_minutes: 60

- id: wired_ai
  name: WIRED AI
  tab: ai_agent
  url: https://www.wired.com/feed/tag/ai/latest/rss
  priority: 0.75
  poll_minutes: 60

- id: zdnet_news
  name: ZDNet News
  tab: ai_agent
  url: https://www.zdnet.com/news/rss.xml
  priority: 0.55
  poll_minutes: 60

- id: zdnet_ai
  name: ZDNet AI
  tab: ai_agent
  url: https://www.zdnet.com/topic/artificial-intelligence/rss.xml
  priority: 0.65
  poll_minutes: 60

- id: zdnet_security
  name: ZDNet Security
  tab: dev
  url: https://www.zdnet.com/topic/security/rss.xml
  priority: 0.60
  poll_minutes: 60

# Developer / social news
- id: hackernews_top
  name: Hacker News Top
  tab: dev
  adapter: hackernews_api
  priority: 0.90
  poll_minutes: 20

- id: hackernews_new
  name: Hacker News New
  tab: dev
  adapter: hackernews_api
  priority: 0.65
  poll_minutes: 20

# Needs discovery / optional
- id: alphasignal
  name: AlphaSignal
  tab: ai_agent
  url: null
  adapter: newsletter_or_feed_discovery
  priority: 0.80
  poll_minutes: 1440
```

### 3.2 Feed Support Notes

| Source | Use RSS? | Suggested Handling |
|---|---:|---|
| Phoronix | Yes | Use official RSS endpoints. Good HW/Linux source. |
| HPCwire | Yes | Use `/feed/`; validate with smoke test. |
| The Next Platform | Yes | Use `/feed/`; high-value for systems/HPC/cloud infrastructure. |
| AlphaSignal | Unclear | Treat as newsletter/source-discovery item. Use RSS only if a stable endpoint is found. |
| Hacker News | Prefer API | Use official Firebase API for score and comment count. RSS is possible but less useful. |
| ZDNet | Yes, but fragile | Use topic feeds where possible. Monitor breakage. |
| TechCrunch | Yes | Respect RSS terms and attribution/link-back. |
| WIRED | Yes | Use topic feeds, especially AI, Gear, Security, Science. |
| The Verge | Yes | Use public RSS; premium items may be preview-only. |
| Engadget | Yes | Use main feed or topic feeds. |
| Tom's Hardware | Yes | Use main feed; add topic feeds later if stable. |

---

## 4. Additional Recommended Sources

### 4.1 HW / Linux / HPC / Infrastructure

Add these after the MVP is working:

```yaml
- Ars Technica
- ServeTheHome
- The Register: HPC, AI/ML, Cloud, Software
- insideHPC
- TOP500
- AWS HPC Blog
- Puget Systems Blog
- TechPowerUp
- Chips and Cheese
- IEEE Spectrum
- NVIDIA Technical Blog
- AMD Community / ROCm Blog
- Intel Developer Blog
- RISC-V International Blog
- SemiAnalysis, if subscription/access allows
```

### 4.2 Dev / Software Engineering

```yaml
- InfoQ
- Stack Overflow Blog
- GitHub Blog
- GitHub Changelog
- Kubernetes Blog
- CNCF Blog
- Cloudflare Blog
- AWS Architecture Blog
- Google Cloud Blog
- Microsoft Developer Blog
- Martin Fowler
- Simon Willison
- Docker Blog
- Rust Blog
- Python Insider
- JetBrains Blog
```

### 4.3 AI / Agent

```yaml
- Hugging Face Blog
- LangChain Blog
- LlamaIndex Blog
- Anthropic News
- OpenAI News
- Google DeepMind Blog
- Meta AI Blog
- NVIDIA AI Blog
- VentureBeat AI
- MIT Technology Review AI
- The Decoder
- Latent Space
- Import AI
- The Batch
- TLDR AI
- Ben's Bites
- Papers with Code trending, if useful
```

---

## 5. Reddit Strategy

RSS is good for discovering posts from known public subreddits. It is not a clean way to reproduce the exact personalized Reddit Home feed, especially recommendations and ads.

Use a manually maintained subreddit list:

```yaml
- id: reddit_machinelearning
  name: r/MachineLearning
  tab: reddit
  url: https://www.reddit.com/r/MachineLearning/new/.rss?limit=100
  priority: 0.85
  poll_minutes: 30

- id: reddit_localllama
  name: r/LocalLLaMA
  tab: reddit
  url: https://www.reddit.com/r/LocalLLaMA/new/.rss?limit=100
  priority: 0.90
  poll_minutes: 30

- id: reddit_programming
  name: r/programming
  tab: reddit
  url: https://www.reddit.com/r/programming/new/.rss?limit=100
  priority: 0.70
  poll_minutes: 30
```

Recommended Reddit handling:

```text
1. Poll each subreddit separately using `/new/.rss?limit=100`.
2. Deduplicate by Reddit post ID or permalink.
3. Store title, link, subreddit, published time, fetched time.
4. Optionally enrich selected posts with Reddit API/JSON to get exact comment count and score.
5. Rank by comments/hour, age, subreddit priority, and LLM relevance.
```

Avoid relying on a combined multi-subreddit RSS feed as the primary source. A very active subreddit can crowd out quieter sources.

---

## 6. Hacker News Strategy

Use the official Hacker News Firebase API rather than RSS.

Endpoints:

```text
Top stories: https://hacker-news.firebaseio.com/v0/topstories.json
New stories: https://hacker-news.firebaseio.com/v0/newstories.json
Best stories: https://hacker-news.firebaseio.com/v0/beststories.json
Item:        https://hacker-news.firebaseio.com/v0/item/{id}.json
```

HN item fields to store:

```text
id
by
time
title
url
score
descendants     # comment count
type
```

Ranking hint:

```text
HN hotness = log(score + 1) + log(descendants + 1) - age_hours * decay
```

---

## 7. Data Model

For MVP, SQLite is sufficient.

```sql
CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tab TEXT NOT NULL,
    url TEXT,
    adapter TEXT DEFAULT 'rss',
    priority REAL DEFAULT 0.5,
    poll_minutes INTEGER DEFAULT 60,
    etag TEXT,
    last_modified TEXT,
    last_fetched_at TIMESTAMP,
    last_success_at TIMESTAMP,
    enabled BOOLEAN DEFAULT 1
);

CREATE TABLE items (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    external_id TEXT,
    canonical_url TEXT,
    title TEXT NOT NULL,
    author TEXT,
    published_at TIMESTAMP,
    fetched_at TIMESTAMP NOT NULL,
    raw_summary TEXT,
    raw_content TEXT,
    content_hash TEXT,
    tab TEXT NOT NULL,
    score REAL,
    comment_count INTEGER,
    comments_per_hour REAL,
    hotness REAL,
    llm_importance INTEGER,
    llm_summary TEXT,
    llm_reason TEXT,
    llm_tags TEXT,
    cluster_id TEXT,
    read_state TEXT DEFAULT 'unread',
    hidden BOOLEAN DEFAULT 0,
    saved BOOLEAN DEFAULT 0,
    FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE clusters (
    id TEXT PRIMARY KEY,
    representative_item_id TEXT,
    title TEXT,
    summary TEXT,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE user_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL
);
```

For a personal app, avoid storing full article text unless necessary. Store metadata, short snippets, and summaries.

---

## 8. Fetching and Normalization

### 8.1 Fetcher Rules

```text
- Run every 15-60 minutes depending on source.
- Use a descriptive User-Agent.
- Use ETag and If-Modified-Since where available.
- Respect 304 Not Modified.
- Back off on 403, 429, and 5xx.
- Record last success timestamp per feed.
- Alert if a source has no successful fetch for 24 hours.
- Keep raw fetch logs compact and rotate them.
```

### 8.2 Normalized Item Fields

Every adapter should emit the same normalized shape:

```json
{
  "source_id": "phoronix_all",
  "external_id": "source-specific-id",
  "canonical_url": "https://example.com/article",
  "title": "Article title",
  "author": "Author name or null",
  "published_at": "2026-05-27T07:00:00+09:00",
  "fetched_at": "2026-05-27T08:00:00+09:00",
  "raw_summary": "Short feed summary",
  "tab": "hw",
  "score": null,
  "comment_count": null
}
```

### 8.3 Deduplication

Deduplicate in layers:

```text
1. Exact canonical URL match.
2. Exact external ID match.
3. Normalized title match.
4. Near-duplicate title similarity.
5. Optional embedding-based clustering for large volume.
```

Title normalization:

```text
- Lowercase
- Remove punctuation
- Remove tracking suffixes
- Normalize whitespace
- Strip source-specific prefixes like "Ask HN:" only for similarity, not display
```

---

## 9. Ranking

Rank before calling the LLM to reduce cost.

### 9.1 Base Score

```text
base_score =
  0.30 * source_priority
+ 0.25 * engagement_score
+ 0.20 * personal_interest_score
+ 0.15 * recency_score
+ 0.10 * novelty_score
```

### 9.2 Recency Score

```text
recency_score = exp(-age_hours / half_life_hours)
```

Recommended half-lives:

```yaml
hw:       36
reddit:   12
dev:      24
ai_agent: 18
```

### 9.3 Engagement Score

For Hacker News:

```text
engagement_score = normalize(log(score + 1) + log(comment_count + 1))
```

For Reddit:

```text
engagement_score = normalize(log(comment_count + 1) + comments_per_hour)
```

For RSS-only news:

```text
engagement_score = 0.0 initially
```

### 9.4 Personal Interest Score

Maintain a weighted watchlist:

```yaml
high_priority:
  - CUDA
  - ROCm
  - NVIDIA
  - AMD
  - Intel
  - Linux kernel
  - GPU
  - HPC
  - supercomputing
  - RISC-V
  - agents
  - MCP
  - LangChain
  - LlamaIndex
  - OpenAI
  - Anthropic
  - local LLM
  - inference
  - autonomous driving
  - automotive AI

negative_or_low_priority:
  - celebrity
  - pure gadget rumor
  - coupon
  - sale
  - generic smartphone deal
```

---

## 10. LLM Curation

The LLM should act as an editor, not as a crawler.

### 10.1 When to Call the LLM

```text
- Only call the LLM for top-ranked candidates.
- For each daily digest, summarize roughly:
  - HW News: top 20-40 candidates
  - Reddit: top 20-40 candidates
  - Dev: top 20-40 candidates
  - AI / Agent: top 20-40 candidates
- Skip low-value, duplicate, or promotional items before LLM processing when possible.
```

### 10.2 LLM Input

Use compact metadata:

```json
{
  "title": "Article title",
  "source": "Phoronix",
  "tab_hint": "hw",
  "published_at": "2026-05-27T07:00:00+09:00",
  "url": "https://example.com/article",
  "summary_snippet": "Feed-provided short summary",
  "score": null,
  "comment_count": null,
  "watchlist_terms": ["Linux kernel", "AMD"]
}
```

### 10.3 LLM Output Schema

```json
{
  "tab": "hw|reddit|dev|ai_agent",
  "importance": 1,
  "summary": "One or two sentence factual summary.",
  "why_it_matters": "Why this matters to an engineer/AI lead.",
  "entities": ["NVIDIA", "Linux", "CUDA"],
  "tags": ["GPU", "Linux", "HPC"],
  "skip": false,
  "skip_reason": null
}
```

Importance scale:

```text
5 = must-read; strategically or technically important
4 = likely important; deserves top-section placement
3 = useful; include in tab body
2 = optional; include only if space allows
1 = skip unless specifically requested
```

### 10.4 Prompt Sketch

```text
You are curating a daily engineering/AI digest for a technical reader.
Classify the item into one tab, assign importance 1-5, write a concise summary,
and explain why it matters. Prefer technical relevance over hype. Mark promotional,
duplicate, or low-signal items as skip=true.

Return strict JSON matching the schema.
```

---

## 11. UI Plan

### 11.1 Page Layout

Single scrollable page with sticky tab navigation:

```text
[Today] [HW News] [Reddit] [Dev] [AI / Agent] [Saved] [Settings]
```

Top summary section:

```text
- Top 10 overall
- Fast-moving discussions
- Repeated stories across multiple sources
- Watchlist hits
```

Card layout:

```text
Source · Time · Score/comments if available · Importance
Title
1-2 sentence summary
Why it matters
Tags
Related links
[Open] [Save] [Hide] [More like this] [Less like this]
```

### 11.2 Tab Definitions

```yaml
HW News:
  sources:
    - Phoronix
    - HPCwire
    - The Next Platform
    - Tom's Hardware
    - ServeTheHome
    - The Register HPC
    - TOP500
  sorting:
    - importance
    - hotness
    - recency

Reddit:
  sources:
    - selected subreddits
  sorting:
    - comments_per_hour
    - hotness
    - LLM importance
  display:
    - subreddit
    - title
    - comment count
    - comments/hour

Dev:
  sources:
    - Hacker News
    - InfoQ
    - GitHub Blog
    - GitHub Changelog
    - Stack Overflow Blog
    - Kubernetes Blog
    - Cloudflare Blog
  sorting:
    - HN score/comments
    - source priority
    - watchlist hits

AI / Agent:
  sources:
    - WIRED AI
    - TechCrunch
    - ZDNet AI
    - Hugging Face
    - LangChain
    - LlamaIndex
    - Anthropic
    - OpenAI
    - Google DeepMind
    - VentureBeat AI
  sorting:
    - importance
    - novelty
    - recency
```

### 11.3 Useful UI Controls

```text
- Search
- Filter by source
- Filter by tag
- Hide read items
- Save item
- Hide source
- More like this / less like this
- Open original article
- Copy digest as Markdown
- Export OPML/source list
```

---

## 12. Daily Digest Generation

Run daily at a chosen local time, e.g. 07:00 KST.

```text
1. Fetch all sources.
2. Normalize and store new items.
3. Deduplicate and cluster.
4. Compute hotness and base ranking.
5. Select candidates per tab.
6. Run LLM curation.
7. Generate `daily_digest` snapshot.
8. Serve snapshot in web UI.
9. Optionally send email/Slack/Teams notification.
```

Snapshot table:

```sql
CREATE TABLE daily_digests (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    generated_at TIMESTAMP NOT NULL,
    markdown TEXT,
    json TEXT
);
```

Markdown digest output example:

```markdown
# Daily Tech Digest — 2026-05-27

## Top 10

1. **Title** — Source
   - Summary
   - Why it matters
   - Link

## HW News
...

## Reddit
...

## Dev
...

## AI / Agent
...
```

---

## 13. Implementation Milestones

### Milestone 1 — RSS MVP

Deliverables:

```text
- `feeds.yaml`
- RSS fetcher
- SQLite database
- Basic normalized item table
- One-page web UI with tabs
- Manual refresh button
```

Acceptance criteria:

```text
- Fetches at least 10 configured RSS feeds.
- Stores unique items.
- Displays items grouped by tab.
- Does not duplicate repeated items across refreshes.
```

### Milestone 2 — HN and Reddit

Deliverables:

```text
- Hacker News API adapter
- Reddit RSS adapter
- Reddit per-subreddit config
- Comment count / score for HN
- Optional Reddit API enrichment for comment count
```

Acceptance criteria:

```text
- HN items show score and comment count.
- Reddit posts show subreddit and published time.
- Reddit ranking uses age and comments if enriched.
```

### Milestone 3 — Ranking and Dedup

Deliverables:

```text
- Hotness scoring
- Recency decay
- Source priority weighting
- Watchlist term boosting
- URL/title deduplication
```

Acceptance criteria:

```text
- Top page surfaces the highest-value items.
- Duplicate or near-duplicate stories are grouped or suppressed.
```

### Milestone 4 — LLM Curation

Deliverables:

```text
- LLM classification/summarization pipeline
- Strict JSON output schema
- Importance score
- Tags and why-it-matters text
```

Acceptance criteria:

```text
- Each top item has a short summary.
- Low-signal items can be skipped.
- Digest is readable in under 10 minutes.
```

### Milestone 5 — Feedback and Personalization

Deliverables:

```text
- Save/hide buttons
- More-like-this / less-like-this feedback
- Per-source priority adjustment
- Watchlist editor
```

Acceptance criteria:

```text
- Feedback changes ranking over time.
- User can suppress noisy sources and topics.
```

---

## 14. Operational Considerations

### 14.1 Reliability

```text
- Feed endpoints can break.
- Some publishers change RSS URLs.
- Some feeds may return partial content only.
- Some feeds may temporarily block unusual clients.
- Keep per-source health status visible in Settings.
```

### 14.2 Compliance and Etiquette

```text
- Use RSS where available.
- Use official APIs where they are clearly better, e.g. Hacker News.
- Use a descriptive User-Agent.
- Respect rate limits.
- Link back to original sources.
- Avoid republishing full article text.
- Store minimal metadata and short summaries.
- For Reddit, avoid long-term storage of deleted content.
```

### 14.3 Cost Control

```text
- Do not send every item to the LLM.
- Rank first, summarize second.
- Cache LLM outputs by item ID/content hash.
- Use smaller/cheaper models for classification.
- Use a stronger model only for final digest synthesis if needed.
```

---

## 15. Suggested Repository Structure

```text
daily-digest/
  README.md
  feeds.yaml
  docker-compose.yml
  backend/
    app.py
    config.py
    db.py
    models.py
    fetchers/
      rss.py
      hackernews.py
      reddit.py
    curator/
      ranker.py
      dedup.py
      llm.py
      prompts.py
    jobs/
      scheduler.py
      generate_digest.py
  frontend/
    package.json
    src/
      App.tsx
      components/
        DigestPage.tsx
        TabNav.tsx
        ItemCard.tsx
        SourceHealth.tsx
  data/
    digest.sqlite
```

---

## 16. MVP Pseudocode

```python
from datetime import datetime, timezone
import feedparser
import httpx


def fetch_rss_source(source):
    headers = {
        "User-Agent": "daily-tech-digest/0.1 personal aggregator"
    }
    if source.etag:
        headers["If-None-Match"] = source.etag
    if source.last_modified:
        headers["If-Modified-Since"] = source.last_modified

    response = httpx.get(source.url, headers=headers, timeout=20)

    if response.status_code == 304:
        return []
    response.raise_for_status()

    parsed = feedparser.parse(response.text)
    items = []

    for entry in parsed.entries:
        item = {
            "source_id": source.id,
            "external_id": entry.get("id") or entry.get("guid") or entry.get("link"),
            "canonical_url": entry.get("link"),
            "title": entry.get("title", "").strip(),
            "author": entry.get("author"),
            "published_at": entry.get("published"),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "raw_summary": entry.get("summary"),
            "tab": source.tab,
        }
        items.append(item)

    return items
```

---

## 17. Open Questions

Resolve these during implementation:

```text
1. Which exact subreddits should be included?
2. Should Reddit use RSS-only, or should selected posts be enriched through the Data API?
3. Should the daily digest be generated once per morning or continuously updated?
4. Should summaries be saved permanently or regenerated when prompts change?
5. Should the app run locally, on a home server, or in the cloud?
6. Should the digest include email/Slack/Teams delivery?
7. Which LLM provider/model should be used for summarization?
8. Should full article content be fetched, or only RSS snippets and titles?
```

---

## 18. Recommended First Build

Start with this minimal implementation:

```text
1. Python + FastAPI backend.
2. SQLite database.
3. `feeds.yaml` with 15-25 sources.
4. RSS fetcher with ETag support.
5. HN API adapter.
6. Reddit RSS adapter for selected subreddits.
7. Simple React or server-rendered HTML frontend.
8. Rule-based ranking first.
9. Add LLM summaries only after ranking/dedup works.
```

First success condition:

```text
A single page opens in the morning and shows:

- 10 most important items overall
- HW News tab
- Reddit tab
- Dev tab
- AI / Agent tab
- each item has source, time, title, link, summary or snippet, and score/comments when available
```

---

## 19. Guiding Principle

Do not build a generic RSS reader. Build a technical editor for your interests.

The collector should maximize recall. The ranking, deduplication, and LLM layer should aggressively reduce noise.
