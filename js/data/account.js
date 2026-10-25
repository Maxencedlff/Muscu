// ═══════════════════════════════════════════════════════════
//  Compte MDLF (facultatif) : connexion (Apple, Google, code par e-mail), session persistante,
//  profil (pseudo et avatar), moyens de connexion reliés, synchronisation
//
//  - Serveur : Supabase (projet mdlf-training, région UE). Clé publique « publishable » seulement :
//    la sécurité vient des règles RLS du serveur (supabase/migrations) ; chacun ne lit et n'écrit
//    que ses propres lignes.
//  - Session : gardée dans le Trousseau (Native.account.storage), rafraîchie toute seule. Le jeton de
//    rafraîchissement n'expire pas : on reste connecté jusqu'à « Se déconnecter » ou la suppression du
//    compte. Une erreur réseau ne déconnecte jamais (hors ligne, la session stockée suffit).
//  - Synchronisation (logique pure dans js/data/sync.js) : à la connexion, au retour dans l'app, et
//    quelques secondes après chaque enregistrement. Hors ligne, rien ne se perd : l'envoi attend.
//  - État de synchro (mdlf_sync_<id>) valable seulement pour le dernier compte connecté sur
//    l'appareil (SYNC_OWNER_KEY, posé dès la connexion) : se reconnecter au même compte reprend où on en était ; changer de
//    compte repart de zéro (le compte fait foi, rien n'est supprimé). Effacer les données de l'appareil, importer une sauvegarde ou la
//    réinitialisation de secours détachent l'appareil (accountForgetDevice, accountResetSyncState) :
//    jamais de suppression envoyée au compte pour une action locale.
//  - Connexion : trois moyens, un seul parcours (finishSignIn) : choix de fusion si l'appareil contient
//    les séances d'un autre compte, profil, première synchro. Apple et Google donnent un jeton
//    d'identité (signInWithIdToken, nonce brut ici, haché côté natif) ; l'e-mail un code à 6 chiffres
//    (signInWithOtp puis verifyOtp). Logique pure (erreurs, pseudo, identités) : js/data/account-auth.js.
//  - Profil public (user_profiles : pseudo, avatar emoji) séparé de profiles.doc (privé, synchronisé) ;
//    gardé en cache sur l'appareil (PROFILE_CACHE_KEY) pour l'afficher hors ligne.
//  - Couche données : aucun affichage ici. L'écran (js/features/account-ui.js) s'abonne par
//    onAccountChange et reçoit les résultats des actions.
//  - Sans compte, l'app marche comme avant ; dans le navigateur ou une coquille iOS sans le module,
//    la rubrique Compte n'apparaît pas.
// ═══════════════════════════════════════════════════════════
'use strict';

const ACCOUNT_CONFIG = {
  url: 'https://yopptmdjtnezmccdvaxf.supabase.co',
  publishableKey: 'sb_publishable_9L0-y5dhw7V8LVm5PuxG5g_Hd7ExHkS',   // clé publique (rien de secret dans l'app) gitleaks:allow
};
const SYNC_META_PREFIX = 'mdlf_sync_';      // + identifiant du compte : curseur et empreintes (localStorage)
const SYNC_OWNER_KEY   = 'mdlf_sync_owner'; // dernier compte connecté sur cet appareil (posé à la connexion)
const AUTH_STORAGE_KEY = 'mdlf-auth';
const PROFILE_CACHE_KEY = 'mdlf_profile';  // { userId, username, avatar, changedAt } du dernier compte
const SYNC_DEBOUNCE_MS = 4000;
const SYNC_BATCH = 200;

let sb = null;   // client supabase unique (deux clients se voleraient le jeton de rafraîchissement)
// error : null | 'offline' (réseau) | 'server' (refus du serveur ou stockage plein)
// profile : { username, avatar, changedAt, stored } | null (pas encore de profil) ; google : connexion
// Google proposée (module natif présent et client Google configuré dans Info.plist)
const account = { user: null, syncing: false, lastSync: null, error: null, ready: false, profile: null, google: false };
let syncTimer = null;
let applyingRemote = false;   // fusion en cours : son propre enregistrement ne relance pas de synchro
let syncHeld = false;         // connexion en cours (choix du compte pas encore fait) : aucune synchro
let syncHoldUntil = 0;        // import : pas de synchro pendant le délai « Annuler » (accountHoldSync)
let syncGeneration = 0;       // +1 à chaque oubli de l'état : une synchro commencée avant n'écrit plus rien
const accountListeners = [];

