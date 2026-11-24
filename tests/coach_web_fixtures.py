"""Outils des tests de l'appli web du coach (coach-web/, docs/COACH_WEB.md).

- Serveur statique local du dépôt sur un port libre (jamais 8731, celui de la suite de l'app) ;
- faux Supabase de tests/fake_account.py injecté avant le chargement (window.supabase factice : aucun réseau, aucun
  vrai secret : code e-mail factice 123456, adresse en exemple.test) ;
- COACH_WEB_SEED : un coach factice et dix élèves réalistes (séances, records, pesées, mensurations, diète, eau,
  phases, messages), datés depuis l'horloge figée de la page (mardi 24 novembre 2026, 15 h, Europe/Paris) ;
- FAKE_APPLE_JS : faux Sign in with Apple JS servi à la place de celui d'Apple (aucun réseau) : init() garde la
  configuration, signIn() rend un faux id_token qui porte le nonce reçu (comme Apple), ou rejette avec
  window.__appleFail ('popup_closed_by_user'…) ;
- open_desk() : contexte, horloge, thème, seed, faux Apple JS (apple='blocked' : script injoignable), connexion par code.
"""
import contextlib
import datetime
import functools
import http.server
import os
import socket
import threading
from zoneinfo import ZoneInfo

from fake_account import FAKE_ACCOUNT

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = ZoneInfo('Europe/Paris')
# Mardi 24 novembre 2026, 15 h à Paris : semaine 48, lundi 23
NOW = datetime.datetime(2026, 11, 24, 15, 0, tzinfo=TZ)
COACH_EMAIL = 'coach@exemple.test'
FAKE_CODE = '123456'   # code factice du faux serveur (tests/fake_account.py), jamais un vrai

