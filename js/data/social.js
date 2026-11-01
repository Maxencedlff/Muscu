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
//  - Réactions (liste fermée REACTIONS, comme le serveur : rien à modérer) : une par personne et par
//    séance, posée, changée ou retirée par set_reaction, affichée tout de suite et corrigée par la
//    réponse. Mes séances : réactions reçues (my_reactions, Historique), qui a réagi
//    (session_reactions, seulement les personnes que j'ai acceptées), activité de Mon profil
//    (my_activity), vue côté serveur (mark_activity_seen : la pastille repart de zéro), et mes séances
//    telles que mes abonnés les voient (my_shown_sessions, fil SOCIAL_ME).
//  - Commentaires libres sur une séance : js/data/comments.js (mêmes appels socialRpc, erreurs traduites
//    ici) ; un commentaire reçu sur une de mes séances est une ligne « comment » de l'activité.
//  - Résultats : { ok: true, data } ou { ok: false, kind }. L'écran (js/features/social-ui.js)
//    s'abonne par onSocialChange.
// ═══════════════════════════════════════════════════════════
'use strict';

const SOCIAL_CACHE_KEY  = 'mdlf_social';   // { userId, enabled, badge, activityNew } du dernier état lu
const SOCIAL_QUERY_MIN  = 2;               // recherche : 2 caractères au moins (comme le serveur)
const SOCIAL_PAGE       = 20;              // séances par page du fil (comme le serveur)
const SOCIAL_REFRESH_MS = 30_000;          // retour au premier plan : une relecture toutes les 30 s au plus
const REPORT_DETAILS_MAX = 500;
const SOCIAL_ME = '@me';                   // clé du fil de mes séances telles que les autres les voient
const ACTIVITY_PAGE = 50;                  // lignes par page de l'activité (comme le serveur)
// Réactions, dans l'ordre du choix (liste fermée, la même que la contrainte bravos_kind du serveur).
// La première est celle d'un simple toucher.
const REACTIONS = [
  { kind: 'clap', emoji: '👏', label: 'Applaudissements' },
  { kind: 'fire', emoji: '🔥', label: 'Chaud' },
  { kind: 'strong', emoji: '💪', label: 'Costaud' },
  { kind: 'trophy', emoji: '🏆', label: 'Record' },
  { kind: 'wow', emoji: '😮', label: 'Impressionnant' },
];
const REACTION_DEFAULT = REACTIONS[0].kind;
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
// (clé : identifiant ; SOCIAL_ME : les miennes) ; people : pseudo et avatar connus par identifiant ;
// reactions : réactions reçues sur mes séances (my_reactions), par identifiant de séance ; who : qui a
// réagi à une de mes séances (session_reactions) ; activity : activité de Mon profil (my_activity)
const social = { userId: null, state: null, cached: null, loading: false, error: null, loadedAt: 0,
  feeds: {}, people: {}, reactions: {}, reactionsAt: 0, who: {}, activity: null, seenAt: 0 };
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

// social_state() nettoyé : { enabled, username, avatar, pending_in, following, followers, requested, blocked,
// badge, activity_new, shown_sessions } (shown_sessions : null si le serveur ne le donne pas encore)
function cleanSocialState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const pendingIn = cleanPeople(r.pending_in);
  const nat = v => (Number.isInteger(v) && v >= 0 ? v : null);
  return { enabled: r.enabled === true, username: typeof r.username === 'string' ? r.username : null, avatar: validAvatar(r.avatar),
    pending_in: pendingIn, following: cleanPeople(r.following), followers: cleanPeople(r.followers),
    requested: cleanPeople(r.requested), blocked: cleanPeople(r.blocked), badge: nat(r.badge) ?? pendingIn.length,
    activity_new: nat(r.activity_new) ?? 0, shown_sessions: nat(r.shown_sessions) };
}

// ── Réactions (logique pure) ──