// kind : 'state' (connexion, synchro) ou 'merged' (données reçues du compte : l'écran est à redessiner)
function onAccountChange(fn) { accountListeners.push(fn); }
function notifyAccount(kind = 'state') { for (const fn of accountListeners) { try { fn(kind); } catch { /* écran absent */ } } }

function accountAvailable() {
  return Native.account.available && typeof supabase !== 'undefined' && !!ACCOUNT_CONFIG.publishableKey;
}

function syncOwner() { try { return localStorage.getItem(SYNC_OWNER_KEY); } catch { return null; } }

function loadSyncMeta(userId) {
  if (syncOwner() !== userId) return emptySyncMeta(userId);   // état d'un autre compte : jamais réutilisé
  try {
    const m = JSON.parse(localStorage.getItem(SYNC_META_PREFIX + userId));
    if (m && m.userId === userId && m.pushed && typeof m.pushed === 'object') return m;
  } catch { /* état illisible : synchro complète, le compte fait foi */ }
  return emptySyncMeta(userId);
}
function saveSyncMeta(m) { try { localStorage.setItem(SYNC_META_PREFIX + m.userId, JSON.stringify(m)); } catch { /* refait au prochain passage */ } }
// Oublie les états de synchro de cet appareil (la prochaine synchro repart du compte) ; le
// dernier compte connu (SYNC_OWNER_KEY) n'est pas un état de synchro et reste
function clearSyncMetas() {
  syncGeneration++;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const k of keys) if (k?.startsWith(SYNC_META_PREFIX) && k !== SYNC_OWNER_KEY) localStorage.removeItem(k);
  } catch { /* rien */ }
}

// Identifiant Apple du compte (claim sub), pour vérifier au lancement qu'il n'a pas été révoqué
function appleUserOf(user) {
  const id = identityOf(user, 'apple');
  return id?.identity_data?.sub || id?.id || null;
}

// Nonce aléatoire (32 octets en hexadécimal) : lie le jeton d'Apple ou de Google à cette demande de connexion
function randomNonce() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Séances de cet appareil pas encore sur le compte userId (selon le dernier état de synchro connu ;
// sans état, toutes) : sert à ne jamais promettre « elles restent sur ton compte » à tort
function accountPendingCount(userId) {
  if (!userId) return (data.history || []).length;
  return planSessionPush(data.history || [], loadSyncMeta(userId)).upserts.length;
}

// Session stockée, même expirée (lancement hors ligne : on reste « connecté », la synchro attend)
async function storedSessionUser() {
  try { return JSON.parse(await Native.account.storage.getItem(AUTH_STORAGE_KEY))?.user || null; }
  catch { return null; }
}

// Démarrage : session reprise du Trousseau, identifiant Apple vérifié, première synchro
async function accountInit() {
  if (!accountAvailable() || sb) return;
  try {
    sb = supabase.createClient(ACCOUNT_CONFIG.url, ACCOUNT_CONFIG.publishableKey, {
      auth: { storage: Native.account.storage, storageKey: AUTH_STORAGE_KEY, persistSession: true,
              autoRefreshToken: true, detectSessionInUrl: false },
    });
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') { account.user = null; account.lastSync = null; account.error = null; }
      else if (session?.user) account.user = session.user;
      // Réseau revenu (jeton rafraîchi) : ce qui attendait part
      if (event === 'TOKEN_REFRESHED') scheduleSync(0);
      notifyAccount();
    });
    document.addEventListener('visibilitychange', onAccountVisibility);
    const [{ data: { session } }, google] = await Promise.all([sb.auth.getSession(), Native.account.googleAvailable()]);
    account.google = google;
    account.user = session?.user || await storedSessionUser();
    account.profile = cachedProfile(account.user?.id);
  } finally {
    account.ready = true;
    notifyAccount();
  }
  if (!account.user) return;
  // Connexion avec Apple retirée par l'utilisateur (Réglages › Apple ID) : déconnexion locale.
  // Seulement pour un compte relié à Apple (e-mail ou Google seuls : rien à demander à Apple)
  const appleUser = appleUserOf(account.user);
  if (appleUser && (await Native.account.credentialState(appleUser)) === 'revoked') { await accountSignOut(); return; }
  accountLoadProfile();
  syncNow();
}

