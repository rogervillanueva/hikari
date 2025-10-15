/* eslint-disable no-restricted-globals */

self.addEventListener('install', (event) => {
  console.info('[sw] installing');
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  console.info('[sw] activating');
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    caches.open('runtime').then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) {
        return cached;
      }
      const response = await fetch(request);
      cache.put(request, response.clone());
      return response;
    })
  );
});
