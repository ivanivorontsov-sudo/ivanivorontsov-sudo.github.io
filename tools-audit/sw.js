const CACHE_NAME = "tools-audit-shell-v23";
const CORE = ["./", "./index.html", "./workbench.html", "./privacy.html", "./manifest.webmanifest", "./icon.svg", "./web-tools.html", "./extra-500.html", "./vendor/JSQR-LICENSE.txt", "./vendor/JSZIP-LICENSE.txt", "./vendor/QRCODE-LICENSE.txt", "./vendor/jsQR.js", "./vendor/jszip.min.js", "./vendor/qrcode-generator.js", "./local-alternatives.html", "./local-suite.html", "./local-plus.html", "./search.html", "./search.js", "./workshop/converters.js"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("tools-audit-") && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const safeUrl = new URL(url.href);
      const toolId = safeUrl.searchParams.get("tool");
      const isSafeToolLink =
        /\/tools-audit\/workshop\//.test(safeUrl.pathname) &&
        safeUrl.searchParams.size === 1 &&
        /^[a-z0-9-]{1,120}$/i.test(toolId || "");
      if (safeUrl.search && !isSafeToolLink) safeUrl.search = "";
      const cacheKey = new Request(safeUrl.href, { method: "GET" });
      try {
        const response = await fetch(safeUrl.href, {
          credentials: "same-origin",
          cache: "no-cache",
          referrerPolicy: "no-referrer"
        });
        if (response.ok) {
          const copy = response.clone();
          await caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, copy));
        }
        return response;
      } catch {
        return (await caches.match(cacheKey)) ||
          (await caches.match("./workbench.html"));
      }
    })());
    return;
  }
  event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then(cache => cache.put(req, copy)); }
    return res;
  })));
});
