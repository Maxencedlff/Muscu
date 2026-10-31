// ═══════════════════════════════════════════════════════════
//  Accès payant (Payant V1) : lecture du droit d'accès, sans affichage
//
//  - Contrat serveur / app / Apple : docs/PAYANT_V1.md. Deux fonctions RPC seulement :
//    `my_access()` (crée la ligne `entitlements` au premier appel, sans rien donner) et
//    `access_state()` (lecture seule, ne crée rien). Aucune RPC n'écrit un droit : les écritures
//    viennent des fonctions Edge (`verify-purchase`, `appstore-notify`).
//  - MODÈLE B (28/10/2026) : l'essai gratuit de 3 mois est l'OFFRE DE LANCEMENT D'APPLE sur les deux
//    abonnements (Apple garantit un seul essai par identifiant Apple). Il n'y a plus d'essai maison :
//    sans abonnement, cadeau maison ni coach, pas de droit d'écrire quand le verrou est allumé. Un
//    abonné en essai est 'active' avec `intro_offer` et `intro_until` (lus dans la transaction signée).
//  - LE SERVEUR FAIT FOI. Tout ce qu'il renvoie est nettoyé ici (cleanAccess : liste blanche, bornes),
//    et l'écran (js/features/paywall-ui.js) échappe tout texte reçu.
//  - L'HORLOGE DE L'APPAREIL NE DÉCIDE JAMAIS. Le droit d'écrire est celui que le serveur a calculé à
//    `server_now` : il est gardé tel quel, jamais recalculé ici. Avancer ou reculer l'horloge de
//    l'iPhone ne débloque rien et ne bloque rien ; au pire cela périme le cache, ce qui déclenche une
//    nouvelle lecture (et, hors ligne, retire un droit d'écriture devenu invérifiable : voir plus bas).
//  - HORS LIGNE : le dernier état lu est gardé par compte (ACCESS_CACHE_KEY, verrouillé par `userId`)
//    et vaut 7 jours au plus après sa lecture (`server_now`), pour qu'une salle sans réseau ne bloque
//    personne. Au-delà, l'app ne se prolonge pas elle-même : un droit d'écriture périmé ne vaut plus
//    (on redemande au premier réseau), tandis qu'un refus reste un refus (seul le serveur le lève).
//    Les deux sens vont donc vers le plus strict : une horloge trafiquée ne peut rien ouvrir.
//  - LE VERROU EST LIVRÉ ÉTEINT. Tant que `paywall_on` est faux, `canWrite()` est TOUJOURS vrai, même
//    sans compte, sans réseau et sans état connu : rien ne doit bloquer.
//  - COMPTE OBLIGATOIRE QUAND LE VERROU EST ALLUMÉ (règle du 28/10/2026) : sans compte, l'app lit la
//    seule ligne `paywall_on` de `app_config` (lisible par anon, rien d'autre) ; allumé, démarrer ou
//    enregistrer une séance invite à se connecter (accessGate, js/features/paywall-ui.js). Verrou
//    éteint ou lu à faux, comptes indisponibles : rien ne bloque. Valeur INCONNUE (jamais lue sur
//    cette installation), une fois le verrou mis en service (PAYWALL_LAUNCHED) : ouverte 7 jours après
//    la première ouverture de l'app, date gardée dans le
//    Trousseau (elle survit à une réinstallation) ; ensuite une lecture réussie est nécessaire. Sans
//    cette borne, réinstaller l'app et bloquer le serveur suffirait à tout garder ouvert pour toujours.
//  - ACCÈS À VIE (payant plus, 31/10/2026) : achat unique non consommable (PLAN_LIFETIME_ID), vérifié
//    par le serveur comme un abonnement. `lifetime` dit d'où vient un accès à vie : 'purchase' (payé),
//    'gift' (offert par l'administrateur ou un code à vie), 'test' (achat Sandbox, 7 jours seulement) ;
//    `also_sub` : un abonnement PARTICULIER continue à côté (Apple ne le résilie pas tout seul). Un
//    palier coach n'y compte jamais : il donne le nombre d'élèves, l'accès à vie n'en donne aucun.
//  - TESTFLIGHT : l'environnement StoreKit de l'app (accessStoreEnvironment) est lu. Sous TestFlight
//    (Sandbox), AUCUN code d'offre élève n'est demandé : un code ne s'y utilise pas par la page d'Apple
//    (voir accessStudentOffer). Ailleurs, un code de Production.
//  - Résultats : { ok: true, data } ou { ok: false, kind }. L'écran s'abonne par onAccessChange.
// ═══════════════════════════════════════════════════════════
'use strict';

