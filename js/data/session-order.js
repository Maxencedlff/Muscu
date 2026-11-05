// ═══════════════════════════════════════════════════════════
//  Ordre des exercices pendant la séance : « Faire maintenant » et « Faire plus tard »
//  Logique pure sur la liste de la séance ; l'écran est dans js/features/session-order-ui.js
// ═══════════════════════════════════════════════════════════
//
// Une machine est prise : on fait un autre exercice avant, sans passer par Monter et Descendre.
// On déplace toujours un BLOC entier (un exercice seul, ou tout son superset : js/data/supersets.js),
// jamais un exercice au milieu d'un groupe. Les fonctions renvoient une nouvelle liste (mêmes objets),
// ou null quand le déplacement n'a pas de sens.
'use strict';

const orderBlockOf  = (blocks, ei) => blocks.findIndex(b => b.includes(ei));
const orderPending  = (xs, b) => b.some(i => xs[i].sets.some(s => !s.done));

// Faire maintenant : le bloc de ei passe juste avant le bloc de la série en cours (curEi).
// Il doit lui rester une série à faire et ne pas être déjà le bloc en cours.
function orderDoNow(xs, ei, curEi) {
  const blocks = ssBlocks(xs);
  const bi = orderBlockOf(blocks, ei), ci = orderBlockOf(blocks, curEi);
  if (bi < 0 || ci < 0 || bi === ci || !orderPending(xs, blocks[bi])) return null;
  const rest = blocks.filter((_, k) => k !== bi);
  rest.splice(rest.indexOf(blocks[ci]), 0, blocks[bi]);
  return rest.flat().map(i => xs[i]);
}

// Faire plus tard : le bloc de ei passe en dernier. Il faut un autre bloc qui reste à faire.
function orderDoLater(xs, ei) {
  const blocks = ssBlocks(xs);
  const bi = orderBlockOf(blocks, ei);
  if (bi < 0 || !orderPending(xs, blocks[bi]) || !blocks.some((b, k) => k !== bi && orderPending(xs, b))) return null;
  return [...blocks.filter((_, k) => k !== bi), blocks[bi]].flat().map(i => xs[i]);
}

// Ce que propose la carte de l'exercice ei : 'later' pour le bloc en cours, 'now' pour un autre bloc
// qui reste à faire, null sinon (exercice fini, ou plus rien d'autre à faire)
function orderChoiceFor(xs, ei, curEi) {
  if (!Number.isInteger(curEi)) return null;
  const blocks = ssBlocks(xs);
  const bi = orderBlockOf(blocks, ei);
  if (bi < 0 || !orderPending(xs, blocks[bi])) return null;
  if (bi === orderBlockOf(blocks, curEi)) return orderDoLater(xs, ei) ? 'later' : null;
  return 'now';
}

// lastEi à poser pour que la série en cours (currentSet) soit dans le bloc qui commence à ei : un exercice
// seul, lui-même ; un superset, son dernier membre (le tour repart du premier qui a une série à faire)
function orderFocusEi(xs, ei) {
  const b = ssBlocks(xs).find(x => x.includes(ei));
  return b ? b.at(-1) : null;
}
