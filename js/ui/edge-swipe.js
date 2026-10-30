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
  // Calque fixe (position: fixed, overflow: hidden) qui montre un écran figé à sa position de défilement
  function makeEdgeLayer(html, scrollY, className) {
    const el = document.createElement('div');
    el.className = className;
    el.setAttribute('aria-hidden', 'true');
    el.inert = true;
    el.innerHTML = html;
    document.body.appendChild(el);
    el.scrollTop = scrollY;
    return el;
  }

  document.addEventListener('touchstart', ev => {
    if (!isStandalone() || ev.touches.length !== 1) return;
    const x = ev.touches[0].clientX;
    if (x >= 24 || nav.stacks[nav.tab].length < 2) return;
    if (currentRoute() === 'session' || document.querySelector('.sheet-root, .ios-dialog, .modal-overlay, .auth, .onb')) return;
    const fe = document.activeElement;
    if (fe && /^(INPUT|TEXTAREA|SELECT)$/.test(fe.tagName)) return;
    x0 = x; t0 = Date.now(); dx = 0; tracking = true;
  }, { passive: true });

  document.addEventListener('touchmove', ev => {
    if (!tracking) return;
    dx = Math.max(0, ev.touches[0].clientX - x0);
    if (!layer && dx > 6) {
      // Les deux écrans deviennent des calques FIXES qui ne débordent jamais de l'écran : déplacer #app
      // lui-même élargissait le document de la largeur du glissement, et iOS faisait alors un zoom
      // arrière de toute la page pendant le geste (vu le 30/10). Chaque calque défile au même endroit
      // que l'écran qu'il remplace (scrollTop), donc la barre de titre collante reste en haut.
      const prevKey = navKey({ tab: nav.tab, stacks: { [nav.tab]: nav.stacks[nav.tab].slice(0, -1) } });
      layer = makeEdgeLayer(snapMem[prevKey] || '', scrollMem[prevKey] || 0, 'edge-layer');
      cur = makeEdgeLayer($('#app').innerHTML, window.scrollY, 'edge-layer edge-layer--current');
      document.body.classList.add('edge-swiping');   // #app reste en place mais invisible
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
        skipTransition = true; // le geste a déjà animé
        try { goBack(); } finally { skipTransition = false; }
        document.body.classList.remove('edge-swiping');
        c.remove(); l.remove();
      }, 250);
    } else {
      c.style.transform = 'translateX(0)';
      l.style.transform = 'translateX(-30%)';
      setTimeout(() => { document.body.classList.remove('edge-swiping'); c.remove(); l.remove(); }, 250);
    }
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
})();
