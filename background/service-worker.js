const CONCURRENCY = 10;
const TIMEOUT_MS = 10000;

async function checkUrl(url) {
  const check = async (method) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method,
        redirect: "follow",
        signal: controller.signal,
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
    const result = await check("HEAD");
    if (result.status === 405) {
      return await check("GET");
    }
    return result;
  } catch (err) {
    return {
      url,
      finalUrl: url,
      status: 0,
      redirected: false,
      error: err.name === "AbortError" ? "Timeout" : "Network error",
    };
  }
}

async function processUrls(urls, port) {
  let index = 0;
  let active = 0;
  let done = 0;
  const total = urls.length;

  return new Promise((resolve) => {
    function next() {
      while (active < CONCURRENCY && index < total) {
        const url = urls[index++];
        active++;
        checkUrl(url).then((result) => {
          active--;
          done++;
          try {
            port.postMessage({ type: "result", data: result, done, total });
          } catch {
            // port disconnected
          }
          if (done === total) {
            try {
              port.postMessage({ type: "done", total });
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

  port.onMessage.addListener(async (msg) => {
    if (msg.action === "checkUrls") {
      const urls = msg.urls.map((u) => u.url);
      await processUrls(urls, port);
    }
  });
});
