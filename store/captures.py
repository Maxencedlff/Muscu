"""Captures d'écran pour la fiche App Store (iPhone 6,9 pouces : 1320 × 2868 px).

Lancer depuis la racine du dépôt, serveur local sur le port 8731 :
    python3 -m http.server 8731 &
    python3 store/captures.py [sombre|clair]

Les données sont celles des tests (9 semaines d'historique réaliste). Les images sont écrites dans
store/screenshots/<thème>/, numérotées dans l'ordre de la fiche.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'tests'))
from fixtures import ppl_v2_today_json, seed  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

URL = os.environ.get('PPL_URL', 'http://localhost:8731/')
THEME = {'sombre': 'dark', 'clair': 'light'}[sys.argv[1] if len(sys.argv) > 1 else 'sombre']
OUT = os.path.join(HERE, 'screenshots', 'sombre' if THEME == 'dark' else 'clair')

# iPhone 6,9 pouces (16 Pro Max / 17 Pro Max) : 440 × 956 points, échelle 3
DEVICE = dict(viewport={'width': 440, 'height': 956}, device_scale_factor=3, is_mobile=True, has_touch=True,
              user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
                         '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
              color_scheme=THEME, service_workers='block')


def tab(page, i):
    page.locator('.tabbar [role=tab]').nth(i).click()
    page.wait_for_timeout(500)


def snap(page, name):
    page.wait_for_timeout(700)   # fin des animations et des toasts
    path = os.path.join(OUT, name + '.png')
    page.screenshot(path=path)
    print(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        browser = p.webkit.launch()
        page = browser.new_context(**DEVICE).new_page()
        seed(page, THEME, ppl_v2_today_json(), url=URL)

        snap(page, '1-accueil')

        # Séance : deux séries validées, repos en cours
        page.locator('[data-action="start-session"]').first.click()
        page.wait_for_selector('.view.session')
        for si in range(2):
            page.click(f'[data-action="validate-set"][data-ei="0"][data-si="{si}"]')
            page.wait_for_timeout(400)
        page.evaluate("document.querySelectorAll('.toast').forEach(t => t.remove())")
        snap(page, '2-seance')

        # Progrès › Développé couché : courbe de charge
        page.evaluate("handleAction(null, document.body, 'back')")
        page.wait_for_timeout(400)
        tab(page, 2)
        snap(page, '3-progres')
        page.locator('[data-action="open-stats-ex"]').first.click()
        page.wait_for_selector('.stats-canvas, canvas')
        snap(page, '4-progression-exercice')

        tab(page, 1)
        snap(page, '5-historique')

        tab(page, 3)
        snap(page, '6-programme')
        browser.close()


if __name__ == '__main__':
    main()
