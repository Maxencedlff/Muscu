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
        page.wait_for_function("() => nav.tab === 'history' && currentView() === 'history-detail'", timeout=3000)
        R.check(page.evaluate('nav.tab') == 'history' and page.evaluate('currentView()') == 'history-detail', f'{t} bravo → la séance ({page.evaluate("currentView()")})')
        page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': 'follow_request', 'ref': ''})
        page.wait_for_function("() => nav.tab === 'friends'", timeout=3000)
        R.check(page.evaluate('nav.tab') == 'friends', f'{t} demande → onglet Social')
        page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': 'comment', 'ref': sid})
        page.wait_for_function("() => nav.tab === 'history' && currentView() === 'history-detail'", timeout=3000)
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


def o_coach_segment(bench):
    """Compte coach : un bravo ou un commentaire touché ouvre la séance, puis l'onglet Coach s'ouvre sur Social (là où
    est l'activité) ; un message d'élève, sur Élèves."""
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        data = json.loads(ppl_v2_today_json())
        sid = data['history'][0]['id']
        open_app(page, 'dark', json.dumps(data))
        signin(page)
        page.evaluate("async () => { const me = __sb.meId(); __sb.makeCoach(me); const s = __sb.addPerson({ username: 'zoe', social: false }); __sb.link(me, s); await coachRefresh(); }")
        page.wait_for_timeout(300)
        segs = {}
        for kind, ref in (('reaction', sid), ('comment', sid), ('chat_message', '00000000-0000-0000-0000-0000000000b2')):
            page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': kind, 'ref': ref})
            page.wait_for_timeout(400)
            segs[kind] = page.evaluate('friendsSeg()')
        R.check(segs == {'reaction': 'friends', 'comment': 'friends', 'chat_message': 'students'}, f'coach : bravo et commentaire → Social, message → Élèves {segs}')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')


# ── Demande en contexte (coach ↔ élève) : feuille d'iOS, une fois, jamais au premier lancement ──

def with_coach(page):
    """Je suis l'élève de coachmax (lien déjà là)."""
    page.evaluate("""async () => { const c = __sb.addPerson({ username: 'coachmax', social: false }); __sb.makeCoach(c); __sb.link(c, __sb.meId()); await coachRefresh(); }""")


def open_chat(page, key='@coach'):
    page.evaluate("k => { switchTab('friends', { reset: true }); navigate(makeRoute('coach-chat', k === '@coach' ? CHAT_COACH : k)); }", key)
    page.wait_for_selector('.coach-chat-view')
    page.wait_for_timeout(500)


def leave_chat(page):
    page.evaluate("switchTab('train', { reset: true })")
    page.wait_for_timeout(200)


def ask_sheet(page):
    d = page.locator('.ios-dialog--sheet')
    return d.inner_text() if d.count() else ''