const ACCESS_CACHE_KEY   = 'mdlf_access';     // { userId, state } du dernier état lu (effacé à la déconnexion)
const ACCESS_ANON_KEY    = 'mdlf_paywall_anon'; // { on, at } : verrou lu sans compte (réglage public, pas une donnée)
const ACCESS_ANON_MS     = 10 * 60_000;       // sans compte : une relecture du verrou toutes les 10 min au plus
const ACCESS_UNKNOWN_MS  = 7 * 86400_000;     // sans compte : verrou jamais lu, ouvert 7 jours après la 1re ouverture
const ACCESS_FIRST_KEY   = 'mdlf_first_seen'; // première ouverture (ms), Trousseau puis localStorage
// Verrou mis en service (relecture du 28/10) : tant que c'est faux, un verrou JAMAIS lu ne ferme rien,
// même après 7 jours (« verrou éteint = rien ne bloque »). À passer à vrai dans la mise à jour à chaud
// qui accompagne l'allumage du verrou (docs/PAYANT_V1.md, « Ordre de déploiement »).
const PAYWALL_LAUNCHED   = false;
// Copie lue par accessUnknownExpired (les tests la basculent pour simuler le verrou mis en service)
const accessLaunch = { on: PAYWALL_LAUNCHED };
const ACCESS_CACHE_MS    = 7 * 86400_000;     // hors ligne : validité du dernier état lu
const ACCESS_SKEW_MS     = 5 * 60_000;        // tolérance d'horloge (l'appareil peut être un peu en retard)
const ACCESS_GRACE_MS    = 2 * 86400_000;     // abonné hors ligne : marge après la date de fin du serveur
const ACCESS_REFRESH_MS  = 30_000;            // retour au premier plan : une relecture toutes les 30 s au plus
const ACCESS_STATUSES    = ['none', 'active', 'expired', 'gift', 'coach_team'];
// Formules : catalogue dans js/data/plans.js (chargé avant), particulier puis paliers coach
const ACCESS_MONTHLY_ID  = planId('pro', 'month');
const ACCESS_YEARLY_ID   = planId('pro', 'year');
const ACCESS_PRODUCT_IDS = PLAN_SOLD_IDS;   // abonnements et accès à vie
const ACCESS_LIFETIME_ID = PLAN_LIFETIME_ID;
const ACCESS_LIFETIME_KINDS = ['purchase', 'gift', 'test'];
// Code cadeau maison : 10 à 24 caractères parmi les 32 symboles lisibles (sans 0, O, 1 ni I),
// même alphabet que la contrainte de gift_codes côté serveur
const ACCESS_GIFT_CODE_RE = /^[A-HJ-NP-Z2-9]{10,24}$/;

// state : dernier état lu pendant ce lancement ; cached : dernier état gardé sur l'appareil
const access = { userId: null, state: null, cached: null, loading: false, again: false, error: null, loadedAt: 0,
  products: null, missing: null, productsAt: 0, buying: null, verifying: false, syncing: false,
  canPay: true, refused: new Set(), currentProduct: null, studentOffer: null, storeEnv: null,
  // Sans compte : verrou lu dans app_config (true, false, ou null tant qu'il n'a jamais été lu)
  anon: readAnonPaywall(), anonAt: 0, anonLoading: false, firstSeen: null };
const accessListeners = [];
let accessSeq = 0;   // +1 à chaque changement de compte : une réponse arrivée après n'écrit plus rien

function onAccessChange(fn) { accessListeners.push(fn); }
function readAnonPaywall() {
  try { const v = JSON.parse(localStorage.getItem(ACCESS_ANON_KEY)); return typeof v?.on === 'boolean' ? v.on : null; }
  catch { return null; }
}
function notifyAccess() { for (const fn of accessListeners) { try { fn(); } catch { /* écran absent */ } } }

// ── Logique pure : nettoyage de ce que renvoie le serveur ───

const accessTime = v => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : null; };
const accessInt = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);

// my_access() / access_state() nettoyé, ou null si inutilisable :
// { status, until, paywall_on, days_left, can_write, gift, gift_until, coach_team, intro_offer,
//   intro_until, lifetime, also_sub, server_now }.
// Sans `server_now`, rien n'est gardé : l'app ne saurait pas quand cet état a été lu, et l'horloge de
// l'appareil ne sert jamais à le décider. `can_write` est forcé à vrai quand le verrou est éteint
// (même règle que le serveur : rien ne bloque tant que `paywall_on` est faux).
function cleanAccess(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!r) return null;
  const serverNow = accessTime(r.server_now);
  if (serverNow === null) return null;
  const paywallOn = r.paywall_on === true;
  return {
    status: ACCESS_STATUSES.includes(r.status) ? r.status : 'unknown',
    until: accessTime(r.until),
    paywall_on: paywallOn,
    days_left: accessInt(r.days_left, 3650),
    // Le droit vient du serveur, jamais recalculé ici ; verrou éteint = toujours vrai (même règle
    // que le serveur, reprise pour qu'une réponse abîmée ne bloque jamais personne)
    can_write: r.can_write === true || !paywallOn,
    gift: r.gift === true,
    gift_until: accessTime(r.gift_until),
    coach_team: r.coach_team === true,
    // Abonnement dans son offre de lancement (essai gratuit d'Apple) et fin de cette offre
    intro_offer: r.intro_offer === true && r.status === 'active',
    intro_until: r.intro_offer === true && r.status === 'active' ? accessTime(r.intro_until) : null,
    // Accès à vie : seulement sur un statut qui donne l'accès (jamais sur « expiré »)
    lifetime: ACCESS_LIFETIME_KINDS.includes(r.lifetime) && ['active', 'gift'].includes(r.status) ? r.lifetime : null,
    also_sub: r.also_sub === true && ['purchase', 'gift'].includes(r.lifetime),
    server_now: serverNow,
  };
}

