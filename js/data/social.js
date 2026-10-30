// ═══════════════════════════════════════════════════════════
//  Amis (Social V1) : appels au serveur et logique pure, sans affichage
//
//  - Contrat serveur / app : docs/SOCIAL_V1.md (noms des fonctions RPC, retours, erreurs). Tout passe
//    par des fonctions RPC (security definer, rôle authenticated) et par la fonction Edge report ;
//    aucune lecture directe des tables des autres.
//  - Comptes privés : on ne voit les séances de quelqu'un qu'après qu'il a accepté la demande. Le
//    serveur filtre chaque séance (liste blanche private.session_public) ; l'app nettoie quand même ce
//    qu'elle reçoit (cleanPublicSession, cleanPerson) et l'écran échappe tout texte venu du serveur.
//  - Rien ne bloque le démarrage : l'état (social_state) est relu en arrière-plan à l'ouverture de
//    l'app (connexion reprise), au retour au premier plan et à l'ouverture de l'onglet Amis. Le dernier
//    état lu est gardé sur l'appareil (SOCIAL_CACHE_KEY : activé et badge seulement) pour que l'onglet
//    et le badge restent justes hors ligne.
//  - Blocage jamais révélé : une demande vers quelqu'un qui t'a bloqué (ou sans social) répond
//    'requested' et devient une demande « fantôme » côté serveur, listée dans requested comme les
//    autres : l'app l'affiche comme une demande envoyée, sans rien de particulier.
//  - Fil paginé par curseur complet (done_at, owner, id de la dernière carte), paramètres nommés.
//  - Erreurs : message court en snake_case du serveur (socialErrorKind) → SOCIAL_ERROR_TEXT.
//  - Résultats : { ok: true, data } ou { ok: false, kind }. L'écran (js/features/social-ui.js)
//    s'abonne par onSocialChange.
// ═══════════════════════════════════════════════════════════
'use strict';

const SOCIAL_CACHE_KEY  = 'mdlf_social';   // { userId, enabled, badge } du dernier état lu
const SOCIAL_QUERY_MIN  = 2;               // recherche : 2 caractères au moins (comme le serveur)
const SOCIAL_PAGE       = 20;              // séances par page du fil (comme le serveur)
const SOCIAL_REFRESH_MS = 30_000;          // retour au premier plan : une relecture toutes les 30 s au plus
const REPORT_DETAILS_MAX = 500;
// Motifs de la fonction report, dans l'ordre de la feuille « Signaler »
const REPORT_REASONS = [
  { reason: 'spam', label: 'Spam ou publicité' },
  { reason: 'harcelement', label: 'Harcèlement' },
  { reason: 'sexuel', label: 'Contenu sexuel' },
  { reason: 'violence', label: 'Violence' },
  { reason: 'haine', label: 'Propos haineux' },
  { reason: 'autre', label: 'Autre chose' },
];

// state : dernier social_state nettoyé (null : pas encore lu) ; feeds : fil ('') et séances d'un profil
// (clé : identifiant) ; people : pseudo et avatar connus par identifiant (écran d'un profil) ; bravos :
// bravos reçus sur mes séances (my_bravos), par identifiant de séance
const social = { userId: null, state: null, cached: null, loading: false, error: null, loadedAt: 0,
  feeds: {}, people: {}, bravos: {}, bravosAt: 0 };
const socialListeners = [];
let socialSeq = 0;   // +1 à chaque changement de compte : une réponse arrivée après n'écrit plus rien

function onSocialChange(fn) { socialListeners.push(fn); }
function notifySocial() { for (const fn of socialListeners) { try { fn(); } catch { /* écran absent */ } } }

// ── Logique pure ────────────────────────────────────────────

