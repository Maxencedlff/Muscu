// ═══════════════════════════════════════════════════════════
//  Entraînement intelligent : niveau de force par exercice principal et périodisation
//  (semaine plus légère, progrès qui stagnent). Logique pure, tout reste sur l'appareil.
//  Écrans : js/features/training-insights-ui.js. Sources, seuils et règles : docs/ENTRAINEMENT.md
//  Chargé avant store.js (cleanDeload sert au nettoyage du chargement) : rien n'est appelé au niveau supérieur.
// ═══════════════════════════════════════════════════════════
'use strict';

const TI_DAY = 86_400_000;

// ── Niveau de force ─────────────────────────────────────────
// Seuils en 1RM ÷ poids du corps, dans l'ordre [débutant, novice, intermédiaire, avancé, élite], relevés le
// 31/10/2026 sur strengthlevel.com (« Bodyweight Ratio Standards » de chaque exercice : percentiles 5, 20, 50,
// 80 et 95 de plus de 10 millions de performances saisies par leurs utilisateurs). Chiffres recopiés tels
// quels, jamais retouchés : une mise à jour se fait ici, source à l'appui (docs/ENTRAINEMENT.md).
const STRENGTH_LEVELS = ['Débutant', 'Novice', 'Intermédiaire', 'Avancé', 'Élite'];
const STRENGTH_LIFTS = [
  { id: 'squat',    name: 'Squat barre',               male: [0.75, 1.25, 1.75, 2.25, 2.75], female: [0.50, 0.75, 1.25, 1.75, 2.25] },
  { id: 'bench',    name: 'Développé couché barre',    male: [0.50, 1.00, 1.25, 1.50, 2.00], female: [0.30, 0.50, 0.75, 1.10, 1.45] },
  { id: 'deadlift', name: 'Soulevé de terre',          male: [1.00, 1.50, 2.00, 2.50, 3.25], female: [0.75, 1.00, 1.50, 2.00, 2.50] },
  { id: 'ohp',      name: 'Développé militaire barre', male: [0.35, 0.55, 0.80, 1.05, 1.35], female: [0.20, 0.35, 0.50, 0.70, 0.95] },
  { id: 'row',      name: 'Rowing barre',              male: [0.50, 0.75, 1.00, 1.50, 1.75], female: [0.30, 0.45, 0.70, 0.95, 1.25] },
];
// 1RM estimé : meilleure série de ces 90 derniers jours (le niveau dit la force d'aujourd'hui, pas d'il y a un an)
const STRENGTH_WINDOW_DAYS = 90;

// Exercice principal d'un nom (bibliothèque, alias compris : « Développé couché », « bench press ») ou null.
// Les variantes (haltères, machine, prise serrée, sumo) n'ont pas de repères : elles ne comptent pas.
function strengthLiftOf(name) {
  const e = typeof catalogueEntry === 'function' ? catalogueEntry(name) : null;
  return e ? STRENGTH_LIFTS.find(l => l.name === e.name) || null : null;
}

// Repères hommes ou femmes : la silhouette choisie (Réglages › Apparence, premier lancement) ; absente = hommes
function strengthSex(d = data) { return d?.silhouette === 'female' ? 'female' : 'male'; }

// Meilleur 1RM estimé d'un exercice principal : { e1rm, date } ou null. Séries de travail en répétitions
// (1 à 12 : calc1RM, Epley), charge > 0. opts.now : fin de la fenêtre ; opts.before : séances strictement
// antérieures à cette date seulement (bilan : le niveau d'avant la séance).
function liftBestE1rm(history, lift, { now = Date.now(), before = Infinity } = {}) {
  const from = now - STRENGTH_WINDOW_DAYS * TI_DAY;
  let best = null;
  for (const h of history || []) {
    if (!h || !(h.date >= from) || h.date > now || h.date >= before) continue;
    for (const ex of h.exercises || []) {
      if (strengthLiftOf(ex.name)?.id !== lift.id || measureOf(ex) !== 'reps') continue;
      for (const s of workSets(ex.sets)) {
        const e1 = calc1RM(s.weight, s.reps);
        if (e1 && (!best || e1 > best.e1rm)) best = { e1rm: e1, date: h.date };
      }
    }
  }
  return best;
}

