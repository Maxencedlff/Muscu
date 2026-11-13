const CACHE = 'ppl-v150';
const ASSETS = [
  '/', '/index.html', '/manifest.json', '/data/exercise-videos.json', '/data/foods.json', '/icon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png',
  '/css/base.css', '/css/training.css', '/css/views.css', '/css/components.css',
  '/css/navigation.css', '/css/home.css', '/css/session.css', '/css/screens.css', '/css/muscles.css', '/css/share.css', '/css/recap.css', '/css/strength-levels.css', '/css/account.css',
  '/css/social.css', '/css/coach.css', '/css/coach-plan.css', '/css/paywall.css', '/css/strava.css', '/css/nutrition.css', '/css/theme-sobre.css', '/css/theme-sobre-seance.css', '/css/theme-sobre-progres.css', '/css/theme-sobre-nutrition.css', '/css/theme-sobre-coach.css',
  '/js/platform/native.js',
  '/js/core/util.js', '/js/core/dialogs.js', '/js/core/haptics-audio.js',
  '/js/data/programmes.js', '/js/data/store.js', '/js/data/records.js', '/js/data/accessors.js', '/js/data/goals.js', '/js/data/active-session.js',
  '/js/data/backup.js', '/js/data/sync.js', '/js/data/account-auth.js', '/js/data/account.js', '/js/data/age-range.js', '/js/data/social.js', '/js/data/comments.js', '/js/data/coach.js', '/js/data/strava.js',
  '/js/data/plans.js', '/js/data/min-build.js', '/js/data/access.js', '/js/data/coach-pro.js', '/js/data/newsletter.js', '/js/data/legal-links.js', '/js/data/coach-share.js', '/js/data/coach-chat.js', '/js/data/coach-plan.js', '/js/data/coach-progress.js', '/js/data/referral.js',
  '/js/data/prog-share.js', '/js/data/trash.js', '/js/data/muscles.js', '/js/data/exercise-catalogue.js', '/js/data/measures.js', '/js/data/import-csv.js', '/js/data/session-review.js',
  '/js/data/health-workouts.js', '/js/data/health-export.js', '/js/data/health-sleep.js', '/js/data/push.js', '/js/data/effort-clock.js', '/js/data/machine-track.js', '/js/data/body-measures.js',
  '/js/data/progress-photos.js', '/js/data/photo-vault.js', '/js/data/coach-photos.js', '/js/data/plates.js', '/js/data/warmup.js', '/js/data/intensif.js', '/js/data/rir.js', '/js/data/strength-standards.js', '/js/data/strength-levels.js',
  '/js/data/tempo.js', '/js/data/grips.js', '/js/data/session-order.js', '/js/data/supersets.js', '/js/data/exercise-moves.js', '/js/data/exercise-howto.js', '/js/data/muscle-load.js', '/js/data/recap.js', '/js/data/app-icons.js',
  '/js/data/guide.js', '/js/data/onboarding.js', '/js/data/my-programmes.js',
  '/js/data/import-measures.js',
  '/js/data/exercise-videos.js', '/js/data/exercise-anims.js',
  '/js/data/food-portions.js', '/js/data/nutrition.js', '/js/data/food-swap.js', '/js/data/food-scan.js', '/js/data/coach-diet.js',
  '/js/ui/theme.js', '/js/ui/router.js', '/js/ui/navbar.js', '/js/ui/sheet.js',
  '/js/ui/forms.js', '/js/ui/edge-swipe.js', '/js/ui/reorder.js', '/js/ui/body-map.js', '/js/ui/body-tip.js', '/js/ui/exercise-anim.js', '/js/ui/exercise-video.js', '/js/ui/medal.js', '/js/ui/vivant.js', '/js/ui/vivant-nutrition.js', '/js/ui/vivant-coach.js',
  '/js/app/actions.js', '/js/app/updates.js', '/js/app/live-update.js', '/js/app/init.js',
  '/js/features/dashboard.js', '/js/features/programme.js', '/js/features/programme-editor.js', '/js/features/custom-session.js',
  '/js/features/session.js', '/js/features/rest.js', '/js/features/effort.js', '/js/features/effort-tempo.js', '/js/features/effort-machine.js', '/js/features/rest-activity.js', '/js/features/watch.js', '/js/features/home-widget.js', '/js/features/siri.js', '/js/features/session-sheets.js', '/js/features/session-tools.js', '/js/features/supersets-ui.js', '/js/features/grip-ui.js', '/js/features/session-order-ui.js', '/js/features/session-gestures.js', '/js/features/session-intensif.js',
  '/js/features/summary.js', '/js/features/add-session.js', '/js/features/settings.js', '/js/features/newsletter-ui.js', '/js/features/import-ui.js', '/js/features/account-ui.js',
  '/js/features/auth-flow.js', '/js/features/social-ui.js', '/js/features/reactions-ui.js', '/js/features/comments-ui.js', '/js/features/social-me-ui.js', '/js/features/coach-ui.js',
  '/js/features/push-ui.js', '/js/features/strava-ui.js', '/js/features/coach-pro-ui.js', '/js/features/paywall-ui.js', '/js/features/coach-share-ui.js', '/js/features/coach-chat-ui.js', '/js/features/coach-plan-ui.js', '/js/features/coach-progress-ui.js',
  '/js/features/apple-services.js', '/js/features/app-icon.js', '/js/features/progress.js', '/js/features/progress-chart.js', '/js/features/progress-overview.js', '/js/features/body-measures-ui.js',
  '/js/features/photo-vault-ui.js', '/js/features/coach-photos-ui.js', '/js/features/muscles.js', '/js/features/muscle-tip.js', '/js/features/library.js', '/js/features/history.js', '/js/features/trash.js', '/js/features/guide.js',
  '/js/features/onboarding.js', '/js/features/share-stats.js', '/js/features/share-canvas.js', '/js/features/share.js', '/js/features/recap-canvas.js', '/js/features/recap.js',
  '/js/features/strength-levels-ui.js', '/js/features/nutrition-ui.js', '/js/features/diet-qty.js', '/js/features/diet-editor.js', '/js/features/food-scan-ui.js', '/js/features/diet-settings.js', '/img/strava/connect-with-strava.svg',
  // Personnage 3D de la carte des muscles (js/ui/body-map.js, BODY_IMG) : base et calques par muscle
  '/img/body/male/front/base.webp', '/img/body/male/front/chest.webp', '/img/body/male/front/front_delts.webp', '/img/body/male/front/side_delts.webp',
  '/img/body/male/front/traps.webp', '/img/body/male/front/biceps.webp', '/img/body/male/front/brachialis.webp', '/img/body/male/front/triceps.webp',
  '/img/body/male/front/forearms.webp', '/img/body/male/front/abs.webp', '/img/body/male/front/obliques.webp', '/img/body/male/front/quads.webp', '/img/body/male/front/adductors.webp',
  '/img/body/male/front/calves.webp', '/img/body/male/back/base.webp', '/img/body/male/back/side_delts.webp', '/img/body/male/back/rear_delts.webp',
  '/img/body/male/back/traps.webp', '/img/body/male/back/lats.webp', '/img/body/male/back/lower_back.webp', '/img/body/male/back/triceps.webp',
  '/img/body/male/back/forearms.webp', '/img/body/male/back/glutes.webp', '/img/body/male/back/hamstrings.webp', '/img/body/male/back/adductors.webp',
  '/img/body/male/back/calves.webp', '/img/body/female/front/base.webp', '/img/body/female/front/chest.webp', '/img/body/female/front/front_delts.webp',
  '/img/body/female/front/side_delts.webp', '/img/body/female/front/traps.webp', '/img/body/female/front/biceps.webp', '/img/body/female/front/brachialis.webp',
  '/img/body/female/front/triceps.webp', '/img/body/female/front/forearms.webp', '/img/body/female/front/abs.webp', '/img/body/female/front/obliques.webp', '/img/body/female/front/quads.webp',
  '/img/body/female/front/adductors.webp', '/img/body/female/front/calves.webp', '/img/body/female/back/base.webp', '/img/body/female/back/side_delts.webp',
  '/img/body/female/back/rear_delts.webp', '/img/body/female/back/traps.webp', '/img/body/female/back/lats.webp', '/img/body/female/back/lower_back.webp',
  '/img/body/female/back/triceps.webp', '/img/body/female/back/forearms.webp', '/img/body/female/back/glutes.webp', '/img/body/female/back/hamstrings.webp',
  '/img/body/female/back/adductors.webp', '/img/body/female/back/calves.webp',
  // Animations 3D du « Comment faire » (js/data/exercise-anims.js) : affiches dès l'installation, vidéos au
  // premier visionnage (ANIM_RE plus bas)
  '/img/anim/squat-barre.webp', '/img/anim/developpe-couche-barre.webp', '/img/anim/souleve-de-terre.webp',
  '/img/anim/tractions-pronation.webp', '/img/anim/curl-biceps-halteres.webp',
];