// Personne reçue du serveur : { user_id, username, avatar, since }. Pseudo de la forme du serveur
// (USERNAME_RE), avatar de la liste blanche, sinon l'initiale ; null si l'identifiant manque
function cleanPerson(p) {
  if (!p || typeof p !== 'object' || typeof p.user_id !== 'string' || !p.user_id) return null;
  const username = typeof p.username === 'string' && USERNAME_RE.test(p.username) ? p.username : null;
  return { user_id: p.user_id, username, avatar: validAvatar(p.avatar), since: p.since || null };
}
function cleanPeople(list) { return Array.isArray(list) ? list.map(cleanPerson).filter(Boolean) : []; }

// social_state() nettoyé : { enabled, username, avatar, pending_in, following, followers, requested, blocked, badge }
function cleanSocialState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const pendingIn = cleanPeople(r.pending_in);
  const badge = Number.isInteger(r.badge) && r.badge >= 0 ? r.badge : pendingIn.length;
  return { enabled: r.enabled === true, username: typeof r.username === 'string' ? r.username : null, avatar: validAvatar(r.avatar),
    pending_in: pendingIn, following: cleanPeople(r.following), followers: cleanPeople(r.followers),
    requested: cleanPeople(r.requested), blocked: cleanPeople(r.blocked), badge };
}

// Séance d'un autre, telle que la liste blanche du serveur la décrit : { date, duration, programme,
// category, label, exercises: [{ name, measure, ss, sets: [{ weight, reps, dist }] }] }. Rien d'autre n'est
// gardé, chaque champ est borné ; textes laissés bruts (échappés à l'affichage)
function cleanPublicSession(s) {
  const o = s && typeof s === 'object' ? s : {};
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const numStr = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && Number.isFinite(parseFloat(v)) ? v.slice(0, 12) : '');
  const exercises = (Array.isArray(o.exercises) ? o.exercises : []).slice(0, 60)
    .filter(e => e && typeof e === 'object' && typeof e.name === 'string' && e.name.trim())
    .map(e => ({
      name: e.name.slice(0, 80),
      // Mesure absente : son app n'en écrivait pas (version d'avant) ; mots de cardio appris depuis : répétitions
      ...(['reps', 'time', 'cardio'].includes(e.measure) ? { measure: e.measure } : pinnedLegacyMeasure(e.name)),
      ...(ssId(e) ? { ss: e.ss } : {}),
      sets: (Array.isArray(e.sets) ? e.sets : []).slice(0, 50).filter(st => st && typeof st === 'object')
        .map(st => ({ weight: numStr(st.weight), reps: numStr(st.reps), ...(numStr(st.dist) ? { dist: numStr(st.dist) } : {}) })),
    }));
  return {
    date: Number.isFinite(o.date) ? o.date : null,
    duration: Number.isFinite(o.duration) && o.duration > 0 ? o.duration : null,
    programme: str(o.programme, 40), category: str(o.category, 40),
    label: str(o.label, 60).trim() || 'Séance', exercises,
  };
}

function pinnedLegacyMeasure(name) { const ex = { name }; pinLegacyCardioWords(ex); return ex.measure ? { measure: ex.measure } : {}; }

// Ligne de feed() : { owner, username, avatar, id, doneAt, s, bravos, mine }, null si inutilisable
function cleanFeedRow(r) {
  if (!r || typeof r !== 'object' || typeof r.owner !== 'string' || typeof r.id !== 'string') return null;
  const p = cleanPerson({ user_id: r.owner, username: r.username, avatar: r.avatar });
  if (!p) return null;
  const s = cleanPublicSession(r.s);
  const doneAt = Number.isFinite(Number(r.done_at)) ? Number(r.done_at) : s.date;
  if (!Number.isFinite(doneAt)) return null;
  return { owner: r.owner, username: p.username, avatar: p.avatar, id: r.id, doneAt, s,
    bravos: Number.isInteger(r.bravos) && r.bravos > 0 ? r.bravos : 0, mine: r.my_bravo === true };
}

