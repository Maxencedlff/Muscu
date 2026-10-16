// ═══════════════════════════════════════════════════════════
//  Mises à jour à chaud du contenu web (app iOS uniquement)
// ═══════════════════════════════════════════════════════════
'use strict';

// Principe (voir IOS.md) : la CI publie à chaque version de main un paquet du contenu web (zip) et un
// manifeste { version, seq, runtime, url, checksum }. L'app le télécharge en arrière-plan et l'applique
// au prochain lancement. Le module natif revient seul à la version précédente si le nouveau contenu
// ne confirme pas son démarrage (Native.ota.ready) sous 10 s.
// Règle Apple 2.5.2 : réservé aux corrections ; une nouvelle fonctionnalité passe par l'App Store.

const OTA_MANIFEST_URL  = 'https://mdlf-ota.vercel.app/manifest.json';
const SHELL_RUNTIME_KEY = 'mdlf_shell_runtime';
const OTA_CHECK_EVERY   = 6 * 3_600_000;   // au retour au premier plan, au plus toutes les 6 h
const OTA_TIMEOUT       = 8_000;

let otaLastCheck = 0;
let otaBusy      = false;

// Contenu en place (window.MDLF_BUILD est généré par scripts/build-web.mjs ; absent dans la PWA)
function currentBuild() {
  return window.MDLF_BUILD || null;
}

// Décision pure : faut-il télécharger ce manifeste ? Renvoie { download, reason }.
//   build        : contenu en place { version, seq, runtime }
//   shellRuntime : empreinte native de l'app installée
//   failed       : versions déjà tentées et en échec (jamais retentées)
function liveUpdateDecision(manifest, { build, shellRuntime, failed = [] }) {
  const no = reason => ({ download: false, reason });
  if (!build) return no('contenu sans informations de version');
  if (!manifest || typeof manifest.version !== 'string' || !Number.isFinite(manifest.seq)
      || !/^https:\/\//.test(manifest.url || '') || !/^[0-9a-f]{64}$/.test(manifest.checksum || '')) {
    return no('manifeste invalide');
  }
  if (manifest.runtime !== shellRuntime) return no('nécessite une nouvelle version de l\'app');
  if (!(manifest.seq > build.seq)) return no('à jour');
  if (failed.includes(manifest.version)) return no('version déjà en échec');
  return { download: true, reason: 'nouvelle version ' + manifest.version };
}

// Empreinte native de l'app installée : connue avec certitude quand le contenu d'origine tourne
async function shellRuntime() {
  const build = currentBuild();
  const cur = await Native.ota.current();
  if (build && cur?.bundle?.id === 'builtin') {
    try { localStorage.setItem(SHELL_RUNTIME_KEY, build.runtime); } catch {}
    return build.runtime;
  }
  try { return localStorage.getItem(SHELL_RUNTIME_KEY) || build?.runtime || null; } catch { return build?.runtime || null; }
}

async function fetchManifest() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OTA_TIMEOUT);
  try {
    const res = await fetch(OTA_MANIFEST_URL, { cache: 'no-store', signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// Vérifie, télécharge et programme la mise à jour.
//   now = true (bouton des Réglages) : appliquée tout de suite si aucune séance n'est en cours.
// Renvoie { status: 'none' | 'ready' | 'applied' | 'error', reason }
async function checkLiveUpdate({ now = false } = {}) {
  if (!Native.isNative || otaBusy) return { status: 'none', reason: 'indisponible' };
  otaBusy = true;
  otaLastCheck = Date.now();
  try {
    const manifest = await fetchManifest();
    if (!manifest) return { status: 'error', reason: 'serveur de mise à jour injoignable' };
    const bundles = await Native.ota.list();
    const decision = liveUpdateDecision(manifest, {
      build: currentBuild(),
      shellRuntime: await shellRuntime(),
      failed: bundles.filter(b => b.status === 'error').map(b => b.version),
    });
    if (!decision.download) return { status: 'none', reason: decision.reason };

    const bundle = bundles.find(b => b.version === manifest.version && b.status === 'success')
      || await Native.ota.download({ url: manifest.url, version: manifest.version, checksum: manifest.checksum });
    if (!bundle?.id) return { status: 'error', reason: 'téléchargement impossible' };

    if (now && !activeSession && await Native.ota.applyNow(bundle.id)) return { status: 'applied', reason: manifest.version };
    return (await Native.ota.applyAtNextLaunch(bundle.id))
      ? { status: 'ready', reason: manifest.version }
      : { status: 'error', reason: 'mise à jour non programmée' };
  } finally {
    otaBusy = false;
  }
}

// Démarrage de l'app iOS : confirme le contenu en place, puis vérifie sans bloquer l'affichage
function liveUpdateBoot() {
  if (!Native.isNative) return;
  Native.ota.ready();
  setTimeout(() => { checkLiveUpdate(); }, 3_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - otaLastCheck > OTA_CHECK_EVERY) checkLiveUpdate();
  });
}

function liveUpdateLabel() {
  const b = currentBuild();
  return b ? `Contenu ${b.version}` : '';
}

registerActions({
  'live-update-check': async () => {
    if (activeSession) { showToast('Termine ta séance avant de mettre à jour'); return; }
    showToast('Recherche d\'une mise à jour…');
    const r = await checkLiveUpdate({ now: true });
    if (r.status === 'none') showToast(r.reason === 'à jour' ? 'Tu as la dernière version' : `Pas de mise à jour : ${r.reason}`);
    else if (r.status === 'ready') showToast('Mise à jour prête, appliquée au prochain lancement');
    else if (r.status === 'error') showToast(`Mise à jour impossible : ${r.reason}`, { error: true });
    // 'applied' : l'app se recharge sur le nouveau contenu
  },
});
