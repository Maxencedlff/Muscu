"""Parrainage (app iOS simulée) : code d'un coach ou d'un ami saisi à la création du compte (lien sous le
pseudo) et dans Réglages › Compte, code inconnu ou inactif refusé avec un message clair, « Parrainé par
Lucas » ensuite, plus rien à saisir ; compte de plus de 30 jours : rien proposé ; hors ligne ; trop d'essais.

L'app iOS et Supabase sont simulés (tests/fake_account.py, règles de docs/PARRAINAGE.md) : aucune requête ne
sort. Captures : $PPL_SCRATCH/shots/lotparrainage/ (chaque écran, clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_parrainage.py (ou run_all.py parrainage).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
import fixtures
fixtures.REAL_ANIMATIONS = True   # vérifie des animations elles-mêmes : pas d'accélération (fixtures.FAST_ANIMATIONS)
from fake_account import FAKE_ACCOUNT

LOT = 'parrainage'
R = Results(LOT)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, old=False):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': old}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
    settle(page)


def signin(page, username='lea'):
    page.evaluate("""async u => { await accountSignInWith('apple', async () => 'add'); if (u) await accountSaveProfile({ username: u }); }""", username)
    settle(page)


def rcalls(page, fn):
    return page.evaluate('f => __sb.calls.filter(c => c[0] === "referral" && c[1] === f).map(c => JSON.parse(c[2]))', fn)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small_targets(page, sel):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled && !e.matches('.link-inline'))
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def cut_texts(page, root):
    return page.evaluate("""r => [...document.querySelectorAll(r + ' *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .visually-hidden') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""", root)


def layout(page, t, name, root):
    # Mesures après les transitions d'ouverture : en plein glissement, un bouton mesuré en cours d'échelle
    # passait sous 44 pt (instable sur le Duo paysage)
    page.wait_for_function("() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)", timeout=5000)
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page, f'{root} button')
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page, root)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')


def toast(page):
    return page.locator('.toast').inner_text() if page.locator('.toast').count() else ''


def type_code(page, code):
    page.fill('#authReferral', '')
    page.type('#authReferral', code)
    page.click('[data-role="referral"]')
    settle(page)


def t_nouveau_compte(bench, eng, dev, theme):
    """Compte tout neuf (Apple depuis l'écran Compte) : lien sous le pseudo, code inconnu, puis LUCAS."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        page.evaluate("navigate('account')")
        page.wait_for_selector('[data-action="auth-provider"][data-provider="apple"]')
        page.click('[data-action="auth-provider"][data-provider="apple"]')
        page.wait_for_selector('.auth__page--username')
        settle(page)
        link = page.locator('[data-action="auth-referral"]')
        R.check(link.count() == 1 and "Code d'un coach" in link.inner_text(), f'{t} pseudo d\'un compte neuf : lien vers le code')
        layout(page, t, 'pseudo avec lien', '.auth')
        shot(page, LOT, f'01-pseudo-lien-{t}')
        link.click()
        page.wait_for_selector('#authReferral')
        R.check(page.evaluate("document.querySelector('#authReferral').autocapitalize") == 'characters', f'{t} champ en majuscules')
        R.check(page.locator('[data-role="referral"]').is_disabled(), f'{t} Valider grisé sans code')
        type_code(page, 'lukas')
        err = page.inner_text('#authError')
        R.check('Code inconnu' in err, f'{t} code inconnu : message clair ({err!r})')
        R.check(page.get_attribute('#authReferral', 'aria-invalid') == 'true', f'{t} champ marqué invalide (VoiceOver)')
        layout(page, t, 'code inconnu', '.auth')
        shot(page, LOT, f'02-code-inconnu-{t}')
        type_code(page, 'vieux')
        R.check('Code inconnu' in page.inner_text('#authError'), f'{t} code inactif : refusé comme inconnu')
        type_code(page, ' lucas ')
        page.wait_for_selector('.auth__page--username')
        settle(page)
        done = page.locator('.auth__referral-done')
        R.check(done.count() == 1 and 'Parrainé par Lucas' in done.inner_text() and page.locator('[data-action="auth-referral"]').count() == 0,
                f'{t} retour au pseudo : « Parrainé par Lucas »')
        R.check(rcalls(page, 'referral_apply')[-1] == {'code': 'LUCAS'}, f'{t} code envoyé normalisé {rcalls(page, "referral_apply")}')
        shot(page, LOT, f'03-pseudo-parraine-{t}')
        page.click('[data-action="auth-later"]')
        settle(page)
        txt = page.inner_text('#app')
        R.check('Parrainé par Lucas' in txt and page.locator('[data-action="account-referral"]').count() == 0, f'{t} écran Compte : parrain affiché, plus de saisie')
        R.check(json.loads(ls(page, 'mdlf_referral'))['name'] == 'Lucas', f'{t} parrain gardé sur l\'appareil')
        layout(page, t, 'compte parrainé', '#app .scr')
        page.locator('.referral-cell').scroll_into_view_if_needed()
        shot(page, LOT, f'04-compte-parraine-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_reglages(bench, eng, dev, theme):
    """Réglages › Compte d'un compte de moins de 30 jours : saisie, fermeture, toast ; hors ligne ; trop d'essais."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        signin(page)
        page.evaluate("navigate('account')")
        page.wait_for_selector('[data-action="account-referral"]')
        settle(page)
        R.check(len(rcalls(page, 'referral_state')) == 1, f'{t} état lu une fois {rcalls(page, "referral_state")}')
        foot = page.locator('[data-action="account-referral"]').locator('xpath=../following-sibling::div[1]').inner_text()
        R.check('Jusqu' in foot, f'{t} date limite affichée ({foot!r})')
        page.locator('[data-action="account-referral"]').scroll_into_view_if_needed()
        shot(page, LOT, f'05-compte-saisir-{t}')
        page.click('[data-action="account-referral"]')
        page.wait_for_selector('#authReferral')
        settle(page)
        layout(page, t, 'étape du code', '.auth')
        shot(page, LOT, f'06-etape-code-{t}')
        # Hors ligne : message, saisie gardée
        page.evaluate('__sb.fail.referral = "offline"')
        type_code(page, 'LUCAS')
        R.check('Pas d' in page.inner_text('#authError') and page.input_value('#authReferral') == 'LUCAS', f'{t} hors ligne : message, saisie gardée')
        page.evaluate('__sb.fail.referral = null')
        page.click('[data-role="referral"]')
        settle(page)
        R.check(page.locator('.auth').count() == 0 or page.locator('.auth--out').count() == 1, f'{t} code valable : étape fermée')
        R.check('Parrainé par Lucas' in toast(page), f'{t} toast « Parrainé par Lucas » ({toast(page)!r})')
        settle(page)
        R.check('Parrainé par Lucas' in page.inner_text('#app') and page.locator('[data-action="account-referral"]').count() == 0, f'{t} Compte : parrain affiché')
        # Changer de parrain : impossible (serveur), et l'app ne le propose plus
        r = page.evaluate("referralApply('PAUL')")
        R.check(r == {'ok': False, 'kind': 'already_referred'}, f'{t} autre code ensuite refusé {r}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    # Trop d'essais : message après 10 codes faux
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        signin(page)
        page.evaluate("navigate('account')")
        page.wait_for_selector('[data-action="account-referral"]')
        page.click('[data-action="account-referral"]')
        page.wait_for_selector('#authReferral')
        for i in range(10):
            page.evaluate(f"referralApply('FAUX{i}')")
        type_code(page, 'LUCAS')
        R.check('Trop d' in page.inner_text('#authError'), f'{t} 11e essai : trop d\'essais')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_vieux_compte(bench, eng, dev, theme):
    """Compte de plus de 30 jours : rien proposé dans Compte ; sans compte : aucun appel."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, old=True)
        signin(page)
        page.evaluate("navigate('account')")
        page.wait_for_selector('.account-view')
        settle(page)
        R.check(page.locator('[data-action="account-referral"]').count() == 0 and 'Parrainé' not in page.inner_text('#app'), f'{t} compte ancien : rien proposé')
        R.check(not rcalls(page, 'referral_apply'), f'{t} compte ancien : aucune saisie envoyée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        page.evaluate("navigate('account')")
        page.wait_for_selector('.account-view--out')
        settle(page)
        R.check(page.evaluate("__sb.calls.filter(c => c[0] === 'referral').length") == 0, f'{t} sans compte : aucun appel')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_nouveau_compte, t_reglages, t_vieux_compte])