// Âge du dernier état lu, mesuré depuis l'heure du SERVEUR (`server_now`). Une horloge en avance donne
// un âge trop grand, une horloge en retard un âge négatif : les deux périment le cache, jamais l'inverse.
function accessAge(st) { return st ? Date.now() - st.server_now : Infinity; }
// Horloge reculée : jamais de rallonge. Dans les 7 jours : la salle sans réseau ne bloque personne.
// Au-delà, un abonnement ou un cadeau garde sa valeur jusqu'à la date de fin DONNÉE PAR LE SERVEUR
// (plus deux jours, le temps qu'un renouvellement soit annoncé) : un abonné parti trois semaines sans
// réseau n'est pas coupé (l'essai gratuit d'Apple est un abonnement daté : même règle). Un accès sans
// date de fin (code à vie, élève d'un coach) garde les 7 jours : rien ne permettrait de borner sa
// validité autrement.
function accessCacheValid(st) {
  const age = accessAge(st);
  if (age < -ACCESS_SKEW_MS) return false;
  if (age <= ACCESS_CACHE_MS) return true;
  if (!['active', 'gift'].includes(st.status) || st.until === null) return false;
  return Date.now() <= st.until + ACCESS_GRACE_MS;
}

// État retenu pour décider : celui lu pendant ce lancement, sinon le dernier état de l'appareil.
// Cache périmé (plus de 7 jours, ou horloge reculée) : le droit d'écriture ne vaut plus (l'app ne se
// prolonge pas elle-même) mais le verrou gardé reste, pour qu'une horloge avancée n'ouvre rien.
// Renvoie null quand aucun état n'est connu : l'app ne bloque alors rien (voir canWrite).
function accessKnown() {
  if (access.state) return access.state;
  const c = access.cached;
  if (!c) return null;
  if (accessCacheValid(c)) return c;
  return { ...c, status: 'unknown', days_left: null, until: null, can_write: !c.paywall_on, stale: true };
}

// Le dernier état connu n'est plus sûr (jamais lu de ce lancement et cache périmé) : on redemande
function accessStale() {
  if (access.state) return false;
  return !access.cached || !accessCacheValid(access.cached);
}

// Compte obligatoire (règle 2) : pas de compte, comptes disponibles sur cet appareil, et verrou lu
// ALLUMÉ. Une valeur jamais lue (null) ne bloque pas : seule une réponse du serveur ferme.
// account.ready : au démarrage à froid, la session n'est pas encore relue (account.user vaut null
// un instant) ; sans cette condition un compte connecté verrait l'écran de connexion.
function accessSignInRequired() {
  return !account.user && account.ready && accountAvailable() && access.anon === true;
}

// Verrou mis en service (PAYWALL_LAUNCHED), jamais lu sur cette installation, et plus de 7 jours
// depuis la première ouverture : une lecture réussie est nécessaire (hors ligne depuis toujours, ou serveur bloqué exprès). Lu à faux une
// fois, jamais bloqué. Horloge de l'appareil reculée : reste ouvert (limite documentée).
function accessUnknownExpired() {
  return accessLaunch.on && !account.user && account.ready && accountAvailable() && access.anon === null
    && access.firstSeen !== null && Date.now() - access.firstSeen > ACCESS_UNKNOWN_MS;
}

// Première ouverture de l'app : Trousseau d'abord (survit à une réinstallation), sinon localStorage.
// Posée au premier lancement qui exécute ce code, jamais reculée par l'app.
async function accessLoadFirstSeen() {
  const valid = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  let at = null;
  try { at = valid(await Native.account?.storage?.getItem(ACCESS_FIRST_KEY)); } catch { at = null; }
  let local = null;
  try { local = valid(localStorage.getItem(ACCESS_FIRST_KEY)); } catch { local = null; }
  at = at ?? local ?? Date.now();
  try { await Native.account?.storage?.setItem(ACCESS_FIRST_KEY, String(at)); } catch { /* Trousseau absent */ }
  try { localStorage.setItem(ACCESS_FIRST_KEY, String(at)); } catch { /* facultatif */ }
  access.firstSeen = at;
  return at;
}

// Droit d'enregistrer une séance. Jamais bloqué : sans état connu ou verrou éteint ; sans compte,
// seulement quand le verrou est allumé (il faut alors un compte).
function canWrite() {
  if (!account.user) return !accessSignInRequired() && !accessUnknownExpired();
  const st = accessKnown();
  if (!st || !st.paywall_on) return true;
  return st.can_write === true;
}

// Verrou réellement allumé pour ce compte (dernier état connu) : l'écran n'affiche l'abonnement que là
function paywallOn() {
  if (!account.user) return false;
  return accessKnown()?.paywall_on === true;
}

// 'none' | 'active' | 'expired' | 'gift' | 'coach_team' | 'unknown' (rien de sûr : hors ligne trop longtemps)
function accessStatus() {
  const st = accessKnown();
  return st ? st.status : 'unknown';
}

// Fin de l'essai gratuit d'Apple (offre de lancement) d'après le serveur, ou null
function accessIntroUntil() {
  const st = accessKnown();
  return st && !st.stale && st.intro_offer ? st.intro_until : null;
}

// Accès à vie d'après le serveur : 'purchase' | 'gift' | 'test' | null (null aussi quand l'état n'est
// plus sûr : hors ligne trop longtemps)
function accessLifetime() {
  const st = accessKnown();
  return st && !st.stale ? st.lifetime : null;
}
// Un abonnement particulier tourne encore à côté d'un accès à vie : l'app invite à le résilier chez
// Apple (jamais un palier coach : le serveur ne le compte pas dans also_sub)
function accessAlsoSub() {
  const st = accessKnown();
  return !!(st && !st.stale && st.also_sub);
}

// Date de fin donnée par le serveur (fin de l'abonnement, essai d'Apple compris, ou du cadeau), ou null
function accessUntil() {
  const st = accessKnown();
  return st && !st.stale ? st.until : null;
}

