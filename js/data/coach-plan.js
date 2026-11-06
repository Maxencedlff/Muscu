// ═══════════════════════════════════════════════════════════
//  Planification du coach : phases par élève (« Mini cut, 6 semaines à partir du 9 nov. »), logique
//  pure et appels au serveur, sans affichage. Contrat : docs/COACH_SUIVI.md, « Planification » ;
//  serveur : supabase/migrations/20261105000000_coach_planning.sql. Écrans : js/features/coach-plan-ui.js.
//
//  - Une phase = { id, name, goal, start: 'AAAA-MM-JJ', weeks, progName, note? } : un jour du calendrier
//    et un nombre de semaines, jamais un instant (la semaine 3 est la même partout, à toute heure).
//    La note n'existe que côté coach (le serveur ne la donne jamais à l'élève).
//  - Coach : coach_plans() (toutes ses phases, par élève), coach_plan_save, coach_plan_delete.
//    Élève : student_plan() (ses phases, sans la note).
//  - Serveur sans la planification (fonction absente, PGRST202 → 'missing') : plan.available = false,
//    rien ne s'affiche. Tant que rien n'est lu (null), rien ne s'affiche non plus.
//  - Dernier état lu gardé sur l'appareil (COACH_PLAN_KEY), pour l'afficher hors ligne.
//  - Relu après chaque coachRefresh (js/data/coach.js). L'écran s'abonne par onCoachChange.
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_PLAN_KEY = 'mdlf_coach_plan';   // { userId, available, coach: { [élève]: phases }, student: phases, studentCoach }
const PLAN_MAX_PHASES = 30, PLAN_MAX_WEEKS = 52, PLAN_NAME_MAX = 40, PLAN_PROG_MAX = 40, PLAN_NOTE_MAX = 500;
// Objectifs (même liste que le serveur) : libellé et couleur (jetons de css/base.css)
const PLAN_GOALS = [
  { goal: 'bulk',     label: 'Prise de masse', color: 'var(--orange)' },
  { goal: 'cut',      label: 'Sèche',          color: 'var(--teal)' },
  { goal: 'mini_cut', label: 'Mini cut',       color: 'var(--indigo)' },
  { goal: 'maintain', label: 'Maintien',       color: 'var(--green)' },
  { goal: 'comeback', label: 'Reprise',        color: 'var(--yellow)' },
  { goal: 'strength', label: 'Force',          color: 'var(--red)' },
  { goal: 'prep',     label: 'Préparation',    color: 'var(--purple)' },
  { goal: 'deload',   label: 'Décharge',       color: 'var(--chart-bar)' },
  { goal: 'other',    label: 'Autre',          color: 'var(--tint)' },
];
const PLAN_GOAL_IDS = PLAN_GOALS.map(g => g.goal);
const PLAN_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// available : null tant que rien n'est lu, false si le serveur n'a pas la planification
const plan = { userId: null, available: null, coach: null, coachLoading: false, coachError: null,
  student: null, studentCoach: null, studentLoading: false, studentError: null, busy: false };
let planSeq = 0;   // +1 au changement de compte : une réponse arrivée après n'écrit plus rien

// ── Logique pure : jours du calendrier ──────────────────────

