// ═══════════════════════════════════════════════════════════
//  Suivi de la diète par le coach : l'élève choisit de montrer à son coach, jour par jour, s'il suit sa diète
//  (repas cochés, eau, sel, écart avec l'objectif du jour). Contrat : docs/NUTRITION_V1.md, « Suivi de la diète par
//  le coach » ; serveur : supabase/migrations/20261118010000_suivi_diete_coach.sql. Écrans : js/features/coach-diet-ui.js
//  (carte Diète du coach) et js/features/coach-share-ui.js (case « Suivi de ma diète » de l'élève).
//
//  - Consentement : une case de « Partager avec mon coach » (coach_shares, kind 'diet_log'), décochée par défaut,
//    montrée seulement si le serveur l'annonce (student_shares().kinds). Décocher efface tout côté serveur.
//  - Ce qui part : un résumé par jour (dietShareDay), jamais les aliments, les remplacements ni les heures. 90 jours au
//    plus (le serveur ne garde rien de plus vieux). Miroir de l'appareil (le journal reste sur l'iPhone,
//    SYNC_LOCAL_ONLY) : même règle que les pesées (js/data/coach-share.js, coachShareUploadKind).
//  - Quand : au cochage, puis 5 s après un enregistrement (save, js/data/store.js) si le résumé a changé, et à la
//    relecture de l'état du partage. L'empreinte évite tout envoi inutile.
//  - Côté coach : lecture des jours d'un élève (coach_student_diet) et, pour « À relancer » de Mes élèves, les
//    derniers jours de tous ses élèves en un appel (coach_diet_overview). Statut d'un jour par seuils d'écart.
// ═══════════════════════════════════════════════════════════
'use strict';

const DIET_SHARE_DAYS = 90;          // jours envoyés et gardés (le serveur écarte le reste)
const DIET_SHARE_OK_PCT = 10;        // suivi : à 10 % de l'objectif de calories, ou moins
const DIET_SHARE_PART_PCT = 25;      // partiel : à 25 % ; au-delà : pas suivi
const DIET_SHARE_PROT_SHARE = 0.9;   // suivi : protéines atteintes à 90 % au moins (panel du 18/11 : des kcal justes sans les
                                     // protéines ne sont pas une diète suivie ; au-dessus de l'objectif ne compte pas contre)
const DIET_SHARE_WARN_DAYS = 3;      // à relancer : les 3 jours d'avant aujourd'hui, tous pas suivis ou sans rien de noté
const DIET_SHARE_WEEKS = 12;         // semaines que le coach peut remonter (84 jours, sous les 90 gardés)
const DIET_SHARE_DEBOUNCE_MS = 5000; // un envoi au plus toutes les 5 s pendant qu'on coche
const DIET_SHARE_MAX_AGE_MS = 5 * 60_000;
const DIET_SHARE_RETRY_MS = 10 * 60_000;   // serveur sans la fonction : nouvel essai après 10 min

const dsInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
// Nom envoyé ou lu : caractères de contrôle remplacés (le serveur les refuse), 40 caractères au plus
const dsCtrl = ch => { const c = ch.charCodeAt(0); return c < 32 || (c >= 127 && c < 160); };
const dsName = v => dietText(Array.from(String(v ?? ''), ch => (dsCtrl(ch) ? ' ' : ch)).join(''), DIET_NAME_MAX);

// ── Élève : le résumé d'un jour (logique pure) ──────────────

