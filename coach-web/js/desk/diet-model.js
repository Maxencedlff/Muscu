// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : logique pure de l'onglet Nutrition (docs/COACH_WEB.md, vague 4 ; maquette 5-nutrition)
//
//  Ce que l'élève partage déjà (consentement « Suivi de ma diète », coach_student_diet) : un résumé par jour, jamais
//  les aliments remplacés ni les heures. Statut d'un jour et seuils : ceux de l'app (dietShareStatus, dietShareGap,
//  DIET_SHARE_OK_PCT, DIET_SHARE_PART_PCT de js/data/diet-share.js). Plan envoyé : cleanSentDiet (js/data/nutrition.js).
//  Semaine du lundi au dimanche, comme la fiche Semaines ; 12 semaines au plus (le serveur garde 90 jours).
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_NT_WEEKS = DIET_SHARE_WEEKS;   // semaines qu'on peut remonter
const DESK_NT_DOW = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.'];
const DESK_NT_KIND = { t: 'jour d\'entraînement', r: 'jour de repos' };
const deskCap = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');

// Les 7 jours de la semaine `back` (0 : celle-ci), du lundi au dimanche : [{ day, ts, dow, num, x, status }]
// status : celui de l'app (ok, part, off, none, today), 'future' pour un jour pas encore arrivé
function deskNtWeek(diet, back = 0, now = Date.now()) {
  const start = deskDayStart(deskWeekStart(now), -7 * back), today = localISO(now);
  return Array.from({ length: 7 }, (_, i) => {
    const ts = deskDayStart(start, i) + 12 * 3600e3, day = localISO(ts);
    const x = diet?.days?.[day] || null;
    const status = day > today ? 'future' : dietShareStatus(x, { today: day === today });
    return { day, ts, dow: DESK_NT_DOW[i], num: new Date(ts).getDate(), x, status };
  });
}
// « 5 jours suivis, 1 partiel, 1 pas suivi » (jours notés de la semaine) ; '' sans rien
function deskNtWeekText(days) {
  const n = s => days.filter(d => d.status === s).length;
  const parts = [[n('ok'), 'jour suivi', 'jours suivis'], [n('part'), 'partiel', 'partiels'], [n('off'), 'pas suivi', 'pas suivis']].filter(([c]) => c > 0)
    .map(([c, one, many]) => plural(c, one, many));
  return parts.length ? parts.join(', ') : 'Rien de noté cette semaine';
}
// Jour du plan suivi ce jour-là : jour d'entraînement ou de repos (plan sur 2 jours), jour de la semaine (plan sur 7 jours)
function deskNtPlanDay(plan, x, ts) {
  if (!plan) return null;
  if (plan.days?.mode === 'week') return dietDayObj(plan, (new Date(ts).getDay() + 6) % 7);
  if (plan.days?.mode === 'session') return dietDayObj(plan, x?.kind === 'r' ? 1 : 0);
  return plan;
}
// Repas du jour : ceux que l'élève a notés (cochés ou non), avec les aliments du plan envoyé quand le nom correspond
// → [{ name, ok, items: 'Flocons d'avoine 60 g · skyr 150 g', kcal }]
function deskNtMeals(x, planDay) {
  if (!x) return [];
  const byName = new Map((planDay?.meals || []).map(m => [normName(m.name), m]));
  return x.meals.map(m => {
    const pm = byName.get(normName(m.n));
    return { name: m.n, ok: m.ok, items: pm ? pm.items.map(it => `${it.name} ${dietQtyText(it)}`).join(' · ') : '',
      kcal: pm ? Math.round(dietMealMacros(pm).kcal) : null };
  });
}
// Chiffres d'un jour face à son objectif : [{ key, label, v, goal, unit, pct }] (pct : part de l'objectif, en %)
function deskNtMacros(x) {
  if (!x) return [];
  const g = x.goal || {};
  return [['kcal', 'Calories', 'kcal'], ['p', 'Protéines', 'g'], ['c', 'Glucides', 'g'], ['f', 'Lipides', 'g']].map(([key, label, unit]) => {
    const goal = Number(g[key]) > 0 ? Number(g[key]) : null;
    return { key, label, unit, v: Math.round(Number(x[key]) || 0), goal, pct: goal ? Math.round((Number(x[key]) || 0) / goal * 100) : null };
  });
}
// Moyennes de la semaine sur les jours notés : { n, kcal, goalKcal, gap, p, goalP, water (L), waterGoal (L), salt, saltMax } | null
function deskNtAverages(days) {
  const xs = days.map(d => d.x).filter(Boolean);
  if (!xs.length) return null;
  const avg = (f, list = xs) => { const v = list.map(f).filter(n => Number.isFinite(n)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const withGoal = xs.filter(x => Number(x.goal?.kcal) > 0);
  const kcal = avg(x => x.kcal), goalKcal = avg(x => Number(x.goal.kcal), withGoal);
  const wl = xs.filter(x => x.water > 0);
  const salted = xs.filter(x => x.salt !== null && x.salt !== undefined);
  return { n: xs.length, kcal: Math.round(kcal), goalKcal: goalKcal ? Math.round(goalKcal) : null,
    gap: goalKcal ? Math.round((avg(x => x.kcal, withGoal) - goalKcal) / goalKcal * 100) : null,
    p: Math.round(avg(x => x.p)), goalP: avg(x => Number(x.goal?.p) || NaN) ? Math.round(avg(x => Number(x.goal?.p) || NaN)) : null,
    water: wl.length ? Math.round(avg(x => x.water, wl) / 100) / 10 : null,
    waterGoal: avg(x => (x.waterGoal ? x.waterGoal : NaN)) ? Math.round(avg(x => (x.waterGoal ? x.waterGoal : NaN)) / 100) / 10 : null,
    salt: salted.length ? Math.round(avg(x => x.salt, salted) * 10) / 10 : null, saltMax: avg(x => (x.saltMax ? x.saltMax : NaN)) || null };
}
// Objectifs du plan en une ligne : « Entraînement 1 850 kcal · repos 1 650 kcal · eau 2,5 L »
function deskNtPlanLine(plan) {
  if (!plan) return '';
  const kcal = p => p?.targets?.kcal || Math.round(dietPlanMacros(p).kcal) || null;
  const parts = [];
  if (plan.days?.mode === 'session') {
    const t = kcal(plan), r = kcal(dietDayObj(plan, 1));
    if (t) parts.push(`Entraînement ${fmtNum(t)} kcal`);
    if (r) parts.push(`repos ${fmtNum(r)} kcal`);
  } else if (kcal(plan)) parts.push(`${fmtNum(kcal(plan))} kcal${plan.days?.mode === 'week' ? ' le lundi' : ' par jour'}`);
  if (plan.targets?.water) parts.push(`eau ${fmtNum(plan.targets.water, 2)} L`);
  return parts.join(' · ');
}
