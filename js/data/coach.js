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
//    Reçu, il devient un programme perso u_c<8 caractères du coach>_<prog_id> marqué fromCoach (coachLocalId) ;
//    un nouvel envoi le met à jour en gardant les identifiants d'exercices dont le nom ne change pas dans la
//    même séance (historique et records suivent), garde les séances retirées (retired: true) pour l'historique,
//    et demande avant d'écraser un programme que l'élève a modifié (empreinte fromCoach.hash).
//  - Rien ne bloque le démarrage : l'état (coach_state, et student_inbox pour un élève) est relu en
//    arrière-plan (connexion, premier plan, onglet Amis, écrans du coach). Rôle et badge du dernier état
//    lu sont gardés sur l'appareil (COACH_CACHE_KEY) pour l'onglet hors ligne.
//  - Résultats : { ok: true, data } ou { ok: false, kind }. L'écran s'abonne par onCoachChange.
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_CACHE_KEY   = 'mdlf_coach';   // { userId, isCoach, hasCoach, badge, badgeCoach, badgeStudent } du dernier état lu
const COACH_SEEN_KEY    = 'mdlf_coach_seen';    // { userId, items: [{ kind, ref }] } : « vu » à renvoyer (échec hors ligne)
const COACH_SENT_KEY    = 'mdlf_coach_sent';    // { userId, sent: { [élève]: { [prog_id]: date } } } : mes envois (coach)
const COACH_LOST_KEY    = 'mdlf_coach_lost';    // { userId, name } : coach perdu (élève retiré), dit une fois
const COACH_INBOX_KEY   = 'mdlf_coach_inbox';   // { userId, coach, inbox } : dernière boîte de l'élève (commentaires hors ligne)
const COACH_IDLE_REFRESH_MS = 5 * 60_000;   // premier plan, compte ni coach ni élève
const COACH_PAGE        = 30;             // séances d'un élève par page (comme le serveur)
const COACH_NOTE_MAX    = 1000;           // commentaire d'une séance
const COACH_PROG_BYTES  = 200 * 1024;     // programme envoyé : 200 Ko au plus
// Code d'invitation : 8 caractères (codes de 7 jours) ou 12 (code permanent du coach, créé à la
// validation de son rôle), lisibles, sans 0, O, 1 ni I
const COACH_CODE_RE     = /^(?:[A-HJ-NP-Z2-9]{8}|[A-HJ-NP-Z2-9]{12})$/;
const COACH_PROG_ID_RE  = /^[A-Za-z0-9_-]{1,40}$/;
const COACH_LOCAL_PREFIX = 'u_c';         // programme reçu : u_c<8 caractères du coach>_<prog_id>

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
  // sent : mes programmes envoyés à cet élève et s'il les a ouverts (null : serveur sans ce champ)
  const sent = Array.isArray(raw.sent) ? raw.sent
    .filter(x => x && typeof x.id === 'string' && COACH_PROG_ID_RE.test(x.id))
    .map(x => ({ id: x.id, sentAt: coachTime(x.sent_at) ?? 0, seen: x.seen === true })) : null;
  return { ...p, sessions_7d: nInt(raw.sessions_7d), new_sessions: nInt(raw.new_sessions), sent,
    last_session: lastAt === null ? null : { done_at: lastAt, label: coachStr(ls?.label, 60).trim() || 'Séance', programme: coachStr(ls?.programme, 50) } };
}