// Recherche : même normalisation que le serveur (minuscules, sans accent, sans @), '' sous 2 caractères
function normalizeSocialQuery(raw) {
  const q = normalizeUsername(raw).replace(/[^a-z0-9._]/g, '');
  return q.length >= SOCIAL_QUERY_MIN ? q.slice(0, USERNAME_MAX) : '';
}

// Relation avec une personne, d'après l'état : 'self', 'blocked', 'following', 'requested', 'none' ;
// followsYou et pendingIn (demande reçue) en plus
function socialRelation(userId, state) {
  const has = list => (list || []).some(p => p.user_id === userId);
  const st = state || {};
  const base = { followsYou: has(st.followers), pendingIn: has(st.pending_in) };
  if (userId === social.userId) return { ...base, status: 'self' };
  if (has(st.blocked)) return { ...base, status: 'blocked' };
  if (has(st.following)) return { ...base, status: 'following' };
  if (has(st.requested)) return { ...base, status: 'requested' };
  return { ...base, status: 'none' };
}

// Résumé des exercices d'une carte : « Squat, Presse à cuisses, Leg curl et 2 autres » (texte brut)
function feedExercisesLine(s, max = 3) {
  const names = (s?.exercises || []).map(e => e.name);
  if (names.length <= max + 1) return names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : (names[0] || '');
  return `${names.slice(0, max).join(', ')} et ${names.length - max} autres`;
}

// Erreur du serveur → clé de SOCIAL_ERROR_TEXT. Exceptions des RPC : message en snake_case (code P0001) ;
// fonction report : corps { error } de la réponse, ou statut 429
function socialErrorKind(error) {
  if (!error) return null;
  if (isNetworkError(error) || /fetch|network|load failed/i.test(String(error.message || ''))) return 'offline';
  const msg = String(error.message || error.error || '');
  for (const k of ['social_not_enabled', 'username_required', 'age_required', 'rate_limited', 'not_found']) if (msg.includes(k)) return k;
  if (error.status === 429) return 'rate_limited';
  return 'server';
}
const SOCIAL_ERROR_TEXT = {
  offline: 'Pas d\'Internet : réessaie avec du réseau.',
  social_not_enabled: 'Active d\'abord les amis dans l\'onglet Amis.',
  username_required: 'Choisis d\'abord un pseudo.',
  age_required: 'Confirme que tu as 15 ans ou plus.',
  rate_limited: 'Trop d\'actions aujourd\'hui. Réessaie demain.',
  not_found: 'Cette séance n\'est plus visible.',
  signed_out: 'Connecte-toi d\'abord à ton compte.',
  report_rate: 'Tu as envoyé beaucoup de signalements aujourd\'hui. Réessaie demain ou écris à contact@mdlf.app.',
  report_gone: 'Ce compte n\'existe plus.',
  report_auth: 'Ta connexion a expiré. Reconnecte-toi, puis réessaie.',
  report_invalid: 'Signalement refusé. Réessaie, ou écris à contact@mdlf.app.',
  server: 'Action impossible pour l\'instant, réessaie dans un moment.',
};
function socialErrorText(kind) { return SOCIAL_ERROR_TEXT[kind] || SOCIAL_ERROR_TEXT.server; }

// ── État lu et caché ────────────────────────────────────────

function readSocialCache(userId) {
  try {
    const c = JSON.parse(localStorage.getItem(SOCIAL_CACHE_KEY));
    return c && c.userId === userId ? { enabled: c.enabled === true, badge: Number.isInteger(c.badge) ? c.badge : 0 } : null;
  } catch { return null; }
}
function writeSocialCache() {
  if (!social.userId || !social.state) return;
  try { localStorage.setItem(SOCIAL_CACHE_KEY, JSON.stringify({ userId: social.userId, enabled: social.state.enabled, badge: social.state.badge })); }
  catch { /* cache facultatif */ }
}

