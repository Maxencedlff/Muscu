"""Scanner un aliment (docs/NUTRITION_V1.md, « Scanner un produit ») : feuille « Ajouter un aliment » avec
« Scanner un code-barres » en tête, produit trouvé sur Open Food Facts (fiche, grammes, kcal et macros, source),
déjà scanné (retrouvé sans réseau), introuvable (« Créer l'aliment », code gardé), hors ligne (« Réessayer »),
caméra refusée, et sans module natif (« Saisir un code-barres »).

Le module natif MdlfScanner est simulé (window.Capacitor, comme tests/test_coffre.py) et Open Food Facts est
intercepté (route Playwright) : aucune requête ne sort. Captures : $PPL_SCRATCH/shots/lotscan/.
Lancer : python3 test_scan_aliment.py (sans PPL_DEVICES : iPhone 13, SE, 17, 17 Pro Max et Air, clair et sombre)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'scan'
R = Results(LOT)
NOW = local_ms(2026, 11, 9, 12, 30, tz=PARIS)

FOUND, UNKNOWN, OFFLINE = '3017620422003', '96385074', '4006381333931'
PRODUCT = {'status': 1, 'code': FOUND, 'product': {'product_name': 'Pâte à tartiner noisettes', 'brands': 'Marque Test, Groupe',
           'quantity': '400 g', 'nutriments': {'energy-kcal_100g': 539, 'energy-kj_100g': 2252, 'proteins_100g': 6.3,
                                               'carbohydrates_100g': 57.5, 'fat_100g': 30.9, 'salt_100g': 0.107}}}
SKYR = {'status': 1, 'code': OFFLINE, 'product': {'product_name_fr': 'Skyr nature', 'brands': 'Laiterie',
        'nutriments': {'energy-kj_100g': 264, 'proteins_100g': 11, 'carbohydrates_100g': 4, 'fat_100g': 0.2}}}

# Coquille iOS factice : seul MdlfScanner répond ; window.__scan règle la prochaine lecture
FAKE_SHELL = """
window.__scan = { code: null, type: 'ean13', mode: 'ok' };
window.__scanCalls = 0;
const err = code => { const e = new Error(code); e.code = code; return e; };
const scanner = { scan: async () => { window.__scanCalls++;
  const s = window.__scan;
  if (s.mode === 'cancel') throw err('CANCELED');
  if (s.mode === 'denied') throw err('DENIED');
  return { code: s.code, type: s.type }; } };
