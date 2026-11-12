// ═══════════════════════════════════════════════════════════
//  Mises à jour à chaud du contenu web (app iOS uniquement)
// ═══════════════════════════════════════════════════════════
'use strict';

// Principe (voir IOS.md) : la CI publie à chaque version de main un paquet du contenu web (zip) et un
// manifeste { version, seq, runtime, url, checksum }. L'app le télécharge en arrière-plan et l'applique
// au prochain lancement. Le module natif revient seul à la version précédente si le nouveau contenu
// ne confirme pas son démarrage (Native.ota.ready) sous 10 s.
// Règle Apple 2.5.2 : réservé aux corrections ; une nouvelle fonctionnalité passe par l'App Store.

// Adresses figées : le manifeste vient toujours de cette adresse, et le paquet qu'il désigne doit
// être sous OTA_BUNDLE_PREFIX (audit du 12/11/2026, M1). Un manifeste qui pointerait ailleurs
// (autre domaine, autre chemin, http) est refusé, même avec une empreinte valide.
const OTA_MANIFEST_URL  = 'https://mdlf-ota.vercel.app/manifest.json';
const OTA_BUNDLE_PREFIX = 'https://mdlf-ota.vercel.app/bundles/';
const SHELL_RUNTIME_KEY = 'mdlf_shell_runtime';
const OTA_CHECK_EVERY   = 6 * 3_600_000;   // au retour au premier plan, au plus toutes les 6 h
const OTA_TIMEOUT       = 8_000;
// Installée après 5 min passées en arrière-plan : on rouvre l'app plus tard et on est à jour. Avant,
// seule la fermeture complète de l'app l'installait ; iOS ne ferme presque jamais une app en
// arrière-plan, donc la mise à jour attendait des jours (il fallait « Rechercher une mise à jour »).
const OTA_BACKGROUND_MS = 5 * 60_000;

// Conditions d'installation d'une mise à jour en file. Séance en cours : JAMAIS en arrière-plan (un
// long repos, un appel…), seulement si l'app est fermée puis rouverte, comme quand iOS la ferme de
// lui-même ; la séance, enregistrée à chaque série, est alors restaurée. Hors séance : après 5 min
// en arrière-plan. Rebasculées au début et à la fin de chaque séance (otaSessionChanged).
function otaDelayConditions(sessionActive) {
  return sessionActive ? [{ kind: 'kill' }] : [{ kind: 'background', value: String(OTA_BACKGROUND_MS) }];
}

let otaLastCheck = 0;
let otaBusy      = false;

// Contenu en place (window.MDLF_BUILD est généré par scripts/build-web.mjs ; absent dans la PWA)
function currentBuild() {
  return window.MDLF_BUILD || null;
}

// Adresse de paquet acceptée : préfixe exact, puis un seul nom de fichier « <version>.zip » fait de
// caractères sûrs. Le contrôle porte sur le texte brut, sans le décoder : « % » (encodages),
// « @ » (identifiants), « / » ou « \ » (autre dossier, « // »), « ? » et « # » sont refusés d'office,
// et un nom qui commence par « . » aussi (« .. »). Le nom de domaine est en minuscules dans le
// préfixe : « MDLF-OTA… » ou un port (« :443 ») ne passent pas non plus.
function otaBundleUrlAllowed(url) {
  if (typeof url !== 'string' || !url.startsWith(OTA_BUNDLE_PREFIX)) return false;
  return /^[0-9A-Za-z][0-9A-Za-z._-]*\.zip$/.test(url.slice(OTA_BUNDLE_PREFIX.length));
}

// Empreinte du paquet, sous l'une des deux formes publiées par scripts/ota-bundle.py :
//  - sans signature (builds sans publicKey) : SHA-256 en hexadécimal ;
//  - signée (builds avec publicKey Capgo, docs/BUILD.md) : SHA-256 chiffré par la clé privée (base64)
//    et clé de session « iv:clé » (base64). Le module natif vérifie la signature avec la clé publique
//    compilée dans l'app et refuse tout paquet sans clé de session valide.
const OTA_B64 = '[A-Za-z0-9+/]+={0,2}';
function otaChecksumValid(manifest) {
  if (manifest.sessionKey === undefined) return /^[0-9a-f]{64}$/.test(manifest.checksum || '');
  return new RegExp(`^${OTA_B64}$`).test(manifest.checksum || '')
    && new RegExp(`^${OTA_B64}:${OTA_B64}$`).test(manifest.sessionKey || '');
}

// Décision pure : faut-il télécharger ce manifeste ? Renvoie { download, reason }.
//   build        : contenu en place { version, seq, runtime }
//   shellRuntime : empreinte native de l'app installée
//   failed       : versions déjà tentées et en échec (jamais retentées)
function liveUpdateDecision(manifest, { build, shellRuntime, failed = [] }) {
  const no = reason => ({ download: false, reason });
  if (!build) return no('contenu sans informations de version');
  if (!manifest || typeof manifest.version !== 'string' || !Number.isFinite(manifest.seq)
      || !otaBundleUrlAllowed(manifest.url) || !otaChecksumValid(manifest)) {
    return no('manifeste invalide');
  }
  // Avant l'empreinte : une OTA plus ancienne que le contenu en place (faite pour une build
  // précédente) ne demande rien, l'app est à jour
  if (!(manifest.seq > build.seq)) return no('à jour');
  if (manifest.runtime !== shellRuntime) return no('nécessite une nouvelle version de l\'app');
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
      || await Native.ota.download({ url: manifest.url, version: manifest.version, checksum: manifest.checksum,
        sessionKey: manifest.sessionKey });
    if (!bundle?.id) return { status: 'error', reason: 'téléchargement impossible' };

    if (now && !activeSession && await Native.ota.applyNow(bundle.id)) return { status: 'applied', reason: manifest.version };
    return (await Native.ota.applyAtNextLaunch(bundle.id, otaDelayConditions(!!activeSession)))
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
  otaSessionChanged();   // séance restaurée au lancement : une mise à jour en file l'attend
  setTimeout(() => { checkLiveUpdate(); }, 3_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - otaLastCheck > OTA_CHECK_EVERY) checkLiveUpdate();
  });
}

// Début ou fin de séance : une mise à jour déjà en file change de conditions (jamais pendant une
// séance, après 5 min en arrière-plan sinon). Sans mise à jour en file, rien à faire.
async function otaSessionChanged() {
  if (!Native.isNative) return;
  if (!(await Native.ota.pending())) return;
  await Native.ota.setDelay(otaDelayConditions(!!activeSession));
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
