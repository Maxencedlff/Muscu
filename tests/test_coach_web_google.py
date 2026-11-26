"""Site du coach : identifiant Google ou Apple inconnu de MDLF, et erreurs rendues par Supabase au retour de Google
(docs/COACH_WEB.md, « Identifiant inconnu : aucun compte laissé »), dans les trois moteurs.

    python3 tests/test_coach_web_google.py
    PPL_ENGINES=webkit python3 tests/test_coach_web_google.py

1. Google inconnu : compte neuf effacé par coach-web-orphan (faux serveur de tests/fake_account.py), session fermée,
   message « Ce compte Google n'est relié à aucun compte MDLF… », rien dans l'onglet, adresse propre.
2. Fonction serveur absente (pas encore déployée) ou réseau coupé : déconnecté quand même, même message.
3. Compte gardé par le serveur (données, autre session) : la connexion continue (« Réservé aux coachs »).
4. Apple inconnu : même chose, message Apple.
5. Coach dont Google est relié : entre comme avant, rien n'est effacé.
6. Retour de Google en erreur (bad_oauth_state…, dans la requête et l'ancre) : message clair, adresse nettoyée,
   error_description jamais affiché.
7. mdlf.app (web-public/, servi sous son vrai nom par une route) : ?error=… renvoyé vers coach.mdlf.app avec error et
   error_code seuls ; sans erreur, la page reste.
Faux réseau, aucun appel à Supabase ni à Google ; un navigateur à la fois, sans fenêtre.
"""
import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright  # noqa: E402
import fixtures  # noqa: E402,F401
from coach_web_fixtures import static_server, launch, open_desk, ROOT  # noqa: E402

ENGINES = [e for e in os.environ.get('PPL_ENGINES', 'chromium,firefox,webkit').split(',') if e]
UNLINKED_G = "Ce compte Google n'est relié à aucun compte MDLF. Dans l'app : Réglages › Compte › Google › Ajouter, puis réessaie."
UNLINKED_A = "Cet identifiant Apple n'est relié à aucun compte MDLF. Dans l'app : Réglages › Compte › Apple › Ajouter, puis réessaie."
GOOGLE_USERS = "Object.values(__sb.users).filter(u => u.identities.some(i => i.provider === 'google')).length"


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def until(page, expr, timeout=20000):
    """Attend qu'une expression soit vraie, par page.evaluate (wait_for_function passe par eval, refusé par la CSP)."""
    end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if page.evaluate(expr):
                return
        except Exception:
            pass   # page en cours de rechargement
        time.sleep(0.1)
    raise AssertionError(f'toujours faux après {timeout} ms : {expr}')


def err_text(page):
    return page.evaluate("document.getElementById('login-err')?.innerText || ''")


def signed_out_clean(page, tag):
    check(page.locator('#login-email').count() == 1, f'{tag} : écran de connexion')
    check(page.evaluate('__sb.session') is None, f'{tag} : session encore ouverte')
    check(page.evaluate("sessionStorage.getItem('mdlf-coach-web-auth')") is None, f'{tag} : session gardée dans l\'onglet')
    check(page.evaluate('location.search + location.hash') == '', f'{tag} : adresse {page.evaluate("location.href")!r}')
    check(not page.evaluate('window.__csp'), f'{tag} : CSP {page.evaluate("window.__csp")}')
    check(not page.errors, f'{tag} : erreurs {page.errors}')


