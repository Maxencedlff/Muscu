"""Captures des plans diète de l'appli web du coach (docs/COACH_WEB.md, « Plans diète ») : sombre et clair, 1440, 1180
et 820 px, puis une planche par écran (sombre et clair côte à côte, si Pillow est là).

    python3 tests/coach_web_captures_diete.py [dossier] [moteur]

Dossier par défaut : $PPL_SCRATCH/shots/coach-web-diete ; moteur : chromium. Données factices de
tests/coach_web_fixtures.py, Open Food Facts simulé (aucun réseau). Sans fenêtre à l'écran (headless).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright  # noqa: E402
from coach_web_fixtures import static_server, launch, open_desk  # noqa: E402
from test_coach_web_diete import route_off  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('PPL_SCRATCH', '/tmp/ppl-tests'), 'shots', 'coach-web-diete')
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
SIZES = [(1440, 900), (1180, 820), (820, 1180)]
NAMES = ['1-plans', '2-editeur', '3-recherche', '4-quantite-oeufs', '5-equivalents', '6-semaine-options', '7-code-barres', '8-nutrition-eleve', '9-plan-recu-modifie']


def wait(page, expr):
    for _ in range(100):
        if page.evaluate(expr):
            return
        page.wait_for_timeout(100)


def capture(browser, url, w, h, theme):
    tag = f'{w}_{theme}'
    ctx, page = open_desk(browser, url, width=w, height=h, theme=theme, touch=w < 1200, v4=True, diete=True)
    route_off(ctx)

    def shot(name):
        page.mouse.move(0, 0)
        page.wait_for_timeout(250)
        page.screenshot(path=os.path.join(OUT, f'{name}_{tag}.png'))
    page.evaluate("location.hash = '#/plans-diete'")
    page.wait_for_selector('.dt-pl')
    shot('1-plans')
    page.click('.dt-pl-a >> nth=0')
    page.wait_for_selector('.dt-it')
    wait(page, "dt.foods === 'ready'")
    shot('2-editeur')
    page.click('[data-dt="add"] >> nth=1')
    page.fill('#dtp-q', 'riz basmati')
    page.wait_for_selector('#dtp-o-0')
    shot('3-recherche')
    page.fill('#dtp-q', 'oeuf dur')
    page.wait_for_selector('#dtp-o-0')
    page.keyboard.press('Enter')
    page.wait_for_selector('#dtp-qty')
    page.fill('#dtp-qty', '2')
    page.dispatch_event('#dtp-qty', 'input')
    shot('4-quantite-oeufs')
    page.click('[data-p="add"]')
    wait(page, "!document.querySelector('dialog[open]')")
    page.click('[data-dt="swap"] >> nth=2')
    page.wait_for_selector('dialog[open]')
    shot('5-equivalents')
    page.keyboard.press('Escape')
    page.click('[data-dt="mode"][data-v="week"]')
    page.wait_for_selector('[data-dt="day"][data-v="6"]')
    page.click('[data-dt="day"][data-v="2"]')
    page.click('[data-dt="kind"][data-v="r"]')
    page.click('[data-dt="opts"] >> nth=0')
    page.evaluate('window.scrollTo(0, 0)')
    shot('6-semaine-options')
    page.click('[data-dt="add"] >> nth=0')
    page.click('[data-p="barcode"]')
    page.fill('#dtp-code', '3017620422003')
    page.press('#dtp-code', 'Enter')
    page.wait_for_selector('#dtp-qty')
    shot('7-code-barres')
    page.keyboard.press('Escape')
    page.evaluate("dt.saved = deskDtSnap(dt.draft); dt.fresh = false")   # pas de confirmation pour la suite des captures
    page.evaluate("location.hash = '#/eleve/' + window.__lea + '/nutrition'")
    page.wait_for_selector('.nt-acts')
    page.wait_for_selector('.nt-day')
    shot('8-nutrition-eleve')
    page.click('[data-dt="edit-sent"]')
    page.wait_for_selector('.dt-it')
    page.locator('[data-dt-f="qty"]').first.fill('70')
    page.wait_for_timeout(700)
    shot('9-plan-recu-modifie')
    if page.errors:
        print(tag, 'erreurs :', page.errors)
    ctx.close()


def boards():
    try:
        from PIL import Image
    except ImportError:
        print('Pillow absent : pas de planche')
        return
    for name in NAMES:
        for w, _ in SIZES:
            a, b = (os.path.join(OUT, f'{name}_{w}_{t}.png') for t in ('dark', 'light'))
            if not (os.path.exists(a) and os.path.exists(b)):
                continue
            ia, ib = Image.open(a), Image.open(b)
            board = Image.new('RGB', (ia.width + ib.width + 24, max(ia.height, ib.height)), (128, 128, 128))
            board.paste(ia, (0, 0))
            board.paste(ib, (ia.width + 24, 0))
            board.save(os.path.join(OUT, f'planche_{name}_{w}.png'))


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as pw, static_server() as url:
        browser = launch(pw, ENGINE)
        try:
            for theme in ('dark', 'light'):
                for w, h in SIZES:
                    capture(browser, url, w, h, theme)
        finally:
            browser.close()
    boards()
    print('Captures dans', OUT)


if __name__ == '__main__':
    main()