// Animations 3D de l'app (fichiers de l'app, quelques centaines de Ko) : mises en cache entières au premier
// visionnage, puis servies depuis le cache, plages (Range → 206) comprises : Safari ne lit une vidéo qu'ainsi
const ANIM_RE = /^\/img\/anim\/[a-z0-9-]+\.(mp4|webm)$/;

async function animResponse(request, path) {
  const cache = await caches.open(CACHE);
  let full = await cache.match(path);
  if (!full) {
    const res = await fetch(path);
    if (!res.ok) return res;
    await cache.put(path, res.clone());
    full = res;
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (!m) return full;
  const buf = await full.arrayBuffer();
  const size = buf.byteLength;
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (!(start <= end && start < size)) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(buf.slice(start, end + 1), { status: 206, headers: {
    'Content-Type': full.headers.get('Content-Type') || 'video/mp4', 'Accept-Ranges': 'bytes',
    'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
}

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
  if (ANIM_RE.test(url.pathname)) { e.respondWith(animResponse(e.request, url.pathname)); return; }
  // Vidéos d'exercices (docs/VIDEOS_EXERCICES.md) : jamais en cache, lues par plages (Range) depuis le réseau
  if (e.request.destination === 'video' || e.request.headers.has('range') || /\.(mp4|m4v|mov|webm)$/i.test(url.pathname)) return;
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
