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
const LATEST_NATIVE_BUILD = 24;
const TESTFLIGHT_URL      = 'https://testflight.apple.com/join/qxpdFN6Z';
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
// Relecture du 28/10 : le jour où le verrou de l'abonnement s'allume, une build trop ancienne ne saurait
// rien proposer quand le serveur refuse ses séances. Le serveur publie donc la build native minimale
// (`min_build`, lisible sans compte comme `paywall_on`) ; une app plus ancienne affiche un écran « Mets à
// jour l'app » qui ne se ferme pas. Rien n'est perdu : les séances restent sur l'iPhone. 0 (valeur
// livrée) ou une lecture impossible : rien n'est affiché. Les builds publiées AVANT ce code ne le
// lisent pas : voir docs/PAYANT_V1.md, « Ordre de déploiement ».
const MIN_BUILD_KEY = 'mdlf_min_build';      // dernière valeur lue (hors ligne, elle vaut encore)
const UPDATE_URL    = TESTFLIGHT_URL;        // à remplacer par la page App Store à la sortie publique

function readMinBuild() {
  try { const v = Number(localStorage.getItem(MIN_BUILD_KEY)); return Number.isInteger(v) && v > 0 ? v : 0; } catch { return 0; }
}
async function loadMinBuild() {
  if (typeof sb === 'undefined' || !sb) return readMinBuild();
  try {
    const { data: row, error } = await sb.from('app_config').select('value').eq('key', 'min_build').maybeSingle();
    if (error) return readMinBuild();
    const v = Number.isInteger(row?.value) && row.value > 0 ? row.value : 0;
    try { localStorage.setItem(MIN_BUILD_KEY, String(v)); } catch { /* facultatif */ }
    return v;
  } catch { return readMinBuild(); }
}
async function checkMinBuild() {
  const build = await Native.appBuild();
  if (!build) return false;
  const min = await loadMinBuild();
  if (!min || build >= min || $('.min-build')) return false;
  const el = document.createElement('div');
  el.className = 'min-build';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'minBuildTitle');
  el.innerHTML = `<div class="min-build__box">
      <h1 class="min-build__title" id="minBuildTitle" tabindex="-1">Mets à jour l'app</h1>
      <p class="min-build__text">Cette version de MDLF Training est trop ancienne. Installe la dernière version pour continuer. Tes séances restent sur cet iPhone.</p>
      <button class="btn btn--primary min-build__btn" type="button">Mettre à jour</button>
    </div>`;
  el.querySelector('.min-build__btn').addEventListener('click', () => window.open(UPDATE_URL, '_blank'));
  document.body.appendChild(el);
  el.querySelector('#minBuildTitle')?.focus({ preventScroll: true });
  return true;
}
// Au démarrage, une fois le compte relu (le client Supabase existe alors), et au retour au premier plan
let minBuildChecked = false;
onAccountChange(() => { if (account.ready && !minBuildChecked) { minBuildChecked = true; checkMinBuild(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && account.ready) checkMinBuild(); });

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