// 'AAAA-MM-JJ' → numéro de jour (UTC, sans heure d'été), null si la date n'existe pas
function planDayNum(iso) {
  const m = PLAN_DAY_RE.exec(String(iso ?? ''));
  if (!m) return null;
  const t = Date.UTC(+m[1], m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === m[2] - 1 && d.getUTCDate() === +m[3] ? t / 86_400_000 : null;
}
function planIsoOf(n) { return new Date(n * 86_400_000).toISOString().slice(0, 10); }
function planAddDays(iso, days) { const n = planDayNum(iso); return n === null ? null : planIsoOf(n + days); }
// Jour du calendrier → horodatage local à midi (affichage avec fmtDate)
function planTs(iso) { const m = PLAN_DAY_RE.exec(iso); return m ? new Date(+m[1], m[2] - 1, +m[3], 12).getTime() : NaN; }
function planToday(now = Date.now()) { return localISO(now); }

function planGoal(goal) { return PLAN_GOALS.find(g => g.goal === goal) || PLAN_GOALS[PLAN_GOALS.length - 1]; }
// Nom affiché : celui du coach, sinon l'objectif
function phaseTitle(p) { return p.name || planGoal(p.goal).label; }
// Dernier jour de la phase (inclus)
function phaseLastDay(p) { return planAddDays(p.start, p.weeks * 7 - 1); }

// Où en est la phase aujourd'hui : { status: 'upcoming' | 'current' | 'done', week (1..weeks, en cours),
// day (jour de la phase, 1..7×weeks), daysLeft (jusqu'à la fin, aujourd'hui compris), daysTo (avant le début) }
function phaseProgress(p, today = planToday()) {
  const t = planDayNum(today), s = planDayNum(p.start), total = p.weeks * 7;
  if (t === null || s === null) return { status: 'upcoming', week: 0, day: 0, daysLeft: total, daysTo: 0 };
  if (t < s) return { status: 'upcoming', week: 0, day: 0, daysLeft: total, daysTo: s - t };
  if (t >= s + total) return { status: 'done', week: p.weeks, day: total, daysLeft: 0, daysTo: 0 };
  const day = t - s + 1;
  return { status: 'current', week: Math.floor((day - 1) / 7) + 1, day, daysLeft: total - day + 1, daysTo: 0 };
}

// « Semaine 3 sur 6 », « Dans 5 jours », « Demain », « Terminée »
function phaseStatusText(p, today = planToday()) {
  const g = phaseProgress(p, today);
  if (g.status === 'current') return `Semaine ${g.week} sur ${p.weeks}`;
  if (g.status === 'done') return 'Terminée';
  return g.daysTo === 1 ? 'Demain' : g.daysTo < 7 ? `Dans ${g.daysTo} jours` : `Dans ${plural(Math.round(g.daysTo / 7), 'semaine', 'semaines')}`;
}
// « Du 9 nov. au 20 déc. »
function phaseRangeText(p) {
  return `Du ${fmtDate(planTs(p.start), 'short')} au ${fmtDate(planTs(phaseLastDay(p)), 'short')}`;
}

// Phases triées (début croissant) ; en cours, prochaine, et dernière terminée
function planSorted(phases) { return (phases || []).slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id - b.id)); }
function planCurrent(phases, today = planToday()) { return planSorted(phases).find(p => phaseProgress(p, today).status === 'current') || null; }
function planNext(phases, today = planToday()) { return planSorted(phases).find(p => phaseProgress(p, today).status === 'upcoming') || null; }

// Début proposé pour une nouvelle phase : le lendemain de la dernière phase si elle finit aujourd'hui ou
// plus tard, sinon aujourd'hui (les phases s'enchaînent sans trou ni chevauchement)
function planNextStart(phases, today = planToday()) {
  const last = planSorted(phases).at(-1);
  const after = last ? planAddDays(phaseLastDay(last), 1) : null;
  return after && after > today ? after : today;
}
// Première phase (dans le temps) que chevaucherait candidate (même règle que le serveur), sinon null
function planOverlap(phases, candidate) {
  const s = planDayNum(candidate.start);
  if (s === null) return null;
  const e = s + candidate.weeks * 7;
  return planSorted(phases).find(p => p.id !== candidate.id && planDayNum(p.start) < e && s < planDayNum(p.start) + p.weeks * 7) || null;
}

// ── Logique pure : nettoyage de ce que renvoie le serveur ───