window.Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => 'ios',
  isPluginAvailable: n => n === 'MdlfScanner',
  registerPlugin: name => name === 'MdlfScanner' ? scanner
    : name === 'App' ? { addListener: async () => ({ remove() {} }), getInfo: async () => ({ build: '41', version: '1.2' }) }
    : new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) }),
};
"""


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def plan_json():
    d = ppl_v2_today(now_ms=NOW)
    d['dietPlans'] = {'d_scan01': {'name': 'Mon plan', 'meals': [
        {'id': 'm1', 'name': 'Petit-déjeuner', 'items': []}, {'id': 'm2', 'name': 'Collation', 'items': []}]}}
    d['dietActive'] = 'd_scan01'
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


class Off:
    """Open Food Facts simulé : réponses par code, requêtes notées (aucune ne sort)."""
    def __init__(self, page):
        self.calls, self.mode = [], {}
        page.route('https://world.openfoodfacts.org/**', self.handle)

    def handle(self, route):
        req = route.request
        code = req.url.split('/product/')[1].split('.json')[0]
        self.calls.append({'url': req.url, 'headers': req.headers, 'code': code})
        mode = self.mode.get(code, 'unknown')
        if mode == 'offline':
            return route.abort('internetdisconnected')
        if mode == 'unknown':
            return route.fulfill(status=404, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                                 body=json.dumps({'status': 0, 'status_verbose': 'product not found', 'code': code}))
        body = PRODUCT if code == FOUND else SKYR
        route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))


def open_plan(page, theme, shell=True):
    if shell:
        page.add_init_script(FAKE_SHELL)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    off = Off(page)
    seed(page, theme, plan_json(), extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)
    page.evaluate("navigate(makeRoute('diet-plan', 'd_scan01'))")
    page.wait_for_selector('.diet-plan-view [data-action="diet-add-food"]')
    return off


def add_food_sheet(page, meal=0):
    page.locator('[data-action="diet-add-food"]').nth(meal).click()
    page.wait_for_selector('.diet-cand--scan')
    page.wait_for_timeout(250)


def scan(page, code, mode='ok', type_='ean13'):
    page.evaluate('([c, m, t]) => { window.__scan = { code: c, mode: m, type: t }; }', [code, mode, type_])
    page.click('.diet-cand--scan')


def sheet_layout(page, t, name):
    small = page.evaluate("""[...document.querySelectorAll('.sheet-root button, .ios-dialog button')].filter(e => e.offsetParent && getComputedStyle(e).visibility !== 'hidden')
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(e => e.textContent.trim().slice(0, 30))""")
    R.check(not small, f'{t} {name} : cibles de 44 pt {small}')
    R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} {name} : pas de défilement horizontal')
    over = page.evaluate("""[...document.querySelectorAll('.sheet-root .fscan *, .sheet-root .diet-cand__name')].filter(e => e.offsetParent && e.children.length === 0 && !e.closest('.sr-text')
        && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map(e => e.textContent.trim().slice(0, 30))""")
    R.check(not over, f'{t} {name} : aucun texte coupé {over}')
    R.check(not page.errors, f'{t} {name} : aucune erreur JS {page.errors[:2]}')


def t_scan(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        off = open_plan(page, theme)
        add_food_sheet(page)
        # Bouton en tête, avant la recherche, avec son icône
        order = page.evaluate("[...document.querySelector('.diet-pick').children].map(e => e.className.split(' ').pop() || e.id)")
        R.check(order[:2] == ['diet-cand--scan', 'search'], f'{t} feuille : « Scanner » en tête, avant la recherche {order[:3]}')
        R.check(page.inner_text('.diet-cand--scan').strip() == 'Scanner un code-barres' and page.locator('.diet-cand--scan svg use[href="#i-barcode"]').count() == 1,
                f'{t} feuille : « Scanner un code-barres » et son icône')
        sheet_layout(page, t, 'feuille Ajouter un aliment')
        page.evaluate('document.activeElement.blur()')   # capture sans clavier
        shot(page, LOT, f'1-feuille-scanner-{t}')

        # 1. Trouvé : fiche, source, 30 g → kcal et macros
        off.mode[FOUND] = 'found'
        scan(page, FOUND)
        page.wait_for_selector('.fscan__name')
        R.check(page.inner_text('.fscan__name') == 'Marque Test · Pâte à tartiner noisettes', f'{t} trouvé : « Marque · Nom »')
        txt = page.inner_text('.sheet-root .fscan').replace(' ', ' ').replace(' ', ' ')
        R.check('539 kcal' in txt and '6,3 g' in txt and '57,5 g' in txt and '30,9 g' in txt and '0,11 g' in txt, f'{t} trouvé : valeurs pour 100 g et sel')
        R.check('Open Food Facts' in txt and 'ODbL' in txt and 'contributeurs' in txt, f'{t} trouvé : source et licence sur la fiche')
        R.check(len(off.calls) == 1, f'{t} trouvé : une requête ({len(off.calls)})')
        h = off.calls[0]['headers']
        R.check(h.get('x-user-agent') == 'MDLF Training/1.2 (iOS)' and '@' not in json.dumps(h) and 'cookie' not in h, f'{t} requête : User-Agent de l\'app, sans contact ni cookie ({h.get("x-user-agent")})')
        R.check('fields=product_name,product_name_fr,brands,nutriments,quantity' in off.calls[0]['url'], f'{t} requête : champs demandés')
        R.check(page.evaluate(f"dietFoodByCode(data.dietFoods, '{FOUND}')?.src") == 'off', f'{t} trouvé : gardé dans Mes aliments')
        page.fill('#fscanG', '30')
        tot = page.inner_text('#fscanTotal').replace(' ', ' ')
        R.check('30 g : 162 kcal' in tot, f'{t} 30 g : kcal recalculées ({tot!r})')
        R.check('grammes de protéines' in page.text_content('#fscanTotal .sr-text'), f'{t} VoiceOver : total en toutes lettres')
        page.focus('.fscan__name')   # capture sans clavier (focus rendu au titre de la fiche, comme à l'ouverture)
        sheet_layout(page, t, 'produit trouvé')
        shot(page, LOT, f'2-produit-trouve-{t}')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(400)
        it = page.evaluate("data.dietPlans.d_scan01.meals[0].items[0]")
        R.check(it and it['g'] == 30 and it['src'] == 'off' and it['per']['k'] == 539, f'{t} ajouté au repas : 30 g, source off ({it})')
        R.check('162 kcal' in page.inner_text('.diet-plan-view').replace(' ', ' '), f'{t} plan : 162 kcal affichées')
        R.check('Open Food Facts' in page.inner_text('.diet-plan-view'), f'{t} plan : attribution au pied')

        # 2. Déjà scanné : retrouvé sans réseau
        off.mode[FOUND] = 'offline'
        add_food_sheet(page, 1)
        scan(page, FOUND)
        page.wait_for_selector('.fscan__name')
        R.check(len(off.calls) == 1, f'{t} déjà scanné : aucune requête ({len(off.calls)})')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(400)
        R.check(page.evaluate("data.dietPlans.d_scan01.meals[1].items[0]?.g") == 100, f'{t} déjà scanné : 100 g d\'office')

        # 3. Introuvable : « Créer l'aliment », code gardé, retrouvé au scan suivant
        add_food_sheet(page, 1)
        scan(page, UNKNOWN, type_='ean8')
        page.wait_for_selector('.fscan__state [data-fscan="create"]')
        R.check(page.inner_text('.fscan__title') == 'Produit introuvable', f'{t} introuvable : titre')
        R.check(page.evaluate("getComputedStyle(document.querySelector('.sheet-root .sheet__btn--confirm')).visibility") == 'hidden', f'{t} introuvable : pas de « Ajouter »')
        sheet_layout(page, t, 'introuvable')
        shot(page, LOT, f'3-introuvable-{t}')
        page.click('[data-fscan="create"]')
        page.wait_for_selector('#dietFoodName')
        R.check(page.input_value('#dietFoodName') == '' and '9638 5074' in page.inner_text('.diet-form').replace(' ', ' '), f'{t} création : nom vide, code rappelé')
        page.fill('#dietFoodName', 'Barre protéinée')
        for k, v in (('P', '30'), ('C', '40'), ('F', '12')):
            page.fill(f'#dietFood{k}', v)
        page.click('.sheet-root .sheet__btn--confirm')
        page.wait_for_selector('.ios-dialog__input')
        page.fill('.ios-dialog__input', '45')
        tap_dialog(page, 'OK')
        page.wait_for_timeout(300)
        R.check(page.evaluate(f"dietFoodByCode(data.dietFoods, '{UNKNOWN}')?.name") == 'Barre protéinée', f'{t} créé : gardé avec son code')
        R.check(page.evaluate("data.dietPlans.d_scan01.meals[1].items[1]?.g") == 45, f'{t} créé : ajouté au repas')
        n = len(off.calls)
        add_food_sheet(page, 1)
        scan(page, UNKNOWN, type_='ean8')
        page.wait_for_selector('.fscan__name')
        R.check(page.inner_text('.fscan__name') == 'Barre protéinée' and len(off.calls) == n and 'Ton aliment' in page.inner_text('.fscan'),
                f'{t} créé puis rescanné : retrouvé sur l\'appareil')
        page.click('.sheet-root .sheet__btn--cancel')
        page.wait_for_timeout(300)

        # 4. Hors ligne : « Réessayer » puis trouvé
        off.mode[OFFLINE] = 'offline'
        add_food_sheet(page, 1)
        scan(page, OFFLINE)
        page.wait_for_selector('[data-fscan="retry"]')
        R.check(page.inner_text('.fscan__title') == 'Pas de réseau', f'{t} hors ligne : dit tel quel')
        sheet_layout(page, t, 'hors ligne')
        shot(page, LOT, f'4-hors-ligne-{t}')
        off.mode[OFFLINE] = 'found'
        page.click('[data-fscan="retry"]')
        page.wait_for_selector('.fscan__name')
        txt = page.inner_text('.fscan').replace(' ', ' ')
        R.check(page.inner_text('.fscan__name') == 'Laiterie · Skyr nature' and '63 kcal' in txt, f'{t} réessayé : trouvé, kcal depuis les kJ ({txt[:80]!r})')
        page.click('.sheet-root .sheet__btn--cancel')
        page.wait_for_timeout(300)
        R.check(page.evaluate(f"!!dietFoodByCode(data.dietFoods, '{OFFLINE}')"), f'{t} annulé après la fiche : produit gardé quand même')

        # 5. Annulé dans le lecteur : rien
        add_food_sheet(page, 1)
        scan(page, None, mode='cancel')
        page.wait_for_timeout(500)
        R.check(page.locator('.fscan').count() == 0 and page.locator('.ios-dialog').count() == 0, f'{t} lecteur fermé : rien ne s\'ouvre')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


def t_sans_module(bench):
    """Navigateur (aucun module natif) : « Saisir un code-barres », chiffres vérifiés, même fiche ; caméra refusée."""
    for theme in THEMES:
        t = tag('iPhone 13', theme)
        with bench.frozen_page(NOW, 'webkit', 'iPhone 13', theme) as page:
            off = open_plan(page, theme, shell=False)
            off.mode[FOUND] = 'found'
            add_food_sheet(page)
            R.check(page.inner_text('.diet-cand--scan').strip() == 'Saisir un code-barres', f'{t} sans caméra : « Saisir un code-barres »')
            page.click('.diet-cand--scan')
            page.wait_for_selector('.ios-dialog__input')
            R.check(page.get_attribute('.ios-dialog__input', 'inputmode') == 'numeric', f'{t} saisie : clavier numérique')
            page.fill('.ios-dialog__input', '3017620422004')
            tap_dialog(page, 'Rechercher')
            page.wait_for_selector('.ios-dialog__input')
            R.check('ne tient pas' in page.inner_text('.ios-dialog__msg') and page.input_value('.ios-dialog__input') == '3017620422004' and not off.calls,
                    f'{t} saisie fausse : redemandée, chiffres gardés, rien envoyé')
            page.fill('.ios-dialog__input', '3 017620 422003')
            tap_dialog(page, 'Rechercher')
            page.wait_for_selector('.fscan__name')
            R.check(len(off.calls) == 1 and off.calls[0]['code'] == FOUND, f'{t} saisie : même recherche')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')
    with bench.frozen_page(NOW, 'webkit', 'iPhone SE', 'dark') as page:
        open_plan(page, 'dark')
        add_food_sheet(page)
        scan(page, None, mode='denied')
        page.wait_for_selector('.ios-dialog')
        R.check('Réglages › MDLF Training' in page.inner_text('.ios-dialog'), 'caméra refusée : où l\'autoriser')
        tap_dialog(page, 'Taper le code')
        page.wait_for_selector('.ios-dialog__input')
        R.check(page.inner_text('.ios-dialog__title') == 'Code-barres', 'caméra refusée : saisie proposée')
        R.check(not page.errors, f'caméra refusée : aucune erreur JS {page.errors[:2]}')


def t_grand_texte(bench):
    """Texte agrandi (33 px) sur iPhone SE : feuille et fiche sans débordement."""
    css = "(() => { const st = document.createElement('style'); st.textContent = 'html { font: 33px -apple-system, system-ui, sans-serif !important; }'; const put = () => { if (!document.documentElement) return false; document.documentElement.appendChild(st); return true; }; if (!put()) new MutationObserver((m, o) => { if (put()) o.disconnect(); }).observe(document, { childList: true }); })()"
    for theme in THEMES:
        t = tag('iPhone SE', theme) + '-texte-agrandi'
        with bench.frozen_page(NOW, 'webkit', 'iPhone SE', theme) as page:
            page.add_init_script(css)
            off = open_plan(page, theme)
            off.mode[FOUND] = 'found'
            add_food_sheet(page)
            R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} feuille : pas de débordement')
            scan(page, FOUND)
            page.wait_for_selector('.fscan__name')
            page.focus('.fscan__name')
            sheet_layout(page, t, 'fiche')
            shot(page, LOT, f'5-fiche-{t}')


# Appareils du lot : les deux de référence (ERGONOMIE.md) et les iPhone récents (tests/test_ecrans_recents.py)
SCAN_DEVICES = 'iPhone 13,iPhone SE,iPhone 17,iPhone 17 Pro Max,iPhone Air'

if __name__ == '__main__':
    if not os.environ.get('PPL_DEVICES') and not os.environ.get('PPL_DEV'):
        os.environ['PPL_DEVICES'] = SCAN_DEVICES
    run_main(R, [t_scan], once=[t_sans_module, t_grand_texte])
