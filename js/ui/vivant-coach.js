// ═══════════════════════════════════════════════════════════
//  Mouvement utile du Coach, du Social et des Messages (css/theme-sobre-coach.css)
//  Même principe que js/ui/vivant.js : l'app redessine l'écran entier, ce module regarde ce qui vient d'être
//  dessiné et n'anime que ce qui vient de changer (message arrivé ou envoyé, réaction donnée, planning qu'on
//  ouvre). Les gestes sont seulement notés au « click » (un seul tap iOS), sans preventDefault.
//  Réduire les animations : rien ne bouge.
// ═══════════════════════════════════════════════════════════
'use strict';

const SBC_REDUCED = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// Messages déjà vus à l'écran : seul un message nouveau (envoyé ou reçu) entre en glissant ; ouvrir une
// conversation ne fait rien bouger
const sbcSeenMsgs = new Set();
function sbcMessages() {
  const list = document.querySelectorAll('.chat-msg[data-mid]');
  if (!list.length) return;
  const first = ![...list].some(m => sbcSeenMsgs.has(m.dataset.mid));
  list.forEach(m => {
    const id = m.dataset.mid;
    if (sbcSeenMsgs.has(id)) return;
    sbcSeenMsgs.add(id);
    if (!first) m.classList.add('sbc-in');
  });
}

// Réaction donnée : le bouton touché rebondit une fois, au rendu qui suit le toucher
let sbcReact = null;
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-action="social-react"], [data-action="social-react-pick"]');
  if (b) sbcReact = { id: b.dataset.id || '', kind: b.dataset.kind || '', at: Date.now() };
}, true);
function sbcReaction() {
  if (!sbcReact) return;
  if (Date.now() - sbcReact.at > 2000) { sbcReact = null; return; }
  const on = (sbcReact.id && document.querySelector(`.react--on[data-id="${CSS.escape(sbcReact.id)}"]`))
    || document.querySelector('.react-row__btn--on');
  if (!on) return;
  sbcReact = null;
  on.classList.add('sbc-pop');
}

// Planning des phases : les barres se déroulent la première fois qu'on ouvre l'écran, pas à chaque rendu
let sbcPlanRoute = '';
function sbcPlan() {
  const route = typeof currentRoute === 'function' ? currentRoute() : '';
  const host = document.querySelector('.plan-gantt, .plan-line');
  if (!host) { sbcPlanRoute = ''; return; }
  if (sbcPlanRoute === route) return;
  sbcPlanRoute = route;
  document.querySelectorAll('.plan-gantt, .plan-line').forEach(el => el.classList.add('sbc-grow'));
}

let sbcQueued = false;
function sbcAfterRender() {
  sbcQueued = false;
  if (SBC_REDUCED()) { sbcReact = null; return; }
  sbcMessages();
  sbcReaction();
  sbcPlan();
}
function sbcStart() {
  const root = document.getElementById('app') || document.body;
  new MutationObserver(() => {
    if (sbcQueued) return;
    sbcQueued = true;
    requestAnimationFrame(sbcAfterRender);
  }).observe(root, { childList: true, subtree: true });
  sbcAfterRender();
}
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sbcStart);
  else sbcStart();
}
