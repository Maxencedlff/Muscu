// ═══════════════════════════════════════════════════════════
//  Mode coach grand écran (docs/COACH_IPAD.md) : liaison avec l'app, DERNIER script de la page embarquée
//  (après js/desk/main.js). Ne fait rien hors de l'app (window.MDLF_COACH_HOST absent, js/embed/bridge-start.js).
//
//  Une seule session pour deux clients supabase-js (celui de l'app, celui de cette page) : les jetons de
//  rafraîchissement sont à usage unique (rotation de Supabase Auth). Si les deux rafraîchissaient chacun de leur
//  côté, le second présenterait un jeton déjà remplacé et, passé le délai de réutilisation (10 s), Supabase fermerait
//  la session des DEUX côtés. D'où :
//  - un seul rafraîchisseur régulier, l'app : arrêt du rafraîchissement automatique ici, une fois la session posée ;
//    l'app pose ses jetons neufs ici (window.MDLF_COACH_EMBED.setSession) à chaque renouvellement ;
//  - jeton expiré ici quand même (iPad sorti de veille avant que l'app ait renouvelé) : supabase-js le renouvelle à
//    la première requête, et les jetons neufs repartent aussitôt à l'app (onSession) ;
//  - jamais de déconnexion depuis cette page : elle fermerait la session de l'app sur le serveur. « Se déconnecter »
//    ramène à l'app, qui garde son propre bouton (Réglages › Compte).
//  Ce script lit deskClient() de js/desk/api.js (portée globale des scripts classiques) : vérifié par
//  tests/unit/coach-ipad.mjs sur les vrais fichiers de la page.
// ═══════════════════════════════════════════════════════════
'use strict';

(() => {
  const host = window.MDLF_COACH_HOST;
  if (!host || !host.session || typeof deskClient !== 'function') return;
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
  const setSession = async t => {
    const next = tokens(t);
    if (!next || next.refresh_token === last) return { ok: true };
    last = next.refresh_token;
    try {
      const { error } = await c.auth.setSession(next);
      return { ok: !error };
    } catch { return { ok: false }; }
  };
  Object.defineProperty(window, 'MDLF_COACH_EMBED', { value: Object.freeze({ setSession }), writable: false, configurable: false });
})();
