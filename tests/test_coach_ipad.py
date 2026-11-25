"""Mode coach grand écran sur iPad (docs/COACH_IPAD.md) : l'app construite (dist/, avec l'appli web du coach embarquée
dans dist/coach/) dans Chromium et WebKit, viewport d'iPad 13 pouces en portrait (1024 × 1366) et en paysage
(1366 × 1024), tactile, marges de sécurité de l'iPad (24 en haut, 20 en bas), sombre et clair.

    python3 tests/test_coach_ipad.py                     # construit dist/, puis Chromium et WebKit
    PPL_ENGINES=webkit PPL_NO_BUILD=1 python3 tests/test_coach_ipad.py

Parcours : carte de l'onglet Coach (jamais ouverte d'office), ouverture, session de l'app reprise dans le cadre (aucun
écran de connexion, rien dans le stockage), « Revenir à l'appli » visible et dans les marges, rotation, retour à l'app,
choix retenu, jetons renouvelés dans les deux sens, « Se déconnecter » qui ne ferme pas la session de l'app, Masquer,
puis l'iPhone inchangé et l'iPad en Split View étroit. Faux iPhone et faux Supabase de tests/fake_account.py (le cadre
parle au même faux serveur que l'app, comme les deux clients supabase-js au même projet) ; supabase-js et capacitor.js
de dist/ sont remplacés par ces faux (aucun réseau, jetons factices). Un navigateur à la fois, sans fenêtre.
Captures : $PPL_SCRATCH/shots/coach-ipad/.
"""
import contextlib
import functools
import http.server
import json
import os
import socket
import subprocess
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import (Results, track_idle, simulate_safe_area, settle, seed, freeze_clock, ppl_v2_today_json,  # noqa: E402
                      local_ms, days_back_ms, PARIS, SHOTS, IOS_UA, until)
from fake_account import FAKE_ACCOUNT  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIST = os.path.join(ROOT, 'dist')
R = Results('coach-ipad')
ENGINES = [e for e in os.environ.get('PPL_ENGINES', 'chromium,webkit').split(',') if e]
OUT = os.path.join(SHOTS, 'coach-ipad')
NOW = local_ms(2026, 11, 25, 18, 0, tz=PARIS)
IPAD_UA = ('Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148')
IPAD_SAFE = (24, 0, 20, 0)
PORTRAIT, LANDSCAPE = (1024, 1366), (1366, 1024)

# Cadre de l'appli web du coach (init script, toutes les fenêtres ; ne fait rien dans la fenêtre de l'app) :
# - pas de pont natif dans un cadre (Capacitor ne l'injecte que dans la fenêtre principale) ;
# - marges de sécurité à 0, comme env(safe-area-inset-*) dans un iframe sur iPad ;
# - client supabase-js : même faux serveur que l'app (même compte), session propre au cadre, posée par setSession
#   avec les jetons de l'app (refusée sinon), rafraîchissement et déconnexion journalisés dans __sb.calls.
FRAME_SHIM = r"""(() => {
  if (window.parent === window) return;
  let P;
  try { P = window.parent; if (!P.__sb) return; } catch { return; }
  try { delete window.Capacitor; } catch { window.Capacitor = undefined; }
  const zero = () => { document.documentElement.style.cssText += ';--sim-sai-top:0px;--sim-sai-right:0px;--sim-sai-bottom:0px;--sim-sai-left:0px'; };
  if (document.documentElement) zero(); else addEventListener('DOMContentLoaded', zero);
  const real = P.__sb;
  window.__sb = real;
  const log = (...a) => real.calls.push(['frame', ...a]);
  window.supabase = { createClient: (url, key, o) => {
    log('createClient', !!o?.auth?.persistSession, o?.auth?.storage === undefined);
    const keep = [real.storage, real.storageKey];
    const c = P.supabase.createClient(url, key, { auth: { storage: real.storage, storageKey: real.storageKey } });
    [real.storage, real.storageKey] = keep;
    const listeners = [];
    let mine = null;
    const auth = { ...c.auth,
      onAuthStateChange: fn => { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
      setSession: async ({ access_token, refresh_token } = {}) => {
        log('setSession', refresh_token);
        if (!real.session || access_token !== real.session.access_token) return { data: { session: null, user: null }, error: { name: 'AuthApiError', code: 'session_not_found', message: 'Session not found', status: 403 } };
        mine = { access_token, refresh_token, user: JSON.parse(JSON.stringify(real.session.user)) };
        listeners.forEach(fn => fn('SIGNED_IN', mine));
        return { data: { session: mine, user: mine.user }, error: null };
      },
      getSession: async () => ({ data: { session: mine }, error: null }),
      stopAutoRefresh: async () => { log('stopAutoRefresh'); },
      startAutoRefresh: async () => { log('startAutoRefresh'); },
      signOut: async () => { log('signOut'); return { error: null }; },
    };
    window.__frameRefresh = t => { mine = { ...mine, ...t }; listeners.forEach(fn => fn('TOKEN_REFRESHED', mine)); };
    return { ...c, auth };
  } };
})();"""
CSP_WATCH = ("window.__csp = []; document.addEventListener('securitypolicyviolation', "
             "e => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));")


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


