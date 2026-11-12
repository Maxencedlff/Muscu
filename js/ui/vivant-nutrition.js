// ═══════════════════════════════════════════════════════════
//  Mouvement utile de la nutrition (direction « sobre et vivante », css/theme-sobre-nutrition.css)
//  Un repas qu'on vient de cocher (journal du jour ou carte de l'accueil) : son rond se remplit de vert, la
//  coche se trace. Le toucher est seulement noté au « click » (un seul tap iOS, rien au pointerdown, aucun
//  preventDefault) ; l'écran redessiné, le nouveau bouton coché reçoit la classe. Réduire les animations : rien.
//  L'anneau et les barres des macros sont dans js/ui/vivant.js (vvFillRings).
// ═══════════════════════════════════════════════════════════
'use strict';

let vnPending = null;   // { meal, at } : repas qu'on vient de toucher pour le cocher
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-action="diet-check"]');
  if (b && b.getAttribute('aria-pressed') !== 'true') vnPending = { meal: b.dataset.meal, at: Date.now() };
}, true);

function vnAfterRender() {
  if (!vnPending) return;
  if (Date.now() - vnPending.at > 1500 || (typeof VV_REDUCED === 'function' && VV_REDUCED())) { vnPending = null; return; }
  const sel = `.diet-check--on[data-meal="${CSS.escape(vnPending.meal)}"]`;
  const btn = document.querySelector(sel);
  if (!btn) return;
  vnPending = null;
  btn.classList.add('vv-fill');
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const start = () => {
    let queued = false;
    new MutationObserver(() => {
      if (queued || !vnPending) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; vnAfterRender(); });
    }).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