// Rafraîchissement automatique seulement au premier plan (recommandation supabase-js pour une app) ;
// retour dans l'app : synchro
function onAccountVisibility() {
  if (document.visibilityState === 'visible') { sb.auth.startAutoRefresh(); if (account.user) syncNow(); }
  else sb.auth.stopAutoRefresh();
}

// ── Connexion : un parcours commun aux trois moyens ─────────

// authenticate() : demande au moyen choisi puis à Supabase. Renvoie { cancel: true } (fenêtre fermée),
// { provider: true } (échec du module natif), { kind } (refus déjà traduit) ou le résultat de
// supabase-js ({ data: { user }, error }).
// askMerge(n, pending) : appelé si cet appareil contient n séances d'un AUTRE compte (dont pending
// jamais sauvegardées sur cet autre compte) ; renvoie 'add' (les ajouter à ce compte), 'replace'
// (l'écran a déjà vidé l'appareil : ne garder que celles du compte) ou null (annuler : déconnexion).
// Renvoie { ok, reason?: 'cancel' | 'provider' | 'auth' | 'server' | 'sync', kind?, sent, received, isNew }.
async function finishSignIn(authenticate, askMerge) {
  if (!sb) return { ok: false, reason: 'server' };
  // Aucune synchro tant que l'utilisateur n'a pas choisi (sinon les séances d'un autre compte partiraient)
  syncHeld = true;
  let user;
  try {
    let res;
    try { res = await authenticate(); }
    catch (e) { return { ok: false, reason: 'auth', kind: authErrorKind(e) || 'server' }; }
    if (res?.cancel) return { ok: false, reason: 'cancel' };
    if (res?.provider) return { ok: false, reason: 'provider' };
    if (res?.kind || res?.error || !res?.data?.user) return { ok: false, reason: 'auth', kind: res?.kind || authErrorKind(res?.error) || 'server' };
    user = res.data.user;
    const owner = syncOwner();
    if (owner && owner !== user.id) {
      const n = (data.history || []).length;
      const choice = n ? await askMerge(n, accountPendingCount(owner)) : 'add';
      if (!choice) { await accountSignOut(); return { ok: false, reason: 'cancel' }; }
      clearSyncMetas();   // l'ancien compte ne laisse rien derrière lui
    }
    // Appareil rattaché à ce compte dès la connexion, avant la première synchro : si elle échoue (hors
    // ligne), un autre compte qui se connecte ensuite verra quand même le choix de fusion. Sans changement
    // de compte, l'état de synchro déjà enregistré pour ce compte est repris (planSessionPush compare
    // les empreintes : rien n'est renvoyé à tort).
    try { localStorage.setItem(SYNC_OWNER_KEY, user.id); } catch { /* reposé à la fin de la synchro */ }
    account.user = user;
    account.profile = cachedProfile(user.id);
  } finally { syncHeld = false; }
  const profile = await accountLoadProfile();
  const isNew = isNewAccount(user, profile);
  const before = (data.history || []).length;
  const ok = await syncNow();
  return { ok, reason: ok ? undefined : 'sync', sent: before, received: Math.max(0, (data.history || []).length - before), isNew };
}

// Jeton d'identité Apple ou Google : { token, nonce, extra } ; { cancel } ou { provider } sinon
async function providerToken(provider) {
  const nonce = randomNonce();
  try {
    if (provider === 'apple') {
      const apple = await Native.account.signIn(nonce);
      return apple ? { token: apple.identityToken, nonce, code: apple.authorizationCode } : { cancel: true };
    }
    const google = await Native.account.signInGoogle(nonce);
    return google ? { token: google.idToken, nonce } : { cancel: true };
  } catch { return { provider: true }; }
}

// Connexion avec Apple (sans nom ni e-mail demandés) ou avec Google
function accountSignInWith(provider, askMerge) {
  return finishSignIn(async () => {
    const t = await providerToken(provider);
    if (!t.token) return t;
    return sb.auth.signInWithIdToken({ provider, token: t.token, nonce: t.nonce });
  }, askMerge);
}

