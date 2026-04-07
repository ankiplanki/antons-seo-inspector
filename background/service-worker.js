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

chrome.runtime.onConnect.addListener((port) => {
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
