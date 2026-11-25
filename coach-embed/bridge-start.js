// ═══════════════════════════════════════════════════════════
//  Mode coach grand écran (docs/COACH_IPAD.md) : liaison avec l'app, PREMIER script de la page embarquée
//  (dist/coach/index.html, posé par scripts/embed-coach-web.mjs ; absent du site coach.mdlf.app).
//
//  L'app ouvre cette page dans un cadre (iframe) de même origine que la sienne et pose, avant, dans SA fenêtre,
//  window.MDLF_COACH_PARENT = { session(), exit(), onSession(jetons), photos }. Ce script en tire le contrat que
//  l'appli web du coach lit au démarrage (docs/COACH_WEB.md, « Embarquer dans l'app ») :
//    window.MDLF_COACH_HOST = { session: { access_token, refresh_token }, exit(), onSession(jetons), photos }
//  - session : jetons de la session déjà ouverte dans l'app, lus maintenant (ni écran de connexion, ni copie) ;
//  - exit : rend la main à l'app (bouton « Revenir à l'appli ») ;
//  - onSession : jetons renouvelés ici, rendus à l'app (js/embed/bridge-end.js) ;
//  - photos : point d'accroche des photos de bilan, déchiffrées par l'app (clé du trousseau), voir la doc.
//  Hors de l'app (page ouverte seule, autre origine : lecture refusée par le navigateur), rien n'est posé :
//  la page se comporte comme le site. Seul ce fichier lit la fenêtre parente ; les scripts du coach jamais.
// ═══════════════════════════════════════════════════════════
'use strict';

(() => {
  let parent = null;
  try {
    const p = window.parent;
    if (p && p !== window && p.location.origin === window.location.origin) parent = p.MDLF_COACH_PARENT || null;
  } catch { parent = null; }   // autre origine : le navigateur refuse la lecture
  if (!parent || typeof parent.exit !== 'function' || typeof parent.session !== 'function') return;
  let s = null;
  try { s = parent.session(); } catch { s = null; }
  const session = s && typeof s.access_token === 'string' && typeof s.refresh_token === 'string'
    ? Object.freeze({ access_token: s.access_token, refresh_token: s.refresh_token }) : null;
  const host = Object.freeze({
    session,
    exit: () => { try { parent.exit(); } catch { /* app déjà revenue */ } },
    onSession: t => { try { parent.onSession?.(t); } catch { /* app déjà revenue */ } },
    photos: parent.photos || null,
  });
  Object.defineProperty(window, 'MDLF_COACH_HOST', { value: host, writable: false, configurable: false, enumerable: false });
  document.documentElement.classList.add('in-app');
})();