// Code de connexion envoyé par e-mail (valable 10 min). create : false pour ne jamais créer de
// compte (nouvelle connexion avant la suppression). Renvoie { ok, sentAt } ou { ok: false, kind }.
async function accountSendEmailCode(email, { create = true } = {}) {
  if (!sb) return { ok: false, kind: 'server' };
  try {
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: create } });
    return error ? { ok: false, kind: authErrorKind(error) } : { ok: true, sentAt: Date.now() };
  } catch (e) { return { ok: false, kind: authErrorKind(e) || 'server' }; }
}

// Code reçu par e-mail, puis le parcours commun. sentAt : heure d'envoi (code faux ou expiré)
function accountVerifyEmailCode(email, code, sentAt, askMerge) {
  return finishSignIn(async () => {
    const res = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
    return res.error ? { kind: otpErrorKind(res.error, sentAt) } : res;
  }, askMerge);
}

// Utilisateur relu sur le serveur (identités à jour après un ajout ou un retrait)
async function refreshAccountUser() {
  try {
    const { data: res, error } = await sb.auth.getUser();
    if (!error && res?.user && res.user.id === account.user?.id) account.user = res.user;
  } catch { /* hors ligne : on garde l'utilisateur connu */ }
  notifyAccount();
}

// ── Moyens de connexion reliés (écran Compte) ───────────────
// Supabase : « Manual linking » activé (security_manual_linking_enabled). Renvoient { ok } ou
// { ok: false, reason?: 'cancel' | 'provider', kind? }.

// Liaison d'Apple ou de Google : Supabase renvoie une nouvelle session (link_identity), gardée par
// supabase-js. L'écran demande d'abord une nouvelle connexion (reauthenticate) si la session est ancienne.
async function accountLink(provider) {
  if (!sb || !account.user) return { ok: false, kind: 'server' };
  const t = await providerToken(provider);
  if (!t.token) return { ok: false, reason: t.cancel ? 'cancel' : 'provider' };
  try {
    const { data: res, error } = await sb.auth.linkIdentity({ provider, token: t.token, nonce: t.nonce });
    if (error) return { ok: false, kind: authErrorKind(error) };
    if (res?.user?.id === account.user.id) account.user = res.user;
  } catch (e) { return { ok: false, kind: authErrorKind(e) || 'server' }; }
  await refreshAccountUser();
  return { ok: true };
}

// Ajout d'une adresse e-mail à un compte qui n'en a pas (compte Apple, canAddEmail) : code envoyé à
// cette adresse (changement d'e-mail de Supabase, une seule confirmation puisqu'il n'y a pas d'ancienne
// adresse), puis accountLinkEmailVerify. Un compte qui a déjà une adresse (Google) est refusé ici :
// updateUser la remplacerait, après deux confirmations. Une adresse déjà utilisée par un autre compte
// est refusée par le serveur.
async function accountLinkEmailStart(email) {
  if (!sb || !account.user) return { ok: false, kind: 'server' };
  if (signInEmailOf(account.user) && normalizeEmail(account.user.email) === email) return { ok: false, kind: 'same_email' };
  if (!canAddEmail(account.user)) return { ok: false, kind: 'has_email' };
  try {
    const { error } = await sb.auth.updateUser({ email });
    return error ? { ok: false, kind: authErrorKind(error) } : { ok: true, sentAt: Date.now() };
  } catch (e) { return { ok: false, kind: authErrorKind(e) || 'server' }; }
}
async function accountLinkEmailVerify(email, code, sentAt) {
  if (!sb || !account.user) return { ok: false, kind: 'server' };
  try {
    const { data: res, error } = await sb.auth.verifyOtp({ email, token: code, type: 'email_change' });
    if (error) return { ok: false, kind: otpErrorKind(error, sentAt) };
    if (res?.user?.id === account.user.id) account.user = res.user;
  } catch (e) { return { ok: false, kind: authErrorKind(e) || 'server' }; }
  await refreshAccountUser();
  // Ajoutée seulement si le serveur porte bien cette adresse (sinon une confirmation manque encore)
  if (normalizeEmail(account.user?.email) !== email) return { ok: false, kind: 'email_unconfirmed' };
  return { ok: true };
}