def google_unknown(browser, url, engine):
    tag = f'{engine} Google inconnu'
    ctx, page = open_desk(browser, url, width=1440, login=False, pre="window.__googleSub = 'google-sub-inconnu';")
    try:
        page.locator('#google-signin').click()
        until(page, "document.getElementById('login-err')?.innerText.includes('relié à aucun compte MDLF')")
        check(err_text(page) == UNLINKED_G, f'{tag} : message {err_text(page)!r}')
        check(page.evaluate('__sb.orphans') == 1, f'{tag} : compte vide pas effacé')
        check(page.evaluate(GOOGLE_USERS) == 0, f'{tag} : un compte garde l\'identité Google')
        signed_out_clean(page, tag)
        # Le message est lu par les lecteurs d'écran (role=alert) et le bouton Google reste là pour réessayer
        check(page.locator('#login-err[role="alert"]').count() == 1 and page.locator('#google-signin:not([disabled])').count() == 1, f'{tag} : réessai')
    finally:
        ctx.close()
    for fail in ('missing', 'offline'):
        tag = f'{engine} Google inconnu, fonction serveur {fail}'
        ctx, page = open_desk(browser, url, width=1440, login=False, pre=f"window.__googleSub = 'google-sub-inconnu'; __sb.fail.orphan = '{fail}';")
        try:
            page.locator('#google-signin').click()
            until(page, "document.getElementById('login-err')?.innerText.includes('relié à aucun compte MDLF')")
            check(err_text(page) == UNLINKED_G, f'{tag} : message')
            check(not page.evaluate('__sb.orphans'), f'{tag} : effacé sans la fonction ?')
            page.errors[:] = [e for e in page.errors if 'Failed to fetch' not in e]
            signed_out_clean(page, tag)
        finally:
            ctx.close()
    # Compte Google seul, ancien (créé il y a 30 jours, oldAccounts), fonction serveur absente : jamais déconnecté par une panne
    tag = f'{engine} Google seul ancien, fonction serveur absente'
    ctx, page = open_desk(browser, url, width=1440, login=False, fake_opts={'oldAccounts': True}, pre="window.__googleSub = 'google-sub-inconnu'; __sb.fail.orphan = 'missing';")
    try:
        page.locator('#google-signin').click()
        page.wait_for_selector('text=Réservé aux coachs', timeout=20000)
        check('pas un compte coach validé' in page.inner_text('main'), f'{tag} : texte')
        check(any('coach-web-orphan' in c for c in page.evaluate('__sb.calls.map(String)')), f'{tag} : fonction serveur pas demandée')
    finally:
        ctx.close()
    tag = f'{engine} Google neuf gardé par le serveur'
    ctx, page = open_desk(browser, url, width=1440, login=False, pre="window.__googleSub = 'google-sub-inconnu'; __sb.fail.orphan = 'kept';")
    try:
        page.locator('#google-signin').click()
        page.wait_for_selector('text=Réservé aux coachs', timeout=20000)
        check('pas encore de compte MDLF' in page.inner_text('main'), f'{tag} : texte du compte neuf')
        check(page.evaluate(GOOGLE_USERS) == 1 and not page.evaluate('__sb.orphans'), f'{tag} : compte effacé')
    finally:
        ctx.close()


def apple_unknown(browser, url, engine):
    tag = f'{engine} Apple inconnu'
    ctx, page = open_desk(browser, url, width=1440, login=False, pre="window.__appleSub = 'apple-sub-inconnu';")
    try:
        page.wait_for_selector('#apple-signin:not([disabled])', timeout=20000)
        page.locator('#apple-signin').click()
        until(page, "document.getElementById('login-err')?.innerText.includes('relié à aucun compte MDLF')")
        check(err_text(page) == UNLINKED_A, f'{tag} : message {err_text(page)!r}')
        check(page.evaluate('__sb.orphans') == 1, f'{tag} : compte vide pas effacé')
        check(page.evaluate("Object.values(__sb.users).some(u => u.identities.some(i => i.id === 'apple-sub-inconnu'))") is False, f'{tag} : identité Apple gardée')
        signed_out_clean(page, tag)
    finally:
        ctx.close()


def google_linked_coach(browser, url, engine):
    tag = f'{engine} coach avec Google relié'
    pre = ("window.__googleSub = 'google-sub-coach'; (() => { const u = __sb.users[window.__coachId]; "
           "u.identities.push({ identity_id: 'idt-google', provider: 'google', id: 'google-sub-coach', identity_data: { sub: 'google-sub-coach' }, created_at: u.created_at }); })();")
    # Compte du coach créé il y a 30 jours (oldAccounts) : gardé par le serveur, le coach entre
    ctx, page = open_desk(browser, url, width=1440, login=False, pre=pre, fake_opts={'oldAccounts': True})
    try:
        page.locator('#google-signin').click()
        page.wait_for_selector('.lst a.row', timeout=30000)
        check(page.locator('.lst a.row').count() == 10, f'{tag} : tableau de bord')
        check(not page.evaluate('__sb.orphans'), f'{tag} : effacement demandé')
        check(page.evaluate(GOOGLE_USERS) == 1, f'{tag} : compte du coach touché')
        check(not page.errors, f'{tag} : erreurs {page.errors}')
    finally:
        ctx.close()


