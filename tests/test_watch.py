"""Apple Watch et Siri branchés sur la vraie séance (js/features/watch.js, js/features/siri.js).

Les tests unitaires (tests/unit/companions.mjs) couvrent la logique pure ; ici, l'app entière tourne
dans une coquille Capacitor factice (comme test_icone.py) avec de faux modules MdlfWatch et MdlfShortcuts :
- MdlfWatch garde les évènements arrivés avant que le JS écoute et les lui remet à son addListener,
  comme notifyListeners(…, retainUntilConsumed: true) dans WatchPlugin.swift ; chaque état envoyé
  est noté dans window.__watch.sent ;
- MdlfShortcuts garde une demande (ShortcutInbox) ; `fireOnListen` simule la notification de Siri
  arrivée pendant le chargement, avant la restauration de la séance.
Lancer : python3 test_watch.py (tests uniques, un appareil).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'watch'
R = Results(LOT)
ENGINE, DEVICE, THEME = 'chromium', 'Pixel 7', 'dark'

FAKE_SHELL = """
window.__watch = { sent: [], listeners: {}, retained: %(retained)s };
window.__sc = { inbox: %(inbox)s, listeners: [], fireOnListen: %(fire)s, takes: 0 };
window.__watch.emit = (ev, data) => (__watch.listeners[ev] || []).forEach(fn => fn(data));
window.Capacitor = {
  isNativePlatform: () => true,
  isPluginAvailable: name => ['MdlfWatch', 'MdlfShortcuts'].includes(name),
  registerPlugin: (pluginName) => {
    if (pluginName === 'MdlfWatch') return {
      send: async ({ state }) => { __watch.sent.push(JSON.parse(state)); },
      addListener: (ev, fn) => {
        (__watch.listeners[ev] ||= []).push(fn);
        // retainUntilConsumed : ce qui est arrivé avant l'écoute est remis maintenant
        const kept = __watch.retained.filter(r => r.ev === ev);
        __watch.retained = __watch.retained.filter(r => r.ev !== ev);
        kept.forEach(r => fn(r.data));
        return Promise.resolve({ remove() {} });
      },
    };
    if (pluginName === 'MdlfShortcuts') return {
      takeRequest: async () => { __sc.takes++; const r = __sc.inbox; __sc.inbox = null; return r || {}; },
      addListener: (ev, fn) => {
        __sc.listeners.push(fn);
        if (__sc.fireOnListen) fn({});   // notification de Siri pendant le chargement de l'app
        return Promise.resolve({ remove() {} });
      },
    };
    return new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) });
  },
};
"""


def shell(retained=(), inbox=None, fire=False):
    return FAKE_SHELL % {'retained': json.dumps(list(retained)), 'inbox': json.dumps(inbox),
                         'fire': 'true' if fire else 'false'}


def open_app(page, data, active=None, **kw):
    page.add_init_script(shell(**kw))
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, THEME, data, active=active)
    page.wait_for_timeout(600)


def saved_session(bench, data):
    """Séance push réelle (démarrée par l'app), enregistrée telle que l'app la garde."""
    with bench.page(ENGINE, DEVICE, THEME) as page:
        open_app(page, data)
        page.evaluate("startSession('push')")
        page.wait_for_timeout(200)
        raw = ls(page, 'ppl_active_session')
    return json.loads(raw)


def now_ms():
    return int(time.time() * 1000)


def t_montre(bench):
    data = ppl_v2_today_json()
    active = saved_session(bench, data)
    started = active['activeSession']['startedAt']
    # Geste « valider la 1re série » et demande d'état arrivés avant que la vue web écoute
    retained = [{'ev': 'action', 'data': {'type': 'validate', 'ei': 0, 'si': 0, 'at': now_ms()}},
                {'ev': 'request', 'data': {}}]
    with bench.page(ENGINE, DEVICE, THEME) as page:
        open_app(page, data, active=active, retained=retained)
        page.wait_for_function('window.__watch.sent.length > 0', timeout=4000)
        sent = page.evaluate('__watch.sent')
        R.check(all(s['active'] for s in sent),
                f'aucun état « pas de séance » envoyé avant la restauration : {[s["active"] for s in sent]}')
        st = page.evaluate("({ done: activeSession.exercises[0].sets[0].done === true, rest: restActive, started: activeSession.startedAt })")
        R.check(st['done'], 'geste remis au démarrage : 1re série cochée sur la séance restaurée')
        R.check(st['rest'], 'geste remis au démarrage : repos ouvert')
        R.check(st['started'] == started, 'séance restaurée, pas remplacée')
        last = sent[-1]
        R.check(last['active'] and last['cur'] == {'ei': 0, 'si': 1} and last['rest'] is not None,
                f'dernier état envoyé : séance en cours, série 2, repos : {last.get("cur")} {last.get("rest")}')

        # Geste périmé (série déjà validée) : rien ne change, l'état réel est renvoyé
        n = page.evaluate('__watch.sent.length')
        page.evaluate(f"__watch.emit('action', {{ type: 'validate', ei: 0, si: 0, at: {now_ms()} }})")
        page.wait_for_timeout(150)
        after = page.evaluate("({ n: __watch.sent.length, done2: activeSession.exercises[0].sets[1].done === true, last: __watch.sent.at(-1) })")
        R.check(after['n'] == n + 1 and after['last']['cur'] == {'ei': 0, 'si': 1}, 'geste périmé : état réel renvoyé')
        R.check(not after['done2'], 'geste périmé : la série suivante n\'est pas validée à sa place')

        # Repos : −15 s puis passer
        end0 = page.evaluate('restEndTime')
        page.evaluate(f"__watch.emit('action', {{ type: 'restAdjust', d: -15, at: {now_ms()} }})")
        page.wait_for_timeout(100)
        R.check(abs((end0 - page.evaluate('restEndTime')) - 15000) < 1500, 'repos : −15 s depuis la montre')
        page.evaluate(f"__watch.emit('action', {{ type: 'skipRest', at: {now_ms()} }})")
        page.wait_for_timeout(150)
        R.check(not page.evaluate('restActive') and page.evaluate('__watch.sent.at(-1).rest') is None, 'repos passé depuis la montre')

        # Geste valide mais trop ancien (resté en file pendant que l'iPhone dormait) : refusé
        page.evaluate(f"__watch.emit('action', {{ type: 'validate', ei: 0, si: 1, at: {now_ms() - 60_000} }})")
        page.wait_for_timeout(150)
        R.check(not page.evaluate('activeSession.exercises[0].sets[1].done === true'), 'geste de plus de 30 s : refusé')
        page.evaluate(f"__watch.emit('action', {{ type: 'validate', ei: 0, si: 1 }})")
        page.wait_for_timeout(150)
        R.check(not page.evaluate('activeSession.exercises[0].sets[1].done === true'), 'geste sans heure : refusé')

        # Chrono d'effort en cours : la validation se fait sur l'iPhone
        page.evaluate("activeSession.effort = { ei: 0, si: 1, start: Date.now(), target: 30, sides: 1 }")
        page.evaluate(f"__watch.emit('action', {{ type: 'validate', ei: 0, si: 1, at: {now_ms()} }})")
        page.wait_for_timeout(150)
        R.check(not page.evaluate('activeSession.exercises[0].sets[1].done === true'), 'chrono d\'effort : validation refusée')
        R.check(page.evaluate('__watch.sent.at(-1).canValidate') is False, 'chrono d\'effort : la montre reçoit « pas validable »')
        page.evaluate('delete activeSession.effort')

        # Série en cours, validable : validée, et le repos démarre
        page.evaluate(f"__watch.emit('action', {{ type: 'validate', ei: 0, si: 1, at: {now_ms()} }})")
        page.wait_for_timeout(150)
        R.check(page.evaluate('activeSession.exercises[0].sets[1].done === true && restActive'), 'série 2 validée depuis la montre, repos ouvert')
        R.check(page.evaluate("JSON.parse(localStorage.getItem('ppl_active_session')).activeSession.exercises[0].sets[1].done") is True,
                'geste de la montre sauvegardé')

        # La montre redemande l'état : renvoyé même s'il n'a pas changé
        n = page.evaluate('__watch.sent.length')
        page.evaluate("__watch.emit('request', {})")
        page.wait_for_timeout(100)
        R.check(page.evaluate('__watch.sent.length') == n + 1, 'demande de la montre : état renvoyé')
        R.check(not page.errors, f'montre : aucune erreur JS {page.errors}')


def t_siri(bench):
    data = ppl_v2_today_json()
    active = saved_session(bench, data)
    started = active['activeSession']['startedAt']
    req = {'action': 'startSession', 'at': now_ms()}

    # Séance en cours, notification de Siri pendant le chargement : on y retourne, rien n'est écrasé
    with bench.page(ENGINE, DEVICE, THEME) as page:
        open_app(page, data, active=active, inbox=dict(req, at=now_ms()), fire=True)
        page.wait_for_function('window.__sc.takes > 0', timeout=4000)
        page.wait_for_timeout(300)
        saved = json.loads(ls(page, 'ppl_active_session'))
        R.check(saved['activeSession']['startedAt'] == started, 'Siri au démarrage : la séance en cours n\'est pas remplacée')
        R.check(page.evaluate('activeSession.startedAt') == started, 'Siri au démarrage : séance restaurée en mémoire')
        R.check(page.evaluate('currentView()') == 'session', f'Siri, séance en cours : écran séance ({page.evaluate("currentView()")})')
        R.check(page.locator('.ios-dialog').count() == 0, 'Siri, séance en cours : pas de dialogue « déjà en cours »')
        R.check(not page.errors, f'Siri (séance en cours) : aucune erreur JS {page.errors}')

    # Sans séance : la prochaine séance démarre
    with bench.page(ENGINE, DEVICE, THEME) as page:
        open_app(page, data, inbox=dict(req, at=now_ms()), fire=True)
        page.wait_for_function('window.__sc.takes > 0', timeout=4000)
        page.wait_for_timeout(300)
        st = page.evaluate("({ cat: activeSession && activeSession.category, next: nextSessionCat(sessionKeys()), view: currentView() })")
        R.check(st['cat'] is not None and st['view'] == 'session', f'Siri sans séance : séance démarrée {st}')

    # App déjà ouverte : la demande arrive par l'évènement
    with bench.page(ENGINE, DEVICE, THEME) as page:
        open_app(page, data)
        R.check(page.evaluate('activeSession') is None, 'app ouverte sans séance')
        page.evaluate(f"__sc.inbox = {{ action: 'startSession', at: {now_ms()} }}; __sc.listeners.forEach(fn => fn({{}}))")
        page.wait_for_timeout(400)
        R.check(page.evaluate("currentView() === 'session' && !!activeSession"), 'Siri, app ouverte : séance démarrée')
        R.check(page.evaluate('__sc.listeners.length') == 1, 'un seul écouteur Siri')
        R.check(not page.errors, f'Siri (app ouverte) : aucune erreur JS {page.errors}')


run_main(R, [], once=[t_montre, t_siri])