// Retrait d'un moyen de connexion : seulement s'il en reste un autre (le serveur le vérifie aussi).
// Apple : nouvelle connexion avec Apple d'abord (code tout frais), retrait, puis révocation de l'accès
// Apple par la fonction serveur revoke-apple, au mieux. Connexion avec Apple impossible : retrait quand
// même, sans révocation. Renvoie { ok, revoked? } (revoked : Apple seulement).
async function accountUnlink(provider) {
  if (!sb || !account.user) return { ok: false, kind: 'server' };
  if (!canUnlink(account.user, provider)) return { ok: false, kind: 'last_identity' };
  let code = '';
  if (provider === 'apple') {
    const r = await accountReauthApple({ session: false });
    if (r.reason === 'cancel') return { ok: false, reason: 'cancel' };
    if (r.kind === 'other_account') return { ok: false, kind: 'other_account' };
    code = r.code || '';
  }
  try {
    const { error } = await sb.auth.unlinkIdentity(identityOf(account.user, provider));
    if (error) return { ok: false, kind: authErrorKind(error) };
  } catch (e) { return { ok: false, kind: authErrorKind(e) || 'server' }; }
  await refreshAccountUser();
  if (provider !== 'apple') return { ok: true };
  let revoked = false;
  if (code) {
    try { revoked = (await sb.functions.invoke('revoke-apple', { body: { code } })).data?.revoked === true; } catch { /* au mieux */ }
  }
  return { ok: true, revoked };
}

// ── Profil public : pseudo et avatar ────────────────────────

function cachedProfile(userId) {
  if (!userId) return null;
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY));
    if (p?.userId === userId) return { username: p.username || null, avatar: validAvatar(p.avatar), changedAt: p.changedAt || null, stored: true };
  } catch { /* cache illisible : relu au prochain passage */ }
  return null;
}
function setProfile(userId, row) {
  account.profile = row ? { username: row.username || null, avatar: validAvatar(row.avatar_emoji), changedAt: row.username_changed_at || null, stored: true } : null;
  try {
    if (row) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ userId, ...account.profile }));
    else localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch { /* cache facultatif */ }
  notifyAccount();
}
const PROFILE_COLUMNS = 'username,avatar_emoji,username_changed_at';

// Profil du compte relu sur le serveur. Renvoie le profil, null (pas encore de profil) ou undefined
// (illisible : hors ligne, serveur indisponible)
async function accountLoadProfile() {
  if (!sb || !account.user) return undefined;
  const userId = account.user.id;
  try {
    const { data: row, error } = await sb.from('user_profiles').select(PROFILE_COLUMNS).maybeSingle();
    if (error || account.user?.id !== userId) return undefined;
    setProfile(userId, row);
    return account.profile;
  } catch { return undefined; }
}

// Enregistre { username?, avatar? } (déjà normalisés). Renvoie { ok } ou { ok: false, kind } (clé de
// USERNAME_TEXT : taken, forbidden, too_soon, offline…)
async function accountSaveProfile(changes) {
  if (!sb || !account.user) return { ok: false, kind: 'server' };
  const userId = account.user.id, patch = {};
  if ('username' in changes) {
    const bad = usernameProblem(changes.username);
    if (bad) return { ok: false, kind: bad };
    patch.username = changes.username;
  }
  if ('avatar' in changes) patch.avatar_emoji = validAvatar(changes.avatar);
  if (!Object.keys(patch).length) return { ok: true };
  try {
    // Pas encore de ligne connue : insertion (user_id vient de auth.uid() côté serveur). Ligne déjà
    // créée ailleurs entre-temps (clé primaire en double) : mise à jour.
    let res = account.profile?.stored ? null : await sb.from('user_profiles').insert(patch).select(PROFILE_COLUMNS).single();
    if (!res || (res.error?.code === '23505' && /pkey/.test(res.error.message || ''))) {
      res = await sb.from('user_profiles').update(patch).eq('user_id', userId).select(PROFILE_COLUMNS).single();
    }
    if (res.error) return { ok: false, kind: profileErrorKind(res.error) };
    if (account.user?.id === userId) setProfile(userId, res.data);
    return { ok: true };
  } catch (e) { return { ok: false, kind: profileErrorKind(e) || 'server' }; }
}

// Pseudo libre ? true / false, ou null si la question n'a pas pu être posée (hors ligne)
async function accountUsernameAvailable(name) {
  if (!sb || !account.user || usernameProblem(name)) return false;
  try {
    const { data: free, error } = await sb.rpc('username_available', { name });
    return error ? null : free === true;
  } catch { return null; }
}

