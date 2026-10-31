"""Réglages › Notifications (app iOS simulée) : tout éteint au départ, fenêtre d'iOS seulement au toucher
d'un interrupteur, jeton inscrit puis retiré quand tout est éteint ou à la déconnexion, refus d'iOS expliqué
avec un lien vers Réglages, groupe atténué ; absent de la PWA et sans compte ; toucher d'une notification
qui ouvre le bon écran. Sommeil de Santé sur l'accueil (une ligne, seulement avec une nuit aujourd'hui).

L'app iOS et Supabase sont simulés (tests/fake_account.py) : aucune requête ne sort, jetons faux.
Captures : $PPL_SCRATCH/shots/lotnotifications/ (clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_notifications.py (ou run_all.py notifications).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'notifications'
R = Results(LOT)
FAKE_TOKEN = 'ab' * 32


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, ppl_v2=None, opts=None):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True, **(opts or {})}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2, extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username='max'):
    page.evaluate("""async (u) => {
        await accountSignInWith('apple', async () => 'add');
        if (u) await accountSaveProfile({ username: u });
    }""", username)
    page.wait_for_timeout(300)


def push_calls(page):
    return page.evaluate("__sb.calls.filter(c => c[0] === 'push').map(c => c.slice(1).join(' '))")


def switches(page):
    return page.evaluate("""[...document.querySelectorAll('[data-action="push-toggle"]')]
        .map(b => [b.dataset.kind, b.getAttribute('aria-checked')])""")


def open_notifications(page):
    page.click('[data-action="go-settings"]')
    page.wait_for_selector('.settings-view')
    page.click('[data-action="push-open"]')
    page.wait_for_selector('.push-view [data-action="push-toggle"]')
    page.wait_for_timeout(200)


def t_reglages(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page)
        open_notifications(page)
        R.check(switches(page) == [['reactions', 'false'], ['follows', 'false'], ['coach', 'false']], f'{t} tout éteint au départ {switches(page)}')
        R.check(not any('request' in c or 'register' in c for c in push_calls(page)), f'{t} aucune fenêtre d\'iOS ni jeton sans toucher {push_calls(page)}')
        R.check('jamais le texte' in page.inner_text('.push-view'), f'{t} pied : ce que montre la notification')
        sizes = page.evaluate("[...document.querySelectorAll('[data-action=\"push-toggle\"]')].map(b => b.getBoundingClientRect().height)")
        R.check(all(h >= 44 for h in sizes), f'{t} cibles d\'au moins 44 pt {sizes}')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} pas de défilement horizontal')
        shot(page, LOT, f'notifications-eteintes-{t}')

        # iOS : rien ne bouge au pointerdown d'un interrupteur
        sw = page.locator('[data-kind="reactions"]')
        before = page.evaluate("document.querySelector('.push-view').outerHTML")
        sw.dispatch_event('pointerdown')
        page.wait_for_timeout(120)
        R.check(page.evaluate("document.querySelector('.push-view').outerHTML") == before, f'{t} rien ne change au pointerdown')
        sw.dispatch_event('pointerup')

        sw.click()
        page.wait_for_function("document.querySelector('[data-kind=\"reactions\"]').getAttribute('aria-checked') === 'true'")
        calls = push_calls(page)
        R.check(calls.index('request') < calls.index('register') < next(i for i, c in enumerate(calls) if c.startswith('push_set_prefs')),
                f'{t} ordre : fenêtre d\'iOS, jeton, réglage {calls}')
        R.check(page.evaluate('__sb.push.devices')[FAKE_TOKEN] is not None, f'{t} jeton inscrit pour le compte')
        page.locator('[data-kind="coach"]').click()
        page.wait_for_function("document.querySelector('[data-kind=\"coach\"]').getAttribute('aria-checked') === 'true'")
        R.check(push_calls(page).count('request') == 1, f'{t} fenêtre d\'iOS montrée une seule fois')
        shot(page, LOT, f'notifications-allumees-{t}')

        # Tout éteint : le jeton quitte le compte
        page.locator('[data-kind="reactions"]').click()
        page.wait_for_function("document.querySelector('[data-kind=\"reactions\"]').getAttribute('aria-checked') === 'false'")
        page.locator('[data-kind="coach"]').click()
        page.wait_for_function("document.querySelector('[data-kind=\"coach\"]').getAttribute('aria-checked') === 'false'")
        page.wait_for_timeout(200)
        R.check(page.evaluate('__sb.push.devices') == {}, f'{t} tout éteint : jeton retiré {page.evaluate("__sb.push.devices")}')

        # Rallumé puis déconnexion : jeton retiré avant la fin de session
        page.locator('[data-kind="follows"]').click()
        page.wait_for_function("document.querySelector('[data-kind=\"follows\"]').getAttribute('aria-checked') === 'true'")
        page.evaluate('accountSignOut()')
        page.wait_for_timeout(400)
        R.check(page.evaluate('__sb.push.devices') == {}, f'{t} déconnexion : jeton retiré')
        R.check(page.evaluate("localStorage.getItem('mdlf_push')") is None, f'{t} déconnexion : rien gardé sur l\'iPhone')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_refus(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), {'push': {'answer': 'denied'}})
        signin(page)
        open_notifications(page)
        page.locator('[data-kind="follows"]').click()
        page.wait_for_selector('.ios-dialog')
        R.check('Notifications refusées' in page.inner_text('.ios-dialog'), f'{t} refus : explication')
        R.check(not any(c.startswith('push_set_prefs') or c.startswith('push_register') for c in push_calls(page)), f'{t} refus : rien sur le serveur')
        page.click('.ios-dialog >> text=Ouvrir Réglages')
        page.wait_for_timeout(200)
        R.check('openSettings' in push_calls(page), f'{t} lien vers les Réglages de l\'iPhone')
        page.wait_for_timeout(200)
        R.check(page.locator('[data-action="push-open-ios-settings"]').count() == 1, f'{t} ligne « coupées sur l\'iPhone »')
        R.check(page.locator('.group--disabled').count() == 1, f'{t} interrupteurs atténués')
        R.check(all(v == 'false' for _, v in switches(page)), f'{t} interrupteurs éteints {switches(page)}')
        shot(page, LOT, f'notifications-refusees-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_absent(bench, eng, dev, theme):
    t = tag(dev, theme)
    # Navigateur : aucune trace
    with bench.page(eng, dev, theme) as page:
        page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
        seed(page, theme, ppl_v2_today_json())
        page.click('[data-action="go-settings"]')
        page.wait_for_selector('.settings-view')
        R.check(page.locator('[data-action="push-open"]').count() == 0, f'{t} PWA : pas de cellule Notifications')
        R.check(not page.errors, f'{t} PWA : aucune erreur JS {page.errors}')
    # App iOS sans compte : pas de cellule, aucun appel
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        page.click('[data-action="go-settings"]')
        page.wait_for_selector('.settings-view')
        R.check(page.locator('[data-action="push-open"]').count() == 0, f'{t} sans compte : pas de cellule')
        R.check(push_calls(page) == [], f'{t} sans compte : aucun appel {push_calls(page)}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_toucher(bench, eng, dev, theme):
    t = tag(dev, theme)
    if dev != 'iPhone 13':
        return
    with bench.page(eng, dev, theme) as page:
        data = json.loads(ppl_v2_today_json())
        sid = data['history'][0]['id']
        open_app(page, theme, json.dumps(data))
        signin(page)
        page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': 'reaction', 'ref': sid})
        page.wait_for_timeout(400)
        R.check(page.evaluate('nav.tab') == 'history' and page.evaluate('currentView()') == 'history-detail', f'{t} bravo → la séance ({page.evaluate("currentView()")})')
        page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': 'follow_request', 'ref': ''})
        page.wait_for_timeout(400)
        R.check(page.evaluate('nav.tab') == 'friends', f'{t} demande → onglet Amis')
        page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': 'pub', 'ref': 'x'})
        page.wait_for_timeout(200)
        R.check(page.evaluate('nav.tab') == 'friends', f'{t} type inconnu : rien ne bouge')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_sommeil(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        lt = time.localtime()
        bed = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)) * 1000) - 3600_000   # hier 23 h
        data = json.loads(ppl_v2_today_json())
        data['healthOn'] = True
        open_app(page, theme, json.dumps(data))
        page.evaluate("""([bed]) => {
            Native.health.requestStatus = async () => 'unnecessary';
            Native.health.sleep = async () => [{ start: bed, end: bed + 7.25 * 3600e3, stage: 'core' }];
            Native.health.workouts = async () => []; Native.health.bodyMass = async () => [];
            resetWorkoutsAuth(); render();
        }""", [bed])
        page.wait_for_timeout(500)
        line = page.locator('#heroSleep')
        R.check(line.count() == 1 and 'Cette nuit' in line.inner_text() and '7' in line.inner_text(), f'{t} accueil : ligne du sommeil ({line.inner_text() if line.count() else "absente"})')
        R.check(page.evaluate("getComputedStyle(document.querySelector('#heroSleep .icon')).display") != 'none', f'{t} icône lune affichée')
        shot(page, LOT, f'accueil-sommeil-{t}')
        # Pas de nuit aujourd'hui : rien
        page.evaluate("Native.health.sleep = async () => []; sleepCache = { at: 0, samples: [], failedAt: 0 }; render()")
        page.wait_for_timeout(400)
        R.check(page.locator('#heroSleep').count() == 0, f'{t} sans nuit : pas de ligne')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_reglages, t_refus, t_absent, t_toucher, t_sommeil])
