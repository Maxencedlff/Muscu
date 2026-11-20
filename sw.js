const CACHE = 'ppl-v220';
const ASSETS = [
  '/', '/index.html', '/manifest.json', '/data/exercise-videos.json', '/data/foods.json', '/icon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png',
  '/css/base.css', '/css/training.css', '/css/views.css', '/css/components.css',
  '/css/navigation.css', '/css/home.css', '/css/session.css', '/css/screens.css', '/css/muscles.css', '/css/share.css', '/css/recap.css', '/css/strength-levels.css', '/css/account.css',
  '/css/social.css', '/css/coach.css', '/css/coach-plan.css', '/css/paywall.css', '/css/strava.css', '/css/nutrition.css', '/css/water.css', '/css/theme-sobre.css', '/css/theme-sobre-seance.css', '/css/theme-sobre-progres.css', '/css/theme-sobre-nutrition.css', '/css/theme-sobre-coach.css', '/css/theme-sobre-reglages.css', '/css/programme.css',
  '/js/platform/native.js',
  '/js/core/util.js', '/js/core/dialogs.js', '/js/core/haptics-audio.js',
  '/js/data/programmes.js', '/js/data/store.js', '/js/data/records.js', '/js/data/accessors.js', '/js/data/goals.js', '/js/data/active-session.js',
  '/js/data/backup.js', '/js/data/sync.js', '/js/data/account-auth.js', '/js/data/account.js', '/js/data/age-range.js', '/js/data/social.js', '/js/data/comments.js', '/js/data/coach.js', '/js/data/strava.js',
  '/js/data/plans.js', '/js/data/min-build.js', '/js/data/access.js', '/js/data/coach-pro.js', '/js/data/newsletter.js', '/js/data/legal-links.js', '/js/data/coach-share.js', '/js/data/coach-chat.js', '/js/data/coach-plan.js', '/js/data/coach-progress.js', '/js/data/referral.js',
  '/js/data/prog-share.js', '/js/data/trash.js', '/js/data/muscles.js', '/js/data/exercise-catalogue.js', '/js/data/body-parts.js', '/js/data/exercise-parts.js', '/js/data/atlas.js', '/js/data/measures.js', '/js/data/import-csv.js', '/js/data/session-review.js',
  '/js/data/health-workouts.js', '/js/data/health-export.js', '/js/data/health-sleep.js', '/js/data/push.js', '/js/data/effort-clock.js', '/js/data/machine-track.js', '/js/data/body-measures.js',
  '/js/data/progress-photos.js', '/js/data/photo-vault.js', '/js/data/coach-photos.js', '/js/data/profile-photo.js', '/js/data/plates.js', '/js/data/warmup.js', '/js/data/intensif.js', '/js/data/coach-presc.js', '/js/data/rir.js', '/js/data/notes.js', '/js/data/strength-standards.js', '/js/data/strength-levels.js',
  '/js/data/tempo.js', '/js/data/grips.js', '/js/data/session-order.js', '/js/data/supersets.js', '/js/data/exercise-moves.js', '/js/data/exercise-howto.js', '/js/data/muscle-load.js', '/js/data/recap.js', '/js/data/app-icons.js',
  '/js/data/guide.js', '/js/data/onboarding.js', '/js/data/my-programmes.js', '/js/data/program-generator.js',
  '/js/data/import-measures.js',
  '/js/data/exercise-videos.js', '/js/data/exercise-anims.js',
  '/js/data/food-portions.js', '/js/data/nutrition.js', '/js/data/diet-estimate.js', '/js/data/water.js', '/js/data/food-swap.js', '/js/data/food-scan.js', '/js/data/coach-diet.js', '/js/data/diet-share.js',
  '/js/ui/theme.js', '/js/ui/router.js', '/js/ui/navbar.js', '/js/ui/sheet.js',
  '/js/ui/forms.js', '/js/ui/edge-swipe.js', '/js/ui/swipe-row.js', '/js/ui/reorder.js', '/js/ui/body-map.js', '/js/ui/body-tip.js', '/js/ui/body-zoom.js', '/js/ui/exercise-anim.js', '/js/ui/exercise-video.js', '/js/ui/medal.js', '/js/ui/vivant.js', '/js/ui/vivant-nutrition.js', '/js/ui/vivant-coach.js',
  '/js/app/actions.js', '/js/app/updates.js', '/js/app/live-update.js', '/js/app/init.js',
  '/js/features/dashboard.js', '/js/features/programme.js', '/js/features/programme-editor.js', '/js/features/custom-session.js',
  '/js/features/session.js', '/js/features/rest.js', '/js/features/effort.js', '/js/features/effort-tempo.js', '/js/features/effort-machine.js', '/js/features/rest-activity.js', '/js/features/watch.js', '/js/features/home-widget.js', '/js/features/siri.js', '/js/features/session-sheets.js', '/js/features/session-tools.js', '/js/features/supersets-ui.js', '/js/features/grip-ui.js', '/js/features/session-notes.js', '/js/features/session-order-ui.js', '/js/features/session-gestures.js', '/js/features/session-intensif.js',
  '/js/features/summary.js', '/js/features/add-session.js', '/js/features/settings.js', '/js/features/newsletter-ui.js', '/js/features/import-ui.js', '/js/features/account-ui.js',
  '/js/features/auth-flow.js', '/js/features/social-ui.js', '/js/features/reactions-ui.js', '/js/features/comments-ui.js', '/js/features/social-me-ui.js', '/js/features/coach-ui.js', '/js/features/coach-presc-ui.js',
  '/js/features/push-ui.js', '/js/features/strava-ui.js', '/js/features/coach-pro-ui.js', '/js/features/paywall-ui.js', '/js/features/coach-share-ui.js', '/js/features/coach-diet-ui.js', '/js/features/coach-chat-ui.js', '/js/features/coach-plan-ui.js', '/js/features/coach-progress-ui.js',
  '/js/features/apple-services.js', '/js/features/app-icon.js', '/js/features/progress.js', '/js/features/progress-chart.js', '/js/features/progress-overview.js', '/js/features/progress-muscles.js', '/js/features/body-measures-ui.js',
  '/js/features/photo-vault-ui.js', '/js/features/coach-photos-ui.js', '/js/features/profile-photo-ui.js', '/js/features/muscles.js', '/js/features/muscle-tip.js', '/js/features/library.js', '/js/features/history.js', '/js/features/history-calendar.js', '/js/features/trash.js', '/js/features/guide.js',
  '/js/features/onboarding.js', '/js/features/program-generator-ui.js', '/js/features/share-stats.js', '/js/features/share-canvas.js', '/js/features/share.js', '/js/features/recap-canvas.js', '/js/features/recap.js',
  '/js/features/strength-levels-ui.js', '/js/features/nutrition-ui.js', '/js/features/diet-qty.js', '/js/features/diet-editor.js', '/js/features/diet-week.js', '/js/features/food-scan-ui.js', '/js/features/diet-settings.js', '/js/features/water-ui.js', '/img/strava/connect-with-strava.svg',
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
  // <body2-1x> (tools/gen-body2.py) atlas de la fiche exercice en 1× et cartes de toucher ; le 3× n'est pas
  // ici : mis en cache au premier zoom par la règle « cache d'abord » du fetch (plus bas)
  '/img/body2/female/back/base.webp', '/img/body2/female/back/hit.png', '/img/body2/female/back/p/adductor_magnus.webp', '/img/body2/female/back/p/biceps_femoris.webp',
  '/img/body2/female/back/p/brachioradialis.webp', '/img/body2/female/back/p/delt_lateral.webp', '/img/body2/female/back/p/delt_posterior.webp', '/img/body2/female/back/p/erector.webp',
  '/img/body2/female/back/p/external_oblique.webp', '/img/body2/female/back/p/finger_extensors.webp', '/img/body2/female/back/p/gastro_lateral.webp', '/img/body2/female/back/p/gastro_medial.webp',
  '/img/body2/female/back/p/glute_max.webp', '/img/body2/female/back/p/glute_med.webp', '/img/body2/female/back/p/infraspinatus.webp', '/img/body2/female/back/p/lats.webp',
  '/img/body2/female/back/p/radial_extensors.webp', '/img/body2/female/back/p/rhomboid_major.webp', '/img/body2/female/back/p/rhomboid_minor.webp', '/img/body2/female/back/p/semimembranosus.webp',
  '/img/body2/female/back/p/semitendinosus.webp', '/img/body2/female/back/p/soleus.webp', '/img/body2/female/back/p/teres.webp', '/img/body2/female/back/p/teres_minor.webp',
  '/img/body2/female/back/p/traps_lower.webp', '/img/body2/female/back/p/traps_middle.webp', '/img/body2/female/back/p/traps_upper.webp', '/img/body2/female/back/p/triceps_lateral.webp',
  '/img/body2/female/back/p/triceps_long.webp', '/img/body2/female/back/p/triceps_medial.webp', '/img/body2/female/front/base.webp', '/img/body2/female/front/hit.png',
  '/img/body2/female/front/p/adductors.webp', '/img/body2/female/front/p/biceps_long.webp', '/img/body2/female/front/p/biceps_short.webp', '/img/body2/female/front/p/brachialis.webp',
  '/img/body2/female/front/p/brachioradialis.webp', '/img/body2/female/front/p/chest_abdominal.webp', '/img/body2/female/front/p/chest_clavicular.webp', '/img/body2/female/front/p/chest_sternal.webp',
  '/img/body2/female/front/p/delt_anterior.webp', '/img/body2/female/front/p/delt_lateral.webp', '/img/body2/female/front/p/external_oblique.webp', '/img/body2/female/front/p/gastro_medial.webp',
  '/img/body2/female/front/p/pec_minor.webp', '/img/body2/female/front/p/peroneus.webp', '/img/body2/female/front/p/rectus_abdominis.webp', '/img/body2/female/front/p/rectus_femoris.webp',
  '/img/body2/female/front/p/sartorius.webp', '/img/body2/female/front/p/serratus.webp', '/img/body2/female/front/p/soleus.webp', '/img/body2/female/front/p/tfl.webp',
  '/img/body2/female/front/p/tibialis.webp', '/img/body2/female/front/p/traps_upper.webp', '/img/body2/female/front/p/triceps_long.webp', '/img/body2/female/front/p/triceps_medial.webp',
  '/img/body2/female/front/p/vastus_lateralis.webp', '/img/body2/female/front/p/vastus_medialis.webp', '/img/body2/female/front/p/wrist_flexors.webp', '/img/body2/male/back/base.webp',
  '/img/body2/male/back/hit.png', '/img/body2/male/back/p/adductor_magnus.webp', '/img/body2/male/back/p/biceps_femoris.webp', '/img/body2/male/back/p/brachioradialis.webp',
  '/img/body2/male/back/p/delt_lateral.webp', '/img/body2/male/back/p/delt_posterior.webp', '/img/body2/male/back/p/erector.webp', '/img/body2/male/back/p/external_oblique.webp',
  '/img/body2/male/back/p/finger_extensors.webp', '/img/body2/male/back/p/gastro_lateral.webp', '/img/body2/male/back/p/gastro_medial.webp', '/img/body2/male/back/p/glute_max.webp',
  '/img/body2/male/back/p/glute_med.webp', '/img/body2/male/back/p/infraspinatus.webp', '/img/body2/male/back/p/lats.webp', '/img/body2/male/back/p/radial_extensors.webp',
  '/img/body2/male/back/p/rhomboid_major.webp', '/img/body2/male/back/p/rhomboid_minor.webp', '/img/body2/male/back/p/semimembranosus.webp', '/img/body2/male/back/p/semitendinosus.webp',
  '/img/body2/male/back/p/soleus.webp', '/img/body2/male/back/p/teres.webp', '/img/body2/male/back/p/teres_minor.webp', '/img/body2/male/back/p/traps_lower.webp',
  '/img/body2/male/back/p/traps_middle.webp', '/img/body2/male/back/p/traps_upper.webp', '/img/body2/male/back/p/triceps_lateral.webp', '/img/body2/male/back/p/triceps_long.webp',
  '/img/body2/male/back/p/triceps_medial.webp', '/img/body2/male/front/base.webp', '/img/body2/male/front/hit.png', '/img/body2/male/front/p/adductors.webp',
  '/img/body2/male/front/p/biceps_long.webp', '/img/body2/male/front/p/biceps_short.webp', '/img/body2/male/front/p/brachialis.webp', '/img/body2/male/front/p/brachioradialis.webp',
  '/img/body2/male/front/p/chest_abdominal.webp', '/img/body2/male/front/p/chest_clavicular.webp', '/img/body2/male/front/p/chest_sternal.webp', '/img/body2/male/front/p/delt_anterior.webp',
  '/img/body2/male/front/p/delt_lateral.webp', '/img/body2/male/front/p/external_oblique.webp', '/img/body2/male/front/p/gastro_medial.webp', '/img/body2/male/front/p/pec_minor.webp',
  '/img/body2/male/front/p/peroneus.webp', '/img/body2/male/front/p/rectus_abdominis.webp', '/img/body2/male/front/p/rectus_femoris.webp', '/img/body2/male/front/p/sartorius.webp',
  '/img/body2/male/front/p/serratus.webp', '/img/body2/male/front/p/soleus.webp', '/img/body2/male/front/p/tfl.webp', '/img/body2/male/front/p/tibialis.webp',
  '/img/body2/male/front/p/traps_upper.webp', '/img/body2/male/front/p/triceps_long.webp', '/img/body2/male/front/p/triceps_medial.webp', '/img/body2/male/front/p/vastus_lateralis.webp',
  '/img/body2/male/front/p/vastus_medialis.webp', '/img/body2/male/front/p/wrist_flexors.webp',
  // </body2-1x>
  // Groupes de muscles illustrés (Bibliothèque) et en-tête de la fiche d'un exercice (js/features/library.js)
  '/img/muscles/pectoraux.webp', '/img/muscles/dos.webp', '/img/muscles/epaules.webp', '/img/muscles/bras.webp', '/img/muscles/abdominaux.webp', '/img/muscles/jambes.webp',
  '/img/muscles/chest.webp', '/img/muscles/front_delts.webp', '/img/muscles/side_delts.webp', '/img/muscles/rear_delts.webp', '/img/muscles/traps.webp', '/img/muscles/lats.webp',
  '/img/muscles/lower_back.webp', '/img/muscles/biceps.webp', '/img/muscles/brachialis.webp', '/img/muscles/triceps.webp', '/img/muscles/forearms.webp', '/img/muscles/abs.webp',
  '/img/muscles/obliques.webp', '/img/muscles/glutes.webp', '/img/muscles/quads.webp', '/img/muscles/hamstrings.webp', '/img/muscles/adductors.webp', '/img/muscles/calves.webp',
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