# Coach et élèves factices. Tout est calculé dans la page, depuis son horloge figée (jours du calendrier locaux).
COACH_WEB_SEED = r"""
(() => {
  const sb = window.__sb, co = sb.co, now = Date.now();
  const at = (k, h = 18, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); d.setDate(d.getDate() - k); return d.getTime(); };
  const iso = k => { const d = new Date(at(k, 12)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const coach = sb.addPerson({ username: 'max.coach' });
  sb.users[coach].email = 'coach@exemple.test';
  sb.makeCoach(coach);
  // Verrou de l'abonnement allumé (faux StoreKit absent : seul ce drapeau est lu) et formule 25 élèves
  window.__st = window.__st || { paywallOn: true };
  sb.setTier(coach, 'com.mdlf.training.coach20.monthly');
  window.__coachId = coach;
  const EX = [['Squat', 80], ['Développé couché', 55], ['Rowing barre', 50], ['Hip thrust', 90]];
  let n = 0;
  const session = (k, label, scale = 1, recs = [], h = 18) => ({ id: 's' + (++n), date: at(k, h), duration: 3900000, label, programme: 'u_c' + coach.replace(/[^a-z0-9]/gi, '').slice(0, 8) + '_seche4', category: 'push',
    exercises: EX.map(([name, kg]) => ({ name, measure: 'reps', sets: [0, 1, 2].map(() => ({ weight: String(Math.round(kg * scale * 2) / 2), reps: '8' })) })),
    records: recs });
  const rec = (ex, after) => ({ ex, kind: 'charge', before: after - 2.5, after });
  // days : jours d'entraînement (il y a k jours) ; chaque semaine plus ancienne un peu plus léger
  const sessions = (days, recs = {}) => days.map(k => session(k, ['Haut du corps', 'Bas du corps'][k % 2], 1 - k / 400, recs[k] || [], k % 3 ? 18 : 7));
  const dietDay = (k, kcal, okMeals = 4, water = 2200) => ({ day: iso(k), plan: 'diet_seche', name: 'Sèche', kind: k % 2 ? 't' : 'r',
    meals: ['Petit-déjeuner', 'Déjeuner', 'Collation', 'Dîner'].map((x, i) => ({ n: x, ok: i < okMeals })), kcal, p: Math.round(kcal / 15), c: Math.round(kcal / 10), f: 55,
    goal: { kcal: 1800, p: 120, c: 180, f: 60 }, water, waterGoal: 2500, waterMin: null, salt: null, saltMin: null, saltMax: null });
  const prog = (student, seen = true) => co.progs.push({ coach, student, id: 'seche4', data: { name: 'Sèche 4 jours', sessions: [] }, sent_at: new Date(at(40)).toISOString(), seen });
  const weekly = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const P = [];
  const add = (username, o = {}) => {
    const id = sb.addPerson({ username, social: false, sessions: o.sessions || [] });
    sb.link(coach, id, o.since ?? at(90));
    const l = co.links.find(x => x.student === id); l.seen = o.seen ?? at(1);
    if (o.prog !== false) prog(id);
    (o.phases || []).forEach(p => sb.addPhase(id, p));
    if (o.weights) sb.share(id, o.weights);
    if (o.measures) sb.shareMeasures(id, o.measures);
    if (o.diet) sb.shareDiet(id, o.diet);
    (o.msgs || []).forEach(([k, txt]) => sb.msg(id, false, txt, at(k, 20)));
    P.push(id); return id;
  };
  // Léa : sèche semaine 5 sur 8, tout partagé, 2 messages non lus
  window.__lea = add('lea', {
    sessions: sessions([1, 2, 7, 9, 10, 12, 14, 16, 17, 19, 21, 23, 24, 26, 28, 30, 31, 33, 35, 37, 38, 40, 44, 47, 51, 54], { 9: [rec('Hip thrust', 95)], 23: [rec('Squat', 82.5)] }),
    phases: [{ goal: 'maintain', start: iso(65), weeks: 4 }, { goal: 'cut', start: iso(29 + 7), weeks: 8, prog_name: 'Sèche 4 jours' }],
    weights: weekly(40, i => ({ date: at(i * 2, 7), kg: Math.round((61.6 + i * 0.045 + ((i * 7) % 5) * 0.08) * 10) / 10 })),
    measures: { waist: weekly(6, i => ({ date: at(2 + i * 7, 8), cm: 68.5 + i * 0.5 })), hips: weekly(6, i => ({ date: at(2 + i * 7, 8), cm: 94.5 + i * 0.3 })), thighL: weekly(6, i => ({ date: at(2 + i * 7, 8), cm: 54.5 + i * 0.2 })) },
    diet: weekly(60, i => dietDay(i, i % 7 === 3 ? 2300 : 1780 + (i % 4) * 15, i % 7 === 3 ? 2 : 4, 1900 + (i % 5) * 150)).filter((_, i) => i % 9 !== 5),
    msgs: [[0, 'Je peux remplacer le riz par des pâtes ce soir ?'], [0, 'Et merci pour le programme !']],
  });
  // Tom : prise de masse, 2 records cette semaine, 1 message
  add('tom', { sessions: sessions([0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25], { 0: [rec('Squat', 120)], 2: [rec('Développé couché', 92.5)] }),
    phases: [{ goal: 'bulk', start: iso(56), weeks: 12 }], weights: weekly(20, i => ({ date: at(i * 3, 7), kg: 78.4 - i * 0.12 })),
    diet: weekly(30, i => dietDay(i, 2900 + (i % 3) * 20, 4, 3000)).map(d => ({ ...d, goal: { kcal: 2900, p: 160, c: 380, f: 80 }, p: 165 })), msgs: [[1, 'Le squat est passé !']] });
  // Karim : sèche, plus de séance depuis 9 jours, diète pas suivie
  add('karim', { sessions: sessions([9, 11, 14, 16, 18, 21]), phases: [{ goal: 'cut', start: iso(10), weeks: 6 }],
    diet: [dietDay(6, 2500, 1), dietDay(7, 2600, 1), dietDay(8, 1800, 4)] });
  // Inès : mini cut, diète pas suivie les 3 derniers jours
  add('ines', { sessions: sessions([1, 3, 6, 8, 10, 13, 15, 17, 20, 22, 24]), phases: [{ goal: 'mini_cut', start: iso(23), weeks: 4 }],
    diet: [dietDay(0, 900, 1), dietDay(1, 2600, 1), dietDay(2, 2700, 1), dietDay(3, 2650, 2), dietDay(4, 1800, 4), dietDay(5, 1790, 4), dietDay(6, 1810, 4)] });
  // Jade : reprise, diète non partagée, 1 nouvelle séance
  add('jade', { sessions: sessions([0, 3, 8]), phases: [{ goal: 'comeback', start: iso(1), weeks: 4 }], seen: at(2) });
  // Hugo : aucun programme, aucune phase
  add('hugo', { sessions: sessions([3, 6, 10, 13]), prog: false });
  // Sarah : force, 3 nouvelles séances
  add('sarah', { sessions: sessions([0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23]), phases: [{ goal: 'strength', start: iso(24), weeks: 6 }], seen: at(5),
    weights: weekly(10, i => ({ date: at(i * 4, 7), kg: 64.2 })) });
  // Nathan : prise de masse, rien à traiter
  add('nathan', { sessions: sessions([1, 3, 5, 8, 10, 12, 15, 17, 19, 22]), phases: [{ goal: 'bulk', start: iso(10), weeks: 10 }],
    diet: weekly(10, i => dietDay(i, 1800, 4)) });
  // Camille : maintien, un record
  add('camille', { sessions: sessions([0, 2, 5, 7, 9, 12, 14, 16, 19], { 0: [rec('Hip thrust', 110)] }), phases: [{ goal: 'maintain', start: iso(37), weeks: 8 }] });
  // Yanis : décharge, phase suivante dans 6 jours
  add('yanis', { sessions: sessions([2, 6, 9, 13, 16]), phases: [{ goal: 'deload', start: iso(1), weeks: 1 }, { goal: 'strength', start: iso(-6), weeks: 6 }] });
  window.__students = P;
})();
"""


