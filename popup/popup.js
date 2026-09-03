Sentry.init({
  dsn: "https://e1da536eab1acb8fabb634aa50cc85bf@o4508716372197376.ingest.us.sentry.io/4511180549128192",
  release: "link-status-scanner@1.0.0",
});

// Map of url -> result object
const results = new Map();
let port = null;
let scanning = false;
let stopped = false;
let currentTabId = null;
let highlightsActive = false;

const scanBtn = document.getElementById("scanBtn");
const stopBtn = document.getElementById("stopBtn");
const copyAllBtn = document.getElementById("copyAll");
const highlightBtn = document.getElementById("highlightBtn");
const progressEl = document.getElementById("progress");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

function getStatusGroup(status, redirected) {
  if (status === 0) return "err";
  if (redirected) return "3xx";
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

const GROUP_META = {
  "2xx": { label: "Success (2xx)", cls: "group-2xx", badgeCls: "badge-2xx", expandByDefault: true },
  "3xx": { label: "Redirected", cls: "group-3xx", badgeCls: "badge-3xx", expandByDefault: true },
  "4xx": { label: "Client Errors (4xx)", cls: "group-4xx", badgeCls: "badge-4xx", expandByDefault: true },
  "5xx": { label: "Server Errors (5xx)", cls: "group-5xx", badgeCls: "badge-5xx", expandByDefault: true },
  "err": { label: "Network Errors", cls: "group-err", badgeCls: "badge-err", expandByDefault: true },
};

const GROUP_ORDER = ["4xx", "5xx", "err", "3xx", "2xx"];

const TYPE_LABELS = {
  link: "A",
  img: "IMG",
  script: "JS",
  "link-tag": "LINK",
  iframe: "iframe",
  video: "video",
  audio: "audio",
  source: "source",
  object: "object",
  embed: "embed",
  form: "form",
  area: "area",
};

// Group elements cache
const groupEls = {};

function ensureGroup(groupKey) {
  if (groupEls[groupKey]) return groupEls[groupKey];

  const meta = GROUP_META[groupKey];
  const group = document.createElement("div");
  group.className = `group ${meta.cls} open`;
  group.dataset.group = groupKey;

  group.innerHTML = `
    <div class="group-header">
      <span class="group-toggle">▼</span>
      <span class="group-label">${meta.label}</span>
      <span class="group-count">0 URLs</span>
      <button class="btn btn-copy copy-group-btn">Copy URLs</button>
    </div>
    <div class="group-body"></div>
  `;

  group.querySelector(".group-header").addEventListener("click", (e) => {
    if (e.target.classList.contains("copy-group-btn")) return;
    group.classList.toggle("open");
    group.classList.toggle("closed");
  });

  group.querySelector(".copy-group-btn").addEventListener("click", () => {
    copyGroup(groupKey, group.querySelector(".copy-group-btn"));
  });

  // Insert in order
  const order = GROUP_ORDER;
  const insertBefore = order.slice(order.indexOf(groupKey) + 1)
    .map((k) => groupEls[k]?.el)
    .find((el) => el);

  if (insertBefore) {
    resultsEl.insertBefore(group, insertBefore);
  } else {
    resultsEl.appendChild(group);
  }

  groupEls[groupKey] = { el: group, body: group.querySelector(".group-body"), count: 0 };
  return groupEls[groupKey];
}

function updateGroupCount(groupKey) {
  const g = groupEls[groupKey];
  if (!g) return;
  g.el.querySelector(".group-count").textContent = `${g.count} URL${g.count !== 1 ? "s" : ""}`;
}

function addResultRow(result) {
  const group = getStatusGroup(result.status, result.redirected);
  const meta = GROUP_META[group];
  const g = ensureGroup(group);
  g.count++;
  updateGroupCount(group);

  const row = document.createElement("div");
  row.className = "url-row";

  const badgeText = result.status === 0 ? "ERR" : result.status;
  const typeLabel = TYPE_LABELS[result.type] || result.type || "";
  const hasAnchorText = result.type === "link" && result.anchorText;

  row.innerHTML = `
    <div class="url-main">
      <span class="status-badge ${meta.badgeCls}">${badgeText}</span>
      ${typeLabel ? `<span class="type-badge">${escHtml(typeLabel)}</span>` : ""}
      <span class="url-text" title="${escHtml(result.url)}">${escHtml(result.url)}</span>
      ${result.elementId != null ? `<button class="scroll-btn" title="Find on page">↗</button>` : ""}
    </div>
    ${hasAnchorText ? `<div class="anchor-text">"${escHtml(result.anchorText)}"</div>` : ""}
    ${result.redirected && result.finalUrl !== result.url ? `
      <div class="url-redirect">
        <span class="redirect-arrow">↳</span>
        <span class="redirect-url" title="${escHtml(result.finalUrl)}">${escHtml(result.finalUrl)}</span>
      </div>
    ` : ""}
    ${result.error ? `<div class="error-text">${escHtml(result.error)}</div>` : ""}
  `;

  if (result.elementId != null) {
    row.querySelector(".scroll-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      scrollToElement(result.elementId);
    });
  }

  g.body.appendChild(row);
}