@contextlib.contextmanager
def dist_server():
    """Sert dist/ sur un port libre de localhost (jamais 8731)."""
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    if port == 8731:
        port = 8734
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(_Quiet, directory=DIST))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        yield f'http://127.0.0.1:{port}/'
    finally:
        srv.shutdown()


def launch(pw, engine):
    if engine == 'chromium':
        return pw.chromium.launch(headless=True, args=['--mute-audio'])
    return getattr(pw, engine).launch(headless=True)


@contextlib.contextmanager
def app_page(browser, url, *, size=PORTRAIT, theme='dark', ua=IPAD_UA, safe=IPAD_SAFE):
    w, h = size
    ctx = browser.new_context(viewport={'width': w, 'height': h}, screen={'width': w, 'height': h}, device_scale_factor=2,
                              has_touch=True, is_mobile=browser.browser_type.name != 'firefox', user_agent=ua,
                              color_scheme=theme, locale='fr-FR', timezone_id=PARIS, service_workers='block')
    track_idle(ctx)
    simulate_safe_area(ctx, safe)
    # supabase-js et capacitor.js de dist/ remplacés par les faux (posés avant par FAKE_ACCOUNT)
    ctx.route('**/js/vendor/supabase.js', lambda r: r.fulfill(body='', content_type='text/javascript'))
    ctx.route('**/js/vendor/capacitor.js', lambda r: r.fulfill(body='', content_type='text/javascript'))
    ctx.route('https://mdlf-ota.vercel.app/**', lambda r: r.abort())
    page = ctx.new_page()
    page.errors = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    page.csp = []
    page.on('console', lambda m: m.text.startswith('[CSP]') and page.csp.append(m.text))
    freeze_clock(page, NOW)
    page.add_init_script(CSP_WATCH)
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
    page.add_init_script(FAKE_ACCOUNT)
    page.add_init_script(FRAME_SHIM)
    try:
        seed(page, theme, ppl_v2_today_json(now_ms=NOW), extra={'ppl_welcome_seen': '1'}, url=url)
        settle(page)
        yield page
    finally:
        ctx.close()


def signin_coach(page):
    """Connexion Apple, pseudo max, rôle coach validé, deux élèves (Léa avec des séances, Tom sans)."""
    lea = [{'id': f'l{i:02d}', 'date': days_back_ms(NOW, i + 1, 10, tz=PARIS), 'duration': 50 * 60_000, 'programme': 'ppl', 'category': 'push',
            'label': 'Push', 'exercises': [{'name': 'Développé couché', 'sets': [{'weight': '40', 'reps': '8'}]}]} for i in range(12)]
    page.evaluate("""async (s) => {
        await accountSignInWith('apple', async () => 'add');
        await accountSaveProfile({ username: 'max' });
        const me = __sb.meId();
        __sb.makeCoach(me);
        const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false, sessions: s });
        const tom = __sb.addPerson({ username: 'tom' });
        __sb.link(me, lea, Date.now() - 20 * 86400000);
        __sb.link(me, tom);
        await coachRefresh();
    }""", lea)
    settle(page)
    page.click('.tabbar [data-tab="friends"]')
    settle(page)
    page.wait_for_selector('.friends-view .coach-team .coach-student-row')


def frame_of(page):
    return page.frame_locator('.coach-desk__frame')


def frame_obj(page):
    return page.frame(url=lambda u: '/coach/index.html' in u)


def frame_calls(page, what=None):
    return page.evaluate("w => __sb.calls.filter(c => c[0] === 'frame' && (!w || c[1] === w)).map(c => c.slice(1))", what)


def rect(page, sel):
    return page.evaluate("s => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; }", sel)


def shot(page, name):
    os.makedirs(OUT, exist_ok=True)
    page.screenshot(path=os.path.join(OUT, name + '.png'))


