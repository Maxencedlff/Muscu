// ═══════════════════════════════════════════════════════════
//  Coach (Coach V1) : appels au serveur et logique pure, sans affichage
//
//  - Contrat serveur / app : docs/COACH_V1.md. Tout passe par des fonctions RPC (security definer, rôle
//    authenticated) ; indépendant du social (être coach ou élève ne demande pas d'avoir activé Amis).
//  - Champs gardés dans ppl_v2 : fromCoach et consigne (programme), consigne (exercice), bornés par
//    sanitizeData (cleanConsigne, cleanFromCoach dans store.js, chargé avant).
//  - Tout ce qui vient du serveur est nettoyé ici (cleanCoachState, cleanCoachSession, cleanSentProgramme…)
//    et l'écran (js/features/coach-ui.js) échappe tout texte reçu.
//  - Programme envoyé : format de js/data/prog-share.js étendu (consignes, supersets, clés de séance).
//    Reçu, il devient un programme perso u_c<prog_id> marqué fromCoach ; un nouvel envoi le met à jour en
//    gardant les identifiants d'exercices dont le nom ne change pas (historique et records suivent), et
//    demande avant d'écraser un programme que l'élève a modifié (empreinte fromCoach.hash).
//  - Rien ne bloque le démarrage : l'état (coach_state, et student_inbox pour un élève) est relu en
//    arrière-plan (connexion, premier plan, onglet Amis, écrans du coach). Rôle et badge du dernier état
//    lu sont gardés sur l'appareil (COACH_CACHE_KEY) pour l'onglet hors ligne.
//  - Résultats : { ok: true, data } ou { ok: false, kind }. L'écran s'abonne par onCoachChange.
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_CACHE_KEY   = 'mdlf_coach';   // { userId, isCoach, hasCoach, badge } du dernier état lu
const COACH_PAGE        = 30;             // séances d'un élève par page (comme le serveur)
const COACH_NOTE_MAX    = 1000;           // commentaire d'une séance
const COACH_PROG_BYTES  = 200 * 1024;     // programme envoyé : 200 Ko au plus
const COACH_CODE_RE     = /^[A-HJ-NP-Z2-9]{8}$/;   // 8 caractères lisibles, sans 0, O, 1 ni I
const COACH_PROG_ID_RE  = /^[A-Za-z0-9_-]{1,40}$/;
const COACH_LOCAL_PREFIX = 'u_c';         // programme reçu : u_c<prog_id>

const coach = { userId: null, state: null, cached: null, loading: false, error: null, loadedAt: 0,
  inbox: null, sessions: {}, preview: null };
const coachListeners = [];
let coachSeq = 0;   // +1 à chaque changement de compte : une réponse arrivée après n'écrit plus rien

function onCoachChange(fn) { coachListeners.push(fn); }
function notifyCoach() { for (const fn of coachListeners) { try { fn(); } catch { /* écran absent */ } } }

// ── Logique pure : nettoyage de ce que renvoie le serveur ───

const coachStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const coachTime = v => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : null; };
// Élève dans coach_state : personne + dernière séance, séances sur 7 jours, nouvelles séances
function cleanStudent(raw) {
  const p = cleanPerson(raw);
  if (!p) return null;
  const nInt = v => (Number.isInteger(v) && v >= 0 ? v : 0);
  const ls = raw.last_session && typeof raw.last_session === 'object' ? raw.last_session : null;
  const lastAt = ls ? coachTime(ls.done_at) : coachTime(raw.last_session_at);
  return { ...p, sessions_7d: nInt(raw.sessions_7d), new_sessions: nInt(raw.new_sessions),
    last_session: lastAt === null ? null : { done_at: lastAt, label: coachStr(ls?.label, 60).trim() || 'Séance', programme: coachStr(ls?.programme, 50) } };
}

