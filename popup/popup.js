// Map of status code -> result object
const results = new Map();
let port = null;
let scanning = false;
let stopped = false;

const scanBtn = document.getElementById("scanBtn");
const stopBtn = document.getElementById("stopBtn");
const copyAllBtn = document.getElementById("copyAll");
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
  const displayUrl = result.url;

  row.innerHTML = `
    <div class="url-main">
      <span class="status-badge ${meta.badgeCls}">${badgeText}</span>
      <span class="url-text" title="${escHtml(displayUrl)}">${escHtml(displayUrl)}</span>
    </div>
    ${result.redirected && result.finalUrl !== result.url ? `
      <div class="url-redirect">
        <span class="redirect-arrow">↳</span>
        <span class="redirect-url" title="${escHtml(result.finalUrl)}">${escHtml(result.finalUrl)}</span>
      </div>
    ` : ""}
    ${result.error ? `<div class="error-text">${escHtml(result.error)}</div>` : ""}
  `;

  g.body.appendChild(row);
}

function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function copyGroup(groupKey, btn) {
  const urls = [...results.values()]
    .filter((r) => getStatusGroup(r.status, r.redirected) === groupKey)
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
  const lines = [...results.values()].map((r) => {
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
  statusEl.textContent = "Extracting URLs…";
  setScanningState(true);
  progressEl.removeAttribute("hidden");
  progressBar.style.width = "0%";
  progressText.textContent = "0 / 0";
  copyAllBtn.hidden = true;

  let tabId;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab.id;

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
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

    // Save url metadata for copy purposes
    urlItems.forEach((item) => results.set(item.url, { ...item, status: null }));

    if (port) port.disconnect();
    port = chrome.runtime.connect({ name: "scan" });

    port.onMessage.addListener((msg) => {
      if (msg.type === "result") {
        results.set(msg.data.url, msg.data);
        addResultRow(msg.data);
        const pct = Math.round((msg.done / msg.total) * 100);
        progressBar.style.width = pct + "%";
        progressText.textContent = `${msg.done} / ${msg.total}`;
      }
      if (msg.type === "done") {
        statusEl.textContent = `Scan complete — ${msg.total} URLs checked.`;
        setScanningState(false);
        copyAllBtn.hidden = false;
        saveToSession();
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
  chrome.storage.session.set({ lastScan: data }).catch(() => {});
}

async function loadFromSession() {
  try {
    const stored = await chrome.storage.session.get("lastScan");
    if (stored.lastScan && stored.lastScan.length > 0) {
      stored.lastScan.forEach((r) => {
        if (r.status !== null) {
          results.set(r.url, r);
          addResultRow(r);
        }
      });
      statusEl.textContent = `Last scan: ${stored.lastScan.filter((r) => r.status !== null).length} URLs. Click Scan Page to refresh.`;
      copyAllBtn.hidden = false;
    }
  } catch {}
}

// The extracted function runs in the page context
function extractAllUrls() {
  const urlMap = new Map();

  function addUrl(url, source) {
    if (!url) return;
    let absolute;
    try { absolute = new URL(url, document.baseURI).href; } catch { return; }
    if (!absolute.startsWith("http://") && !absolute.startsWith("https://")) return;
    if (!urlMap.has(absolute)) urlMap.set(absolute, new Set());
    urlMap.get(absolute).add(source);
  }

  function parseSrcset(srcset, source) {
    if (!srcset) return;
    srcset.split(",").forEach((part) => {
      const trimmed = part.trim().split(/\s+/)[0];
      if (trimmed) addUrl(trimmed, source);
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
      if (isSrcset) parseSrcset(val, label);
      else addUrl(val, label);
    });
  }

  return Array.from(urlMap.entries()).map(([url, sources]) => ({
    url,
    sources: Array.from(sources),
  }));
}

// Load cached results on popup open
loadFromSession();
