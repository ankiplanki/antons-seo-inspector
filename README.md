# Anton's SEO Inspector

A browser extension (Chrome and Firefox) with two SEO checks in one popup: an **Indexability** check for the current page, and a **Link Scanner** that scans every URL on the page and reports its HTTP status code.

## Features

### Indexability Checker
- **HTTP status** of the current page
- **robots.txt** — checks whether Googlebot, Bingbot, GPTBot, ClaudeBot, and PerplexityBot are allowed to crawl the current path
- **Meta robots tags** — reads `<meta name="robots">` and its per-bot variants, flags `noindex`/`none` as a failure and `nofollow`/`noarchive`/`nosnippet` as a warning
- **X-Robots-Tag header** — same fail/warning logic as meta robots, read from the page's HTTP response
- **Canonical URL** — compares the page's `<link rel="canonical">` against its own URL
- Runs automatically when you open the popup, with a **Scan** button to re-check

### Link Status Scanner
- **Scans all URL types** — links, images, scripts, stylesheets, iframes, forms, media, and more
- **Redirect detection** — when a URL redirects, shows the final destination URL alongside the resolved status code
- **Color-coded by status group** — instantly see what's broken, what redirects, and what's healthy
- **Copy per group** — click "Copy URLs" on any group to copy all URLs in that group to your clipboard
- **Copy All** — copies every URL prefixed with its status badge (e.g. `[404] https://example.com/gone`)
- **Live progress** — results stream in as checks complete, no waiting for the full scan
- **Session cache** — re-opening the popup shows results from your last scan automatically
- **Highlight Links** — outlines every link on the page, color-coded by its status group
- **Find on page** — jump to and briefly highlight the exact element a result came from

## Status color coding

| Group | Color |
|---|---|
| 2xx Success | Green |
| Redirected (3xx) | Amber |
| 4xx Client Errors | Red |
| 5xx Server Errors | Dark red |
| Network Errors | Purple |

## Installation

This extension is not published on the Chrome Web Store or Firefox Add-ons. Load it manually.

### Chrome / Chromium-based browsers

1. Clone or download this repo
2. Go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked**
5. Select the `antons-seo-inspector` folder

### Firefox

1. Clone or download this repo (same codebase, no separate build)
2. Go to `about:debugging` → **This Firefox**
3. Click **Load Temporary Add-on…**
4. Select `manifest.json` inside the `antons-seo-inspector` folder

Note: temporarily loaded add-ons are removed when Firefox restarts. A persistent install requires signing by Mozilla (AMO).

## Usage

1. Navigate to any page you want to audit
2. Click the extension icon
3. The **Indexability** tab checks the current page automatically — click **Scan** to re-check
4. Switch to the **Link Scanner** tab and click **Scan Page** to check every URL on the page
5. Link Scanner results appear grouped by status code as checks complete; use **Copy URLs** on any group to export that list, or **Copy All** for everything

## How it works

### Indexability
- DOM signals (meta robots tags, canonical URL) are read from the live page via `scripting.executeScript`
- Network signals (robots.txt, page HTTP status, X-Robots-Tag header) are fetched by the background script and returned via a one-shot `runtime.sendMessage` request
- robots.txt is parsed and matched per bot using standard group-matching semantics (specific user-agent preferred over `*`, longest matching path wins between allow/disallow rules)

### Link Scanner
- URL extraction runs in the page context via `scripting.executeScript`, scanning all relevant DOM elements and resolving relative URLs to absolute
- Status checks run in the background script (required for cross-origin fetches), using `HEAD` requests with a `GET` fallback for servers that don't support `HEAD`
- Redirects are detected by comparing the original URL against `response.url` after `fetch` follows the chain
- Up to 10 requests run concurrently with a 10-second timeout per URL

## License

MIT
