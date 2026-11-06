// ═══════════════════════════════════════════════════════════
//  Progression des élèves vue par le coach : qui a progressé, qui décroche, d'un coup d'œil. Logique
//  pure et lecture du serveur, sans affichage. Contrat : docs/COACH_SUIVI.md, « Progression des élèves » ;
//  serveur : supabase/migrations/20261106000000_coach_progression.sql. Écrans : js/features/coach-progress-ui.js.
//
//  - Un seul signal par élève (studentProgress), 22 caractères au plus (une ligne sur un iPhone SE), choisi
//    dans cet ordre :
//      1. inactif   (orange) : pas de séance depuis 8 jours du calendrier ou plus ;
//      2. en baisse (orange) : cette semaine, au moins 2 séances de moins que d'habitude (médiane des 3
//         semaines d'avant, au moins 2 par semaine), jamais pendant une décharge ou une reprise ;
//      3. records   (vert)   : au moins un record noté cette semaine (un par exercice) ;
//      4. stable    (gris)   : aucun record depuis 2 semaines ou plus, sur des séances que l'app sait juger,
//         jamais pendant une phase où l'on ne cherche pas de record (sèche, mini cut, maintien, décharge,
//         reprise) ;
//      5. sinon     (gris)   : le nombre de séances de la semaine.
//    « Cette semaine » = aujourd'hui et les 6 jours d'avant (jours du calendrier) : un lundi matin ne
//    remet pas tout le monde à zéro.
//  - Tri de Mes élèves (sortStudentsByProgress) : nouveautés à lire, puis élèves à relancer, puis records,
//    puis les autres.
//  - Données : coach_progress() (séances des 35 derniers jours avec leurs records notés, pour tous mes
//    élèves en un appel). Serveur sans cette fonction (PGRST202) : les séances déjà reçues de chaque
//    élève (coach_student_sessions), lues page par page en arrière-plan (coachProgressPrefetch).
//    Rien de lu : le signal ne s'appuie que sur coach_state (dernière séance, séances sur 7 jours).
//  - Relu à l'ouverture de Mes élèves et de la fiche d'un élève (5 min au plus entre deux lectures).
// ═══════════════════════════════════════════════════════════
'use strict';

const PROGRESS_DAY_MS = 86_400_000;
const PROGRESS_INACTIVE_DAYS = 8;      // pas de séance depuis 8 jours du calendrier : une semaine entière sautée
const PROGRESS_STABLE_DAYS = 14;       // aucun record depuis 2 semaines : « Stable depuis 2 semaines »
const PROGRESS_HABIT_WEEKS = 3;        // habitude : médiane des 3 semaines d'avant cette semaine
const PROGRESS_HABIT_MIN = 2;          // « en baisse » seulement pour qui s'entraîne au moins 2 fois par semaine
const PROGRESS_FEWER_GAP = 2;          // … et au moins 2 séances de moins que d'habitude (une séance ratée ne compte pas)
const PROGRESS_SERVER_DAYS = 35;       // fenêtre de coach_progress()
const PROGRESS_SERVER_MAX = 80;        // séances au plus par élève dans cette fenêtre
const PROGRESS_STABLE_MAX_WEEKS = 26;  // horizon du serveur (182 jours)
const PROGRESS_MAX_AGE_MS = 5 * 60_000;
const PROGRESS_PREFETCH_MAX = 30;      // serveur sans coach_progress : élèves lus en arrière-plan, au plus
// Phases où l'on s'entraîne moins exprès : jamais « en baisse »
const PROGRESS_LIGHT_GOALS = ['deload', 'comeback'];
// Phases où un record n'est pas le but : jamais « stable » (ce serait lu comme un reproche)
const PROGRESS_NO_RECORD_GOALS = ['deload', 'comeback', 'cut', 'mini_cut', 'maintain'];

// available : null tant que rien n'est lu, false si le serveur n'a pas coach_progress
const progress = { userId: null, available: null, facts: null, loadedAt: 0, loading: false, error: null, prefetching: false };
let progressSeq = 0;   // +1 au changement de compte : une réponse arrivée après n'écrit plus rien

