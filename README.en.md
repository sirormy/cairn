# Cairn

**Stack your links into a trail you can follow back.**

[![CI](https://github.com/sirormy/cairn/actions/workflows/ci.yml/badge.svg)](https://github.com/sirormy/cairn/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[中文](README.md) · English

---

A cairn is the pile of stones hikers leave on a trail — one rock added each time you pass, until it becomes a landmark you can navigate by.

Cairn does the same thing for what you read. Drop a tweet, an article, a GitHub repo or a product page into the chat box, and an agent fetches the original, caches it locally, and writes a summary. For GitHub repos and websites it also produces a structured research report. Everything lives in your own SQLite database: full-text searchable, taggable, annotatable.

Your data stays on your machine. Apart from the LLM endpoint you configure, every request serves a link you provided. Concretely, collecting one item may touch: the real target site after short-link redirects, `cdn.syndication.twimg.com` and `publish.twitter.com` (tweet fallback fetching), `x.com/i/api` (only when cookies are configured, for full tweets and bookmarks) and `api.github.com` (repository metadata). Nothing else is ever sent anywhere.

## Features

**Collect through conversation.** No forms, no type picker — just paste a URL. The agent decides what it's looking at and uses five tools (`fetch_webpage`, `fetch_tweet`, `github_repo_info`, `save_item`, `search_collection`) to fetch, store and summarize, streaming each tool call into the chat as it happens.

**A fetch strategy per content type.** Tweets fall back through three layers — syndication, oembed, and an authenticated cookie call — with t.co links expanded and X long-form articles captured by title and preview. Articles and websites go through Readability + Turndown for clean Markdown. GitHub repos pull metadata, README and the latest release.

**One-click X bookmark import.** Export your x.com cookies to `x.cookie.json` in the repo root (already gitignored), then hit "import X bookmarks" on the collection page to pull in your whole bookmark library, including titles, previews and covers for X articles. Existing links are skipped, so your own edits are never overwritten.

**Research reports.** Repos and websites get a structured report written by the LLM, rendered on the detail page and indexed for search alongside everything else.

**Collection management.** Filter by type, browse tag aggregates, edit notes and tags. Full-text search uses SQLite FTS5 with the trigram tokenizer, so it works on Chinese text and code fragments as well as English prose.

**Hardened fetching.** Every outbound request re-validates the resolved address at each hop and blocks loopback, private, link-local and CGNAT ranges, with size and timeout caps. Short links are resolved to their real target before being checked.

## Getting started

Requires Node ≥ 22 and pnpm.

```bash
pnpm install
cp .env.example .env   # fill in an LLM endpoint (see below)
pnpm dev               # web on :5173, API on 127.0.0.1:8787
```

Open http://localhost:5173 and paste any link into the chat box.

### Configuration

`.env.example` documents every variable. The ones you'll actually touch:

| Variable | Description |
| --- | --- |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | Required. Any OpenAI-compatible endpoint (Ark, OpenRouter, DeepSeek, …) |
| `LLM_MODEL_NAME` | Optional display name for the model |
| `GITHUB_TOKEN` | Optional; raises the GitHub API limit from 60/h to 5000/h |
| `X_AUTH_TOKEN` / `X_CT0` | Optional cookie fallback for tweet fetching |
| `X_COOKIE_FILE` | Optional path to the X cookie file; defaults to `x.cookie.json` in the repo root |
| `X_BOOKMARKS_QUERY_ID` | Optional GraphQL queryId for the Bookmarks API; refresh it from projects like twscrape when X rotates it |
| `X_GQL_QUERY_ID` / `X_GQL_FEATURES` | Optional parameters for the single-tweet API; rarely needed |
| `API_PORT` / `HOST` | Optional; defaults to `8787` and `127.0.0.1` |

Without an LLM configured the server still starts, and the chat endpoint returns a 503 naming the missing variables.

### Try it without an API key

The repo ships a local mock LLM that exercises the entire collection pipeline:

```bash
node scripts/mock-llm.mjs
```

Point `.env` at it:

```bash
LLM_BASE_URL=http://localhost:8790/v1
LLM_API_KEY=mock
LLM_MODEL=mock-1
```

Then run `pnpm dev` and paste any link — you'll see fetching, saving and rendering end to end.

## Architecture

```
apps/
  server/   Node + Hono + pi-agent-core: agent loop, tools, SSE streaming, SQLite
  web/      React 19 + Vite + Tailwind: chat, collection list, item detail
packages/
  shared/   Types shared between front and back end
data/       Runtime data (gitignored): SQLite, content cache, item bodies
scripts/
  mock-llm.mjs  Local mock LLM
```

Chat streams over SSE, and the frontend reduces the event stream into a message state machine. Fetched pages are written both to the content cache and to `data/items/<id>/content.md`, with the body fed into the FTS index.

## Tests and builds

```bash
pnpm test         # vitest: server (db / net / normalize / url-parse / fetch parsing) + web (SSE parsing / event state machine)
pnpm typecheck
pnpm build        # typecheck + web build + server build
```

## Caveats

- The server binds to `127.0.0.1` by default and has **no authentication or rate limiting**. Exposing it to your LAN means `HOST=0.0.0.0`, which hands over your collection and your X session — don't put it on the public internet.
- Fetched web content goes into the LLM context, so prompt injection is a real consideration. Titles, summaries and reports are LLM-generated; verify anything that matters.
- `x.cookie.json` grants full access to your X account. Keep it local, never commit it, never share it. It's gitignored by default.
- **The X features are your call to make.** Tweet fetching falls back to X's public syndication endpoint; bookmark import uses X's internal web GraphQL API with your own session — reading **your own** bookmarks. Those endpoints are undocumented, carry no stability guarantee, and X's terms may not permit automated access. Rate limits, anti-bot challenges and account suspension are risks you take on. If that's not a trade you want, simply don't configure cookies: tweet fetching degrades to the public endpoints and bookmark import becomes unavailable.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please make sure `pnpm typecheck && pnpm test && pnpm build` all pass before submitting.

## License

[MIT](LICENSE)
