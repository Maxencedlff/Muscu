"""Mode coach grand écran sur iPad (docs/COACH_IPAD.md) : l'app construite (dist/, avec l'appli web du coach embarquée
dans dist/coach/) dans Chromium et WebKit, viewport d'iPad 13 pouces en portrait (1024 × 1366) et en paysage
(1366 × 1024), tactile, marges de sécurité de l'iPad (24 en haut, 20 en bas), sombre et clair.

    python3 tests/test_coach_ipad.py                     # construit dist/, puis Chromium et WebKit
    PPL_ENGINES=webkit PPL_NO_BUILD=1 python3 tests/test_coach_ipad.py

Parcours : carte de l'onglet Coach (jamais ouverte d'office), ouverture, cadre isolé (sandbox : origine opaque, pas de
stockage, parent.Capacitor inaccessible), session de l'app reçue par message (aucun écran de connexion), « Revenir à l'appli » visible et dans les marges, rotation, retour à l'app,
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

# Séances de Léa (une par jour, les 12 derniers jours), les mêmes dans l'app et dans le cadre
LEA = [{'id': f'l{i:02d}', 'date': days_back_ms(NOW, i + 1, 10, tz=PARIS), 'duration': 50 * 60_000, 'programme': 'ppl', 'category': 'push',
        'label': 'Push', 'exercises': [{'name': 'Développé couché', 'sets': [{'weight': '40', 'reps': '8'}]}]} for i in range(12)]

# Cadre de l'appli web du coach (init script de toutes les fenêtres, ne fait rien dans celle de l'app). Le cadre est
# ISOLÉ (sandbox sans allow-same-origin) : il ne voit rien de la fenêtre de l'app, son faux serveur est le sien. Il
# reçoit les mêmes comptes, créés dans le même ordre (mêmes identifiants : coach max, puis Léa, puis Tom), comme le
# vrai serveur sert les mêmes données aux deux clients supabase-js. setSession n'accepte que le jeton du coach.
# Journal du client du cadre dans window.__frameLog ; __frameRefresh(jetons) simule un renouvellement dans le cadre.
FRAME_SHIM = r"""(() => {
  if (window.parent === window || !window.__sb) return;
  // Comme dans un cadre isolé (sandbox) : pas de pont natif (Capacitor n'est injecté que dans la fenêtre principale)
  try { delete window.Capacitor; } catch { window.Capacitor = undefined; }
  const zero = () => { document.documentElement.style.cssText += ';--sim-sai-top:0px;--sim-sai-right:0px;--sim-sai-bottom:0px;--sim-sai-left:0px'; };
  if (document.documentElement) zero(); else addEventListener('DOMContentLoaded', zero);
  const sb = window.__sb;
  const me = sb.addPerson({ username: 'max' });
  sb.makeCoach(me);
  const lea = sb.addPerson({ username: 'lea', avatar: '🦊', social: false, sessions: %LEA% });
  const tom = sb.addPerson({ username: 'tom' });
  sb.link(me, lea, Date.now() - 20 * 86400000);
  sb.link(me, tom);
  const log = window.__frameLog = [];
  const create = window.supabase.createClient;
  window.supabase = { createClient: (url, key, o) => {
    log.push(['createClient', !!o?.auth?.persistSession, o?.auth?.storage === undefined]);
    const c = create(url, key, o);
    const listeners = [];
    const auth = { ...c.auth,
      onAuthStateChange: fn => { listeners.push(fn); return c.auth.onAuthStateChange(fn); },
      setSession: async t => { log.push(['setSession', t?.refresh_token, t?.access_token]); return c.auth.setSession(t); },
      stopAutoRefresh: async () => { log.push(['stopAutoRefresh']); },
      signOut: async () => { log.push(['signOut']); return { error: null }; },
    };
    window.__frameRefresh = t => listeners.forEach(fn => fn('TOKEN_REFRESHED', { ...t, user: { id: me } }));
    return { ...c, auth };
  } };
})();""".replace('%LEA%', json.dumps(LEA, ensure_ascii=False))
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
                              color_scheme=theme, locale='fr-FR', timezone_id=PARIS)
    # Sans service_workers='block' : son script de Playwright lit navigator.serviceWorker dans chaque cadre, ce qu'un
    # cadre isolé refuse (WebKit arrête alors les scripts de test du cadre). L'app n'enregistre aucun service worker
    # dans la coquille native (faux Capacitor)
    track_idle(ctx)
    simulate_safe_area(ctx, safe)
    # supabase-js et capacitor.js de dist/ remplacés par les faux (posés avant par FAKE_ACCOUNT)
    ctx.route('**/js/vendor/supabase.js', lambda r: r.fulfill(body='', content_type='text/javascript'))
    ctx.route('**/js/vendor/capacitor.js', lambda r: r.fulfill(body='', content_type='text/javascript'))
    ctx.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda r: r.abort())
    page = ctx.new_page()
    page.errors = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    page.csp = []
    page.on('console', lambda m: m.text.startswith('[CSP]') and page.csp.append(m.text))
    freeze_clock(page, NOW)
    page.add_init_script(CSP_WATCH)
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
    # Cadre : identifiants décalés comme dans l'app (où la connexion crée le coach en 2e position), pour que les mêmes
    # comptes aient les mêmes identifiants des deux côtés (FRAME_SHIM)
    page.add_init_script("if (window.parent !== window) window.__fakeOpts = { ...window.__fakeOpts, uidStart: 1 };")
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
    lea = LEA
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
    """Journal du client supabase-js du cadre (lu dans le cadre : Playwright y a accès, l'app non)."""
    fo = frame_obj(page)
    return fo.evaluate("w => (window.__frameLog || []).filter(c => !w || c[0] === w)", what) if fo else []


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
    # Session de l'app : ses jetons, reçus par message, posés dans le cadre, gardés en mémoire seulement
    app_t = page.evaluate('[__sb.session.refresh_token, __sb.session.access_token]')
    sets = frame_calls(page, 'setSession')
    R.check(sets and sets[0][1:] == app_t, f'{t} : session de l\'app reprise par message ({sets[:1]})')
    R.check(['createClient', False, True] in frame_calls(page, 'createClient'), f'{t} : session du cadre en mémoire seulement')
    fo = frame_obj(page)
    until(fo, "() => (window.__frameLog || []).some(c => c[0] === 'stopAutoRefresh')", 3000)
    R.check(bool(frame_calls(page, 'stopAutoRefresh')), f'{t} : rafraîchissement laissé à l\'app')
    # Cadre isolé : origine opaque, ni stockage, ni accès à la fenêtre de l'app (Capacitor, coffre des photos)
    R.check(fo.evaluate('origin') == 'null', f'{t} : origine opaque du cadre ({fo.evaluate("origin")})')
    R.check(fo.evaluate("(() => { try { localStorage.length; return 'ouvert'; } catch { return 'fermé'; } })()") == 'fermé', f'{t} : pas de stockage dans le cadre')
    for name in ('Capacitor', 'cphCoachUnlock', 'sb', 'document'):
        r = fo.evaluate(f"(() => {{ try {{ return typeof parent.{name}; }} catch (e) {{ return 'bloqué'; }} }})()")
        R.check(r == 'bloqué', f'{t} : parent.{name} inaccessible depuis le cadre ({r})')
    R.check(page.get_attribute('.coach-desk__frame', 'sandbox') == 'allow-scripts allow-forms', f'{t} : cadre isolé')
    R.check(fo.evaluate('!!window.MDLF_COACH_HOST && window.MDLF_COACH_HOST.photos === undefined'), f'{t} : contrat d\'hôte, pas de photos avant la vague 5')
    R.check(frame_of(page).locator('[data-action="soon"]').count() == 0, f'{t} : aucune entrée « bientôt » dans l\'app (audit B3)')
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
        # Cadre sorti de veille : jetons renouvelés là-bas → l'app les reprend (par message)
        app_at = page.evaluate('__sb.session.access_token')
        fo.evaluate("t => __frameRefresh({ access_token: t, refresh_token: 'faux-rafraichi-par-le-cadre' })", app_at)
        until(page, '() => __appSet.length > 0', 3000)
        R.check(page.evaluate('__appSet') == ['faux-rafraichi-par-le-cadre'], f'{t} : jetons du cadre rendus à l\'app ({page.evaluate("__appSet")})')
        # L'app renouvelle : envoyés au cadre, posés là-bas
        page.evaluate("coachDeskPost({ type: 'mdlf-coach-tokens', tokens: { access_token: __sb.session.access_token, refresh_token: 'faux-rafraichi-par-l-app' } })")
        until(fo, "() => __frameLog.some(c => c[0] === 'setSession' && c[1] === 'faux-rafraichi-par-l-app')", 3000)
        R.check(frame_calls(page, 'setSession')[-1][1] == 'faux-rafraichi-par-l-app', f'{t} : jetons de l\'app posés dans le cadre')
        # Jetons d'un AUTRE compte venus du cadre (script injecté) : jamais posés dans l'app, cadre fermé
        other = page.evaluate("() => 'h.' + btoa(JSON.stringify({ sub: '00000000-0000-0000-0000-000000000666' })).replace(/=+$/, '') + '.s'")
        n_set = len(page.evaluate('__appSet'))
        fo.evaluate("t => __frameRefresh({ access_token: t, refresh_token: 'faux-autre-compte' })", other)
        settle(page)
        R.check(page.locator('.coach-desk').count() == 0, f'{t} : jetons d\'un autre compte : mode grand écran fermé')
        R.check(len(page.evaluate('__appSet')) == n_set, f'{t} : jetons d\'un autre compte jamais posés dans l\'app')
        toast = page.locator('.toast').last.inner_text() if page.locator('.toast').count() else ''
        R.check('Connexion perdue, réessaie' in toast, f'{t} : message « Connexion perdue » ({toast!r})')
        open_desk(page, t)
        fo = frame_obj(page)
        # Message d'une autre fenêtre : ignoré par l'app
        page.evaluate("window.postMessage({ type: 'mdlf-coach-exit' }, '*')")
        settle(page)
        R.check(page.locator('.coach-desk').count() == 1, f'{t} : message qui ne vient pas du cadre ignoré')
        # « Se déconnecter » dans l'appli web : retour à l'app, sa session n'est pas fermée
        fo.evaluate("deskSignOut()")
        settle(page)
        R.check(page.locator('.coach-desk').count() == 0, f'{t} : déconnexion demandée dans le cadre → retour à l\'app')
        open_desk(page, t)
        fo = frame_obj(page)
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


def t_narrow(browser, url, engine):
    """Mode ouvert puis fenêtre rétrécie (Split View, Slide Over ; XCUITest ne les pilote pas) : reste ouvert à 678
    points (Split View à moitié sur un 13 pouces), se referme avec un message à 375 et à 320 (audit M3)."""
    t = f'{engine} fenêtre étroite'
    with app_page(browser, url) as page:
        signin_coach(page)
        for width, stays in ((678, True), (375, False), (320, False)):
            page.set_viewport_size({'width': 1024, 'height': 1366})
            settle(page)
            open_desk(page, t)
            page.set_viewport_size({'width': width, 'height': 1366})
            settle(page)
            R.check((page.locator('.coach-desk').count() == 1) == stays, f'{t} : {width} points, mode {"ouvert" if stays else "refermé"}')
            if stays:
                shot(page, f'{engine}-ouvert-{width}')
                page.locator('.coach-desk__back').tap() if page.locator('#coachDeskBar').is_visible() else frame_of(page).locator('[data-action="host-exit"]:visible').first.tap()
                settle(page)
            else:
                toast = page.locator('.toast').last.inner_text() if page.locator('.toast').count() else ''
                R.check('Agrandis la fenêtre pour le mode grand écran' in toast, f'{t} : {width} points, message ({toast!r})')
                R.check(page.evaluate("!document.querySelector('#app').inert"), f'{t} : {width} points, app de nouveau active')
        R.check(not page.errors, f'{t} : erreurs {page.errors[:3]}')


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
                print(f'· {engine} fenêtre étroite (678, 375, 320)', flush=True)
                t_narrow(browser, url, engine)
            finally:
                browser.close()
    print(f'\n{R.count - len(R.fails)}/{R.count} vérifications OK')
    sys.exit(1 if R.fails else 0)


if __name__ == '__main__':
    main()