// ── Logique pure : faits ────────────────────────────────────
// Faits d'un élève : { sessions: [{ at, records }], from, firstAt, lastRecordAt, unnotedAt }
//   sessions : séances connues, du plus récent ; records = records notés (cleanNotedRecords), null pour une
//              séance d'une app d'avant les records notés (on ne sait pas) ;
//   from     : début de la période couverte (-Infinity : tout l'historique) ;
//   firstAt, lastRecordAt, unnotedAt : première séance, dernière séance avec un record, dernière séance
//              sans records notés (null : aucune), sur la période que la source connaît.

const progressTime = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Un élève de coach_progress(), lu à loadedAt ; null s'il est inutilisable
function cleanProgressFacts(raw, loadedAt) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sessions)) return null;
  const sessions = raw.sessions.slice(0, PROGRESS_SERVER_MAX)
    .filter(s => s && progressTime(s.at) !== null)
    .map(s => ({ at: s.at, records: cleanNotedRecords(s.records) }))
    .sort((a, b) => b.at - a.at);
  // Fenêtre pleine (80 séances) : la période couverte s'arrête à la plus ancienne reçue
  const from = sessions.length >= PROGRESS_SERVER_MAX ? sessions[sessions.length - 1].at : loadedAt - PROGRESS_SERVER_DAYS * PROGRESS_DAY_MS;
  return { sessions, from, firstAt: progressTime(raw.first_at), lastRecordAt: progressTime(raw.last_record_at), unnotedAt: progressTime(raw.unnoted_at) };
}
// coach_progress() nettoyé : { [élève]: faits }
function cleanCoachProgress(raw, loadedAt) {
  const out = {};
  (Array.isArray(raw?.students) ? raw.students : []).forEach(s => {
    if (!s || typeof s.student_id !== 'string' || !s.student_id) return;
    const f = cleanProgressFacts(s, loadedAt);
    if (f) out[s.student_id] = f;
  });
  return out;
}
// Séances reçues d'un élève (coachSessions : { rows, end, loadedAt }) → faits, null si rien n'est lu
function progressFactsFromRows(f) {
  if (!f?.loadedAt) return null;
  const sessions = f.rows.map(r => ({ at: r.doneAt, records: Array.isArray(r.s.records) ? r.s.records : null })).sort((a, b) => b.at - a.at);
  const maxOf = list => (list.length ? list[0].at : null);
  return {
    sessions,
    from: f.end ? -Infinity : (sessions.length ? sessions[sessions.length - 1].at : Infinity),
    firstAt: sessions.length ? sessions[sessions.length - 1].at : null,
    lastRecordAt: maxOf(sessions.filter(s => s.records?.length)),
    unnotedAt: maxOf(sessions.filter(s => s.records === null)),
  };
}

// ── Logique pure : semaines ─────────────────────────────────

// Médiane d'une liste de nombres (habitude : une semaine à part, malade ou en vacances, ne la fausse pas)
function progressMedian(list) {
  const v = list.slice().sort((a, b) => a - b), m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
// Début (00:00, heure locale) du jour qui précède aujourd'hui de `days` jours
function progressDayStart(now, days) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - days).getTime();
}
// Séances dans la semaine k (0 : cette semaine, aujourd'hui et les 6 jours d'avant ; 1 : la semaine d'avant…)
function progressWeekCount(sessions, k, now) {
  return sessions.filter(s => { const d = Math.max(0, daysAgo(s.at, now)); return d >= 7 * k && d <= 7 * k + 6; }).length;
}
// Une phase d'un de ces objectifs touche-t-elle cette semaine (aujourd'hui et les 6 jours d'avant) ?
function progressPhaseThisWeek(phases, goals, now) {
  const today = planDayNum(localISO(now));
  if (today === null) return false;
  return (phases || []).some(p => {
    const s = planDayNum(p.start);
    return goals.includes(p.goal) && s !== null && s <= today && s + p.weeks * 7 - 1 >= today - 6;
  });
}
// Records de cette semaine, un par exercice (le plus marquant, betterNoted), le plus marquant d'abord :
// [{ ex, r, at }]
function progressWeekRecords(sessions, now) {
  const best = new Map();
  sessions.forEach(s => {
    if (!s.records?.length || daysAgo(s.at, now) > 6) return;
    s.records.forEach(r => {
      const k = normName(r.ex), cur = best.get(k);
      if (!cur || betterNoted(r, cur.r)) best.set(k, { ex: r.ex, r, at: s.at });
    });
  });
  return [...best.values()].sort((a, b) => (NOTED_RANK[b.r.kind] - NOTED_RANK[a.r.kind]) || (b.at - a.at));
}

