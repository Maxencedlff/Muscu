// ═══════════════════════════════════════════════════════════
//  Mode coach grand écran (docs/COACH_IPAD.md) : liaison avec l'app, DERNIER script chargé dans le cadre (après
//  js/desk/main.js, par js/embed/bridge-start.js). Ne fait rien hors de l'app (window.MDLF_COACH_HOST absent).
//
//  Une seule session pour deux clients supabase-js (celui de l'app, celui du cadre) : les jetons de rafraîchissement
//  sont à usage unique (rotation de Supabase Auth). Si les deux rafraîchissaient chacun de leur côté, le second
//  présenterait un jeton déjà remplacé et, passé le délai de réutilisation (10 s), Supabase fermerait la session des
//  DEUX côtés. D'où :
//  - un seul rafraîchisseur régulier, l'app (coach-web coupe autoRefreshToken en mode embarqué ; arrêt redit ici) :
//    l'app envoie ses jetons neufs au cadre (message 'mdlf-coach-tokens'), posés ici par setSession ;
//  - jeton expiré ici quand même (iPad sorti de veille avant que l'app ait renouvelé) : supabase-js le renouvelle à
//    la première requête, et les jetons neufs repartent aussitôt à l'app (onSession) ;
//  - un jeton n'est retenu que si setSession l'a accepté (sinon le suivant, même identique, serait ignoré) ;
//  - jamais de déconnexion depuis le cadre : elle fermerait la session de l'app sur le serveur. « Se déconnecter »
//    ramène à l'app ;
//  - session refusée (expirée, révoquée) : le retour à l'app porte la raison 'session' (« Connexion perdue »).
//  Ce script lit deskClient() de js/desk/api.js (portée globale des scripts classiques) : vérifié par
//  tests/unit/coach-ipad.mjs sur les vrais fichiers de la page.
// ═══════════════════════════════════════════════════════════
'use strict';

(() => {
  const host = window.MDLF_COACH_HOST, hooks = window.MDLF_COACH_EMBED_HOOKS;
  if (!host || !host.session || !hooks || typeof deskClient !== 'function') return;
  const c = deskClient();
  if (!c || !c.auth) return;
  const tokens = s => (s && typeof s.access_token === 'string' && typeof s.refresh_token === 'string'
    ? { access_token: s.access_token, refresh_token: s.refresh_token } : null);
  let last = host.session.refresh_token;
  c.auth.signOut = async () => { host.exit(); return { error: null }; };
  c.auth.onAuthStateChange((event, session) => {
    const t = tokens(session);
    if (!t || t.refresh_token === last) return;
    last = t.refresh_token;
    if (event === 'TOKEN_REFRESHED') host.onSession(t);
  });
  Promise.resolve(c.auth.getSession()).then(() => c.auth.stopAutoRefresh()).catch(() => { /* hors ligne : rien à arrêter */ });
  // « Revenir à l'appli » de l'appli web (data-action="host-exit") visible ou non : dit à l'app, qui montre sa propre
  // barre de retour tant que ce n'est pas le cas (le cadre isolé ne se laisse pas inspecter)
  let shown = null;
  const report = () => {
    const now = [...document.querySelectorAll('[data-action="host-exit"]')].some(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
        && getComputedStyle(el).visibility !== 'hidden';
    });
    if (now !== shown) { shown = now; host.report({ type: 'mdlf-coach-exit-shown', shown: now }); }
  };
  if (typeof MutationObserver === 'function') new MutationObserver(report).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  window.addEventListener('resize', report);
  report();
  hooks.reason = async () => {
    try { return (await c.auth.getSession())?.data?.session ? undefined : 'session'; } catch { return 'session'; }
  };
  hooks.onTokens = async t => {
    if (t.refresh_token === last) return;
    try {
      const { error } = await c.auth.setSession(t);
      if (!error) last = t.refresh_token;
    } catch { /* hors ligne : le prochain renouvellement de l'app réessaiera */ }
  };
})();
