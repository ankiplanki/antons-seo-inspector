const api = globalThis.browser || globalThis.chrome;

const CONCURRENCY = 10;
const TIMEOUT_MS = 10000;

async function checkUrl(url, scanSignal) {
  const check = async (method, withCredentials) => {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), TIMEOUT_MS);

    // Combine per-request timeout with the scan-level abort signal
    scanSignal.addEventListener("abort", () => timeoutController.abort(), { once: true });

    try {
      const response = await fetch(url, {
        method,
        redirect: "follow",
        credentials: withCredentials ? "include" : "omit",
        signal: timeoutController.signal,
      });
      clearTimeout(timer);
      return {
        url,
        finalUrl: response.url,
        status: response.status,
        redirected: response.redirected,
        error: null,
      };
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  };

  try {
    const result = await check("HEAD", true);
    if (result.status === 405) {
      return await check("GET", false);
    }
    return result;
  } catch (err) {
    // Distinguish scan-stopped from per-request timeout
    if (scanSignal.aborted) return null;
    return {
      url,
      finalUrl: url,
      status: 0,
      redirected: false,
      error: err.name === "AbortError" ? "Timeout" : "Network error",
    };
  }
}

async function processUrls(urls, port, scanSignal) {
  let index = 0;
  let active = 0;
  let done = 0;
  const total = urls.length;

  return new Promise((resolve) => {
    function next() {
      while (active < CONCURRENCY && index < total) {
        const url = urls[index++];
        active++;
        checkUrl(url, scanSignal).then((result) => {
          active--;
          done++;

          // null result means scan was stopped — drain remaining active fetches silently
          if (result !== null) {
            try {
              port.postMessage({ type: "result", data: result, done, total });
            } catch {
              // port disconnected
            }
          }

          if (done === total) {
            try {
              if (!scanSignal.aborted) port.postMessage({ type: "done", total });
            } catch {}
            resolve();
          } else {
            next();
          }
        });
      }
    }
    next();
  });
}

api.runtime.onConnect.addListener((port) => {
  if (port.name !== "scan") return;

  const scanController = new AbortController();

  port.onDisconnect.addListener(() => {
    scanController.abort();
  });

  port.onMessage.addListener(async (msg) => {
    if (msg.action === "checkUrls") {
      const urls = msg.urls.map((u) => u.url);
      await processUrls(urls, port, scanController.signal);
    }
  });
});

// --- Indexability check ---

function fetchWithTimeout(url, options = {}, ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const TARGET_BOTS = ["Googlebot", "Bingbot", "GPTBot", "ClaudeBot", "PerplexityBot"];

function parseRobotsTxt(text) {
  const groups = [];
  let current = null;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;

    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;

    const field = match[1].trim().toLowerCase();
    const value = match[2].trim();

    if (field === "user-agent") {
      if (current && current.rules.length === 0) {
        current.userAgents.push(value.toLowerCase());
      } else {
        current = { userAgents: [value.toLowerCase()], rules: [] };
        groups.push(current);
      }
    } else if (current && (field === "allow" || field === "disallow")) {
      if (value) {
        current.rules.push({ type: field, path: value });
      }
    }
  }

  return groups;
}

function pathToRegex(pattern) {
  let regex = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      regex += ".*";
    } else if (ch === "$" && i === pattern.length - 1) {
      regex += "$";
    } else {
      regex += ch.replace(/[.+?^{}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^" + regex);
}

function findMatchingGroup(groups, userAgent) {
  const ua = userAgent.toLowerCase();
  const specific = groups.find((g) => g.userAgents.includes(ua));
  if (specific) return specific;
  return groups.find((g) => g.userAgents.includes("*")) || null;
}

function isPathAllowed(groups, userAgent, path) {
  const group = findMatchingGroup(groups, userAgent);
  if (!group) return true;

  let bestMatch = null;
  let bestLength = -1;

  for (const rule of group.rules) {
    const regex = pathToRegex(rule.path);
    if (regex.test(path) && rule.path.length > bestLength) {
      bestMatch = rule;
      bestLength = rule.path.length;
    }
  }

  if (!bestMatch) return true;
  return bestMatch.type === "allow";
}

async function checkRobotsTxt(origin, pathname) {
  try {
    const res = await fetchWithTimeout(origin + "/robots.txt");
    if (res.status === 404) {
      return { status: "pass", details: TARGET_BOTS.map((b) => ({ userAgent: b, allowed: true })), raw: null };
    }
    if (!res.ok) {
      return {
        status: "pass",
        details: TARGET_BOTS.map((b) => ({ userAgent: b, allowed: true })),
        raw: null,
        note: `robots.txt returned ${res.status} — treating as fully allowed`,
      };
    }
    const text = await res.text();
    const groups = parseRobotsTxt(text);
    const details = TARGET_BOTS.map((bot) => ({ userAgent: bot, allowed: isPathAllowed(groups, bot, pathname) }));
    const allAllowed = details.every((d) => d.allowed);
    return { status: allAllowed ? "pass" : "fail", details, raw: text.slice(0, 2000) };
  } catch (e) {
    return {
      status: "warn",
      details: [],
      error: e.name === "AbortError" ? "Timed out fetching robots.txt" : `Could not fetch robots.txt: ${e.message}`,
    };
  }
}

async function checkPageHeaders(url) {
  try {
    const res = await fetchWithTimeout(url, { method: "GET", redirect: "follow" });
    const xRobotsTag = res.headers.get("X-Robots-Tag");
    let xRobotsStatus = "pass";
    let xRobotsDirectives = null;

    if (xRobotsTag) {
      xRobotsDirectives = xRobotsTag;
      const lower = xRobotsTag.toLowerCase();
      if (lower.includes("noindex") || lower.includes("none")) {
        xRobotsStatus = "fail";
      } else if (lower.includes("nofollow") || lower.includes("noarchive") || lower.includes("nosnippet")) {
        xRobotsStatus = "warn";
      }
    }

    let httpStatus = "pass";
    if (res.status >= 400) httpStatus = "fail";
    else if (res.status >= 300 || res.redirected) httpStatus = "warn";

    return {
      httpStatus: { status: httpStatus, code: res.status, redirected: res.redirected, finalUrl: res.url },
      xRobotsTag: { status: xRobotsStatus, directives: xRobotsDirectives },
    };
  } catch (e) {
    return {
      httpStatus: { status: "warn", code: null, error: e.name === "AbortError" ? "Timed out" : e.message },
      xRobotsTag: { status: "warn", directives: null, error: "Could not fetch page headers" },
    };
  }
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "indexability-scan") return;

  const url = new URL(msg.url);
  const origin = url.origin;
  const pathname = url.pathname + url.search;

  Promise.all([checkRobotsTxt(origin, pathname), checkPageHeaders(msg.url)])
    .then(([robotsTxt, pageHeaders]) => sendResponse({ robotsTxt, ...pageHeaders }))
    .catch((err) => sendResponse({ error: err.message }));

  return true; // keep sendResponse channel open for async work
});
