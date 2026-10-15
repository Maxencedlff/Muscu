// ═══════════════════════════════════════════════════════════
//  Feuille modale générique
// ═══════════════════════════════════════════════════════════
'use strict';

// sheet({ title, cancel, confirm, body, onConfirm }) → Promise (valeur de onConfirm, ou null si annulée)
// onConfirm(panel) peut renvoyer false pour garder la feuille ouverte.
function sheet({ title = '', cancel = 'Annuler', confirm = 'OK', body = '', onConfirm = null, onCancel = null } = {}) {
  return new Promise(resolve => {
    const root = document.createElement('div');
    const id = 'sheet-' + uid();
    root.className = 'sheet-root';
    root.innerHTML = `
      <div class="sheet__backdrop"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${id}">
        <div class="sheet__grabber" aria-hidden="true"></div>
        <div class="sheet__bar">
          <button class="sheet__btn sheet__btn--cancel">${cancel ? esc(cancel) : ''}</button>
          <div class="sheet__title" id="${id}">${esc(title)}</div>
          <button class="sheet__btn sheet__btn--confirm">${confirm ? esc(confirm) : ''}</button>
        </div>
        <div class="sheet__body">${body}</div>
      </div>`;
    const panel = $('.sheet', root);
    if (!cancel) $('.sheet__btn--cancel', root).style.visibility = 'hidden';
    if (!confirm) $('.sheet__btn--confirm', root).style.visibility = 'hidden';
    const prevFocus = document.activeElement;
    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      root.classList.add('sheet-root--out');
      setTimeout(() => { root.remove(); prevFocus?.focus?.(); }, reduceMotion.matches ? 0 : 220);
      resolve(val);
    };
    const tryCancel = async () => {
      if (onCancel && (await onCancel(panel)) === false) return;
      close(null);
    };
    root._close = close;
    $('.sheet__backdrop', root).addEventListener('click', tryCancel);
    $('.sheet__btn--cancel', root).addEventListener('click', tryCancel);
    $('.sheet__btn--confirm', root).addEventListener('click', async () => {
      const v = onConfirm ? await onConfirm(panel) : true;
      if (v !== false) close(v);
    });
    root.addEventListener('keydown', ev => { if (ev.key === 'Escape') tryCancel(); });

    // Glisser vers le bas pour fermer (au-delà de 120 px ou à plus de 0,5 px/ms)
    let y0 = null, t0 = 0, dy = 0;
    const grab = $('.sheet__grabber', root), barEl = $('.sheet__bar', root);
    const startDrag = ev => { if (ev.target.closest('button')) return; y0 = ev.touches[0].clientY; t0 = Date.now(); dy = 0; panel.style.transition = 'none'; };
    [grab, barEl].forEach(h => h.addEventListener('touchstart', startDrag, { passive: true }));
    root.addEventListener('touchmove', ev => {
      if (y0 === null) return;
      dy = Math.max(0, ev.touches[0].clientY - y0);
      panel.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    root.addEventListener('touchend', () => {
      if (y0 === null) return;
      const v = dy / Math.max(1, Date.now() - t0);
      y0 = null;
      panel.style.transition = '';
      panel.style.transform = '';
      if (dy > 120 || v > 0.5) tryCancel();
    });

    document.body.appendChild(root);
    setTimeout(() => $('.sheet__btn--confirm', root)?.focus({ preventScroll: true }), 50);
  });
}