// Niveau d'un 1RM estimé : { lift, index, label, ratio, next: { label, kg } | null, progress 0..1 } ou null
// (poids du corps inconnu ou hors bornes). Sous le seuil « novice », c'est « Débutant » (y compris sous le
// seuil débutant) ; au-delà du seuil élite, « Élite » sans palier suivant.
function strengthStanding(lift, e1rm, bodyKg, sex = 'male') {
  if (!lift || !(e1rm > 0) || !(bodyKg >= 25 && bodyKg <= 300)) return null;
  const thr = lift[sex === 'female' ? 'female' : 'male'];
  const ratio = e1rm / bodyKg;
  let index = 0;
  for (let i = 1; i < thr.length; i++) if (ratio >= thr[i]) index = i;
  const top = index === thr.length - 1;
  const low = index === 0 ? 0 : thr[index];
  const next = top ? null : { label: STRENGTH_LEVELS[index + 1], kg: Math.round(thr[index + 1] * bodyKg * 10) / 10 };
  const progress = top ? 1 : Math.max(0, Math.min(1, (ratio - low) / (thr[index + 1] - low)));
  return { lift: lift.id, index, label: STRENGTH_LEVELS[index], ratio: Math.round(ratio * 100) / 100, next, progress };
}

// Niveaux de tous les exercices principaux faits ces 90 derniers jours : [{ lift, name, e1rm, date, standing }]
function strengthStandings(history, bodyKg, sex, now = Date.now()) {
  return STRENGTH_LIFTS.map(lift => {
    const best = liftBestE1rm(history, lift, { now });
    const standing = best && strengthStanding(lift, best.e1rm, bodyKg, sex);
    return standing ? { lift: lift.id, name: lift.name, e1rm: best.e1rm, date: best.date, standing } : null;
  }).filter(Boolean);
}

// Bilan d'une séance : niveau de chaque exercice principal fait, et palier franchi par rapport à avant
// la séance (même fenêtre de 90 jours). [{ name, standing, up }]
function sessionStrengthLevels(entry, history, bodyKg, sex) {
  if (!entry) return [];
  const done = new Set((entry.exercises || []).map(ex => strengthLiftOf(ex.name)).filter(Boolean));
  return STRENGTH_LIFTS.filter(l => done.has(l)).map(lift => {
    const after = liftBestE1rm(history, lift, { now: entry.date });
    const standing = after && strengthStanding(lift, after.e1rm, bodyKg, sex);
    if (!standing) return null;
    const prev = liftBestE1rm(history, lift, { now: entry.date, before: entry.date });
    const was = prev && strengthStanding(lift, prev.e1rm, bodyKg, sex);
    return { name: lift.name, standing, up: !!was && standing.index > was.index };
  }).filter(Boolean);
}

// ── Périodisation : semaine plus légère et stagnation ───────
// Règles (docs/ENTRAINEMENT.md) : une semaine plus légère est conseillée après au moins DELOAD_STREAK_MIN
// semaines chargées d'affilée quand les progrès stagnent sur la moitié des exercices suivis (deux au moins),
// ou quand l'effort noté (RIR) monte sans progrès ; sans aucun signe, après DELOAD_STREAK_MAX semaines.
// Consensus Delphi de Bell et al. 2023 (Sports Med Open 9:87) : décharge « en général toutes les 4 à 6
// semaines, pendant environ 7 jours », prévue ou déclenchée par la fatigue, en baissant le nombre de séries
// ou de répétitions, la charge pouvant rester la même.
const DELOAD_DAYS        = 7;
const DELOAD_STREAK_MIN  = 4;     // semaines chargées d'affilée avant de parler de décharge
const DELOAD_STREAK_MAX  = 8;     // borne haute des décharges prévues (4 à 8 semaines, Bell et al. 2023)
const TRAIN_WEEKS        = 12;    // semaines complètes regardées pour la série de semaines chargées
const LIGHT_WEEK_RATIO   = 0.6;   // semaine plus légère : moins de 60 % des séries d'une semaine habituelle (médiane)…
const LIGHT_LOAD_RATIO   = 0.92;  // … ou charges baissées : 1RM est. de la semaine sous 92 % de celui des 4 semaines d'avant
const TREND_DAYS         = 56;    // 8 semaines : fenêtre des courbes de 1RM estimé
const TREND_MIN_SESSIONS = 4;     // séances de l'exercice dans la fenêtre pour en juger
const STALL_SESSIONS     = 3;     // séances d'affilée sans nouveau meilleur 1RM estimé
const STALL_DAYS         = 14;    // … sur au moins deux semaines
const DROP_RATIO         = 0.97;  // recul : moyenne des 2 dernières séances sous 97 % du meilleur
const EFFORT_RISE        = 0.5;   // effort qui monte : RPE moyen des 2 dernières semaines + 0,5 sur les 4 d'avant
const EFFORT_MIN_SETS    = 6;     // séries notées de chaque côté pour comparer
const SNOOZE_DAYS        = 7;     // « Pas maintenant »
const RESUME_DAYS        = 7;     // carte « Reprends tes charges » après la décharge