// Déconnexion de cet appareil : les données restent sur l'iPhone et sur le compte. L'état de synchro
// est gardé : une reconnexion au même compte reprend où elle en était.
async function accountSignOut() {
  if (!sb) return;
  clearTimeout(syncTimer);
  account.user = null;
  account.profile = null;
  await sb.auth.signOut({ scope: 'local' });
  notifyAccount();
}

// Effacement des données de cet appareil (Réglages, suppression du compte) : l'appareil quitte le
// compte AVANT l'écriture, pour que l'effacement ne parte jamais en suppressions sur le compte.
async function accountForgetDevice() {
  clearTimeout(syncTimer);
  account.user = null;   // synchrone : le save() qui suit ne programme plus rien
  account.profile = null;
  clearSyncMetas();
  try { localStorage.removeItem(SYNC_OWNER_KEY); localStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* rien */ }
  if (sb) await sb.auth.signOut({ scope: 'local' });
  notifyAccount();
}

// Import d'une sauvegarde : les séances absentes du fichier ne doivent pas être supprimées du compte.
// L'état de synchro est oublié ; la prochaine synchro repart du compte et y ajoute ce qui manque.
function accountResetSyncState() {
  clearTimeout(syncTimer);
  clearSyncMetas();
}

// Import : la synchro attend la fin du délai où l'import peut être annulé. Annulé dans ce délai,
// rien n'est parti et rien de ce qui est arrivé d'un autre appareil n'est supprimé.
function accountHoldSync(ms) {
  syncHoldUntil = Date.now() + ms;
  scheduleSync(ms + 100);
}

// ── Suppression du compte (règle Apple 5.1.1(v)) ────────────
// Compte relié à Apple : nouvelle connexion avec Apple, toujours, pour un code tout frais que la
// fonction serveur delete-account échange auprès d'Apple (preuve d'identité, puis révocation de l'accès
// Apple) ; la même connexion rend aussi la session récente, au cas où l'échange échouerait. Sinon : la
// fonction exige une connexion de moins de 10 min (claim amr) ; l'écran la demande d'abord
// (accountReauthGoogle, accountReauthEmail…). Dans tous les cas, refus si un moyen de connexion a été
// ajouté depuis moins de 24 h (linkedIdentityHoldUntil, même règle que le serveur).

// Moyens possibles pour se reconnecter (avant la suppression, avant l'ajout d'un moyen de connexion)
function reauthMethods(user = account.user) {
  const out = [];
  if (hasApple(user)) out.push('apple');
  if (account.google && identityOf(user, 'google')) out.push('google');
  if (signInEmailOf(user)) out.push('email');
  return out;
}

// Nouvelle session du même compte (jamais d'un autre : sinon on s'y retrouverait connecté)
async function sameAccountSession(res, userId) {
  if (res.error || !res.data?.user) return { ok: false, kind: res.kind || authErrorKind(res.error) || 'server' };
  if (res.data.user.id !== userId) { await accountSignOut(); return { ok: false, kind: 'other_account' }; }
  account.user = res.data.user;
  return { ok: true };
}

async function accountReauthGoogle() {
  if (!sb || !account.user) return { ok: false, kind: 'server' };
  const userId = account.user.id, t = await providerToken('google');
  if (!t.token) return { ok: false, reason: t.cancel ? 'cancel' : 'provider' };
  // Autre compte Google choisi : refusé avant de parler à Supabase (qui créerait un autre compte)
  if (jwtPayload(t.token)?.sub !== googleSubOf(account.user)) return { ok: false, kind: 'other_account' };
  try { return await sameAccountSession(await sb.auth.signInWithIdToken({ provider: 'google', token: t.token, nonce: t.nonce }), userId); }
  catch (e) { return { ok: false, kind: authErrorKind(e) || 'server' }; }
}

