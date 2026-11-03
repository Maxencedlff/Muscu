"""Version minimale de l'app (« Mets à jour l'app », app_config.min_build, js/data/min-build.js et
js/app/updates.js) : une build native plus ancienne que le minimum du serveur affiche un écran plein
qui ne se ferme pas, avec un bouton vers l'App Store (app installée par l'App Store) ou TestFlight ;
les séances restent sur l'iPhone. Serveur injoignable : jamais bloqué. Navigateur : jamais affiché.
Jamais pendant une séance. Minimum abaissé ensuite : l'écran s'en va.

L'app iOS, StoreKit et Supabase sont simulés (tests/fake_account.py + tests/fake_store.py) : aucune
requête ne sort.
Captures : $PPL_SCRATCH/shots/lotmaj_obligatoire/ (clair et sombre, plus iPhone 15 Pro).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_maj_obligatoire.py (ou run_all.py maj_obligatoire).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT
from fake_store import FAKE_STORE

LOT = 'maj_obligatoire'
R = Results(LOT)
APP_STORE = 'https://apps.apple.com/app/id6823561962'


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, store=None, active=None):
    """App lancée avec la coquille iOS, Supabase et StoreKit simulés. store : réglages de __st."""
    st = {'paywallOn': False, 'appBuild': 25, 'minBuild': 30, **(store or {})}
    page.add_init_script('window.__fakeOpts = %s; window.__stOpts = %s;'
                         % (json.dumps({'oldAccounts': True}), json.dumps(st)))
    page.add_init_script(FAKE_ACCOUNT)
    page.add_init_script(FAKE_STORE)
    page.add_init_script("window.__opened = []; window.open = u => { window.__opened.push(u); return null; };")
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(), active=active, extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(500)


def foreground(page):
    """Retour de l'app au premier plan (visibilitychange)."""
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_timeout(400)


def screen(page):
    return page.inner_text('.min-build') if page.locator('.min-build').count() else ''


def app_inert(page):
    return page.evaluate("!!document.querySelector('#app')?.inert")


def t_ecran(bench, eng, dev, theme):
    """Build trop ancienne, app de l'App Store : écran plein, lien App Store, données intactes."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        page.wait_for_selector('.min-build', timeout=5000)
        txt = screen(page)
        R.check('Mets à jour l\'app' in txt and 'Tes séances restent enregistrées sur cet iPhone' in txt,
                f'{t} écran de mise à jour ({txt[:140]!r})')
        R.check('Version installée : 25 · requise : 30' in txt, f'{t} builds installée et requise affichées')
        R.check(page.inner_text('.min-build__btn') == 'Ouvrir l\'App Store', f'{t} bouton App Store')
        R.check(app_inert(page), f'{t} app inerte sous l\'écran (VoiceOver reste dans l\'écran)')
        R.check(page.evaluate("document.activeElement?.id") == 'minBuildTitle', f'{t} focus sur le titre')
        # Mise en page : écran entier, rien qui déborde, bouton à taille de pouce, rien de coupé
        box = page.evaluate("""() => { const r = document.querySelector('.min-build').getBoundingClientRect();
            const b = document.querySelector('.min-build__btn').getBoundingClientRect();
            return { w: r.width, h: r.height, bw: b.width, bh: b.height, bb: b.bottom, ih: innerHeight, iw: innerWidth }; }""")
        R.check(box['w'] >= box['iw'] - 1 and box['h'] >= box['ih'] - 1, f'{t} écran plein {box}')
        R.check(box['bh'] >= 44 and box['bb'] <= box['ih'], f'{t} bouton visible et assez grand {box}')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} pas de défilement horizontal')
        cut = page.evaluate("""() => [...document.querySelectorAll('.min-build *')].filter(e => e.children.length === 0
            && e.textContent.trim() && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 30))""")
        R.check(not cut, f'{t} aucun texte coupé {cut}')
        shot(page, LOT, f'01-ecran-{t}')
        page.click('.min-build__btn')
        R.check(page.evaluate('window.__opened') == [APP_STORE], f'{t} fiche App Store ouverte {page.evaluate("window.__opened")}')
        R.check(page.locator('.min-build').count() == 1, f'{t} l\'écran ne se ferme pas')
        R.check(page.evaluate('data.history.length') > 0, f'{t} séances intactes sur l\'iPhone')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_testflight(bench):
    """Installée par TestFlight (StoreKit Sandbox) : bouton et lien TestFlight."""
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        open_app(page, 'dark', store={'environment': 'sandbox'})
        page.wait_for_selector('.min-build', timeout=5000)
        R.check(page.inner_text('.min-build__btn') == 'Ouvrir TestFlight', 'TestFlight : bouton TestFlight')
        page.click('.min-build__btn')
        opened = page.evaluate('window.__opened')
        R.check(len(opened) == 1 and opened[0].startswith('https://testflight.apple.com/join/'), f'TestFlight : lien TestFlight {opened}')
        R.check(not page.errors, f'TestFlight : aucune erreur JS {page.errors}')


def t_a_jour(bench):
    """Build à jour, ou min_build à 0 (valeur livrée) : rien. Lecture faite sans compte (anon)."""
    for opts, name in (({'appBuild': 30, 'minBuild': 30}, 'build à jour'), ({'appBuild': 31, 'minBuild': 30}, 'build plus récente'),
                       ({'appBuild': 25, 'minBuild': 0}, 'min_build à 0')):
        with bench.page('webkit', 'iPhone 13', 'dark') as page:
            open_app(page, 'dark', store=opts)
            page.wait_for_timeout(500)
            reads = page.evaluate("__st.calls.filter(c => c[0] === 'app_config').map(c => c[1])")
            R.check('anon' in reads, f'{name} : min_build lu sans compte {reads}')
            R.check(page.locator('.min-build').count() == 0 and not app_inert(page), f'{name} : aucun écran de mise à jour')
            R.check(not page.errors, f'{name} : aucune erreur JS {page.errors}')


def t_hors_ligne(bench):
    """Serveur injoignable au lancement : jamais bloqué, l'app se lit normalement ; réseau revenu :
    l'écran arrive ; réseau reperdu ensuite : l'écran reste (pas de clignotement)."""
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        open_app(page, 'dark', store={'fail': {'config': 'offline'}})
        page.wait_for_timeout(500)
        R.check(page.locator('.min-build').count() == 0, 'hors ligne : aucun écran de mise à jour')
        page.evaluate("switchTab('history')")
        page.wait_for_timeout(400)
        R.check(page.locator('#app').inner_text().strip() != '' and not app_inert(page), 'hors ligne : Historique lisible')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        page.locator('[data-action="start-session"]').first.click()
        page.wait_for_timeout(500)
        R.check(page.evaluate('!!activeSession'), 'hors ligne : séance démarrée')
        page.evaluate('endSession()')
        page.wait_for_timeout(300)
        R.check(page.evaluate("Object.keys(localStorage).filter(k => /min.?build/i.test(k))") == [], 'hors ligne : rien gardé sur l\'appareil')
        # Le réseau revient : vérification aussitôt
        page.evaluate("__st.fail.config = null; window.dispatchEvent(new Event('online'))")
        page.wait_for_selector('.min-build', timeout=3000)
        R.check(True, 'réseau revenu : écran de mise à jour')
        page.evaluate("__st.fail.config = 'offline'")
        foreground(page)
        R.check(page.locator('.min-build').count() == 1, 'réseau reperdu : l\'écran reste')
        R.check(not page.errors, f'hors ligne : aucune erreur JS {page.errors}')


def t_seance(bench):
    """Séance en cours : l'écran attend ; séance finie puis retour au premier plan : il arrive."""
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        open_app(page, 'dark', store={'minBuild': 0})
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        page.locator('[data-action="start-session"]').first.click()
        page.wait_for_timeout(500)
        R.check(page.evaluate('!!activeSession'), 'séance démarrée')
        page.evaluate('__st.minBuild = 30')
        foreground(page)
        R.check(page.locator('.min-build').count() == 0, 'séance en cours : pas d\'écran')
        page.evaluate('endSession()')
        page.wait_for_timeout(300)
        foreground(page)
        R.check(page.locator('.min-build').count() == 1, 'séance finie : écran de mise à jour')
        R.check(page.evaluate('data.history.length') > 0, 'séance finie : historique gardé')
        R.check(not page.errors, f'séance : aucune erreur JS {page.errors}')


