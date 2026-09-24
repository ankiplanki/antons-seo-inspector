const ovScanBtn = document.getElementById("ovScanBtn");
const ovStatusEl = document.getElementById("ovStatus");
const ovResultsEl = document.getElementById("ovResults");

async function extractOverviewSignals(tab) {
  const [{ result }] = await api.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const getMeta = (name) => document.querySelector(`meta[name="${name}" i]`)?.content?.trim() || null;
      const countTag = (tag) => document.getElementsByTagName(tag).length;
      return {
        title: document.title?.trim() || null,
        description: getMeta("description"),
        keywords: getMeta("keywords"),
        canonical: document.querySelector('link[rel="canonical"]')?.href || null,
        robotsMeta: getMeta("robots"),
        author: getMeta("author"),
        publisher: getMeta("publisher"),
        lang: document.documentElement.lang?.trim() || null,
        headings: {
          h1: countTag("h1"),
          h2: countTag("h2"),
          h3: countTag("h3"),
          h4: countTag("h4"),
          h5: countTag("h5"),
          h6: countTag("h6"),
        },
        images: document.querySelectorAll("img").length,
        links: document.querySelectorAll("a[href]").length,
        currentUrl: window.location.href,
      };
    },
  });
  return result;
}

function formatRobotsTag(value) {
  if (!value) return "INDEX, FOLLOW";
  return value.split(",").map((s) => s.trim().toUpperCase()).join(", ");
}

function titleStatus(len) {
  if (!len) return "missing";
  if (len < 30 || len > 60) return "warn";
  return "pass";
}

function descriptionStatus(len) {
  if (!len) return "missing";
  if (len < 50 || len > 170) return "warn";
  return "pass";
}

function valueRow(label, value, { missingText } = {}) {
  if (!value) {
    return `
      <div class="ov-row">
        <span class="ov-label">${escHtml(label)}</span>
        <span class="ov-value missing">${escHtml(missingText || `${label} is missing!`)}</span>
      </div>
    `;
  }
  return `
    <div class="ov-row">
      <span class="ov-label">${escHtml(label)}</span>
      <span class="ov-value">${escHtml(value)}</span>
    </div>
  `;
}

function charCountRow(label, value, status) {
  const len = value ? value.length : 0;
  const valueHtml = value
    ? `${escHtml(value)}<br><span class="ov-value ${status}">${len} characters</span>`
    : `<span class="ov-value missing">${escHtml(label)} is missing!</span>`;
  return `
    <div class="ov-row">
      <span class="ov-label">${escHtml(label)}</span>
      <span class="ov-value">${valueHtml}</span>
    </div>
  `;
}

function linkOrDisabled(label, info) {
  if (info && info.exists && info.url) {
    return `<a class="ov-link" href="${escHtml(info.url)}" target="_blank" rel="noopener">${escHtml(label)}</a>`;
  }
  return `<span class="ov-link disabled" title="Not found">${escHtml(label)}</span>`;
}

function renderOverview(dom, net) {
  ovResultsEl.innerHTML = `
    <div class="ov-grid">
      ${charCountRow("Title", dom.title, titleStatus(dom.title ? dom.title.length : 0))}
      ${charCountRow("Description", dom.description, descriptionStatus(dom.description ? dom.description.length : 0))}
      ${valueRow("Keywords", dom.keywords)}
      ${valueRow("URL", dom.currentUrl)}
      ${valueRow("Canonical", dom.canonical)}
      ${valueRow("Robots Tag", formatRobotsTag(dom.robotsMeta))}
      ${valueRow("Author", dom.author)}
      ${valueRow("Publisher", dom.publisher)}
      ${valueRow("Lang", dom.lang)}
    </div>
    <div class="ov-counts">
      ${["h1", "h2", "h3", "h4", "h5", "h6"].map((h) => `
        <div class="ov-count">
          <div class="ov-count-value">${dom.headings[h]}</div>
          <div class="ov-count-label">${h.toUpperCase()}</div>
        </div>
      `).join("")}
      <div class="ov-count">
        <div class="ov-count-value">${dom.images}</div>
        <div class="ov-count-label">Images</div>
      </div>
      <div class="ov-count">
        <div class="ov-count-value">${dom.links}</div>
        <div class="ov-count-label">Links</div>
      </div>
    </div>
    <div class="ov-links-row">
      ${linkOrDisabled("Robots.txt", net.robots)}
      <span class="ov-links-sep">|</span>
      ${linkOrDisabled("Sitemap.xml", net.sitemap)}
    </div>
  `;
}

async function runOverviewScan() {
  ovScanBtn.disabled = true;
  ovStatusEl.textContent = "Scanning…";
  ovResultsEl.innerHTML = "";

  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });

    if (!tab || !/^https?:\/\//i.test(tab.url || "")) {
      ovStatusEl.textContent = "This page can't be checked (not http/https).";
      ovScanBtn.disabled = false;
      return;
    }

    const [dom, net] = await Promise.all([
      extractOverviewSignals(tab),
      api.runtime.sendMessage({ action: "overview-scan", url: tab.url }),
    ]);

    if (net && net.error) {
      ovStatusEl.textContent = `Error: ${net.error}`;
      ovScanBtn.disabled = false;
      return;
    }

    ovStatusEl.textContent = "";
    renderOverview(dom, net);
  } catch (err) {
    ovStatusEl.textContent = `Error: ${err.message}`;
  } finally {
    ovScanBtn.disabled = false;
  }
}

ovScanBtn.addEventListener("click", runOverviewScan);

// Auto-run when the popup opens
runOverviewScan();
