const CACHE_NAME = 'bitrack-v1';
const ASSETS = [
  '/BITrack/',
  '/BITrack/manifest.json',
  '/BITrack/icon-192x192.png',
  '/BITrack/icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
