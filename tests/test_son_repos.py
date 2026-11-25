"""Son de fin de repos dans l'app iOS : lecture native surveillée, notification en filet, outils de diagnostic.

Coquille Capacitor factice (comme test_watch.py) : un faux MdlfSound (build 68 : play + diagnostics) dont
l'état rendu se règle par window.__snd.diag, et un faux LocalNotifications qui note chaque programmation
et annulation de la notification de fin de repos.
- Réglages › Sons : « Tester la fin de repos » joue 3-2-1 puis GO (duck) ; « Diagnostic du son » affiche l'état ;
- aucun contexte Web Audio créé dans l'app (WebKit changerait la catégorie audio de toute l'app) ;
- fin de repos app à l'écran, lecture saine : notification repoussée puis annulée après le GO ;
- lecture en panne : GO rejoué en forçant la remise en état (duck), notification gardée ;
- app cachée à la fin : notification gardée ;
- coquille du 21/11/2026 (selfTest) : « Diagnostic du son » lance le test mesuré, affiche sortie, volume et
  niveaux en clair, copie le détail ; navigateur : la ligne n'existe pas.
Lancer : python3 test_son_repos.py (tests uniques, un appareil).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'son_repos'
R = Results(LOT)
ENGINE, DEVICE, THEME = 'chromium', 'Pixel 7', 'dark'
# Premières notes du décompte et du GO (MELODIES, js/core/haptics-audio.js : sous 800 Hz depuis le 19/11/2026)
COUNT, GO = 587, 494

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
    if (pluginName === 'Share') return { share: async (o) => { window.__shared = o; } };
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
    page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
    seed(page, THEME, ppl_v2_today_json())
    settle(page)


def end_rest_soon(page, ms=2600):
    """Séance push, repos ouvert, puis fin du repos ramenée à `ms` ms (notification reprogrammée)."""
    page.evaluate("startSession('push')")
    settle(page)
    page.evaluate(f"openRest(90); restEndTime = Date.now() + {ms}; resumeRestCountdown(); syncNativeRest();")
    page.wait_for_timeout(150)   # attente voulue : vider ce que l'ouverture du repos a joué, bien avant le décompte (repère des sons attendus)
    page.evaluate("__snd.plays = []; __snd.notif = []")


def after_defer(notif, end):
    """Opérations sur la notification après sa programmation repoussée (scheduleRestEnd annule puis reprogramme)"""
    idx = [i for i, n in enumerate(notif) if n['op'] == 'schedule' and n['at'] >= end + 2000]
    return None if not idx else notif[idx[0] + 1:]


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
        R.check([p['freq'] for p in plays[:4]] == [COUNT, COUNT, COUNT, GO], f'test : 3-2-1 puis GO {[p["freq"] for p in plays]}')
        R.check(all(p['duck'] for p in plays[:4]), 'test : musique baissée comme en vraie fin de repos')
        gaps = [plays[i + 1]['at'] - plays[i]['at'] for i in range(3)]
        R.check(all(800 <= g <= 1400 for g in gaps), f'test : un bip par seconde {gaps}')
        page.click('[data-action="sound-diagnostics"]')
        page.wait_for_function("document.querySelector('.sound-diag__text')?.textContent.includes('Catégorie')", timeout=3000)
        txt = page.evaluate("document.querySelector('.sound-diag__text').textContent")
        for part in ('Catégorie : Playback', 'Session active : oui', 'moteur : oui', 'Notifications : granted', 'interruption (début)'):
            R.check(part in txt, f'diagnostic : « {part} » affiché')
        R.check(page.evaluate("getComputedStyle(document.querySelector('.sound-diag__text')).userSelect") in ('text', 'auto'),
                'diagnostic : texte sélectionnable')
        # Tester les hauteurs : 440, 660, 880, 1320 Hz, 0,8 s d'écart, numéros allumés un à un
        R.check(page.locator('[data-action="sound-test-pitch"]').count() == 1, 'Réglages : ligne « Tester les hauteurs »')
        R.check(page.locator('.pitch-steps__n--on').count() == 0, 'hauteurs : numéros éteints au départ')
        page.evaluate('__snd.plays = []')
        page.click('[data-action="sound-test-pitch"]')
        page.wait_for_function('__snd.plays.length >= 4', timeout=6000)
        plays = page.evaluate('__snd.plays')
        R.check([p['freq'] for p in plays] == [440, 660, 880, 1320], f'hauteurs : 4 bips du grave à l\'aigu {[p["freq"] for p in plays]}')
        R.check(not any(p['duck'] for p in plays), 'hauteurs : musique jamais baissée')
        gaps = [plays[i + 1]['at'] - plays[i]['at'] for i in range(3)]
        R.check(all(650 <= g <= 1200 for g in gaps), f'hauteurs : 0,8 s entre deux bips {gaps}')
        R.check(page.locator('.pitch-steps__n--on').count() == 4, 'hauteurs : les 4 numéros allumés')
        R.check(page.evaluate('__snd.ctx') == 0, 'aucun contexte Web Audio créé dans l\'app')
        shot(page, LOT, f'reglages-sons-{THEME}')
        R.check(not page.errors, f'réglages : aucune erreur JS {page.errors[:2]}')


def t_fin_repos_saine(bench):
    with bench.page(ENGINE, DEVICE, THEME) as page:
        open_app(page)
        end_rest_soon(page)
        end = page.evaluate('restEndTime')
        page.evaluate(f'window.__end = {end}')
        page.wait_for_function("(() => { const i = __snd.notif.findIndex(n => n.op === 'schedule' && n.at >= __end + 2000);"
                               " return i >= 0 && __snd.notif.slice(i + 1).some(n => n.op === 'cancel'); })()", timeout=7000)
        settle(page)
        plays, notif = page.evaluate('__snd.plays'), page.evaluate('__snd.notif')
        R.check([p['freq'] for p in plays] == [COUNT, COUNT, GO] or [p['freq'] for p in plays] == [COUNT, COUNT, COUNT, GO],
                f'fin de repos : décompte puis GO {[p["freq"] for p in plays]}')
        sched = [n for n in notif if n['op'] == 'schedule']
        R.check(len(sched) == 1 and sched[0]['at'] >= end + 2000, f'notification repoussée après la fin, pas annulée avant le GO {notif}')
        go_at = [p['at'] for p in plays if p['freq'] == GO][0]
        cancels = [n for n in (after_defer(notif, end) or []) if n['op'] == 'cancel']
        R.check(cancels and cancels[0]['at'] >= go_at, 'notification annulée seulement après le GO joué')
        R.check(not page.errors, f'fin saine : aucune erreur JS {page.errors[:2]}')


def t_fin_repos_panne(bench):
    with bench.page(ENGINE, DEVICE, THEME) as page:
        open_app(page)
        end_rest_soon(page)
        end = page.evaluate('restEndTime')
        page.evaluate("__snd.diag.category = 'AVAudioSessionCategoryAmbient'")
        page.wait_for_function('__snd.plays.filter(p => p.freq === ' + str(GO) + ').length >= 2', timeout=7000)
        settle(page)
        plays, notif = page.evaluate('__snd.plays'), page.evaluate('__snd.notif')
        gos = [p for p in plays if p['freq'] == GO]
        R.check(len(gos) == 2 and gos[1]['duck'], f'lecture en panne : GO rejoué une fois en forçant la remise en état {gos}')
        rest = after_defer(notif, end)
        R.check(rest is not None and not any(n['op'] == 'cancel' for n in rest), f'lecture en panne : notification gardée en filet {notif}')
        R.check(not page.errors, f'panne : aucune erreur JS {page.errors[:2]}')


def t_fin_repos_cachee(bench):
    with bench.page(ENGINE, DEVICE, THEME) as page:
        open_app(page)
        end_rest_soon(page, ms=1800)
        page.evaluate("Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })")
        page.wait_for_function('!restActive', timeout=6000)
        settle(page)
        notif = page.evaluate('__snd.notif')
        R.check(not any(n['op'] == 'cancel' for n in notif), f'app cachée à la fin : notification jamais annulée {notif}')
        R.check(not page.errors, f'cachée : aucune erreur JS {page.errors[:2]}')


# Coquille du 21/11/2026 : selfTest publié, résultat factice (fichier joué, GO muet moteur arrêté) ;
# presse-papier relevé dans window.__copied
SELF_TEST_SHELL = FAKE_SHELL.replace(
    "{ name: 'diagnostics', rtype: 'promise' }]",
    "{ name: 'diagnostics', rtype: 'promise' }, { name: 'selfTest', rtype: 'promise' }]",
).replace(
    "diagnostics: async () => JSON.parse(JSON.stringify(__snd.diag)),",
    """diagnostics: async () => JSON.parse(JSON.stringify(__snd.diag)),
      selfTest: async (o) => { __snd.selfTest = o.steps; await new Promise(r => setTimeout(r, 300)); return {
        before: { outputs: [{ type: 'Speaker', name: 'Speaker' }], outputVolume: 0.8, otherAudioPlaying: false,
                  category: 'AVAudioSessionCategoryPlayback', mode: 'AVAudioSessionModeDefault', categoryOptions: ['mixWithOthers'],
                  sessionActive: true, engineRunning: true, secondaryAudioShouldBeSilencedHint: false, sampleRate: 48000, journal: [] },
        silentMode: 'unknown', silentMs: 200, file: { played: true, peakDb: -2.4, avgDb: -12.2, ms: 640 },
        steps: o.steps.map((s, i) => ({ name: s.name, peakDb: i === 3 ? -160 : -11.6, rmsDb: -15, buffers: i === 3 ? 0 : 40,
                                        ducking: s.duck, engineRunning: i !== 3 })),
        after: { category: 'AVAudioSessionCategoryPlayback', sessionActive: true, engineRunning: false,
                 journal: ['2026-11-21T10:00:00Z diagnostic du son fait'] } }; },""",
) + """
window.__copied = null;
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });
"""


def got_head_visible(page):
    """Ligne « Diagnostic du son » entière à l'écran, sous la barre de navigation, au-dessus du verdict"""
    return page.evaluate("""(() => { const h = document.querySelector('.settings-view [data-action="sound-diagnostics"]').getBoundingClientRect();
        const v = document.querySelector('.sound-diag__verdict').getBoundingClientRect();
        const nav = document.querySelector('.navbar').getBoundingClientRect();
        return h.top >= nav.bottom - 1 && h.bottom <= v.top + 1; })()""")


