"""Appli web du coach (coach-web/, docs/COACH_WEB.md) dans les trois moteurs : Chromium, Firefox et WebKit, à 1440 et
1180 px (ordinateur, iPad paysage) et 820 px (tablette en portrait, tactile), en sombre et en clair.

    python3 tests/test_coach_web.py            # tout : 3 moteurs × 3 largeurs × 2 thèmes, puis les parcours
    PPL_ENGINES=chromium python3 tests/test_coach_web.py

Faux Supabase de tests/fake_account.py, coach et élèves factices de tests/coach_web_fixtures.py (aucun réseau,
code factice). Un navigateur à la fois, sans fenêtre. Sort en erreur au premier échec, captures dans
$PPL_SCRATCH/shots/coach-web-echecs/.
"""
import os
import subprocess
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright  # noqa: E402
import fixtures  # noqa: E402,F401  (textes lus ramenés aux espaces simples, comme les autres tests : typo_norm)
import hashlib  # noqa: E402
import base64  # noqa: E402
import json  # noqa: E402
from coach_web_fixtures import static_server, launch, open_desk, route_apple, COACH_EMAIL, FAKE_CODE, APPLE_SUB  # noqa: E402

ENGINES = [e for e in os.environ.get('PPL_ENGINES', 'chromium,firefox,webkit').split(',') if e]
SIZES = [(1440, 900, False), (1180, 820, True), (820, 1180, True)]
FAILS = os.path.join(os.environ.get('PPL_SCRATCH', '/tmp/ppl-tests'), 'shots', 'coach-web-echecs')


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def no_hscroll(page, where):
    over = page.evaluate('document.scrollingElement.scrollWidth - innerWidth')
    check(over <= 0, f'{where} : la page défile en largeur ({over} px)')


def small_targets(page):
    """Cibles touchables de moins de 44 px (boutons, liens, champs visibles)."""
    return page.evaluate("""() => [...document.querySelectorAll('button, a[href], input, [role=tab], [role=radio]')]
      .filter(e => e.offsetParent !== null && !e.closest('dialog:not([open])'))
      .map(e => { const r = e.getBoundingClientRect(); return { t: (e.innerText || e.id || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter(x => x.h < 44 || x.w < 44)""")


def matrix_case(browser, url, engine, w, h, touch, theme):
    tag = f'{engine} {w}px {theme}'
    ctx, page = open_desk(browser, url, width=w, height=h, theme=theme, touch=touch)
    try:
        # Tableau de bord : les 10 élèves, les plus urgents en tête
        rows = page.locator('.lst a.row')
        check(rows.count() == 10, f'{tag} : {rows.count()} élèves')
        first = page.locator('.lst a.row').first.inner_text()
        check('karim' in first and '9 jours sans séance' in first, f'{tag} : premier élève {first!r}')
        check(page.locator('.seg button.on').inner_text().startswith('À traiter'), f'{tag} : segment par défaut')
        bg = page.evaluate('getComputedStyle(document.body).backgroundColor')
        check(bg == ('rgb(0, 0, 0)' if theme == 'dark' else 'rgb(242, 242, 247)'), f'{tag} : fond {bg}')
        no_hscroll(page, f'{tag} tableau de bord')
        small = small_targets(page)
        check(not small, f'{tag} : cibles de moins de 44 px {small[:5]}')
        side = page.locator('.side').is_visible()
        bar = page.locator('.tabbar').is_visible()
        check(side == (w >= 900) and bar == (w < 900), f'{tag} : barre latérale {side}, barre d\'onglets {bar}')
        rail = page.locator('.rail').is_visible()
        check(rail == (w >= 1240), f'{tag} : panneau de droite {rail}')
        # Recherche
        page.fill('#q', 'ines')
        check(page.locator('.lst a.row').count() == 1, f'{tag} : recherche')
        page.fill('#q', '')
        # Fiche Semaines de Léa (toucher ou clic)
        lea = page.locator('.lst a.row', has_text='lea').first
        lea.tap() if touch else lea.click()
        page.wait_for_selector('table.wk tbody tr')
        check(page.locator('table.wk tbody tr').count() == 8, f'{tag} : 8 semaines')
        check(page.locator('table.wk tbody tr.cur').inner_text().startswith('S48'), f'{tag} : semaine en cours')
        check(page.locator('.chart svg polyline').count() == 1, f'{tag} : courbe du poids')
        check(page.locator('[role=tab]').count() == 5 and page.locator('[role=tab][aria-disabled=true]').count() == 0, f'{tag} : les cinq onglets de la fiche (vague 4)')
        no_hscroll(page, f'{tag} fiche')
        small = small_targets(page)
        check(not small, f'{tag} : fiche, cibles de moins de 44 px {small[:5]}')
        more = page.locator('[data-action=more-weeks]')
        more.tap() if touch else more.click()
        check(page.locator('table.wk tbody tr').count() == 12, f'{tag} : 12 semaines')
        check(not page.evaluate('window.__csp || []'), f'{tag} : CSP {page.evaluate("window.__csp")}')
        check(not page.errors, f'{tag} : erreurs {page.errors}')
        # Rien des élèves sur l'appareil : seules la session et l'heure du dernier geste
        # (mdlf_push_ask et mdlf_push_remind : posées par le faux serveur lui-même, tests/fake_account.py)
        keys = page.evaluate("Object.keys(localStorage).filter(k => !['mdlf_push_ask', 'mdlf_push_remind'].includes(k)).sort()")
        check(keys == [], f'{tag} : localStorage {keys}')
        keys = page.evaluate("Object.keys(sessionStorage).sort()")
        check(keys == ['mdlf-coach-web-auth', 'mdlf_coach_web_active'], f'{tag} : sessionStorage {keys}')
    except Exception:
        os.makedirs(FAILS, exist_ok=True)
        page.screenshot(path=os.path.join(FAILS, tag.replace(' ', '_') + '.png'), full_page=True)
        raise
    finally:
        ctx.close()


