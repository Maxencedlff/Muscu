// ═══════════════════════════════════════════════════════════
//  Séance : « Faire maintenant » et « Faire plus tard » en un toucher (machine prise)
//  Logique : js/data/session-order.js ; aussi dans le menu ⋯ (js/features/session-sheets.js)
// ═══════════════════════════════════════════════════════════
'use strict';

// Bouton en bas de la carte : « Plus tard » sur l'exercice en cours, « Faire maintenant » sur les autres
// qui restent à faire. Rien sur un exercice fini, ni quand il ne reste qu'un exercice à faire.
function orderBtnHtml(ei, cur) {
  const xs = activeSession.exercises;
  const choice = orderChoiceFor(xs, ei, cur?.ei);
  if (!choice) return '';
  const g = ssGroupOf(xs, ei), what = g ? ssKind(g.length).toLowerCase() : esc(xs[ei].name);
  return choice === 'later'
    ? `<button class="order-link" data-action="ex-later" data-ei="${ei}" aria-label="Faire plus tard : ${what}, passe en dernier">${icon('chevron.down', 14)}Plus tard</button>`
    : `<button class="order-link" data-action="ex-now" data-ei="${ei}" aria-label="Faire maintenant : ${what}">${icon('arrow.up', 14)}Faire maintenant</button>`;
}

// Nouvelle liste de la séance (mêmes objets, autre ordre) : les positions (ei) gardées ailleurs suivent
// leur exercice (chrono en cours, série rouverte, sélecteur RIR)
function remapSessionOrder(next) {
  const s = activeSession, before = s.exercises;
  const at = ei => (Number.isInteger(ei) && before[ei] ? next.indexOf(before[ei]) : -1);
  if (s.effort) { const k = at(s.effort.ei); if (k >= 0) s.effort.ei = k; else cancelEffort(); }
  if (editingSet) { const k = at(editingSet.ei); if (k >= 0) editingSet.ei = k; else editingSet = null; }
  if (s.lastDone) { const k = at(s.lastDone.ei); s.lastDone = k >= 0 ? { ...s.lastDone, ei: k } : null; }
  s.exercises = next;
}

// focus : exercice à faire tout de suite (Faire maintenant), null : le premier qui reste (Plus tard)
function applySessionOrder(next, focus, toast) {
  const s = activeSession;
  const undo = { xs: s.exercises, lastEi: s.lastEi ?? null, lastDone: s.lastDone ?? null };
  remapSessionOrder(next);
  s.lastEi = focus ? orderFocusEi(next, next.indexOf(focus)) : null;
  haptic();
  persistSession();
  render();
  scrollToCurrent();   // la série en cours, au centre (sous la barre, jamais cachée par elle)
  showToast(toast, { action: 'Annuler', duration: 4000, onAction: () => undoSessionOrder(undo, next) });
}

// « Annuler » : l'ordre d'avant revient, avec la série en cours d'avant (séries validées entre-temps gardées)
function undoSessionOrder(u, applied) {
  const s = activeSession;
  if (!s || s.exercises !== applied) return;
  remapSessionOrder(u.xs);
  s.lastEi = u.lastEi;
  s.lastDone = u.lastDone;
  persistSession();
  render();
  scrollToCurrent();
}

// Faire maintenant : le bloc de ei (exercice seul ou superset entier) passe avant l'exercice en cours
function sessionDoNow(ei) {
  const xs = activeSession?.exercises, cur = currentSet();
  if (!xs?.[ei] || !cur) return;
  const next = orderDoNow(xs, ei, cur.ei);
  if (!next) return;
  const g = ssGroupOf(xs, ei), first = xs[g ? g[0] : ei];
  applySessionOrder(next, first, `${g ? ssKind(g.length) : 'Exercice'} avancé`);
}

// Faire plus tard : le bloc de ei passe en dernier ; l'exercice suivant devient celui en cours
function sessionDoLater(ei) {
  const xs = activeSession?.exercises;
  if (!xs?.[ei]) return;
  const next = orderDoLater(xs, ei);
  if (!next) return;
  const g = ssGroupOf(xs, ei);
  applySessionOrder(next, null, `${g ? ssKind(g.length) : 'Exercice'} repoussé à la fin`);
}

registerActions({
  'ex-now':   (e, el) => sessionDoNow(parseInt(el.dataset.ei)),
  'ex-later': (e, el) => sessionDoLater(parseInt(el.dataset.ei)),
});