// Texte d'une ligne (nom, programme) : caractères de contrôle remplacés (\p{Cc}), espaces resserrés, rogné
const planLine = (v, max) => (typeof v === 'string' ? v.replace(/\p{Cc}/gu, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max) : '');
// Phase reçue, null si inutilisable. withNote : côté coach seulement
// L'élève ne reçoit pas d'identifiant (student_plan) : fallbackId, son rang
function cleanPlanPhase(raw, withNote = false, fallbackId = null) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id == null && fallbackId !== null ? fallbackId : Number(raw.id);
  const weeks = Number(raw.weeks);
  if (!Number.isSafeInteger(id) || id <= 0 || planDayNum(raw.start) === null
      || !Number.isInteger(weeks) || weeks < 1 || weeks > PLAN_MAX_WEEKS || !PLAN_GOAL_IDS.includes(raw.goal)) return null;
  // prog_name : serveur ; progName : cache de l'appareil (déjà nettoyé)
  const p = { id, name: planLine(raw.name, PLAN_NAME_MAX), goal: raw.goal, start: raw.start, weeks, progName: planLine(raw.prog_name ?? raw.progName, PLAN_PROG_MAX) || null };
  if (withNote) p.note = typeof raw.note === 'string' ? raw.note.slice(0, PLAN_NOTE_MAX) : '';
  return p;
}
const cleanPlanPhases = (list, withNote) => planSorted((Array.isArray(list) ? list : []).slice(0, PLAN_MAX_PHASES * 2).map(x => cleanPlanPhase(x, withNote)).filter(Boolean));
// coach_plans() nettoyé : { [élève]: phases }
function cleanCoachPlans(raw) {
  const out = {};
  (Array.isArray(raw?.students) ? raw.students : []).forEach(s => {
    if (s && typeof s.student_id === 'string' && s.student_id) out[s.student_id] = cleanPlanPhases(s.phases, true);
  });
  return out;
}
// student_plan() nettoyé : phases (sans note, même si le serveur en envoyait une)
function cleanStudentPlan(raw) {
  if (raw?.coach !== true || !Array.isArray(raw.phases)) return [];
  return planSorted(raw.phases.slice(0, PLAN_MAX_PHASES * 2).map((x, i) => cleanPlanPhase(x, false, i + 1)).filter(Boolean));
}

// Saisie du coach → arguments de coach_plan_save, ou { error } (mêmes bornes que le serveur)
function planSaveArgs(student, f) {
  const name = planLine(f.name, 1000), prog = planLine(f.progName, 1000), note = String(f.note ?? '').replace(/\r/g, '').trim();
  const weeks = Number(f.weeks);
  if (!PLAN_GOAL_IDS.includes(f.goal)) return { error: 'goal' };
  if (planDayNum(f.start) === null) return { error: 'start' };
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > PLAN_MAX_WEEKS) return { error: 'weeks' };
  if (name.length > PLAN_NAME_MAX || prog.length > PLAN_PROG_MAX || note.length > PLAN_NOTE_MAX) return { error: 'too_long' };
  return { args: { student, phase_id: f.id || null, name, goal: f.goal, start_date: f.start, weeks, programme: prog || null, note } };
}

// ── État, cache ─────────────────────────────────────────────

function planAvailable() { return plan.available === true; }
function planOfStudent(uid) { return plan.coach?.[uid] || null; }
// Mes phases, seulement si elles viennent de mon coach actuel (cache d'un ancien coach : rien)
function myPlan() { return plan.student && plan.studentCoach && plan.studentCoach === myCoach()?.user_id ? plan.student : null; }

function readPlanCache(userId) {
  try {
    const c = JSON.parse(localStorage.getItem(COACH_PLAN_KEY));
    if (!c || c.userId !== userId || c.available !== true) return null;
    const coachPlans = {};
    Object.entries(c.coach && typeof c.coach === 'object' ? c.coach : {}).forEach(([k, v]) => { coachPlans[k] = cleanPlanPhases(v, true); });
    return { coach: c.coach ? coachPlans : null, student: Array.isArray(c.student) ? cleanPlanPhases(c.student, false) : null,
      studentCoach: typeof c.studentCoach === 'string' ? c.studentCoach : null };
  } catch { return null; }
}
function writePlanCache() {
  try {
    if (!plan.userId || plan.available !== true) localStorage.removeItem(COACH_PLAN_KEY);
    else localStorage.setItem(COACH_PLAN_KEY, JSON.stringify({ userId: plan.userId, available: true, coach: plan.coach, student: plan.student, studentCoach: plan.studentCoach }));
  } catch { /* facultatif : sans cache, rien hors ligne */ }
}