const tiMedian = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Ce que la périodisation lit d'une séance, calculé en un passage : séries de travail (échauffement et cardio
// exclus), meilleur 1RM estimé de chaque exercice à charge (lifts : [{ key, name, e1 }]) et effort noté (rpe).
// memo (Map séance → lecture) : chaque séance n'est lue qu'une fois par conseil, même vue par plusieurs fenêtres
// (12 semaines et les 4 d'avant chacune, courbes, effort). Mesure et genre de charge passent par la
// bibliothèque (catalogueEntry) : sans memo, l'accueil la relisait plus de 9 000 fois pour 150 séances.
// Jamais gardé d'un appel à l'autre : une séance passée corrigée sur place doit compter tout de suite.
function entryFacts(h, memo) {
  const known = memo?.get(h);
  if (known) return known;
  const f = { sets: 0, lifts: [], rpe: [] };
  for (const ex of h.exercises || []) {
    const measure = measureOf(ex), ws = workSets(ex.sets);
    if (measure !== 'cardio') f.sets += ws.length;
    if (measure !== 'reps') continue;
    for (const s of ws) { const r = cleanRir(s.rir); if (r !== null) f.rpe.push(10 - r); }
    if (loadKind(ex) !== 'charge') continue;
    f.lifts.push({ key: exKey(ex), name: ex.name, e1: Math.max(0, ...ws.map(s => calc1RM(s.weight, s.reps) || 0)) });
  }
  memo?.set(h, f);
  return f;
}

// Séries de travail d'une séance (échauffement exclu), cardio exclu : la charge d'entraînement en séries
function entryWorkSets(h, memo) { return entryFacts(h, memo).sets; }

// Décharge enregistrée : { start, end, seen? } valide ou null
function cleanDeload(v) {
  if (!v || typeof v !== 'object' || !Number.isFinite(v.start) || !Number.isFinite(v.end)) return null;
  if (v.start <= 0 || v.end <= v.start || v.end - v.start > 2 * DELOAD_DAYS * TI_DAY) return null;
  return { start: v.start, end: v.end, ...(v.seen === true ? { seen: true } : {}) };
}

// Meilleur 1RM estimé de chaque exercice à charge (clé exKey) des séances de [from, to) : Map clé → kg
function bestE1ByKey(history, from, to, memo = new Map()) {
  const m = new Map();
  for (const h of history || []) {
    if (!h || h.date < from || h.date >= to) continue;
    for (const { key, e1 } of entryFacts(h, memo).lifts) if (e1 > (m.get(key) || 0)) m.set(key, e1);
  }
  return m;
}

// Charges d'une semaine face aux 4 semaines d'avant : médiane, exercice par exercice, du rapport des
// meilleurs 1RM estimés ; null avec moins de deux exercices comparables
function weekIntensity(history, start, end, memo = new Map()) {
  const week = bestE1ByKey(history, start, end, memo), before = bestE1ByKey(history, start - 28 * TI_DAY, start, memo);
  const ratios = [...week].filter(([k]) => before.has(k)).map(([k, v]) => v / before.get(k));
  return ratios.length >= 2 ? Math.round(tiMedian(ratios) * 1000) / 1000 : null;
}