function reactionOf(kind) { return REACTIONS.find(r => r.kind === kind) || null; }
function validReaction(kind) { return reactionOf(kind) ? kind : null; }
// Comptes par sorte reçus du serveur : sortes connues et entiers positifs seulement
function cleanReactionCounts(raw) {
  const out = {};
  if (raw && typeof raw === 'object') for (const r of REACTIONS) if (Number.isInteger(raw[r.kind]) && raw[r.kind] > 0) out[r.kind] = raw[r.kind];
  return out;
}
function reactionTotal(counts) { return Object.values(counts || {}).reduce((a, n) => a + n, 0); }
// Sortes reçues, la plus fréquente d'abord (égalité : ordre de REACTIONS, comme le serveur) ; max premières
function reactionsTop(counts, max = REACTIONS.length) {
  return REACTIONS.filter(r => counts?.[r.kind] > 0)
    .sort((a, b) => counts[b.kind] - counts[a.kind] || REACTIONS.indexOf(a) - REACTIONS.indexOf(b))
    .slice(0, max).map(r => r.kind);
}
// Résumé court : « 🔥👏 3 », '' sans réaction
function reactionsSummary(counts, max = 3) {
  const n = reactionTotal(counts);
  return n ? `${reactionsTop(counts, max).map(k => reactionOf(k).emoji).join('')} ${n}` : '';
}
// Pour VoiceOver : « 3 réactions : 2 Chaud, 1 Applaudissements »
function reactionsSpoken(counts) {
  const n = reactionTotal(counts);
  if (!n) return 'Aucune réaction';
  return `${plural(n, 'réaction', 'réactions')} : ${reactionsTop(counts).map(k => `${counts[k]} ${reactionOf(k).label}`).join(', ')}`;
}
// Ma réaction remplacée par kind (null : retirée) : nouveaux comptes, sans toucher à ceux d'entrée
function withMyReaction(counts, mine, kind) {
  const out = { ...counts };
  if (mine && out[mine]) { out[mine] -= 1; if (!out[mine]) delete out[mine]; }
  if (kind) out[kind] = (out[kind] || 0) + 1;
  return out;
}
// Ce que fait un toucher sur le bouton : réaction par défaut, ou retirer la mienne
function tapReaction(mine) { return mine ? null : REACTION_DEFAULT; }

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
        .map(st => ({ weight: numStr(st.weight), reps: numStr(st.reps), ...(numStr(st.dist) ? { dist: numStr(st.dist) } : {}),
          // Échauffement (true seulement) et RIR (entier 0 à 4), envoyés depuis la migration 20261031100000_records_series.sql
          ...(st.warmup === true ? { warmup: true } : {}), ...(typeof st.rir === 'number' && cleanRir(st.rir) !== null ? { rir: cleanRir(st.rir) } : {}) })),
    }));
  // Records notés par son app (js/data/records.js) ; absents : séance d'une version d'avant, recalculés
  const records = cleanNotedRecords(o.records);
  return {
    date: Number.isFinite(o.date) ? o.date : null,
    duration: Number.isFinite(o.duration) && o.duration > 0 ? o.duration : null,
    programme: str(o.programme, 40), category: str(o.category, 40),
    label: str(o.label, 60).trim() || 'Séance', exercises,
    ...(records ? { records } : {}),
  };
}

function pinnedLegacyMeasure(name) { const ex = { name }; pinLegacyCardioWords(ex); return ex.measure ? { measure: ex.measure } : {}; }

