// ═══════════════════════════════════════════════════════════
//  Objectif du jour d'un exercice : une seule règle pour l'accueil (« À battre aujourd'hui »,
//  js/features/dashboard.js) et la puce ↑ de la séance (bumpReady). La séance n'affiche plus de ligne
//  « Objectif … » sous le nom (demande de Maxence du 17/11) : seule la prescription du coach y reste.
// ═══════════════════════════════════════════════════════════
'use strict';

// Fourchette (« 8 à 10 », ou 12 en haut par défaut) : la dernière fois a atteint le haut sur toutes les séries de
// travail, ou l'a dépassé sur la meilleure (Maxence le 17/11 : 24 × 12 en 8 à 10 donnait « Objectif 24 kg × 13 »,
// « il est con cet objectif ») → charge + 2,5 kg (5 lb, le plus petit pas des haltères, machines et barres par
// défaut), au bas de la fourchette (goalRepsAfterBump) ; sinon la meilleure série + 1 rep, jamais au-delà du haut.
// Cran trop gros pour la charge (Maxence le 23/11 : 8 kg × 15 aux élévations latérales donnait « 10,5 kg × 12 »,
// « c'est les reps qui seraient intéressantes ») : + 1 rep à la même charge au-delà du haut, jusqu'à repsBeforeBump.
// Reps fixes : la règle d'avant (+ 1 rep jusqu'au nombre, puis la charge). Jamais fait → nombre de séries prévu.
// text : « 32,5 kg × 11 », « 35 kg × 8 » ; gain : sans signe (« 1 rep », « 2,5 kg »), l'accueil le précède
// d'une flèche ↑ ; before : la meilleure série de la dernière fois, '' si jamais fait ; goal : la série à
// faire { w en kg, r }, null quand il n'y a rien à battre (jamais fait, durée, cardio, aide).
// Jamais fait : « 4 séries », ou « 4 × 12 » en reps fixes (setsRepsText).
// Programme envoyé par un coach (importCoachProgramme, js/data/coach.js) : c'est lui qui décide de la charge. Ni hausse
// de 2,5 kg proposée (objectif, puce de la séance), ni rep au-delà du haut de sa fourchette (panel « yeux neufs » du
// 16/11 : « 3 à 5 reps, 1re série lourde » prescrit, « ↑ 2,5 kg » et « Objectif 75 kg × 3 » affichés)
function coachLedProgramme(progKey) { return !!data.userProgrammes?.[progKey]?.fromCoach; }

// Charge prescrite par le coach (load, loads : js/data/coach-presc.js) : c'est elle l'objectif, « 60 kg × 8 »,
// coach: true (« Coach : 60 kg × 8 » en séance et sur l'accueil) ; goal = la charge la plus lourde au bas des reps.
function exerciseGoal(cat, ex, progKey = data.activeProgramme) {
  const lp = lastPerf(progKey, cat, ex);
  if (measureOf(ex) === 'reps' && hasPrescLoad(ex)) {
    const lb = lp ? bestSet(recordSets(lp.ex.sets).filter(s => (parseInt(s.reps) || 0) > 0)) : null;
    const r = prescReps(ex);
    return { text: prescText(ex), spoken: prescSpoken(ex), gain: '', before: lb ? setTxt(lb, ex) : '', coach: true,
      goal: { w: Math.max(...prescKgList(ex)), r: r ? r.lo : 1 } };
  }
  const planned = { text: setsRepsText(ex), gain: '', before: '', goal: null };
  if (!lp) return planned;
  // L'échauffement ne fixe pas la cible ; série notée par bras : le côté le plus faible décide de la hausse (weakSets,
  // js/data/unilateral.js), comme la puce ↑ de la séance
  const sets = weakSets(lp.ex.sets).filter(s => (parseInt(s.reps) || 0) > 0);
  const best = bestSet(sets);
  if (!best) return planned;
  const before = setTxt(best, ex);
  if (measureOf(ex) !== 'reps' || isAssisted(ex)) return { text: setTxt(best, ex), gain: '', before, goal: null };   // durée, cardio : on rappelle la dernière fois
  // La rep de plus ne dépasse pas le haut (reps fixes : ce nombre ; fourchette : son haut, la charge monte ensuite).
  // Poids du corps et lest : pas de charge à monter, les reps continuent au-delà (sauf reps fixes ou coach)
  // Cran de charge trop gros pour la charge (8 → 10,5 kg, + 31 %) : une fois le haut atteint (goalTopReached), les reps
  // montent au-delà, jusqu'à repsBeforeBump (double progression, docs/PROGRESSION.md) ; jamais sur un programme du coach.
  const coachLed = coachLedProgramme(progKey);
  const fixed = fixedReps(ex);
  const hold = coachLed || loadKind(ex) !== 'charge' || !goalTopReached(ex, sets) ? null : repsBeforeBump(ex, best.w);
  const repMax = fixed || hold || (parseInt(ex.repMax) || 12);
  const capped = fixed || coachLed || (best.w > 0 && loadKind(ex) !== 'lest');
  const more = { w: best.w, r: capped ? Math.min(best.r + 1, repMax) : best.r + 1 };
  if (loadKind(ex) === 'lest') return { text: setTxt({ ...best, r: more.r, reps: String(more.r) }, ex), gain: more.r > best.r ? '1 rep' : '', before, goal: more };
  const bump = goalBumpDue(ex, sets, coachLed);
  if (bump) {
    const w = best.w + loadStepKg(ex), r = goalRepsAfterBump(ex);
    return { text: setTxt({ w, weight: w, r }), gain: loadStepLabel(ex), before, goal: { w, r } };
  }
  return { text: setTxt({ ...best, r: more.r }), gain: more.r > best.r ? '1 rep' : '', before, goal: more };
}