// Erreur du serveur → clé de ACCESS_ERROR_TEXT
function accessErrorKind(error) {
  if (!error) return null;
  if (isNetworkError(error) || /fetch|network|load failed/i.test(String(error.message || ''))) return 'offline';
  const msg = String(error.message || error.error || '');
  for (const k of ACCESS_SERVER_ERRORS) if (msg.includes(k)) return k;
  return 'server';
}
// Refus nommés par le serveur (verify-purchase, appstore-notify, RPC) : tous traduits
const ACCESS_SERVER_ERRORS = ['invalid_jws', 'bad_bundle', 'bad_environment', 'bad_type', 'not_purchased',
  'transaction_taken', 'unknown_product', 'invalid_transaction', 'rate_limited', 'not_found'];
const ACCESS_ERROR_TEXT = {
  offline: 'Pas d\'Internet : réessaie avec du réseau.',
  invalid_jws: 'Cet achat n\'a pas pu être vérifié auprès d\'Apple.',
  bad_bundle: 'Cet achat vient d\'une autre app.',
  transaction_taken: 'Cet abonnement est déjà rattaché à un autre compte MDLF. Connecte-toi à ce compte pour le retrouver.',
  not_found: 'Apple ne retrouve pas cet achat. Réessaie dans un moment.',
  unknown_product: 'Cet achat ne correspond à aucune formule de l\'app.',
  bad_environment: 'Cet achat vient d\'un environnement de test que l\'app ne reconnaît pas.',
  bad_type: 'Ce type d\'achat n\'est pas reconnu par l\'app.',
  not_purchased: 'Cet achat n\'est pas rattaché à ton identifiant Apple. Le partage familial n\'est pas accepté.',
  invalid_transaction: 'Apple n\'a pas reconnu cette transaction.',
  blocked: 'Les achats sont bloqués sur cet iPhone. Regarde dans Réglages, Temps d\'écran.',
  retry: 'Apple ne répond pas pour l\'instant. Ton achat n\'est pas perdu, on réessaiera.',
  rate_limited: 'Trop d\'essais pour l\'instant. Réessaie dans une heure.',
  invalid_code: 'Ce code n\'existe pas. Vérifie les lettres et les chiffres.',
  code_expired: 'Ce code a expiré.',
  code_used_up: 'Ce code a déjà servi au maximum de fois prévu.',
  already_redeemed: 'Tu as déjà utilisé ce code.',
  cancelled: 'Achat annulé.',
  not_student: 'L\'offre élève est réservée aux élèves d\'un coach vérifié.',
  not_new: 'L\'offre élève est réservée à un premier abonnement. Choisis une formule ci-dessous.',
  no_code: 'Plus d\'offre élève disponible pour l\'instant. Réessaie dans quelques jours.',
  testflight: 'L\'offre élève n\'est pas disponible dans la version de test (TestFlight). Elle le sera dans l\'app de l\'App Store.',
  pending: 'Ton achat attend une autorisation. L\'accès arrivera dès qu\'Apple l\'aura validé.',
  no_products: 'Les formules ne sont pas encore proposées par Apple. Réessaie plus tard.',
  no_store: 'Les achats se font dans l\'app MDLF Training sur iPhone.',
  nothing: 'Aucun achat à restaurer sur cet identifiant Apple.',
  signed_out: 'Connecte-toi d\'abord à ton compte.',
  server: 'Action impossible pour l\'instant, réessaie dans un moment.',
};
function accessErrorText(kind) { return ACCESS_ERROR_TEXT[kind] || ACCESS_ERROR_TEXT.server; }

// ── État lu et caché ────────────────────────────────────────

function readAccessCache(userId) {
  try {
    const c = JSON.parse(localStorage.getItem(ACCESS_CACHE_KEY));
    return c && c.userId === userId ? cleanAccess(c.state) : null;
  } catch { return null; }
}
function writeAccessCache() {
  if (!access.userId || !access.state) return;
  try { localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify({ userId: access.userId, state: access.state })); }
  catch { /* cache facultatif */ }
}

function accessReset(userId) {
  accessSeq++;
  access.refused.clear();
  Object.assign(access, { userId, state: null, cached: userId ? readAccessCache(userId) : null,
    loading: false, again: false, error: null, loadedAt: 0, buying: null, verifying: false, studentOffer: null });
}

// ── Appels au serveur ───────────────────────────────────────

async function accessRpc(fn, args) {
  if (!sb || !account.user) return { ok: false, kind: 'signed_out' };
  const seq = accessSeq;
  try {
    const { data: res, error } = await sb.rpc(fn, args);
    if (seq !== accessSeq) return { ok: false, kind: 'signed_out' };
    return error ? { ok: false, kind: accessErrorKind(error) } : { ok: true, data: res };
  } catch (e) {
    return { ok: false, kind: accessErrorKind(e) || 'server' };
  }
}