// coach_state() nettoyé : { is_coach, coach, students, invites, badge, badge_coach, badge_student }.
// badge_coach : nouvelles séances de mes élèves (pastille « Mes élèves ») ; badge_student : programmes et
// commentaires non vus de mon coach (« Mon coach ») ; badge : leur somme (onglet Amis)
function cleanCoachState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const students = (Array.isArray(r.students) ? r.students : []).map(cleanStudent).filter(Boolean);
  const invites = (Array.isArray(r.invites) ? r.invites : [])
    .filter(i => i && COACH_CODE_RE.test(i.code) && coachTime(i.expires_at) !== null)
    .map(i => ({ code: i.code, expires_at: coachTime(i.expires_at) }));
  const isCoach = r.is_coach === true;
  const n = v => (Number.isInteger(v) && v >= 0 ? v : null);
  const badgeCoach = isCoach ? (n(r.badge_coach) ?? students.reduce((a, s) => a + s.new_sessions, 0)) : 0;
  const total = n(r.badge);
  const badgeStudent = r.coach ? (n(r.badge_student) ?? Math.max(0, (total ?? badgeCoach) - badgeCoach)) : 0;
  return { is_coach: isCoach, coach: cleanPerson(r.coach), students: isCoach ? students : [], invites: isCoach ? invites : [],
    removed: isCoach ? cleanPeople(r.removed).sort((a, b) => (Date.parse(b.since) || 0) - (Date.parse(a.since) || 0)) : [],
    badge: badgeCoach + badgeStudent, badge_coach: badgeCoach, badge_student: badgeStudent };
}