// Hausse de charge due (objectif et puce ↑ de la séance, bumpReady) : séries de travail de la dernière fois
// (reps > 0) toutes au haut (au moins 2, ou le nombre prévu s'il est plus petit), ou, en fourchette, la meilleure
// au-delà du haut. Jamais sur un programme du coach (c'est lui qui décide), ni sans charge.
// Cran trop gros (repsBeforeBump) : la meilleure série doit en plus atteindre ces reps à la même charge.
function goalBumpDue(ex, sets, coachLed = false) {
  if (coachLed || !goalTopReached(ex, sets)) return false;
  const best = bestSet(sets), hold = best ? repsBeforeBump(ex, best.w) : null;
  return !hold || best.r >= hold;
}
// Haut de la fourchette atteint (règle d'avant le 23/11) : toutes les séries au haut, ou la meilleure au-delà
function goalTopReached(ex, sets) {
  if (!sets.length) return false;
  const fixed = fixedReps(ex), hi = fixed || (parseInt(ex.repMax) || 12);
  const reps = sets.map(s => parseInt(s.reps) || 0), w = Math.max(...sets.map(s => parseFloat(s.weight) || 0));
  if (!(w > 0)) return false;
  const all = sets.length >= Math.min(parseInt(ex.sets) || 2, 2) && reps.every(r => r >= hi);
  return all || (!fixed && Math.max(...reps) > hi);
}

// ── Cran de charge et double progression (docs/PROGRESSION.md) ──
// Plus petit pas de charge de l'exercice, en kg : son réglage (loadStep, en kg, facultatif : machine à crans de
// 5 kg, haltères de 2 kg en 2 kg) ; sinon barre à disques : deux fois le plus petit disque de la personne
// (plateSetup, js/data/plates.js : 2 × 1,25 = 2,5 kg par défaut) ; sinon 2,5 kg (5 lb), le pas des racks d'haltères.
function loadStepKg(ex) {
  const own = parseFloat(ex?.loadStep);
  if (own > 0) return own;
  if (ex?.name && isBarbellExercise(ex)) {
    const { unit, plates } = plateSetup(), step = 2 * Math.min(...plates);
    if (step > 0) return unit === 'lb' ? step / KG_TO_LBS : step;
  }
  return bumpStepKg();
}
// « 2,5 kg », « 5 kg », « 5 lb » : sans signe, comme bumpLabel
function loadStepLabel(ex) { return `${fmtW(loadStepKg(ex))} ${data.unit === 'lbs' ? 'lb' : 'kg'}`; }

// Hausse relative au-delà de laquelle le cran est « gros » (8 → 10,5 kg = + 31 %, 100 → 102,5 kg = + 2,5 %)
const BIG_STEP_SHARE = 0.10;
// Reps à faire à la charge w avant de monter d'un cran, quand ce cran est gros (plus de 10 % de la charge) ou
// ferait tomber les reps sous le bas de la fourchette ; null quand la règle de la fourchette suffit (cran petit,
// reps fixes, sans charge). Calcul : la charge + 1 cran faite au bas de la fourchette (goalRepsAfterBump) donne
// un 1RM estimé (Epley, comme e1rm) ; on cherche les reps qui donnent ce 1RM à la charge d'aujourd'hui. Jamais
// moins que le haut + 1 (« nettement au-dessus »), jamais plus que 2 × le haut (30 au plus) : un cran énorme
// (2 → 4,5 kg) finit par passer.
//   8 kg, + 2,5 kg, 8 à 12 → 20 reps ; 18 kg → 14 ; 100 kg → null ; machine 40 kg, crans de 5 kg → 13
function repsBeforeBump(ex, w) {
  if (!(w > 0) || measureOf(ex) !== 'reps' || fixedReps(ex)) return null;
  const step = loadStepKg(ex), lo = goalRepsAfterBump(ex), hi = parseInt(ex.repMax) || 12;
  const need = Math.ceil(30 * ((w + step) * (1 + lo / 30) / w - 1) - 1e-9);
  if (step / w <= BIG_STEP_SHARE && need <= hi) return null;
  return Math.min(Math.max(need, hi + 1), Math.max(hi + 1, Math.min(30, 2 * hi)));
}