// Relit le droit d'accès. `my_access()` tant qu'aucun état n'est connu pour ce compte (il crée la ligne
// du compte, sans rien donner), `access_state()` ensuite (lecture seule, ne crée rien).
// Renvoie true si l'état a pu être lu. Demandée pendant une lecture en cours : relancée à la fin.
async function accessRefresh({ minAge = 0, fn = null } = {}) {
  if (!sb || !account.user) return false;
  if (access.loading) { access.again = true; return false; }
  if (minAge && access.state && Date.now() - access.loadedAt < minAge) return true;
  access.loading = true;
  access.again = false;
  const seq = accessSeq;
  const call = fn || (!access.state && !access.cached ? 'my_access' : 'access_state');
  const r = await accessRpc(call);
  if (seq !== accessSeq) return false;
  let ok = false;
  const st = r.ok ? cleanAccess(r.data) : null;
  if (!st) {
    access.error = r.ok ? 'server' : r.kind;
    access.loading = false;
    // access_state() ne crée rien : un compte dont la ligne n'existe pas encore (jamais lue, ligne
    // effacée) est rattrapé une fois par my_access()
    if (r.ok && call !== 'my_access') return accessRefresh({ fn: 'my_access' });
    notifyAccess();
    if (access.again) { access.again = false; return accessRefresh(); }
    return false;
  }
  ok = true;
  access.loading = false;
  accessApplyState(st);
  if (access.again) { access.again = false; return accessRefresh(); }
  return ok;
}

// État tout juste lu (réponse de my_access, access_state ou redeem_gift_code) : gardé en mémoire et
// sur l'appareil. Renvoie false si la réponse était inutilisable.
function accessApplyState(raw) {
  const st = cleanAccess(raw);
  if (!st) return false;
  access.state = st;
  access.cached = st;
  access.error = null;
  access.loadedAt = Date.now();
  writeAccessCache();
  // Droit d'écrire retrouvé (abonnement pris, code utilisé, élève repris par un coach) : les séances
  // que le serveur avait refusées (paywall_locked) repartent tout de suite, rien n'a été perdu
  if (canWrite() && accountLockedCount()) { clearPaywallLock(); syncNow(); }
  notifyAccess();
  return true;
}

// Code cadeau maison, saisi DANS l'app (Réglages › Abonnement › « J'ai un code »). Saisie souple :
// majuscules, espaces et tirets ignorés. ATTENTION : le serveur ne lève PAS d'exception pour un refus
// de code (une exception annulerait le comptage des essais et permettrait de deviner des codes sans
// fin) : le refus est dans { ok: false, error }. On regarde donc ok et error, pas seulement l'erreur.
// Renvoie { ok: true, kind: 'lifetime' | 'days' } ou { ok: false, kind }.
function normalizeGiftCode(raw) {
  const c = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
  return ACCESS_GIFT_CODE_RE.test(c) ? c : null;
}
async function accessRedeemGiftCode(raw) {
  if (!sb || !account.user) return { ok: false, kind: 'signed_out' };
  const code = normalizeGiftCode(raw);
  if (!code) return { ok: false, kind: 'invalid_code' };
  const r = await accessRpc('redeem_gift_code', { code });
  if (!r.ok) return r;                       // rate_limited, not_found, hors ligne : vraies exceptions
  const d = r.data && typeof r.data === 'object' ? r.data : null;
  if (!d || d.ok !== true) {
    const err = String(d?.error || '');
    return { ok: false, kind: ACCESS_ERROR_TEXT[err] ? err : 'server' };
  }
  // La réponse porte déjà l'état à jour ; sinon on relit
  if (!accessApplyState(d.access)) await accessRefresh();
  return { ok: true, kind: d.kind === 'lifetime' ? 'lifetime' : 'days' };
}

// Avant de refuser une écriture : si l'état n'est plus sûr, on redemande une fois (hors ligne, rien
// ne change et le dernier état connu décide). Renvoie le droit d'écrire après cette tentative.
async function accessEnsure() {
  if (canWrite()) return true;
  // Sans compte : le verrou a peut-être été éteint depuis
  if (!account.user) { await accessAnonRefresh(); return canWrite(); }
  if (accessStale() || !access.state) await accessRefresh();
  return canWrite();
}

// ── Sans compte : le verrou (règle 2) ───────────────────────

// Lit la seule ligne paywall_on de app_config, lisible sans compte (politique RLS de
// 20261029000000_payant_modele_b.sql). Gardée sur l'appareil : hors ligne, la dernière valeur lue vaut.
// Une erreur ne change rien (la dernière valeur, ou rien de bloqué si jamais lue).
async function accessAnonRefresh({ minAge = 0 } = {}) {
  if (!sb || account.user || !accountAvailable() || access.anonLoading) return access.anon;
  if (minAge && access.anonAt && Date.now() - access.anonAt < minAge) return access.anon;
  access.anonLoading = true;
  try {
    const { data: row, error } = await sb.from('app_config').select('value').eq('key', 'paywall_on').maybeSingle();
    if (error || account.user) return access.anon;
    const on = row?.value === true;
    access.anonAt = Date.now();
    if (on !== access.anon) {
      access.anon = on;
      try { localStorage.setItem(ACCESS_ANON_KEY, JSON.stringify({ on, at: Date.now() })); } catch { /* facultatif */ }
      notifyAccess();
    }
    return on;
  } catch { return access.anon; }
  finally { access.anonLoading = false; }
}

