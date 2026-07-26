const CACHE_NAME = 'agentmesh-pwa-v3';
const CORE_ASSETS = [
  '/',
  '/assets/ui/styles.css',
  '/assets/ui/app.js',
  '/assets/ui/terminal.js',
  '/assets/ui/icon-app.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => {
      if (key === CACHE_NAME) return Promise.resolve();
      return caches.delete(key);
    }))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      }).catch(() => caches.match(request).then((cached) => cached || caches.match('/'))),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => cache.match(request).then((cached) => {
        const refresh = fetch(request).then((response) => {
          if (response && response.status === 200) {
            cache.put(request, response.clone()).catch(() => undefined);
          }
          return response;
        });
        if (cached) {
          refresh.catch(() => undefined);
          return cached;
        }
        return refresh;
      })),
    );
  }
});
