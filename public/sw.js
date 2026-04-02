const CACHE = 'nudge-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
     .then(() => self.clients.matchAll().then(clients =>
       clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }))
     ))
  );
});

self.addEventListener('fetch', (e) => {
  // Let the browser handle external requests (API calls, fonts, etc.)
  if (!e.request.url.startsWith(self.location.origin)) return;

  // Network-first for same-origin assets, fall back to cache when offline
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