// Semaines complètes (lundi → lundi) avant la semaine en cours, de la plus ancienne à la plus récente :
// [{ start, sessions, sets, intensity, deload }] ; deload : la semaine recoupe une décharge enregistrée
function trainingWeeks(history, now = Date.now(), n = TRAIN_WEEKS, deload = null, memo = new Map()) {
  const cur = weekStart(now);
  // Seules les séances de la fenêtre regardée (n semaines et les 4 d'avant) sont relues, semaine par semaine
  const seen = (history || []).filter(h => h && h.date >= addDays(cur, -7 * n) - 28 * TI_DAY && h.date < cur);
  const weeks = [];
  for (let i = n; i >= 1; i--) {
    const start = addDays(cur, -7 * i), end = addDays(cur, -7 * (i - 1));
    const hs = seen.filter(h => h.date >= start && h.date < end);
    weeks.push({ start, sessions: hs.length, sets: hs.reduce((a, h) => a + entryWorkSets(h, memo), 0),
      intensity: hs.length ? weekIntensity(seen, start, end, memo) : null,
      deload: !!deload && deload.start < end && deload.end > start });
  }
  return weeks;
}

// Semaines chargées d'affilée jusqu'à la dernière semaine complète. Coupe la série : une semaine sans séance,
// une semaine plus légère (séries sous LIGHT_WEEK_RATIO de la médiane des semaines entraînées, ou charges sous
// LIGHT_LOAD_RATIO de celles des 4 semaines d'avant), ou une décharge enregistrée.
function loadedStreak(weeks) {
  const med = tiMedian(weeks.filter(w => w.sessions > 0).map(w => w.sets));
  if (!med) return 0;
  let n = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i];
    if (!w.sessions || w.deload || w.sets < LIGHT_WEEK_RATIO * med) break;
    if (w.intensity != null && w.intensity < LIGHT_LOAD_RATIO) break;
    n++;
  }
  return n;
}

// Courbe du 1RM estimé de chaque exercice à charge (ni lest, ni aide, ni durée) sur TREND_DAYS :
// [{ key, name, status: 'up' | 'flat' | 'down', sessions, sinceBest, best, bestDate, last, lastDate }].
// flat : STALL_SESSIONS séances et STALL_DAYS jours au moins depuis le dernier meilleur ; down : les deux
// dernières séances en moyenne sous DROP_RATIO du meilleur d'avant elles.
function exerciseTrends(history, now = Date.now(), memo = new Map()) {
  const from = now - TREND_DAYS * TI_DAY;
  const byKey = new Map();
  (history || []).filter(h => h && h.date >= from && h.date <= now).sort((a, b) => a.date - b.date).forEach(h => {
    for (const { key, name, e1 } of entryFacts(h, memo).lifts) {
      if (!e1) continue;
      if (!byKey.has(key)) byKey.set(key, { key, name, pts: [] });
      const it = byKey.get(key);
      it.name = name;
      it.pts.push({ date: h.date, e1 });
    }
  });
  const out = [];
  for (const it of byKey.values()) {
    const p = it.pts;
    if (p.length < TREND_MIN_SESSIONS) continue;
    let bi = 0;
    for (let i = 1; i < p.length; i++) if (p[i].e1 > p[bi].e1) bi = i;
    const last = p[p.length - 1], sinceBest = p.length - 1 - bi;
    const before = p.slice(0, -2), bestBefore = Math.max(0, ...before.map(x => x.e1));
    const recent = (p[p.length - 1].e1 + p[p.length - 2].e1) / 2;
    let status = 'up';
    if (sinceBest >= 2 && bestBefore && recent < DROP_RATIO * bestBefore) status = 'down';
    else if (sinceBest >= STALL_SESSIONS && last.date - p[bi].date >= STALL_DAYS * TI_DAY) status = 'flat';
    out.push({ key: it.key, name: it.name, status, sessions: p.length, sinceBest,
      best: p[bi].e1, bestDate: p[bi].date, last: last.e1, lastDate: last.date });
  }
  return out;
}

// Effort noté : RPE moyen (RIR de js/data/rir.js) des 14 derniers jours contre les 28 d'avant.
// { recent, prior, rising } ou null quand il y a trop peu de séries notées.
function effortTrend(history, now = Date.now(), memo = new Map()) {
  const cut = now - 14 * TI_DAY, from = now - 42 * TI_DAY;
  const recent = [], prior = [];
  for (const h of history || []) {
    if (!h || h.date < from || h.date > now) continue;
    (h.date >= cut ? recent : prior).push(...entryFacts(h, memo).rpe);
  }
  if (recent.length < EFFORT_MIN_SETS || prior.length < EFFORT_MIN_SETS) return null;
  const avg = a => Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10;
  const r = avg(recent), p = avg(prior);
  return { recent: r, prior: p, rising: r - p >= EFFORT_RISE };
}

