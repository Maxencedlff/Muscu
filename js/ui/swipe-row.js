// ═══════════════════════════════════════════════════════════
//  Balayer une ligne vers la gauche pour la supprimer, comme les listes d'iOS (Mail, Rappels)
//
//  - Une ligne balayable porte data-swipe-del="<action>" : le bouton rouge « Supprimer » révélé dessous reçoit cette
//    action et les autres data-* de la ligne (data-meal, data-item…), traitée par le registre d'actions comme un toucher.
//  - Axe verrouillé après SWIPE_AXIS_PX : un défilement vertical ne fait jamais glisser la ligne (pointercancel du
//    navigateur aussi). Au-delà de SWIPE_FULL de la largeur, le bouton s'étend et le lâcher supprime directement ;
//    sinon la ligne reste ouverte sur « Supprimer », un toucher ailleurs la referme.
//  - Le bouton n'existe que pendant le geste (aucune marque dans les gabarits, séparateurs « + » intacts). VoiceOver et
//    le clavier gardent la voie habituelle : le toucher de la ligne ouvre son menu, où « Retirer » reste en second.
//  - La suppression elle-même propose Annuler (toast) : le geste rapide n'efface jamais sans retour.
// ═══════════════════════════════════════════════════════════
'use strict';

const SWIPE_DEL_W = 104, SWIPE_AXIS_PX = 10, SWIPE_FULL = 0.6;
let swRow = null, swOpen = null, swBlockClick = false;

function swipeDelButton(row) {
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'swipe-del';
  del.tabIndex = -1;
  del.setAttribute('aria-hidden', 'true');
  del.textContent = 'Supprimer';
  for (const [k, v] of Object.entries(row.dataset)) if (k !== 'action' && k !== 'swipeDel') del.dataset[k] = v;
  del.dataset.action = row.dataset.swipeDel;
  const host = row.parentElement;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  del.style.top = `${row.offsetTop}px`;
  del.style.height = `${row.offsetHeight}px`;
  host.appendChild(del);
  return del;
}
function swipePaint(s, x) {
  s.row.style.transform = x ? `translateX(${x}px)` : '';
  s.del.style.width = `${Math.max(SWIPE_DEL_W, -x)}px`;
  const full = -x > s.row.offsetWidth * SWIPE_FULL;
  if (full !== s.full) { s.full = full; s.del.classList.toggle('swipe-del--full', full); if (full) haptic?.('light'); }
}
function swipeClose(s = swOpen) {
  if (!s) return;
  if (swOpen === s) swOpen = null;
  s.row.classList.remove('swipe-on');
  s.row.style.transform = '';
  const del = s.del;
  setTimeout(() => del?.remove(), reduceMotion.matches ? 0 : 200);
}

document.addEventListener('pointerdown', e => {
  const row = e.target.closest?.('[data-swipe-del]');
  if (!row) { if (!e.target.closest?.('.swipe-del')) swipeClose(); return; }
  if (swOpen && swOpen.row !== row) swipeClose();
  swRow = swOpen?.row === row ? { ...swOpen, x0: e.clientX, y0: e.clientY, id: e.pointerId, axis: 'x', base: -SWIPE_DEL_W, dx: 0, reopen: true }
    : { row, del: null, x0: e.clientX, y0: e.clientY, id: e.pointerId, axis: null, base: 0, dx: 0, full: false };
});
document.addEventListener('pointermove', e => {
  const s = swRow;
  if (!s || e.pointerId !== s.id) return;
  const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
  if (!s.axis) {
    if (Math.abs(dx) < SWIPE_AXIS_PX && Math.abs(dy) < SWIPE_AXIS_PX) return;
    s.axis = Math.abs(dx) > Math.abs(dy) && dx < 0 ? 'x' : 'y';
    if (s.axis !== 'x') { swRow = null; return; }
    s.del = swipeDelButton(s.row);
    s.row.classList.add('swipe-on', 'swipe-drag');
    try { s.row.setPointerCapture(e.pointerId); } catch {}
  }
  if (s.axis !== 'x') return;
  s.dx = dx;
  swipePaint(s, Math.max(-s.row.offsetWidth, Math.min(0, s.base + dx)));
});
function swipeEnd(e) {
  const s = swRow;
  if (!s || e.pointerId !== s.id) return;
  swRow = null;
  s.row.classList.remove('swipe-drag');
  if (s.axis !== 'x' || !s.del) return;
  if (Math.abs(s.dx) >= SWIPE_AXIS_PX) { swBlockClick = true; setTimeout(() => { swBlockClick = false; }, 60); }
  if (e.type === 'pointercancel') { swipeClose(s); return; }
  const x = s.base + s.dx;
  if (s.full) {
    // Balayé jusqu'au bout : supprimé tout de suite (Annuler dans le toast de l'action)
    swipePaint(s, -s.row.offsetWidth);
    swOpen = null;
    s.del.click();
    setTimeout(() => s.del.remove(), 0);
  } else if (x < -SWIPE_DEL_W / 2) {
    swipePaint(s, -SWIPE_DEL_W);
    swOpen = s;
  } else swipeClose(s);
}
document.addEventListener('pointerup', swipeEnd);
document.addEventListener('pointercancel', swipeEnd);
// Le clic qui suit un balayage n'ouvre pas la ligne ; une ligne ouverte se referme au toucher
document.addEventListener('click', e => {
  if (e.target.closest?.('.swipe-del')) { swOpen = null; return; }
  const row = e.target.closest?.('[data-swipe-del]');
  if (swBlockClick || (row && swOpen?.row === row)) {
    e.stopImmediatePropagation(); e.preventDefault();
    if (!swBlockClick) swipeClose();
  }
}, true);
