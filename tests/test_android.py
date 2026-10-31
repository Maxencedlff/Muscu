"""Coquille Android (préparation, docs/ANDROID.md) : Réglages › Santé avec Health Connect, sans Apple Music,
sans icône de l'app, sans erreur ; et coquille iOS inchangée (Services Apple, Apple Music).

Les coquilles sont simulées comme dans test_icone.py : window.Capacitor factice injecté avant le
chargement. getPlatform() dit 'android' ou 'ios'. Comme le vrai runtime de Capacitor, un module absent
de la coquille rejette ses appels avec le code UNIMPLEMENTED (MdlfAppIcon, MdlfMusic… sur Android).
Captures : $PPL_SCRATCH/shots/lotandroid/.
Lancer : PPL_DEV="Pixel 7" PPL_THEME=dark python3 test_android.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'android'
R = Results(LOT)

# %s : 'android' ou 'ios' ; %s : Health Connect disponible (true / false)
FAKE_SHELL = """
window.__health = { asked: 0, available: %s };
window.Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => '%s',
  isPluginAvailable: () => false,
  registerPlugin: (pluginName) => {
    const android = Capacitor.getPlatform() === 'android';
    if (pluginName === 'MdlfHealth') return {
      requestAuthorization: async () => { __health.asked++; return { available: __health.available, workouts: __health.available }; },
      authorizationStatus: async () => ({ available: __health.available, request: 'unnecessary' }),
      bodyMass: async () => ({ samples: [] }),
      workouts: async () => ({ workouts: [] }),
      saveWorkout: async () => ({ saved: true }),
    };
    // Modules propres à iOS : absents de la coquille Android (rejet UNIMPLEMENTED, comme Capacitor)
    if (android && ['MdlfAppIcon', 'MdlfMusic', 'MdlfCloudBackup', 'MdlfSound', 'MdlfAccount'].includes(pluginName)) {
      return new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => {
        const e = new Error(`"${pluginName}" plugin is not implemented on android`); e.code = 'UNIMPLEMENTED'; throw e; }) });
    }
    if (pluginName === 'MdlfAppIcon') return { getName: async () => ({ supported: true }), change: async () => ({}) };
    return new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) });
  },
};
"""


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_settings(page, theme, platform, available='true'):
    page.add_init_script(FAKE_SHELL % (available, platform))
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())   # jamais de réseau
    seed(page, theme, ppl_v2_today_json())
    page.click('[data-action="go-settings"]')
    page.wait_for_selector('.settings-view')
    page.wait_for_timeout(300)


def group_titles(page):
    return page.evaluate("[...document.querySelectorAll('.settings-view .group-title')].map(e => e.textContent.trim())")


def t_android(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_settings(page, theme, 'android')
        R.check(page.evaluate('Native.platform') == 'android', f'{t} coquille Android simulée')
        titles = group_titles(page)
        R.check('Santé' in titles and 'Services Apple' not in titles, f'{t} groupe « Santé » : {titles}')
        text = page.inner_text('.settings-view')
        R.check('Health Connect' in text, f'{t} Health Connect proposé')
        R.check('Apple Music' not in text and 'Apple Santé' not in text, f'{t} rien d\'Apple')
        R.check(page.locator('[data-action="setting-music"]').count() == 0, f'{t} pas de cellule Apple Music')
        R.check(page.locator('.app-icons').count() == 0, f'{t} pas d\'icône de l\'app (module absent)')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} pas de défilement horizontal')
        cell = page.locator('[data-action="setting-health"]')
        R.check(cell.get_attribute('role') == 'switch' and cell.get_attribute('aria-checked') == 'false', f'{t} interrupteur accessible, éteint')
        box = cell.bounding_box()
        R.check(box and box['height'] >= 44, f'{t} cible d\'au moins 44 pt {box}')
        cell.scroll_into_view_if_needed()
        shot(page, LOT, f'reglages-sante-{t}')

        cell.click()
        page.wait_for_timeout(300)
        R.check(page.evaluate('__health.asked') == 1, f'{t} autorisation demandée à Health Connect')
        R.check(page.evaluate('data.healthOn') is True, f'{t} santé activée')
        R.check('Health Connect connecté' in page.inner_text('body'), f'{t} toast « Health Connect connecté »')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Health Connect absent (Android 13 sans l'appli) : invitation à l'installer, rien d'activé
    with bench.page(eng, dev, theme) as page:
        open_settings(page, theme, 'android', available='false')
        page.locator('[data-action="setting-health"]').click()
        page.wait_for_timeout(300)
        R.check(page.evaluate('data.healthOn') is not True, f'{t} indisponible : reste éteint')
        R.check('Play Store' in page.inner_text('body'), f'{t} indisponible : installer depuis le Play Store')
        R.check(not page.errors, f'{t} indisponible : aucune erreur JS {page.errors}')


def t_ios(bench, eng, dev, theme):
    """La coquille iOS garde exactement ses Services Apple."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_settings(page, theme, 'ios')
        R.check(page.evaluate('Native.platform') == 'ios', f'{t} coquille iOS simulée')
        R.check('Services Apple' in group_titles(page), f'{t} iOS : groupe Services Apple')
        text = page.inner_text('.settings-view')
        R.check('Apple Santé' in text and 'Apple Music' in text, f'{t} iOS : Apple Santé et Apple Music')
        R.check(page.locator('.app-icons').count() == 1, f'{t} iOS : icône de l\'app')
        R.check(not page.errors, f'{t} iOS : aucune erreur JS {page.errors}')


run_main(R, [t_android, t_ios])