// ── Logique pure : le signal ────────────────────────────────

// st : élève de coach_state (cleanStudent) ; facts : faits (ou null) ; phases : son planning (ou null).
// Renvoie { kind, tone, text, n7, habit, records, daysSince }, kind parmi inactive, never, fewer, records,
// stable, regular, new ; tone : 'warn' (orange), 'up' (vert, l'écran ajoute la flèche ↑) ou 'muted' (gris).
function studentProgress(st, { facts = null, phases = null, now = Date.now() } = {}) {
  const known = facts?.sessions || [];
  const lastAt = Math.max(st?.last_session?.done_at ?? -Infinity, known.length ? known[0].at : -Infinity);
  const n7 = facts ? progressWeekCount(known, 0, now) : (st?.sessions_7d || 0);
  const records = facts ? progressWeekRecords(known, now) : [];
  const out = (kind, tone, text, extra = {}) => ({ kind, tone, text, n7, habit: null, records, daysSince: null, ...extra });
  const weekTxt = n => `${plural(n, 'séance', 'séances')} cette sem.`;

  // 1. Inactif (ou jamais venu depuis son arrivée)
  if (!Number.isFinite(lastAt)) {
    const since = Date.parse(st?.since);
    return Number.isFinite(since) && daysAgo(since, now) >= PROGRESS_INACTIVE_DAYS
      ? out('never', 'warn', 'Pas encore de séance', { daysSince: daysAgo(since, now) })
      : out('new', 'muted', 'Pas encore de séance');
  }
  const daysSince = Math.max(0, daysAgo(lastAt, now));
  if (daysSince >= PROGRESS_INACTIVE_DAYS) {
    const txt = daysSince < 28 ? `${daysSince} jours` : `${Math.floor(daysSince / 7)} sem.`;
    return out('inactive', 'warn', `${txt} sans séance`, { daysSince });
  }

  // 2. En baisse : seulement si les 3 semaines d'avant sont connues, hors décharge et reprise
  let habit = null;
  if (facts && facts.from <= progressDayStart(now, 7 * (PROGRESS_HABIT_WEEKS + 1) - 1)) {
    habit = progressMedian(Array.from({ length: PROGRESS_HABIT_WEEKS }, (_, i) => progressWeekCount(known, i + 1, now)));
  }
  const light = progressPhaseThisWeek(phases, PROGRESS_LIGHT_GOALS, now);
  if (habit !== null && !light && habit >= PROGRESS_HABIT_MIN && n7 <= habit - PROGRESS_FEWER_GAP) {
    return out('fewer', 'warn', `${plural(n7, 'séance', 'séances')} au lieu de ${fmtNum(habit)}`, { habit, daysSince });
  }

  // 3. Records de la semaine
  if (records.length) return out('records', 'up', `${plural(records.length, 'record', 'records')} cette sem.`, { habit, daysSince });

  // 4. Stable : depuis le dernier record (ou la première séance connue), mais jamais sur une période où une
  //    séance n'a pas de records notés (app d'avant : on ne sait pas)
  const cur = phases ? planCurrent(phases, localISO(now)) : null;
  if (facts && n7 && !(cur && PROGRESS_NO_RECORD_GOALS.includes(cur.goal))) {
    const base = Math.max(facts.lastRecordAt ?? facts.firstAt ?? -Infinity, facts.unnotedAt ?? -Infinity);
    const days = Number.isFinite(base) ? daysAgo(base, now) : -1;
    if (days >= PROGRESS_STABLE_DAYS) {
      const weeks = Math.floor(days / 7);
      const txt = weeks >= PROGRESS_STABLE_MAX_WEEKS ? '6 mois' : `${weeks} sem.`;
      return out('stable', 'muted', `Stable depuis ${txt}`, { habit, daysSince });
    }
  }

  // 5. Le reste : la semaine
  return out('regular', 'muted', weekTxt(n7), { habit, daysSince });
}