def journeys(browser, url, engine):
    """Parcours détaillés (un moteur à la fois) : clavier, repli du serveur, refus, déconnexion, invitation."""
    # Clavier : / recherche, J / K, Entrée ouvre la fiche, retour au tableau
    ctx, page = open_desk(browser, url, width=1440)
    page.locator('body').click(position={'x': 700, 'y': 20})
    page.keyboard.press('/')
    check(page.evaluate('document.activeElement.id') == 'q', 'clavier : / ne mène pas à la recherche')
    page.keyboard.press('Escape')
    page.locator('h1').click()
    page.keyboard.press('j')
    page.keyboard.press('j')
    focused = page.evaluate('document.activeElement.dataset.student')
    check(focused == page.locator('.lst a.row').nth(1).get_attribute('data-student'), 'clavier : J ne passe pas à l\'élève suivant')
    page.keyboard.press('k')
    check(page.evaluate('document.activeElement.dataset.student') == page.locator('.lst a.row').first.get_attribute('data-student'), 'clavier : K')
    page.keyboard.press('Enter')
    page.wait_for_selector('table.wk')
    page.click('.crumb a')
    page.wait_for_selector('.lst a.row')
    # Segments
    page.click('[data-filter=noprog]')
    check(page.locator('.lst a.row').count() == 1 and 'hugo' in page.locator('.lst a.row').inner_text(), 'segment Sans programme')
    page.click('[data-filter=all]')
    check(page.locator('.lst a.row').count() == 10, 'segment Tous')
    # Invitation : dialogue avec le code permanent
    page.click('[data-action=invite]')
    check(page.locator('#invite-dialog[open] .big').inner_text().replace(' ', '') == page.evaluate('__sb.co.permCode[__coachId]'), 'code d\'invitation')
    page.keyboard.press('Escape')
    check(page.locator('.rail').inner_text().find('25 élèves offerts') >= 0, 'palier de l\'abonnement')
    # Fiche en un appel (serveur à jour)
    lea = page.evaluate('window.__lea')
    page.evaluate(f"location.hash = '#/eleve/{lea}'")
    page.wait_for_selector('table.wk tbody tr')
    calls = page.evaluate("__sb.calls.filter(c => c[0] === 'coach' && c[1].startsWith('coach_student') && c[1] !== 'coach_student_checkins' && c[2].includes(window.__lea)).map(c => c[1])")
    check(calls == ['coach_student_weeks'], f'fiche : un seul appel attendu, {calls}')
    # Réglages, déconnexion de cet ordinateur
    page.evaluate("location.hash = '#/reglages'")
    page.click('[data-action=signout]')
    page.wait_for_selector('#login-email')
    left = page.evaluate("Object.keys(localStorage).filter(k => !k.startsWith('mdlf_push_')).concat(Object.keys(sessionStorage))")
    check(left == [], f'déconnexion : il reste {left}')
    check(not page.errors, f'parcours : erreurs {page.errors}')
    ctx.close()

    # Serveur d'avant la migration : lectures une par une, même tableau
    ctx, page = open_desk(browser, url, width=1180, fake_opts={})
    page.evaluate("__sb.fail.weeks = 'missing'")
    page.evaluate("location.hash = '#/eleve/' + window.__lea")
    page.wait_for_selector('table.wk tbody tr')
    calls = page.evaluate("[...new Set(__sb.calls.filter(c => c[0] === 'coach' && c[1].startsWith('coach_student') && c[1] !== 'coach_student_checkins').map(c => c[1]))].sort()")
    check(calls == ['coach_student_diet', 'coach_student_measures', 'coach_student_sessions', 'coach_student_weeks', 'coach_student_weights'], f'repli : {calls}')
    check(page.locator('table.wk tbody tr.cur').inner_text().startswith('S48'), 'repli : semaine en cours')
    ctx.close()

    # Mauvais code, puis compte qui n'est pas coach
    ctx, page = open_desk(browser, url, width=1440, login=False)
    page.fill('#login-email', COACH_EMAIL)
    page.click('form[data-form=email] button')
    page.fill('#login-code', '000000')
    page.click('form[data-form=code] button')
    page.wait_for_selector('#login-err:not(:empty)')
    check('Code incorrect' in page.inner_text('#login-err'), 'mauvais code')
    otp = page.evaluate("__sb.calls.filter(c => c[0] === 'otp').map(c => c[2])")
    check(otp == [False], f'code demandé sans créer de compte : {otp}')
    ctx.close()
    ctx, page = open_desk(browser, url, width=1440, login=False)
    page.evaluate("(() => { const id = __sb.addPerson({ username: 'eleve.seul' }); __sb.users[id].email = 'eleve@exemple.test'; })()")
    page.fill('#login-email', 'eleve@exemple.test')
    page.click('form[data-form=email] button')
    page.fill('#login-code', FAKE_CODE)
    page.click('form[data-form=code] button')
    page.wait_for_selector('text=Réservé aux coachs')
    check(page.locator('.lst').count() == 0, 'compte non coach : aucune liste')
    ctx.close()