// Séries de travail habituelles par séance : médiane des 28 jours avant `until`
function usualSetsPerSession(history, until, memo = new Map()) {
  const from = until - 28 * TI_DAY;
  return Math.round(tiMedian((history || []).filter(h => h && h.date >= from && h.date < until).map(h => entryWorkSets(h, memo))));
}

// Charges d'avant la décharge : meilleure série des exercices à charge de la dernière séance de chacun avant
// `start` (4 semaines au plus), les plus lourds d'abord : [{ name, weight, reps }] (3 au plus)
function preDeloadSets(history, start, max = 3) {
  const from = start - 28 * TI_DAY, seen = new Set(), out = [];
  (history || []).filter(h => h && h.date >= from && h.date < start).sort((a, b) => b.date - a.date).forEach(h => {
    (h.exercises || []).forEach(ex => {
      const key = exKey(ex);
      if (seen.has(key) || measureOf(ex) !== 'reps' || loadKind(ex) !== 'charge') return;
      const b = bestSet(ex.sets);
      if (!b || !(b.w > 0)) return;
      seen.add(key);
      out.push({ name: ex.name, weight: b.w, reps: b.r, e1: calc1RM(b.w, b.r) || b.w });
    });
  });
  return out.sort((a, b) => b.e1 - a.e1).slice(0, max).map(({ name, weight, reps }) => ({ name, weight, reps }));
}

// Conseil du moment, ou null (réglage coupé, rien à dire) :
//   { kind: 'deload', streak, stalled: [noms], effort, usualSets, targetSets }       semaine plus légère conseillée
//   { kind: 'deload-active', start, end, usualSets, targetSets }                      décharge en cours
//   { kind: 'resume', end, sets: [{ name, weight, reps }] }                           semaine d'après la décharge
function trainingAdvice(d = data, now = Date.now()) {
  if (!d || d.trainingTipsOff === true) return null;
  const hist = (d.history || []).filter(h => h && Number.isFinite(h.date) && h.date <= now);
  const dl = cleanDeload(d.deload);
  if (dl && now >= dl.start && now < dl.end) {
    const usual = usualSetsPerSession(hist, dl.start);
    return { kind: 'deload-active', start: dl.start, end: dl.end, usualSets: usual, targetSets: usual ? Math.max(1, Math.round(usual / 2)) : 0 };
  }
  if (dl && !dl.seen && now >= dl.end && now < dl.end + RESUME_DAYS * TI_DAY) {
    const sets = preDeloadSets(hist, dl.start);
    if (sets.length) return { kind: 'resume', end: dl.end, sets };
  }
  // Une décharge faite (même arrêtée en route) : pas de nouveau conseil avant DELOAD_STREAK_MIN semaines
  if (dl && now < dl.end + DELOAD_STREAK_MIN * 7 * TI_DAY) return null;
  if (Number.isFinite(d.deloadSnooze) && d.deloadSnooze > now) return null;
  const memo = new Map();   // chaque séance lue une fois pour tout le conseil (entryFacts)
  const streak = loadedStreak(trainingWeeks(hist, now, TRAIN_WEEKS, dl, memo));
  if (streak < DELOAD_STREAK_MIN) return null;
  const trends = exerciseTrends(hist, now, memo);
  const stalled = trends.filter(t => t.status !== 'up');
  const effort = effortTrend(hist, now, memo);
  const plateau = stalled.length >= 2 && stalled.length * 2 >= trends.length;
  const tired = !!effort?.rising && stalled.length >= 1;
  if (!plateau && !tired && streak < DELOAD_STREAK_MAX) return null;
  const usual = usualSetsPerSession(hist, now, memo);
  return { kind: 'deload', streak, stalled: stalled.map(t => t.name), effort: tired ? effort : null,
    usualSets: usual, targetSets: usual ? Math.max(1, Math.round(usual / 2)) : 0 };
}

// Stagnation d'un exercice (Progrès › Exercice) : sa courbe si elle stagne ou recule, sinon null
function exerciseStall(history, key, now = Date.now()) {
  const t = exerciseTrends(history, now).find(x => x.key === key);
  return t && t.status !== 'up' ? t : null;
}
