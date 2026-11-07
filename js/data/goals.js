// ═══════════════════════════════════════════════════════════
//  Objectif du jour d'un exercice : une seule règle pour l'accueil (« À battre aujourd'hui »,
//  js/features/dashboard.js) et la séance (sous le nom, js/features/session.js)
// ═══════════════════════════════════════════════════════════
'use strict';

// Même règle que la puce de la séance (bumpReady) : toutes les séries de la dernière fois en haut de la
// fourchette → charge + 2,5 kg (5 lb), à faire au bas de la fourchette (goalRepsAfterBump) ; sinon la
// meilleure série de la dernière fois + 1 rep ; jamais fait → nombre de séries prévu.
// text : « 32,5 kg × 11 », « 35 kg × 8 » ; gain : sans signe (« 1 rep », « 2,5 kg »), l'accueil le précède
// d'une flèche ↑ ; before : la meilleure série de la dernière fois, '' si jamais fait ; goal : la série à
// faire { w en kg, r }, null quand il n'y a rien à battre (jamais fait, durée, cardio, aide).
function exerciseGoal(cat, ex, progKey = data.activeProgramme) {
  const lp = lastPerf(progKey, cat, ex);
  const planned = { text: `${ex.sets} série${ex.sets > 1 ? 's' : ''}`, gain: '', before: '', goal: null };
  if (!lp) return planned;
  const sets = workSets(lp.ex.sets).filter(s => (parseInt(s.reps) || 0) > 0);   // l'échauffement ne fixe pas la cible
  const best = bestSet(sets);
  if (!best) return planned;
  const before = setTxt(best, ex);
  if (measureOf(ex) !== 'reps' || isAssisted(ex)) return { text: setTxt(best, ex), gain: '', before, goal: null };   // durée, cardio : on rappelle la dernière fois
  // Reps fixées par le coach (« 5 reps », haut sans bas) : la rep de plus ne dépasse pas ce nombre
  const fixed = parseInt(ex.repMin) > 0 ? null : explicitRepMax(ex);
  const more = { w: best.w, r: fixed ? Math.min(best.r + 1, fixed) : best.r + 1 };
  if (loadKind(ex) === 'lest') return { text: setTxt({ ...best, r: more.r, reps: String(more.r) }, ex), gain: more.r > best.r ? '1 rep' : '', before, goal: more };
  const repMax = ex.repMax ?? 12;
  const bump = best.w > 0 && sets.length >= Math.min(ex.sets, 2) && sets.every(s => (parseInt(s.reps) || 0) >= repMax);
  if (bump) {
    const w = best.w + bumpStepKg(), r = goalRepsAfterBump(ex);
    return { text: setTxt({ w, weight: w, r }), gain: bumpLabel(), before, goal: { w, r } };
  }
  return { text: setTxt({ ...best, r: more.r }), gain: more.r > best.r ? '1 rep' : '', before, goal: more };
}

// Reps à faire avec la charge augmentée :
//   fourchette complète (« 8 à 12 ») ou bas seul (« 8 à 12 » par défaut) → le bas ;
//   reps fixes du coach (« 5 reps » : haut réglé sans bas) → ces reps, avec la nouvelle charge (75 kg × 5),
//     pas « 75 kg × 3 » qui contredisait « 5 reps » et les cases (panel du 07/11) ;
//   rien de réglé (12 par défaut) → 4 sous le haut, 8.
function goalRepsAfterBump(ex) {
  const min = parseInt(ex.repMin);
  if (min > 0) return min;
  const fixed = explicitRepMax(ex);
  if (fixed) return fixed;
  return (parseInt(ex.repMax) || 12) - 4;
}

// Haut de fourchette réglé à autre chose que le 12 par défaut (l'éditeur l'écrit même sans réglage), sinon
// null : « 5 reps » d'un 5 × 5 du coach se montre et borne les reps reprises de la dernière fois
function explicitRepMax(ex) {
  const max = parseInt(ex?.repMax);
  return max > 0 && max !== 12 ? max : null;
}

function exerciseTarget(cat, ex) {
  const { text, gain, before } = exerciseGoal(cat, ex);
  return { text, gain, before };
}

// Une série de travail validée atteint l'objectif : au moins la charge (kg, au centième près) et les reps
function goalReached(goal, sets) {
  if (!goal) return false;
  return workSets(sets).some(s => s.done && (parseInt(s.reps) || 0) >= goal.r
    && Math.round((parseFloat(s.weight) || 0) * 100) >= Math.round(goal.w * 100));
}
