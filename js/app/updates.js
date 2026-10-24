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
