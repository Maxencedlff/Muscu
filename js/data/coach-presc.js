// ═══════════════════════════════════════════════════════════
//  Charge prescrite par le coach (demande de Maxence du 16/11/2026 : « le coach peut prescrire les
//  charges si besoin et les reps »). Logique pure, chargée avant store.js (sanitizeData et
//  cleanHistoryEntry s'en servent au chargement). Écran du coach : js/features/coach-presc-ui.js ;
//  séance de l'élève : js/features/session.js ; contrat : docs/COACH_V1.md, « Charge prescrite ».
//
//  Exercice d'un programme (envoyé, puis importé chez l'élève), deux champs facultatifs :
//    load  : kg, de 0 à 500, pour toutes les séries de travail ;
//    loads : [kg | null], série de travail par série de travail (top set, back-off) ; null = load.
//  Les reps restent celles du programme : fourchette (repMin, repMax) ou reps fixes (repFixed).
//  Une app d'avant ce fichier écarte les deux champs (cleanSentProgramme ne garde que ce qu'il connaît) :
//  le programme marche comme avant, sans charge prescrite.
//
//  Séance de l'élève : chaque série de travail prescrite garde pk (kg prescrits, texte) ; l'entrée
//  d'historique porte presc = { kg: [kg | null, aligné sur ses séries], lo, hi } pour que le coach
//  voie l'écart entre prescrit et fait (serveur : supabase/migrations/20261116010000_charge_prescrite.sql).
// ═══════════════════════════════════════════════════════════
'use strict';

const PRESC_KG_MAX = 500;
const COACH_PRESC_KEY = 'mdlf_coach_presc';   // coach : { userId, map: { [élève]: { [prog]: prescription } } }

// kg prescrits lisibles (nombre de 0 à 500, au gramme), sinon null
function cleanPrescKg(v) {
  if (v === '' || v == null) return null;
  const n = num(v, 0, PRESC_KG_MAX);
  return n === null ? null : Math.round(n * 1000) / 1000;
}

// Champs load et loads nettoyés pour un exercice de sets séries : {} sans charge prescrite
function prescLoadFields(e, sets) {
  const out = {};
  if (!e || typeof e !== 'object') return out;
  const l = cleanPrescKg(e.load);
  if (l !== null) out.load = l;
  if (Array.isArray(e.loads)) {
    const a = e.loads.slice(0, Math.max(0, sets | 0)).map(cleanPrescKg);
    while (a.length && a.at(-1) === null) a.pop();
    if (a.some(x => x !== null)) out.loads = a;
  }
  return out;
}
// Programme local (sanitizeData) : les deux champs remis en forme, retirés s'ils ne disent rien
function cleanPrescInPlace(ex) {
  if (ex.load === undefined && ex.loads === undefined) return;
  const f = prescLoadFields(ex, ex.sets);
  delete ex.load; delete ex.loads;
  Object.assign(ex, f);
}

function hasPrescLoad(ex) {
  return !!ex && (cleanPrescKg(ex.load) !== null || (Array.isArray(ex.loads) && ex.loads.some(x => cleanPrescKg(x) !== null)));
}
// Étiquette d'une série d'après la technique prescrite (« Top set », « Back-off », « Cluster » sur la série choisie),
// '' sinon (intensPlanTechs, js/data/intensif.js) : écran de prescription de l'app et éditeur de l'appli web du coach
function prescSetTag(e, i) {
  const t = intensPlanTechs(e?.intens, e?.intensOn, e?.sets || 3)[i];
  return t ? TECHS[t].label : '';
}
// kg prescrits pour la i-ème série de travail (0 : la première), null sans charge prescrite
function prescKgAt(ex, i) {
  const own = Array.isArray(ex?.loads) ? cleanPrescKg(ex.loads[i]) : null;
  return own ?? cleanPrescKg(ex?.load);
}
// Reps prescrites { lo, hi } : reps fixes (lo = hi), sinon la fourchette (bas vide : 4 sous le haut, repSpanOf)
function prescReps(ex) {
  if (!ex || measureOf(ex) !== 'reps') return null;
  const f = fixedReps(ex);
  if (f) return { lo: f, hi: f };
  const span = repSpanOf(ex);
  if (span) return { lo: span[0], hi: span[1] };
  const hi = parseInt(ex.repMax) || 12;
  return { lo: hi, hi };
}
const prescRepsTxt = r => (!r ? '' : r.lo === r.hi ? String(r.lo) : `${r.lo}–${r.hi}`);
const prescRepsSpoken = r => (!r ? '' : r.lo === r.hi ? plural(r.lo, 'rep', 'reps') : `${r.lo} à ${r.hi} reps`);