def t_demande_eleve(bench, eng, dev, theme):
    """Élève, première ouverture de la conversation : feuille sobre, « Activer » → iOS, jeton, messages + coach + commentaires."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), {'pushAsk': True})
        signin(page)
        R.check(not any(c in ('request', 'register') for c in push_calls(page)), f'{t} rien demandé au lancement {push_calls(page)}')
        with_coach(page)
        open_chat(page)
        page.wait_for_selector('.ios-dialog--sheet', timeout=3000)
        txt = ask_sheet(page)
        R.check('Être prévenu quand ton coach t’écrit ?' in txt and 'jamais le texte' in txt, f'{t} feuille : la question et ce que montre la notification ({txt!r})')
        btns = page.evaluate("[...document.querySelectorAll('.ios-dialog__btn')].map(b => [b.textContent.trim(), Math.round(b.getBoundingClientRect().height)])")
        R.check([b[0] for b in btns] == ['Activer', 'Plus tard'] and all(h >= 44 for _, h in btns), f'{t} « Activer » et « Plus tard », 44 pt {btns}')
        R.check(page.evaluate("document.querySelector('.ios-dialog').getAttribute('role') === 'dialog' && !!document.querySelector('.ios-dialog').getAttribute('aria-labelledby')"),
                f'{t} VoiceOver : feuille nommée par sa question')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} pas de défilement horizontal')
        shot(page, LOT, f'demande-eleve-{t}')
        R.check(not any(c in ('request', 'register') for c in push_calls(page)), f'{t} fenêtre d\'iOS seulement après « Activer »')
        tap_dialog(page, 'Activer')
        page.wait_for_function("() => (__sb.push.prefs[__sb.meId()] || {}).messages === true", timeout=3000)
        calls = push_calls(page)
        R.check(calls.index('request') < calls.index('register') < next(i for i, c in enumerate(calls) if c.startswith('push_set_prefs')), f'{t} ordre : iOS, jeton, réglages {calls}')
        prefs = page.evaluate('__sb.push.prefs[__sb.meId()]')
        R.check(prefs == {'reactions': False, 'follows': False, 'coach': True, 'comments': True, 'messages': True, 'student_sessions': False}, f'{t} messages, coach et commentaires ; le reste inchangé {prefs}')
        R.check(page.evaluate('__sb.push.devices')[FAKE_TOKEN] is not None, f'{t} appareil inscrit')
        R.check(page.locator('.chat-push-off').count() == 0, f'{t} accordé : pas de ligne « désactivées »')
        leave_chat(page)
        open_chat(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 0, f'{t} plus jamais redemandé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_demande_refusee(bench, eng, dev, theme):
    """Refus d'iOS : rien sur le serveur, la conversation montre « Notifications désactivées · Réglages »."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), {'pushAsk': True, 'push': {'answer': 'denied'}})
        signin(page)
        with_coach(page)
        open_chat(page)
        page.wait_for_selector('.ios-dialog--sheet', timeout=3000)
        tap_dialog(page, 'Activer')
        page.wait_for_selector('.chat-push-off', timeout=3000)
        R.check(not any(c.startswith('push_set_prefs') or c.startswith('push_register') for c in push_calls(page)), f'{t} refus : rien sur le serveur {push_calls(page)}')
        line = page.locator('.chat-push-off')
        R.check(line.inner_text().strip() == 'Notifications désactivées · Réglages', f'{t} ligne discrète ({line.inner_text()!r})')
        box = line.bounding_box()
        R.check(box and box['height'] >= 44, f'{t} ligne : 44 pt de cible')
        R.check(page.locator('.ios-dialog').count() == 0, f'{t} pas d\'alerte en plus après le refus')
        shot(page, LOT, f'conversation-notifs-desactivees-{t}')
        line.click()
        page.wait_for_timeout(200)
        R.check('openSettings' in push_calls(page), f'{t} ouvre les Réglages de l\'iPhone')
        # Réglages ouverts mais sans réponse (build sans le module) : Réglages › Notifications de l'app
        page.evaluate("Native.push.openSettings = async () => false")
        line.click()
        page.wait_for_selector('.push-view', timeout=3000)
        R.check(page.evaluate('currentView()') == 'notifications', f'{t} repli : Réglages › Notifications')
        # Rallumées dans iOS puis retour dans l'app : la ligne disparaît
        page.evaluate("__sb.push.permission = 'granted'")
        open_chat(page)
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_timeout(300)
        R.check(page.locator('.chat-push-off').count() == 0, f'{t} autorisées de nouveau : plus de ligne')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def o_demande_plus_tard(bench):
    """« Plus tard » : pas avant 7 jours, 2 fois au plus ; déjà refusé dans iOS : jamais de feuille."""
    with bench.page('webkit', 'iPhone 13', 'light') as page:
        open_app(page, 'light', ppl_v2_today_json(), {'pushAsk': True})
        signin(page)
        with_coach(page)
        open_chat(page)
        page.wait_for_selector('.ios-dialog--sheet', timeout=3000)
        tap_dialog(page, 'Plus tard')
        R.check(not any(c in ('request', 'register') or c.startswith('push_set_prefs') for c in push_calls(page)), f'« Plus tard » : rien demandé {push_calls(page)}')
        R.check(page.evaluate("JSON.parse(localStorage.getItem('mdlf_push_ask')).n") == 1, '« Plus tard » noté')
        leave_chat(page); open_chat(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 0, 'pas redemandé avant 7 jours')
        page.evaluate("const s = JSON.parse(localStorage.getItem('mdlf_push_ask')); s.at -= 8 * 86400e3; localStorage.setItem('mdlf_push_ask', JSON.stringify(s))")
        leave_chat(page); open_chat(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 1, 'redemandé après 7 jours')
        tap_dialog(page, 'Plus tard')
        page.evaluate("const s = JSON.parse(localStorage.getItem('mdlf_push_ask')); s.at -= 8 * 86400e3; localStorage.setItem('mdlf_push_ask', JSON.stringify(s))")
        leave_chat(page); open_chat(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 0, 'jamais plus de 2 fois')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        open_app(page, 'dark', ppl_v2_today_json(), {'pushAsk': True, 'push': {'permission': 'denied'}})
        signin(page)
        with_coach(page)
        open_chat(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 0, 'déjà refusé dans iOS : pas de feuille')
        R.check(page.locator('.chat-push-off').count() == 1, 'déjà refusé : la ligne vers Réglages')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')


