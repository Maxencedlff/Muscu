// ═══════════════════════════════════════════════════════════
//  Séance : balayage d'une série et saisie au clavier
// ═══════════════════════════════════════════════════════════
'use strict';

const SWIPE_OPEN = 74, SWIPE_MIN = 80;
let swipe = null, swipeBlockClick = false;

function closeSwipes(except) {
  document.querySelectorAll('.set-swipe--open').forEach(w => {
    if (w === except) return;
    w.classList.remove('set-swipe--open');
    const r = w.querySelector('.session-set');
    if (r) r.style.transform = '';
  });
}

document.addEventListener('pointerdown', e => {
  const row = e.target.closest?.('.set-swipe .session-set');
  if (!row || row.classList.contains('session-set--editing')) { if (!e.target.closest?.('.set-del')) closeSwipes(); return; }
  const wrap = row.parentElement;
  closeSwipes(wrap);
  swipe = { row, wrap, x0: e.clientX, y0: e.clientY, dx: 0, axis: null, base: wrap.classList.contains('set-swipe--open') ? -SWIPE_OPEN : 0 };
});
document.addEventListener('pointermove', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x0, dy = e.clientY - swipe.y0;
  // Axe verrouillé après 10 px : le défilement vertical reste prioritaire
  if (!swipe.axis && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) swipe.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  if (swipe.axis !== 'x') return;
  // Bouton « Supprimer » révélé seulement maintenant : le faire apparaître dès le toucher
  // ferait avaler le tap par iOS (il faudrait toucher deux fois le ✓ ou les champs)
  swipe.wrap.classList.add('set-swipe--swiping');
  swipe.dx = dx;
  const t = Math.min(0, Math.max(-140, swipe.base + dx));
  swipe.row.style.transition = 'none';
  swipe.row.style.transform  = `translateX(${t}px)`;
});
function endSwipe() {
  if (!swipe) return;
  const s = swipe; swipe = null;
  setTimeout(() => s.wrap.classList.remove('set-swipe--swiping'), 260);
  if (s.axis !== 'x') return;
  swipeBlockClick = true;
  setTimeout(() => { swipeBlockClick = false; }, 60);
  s.row.style.transition = '';
  const open = s.base + s.dx < -SWIPE_MIN || (s.base && s.dx < 20);
  s.wrap.classList.toggle('set-swipe--open', open);
  s.row.style.transform = open ? `translateX(${-SWIPE_OPEN}px)` : '';
  if (open) haptic();
}
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', () => {
  if (!swipe) return;
  swipe.row.style.transform = '';
  swipe.wrap.classList.remove('set-swipe--swiping');
  swipe = null;
});
// Le relâchement d'un balayage ne doit pas ouvrir la série en édition
document.addEventListener('click', e => {
  if (swipeBlockClick && e.target.closest?.('.session-set')) { e.stopPropagation(); e.preventDefault(); }
}, true);

// ── Saisie au clavier ───────────────────────────────────────

// Champ de série touché : clavier ouvert (la barre de repos s'efface), curseur laissé où iOS le place
document.addEventListener('focusin', e => {
  const t = e.target;
  if (!t.matches?.('.set-input')) return;
  document.body.classList.add('kb-open');
});
// Appui commencé dans la série rouverte (✓, autre champ) : c'est ce geste qui enregistre ou
// garde la saisie, pas la sortie du champ (sur iOS un bouton ne prend pas le focus, et sous
// charge le délai ci-dessous passerait avant le clic du ✓, qui tomberait alors dans le vide)
let editPointerInside = false;
document.addEventListener('pointerdown', e => { editPointerInside = !!e.target.closest?.('.session-set--editing'); }, true);
document.addEventListener('click', () => { setTimeout(() => { editPointerInside = false; }, 0); }, true);

document.addEventListener('focusout', e => {
  const leftEdit = e.target.closest?.('.session-set--editing');
  setTimeout(() => {
    if (!document.activeElement?.matches?.('.set-input')) document.body.classList.remove('kb-open');
    // Saisie sortie de la série rouverte (clavier fermé, tap ailleurs) : enregistrée comme avec le ✓.
    // Le délai laisse passer le tap sur le ✓ lui-même ; saveEditedSet ne fait rien s'il a déjà eu lieu.
    // Champ retiré par un nouveau rendu (isConnected faux) : ce n'est pas l'utilisateur qui part, la
    // saisie reste ouverte avec ses valeurs (editingSet).
    if (leftEdit?.isConnected && editingSet && !editPointerInside && !document.activeElement?.closest?.('.session-set--editing')) saveEditedSet();
  }, 50);
});

// Entrée : du poids aux reps, puis validation de la série
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const t = e.target;
  if (!t.matches?.('.set-input') || !t.closest('.session-set')) return;
  e.preventDefault();
  const row = t.closest('.session-set');
  const isW = t.dataset.action === 'set-weight' || t.id === 'editSetWeight';
  if (isW) { row.querySelector('[data-action="set-reps"], #editSetReps')?.focus(); return; }
  row.querySelector('.set-check-zone')?.click();
});

// Recherche de la feuille « Ajouter un exercice »
document.addEventListener('input', e => {
  if (e.target.id === 'axSearch') {
    const list = $('#axList');
    if (list) list.innerHTML = axListHtml(e.target.value);
  }
  if (e.target.id === 'summaryNotes') summaryNotesInput(e.target.value);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'axSearch') {
    e.preventDefault();
    const q = e.target.value.trim();
    if (q) axPick(q);
  }
});