def give_coach_apple(page):
    """Le coach factice a un identifiant Apple (compte seulement Apple, comme celui de Maxence)."""
    page.evaluate("""sub => { const u = __sb.users[__coachId]; u.identities.push({ identity_id: 'idt-apple-coach', provider: 'apple', id: sub,
      identity_data: { sub }, created_at: u.created_at }); window.__appleSub = sub;
      const f = sb.auth.signInWithIdToken; window.__idt = []; sb.auth.signInWithIdToken = a => { window.__idt.push(a); return f(a); }; }""", APPLE_SUB)


def apple_journeys(browser, url, engine):
    """Se connecter avec Apple : faux Apple JS (tests/coach_web_fixtures.py), nonce, refus, annulation, sans le script."""
    ctx, page = open_desk(browser, url, width=1440, login=False)
    page.wait_for_selector('#apple-signin:not([disabled])')
    btn = page.locator('#apple-signin').bounding_box()
    form = page.locator('#login-email').bounding_box()
    check(btn['y'] < form['y'], 'Apple : bouton au-dessus de l\'e-mail')
    check(btn['height'] >= 44, 'Apple : bouton de 44 px au moins')
    check(page.locator('#apple-signin').inner_text().strip() == 'Se connecter avec Apple', 'Apple : libellé')
    check('Choisis le même bouton que dans' in page.inner_text('.login-card'), 'Apple : texte sous le formulaire')
    give_coach_apple(page)
    init = page.evaluate('window.__appleInit')
    origin = url.split('/coach-web/')[0]
    check(init['clientId'] == 'com.mdlf.training.coach' and init['usePopup'] is True and init['redirectURI'] == origin + '/', f'Apple : init {init}')
    page.click('#apple-signin')
    page.wait_for_selector('.lst a.row')
    idt = page.evaluate('window.__idt')
    check(len(idt) == 1 and idt[0]['provider'] == 'apple', f'Apple : échange {idt}')
    raw = idt[0]['nonce']
    token_nonce = json.loads(base64.b64decode(idt[0]['token'].split('.')[1] + '==='))['nonce']
    check(hashlib.sha256(raw.encode()).hexdigest() == token_nonce == init['nonce'], 'Apple : Apple a le SHA-256, Supabase le nonce brut')
    check(page.locator('.lst a.row').count() == 10, 'Apple : tableau de bord du coach')
    check(not page.evaluate('window.__csp'), f'Apple : CSP {page.evaluate("window.__csp")}')
    check(not page.errors, f'Apple : erreurs {page.errors}')
    ctx.close()

    # Fenêtre d'Apple fermée (ou erreur d'Apple, Services ID pas configuré) : message clair, l'e-mail reste
    ctx, page = open_desk(browser, url, width=1440, login=False)
    page.wait_for_selector('#apple-signin:not([disabled])')
    page.evaluate("window.__appleFail = 'popup_closed_by_user'")
    page.click('#apple-signin')
    page.wait_for_selector('#login-err:not(:empty)')
    check('Connexion avec Apple annulée' in page.inner_text('#login-err'), 'Apple : annulation')
    page.wait_for_selector('#apple-signin:not([disabled])')
    # Services ID absent de external_apple_client_id : refus de Supabase
    page.evaluate("""() => { window.__appleFail = null; sb.auth.signInWithIdToken = async () => ({ data: {}, error: { name: 'AuthApiError', status: 400, message: 'Unacceptable audience in id_token: [com.mdlf.training.coach]' } }); }""")
    page.click('#apple-signin')
    page.wait_for_function("document.getElementById('login-err').innerText.includes('pas encore ouverte sur ce site')")
    check(page.locator('#login-email').is_visible(), 'Apple : e-mail toujours là')
    ctx.close()

    # Identifiant Apple inconnu de MDLF : jamais le tableau de bord
    ctx, page = open_desk(browser, url, width=1440, login=False)
    page.wait_for_selector('#apple-signin:not([disabled])')
    page.evaluate("window.__appleSub = '009999.autreidentifiant.0002'")
    page.click('#apple-signin')
    page.wait_for_selector('text=Réservé aux coachs')
    check('pas encore de compte MDLF' in page.inner_text('.login-card'), 'Apple : identifiant inconnu')
    check(page.locator('.lst').count() == 0, 'Apple : identifiant inconnu, aucune liste')
    ctx.close()

    # Script d'Apple injoignable (bloqueur, réseau) : pas de bouton, l'e-mail marche
    ctx, page = open_desk(browser, url, width=1440, login=False, apple='blocked')
    page.wait_for_function("!document.getElementById('apple-signin') && document.querySelector('.note').innerText.includes('pas pu se charger')")
    check(page.locator('.or').count() == 1 and page.locator('#google-signin').count() == 1, 'sans Apple : Google, puis « ou » et l\'e-mail')
    page.fill('#login-email', COACH_EMAIL)
    page.click('form[data-form=email] button')
    page.fill('#login-code', FAKE_CODE)
    page.click('form[data-form=code] button')
    page.wait_for_selector('.lst a.row')
    check(not page.evaluate('window.__csp'), 'sans Apple : CSP')
    check(not [e for e in page.errors if 'Failed to load resource' not in e and 'appleid' not in e], f'sans Apple : erreurs {page.errors}')
    ctx.close()


