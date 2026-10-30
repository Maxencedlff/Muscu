// ═══════════════════════════════════════════════════════════
//  Disques : exercices à barre, jeu de disques de la personne, répartition par côté
//  Logique pure ; la feuille « Disques » est dans js/features/session-tools.js. Chargé avant store.js
//  (cleanPlates sert au nettoyage de data.plates au chargement) : rien d'autre n'est appelé à ce moment.
// ═══════════════════════════════════════════════════════════
'use strict';

// Jeux standard (poids d'un disque ; chaque valeur existe en nombre illimité) et barres olympiques
// courantes : 20 kg (hommes), 15 kg (femmes), 10 kg (technique) ; 45 lb et 35 lb aux États-Unis.
// Unité des disques : 'kg' ou 'lb' (data.unit vaut 'kg' ou 'lbs' : plateUnit)
const PLATE_SETS   = { kg: [25, 20, 15, 10, 5, 2.5, 1.25], lb: [45, 35, 25, 10, 5, 2.5] };
const BAR_CHOICES  = { kg: [20, 15, 10], lb: [45, 35] };
const BAR_DEFAULT  = { kg: 20, lb: 45 };
const PLATE_MIN    = 0.25;   // plus petit disque accepté (micro-charges de 0,25 kg)
const PLATE_MAX    = 50;     // plus gros disque accepté (50 kg existe, 55 lb aussi)
const PLATE_KINDS  = 12;     // sortes de disques différentes au plus
const PLATE_Q      = 4;      // calcul en quarts (0,25) : tout disque courant en est un multiple

function plateUnit() { return data.unit === 'lbs' ? 'lb' : 'kg'; }

// Réglage mémorisé (data.plates = { bar: { kg, lb }, kg: [...], lb: [...] }), chaque partie facultative.
// Valeurs hors bornes écartées ; rien de valable : null (réglage retiré, les jeux standard reviennent)
function cleanPlates(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  const plates = list => Array.isArray(list)
    ? [...new Set(list.map(p => Math.round(parseFloat(p) * PLATE_Q) / PLATE_Q).filter(p => p >= PLATE_MIN && p <= PLATE_MAX))].sort((a, b) => b - a).slice(0, PLATE_KINDS)
    : null;
  for (const u of ['kg', 'lb']) {
    const list = plates(v[u]);
    if (list && list.length) out[u] = list;
    const bar = parseFloat(v.bar?.[u]);
    if (BAR_CHOICES[u].includes(bar)) (out.bar ??= {})[u] = bar;
  }
  return Object.keys(out).length ? out : null;
}

// Réglage en vigueur dans l'unité affichée : { unit, bar, plates (du plus lourd au plus léger) }
function plateSetup(d = data) {
  const u = plateUnit();
  const p = d.plates || {};
  return { unit: u, bar: p.bar?.[u] ?? BAR_DEFAULT[u], plates: (p[u] || PLATE_SETS[u]).slice() };
}

// Noms d'exercices faits avec une barre chargée de disques. La bibliothèque n'a pas de famille « barre »
// (son filtre « Tractions et dips » s'appelle barre, celui des barres chargées est « Salle ») : on lit le nom
// de la fiche (alias résolus), ou le nom tapé hors bibliothèque, par mots-clés.
const BARBELL_RE     = /\bbarre\b|barbell|souleve de terre|deadlift|\bsquat\b|hip thrust|good morning|rack pull|rowing menton|upright row|developpe (couche|incline|decline|militaire)|bench press|overhead press|\bohp\b|jm press|zercher|\bclean\b|thruster|snatch|arrache|epaule jete/;
const NOT_BARBELL_RE = /halter|dumbbell|\bdb\b|poulie|cable|machine|smith|guid|kettlebell|elastique|\bband\b|poids du corps|saut|jump|pistol|shrimp|bulgare|gobelet|goblet|pendulum|hack|sissy|chaise|parallele|fixe|traction|dips|trap bar|landmine|ceinture|belt|unilateral|une main|un bras/;

// Exercice chargé sur une barre à disques : répétitions en vraie charge (ni lest ni aide), fiche « Salle »
// ou nom libre, et mot-clé de barre sans mot d'un autre matériel
function isBarbellExercise(ex) {
  if (measureOf(ex) !== 'reps' || loadKind(ex) !== 'charge') return false;
  const entry = catalogueEntry(ex?.name || '');
  if (entry && entry.equip !== 'salle') return false;
  const k = ruleKey(entry ? entry.name : ex?.name || '');
  return BARBELL_RE.test(k) && !NOT_BARBELL_RE.test(k);
}

// Disques d'un côté pour la cible (unité affichée) : la charge atteignable la plus proche sous la cible (ou
// égale), avec le moins de disques. Programmation dynamique sur les quarts (0,25) : un jeu incomplet est bien
// servi là où le glouton échoue (15 + 15 = 30 quand il n'y a pas de 20 ni de 10).
// Renvoie { perSide: [25, 5, 1.25] (du plus lourd au plus léger), total, exact, belowBar }
function platesPerSide(target, bar, plates) {
  const t = parseFloat(target) || 0, b = parseFloat(bar) || 0;
  const avail = [...new Set((plates || []).map(p => Math.round(parseFloat(p) * PLATE_Q)).filter(q => q > 0))].sort((x, y) => y - x);
  if (t <= b || !avail.length) return { perSide: [], total: b, exact: Math.abs(t - b) < 0.005, belowBar: t < b };
  const side = Math.min(20000, Math.floor(Math.round((t - b) / 2 * PLATE_Q * 1000) / 1000));   // quarts par côté
  const best = new Array(side + 1).fill(Infinity), pick = new Array(side + 1).fill(0);
  best[0] = 0;
  for (let q = 1; q <= side; q++) {
    for (const p of avail) if (p <= q && best[q - p] + 1 < best[q]) { best[q] = best[q - p] + 1; pick[q] = p; }
  }
  let q = side;
  while (q > 0 && best[q] === Infinity) q--;
  const perSide = [];
  for (let r = q; r > 0; r -= pick[r]) perSide.push(pick[r] / PLATE_Q);
  perSide.sort((x, y) => y - x);
  const total = Math.round((b + q / PLATE_Q * 2) * 100) / 100;
  return { perSide, total, exact: Math.abs(total - t) < 0.005, belowBar: false };
}

// Charge arrondie à ce qui se charge vraiment (unité affichée). Barre : barre + paires de disques, le pas est
// le plus petit disque × 2, jamais sous la barre. Sans barre (haltères, machines) : pas de 2,5 kg ou 5 lb,
// comme la plupart des racks, jamais sous ce pas.
function roundLoad(v, { barbell, unit, bar, plates }) {
  const x = parseFloat(v) || 0;
  if (barbell) {
    const step = 2 * Math.min(...plates);
    return Math.round(Math.max(bar, bar + Math.round((x - bar) / step) * step) * 100) / 100;
  }
  const step = unit === 'lb' ? 5 : 2.5;
  return Math.round(Math.max(step, Math.round(x / step) * step) * 100) / 100;
}

// « 20 + 5 + 2,5 » (texte d'un côté), « — » sans disque
function platesText(perSide) {
  return perSide.length ? perSide.map(p => fmtNum(p)).join(' + ') : '—';
}
