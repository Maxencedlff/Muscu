// ═══════════════════════════════════════════════════════════
//  Ordre des exercices pendant la séance : « Plus tard » et « Faire maintenant »
//  Logique pure sur la liste de la séance ; l'écran est dans js/features/session-order-ui.js
// ═══════════════════════════════════════════════════════════
//
// Une machine est prise : on fait un autre exercice avant, sans passer par Monter et Descendre.
// « Plus tard » est en bas de la carte en cours et dans ⋯ ; « Faire maintenant » dans ⋯ seulement
// (toucher une série d'un autre exercice suffit déjà à le commencer).
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

// Plus tard : le bloc de ei passe en dernier. Il faut un autre bloc qui reste à faire.
function orderDoLater(xs, ei) {
  const blocks = ssBlocks(xs);
  const bi = orderBlockOf(blocks, ei);
  if (bi < 0 || !orderPending(xs, blocks[bi]) || !blocks.some((b, k) => k !== bi && orderPending(xs, b))) return null;
  return [...blocks.filter((_, k) => k !== bi), blocks[bi]].flat().map(i => xs[i]);
}

// Exercice qui prend la suite après « Plus tard » sur ei : le premier du bloc à faire qui SUIVAIT ce bloc
// (pas le premier de la liste : un exercice sauté plus haut reste sauté), sinon le premier à faire avant lui
function orderLaterFocus(xs, ei) {
  const blocks = ssBlocks(xs);
  const bi = orderBlockOf(blocks, ei);
  if (bi < 0) return null;
  const after = blocks.slice(bi + 1).find(b => orderPending(xs, b)) || blocks.slice(0, bi).find(b => orderPending(xs, b));
  return after ? xs[after[0]] : null;
}

// Ce que propose l'exercice ei : 'later' pour le bloc en cours, 'now' pour un autre bloc qui reste à
// faire, null sinon (exercice fini, ou plus rien d'autre à faire)
function orderChoiceFor(xs, ei, curEi) {
  if (!Number.isInteger(curEi)) return null;
  const blocks = ssBlocks(xs);
  const bi = orderBlockOf(blocks, ei);
  if (bi < 0 || !orderPending(xs, blocks[bi])) return null;
  if (bi === orderBlockOf(blocks, curEi)) return orderDoLater(xs, ei) ? 'later' : null;
  return 'now';
}

// lastEi à poser pour que la série en cours (currentSet) soit dans le bloc qui contient ei. Exercice seul :
// lui-même. Superset : la série en cours sera celle du membre le moins avancé (ssNextSet sans dernier) ;
// lastEi est le membre qui le précède dans le groupe (le dernier s'il est le premier), pour que
// l'enchaînement reparte de lui sans casser le tour déjà commencé.
function orderFocusEi(xs, ei) {
  const b = ssBlocks(xs).find(x => x.includes(ei));
  if (!b) return null;
  if (b.length < 2) return b[0];
  const target = ssNextSet(xs, b, null)?.ei ?? b[0];
  const k = b.indexOf(target);
  return k > 0 ? b[k - 1] : b.at(-1);
}
