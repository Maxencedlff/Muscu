"""Captures de l'appli web du coach (docs/COACH_WEB.md) : chaque écran, sombre et clair, à 1440, 1180 et 820 px.
Vague 2 : Mes bilans (et un suivi ouvert), onglet Bilans de la fiche, Bilans reçus.

    python3 tests/coach_web_captures.py [dossier] [moteur]

Dossier par défaut : $PPL_SCRATCH/shots/coach-web ; moteur : chromium (webkit, firefox possibles). Données factices
de tests/coach_web_fixtures.py (aucun réseau, aucun vrai compte). Sans fenêtre à l'écran (headless).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright  # noqa: E402
from coach_web_fixtures import static_server, launch, open_desk  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('PPL_SCRATCH', '/tmp/ppl-tests'), 'shots', 'coach-web')
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
SIZES = [(1440, 900), (1180, 820), (820, 1180)]


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as pw, static_server() as url:
        browser = launch(pw, ENGINE)
        try:
            for theme in ('dark', 'light'):
                for w, h in SIZES:
                    tag = f'{w}_{theme}'
                    ctx, page = open_desk(browser, url, width=w, height=h, theme=theme, login=False)
                    page.screenshot(path=os.path.join(OUT, f'0-connexion_{tag}.png'))
                    ctx.close()
                    ctx, page = open_desk(browser, url, width=w, height=h, theme=theme, touch=w < 1200)
                    page.mouse.move(0, 0)
                    full = w >= 900   # tablette en portrait : barre d'onglets fixe, capture de l'écran
                    page.screenshot(path=os.path.join(OUT, f'1-tableau-de-bord_{tag}.png'), full_page=full)
                    lea = page.evaluate('window.__lea')
                    page.evaluate(f"location.hash = '#/eleve/{lea}'")
                    page.wait_for_selector('table.wk')
                    page.mouse.move(0, 0)
                    page.screenshot(path=os.path.join(OUT, f'2-fiche-semaines_{tag}.png'), full_page=full)
                    if page.errors:
                        print(tag, 'erreurs :', page.errors)
                    ctx.close()
                    # Vague 2 : bilans configurables (données de COACH_WEB_CHECKINS_SEED)
                    ctx, page = open_desk(browser, url, width=w, height=h, theme=theme, touch=w < 1200, checkins=True)
                    page.evaluate("location.hash = '#/bilans'")
                    page.wait_for_selector('#ck-name')
                    page.mouse.move(0, 0)
                    page.screenshot(path=os.path.join(OUT, f'3-mes-bilans_{tag}.png'), full_page=full)
                    page.click('#main-sleep')
                    page.mouse.move(0, 0)
                    page.screenshot(path=os.path.join(OUT, f'3b-mes-bilans-suivi_{tag}.png'), full_page=full)
                    page.evaluate("location.hash = '#/eleve/' + window.__lea + '/bilans'")
                    page.wait_for_selector('.rv-cur')
                    page.mouse.move(0, 0)
                    page.screenshot(path=os.path.join(OUT, f'4-fiche-bilans_{tag}.png'), full_page=full)
                    page.evaluate("location.hash = '#/bilans-recus'")
                    page.wait_for_selector('#h-todo')
                    page.screenshot(path=os.path.join(OUT, f'5-bilans-recus_{tag}.png'), full_page=full)
                    if page.errors:
                        print(tag, 'erreurs (bilans) :', page.errors)
                    ctx.close()
        finally:
            browser.close()
    print('Captures dans', OUT)


if __name__ == '__main__':
    main()