// Charges distinctes dans l'ordre des séries (« 100 puis 90 ») : [kg]
function prescKgList(ex, n = ex?.sets) {
  const out = [];
  for (let i = 0; i < n; i++) { const kg = prescKgAt(ex, i); if (kg !== null && out.at(-1) !== kg) out.push(kg); }
  return out;
}
// « 60 kg × 8 », « 100 kg puis 90 kg × 3–5 » (unité de la personne) ; '' sans charge prescrite
function prescText(ex) {
  const kgs = prescKgList(ex);
  if (!kgs.length) return '';
  const r = prescReps(ex);
  return `${kgs.map(kg => `${fmtW(kg)} ${unitLbl()}`).join(' puis ')}${r ? ` × ${prescRepsTxt(r)}` : ''}`;
}
// Même chose pour VoiceOver : « 60 kilos, 8 reps »
function prescSpoken(ex) {
  const kgs = prescKgList(ex);
  if (!kgs.length) return '';
  const u = unitLbl() === 'kg' ? 'kilos' : 'livres';
  const r = prescReps(ex);
  return `${kgs.map(kg => `${fmtW(kg)} ${u}`).join(' puis ')}${r ? `, ${prescRepsSpoken(r)}` : ''}`;
}

// ── Séance de l'élève ────────────────────────────────────────
// Séries de travail à faire posées sur la prescription de d (exercice du programme) : charge prescrite,
// reps prescrites. Reps fixes : ce nombre. Fourchette : la charge est celle de la dernière fois → les reps
// de la dernière fois (« Avant », sans rep ajoutée) ramenées dans la fourchette ; une autre charge → le bas de
// la fourchette (même règle qu'après une hausse de charge, goalRepsAfterBump). « Avant » ne bouge pas.
// Renvoie true si une charge est prescrite.
function prescPrefill(ex, d) {
  if (!ex || !hasPrescLoad(d) || measureOf(d) !== 'reps') return false;
  const r = prescReps(d);
  let i = 0;
  ex.sets.forEach(s => {
    if (isWarmupSet(s)) return;
    const kg = prescKgAt(d, i++);
    if (kg === null || s.done) return;
    // Même charge que la dernière fois (« Avant ») : on continue ses reps ; sinon on repart du bas
    const same = !!s.prev && Math.round((parseFloat(s.prev.weight) || 0) * 100) === Math.round(kg * 100);
    const n = parseInt(s.reps);
    s.weight = String(kg);
    s.plannedWeight = s.weight;
    s.pk = s.weight;
    if (r) s.reps = String(same && n > 0 ? Math.min(r.hi, Math.max(r.lo, n)) : r.lo);
  });
  if (r) ex.presc = { lo: r.lo, hi: r.hi };
  return true;
}
// Programme d'un coach : les reps pré-remplies restent dans sa fourchette (plafonnées au haut, relevées au
// bas), comme l'objectif affiché (exerciseGoal ne dépasse pas le haut). Panel du 16/11 : « 3–5 reps » et
// « Objectif 72,5 kg × 5 » au-dessus de cases à 8, 8, 8, 7 (la dernière fois, avant la fourchette).
function clampRepsToPlan(ex, d) {
  const r = d && measureOf(d) === 'reps' ? prescReps(d) : null;
  if (!r) return;
  ex.sets.forEach(s => {
    if (s.done || isWarmupSet(s)) return;
    const n = parseInt(s.reps);
    if (n > 0) s.reps = String(Math.min(r.hi, Math.max(r.lo, n)));
    // Second côté d'une série notée par bras (js/data/unilateral.js) : ses reps prises de sa dernière fois, bornées aussi
    const p = s.side2 && !s.side2.done ? parseInt(s.side2.prev?.reps) : 0;
    if (p > 0 && !String(s.side2.reps ?? '').trim()) s.side2.reps = String(Math.min(r.hi, Math.max(r.lo, p)));
  });
}

// presc de l'entrée d'historique : kg prescrits de chaque série enregistrée (null : échauffement ou série
// ajoutée), bornes de reps. null si rien n'était prescrit
function historyPresc(ex, savedSets) {
  if (!ex?.presc || !savedSets.some(s => cleanPrescKg(s.pk) !== null)) return null;
  return { kg: savedSets.map(s => (isWarmupSet(s) ? null : cleanPrescKg(s.pk))), lo: ex.presc.lo, hi: ex.presc.hi };
}
// Nettoyage (historique, séance reçue par le coach) : kg alignés sur sets, reps de 1 à 100 ; null sinon
function cleanHistoryPresc(p, setsLen) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.kg) || p.kg.length !== setsLen) return null;
  const kg = p.kg.map(cleanPrescKg);
  if (!kg.some(x => x !== null)) return null;
  const lo = num(p.lo, 1, 100, true), hi = num(p.hi, 1, 100, true);
  return { kg, ...(lo !== null && hi !== null && lo <= hi ? { lo, hi } : {}) };
}

