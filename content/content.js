function extractAllUrls() {
  const urlMap = new Map();
  let idCounter = 0;

  function addUrl(url, source, el) {
    if (!url) return;
    let absolute;
    try {
      absolute = new URL(url, document.baseURI).href;
    } catch {
      return;
    }
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
      if (isSrcset) {
        parseSrcset(val, label, el);
      } else {
        addUrl(val, label, el);
      }
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