// Ligne de feed() ou de my_shown_sessions() : { owner, username, avatar, id, doneAt, s, reactions, my,
// bravos, mine }, null si inutilisable. reactions : comptes par sorte, my : ma réaction (ou null).
// Serveur d'avant les réactions (bravos et my_bravo seulement) : tout est compté en 👏.
function cleanFeedRow(r) {
  if (!r || typeof r !== 'object' || typeof r.owner !== 'string' || typeof r.id !== 'string') return null;
  const p = cleanPerson({ user_id: r.owner, username: r.username, avatar: r.avatar });
  if (!p) return null;
  const s = cleanPublicSession(r.s);
  const doneAt = Number.isFinite(Number(r.done_at)) ? Number(r.done_at) : s.date;
  if (!Number.isFinite(doneAt)) return null;
  const bravos = Number.isInteger(r.bravos) && r.bravos > 0 ? r.bravos : 0;
  const reactions = r.reactions && typeof r.reactions === 'object' ? cleanReactionCounts(r.reactions) : (bravos ? { [REACTION_DEFAULT]: bravos } : {});
  const my = 'my_reaction' in r ? validReaction(r.my_reaction) : (r.my_bravo === true ? REACTION_DEFAULT : null);
  return { owner: r.owner, username: p.username, avatar: p.avatar, id: r.id, doneAt, s, reactions, my,
    bravos: reactionTotal(reactions), mine: !!my };
}

// Personne qui a réagi à ma séance (session_reactions) : { user_id, username, avatar, kind, at }
function cleanWhoRow(r) {
  const p = cleanPerson(r);
  const kind = validReaction(r?.kind);
  return p && kind ? { user_id: p.user_id, username: p.username, avatar: p.avatar, kind, at: Date.parse(r.at) || null } : null;
}

// Ligne de l'activité (my_activity) : { kind, user_id, username, avatar, at, reaction, sessionId, label,
// sessionAt, isNew, cursor }, null si inutilisable. cursor : { at, key } de la page suivante, at tel que
// le serveur l'a renvoyé (microsecondes : Date.parse les perdrait et sauterait des lignes) et key =
// kind:user_id:session_id, la clé de départage de my_activity à date égale
// Commentaire (comment, migration 20261031500000_commentaires.sql) : commentId et text (120 caractères
// au plus) en plus ; sa clé de départage finit par l'identifiant du commentaire (comment:user:séance:id)
const ACTIVITY_KINDS = ['reaction', 'comment', 'follower', 'accepted', 'request'];
function cleanActivityRow(r) {
  if (!r || !ACTIVITY_KINDS.includes(r.kind)) return null;
  const p = cleanPerson(r);
  const at = Date.parse(r.at);
  if (!p || !Number.isFinite(at)) return null;
  const onSession = r.kind === 'reaction' || r.kind === 'comment';
  const reaction = r.kind === 'reaction' ? validReaction(r.reaction) : null;
  if (r.kind === 'reaction' && !reaction) return null;
  if (onSession && typeof r.session_id !== 'string') return null;
  const commentId = r.kind === 'comment' ? Number(r.comment_id) : null;
  if (r.kind === 'comment' && (!Number.isSafeInteger(commentId) || commentId <= 0)) return null;
  const key = r.kind === 'comment' ? `comment:${r.user_id}:${r.session_id}:${commentId}` : `${r.kind}:${r.user_id}:${r.kind === 'reaction' ? r.session_id : ''}`;
  return { kind: r.kind, user_id: p.user_id, username: p.username, avatar: p.avatar, at, reaction,
    sessionId: onSession ? r.session_id : null,
    ...(r.kind === 'comment' ? { commentId, text: typeof r.comment_text === 'string' ? [...r.comment_text].slice(0, 120).join('') : '' } : {}),
    label: typeof r.session_label === 'string' ? r.session_label.slice(0, 60) : '',
    sessionAt: Number.isFinite(Number(r.session_at)) && r.session_at != null ? Number(r.session_at) : null,
    isNew: r.is_new === true,
    cursor: { at: String(r.at), key } };
}