// Résumé envoyé pour ce jour, ou null s'il n'y a rien à dire (ni plan, ni eau, ni sel). Le plan est celui du journal
// de ce jour-là (aujourd'hui sans rien de noté : le plan suivi).
function dietShareDay(d, day, today = dietDayKey()) {
  const e = d.dietLog?.[day];
  const planId = e?.plan || (day === today ? d.dietActive : null) || null;
  const plan = planId ? dietDayPlan(d, planId, day, e) : null;
  const ml = typeof waterDayMl === 'function' ? waterDayMl(d, day) : 0;
  const added = saltAddedG(d, day);
  if (!plan && !ml && !added) return null;
  const out = { day, plan: null, name: null, kind: null, meals: [], kcal: 0, p: 0, c: 0, f: 0, goal: null, water: dsInt(ml, 0, 20000),
    waterGoal: null, waterMin: null, salt: added ? Math.round(Math.min(100, added) * 10) / 10 : null, saltMin: null, saltMax: null };
  if (!plan || !DIET_ID_RE.test(planId)) return out;
  const pr = dietDayProgress(d, planId, day);
  if (!pr) return out;
  const ent = dietDay(d, planId, day);
  const shown = dietShownMeals(pr.plan);
  const req = new Set(dietDayRequired(shown, ent));
  out.plan = planId;
  out.name = dsName(d.dietPlans[planId]?.name) || null;
  out.kind = dietDayIndex(d, planId, day, e).kind || null;
  out.meals = shown.filter(m => req.has(m.id)).slice(0, DIET_MEAL_MAX).map(m => ({ n: dsName(m.name) || 'Repas', ok: dietMealSatisfied(ent, m.id) }));
  out.kcal = dsInt(pr.eaten.kcal, 0, 20000);
  out.p = dsInt(pr.eaten.p, 0, 2000); out.c = dsInt(pr.eaten.c, 0, 2000); out.f = dsInt(pr.eaten.f, 0, 2000);
  out.goal = { kcal: dsInt(pr.goal.kcal, 0, 10000), p: dsInt(pr.goal.p, 0, 600), c: dsInt(pr.goal.c, 0, 1500), f: dsInt(pr.goal.f, 0, 600) };
  const t = pr.plan.targets || {};
  const wHi = cleanWaterLitres(t.water), wLo = cleanWaterLitres(t.waterMin);
  if (wHi !== null) { out.waterGoal = Math.round(wHi * 1000); if (wLo !== null && wLo < wHi) out.waterMin = Math.round(wLo * 1000); }
  const s = dietDaySalt(d, pr), sg = dietSaltGoal(pr.plan);
  out.salt = Math.round(Math.min(100, s.g) * 10) / 10;
  if (sg) { out.saltMin = sg.min; out.saltMax = sg.max; }
  return out;
}

// Les jours envoyés : les 90 derniers jours (aujourd'hui compris), du plus récent, ceux qui ont quelque chose
function dietSharePayload(d = data, now = Date.now()) {
  const today = dietDayKey(now), out = [];
  for (let i = 0; i < DIET_SHARE_DAYS; i++) {
    const t = new Date(now); t.setHours(12, 0, 0, 0); t.setDate(t.getDate() - i);
    const x = dietShareDay(d, dietDayKey(t.getTime()), today);
    if (x) out.push(x);
  }
  return out;
}

// Enregistrement fait (save) : renvoi du résumé dans 5 s s'il a changé (aucun envoi si rien n'est partagé)
let dietShareTimer = 0;
function dietShareSchedule() {
  if (typeof account === 'undefined' || !account.user || typeof coachShareOn !== 'function' || !coachShareOn('diet_log')) return;
  clearTimeout(dietShareTimer);
  dietShareTimer = setTimeout(() => {
    dietShareTimer = 0;
    if (account.user && coachShareOn('diet_log')) coachShareUploadKind('diet_log', { force: true, ifChanged: true });
  }, DIET_SHARE_DEBOUNCE_MS);
}

// ── Statut d'un jour (logique pure, élève et coach) ─────────

// Écart en % avec l'objectif de calories du jour (−20 : 20 % sous l'objectif), null sans objectif
function dietShareGap(x) {
  const g = Number(x?.goal?.kcal) || 0;
  return g > 0 ? Math.round((x.kcal - g) / g * 100) : null;
}
// 'ok' (suivi), 'part' (partiel), 'off' (pas suivi), 'none' (rien de noté), 'today' (aujourd'hui, pas encore suivi).
// Par l'écart de calories (suivi : à 10 % près ET protéines atteintes à 90 %, quand le jour en a un objectif ; sinon
// partiel) ; sans objectif de calories, par les repas cochés
function dietShareStatus(x, { today = false } = {}) {
  if (!x) return today ? 'today' : 'none';
  const gap = dietShareGap(x), meals = Array.isArray(x.meals) ? x.meals : [];
  const done = meals.filter(m => m.ok).length;
  const gp = Number(x.goal?.p) || 0, protOk = !(gp > 0) || !Number.isFinite(Number(x.p)) || Number(x.p) >= gp * DIET_SHARE_PROT_SHARE;
  let s;
  if (gap !== null) s = Math.abs(gap) <= DIET_SHARE_OK_PCT ? (protOk ? 'ok' : 'part') : Math.abs(gap) <= DIET_SHARE_PART_PCT ? 'part' : 'off';
  else s = meals.length && done === meals.length ? 'ok' : done ? 'part' : 'off';
  return today && s !== 'ok' ? 'today' : s;
}
const DIET_SHARE_WORDS = { ok: 'suivi', part: 'partiel', off: 'pas suivi', none: 'rien de noté', today: 'en cours' };

