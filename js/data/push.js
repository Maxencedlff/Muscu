// ═══════════════════════════════════════════════════════════
//  Notifications push : réglages par type, jeton de l'appareil, écran à ouvrir au toucher
//  Contrat : docs/NOTIFICATIONS.md. Aucun affichage : l'écran (js/features/push-ui.js) s'abonne
//  avec onPushChange.
// ═══════════════════════════════════════════════════════════
'use strict';

// Rien n'est envoyé sans accord : chaque type est éteint par défaut sur le serveur (push_prefs), iOS a sa
// propre autorisation (demandée seulement quand on allume un type, ou à « Activer » de la demande en contexte), et le jeton n'est inscrit qu'à ce
// moment-là. Tout éteint, ou déconnexion : le jeton est retiré du compte (push_unregister). Session finie
// hors de l'app (jeton de rafraîchissement refusé), ou retrait qui n'a pas abouti (hors ligne, erreur,
// délai) : le marqueur reste, et le jeton est retiré à la connexion suivante d'un AUTRE compte sur cet
// iPhone (push_release), avant tout le reste.
// Ce que le serveur reçoit : le jeton APNs de l'appareil, son environnement (production / sandbox) et les
// interrupteurs. Rien d'autre (pas de modèle d'iPhone, pas de données Santé).

const PUSH_KEY = 'mdlf_push';   // { userId, token } : dernier jeton inscrit, pour le retirer à la déconnexion
// later : types arrivés avec 20261031910000_notifications_messages.sql. Un serveur d'avant ne les renvoie
// pas dans push_prefs : leurs interrupteurs ne sont pas montrés, et push_set_prefs part avec 3 arguments.
const PUSH_TYPES = [
  { id: 'reactions', title: 'Réactions', sub: 'Quand quelqu’un réagit à une de tes séances' },
  { id: 'comments', title: 'Commentaires', sub: 'Quand quelqu’un commente une de tes séances', later: true },
  { id: 'follows', title: 'Demandes d’abonnement', sub: 'Quand quelqu’un veut suivre tes séances' },
  { id: 'coach', title: 'Mon coach', sub: 'Commentaire sur une séance, nouveau programme' },
  { id: 'messages', title: 'Messages', sub: 'Quand ton coach ou un de tes élèves t’écrit', later: true },
  // 20261116020000_notifications_seances_eleves.sql ; montré aux coachs seulement (ou s'il est déjà allumé)
  { id: 'student_sessions', title: 'Séances de mes élèves', sub: 'Quand un élève termine une séance', later: true, coachOnly: true },
];

// prefs : réglages lus sur le serveur (null tant que non lus) ; permission : celle d'iOS
// ('prompt' | 'granted' | 'denied' | 'unavailable' : build sans le module, navigateur) ; busy : un
// interrupteur en cours d'écriture ; error : dernière erreur de lecture ('offline', 'server').
const push = { userId: null, prefs: null, permission: null, busy: null, error: null, retriedAt: null };
const pushListeners = [];
function onPushChange(fn) { pushListeners.push(fn); }
function notifyPush() { for (const fn of pushListeners) { try { fn(); } catch { /* écran absent */ } } }

