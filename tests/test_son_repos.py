"""Son de fin de repos dans l'app iOS : lecture native surveillée, notification en filet, outils de diagnostic.

Coquille Capacitor factice (comme test_watch.py) : un faux MdlfSound (build 68 : play + diagnostics) dont
l'état rendu se règle par window.__snd.diag, et un faux LocalNotifications qui note chaque programmation
et annulation de la notification de fin de repos.
- Réglages › Sons : « Tester la fin de repos » joue 3-2-1 puis GO (duck) ; « Diagnostic du son » affiche l'état ;
- aucun contexte Web Audio créé dans l'app (WebKit changerait la catégorie audio de toute l'app) ;
- fin de repos app à l'écran, lecture saine : notification repoussée puis annulée après le GO ;
- lecture en panne : GO rejoué en forçant la remise en état (duck), notification gardée ;
- app cachée à la fin : notification gardée.
Lancer : python3 test_son_repos.py (tests uniques, un appareil).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'son_repos'
R = Results(LOT)
ENGINE, DEVICE, THEME = 'chromium', 'Pixel 7', 'dark'

FAKE_SHELL = """
window.__snd = { plays: [], notif: [], ctx: 0,
  diag: { category: 'AVAudioSessionCategoryPlayback', duckOthers: false, ducking: false, sessionActive: true,
          engineRunning: true, otherAudioPlaying: false, journal: ['2026-11-15T09:00:00Z interruption (début)'] } };
