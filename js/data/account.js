// ═══════════════════════════════════════════════════════════
//  Compte MDLF (facultatif) : connexion avec Apple, session persistante, synchronisation
//
//  - Serveur : Supabase (projet mdlf-training, région UE). Clé publique « publishable » seulement :
//    la sécurité vient des règles RLS du serveur (supabase/migrations) ; chacun ne lit et n'écrit
//    que ses propres lignes.
//  - Session : gardée dans le Trousseau (Native.account.storage), rafraîchie toute seule. Le jeton de
//    rafraîchissement n'expire pas : on reste connecté jusqu'à « Se déconnecter » ou la suppression du
//    compte. Une erreur réseau ne déconnecte jamais.
//  - Synchronisation (logique pure dans js/data/sync.js) : à la connexion, au retour dans l'app, et
//    quelques secondes après chaque enregistrement. Hors ligne, rien ne se perd : l'envoi attend.
//  - Sans compte, l'app marche comme avant ; dans le navigateur ou une coquille iOS sans le module,
//    la rubrique Compte n'apparaît pas.
// ═══════════════════════════════════════════════════════════
'use strict';

const ACCOUNT_CONFIG = {
  url: 'https://REF.supabase.co',
  publishableKey: '',                    // clé publique sb_publishable_… (rien de secret dans l'app)
};
const SYNC_META_KEY   = 'mdlf_sync';     // état de synchro (curseur, empreintes) : localStorage
const APPLE_USER_KEY  = 'mdlf_apple_user';
const SYNC_DEBOUNCE_MS = 4000;
const SYNC_BATCH = 200;

let sb = null;   // client supabase unique (deux clients se voleraient le jeton de rafraîchissement)
const account = { user: null, syncing: false, lastSync: null, error: null, ready: false };
let syncTimer = null;

function accountAvailable() {
  return Native.account.available && typeof supabase !== 'undefined' && !!ACCOUNT_CONFIG.publishableKey;
}

function loadSyncMeta(userId) {
  try {
    const m = JSON.parse(localStorage.getItem(SYNC_META_KEY));
    if (m && m.userId === userId && m.pushed && typeof m.pushed === 'object') return m;
  } catch { /* état illisible : synchro complète */ }
  return emptySyncMeta(userId);
}
function saveSyncMeta(m) { try { localStorage.setItem(SYNC_META_KEY, JSON.stringify(m)); } catch { /* refait au prochain passage */ } }

// Nonce aléatoire (32 octets en hexadécimal) : lie le jeton d'Apple à cette demande de connexion
function randomNonce() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Démarrage : session reprise du Trousseau, identifiant Apple vérifié, première synchro
async function accountInit() {
  if (!accountAvailable() || sb) return;
  sb = supabase.createClient(ACCOUNT_CONFIG.url, ACCOUNT_CONFIG.publishableKey, {
    auth: { storage: Native.account.storage, storageKey: 'mdlf-auth', persistSession: true,
            autoRefreshToken: true, detectSessionInUrl: false },
  });
  sb.auth.onAuthStateChange((event, session) => {
    account.user = session?.user || null;
    if (event === 'SIGNED_OUT') { account.lastSync = null; account.error = null; }
    refreshAccountUI();
  });
  const { data: { session } } = await sb.auth.getSession();
  account.user = session?.user || null;
  account.ready = true;
  refreshAccountUI();
  if (!account.user) return;
  // Connexion avec Apple retirée par l'utilisateur (Réglages › Apple ID) : déconnexion locale
  const appleUser = localStorage.getItem(APPLE_USER_KEY);
  if (appleUser && (await Native.account.credentialState(appleUser)) === 'revoked') { await accountSignOut(); return; }
  syncNow();
}

// Rafraîchissement automatique seulement au premier plan (recommandation supabase-js pour une app)
document.addEventListener('visibilitychange', () => {
  if (!sb) return;
  if (document.visibilityState === 'visible') { sb.auth.startAutoRefresh(); if (account.user) syncNow(); }
  else sb.auth.stopAutoRefresh();
});

async function accountSignIn() {
  if (!sb) return false;
  const nonce = randomNonce();
  let apple;
  try { apple = await Native.account.signIn(nonce); }
  catch { showToast('Connexion avec Apple impossible', { error: true }); return false; }
  if (!apple) return false;   // fenêtre fermée
  const { error } = await sb.auth.signInWithIdToken({ provider: 'apple', token: apple.identityToken, nonce });
  if (error) { showToast('Connexion refusée par le serveur, réessaie', { error: true }); return false; }
  try { localStorage.setItem(APPLE_USER_KEY, apple.user); } catch { /* vérification de révocation sautée */ }
  const before = (data.history || []).length;
  const ok = await syncNow();
  if (ok) showToast(before ? `Connecté : ${plural(before, 'séance sauvegardée', 'séances sauvegardées')} sur ton compte` : 'Connecté : tes données du compte sont sur cet iPhone');
  return true;
}