APPLE_JS_URL = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/fr_FR/appleid.auth.js'
APPLE_SUB = '001234.facticeapple.0001'   # identifiant Apple factice du coach
FAKE_APPLE_JS = r"""
window.AppleID = { auth: {
  init(o) { window.__appleInit = o; },
  signIn() {
    window.__appleCalls = (window.__appleCalls || 0) + 1;
    if (window.__appleFail) return Promise.reject({ error: window.__appleFail });
    const o = window.__appleInit, b64 = x => btoa(JSON.stringify(x)).replace(/=+$/, '');
    return Promise.resolve({ authorization: { id_token: 'apple.' + b64({ sub: window.__appleSub, nonce: o.nonce, aud: o.clientId }) + '.sig', state: o.state, code: 'code-factice' } });
  },
} };
"""


def route_apple(ctx, mode='fake'):
    """Script d'Apple : faux (mode 'fake') ou injoignable ('blocked'), jamais le vrai."""
    if mode == 'blocked':
        ctx.route('https://appleid.cdn-apple.com/**', lambda r: r.abort())
    else:
        ctx.route('https://appleid.cdn-apple.com/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=FAKE_APPLE_JS))


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


@contextlib.contextmanager
def static_server():
    """Sert le dépôt sur un port libre de localhost (jamais 8731) ; rend l'adresse de coach-web/."""
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    if port == 8731:
        port = 8733
    handler = functools.partial(_Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        yield f'http://127.0.0.1:{port}/coach-web/'
    finally:
        srv.shutdown()


def launch(pw, engine):
    """Navigateur sans fenêtre ; Chromium muet (--mute-audio)."""
    args = ['--mute-audio'] if engine == 'chromium' else []
    return getattr(pw, engine).launch(headless=True, args=args)


def open_desk(browser, url, *, width, height=900, theme='dark', touch=False, seed=True, login=True, fake_opts=None, apple='fake'):
    """Page de l'appli web du coach, horloge figée, faux serveur injecté, coach connecté (sauf login=False)."""
    ctx = browser.new_context(viewport={'width': width, 'height': height}, color_scheme=theme, locale='fr-FR',
                              timezone_id='Europe/Paris', has_touch=touch, device_scale_factor=1)
    route_apple(ctx, apple)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.clock.install(time=NOW)
    opts = fake_opts or {}
    page.add_init_script('window.__fakeOpts = ' + __import__('json').dumps(opts) + ';')
    page.add_init_script("window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));")
    page.add_init_script(FAKE_ACCOUNT)
    if seed:
        page.add_init_script(COACH_WEB_SEED)
    page.goto(url)
    page.wait_for_selector('#app > *')
    if login:
        page.fill('#login-email', COACH_EMAIL)
        page.click('form[data-form="email"] button')
        page.wait_for_selector('#login-code')
        page.fill('#login-code', FAKE_CODE)
        page.click('form[data-form="code"] button')
        page.wait_for_selector('.lst, .empty:not([role="status"])')
    page.errors = errors
    return ctx, page
