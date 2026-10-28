// ═══════════════════════════════════════════════════════════
//  Accès payant (Payant V1) : lecture du droit d'accès, sans affichage
//
//  - Contrat serveur / app / Apple : docs/PAYANT_V1.md. Deux fonctions RPC seulement :
//    `my_access()` (crée la ligne `entitlements` en `trial` au premier appel : c'est le serveur qui
//    démarre l'essai) et `access_state()` (lecture seule, ne crée rien). Aucune RPC n'écrit un droit :
//    les écritures viennent des fonctions Edge (`verify-purchase`, `appstore-notify`).
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
//  - Résultats : { ok: true, data } ou { ok: false, kind }. L'écran s'abonne par onAccessChange.
// ═══════════════════════════════════════════════════════════
'use strict';

const ACCESS_CACHE_KEY   = 'mdlf_access';     // { userId, state } du dernier état lu (effacé à la déconnexion)
const ACCESS_CACHE_MS    = 7 * 86400_000;     // hors ligne : validité du dernier état lu
const ACCESS_SKEW_MS     = 5 * 60_000;        // tolérance d'horloge (l'appareil peut être un peu en retard)
const ACCESS_REFRESH_MS  = 30_000;            // retour au premier plan : une relecture toutes les 30 s au plus
const ACCESS_STATUSES    = ['trial', 'active', 'expired', 'gift', 'coach_team'];
const ACCESS_MONTHLY_ID  = 'com.mdlf.training.pro.monthly';
const ACCESS_YEARLY_ID   = 'com.mdlf.training.pro.yearly';
const ACCESS_GIFT_ID     = 'com.mdlf.training.access.gift';   // jamais vendu : codes seulement
const ACCESS_PRODUCT_IDS = [ACCESS_MONTHLY_ID, ACCESS_YEARLY_ID];
// Code cadeau maison : 10 à 24 caractères parmi les 32 symboles lisibles (sans 0, O, 1 ni I),
// même alphabet que la contrainte de gift_codes côté serveur
const ACCESS_GIFT_CODE_RE = /^[A-HJ-NP-Z2-9]{10,24}$/;

// state : dernier état lu pendant ce lancement ; cached : dernier état gardé sur l'appareil
const access = { userId: null, state: null, cached: null, loading: false, again: false, error: null, loadedAt: 0,
  products: null, missing: null, productsAt: 0, buying: null, verifying: false };
const accessListeners = [];
let accessSeq = 0;   // +1 à chaque changement de compte : une réponse arrivée après n'écrit plus rien

function onAccessChange(fn) { accessListeners.push(fn); }
function notifyAccess() { for (const fn of accessListeners) { try { fn(); } catch { /* écran absent */ } } }

// ── Logique pure : nettoyage de ce que renvoie le serveur ───

const accessTime = v => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : null; };
const accessInt = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);

// my_access() / access_state() nettoyé, ou null si inutilisable :
// { status, until, paywall_on, trial_days, days_left, can_write, gift, coach_team, server_now }.
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
    trial_days: accessInt(r.trial_days, 3650) ?? 90,
    days_left: accessInt(r.days_left, 3650),
    // Le droit vient du serveur, jamais recalculé ici ; verrou éteint = toujours vrai (même règle
    // que le serveur, reprise pour qu'une réponse abîmée ne bloque jamais personne)
    can_write: r.can_write === true || !paywallOn,
    gift: r.gift === true,
    gift_until: accessTime(r.gift_until),
    coach_team: r.coach_team === true,
    server_now: serverNow,
  };
}