def built_page(browser, url):
    """Version construite (dist-coach/, scripts/build-coach-web.mjs) avec le VRAI supabase-js : la page de connexion
    s'ouvre sans erreur ni blocage de la CSP. Aucune session : aucun appel réseau vers Supabase."""
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    route_apple(ctx)
    page = ctx.new_page()
    errors, outside = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('request', lambda r: outside.append(r.url) if not r.url.startswith(url.split('/coach-web/')[0]) and not r.url.startswith('https://appleid.cdn-apple.com/') else None)
    page.add_init_script("window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.effectiveDirective));")
    page.goto(url.replace('/coach-web/', '/dist-coach/'))
    page.wait_for_selector('#apple-signin:not([disabled])')
    check(page.evaluate('typeof supabase.createClient') == 'function', 'version construite : supabase-js absent')
    check(not errors and not page.evaluate('window.__csp'), f'version construite : erreurs {errors} {page.evaluate("window.__csp")}')
    check(not outside, f'version construite : requêtes hors du site {outside}')
    ctx.close()


def main():
    subprocess.run(['node', os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts', 'build-coach-web.mjs')], check=True)
    done = 0
    with sync_playwright() as pw, static_server() as url:
        for engine in ENGINES:
            browser = launch(pw, engine)
            try:
                for w, h, touch in SIZES:
                    for theme in ('dark', 'light'):
                        matrix_case(browser, url, engine, w, h, touch, theme)
                        done += 1
                        print(f'  ok    {engine} {w}px {theme}', flush=True)
                journeys(browser, url, engine)
                apple_journeys(browser, url, engine)
                built_page(browser, url)
                print(f'  ok    {engine} : clavier, segments, invitation, un appel, repli, refus, déconnexion, Apple', flush=True)
            finally:
                browser.close()
    print(f'\nAppli web du coach : {done} combinaisons et {len(ENGINES)} parcours OK')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