def o_demande_premier_lancement(bench):
    """Premier lancement (aucune séance, questions de départ pas répondues) : jamais de feuille."""
    with bench.page('webkit', 'iPhone 13', 'light') as page:
        open_app(page, 'light', None, {'pushAsk': True})
        R.check(page.evaluate('PUSH_ASK_FIRST_LAUNCH') is True, 'premier lancement reconnu')
        signin(page)
        R.check(page.evaluate("pushAskCheck('student')") == 'skip', 'premier lancement : rien à demander')
        R.check(not any(c in ('request', 'register') for c in push_calls(page)), f'aucune fenêtre d\'iOS {push_calls(page)}')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')


def o_demande_coach(bench):
    """Coach : Mes élèves avec un premier élève → « …quand un élève t'écrit ? » ; « Activer » allume messages et coach."""
    for theme in ('light', 'dark'):
        with bench.page('webkit', 'iPhone 13', theme) as page:
            open_app(page, theme, ppl_v2_today_json(), {'pushAsk': True})
            signin(page)
            page.evaluate("async () => { const me = __sb.meId(); __sb.makeCoach(me); await coachRefresh(); }")
            page.evaluate("switchTab('friends', { reset: true }); navigate('coach-students')")
            page.wait_for_timeout(700)
            R.check(page.locator('.ios-dialog--sheet').count() == 0, f'{theme} aucun élève : pas de feuille')
            page.evaluate("async () => { const me = __sb.meId(); const s = __sb.addPerson({ username: 'zoe', social: false }); __sb.link(me, s); }")
            page.evaluate("switchTab('train', { reset: true })"); page.wait_for_timeout(150)
            page.evaluate("switchTab('friends', { reset: true }); navigate('coach-students')")
            page.wait_for_selector('.ios-dialog--sheet', timeout=3000)
            txt = ask_sheet(page)
            R.check('Être prévenu quand un élève t’écrit ou termine une séance ?' in txt and 'jamais' in txt and 'charges' in txt, f'{theme} coach : la question ({txt!r})')
            shot(page, LOT, f'demande-coach-iPhone_13-{theme}')
            tap_dialog(page, 'Activer')
            page.wait_for_function("() => (__sb.push.prefs[__sb.meId()] || {}).messages === true", timeout=3000)
            prefs = page.evaluate('__sb.push.prefs[__sb.meId()]')
            R.check(prefs == {'reactions': False, 'follows': False, 'coach': True, 'comments': False, 'messages': True, 'student_sessions': True},
                    f'{theme} coach : messages, coach et séances des élèves {prefs}')
            # Réglages › Notifications : l'interrupteur des séances des élèves, montré au coach, allumé
            page.evaluate("switchTab('train', { reset: true }); navigate('notifications')")
            page.wait_for_selector('.push-view [data-kind="student_sessions"]')
            R.check(page.get_attribute('[data-kind="student_sessions"]', 'aria-checked') == 'true', f'{theme} interrupteur « Séances de mes élèves » allumé')
            R.check(not page.errors, f'{theme} aucune erreur JS {page.errors}')


