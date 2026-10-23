const CACHE = 'ppl-v49';
const ASSETS = [
  '/', '/index.html', '/manifest.json', '/icon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png',
  '/css/base.css', '/css/training.css', '/css/views.css', '/css/components.css',
  '/css/navigation.css', '/css/session.css', '/css/screens.css', '/css/muscles.css', '/css/share.css',
  '/js/platform/native.js',
  '/js/core/util.js', '/js/core/dialogs.js', '/js/core/haptics-audio.js',
  '/js/data/programmes.js', '/js/data/store.js', '/js/data/records.js', '/js/data/accessors.js', '/js/data/active-session.js',
  '/js/data/backup.js', '/js/data/trash.js', '/js/data/muscles.js', '/js/data/muscle-load.js', '/js/data/app-icons.js',
  '/js/ui/theme.js', '/js/ui/router.js', '/js/ui/navbar.js', '/js/ui/sheet.js',
  '/js/ui/forms.js', '/js/ui/edge-swipe.js', '/js/ui/reorder.js', '/js/ui/body-map.js', '/js/ui/medal.js',
  '/js/app/actions.js', '/js/app/updates.js', '/js/app/live-update.js', '/js/app/init.js',
  '/js/features/dashboard.js', '/js/features/programme.js', '/js/features/programme-editor.js', '/js/features/custom-session.js',
  '/js/features/session.js', '/js/features/rest.js', '/js/features/rest-activity.js', '/js/features/session-sheets.js', '/js/features/session-gestures.js',
  '/js/features/summary.js', '/js/features/add-session.js', '/js/features/settings.js', '/js/features/apple-services.js', '/js/features/app-icon.js', '/js/features/progress.js',
  '/js/features/progress-chart.js', '/js/features/progress-overview.js', '/js/features/muscles.js', '/js/features/history.js', '/js/features/trash.js',
  '/js/features/share-stats.js', '/js/features/share-canvas.js', '/js/features/share.js',
];

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
