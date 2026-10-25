// ═══════════════════════════════════════════════════════════
//  Compte MDLF (facultatif) : connexion avec Apple, session persistante, synchronisation
//
//  - Serveur : Supabase (projet mdlf-training, région UE). Clé publique « publishable » seulement :
//    la sécurité vient des règles RLS du serveur (supabase/migrations) ; chacun ne lit et n'écrit
//    que ses propres lignes.
//  - Session : gardée dans le Trousseau (Native.account.storage), rafraîchie toute seule. Le jeton de
//    rafraîchissement n'expire pas : on reste connecté jusqu'à « Se déconnecter » ou la suppression du
//    compte. Une erreur réseau ne déconnecte jamais (hors ligne, la session stockée suffit).
//  - Synchronisation (logique pure dans js/data/sync.js) : à la connexion, au retour dans l'app, et
//    quelques secondes après chaque enregistrement. Hors ligne, rien ne se perd : l'envoi attend.
//  - État de synchro (mdlf_sync_<id>) valable seulement pour le dernier compte synchronisé sur
//    l'appareil (SYNC_OWNER_KEY) : se reconnecter au même compte reprend où on en était ; changer de
//    compte repart de zéro (le compte fait foi, rien n'est supprimé). Effacer les données de l'appareil, importer une sauvegarde ou la
//    réinitialisation de secours détachent l'appareil (accountForgetDevice, accountResetSyncState) :
//    jamais de suppression envoyée au compte pour une action locale.
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
const SYNC_OWNER_KEY   = 'mdlf_sync_owner'; // dernier compte synchronisé sur cet appareil
const AUTH_STORAGE_KEY = 'mdlf-auth';
const SYNC_DEBOUNCE_MS = 4000;
const SYNC_BATCH = 200;

let sb = null;   // client supabase unique (deux clients se voleraient le jeton de rafraîchissement)
// error : null | 'offline' (réseau) | 'server' (refus du serveur ou stockage plein)
const account = { user: null, syncing: false, lastSync: null, error: null, ready: false };
let syncTimer = null;
let applyingRemote = false;   // fusion en cours : son propre enregistrement ne relance pas de synchro
let syncHeld = false;         // connexion en cours (choix du compte pas encore fait) : aucune synchro
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
  const id = user?.identities?.find(i => i.provider === 'apple');
  return id?.identity_data?.sub || id?.id || null;
}

// Nonce aléatoire (32 octets en hexadécimal) : lie le jeton d'Apple à cette demande de connexion
function randomNonce() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
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
    const { data: { session } } = await sb.auth.getSession();
    account.user = session?.user || await storedSessionUser();
  } finally {
    account.ready = true;
    notifyAccount();
  }
  if (!account.user) return;
  // Connexion avec Apple retirée par l'utilisateur (Réglages › Apple ID) : déconnexion locale
  const appleUser = appleUserOf(account.user);
  if (appleUser && (await Native.account.credentialState(appleUser)) === 'revoked') { await accountSignOut(); return; }
  syncNow();
}

// Rafraîchissement automatique seulement au premier plan (recommandation supabase-js pour une app) ;
// retour dans l'app : synchro
function onAccountVisibility() {
  if (document.visibilityState === 'visible') { sb.auth.startAutoRefresh(); if (account.user) syncNow(); }
  else sb.auth.stopAutoRefresh();
}

// Connexion avec Apple, puis première synchro.
// askMerge(n) : appelé si cet appareil contient n séances d'un AUTRE compte ; renvoie 'add' (les ajouter
// à ce compte), 'replace' (l'écran a déjà vidé l'appareil : ne garder que celles du compte) ou null
// (annuler : déconnexion).
// Renvoie { ok, reason?: 'cancel' | 'apple' | 'server' | 'sync', sent, received }.
async function accountSignIn(askMerge) {
  if (!sb) return { ok: false, reason: 'server' };
  const nonce = randomNonce();
  let apple;
  try { apple = await Native.account.signIn(nonce); }
  catch { return { ok: false, reason: 'apple' }; }
  if (!apple) return { ok: false, reason: 'cancel' };
  // Aucune synchro tant que l'utilisateur n'a pas choisi (sinon les séances d'un autre compte partiraient)
  syncHeld = true;
  try {
    const { data: auth, error } = await sb.auth.signInWithIdToken({ provider: 'apple', token: apple.identityToken, nonce });
    if (error || !auth?.user) return { ok: false, reason: 'server' };
    const owner = syncOwner();
    if (owner && owner !== auth.user.id) {
      const n = (data.history || []).length;
      const choice = n ? await askMerge(n) : 'add';
      if (!choice) { await accountSignOut(); return { ok: false, reason: 'cancel' }; }
      clearSyncMetas();   // l'ancien compte ne laisse rien derrière lui
      try { localStorage.removeItem(SYNC_OWNER_KEY); } catch { /* loadSyncMeta compare de toute façon */ }
    }
    account.user = auth.user;
  } finally { syncHeld = false; }
  const before = (data.history || []).length;
  const ok = await syncNow();
  return { ok, reason: ok ? undefined : 'sync', sent: before, received: Math.max(0, (data.history || []).length - before) };
}

// Déconnexion de cet appareil : les données restent sur l'iPhone et sur le compte. L'état de synchro
// est gardé : une reconnexion au même compte reprend où elle en était.
async function accountSignOut() {
  if (!sb) return;
  clearTimeout(syncTimer);
  account.user = null;
  await sb.auth.signOut({ scope: 'local' });
  notifyAccount();
}

// Effacement des données de cet appareil (Réglages, suppression du compte) : l'appareil quitte le
// compte AVANT l'écriture, pour que l'effacement ne parte jamais en suppressions sur le compte.
async function accountForgetDevice() {
  clearTimeout(syncTimer);
  account.user = null;   // synchrone : le save() qui suit ne programme plus rien
  clearSyncMetas();
  try { localStorage.removeItem(SYNC_OWNER_KEY); } catch { /* rien */ }
  if (sb) await sb.auth.signOut({ scope: 'local' });
  notifyAccount();
}

// Import d'une sauvegarde : les séances absentes du fichier ne doivent pas être supprimées du compte.
// L'état de synchro est oublié ; la prochaine synchro repart du compte et y ajoute ce qui manque.
function accountResetSyncState() {
  clearTimeout(syncTimer);
  clearSyncMetas();
}

// Suppression du compte (règle Apple 5.1.1(v)) : nouvelle connexion avec Apple pour un code frais,
// puis la fonction serveur delete-account révoque l'accès Apple et efface le compte et ses données.
// Renvoie { ok, reason?: 'cancel' | 'apple' | 'server', revoked }.
async function accountDelete() {
  if (!sb || !account.user) return { ok: false, reason: 'server' };
  let apple;
  try { apple = await Native.account.signIn(randomNonce()); }
  catch { return { ok: false, reason: 'apple' }; }
  if (!apple) return { ok: false, reason: 'cancel' };
  const { data: res, error } = await sb.functions.invoke('delete-account', { body: { code: apple.authorizationCode } });
  if (error || !res?.deleted) return { ok: false, reason: 'server' };
  await accountForgetDevice();
  return { ok: true, revoked: !!res.revoked };
}

// Après chaque enregistrement local : envoi groupé quelques secondes plus tard
function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
  if (!sb || !account.user || applyingRemote || syncHeld) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
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