// Texte d'une ligne de l'activité, sans le pseudo (affiché en gras devant) : « a réagi 🔥 à ta séance
// Legs ». sessionLabel : nom de la séance sur cet appareil, s'il est connu (sinon celui du serveur).
function activityText(row, sessionLabel = '') {
  if (row.kind === 'reaction') {
    const name = sessionLabel || row.label;
    return `a réagi ${reactionOf(row.reaction).emoji} à ta séance${name ? ` ${name}` : ''}`;
  }
  if (row.kind === 'comment') {
    const name = sessionLabel || row.label;
    return `a commenté ta séance${name ? ` ${name}` : ''}${row.text ? ` : « ${row.text.replace(/\s+/g, ' ')} »` : ''}`;
  }
  return { follower: 'a commencé à te suivre', accepted: 'a accepté ta demande', request: 'veut voir tes séances' }[row.kind];
}

// Activité de Mon profil, groupée : les réactions à une même séance tiennent en une ligne dès qu'il y en a
// deux (« 3 réactions sur Push de vendredi ») ; une réaction seule, un commentaire (son texte compte), un
// abonné ou une demande restent des lignes à part. Ordre d'arrivée gardé (du plus récent au plus ancien),
// un groupe à la place de sa réaction la plus récente.
// [{ kind: 'single', row } | { kind: 'reactions', sessionId, rows }]
function groupActivity(rows) {
  const out = [], bySession = new Map();
  (rows || []).forEach(a => {
    if (a.kind !== 'reaction' || !a.sessionId) { out.push({ kind: 'single', row: a }); return; }
    let g = bySession.get(a.sessionId);
    if (!g) { g = { kind: 'reactions', sessionId: a.sessionId, rows: [] }; bySession.set(a.sessionId, g); out.push(g); }
    g.rows.push(a);
  });
  return out.map(g => (g.kind === 'reactions' && g.rows.length === 1 ? { kind: 'single', row: g.rows[0] } : g));
}
// Jour d'une séance dans une phrase : « d'aujourd'hui », « d'hier », « de vendredi » (cette semaine
// glissante), puis « du 28 oct. » ; '' sans date
function sessionDayTxt(ts, now = Date.now()) {
  if (!Number.isFinite(ts)) return '';
  const d = daysAgo(ts, now);
  if (d <= 0) return 'd\'aujourd\'hui';
  if (d === 1) return 'd\'hier';
  if (d < 7) return `de ${new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long' })}`;
  return `du ${fmtDate(ts, 'short')}`;
}
// Phrase d'un groupe de réactions : « 3 réactions sur Push de vendredi » (texte brut). label : nom de la
// séance (cet appareil, sinon le serveur) ; at : sa date, si elle est connue
function reactionsGroupText(count, label, at, now = Date.now()) {
  const day = sessionDayTxt(at, now);
  return `${plural(count, 'réaction', 'réactions')} sur ${label || 'ta séance'}${day ? ` ${day}` : ''}`;
}
// Qui a réagi, en une ligne courte : « lea, paul +1 » (deux pseudos au plus, puis le reste en nombre)
function reactorsLine(names, shown = 2) {
  const uniq = [...new Set(names)];
  return uniq.length > shown ? `${uniq.slice(0, shown).join(', ')} +${uniq.length - shown}` : uniq.join(', ');
}

// « à l'instant », « il y a 5 min », « il y a 2 h », « hier », « il y a 3 j », puis la date
function fmtAgo(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'à l\'instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'hier';
  if (d < 7) return `il y a ${d} j`;
  return fmtDate(at);
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
  for (const k of ['social_not_enabled', 'username_required', 'age_required', 'rate_limited', 'not_found',
    // Commentaires (js/data/comments.js)
    'empty_comment', 'too_long', 'comment_forbidden', 'invalid_reason']) if (msg.includes(k)) return k;
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
  // Commentaires (js/data/comments.js)
  empty_comment: 'Écris quelque chose avant d\'envoyer.',
  too_long: 'Commentaire trop long : 500 caractères au plus.',
  comment_forbidden: 'Ce commentaire contient un mot interdit par les règles de la communauté.',
  invalid_reason: 'Choisis un motif pour signaler.',
  busy: 'Envoi déjà en cours.',
  server: 'Action impossible pour l\'instant, réessaie dans un moment.',
};
function socialErrorText(kind) { return SOCIAL_ERROR_TEXT[kind] || SOCIAL_ERROR_TEXT.server; }

