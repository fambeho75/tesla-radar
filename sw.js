/* Tesla Radar — offline cache.
   App shell: cache-first with background refresh (bump CACHE + ?v= when HTML/CSS/JS change).
   data/*.json: network-first, falls back to the last cached snapshot. */
const CACHE = "myradar-v3";
const DATA_CACHE = "myradar-data-v1";
const ASSETS = [
  "./", "./index.html", "./styles.css?v=1", "./radar.js?v=1", "./app.js?v=1",
  "./manifest.webmanifest?v=1", "./icon.svg?v=1", "./icon-rounded.svg?v=1", "./favicon-32.png?v=1",
  "./apple-touch-icon.png?v=1", "./icon-192.png?v=1", "./icon-512.png?v=1",
  "./icon-maskable-192.png?v=1", "./icon-maskable-512.png?v=1",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((p) => new Request(p, { cache: "no-store" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(cacheName, req, res) {
  if (!res || !res.ok) return;
  const copy = res.clone();
  caches.open(cacheName).then((c) => c.put(req, copy)).catch(() => {});
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith("/sw.js")) return;

  if (/\/data\/[^/]+\.json$/.test(url.pathname)) {
    const key = url.origin + url.pathname; // ignore cache-busting query
    event.respondWith(
      fetch(req).then((res) => { put(DATA_CACHE, key, res); return res; })
        .catch(() => caches.open(DATA_CACHE).then((c) => c.match(key)).then((hit) => hit || Response.error()))
    );
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => { put(CACHE, "./index.html", res); return res; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req).then((res) => { put(CACHE, req, res); return res; }).catch(() => cached);
      return cached || fresh;
    })
  );
});