// Transaction signée par Apple (JWS) envoyée à la fonction Edge verify-purchase : c'est elle qui
// vérifie la signature, relit la transaction auprès d'Apple et écrit `entitlements`. L'app ne décide
// rien. La transaction n'est terminée chez Apple (Native.store.finish) QU'APRÈS l'accord du serveur,
// ou sur un refus définitif (JWS illisible, autre app, produit inconnu) : sans cela, Apple la réannoncerait à chaque
// lancement. Un refus qui peut encore changer (transaction prise par un autre compte, inconnue
// d'Apple pour l'instant) laisse la transaction ouverte : elle reviendra.
// Renvoie { ok: true } (état relu) ou { ok: false, kind }.
// unknown_product : produit qui n'est plus des nôtres (l'ancien « Accès offert » d'Apple, supprimé
// le 28/10) ; terminé aussi, sinon StoreKit le réannoncerait à chaque lancement
const ACCESS_FINAL_REFUSALS = ['invalid_jws', 'bad_bundle', 'unknown_product'];
async function accessVerifyPurchase(jws, transactionId = null) {
  if (!sb || !account.user) return { ok: false, kind: 'signed_out' };
  if (typeof jws !== 'string' || !jws) return { ok: false, kind: 'invalid_jws' };
  // Déjà refusée pour ce compte (rattachée à un autre) : inutile de redemander à Apple
  if (transactionId != null && access.refused.has(String(transactionId))) return { ok: false, kind: 'transaction_taken' };
  access.verifying = true;
  notifyAccess();
  try {
    const { data: res, error } = await sb.functions.invoke('verify-purchase', { body: { jws } });
    if (error) {
      // Réponse d'erreur de la fonction : error.context est la réponse HTTP (FunctionsHttpError)
      let info = {};
      try { info = await error.context.json(); } catch { /* corps illisible */ }
      // 503 : Apple injoignable. Ce n'est pas un refus : la transaction n'est SURTOUT pas terminée,
      // elle reviendra par Transaction.updates au prochain lancement.
      const status = error.context?.status;
      const kind = ACCESS_SERVER_ERRORS.includes(info?.error) ? info.error
        : status === 429 ? 'rate_limited'
          : status >= 500 ? 'retry' : accessErrorKind(error);
      if (ACCESS_FINAL_REFUSALS.includes(kind)) await Native.store.finish(transactionId);
      // Transaction rattachée à un autre compte : gardée OUVERTE chez Apple (elle redeviendra utile
      // si la personne se connecte au bon compte), mais plus réenvoyée tant qu'on reste sur ce
      // compte : sans cela, chaque lancement rejouerait la vérification et mangerait le quota.
      if (kind === 'transaction_taken' && transactionId != null) access.refused.add(String(transactionId));
      return { ok: false, kind };
    }
    if (res?.ok === false) return { ok: false, kind: ACCESS_ERROR_TEXT[res.error] ? res.error : 'server' };
    // Le serveur a écrit le droit : la transaction peut être terminée chez Apple
    await Native.store.finish(transactionId);
    // La réponse porte l'état à jour ({ ok: true, access }) ; sinon on relit
    if (!accessApplyState(res?.access)) await accessRefresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, kind: accessErrorKind(e) || 'server' };
  } finally {
    access.verifying = false;
    notifyAccess();
  }
}

// ── Achats (StoreKit 2, par le module natif) ────────────────

// Formules proposées : prix LUS CHEZ STOREKIT (localisés par Apple), jamais écrits en dur. Le module
// rend `displayPrice` (chaîne déjà formatée dans la monnaie de la boutique) et `displayName` ; `price`
// est un nombre, inutilisable tel quel à l'écran. Hors app iOS, ou module absent : liste vide
// (l'écran invite à utiliser l'app). Les identifiants inconnus sont écartés. `canMakePayments` : faux
// quand les achats sont bloqués (Temps d'écran).
// Offre de lancement (essai gratuit de 3 mois, géré par Apple) : `trial` = { unit, value } quand
// StoreKit dit que la personne y a droit (introEligible) et que l'offre est gratuite (freeTrial) ;
// null sinon (déjà utilisée sur cet identifiant Apple, ou pas d'offre) : l'écran montre le prix normal.
const ACCESS_UNITS = ['day', 'week', 'month', 'year'];
function accessTrialOf(p) {
  const o = p?.offer;
  if (p?.introEligible !== true || !o || o.paymentMode !== 'freeTrial') return null;
  const unit = ACCESS_UNITS.includes(o.period?.unit) ? o.period.unit : null;
  const n = (Number.isInteger(o.period?.value) ? o.period.value : 0) * (Number.isInteger(o.periodCount) && o.periodCount > 0 ? o.periodCount : 1);
  return unit && n > 0 && n <= 366 ? { unit, value: n } : null;
}
async function accessLoadProducts({ force = false } = {}) {
  if (!Native.store.available) { access.products = []; access.missing = []; return []; }
  if (access.products?.length && !force) return access.products;
  const raw = await Native.store.products();
  const list = (Array.isArray(raw?.products) ? raw.products : [])
    .filter(p => p && ACCESS_PRODUCT_IDS.includes(p.id) && typeof p.displayPrice === 'string' && p.displayPrice.trim())
    .map(p => ({ id: p.id, price: p.displayPrice.trim().slice(0, 24),
      label: typeof p.displayName === 'string' ? p.displayName.slice(0, 60) : '',
      period: planOf(p.id).period,
      // Nombre (pour « soit 8,5 mois ») et devise (prix de l'offre élève) : jamais affichés tels quels
      amount: typeof p.price === 'number' && Number.isFinite(p.price) ? p.price : null,
      currency: typeof p.currency === 'string' ? p.currency.slice(0, 3) : null,
      trial: accessTrialOf(p) }))
    .sort((a, b) => ACCESS_PRODUCT_IDS.indexOf(a.id) - ACCESS_PRODUCT_IDS.indexOf(b.id));
  if (typeof raw?.canMakePayments === 'boolean') access.canPay = raw.canMakePayments;
  access.products = list;
  // Identifiants qu'Apple ne connaît pas encore (contrat Paid Apps pas signé, produit en attente) :
  // l'écran le dit au lieu d'afficher une liste vide sans explication
  access.missing = (Array.isArray(raw?.missing) ? raw.missing : []).filter(id => ACCESS_PRODUCT_IDS.includes(id));
  access.productsAt = Date.now();
  notifyAccess();
  return list;
}

