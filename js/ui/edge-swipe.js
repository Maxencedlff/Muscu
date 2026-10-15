// ═══════════════════════════════════════════════════════════
//  Geste de retour depuis le bord (app installée sur iOS)
// ═══════════════════════════════════════════════════════════
'use strict';

function isStandalone() {
  if (Native.isNative) return true;   // app iOS : plein écran, sans geste de retour du navigateur
  return navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

(function edgeSwipe() {
  let x0 = null, t0 = 0, dx = 0, layer = null, cur = null, tracking = false;
  const W = () => window.innerWidth;
  const reset = () => { x0 = null; tracking = false; dx = 0; };

  document.addEventListener('touchstart', ev => {
    if (!isStandalone() || ev.touches.length !== 1) return;
    const x = ev.touches[0].clientX;
    if (x >= 24 || nav.stacks[nav.tab].length < 2) return;
    if (currentRoute() === 'session' || document.querySelector('.sheet-root, .ios-dialog, .modal-overlay')) return;
    const fe = document.activeElement;
    if (fe && /^(INPUT|TEXTAREA|SELECT)$/.test(fe.tagName)) return;
    x0 = x; t0 = Date.now(); dx = 0; tracking = true;
  }, { passive: true });

  document.addEventListener('touchmove', ev => {
    if (!tracking) return;
    dx = Math.max(0, ev.touches[0].clientX - x0);
    if (!layer && dx > 6) {
      // Écran précédent, figé, glissé dessous
      const prevKey = navKey({ tab: nav.tab, stacks: { [nav.tab]: nav.stacks[nav.tab].slice(0, -1) } });
      layer = document.createElement('div');
      layer.className = 'edge-layer';
      layer.setAttribute('aria-hidden', 'true');
      layer.inert = true;
      layer.innerHTML = `<div style="transform:translateY(${-(scrollMem[prevKey] || 0)}px)">${snapMem[prevKey] || ''}</div>`;
      document.body.appendChild(layer);
      cur = $('#app');
      cur.classList.add('edge-current');
    }
    if (!layer) return;
    const p = Math.min(1, dx / W());
    cur.style.transform = `translateX(${dx}px)`;
    layer.style.transform = `translateX(${-30 * (1 - p)}%)`;
  }, { passive: true });

  const end = () => {
    if (!tracking) return;
    const v = dx / Math.max(1, Date.now() - t0);
    const ok = layer && (dx > W() * 0.35 || v > 0.5);
    const l = layer, c = cur;
    layer = null; cur = null;
    reset();
    if (!l) return;
    c.style.transition = l.style.transition = 'transform .25s var(--nav-ease)';
    if (ok) {
      c.style.transform = `translateX(${W()}px)`;
      l.style.transform = 'translateX(0)';
      setTimeout(() => {
        c.style.transition = c.style.transform = '';
        c.classList.remove('edge-current');
        skipTransition = true; // le geste a déjà animé
        try { goBack(); } finally { skipTransition = false; }
        l.remove();
      }, 250);
    } else {
      c.style.transform = 'translateX(0)';
      l.style.transform = 'translateX(-30%)';
      setTimeout(() => { c.style.transition = c.style.transform = ''; c.classList.remove('edge-current'); l.remove(); }, 250);
    }
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
})();
