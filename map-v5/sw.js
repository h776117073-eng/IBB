const CACHE_NAME = 'ibb-market-geo-engine-v5-port';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/ibb-search-worker.js',
  './js/ibb-routing-worker.js',
  './sdk/ibb-map-sdk.js',
  './manifest.json',
  './data/core_lite.json',
  './data/ibb_routing_graph.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Byte-Range requests (HTTP 206) are cached directly inside IndexedDB by IndexedDBByteSource
  if (req.headers.has('range')) return;

  const url = new URL(req.url);
  const shouldCache =
    url.origin === self.location.origin ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('demotiles.maplibre.org') ||
    url.hostname.includes('arcgisonline.com') ||
    url.hostname.includes('amazonaws.com');

  if (!shouldCache) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.status === 200) {
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        return cached || Response.error();
      }
    })
  );
});
