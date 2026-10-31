// ═══════════════════════════════════════════════════════════
//  Notifications push : réglages par type, jeton de l'appareil, écran à ouvrir au toucher
//  Contrat : docs/NOTIFICATIONS.md. Aucun affichage : l'écran (js/features/push-ui.js) s'abonne
//  avec onPushChange.
// ═══════════════════════════════════════════════════════════
'use strict';

// Rien n'est envoyé sans accord : chaque type est éteint par défaut sur le serveur (push_prefs), iOS a sa
// propre autorisation (demandée seulement quand on allume un type), et le jeton n'est inscrit qu'à ce
// moment-là. Tout éteint, ou déconnexion : le jeton est retiré du compte (push_unregister).
// Ce que le serveur reçoit : le jeton APNs de l'appareil, son environnement (production / sandbox) et les
// trois interrupteurs. Rien d'autre (pas de modèle d'iPhone, pas de données Santé).

const PUSH_KEY = 'mdlf_push';   // { userId, token } : dernier jeton inscrit, pour le retirer à la déconnexion
const PUSH_TYPES = [
  { id: 'reactions', title: 'Bravos', sub: 'Quand quelqu’un dit bravo pour une de tes séances' },
  { id: 'follows', title: 'Demandes d’abonnement', sub: 'Quand quelqu’un veut suivre tes séances' },
  { id: 'coach', title: 'Mon coach', sub: 'Commentaire sur une séance, nouveau programme' },
];
const PUSH_OFF = Object.freeze({ reactions: false, follows: false, coach: false });

// prefs : réglages lus sur le serveur (null tant que non lus) ; permission : celle d'iOS
// ('prompt' | 'granted' | 'denied' | 'unavailable' : build sans le module, navigateur) ; busy : un
// interrupteur en cours d'écriture ; error : dernière erreur de lecture ('offline', 'server').
const push = { userId: null, prefs: null, permission: null, busy: null, error: null };
const pushListeners = [];
function onPushChange(fn) { pushListeners.push(fn); }
function notifyPush() { for (const fn of pushListeners) { try { fn(); } catch { /* écran absent */ } } }

// Réponse du serveur → trois booléens (tout ce qui n'est pas exactement true est éteint)
function cleanPushPrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return { reactions: r.reactions === true, follows: r.follows === true, coach: r.coach === true };
}
function pushAnyOn(prefs) { return !!prefs && PUSH_TYPES.some(t => prefs[t.id] === true); }

function pushStored() {
  try { const v = JSON.parse(localStorage.getItem(PUSH_KEY)); return v && typeof v.token === 'string' ? v : null; } catch { return null; }
}
function pushStore(v) { try { if (v) localStorage.setItem(PUSH_KEY, JSON.stringify(v)); else localStorage.removeItem(PUSH_KEY); } catch { /* rien */ } }

// Notifications possibles ici : app iOS avec le module, compte connecté
function pushPossible() { return Native.isNative && accountAvailable() && !!account.user; }

async function pushRpc(fn, args) {
  if (!sb || !account.user) return { ok: false, kind: 'signed_out' };
  try {
    const { data: res, error } = await sb.rpc(fn, args);
    return error ? { ok: false, kind: socialErrorKind(error) || 'server' } : { ok: true, data: res };
  } catch (e) { return { ok: false, kind: socialErrorKind(e) || 'server' }; }
}

// Lit l'autorisation d'iOS et les réglages du compte (écran Réglages › Notifications, démarrage)
async function pushLoad() {
  if (!pushPossible()) return false;
  const uid = account.user.id;
  const [permission, r] = await Promise.all([Native.push.permission(), pushRpc('push_prefs')]);
  if (account.user?.id !== uid) return false;
  push.userId = uid;
  push.permission = permission;
  if (r.ok) { push.prefs = cleanPushPrefs(r.data); push.error = null; } else push.error = r.kind;
  notifyPush();
  return r.ok;
}

// Inscrit le jeton de cet appareil pour le compte (rafraîchi à chaque lancement : iOS peut le changer).
// true si le serveur l'a.
async function pushRegisterDevice() {
  const dev = await Native.push.register();
  if (!dev || !account.user) return false;
  const r = await pushRpc('push_register', { token: dev.token, env: dev.environment });
  if (r.ok) pushStore({ userId: account.user.id, token: dev.token });
  return r.ok;
}

// Allume ou éteint un type. → { ok } ou { ok: false, reason: 'denied' | 'unavailable' | 'register' | <erreur> }
async function pushSetPref(id, on) {
  if (!PUSH_TYPES.some(t => t.id === id) || !pushPossible() || push.busy) return { ok: false, reason: 'busy' };
  push.busy = id; notifyPush();
  try {
    if (on) {
      let perm = await Native.push.permission();
      if (perm === 'prompt') perm = await Native.push.requestPermission();   // fenêtre d'iOS, après ce toucher seulement
      push.permission = perm;
      if (perm === 'unavailable') return { ok: false, reason: 'unavailable' };
      if (perm !== 'granted') return { ok: false, reason: 'denied' };
      if (!(await pushRegisterDevice())) return { ok: false, reason: 'register' };
    }
    const args = { reactions: null, follows: null, coach: null, [id]: on };
    const r = await pushRpc('push_set_prefs', args);
    if (!r.ok) return { ok: false, reason: r.kind };
    push.prefs = cleanPushPrefs(r.data);
    if (!pushAnyOn(push.prefs)) await pushForgetDevice();   // plus rien de voulu : le jeton quitte le compte
    return { ok: true };
  } finally { push.busy = null; notifyPush(); }
}

// Retire le jeton de cet appareil du compte encore connecté (déconnexion, effacement, tout éteint). Appelé
// AVANT la fin de session (il faut encore le jeton de session) ; au mieux, 3 s au plus : une déconnexion
// hors ligne ne doit pas attendre. Le serveur oublie de lui-même un jeton muet depuis 60 jours.
async function pushForgetDevice() {
  const st = pushStored();
  pushStore(null);
  if (!st || !sb) return;
  try {
    await Promise.race([sb.rpc('push_unregister', { token: st.token }), new Promise(r => setTimeout(r, 3000))]);
  } catch { /* hors ligne : oublié par le serveur plus tard */ }
}

// Écran ouvert par le toucher d'une notification ({ kind, ref } posés par push-send)
//   → { tab, screen, params } (screen null : racine de l'onglet) ; inconnu : null (l'app s'ouvre simplement).
// Une séance qui n'est pas (ou plus) sur cet appareil : l'Historique.
function pushTarget(p, history = []) {
  const kind = p?.kind, ref = typeof p?.ref === 'string' ? p.ref : '';
  if (kind === 'reaction' || kind === 'coach_note') {
    return ref && history.some(h => h.id === ref)
      ? { tab: 'history', screen: 'history-detail', params: [ref] } : { tab: 'history', screen: null, params: [] };
  }
  if (kind === 'follow_request') return { tab: 'friends', screen: null, params: [] };
  if (kind === 'coach_programme') return { tab: 'friends', screen: 'coach-mine', params: [] };
  return null;
}

// Connexion (ou autre compte) : réglages relus ; un type allumé et iOS d'accord → jeton rafraîchi
onAccountChange(() => {
  const id = account.user?.id || null;
  if (id === push.userId) return;
  push.userId = id; push.prefs = null; push.permission = null; push.error = null;
  notifyPush();
  if (!id || !pushPossible()) return;
  pushLoad().then(ok => {
    if (ok && pushAnyOn(push.prefs) && push.permission === 'granted') pushRegisterDevice().catch(() => {});
  }).catch(() => {});
});