// Déconnexion de cet appareil : les données restent sur l'iPhone et sur le compte
async function accountSignOut() {
  if (!sb) return;
  clearTimeout(syncTimer);
  await sb.auth.signOut({ scope: 'local' });
  try { localStorage.removeItem(SYNC_META_KEY); localStorage.removeItem(APPLE_USER_KEY); } catch { /* rien */ }
  account.user = null;
  refreshAccountUI();
}

// Suppression du compte (règle Apple 5.1.1(v)) : nouvelle connexion avec Apple pour un code frais,
// puis la fonction serveur delete-account révoque l'accès Apple et efface le compte et ses données.
// Renvoie { ok, revoked } ; ok faux si rien n'a été supprimé.
async function accountDelete() {
  if (!sb || !account.user) return { ok: false };
  let apple;
  try { apple = await Native.account.signIn(randomNonce()); }
  catch { showToast('Connexion avec Apple impossible', { error: true }); return { ok: false }; }
  if (!apple) return { ok: false };
  const { data: res, error } = await sb.functions.invoke('delete-account', { body: { code: apple.authorizationCode } });
  if (error || !res?.deleted) { showToast('Suppression impossible, vérifie ta connexion', { error: true }); return { ok: false }; }
  await accountSignOut();
  return { ok: true, revoked: !!res.revoked };
}

// Après chaque enregistrement local : envoi groupé quelques secondes plus tard
function scheduleSync() {
  if (!sb || !account.user) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, SYNC_DEBOUNCE_MS);
}

// Lignes de séances modifiées sur le serveur depuis le curseur (marge de 5 min : la fusion est idempotente)
async function pullSessions(cursor) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from('sessions').select('id,data,deleted_at,updated_at').order('updated_at').range(from, from + 999);
    if (cursor) q = q.gt('updated_at', new Date(Date.parse(cursor) - 5 * 60_000).toISOString());
    const { data: page, error } = await q;
    if (error) throw error;
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

// Synchronisation complète : réception, fusion, puis envoi. true si tout est passé.
async function syncNow() {
  if (!sb || !account.user || account.syncing) return false;
  account.syncing = true; account.error = null;
  refreshAccountUI();
  const uid = account.user.id, meta = loadSyncMeta(uid);
  try {
    // 1. Réception et fusion
    const rows = await pullSessions(meta.cursor);
    const { data: prof, error: profErr } = await sb.from('profiles').select('doc,updated_at').maybeSingle();
    if (profErr) throw profErr;
    const merged = applyRemoteSessions(data.history || [], rows, meta);
    const profChanged = applyRemoteProfile(data, prof, meta);
    if (merged.changed || profChanged) {
      data.history = merged.history;
      sanitizeData(data);
      recomputePRFromHistory(data);
      syncTimersFromHistory();
      save(true);
      if (typeof render === 'function') render();
    }
    for (const r of rows) if (r.updated_at && (!meta.cursor || r.updated_at > meta.cursor)) meta.cursor = r.updated_at;
    saveSyncMeta(meta);

    // 2. Envoi des séances (par lots) puis du profil
    const plan = planSessionPush(data.history || [], meta);
    const now = new Date().toISOString();
    for (let i = 0; i < plan.upserts.length; i += SYNC_BATCH) {
      const batch = plan.upserts.slice(i, i + SYNC_BATCH);
      const { error } = await sb.from('sessions').upsert(
        batch.map(u => ({ user_id: uid, id: u.id, data: u.data, client_mod: now, deleted_at: null })), { onConflict: 'user_id,id' });
      if (error) throw error;
      batch.forEach(u => { meta.pushed[u.id] = u.hash; });
      saveSyncMeta(meta);
    }
    for (let i = 0; i < plan.deletes.length; i += SYNC_BATCH) {
      const batch = plan.deletes.slice(i, i + SYNC_BATCH);
      const { error } = await sb.from('sessions').upsert(
        batch.map(id => ({ user_id: uid, id, data: {}, client_mod: now, deleted_at: now })), { onConflict: 'user_id,id' });
      if (error) throw error;
      batch.forEach(id => { meta.pushed[id] = 'deleted'; });
      saveSyncMeta(meta);
    }
    const doc = profilePayload(data), docHash = syncHash(doc);
    if (docHash !== meta.profileHash) {
      const { data: up, error } = await sb.from('profiles').upsert({ user_id: uid, doc }, { onConflict: 'user_id' }).select('updated_at').single();
      if (error) throw error;
      meta.profileHash = docHash; meta.profileAt = up.updated_at;
      saveSyncMeta(meta);
    }
    account.lastSync = Date.now();
    return true;
  } catch (e) {
    // Hors ligne ou serveur indisponible : on réessaiera ; jamais de déconnexion ici
    account.error = e?.message || 'erreur';
    return false;
  } finally {
    account.syncing = false;
    refreshAccountUI();
  }
}

// Réglages ouverts : la rubrique Compte suit l'état (connexion, synchro)
function refreshAccountUI() {
  const box = document.getElementById('accountGroup');
  if (box && typeof renderAccountGroupInner === 'function') box.innerHTML = renderAccountGroupInner();
}
