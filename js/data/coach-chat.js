// ═══════════════════════════════════════════════════════════
//  Messages coach ↔ élève (Coach V1.2) : appels au serveur et logique pure, sans affichage
//
//  - Contrat : docs/COACH_V1.md, section « Messages » ; serveur :
//    supabase/migrations/20261031510000_chat_coach.sql. RPC chat_threads, chat_messages, chat_send,
//    chat_mark_read, report_chat (coachRpc de js/data/coach.js : même compte, mêmes erreurs traduites).
//  - Une conversation par lien coach ↔ élève, désignée par une clé : CHAT_COACH (« avec mon coach »,
//    je suis l'élève) ou l'identifiant d'un de mes élèves (je suis son coach). Le serveur relit le
//    lien à chaque appel : seuls un coach et ses élèves liés lisent et écrivent ; lien rompu = messages
//    effacés côté serveur (et ici à la relecture).
//  - Texte seul, 2000 caractères au plus (CHAT_MAX), nettoyé comme le serveur (chatClean).
//  - Pas de temps réel : chat_threads est relu avec l'état du coach (coachRefresh : ouverture de l'app,
//    premier plan, onglet Amis) ; une conversation ouverte est relue toutes les CHAT_POLL_MS (seulement
//    les messages plus récents que le dernier REÇU du serveur par chat_messages, curseur c.cursor : mon
//    propre message renvoyé par chat_send n'avance pas le curseur, sinon un message de l'autre arrivé
//    juste avant ma réponse ne serait jamais relu).
//  - Non-lus : par conversation (chat_threads), total dans le badge de l'onglet Amis ; gardé sur
//    l'appareil (CHAT_CACHE_KEY) pour un badge juste hors ligne. Ouvrir la conversation la marque lue
//    jusqu'au curseur (chat_mark_read up_to) : un message arrivé après la lecture reste non lu. Écrire
//    ne vaut pas lecture (comme le serveur).
//  - Signaler (chatReport) : le serveur copie les 50 derniers messages (report_chat, preuve gardée même
//    si le suivi s'arrête ensuite), puis l'alerte par e-mail est demandée (socialReportAlert).
//  - Serveur sans messagerie (migration pas encore appliquée) : chat.available = false, l'écran cache
//    la cellule « Messages ».
//  - L'écran (js/features/coach-chat-ui.js) s'abonne par onCoachChange : chaque changement appelle notifyCoach.
// ═══════════════════════════════════════════════════════════
'use strict';

const CHAT_COACH = '@coach';         // clé de la conversation avec mon coach
const CHAT_MAX = 2000;               // caractères (comme la contrainte du serveur)
const CHAT_PAGE = 50;                // messages par page (comme chat_messages)
const CHAT_POLL_MS = 15_000;         // relecture d'une conversation ouverte
const CHAT_WARN = 1800;              // compteur affiché à partir de là
const CHAT_CACHE_KEY = 'mdlf_chat';  // { userId, unread } : dernier total de non-lus

// threads : dernier chat_threads nettoyé ; convs : conversations chargées par clé
const chat = { userId: null, available: null, threads: null, cachedUnread: 0, loading: false, error: null, loadedAt: 0, convs: {} };
let chatSeq = 0;   // +1 au changement de compte : une réponse arrivée après n'écrit plus rien

// ── Logique pure ────────────────────────────────────────────

// Texte tel que le serveur le gardera (private.chat_clean)
function chatClean(t) {
  return String(t ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').replace(/^[ \t\n]+|[ \t\n]+$/g, '');
}
function chatLength(t) { return [...chatClean(t)].length; }
function chatProblem(t) {
  const n = chatLength(t);
  return !n ? 'empty' : n > CHAT_MAX ? 'too_long' : null;
}
// Arguments des RPC pour une clé : rien (mon coach) ou { student }
function chatArgs(key) { return key === CHAT_COACH ? {} : { student: key }; }

// Message reçu : { id, mine, body, at }, null si inutilisable
function cleanChatMessage(r) {
  if (!r || typeof r !== 'object') return null;
  const id = Number(r.id), at = Date.parse(r.at);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof r.body !== 'string' || !r.body || !Number.isFinite(at)) return null;
  return { id, mine: r.mine === true, body: [...r.body].slice(0, CHAT_MAX).join(''), at };
}
// Résumé d'une conversation : { unread, last: message | null }
function cleanChatThread(t) {
  const o = t && typeof t === 'object' ? t : {};
  return { unread: Number.isInteger(o.unread) && o.unread > 0 ? Math.min(o.unread, 999) : 0, last: cleanChatMessage(o.last) };
}
// chat_threads() nettoyé : { coach: résumé | null, students: { [uid]: résumé }, unread }
function cleanChatThreads(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const students = {};
  for (const s of Array.isArray(r.students) ? r.students : []) {
    if (s && typeof s.student_id === 'string' && s.student_id) students[s.student_id] = cleanChatThread(s);
  }
  const coachThread = r.coach && typeof r.coach === 'object' ? cleanChatThread(r.coach) : null;
  const unread = (coachThread?.unread || 0) + Object.values(students).reduce((a, s) => a + s.unread, 0);
  return { coach: coachThread, students, unread };
}
// Messages fusionnés par identifiant, du plus ancien au plus récent
function chatMerge(rows, page) {
  const byId = new Map(rows.map(m => [m.id, m]));
  for (const m of page) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
// Jour d'un message, pour les séparateurs (« Aujourd'hui », « Hier », sinon la date)
function chatDayLabel(at, now = Date.now()) {
  const d = new Date(at), today = new Date(now);
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(today) - day(d)) / 86400000);
  if (diff === 0) return 'Aujourd\'hui';
  if (diff === 1) return 'Hier';
  const long = fmtDate(at, 'long');
  return long.charAt(0).toUpperCase() + long.slice(1);
}

