// ═══════════════════════════════════════════════════════════
//  Mises à jour (service worker)
// ═══════════════════════════════════════════════════════════
'use strict';

let swReg = null;
let swReloading = false;

function registerServiceWorker() {
  // App iOS : les mises à jour passent par l'App Store, pas par le service worker
  if (Native.isNative || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').then(reg => {
    swReg = reg;
    maybeShowUpdateBanner();
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => { if (sw.state === 'installed') maybeShowUpdateBanner(); });
    });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swReloading) location.reload();
  });
  // Vérifie au retour au premier plan
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') swReg?.update().catch(() => {});
  });
}

// ── Nouvelle build dans TestFlight ──────────────────────────
// Le code natif ne change que par une build : quand une build plus récente que celle installée est
// disponible, une bannière (publiée par mise à jour à chaud, donc lue par l'ancienne build) envoie
// vers TestFlight. LATEST_NATIVE_BUILD n'est relevé qu'une fois la build installable.
const LATEST_NATIVE_BUILD = 24;            // lien TestFlight : TESTFLIGHT_URL (js/data/min-build.js)
const NATIVE_BANNER_KEY   = 'ppl_native_update_dismissed';   // build pour laquelle « Plus tard » a été touché

async function maybeShowNativeUpdate() {
  const build = await Native.appBuild();
  if (!build || build >= LATEST_NATIVE_BUILD || activeSession || $('.update-banner')) return;
  try { if (localStorage.getItem(NATIVE_BANNER_KEY) === String(LATEST_NATIVE_BUILD)) return; } catch {}
  const el = document.createElement('div');
  el.className = 'update-banner update-banner--native';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>Nouvelle version dans TestFlight</span>
    <button class="update-banner__later" type="button">Plus tard</button>
    <button class="update-banner__btn" type="button">Installer</button>`;
  const close = () => { el.remove(); try { localStorage.setItem(NATIVE_BANNER_KEY, String(LATEST_NATIVE_BUILD)); } catch {} };
  el.querySelector('.update-banner__later').addEventListener('click', close);
  // Lien public TestFlight : iOS l'ouvre hors de l'app, TestFlight propose la mise à jour
  el.querySelector('.update-banner__btn').addEventListener('click', () => { close(); window.open(TESTFLIGHT_URL, '_blank'); });
  document.body.appendChild(el);
}

// ── Version minimale de l'app (app_config.min_build) ────────
// Écran plein « Mets à jour l'app », qui ne se ferme pas, quand le serveur annonce une build native
// minimale plus récente que celle installée (règles dans js/data/min-build.js). Rien n'est perdu : les
// séances restent sur l'iPhone. Serveur injoignable : rien n'est affiché (hors ligne, jamais bloqué).
// Jamais pendant une séance : l'écran attend le retour suivant au premier plan. Si le serveur abaisse
// ensuite le minimum (valeur réglée par erreur), l'écran s'en va à la vérification suivante.
// Les builds publiées AVANT ce code ne le lisent pas : voir docs/PAYANT_V1.md, « Ordre de déploiement ».
async function checkMinBuild() {
  const build = await Native.appBuild();
  if (!build) return false;                        // navigateur : jamais
  const r = await minBuildFetch();
  if (!r.ok) return !!$('.min-build');             // injoignable : rien ne change
  const shown = $('.min-build');
  if (!minBuildBlocks(build, r.min)) { shown?.remove(); return false; }
  if (shown) return true;
  if (activeSession) return false;
  const url = minBuildUpdateUrl(await accessStoreEnvironment());
  const store = url.includes('testflight') ? 'TestFlight' : 'l\'App Store';
  const el = document.createElement('div');
  el.className = 'min-build';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'minBuildTitle');
  el.setAttribute('aria-describedby', 'minBuildText');
  el.innerHTML = `<div class="min-build__box">
      <img class="min-build__icon" src="apple-touch-icon.png" alt="" width="96" height="96">
      <h1 class="min-build__title" id="minBuildTitle" tabindex="-1">Mets à jour l'app</h1>
      <p class="min-build__text" id="minBuildText">Une nouvelle version de MDLF Training est nécessaire pour continuer. Tes séances restent enregistrées sur cet iPhone.</p>
    </div>
    <div class="min-build__foot">
      <button class="btn btn--primary min-build__btn" type="button">Ouvrir ${store}</button>
      <p class="min-build__note">Version installée : ${build} · requise : ${r.min}</p>
    </div>`;
  el.querySelector('.min-build__btn').addEventListener('click', () => window.open(url, '_blank'));
  if ($('.min-build') || activeSession) return !!$('.min-build');   // vérification concurrente
  document.body.appendChild(el);
  el.querySelector('#minBuildTitle')?.focus({ preventScroll: true });
  return true;
}
// Au démarrage, une fois le compte relu (le client Supabase existe alors), au retour au premier plan
// et au retour du réseau
let minBuildChecked = false;
onAccountChange(() => { if (account.ready && !minBuildChecked) { minBuildChecked = true; checkMinBuild(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && account.ready) checkMinBuild(); });
window.addEventListener('online', () => { if (account.ready) checkMinBuild(); });

// Bannière « Nouvelle version disponible », jamais pendant une séance
function maybeShowUpdateBanner() {
  if (!swReg?.waiting || !navigator.serviceWorker.controller || activeSession || $('.update-banner')) return;
  const el = document.createElement('div');
  el.className = 'update-banner';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>Nouvelle version disponible</span><button class="update-banner__btn" type="button">Mettre à jour</button>`;
  el.querySelector('button').addEventListener('click', () => applyUpdate());
  document.body.appendChild(el);
}

function applyUpdate() {
  const waiting = swReg?.waiting;
  if (!waiting) { location.reload(); return; }
  swReloading = true;
  waiting.postMessage('skipWaiting');
  setTimeout(() => location.reload(), 3000); // filet si controllerchange n'arrive pas
}

async function checkForUpdate() {
  if (!('serviceWorker' in navigator) || !swReg) { location.reload(); return; }
  try { await swReg.update(); }
  catch { showToast('Impossible de vérifier : pas de connexion ?', { error: true }); return; }
  const pending = swReg.waiting || swReg.installing;
  if (!pending) { showToast('Tu as la dernière version'); return; }
  showToast('Mise à jour…');
  // Repart de zéro : caches vidés, service worker désinscrit, puis rechargement
  try { await Promise.all((await caches.keys()).map(k => caches.delete(k))); } catch {}
  try { await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.unregister())); } catch {}
  location.reload();
}