// Reps à faire avec la charge augmentée :
//   fourchette complète (« 8 à 12 ») ou bas seul (« 8 à 12 » par défaut) → le bas ;
//   reps fixes (« 4 × 12 », « 5 × 5 » : fixedReps) → ces reps, avec la nouvelle charge (75 kg × 5),
//     pas « 75 kg × 3 » qui contredisait « 5 reps » et les cases (panel du 07/11) ;
//   rien de réglé (12 par défaut) → 4 sous le haut, 8.
function goalRepsAfterBump(ex) {
  const min = parseInt(ex.repMin);
  if (min > 0) return min;
  const fixed = fixedReps(ex);
  if (fixed) return fixed;
  return (parseInt(ex.repMax) || 12) - 4;
}

// Haut de fourchette réglé à autre chose que le 12 par défaut (l'éditeur l'écrit même sans réglage), sinon
// null : ancien format des reps fixes (avant repFixed), lu par fixedReps
function explicitRepMax(ex) {
  const max = parseInt(ex?.repMax);
  return max > 0 && max !== 12 ? max : null;
}

// ── Reps fixes (« 4 × 12 », demande des coachs partenaires, vague 4) ──
// Un exercice en répétitions se prescrit en fourchette (« 8 à 12 », repMin + repMax) ou en reps fixes :
// repFixed: true, le nombre dans repMax (12 compris, qu'on ne pouvait pas distinguer du 12 par défaut).
// Champ facultatif : un programme sans repFixed garde son sens d'avant, et le haut réglé seul hors 12
// (« 5 reps », ancien format) se lit aussi en reps fixes. Une appli qui ne connaît pas repFixed lit le
// seul haut : même progression (charge en hausse quand toutes les séries l'atteignent).
// Progression des reps fixes : objectif = la meilleure série d'avant + 1 rep, jamais au-delà du nombre ;
// toutes les séries de travail au nombre → charge + 2,5 kg (5 lb), toujours ce nombre de reps.
// Renvoie le nombre, null pour une fourchette (ou hors répétitions : à l'appelant de vérifier la mesure).
function fixedReps(ex) {
  if (!ex || parseInt(ex.repMin) > 0) return null;
  if (ex.repFixed === true) { const n = parseInt(ex.repMax); return n > 0 ? n : 12; }
  return explicitRepMax(ex);
}

// Séries prescrites : « 4 × 12 » en reps fixes (espaces insécables : jamais coupé), sinon « 4 séries »
function setsRepsText(ex) {
  const n = measureOf(ex) === 'reps' ? fixedReps(ex) : null;
  return n ? `${ex.sets}\u00a0×\u00a0${n}` : setsCountTxt(ex);
}
// « 3 séries », vacuum : « 5 maintiens » (setNoun, js/data/measures.js, chargé après : appelé au rendu seulement)
function setsCountTxt(ex) { return `${ex.sets} ${setNoun(ex, ex.sets)}`; }
// Même chose pour VoiceOver : « 4 séries de 12 reps », pas « 4 multiplié par 12 »
function setsRepsSpoken(ex) {
  const n = measureOf(ex) === 'reps' ? fixedReps(ex) : null;
  return n ? `${plural(ex.sets, 'série', 'séries')} de ${plural(n, 'rep', 'reps')}` : setsCountTxt(ex);
}
// HTML : le texte affiché, lu par VoiceOver dans sa forme parlée (classe visually-hidden, css/screens.css, que les contrôles de textes coupés ignorent)
function setsRepsHtml(ex) {
  const shown = setsRepsText(ex), spoken = setsRepsSpoken(ex);
  return shown === spoken ? esc(shown) : `<span aria-hidden="true">${esc(shown)}</span><span class="visually-hidden">${esc(spoken)}</span>`;
}

// Liste d'une séance du programme : la prescription entière, fourchette comprise (« 3 × 8–12 », bas vide : 4 sous le
// haut, comme goalRepsAfterBump), pour ne plus lire « 3 séries » sans reps à côté de « 4 × 10 » (panel vague 4)
function repSpanOf(ex) {
  if (measureOf(ex) !== 'reps' || fixedReps(ex)) return null;
  const hi = parseInt(ex.repMax) || 12, lo = parseInt(ex.repMin) > 0 ? parseInt(ex.repMin) : Math.max(1, hi - 4);
  return lo < hi ? [lo, hi] : null;
}
function setsRangeHtml(ex) {
  const span = repSpanOf(ex);
  if (!span) return setsRepsHtml(ex);
  return `<span aria-hidden="true">${ex.sets}\u00a0×\u00a0${span[0]}–${span[1]}</span><span class="visually-hidden">${esc(`${plural(ex.sets, 'série', 'séries')} de ${span[0]} à ${span[1]} reps`)}</span>`;
}

function exerciseTarget(cat, ex) {
  const { text, gain, before, coach, spoken } = exerciseGoal(cat, ex);
  return { text, gain, before, ...(coach ? { coach: true, spoken } : {}) };
}