// Social activé : état lu, sinon dernier état connu sur l'appareil
function socialEnabled() { return !!account.user && !!(social.state ? social.state.enabled : social.cached?.enabled); }
// Badge de l'onglet : demandes reçues en attente
function socialBadge() {
  if (!account.user) return 0;
  return social.state ? (social.state.enabled ? social.state.badge : 0) : (social.cached?.enabled ? social.cached.badge : 0);
}

function rememberPeople(list) {
  for (const p of list || []) if (p?.user_id) social.people[p.user_id] = { username: p.username, avatar: p.avatar };
}
function socialPerson(userId) { return social.people[userId] || null; }

// Compte changé (connexion, déconnexion, autre compte) : tout repart de zéro, lecture en arrière-plan
function socialReset(userId) {
  socialSeq++;
  Object.assign(social, { userId, state: null, cached: userId ? readSocialCache(userId) : null, loading: false, error: null, loadedAt: 0,
    feeds: {}, people: {}, bravos: {}, bravosAt: 0 });
}

// ── Appels au serveur ───────────────────────────────────────

// Fonction RPC ; { ok, data } ou { ok: false, kind }. Réponse d'un compte qui n'est plus connecté : ignorée
async function socialRpc(fn, args) {
  if (!sb || !account.user) return { ok: false, kind: 'signed_out' };
  const seq = socialSeq;
  try {
    const { data: res, error } = await sb.rpc(fn, args);
    if (seq !== socialSeq) return { ok: false, kind: 'signed_out' };
    return error ? { ok: false, kind: socialErrorKind(error) } : { ok: true, data: res };
  } catch (e) {
    return { ok: false, kind: socialErrorKind(e) || 'server' };
  }
}

// Relit social_state (et les bravos reçus si le social est activé). minAge : pas de relecture si le
// dernier état a moins de minAge ms. Renvoie true si l'état a pu être lu.
async function socialRefresh({ minAge = 0 } = {}) {
  if (!sb || !account.user || social.loading) return false;
  if (minAge && social.state && Date.now() - social.loadedAt < minAge) return true;
  social.loading = true;
  const seq = socialSeq;
  const r = await socialRpc('social_state');
  if (seq !== socialSeq) return false;
  social.loading = false;
  if (!r.ok) { social.error = r.kind; notifySocial(); return false; }
  social.state = cleanSocialState(r.data);
  social.error = null;
  social.loadedAt = Date.now();
  const st = social.state;
  rememberPeople([...st.pending_in, ...st.following, ...st.followers, ...st.requested, ...st.blocked]);
  writeSocialCache();
  notifySocial();
  if (st.enabled) socialLoadMyBravos();
  return true;
}

async function socialEnable(ageOk) {
  const r = await socialRpc('social_enable', { age_ok: ageOk === true });
  if (r.ok) await socialRefresh();
  return r;
}
async function socialDisable() {
  const r = await socialRpc('social_disable');
  if (r.ok) { social.feeds = {}; await socialRefresh(); }
  return r;
}

// Recherche par début de pseudo : { ok, data: [{ user_id, username, avatar, relation }] }
async function socialSearch(raw) {
  const q = normalizeSocialQuery(raw);
  if (!q) return { ok: true, data: [] };
  const r = await socialRpc('search_profiles', { q });
  if (!r.ok) return r;
  const rows = (Array.isArray(r.data) ? r.data : []).map(x => {
    const p = cleanPerson(x);
    return p && p.username ? { ...p, relation: ['none', 'requested', 'following', 'follows_you'].includes(x.relation) ? x.relation : 'none' } : null;
  }).filter(Boolean);
  rememberPeople(rows);
  return { ok: true, data: rows };
}

