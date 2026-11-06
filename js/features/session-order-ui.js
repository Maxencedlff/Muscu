// ═══════════════════════════════════════════════════════════
//  Séance : « Plus tard » en un toucher (machine prise), « Faire maintenant » dans le menu ⋯
//  Logique : js/data/session-order.js ; menu ⋯ : js/features/session-sheets.js
// ═══════════════════════════════════════════════════════════
'use strict';

// « Plus tard » en bas de la carte de l'exercice en cours (ou de son superset), quand il reste autre
// chose à faire. Les autres exercices n'ont pas de bouton : toucher une de leurs séries suffit.
function orderBtnHtml(ei, cur) {
  const xs = activeSession.exercises;
  if (orderChoiceFor(xs, ei, cur?.ei) !== 'later') return '';
  const g = ssGroupOf(xs, ei);
  const what = g ? `${ssKind(g.length).toLowerCase()} ${g.map(k => esc(xs[k].name)).join(' et ')}` : esc(xs[ei].name);
  return `<button class="order-link" data-action="ex-later" data-ei="${ei}" aria-label="Plus tard : ${what}, passe en dernier">${icon('chevron.down', 14)}Plus tard</button>`;
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

// focus : exercice du bloc qui devient celui en cours (null : le premier qui reste à faire).
// Pendant un repos, la notification de fin et la Live Activity annoncent le nouvel exercice suivant.
function applySessionOrder(next, focus, toast) {
  const s = activeSession;
  const undo = { xs: s.exercises, lastEi: s.lastEi ?? null, lastDone: s.lastDone ?? null };
  remapSessionOrder(next);
  s.lastEi = focus ? orderFocusEi(next, next.indexOf(focus)) : null;
  haptic();
  persistSession();
  syncNativeRest();
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
  syncNativeRest();
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
  applySessionOrder(next, first, 'Mis en cours');
}

// Plus tard : le bloc de ei passe en dernier ; le bloc qui le suivait devient celui en cours
function sessionDoLater(ei) {
  const xs = activeSession?.exercises;
  if (!xs?.[ei]) return;
  const next = orderDoLater(xs, ei);
  if (!next) return;
  applySessionOrder(next, orderLaterFocus(xs, ei), 'Mis en dernier');
}

registerActions({
  'ex-later': (e, el) => sessionDoLater(parseInt(el.dataset.ei)),
});
