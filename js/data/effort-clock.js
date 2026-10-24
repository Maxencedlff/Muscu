// ═══════════════════════════════════════════════════════════
//  Chrono d'effort : horloge pure (js/features/effort.js l'affiche et la pilote)
// ═══════════════════════════════════════════════════════════
'use strict';

const EFFORT_PREP_S   = 5;   // le temps de se mettre en position, téléphone posé
const EFFORT_SWITCH_S = 5;   // exercice à deux côtés : le temps de changer de côté

// Exercices tenus d'un côté puis de l'autre (gainage latéral…) : le chrono enchaîne les deux côtés
const BOTH_SIDES_RE = /gainage lateral|side plank|planche laterale|copenhag|unilat|une jambe|un bras|chaque cote/;
function bothSides(ex) { return measureOf(ex) === 'time' && BOTH_SIDES_RE.test(ruleKey(ex?.name || '')); }

// Horloge pure d'un effort { start, target, sides } (start : fin de la préparation ; target en secondes
// par côté, null = chrono libre arrêté à la main ; sides : 1 ou 2, avec EFFORT_SWITCH_S entre les deux).
// Renvoie { phase: 'prep' | 'effort' | 'switch' | 'done', side, prepLeft, switchLeft, elapsed, left, endAt }.
function effortClock(effort, now = Date.now()) {
  const t = (now - effort.start) / 1000, target = effort.target, two = effort.sides === 2;
  const base = { side: 1, prepLeft: 0, switchLeft: 0, elapsed: 0, left: target, endAt: null };
  if (t < 0) return { ...base, phase: 'prep', prepLeft: Math.ceil(-t) };
  if (!target) {
    // Chrono libre : côté 2 démarré à la main (effort.side2Start), sinon on compte le côté 1
    if (two && effort.side2Start) {
      const t2 = (now - effort.side2Start) / 1000;
      if (t2 < 0) return { ...base, phase: 'switch', side: 2, switchLeft: Math.ceil(-t2) };
      return { ...base, phase: 'effort', side: 2, elapsed: Math.floor(t2), left: null };
    }
    return { ...base, phase: 'effort', elapsed: Math.floor(t), left: null };
  }
  const total = two ? 2 * target + EFFORT_SWITCH_S : target, endAt = effort.start + total * 1000;
  if (t >= total) return { ...base, phase: 'done', side: two ? 2 : 1, elapsed: target, left: 0, endAt };
  if (!two || t < target) return { ...base, phase: 'effort', elapsed: Math.floor(t), left: Math.ceil(target - t), endAt };
  if (t < target + EFFORT_SWITCH_S) return { ...base, phase: 'switch', side: 2, switchLeft: Math.ceil(target + EFFORT_SWITCH_S - t), endAt };
  const t2 = t - target - EFFORT_SWITCH_S;
  return { ...base, phase: 'effort', side: 2, elapsed: Math.floor(t2), left: Math.ceil(target - t2), endAt };
}

// Horloge d'une série guidée au tempo { start, tempo: [ecc, pause, con, haut], reps: N | null, conFirst,
// firstRep } (firstRep : rang de la première répétition guidée depuis start, > 1 après une reprise).
// Phases d'une répétition dans l'ordre réel du mouvement (les tirages commencent par la concentrique),
// les phases à 0 sont sautées. Renvoie { phase: 'prep' | 'ecc' | 'bottom' | 'con' | 'top' | 'done',
// rep, prepLeft, phaseLeft, endAt } ; fin après N répétitions (sans N : jusqu'à « Terminer »).
function tempoClock(effort, now = Date.now()) {
  const t = (now - effort.start) / 1000, [ecc, bottom, con, top] = effort.tempo, first = effort.firstRep || 1;
  if (t < 0) return { phase: 'prep', rep: first, prepLeft: Math.ceil(-t), phaseLeft: 0, endAt: null };
  const order = effort.conFirst
    ? [['con', con], ['top', top], ['ecc', ecc], ['bottom', bottom]]
    : [['ecc', ecc], ['bottom', bottom], ['con', con], ['top', top]];
  const phases = order.map(([p, v]) => [p, v === 'X' ? 1 : v]).filter(([, d]) => d > 0);
  const repDur = phases.reduce((a, [, d]) => a + d, 0);
  const endAt = effort.reps ? effort.start + (effort.reps - first + 1) * repDur * 1000 : null;
  if (endAt && now >= endAt) return { phase: 'done', rep: effort.reps, prepLeft: 0, phaseLeft: 0, endAt };
  const done = Math.floor(t / repDur), rep = first + done;
  let inRep = t - done * repDur;
  for (const [p, d] of phases) {
    if (inRep < d) return { phase: p, rep, prepLeft: 0, phaseLeft: Math.ceil(d - inRep), endAt };
    inRep -= d;
  }
  return { phase: phases[0][0], rep: rep + 1, prepLeft: 0, phaseLeft: phases[0][1], endAt };
}
