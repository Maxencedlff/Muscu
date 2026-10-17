"""Réglages › Icône de l'app : absente de la PWA, présente et fonctionnelle dans l'app iOS.

L'app iOS est simulée par une coquille Capacitor factice (window.Capacitor, injecté avant le
chargement) : native.js voit alors Native.isNative = true et parle au faux module MdlfAppIcon,
qui garde l'icône courante et la liste des appels dans window.__icon.
Captures : $PPL_SCRATCH/shots/loticone/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_icone.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'icone'
R = Results(LOT)
LABELS = ['Orange', 'Fonte rouillée', 'Inversée', 'Craie', 'Signature']

# Coquille iOS factice. Les autres modules natifs répondent {} sans rien faire.
FAKE_SHELL = """
window.__icon = { name: %s, supported: %s, calls: [], fail: false };
window.Capacitor = {
  isNativePlatform: () => true,
  registerPlugin: (pluginName) => {
    if (pluginName === 'MdlfAppIcon') return {
      getName: async () => (__icon.name ? { supported: __icon.supported, name: __icon.name } : { supported: __icon.supported }),
      change: async ({ name }) => {
        __icon.calls.push(name);
        if (__icon.fail) throw new Error('refusé');
        __icon.name = name; return name ? { name } : {};
      },
    };
    return new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) });
  },
};
"""


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_settings(page, theme, native_name='null', supported='true'):
    if native_name is not None:
        page.add_init_script(FAKE_SHELL % (native_name, supported))
    # Mises à jour à chaud : jamais de réseau pendant les tests
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json())
    page.click('[data-action="go-settings"]')
    page.wait_for_selector('.settings-view')
    page.wait_for_timeout(300)


def pressed(page):
    return page.evaluate("""() => [...document.querySelectorAll('.app-icon')]
        .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim())""")


def t_pwa(bench, eng, dev, theme):
    """Dans le navigateur : aucune trace de la section (une PWA ne change pas son icône)."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_settings(page, theme, native_name=None)
        R.check(page.evaluate('Native.isNative') is False, f'{t} PWA : pas natif')
        R.check(page.locator('.app-icons, [data-action="set-app-icon"]').count() == 0, f'{t} PWA : section absente')
        R.check("Icône de l'app" not in page.inner_text('.settings-view'), f'{t} PWA : titre absent')
        R.check(not page.errors, f'{t} PWA : aucune erreur JS {page.errors}')


def t_natif(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_settings(page, theme)
        R.check(page.evaluate('Native.isNative') is True, f'{t} app : coquille simulée')
        grid = page.locator('.app-icons')
        R.check(grid.count() == 1, f'{t} app : section présente')
        R.check(page.locator('#appIconTitle').inner_text().lower() == "icône de l'app", f'{t} titre de section')
        R.check(grid.get_attribute('aria-labelledby') == 'appIconTitle', f'{t} groupe nommé pour VoiceOver')
        tiles = page.locator('.app-icon')
        R.check([tiles.nth(i).inner_text().strip() for i in range(tiles.count())] == LABELS, f'{t} noms des icônes')
        R.check(pressed(page) == ['Orange'], f'{t} défaut coché : {pressed(page)}')
        R.check(page.locator('.app-icon[aria-pressed="true"] .app-icon__check').count() == 1, f'{t} coche sur l\'icône active')
        R.check(page.locator('.app-icon__img > svg[aria-hidden="true"]').count() == 5, f'{t} vignettes masquées à VoiceOver')
        sizes = page.evaluate("[...document.querySelectorAll('.app-icon')].map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; })")
        R.check(all(w >= 44 and h >= 44 for w, h in sizes), f'{t} cibles d\'au moins 44 pt {sizes}')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} pas de défilement horizontal')
        page.evaluate("document.querySelector('.app-icons').closest('.group').scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'reglages-icone-{t}')

        # iOS : rien ne doit bouger au pointerdown (sinon le tap est avalé)
        craie = page.locator('.app-icon[data-id="craie"]')
        before = page.evaluate("document.querySelector('.app-icons').outerHTML")
        craie.dispatch_event('pointerdown')
        page.wait_for_timeout(120)
        R.check(page.evaluate("document.querySelector('.app-icons').outerHTML") == before, f'{t} rien ne change au pointerdown')
        craie.dispatch_event('pointerup')

        craie.click()
        page.wait_for_timeout(250)
        R.check(page.evaluate('__icon.calls') == ['AppIcon-Craie'], f'{t} Craie : nom natif envoyé {page.evaluate("__icon.calls")}')
        R.check(pressed(page) == ['Craie'], f'{t} Craie cochée : {pressed(page)}')
        page.locator('.app-icon[data-id="craie"]').click()
        page.wait_for_timeout(200)
        R.check(len(page.evaluate('__icon.calls')) == 1, f'{t} icône déjà active : aucun appel')

        page.evaluate('__icon.fail = true')
        page.locator('.app-icon[data-id="signature"]').click()
        page.wait_for_timeout(300)
        R.check(pressed(page) == ['Craie'], f'{t} refus d\'iOS : coche inchangée')
        R.check("n'a pas pu être changée" in page.inner_text('body'), f'{t} refus d\'iOS : message affiché')
        page.evaluate('__icon.fail = false')

        page.locator('.app-icon[data-id="orange"]').click()
        page.wait_for_timeout(250)
        R.check(page.evaluate('__icon.calls')[-1] is None, f'{t} retour au défaut : nom natif null')
        R.check(pressed(page) == ['Orange'], f'{t} Orange cochée')
        R.check(not page.errors, f'{t} app : aucune erreur JS {page.errors}')

    # Icône alternative déjà choisie au lancement : cochée dès l'ouverture des Réglages
    with bench.page(eng, dev, theme) as page:
        open_settings(page, theme, native_name="'AppIcon-Signature'")
        R.check(pressed(page) == ['Signature'], f'{t} icône courante relue au lancement : {pressed(page)}')

    # iOS sans icônes alternatives : section masquée
    if dev == 'iPhone 13':
        with bench.page(eng, dev, theme) as page:
            open_settings(page, theme, supported='false')
            R.check(page.locator('.app-icons').count() == 0, f'{t} non pris en charge : section absente')


run_main(R, [t_pwa, t_natif])
