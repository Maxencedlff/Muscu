"""Réglages › Notifications (app iOS simulée) : tout éteint au départ, fenêtre d'iOS seulement au toucher
d'un interrupteur, jeton inscrit puis retiré quand tout est éteint ou à la déconnexion, refus d'iOS expliqué
avec un lien vers Réglages, groupe atténué ; réinstallation (réglages du compte allumés, iOS sans accord) :
ligne « Réactiver sur cet iPhone » ; session finie hors de l'app puis autre compte : jeton de l'ancien retiré ; absent de la PWA et sans compte ; toucher d'une notification
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
        R.check(switches(page) == [['reactions', 'false'], ['comments', 'false'], ['follows', 'false'], ['coach', 'false'], ['messages', 'false']], f'{t} tout éteint au départ {switches(page)}')
        R.check(not any('request' in c or 'register' in c for c in push_calls(page)), f'{t} aucune fenêtre d\'iOS ni jeton sans toucher {push_calls(page)}')
        R.check("jamais le texte d'un commentaire ou d'un message" in page.inner_text('.push-view'), f'{t} pied : ce que montre la notification')
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
        page.locator('[data-kind="messages"]').click()
        page.wait_for_function("document.querySelector('[data-kind=\"messages\"]').getAttribute('aria-checked') === 'true'")
        R.check(page.evaluate('__sb.push.prefs[__sb.meId()].messages') is True, f'{t} messages allumés sur le compte')
        shot(page, LOT, f'notifications-allumees-{t}')
        page.locator('[data-kind="messages"]').click()
        page.wait_for_function("document.querySelector('[data-kind=\"messages\"]').getAttribute('aria-checked') === 'false'")

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


def t_reactiver(bench, eng, dev, theme):
    # App réinstallée (ou nouvel iPhone) : réglages allumés sur le compte, iOS n'a encore rien accordé ici
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page)
        page.evaluate("__sb.push.prefs[__sb.meId()] = { reactions: true, follows: false, coach: true, comments: false, messages: true }; pushLoad()")
        page.wait_for_timeout(200)
        page.click('[data-action="go-settings"]')
        page.wait_for_selector('.settings-view')
        cell = page.inner_text('[data-action="push-open"]')
        R.check('À réactiver' in cell, f'{t} cellule : à réactiver ({cell!r})')
        page.click('[data-action="push-open"]')
        page.wait_for_selector('[data-action="push-reactivate"]')
        page.wait_for_timeout(200)
        R.check(all(v == 'false' for _, v in switches(page)), f"{t} rien d'affiché allumé sans accord d'iOS {switches(page)}")
        R.check(not any(c in ('request', 'register') for c in push_calls(page)), f"{t} aucune fenêtre d'iOS sans toucher {push_calls(page)}")
        h = page.evaluate("document.querySelector('[data-action=\"push-reactivate\"]').getBoundingClientRect().height")
        R.check(h >= 44, f'{t} ligne réactiver : au moins 44 pt ({h})')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} pas de défilement horizontal')
        shot(page, LOT, f'notifications-a-reactiver-{t}')
        btn = page.locator('[data-action="push-reactivate"]')
        before = page.evaluate("document.querySelector('.push-view').outerHTML")
        btn.dispatch_event('pointerdown')
        page.wait_for_timeout(120)
        R.check(page.evaluate("document.querySelector('.push-view').outerHTML") == before, f'{t} rien ne change au pointerdown')
        btn.dispatch_event('pointerup')
        btn.click()
        page.wait_for_function("document.querySelector('[data-kind=\"coach\"]')?.getAttribute('aria-checked') === 'true'")
        R.check(switches(page) == [['reactions', 'true'], ['comments', 'false'], ['follows', 'false'], ['coach', 'true'], ['messages', 'true']], f'{t} réglages du compte retrouvés {switches(page)}')
        R.check(page.evaluate('__sb.push.devices').get(FAKE_TOKEN) == page.evaluate('__sb.meId()'), f'{t} jeton inscrit pour le compte')
        R.check(page.locator('[data-action="push-reactivate"]').count() == 0, f'{t} ligne réactiver partie')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_autre_compte(bench, eng, dev, theme):
    # Session de A finie hors de l'app (jeton refusé) : le jeton de A ne doit pas rester quand B se connecte,
    # ni quand sa connexion est annulée au choix de fusion
    t = tag(dev, theme)
    if dev != 'iPhone 13':
        return
    for choice in ('add', None):
        with bench.page(eng, dev, theme) as page:
            open_app(page, theme, ppl_v2_today_json())
            signin(page)
            open_notifications(page)
            page.locator('[data-kind="reactions"]').click()
            page.wait_for_function("document.querySelector('[data-kind=\"reactions\"]').getAttribute('aria-checked') === 'true'")
            a = page.evaluate('__sb.meId()')
            R.check(page.evaluate('__sb.push.devices').get(FAKE_TOKEN) == a, f'{t} jeton de A inscrit')
            page.evaluate('__sb.endSession()')
            page.wait_for_timeout(300)
            page.evaluate("async (c) => { __sb.appleUser = 'apple-sub-2'; await accountSignInWith('apple', async () => c); }", choice)
            page.wait_for_timeout(500)
            devices = page.evaluate('__sb.push.devices')
            label = 'B connecté' if choice else 'fusion annulée'
            R.check(FAKE_TOKEN not in devices, f'{t} {label} : jeton de A retiré {devices}')
            R.check(any(c.startswith('push_release') for c in push_calls(page)), f'{t} {label} : push_release {push_calls(page)}')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_ancien_serveur(bench, eng, dev, theme):
    # App à jour, serveur d'avant 20261031910000 (3 types) : les deux nouveaux interrupteurs n'apparaissent pas,
    # les trois d'avant marchent (push_set_prefs à 3 arguments)
    t = tag(dev, theme)
    if dev != 'iPhone 13':
        return
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), {'pushOldServer': True})
        signin(page)
        open_notifications(page)
        R.check(switches(page) == [['reactions', 'false'], ['follows', 'false'], ['coach', 'false']], f'{t} serveur d\'avant : 3 interrupteurs {switches(page)}')
        page.locator('[data-kind="follows"]').click()
        page.wait_for_function("document.querySelector('[data-kind=\"follows\"]').getAttribute('aria-checked') === 'true'")
        R.check(page.locator('.toast').count() == 0, f'{t} serveur d\'avant : pas de message d\'erreur')
        R.check(any(c.startswith('push_set_prefs') for c in push_calls(page)) and page.evaluate('__sb.push.prefs[__sb.meId()].follows') is True,
                f'{t} serveur d\'avant : réglage enregistré {push_calls(page)}')
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
        # App fermée : le toucher arrive avant que le compte soit chargé ; la clé vient du serveur
        page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': 'chat_message', 'ref': '@coach'})
        page.wait_for_function("() => currentRoute() === 'coach-chat:' + encodeURIComponent(CHAT_COACH)", timeout=3000)
        R.check(page.evaluate('nav.tab') == 'friends', f'{t} toucher avant le compte : conversation avec mon coach')
        signin(page)
        page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': 'reaction', 'ref': sid})
        page.wait_for_timeout(400)
        R.check(page.evaluate('nav.tab') == 'history' and page.evaluate('currentView()') == 'history-detail', f'{t} bravo → la séance ({page.evaluate("currentView()")})')
        page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': 'follow_request', 'ref': ''})
        page.wait_for_timeout(400)
        R.check(page.evaluate('nav.tab') == 'friends', f'{t} demande → onglet Amis')
        page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': 'comment', 'ref': sid})
        page.wait_for_timeout(400)
        R.check(page.evaluate('nav.tab') == 'history' and page.evaluate('currentView()') == 'history-detail', f'{t} commentaire → la séance ({page.evaluate("currentView()")})')
        coach_route = 'coach-chat:' + page.evaluate("encodeURIComponent(CHAT_COACH)")
        page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': 'chat_message', 'ref': '@coach'})
        page.wait_for_function("r => currentRoute() === r", arg=coach_route, timeout=3000)
        R.check(page.evaluate('nav.tab') == 'friends', f'{t} message du coach → la conversation ({page.evaluate("currentRoute()")})')
        other = '00000000-0000-0000-0000-0000000000b2'
        page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': 'chat_message', 'ref': other})
        page.wait_for_function("r => currentRoute() === r", arg='coach-chat:' + other, timeout=3000)
        R.check(page.evaluate('currentRoute()') == 'coach-chat:' + other, f'{t} message d\'un élève → sa conversation')
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


run_main(R, [t_reglages, t_refus, t_reactiver, t_autre_compte, t_ancien_serveur, t_absent, t_toucher, t_sommeil])