def open_desk(page, t):
    page.locator('[data-action="coach-desk-open"]').first.tap()
    page.wait_for_selector('.coach-desk .coach-desk__frame')
    fr = frame_of(page)
    fr.locator('.lst a.row').first.wait_for(timeout=15_000)
    return fr


def check_open(page, t, w, h):
    fr = frame_of(page)
    R.check(fr.locator('#login-email').count() == 0, f'{t} : aucun écran de connexion dans le cadre')
    rows = fr.locator('.lst a.row')
    R.check(rows.count() == 2, f'{t} : les 2 élèves de l\'app dans l\'appli web ({rows.count()})')
    R.check(any('lea' in x for x in rows.all_inner_texts()), f'{t} : Léa listée')
    # Session de l'app : ses jetons, posés dans le cadre, gardés en mémoire seulement
    app_rt = page.evaluate('__sb.session.refresh_token')
    sets = frame_calls(page, 'setSession')
    R.check(sets and sets[0][1] == app_rt, f'{t} : session de l\'app reprise ({sets})')
    R.check(['createClient', False, True] in frame_calls(page, 'createClient'), f'{t} : session du cadre en mémoire seulement')
    until(page, "() => __sb.calls.some(c => c[0] === 'frame' && c[1] === 'stopAutoRefresh')", 3000)
    R.check(bool(frame_calls(page, 'stopAutoRefresh')), f'{t} : rafraîchissement laissé à l\'app')
    fo = frame_obj(page)
    keys = fo.evaluate("Object.keys(localStorage).filter(k => k.startsWith('mdlf-coach-web') || k.startsWith('mdlf_coach_web'))")
    R.check(keys == [], f'{t} : rien de l\'appli web dans le stockage ({keys})')
    R.check(fo.evaluate('typeof window.Capacitor') == 'undefined', f'{t} : pas de pont natif dans le cadre')
    R.check(fo.evaluate('!!window.MDLF_COACH_HOST && !!window.MDLF_COACH_HOST.photos'), f'{t} : contrat d\'hôte et point d\'accroche des photos')
    # Écran hôte : plein écran, marges de sécurité laissées, « Revenir à l'appli » visible, 44 points au moins
    box = rect(page, '.coach-desk')
    R.check(box and abs(box['w'] - w) < 1 and abs(box['h'] - h) < 1, f'{t} : écran hôte plein écran ({box})')
    fb = rect(page, '.coach-desk__frame')
    R.check(fb['b'] <= h - IPAD_SAFE[2] + 0.5, f'{t} : cadre au-dessus de la barre d\'accueil ({fb})')
    own = fo.evaluate("""() => [...document.querySelectorAll('[data-action="host-exit"]')].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight; })""")
    bar_shown = page.locator('#coachDeskBar').is_visible()
    R.check(own != bar_shown, f'{t} : un seul « Revenir à l\'appli » (appli web {own}, hôte {bar_shown})')
    if bar_shown:
        b = rect(page, '.coach-desk__back')
        R.check(b['y'] >= IPAD_SAFE[0] - 0.5 and b['h'] >= 44 and b['w'] >= 44, f'{t} : bouton de retour sous la barre d\'état, 44 points ({b})')
        R.check(fb['y'] >= b['b'] - 0.5, f'{t} : le bouton ne cache pas l\'appli web')
        R.check(page.inner_text('.coach-desk__back').strip() == "Revenir à l'appli", f'{t} : libellé du retour')
    else:
        R.check(fb['y'] >= IPAD_SAFE[0] - 0.5, f'{t} : cadre sous la barre d\'état ({fb})')
    R.check(page.evaluate("document.querySelector('#app').inert === true"), f'{t} : l\'app dessous est inerte')
    over = fo.evaluate('document.scrollingElement.scrollWidth - innerWidth')
    R.check(over <= 0, f'{t} : l\'appli web ne défile pas en largeur ({over})')
    csp = fo.evaluate('window.__csp || []') + page.evaluate('window.__csp || []') + page.csp
    R.check(not csp, f'{t} : CSP respectée ({csp[:3]})')