// Achat d'une formule : StoreKit rend le JWS de la transaction, que le serveur vérifie.
// Renvoie { ok: true }, { ok: false, reason: 'cancel' } ou { ok: false, kind }.
async function accessBuy(productId) {
  if (!account.user) return { ok: false, kind: 'signed_out' };
  if (!Native.store.available) return { ok: false, kind: 'no_store' };
  if (!ACCESS_PRODUCT_IDS.includes(productId)) return { ok: false, kind: 'server' };
  access.buying = productId;
  notifyAccess();
  try {
    // purchase() ne rejette jamais : il résout 'success', 'userCancelled' ou 'pending'.
    // appAccountToken : l'identifiant du compte MDLF part avec l'achat, et revient dans la
    // transaction et dans les notifications d'Apple. Sans lui, un achat dont la vérification échoue
    // (réseau coupé juste après le paiement) serait orphelin : le serveur ne saurait pas à qui le
    // rattacher. L'identifiant Supabase est un UUID, c'est ce qu'Apple attend.
    const r = await Native.store.purchase(productId, account.user.id);
    if (r?.status === 'userCancelled') return { ok: false, reason: 'cancel' };
    if (r?.status === 'pending') return { ok: false, kind: 'pending' };
    if (r?.status !== 'success' || !r?.jws) return { ok: false, kind: 'server' };
    return await accessVerifyPurchase(r.jws, r.transactionId);
  } finally {
    access.buying = null;
    notifyAccess();
  }
}

// Droits en cours rendus par le module : [{ jws, transactionId, productId, … }]. Le JWS est dans
// CHAQUE droit, jamais à la racine.
function accessEntitlementsOf(r) {
  const list = Array.isArray(r?.entitlements) ? r.entitlements : [];
  return list.filter(e => e && typeof e.jws === 'string' && e.jws);
}

// Envoie chaque droit au serveur. Un seul accepté suffit ; Apple injoignable arrête la série (les
// suivants échoueraient pareil et consommeraient le quota d'appels).
async function accessSendEntitlements(list) {
  let ok = false, first = null;
  for (const e of list) {
    const r = await accessVerifyPurchase(e.jws, e.transactionId);
    if (r.ok) { ok = true; continue; }
    first ||= r;
    if (r.kind === 'retry') break;
  }
  return ok ? { ok: true } : (first || { ok: false, kind: 'nothing' });
}

// « Restaurer mes achats » : AppStore.sync() (qui demande le mot de passe Apple) puis les droits en
// cours. Renvoie { ok: true }, { ok: false, kind: 'nothing' } (rien sur cet identifiant Apple),
// { ok: false, reason: 'cancel' } (fenêtre d'Apple fermée et rien à restaurer) ou { ok: false, kind }.
async function accessRestore() {
  if (!account.user) return { ok: false, kind: 'signed_out' };
  if (!Native.store.available) return { ok: false, kind: 'no_store' };
  const r = await Native.store.restore();
  if (!r) return { ok: false, kind: 'server' };
  const list = accessEntitlementsOf(r);
  if (list.length) return await accessSendEntitlements(list);
  // Rien chez Apple : l'état du serveur peut quand même avoir changé (notification Apple reçue)
  await accessRefresh();
  if (canWrite() && paywallOn()) return { ok: true };
  return r.cancelled ? { ok: false, reason: 'cancel' } : { ok: false, kind: 'nothing' };
}

// Droits déjà chez Apple mais que le serveur ne connaît pas encore : achat dont la vérification a
// échoué (réseau coupé), app réinstallée, nouvel iPhone restauré. Lu au lancement SANS rien demander
// à l'utilisateur (Transaction.currentEntitlements, aucun mot de passe), seulement quand le verrou
// est allumé et qu'on n'a pas le droit d'écrire : sinon il n'y a rien à rattraper.
async function accessSyncCurrent() {
  if (!Native.store.available || !account.user) return false;
  if (!paywallOn() || canWrite() || access.syncing) return false;
  access.syncing = true;
  try {
    const list = accessEntitlementsOf(await Native.store.current());
    if (!list.length) return false;
    return (await accessSendEntitlements(list)).ok;
  } finally { access.syncing = false; }
}

// Lancement et retour du réseau : on relit l'état, puis on rattrape ce qu'Apple connaît déjà
async function accessBoot() {
  const ok = await accessRefresh();
  await accessSyncCurrent();
  return ok;
}

// « J'ai un code » : feuille de codes d'Apple. Attention, elle n'accepte que les codes d'offre
// d'ABONNEMENT (par exemple un an gratuit). Le code utilisé arrive par
// Transaction.updates (accessOnTransaction), jamais par cette fonction : elle ouvre juste la feuille.
async function accessRedeemCode() {
  if (!account.user) return { ok: false, kind: 'signed_out' };
  if (!Native.store.available) return { ok: false, kind: 'no_store' };
  const r = await Native.store.redeemCode();
  if (r?.presented === true) return { ok: true };
  // Feuille fermée par l'utilisateur : rien à dire, surtout pas une erreur
  return r?.cancelled ? { ok: false, reason: 'cancel' } : { ok: false, kind: 'server' };
}

