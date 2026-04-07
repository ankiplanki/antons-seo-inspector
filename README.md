# Link Status Scanner

A Chrome extension that scans every URL on the current page and reports its HTTP status code — with redirect detection, color-coded groups, and one-click export.

## Features

- **Scans all URL types** — links, images, scripts, stylesheets, iframes, forms, media, and more
- **Redirect detection** — when a URL redirects, shows the final destination URL alongside the resolved status code
- **Color-coded by status group** — instantly see what's broken, what redirects, and what's healthy
- **Copy per group** — click "Copy URLs" on any group to copy all URLs in that group to your clipboard
- **Copy All** — copies every URL prefixed with its status badge (e.g. `[404] https://example.com/gone`)
- **Live progress** — results stream in as checks complete, no waiting for the full scan
- **Session cache** — re-opening the popup shows results from your last scan automatically

## Status color coding

| Group | Color |
|---|---|
| 2xx Success | Green |
| Redirected (3xx) | Amber |
| 4xx Client Errors | Red |
| 5xx Server Errors | Dark red |
| Network Errors | Purple |

## Installation

This extension is not on the Chrome Web Store. Load it manually:

1. Clone or download this repo
2. Go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked**
5. Select the `link-status-scanner` folder

## Usage

1. Navigate to any page you want to audit
2. Click the extension icon
3. Click **Scan Page**
4. Results appear grouped by status code as checks complete
5. Use the **Copy URLs** button on any group to export that list, or **Copy All** for everything

## How it works

- URL extraction runs in the page context via `chrome.scripting.executeScript`, scanning all relevant DOM elements and resolving relative URLs to absolute
- Status checks run in the background service worker (required for cross-origin fetches), using `HEAD` requests with a `GET` fallback for servers that don't support `HEAD`
- Redirects are detected by comparing the original URL against `response.url` after `fetch` follows the chain
- Up to 10 requests run concurrently with a 10-second timeout per URL

## License

MIT