def t_ipad(browser, url, engine, size, theme):
    w, h = size
    orient = 'portrait' if w < h else 'paysage'
    t = f'{engine} iPad {orient} {theme}'
    with app_page(browser, url, size=size, theme=theme) as page:
        signin_coach(page)
        # Carte de l'onglet Coach, jamais ouverte d'office
        R.check(page.locator('.coach-desk').count() == 0, f'{t} : rien ne s\'ouvre d\'office')
        card = page.locator('.coach-desk-card')
        R.check(card.count() == 1 and 'Ouvrir le mode grand écran' in card.inner_text(), f'{t} : carte « Ouvrir le mode grand écran »')
        over = page.evaluate('document.scrollingElement.scrollWidth - innerWidth')
        R.check(over <= 0, f'{t} : l\'app ne défile pas en largeur ({over})')
        shot(page, f'{engine}-{orient}-{theme}-1-onglet-coach')
        # Ouverture
        open_desk(page, t)
        settle(page)
        check_open(page, t, w, h)
        shot(page, f'{engine}-{orient}-{theme}-2-grand-ecran')
        # Fiche d'un élève dans le cadre
        fr = frame_of(page)
        fr.locator('.lst a.row', has_text='lea').first.tap()
        fr.locator('table.wk tbody tr').first.wait_for()
        shot(page, f'{engine}-{orient}-{theme}-3-fiche')
        # Rotation de l'iPad, mode ouvert
        page.set_viewport_size({'width': h, 'height': w})
        settle(page)
        box = rect(page, '.coach-desk')
        R.check(box and abs(box['w'] - h) < 1 and abs(box['h'] - w) < 1, f'{t} : rotation, écran hôte suit ({box})')
        R.check(fr.locator('table.wk').count() == 1, f'{t} : rotation, la fiche reste ouverte')
        R.check(page.locator('#coachDeskBar').is_visible() or frame_obj(page).evaluate("!!document.querySelector('[data-action=\"host-exit\"]')"), f'{t} : rotation, retour toujours là')
        page.set_viewport_size({'width': w, 'height': h})
        settle(page)
        # Retour à l'app
        page.locator('.coach-desk__back').tap() if page.locator('#coachDeskBar').is_visible() else frame_of(page).locator('[data-action="host-exit"]:visible').first.tap()
        settle(page)
        R.check(page.locator('.coach-desk').count() == 0, f'{t} : retour à l\'app')
        R.check(page.evaluate("!document.querySelector('#app').inert && !document.querySelector('#app').hasAttribute('aria-hidden')"), f'{t} : app de nouveau active')
        R.check(page.evaluate('typeof window.MDLF_COACH_PARENT') == 'undefined', f'{t} : jetons retirés de la fenêtre')
        R.check(page.locator('.friends-view .coach-team .coach-student-row').count() == 2, f'{t} : onglet Coach retrouvé')
        R.check(page.evaluate("localStorage.getItem('mdlf_coach_desk')") == 'used', f'{t} : choix retenu')
        R.check(page.locator('.coach-desk-card [data-action="coach-desk-open"]').count() == 1 and page.locator('.coach-desk-card__intro').count() == 0,
                f'{t} : ensuite une simple ligne « Mode grand écran »')
        shot(page, f'{engine}-{orient}-{theme}-4-retour')
        R.check(not page.errors, f'{t} : erreurs {page.errors[:3]}')


