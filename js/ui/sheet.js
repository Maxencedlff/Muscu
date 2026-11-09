// ═══════════════════════════════════════════════════════════
//  Feuille modale générique
// ═══════════════════════════════════════════════════════════
'use strict';

// sheet({ title, cancel, confirm, body, onConfirm }) → Promise (valeur de onConfirm, ou null si annulée)
// onConfirm(panel) peut renvoyer false pour garder la feuille ouverte.
// focus : sélecteur du champ à activer tout de suite (dans le geste qui ouvre la feuille : sur iOS, le clavier
// ne s'ouvre que si le focus est donné pendant le toucher), à la place du bouton OK
function sheet({ title = '', cancel = 'Annuler', confirm = 'OK', body = '', onConfirm = null, onCancel = null, focus = null } = {}) {
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
    const field = focus && $(focus, root);
    if (field) field.focus({ preventScroll: true });
    else setTimeout(() => $('.sheet__btn--confirm', root)?.focus({ preventScroll: true }), 50);
  });
}

// Clavier iOS : il recouvre le bas de l'écran sans le redimensionner (la feuille restait dessous, bouton Scanner
// caché, signalé le 10/11/2026). La zone vraiment visible (visualViewport) est recopiée dans --vv-top et --vv-h :
// la feuille se pose au-dessus du clavier et raccourcit, son contenu défile.
(function followKeyboard() {
  const vv = typeof window !== 'undefined' && window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let frame = 0;
  const apply = () => {
    frame = 0;
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    if (kb > 40) {
      root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
      root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
      root.classList.add('kb-open');
    } else {
      root.style.removeProperty('--vv-top'); root.style.removeProperty('--vv-h');
      root.classList.remove('kb-open');
    }
  };
  const queue = () => { if (!frame) frame = requestAnimationFrame(apply); };
  vv.addEventListener('resize', queue);
  vv.addEventListener('scroll', queue);
})();
