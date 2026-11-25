"""Faux serveurs du test d'interface iPad (XCUITest, ios/UITests/, docs/COACH_IPAD.md « Test dans la vraie vue web »).

    python3 tests/ios_e2e_fixtures.py dist/e2e        # puis npx cap copy ios

Écrit deux scripts que la build Debug injecte dans la vraie WKWebView, SEULEMENT lancée avec « -mdlfE2E 1 »
(MainViewController.swift, #if DEBUG ; jamais dans une build TestFlight : ios.yml ne les écrit qu'en mode contrôle et
vérifie leur absence dans l'archive) :
- main.js (fenêtre de l'app) : faux iPhone et faux Supabase de tests/fake_account.py (aucun réseau, aucun vrai compte,
  jetons factices), coach max connecté par le faux Apple, élèves Léa (12 séances) et Tom ; puis une ligne d'état visible
  « E2E … » que le test lit dans l'arbre d'accessibilité (prêt, mode ouvert, état rapporté par le cadre, CSP, erreurs) ;
- frame.js (cadre isolé du mode grand écran) : le même faux Supabase, mêmes comptes dans le même ordre (mêmes
  identifiants), puis un rapport toutes les 500 ms à l'app par postMessage : origine du cadre, session reçue par
  message, accès à parent.Capacitor et parent.cphCoachUnlock (doivent être refusés), élèves affichés, fiche ouverte,
  route, violations de CSP et erreurs.
supabase.js et capacitor.js du paquet se chargent ensuite : window.supabase et window.Capacitor sont figés sur les faux.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_account import FAKE_ACCOUNT  # noqa: E402

# Les mêmes comptes des deux côtés : Léa, 12 séances (une par jour), Tom sans séance
SEED_PEOPLE = r"""
  const day = 86400000, lea = [];
  for (let i = 0; i < 12; i++) lea.push({ id: 'l' + String(i).padStart(2, '0'), date: Date.now() - (i + 1) * day, duration: 50 * 60000,
    programme: 'ppl', category: 'push', label: 'Push', exercises: [{ name: 'Développé couché', sets: [{ weight: '40', reps: '8' }] }] });
"""

LOCK = r"""
  // Les scripts du paquet (supabase.js, capacitor.js) ne remplacent pas les faux
  const lock = (name, value) => { try { Object.defineProperty(window, name, { configurable: false, get: () => value, set() {} }); } catch { /* déjà figé */ } };
  // Réseau des mises à jour à chaud coupé : rien ne sort du test
  const rawFetch = window.fetch.bind(window);
  window.fetch = (u, o) => (/ota\.mdlf\.app|mdlf-ota\.vercel\.app/.test(String(u)) ? Promise.reject(new TypeError('coupé par le test')) : rawFetch(u, o));