// ── Coach : nettoyage de ce que rend le serveur ─────────────

const DS_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function cleanDietShareDay(v) {
  if (!v || typeof v !== 'object' || !DS_DAY_RE.test(v.day)) return null;
  const n = (x, lo, hi) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Math.min(hi, Math.max(lo, Number(x))) : null);
  const goal = v.goal && typeof v.goal === 'object' ? { kcal: n(v.goal.kcal, 0, 10000), p: n(v.goal.p, 0, 600), c: n(v.goal.c, 0, 1500), f: n(v.goal.f, 0, 600) } : null;
  return {
    day: v.day, plan: typeof v.plan === 'string' ? v.plan : null, name: typeof v.name === 'string' ? dsName(v.name) || null : null,
    kind: v.kind === 't' || v.kind === 'r' ? v.kind : null,
    meals: (Array.isArray(v.meals) ? v.meals : []).slice(0, DIET_MEAL_MAX).filter(m => m && typeof m.n === 'string').map(m => ({ n: dsName(m.n) || 'Repas', ok: m.ok === true })),
    kcal: n(v.kcal, 0, 20000) ?? 0, p: n(v.p, 0, 2000) ?? 0, c: n(v.c, 0, 2000) ?? 0, f: n(v.f, 0, 2000) ?? 0, goal,
    water: n(v.water, 0, 20000) ?? 0, waterGoal: n(v.waterGoal, 0, 10000), waterMin: n(v.waterMin, 0, 10000),
    salt: n(v.salt, 0, 100), saltMin: n(v.saltMin, 0, 15), saltMax: n(v.saltMax, 0, 15),
  };
}
// coach_student_diet() nettoyé : { shared, since, days: { 'AAAA-MM-JJ': jour } }
function cleanCoachDiet(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const shared = r.shared === true, days = {};
  if (shared && Array.isArray(r.days)) r.days.slice(0, DIET_SHARE_DAYS + 2).forEach(v => { const x = cleanDietShareDay(v); if (x) days[x.day] = x; });
  return { shared, since: shared ? coachTime(r.since) : null, days };
}
// coach_diet_overview() nettoyé : { [élève]: { since, days: { jour: { kcal, p, goal: { kcal, p }, meals } } } }
function cleanDietOverview(raw) {
  const out = {};
  (Array.isArray(raw?.students) ? raw.students : []).forEach(s => {
    if (!s || typeof s.student_id !== 'string') return;
    const days = {};
    (Array.isArray(s.days) ? s.days : []).slice(0, 10).forEach(a => {
      if (!Array.isArray(a) || !DS_DAY_RE.test(a[0])) return;
      const done = Math.max(0, Number(a[3]) || 0), n = Math.max(0, Number(a[4]) || 0);
      days[a[0]] = { kcal: Number(a[1]) || 0, goal: { kcal: Number(a[2]) || 0, p: Number(a[6]) || 0 }, p: Number(a[5]) || 0, meals: Array.from({ length: n }, (_, i) => ({ ok: i < done })) };
    });
    out[s.student_id] = { since: coachTime(s.since), days };
  });
  return out;
}

// Jours AAAA-MM-JJ, du plus ancien : les 7 jours qui finissent `weeks` semaines avant aujourd'hui
function dietShareWeekDays(weeks = 0, now = Date.now()) {
  return Array.from({ length: 7 }, (_, j) => {
    const t = new Date(now); t.setHours(12, 0, 0, 0); t.setDate(t.getDate() - weeks * 7 - (6 - j));
    return dietDayKey(t.getTime());
  });
}

