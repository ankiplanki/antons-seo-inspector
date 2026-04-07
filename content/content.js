function extractAllUrls() {
  const urlMap = new Map(); // url -> Set of sources

  function addUrl(url, source) {
    if (!url) return;
    let absolute;
    try {
      absolute = new URL(url, document.baseURI).href;
    } catch {
      return;
    }
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
      if (isSrcset) {
        parseSrcset(val, label);
      } else {
        addUrl(val, label);
      }
    });
  }

  return Array.from(urlMap.entries()).map(([url, sources]) => ({
    url,
    sources: Array.from(sources),
  }));
}