// ── Côté coach : l'écart prescrit / fait ─────────────────────
// Séance d'un élève (exercice e avec sets et presc) : « Prescrit 60 kg × 8 · fait comme prévu » ou
// « Prescrit 60 kg × 8 · série 1 à 62,5 kg, série 3 : 7 reps ». '' sans prescription
function prescGapText(e) {
  const p = e?.presc;
  if (!p) return '';
  const work = [];
  (e.sets || []).forEach((s, j) => { if (!isWarmupSet(s)) work.push({ s, kg: p.kg[j] ?? null }); });
  const shown = work.filter(w => w.kg !== null);
  if (!shown.length) return '';
  const kgs = []; shown.forEach(w => { if (kgs.at(-1) !== w.kg) kgs.push(w.kg); });
  const r = p.lo ? { lo: p.lo, hi: p.hi } : null;
  const head = `Prescrit ${kgs.map(kg => `${fmtW(kg)} ${unitLbl()}`).join(' puis ')}${r ? ` × ${prescRepsTxt(r)}` : ''}`;
  const gaps = [];
  work.forEach((w, i) => {
    if (w.kg === null) return;
    const bits = [];
    const done = parseFloat(w.s.weight) || 0;
    if (Math.round(done * 100) !== Math.round(w.kg * 100)) bits.push(`à ${fmtW(done)} ${unitLbl()}`);
    const n = parseInt(w.s.reps) || 0;
    if (r && (n < r.lo || n > r.hi)) bits.push(plural(n, 'rep', 'reps'));
    if (bits.length) gaps.push(`série ${i + 1} ${bits.join(', ')}`);
  });
  return `${head} · ${gaps.length ? gaps.join(' ; ') : 'fait comme prévu'}`;
}

// Prescription saisie par le coach pour un élève et un exercice : { load, loads, reps? } où reps =
// { fixed, min, max } remplace les reps du programme. Nettoyée, null si vide
function cleanCoachPresc(p, sets) {
  if (!p || typeof p !== 'object') return null;
  const f = prescLoadFields(p, sets);
  const out = { ...f };
  const rp = p.reps;
  if (rp && typeof rp === 'object') {
    const max = num(rp.max, 1, 100, true), min = num(rp.min, 1, 99, true);
    if (max !== null) out.reps = rp.fixed === true ? { fixed: true, max } : { fixed: false, max, ...(min !== null && min < max ? { min } : {}) };
  }
  return Object.keys(out).length ? out : null;
}
// Champs d'envoi d'un exercice o (programmeToSent) avec la prescription p du coach : charge, puis reps
function applyCoachPresc(o, p) {
  const c = cleanCoachPresc(p, o.sets);
  if (!c) return o;
  if (c.load !== undefined) o.load = c.load;
  if (c.loads) o.loads = c.loads;
  if (c.reps) {
    delete o.repMin; delete o.repFixed;
    o.repMax = c.reps.max;
    if (c.reps.fixed) o.repFixed = true;
    else if (c.reps.min) o.repMin = c.reps.min;
  }
  return o;
}

// Mémoire des prescriptions du coach, par élève et programme (sur l'appareil) : reprises au prochain envoi
function coachPrescStore() {
  try {
    const s = JSON.parse(localStorage.getItem(COACH_PRESC_KEY));
    return s && s.userId === account.user?.id && s.map && typeof s.map === 'object' ? s.map : {};
  } catch { return {}; }
}
function coachPrescFor(student, progId) {
  const m = coachPrescStore()[student]?.[progId];
  return m && typeof m === 'object' ? m : {};
}
function coachPrescRemember(student, progId, presc) {
  const map = coachPrescStore();
  (map[student] ||= {})[progId] = presc || {};
  try { localStorage.setItem(COACH_PRESC_KEY, JSON.stringify({ userId: account.user?.id, map })); } catch { /* mémoire facultative */ }
}

// Dernière fois de l'élève sur cet exercice, d'après ses séances reçues par le coach (plus récente d'abord) :
// { kg: [kg des séries de travail], reps: [reps], doneAt } ou null
function studentLastLoads(rows, name) {
  const n = normName(name);
  for (const r of [...(rows || [])].sort((a, b) => b.doneAt - a.doneAt)) {
    // Le même exercice deux fois (blocs, js/data/blocks.js) : le bloc de pré-fatigue n'a que des séries marquées, c'est
    // le bloc de travail qui compte
    const work = (r.s?.exercises || []).filter(x => normName(x.name) === n)
      .map(x => workSets(x.sets).filter(s => (parseFloat(s.weight) || 0) > 0)).find(w => w.length) || [];
    if (work.length) return { kg: work.map(s => parseFloat(s.weight)), reps: work.map(s => parseInt(s.reps) || 0), doneAt: r.doneAt };
  }
  return null;
}