// ── État lu et caché ────────────────────────────────────────

function readSocialCache(userId) {
  try {
    const c = JSON.parse(localStorage.getItem(SOCIAL_CACHE_KEY));
    const n = v => (Number.isInteger(v) && v >= 0 ? v : 0);
    return c && c.userId === userId ? { enabled: c.enabled === true, badge: n(c.badge), activityNew: n(c.activityNew) } : null;
  } catch { return null; }
}
function writeSocialCache() {
  if (!social.userId || !social.state) return;
  const st = social.state;
  try { localStorage.setItem(SOCIAL_CACHE_KEY, JSON.stringify({ userId: social.userId, enabled: st.enabled, badge: st.badge, activityNew: st.activity_new })); }
  catch { /* cache facultatif */ }
}

// Social activé : état lu, sinon dernier état connu sur l'appareil
function socialEnabled() { return !!account.user && !!(social.state ? social.state.enabled : social.cached?.enabled); }
// Réglages › Amis et coach › Séances visibles par défaut : absent = oui (toute séance visible des abonnés
// tant qu'on n'éteint pas « Visible sur mon profil » à la fin)
function sessionsVisibleByDefault(d = data) { return d.sessionVisibleDefault !== false; }
// Une séance qui se termine maintenant naît masquée (hidden: true) : Amis activé et réglage éteint
function newSessionHidden(d = data) { return socialEnabled() && !sessionsVisibleByDefault(d); }
// Badge de l'onglet : demandes reçues en attente, plus les nouveautés de l'activité (réactions à mes
// séances, demandes acceptées) jusqu'à l'ouverture de Mon profil
function socialBadge() { return socialPending() + socialActivityNew(); }
function socialPending() {
  if (!account.user) return 0;
  return social.state ? (social.state.enabled ? social.state.badge : 0) : (social.cached?.enabled ? social.cached.badge : 0);
}
function socialActivityNew() {
  if (!account.user) return 0;
  return social.state ? (social.state.enabled ? social.state.activity_new : 0) : (social.cached?.enabled ? social.cached.activityNew : 0);
}

function rememberPeople(list) {
  for (const p of list || []) if (p?.user_id) social.people[p.user_id] = { username: p.username, avatar: p.avatar };
}
function socialPerson(userId) { return social.people[userId] || null; }