const RealCtx = window.AudioContext;
window.AudioContext = function () { __snd.ctx++; return new RealCtx(); };
window.webkitAudioContext = window.AudioContext;
window.Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => 'ios',
  isPluginAvailable: name => ['MdlfSound', 'LocalNotifications'].includes(name),
  PluginHeaders: [{ name: 'MdlfSound', methods: [{ name: 'play', rtype: 'promise' }, { name: 'diagnostics', rtype: 'promise' }] }],
  registerPlugin: (pluginName) => {
    if (pluginName === 'MdlfSound') return {
      play: async (o) => { __snd.plays.push({ freq: o.notes[0].freq, duck: o.duck, at: Date.now() }); },
      diagnostics: async () => JSON.parse(JSON.stringify(__snd.diag)),
    };
    if (pluginName === 'LocalNotifications') return {
      checkPermissions: async () => ({ display: 'granted' }),
      requestPermissions: async () => ({ display: 'granted' }),
      schedule: async (o) => { __snd.notif.push({ op: 'schedule', at: +o.notifications[0].schedule.at }); },
      cancel: async () => { __snd.notif.push({ op: 'cancel', at: Date.now() }); },
    };
    return new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) });
  },
};
"""


def open_app(page):
    page.add_init_script(FAKE_SHELL)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, THEME, ppl_v2_today_json())
    page.wait_for_timeout(500)


def end_rest_soon(page, ms=2600):
    """Séance push, repos ouvert, puis fin du repos ramenée à `ms` ms (notification reprogrammée)."""
    page.evaluate("startSession('push')")
    page.wait_for_timeout(200)
    page.evaluate(f"openRest(90); restEndTime = Date.now() + {ms}; resumeRestCountdown(); syncNativeRest();")
    page.wait_for_timeout(150)
    page.evaluate("__snd.plays = []; __snd.notif = []")


def t_reglages(bench):
    with bench.page(ENGINE, DEVICE, THEME) as page:
        open_app(page)
        page.evaluate("document.dispatchEvent(new PointerEvent('pointerdown'))")
        page.evaluate("routeTo('settings')")
        page.wait_for_selector('.view.settings-view')
        R.check(page.locator('[data-action="sound-test-rest"]').count() == 1, 'Réglages : ligne « Tester la fin de repos »')
        R.check(page.locator('[data-action="sound-diagnostics"]').count() == 1, 'Réglages : ligne « Diagnostic du son »')
        R.check(page.locator('#sound-diag').is_hidden(), 'diagnostic replié au départ')
        page.click('[data-action="sound-test-rest"]')
        page.wait_for_function('__snd.plays.length >= 4', timeout=6000)
        plays = page.evaluate('__snd.plays')
        R.check([p['freq'] for p in plays[:4]] == [880, 880, 880, 1050], f'test : 3-2-1 puis GO {[p["freq"] for p in plays]}')
        R.check(all(p['duck'] for p in plays[:4]), 'test : musique baissée comme en vraie fin de repos')
        gaps = [plays[i + 1]['at'] - plays[i]['at'] for i in range(3)]
        R.check(all(800 <= g <= 1400 for g in gaps), f'test : un bip par seconde {gaps}')
        page.click('[data-action="sound-diagnostics"]')
        page.wait_for_function("document.querySelector('.sound-diag__text').textContent.includes('Catégorie')", timeout=3000)
        txt = page.evaluate("document.querySelector('.sound-diag__text').textContent")
        for part in ('Catégorie : Playback', 'Session active : oui', 'moteur : oui', 'Notifications : granted', 'interruption (début)'):
            R.check(part in txt, f'diagnostic : « {part} » affiché')
        R.check(page.evaluate("getComputedStyle(document.querySelector('.sound-diag__text')).userSelect") in ('text', 'auto'),
                'diagnostic : texte sélectionnable')
        R.check(page.evaluate('__snd.ctx') == 0, 'aucun contexte Web Audio créé dans l\'app')
        shot(page, LOT, f'reglages-sons-{THEME}')
        R.check(not page.errors, f'réglages : aucune erreur JS {page.errors[:2]}')


def t_fin_repos_saine(bench):
    with bench.page(ENGINE, DEVICE, THEME) as page:
        open_app(page)
        end_rest_soon(page)
        end = page.evaluate('restEndTime')
        page.wait_for_function('__snd.notif.some(n => n.op === "cancel")', timeout=7000)
        page.wait_for_timeout(300)
        plays, notif = page.evaluate('__snd.plays'), page.evaluate('__snd.notif')
        R.check([p['freq'] for p in plays] == [880, 880, 1050] or [p['freq'] for p in plays] == [880, 880, 880, 1050],
                f'fin de repos : décompte puis GO {[p["freq"] for p in plays]}')
        sched = [n for n in notif if n['op'] == 'schedule']
        R.check(len(sched) == 1 and sched[0]['at'] >= end + 2000, f'notification repoussée après la fin, pas annulée avant le GO {notif}')
        go_at = [p['at'] for p in plays if p['freq'] == 1050][0]
        cancels = [n for n in notif if n['op'] == 'cancel']
        R.check(cancels and cancels[0]['at'] >= go_at, 'notification annulée seulement après le GO joué')
        R.check(not page.errors, f'fin saine : aucune erreur JS {page.errors[:2]}')


def t_fin_repos_panne(bench):
    with bench.page(ENGINE, DEVICE, THEME) as page:
        open_app(page)
        end_rest_soon(page)
        page.evaluate("__snd.diag.category = 'AVAudioSessionCategoryAmbient'")
        page.wait_for_function('__snd.plays.filter(p => p.freq === 1050).length >= 2', timeout=7000)
        page.wait_for_timeout(800)
        plays, notif = page.evaluate('__snd.plays'), page.evaluate('__snd.notif')
        gos = [p for p in plays if p['freq'] == 1050]
        R.check(len(gos) == 2 and gos[1]['duck'], f'lecture en panne : GO rejoué une fois en forçant la remise en état {gos}')
        R.check(not any(n['op'] == 'cancel' for n in notif), f'lecture en panne : notification gardée en filet {notif}')
        R.check(not page.errors, f'panne : aucune erreur JS {page.errors[:2]}')


def t_fin_repos_cachee(bench):
    with bench.page(ENGINE, DEVICE, THEME) as page:
        open_app(page)
        end_rest_soon(page, ms=1800)
        page.evaluate("Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })")
        page.wait_for_function('!restActive', timeout=6000)
        page.wait_for_timeout(800)
        notif = page.evaluate('__snd.notif')
        R.check(not any(n['op'] == 'cancel' for n in notif), f'app cachée à la fin : notification jamais annulée {notif}')
        R.check(not page.errors, f'cachée : aucune erreur JS {page.errors[:2]}')


run_main(R, [], once=[t_reglages, t_fin_repos_saine, t_fin_repos_panne, t_fin_repos_cachee])