// Demande d'abonnement : 'requested' ou 'following'
async function socialRequestFollow(target) {
  const r = await socialRpc('request_follow', { target });
  if (!r.ok) return r;
  await socialRefresh();
  return { ok: true, data: r.data === 'following' ? 'following' : 'requested' };
}
// Demande ou abonnement retiré : ses séances quittent le fil
async function socialCancelFollow(target) {
  const r = await socialRpc('cancel_follow', { target });
  if (r.ok) { dropFromFeeds(target); await socialRefresh(); }
  return r;
}
async function socialRespond(follower, accept) {
  const r = await socialRpc('respond_follow', { follower, accept: accept === true });
  if (r.ok) await socialRefresh();
  return r;
}
async function socialRemoveFollower(follower) {
  const r = await socialRpc('remove_follower', { follower });
  if (r.ok) await socialRefresh();
  return r;
}
async function socialBlock(target) {
  const r = await socialRpc('block_user', { target });
  if (r.ok) { dropFromFeeds(target); await socialRefresh(); }
  return r;
}
async function socialUnblock(target) {
  const r = await socialRpc('unblock_user', { target });
  if (r.ok) await socialRefresh();
  return r;
}

// ── Fil ─────────────────────────────────────────────────────

// Fil ('') ou séances d'un profil (identifiant) : { rows, end, loading, error, loadedAt, triedAt }
function socialFeed(key = '') {
  return social.feeds[key] ||= { rows: [], end: false, loading: false, error: null, loadedAt: 0 };
}
function dropFromFeeds(owner) {
  delete social.feeds[owner];
  const f = social.feeds[''];
  if (f) f.rows = f.rows.filter(r => r.owner !== owner);
}

// Charge la première page (more : false) ou la suivante (curseur : done_at, owner et id de la dernière
// carte ; deux séances à la même milliseconde ne sont ni perdues ni doublées). Paramètres toujours
// nommés. Renvoie { ok } ; le fil est dans socialFeed(key).
async function socialLoadFeed(key = '', { more = false } = {}) {
  const f = socialFeed(key);
  if (f.loading || (more && f.end)) return { ok: true };
  f.loading = true;
  f.triedAt = social.loadedAt;   // essai fait avec cet état (socialFeedNeedsLoad)
  const seq = socialSeq;
  notifySocial();
  const last = more ? f.rows[f.rows.length - 1] : null;
  const args = last ? { before_at: last.doneAt, before_owner: last.owner, before_id: last.id } : {};
  if (key) args.only_user = key;
  const r = await socialRpc('feed', args);
  if (seq !== socialSeq) return { ok: false, kind: 'signed_out' };
  f.loading = false;
  if (!r.ok) { f.error = r.kind; notifySocial(); return r; }
  const rows = (Array.isArray(r.data) ? r.data : []).map(cleanFeedRow).filter(Boolean);
  rememberPeople(rows.map(x => ({ user_id: x.owner, username: x.username, avatar: x.avatar })));
  const seen = new Set(more ? f.rows.map(x => x.owner + '/' + x.id) : []);
  f.rows = [...(more ? f.rows : []), ...rows.filter(x => !seen.has(x.owner + '/' + x.id))];
  f.end = (Array.isArray(r.data) ? r.data.length : 0) < SOCIAL_PAGE;
  f.error = null;
  f.loadedAt = Date.now();
  notifySocial();
  return { ok: true };
}

// Fil affiché à charger d'office : Amis activé, jamais chargé, pas en cours, et pas déjà essayé avec
// l'état social actuel. Cas : premier passage sur Amis hors ligne puis réseau revenu (l'état relu
// relance le fil), onglet ouvert pendant la première lecture de l'état (Amis activé connu après).
// Une seule tentative par lecture de l'état : un fil en erreur ne boucle pas sur ses propres notifications.
function socialFeedNeedsLoad(key = '') {
  if (!socialEnabled()) return false;
  const f = socialFeed(key);
  return !f.loading && !f.loadedAt && f.triedAt !== social.loadedAt;
}

// Séance d'un autre déjà reçue (fil ou profil), ou null
function socialSessionOf(owner, id) {
  for (const f of Object.values(social.feeds)) {
    const row = f.rows.find(r => r.owner === owner && r.id === id);
    if (row) return row;
  }
  return null;
}

