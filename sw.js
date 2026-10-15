const CACHE = 'ppl-v24';
const ASSETS = ['/', '/index.html', '/style.css', '/nav.css', '/session.css', '/screens.css', '/app.js', '/manifest.json', '/icon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png'];

// Une version = un cache complet, téléchargé d'un bloc (cache HTTP contourné) :
// l'app ne mélange jamais des fichiers de deux versions.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
  // Pas de skipWaiting ici : la nouvelle version attend que l'utilisateur la demande
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache d'abord : ouverture instantanée, même sans réseau en salle.
// La mise à jour passe par un nouveau sw.js (vérifié par le navigateur en arrière-plan).
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const key = e.request.mode === 'navigate' ? '/index.html' : e.request;

  e.respondWith((async () => {
    const cache  = await caches.open(CACHE);
    const cached = await cache.match(key, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(e.request);
    if (res.ok && url.pathname !== '/sw.js') cache.put(key, res.clone());
    return res;
  })());
});