function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function scrollToElement(elementId) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (id) => {
        const el = document.querySelector(`[data-lss-id="${id}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const prevOutline = el.style.outline;
        const prevOffset = el.style.outlineOffset;
        el.style.outline = "3px solid #2563eb";
        el.style.outlineOffset = "3px";
        setTimeout(() => {
          el.style.outline = prevOutline;
          el.style.outlineOffset = prevOffset;
        }, 2000);
      },
      args: [elementId],
    });
  } catch (err) {
    statusEl.textContent = `Could not scroll to element: ${err.message}`;
  }
}

async function applyHighlights() {
  if (!currentTabId) return;
  const data = [...results.values()]
    .filter((r) => r.status !== null)
    .map((r) => ({ url: r.url, group: getStatusGroup(r.status, r.redirected) }));

  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: (resultsData) => {
        // Clear previous highlights
        document.querySelectorAll("[data-lss-highlight]").forEach((el) => {
          el.style.removeProperty("outline");
          el.style.removeProperty("outline-offset");
          el.removeAttribute("data-lss-highlight");
        });
        const colorMap = {
          "2xx": "#22c55e",
          "3xx": "#f59e0b",
          "4xx": "#ef4444",
          "5xx": "#dc2626",
          "err": "#8b5cf6",
        };
        const urlGroups = Object.fromEntries(resultsData.map((r) => [r.url, r.group]));
        document.querySelectorAll("a[href]").forEach((el) => {
          let absolute;
          try { absolute = new URL(el.getAttribute("href"), document.baseURI).href; } catch { return; }
          const group = urlGroups[absolute];
          const color = colorMap[group];
          if (color) {
            el.style.outline = `2px solid ${color}`;
            el.style.outlineOffset = "2px";
            el.setAttribute("data-lss-highlight", group);
          }
        });
      },
      args: [data],
    });
    highlightsActive = true;
    highlightBtn.textContent = "Clear Highlights";
  } catch {}
}

async function clearHighlights() {
  if (!currentTabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: () => {
        document.querySelectorAll("[data-lss-highlight]").forEach((el) => {
          el.style.removeProperty("outline");
          el.style.removeProperty("outline-offset");
          el.removeAttribute("data-lss-highlight");
        });
      },
    });
  } catch {}
  highlightsActive = false;
  highlightBtn.textContent = "Highlight Links";
}

highlightBtn.addEventListener("click", () => {
  if (highlightsActive) clearHighlights();
  else applyHighlights();
});

async function copyGroup(groupKey, btn) {
  const urls = [...results.values()]
    .filter((r) => r.status !== null && getStatusGroup(r.status, r.redirected) === groupKey)
    .map((r) => r.url);
  await copyToClipboard(urls.join("\n"), btn);
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove("copied");
    }, 1500);
  } catch {
    statusEl.textContent = "Failed to copy to clipboard.";
  }
}

copyAllBtn.addEventListener("click", () => {
  const lines = [...results.values()]
    .filter((r) => r.status !== null)
    .map((r) => {
      const status = r.status === 0 ? "ERR" : r.status;
      return `[${status}] ${r.url}`;
    });
  copyToClipboard(lines.join("\n"), copyAllBtn);
});

stopBtn.addEventListener("click", () => {
  stopped = true;
  if (port) {
    port.disconnect();
    port = null;
  }
  setScanningState(false);
  statusEl.textContent = "Scan stopped.";
});

scanBtn.addEventListener("click", startScan);

async function startScan() {
  if (scanning) return;

  // Reset state
  results.clear();
  resultsEl.innerHTML = "";
  Object.keys(groupEls).forEach((k) => delete groupEls[k]);
  stopped = false;
  highlightsActive = false;
  highlightBtn.hidden = true;
  highlightBtn.textContent = "Highlight Links";
  statusEl.textContent = "Extracting URLs…";
  setScanningState(true);
  progressEl.removeAttribute("hidden");
  progressBar.style.width = "0%";
  progressText.textContent = "0 / 0";
  copyAllBtn.hidden = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;

    // Clear any previous highlights before new scan
    await clearHighlights();

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: extractAllUrls,
    });

    const urlItems = injection.result;

    if (!urlItems || urlItems.length === 0) {
      statusEl.textContent = "No URLs found on this page.";
      setScanningState(false);
      progressEl.setAttribute("hidden", "");
      return;
    }

    statusEl.textContent = `Found ${urlItems.length} URLs. Checking…`;
    progressText.textContent = `0 / ${urlItems.length}`;

    // Save url metadata (type, anchorText, elementId) keyed by url
    urlItems.forEach((item) => results.set(item.url, { ...item, status: null }));

    if (port) port.disconnect();
    port = chrome.runtime.connect({ name: "scan" });

    port.onMessage.addListener((msg) => {
      if (msg.type === "result") {
        // Merge scan result with existing metadata (type, anchorText, elementId)
        const existing = results.get(msg.data.url) || {};
        const merged = { ...existing, ...msg.data };
        results.set(msg.data.url, merged);
        addResultRow(merged);
        const pct = Math.round((msg.done / msg.total) * 100);
        progressBar.style.width = pct + "%";
        progressText.textContent = `${msg.done} / ${msg.total}`;
      }
      if (msg.type === "done") {
        statusEl.textContent = `Scan complete — ${msg.total} URLs checked.`;
        setScanningState(false);
        copyAllBtn.hidden = false;
        highlightBtn.hidden = false;
        saveToSession();
        applyHighlights();
      }
    });

    port.onDisconnect.addListener(() => {
      if (!stopped) {
        statusEl.textContent = "Scan interrupted (service worker restarted).";
        setScanningState(false);
      }
    });

    port.postMessage({ action: "checkUrls", urls: urlItems });
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    setScanningState(false);
    progressEl.setAttribute("hidden", "");
  }
}

function setScanningState(active) {
  scanning = active;
  scanBtn.disabled = active;
  scanBtn.textContent = active ? "Scanning…" : "Scan Page";
  stopBtn.hidden = !active;
}

function saveToSession() {
  const data = [...results.values()];
  const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
  // chrome.storage.session has a 10MB quota — skip caching if we'd exceed 9MB
  if (bytes > 9 * 1024 * 1024) return;
  chrome.storage.session.set({ lastScan: data }).catch(() => {});
}

async function loadFromSession() {
  try {
    const stored = await chrome.storage.session.get("lastScan");
    if (stored.lastScan && stored.lastScan.length > 0) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTabId = tab.id;
      stored.lastScan.forEach((r) => {
        if (r.status !== null) {
          results.set(r.url, r);
          addResultRow(r);
        }
      });
      const count = stored.lastScan.filter((r) => r.status !== null).length;
      statusEl.textContent = `Last scan: ${count} URLs. Click Scan Page to refresh.`;
      copyAllBtn.hidden = false;
      highlightBtn.hidden = false;
    }
  } catch {}
}

// The extracted function runs in the page context
function extractAllUrls() {
  const urlMap = new Map();
  let idCounter = 0;

  function addUrl(url, source, el) {
    if (!url) return;
    let absolute;
    try { absolute = new URL(url, document.baseURI).href; } catch { return; }
    if (!absolute.startsWith("http://") && !absolute.startsWith("https://")) return;

    if (!urlMap.has(absolute)) {
      let elementId = null;
      if (el) {
        if (!el.dataset.lssId) el.dataset.lssId = String(idCounter++);
        elementId = el.dataset.lssId;
      }
      const anchorText = (source === "link" && el)
        ? (el.textContent.trim().slice(0, 100) || null)
        : null;
      urlMap.set(absolute, { sources: [source], anchorText, elementId });
    } else {
      const entry = urlMap.get(absolute);
      if (!entry.sources.includes(source)) entry.sources.push(source);
    }
  }

  function parseSrcset(srcset, source, el) {
    if (!srcset) return;
    srcset.split(/,(?=\s)/).forEach((part) => {
      const trimmed = part.trim().split(/\s+/)[0];
      if (trimmed) addUrl(trimmed, source, el);
    });
  }

  const selectors = [
    { selector: "a[href]", attr: "href", label: "link" },
    { selector: "img[src]", attr: "src", label: "img" },
    { selector: "img[srcset]", attr: "srcset", label: "img", isSrcset: true },
    { selector: "script[src]", attr: "src", label: "script" },
    { selector: "link[href]", attr: "href", label: "link-tag" },
    { selector: "iframe[src]", attr: "src", label: "iframe" },
    { selector: "video[src]", attr: "src", label: "video" },
    { selector: "audio[src]", attr: "src", label: "audio" },
    { selector: "source[src]", attr: "src", label: "source" },
    { selector: "source[srcset]", attr: "srcset", label: "source", isSrcset: true },
    { selector: "object[data]", attr: "data", label: "object" },
    { selector: "embed[src]", attr: "src", label: "embed" },
    { selector: "form[action]", attr: "action", label: "form" },
    { selector: "area[href]", attr: "href", label: "area" },
  ];

  for (const { selector, attr, label, isSrcset } of selectors) {
    document.querySelectorAll(selector).forEach((el) => {
      const val = el.getAttribute(attr);
      if (isSrcset) parseSrcset(val, label, el);
      else addUrl(val, label, el);
    });
  }

  return Array.from(urlMap.entries()).map(([url, data]) => ({
    url,
    sources: data.sources,
    type: data.sources[0],
    anchorText: data.anchorText,
    elementId: data.elementId,
  }));
}

// Load cached results on popup open
loadFromSession();