def t_session(browser, url, engine):
    """Jetons renouvelés dans les deux sens, « Se déconnecter » du cadre, déconnexion de l'app, Masquer, Réglages."""
    t = f'{engine} session'
    with app_page(browser, url) as page:
        signin_coach(page)
        page.evaluate("""() => { window.__appSet = []; sb.auth.setSession = async (s) => { __appSet.push(s.refresh_token); return { data: { session: s }, error: null }; }; }""")
        open_desk(page, t)
        settle(page)
        fo = frame_obj(page)
        # Cadre sorti de veille : jetons renouvelés là-bas → l'app les reprend
        fo.evaluate("__frameRefresh({ access_token: __sb.session.access_token, refresh_token: 'faux-rafraichi-par-le-cadre' })")
        until(page, '() => __appSet.length > 0', 3000)
        R.check(page.evaluate('__appSet') == ['faux-rafraichi-par-le-cadre'], f'{t} : jetons du cadre rendus à l\'app ({page.evaluate("__appSet")})')
        # L'app renouvelle : posés dans le cadre
        fo.evaluate("MDLF_COACH_EMBED.setSession({ access_token: __sb.session.access_token, refresh_token: 'faux-rafraichi-par-l-app' })")
        R.check(frame_calls(page, 'setSession')[-1][1] == 'faux-rafraichi-par-l-app', f'{t} : jetons de l\'app posés dans le cadre')
        # « Se déconnecter » dans l'appli web : retour à l'app, sa session n'est pas fermée
        fo.evaluate("location.hash = '#/reglages'")
        fr = frame_of(page)
        btn = fr.locator('[data-action="signout"]')
        if btn.count():
            btn.first.tap()
            settle(page)
            R.check(page.locator('.coach-desk').count() == 0, f'{t} : « Se déconnecter » ramène à l\'app')
        else:
            fr.locator('[data-action="host-exit"]').first.tap()
            settle(page)
        R.check(not frame_calls(page, 'signOut'), f'{t} : aucune déconnexion depuis le cadre')
        R.check(not any(c[0] == 'signOut' for c in page.evaluate('__sb.calls')), f'{t} : session de l\'app gardée')
        R.check(page.evaluate('!!account.user'), f'{t} : toujours connecté dans l\'app')
        # Session de l'app finie pendant le mode ouvert : il se ferme
        open_desk(page, t)
        page.evaluate('__sb.endSession()')
        settle(page)
        R.check(page.locator('.coach-desk').count() == 0, f'{t} : déconnexion de l\'app, mode grand écran fermé')
        page.evaluate("async () => { await accountSignInWith('apple', async () => 'add'); await coachRefresh(); }")
        settle(page)
        # Masquer (carte du premier passage) : plus rien dans l'onglet, la ligne reste dans Réglages › Coach
        page.evaluate("localStorage.removeItem('mdlf_coach_desk'); refreshCoachCell();")
        settle(page)
        page.locator('[data-action="coach-desk-hide"]').tap()
        settle(page)
        R.check(page.locator('.coach-desk-card').count() == 0, f'{t} : Masquer')
        R.check(page.evaluate("localStorage.getItem('mdlf_coach_desk')") == 'hidden', f'{t} : masqué retenu')
        page.evaluate("navigate('coach')")
        settle(page)
        R.check(page.locator('.coach-view [data-action="coach-desk-open"]').count() == 1, f'{t} : Réglages › Coach › Mode grand écran')
        shot(page, f'{engine}-reglages-coach')
        page.locator('.coach-view [data-action="coach-desk-open"]').tap()
        frame_of(page).locator('.lst a.row').first.wait_for(timeout=15_000)
        R.check(page.locator('.coach-desk').count() == 1, f'{t} : ouvert depuis Réglages')
        R.check(not page.errors, f'{t} : erreurs {page.errors[:3]}')


def t_unchanged(browser, url, engine):
    """iPhone : rien ne change. iPad en Split View étroit : rien non plus, et la carte revient en élargissant."""
    t = f'{engine} iPhone'
    with app_page(browser, url, size=(402, 874), ua=IOS_UA, safe=(62, 0, 34, 0)) as page:
        signin_coach(page)
        R.check(page.locator('.coach-desk-card, .coach-desk').count() == 0, f'{t} : aucune carte sur iPhone')
        page.evaluate("navigate('coach')")
        settle(page)
        R.check(page.locator('[data-action="coach-desk-open"]').count() == 0, f'{t} : rien dans Réglages › Coach')
        R.check(not page.errors, f'{t} : erreurs {page.errors[:3]}')
    t = f'{engine} iPad Split View'
    with app_page(browser, url, size=(678, 1024)) as page:
        signin_coach(page)
        R.check(page.locator('.coach-desk-card').count() == 0, f'{t} : 678 points, pas de carte')
        shot(page, f'{engine}-split-view-678')
        page.set_viewport_size({'width': 1024, 'height': 1366})
        settle(page)
        R.check(page.locator('.coach-desk-card').count() == 1, f'{t} : fenêtre élargie, la carte revient')


def main():
    if not os.environ.get('PPL_NO_BUILD'):
        subprocess.run(['node', 'scripts/build-web.mjs'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    if not os.path.exists(os.path.join(DIST, 'coach', 'index.html')):
        sys.exit('dist/coach/ absent : lancer node scripts/build-web.mjs')
    with dist_server() as url, sync_playwright() as pw:
        for engine in ENGINES:
            browser = launch(pw, engine)
            try:
                for size in (PORTRAIT, LANDSCAPE):
                    for theme in ('dark', 'light'):
                        print(f'· {engine} {size} {theme}', flush=True)
                        t_ipad(browser, url, engine, size, theme)
                print(f'· {engine} session', flush=True)
                t_session(browser, url, engine)
                print(f'· {engine} iPhone et Split View', flush=True)
                t_unchanged(browser, url, engine)
            finally:
                browser.close()
    print(f'\n{R.count - len(R.fails)}/{R.count} vérifications OK')
    sys.exit(1 if R.fails else 0)


if __name__ == '__main__':
    main()