// Nouvelle connexion avec Apple, du même identifiant Apple que le compte (sinon refusée avant de parler
// à Supabase, qui créerait un autre compte). Renvoie { ok, code } : code d'autorisation tout frais pour
// le serveur (delete-account, revoke-apple). session : aussi une session Supabase récente (claim amr).
async function accountReauthApple({ session = true } = {}) {
  if (!sb || !account.user) return { ok: false, kind: 'server' };
  const userId = account.user.id, t = await providerToken('apple');
  if (!t.token) return { ok: false, reason: t.cancel ? 'cancel' : 'provider' };
  if (jwtPayload(t.token)?.sub !== appleUserOf(account.user)) return { ok: false, kind: 'other_account' };
  if (!t.code) return { ok: false, reason: 'provider' };
  if (!session) return { ok: true, code: t.code };
  try {
    const r = await sameAccountSession(await sb.auth.signInWithIdToken({ provider: 'apple', token: t.token, nonce: t.nonce }), userId);
    return r.ok ? { ok: true, code: t.code } : r;
  } catch (e) { return { ok: false, kind: authErrorKind(e) || 'server' }; }
}

// Code envoyé à l'adresse du compte (jamais de création de compte)
function accountReauthEmailStart() {
  const email = signInEmailOf(account.user);
  return email ? accountSendEmailCode(email, { create: false }) : Promise.resolve({ ok: false, kind: 'server' });
}
async function accountReauthEmailVerify(code, sentAt) {
  const email = signInEmailOf(account.user);
  if (!sb || !email) return { ok: false, kind: 'server' };
  try {
    const res = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
    return await sameAccountSession(res.error ? { kind: otpErrorKind(res.error, sentAt) } : res, account.user.id);
  } catch (e) { return { ok: false, kind: authErrorKind(e) || 'server' }; }
}

// Connexion de moins de 10 min dans la session en cours (sinon la fonction serveur refuserait)
async function accountRecentlyAuthenticated() {
  try { return isRecentAuth((await sb.auth.getSession()).data.session?.access_token); } catch { return false; }
}

// Renvoie { ok, reason?: 'cancel' | 'apple' | 'other_account' | 'reauth' | 'identity_recent' | 'server',
// retryAt (identity_recent : date en ms), apple (compte relié à Apple), revoked }.
async function accountDelete() {
  if (!sb || !account.user) return { ok: false, reason: 'server' };
  const hold = linkedIdentityHoldUntil(account.user);
  if (hold) return { ok: false, reason: 'identity_recent', retryAt: hold };
  let body = {};
  const apple = hasApple(account.user);
  if (apple) {
    const r = await accountReauthApple();
    if (r.reason === 'cancel') return { ok: false, reason: 'cancel' };
    if (!r.ok) return { ok: false, reason: r.kind === 'other_account' ? 'other_account' : 'apple' };
    body = { code: r.code };
  } else if (!(await accountRecentlyAuthenticated())) return { ok: false, reason: 'reauth' };
  const { data: res, error } = await sb.functions.invoke('delete-account', { body });
  if (error) {
    // Réponse d'erreur de la fonction : error.context est la réponse HTTP (FunctionsHttpError)
    const status = error.context?.status;
    let info = {};
    try { info = await error.context.json(); } catch { /* corps illisible */ }
    if (status === 403 && info?.error === 'identity_recent') return { ok: false, reason: 'identity_recent', retryAt: Date.parse(info.retry_at) || 0 };
    if (status === 401) return { ok: false, reason: apple ? 'apple' : 'reauth' };
    return { ok: false, reason: 'server' };
  }
  if (!res?.deleted) return { ok: false, reason: 'server' };
  await accountForgetDevice();
  return { ok: true, apple, revoked: !!res.revoked };
}

// Après chaque enregistrement local : envoi groupé quelques secondes plus tard
function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
  if (!sb || !account.user || applyingRemote || syncHeld) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, Math.max(delay, syncHoldUntil - Date.now() + 100));
}

// Lignes de séances modifiées sur le serveur depuis le curseur (marge de 5 min : la fusion est
// idempotente). Tri par date puis identifiant : des lignes envoyées ensemble ont la même date.
async function pullSessions(cursor) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from('sessions').select('id,data,deleted_at,updated_at').order('updated_at').order('id').range(from, from + 999);
    if (cursor) q = q.gt('updated_at', new Date(Date.parse(cursor) - 5 * 60_000).toISOString());
    const { data: page, error } = await q;
    if (error) throw error;
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