function planReset(userId) {
  planSeq++;
  // Déconnexion : les notes du coach ne restent pas sur l'appareil (aussi dans CROSS_USER_CACHE_KEYS)
  if (!userId) { try { localStorage.removeItem(COACH_PLAN_KEY); } catch { /* rien */ } }
  const c = userId ? readPlanCache(userId) : null;
  Object.assign(plan, { userId, available: c ? true : null, coach: c?.coach || null, coachLoading: false, coachError: null,
    student: c?.student || null, studentCoach: c?.studentCoach || null, studentLoading: false, studentError: null, busy: false });
}

// ── Appels au serveur ───────────────────────────────────────

// Réponse d'un appel : fonction absente du serveur → planification indisponible (rien ne s'affiche)
function planNoteMissing(r) {
  if (!r.ok && r.kind === 'missing') { plan.available = false; plan.coach = null; plan.student = null; writePlanCache(); }
}

// Relit le planning selon le rôle : coach (tous mes élèves), élève (le mien)
async function coachPlanRefresh() {
  if (!account.user) return false;
  const { isCoach, hasCoach } = coachRole();
  const seq = planSeq;
  const jobs = [];
  if (isCoach && !plan.coachLoading) {
    plan.coachLoading = true;
    jobs.push(coachRpc('coach_plans').then(r => {
      if (seq !== planSeq) return;
      plan.coachLoading = false;
      planNoteMissing(r);
      if (r.ok) { plan.coach = cleanCoachPlans(r.data); plan.available = true; plan.coachError = null; } else plan.coachError = r.kind;
    }));
  } else if (!isCoach) plan.coach = null;
  if (hasCoach && !plan.studentLoading) {
    plan.studentLoading = true;
    const coachId = myCoach()?.user_id || null;
    jobs.push(coachRpc('student_plan').then(r => {
      if (seq !== planSeq) return;
      plan.studentLoading = false;
      planNoteMissing(r);
      if (r.ok) { plan.student = cleanStudentPlan(r.data); plan.studentCoach = coachId; plan.available = true; plan.studentError = null; } else plan.studentError = r.kind;
    }));
  } else if (!hasCoach) { plan.student = null; plan.studentCoach = null; }
  await Promise.all(jobs);
  if (seq !== planSeq) return false;
  writePlanCache();
  notifyCoach();
  return true;
}

// Coach : enregistrer une phase (création si f.id est vide). Renvoie { ok } ou { ok: false, kind }
async function coachPlanSave(student, f) {
  const a = planSaveArgs(student, f);
  if (a.error) return { ok: false, kind: a.error === 'too_long' ? 'too_long' : 'invalid_phase' };
  if (plan.busy) return { ok: false, kind: 'busy' };
  plan.busy = true;
  notifyCoach();
  const seq = planSeq;
  const r = await coachRpc('coach_plan_save', a.args);
  if (seq !== planSeq) return { ok: false, kind: 'signed_out' };
  plan.busy = false;
  planNoteMissing(r);
  if (r.ok) { (plan.coach ||= {})[student] = cleanPlanPhases(r.data, true); writePlanCache(); }
  notifyCoach();
  return r.ok ? { ok: true } : r;
}

async function coachPlanDelete(student, id) {
  if (plan.busy) return { ok: false, kind: 'busy' };
  plan.busy = true;
  notifyCoach();
  const seq = planSeq;
  const r = await coachRpc('coach_plan_delete', { student, phase_id: id });
  if (seq !== planSeq) return { ok: false, kind: 'signed_out' };
  plan.busy = false;
  planNoteMissing(r);
  if (r.ok) { (plan.coach ||= {})[student] = cleanPlanPhases(r.data, true); writePlanCache(); }
  notifyCoach();
  return r.ok ? { ok: true } : r;
}

// ── Déclencheurs ────────────────────────────────────────────

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id !== plan.userId) planReset(id);
});