def o_demande_lien_accepte(bench):
    """Élève qui accepte le lien d'un coach : après « C'est fait ! », la feuille de notifications."""
    with bench.page('webkit', 'iPhone 13', 'light') as page:
        open_app(page, 'light', ppl_v2_today_json(), {'pushAsk': True})
        signin(page, 'lea')
        page.evaluate("""async () => { const c = __sb.addPerson({ username: 'max', social: false }); __sb.makeCoach(c);
            __sb.co.invites.push({ code: 'K7M2QX9P', coach: c, expires: Date.now() + 7 * 86400000 });
            await coachPreview('K7M2QX9P'); socialAgeOk = true; switchTab('friends', { reset: true }); navigate(makeRoute('coach-join', 'K7M2QX9P')); }""")
        page.wait_for_selector('[data-action="coach-accept"]:not([disabled])')
        page.click('[data-action="coach-accept"]')
        page.wait_for_selector('.ios-dialog', timeout=3000)
        R.check("C'est fait" in page.inner_text('.ios-dialog'), 'message de bienvenue d\'abord')
        tap_dialog(page, 'OK')
        page.wait_for_selector('.ios-dialog--sheet', timeout=3000)
        R.check('quand ton coach t’écrit' in ask_sheet(page), f'puis la feuille ({ask_sheet(page)!r})')
        tap_dialog(page, 'Plus tard')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')


def o_toucher_seance_eleve(bench):
    """Coach : toucher « zoe a terminé Push » ouvre la fiche de zoe puis la séance (retour : la fiche)."""
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        open_app(page, 'dark', ppl_v2_today_json())
        signin(page)
        sid = page.evaluate("""async () => { const me = __sb.meId(); __sb.makeCoach(me);
            const s = __sb.addPerson({ username: 'zoe', social: false, sessions: [{ id: 'z-1', date: Date.now() - 600e3, label: 'Push', exercises: [] }] });
            __sb.link(me, s); await coachRefresh(); return s; }""")
        page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': 'student_session', 'ref': f'{sid}/z-1'})
        page.wait_for_function("r => currentRoute() === r", arg=f'coach-session:{sid}:z-1', timeout=3000)
        page.wait_for_timeout(500)
        R.check(page.evaluate('nav.tab') == 'friends' and page.evaluate('friendsSeg()') == 'students', 'séance d\'élève : onglet Coach, segment Élèves')
        R.check(page.locator('.coach-session-view').count() == 1 and 'plus disponible' not in page.inner_text('.coach-session-view'), f'la séance de zoe s\'affiche ({page.inner_text(".coach-session-view")[:80]!r})')
        st = page.evaluate('nav.stacks[nav.tab]')
        R.check(len(st) >= 2 and st[-2] == f'coach-student:{sid}', f'retour : la fiche de zoe {st}')
        page.evaluate("p => __sb.push.listeners.tap(p)", {'kind': 'student_session', 'ref': sid})
        page.wait_for_function("r => currentRoute() === r", arg=f'coach-student:{sid}', timeout=3000)
        R.check(True, 'id de l\'élève seul : sa fiche')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')


# ── Rappel à l'ouverture « Notifications désactivées » (testeurs sans notifications) ──

def remind(page):
    """Ouverture de l'app simulée (le compte est connecté après le démarrage dans ces tests)."""
    page.evaluate("async () => { pushRemindTried = false; await pushRemindAtLaunch({ delay: 0 }); }")
    page.wait_for_timeout(300)


def remind_state(page):
    return page.evaluate("JSON.parse(localStorage.getItem('mdlf_push_remind') || '{}')")


def age_remind(page, days=8):
    page.evaluate("d => { const s = JSON.parse(localStorage.getItem('mdlf_push_remind')); s.at -= d * 86400e3; localStorage.setItem('mdlf_push_remind', JSON.stringify(s)); }", days)