// Erreur de réseau (hors ligne) ou refus du serveur : l'écran ne dit pas la même chose
function syncErrorKind(e) {
  if (!navigator.onLine || e instanceof TypeError || /fetch|network|load failed/i.test(e?.message || '')) return 'offline';
  return 'server';
}

// Synchronisation complète : réception, fusion, puis envoi. true si tout est passé.
async function syncNow() {
  if (!sb || !account.user || account.syncing || syncHeld) return false;
  if (Date.now() < syncHoldUntil) { scheduleSync(0); return false; }
  account.syncing = true; account.error = null;
  notifyAccount();
  const userId = account.user.id, meta = loadSyncMeta(userId), gen = syncGeneration;
  // État oublié pendant la synchro (effacement, import, changement de compte) : tout s'arrête, rien
  // n'est fusionné ni écrit avec l'ancien état
  const alive = () => { if (gen !== syncGeneration || account.user?.id !== userId) throw new Error('reset'); };
  const keepMeta = () => { alive(); saveSyncMeta(meta); };
  try {
    // 1. Réception et fusion
    const rows = await pullSessions(meta.cursor);
    const { data: prof, error: profErr } = await sb.from('profiles').select('doc,updated_at').maybeSingle();
    if (profErr) throw profErr;
    alive();
    const merged = applyRemoteSessions(data.history || [], rows, meta);
    const profChanged = applyRemoteProfile(data, prof, meta);
    if (merged.changed || profChanged) {
      data.history = merged.history;
      // Suppressions venues d'un autre appareil : récupérables ici aussi (Supprimés récemment)
      const now = Date.now();
      for (const entry of merged.removed) (data.trash ||= []).unshift({ entry, deletedAt: now });
      let saved;
      applyingRemote = true;
      try {
        sanitizeData(data);
        recomputePRFromHistory(data);
        syncTimersFromHistory();
        saved = save(true);
      } finally { applyingRemote = false; }
      // Stockage plein : l'état de synchro ne doit pas croire la fusion enregistrée
      if (!saved) throw new Error('storage');
      notifyAccount('merged');
    }
    for (const r of rows) if (r.updated_at && (!meta.cursor || r.updated_at > meta.cursor)) meta.cursor = r.updated_at;
    keepMeta();

    // 2. Envoi des séances (par lots) puis du profil
    const plan = planSessionPush(data.history || [], meta);
    const now = new Date().toISOString();
    for (let i = 0; i < plan.upserts.length; i += SYNC_BATCH) {
      const batch = plan.upserts.slice(i, i + SYNC_BATCH);
      const { error } = await sb.from('sessions').upsert(
        batch.map(u => ({ user_id: userId, id: u.id, data: u.data, client_mod: now, deleted_at: null })), { onConflict: 'user_id,id' });
      if (error) throw error;
      alive();
      batch.forEach(u => { meta.pushed[u.id] = u.hash; });
      keepMeta();
    }
    for (let i = 0; i < plan.deletes.length; i += SYNC_BATCH) {
      const batch = plan.deletes.slice(i, i + SYNC_BATCH);
      const { error } = await sb.from('sessions').upsert(
        batch.map(id => ({ user_id: userId, id, data: {}, client_mod: now, deleted_at: now })), { onConflict: 'user_id,id' });
      if (error) throw error;
      alive();
      batch.forEach(id => { meta.pushed[id] = 'deleted'; });
      keepMeta();
    }
    const doc = profilePayload(data), docHash = syncHash(doc);
    if (docHash !== meta.profileHash) {
      const { data: up, error } = await sb.from('profiles').upsert({ user_id: userId, doc }, { onConflict: 'user_id' }).select('updated_at').single();
      if (error) throw error;
      meta.profileHash = docHash; meta.profileAt = up.updated_at;
      keepMeta();
    }
    alive();
    // Déjà posé à la connexion ; reposé ici pour une session reprise du Trousseau (installation d'avant)
    try { localStorage.setItem(SYNC_OWNER_KEY, userId); } catch { /* redemandé au prochain changement de compte */ }
    account.lastSync = Date.now();
    return true;
  } catch (e) {
    if (e?.message === 'reset') return false;   // état oublié entre-temps : rien à signaler
    // Hors ligne ou serveur indisponible : on réessaiera ; jamais de déconnexion ici
    account.error = syncErrorKind(e);
    return false;
  } finally {
    account.syncing = false;
    notifyAccount();
  }
}