// Rang dans Mes élèves : 0 nouveautés à lire (séances ou messages), 1 à relancer (orange), 2 records, 3 le reste
function progressRank(st, pr, unread = 0) {
  if ((st.new_sessions || 0) + unread > 0) return 0;
  if (pr.tone === 'warn') return 1;
  if (pr.kind === 'records') return 2;
  return 3;
}
// Tri de Mes élèves. prOf(st) : son signal ; unreadOf(st) : ses messages non lus. Dans un même rang :
// à relancer, le plus ancien d'abord ; records, le plus de records d'abord ; sinon la séance la plus récente.
// À égalité : le nom (ordre stable d'un affichage à l'autre).
function sortStudentsByProgress(students, prOf, unreadOf = () => 0) {
  const rows = students.map(st => { const pr = prOf(st); return { st, pr, rank: progressRank(st, pr, unreadOf(st)) }; });
  const last = st => st.last_session?.done_at ?? -Infinity;
  rows.sort((a, b) => (a.rank - b.rank)
    || (a.rank === 1 ? (b.pr.daysSince ?? 0) - (a.pr.daysSince ?? 0) : 0)
    || (a.rank === 2 ? b.pr.records.length - a.pr.records.length : 0)
    || (last(b.st) - last(a.st))
    || String(personName(a.st)).localeCompare(String(personName(b.st)), 'fr'));
  return rows;
}

// ── État et lecture du serveur ──────────────────────────────

function progressReset(userId) {
  progressSeq++;
  Object.assign(progress, { userId, available: null, facts: null, loadedAt: 0, loading: false, error: null, prefetching: false });
}
// Faits d'un élève : coach_progress() s'il existe, sinon ses séances déjà reçues
function coachProgressFacts(uid) {
  if (progress.available === true && progress.facts?.[uid]) return progress.facts[uid];
  return progressFactsFromRows(coach.sessions?.[uid]);
}
// Signal d'un élève avec tout ce que l'app sait
function coachStudentProgress(st, now = Date.now()) {
  return studentProgress(st, { facts: coachProgressFacts(st.user_id), phases: typeof planOfStudent === 'function' && planAvailable() ? planOfStudent(st.user_id) : null, now });
}

async function coachProgressRefresh({ minAge = PROGRESS_MAX_AGE_MS } = {}) {
  if (!account.user || !coachRole().isCoach || progress.loading) return false;
  if (progress.available === false) { coachProgressPrefetch(); return false; }
  if (minAge && progress.facts && Date.now() - progress.loadedAt < minAge) return true;
  progress.loading = true;
  const seq = progressSeq, at = Date.now();
  const r = await coachRpc('coach_progress');
  if (seq !== progressSeq) return false;
  progress.loading = false;
  if (r.ok) Object.assign(progress, { facts: cleanCoachProgress(r.data, at), loadedAt: at, available: true, error: null });
  else {
    progress.error = r.kind;
    if (r.kind === 'missing') { progress.available = false; progress.facts = null; coachProgressPrefetch(); }
  }
  notifyCoach();
  return r.ok;
}

// Serveur sans coach_progress : la première page de séances des élèves actifs ces 35 derniers jours, l'un
// après l'autre (les plus récents d'abord), seulement celles qui n'ont pas été lues depuis 5 min
async function coachProgressPrefetch() {
  if (progress.prefetching || !coach.state) return;
  progress.prefetching = true;
  const seq = progressSeq, now = Date.now();
  const todo = coach.state.students
    .filter(s => s.last_session && now - s.last_session.done_at < PROGRESS_SERVER_DAYS * PROGRESS_DAY_MS)
    .filter(s => { const f = coach.sessions[s.user_id]; return !f || (!f.loading && now - f.loadedAt > PROGRESS_MAX_AGE_MS); })
    .sort((a, b) => b.last_session.done_at - a.last_session.done_at)
    .slice(0, PROGRESS_PREFETCH_MAX);
  for (const s of todo) {
    if (seq !== progressSeq) return;
    const r = await coachLoadSessions(s.user_id);
    if (!r.ok && r.kind === 'offline') break;
  }
  if (seq === progressSeq) progress.prefetching = false;
}

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id !== progress.userId) progressReset(id);
});