def google_errors(browser, url, engine):
    cases = [
        ('?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+not+found+or+expired#error=invalid_request&error_code=bad_oauth_state&sb=',
         'a expiré ou a déjà servi'),
        ('?error=invalid_request&error_code=flow_state_expired&error_description=x', 'a expiré ou a déjà servi'),
        ('?error=access_denied&error_description=refus', 'annulée'),
        ('?error=server_error&error_description=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E%20Texte%20pirate', "n'a pas abouti"),
    ]
    ctx, page = open_desk(browser, url, width=1440, login=False)
    try:
        for query, want in cases:
            tag = f'{engine} retour {query[:50]}'
            page.goto(url + query)
            page.wait_for_selector('#login-email')
            until(page, "!!document.getElementById('login-err')?.innerText")
            text = err_text(page)
            check(want in text, f'{tag} : message {text!r}')
            check('pirate' not in page.inner_text('body') and 'OAuth state' not in page.inner_text('body'), f'{tag} : error_description affiché')
            check(page.evaluate('location.search + location.hash') == '', f'{tag} : adresse {page.evaluate("location.href")!r}')
        check(not page.errors, f'{engine} retours : erreurs {page.errors}')
    finally:
        ctx.close()


def mdlf_app_forward(browser, engine):
    """mdlf.app servi sous son vrai nom (routes) : seul error et error_code partent vers coach.mdlf.app."""
    ctx = browser.new_context(locale='fr-FR')
    seen = []

    def serve_public(route):
        path = route.request.url.split('://', 1)[1].split('/', 1)[1].split('?')[0].split('#')[0] or 'index.html'
        f = os.path.join(ROOT, 'web-public', path)
        if not os.path.isfile(f):
            return route.fulfill(status=404, body='')
        ctype = 'text/javascript' if f.endswith('.js') else 'text/html; charset=utf-8'
        headers = {'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"}
        with open(f, 'rb') as fh:
            route.fulfill(status=200, body=fh.read(), content_type=ctype, headers=headers)

    def serve_coach(route):
        seen.append(route.request.url)
        route.fulfill(status=200, body='<!doctype html><title>coach</title><p>coach</p>', content_type='text/html')

    ctx.route('https://mdlf.app/**', serve_public)
    ctx.route('https://coach.mdlf.app/**', serve_coach)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    try:
        page.goto('https://mdlf.app/?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+not+found+or+expired#error=invalid_request&error_code=bad_oauth_state&sb=')
        page.wait_for_url('https://coach.mdlf.app/**', timeout=20000)
        check(page.url == 'https://coach.mdlf.app/?error=invalid_request&error_code=bad_oauth_state', f'{engine} mdlf.app : renvoyé vers {page.url!r}')
        # Seul l'aller vers coach.mdlf.app, sans le texte libre ; « Retour » ne revient pas sur l'adresse en erreur (replace)
        check(all('error_description' not in u for u in seen), f'{engine} mdlf.app : error_description transmis {seen}')
        # Code douteux retiré, valeur d'erreur douteuse : rien
        page.goto('https://mdlf.app/?error=server_error&error_code=..%2Fevil')
        page.wait_for_url('https://coach.mdlf.app/**', timeout=20000)
        check(page.url == 'https://coach.mdlf.app/?error=server_error', f'{engine} mdlf.app : code douteux {page.url!r}')
        for q in ('', '?error=%3Cscript%3E', '?error=a%26redirect_to%3Dhttps%3A%2F%2Fevil.example'):
            page.goto('https://mdlf.app/' + q)
            page.wait_for_selector('h1')
            page.wait_for_timeout(300)
            check(page.url.startswith('https://mdlf.app/'), f'{engine} mdlf.app {q!r} : parti vers {page.url!r}')
            check("La version web n'est plus disponible" in page.inner_text('body'), f'{engine} mdlf.app {q!r} : page')
        check(not errors, f'{engine} mdlf.app : erreurs {errors}')
    finally:
        ctx.close()


def main():
    with static_server() as url, sync_playwright() as pw:
        for engine in ENGINES:
            browser = launch(pw, engine)
            try:
                for fn in (google_unknown, apple_unknown, google_linked_coach, google_errors):
                    fn(browser, url, engine)
                    print(f'OK : {fn.__name__} {engine}', flush=True)
                mdlf_app_forward(browser, engine)
                print(f'OK : mdlf_app_forward {engine}', flush=True)
            except Exception:
                traceback.print_exc()
                sys.exit(1)
            finally:
                browser.close()
    print('OK : identifiant Google ou Apple inconnu, erreurs de retour de Google, renvoi de mdlf.app')


if __name__ == '__main__':
    main()
