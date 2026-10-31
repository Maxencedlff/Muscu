"""Captures de revue des 10 abonnements (champ « Capture d'écran pour la revue » d'App Store Connect).

Apple accepte pour ce champ toute taille des « Screenshot specifications » de l'app : ici l'iPhone
6,9 pouces, 1320 × 2868 px (440 × 956 points, échelle 3), la même que les captures de la fiche.
Chaque image montre l'écran d'abonnement RÉEL de l'app (verrou allumé, comme à l'examen), la formule
concernée au centre, avec son prix, l'essai et les mentions de la règle 3.1.2. StoreKit et le serveur
sont simulés (tests/fake_store.py, tests/fake_account.py) aux prix France du 30/10 : aucun achat,
aucune requête ne sort.

Lancer depuis la racine du dépôt, serveur local (port libre de ce chantier : 8843) :
    python3 -m http.server 8843 &
    PPL_URL=http://127.0.0.1:8843/ flock /tmp/ppl-e2e.lock python3 store/captures_revue.py [sombre|clair]

Images écrites dans docs/revue/<thème>/, une par produit, nommées par l'identifiant du produit.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'tests'))
from fixtures import ppl_v2_today_json, seed  # noqa: E402
from fake_account import FAKE_ACCOUNT  # noqa: E402
from fake_store import FAKE_STORE  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

URL = os.environ.get('PPL_URL', 'http://127.0.0.1:8843/')
THEME = {'sombre': 'dark', 'clair': 'light'}[sys.argv[1] if len(sys.argv) > 1 else 'sombre']
OUT = os.path.join(HERE, '..', 'docs', 'revue', 'sombre' if THEME == 'dark' else 'clair')
DEVICE = dict(viewport={'width': 440, 'height': 956}, device_scale_factor=3, is_mobile=True, has_touch=True,
              user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
                         '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
              color_scheme=THEME, service_workers='block')

P = 'com.mdlf.training.'
# (produit, onglet, période) dans l'ordre des niveaux du groupe d'abonnements (docs/PAYANT_V1.md)
PRODUCTS = [(f'{P}{t}.{per}', tab, 'month' if per == 'monthly' else 'year')
            for t, tab in (('pro', 'pro'), ('coach10', 'coach'), ('coach20', 'coach'), ('coach30', 'coach'), ('coachmax', 'coach'))
            for per in ('monthly', 'yearly')]


def open_app(page):
    page.add_init_script('window.__fakeOpts = %s; window.__stOpts = %s;'
                         % (json.dumps({'oldAccounts': True}), json.dumps({'paywallOn': True})))
    page.add_init_script(FAKE_ACCOUNT)
    page.add_init_script(FAKE_STORE)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, THEME, ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'}, url=URL)
    page.wait_for_timeout(300)
    page.evaluate("""async () => {
        await accountSignInWith('apple', async () => 'add');
        await accountSaveProfile({ username: 'revue' });
        __sb.makeCoach(__sb.meId()); await coachRefresh(); await coachProRefresh();
        access.loadedAt = 0; await accessRefresh(); }""")
    page.wait_for_timeout(400)


def show(page, product, tab, period):
    route = "makeRoute('paywall', 'offer', 'coach')" if tab == 'coach' else "makeRoute('paywall', 'offer')"
    page.evaluate(f"navigate({route})")
    page.wait_for_selector('.pay-view')
    page.wait_for_timeout(500)
    if tab == 'pro' and page.locator('[data-action="pay-tab"][data-tab="pro"]').count():
        page.click('[data-action="pay-tab"][data-tab="pro"]')
        page.wait_for_timeout(300)
    if tab == 'coach':
        page.click(f'[data-action="pay-period"][data-period="{period}"]')
        page.wait_for_timeout(300)
    btn = page.locator(f'[data-action="pay-buy"][data-id="{product}"]')
    if btn.count() != 1:
        raise SystemExit(f'{product} : formule absente de l\'écran')
    btn.evaluate("e => e.scrollIntoView({ block: 'center' })")
    page.evaluate("document.querySelectorAll('.toast').forEach(t => t.remove())")
    page.wait_for_timeout(500)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        browser = p.webkit.launch()
        page = browser.new_context(**DEVICE).new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        open_app(page)
        for i, (product, tab, period) in enumerate(PRODUCTS, 1):
            show(page, product, tab, period)
            path = os.path.join(OUT, f'{i:02d}-{product}.png')
            page.screenshot(path=path)
            print(path)
        browser.close()
        if errors:
            raise SystemExit(f'erreurs JS : {errors}')


if __name__ == '__main__':
    main()