// Réponse du serveur → un booléen par type (tout ce qui n'est pas exactement true est éteint). Un type
// « later » n'y est que si le serveur le connaît (il le renvoie en booléen).
function cleanPushPrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const t of PUSH_TYPES) if (!t.later || typeof r[t.id] === 'boolean') out[t.id] = r[t.id] === true;
  return out;
}
// Types que le serveur connaît (interrupteurs montrés) ; réglages pas encore lus : ceux d'avant
function pushShownTypes(prefs = push.prefs) {
  return PUSH_TYPES.filter(t => (prefs ? t.id in prefs : !t.later) && (!t.coachOnly || prefs?.[t.id] === true || coachRole().isCoach));
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

// Autorisation d'iOS (fenêtre seulement si jamais demandée, donc après un toucher) puis jeton inscrit.
// null si tout va bien, sinon la raison : 'denied' | 'unavailable' | 'register'
async function pushEnsureDevice() {
  let perm = await Native.push.permission();
  if (perm === 'prompt') perm = await Native.push.requestPermission();   // fenêtre d'iOS, après ce toucher seulement
  push.permission = perm;
  if (perm === 'unavailable') return 'unavailable';
  if (perm !== 'granted') return 'denied';
  return (await pushRegisterDevice()) ? null : 'register';
}

// Réglages allumés sur le compte, mais cet iPhone n'a encore ni l'accord d'iOS ni de jeton (app
// réinstallée, nouvel iPhone) : rien n'arrivera tant qu'on n'a pas réactivé ici (pushReactivate)
function pushNeedsReactivate() { return push.permission === 'prompt' && pushAnyOn(push.prefs); }

// « Réactiver sur cet iPhone » : demande à iOS et inscrit le jeton ; les réglages du compte restent.
// → { ok } ou { ok: false, reason: 'busy' | 'denied' | 'unavailable' | 'register' }
async function pushReactivate() {
  if (!pushPossible() || push.busy) return { ok: false, reason: 'busy' };
  push.busy = 'reactivate'; notifyPush();
  try {
    const fail = await pushEnsureDevice();
    return fail ? { ok: false, reason: fail } : { ok: true };
  } finally { push.busy = null; notifyPush(); }
}

// Allume ou éteint un type. → { ok } ou { ok: false, reason: 'denied' | 'unavailable' | 'register' | <erreur> }
async function pushSetPref(id, on) {
  if (!pushShownTypes().some(t => t.id === id) || !pushPossible() || push.busy) return { ok: false, reason: 'busy' };
  push.busy = id; notifyPush();
  try {
    if (on) {
      const fail = await pushEnsureDevice();
      if (fail) return { ok: false, reason: fail };
    }
    // null = inchangé ; seulement les types que le serveur connaît (3 ou 5 : PostgREST choisit la version)
    const args = { ...Object.fromEntries(pushShownTypes().map(t => [t.id, null])), [id]: on };
    const r = await pushRpc('push_set_prefs', args);
    if (!r.ok) return { ok: false, reason: r.kind };
    push.prefs = cleanPushPrefs(r.data);
    if (!pushAnyOn(push.prefs)) await pushForgetDevice();   // plus rien de voulu : le jeton quitte le compte
    return { ok: true };
  } finally { push.busy = null; notifyPush(); }
}

// Compte de la session de supabase-js (lecture locale), même quand account.user est déjà vidé ou pas
// encore posé (déconnexion en cours, choix de fusion)
async function pushSessionUserId() {
  try { const { data: res } = await sb.auth.getSession(); return res?.session?.user?.id || null; } catch { return null; }
}

// Retire le jeton de cet appareil (déconnexion, effacement, tout éteint). Appelé AVANT la fin de session
// (il faut encore le jeton de session) ; 3 s au plus : une déconnexion hors ligne ne doit pas attendre.
// Jeton inscrit par un AUTRE compte que celui de la session (sa session a fini hors de l'app, puis la
// connexion d'un autre compte est annulée au choix de fusion) : push_release, push_unregister ne retirant
// que les miens.
// Le marqueur mdlf_push n'est vidé qu'après la réponse sans erreur du serveur. Sans session, hors ligne,
// erreur ou délai dépassé : il reste, et la connexion suivante d'un autre compte retire le jeton
// (pushReleaseOther) ; sinon les notifications de ce compte arriveraient chez le suivant.
let PUSH_FORGET_TIMEOUT_MS = 3000;
async function pushForgetDevice() {
  const st = pushStored();
  if (!st || !sb) return;
  const uid = await pushSessionUserId();
  if (!uid) return;   // push_unregister ne ferait rien sans session : gardé pour la connexion suivante
  const fn = uid !== st.userId ? 'push_release' : 'push_unregister';
  let timer;
  try {
    const res = await Promise.race([
      sb.rpc(fn, { token: st.token }),
      new Promise(r => { timer = setTimeout(() => r({ error: 'timeout' }), PUSH_FORGET_TIMEOUT_MS); }),
    ]);
    if (res?.error) return;
  } catch { return; } finally { clearTimeout(timer); }
  const now = pushStored();   // une inscription faite entre-temps reste
  if (now?.token === st.token && now.userId === st.userId) pushStore(null);
}

// Connexion d'un compte alors que cet iPhone garde le jeton inscrit par un autre (session de l'autre finie
// hors de l'app) : le jeton quitte l'autre compte, sinon ses notifications arriveraient ici. Le serveur ne
// touche jamais à un jeton de ce compte (inscription faite entre-temps). Échec (hors ligne) : gardé en
// mémoire, réessayé au prochain lancement. true si plus rien n'est à retirer.
async function pushReleaseOther(uid) {
  const st = pushStored();
  if (!st || st.userId === uid) return true;
  const r = await pushRpc('push_release', { token: st.token });
  if (!r.ok) return false;
  if (pushStored()?.userId === st.userId) pushStore(null);   // une inscription de ce compte entre-temps reste
  return true;
}

// Écran ouvert par le toucher d'une notification ({ kind, ref } posés par push-send)
//   → { tab, screen, params, via? } (screen null : racine de l'onglet ; via : écran ouvert avant, pour le retour) ;
//   inconnu : null (l'app s'ouvre simplement).
// Une séance qui n'est pas (ou plus) sur cet appareil : l'Historique. Message : ref = clé de la
// conversation, décidée par le serveur ('@coach' = CHAT_COACH : avec mon coach ; l'id d'un élève : avec
// lui), sans dépendre du compte connecté (pas encore chargé quand on touche la notification app fermée).
const PUSH_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function pushTarget(p, history = []) {
  const kind = p?.kind, ref = typeof p?.ref === 'string' ? p.ref : '';
  if (kind === 'chat_message') {
    if (ref !== CHAT_COACH && !PUSH_UUID_RE.test(ref)) return { tab: 'friends', screen: null, params: [] };
    return { tab: 'friends', screen: 'coach-chat', params: [ref] };
  }
  if (kind === 'reaction' || kind === 'coach_note' || kind === 'comment') {
    return ref && history.some(h => h.id === ref)
      ? { tab: 'history', screen: 'history-detail', params: [ref] } : { tab: 'history', screen: null, params: [] };
  }
  if (kind === 'follow_request') return { tab: 'friends', screen: null, params: [] };
  // Séance d'un de mes élèves (coach) : ref = '<id de l'élève>/<id de la séance>' (ou l'id seul, séance trop
  // longue pour la notification) → sa fiche, puis la séance (la fiche charge ses séances)
  if (kind === 'student_session') {
    const cut = ref.indexOf('/'), student = cut < 0 ? ref : ref.slice(0, cut), sid = cut < 0 ? '' : ref.slice(cut + 1);
    if (!PUSH_UUID_RE.test(student)) return { tab: 'friends', screen: null, params: [] };
    return sid ? { tab: 'friends', screen: 'coach-session', params: [student, sid], via: ['coach-student', student] }
      : { tab: 'friends', screen: 'coach-student', params: [student] };
  }
  // Plan diète (ref diet_<…>, js/data/nutrition.js) : écran Nutrition, où il se prend d'un toucher
  if (kind === 'coach_programme' && ref.startsWith('diet_')) return { tab: 'train', screen: 'nutrition', params: [] };
  if (kind === 'coach_programme') return { tab: 'friends', screen: 'coach-mine', params: [] };
  return null;
}

// Connexion (ou autre compte) : jeton laissé par un autre compte retiré, réglages relus ; un type allumé
// et iOS d'accord → jeton rafraîchi. Rendu pour les tests.
function pushOnAccount() {
  const id = account.user?.id || null;
  if (id === push.userId) return null;
  push.userId = id; push.prefs = null; push.permission = null; push.error = null;
  notifyPush();
  if (!id || !pushPossible()) return null;
  return pushReleaseOther(id).then(() => pushLoad()).then(ok => {
    if (ok && account.user?.id === id && pushAnyOn(push.prefs) && push.permission === 'granted') return pushRegisterDevice();
    return false;
  }).catch(() => false);
}
onAccountChange(() => { pushOnAccount(); });

// ── Demande en contexte (coach ↔ élève) ─────────────────────
// Les types restent éteints par défaut sur le serveur : on propose de les allumer au moment où ils ont un
// sens (lien avec un coach accepté, Mes élèves avec au moins un élève, première ouverture d'une
// conversation), jamais au premier lancement. « Activer » : fenêtre d'iOS, jeton inscrit, puis les types
// utiles allumés (réactions et abonnements inchangés). « Plus tard » : pas avant 7 jours, 2 fois au plus.
// Mémoire sur cet iPhone seulement (l'autorisation d'iOS l'est aussi) : { n, at, done }.
const PUSH_ASK_KEY = 'mdlf_push_ask';
const PUSH_ASK_WAIT_MS = 7 * 86400_000;
const PUSH_ASK_MAX = 2;
// Types allumés par « Activer » : l'élève garde aussi les commentaires sur ses séances ; le coach, les séances
// de ses élèves. PUSH_ASK_KEYS : ceux qui, déjà allumés ici, rendent la demande inutile
const PUSH_ASK_TYPES = { student: ['messages', 'coach', 'comments'], coach: ['messages', 'coach', 'student_sessions'] };
const PUSH_ASK_KEYS = { student: ['messages'], coach: ['messages', 'student_sessions'] };
// Premier lancement : celui des questions de départ (js/features/onboarding.js), lu au chargement
const PUSH_ASK_FIRST_LAUNCH = typeof data === 'object' && !!data && !data.onboarded && !(data.history || []).length;

function pushAskStored() {
  try { const v = JSON.parse(localStorage.getItem(PUSH_ASK_KEY)); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function pushAskStore(v) { try { localStorage.setItem(PUSH_ASK_KEY, JSON.stringify(v)); } catch { /* redemandé plus tard, au pire */ } }
function pushAskLater(now = Date.now()) {
  const s = pushAskStored();
  pushAskStore({ ...s, n: (Number.isInteger(s.n) ? s.n : 0) + 1, at: now });
}
function pushAskDone() { pushAskStore({ ...pushAskStored(), done: true }); }

// Types que « Activer » allume, parmi ceux que le serveur connaît
function pushAskWanted(role, prefs) {
  return (PUSH_ASK_TYPES[role] || []).filter(id => !!prefs && id in prefs);
}

// Mémoire locale seule (sans réseau) : la demande est-elle encore possible ?
function pushAskOpen(state, now, firstLaunch = PUSH_ASK_FIRST_LAUNCH) {
  if (firstLaunch || state?.done) return false;
  const n = Number.isInteger(state?.n) ? state.n : 0;
  if (n >= PUSH_ASK_MAX) return false;
  return !(Number.isFinite(state?.at) && now - state.at < PUSH_ASK_WAIT_MS);
}

// → 'ask' (proposer), 'done' (déjà allumé ici : ne plus jamais demander), 'skip' (pas maintenant)
function pushAskDecision({ role, permission, prefs, state, now, firstLaunch = PUSH_ASK_FIRST_LAUNCH }) {
  if (!pushAskOpen(state, now, firstLaunch) || !prefs) return 'skip';
  const wanted = pushAskWanted(role, prefs);
  if (!wanted.includes('messages')) return 'skip';   // serveur sans les messages : rien d'utile à proposer
  if (permission === 'granted' && PUSH_ASK_KEYS[role].every(id => !(id in prefs) || prefs[id] === true)) return 'done';
  // Refus d'iOS : la fenêtre ne reviendrait pas (la conversation montre la ligne vers Réglages) ;
  // build sans le module : rien à proposer
  if (permission !== 'prompt' && permission !== 'granted') return 'skip';
  return 'ask';
}

// Lit l'état (mémoire, puis autorisation et réglages) et décide, pour role 'student' | 'coach'
async function pushAskCheck(role, now = Date.now(), firstLaunch = PUSH_ASK_FIRST_LAUNCH) {
  if (!pushPossible() || !pushAskOpen(pushAskStored(), now, firstLaunch)) return 'skip';
  if (!(await pushLoad())) return 'skip';
  return pushAskDecision({ role, permission: push.permission, prefs: push.prefs, state: pushAskStored(), now, firstLaunch });
}

// « Activer » : autorisation d'iOS et jeton, puis les types utiles allumés en un appel (null = inchangé)
// → { ok } ou { ok: false, reason: 'busy' | 'denied' | 'unavailable' | 'register' | <erreur> }
async function pushEnableFor(role) {
  if (!pushPossible() || push.busy || !push.prefs) return { ok: false, reason: 'busy' };
  push.busy = 'ask'; notifyPush();
  try {
    const fail = await pushEnsureDevice();
    if (fail) return { ok: false, reason: fail };
    const args = { ...Object.fromEntries(pushShownTypes().map(t => [t.id, null])),
      ...Object.fromEntries(pushAskWanted(role, push.prefs).map(id => [id, true])) };
    const r = await pushRpc('push_set_prefs', args);
    if (!r.ok) return { ok: false, reason: r.kind };
    push.prefs = cleanPushPrefs(r.data);
    return { ok: true };
  } finally { push.busy = null; notifyPush(); }
}

// Autorisation d'iOS relue (retour des Réglages de l'iPhone) ; prévient l'écran si elle a changé
async function pushRefreshPermission() {
  if (!pushPossible()) return;
  const p = await Native.push.permission();
  if (p !== push.permission) { push.permission = p; notifyPush(); }
}
// Notifications refusées dans iOS pour cette app (ligne discrète de la conversation)
function pushDeniedHere() { return pushPossible() && push.permission === 'denied'; }