// Âge du dernier état lu, mesuré depuis l'heure du SERVEUR (`server_now`). Une horloge en avance donne
// un âge trop grand, une horloge en retard un âge négatif : les deux périment le cache, jamais l'inverse.
function accessAge(st) { return st ? Date.now() - st.server_now : Infinity; }
function accessCacheValid(st) {
  const age = accessAge(st);
  return age >= -ACCESS_SKEW_MS && age <= ACCESS_CACHE_MS;
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

// Droit d'enregistrer une séance. Jamais bloqué : sans compte, sans état connu, ou verrou éteint.
function canWrite() {
  if (!account.user) return true;
  const st = accessKnown();
  if (!st || !st.paywall_on) return true;
  return st.can_write === true;
}

// Verrou réellement allumé pour ce compte (dernier état connu) : l'écran n'affiche l'abonnement que là
function paywallOn() {
  if (!account.user) return false;
  return accessKnown()?.paywall_on === true;
}

// 'trial' | 'active' | 'expired' | 'gift' | 'coach_team' | 'unknown' (rien de sûr : hors ligne trop longtemps)
function accessStatus() {
  const st = accessKnown();
  return st ? st.status : 'unknown';
}

// Jours restants de l'essai d'après le SERVEUR (jamais recalculés depuis l'horloge de l'appareil) ;
// null hors essai, ou quand l'état n'est plus sûr
function daysLeft() {
  const st = accessKnown();
  return st && st.status === 'trial' ? st.days_left : null;
}

// Date de fin donnée par le serveur (fin d'essai ou fin d'abonnement), ou null
function accessUntil() {
  const st = accessKnown();
  return st && !st.stale ? st.until : null;
}

// Erreur du serveur → clé de ACCESS_ERROR_TEXT
function accessErrorKind(error) {
  if (!error) return null;
  if (isNetworkError(error) || /fetch|network|load failed/i.test(String(error.message || ''))) return 'offline';
  const msg = String(error.message || error.error || '');
  for (const k of ['invalid_jws', 'bad_bundle', 'transaction_taken', 'unknown_product', 'rate_limited', 'not_found']) if (msg.includes(k)) return k;
  return 'server';
}
const ACCESS_ERROR_TEXT = {
  offline: 'Pas d\'Internet : réessaie avec du réseau.',
  invalid_jws: 'Cet achat n\'a pas pu être vérifié auprès d\'Apple.',
  bad_bundle: 'Cet achat vient d\'une autre app.',
  transaction_taken: 'Cet abonnement est déjà utilisé par un autre compte MDLF.',
  not_found: 'Apple ne retrouve pas cet achat. Réessaie dans un moment.',
  unknown_product: 'Cet achat ne correspond à aucune formule de l\'app.',
  retry: 'Apple ne répond pas pour l\'instant. Ton achat n\'est pas perdu, on réessaiera.',
  rate_limited: 'Trop d\'essais pour l\'instant. Réessaie dans une heure.',
  invalid_code: 'Ce code n\'existe pas. Vérifie les lettres et les chiffres.',
  code_expired: 'Ce code a expiré.',
  code_used_up: 'Ce code a déjà servi au maximum de fois prévu.',
  already_redeemed: 'Tu as déjà utilisé ce code.',
  cancelled: 'Achat annulé.',
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
  Object.assign(access, { userId, state: null, cached: userId ? readAccessCache(userId) : null,
    loading: false, again: false, error: null, loadedAt: 0, buying: null, verifying: false });
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

// Relit le droit d'accès. `my_access()` tant qu'aucun état n'est connu pour ce compte (c'est lui qui
// démarre l'essai, à l'heure du serveur), `access_state()` ensuite (lecture seule, ne crée rien).
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
    // access_state() ne crée rien : un compte dont la ligne n'existe pas encore (essai jamais
    // démarré, ligne effacée) est rattrapé une fois par my_access()
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
  if (accessStale() || !access.state) await accessRefresh();
  return canWrite();
}

// Transaction signée par Apple (JWS) envoyée à la fonction Edge verify-purchase : c'est elle qui
// vérifie la signature, relit la transaction auprès d'Apple et écrit `entitlements`. L'app ne décide
// rien. La transaction n'est terminée chez Apple (Native.store.finish) QU'APRÈS l'accord du serveur,
// ou sur un refus définitif (JWS illisible, autre app) : sans cela, Apple la réannoncerait à chaque
// lancement. Un refus qui peut encore changer (transaction prise par un autre compte, inconnue
// d'Apple pour l'instant) laisse la transaction ouverte : elle reviendra.
// Renvoie { ok: true } (état relu) ou { ok: false, kind }.
const ACCESS_FINAL_REFUSALS = ['invalid_jws', 'bad_bundle'];
async function accessVerifyPurchase(jws, transactionId = null) {
  if (!sb || !account.user) return { ok: false, kind: 'signed_out' };
  if (typeof jws !== 'string' || !jws) return { ok: false, kind: 'invalid_jws' };
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
      const kind = status >= 500 ? 'retry'
        : ['invalid_jws', 'bad_bundle', 'transaction_taken', 'unknown_product', 'not_found'].includes(info?.error)
          ? info.error : accessErrorKind(error);
      if (ACCESS_FINAL_REFUSALS.includes(kind)) await Native.store.finish(transactionId);
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

// Formules proposées : prix LUS CHEZ STOREKIT (localisés par Apple), jamais écrits en dur. Hors app
// iOS, ou module absent : liste vide (l'écran invite à utiliser l'app). Les identifiants inconnus et
// l'« Accès offert » (jamais vendu) sont écartés.
async function accessLoadProducts({ force = false } = {}) {
  if (!Native.store.available) { access.products = []; access.missing = []; return []; }
  if (access.products?.length && !force) return access.products;
  const raw = await Native.store.products();
  const list = (Array.isArray(raw?.products) ? raw.products : [])
    .filter(p => p && ACCESS_PRODUCT_IDS.includes(p.id) && typeof p.price === 'string' && p.price.trim())
    .map(p => ({ id: p.id, price: p.price.trim().slice(0, 24),
      title: typeof p.title === 'string' ? p.title.slice(0, 60) : '',
      period: p.id === ACCESS_YEARLY_ID ? 'year' : 'month' }))
    .sort((a, b) => ACCESS_PRODUCT_IDS.indexOf(a.id) - ACCESS_PRODUCT_IDS.indexOf(b.id));
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
    // purchase() ne rejette jamais : il résout 'success', 'userCancelled' ou 'pending'
    const r = await Native.store.purchase(productId);
    if (r?.status === 'userCancelled') return { ok: false, reason: 'cancel' };
    if (r?.status === 'pending') return { ok: false, kind: 'pending' };
    if (r?.status !== 'success' || !r?.jws) return { ok: false, kind: 'server' };
    return await accessVerifyPurchase(r.jws, r.transactionId);
  } finally {
    access.buying = null;
    notifyAccess();
  }
}

// « Restaurer mes achats » : AppStore.sync() puis l'état courant ; le JWS rendu repart au serveur.
// Renvoie { ok: true }, { ok: false, kind: 'nothing' } (rien sur cet identifiant Apple) ou { ok: false, kind }.
async function accessRestore() {
  if (!account.user) return { ok: false, kind: 'signed_out' };
  if (!Native.store.available) return { ok: false, kind: 'no_store' };
  const r = await Native.store.restore();
  if (!r?.jws) {
    // Rien chez Apple : l'état du serveur peut quand même avoir changé (notification Apple reçue)
    await accessRefresh();
    return canWrite() && paywallOn() ? { ok: true } : { ok: false, kind: 'nothing' };
  }
  return await accessVerifyPurchase(r.jws, r.transactionId);
}

// « J'ai un code » : feuille de codes d'Apple. Attention, elle n'accepte que les codes d'offre
// d'ABONNEMENT (par exemple un an gratuit) ; un code promotionnel de l'« Accès offert » (non
// consommable) se saisit dans l'app App Store, pas ici. Le code utilisé arrive par
// Transaction.updates (accessOnTransaction), jamais par cette fonction : elle ouvre juste la feuille.
async function accessRedeemCode() {
  if (!account.user) return { ok: false, kind: 'signed_out' };
  if (!Native.store.available) return { ok: false, kind: 'no_store' };
  const ok = await Native.store.redeemCode();
  return ok ? { ok: true } : { ok: false, kind: 'server' };
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
  if (id === access.userId) return;
  accessReset(id);
  notifyAccess();
  if (id) accessRefresh();
});
document.addEventListener?.('visibilitychange', () => {
  if (document.visibilityState === 'visible' && account.user) accessRefresh({ minAge: ACCESS_REFRESH_MS });
});
window.addEventListener?.('online', () => { if (account.user && (access.error === 'offline' || accessStale())) accessRefresh(); });
