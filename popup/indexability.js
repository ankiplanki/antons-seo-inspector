const idxScanBtn = document.getElementById("idxScanBtn");
const idxStatusEl = document.getElementById("idxStatus");
const idxSummaryEl = document.getElementById("idxSummary");
const idxResultsEl = document.getElementById("idxResults");

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    let href = u.href;
    if (href.endsWith("/") && u.pathname === "/") href = href.slice(0, -1);
    return href.replace(/\/$/, "");
  } catch {
    return url;
  }
}

async function extractDomSignals(tab) {
  const [{ result }] = await api.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const getMeta = (name) => document.querySelector(`meta[name="${name}" i]`)?.content || null;
      return {
        metaRobots: getMeta("robots"),
        metaGooglebot: getMeta("googlebot"),
        metaBingbot: getMeta("bingbot"),
        metaGptbot: getMeta("gptbot"),
        metaClaudebot: getMeta("claude-bot"),
        canonical: document.querySelector('link[rel="canonical"]')?.href || null,
        currentUrl: window.location.href,
      };
    },
  });
  return result;
}

function metaRobotsSignal(name, value) {
  if (!value) return { status: "pass", detail: "Not set." };
  const lower = value.toLowerCase();
  if (lower.includes("noindex") || lower.includes("none")) {
    return { status: "fail", detail: `${name}: "${value}"` };
  }
  if (lower.includes("nofollow") || lower.includes("noarchive") || lower.includes("nosnippet")) {
    return { status: "warn", detail: `${name}: "${value}"` };
  }
  return { status: "pass", detail: `${name}: "${value}"` };
}

function buildSignals(dom, net) {
  const signals = [];

  if (net.httpStatus) {
    const hs = net.httpStatus;
    signals.push({
      name: "HTTP Status",
      status: hs.status,
      detail: hs.error
        ? hs.error
        : `${hs.code}${hs.redirected ? ` (redirected to ${hs.finalUrl})` : ""}`,
    });
  }

  if (net.robotsTxt) {
    const rt = net.robotsTxt;
    signals.push({
      name: "robots.txt",
      status: rt.error ? "warn" : rt.status,
      detail: rt.error || rt.note || (rt.status === "pass" ? "All target bots allowed." : "Some bots are disallowed."),
      bots: rt.details,
    });
  }

  const metaChecks = [
    ["Meta Robots", dom.metaRobots],
    ["Meta Googlebot", dom.metaGooglebot],
    ["Meta Bingbot", dom.metaBingbot],
    ["Meta GPTBot", dom.metaGptbot],
    ["Meta ClaudeBot", dom.metaClaudebot],
  ].filter(([, value]) => value);

  if (metaChecks.length === 0) {
    signals.push({ name: "Meta Robots", status: "pass", detail: "Not set." });
  } else {
    for (const [name, value] of metaChecks) {
      signals.push({ name, ...metaRobotsSignal(name, value) });
    }
  }

  if (net.xRobotsTag) {
    const xr = net.xRobotsTag;
    signals.push({
      name: "X-Robots-Tag",
      status: xr.error ? "warn" : xr.status,
      detail: xr.error || (xr.directives ? `"${xr.directives}"` : "Not set."),
    });
  }

  if (dom.canonical) {
    const normCanonical = normalizeUrl(dom.canonical);
    const normCurrent = normalizeUrl(dom.currentUrl);
    if (normCanonical === normCurrent) {
      signals.push({ name: "Canonical URL", status: "pass", detail: "Self-referencing." });
    } else {
      signals.push({ name: "Canonical URL", status: "warn", detail: `Points to ${dom.canonical}` });
    }
  } else {
    signals.push({ name: "Canonical URL", status: "pass", detail: "Not set." });
  }

  return signals;
}

function renderIndexability(signals) {
  idxResultsEl.innerHTML = "";

  const passed = signals.filter((s) => s.status === "pass").length;
  idxSummaryEl.textContent = `${passed}/${signals.length} checks passed`;

  signals.forEach((signal) => {
    const card = document.createElement("div");
    card.className = "signal";

    const botList = signal.bots
      ? `<div class="bot-list">${signal.bots.map((b) => `
        <div class="bot-row">
          <span class="dot bot-dot ${b.allowed ? "green" : "red"}"></span>
          <span>${escHtml(b.userAgent)} — ${b.allowed ? "Allowed" : "Blocked"}</span>
        </div>
      `).join("")}</div>`
      : "";

    card.innerHTML = `
      <div class="signal-header">
        <span class="dot ${escHtml(signal.status)}"></span>
        <span class="signal-name">${escHtml(signal.name)}</span>
      </div>
      <div class="signal-detail">${escHtml(signal.detail)}</div>
      ${botList}
    `;

    idxResultsEl.appendChild(card);
  });
}

async function runIndexabilityScan() {
  idxScanBtn.disabled = true;
  idxStatusEl.textContent = "Checking…";
  idxSummaryEl.textContent = "";
  idxResultsEl.innerHTML = "";

  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });

    if (!tab || !/^https?:\/\//i.test(tab.url || "")) {
      idxStatusEl.textContent = "This page can't be checked (not http/https).";
      idxScanBtn.disabled = false;
      return;
    }

    const [dom, net] = await Promise.all([
      extractDomSignals(tab),
      api.runtime.sendMessage({ action: "indexability-scan", url: tab.url }),
    ]);

    if (net && net.error) {
      idxStatusEl.textContent = `Error: ${net.error}`;
      idxScanBtn.disabled = false;
      return;
    }

    const signals = buildSignals(dom, net);
    idxStatusEl.textContent = "";
    renderIndexability(signals);
  } catch (err) {
    idxStatusEl.textContent = `Error: ${err.message}`;
  } finally {
    idxScanBtn.disabled = false;
  }
}

idxScanBtn.addEventListener("click", runIndexabilityScan);

// Auto-run when the popup opens
runIndexabilityScan();