def t_abaisse(bench):
    """Minimum abaissé sur le serveur (valeur réglée par erreur) : l'écran s'en va au retour suivant."""
    with bench.page('webkit', 'iPhone 13', 'light') as page:
        open_app(page, 'light')
        page.wait_for_selector('.min-build', timeout=5000)
        page.evaluate('__st.minBuild = 25')
        foreground(page)
        R.check(page.locator('.min-build').count() == 0 and not app_inert(page), 'minimum abaissé : écran retiré, app utilisable')
        R.check(not page.errors, f'minimum abaissé : aucune erreur JS {page.errors}')


def t_navigateur(bench):
    """Navigateur (aucune coquille iOS) : jamais affiché, et aucune requête vers le serveur."""
    with bench.page('chromium', 'Pixel 7', 'dark') as page:
        asked = []
        page.route('**/*supabase.co/**', lambda route: (asked.append(route.request.url), route.abort()))
        page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
        seed(page, 'dark', ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
        page.wait_for_timeout(500)
        R.check(page.evaluate('checkMinBuild()') is False, 'navigateur : checkMinBuild ne bloque pas')
        page.evaluate("window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_timeout(400)
        R.check(page.locator('.min-build').count() == 0, 'navigateur : aucun écran')
        R.check(asked == [], f'navigateur : aucune requête au serveur {asked}')
        R.check(not page.errors, f'navigateur : aucune erreur JS {page.errors}')


def t_captures_15pro(bench):
    """Captures iPhone 15 Pro, clair et sombre (relecture visuelle)."""
    for theme in THEMES:
        with bench.page('webkit', 'iPhone 15 Pro', theme) as page:
            open_app(page, theme)
            page.wait_for_selector('.min-build', timeout=5000)
            bg = page.evaluate("getComputedStyle(document.querySelector('.min-build')).backgroundColor")
            if theme == 'dark':
                R.check(bg == 'rgb(0, 0, 0)', f'iPhone 15 Pro sombre : fond noir pur ({bg})')
            shot(page, LOT, f'00-iPhone_15_Pro-{theme}')
            R.check(not page.errors, f'iPhone 15 Pro {theme} : aucune erreur JS {page.errors}')


run_main(R, [t_ecran], once=[t_testflight, t_a_jour, t_hors_ligne, t_seance, t_abaisse, t_navigateur, t_captures_15pro])