// coach_state() nettoyé : { is_coach, coach, students, invites, badge }
function cleanCoachState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const students = (Array.isArray(r.students) ? r.students : []).map(cleanStudent).filter(Boolean);
  const invites = (Array.isArray(r.invites) ? r.invites : [])
    .filter(i => i && COACH_CODE_RE.test(i.code) && coachTime(i.expires_at) !== null)
    .map(i => ({ code: i.code, expires_at: coachTime(i.expires_at) }));
  const isCoach = r.is_coach === true;
  const fallback = isCoach ? students.reduce((a, s) => a + s.new_sessions, 0) : 0;
  return { is_coach: isCoach, coach: cleanPerson(r.coach), students: isCoach ? students : [], invites: isCoach ? invites : [],
    badge: Number.isInteger(r.badge) && r.badge >= 0 ? r.badge : fallback };
}

// Séance d'un élève vue par son coach : liste blanche private.session_for_coach (celle du social, plus
// notes, hidden et id) ; textes bruts bornés (échappés à l'affichage)
function cleanCoachSession(s) {
  const base = cleanPublicSession(s);
  const o = s && typeof s === 'object' ? s : {};
  return { ...base, notes: coachStr(o.notes, 2000), hidden: o.hidden === true };
}

// Ligne de coach_student_sessions : { id, doneAt, s, note }, null si inutilisable
function cleanCoachSessionRow(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || r.id.length > 64) return null;
  const s = cleanCoachSession(r.s);
  const doneAt = Number.isFinite(Number(r.done_at)) && r.done_at !== null ? Number(r.done_at) : s.date;
  if (!Number.isFinite(doneAt)) return null;
  return { id: r.id, doneAt, s, note: coachStr(r.note, COACH_NOTE_MAX) };
}

// Programme envoyé, tel que l'app l'accepte : { name, consigne?, sessions: [{ key, label, color,
// exercises: [{ name, sets, rest?, measure?, tempo?, repMax?, ss?, consigne? }] }] }, null s'il est
// inutilisable. Mêmes bornes que la saisie (sanitizeData) ; clés de séance de SESSION_CAT_RE, uniques.
function cleanSentProgramme(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = coachStr(raw.name, 40).trim();
  if (!name) return null;
  const keys = new Set();
  const sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).slice(0, 20)
    .filter(s => s && typeof s === 'object').map((s, i) => {
      let key = typeof s.key === 'string' && SESSION_CAT_RE.test(s.key) ? s.key : 's' + i;
      while (keys.has(key)) key += 'b';
      keys.add(key);
      const exercises = (Array.isArray(s.exercises) ? s.exercises : []).slice(0, 40)
        .filter(e => e && typeof e === 'object' && typeof e.name === 'string' && e.name.trim())
        .map(e => {
          const sets = num(e.sets, 1, 10, true);
          const o = { name: e.name.trim().slice(0, 80), sets: sets ?? 3 };
          const rest = e.rest == null ? null : num(e.rest, 10, 600, true);
          if (rest !== null) o.rest = rest;
          if (['reps', 'time', 'cardio'].includes(e.measure)) o.measure = e.measure;
          const t = e.tempo == null ? null : parseTempo(e.tempo);
          if (t) o.tempo = formatTempo(t);
          const rm = e.repMax == null ? null : num(e.repMax, 1, 100, true);
          if (rm !== null) o.repMax = rm;
          if (ssId(e)) o.ss = e.ss;
          const c = cleanConsigne(e.consigne);
          if (c) o.consigne = c;
          return o;
        });
      ssNormalize(exercises);
      const color = /^(#[0-9a-f]{6}|var\(--[a-z]+\))$/i.test(s.color || '') ? s.color : '#8E8E93';
      return { key, label: coachStr(s.label, 40).trim() || 'Séance', color, exercises };
    });
  const out = { name, sessions };
  const c = cleanConsigne(raw.consigne);
  if (c) out.consigne = c;
  return out;
}

