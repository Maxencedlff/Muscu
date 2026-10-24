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
