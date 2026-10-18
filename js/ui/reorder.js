// ═══════════════════════════════════════════════════════════
//  Glisser pour réordonner une liste (poignée ≡ du mode Modifier, comme Réglages iOS)
// ═══════════════════════════════════════════════════════════
// Chaque liste s'inscrit une fois : makeReorderable({ view, list, row, handle, onMove(from, to) }).
// view : écran où la liste vit (currentView()) ; list, row, handle : sélecteurs CSS.
// Pendant le geste, les lignes glissent en place ; au lâcher, onMove reçoit les index
// (seulement s'ils diffèrent) puis l'écran est redessiné.
'use strict';

const reorderLists = [];
let reorderDrag = null;

function makeReorderable(cfg) { reorderLists.push(cfg); }

document.addEventListener('pointerdown', e => {
  const cfg = reorderLists.find(c => currentView() === c.view && e.target.closest?.(c.handle));
  if (!cfg) return;
  e.preventDefault();
  const row  = e.target.closest(cfg.row);
  const rows = [...document.querySelectorAll(`${cfg.list} ${cfg.row}`)];
  const from = rows.indexOf(row);
  if (from < 0) return;
  reorderDrag = { cfg, row, rows, from, idx: from, y0: e.clientY, h: row.offsetHeight, id: e.pointerId };
  row.classList.add('is-dragging');
  try { e.target.setPointerCapture(e.pointerId); } catch {}
});

document.addEventListener('pointermove', e => {
  const d = reorderDrag;
  if (!d || e.pointerId !== d.id) return;
  e.preventDefault();
  const dy  = e.clientY - d.y0;
  const idx = Math.max(0, Math.min(d.rows.length - 1, d.from + Math.round(dy / d.h)));
  if (idx !== d.idx) { d.idx = idx; haptic(); }
  d.row.style.transform = `translateY(${dy}px)`;
  d.rows.forEach((r, i) => {
    if (r === d.row) return;
    let shift = 0;
    if (d.from < idx && i > d.from && i <= idx) shift = -d.h;
    if (d.from > idx && i < d.from && i >= idx) shift = d.h;
    r.style.transform = shift ? `translateY(${shift}px)` : '';
  });
});

function endReorderDrag(e) {
  const d = reorderDrag;
  if (!d || e.pointerId !== d.id) return;
  reorderDrag = null;
  if (d.from !== d.idx) d.cfg.onMove(d.from, d.idx);
  render();
}
document.addEventListener('pointerup', endReorderDrag);
document.addEventListener('pointercancel', endReorderDrag);
// iOS : sans ce preventDefault, le glisser de la poignée ferait défiler la liste
document.addEventListener('touchmove', e => { if (reorderDrag) e.preventDefault(); }, { passive: false });