// Séance d'un élève vue par son coach : liste blanche private.session_for_coach (celle du social, plus
// notes, hidden et id) ; textes bruts bornés (échappés à l'affichage). bodyKg : seulement si l'élève me
// partage son poids (serveur : private.coach_session_body ; js/data/coach-share.js), sinon absent
function cleanCoachSession(s) {
  const base = cleanPublicSession(s);
  const o = s && typeof s === 'object' ? s : {};
  const bodyKg = typeof cleanSessionBodyKg === 'function' ? cleanSessionBodyKg(o.bodyKg) : null;
  return { ...base, notes: coachStr(o.notes, 2000), hidden: o.hidden === true, ...(bodyKg ? { bodyKg } : {}) };
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
          const rn = e.repMin == null ? null : num(e.repMin, 1, 99, true);
          if (rn !== null && rn < (o.repMax ?? 12)) o.repMin = rn;
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
    return d ? { id: p.id, data: d, sentAt: coachTime(p.sent_at) ?? 0, seen: p.seen === true, ...(p.meta === true ? { meta: true } : {}) } : null;
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
// Message d'invitation partagé par le coach : dit où aller dans l'app (pas de lien : app en TestFlight)
function coachInviteText(code) {
  const c = String(code || '');
  // Code permanent (12 caractères) : écrit en trois groupes, sans date de fin
  const shown = c.length === 12 ? formatCoachCode(c) : c;
  // La remise de 25 % n'existe que verrou allumé (tout est ouvert sinon) : pas de promesse avant
  const end = c.length !== 12 ? 'Il est valable 7 jours.'
    : paywallOn() ? 'Avec ce code, ton abonnement est à 25 % de moins pendant 12 mois.' : 'Ce code n\'expire pas.';
  return `Je te propose de te suivre sur MDLF Training. Dans l'app MDLF Training : onglet Amis › Rejoindre un coach, puis saisis le code ${shown}. ${end}`;
}
// Code permanent : K7M2QX9PR4TD → K7M2-QX9P-R4TD (les tirets sont ignorés à la saisie)
function formatCoachCode(code) {
  const c = String(code || '');
  return c.length === 12 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}` : c;
}
// Code trouvé dans ce qui a été saisi ou collé : le code seul (« k7m2-qx9p »), ou le message d'invitation
// entier, où il est écrit en capitales et isolé des autres mots
function extractCoachCode(raw) {
  const whole = normalizeCoachCode(raw);
  if (whole) return whole;
  const txt = String(raw ?? '');
  // Code permanent écrit en trois groupes (K7M2-QX9P-R4TD), ou d'un seul bloc ; sinon code de 8
  const long = txt.match(/(?:^|[^A-Za-z0-9-])([A-HJ-NP-Z2-9]{4})-?([A-HJ-NP-Z2-9]{4})-?([A-HJ-NP-Z2-9]{4})(?![A-Za-z0-9-])/);
  if (long) return long[1] + long[2] + long[3];
  const m = txt.match(/(?:^|[^A-Za-z0-9])([A-HJ-NP-Z2-9]{8})(?![A-Za-z0-9])/);
  return m ? m[1] : null;
}

// Erreur du serveur → clé de COACH_ERROR_TEXT
function coachErrorKind(error) {
  if (!error) return null;
  if (isNetworkError(error) || /fetch|network|load failed/i.test(String(error.message || ''))) return 'offline';
  const msg = String(error.message || error.error || '');
  for (const k of ['not_coach', 'already_coached', 'invalid_code', 'tier_full', 'team_full', 'not_found', 'rate_limited', 'too_long', 'invalid_programme', 'username_required', 'not_shared', 'invalid_kind', 'invalid_data',
    'empty_message']) if (msg.includes(k)) return k;
  // Fonction absente du serveur (migration pas encore appliquée) : PostgREST répond PGRST202
  if (error.code === 'PGRST202' || /could not find the function/i.test(msg)) return 'missing';
  return 'server';
}
const COACH_ERROR_TEXT = {
  offline: 'Pas d\'Internet : réessaie avec du réseau.',
  not_coach: 'Ton compte n\'est pas un compte coach.',
  already_coached: 'Tu as déjà un coach. Quitte-le d\'abord dans Réglages › Coach.',
  invalid_code: 'Ce code n\'existe pas ou a expiré. Demande un nouveau code à ton coach.',
  team_full: 'Ce coach suit déjà 50 élèves.',
  tier_full: 'Ton coach a atteint la limite de son abonnement : il doit passer au palier supérieur.',
  not_found: 'Introuvable : ce code est peut-être le tien, ou l\'élève ne te suit plus.',
  rate_limited: 'Trop d\'essais pour l\'instant. Réessaie dans une heure.',
  too_long: 'Texte trop long.',
  invalid_programme: 'Ce programme ne peut pas être envoyé.',
  username_required: 'Choisis d\'abord un pseudo : ton coach te reconnaîtra avec.',
  too_big: 'Programme trop gros pour être envoyé.',
  // Partage avec le coach (js/data/coach-share.js)
  not_shared: 'Ce partage est coupé : coche-le à nouveau pour l\'envoyer.',
  invalid_kind: 'Ce partage n\'est pas encore disponible.',
  invalid_data: 'Pesées illisibles : rien n\'a été envoyé.',
  // Messages (js/data/coach-chat.js)
  empty_message: 'Écris quelque chose avant d\'envoyer.',
  busy: 'Envoi déjà en cours.',
  missing: 'Pas encore disponible : réessaie après la prochaine mise à jour.',
  age_limited: 'Le contrôle parental de cet iPhone limite les échanges : les messages ne sont pas disponibles.',
  signed_out: 'Connecte-toi d\'abord à ton compte.',
  server: 'Action impossible pour l\'instant, réessaie dans un moment.',
};
function coachErrorText(kind) { return COACH_ERROR_TEXT[kind] || COACH_ERROR_TEXT.server; }

// ── Logique pure : programmes (conversion, import, mise à jour) ──

// Identifiant local d'un programme reçu : u_c<8 caractères du coach>_<prog_id>. Le coach y est inscrit :
// - deux coachs qui envoient le même prog_id (ancien et nouveau coach) n'écrasent jamais le programme
//   de l'autre ;
// - le coach reconnaît, dans les séances de son élève (champ programme, seul transmis par le serveur),
//   celles faites avec SON programme, et pas avec celui d'un ancien coach.
// Compatibilité : un programme importé avant sous u_c<prog_id> par ce même coach garde sa place.
const coachTag = id => String(id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
function coachLocalId(progId, d = null, coachId = null) {
  const base = COACH_LOCAL_PREFIX + progId;
  const tag = coachTag(coachId);
  if (!tag) return base;
  if (d?.userProgrammes?.[base]?.fromCoach?.coachId === coachId) return base;
  return `${COACH_LOCAL_PREFIX}${tag}_${progId}`;
}
// Inverse, côté coach : prog_id de MON programme d'après le programme d'une séance d'élève, null sinon
// (programme d'un autre coach, ou ancienne forme u_c<prog_id> qui ne dit pas de quel coach il vient)
function coachSentIdOf(localId, myId = null) {
  if (typeof localId !== 'string' || !localId.startsWith(COACH_LOCAL_PREFIX)) return null;
  const rest = localId.slice(COACH_LOCAL_PREFIX.length), tag = coachTag(myId);
  if (!tag || !rest.startsWith(tag + '_')) return null;
  const id = rest.slice(tag.length + 1);
  return COACH_PROG_ID_RE.test(id) ? id : null;
}

// Séances d'un programme de d (perso ou intégré), dans l'ordre : [{ key, label, color }]
// (séances retirées par le coach exclues)
function progSessionsOf(d, progId) {
  const up = d.userProgrammes?.[progId];
  if (up) return userSessionOrder(up).map(key => ({ key, ...up.sessions[key] })).filter(s => !s.retired).map(s => ({ key: s.key, label: s.label, color: s.color }));
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
        if (e.repMin) o.repMin = e.repMin;
        if (ssId(e)) o.ss = e.ss;
        const c = cleanConsigne(over?.ex?.[s.key]?.[e.id] !== undefined ? over.ex[s.key][e.id] : e.consigne);
        if (c) o.consigne = c;
        return o;
      }) })),
  };
  const c = cleanConsigne(over && over.prog !== undefined ? over.prog : up?.consigne ?? d.programmes?.[progId]?.consigne);
  if (c) out.consigne = c;
  return out;
}

// Taille du programme envoyé (octets du JSON), pour la limite de 200 Ko
function sentProgrammeBytes(p) { return unescape(encodeURIComponent(JSON.stringify(p))).length; }

// Empreinte de ce que le coach a envoyé, telle que le programme local la reproduit : sert à savoir si
// l'élève l'a modifié depuis l'import
function coachProgrammeHash(d, localId) { return syncHash(cleanSentProgramme(programmeToSent(d, localId))); }

// Programme reçu de coachId déjà importé et non supprimé (archivé = supprimé par l'élève), ou null
function importedCoachProgramme(d, progId, coachId = null) {
  const up = d.userProgrammes?.[coachLocalId(progId, d, coachId)];
  return up && up.fromCoach && !up.archived ? up : null;
}

// État d'un programme de la boîte de réception : 'new' (pas encore dans mes programmes), 'update'
// (nouvel envoi), 'current' (à jour, ou mise à jour refusée par l'élève) ; modified : changé par l'élève
function coachProgrammeStatus(d, item, coachId = null) {
  const id = coachLocalId(item.id, d, coachId);
  const up = importedCoachProgramme(d, item.id, coachId);
  if (!up) return { status: 'new', modified: false, id };
  const fc = up.fromCoach;
  const newer = item.sentAt > (fc.sentAt || 0) && item.sentAt !== fc.keptAt;
  return { status: newer ? 'update' : 'current', modified: coachProgrammeHash(d, id) !== fc.hash, id };
}

// Importe ou met à jour le programme reçu item = { id, data, sentAt } de coachPerson = { user_id, username }.
// Exercices : celui de même nom DANS LA MÊME séance garde son identifiant et ses réglages propres à
// l'élève (records, muscles choisis, objectif) ; un exercice qui change de séance repart d'un nouvel
// identifiant (les records se calculent par séance du programme). Ce que le coach décide (séries,
// repos, mesure, tempo, fourchette, superset, consigne) est remplacé.
// Séance retirée par le coach : gardée avec retired: true (nom et couleur des séances déjà faites dans
// l'historique, rawLabel), mais absente de toutes les listes (sessionKeys). Renvoie l'identifiant local.
function importCoachProgramme(d, item, coachPerson) {
  const sent = cleanSentProgramme(item.data);
  if (!sent || !COACH_PROG_ID_RE.test(item.id)) return null;
  const id = coachLocalId(item.id, d, coachPerson?.user_id);
  const prevUp = d.userProgrammes[id];
  const pd = d.programmes[id] && typeof d.programmes[id] === 'object' ? d.programmes[id] : { exercises: {}, timers: {}, cooldowns: {} };
  pd.exercises ||= {}; pd.timers ||= {}; pd.cooldowns ||= {};
  const old = Object.entries(pd.exercises).flatMap(([cat, xs]) => (Array.isArray(xs) ? xs : []).map(ex => ({ cat, ex })));
  const used = new Set();
  const take = (cat, name) => {
    const n = normName(name);
    const hit = old.find(o => o.cat === cat && !used.has(o.ex) && normName(o.ex.name) === n);
    if (hit) used.add(hit.ex);
    return hit?.ex || null;
  };
  const COACH_FIELDS = ['rest', 'measure', 'tempo', 'repMax', 'repMin', 'ss', 'consigne'];
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
  Object.entries(prevUp?.sessions || {}).forEach(([k, ps]) => {
    if (sessions[k] || !ps || typeof ps !== 'object') return;
    sessions[k] = { ...ps, retired: true };
    exercises[k] = Array.isArray(pd.exercises[k]) ? pd.exercises[k] : [];
  });
  pd.exercises = exercises;
  d.programmes[id] = pd;
  const up = { name: sent.name, sessions, order: Object.keys(sessions), archived: false,
    fromCoach: { coachId: coachPerson?.user_id || prevUp?.fromCoach?.coachId || '', name: coachPerson?.username || prevUp?.fromCoach?.name || null, sentAt: item.sentAt || 0 } };
  if (sent.consigne) up.consigne = sent.consigne;
  d.userProgrammes[id] = up;
  up.fromCoach.hash = coachProgrammeHash(d, id);
  if (!(d.myProgrammes || []).includes(id)) (d.myProgrammes ||= []).push(id);
  return id;
}

// Mise à jour refusée par l'élève (« Garder le mien ») : cet envoi n'est plus proposé
function keepMyCoachProgramme(d, item, coachId = null) {
  const up = importedCoachProgramme(d, item.id, coachId);
  if (up) up.fromCoach.keptAt = item.sentAt;
}

// Côté coach : nom de mon programme avec lequel une séance d'élève a été faite (programme u_c<mon id>
// ou u_c<mon tag>_<mon id>), sinon null
function coachOwnProgrammeName(progField, d = data, myId = account.user?.id) {
  const mine = coachSentIdOf(progField, myId);
  if (!mine) return null;
  if (d.userProgrammes?.[mine]) return d.userProgrammes[mine].name;
  return PROGRAMMES[mine] && mine !== 'custom' ? PROGRAMMES[mine].name : null;
}

// ── État lu et caché ────────────────────────────────────────

function readCoachCache(userId) {
  try {
    const c = JSON.parse(localStorage.getItem(COACH_CACHE_KEY));
    const n = v => (Number.isInteger(v) && v >= 0 ? v : 0);
    return c && c.userId === userId ? { isCoach: c.isCoach === true, hasCoach: c.hasCoach === true, badge: n(c.badge),
      badgeCoach: n(c.badgeCoach), badgeStudent: n(c.badgeStudent) } : null;
  } catch { return null; }
}
function writeCoachCache() {
  if (!coach.userId || !coach.state) return;
  const st = coach.state;
  try { localStorage.setItem(COACH_CACHE_KEY, JSON.stringify({ userId: coach.userId, isCoach: st.is_coach, hasCoach: !!st.coach, badge: st.badge,
    badgeCoach: st.badge_coach, badgeStudent: st.badge_student })); }
  catch { /* cache facultatif */ }
}
// Dernière boîte de l'élève, gardée sur l'appareil (commentaires du coach lisibles hors ligne). Écrite au
// format du serveur, relue par cleanInbox
function readCoachInbox(userId) {
  try {
    const c = JSON.parse(localStorage.getItem(COACH_INBOX_KEY));
    return c && c.userId === userId ? { coach: cleanPerson(c.coach), inbox: cleanInbox(c.inbox) } : null;
  } catch { return null; }
}
function writeCoachInbox() {
  try {
    if (!coach.userId || !coach.inbox || !coach.state?.coach) { if (coach.userId && coach.state && !coach.state.coach) localStorage.removeItem(COACH_INBOX_KEY); return; }
    const ib = coach.inbox;
    localStorage.setItem(COACH_INBOX_KEY, JSON.stringify({ userId: coach.userId, coach: coach.state.coach,
      // Programmes : métadonnées seulement (nom, date, vu) ; le contenu se relit sur le serveur
      inbox: { programmes: ib.programmes.slice(0, 30).map(p => ({ id: p.id, data: { name: p.data.name, sessions: [] }, sent_at: p.sentAt, seen: p.seen, meta: true })),
        notes: ib.notes.slice(0, 200).map(x => ({ session_id: x.session_id, text: x.text, updated_at: x.updatedAt, seen: x.seen })) } }));
  } catch { /* cache facultatif */ }
}
// Mon coach : celui de l'état lu, sinon celui de la dernière boîte gardée
function myCoach() { return coach.state ? coach.state.coach : coach.cachedCoach || null; }

// Rôle connu (état lu, sinon dernier état de l'appareil) : { isCoach, hasCoach }
function coachRole() {
  if (!account.user) return { isCoach: false, hasCoach: false };
  if (coach.state) return { isCoach: coach.state.is_coach, hasCoach: !!coach.state.coach };
  return { isCoach: !!coach.cached?.isCoach, hasCoach: !!coach.cached?.hasCoach };
}
// Badges : onglet Amis (somme), pastille « Mes élèves » (nouvelles séances), « Mon coach » (non vus)
function coachBadge() {
  if (!account.user) return 0;
  return coach.state ? coach.state.badge : (coach.cached?.badge || 0);
}
function coachBadgeCoach() { return !account.user ? 0 : coach.state ? coach.state.badge_coach : (coach.cached?.badgeCoach || 0); }
function coachBadgeStudent() { return !account.user ? 0 : coach.state ? coach.state.badge_student : (coach.cached?.badgeStudent || 0); }

function coachReset(userId) {
  coachSeq++;
  const kept = userId ? readCoachInbox(userId) : null;
  Object.assign(coach, { userId, state: null, cached: userId ? readCoachCache(userId) : null, loading: false, again: false, error: null, loadedAt: 0,
    inbox: kept?.inbox || null, cachedCoach: kept?.coach || null, sessions: {}, preview: null });
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
// Demandée pendant une lecture en cours : relancée à la fin (un changement ne se perd pas)
async function coachRefresh({ minAge = 0 } = {}) {
  if (!sb || !account.user) return false;
  if (coach.loading) { coach.again = true; return false; }
  if (minAge && coach.state && Date.now() - coach.loadedAt < minAge) return true;
  coach.loading = true;
  coach.again = false;
  const seq = coachSeq;
  await coachFlushSeen();
  const r = await coachRpc('coach_state');
  if (seq !== coachSeq) return false;
  let ok = r.ok;
  if (!r.ok) coach.error = r.kind;
  else {
    const before = myCoach();
    coach.state = cleanCoachState(r.data);
    // Plus de coach sans l'avoir quitté ici (retiré par le coach, ou quitté sur un autre appareil) : dit une fois
    if (before && !coach.state.coach && !coach.selfLeft) coachSetLost(personName(before));
    if (coach.state.coach) coachSetLost(null);
    coach.selfLeft = false;
    coach.error = null;
    coach.loadedAt = Date.now();
    writeCoachCache();
    if (coach.state.coach) await coachLoadInbox();
    else coach.inbox = null;
    if (seq !== coachSeq) return false;
    writeCoachInbox();
    // Élève : ce qu'il partage avec son coach, et ses pesées si elles ont changé (js/data/coach-share.js)
    if (typeof coachShareRefresh === 'function') coachShareRefresh();
    // Messages : non-lus et derniers messages (js/data/coach-chat.js)
    if (typeof chatRefresh === 'function') chatRefresh();
  }
  coach.loading = false;
  notifyCoach();
  if (coach.again) { coach.again = false; return coachRefresh(); }
  return ok;
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
  // Rejoindre un coach peut attribuer le compte au coach (parrainage) : état relu à la prochaine lecture
  if (r.ok) { coach.preview = null; if (typeof referral === 'object') referral.state = null; await coachRefresh(); }
  return r.ok ? { ok: true, data: cleanPerson(r.data) } : r;
}
async function coachLeave() {
  const r = await coachRpc('coach_leave');
  if (r.ok) { coach.inbox = null; coach.cachedCoach = null; coach.selfLeft = true; await coachRefresh(); }
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
  if (r.ok) { delete coach.sessions[student]; if (typeof coachWeights === 'object') delete coachWeights[student]; await coachRefresh(); }
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
    coach.state.badge_coach = Math.max(0, coach.state.badge_coach - st.new_sessions);
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
  const r = await coachRpc('coach_send_programme', { student, prog_id: progId, data: p });
  if (r.ok) coachRecordSent(student, progId, Date.now(), p.name);
  return r;
}

// Élève : programme ou commentaire vu (badge)
async function coachMarkInboxSeen(kind, ref) {
  const list = kind === 'programme' ? coach.inbox?.programmes : coach.inbox?.notes;
  const item = (list || []).find(x => (kind === 'programme' ? x.id : x.session_id) === ref);
  if (!item || item.seen) return { ok: true };
  item.seen = true;
  coachQueueSeen(kind, ref);
  if (coach.state) {
    coach.state.badge = Math.max(0, coach.state.badge - 1);
    coach.state.badge_student = Math.max(0, coach.state.badge_student - 1);
    writeCoachCache();
  }
  writeCoachInbox();
  notifyCoach();
  return coachFlushSeen();
}

// « Vu » d'un programme ou d'un commentaire : mis en file sur l'appareil, envoyé tout de suite si possible,
// sinon renvoyé à la prochaine lecture de l'état (hors ligne : le badge du serveur finira par suivre)
function coachSeenQueue() {
  try { const q = JSON.parse(localStorage.getItem(COACH_SEEN_KEY)); return q && q.userId === coach.userId && Array.isArray(q.items) ? q.items : []; }
  catch { return []; }
}
function coachSaveSeenQueue(items) {
  try { if (items.length) localStorage.setItem(COACH_SEEN_KEY, JSON.stringify({ userId: coach.userId, items })); else localStorage.removeItem(COACH_SEEN_KEY); }
  catch { /* file facultative */ }
}
function coachQueueSeen(kind, ref) {
  const items = coachSeenQueue().filter(x => !(x.kind === kind && x.ref === ref));
  coachSaveSeenQueue([...items, { kind, ref }].slice(-100));
}
async function coachFlushSeen() {
  const items = coachSeenQueue();
  if (!items.length || !sb || !account.user) return { ok: true };
  const left = [];
  let last = { ok: true };
  for (const it of items) {
    if (!['programme', 'note'].includes(it?.kind) || typeof it.ref !== 'string') continue;
    const r = await coachRpc('student_mark_seen', { kind: it.kind, ref: it.ref });
    if (!r.ok) { left.push(it); last = r; }
  }
  coachSaveSeenQueue(left);
  return last;
}

// Élève : coach perdu (retiré par le coach) à dire une fois dans l'onglet Amis
function coachLost() {
  try { const c = JSON.parse(localStorage.getItem(COACH_LOST_KEY)); return c && c.userId === coach.userId && typeof c.name === 'string' ? c.name : null; }
  catch { return null; }
}
function coachSetLost(name) {
  try { if (name) localStorage.setItem(COACH_LOST_KEY, JSON.stringify({ userId: coach.userId, name })); else localStorage.removeItem(COACH_LOST_KEY); }
  catch { /* facultatif */ }
}

// Coach : mes envois, gardés sur l'appareil : { [élève]: { [prog_id]: { at, name } } } (ancienne forme : la
// date seule). Le nom sert si le programme a été supprimé depuis ; la date, au repli sans sent du serveur
const sentEntry = v => (typeof v === 'number' ? { at: v, name: null } : v && typeof v === 'object' ? { at: Number(v.at) || 0, name: typeof v.name === 'string' ? v.name.slice(0, 40) : null } : { at: 0, name: null });
function coachSentMap() {
  try { const c = JSON.parse(localStorage.getItem(COACH_SENT_KEY)); return c && c.userId === coach.userId && c.sent && typeof c.sent === 'object' ? c.sent : {}; }
  catch { return {}; }
}
function coachRecordSent(student, progId, at = Date.now(), name = null) {
  const sent = coachSentMap();
  (sent[student] ||= {})[progId] = { at, name };
  try { localStorage.setItem(COACH_SENT_KEY, JSON.stringify({ userId: coach.userId, sent })); } catch { /* facultatif */ }
}
// Programmes que j'ai envoyés à cet élève et avec lesquels il n'a encore fait aucune séance depuis l'envoi
// (sessions : ses séances chargées) : [{ progId, sentAt }]
function coachUnusedSent(student, sessions) {
  const sent = coachSentMap()[student] || {};
  const me = account.user?.id;
  return Object.entries(sent).map(([progId, v]) => ({ progId, sentAt: sentEntry(v).at }))
    .filter(({ progId, sentAt }) => !sessions.some(r => coachSentIdOf(r.s.programme, me) === progId && r.doneAt >= sentAt));
}
// Nom d'un programme que j'ai envoyé : le mien s'il existe encore, sinon celui gardé à l'envoi
function coachSentName(student, progId) {
  if (data.userProgrammes?.[progId] && !data.userProgrammes[progId].archived) return data.userProgrammes[progId].name;
  if (PROGRAMMES[progId] && progId !== 'custom') return PROGRAMMES[progId].name;
  return sentEntry(coachSentMap()[student]?.[progId]).name || data.userProgrammes?.[progId]?.name || 'Programme supprimé';
}

// Programmes envoyés à cet élève et ce qu'il en a fait : [{ progId, sentAt, state }], state = 'unseen'
// (pas encore ouvert), 'unused' (vu, pas encore de séance avec depuis l'envoi), 'used' (vu, séance faite).
// Source : sent de coach_state ; sinon (serveur sans ce champ) mes envois gardés sur l'appareil, réduits à
// ceux sans séance (state 'unused', l'ouverture n'étant pas connue)
function coachSentStatus(student, sessions) {
  const st = coach.state?.students.find(s => s.user_id === student);
  const me = account.user?.id;
  const used = (progId, at) => sessions.some(r => coachSentIdOf(r.s.programme, me) === progId && r.doneAt >= at);
  if (Array.isArray(st?.sent)) {
    return st.sent.slice().sort((a, b) => b.sentAt - a.sentAt)
      .map(x => ({ progId: x.id, sentAt: x.sentAt, state: !x.seen ? 'unseen' : used(x.id, x.sentAt) ? 'used' : 'unused' }));
  }
  return coachUnusedSent(student, sessions).map(x => ({ ...x, state: 'unused' }));
}

// Coach : autoriser un élève retiré à revenir avec un de mes codes
async function coachAllowStudent(student) {
  const r = await coachRpc('coach_allow_student', { student });
  if (r.ok) await coachRefresh();
  return r;
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
  // Ni coach ni élève (d'après le dernier état connu) : une relecture toutes les 5 min au plus
  const { isCoach, hasCoach } = coachRole();
  if (document.visibilityState === 'visible' && account.user) coachRefresh({ minAge: isCoach || hasCoach ? SOCIAL_REFRESH_MS : COACH_IDLE_REFRESH_MS });
});
window.addEventListener?.('online', () => { if (account.user && coach.error === 'offline') coachRefresh(); });