def t_diagnostic_mesure(bench):
    for theme in ('dark', 'light'):
        with bench.page(ENGINE, DEVICE, theme) as page:
            page.add_init_script(SELF_TEST_SHELL)
            page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
            seed(page, theme, ppl_v2_today_json())
            settle(page)
            page.evaluate("routeTo('settings')")
            page.wait_for_selector('.view.settings-view')
            cell = page.locator('[data-action="sound-diagnostics"]')
            R.check(cell.count() == 1 and 'Joue un son' in cell.inner_text(), f'{theme} : ligne « Diagnostic du son » et sa description')
            cell.click()
            page.wait_for_selector('.sound-diag__verdict', timeout=5000)
            steps = page.evaluate('__snd.selfTest')
            R.check([s['name'] for s in steps] == ['Décompte 3', 'Décompte 2', 'Décompte 1', 'GO'], f'{theme} : vraie fin de repos testée {steps and [s["name"] for s in steps]}')
            # Verdict amené à l'écran (sous la barre de navigation) et focus VoiceOver posé dessus
            R.check(page.evaluate("document.activeElement?.classList.contains('sound-diag__verdict')"), f'{theme} : focus sur le verdict')
            pos = page.evaluate("""(() => { const v = document.querySelector('.sound-diag__verdict').getBoundingClientRect();
                const nav = document.querySelector('.view.settings-view .navbar, .navbar')?.getBoundingClientRect();
                return { top: v.top, bottom: v.bottom, navBottom: nav ? nav.bottom : 0, h: innerHeight }; })()""")
            R.check(pos['top'] >= pos['navBottom'] - 1 and pos['top'] < pos['h'] / 2, f'{theme} : verdict en haut de l\'écran, visible {pos}')
            R.check(page.inner_text('.sound-diag__title') == "L'app n'a pas joué le GO", f'{theme} : verdict nommé')
            act = page.inner_text('.sound-diag__action')
            R.check(act.startswith("Ferme l'app, rouvre") and act.endswith('puis refais le test.'), f'{theme} : action courte {act!r}')
            R.check('au support' in page.inner_text('.sound-diag__help'), f'{theme} : aide')
            R.check(got_head_visible(page), f'{theme} : ligne « Diagnostic du son » visible au-dessus du verdict')
            R.check(page.locator('.sound-diag__verdict .sound-diag__mark--bad').count() == 1, f'{theme} : croix rouge du verdict')
            rows = page.evaluate("[...document.querySelectorAll('.sound-diag__row')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent])")
            got = dict(rows)
            R.check(got.get('Sortie') == 'Haut-parleur', f'{theme} : sortie en clair {got.get("Sortie")}')
            R.check(got.get('Volume', '').replace('\u00a0', ' ') == '80 %', f'{theme} : volume en % {got.get("Volume")!r}')
            R.check(got.get('Son enregistré') == 'Joué' and got.get('GO') == 'Pas joué', f'{theme} : joué / pas joué {got}')
            vue = page.inner_text('#sound-diag')
            R.check('dB' not in vue and 'moteur' not in vue, f'{theme} : ni dB ni moteur à l\'écran')
            R.check(got.get('Mode silencieux') == "Sans effet sur les sons de l'app", f'{theme} : mode silencieux sans effet {got.get("Mode silencieux")}')
            R.check(page.locator('[data-action="sound-diag-send"]').count() == 1, f'{theme} : « Envoyer le diagnostic »')
            R.check(page.locator('.sound-diag__actions [data-action="sound-diagnostics"]', has_text='Refaire le test').count() == 1, f'{theme} : « Refaire le test »')
            page.evaluate('window.__shared = null')
            page.click('[data-action="sound-diag-send"]')
            page.wait_for_function('window.__shared !== null', timeout=3000)
            R.check('Verdict :' in page.evaluate('window.__shared.text'), f'{theme} : feuille de partage avec le texte rempli')
            R.check(page.inner_text('.sound-diag__recap').strip() == "L'app n'a pas joué le GO", f'{theme} : verdict rappelé au-dessus de la copie')
            page.click('[data-action="sound-diag-copy"]')
            page.wait_for_function('window.__copied !== null', timeout=3000)
            copied = page.evaluate('window.__copied')
            R.check('Verdict :' in copied and 'GO : pas joué, pic' in copied and 'moteur non' in copied and 'diagnostic du son fait' in copied, f'{theme} : diagnostic copié')
            R.check('au support' in page.inner_text('.toast'), f'{theme} : message de copie')
            R.check('Maxence' not in page.inner_text('#sound-diag') and 'contact@mdlf.app' in copied, f'{theme} : support, jamais un prénom')
            page.locator('#sound-diag').scroll_into_view_if_needed()
            shot(page, LOT, f'diagnostic-mesure-{theme}')
            R.check(not page.errors, f'{theme} : diagnostic mesuré, aucune erreur JS {page.errors[:2]}')


def t_web_sans_diagnostic(bench):
    with bench.page(ENGINE, DEVICE, THEME) as page:
        page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
        seed(page, THEME, ppl_v2_today_json())
        settle(page)
        page.evaluate("routeTo('settings')")
        page.wait_for_selector('.view.settings-view')
        R.check(page.locator('[data-action="sound-diagnostics"]').count() == 0, 'navigateur : pas de « Diagnostic du son »')
        R.check(page.locator('#sound-diag').count() == 0, 'navigateur : pas de zone de diagnostic')
        R.check(not page.errors, f'navigateur : aucune erreur JS {page.errors[:2]}')


run_main(R, [], once=[t_reglages, t_fin_repos_saine, t_fin_repos_panne, t_fin_repos_cachee, t_diagnostic_mesure, t_web_sans_diagnostic])
