const CACHE = 'ppl-v18';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/icon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png'];
const NETWORK_TIMEOUT = 2500; // au-delà, on sert le cache (réseau faible en salle)

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Réseau d'abord (mises à jour immédiates), mais jamais plus de 2,5 s d'attente :
// sans réseau ou avec un réseau lent, l'app s'ouvre depuis le cache.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const key = e.request.mode === 'navigate' ? '/index.html' : e.request;

  e.respondWith((async () => {
    const cache   = await caches.open(CACHE);
    const cached  = await cache.match(key, { ignoreSearch: true });
    const network = fetch(e.request).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    if (!cached) return network;
    const timeout = new Promise(r => setTimeout(() => r(cached), NETWORK_TIMEOUT));
    return Promise.race([network.catch(() => cached), timeout]);
  })());
});