"""

MAIN = r"""(() => {
  if (window.parent !== window) return;
  window.__fakeOpts = { oldAccounts: true };
  try { localStorage.setItem('ppl_welcome_seen', '1'); } catch { /* rien */ }
%FAKE%
%LOCK%
  lock('supabase', window.supabase);
  // Réponse du natif à l'appel de plugin tenté depuis le cadre (callbackId « e2e-cadre ») : il ne doit jamais y en avoir
  const nativeAnswers = [];
  const fakeFromNative = window.Capacitor.fromNative;
  window.Capacitor.fromNative = r => { if (r && r.callbackId === 'e2e-cadre') nativeAnswers.push(r); return fakeFromNative ? fakeFromNative(r) : undefined; };
  const cap = new Proxy(window.Capacitor, { set: () => true, defineProperty: () => true, deleteProperty: () => true });
  lock('Capacitor', cap);
  const st = { ready: 0, csp: [], errors: [], frame: {} };
  addEventListener('securitypolicyviolation', e => st.csp.push(e.effectiveDirective + ' ' + e.blockedURI));
  addEventListener('error', e => st.errors.push(String(e.message)));
  addEventListener('message', e => { const d = e.data; if (d && d.type === 'mdlf-e2e-frame') st.frame = d; });
  const el = document.createElement('div');
  el.id = 'mdlf-e2e-status';
  el.setAttribute('style', 'position:fixed;left:4px;bottom:2px;z-index:2147483647;font:11px -apple-system;color:#888;pointer-events:none;background:transparent');
  const text = () => {
    const f = st.frame, desk = document.querySelector('.coach-desk');
    return ['E2E', `prêt=${st.ready}`, `mode=${desk ? 1 : 0}`, `cadre=${f.origin ?? '-'}`, `session=${f.session ? 1 : 0}`,
      `parentCapacitor=${f.parentCapacitor ?? '-'}`, `parentCoffre=${f.parentUnlock ?? '-'}`, `élèves=${f.students ?? 0}`,
      `fiche=${f.fiche ? 1 : 0}`, `canalCadre=${f.channel ?? '-'}`, `appelCadre=${f.call ?? '-'}`, `réponseNative=${nativeAnswers.length}`, `onglet=${f.tab ?? '-'}`, `paysage=${innerWidth > innerHeight ? 1 : 0}`,
      `connecté=${typeof account !== 'undefined' && account.user ? 1 : 0}`, `cspApp=${st.csp.length}`, `cspCadre=${f.csp ?? 0}`,
      `erreursApp=${st.errors.length}`, `erreursCadre=${f.errors ?? 0}`,
      // Première violation de CSP du cadre et de l'app, pour comprendre un échec sur le simulateur
      `cspCadreQuoi=${(f.cspFirst || '-').replace(/\s+/g, '_')}`, `cspAppQuoi=${(st.csp[0] || '-').replace(/\s+/g, '_')}`,
      `erreurAppQuoi=${(st.errors[0] || '-').slice(0, 80).replace(/\s+/g, '_')}`].join(' ');
  };
  setInterval(() => {
    if (!document.body) return;
    // Dans la boîte de dialogue du mode grand écran quand elle est ouverte (aria-modal : le reste est caché)
    const home = document.querySelector('.coach-desk') || document.body;
    if (el.parentNode !== home) home.appendChild(el);
    if (!desk()) st.frame = {};
    el.textContent = text();
    el.setAttribute('aria-label', el.textContent);
  }, 300);
  const desk = () => document.querySelector('.coach-desk');
  // Connexion du coach et de ses élèves, une fois l'app démarrée
  const setup = async () => {
    // Premier lancement : questions passées (comme « Plus tard », sans la visite de l'accueil)
    data.onboarded = true; save();
    if (typeof closeOnboarding === 'function') closeOnboarding();
    await accountSignInWith('apple', async () => 'add');
    await accountSaveProfile({ username: 'max' });
    const me = __sb.meId();
    __sb.makeCoach(me);
%SEED%
    const l = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false, sessions: lea });
    const t = __sb.addPerson({ username: 'tom' });
    __sb.link(me, l, Date.now() - 20 * day);
    __sb.link(me, t);
    await coachRefresh();
    render();
    st.ready = 1;
  };
  const wait = setInterval(() => {
    if (typeof accountSignInWith !== 'function' || typeof account === 'undefined' || !account.ready) return;
    clearInterval(wait);
    setup().catch(e => st.errors.push('installation : ' + e));
  }, 200);
})();"""

FRAME = r"""(() => {
  if (window.parent === window) return;
  window.__fakeOpts = { oldAccounts: true, uidStart: 1 };
%FAKE%
%LOCK%
  try { delete window.Capacitor; } catch { window.Capacitor = undefined; }
  const sb = window.__sb;
%SEED%
  const me = sb.addPerson({ username: 'max' });
  sb.makeCoach(me);
  const l = sb.addPerson({ username: 'lea', avatar: '🦊', social: false, sessions: lea });
  const t = sb.addPerson({ username: 'tom' });
  sb.link(me, l, Date.now() - 20 * day);
  sb.link(me, t);
  lock('supabase', window.supabase);
  const st = window.__e2e = { session: false, csp: [], errors: [] };
  addEventListener('message', e => { const d = e.data; if (e.source === window.parent && d && d.type === 'mdlf-coach-session') st.session = true; });
  addEventListener('securitypolicyviolation', e => st.csp.push([e.effectiveDirective, e.blockedURI, e.sample, e.sourceFile + ':' + e.lineNumber].join(' ')));
  addEventListener('error', e => st.errors.push(String(e.message)));
  const probe = name => { try { return typeof window.parent[name]; } catch { return 'bloqué'; } };
  // Canal natif de Capacitor depuis le cadre : un vrai appel de plugin (StatusBar.getInfo répond toujours) que le
  // natif doit ignorer (MainFrameOnlyMessageHandler) ; la fenêtre de l'app compte les réponses (réponseNative)
  const tryChannel = () => {
    const ch = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridge;
    st.channel = ch ? 'joignable' : 'absent';
    if (!ch) { st.call = 'aucun'; return; }
    try { ch.postMessage({ type: 'message', pluginId: 'StatusBar', methodName: 'getInfo', callbackId: 'e2e-cadre', options: {} }); st.call = 'envoyé'; }
    catch { st.call = 'refusé'; }
  };
  setTimeout(tryChannel, 1500);
  setInterval(() => {
    const report = { type: 'mdlf-e2e-frame', origin: String(self.origin), session: st.session && !!window.MDLF_COACH_HOST,
      parentCapacitor: probe('Capacitor'), parentUnlock: probe('cphCoachUnlock'),
      students: document.querySelectorAll('.lst a.row').length, fiche: !!document.querySelector('table.wk'),
      tab: (location.hash.match(/\/(semaines|bilans|programme|nutrition|messages)\b/) || [, location.hash ? 'accueil' : '-'])[1],
      channel: st.channel, call: st.call, csp: st.csp.length, cspFirst: st.csp[0] || '', errors: st.errors.length };
    window.parent.postMessage(report, '*');
  }, 500);
})();"""


def render(tpl):
    return tpl.replace('%FAKE%', FAKE_ACCOUNT).replace('%LOCK%', LOCK).replace('%SEED%', SEED_PEOPLE)


def main(out):
    os.makedirs(out, exist_ok=True)
    for name, tpl in (('main.js', MAIN), ('frame.js', FRAME)):
        with open(os.path.join(out, name), 'w', encoding='utf-8') as f:
            f.write(render(tpl))
    print(json.dumps({'écrits': sorted(os.listdir(out))}, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'dist/e2e')
