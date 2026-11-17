// ═══════════════════════════════════════════════════════════
//  Glisser pour réordonner une liste (poignée ≡ du mode Modifier, comme Réglages iOS)
// ═══════════════════════════════════════════════════════════
// Chaque liste s'inscrit une fois : makeReorderable({ view, list, row, handle, onMove(from, to), nameOf(i), step? }).
// view : écran où la liste vit (currentView()) ; list, row, handle : sélecteurs CSS.
// Pendant le geste, les lignes glissent en place ; au lâcher, onMove reçoit les index
// (seulement s'ils diffèrent) puis l'écran est redessiné.
// Sans glisser (VoiceOver, Contrôle de sélection, clavier) : la poignée est un bouton data-action="reorder-menu" ;
// la toucher ouvre Monter / Descendre, comme « Plus d'options… » d'un exercice en séance, puis la nouvelle place est
// annoncée (« Développé couché, 2 sur 5 ») et le focus reste sur la poignée de la ligne déplacée.
// nameOf(i) : nom lu de la ligne i ; step(i, dir) facultatif : déplace d'un cran (dir = -1 ou 1) et rend le nouvel
// index, ou -1 si c'est impossible (supersets de l'éditeur) ; sans lui, onMove(i, i + dir) dans les bornes.
'use strict';

const reorderLists = [];
let reorderDrag = null;
let reorderDragEnd = 0;   // fin du dernier vrai glisser : le clic qui le suit n'ouvre pas le menu
const REORDER_TAP_PX = 8;  // en deçà, le doigt n'a pas glissé : c'est un toucher (menu Monter / Descendre)

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
  // Simple toucher : pas de rendu, sinon la poignée serait remplacée avant le clic qui ouvre le menu
  if (d.from === d.idx && Math.abs(e.clientY - d.y0) < REORDER_TAP_PX) {
    d.row.classList.remove('is-dragging');
    d.rows.forEach(r => { r.style.transform = ''; });
    return;
  }
  reorderDragEnd = Date.now();
  if (d.from !== d.idx) d.cfg.onMove(d.from, d.idx);
  render();
}
document.addEventListener('pointerup', endReorderDrag);
document.addEventListener('pointercancel', endReorderDrag);
// iOS : sans ce preventDefault, le glisser de la poignée ferait défiler la liste
document.addEventListener('touchmove', e => { if (reorderDrag) e.preventDefault(); }, { passive: false });


// ── Monter / Descendre sans glisser ────────────────────────
function reorderStep(cfg, i, dir, dry) {
  if (cfg.step) return cfg.step(i, dir, dry);
  const n = document.querySelectorAll(`${cfg.list} ${cfg.row}`).length, to = i + dir;
  if (to < 0 || to >= n) return -1;
  if (!dry) cfg.onMove(i, to);
  return to;
}

// Après la feuille : focus sur la poignée déplacée, une fois la feuille partie (syncModal, js/core/dialogs.js, rend
// d'abord le focus à son déclencheur), puis la place annoncée
function reorderFocus(cfg, to, msg, tries = 0) {
  if (document.querySelector('.ios-dialog') && tries < 120) { requestAnimationFrame(() => reorderFocus(cfg, to, msg, tries + 1)); return; }
  document.querySelectorAll(`${cfg.list} ${cfg.handle}`)[to]?.focus();
  announce(msg);
}

registerActions({
  'reorder-menu': async (e, el) => {
    if (Date.now() - reorderDragEnd < 600) return;
    const cfg = reorderLists.find(c => currentView() === c.view && el.matches(c.handle));
    if (!cfg) return;
    const rows = [...document.querySelectorAll(`${cfg.list} ${cfg.row}`)];
    const i = rows.indexOf(el.closest(cfg.row));
    if (i < 0) return;
    const name = cfg.nameOf(i), n = rows.length;
    const choice = await dialog({ type: 'sheet', title: name, message: `${i + 1} sur ${n}`, actions: [
      ...(reorderStep(cfg, i, -1, true) >= 0 ? [{ label: 'Monter', value: -1 }] : []),
      ...(reorderStep(cfg, i, 1, true)  >= 0 ? [{ label: 'Descendre', value: 1 }] : []),
      { label: 'Annuler', style: 'cancel' },
    ] });
    if (!choice || currentView() !== cfg.view) return;
    const to = reorderStep(cfg, i, choice);
    if (to < 0) return;
    haptic();
    render();
    reorderFocus(cfg, to, `${name}, ${to + 1} sur ${n}`);
  },
});