// Bravo donné ou retiré : affiché tout de suite, corrigé par la réponse du serveur (ou annulé)
async function socialToggleBravo(owner, id) {
  const copies = Object.values(social.feeds).map(f => f.rows.find(r => r.owner === owner && r.id === id)).filter(Boolean);
  if (!copies.length) return { ok: false, kind: 'not_found' };
  const before = { bravos: copies[0].bravos, mine: copies[0].mine };
  const set = (bravos, mine) => copies.forEach(c => { c.bravos = Math.max(0, bravos); c.mine = mine; });
  set(before.bravos + (before.mine ? -1 : 1), !before.mine);
  notifySocial();
  const r = await socialRpc('toggle_bravo', { owner, session_id: id });
  if (!r.ok) { set(before.bravos, before.mine); notifySocial(); return r; }
  if (Number.isInteger(r.data?.bravos) && typeof r.data?.mine === 'boolean') { set(r.data.bravos, r.data.mine); notifySocial(); }
  return { ok: true };
}

// Bravos reçus sur mes séances (Historique) ; minAge comme socialRefresh
async function socialLoadMyBravos({ minAge = 0 } = {}) {
  if (minAge && Date.now() - social.bravosAt < minAge) return;
  social.bravosAt = Date.now();
  const r = await socialRpc('my_bravos');
  if (!r.ok) return;
  const next = {};
  for (const x of Array.isArray(r.data) ? r.data : []) if (typeof x?.session_id === 'string' && Number.isInteger(x.bravos) && x.bravos > 0) next[x.session_id] = x.bravos;
  if (JSON.stringify(next) === JSON.stringify(social.bravos)) return;
  social.bravos = next;
  notifySocial();
}
function myBravos(sessionId) { return social.bravos[sessionId] || 0; }

// ── Signalement (fonction Edge report) ──────────────────────

// { target, kind: 'profile' | 'session', ref?, reason, details? } → { ok } ou { ok: false, kind }
async function socialReport({ target, kind, ref = null, reason, details = '' }) {
  if (!sb || !account.user) return { ok: false, kind: 'signed_out' };
  if (!REPORT_REASONS.some(r => r.reason === reason) || !['profile', 'session'].includes(kind)) return { ok: false, kind: 'server' };
  const body = { target_user: target, kind, reason };
  if (ref) body.target_ref = String(ref);
  const d = String(details || '').trim().slice(0, REPORT_DETAILS_MAX);
  if (d) body.details = d;
  try {
    const { data: res, error } = await sb.functions.invoke('report', { body });
    if (error) {
      // Réponse d'erreur de la fonction : error.context est la réponse HTTP (FunctionsHttpError)
      // (400 invalid, 401 auth, 404 not_found : compte visé inconnu, 429 rate_limited : 10 par jour, 500)
      let info = {};
      try { info = await error.context.json(); } catch { /* corps illisible */ }
      const status = error.context?.status;
      if (status === 429 || info?.error === 'rate_limited') return { ok: false, kind: 'report_rate' };
      if (status === 404) return { ok: false, kind: 'report_gone' };
      if (status === 401) return { ok: false, kind: 'report_auth' };
      if (status === 400) return { ok: false, kind: 'report_invalid' };
      return { ok: false, kind: socialErrorKind({ message: String(info?.error || error.message || ''), status }) };
    }
    return res?.ok === true ? { ok: true } : { ok: false, kind: 'server' };
  } catch (e) { return { ok: false, kind: socialErrorKind(e) || 'server' }; }
}

// ── Déclencheurs : connexion, premier plan, réseau revenu ───

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id === social.userId) return;
  socialReset(id);
  notifySocial();
  if (id) socialRefresh();
});
document.addEventListener?.('visibilitychange', () => {
  if (document.visibilityState === 'visible' && account.user) socialRefresh({ minAge: SOCIAL_REFRESH_MS });
});
window.addEventListener?.('online', () => { if (account.user && social.error === 'offline') socialRefresh(); });