// ── État ────────────────────────────────────────────────────

function readChatCache(userId) {
  try {
    const c = JSON.parse(localStorage.getItem(CHAT_CACHE_KEY));
    return c && c.userId === userId && Number.isInteger(c.unread) && c.unread >= 0 ? c.unread : 0;
  } catch { return 0; }
}
function writeChatCache() {
  if (!chat.userId || !chat.threads) return;
  try { localStorage.setItem(CHAT_CACHE_KEY, JSON.stringify({ userId: chat.userId, unread: chat.threads.unread })); }
  catch { /* cache facultatif */ }
}
function chatReset(userId) {
  chatSeq++;
  Object.assign(chat, { userId, available: null, threads: null, cachedUnread: userId ? readChatCache(userId) : 0,
    loading: false, error: null, loadedAt: 0, convs: {} });
}

// Messagerie possible avec cette conversation : lien connu (coach_state) et serveur à jour
function chatAvailable() { return !!account.user && chat.available !== false; }
// Non-lus : total (badge de l'onglet), ou d'une conversation
function chatUnreadTotal() {
  if (!account.user || chat.available === false) return 0;
  return chat.threads ? chat.threads.unread : chat.cachedUnread;
}
function chatThreadOf(key) {
  if (!chat.threads) return null;
  return key === CHAT_COACH ? chat.threads.coach : chat.threads.students[key] || null;
}
function chatUnreadOf(key) { return chatThreadOf(key)?.unread || 0; }
// cursor : id du plus récent message reçu par chat_messages (relecture after_id, marque de lecture up_to)
function chatConv(key) {
  return chat.convs[key] ||= { rows: [], cursor: 0, end: false, loading: false, error: null, loadedAt: 0, sending: false };
}
// Curseur avancé par une page reçue du serveur (jamais par mon propre envoi)
function chatAdvance(c, page) {
  for (const m of page) if (m.id > c.cursor) c.cursor = m.id;
}

// ── Appels au serveur ───────────────────────────────────────

// Résumés de mes conversations (non-lus, dernier message). Appelée après chaque coachRefresh.
async function chatRefresh() {
  if (!sb || !account.user || chat.loading) return false;
  const { isCoach, hasCoach } = coachRole();
  if (!isCoach && !hasCoach) {
    if (chat.threads?.unread || chat.cachedUnread) { chat.threads = cleanChatThreads({}); chat.cachedUnread = 0; writeChatCache(); notifyCoach(); }
    return true;
  }
  chat.loading = true;
  const seq = chatSeq;
  const r = await coachRpc('chat_threads');
  if (seq !== chatSeq) return false;
  chat.loading = false;
  if (!r.ok) {
    if (r.kind === 'missing') chat.available = false;
    chat.error = r.kind;
    notifyCoach();
    return false;
  }
  chat.available = true;
  chat.threads = cleanChatThreads(r.data);
  chat.error = null;
  chat.loadedAt = Date.now();
  writeChatCache();
  notifyCoach();
  return true;
}

// Première page (les plus récents) ou les plus anciens (more). Renvoie { ok } ou { ok: false, kind }.
async function chatLoad(key, { more = false } = {}) {
  const c = chatConv(key);
  if (c.loading || (more && c.end)) return { ok: true };
  c.loading = true;
  const seq = chatSeq;
  notifyCoach();
  const args = chatArgs(key);
  if (more && c.rows.length) args.before_id = c.rows[0].id;
  const r = await coachRpc('chat_messages', args);
  if (seq !== chatSeq) return { ok: false, kind: 'signed_out' };
  c.loading = false;
  if (!r.ok) {
    if (r.kind === 'missing') chat.available = false;
    c.error = r.kind; notifyCoach(); return r;
  }
  const raw = Array.isArray(r.data) ? r.data : [];
  const page = raw.map(cleanChatMessage).filter(Boolean);
  // Première page : elle remplace la conversation (un lien rompu puis renoué repart à vide)
  if (!more) c.cursor = 0;
  c.rows = more ? chatMerge(c.rows, page) : chatMerge([], page);
  chatAdvance(c, page);
  // Page incomplète : plus rien avant. Toujours recalculé, la première page remplaçant toute la liste
  // (sinon une remontée complète puis une réouverture cacherait les anciens messages pour de bon)
  c.end = raw.length < CHAT_PAGE;
  c.error = null;
  c.loadedAt = Date.now();
  notifyCoach();
  return { ok: true };
}