// Compte changé (connexion, déconnexion, autre compte) : tout repart de zéro, lecture en arrière-plan
function socialReset(userId) {
  socialSeq++;
  Object.assign(social, { userId, state: null, cached: userId ? readSocialCache(userId) : null, loading: false, error: null, loadedAt: 0,
    feeds: {}, people: {}, reactions: {}, reactionsAt: 0, who: {}, activity: null, seenAt: 0 });
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

// Relit social_state (et les réactions reçues si le social est activé). minAge : pas de relecture si le
// dernier état a moins de minAge ms. Renvoie true si l'état a pu être lu.
async function socialRefresh({ minAge = 0 } = {}) {
  if (!sb || !account.user || social.loading) return false;
  if (minAge && social.state && Date.now() - social.loadedAt < minAge) return true;
  social.loading = true;
  const seq = socialSeq, askedAt = Date.now();
  const r = await socialRpc('social_state');
  if (seq !== socialSeq) return false;
  social.loading = false;
  if (!r.ok) { social.error = r.kind; notifySocial(); return false; }
  social.state = cleanSocialState(r.data);
  // Activité vue pendant la lecture : la réponse, partie avant, ne rallume pas la pastille
  if (social.seenAt >= askedAt) social.state.activity_new = 0;
  social.error = null;
  social.loadedAt = Date.now();
  const st = social.state;
  rememberPeople([...st.pending_in, ...st.following, ...st.followers, ...st.requested, ...st.blocked]);
  writeSocialCache();
  notifySocial();
  if (st.enabled) socialLoadMyReactions();
  return true;
}

async function socialEnable(ageOk) {
  const r = await socialRpc('social_enable', { age_ok: ageOk === true });
  if (r.ok) await socialRefresh();
  return r;
}
async function socialDisable() {
  const r = await socialRpc('social_disable');
  if (r.ok) { social.feeds = {}; social.activity = null; social.who = {}; social.reactions = {}; await socialRefresh(); }
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
  if (r.ok) { forgetPersonActivity(follower); await socialRefresh(); }
  return r;
}
async function socialBlock(target) {
  const r = await socialRpc('block_user', { target });
  if (r.ok) { dropFromFeeds(target); forgetPersonActivity(target); await socialRefresh(); }
  return r;
}
async function socialUnblock(target) {
  const r = await socialRpc('unblock_user', { target });
  if (r.ok) await socialRefresh();
  return r;
}

// Abonné retiré ou bloqué : ses réactions ne comptent plus (règle du serveur), retirées sans attendre
// la relecture ; les comptes de mes séances sont relus
function forgetPersonActivity(uid) {
  if (typeof commentsForget === 'function') commentsForget(uid);   // js/data/comments.js
  if (social.activity) social.activity.rows = social.activity.rows.filter(a => a.user_id !== uid);
  for (const w of Object.values(social.who)) w.rows = w.rows.filter(x => x.user_id !== uid);
  delete social.feeds[SOCIAL_ME];
  social.reactionsAt = 0;
  socialLoadMyReactions();
}

// ── Fil ─────────────────────────────────────────────────────

// Fil (''), séances d'un profil (identifiant) ou les miennes vues par les autres (SOCIAL_ME) :
// { rows, end, loading, error, loadedAt, triedAt }
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
  let r;
  if (key === SOCIAL_ME) {
    // Curseur (done_at, id) : toutes les séances sont à moi
    r = await socialRpc('my_shown_sessions', last ? { before_at: last.doneAt, before_id: last.id } : {});
  } else {
    const args = last ? { before_at: last.doneAt, before_owner: last.owner, before_id: last.id } : {};
    if (key) args.only_user = key;
    r = await socialRpc('feed', args);
  }
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

// Ma réaction posée, changée ou retirée (kind null) : affichée tout de suite sur chaque copie de la
// séance (fil et profil), corrigée par la réponse du serveur, ou annulée s'il refuse
async function socialSetReaction(owner, id, kind) {
  kind = kind == null ? null : validReaction(kind);
  const copies = Object.values(social.feeds).map(f => f.rows.find(r => r.owner === owner && r.id === id)).filter(Boolean);
  if (!copies.length) return { ok: false, kind: 'not_found' };
  if (copies[0].my === kind) return { ok: true };
  const before = { reactions: copies[0].reactions, my: copies[0].my };
  const set = (reactions, my) => copies.forEach(c => { c.reactions = reactions; c.my = my; c.bravos = reactionTotal(reactions); c.mine = !!my; });
  set(withMyReaction(before.reactions, before.my, kind), kind);
  notifySocial();
  const r = await socialRpc('set_reaction', { owner, session_id: id, kind });
  if (!r.ok) { set(before.reactions, before.my); notifySocial(); return r; }
  if (r.data && typeof r.data === 'object' && r.data.reactions) { set(cleanReactionCounts(r.data.reactions), validReaction(r.data.my_reaction)); notifySocial(); }
  return { ok: true };
}

// Réactions reçues sur mes séances (Historique) : { total, top, counts } par séance ; minAge comme socialRefresh
async function socialLoadMyReactions({ minAge = 0 } = {}) {
  if (minAge && Date.now() - social.reactionsAt < minAge) return;
  social.reactionsAt = Date.now();
  const r = await socialRpc('my_reactions');
  if (!r.ok) return;
  const next = {};
  for (const x of Array.isArray(r.data) ? r.data : []) {
    if (typeof x?.session_id !== 'string') continue;
    const counts = cleanReactionCounts(x.reactions);
    if (reactionTotal(counts)) next[x.session_id] = { total: reactionTotal(counts), top: reactionsTop(counts, 1)[0], counts };
  }
  if (JSON.stringify(next) === JSON.stringify(social.reactions)) return;
  social.reactions = next;
  notifySocial();
}
function myReactions(sessionId) { return social.reactions[sessionId] || null; }

// Qui a réagi à ma séance : { rows, loading, error, loadedAt } ; relu à chaque ouverture (minAge)
function sessionWho(sessionId) { return social.who[sessionId] || null; }
async function socialLoadWho(sessionId, { minAge = 0 } = {}) {
  const w = social.who[sessionId] ||= { rows: [], loading: false, error: null, loadedAt: 0 };
  if (w.loading || (minAge && Date.now() - w.loadedAt < minAge)) return;
  w.loading = true;
  const seq = socialSeq;
  const r = await socialRpc('session_reactions', { session_id: sessionId });
  if (seq !== socialSeq) return;
  w.loading = false;
  if (!r.ok) { w.error = r.kind; notifySocial(); return; }
  w.rows = (Array.isArray(r.data) ? r.data : []).map(cleanWhoRow).filter(Boolean);
  w.error = null;
  w.loadedAt = Date.now();
  rememberPeople(w.rows);
  notifySocial();
}

// Activité de Mon profil : { rows, end, loading, error, loadedAt }. Première page (more : false) ou la
// suivante (après la dernière ligne : son curseur, cleanActivityRow)
function socialActivity() { return social.activity ||= { rows: [], end: false, loading: false, error: null, loadedAt: 0 }; }
async function socialLoadActivity({ more = false } = {}) {
  const a = socialActivity();
  if (a.loading || (more && a.end)) return;
  a.loading = true;
  const seq = socialSeq;
  notifySocial();
  const last = more ? a.rows[a.rows.length - 1] : null;
  const r = await socialRpc('my_activity', last ? { before_at: last.cursor.at, before_key: last.cursor.key } : {});
  if (seq !== socialSeq) return;
  a.loading = false;
  if (!r.ok) { a.error = r.kind; notifySocial(); return; }
  const rows = (Array.isArray(r.data) ? r.data : []).map(cleanActivityRow).filter(Boolean);
  rememberPeople(rows);
  a.rows = [...(more ? a.rows : []), ...rows];
  a.end = (Array.isArray(r.data) ? r.data.length : 0) < ACTIVITY_PAGE;
  a.error = null;
  a.loadedAt = Date.now();
  notifySocial();
}

// Activité vue (Mon profil ouvert) : la pastille s'éteint tout de suite, le serveur le note
async function socialMarkActivitySeen() {
  if (!socialActivityNew()) return;
  if (social.state) social.state.activity_new = 0;
  if (social.cached) social.cached.activityNew = 0;
  social.seenAt = Date.now();
  writeSocialCache();
  notifySocial();
  await socialRpc('mark_activity_seen');
}

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

// Alerte par e-mail d'un signalement déjà enregistré par une RPC (report_comment, report_chat : la
// copie du commentaire ou des messages est gardée côté serveur) : fonction Edge report, { report_id }.
// Au mieux, sans attendre : sans réseau, ou avec une fonction report d'avant, le signalement reste
// enregistré (notified_at nul, rattrapé à la main, docs/SOCIAL_V1.md) et rien n'est dit à l'utilisateur.
async function socialReportAlert(reportId) {
  if (!sb || !account.user || !Number.isSafeInteger(reportId) || reportId <= 0) return false;
  try {
    const { data: res, error } = await sb.functions.invoke('report', { body: { report_id: reportId } });
    return !error && res?.ok === true;
  } catch { return false; }
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