// À relancer pour sa diète : partagée depuis avant ces jours-là, et les 3 jours d'avant aujourd'hui pas suivis
// (ou sans rien de noté). ov : un élève de cleanDietOverview, ou absent (ne partage pas : jamais)
function dietShareWarn(ov, now = Date.now()) {
  if (!ov) return false;
  const days = Array.from({ length: DIET_SHARE_WARN_DAYS }, (_, i) => {
    const t = new Date(now); t.setHours(12, 0, 0, 0); t.setDate(t.getDate() - 1 - i);
    return dietDayKey(t.getTime());
  });
  const first = new Date(`${days[days.length - 1]}T00:00:00`).getTime();
  if (!Number.isFinite(ov.since) || ov.since > first) return false;
  return days.every(day => ['off', 'none'].includes(dietShareStatus(ov.days[day] || null)));
}
const DIET_SHARE_WARN_TEXT = 'Diète pas suivie 3 jours';   // le mot des pastilles (« Pas suivi »), décision du 19/11
// Jours suivis sur les 7 derniers (aujourd'hui compté seulement s'il est déjà suivi), pour la ligne de Mes élèves ;
// null sans partage
function dietShareWeekCount(ov, now = Date.now()) {
  if (!ov) return null;
  const today = dietDayKey(now);
  return dietShareWeekDays(0, now).filter(d => dietShareStatus(ov.days[d] || null, { today: d === today }) === 'ok').length;
}

// ── Coach : état et lecture ─────────────────────────────────

// Par élève : { shared, since, days, loading, error, loadedAt, missing, triedAt, weeks: semaines remontées, sel: jour choisi }
const coachDiets = {};
// Mes élèves : { available: null | false (serveur sans la fonction) | true, students, loadedAt, loading, triedAt }
const dietOverview = { available: null, students: {}, loadedAt: 0, loading: false, triedAt: 0 };
let dietShareSeq = 0;
let dietShareUser = null;

function coachDietOf(student) {
  return coachDiets[student] ||= { shared: false, since: null, days: {}, loading: false, error: null, loadedAt: 0, missing: false, triedAt: 0, weeks: 0, sel: null };
}
async function coachLoadDiet(student, now = Date.now()) {
  const f = coachDietOf(student);
  if (f.loading || (f.missing && now - f.triedAt < DIET_SHARE_RETRY_MS)) return { ok: true };
  f.triedAt = now;
  f.loading = true;
  const seq = dietShareSeq;
  const r = await coachRpc('coach_student_diet', { student });
  if (seq !== dietShareSeq) return { ok: false, kind: 'signed_out' };
  f.loading = false;
  if (!r.ok) { f.error = r.kind; f.missing = r.kind === 'missing'; notifyCoach(); return r; }
  Object.assign(f, cleanCoachDiet(r.data), { error: null, loadedAt: Date.now(), missing: false });
  notifyCoach();
  return { ok: true };
}
async function coachDietOverviewRefresh({ minAge = DIET_SHARE_MAX_AGE_MS, now = Date.now() } = {}) {
  if (!account.user || !coachRole().isCoach || dietOverview.loading) return false;
  if (dietOverview.available === false && now - dietOverview.triedAt < DIET_SHARE_RETRY_MS) return false;
  if (minAge && dietOverview.loadedAt && now - dietOverview.loadedAt < minAge) return true;
  dietOverview.loading = true;
  dietOverview.triedAt = now;
  const seq = dietShareSeq;
  const r = await coachRpc('coach_diet_overview');
  if (seq !== dietShareSeq) return false;
  dietOverview.loading = false;
  if (r.ok) Object.assign(dietOverview, { available: true, students: cleanDietOverview(r.data), loadedAt: Date.now() });
  else if (r.kind === 'missing') Object.assign(dietOverview, { available: false, students: {} });
  notifyCoach();
  return r.ok;
}
// Élève à relancer pour sa diète (rien de lu, ou serveur d'avant : jamais)
function coachDietWarn(uid, now = Date.now()) { return dietOverview.available === true && dietShareWarn(dietOverview.students[uid], now); }

function dietShareReset(userId) {
  dietShareSeq++;
  dietShareUser = userId;
  Object.keys(coachDiets).forEach(k => delete coachDiets[k]);
  Object.assign(dietOverview, { available: null, students: {}, loadedAt: 0, loading: false, triedAt: 0 });
  clearTimeout(dietShareTimer);
  dietShareTimer = 0;
}

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id !== dietShareUser) dietShareReset(id);
});
