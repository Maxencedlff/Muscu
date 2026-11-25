// ═══════════════════════════════════════════════════════════
//  Mode coach grand écran (docs/COACH_IPAD.md) : liaison avec l'app, SEUL script de la page embarquée au départ
//  (dist/coach/index.html, posé par scripts/embed-coach-web.mjs ; absent du site coach.mdlf.app).
//
//  La page tourne dans un cadre ISOLÉ (iframe sandbox="allow-scripts allow-forms", sans allow-same-origin) : origine
//  opaque, aucun accès à la fenêtre de l'app (ni à Capacitor, ni au coffre des photos, ni à son stockage). Tout passe
//  par postMessage :
//    cadre → app  { type: 'mdlf-coach-ready' }                       page prête à recevoir la session
//    app → cadre  { type: 'mdlf-coach-session', session }            jetons de la session ouverte dans l'app
//    cadre → app  { type: 'mdlf-coach-tokens', tokens }               jetons renouvelés ici (js/embed/bridge-end.js)
//    app → cadre  { type: 'mdlf-coach-tokens', tokens }               jetons renouvelés par l'app
//    cadre → app  { type: 'mdlf-coach-exit', reason }                 « Revenir à l'appli » ; reason 'session' si la
//                                                                     session a été refusée (« Connexion perdue »)
//    cadre → app  { type: 'mdlf-coach-exit-shown', shown }           bouton de retour de la page visible ou non
//  Un message n'est lu que s'il vient de la fenêtre parente (event.source) : l'origine d'un cadre isolé est « null »,
//  la source est la seule preuve. Les scripts de l'appli web du coach (gardés inertes dans <template> par la
//  construction) ne sont chargés qu'une fois la session reçue : ils trouvent alors window.MDLF_COACH_HOST, le contrat
//  de docs/COACH_WEB.md (« Embarquer dans l'app »), comme s'il avait été posé avant eux.
//  Hors de l'app (page ouverte seule) : aucune session n'arrive, rien n'est chargé ; la page le dit.
// ═══════════════════════════════════════════════════════════
'use strict';

(() => {
  const parent = window.parent;
  if (!parent || parent === window) { document.body.textContent = 'MDLF Coach : à ouvrir depuis l\'app.'; return; }
  // Destination des messages vers l'app : son origine si le navigateur la donne, sinon toute (la page n'envoie que
  // des jetons qu'elle a reçus de cette même fenêtre, et l'app refuse tout cadre d'une autre origine : frame-src 'self')
  const to = (window.location.ancestorOrigins && window.location.ancestorOrigins[0]) || '*';
  const send = msg => { try { parent.postMessage(msg, to); } catch { /* app déjà revenue */ } };
  const tokens = s => (s && typeof s.access_token === 'string' && s.access_token && typeof s.refresh_token === 'string' && s.refresh_token
    ? { access_token: s.access_token, refresh_token: s.refresh_token } : null);
  // Crochets posés par js/embed/bridge-end.js : raison du retour (session refusée), jetons venus de l'app
  const hooks = { reason: async () => undefined, onTokens: () => {} };
  Object.defineProperty(window, 'MDLF_COACH_EMBED_HOOKS', { value: hooks, writable: false, configurable: false });

  let started = false;
  window.addEventListener('message', e => {
    if (e.source !== parent) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'mdlf-coach-tokens') { const t = tokens(d.tokens); if (t) hooks.onTokens(t); return; }
    if (d.type !== 'mdlf-coach-session' || started) return;
    const session = tokens(d.session);
    if (!session) { send({ type: 'mdlf-coach-exit', reason: 'session' }); return; }
    started = true;
    const host = Object.freeze({
      session: Object.freeze(session),
      exit: async reason => { let r = reason; try { r = r || await hooks.reason(); } catch { /* rien */ } send({ type: 'mdlf-coach-exit', reason: r || null }); },
      onSession: t => { const n = tokens(t); if (n) send({ type: 'mdlf-coach-tokens', tokens: n }); },
      // État de la page pour l'app (bouton de retour visible : js/embed/bridge-end.js)
      report: msg => { if (msg && msg.type === 'mdlf-coach-exit-shown') send({ type: msg.type, shown: msg.shown === true }); },
    });
    Object.defineProperty(window, 'MDLF_COACH_HOST', { value: host, writable: false, configurable: false, enumerable: false });
    document.documentElement.classList.add('in-app');
    // Scripts de la page, dans leur ordre (async = false : exécutés dans l'ordre d'insertion)
    const tpl = document.getElementById('mdlf-embed-scripts');
    for (const s of tpl ? [...tpl.content.querySelectorAll('script[src]')] : []) {
      const el = document.createElement('script');
      el.src = s.getAttribute('src');
      el.async = false;
      document.body.appendChild(el);
    }
  });
  send({ type: 'mdlf-coach-ready' });
})();