def t_rappel(bench, eng, dev, theme):
    """Élève d'un coach, notifications jamais demandées : feuille sobre à l'ouverture, « Activer » → iOS, jeton, types du coach."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), {'pushRemind': True})
        signin(page)
        with_coach(page)
        remind(page)
        page.wait_for_selector('.ios-dialog--sheet', timeout=3000)
        txt = ask_sheet(page)
        R.check('Notifications désactivées' in txt and 'Tu ne reçois pas les messages et les programmes de ton coach.' in txt, f'{t} titre et phrase de l\'élève ({txt!r})')
        R.check('!' not in txt and 'Réglages ›' not in txt, f'{t} sobre, sans chemin des Réglages tant qu\'iOS n\'a pas refusé')
        btns = page.evaluate("[...document.querySelectorAll('.ios-dialog__btn')].map(b => [b.textContent.trim(), Math.round(b.getBoundingClientRect().height)])")
        R.check([b[0] for b in btns] == ['Activer', 'Plus tard'] and all(h >= 44 for _, h in btns), f'{t} « Activer » et « Plus tard », 44 pt {btns}')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} pas de défilement horizontal')
        shot(page, LOT, f'rappel-eleve-{t}')
        R.check(remind_state(page).get('n') == 1, f'{t} compté une fois {remind_state(page)}')
        R.check(not any(c in ('request', 'register') for c in push_calls(page)), f'{t} fenêtre d\'iOS seulement après « Activer »')
        tap_dialog(page, 'Activer')
        page.wait_for_function("() => (__sb.push.prefs[__sb.meId()] || {}).messages === true", timeout=3000)
        prefs = page.evaluate('__sb.push.prefs[__sb.meId()]')
        R.check(prefs == {'reactions': False, 'follows': False, 'coach': True, 'comments': True, 'messages': True, 'student_sessions': False}, f'{t} messages, coach et commentaires {prefs}')
        R.check(remind_state(page).get('done') is True, f'{t} plus jamais rappelé')
        remind(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 0, f'{t} activées : rien à l\'ouverture suivante')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def o_rappel_regles(bench):
    """« Plus tard » : 7 jours, 3 fois au plus ; reçoit déjà : rien ; séance ou autre feuille : rien ; une demande à la fois."""
    with bench.page('webkit', 'iPhone 13', 'light') as page:
        open_app(page, 'light', ppl_v2_today_json(), {'pushRemind': True, 'pushAsk': True})
        signin(page)
        with_coach(page)
        # Autre feuille ouverte (ici une alerte) : pas de rappel, rien compté
        page.evaluate("dialog({ title: 'Autre', actions: [{ label: 'OK', style: 'preferred' }] })")
        remind(page)
        R.check(page.locator('.ios-dialog').count() == 1 and remind_state(page) == {}, f'autre feuille ouverte : pas de rappel {remind_state(page)}')
        tap_dialog(page, 'OK')
        # Séance en cours : rien
        page.evaluate("window.__s = activeSession; activeSession = { exercises: [] }")
        remind(page)
        page.evaluate("activeSession = window.__s")
        R.check(page.locator('.ios-dialog--sheet').count() == 0 and remind_state(page) == {}, 'séance en cours : pas de rappel')
        remind(page)
        page.wait_for_selector('.ios-dialog--sheet', timeout=3000)
        tap_dialog(page, 'Plus tard')
        R.check(not any(c in ('request', 'register') or c.startswith('push_set_prefs') for c in push_calls(page)), f'« Plus tard » : rien demandé {push_calls(page)}')
        # Une demande à la fois : la conversation n'enchaîne pas avec la demande en contexte
        open_chat(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 0, 'rappel d\'aujourd\'hui : pas de demande en contexte')
        leave_chat(page)
        remind(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 0, 'pas avant 7 jours')
        age_remind(page)
        remind(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 1, 'deuxième fois après 7 jours')
        tap_dialog(page, 'Plus tard')
        age_remind(page)
        remind(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 1, 'troisième fois')
        tap_dialog(page, 'Plus tard')
        age_remind(page)
        remind(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 0 and remind_state(page).get('n') == 3, f'jamais plus de 3 fois {remind_state(page)}')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')
    # Reçoit déjà quelque chose (iOS d'accord, un type allumé) : rien, et plus jamais
    with bench.page('webkit', 'iPhone 13', 'light') as page:
        open_app(page, 'light', ppl_v2_today_json(), {'pushRemind': True, 'push': {'permission': 'granted'}})
        signin(page)
        page.evaluate("__sb.push.prefs[__sb.meId()] = { reactions: true, follows: false, coach: false, comments: false, messages: false, student_sessions: false }")
        with_coach(page)
        remind(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 0 and remind_state(page).get('done') is True, f'déjà activées : rien {remind_state(page)}')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')
    # Ni coach, ni élève, ni social : rien n'arriverait, pas de rappel
    with bench.page('webkit', 'iPhone 13', 'light') as page:
        open_app(page, 'light', ppl_v2_today_json(), {'pushRemind': True})
        signin(page)
        remind(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 0, 'compte seul, sans social : pas de rappel')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')
    # Premier lancement d'un nouveau venu : jamais
    with bench.page('webkit', 'iPhone 13', 'light') as page:
        open_app(page, 'light', None, {'pushRemind': True})
        signin(page)
        with_coach(page)
        page.evaluate("document.querySelector('.onb')?.remove()")
        remind(page)
        R.check(page.locator('.ios-dialog--sheet').count() == 0, 'premier lancement : pas de rappel')


def o_rappel_roles_refus(bench):
    """Coach et social seul : leur phrase ; refusées dans iOS : « Activer » ouvre Réglages, puis allumées au retour."""
    for theme in ('light', 'dark'):
        with bench.page('webkit', 'iPhone 13', theme) as page:
            open_app(page, theme, ppl_v2_today_json(), {'pushRemind': True, 'push': {'permission': 'denied'}})
            signin(page)
            page.evaluate("async () => { const me = __sb.meId(); __sb.makeCoach(me); await coachRefresh(); }")
            remind(page)
            page.wait_for_selector('.ios-dialog--sheet', timeout=3000)
            txt = ask_sheet(page)
            R.check('Tu ne reçois pas les messages de tes élèves.' in txt and 'Réglages › MDLF Training › Notifications' in txt, f'{theme} coach refusé : phrase et chemin ({txt!r})')
            shot(page, LOT, f'rappel-coach-refus-iPhone_13-{theme}')
            tap_dialog(page, 'Activer')
            R.check('openSettings' in push_calls(page) and 'request' not in push_calls(page), f'{theme} ouvre les Réglages de l\'iPhone {push_calls(page)}')
            # Autorisées dans Réglages, retour dans l'app : les types du coach allumés
            page.evaluate("__sb.push.permission = 'granted'; document.dispatchEvent(new Event('visibilitychange'))")
            page.wait_for_function("() => (__sb.push.prefs[__sb.meId()] || {}).student_sessions === true", timeout=3000)
            prefs = page.evaluate('__sb.push.prefs[__sb.meId()]')
            R.check(prefs.get('messages') and prefs.get('coach') and not prefs.get('reactions'), f'{theme} retour des Réglages : messages, coach, séances des élèves {prefs}')
            R.check(remind_state(page).get('done') is True, f'{theme} plus jamais rappelé')
            R.check(not page.errors, f'{theme} aucune erreur JS {page.errors}')
    with bench.page('webkit', 'iPhone SE', 'dark') as page:
        open_app(page, 'dark', ppl_v2_today_json(), {'pushRemind': True})
        signin(page)
        page.evaluate("async () => { await socialEnable(true); }")
        remind(page)
        page.wait_for_selector('.ios-dialog--sheet', timeout=3000)
        R.check('Tu ne reçois pas les bravos et les commentaires sur tes séances.' in ask_sheet(page), f'social seul : bravos et commentaires ({ask_sheet(page)!r})')
        shot(page, LOT, 'rappel-social-iPhone_SE-dark')
        tap_dialog(page, 'Activer')
        page.wait_for_function("() => (__sb.push.prefs[__sb.meId()] || {}).reactions === true", timeout=3000)
        prefs = page.evaluate('__sb.push.prefs[__sb.meId()]')
        R.check(prefs.get('comments') and not prefs.get('messages'), f'bravos et commentaires allumés {prefs}')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')


run_main(R, [t_reglages, t_refus, t_reactiver, t_autre_compte, t_ancien_serveur, t_absent, t_toucher, t_sommeil, t_demande_eleve, t_demande_refusee, t_rappel],
         once=[o_coach_segment, o_demande_plus_tard, o_demande_premier_lancement, o_demande_coach, o_demande_lien_accepte, o_toucher_seance_eleve,
               o_rappel_regles, o_rappel_roles_refus])
