const hdScanBtn = document.getElementById("hdScanBtn");
const hdStatusEl = document.getElementById("hdStatus");
const hdCountsEl = document.getElementById("hdCounts");
const hdResultsEl = document.getElementById("hdResults");

let hdTabId = null;

async function extractHeadings(tab) {
  const [{ result }] = await api.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      let idCounter = 0;
      const nodes = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
      return nodes.map((el) => {
        if (!el.dataset.lssHdId) el.dataset.lssHdId = String(idCounter++);
        return {
          level: Number(el.tagName.slice(1)),
          text: el.textContent.trim().replace(/\s+/g, " ") || "(empty)",
          elementId: el.dataset.lssHdId,
        };
      });
    },
  });
  return result;
}

function renderHeadings(headings) {
  if (!headings.length) {
    hdResultsEl.innerHTML = `<div class="hd-empty">No headings found on this page.</div>`;
    hdCountsEl.innerHTML = "";
    return;
  }

  hdResultsEl.innerHTML = headings.map((h) => `
    <div class="hd-row hd-level-${h.level}">
      <span class="hd-tag">H${h.level}</span>
      <span class="hd-text">${escHtml(h.text)}</span>
      <button class="scroll-btn hd-scroll-btn" title="Find on page" data-el-id="${escHtml(h.elementId)}">↗</button>
    </div>
  `).join("");

  hdResultsEl.querySelectorAll(".hd-scroll-btn").forEach((btn) => {
    btn.addEventListener("click", () => scrollToHeading(btn.dataset.elId));
  });

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  headings.forEach((h) => counts[h.level]++);

  hdCountsEl.innerHTML = [1, 2, 3, 4, 5, 6].map((level) => `
    <div class="ov-count">
      <div class="ov-count-value">${counts[level]}</div>
      <div class="ov-count-label">H${level}</div>
    </div>
  `).join("");
}

async function scrollToHeading(elementId) {
  if (hdTabId == null) return;
  try {
    await api.scripting.executeScript({
      target: { tabId: hdTabId },
      func: (id) => {
        const el = document.querySelector(`[data-lss-hd-id="${id}"]`);
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
    hdStatusEl.textContent = `Could not scroll to element: ${err.message}`;
  }
}

async function runHeadersScan() {
  hdScanBtn.disabled = true;
  hdStatusEl.textContent = "Scanning…";
  hdResultsEl.innerHTML = "";
  hdCountsEl.innerHTML = "";

  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });

    if (!tab || !/^https?:\/\//i.test(tab.url || "")) {
      hdStatusEl.textContent = "This page can't be checked (not http/https).";
      hdScanBtn.disabled = false;
      return;
    }

    hdTabId = tab.id;
    const headings = await extractHeadings(tab);

    hdStatusEl.textContent = "";
    renderHeadings(headings || []);
  } catch (err) {
    hdStatusEl.textContent = `Error: ${err.message}`;
  } finally {
    hdScanBtn.disabled = false;
  }
}

hdScanBtn.addEventListener("click", runHeadersScan);

// Auto-run when the popup opens
runHeadersScan();