// Offre élève (−25 % pendant 12 mois, sans essai) : un CODE D'OFFRE d'Apple à usage unique, distribué
// par le serveur à un élève lié à un coach validé et jamais abonné (student_offer_code). Un refus n'est
// pas une exception : { ok: false, error: 'not_student' | 'not_new' | 'no_code' }. Le même code revient
// tant qu'il n'a pas expiré. L'app ouvre ensuite la page d'Apple, code déjà rempli (planRedeemUrl) ;
// la transaction revient par l'écouteur permanent, comme tout achat.
// Environnement : celui de StoreKit (accessStoreEnvironment). Sous TestFlight (Sandbox), RIEN n'est
// demandé au serveur : { ok: false, kind: 'testflight' }. D'après Apple, un code d'offre Sandbox ne
// s'utilise que dans les réglages du compte Sandbox de l'iPhone (iOS 16.3+), pas par la page
// apps.apple.com/redeem (codes de Production seulement), et un testeur TestFlight a son vrai
// identifiant Apple, pas un compte Sandbox. Demander un code userait pour rien un des 3 codes à vie de
// l'élève (student_offer_code). Non résolu : à revoir après un essai sur un vrai iPhone TestFlight
// (docs/PAYANT_V1.md). Partout ailleurs (App Store, navigateur, réponse inconnue) : code de Production.
// Renvoie { ok: true, code, expiresAt } ou { ok: false, kind }. access.studentOffer garde la réponse.
const ACCESS_STUDENT_ERRORS = ['not_student', 'not_new', 'no_code'];
async function accessStudentOffer() {
  if (await accessStoreEnvironment() === 'sandbox') return { ok: false, kind: 'testflight' };
  const r = await accessRpc('student_offer_code', { env: 'Production' });
  if (!r.ok) return r;
  const d = r.data && typeof r.data === 'object' ? r.data : {};
  if (d.ok !== true) {
    const kind = ACCESS_STUDENT_ERRORS.includes(d.error) ? d.error : 'server';
    access.studentOffer = { error: kind };
    notifyAccess();
    return { ok: false, kind };
  }
  const code = typeof d.code === 'string' && /^[A-Z0-9]{6,64}$/.test(d.code) ? d.code : null;
  if (!code) return { ok: false, kind: 'server' };
  access.studentOffer = { code, expiresAt: accessTime(d.expires_at) };
  notifyAccess();
  return { ok: true, code, expiresAt: access.studentOffer.expiresAt };
}

// Environnement StoreKit de l'app, lu une fois par lancement : 'production', 'sandbox' (TestFlight),
// 'other', 'unknown', ou null (navigateur, ancienne coquille). Faute de réponse : Production.
async function accessStoreEnvironment() {
  if (access.storeEnv) return access.storeEnv;
  const v = await Native.store.environment?.();
  access.storeEnv = ['production', 'sandbox', 'other'].includes(v) ? v : null;
  return access.storeEnv;
}

// Formule de l'abonnement en cours sur cet iPhone (pour « Essai gratuit jusqu'au …, puis <prix> ») :
// lue dans les droits en cours de StoreKit, sans rien demander, et les prix chez StoreKit. Aucune
// décision n'en dépend : c'est du texte.
async function accessLoadCurrentPlan() {
  if (!Native.store.available || !account.user) return null;
  const list = accessEntitlementsOf(await Native.store.current());
  // L'abonnement d'abord : c'est lui dont on affiche le prix après l'essai (l'accès à vie n'en a pas)
  const sub = list.find(e => PLAN_IDS.includes(e.productId)) || list.find(e => e.productId === ACCESS_LIFETIME_ID);
  access.currentProduct = sub ? sub.productId : null;
  if (sub && !access.products?.length) await accessLoadProducts();
  notifyAccess();
  return access.currentProduct;
}

// Achats possibles sur cet iPhone ? Faux quand ils sont bloqués (Temps d'écran, profil de gestion) :
// l'écran ne doit alors proposer aucun bouton d'achat. Lu sans aucun appel réseau.
async function accessLoadStoreStatus() {
  if (!Native.store.available) { access.canPay = false; return false; }
  const r = await Native.store.status();
  if (typeof r?.canMakePayments === 'boolean') access.canPay = r.canMakePayments;
  notifyAccess();
  return access.canPay;
}

// Écouteur permanent des transactions (renouvellement, code utilisé, achat sur un autre appareil) :
// chaque JWS part au serveur, qui écrit le droit ; l'état est relu ensuite.
function accessOnTransaction() {
  Native.store.onTransaction(async ({ jws, transactionId } = {}) => {
    if (!jws || !account.user) return;
    await accessVerifyPurchase(jws, transactionId);
  });
}

// ── Déclencheurs : connexion, premier plan, réseau revenu ───

onAccountChange(() => {
  const id = account.user?.id || null;
  // Sans compte (lancement, déconnexion) : le verrou est lu pour savoir s'il faut un compte
  if (!id && account.ready) accessAnonRefresh({ minAge: ACCESS_ANON_MS });
  if (id === access.userId) return;
  accessReset(id);
  notifyAccess();
  if (id) accessBoot();
});
document.addEventListener?.('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (account.user) accessRefresh({ minAge: ACCESS_REFRESH_MS });
  else if (account.ready) accessAnonRefresh({ minAge: ACCESS_ANON_MS });
});
window.addEventListener?.('online', () => {
  if (account.user && (access.error === 'offline' || accessStale())) accessBoot();
  else if (!account.user) accessAnonRefresh();
});
// Première ouverture de l'app, pour borner un verrou jamais lu (accessUnknownExpired)
accessLoadFirstSeen();