// Relecture d'une conversation ouverte : seulement les messages plus récents que le dernier reçu du
// serveur (curseur ; trois pages au plus d'un coup). Jamais chargée, ou vide : première page. Renvoie
// { ok, added, theirs } (theirs : messages de l'autre arrivés, à marquer lus si la conversation est à l'écran).
async function chatPoll(key) {
  const c = chatConv(key);
  if (c.loading) return { ok: true };
  if (!c.loadedAt || (!c.rows.length && !c.cursor)) {
    // Même réponse que la relecture par curseur : sans theirs, le premier message de l'autre dans une
    // conversation vide resterait compté non lu alors qu'il est à l'écran
    const known = new Set(c.rows.map(m => m.id));
    const r = await chatLoad(key);
    if (!r.ok) return r;
    const fresh = c.rows.filter(m => !known.has(m.id));
    return { ok: true, added: fresh.length, theirs: fresh.filter(m => !m.mine).length };
  }
  c.loading = true;
  const seq = chatSeq;
  let added = 0, theirs = 0;
  for (let i = 0; i < 3; i++) {
    const r = await coachRpc('chat_messages', { ...chatArgs(key), after_id: c.cursor });
    if (seq !== chatSeq) return { ok: false, kind: 'signed_out' };
    if (!r.ok) { c.loading = false; c.error = r.kind; notifyCoach(); return r; }
    const page = (Array.isArray(r.data) ? r.data : []).map(cleanChatMessage).filter(Boolean);
    const known = new Set(c.rows.map(m => m.id));
    const fresh = page.filter(m => !known.has(m.id));
    c.rows = chatMerge(c.rows, page);
    chatAdvance(c, page);
    added += fresh.length;
    theirs += fresh.filter(m => !m.mine).length;
    if ((Array.isArray(r.data) ? r.data.length : 0) < CHAT_PAGE) break;
  }
  c.loading = false;
  c.error = null;
  c.loadedAt = Date.now();
  if (added) notifyCoach();
  return { ok: true, added, theirs };
}

// Envoyer. Renvoie { ok, data: message } ou { ok: false, kind } (le brouillon reste à l'écran).
async function chatSend(key, text) {
  const problem = chatProblem(text);
  if (problem) return { ok: false, kind: problem === 'empty' ? 'empty_message' : 'too_long' };
  const c = chatConv(key);
  if (c.sending) return { ok: false, kind: 'busy' };
  c.sending = true;
  notifyCoach();
  const seq = chatSeq;
  const r = await coachRpc('chat_send', { body: chatClean(text), ...chatArgs(key) });
  if (seq !== chatSeq) return { ok: false, kind: 'signed_out' };
  c.sending = false;
  if (!r.ok) { notifyCoach(); return r; }
  const m = cleanChatMessage(r.data);
  // Affiché tout de suite, sans avancer le curseur : la relecture suivante reprend après le dernier
  // message reçu du serveur et ramène ceux de l'autre arrivés entre-temps. Écrire ne vaut pas lecture.
  if (m) c.rows = chatMerge(c.rows, [m]);
  const th = chatThreadOf(key);
  if (th && m) th.last = m;
  notifyCoach();
  return m ? { ok: true, data: m } : { ok: false, kind: 'server' };
}

// Conversation lue (ouverte, ou nouveaux messages affichés) jusqu'au dernier message reçu (curseur) :
// non-lus remis à zéro ici tout de suite (le serveur garde non lu ce qui est arrivé après ; la
// relecture suivante de chat_threads le remontera). force : des messages de l'autre viennent d'arriver
// à l'écran (relecture), même si le dernier résumé lu n'en comptait pas encore
async function chatMarkRead(key, { force = false } = {}) {
  const th = chatThreadOf(key), c = chatConv(key);
  if (!th?.unread && !force) return;
  if (!c.cursor) return;   // rien reçu : rien à marquer
  if (th?.unread) {
    chat.threads.unread = Math.max(0, chat.threads.unread - th.unread);
    th.unread = 0;
    writeChatCache();
    notifyCoach();
  }
  await coachRpc('chat_mark_read', { ...chatArgs(key), up_to: c.cursor });
}

// Signaler la conversation : le serveur copie les derniers messages (preuve gardée si le suivi s'arrête),
// puis l'alerte par e-mail part au mieux. Renvoie { ok } ou { ok: false, kind } (clé de COACH_ERROR_TEXT,
// ou report_rate : 10 signalements par 24 h, texte de SOCIAL_ERROR_TEXT).
async function chatReport(key, reason) {
  if (!REPORT_REASONS.some(x => x.reason === reason)) return { ok: false, kind: 'server' };
  const r = await coachRpc('report_chat', { reason, ...chatArgs(key) });
  if (!r.ok) return r.kind === 'rate_limited' ? { ok: false, kind: 'report_rate' } : r;
  if (Number.isSafeInteger(r.data)) socialReportAlert(r.data);
  return { ok: true };
}

// ── Déclencheurs ────────────────────────────────────────────

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id !== chat.userId) chatReset(id);
});