// student_inbox() nettoyé : { programmes: [{ id, data, sentAt, seen }], notes: [{ session_id, text, updatedAt, seen }] }
function cleanInbox(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const programmes = (Array.isArray(r.programmes) ? r.programmes : []).map(p => {
    if (!p || typeof p.id !== 'string' || !COACH_PROG_ID_RE.test(p.id)) return null;
    const d = cleanSentProgramme(p.data);
    return d ? { id: p.id, data: d, sentAt: coachTime(p.sent_at) ?? 0, seen: p.seen === true } : null;
  }).filter(Boolean).sort((a, b) => b.sentAt - a.sentAt);
  const notes = (Array.isArray(r.notes) ? r.notes : []).map(n => {
    if (!n || typeof n.session_id !== 'string' || !n.session_id || n.session_id.length > 64) return null;
    const text = coachStr(n.text, COACH_NOTE_MAX).trim();
    return text ? { session_id: n.session_id, text, updatedAt: coachTime(n.updated_at) ?? 0, seen: n.seen === true } : null;
  }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
  return { programmes, notes };
}

// Code saisi : majuscules, sans espaces ni tirets ; null s'il n'a pas la forme d'un code
function normalizeCoachCode(raw) {
  const c = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
  return COACH_CODE_RE.test(c) ? c : null;
}

// Erreur du serveur → clé de COACH_ERROR_TEXT
function coachErrorKind(error) {
  if (!error) return null;
  if (isNetworkError(error) || /fetch|network|load failed/i.test(String(error.message || ''))) return 'offline';
  const msg = String(error.message || error.error || '');
  for (const k of ['not_coach', 'already_coached', 'invalid_code', 'team_full', 'not_found', 'rate_limited', 'too_long']) if (msg.includes(k)) return k;
  return 'server';
}
const COACH_ERROR_TEXT = {
  offline: 'Pas d\'Internet : réessaie avec du réseau.',
  not_coach: 'Ton compte n\'est pas un compte coach.',
  already_coached: 'Tu as déjà un coach. Quitte-le d\'abord dans Réglages › Coach.',
  invalid_code: 'Ce code n\'existe pas ou a expiré. Demande un nouveau code à ton coach.',
  team_full: 'Ce coach suit déjà 50 élèves.',
  not_found: 'Introuvable : ce code est peut-être le tien, ou l\'élève ne te suit plus.',
  rate_limited: 'Trop d\'essais pour l\'instant. Réessaie dans une heure.',
  too_long: 'Texte trop long.',
  too_big: 'Programme trop gros pour être envoyé.',
  signed_out: 'Connecte-toi d\'abord à ton compte.',
  server: 'Action impossible pour l\'instant, réessaie dans un moment.',
};
function coachErrorText(kind) { return COACH_ERROR_TEXT[kind] || COACH_ERROR_TEXT.server; }

// ── Logique pure : programmes (conversion, import, mise à jour) ──

// Identifiant local d'un programme reçu, et l'inverse (null si ce n'est pas un programme reçu)
function coachLocalId(progId) { return COACH_LOCAL_PREFIX + progId; }
function coachSentIdOf(localId) {
  return typeof localId === 'string' && localId.startsWith(COACH_LOCAL_PREFIX) && COACH_PROG_ID_RE.test(localId.slice(3)) ? localId.slice(3) : null;
}

// Séances d'un programme de d (perso ou intégré), dans l'ordre : [{ key, label, color }]
function progSessionsOf(d, progId) {
  if (d.userProgrammes?.[progId]) return Object.entries(d.userProgrammes[progId].sessions || {}).map(([key, s]) => ({ key, label: s.label, color: s.color }));
  if (progId === 'custom') return Object.entries(d.customSessions || {}).map(([key, s]) => ({ key, label: s.label, color: s.color }));
  return Object.entries(PROGRAMMES[progId]?.sessions || {}).map(([key, s]) => ({ key, label: s.label, color: s.color }));
}

// Programme de d au format d'envoi (consignes et supersets compris). Les consignes viennent du
// programme (champ consigne), ou de over = { prog, ex: { [cat]: { [exId]: texte } } } quand le coach
// vient de les saisir
function programmeToSent(d, progId, over = null) {
  const up = d.userProgrammes?.[progId];
  const name = up ? up.name : PROGRAMMES[progId]?.name;
  if (!name) return null;
  const exOf = cat => d.programmes?.[progId]?.exercises?.[cat] || [];
  const out = {
    name: String(name).slice(0, 40),
    sessions: progSessionsOf(d, progId).map(s => ({ key: s.key, label: s.label, color: s.color,
      exercises: exOf(s.key).map(e => {
        const o = { name: e.name, sets: e.sets };
        if (e.rest) o.rest = e.rest;
        if (e.measure) o.measure = e.measure;
        if (e.tempo) o.tempo = e.tempo;
        if (e.repMax) o.repMax = e.repMax;
        if (ssId(e)) o.ss = e.ss;
        const c = cleanConsigne(over?.ex?.[s.key]?.[e.id] !== undefined ? over.ex[s.key][e.id] : e.consigne);
        if (c) o.consigne = c;
        return o;
      }) })),
  };
  const c = cleanConsigne(over && over.prog !== undefined ? over.prog : up?.consigne);
  if (c) out.consigne = c;
  return out;
}

// Taille du programme envoyé (octets du JSON), pour la limite de 200 Ko
function sentProgrammeBytes(p) { return unescape(encodeURIComponent(JSON.stringify(p))).length; }

// Empreinte de ce que le coach a envoyé, telle que le programme local la reproduit : sert à savoir si
// l'élève l'a modifié depuis l'import
function coachProgrammeHash(d, localId) { return syncHash(cleanSentProgramme(programmeToSent(d, localId))); }

// Programme reçu déjà importé et non supprimé (archivé = supprimé par l'élève), ou null
function importedCoachProgramme(d, progId) {
  const up = d.userProgrammes?.[coachLocalId(progId)];
  return up && up.fromCoach && !up.archived ? up : null;
}

// État d'un programme de la boîte de réception : 'new' (pas encore dans mes programmes), 'update'
// (nouvel envoi), 'current' (à jour, ou mise à jour refusée par l'élève) ; modified : changé par l'élève
function coachProgrammeStatus(d, item) {
  const up = importedCoachProgramme(d, item.id);
  if (!up) return { status: 'new', modified: false };
  const fc = up.fromCoach;
  const newer = item.sentAt > (fc.sentAt || 0) && item.sentAt !== fc.keptAt;
  return { status: newer ? 'update' : 'current', modified: coachProgrammeHash(d, coachLocalId(item.id)) !== fc.hash };
}

// Importe ou met à jour le programme reçu item = { id, data, sentAt } de coachPerson = { user_id, username }.
// Exercices : celui de même nom (même séance d'abord, puis tout le programme) garde son identifiant et
// ses réglages propres à l'élève (records, muscles choisis, objectif) ; ce que le coach décide (séries,
// repos, mesure, tempo, fourchette, superset, consigne) est remplacé. Renvoie l'identifiant local.
function importCoachProgramme(d, item, coachPerson) {
  const sent = cleanSentProgramme(item.data);
  if (!sent || !COACH_PROG_ID_RE.test(item.id)) return null;
  const id = coachLocalId(item.id);
  const prevUp = d.userProgrammes[id];
  const pd = d.programmes[id] && typeof d.programmes[id] === 'object' ? d.programmes[id] : { exercises: {}, timers: {}, cooldowns: {} };
  pd.exercises ||= {}; pd.timers ||= {}; pd.cooldowns ||= {};
  const old = Object.entries(pd.exercises).flatMap(([cat, xs]) => (Array.isArray(xs) ? xs : []).map(ex => ({ cat, ex })));
  const used = new Set();
  const take = (cat, name) => {
    const n = normName(name);
    const hit = old.find(o => o.cat === cat && !used.has(o.ex) && normName(o.ex.name) === n)
      || old.find(o => !used.has(o.ex) && normName(o.ex.name) === n);
    if (hit) used.add(hit.ex);
    return hit?.ex || null;
  };
  const COACH_FIELDS = ['rest', 'measure', 'tempo', 'repMax', 'ss', 'consigne'];
  const sessions = {}, exercises = {};
  sent.sessions.forEach(s => {
    sessions[s.key] = { label: s.label, icon: '', desc: prevUp?.sessions?.[s.key]?.desc || '', color: s.color };
    exercises[s.key] = s.exercises.map(e => {
      const ex = take(s.key, e.name) || makeExercise(e.name, e.sets);
      ex.name = e.name; ex.sets = e.sets;
      COACH_FIELDS.forEach(k => { if (e[k] !== undefined) ex[k] = e[k]; else if (k === 'rest') ex.rest = null; else delete ex[k]; });
      // Guidage du tempo : seulement s'il y a encore un tempo
      if (!ex.tempo) { delete ex.tempoGuide; delete ex.tempoPrep; }
      return ex;
    });
    if (!(s.key in pd.timers)) pd.timers[s.key] = null;
    if (!(s.key in pd.cooldowns)) pd.cooldowns[s.key] = 72;
  });
  pd.exercises = exercises;
  d.programmes[id] = pd;
  const up = { name: sent.name, sessions, archived: false,
    fromCoach: { coachId: coachPerson?.user_id || prevUp?.fromCoach?.coachId || '', name: coachPerson?.username || prevUp?.fromCoach?.name || null, sentAt: item.sentAt || 0 } };
  if (sent.consigne) up.consigne = sent.consigne;
  d.userProgrammes[id] = up;
  up.fromCoach.hash = coachProgrammeHash(d, id);
  if (!(d.myProgrammes || []).includes(id)) (d.myProgrammes ||= []).push(id);
  return id;
}

// Mise à jour refusée par l'élève (« Garder le mien ») : cet envoi n'est plus proposé
function keepMyCoachProgramme(d, item) {
  const up = importedCoachProgramme(d, item.id);
  if (up) up.fromCoach.keptAt = item.sentAt;
}

// Côté coach : nom de mon programme avec lequel une séance d'élève a été faite (programme u_c<mon id>),
// sinon null
function coachOwnProgrammeName(progField, d = data) {
  const mine = coachSentIdOf(progField);
  if (!mine) return null;
  if (d.userProgrammes?.[mine]) return d.userProgrammes[mine].name;
  return PROGRAMMES[mine] && mine !== 'custom' ? PROGRAMMES[mine].name : null;
}

// ── État lu et caché ────────────────────────────────────────

function readCoachCache(userId) {
  try {
    const c = JSON.parse(localStorage.getItem(COACH_CACHE_KEY));
    return c && c.userId === userId ? { isCoach: c.isCoach === true, hasCoach: c.hasCoach === true, badge: Number.isInteger(c.badge) ? c.badge : 0 } : null;
  } catch { return null; }
}
function writeCoachCache() {
  if (!coach.userId || !coach.state) return;
  try { localStorage.setItem(COACH_CACHE_KEY, JSON.stringify({ userId: coach.userId, isCoach: coach.state.is_coach, hasCoach: !!coach.state.coach, badge: coach.state.badge })); }
  catch { /* cache facultatif */ }
}

// Rôle connu (état lu, sinon dernier état de l'appareil) : { isCoach, hasCoach }
function coachRole() {
  if (!account.user) return { isCoach: false, hasCoach: false };
  if (coach.state) return { isCoach: coach.state.is_coach, hasCoach: !!coach.state.coach };
  return { isCoach: !!coach.cached?.isCoach, hasCoach: !!coach.cached?.hasCoach };
}
// Badge du coach sur l'onglet Amis : nouvelles séances (coach), programmes et commentaires non vus (élève)
function coachBadge() {
  if (!account.user) return 0;
  return coach.state ? coach.state.badge : (coach.cached?.badge || 0);
}

function coachReset(userId) {
  coachSeq++;
  Object.assign(coach, { userId, state: null, cached: userId ? readCoachCache(userId) : null, loading: false, error: null, loadedAt: 0,
    inbox: null, sessions: {}, preview: null });
}

// ── Appels au serveur ───────────────────────────────────────

async function coachRpc(fn, args) {
  if (!sb || !account.user) return { ok: false, kind: 'signed_out' };
  const seq = coachSeq;
  try {
    const { data: res, error } = await sb.rpc(fn, args);
    if (seq !== coachSeq) return { ok: false, kind: 'signed_out' };
    return error ? { ok: false, kind: coachErrorKind(error) } : { ok: true, data: res };
  } catch (e) {
    return { ok: false, kind: coachErrorKind(e) || 'server' };
  }
}

// Relit coach_state (et la boîte de réception d'un élève). Renvoie true si l'état a pu être lu.
async function coachRefresh({ minAge = 0 } = {}) {
  if (!sb || !account.user || coach.loading) return false;
  if (minAge && coach.state && Date.now() - coach.loadedAt < minAge) return true;
  coach.loading = true;
  const seq = coachSeq;
  const r = await coachRpc('coach_state');
  if (seq !== coachSeq) return false;
  coach.loading = false;
  if (!r.ok) { coach.error = r.kind; notifyCoach(); return false; }
  coach.state = cleanCoachState(r.data);
  coach.error = null;
  coach.loadedAt = Date.now();
  writeCoachCache();
  if (coach.state.coach) await coachLoadInbox();
  else coach.inbox = null;
  notifyCoach();
  return true;
}

async function coachLoadInbox() {
  const r = await coachRpc('student_inbox');
  if (r.ok) coach.inbox = cleanInbox(r.data);
  return r;
}

// Élève : aperçu du coach avant d'accepter, puis lien
async function coachPreview(code) {
  const c = normalizeCoachCode(code);
  if (!c) return { ok: false, kind: 'invalid_code' };
  const r = await coachRpc('coach_preview', { code: c });
  if (!r.ok) return r;
  const p = cleanPerson(r.data);
  if (!p) return { ok: false, kind: 'invalid_code' };
  coach.preview = { code: c, person: p };
  return { ok: true, data: p };
}
async function coachJoin(code) {
  const c = normalizeCoachCode(code);
  if (!c) return { ok: false, kind: 'invalid_code' };
  const r = await coachRpc('coach_join', { code: c });
  if (r.ok) { coach.preview = null; await coachRefresh(); }
  return r.ok ? { ok: true, data: cleanPerson(r.data) } : r;
}
async function coachLeave() {
  const r = await coachRpc('coach_leave');
  if (r.ok) { coach.inbox = null; await coachRefresh(); }
  return r;
}

// Coach : invitations
async function coachCreateInvite() {
  const r = await coachRpc('coach_create_invite');
  if (!r.ok) return r;
  await coachRefresh();
  return COACH_CODE_RE.test(r.data) ? { ok: true, data: r.data } : { ok: false, kind: 'server' };
}
async function coachRevokeInvite(code) {
  const r = await coachRpc('coach_revoke_invite', { code });
  if (r.ok) await coachRefresh();
  return r;
}
async function coachRemoveStudent(student) {
  const r = await coachRpc('coach_remove_student', { student });
  if (r.ok) { delete coach.sessions[student]; await coachRefresh(); }
  return r;
}

// Séances d'un élève : { rows, end, loading, error, loadedAt }
function coachSessions(student) {
  return coach.sessions[student] ||= { rows: [], end: false, loading: false, error: null, loadedAt: 0 };
}
// Première page (more : false) ou suivante : curseur (done_at, id) de la dernière séance
async function coachLoadSessions(student, { more = false } = {}) {
  const f = coachSessions(student);
  if (f.loading || (more && f.end)) return { ok: true };
  f.loading = true;
  const seq = coachSeq;
  notifyCoach();
  const last = more ? f.rows[f.rows.length - 1] : null;
  const args = { student, ...(last ? { before_at: last.doneAt, before_id: last.id } : {}) };
  const r = await coachRpc('coach_student_sessions', args);
  if (seq !== coachSeq) return { ok: false, kind: 'signed_out' };
  f.loading = false;
  if (!r.ok) { f.error = r.kind; notifyCoach(); return r; }
  const rows = (Array.isArray(r.data) ? r.data : []).map(cleanCoachSessionRow).filter(Boolean);
  const seen = new Set(more ? f.rows.map(x => x.id) : []);
  f.rows = [...(more ? f.rows : []), ...rows.filter(x => !seen.has(x.id))];
  f.end = (Array.isArray(r.data) ? r.data.length : 0) < COACH_PAGE;
  f.error = null;
  f.loadedAt = Date.now();
  notifyCoach();
  return { ok: true };
}
function coachSessionOf(student, id) { return coachSessions(student).rows.find(r => r.id === id) || null; }

// Séances de l'élève vues : ses nouvelles séances ne comptent plus dans le badge
async function coachMarkSeen(student) {
  const st = coach.state?.students.find(s => s.user_id === student);
  const r = await coachRpc('coach_mark_seen', { student });
  if (r.ok && st && st.new_sessions) {
    coach.state.badge = Math.max(0, coach.state.badge - st.new_sessions);
    st.new_sessions = 0;
    writeCoachCache();
    notifyCoach();
  }
  return r;
}

// Commentaire d'une séance (texte vide : supprimé)
async function coachSetNote(student, sessionId, text) {
  const t = String(text ?? '').trim();
  if (t.length > COACH_NOTE_MAX) return { ok: false, kind: 'too_long' };
  const r = await coachRpc('coach_set_note', { student, session_id: sessionId, text: t });
  if (r.ok) { const row = coachSessionOf(student, sessionId); if (row) row.note = t; notifyCoach(); }
  return r;
}

// Envoi d'un de mes programmes, avec les consignes saisies (over, voir programmeToSent)
async function coachSendProgramme(student, progId, over = null) {
  const p = cleanSentProgramme(programmeToSent(data, progId, over));
  if (!p || !COACH_PROG_ID_RE.test(progId)) return { ok: false, kind: 'server' };
  if (sentProgrammeBytes(p) > COACH_PROG_BYTES) return { ok: false, kind: 'too_big' };
  return coachRpc('coach_send_programme', { student, prog_id: progId, data: p });
}

// Élève : programme ou commentaire vu (badge)
async function coachMarkInboxSeen(kind, ref) {
  const list = kind === 'programme' ? coach.inbox?.programmes : coach.inbox?.notes;
  const item = (list || []).find(x => (kind === 'programme' ? x.id : x.session_id) === ref);
  if (!item || item.seen) return { ok: true };
  item.seen = true;
  if (coach.state) { coach.state.badge = Math.max(0, coach.state.badge - 1); writeCoachCache(); }
  notifyCoach();
  return coachRpc('student_mark_seen', { kind, ref });
}

// Élève : commentaire de son coach sur une séance, ou null
function coachNoteFor(sessionId) { return coach.inbox?.notes.find(n => n.session_id === sessionId) || null; }

// ── Déclencheurs : connexion, premier plan, réseau revenu ───

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id === coach.userId) return;
  coachReset(id);
  notifyCoach();
  if (id) coachRefresh();
});
document.addEventListener?.('visibilitychange', () => {
  if (document.visibilityState === 'visible' && account.user) coachRefresh({ minAge: SOCIAL_REFRESH_MS });
});
window.addEventListener?.('online', () => { if (account.user && coach.error === 'offline') coachRefresh(); });
