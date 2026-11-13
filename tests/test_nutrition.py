"""Nutrition V1 (docs/NUTRITION_V1.md) : plan diète créé sans coach (Programme › Plans diète, recherche
dans la base Ciqual, quantité, objectifs), journée dans Entraînement › Nutrition (frise, anneau, repas
cochés d'un toucher, repas suivant, remplacement d'un aliment pour la journée), carte de l'accueil
(cocher le prochain repas sans ouvrir l'écran), plan envoyé par le coach (fiche de l'élève, canal des
programmes) et reçu par l'élève (carte de l'accueil, « Utiliser ce plan », Mon coach), base indisponible.

L'app iOS et Supabase sont simulés (tests/fake_account.py) : aucune requête ne sort. Captures :
$PPL_SCRATCH/shots/lotnutrition/ (chaque écran, clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_nutrition.py (ou run_all.py nutrition).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'nutrition'
R = Results(LOT)
# Jeudi 5 novembre 2026, 13 h 40 à Paris : « aujourd'hui » et la frise ne dépendent pas du jour du test
NOW = local_ms(2026, 11, 5, 13, 40, tz=PARIS)

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'foods.json'), encoding='utf-8') as fh:
    FOODS = {r[0]: r for r in json.load(fh)['foods']}


def food_item(code, g, iid):
    r = FOODS[code]
    return {'id': iid, 'name': r[1], 'food': code, 'fam': r[2], 'g': g, 'per': {'k': r[3], 'p': r[4], 'c': r[5], 'f': r[6]}}


RIZ, POULET, OEUF, BANANE, HUILE = 9104, 36018, 22010, 13005, 17270
PLAN = {'name': 'Prise de masse', 'targets': {'kcal': 2600, 'p': 160}, 'meals': [
    {'id': 'm1', 'name': 'Petit-déjeuner', 'items': [food_item(OEUF, 150, 'i1'), food_item(BANANE, 120, 'i2')]},
    {'id': 'm2', 'name': 'Déjeuner', 'note': 'Pèse le riz cuit.', 'items': [food_item(RIZ, 200, 'i3'), food_item(POULET, 150, 'i4'), food_item(HUILE, 10, 'i5')]},
    {'id': 'm3', 'name': 'Collation', 'items': [food_item(BANANE, 120, 'i6')]},
    {'id': 'm4', 'name': 'Dîner', 'items': [food_item(RIZ, 150, 'i7'), food_item(POULET, 120, 'i8')]},
]}


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def with_plan(now_ms, log=None):
    d = ppl_v2_today(now_ms=now_ms)
    d['dietPlans'] = {'d_masse01': PLAN}
    d['dietActive'] = 'd_masse01'
    if log:
        d['dietLog'] = log
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


def open_app(page, theme, ppl_v2=None, account=False):
    if account:
        page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
        page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2, extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username):
    page.evaluate("async u => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: u }); }", username)
    page.wait_for_timeout(200)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small_targets(page, sel='#app button, .tabbar button'):
    # Rebond du rond coché fini d'abord (.vv-fill : 0,86 → 1,08 → 1 en 0,34 s, direction sobre et vivante) : une cible
    # mesurée en plein rebond paraissait sous 44 pt. Seulement lui : attendre toutes les animations laisserait partir
    # les toasts (et leur « Annuler ») avant la suite du test.
    page.evaluate("""() => Promise.all(document.getAnimations().filter(a => a.effect?.target?.closest?.('.vv-fill'))
        .map(a => a.finished.catch(() => null)))""")
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def cut_texts(page, scope='#app'):
    """Textes coupés. Titre compact d'un écran à grand titre exclu : il se coupe au défilement comme sur iOS, le nom entier est dans le grand titre."""
    return page.evaluate("""s => [...document.querySelectorAll(s + ' *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .sr-text, .navbar--large .navbar__title') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""", scope)


def layout(page, t, name, scope='#app'):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page, f'{scope} button, .tabbar button')
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page, scope)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')
    R.check(not page.errors, f'{t} {name} : aucune erreur JS {page.errors[:2]}')


LIVE_SHEET = '.sheet-root:not(.sheet-root--out)'


def qty_grams(page, g):
    """Quantité en grammes : feuille à l'unité (« Grammes | œuf », js/features/diet-qty.js) ou alerte à champ (sans unité)."""
    page.wait_for_selector(f'{LIVE_SHEET} #qtyVal, .ios-dialog__input')
    if page.locator(f'{LIVE_SHEET} #qtyVal').count():
        page.click(f'{LIVE_SHEET} [data-qmode="-1"]')
        page.fill(f'{LIVE_SHEET} #qtyVal', g)
        page.click(f'{LIVE_SHEET} .sheet__btn--confirm')
    else:
        page.fill('.ios-dialog__input', g)
        tap_dialog(page, 'OK')


def toast(page):
    return page.locator('.toast').inner_text() if page.locator('.toast').count() else ''


def kcal_eaten(page):
    return page.evaluate("Math.round(dietDayProgress(data, data.dietActive).eaten.kcal)")


def t_journee(bench, eng, dev, theme):
    """Plan suivi : accueil, cocher depuis la carte, écran Nutrition, repas suivant, remplacement du jour."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, with_plan(NOW))
        card = page.locator('.diet-home')
        R.check(card.count() == 1 and 'nutrition' in card.inner_text().lower() and 'Petit-déjeuner' in card.inner_text(), f'{t} accueil : carte Nutrition avec le prochain repas')
        R.check(small_targets(page, '.diet-home button') == [], f'{t} carte : 44 pt')
        # Bouton à cocher (panel vague 4) : rond vide gris, le même qu'une série à valider en séance ; la coche n'est
        # dessinée qu'une fois coché (rond orange avec sa coche : lu « déjà fait »)
        ring = page.evaluate("""() => { const b = document.querySelector('.diet-home .diet-check'), probe = document.createElement('span');
            probe.style.color = 'var(--set-ring)'; document.body.append(probe); const set = getComputedStyle(probe).color; probe.remove();
            return { ring: getComputedStyle(b).boxShadow, set, op: getComputedStyle(b.querySelector('.icon')).opacity }; }""")
        R.check(page.locator('.diet-home .diet-check').count() == 1 and float(ring['op']) == 0 and ring['set'] in ring['ring'],
                f'{t} carte : rond vide gris comme en séance, sans coche avant de cocher {ring}')
        shot(page, LOT, f'1-accueil-{t}')
        card.scroll_into_view_if_needed()
        shot(page, LOT, f'1b-accueil-carte-{t}')
        # Cocher depuis l'accueil : un seul toucher, le repas suivant prend la place
        page.click('.diet-home [data-action="diet-check"]')
        page.wait_for_timeout(250)
        R.check(page.evaluate("dietDayProgress(data, data.dietActive).meals[0].done") is True, f'{t} accueil : petit-déjeuner coché d\'un toucher')
        R.check(page.locator('.diet-home__meal--next[data-meal="m2"] [data-action="diet-check"]').count() == 1
                and page.locator('.diet-home__meal--done[data-meal="m1"] .diet-home__done').count() == 1, f'{t} accueil : petit-déjeuner coché, le déjeuner a le bouton')
        R.check(page.evaluate("JSON.parse(localStorage.getItem('ppl_v2')).dietLog['2026-11-05'].done[0]") == 'm1', f'{t} coche enregistrée')
        # Écran Nutrition
        page.click('.diet-home__open')
        page.wait_for_selector('.nutrition-view .diet-sum')
        # Journal : même rond vide que sur l'accueil ; l'appel « Coche ton… » est du texte seul (plus de deuxième rond)
        jc = page.evaluate("""() => { const b = document.querySelector('.nutrition-view .diet-check:not(.diet-check--on)'); if (!b) return null;
            const p = document.createElement('span'); p.style.color = 'var(--set-ring)'; document.body.append(p); const set = getComputedStyle(p).color; p.remove();
            return parseFloat(getComputedStyle(b.querySelector('.icon')).opacity) === 0 && getComputedStyle(b).boxShadow.includes(set); }""")
        R.check(jc is True and page.locator('.diet-sum__call-dot').count() == 0, f'{t} journal : pas coché = rond vide gris, un seul dessin ({jc})')
        txt = page.inner_text('.nutrition-view')
        R.check("Aujourd'hui" in txt and 'Prise de masse' in txt and big_title(page) == "Aujourd'hui" and page.inner_text('.navbar__large').strip() == 'Nutrition'
                and page.inner_text('[data-action="diet-open-plan"]').strip() == 'Mon plan', f'{t} Nutrition : titre Nutrition, jour et plan, bouton Mon plan')
        R.check('sur 2 600 kcal' in txt.replace(' ', ' ').replace('\xa0', ' '), f'{t} Nutrition : objectif de calories du plan')
        # Calories et protéines fixées, pas les glucides ni les lipides : pas de repère tiré du plan (il ne colle pas aux 2 600 kcal)
        R.check(page.locator('.diet-bar--p:not(.diet-bar--free) .diet-bar__track').count() == 1 and page.locator('.diet-bar--free').count() == 2
                and '/' not in page.inner_text('.diet-bar--c') and "Pas d'objectif" in page.inner_text('.diet-bar--f'), f'{t} Nutrition : glucides et lipides sans repère inventé')
        R.check(page.locator('.diet-week__day').count() == 7 and page.get_attribute('.diet-week__day--on', 'data-day') == '2026-11-05', f'{t} frise : 7 jours, aujourd\'hui choisi')
        R.check(page.locator('.diet-meal--done').count() == 1 and page.locator('.diet-meal--done .diet-item').count() == 0, f'{t} repas coché replié')
        R.check(page.locator('.diet-meal--next[data-meal="m2"]').count() == 1 and 'ensuite' in page.inner_text('.diet-meal--next').lower(), f'{t} déjeuner marqué « Ensuite »')
        nx = page.evaluate("""() => { const e = document.querySelector('.diet-meal--next .diet-meal__eyebrow'), p = document.createElement('i');
            p.style.color = 'var(--tint)'; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return getComputedStyle(e).color === c; }""")
        R.check(nx, f'{t} « Ensuite » en couleur d\'action, pas le vert de « fait »')
        R.check('Pèse le riz cuit.' in txt, f'{t} consigne du repas')
        R.check('Ciqual 2025' in txt and 'Licence Ouverte Etalab 2.0' in txt and 'avis médical' in txt, f'{t} source, licence et précaution citées')
        R.check('0810 037 037' in txt, f'{t} ligne d\'écoute en bas de l\'écran')
        layout(page, t, 'Nutrition')
        shot(page, LOT, f'2-nutrition-{t}')
        page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
        shot(page, LOT, f'2b-nutrition-bas-{t}')
        page.evaluate('window.scrollTo(0, 0)')
        # Remplacer le riz du déjeuner : équivalents proposés, quantité recalculée, pour aujourd'hui seulement
        before = kcal_eaten(page)
        page.click('.diet-item[data-item="i3"]')
        page.wait_for_selector('.diet-swap .diet-cand')
        sw = page.inner_text('.diet-swap')
        R.check('Mêmes calories' in sw and "aujourd'hui" in sw, f'{t} remplacer : règle et durée dites')
        n = page.locator('.diet-cands .diet-cand').count()
        R.check(5 <= n <= 10, f'{t} remplacer : {n} équivalents')
        R.check(small_targets(page, '.sheet button.diet-cand') == [], f'{t} remplacer : 44 pt')
        shot(page, LOT, f'3-remplacer-{t}')
        name = page.locator('.diet-cands .diet-cand .diet-cand__name').first.inner_text()
        page.locator('.diet-cands .diet-cand').first.click()
        page.wait_for_timeout(400)
        R.check(page.evaluate("dietDayProgress(data, data.dietActive).swaps.i3?.name") == name, f'{t} remplacé par {name}')
        R.check('Remplace Riz blanc' in page.inner_text('.diet-item[data-item="i3"]'), f'{t} ligne : « Remplace Riz blanc… »')
        R.check(page.evaluate("data.dietPlans.d_masse01.meals[1].items[0].food") == RIZ, f'{t} le plan ne change pas')
        # Cocher le déjeuner : compté avec le remplaçant
        page.click('.diet-meal[data-meal="m2"] [data-action="diet-check"]')
        page.wait_for_timeout(300)
        lunch = page.evaluate("Math.round(dietDayProgress(data, data.dietActive).meals[1].macros.kcal)")
        R.check(kcal_eaten(page) == before + lunch, f'{t} déjeuner compté ({before} + {lunch})')
        R.check(page.get_attribute('.diet-meal[data-meal="m2"] [data-action="diet-check"]', 'aria-pressed') == 'true', f'{t} bouton coché (aria-pressed)')
        # Déplier un repas coché, le décocher
        page.click('.diet-meal[data-meal="m1"] .diet-meal__title')
        page.wait_for_timeout(200)
        R.check(page.locator('.diet-meal[data-meal="m1"] .diet-item[data-action="diet-swap"]').count() == 2, f'{t} repas coché déplié au toucher')
        # Journée complète
        for m in ('m3', 'm4'):
            page.click(f'.diet-meal[data-meal="{m}"] [data-action="diet-check"]')
            page.wait_for_timeout(250)
        R.check('Journée complète' in page.inner_text('.diet-sum'), f'{t} journée complète')
        shot(page, LOT, f'4-journee-complete-{t}')
        # Bug du 09/11 (Maxence) : dîner et collation déjà cochés, journée complète, on ne pouvait plus rien y ajouter.
        # Déplier le dîner coché, « Ajouter un aliment » : il reste coché, ses totaux et ceux du jour se recalculent
        before, plan_items = kcal_eaten(page), page.evaluate("data.dietPlans.d_masse01.meals[3].items.length")
        page.click('.diet-meal[data-meal="m4"] .diet-meal__title')
        page.wait_for_timeout(200)
        R.check(page.get_attribute('.diet-meal[data-meal="m4"] .diet-meal__title', 'aria-expanded') == 'true'
                and page.locator('.diet-meal[data-meal="m4"] .diet-meal__more .icon').count() == 1, f'{t} dîner coché : chevron, déplié')
        add = '.diet-meal[data-meal="m4"] [data-action="diet-day-add"]'
        R.check(page.locator(add).count() == 1 and 'Dîner' in (page.get_attribute(add, 'aria-label') or ''), f'{t} dîner coché : « Ajouter un aliment » (nommé)')
        shot(page, LOT, f'4d-coche-deplie-{t}')
        page.click(add)
        page.wait_for_selector('#dietFoodSearch')
        page.fill('#dietFoodSearch', 'huile olive')
        page.wait_for_timeout(200)
        name = page.locator('#dietFoodList .diet-cand .diet-cand__name').first.inner_text()
        page.locator('#dietFoodList .diet-cand').first.click()
        qty_grams(page, '10')   # l'huile a des cuillères : quantité choisie en grammes
        page.wait_for_timeout(400)
        extra = page.evaluate("dietDayProgress(data, data.dietActive).meals[3].extras.map(x => [x.name, x.g])")
        R.check(extra == [[name, 10]], f'{t} ajouté au dîner : {extra}')
        row = page.locator('.diet-meal[data-meal="m4"] .diet-item--extra')
        R.check(row.count() == 1 and 'Ajouté aujourd' in row.inner_text(), f'{t} ligne « Ajouté aujourd\'hui »')
        R.check(page.get_attribute('.diet-meal[data-meal="m4"] [data-action="diet-check"]', 'aria-pressed') == 'true', f'{t} dîner toujours coché')
        after = kcal_eaten(page)
        R.check(after > before and 'Journée complète' in page.inner_text('.diet-sum'), f'{t} mangé recalculé ({before} → {after}), journée complète gardée')
        R.check(page.evaluate("data.dietPlans.d_masse01.meals[3].items.length") == plan_items, f'{t} le plan ne change pas')
        R.check('Ajouté à Dîner' in toast(page), f'{t} toast « Ajouté à Dîner » ({toast(page)!r})')
        page.evaluate("document.querySelectorAll('.toast').forEach(x => x.remove())")
        layout(page, t, 'ajout au dîner coché')
        shot(page, LOT, f'4e-ajout-dine-coche-{t}')
        # Modifier la quantité, puis retirer (Annuler le remet)
        row.click()
        tap_dialog(page, 'Changer la quantité')
        qty_grams(page, '20')
        page.wait_for_timeout(300)
        R.check(page.evaluate("dietDayProgress(data, data.dietActive).meals[3].extras[0].g") == 20, f'{t} quantité changée')
        page.locator('.diet-meal[data-meal="m4"] .diet-item--extra').click()
        tap_dialog(page, 'Retirer')
        page.wait_for_timeout(300)
        R.check(page.locator('.diet-meal[data-meal="m4"] .diet-item--extra').count() == 0 and kcal_eaten(page) == before, f'{t} retiré, total revenu')
        page.locator('.toast__action').click()
        page.wait_for_timeout(300)
        R.check(page.locator('.diet-meal[data-meal="m4"] .diet-item--extra').count() == 1, f'{t} Annuler : remis')
        # Collation cochée : décocher d'un toucher, Annuler la recoche
        page.click('.diet-meal[data-meal="m3"] [data-action="diet-check"]')
        page.wait_for_timeout(300)
        R.check('Décoché : Collation' in toast(page) and 'Journée complète' not in page.inner_text('.diet-sum'), f'{t} collation décochée ({toast(page)!r})')
        page.locator('.toast__action').click()
        page.wait_for_timeout(300)
        R.check(page.get_attribute('.diet-meal[data-meal="m3"] [data-action="diet-check"]', 'aria-pressed') == 'true'
                and 'Journée complète' in page.inner_text('.diet-sum'), f'{t} Annuler : collation recochée')
        page.evaluate("document.querySelectorAll('.toast').forEach(x => x.remove())")
        # Hier : frise, jour vide
        page.click('.diet-week__day[data-day="2026-11-04"]')
        page.wait_for_timeout(300)
        R.check(page.inner_text('.diet-plan-from__day').strip() == 'Hier' and page.inner_text('.navbar__large').strip() == 'Nutrition' and page.locator('.diet-meal--done').count() == 0, f'{t} hier : rien de coché')
        page.click('.diet-week__day[data-day="2026-11-05"]')
        page.wait_for_timeout(300)
        R.check(page.locator('.diet-meal--done').count() == 4, f'{t} retour à aujourd\'hui')
        # Réglages de la nutrition : masquer les calories et les grammes, série
        page.click('[data-action="go-diet-settings"]')
        page.wait_for_selector('.diet-settings-view')
        R.check(page.locator('[data-action="diet-consent"]').count() == 0, f'{t} sans compte : pas d\'accord à donner')
        layout(page, t, 'réglages de la nutrition')
        shot(page, LOT, f'4b-reglages-{t}')
        page.click('[data-action="diet-hide-numbers"]')
        page.wait_for_timeout(200)
        R.check(page.get_attribute('[data-action="diet-hide-numbers"]', 'aria-checked') == 'true', f'{t} chiffres masqués')
        page.evaluate('goBack()')
        page.wait_for_selector('.nutrition-view')
        txt = page.inner_text('.diet-meals') + page.inner_text('.diet-sum')
        R.check('kcal' not in txt and page.locator('.diet-ring').count() == 0 and 'Journée complète' in txt, f'{t} chiffres masqués : cases des repas seulement')
        shot(page, LOT, f'4c-sans-chiffres-{t}')
        page.evaluate("data.dietHideNumbers = undefined; delete data.dietHideNumbers; save(); render()")
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


def t_creer_plan(bench, eng, dev, theme):
    """Sans coach : créer son plan, chercher un aliment, la quantité, les objectifs ; état vide de Nutrition."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(now_ms=NOW))
        R.check(page.locator('.diet-home').count() == 0, f'{t} sans plan : pas de carte à l\'accueil')
        page.evaluate("navigate('nutrition')")
        page.wait_for_selector('.diet-empty')
        R.check('Pas encore de plan diète' in page.inner_text('.diet-empty'), f'{t} Nutrition sans plan : état vide')
        layout(page, t, 'Nutrition vide')
        shot(page, LOT, f'5-nutrition-vide-{t}')
        page.click('.tabbar [data-tab="program"]')
        page.wait_for_selector('[data-action="go-diet-plans"]')
        R.check('Aucun' in page.inner_text('[data-action="go-diet-plans"]'), f'{t} Programme : cellule Plans diète')
        page.click('[data-action="go-diet-plans"]')
        page.wait_for_selector('.diet-plans-view')
        page.click('[data-action="diet-new-plan"]')
        page.wait_for_selector('.ios-dialog__input')
        R.check(page.get_attribute('.ios-dialog__input', 'aria-label') == 'Nouveau plan', f'{t} nom du plan : champ nommé')
        page.fill('.ios-dialog__input', 'Ma prise de masse')   # nom du panel : long, le titre touchait le Retour sur SE
        tap_dialog(page, 'Créer')
        page.wait_for_selector('.diet-plan-view')
        R.check(page.locator('[data-action="diet-add-food"]').count() == 4, f'{t} plan neuf : 4 repas')
        shot(page, LOT, f'4d-plan-cree-{t}')
        R.check(page.evaluate('data.dietActive') == page.evaluate("Object.keys(data.dietPlans)[0]"), f'{t} premier plan : suivi')
        # Ajouter du riz cuit au petit-déjeuner : recherche, choix, 150 g
        page.locator('[data-action="diet-add-food"]').first.click()
        page.wait_for_selector('#dietFoodSearch')
        R.check(page.evaluate("document.activeElement.id") == 'dietFoodSearch', f'{t} recherche active (clavier)')
        page.fill('#dietFoodSearch', 'riz cuit')
        page.wait_for_timeout(200)
        R.check(page.locator('#dietFoodList .diet-cand').count() >= 5, f'{t} recherche : résultats')
        shot(page, LOT, f'6-recherche-{t}')
        # Flocons d'avoine : le nom ne dit ni cru ni cuit, pas de rappel ; la quantité se tape dans l'alerte à champ
        page.fill('#dietFoodSearch', 'flocons avoine')
        page.wait_for_timeout(200)
        first = page.locator('#dietFoodList .diet-cand .diet-cand__name').first.inner_text()
        page.locator('#dietFoodList .diet-cand').first.click()
        page.wait_for_selector('.ios-dialog__input')
        # VoiceOver : le champ de la quantité a un nom (avant : aucun), l'unité dite en toutes lettres
        lbl = page.get_attribute('.ios-dialog__input', 'aria-label') or ''
        R.check(lbl.endswith(', en grammes') and len(lbl) > len(', en grammes') and page.get_attribute('.ios-dialog__unit', 'aria-hidden') == 'true', f'{t} quantité : champ nommé ({lbl!r})')
        # Panel du 07/11 : « P 2,5, G 31 » lu lettre par lettre. Depuis le 09/11 (alerte courte en texte agrandi),
        # le message ne redit plus les macros, déjà dans la liste : l'unité et les kcal pour 100 g, en toutes lettres
        msg = page.inner_text('.ios-dialog__msg')
        R.check(msg.startswith('Quantité en grammes.') and 'Pour 100 g : ' in msg and msg.endswith(' kcal.') and ', P ' not in msg and 'protéines' not in msg,
                f'{t} quantité : message court, sans abréviation ({msg!r})')
        page.fill('.ios-dialog__input', '150')
        tap_dialog(page, 'OK')
        page.wait_for_timeout(300)
        it = page.evaluate("Object.values(data.dietPlans)[0].meals[0].items[0]")
        R.check(it and it['name'] == first and it['g'] == 150 and it['per']['k'] > 0, f'{t} aliment ajouté avec ses valeurs ({it and it["name"]})')
        R.check('150 g' in page.inner_text('.diet-plan-view'), f'{t} éditeur : quantité affichée')
        # VoiceOver : lignes abrégées (« P 4 · G 47 », Total prévu) cachées, dites en toutes lettres à côté
        sr = page.evaluate("""[...document.querySelectorAll('.diet-plan-view .cell__sub')].filter(e => /\\bP\\s/.test(e.textContent))
            .map(e => [!!e.querySelector('[aria-hidden="true"]') && !/\\bP\\s/.test(e.querySelector('.sr-text')?.textContent || 'P '), e.querySelector('.sr-text')?.textContent || ''])""")
        R.check(len(sr) >= 2 and all(ok and 'grammes de protéines' in txt for ok, txt in sr), f'{t} éditeur : macros dites en toutes lettres ({sr})')
        # Panel du 06/11 (iPhone SE) : le titre passait sur le chevron Retour (à droite, « Renommer » prend sa place)
        ov = page.evaluate("""(() => { const b = document.querySelector('.diet-plan-view .navbar__back').getBoundingClientRect(),
            ti = document.querySelector('.diet-plan-view .navbar__title').getBoundingClientRect();
            return [Math.round(b.width), Math.round(b.right - ti.left)]; })()""")
        R.check(ov[0] >= 44 and ov[1] <= 0, f'{t} éditeur : Retour de 44 pt, jamais sous le titre {ov}')
        # Panel du 07/11 (iPhone SE) : titre réduit coupé des deux côtés sans « … » (« a prise de mas »)
        cut = page.evaluate("""(() => { const ti = document.querySelector('.diet-plan-view .navbar__title'), cs = getComputedStyle(ti),
            r = document.createRange(); r.selectNodeContents(ti);
            const over = ti.scrollWidth > ti.clientWidth + 1;
            return { over, left: r.getBoundingClientRect().left >= ti.getBoundingClientRect().left - 1 || !over,
              ellipsis: !over || (cs.display === 'block' && cs.textOverflow === 'ellipsis' && cs.overflow === 'hidden') }; })()""")
        R.check(cut['left'] and cut['ellipsis'], f'{t} éditeur : titre trop long fini par « … », jamais coupé à gauche {cut}')
        # Aliment perso (absent de Ciqual) : skyr
        page.locator('[data-action="diet-add-food"]').nth(1).click()
        page.wait_for_selector('#dietFoodSearch')
        page.click('.diet-cand--new')
        page.wait_for_selector('#dietFoodName')
        page.fill('#dietFoodName', 'Skyr nature')
        page.fill('#dietFoodP', '11')
        page.fill('#dietFoodC', '4')
        page.fill('#dietFoodF', '0,2')
        shot(page, LOT, f'7-nouvel-aliment-{t}')
        page.click('.sheet__btn--confirm')
        qty_grams(page, '200')   # skyr : un pot de 125 g proposé, quantité choisie en grammes
        page.wait_for_timeout(300)
        sk = page.evaluate("Object.values(data.dietPlans)[0].meals[1].items[0]")
        R.check(sk and sk['name'] == 'Skyr nature' and sk['per']['k'] == round(4 * 11 + 4 * 4 + 9 * 0.2) and sk['fam'] == 'v', f'{t} aliment perso : énergie calculée, famille protéines ({sk})')
        R.check(page.evaluate("data.dietFoods[0].name") == 'Skyr nature', f'{t} aliment perso gardé dans mes aliments')
        # Objectifs du jour
        page.click('[data-action="diet-targets"]')
        page.wait_for_selector('#dietT_p')
        page.fill('#dietT_p', '150')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(300)
        R.check(page.evaluate("Object.values(data.dietPlans)[0].targets") == {'p': 150}, f'{t} objectif de protéines fixé')
        R.check(page.locator('.diet-low').count() == 0, f'{t} plan en cours de remplissage (repas vides) : pas de message « très bas »')
        page.click('[data-action="diet-targets"]')
        page.wait_for_selector('#dietT_kcal')
        page.fill('#dietT_kcal', '1100')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(300)
        R.check(page.locator('.diet-low').count() == 1 and 'Cet objectif' in page.inner_text('.diet-low') and '1 200 kcal' in page.inner_text('.diet-low'),
                f'{t} objectif sous 1 200 kcal : message de santé, rien de bloqué')
        layout(page, t, 'éditeur du plan')
        shot(page, LOT, f'8-editeur-{t}')
        page.evaluate("goBack()")
        page.wait_for_selector('.diet-plans-view')
        R.check('En cours' in page.inner_text('.diet-plans-view'), f'{t} liste : plan suivi')
        layout(page, t, 'Plans diète')
        shot(page, LOT, f'9-plans-{t}')
        # Accueil : la carte apparaît
        page.evaluate("switchTab('train', { reset: true })")
        page.wait_for_timeout(400)
        R.check(page.locator('.diet-home').count() == 1, f'{t} accueil : carte du plan créé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


def t_coach_eleve(bench, eng, dev, theme):
    """Coach : refus tant que l'élève n'a pas accepté, puis envoi depuis la fiche et depuis le plan, dupliquer.
    Élève : accepte les plans de son coach (Mon coach), reçoit, suit ; accord « copier sur mon compte » à part."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        d = ppl_v2_today(now_ms=NOW)
        d['dietPlans'] = {'d_lea00001': {**PLAN, 'name': 'Sèche Léa', 'consigne': 'Bois 2 L par jour.'}}
        open_app(page, theme, json.dumps(d, ensure_ascii=False), account=True)
        signin(page, 'max')
        uid = page.evaluate("""() => { const me = __sb.meId(); __sb.makeCoach(me);
            const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false }); __sb.link(me, lea);
            const tom = __sb.addPerson({ username: 'tom', avatar: '🐼', social: false }); __sb.link(me, tom); return lea; }""")
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        page.evaluate(f"switchTab('friends'); navigate(makeRoute('coach-student', '{uid}'))")
        page.wait_for_selector('[data-action="coach-send-diet"]')
        # Élève qui n'a pas accepté : refus clair, rien d'écrit
        page.click('[data-action="coach-send-diet"]')
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'Sèche Léa')
        # Panel du 07/11 : relecture avant l'envoi (nom, objectifs, Annuler), comme pour un programme
        page.wait_for_selector('.ios-dialog--alert')
        dlg = page.inner_text('.ios-dialog--alert').replace('\u00a0', ' ')
        # Panel t5 : unités abrégées comme à l'écran, l'écart avec l'objectif en tête
        R.check('Envoyer « Sèche Léa » à lea ?' in dlg.replace('\u202f', ' ') and 'kcal de moins' in dlg and 'kilocalories' not in dlg and 'Annuler' in dlg, f'{t} coach : relecture avant l\'envoi ({dlg!r})')
        shot(page, LOT, f'8b-envoi-plan-relecture-{t}')
        tap_dialog(page, 'Annuler')
        page.wait_for_timeout(300)
        R.check(not page.evaluate("__sb.co.progs.length") and page.locator('.ios-dialog').count() == 0, f'{t} coach : Annuler n\'envoie rien')
        page.click('[data-action="coach-send-diet"]')
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'Sèche Léa')
        page.wait_for_selector('.ios-dialog--alert')
        tap_dialog(page, 'Envoyer')
        page.wait_for_timeout(500)
        R.check("Ton élève doit d'abord accepter les plans diète dans son app." in toast(page) and not page.evaluate("__sb.co.progs.length"), f'{t} coach : refus clair sans l\'accord de l\'élève')
        page.evaluate(f"__sb.co.shares.push({{ student: '{uid}', coach: __sb.meId(), kind: 'diet', granted_at: new Date().toISOString() }})")
        page.click('[data-action="coach-send-diet"]')
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'Sèche Léa')
        page.wait_for_selector('.ios-dialog--alert')
        tap_dialog(page, 'Envoyer')
        page.wait_for_timeout(500)
        sent = page.evaluate("__sb.co.progs.find(p => p.id === 'diet_lea00001')")
        R.check(sent and sent['data']['kind'] == 'diet' and 'name' not in sent['data'] and sent['data']['diet']['name'] == 'Sèche Léa', f'{t} coach : plan envoyé par le canal des programmes, sans nom au premier niveau')
        page.wait_for_timeout(300)
        g = page.inner_text('.coach-student-view')
        R.check('Sèche Léa' in g and 'Pas encore ouvert' in g, f'{t} fiche : plan envoyé, pas encore ouvert')
        R.check('diet_' not in g and 'Programme supprimé' not in g, f'{t} fiche : le plan n\'est pas listé comme un programme')
        # Plan retiré de mes plans ensuite : la ligne garde le nom envoyé, « supprimé de tes plans » en complément
        page.evaluate("window.__keep = data.dietPlans.d_lea00001; delete data.dietPlans.d_lea00001; render()")
        page.wait_for_timeout(200)
        row = page.inner_text('.coach-sent[data-diet="diet_lea00001"]')
        R.check('Sèche Léa' in row and 'supprimé de tes plans' in row and 'Plan supprimé' not in row, f'{t} fiche : plan supprimé de mes plans, nom envoyé gardé ({row!r})')
        page.evaluate("data.dietPlans.d_lea00001 = window.__keep; render()")
        page.wait_for_timeout(200)
        layout(page, t, 'fiche de l\'élève')
        shot(page, LOT, f'10-coach-fiche-{t}')
        # Préparer le plan d'un 2e élève : dupliquer puis « Envoyer à un élève », depuis le plan
        page.evaluate("switchTab('program', { reset: true }); navigate(makeRoute('diet-plan', 'd_lea00001'))")
        page.wait_for_selector('[data-action="diet-duplicate"]')
        R.check(page.locator('[data-action="diet-send-student"]').count() == 1, f'{t} coach : « Envoyer à un élève » sur le plan')
        R.check(page.locator('[data-action="diet-duplicate"] .icon--doc-on-doc').count() == 1 and page.locator('[data-action="diet-duplicate"] .icon--plus').count() == 0,
                f'{t} « Dupliquer le plan » : icône de copie, pas « + » (réservé à l\'ajout)')
        page.locator('[data-action="diet-duplicate"]').scroll_into_view_if_needed()
        shot(page, LOT, f'10b-dupliquer-icone-{t}')
        page.click('[data-action="diet-duplicate"]')
        page.wait_for_timeout(400)
        nid = page.evaluate("routeParams(currentRoute())[0]")
        R.check(nid != 'd_lea00001' and 'Sèche Léa (copie)' in page.inner_text('.diet-plan-view'), f'{t} dupliquer : nouvelle copie ouverte')
        layout(page, t, 'plan dupliqué')
        shot(page, LOT, f'10b-dupliquer-{t}')
        page.evaluate(f"__sb.co.shares.push({{ student: __sb.co.links.find(l => l.student !== '{uid}').student, coach: __sb.meId(), kind: 'diet', granted_at: new Date().toISOString() }})")
        page.click('[data-action="diet-send-student"]')
        page.wait_for_selector('.ios-dialog')
        shot(page, LOT, f'10c-envoyer-{t}')
        tap_dialog(page, 'tom')
        page.wait_for_timeout(500)
        R.check(page.evaluate(f"__sb.co.progs.some(p => p.id === dietSentId('{nid}') && p.student !== '{uid}')"), f'{t} plan envoyé au 2e élève depuis le plan')
    # Élève : accepte les plans de son coach, reçoit, suit
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(now_ms=NOW), account=True)
        signin(page, 'lea')
        page.evaluate("""() => { const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false }); __sb.makeCoach(max); __sb.link(max, __sb.meId()); window.__max = max; }""")
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(500)
        page.evaluate("switchTab('friends'); navigate('coach-mine')")
        page.wait_for_selector('[data-action="diet-coach-toggle"]')
        R.check(page.get_attribute('[data-action="diet-coach-toggle"]', 'aria-checked') == 'false', f'{t} élève : plans du coach pas acceptés au départ')
        page.click('[data-action="diet-coach-toggle"]')
        page.wait_for_selector('.ios-dialog')
        dlg = page.inner_text('.ios-dialog')
        R.check('Recevoir les plans diète de max' in dlg and 'En savoir plus' in dlg and dlg.count('.') <= 4, f'{t} accord du coach : court, « En savoir plus »')
        shot(page, LOT, f'11a-accord-coach-{t}')
        tap_dialog(page, 'Accepter')
        page.wait_for_timeout(500)
        R.check(page.evaluate("__sb.co.shares.some(x => x.kind === 'diet' && x.student === __sb.meId())"), f'{t} accord enregistré sur le serveur')
        payload = {'kind': 'diet', 'v': 1, 'diet': {**PLAN, 'name': 'Sèche Léa', 'consigne': 'Bois 2 L par jour.'}}
        page.evaluate("p => { __sb.co.progs.push({ coach: window.__max, student: __sb.meId(), id: 'diet_lea00001', data: p, sent_at: new Date().toISOString(), seen: false }); }", payload)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(500)
        page.evaluate("switchTab('train', { reset: true })")
        page.wait_for_timeout(300)
        home = page.locator('.coach-home', has_text='plan diète')
        R.check(home.count() == 1 and 'Nouveau plan diète de max' in home.inner_text() and 'Sèche Léa' in home.inner_text(), f'{t} élève : carte « Nouveau plan diète de max »')
        R.check(page.locator('.coach-home', has_text='Nouveau programme').count() == 0, f'{t} élève : pas pris pour un programme')
        shot(page, LOT, f'11-eleve-accueil-{t}')
        home.locator('[data-action="diet-take"]').click()
        page.wait_for_timeout(500)
        R.check(page.evaluate("(data.dietActive || '').startsWith('dc_')"), f'{t} élève : plan suivi ({page.evaluate("data.dietActive")})')
        R.check(page.evaluate("__sb.co.progs[0].seen") is True, f'{t} élève : plan marqué vu')
        R.check(page.locator('.diet-home').count() == 1, f'{t} élève : carte Nutrition')
        # Accord « copier sur mon compte » : à part, demandé une fois à l'ouverture de Nutrition
        page.click('.diet-home__open')
        page.wait_for_selector('.ios-dialog')
        dlg = page.inner_text('.ios-dialog')
        R.check('Copier tes plans sur ton compte' in dlg and 'Garder sur cet iPhone' in dlg and 'En savoir plus' in dlg, f'{t} accord du compte : court, deux choix et « En savoir plus »')
        shot(page, LOT, f'11b-accord-{t}')
        tap_dialog(page, 'Garder sur cet iPhone')
        page.wait_for_timeout(300)
        R.check(page.evaluate("data.dietConsent.on") is False and page.evaluate("Object.keys(profilePayload(data)).filter(k => k.startsWith('diet'))") == ['dietConsent'], f'{t} refus daté : aucun plan vers le serveur')
        page.wait_for_selector('.nutrition-view .diet-sum')
        R.check('envoyé par max' in page.inner_text('.diet-plan-from') and 'Bois 2 L par jour.' in page.inner_text('.nutrition-view'), f'{t} élève : plan du coach et sa consigne')
        shot(page, LOT, f'12-eleve-nutrition-{t}')
        # Plan du coach en lecture seule
        page.click('[data-action="diet-open-plan"]')
        page.wait_for_selector('.diet-plan-view')
        R.check(page.locator('[data-action="diet-add-food"]').count() == 0 and page.locator('[data-action="diet-rename"]').count() == 0, f'{t} plan du coach : lecture seule')
        layout(page, t, 'plan du coach')
        shot(page, LOT, f'13-eleve-plan-{t}')
        # Mon coach : plans reçus
        page.evaluate("switchTab('friends'); navigate('coach-mine')")
        page.wait_for_selector('.diet-inbox')
        R.check("C'est ton plan" in page.inner_text('.diet-inbox'), f'{t} Mon coach : plan reçu, déjà suivi')
        R.check(page.locator('.coach-prog:not(.diet-inbox)').count() == 0, f'{t} Mon coach : aucun programme fantôme')
        shot(page, LOT, f'14-mon-coach-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


def t_sans_base(bench):
    """Base d'aliments absente (réseau, fichier manquant) : le plan reste lisible, le remplacement le dit."""
    with bench.frozen_page(NOW, 'webkit', 'iPhone 13', 'dark') as page:
        page.route('**/data/foods.json', lambda route: route.abort())
        open_app(page, 'dark', with_plan(NOW))
        page.evaluate("navigate('nutrition')")
        page.wait_for_selector('.diet-item')
        page.click('.diet-item[data-item="i3"]')
        page.wait_for_selector('.diet-swap')
        R.check('indisponible' in page.inner_text('.diet-swap'), 'sans base : remplacement indisponible, dit')
        R.check(not page.errors, f'sans base : aucune erreur JS {page.errors[:2]}')


def t_ancienne_coche(bench):
    """Journal d'un plan supprimé ou d'un jour hors des 7 jours : rien ne casse, rien n'est inventé."""
    with bench.frozen_page(NOW, 'chromium', 'Pixel 7', 'light') as page:
        log = {'2026-11-05': {'plan': 'd_autre', 'done': ['m1']}, '2026-01-01': {'plan': 'd_masse01', 'done': ['m1']}}
        open_app(page, 'light', with_plan(NOW, log))
        R.check(page.evaluate("'2026-01-01' in (data.dietLog || {})") is False, 'journal : jour trop ancien retiré')
        page.evaluate("navigate(makeRoute('nutrition', '2025-01-01'))")
        page.wait_for_selector('.diet-sum')
        R.check(page.get_attribute('.diet-week__day--on', 'data-day') == '2026-11-05', 'jour hors frise : aujourd\'hui affiché')
        R.check(page.locator('.diet-meal--done').count() == 0, 'coche d\'un autre plan : pas comptée')
        R.check(not page.errors, f'aucune erreur JS {page.errors[:2]}')


def t_plan_neuf_puis_coach(bench):
    """Panel du 06/11 : plan neuf (un seul repas rempli sur quatre) coché avec un équivalent, puis plan du coach
    suivi le même jour. Accueil : jamais « Déjeuner · 0 kcal » ni « 217 sur 215 kcal » ; frise d'aujourd'hui
    jamais verte pour les coches de l'ancien plan."""
    for dev, theme, eng in (('iPhone 13', 'light', 'webkit'), ('iPhone SE', 'dark', 'webkit')):
        t = tag(dev, theme)
        with bench.frozen_page(NOW, eng, dev, theme) as page:
            d = ppl_v2_today(now_ms=NOW)
            mine = {'name': 'Ma prise de masse', 'meals': [{'id': 'p1', 'name': 'Petit-déjeuner', 'items': [food_item(RIZ, 150, 'r1')]}]
                    + [{'id': f'p{i}', 'name': n, 'items': []} for i, n in ((2, 'Déjeuner'), (3, 'Collation'), (4, 'Dîner'))]}
            d['dietPlans'] = {'d_neuf0001': mine, 'dc_max_lea00001': {**PLAN, 'name': 'Sèche Léa'}}
            d['dietActive'] = 'd_neuf0001'
            open_app(page, theme, json.dumps(d, ensure_ascii=False))
            page.click('.diet-home [data-action="diet-check"]')
            page.wait_for_timeout(250)
            # Équivalent du riz pour la journée (quelques kcal de plus ou de moins que prévu)
            page.evaluate("""async () => { await loadFoods(); const it = data.dietPlans.d_neuf0001.meals[0].items[0];
                const c = swapCandidates(it).find(x => Math.round(x.macros.kcal) !== Math.round(dietItemMacros(it).kcal));
                dietSetSwap(data, 'd_neuf0001', 'r1', foodToItem(c.food, c.g)); save(); render(); }""")
            page.wait_for_timeout(250)
            home = page.inner_text('.diet-home').replace('\u202f', ' ').replace('\xa0', ' ')
            pr = page.evaluate("dietDayProgress(data, data.dietActive)")
            R.check('Journée complète' in home and 'Déjeuner' not in home, f'{t} accueil : seul repas rempli coché, journée complète ({home!r})')
            R.check(pr['goal']['kcal'] == round(pr['eaten']['kcal']), f'{t} accueil : repère = prévu du jour ({round(pr["eaten"]["kcal"])} sur {pr["goal"]["kcal"]})')
            page.locator('.diet-home').scroll_into_view_if_needed()
            R.check(page.locator('.toast').count() == 0, f'{t} journée complète : aucun toast posé sur la carte d\'un repas (le haut le dit déjà)')
            page.wait_for_timeout(300)
            shot(page, LOT, f'16-plan-neuf-accueil-{t}')
            page.click('.diet-home__open')
            page.wait_for_selector('.nutrition-view .diet-sum')
            R.check('Journée complète' in page.inner_text('.diet-sum') and page.locator('.diet-meal--next').count() == 0, f'{t} Nutrition : journée complète, aucun repas vide « Ensuite »')
            R.check(page.locator('.diet-week__day[data-day="2026-11-05"] .diet-week__dot--done').count() == 1, f'{t} frise : aujourd\'hui vert, comme le bilan')
            # Plan du coach suivi le même jour : 0 coché, la frise d'aujourd'hui ne garde pas la coche de l'ancien plan
            page.evaluate("data.dietActive = 'dc_max_lea00001'; save(); render()")
            page.wait_for_timeout(250)
            txt = page.inner_text('.diet-sum')
            R.check('0 repas coché sur 4' in txt, f'{t} plan du coach : 0 repas coché sur 4 ({txt[-60:]!r})')
            today = page.locator('.diet-week__day[data-day="2026-11-05"]')
            R.check(today.locator('.diet-week__dot--done, .diet-week__dot--some').count() == 0 and 'complète' not in (today.get_attribute('aria-label') or ''),
                    f'{t} frise : aujourd\'hui pas coché pour l\'ancien plan')
            layout(page, t, 'Nutrition plan du coach')
            shot(page, LOT, f'17-plan-coach-frise-{t}')


def t_invitation(bench):
    """Serveur pas encore à jour (le coach a pu envoyer sans accord) : l'élève voit une invitation SANS le
    contenu du plan ; accepter (gardé sur l'appareil) puis le plan s'affiche."""
    for theme in THEMES:
        with bench.frozen_page(NOW, 'webkit', 'iPhone 13', theme) as page:
            page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True, 'dietServerless': True}))
            page.add_init_script(FAKE_ACCOUNT)
            page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
            seed(page, theme, ppl_v2_today_json(now_ms=NOW), extra={'ppl_welcome_seen': '1'})
            page.wait_for_timeout(300)
            signin(page, 'lea')
            payload = {'kind': 'diet', 'v': 1, 'diet': {**PLAN, 'name': 'Plan secret'}}
            page.evaluate("""p => { const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false }); __sb.makeCoach(max); __sb.link(max, __sb.meId());
                __sb.co.progs.push({ coach: max, student: __sb.meId(), id: 'diet_sec00001', data: p, sent_at: new Date().toISOString(), seen: false }); }""", payload)
            page.evaluate('coachRefresh()')
            page.wait_for_timeout(500)
            page.evaluate("routeTo('dashboard')")
            page.wait_for_timeout(300)
            home = page.locator('.coach-home', has_text='plan diète')
            txt = home.inner_text() if home.count() else ''
            R.check('max veut t\'envoyer un plan diète' in txt and 'Plan secret' not in txt, f'{theme} invitation sans le contenu du plan ({txt!r})')
            page.evaluate("switchTab('friends'); navigate('coach-mine')")
            page.wait_for_selector('.diet-invite')
            R.check('Plan secret' not in page.inner_text('#app'), f'{theme} Mon coach : rien du plan sans accord')
            shot(page, LOT, f'15-invitation-iPhone_13-{theme}')
            # Panel vague 4 : « Recevoir » donne l'accord ET prend le plan, d'un seul geste (plus de « Utiliser » ensuite)
            page.click('.diet-invite [data-action="diet-take"]')
            page.wait_for_selector('.ios-dialog')
            tap_dialog(page, 'Accepter')
            page.wait_for_timeout(500)
            R.check(page.evaluate("data.dietCoachConsent.on") is True and 'Plan secret' in page.inner_text('#app'), f'{theme} serveur d\'avant : accord gardé sur l\'appareil, plan affiché')
            R.check(page.evaluate("dietActivePlan(data)?.name") == 'Plan secret' and 'Touche Utiliser' not in toast(page), f'{theme} Recevoir : plan suivi d\'un geste ({toast(page)!r})')
            R.check(not page.errors, f'{theme} invitation : aucune erreur JS {page.errors[:2]}')


def nb(v):
    """Espaces insécables ramenées à l'espace (comparaisons de texte)."""
    return (v or '').replace(' ', ' ').replace(' ', ' ')


def open_editor(page):
    page.evaluate("switchTab('program', { reset: true }); navigate(makeRoute('diet-plan', 'd_masse01'))")
    page.wait_for_selector('.diet-plan-view [data-action="diet-add-food"]')


def pick_food(page, query, name):
    page.wait_for_selector('#dietFoodSearch')
    page.fill('#dietFoodSearch', query)
    page.wait_for_timeout(200)
    i = page.evaluate("n => [...document.querySelectorAll('#dietFoodList .diet-cand__name')].findIndex(e => e.textContent === n)", name)
    page.locator('#dietFoodList .diet-cand').nth(max(i, 0)).click()


def t_unites(bench, eng, dev, theme):
    """Quantités à l'unité (docs/NUTRITION_V1.md) : « 2 œufs » → 100 g et leurs kcal, stockés en grammes, unité à côté."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, with_plan(NOW))
        open_editor(page)
        page.locator('[data-action="diet-add-food"]').nth(2).click()   # Collation
        pick_food(page, 'oeuf dur', 'Œuf dur')   # « Oeuf dur » de Ciqual, écrit avec la ligature à l'écran
        page.wait_for_selector(f'{LIVE_SHEET} #qtyVal')
        R.check(page.text_content(f'{LIVE_SHEET} .sheet__title') == 'Œuf dur', f'{t} œuf : titre « Œuf dur »')
        page.wait_for_timeout(350)
        seg = page.locator(f'{LIVE_SHEET} .qty__mode .segmented__btn').all_inner_texts()
        R.check(seg == ['Grammes', 'Œuf'] and page.get_attribute(f'{LIVE_SHEET} [data-qmode="0"]', 'aria-pressed') == 'true',
                f'{t} œuf : « Grammes | Œuf », à l\'unité d\'office ({seg})')
        R.check(page.input_value(f'{LIVE_SHEET} #qtyVal') == '1' and page.evaluate("document.activeElement.id") != 'qtyVal', f'{t} œuf : 1 œuf, sans clavier à l\'ouverture')
        page.click(f'{LIVE_SHEET} [data-qstep="1"]')
        eq = nb(page.text_content(f'{LIVE_SHEET} #qtyEq [aria-hidden="true"]'))
        R.check(page.input_value(f'{LIVE_SHEET} #qtyVal') == '2' and eq == '2 œufs · 100 g · 134 kcal', f'{t} œuf : + → « 2 œufs · 100 g · 134 kcal » ({eq!r})')
        R.check(page.text_content(f'{LIVE_SHEET} #qtyEq .sr-text') == '2 œufs, 100 grammes, 134 kilocalories', f'{t} œuf : VoiceOver en toutes lettres')
        R.check(nb(page.text_content(f'{LIVE_SHEET} #qtyUnit')) == 'œufs' and 'environ 50' in nb(page.text_content(f'{LIVE_SHEET} #qtyHint')), f'{t} œuf : unité accordée, poids moyen « environ »')
        mac = nb(page.text_content(f'{LIVE_SHEET} #qtyMacros [aria-hidden="true"]'))
        R.check(re.fullmatch(r'Protéines \d+ g · Glucides \d+ g · Lipides \d+ g', mac) and nb(page.text_content(f'{LIVE_SHEET} #qtyHint')) == '1 œuf : environ 50 g, poids moyen.',
                f'{t} œuf : macros en toutes lettres, note du poids moyen ({mac!r})')
        vis = page.evaluate("s => { const m = document.querySelector(s + ' #qtyMacros').getBoundingClientRect(), b = document.querySelector(s + ' .sheet__body').getBoundingClientRect(); return m.bottom <= b.bottom + 1 && m.top >= b.top; }", LIVE_SHEET)
        R.check(vis, f'{t} œuf : ligne des macros visible sans défiler')
        R.check(page.get_attribute(f'{LIVE_SHEET} [data-qstep="1"]', 'aria-label') == '1 œuf de plus', f'{t} œuf : boutons nommés')
        st = small_targets(page, f'{LIVE_SHEET} button')
        R.check(not st, f'{t} feuille de quantité : cibles de 44 pt {st}')
        ct = cut_texts(page, LIVE_SHEET)
        R.check(not ct and no_hscroll(page), f'{t} feuille de quantité : aucun texte coupé {ct}')
        shot(page, LOT, f'q1-quantite-oeufs-{t}')
        # Grammes ↔ unité : 2 œufs = 100 g ; 120 g → 2 œufs (arrondi à l'œuf)
        page.click(f'{LIVE_SHEET} [data-qmode="-1"]')
        R.check(page.input_value(f'{LIVE_SHEET} #qtyVal') == '100' and nb(page.text_content(f'{LIVE_SHEET} #qtyUnit')) == 'g', f'{t} œuf : en grammes, 100 g')
        page.fill(f'{LIVE_SHEET} #qtyVal', '120')
        page.click(f'{LIVE_SHEET} [data-qmode="0"]')
        R.check(page.input_value(f'{LIVE_SHEET} #qtyVal') == '2', f'{t} œuf : 120 g → 2 œufs')
        page.click(f'{LIVE_SHEET} .sheet__btn--confirm')
        page.wait_for_timeout(400)
        it = page.evaluate("data.dietPlans.d_masse01.meals[2].items.at(-1)")
        R.check(it and it['name'] == 'Oeuf dur' and it['g'] == 100 and it.get('por') == {'n': 2, 'u': 'œuf', 'pl': 'œufs', 'g': 50}, f'{t} œuf : 100 g stockés, unité à côté ({it})')
        R.check(page.evaluate("Math.round(dietItemMacros(data.dietPlans.d_masse01.meals[2].items.at(-1)).kcal)") == 134, f'{t} œuf : 134 kcal comptées')
        row = page.locator(f'.diet-plan-view [data-action="diet-item-menu"][data-item="{it["id"]}"]')
        R.check('2 œufs · 100 g · 134 kcal' in nb(row.inner_text()) and '2 œufs, 100 grammes' in row.locator('.sr-text').text_content(), f'{t} plan : « 2 œufs · 100 g » affiché et dit')
        # Modifier : la feuille rouvre à l'unité, 3 œufs → 150 g
        row.click()
        tap_dialog(page, 'Changer la quantité')
        page.wait_for_selector(f'{LIVE_SHEET} #qtyVal')
        R.check(page.input_value(f'{LIVE_SHEET} #qtyVal') == '2', f'{t} modifier : rouvert sur 2 œufs')
        page.click(f'{LIVE_SHEET} [data-qstep="1"]')
        page.click(f'{LIVE_SHEET} .sheet__btn--confirm')
        page.wait_for_timeout(400)
        it = page.evaluate("data.dietPlans.d_masse01.meals[2].items.at(-1)")
        R.check(it['g'] == 150 and it['por']['n'] == 3, f'{t} modifier : 3 œufs, 150 g ({it})')
        # Journée : la ligne du repas dit « 3 œufs · 150 g »
        page.evaluate("switchTab('train', { reset: true }); navigate('nutrition')")
        page.wait_for_selector('.diet-meal[data-meal="m3"]')
        R.check('3 œufs · 150 g' in nb(page.inner_text('.diet-meal[data-meal="m3"]')), f'{t} Nutrition : « 3 œufs · 150 g »')
        R.check(not page.errors, f'{t} unités : aucune erreur JS {page.errors[:2]}')


# Clavier iOS simulé : visualViewport remplacé par un faux (hauteur réduite), 'resize' déclenché à la main
FAKE_VV = """(() => {
  const vv = new EventTarget(); let kb = 0;
  for (const [k, f] of Object.entries({ height: () => innerHeight - kb, width: () => innerWidth, offsetTop: () => 0, offsetLeft: () => 0, pageTop: () => scrollY, scale: () => 1 }))
    Object.defineProperty(vv, k, { get: f });
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  window.__kb = px => { kb = px; vv.dispatchEvent(new Event('resize')); };
})();"""


def t_clavier(bench):
    """Clavier ouvert (signalé le 10/11) : la feuille « Ajouter un aliment » et son bouton Scanner restent au-dessus,
    le contenu défile ; clavier refermé, tout revient en bas."""
    engines = dict((d, e) for e, d in ALL_DEVICES)
    for dev in ('iPhone 13', 'iPhone SE'):
        for theme in THEMES:
            t = tag(dev, theme) + '-clavier'
            with bench.frozen_page(NOW, engines[dev], dev, theme) as page:
                page.add_init_script(FAKE_VV)
                open_app(page, theme, with_plan(NOW))
                open_editor(page)
                page.locator('[data-action="diet-add-food"]').first.click()
                page.wait_for_selector('#dietFoodSearch')
                page.fill('#dietFoodSearch', 'riz')
                page.wait_for_timeout(300)
                kb = 336 if dev == 'iPhone 13' else 260
                page.evaluate('px => __kb(px)', kb)
                page.wait_for_timeout(200)
                m = page.evaluate("""([sel, kb]) => { const r = e => document.querySelector(sel + ' ' + e).getBoundingClientRect(), body = document.querySelector(sel + ' .sheet__body');
                    const vis = innerHeight - kb, s = r('.sheet'), sc = r('.diet-cand--scan'), ok = r('.sheet__btn--cancel');
                    return { open: document.documentElement.classList.contains('kb-open'), vis, bottom: s.bottom, top: s.top, scanTop: sc.top, scanBottom: sc.bottom,
                      barTop: ok.top, scrolls: body.scrollHeight > body.clientHeight + 1 }; }""", [LIVE_SHEET, kb])
                R.check(m['open'] and m['bottom'] <= m['vis'] + 1 and m['top'] >= 0, f'{t} feuille au-dessus du clavier {m}')
                R.check(m['scanTop'] >= m['top'] and m['scanBottom'] <= m['vis'], f'{t} bouton Scanner visible au-dessus du clavier {m}')
                R.check(m['barTop'] >= 0, f'{t} Annuler visible {m}')
                R.check(m['scrolls'] and page.evaluate("s => { const b = document.querySelector(s + ' .sheet__body'); b.scrollTop = 200; return b.scrollTop > 0; }", LIVE_SHEET),
                        f'{t} contenu de la feuille qui défile')
                page.evaluate("s => { document.querySelector(s + ' .sheet__body').scrollTop = 0; }", LIVE_SHEET)
                # Clavier simulé dessiné en gris (captures lisibles), transparent aux touches et à elementFromPoint
                page.evaluate('''px => { const k = document.createElement('div'); k.id = 'fakeKb';
                    k.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${px}px;background:#8e8e93;z-index:99999;pointer-events:none`;
                    document.body.appendChild(k); }''', kb)
                # Rien de la page dans la feuille, voile sur toute la zone visible, rien de la feuille sous son bord
                leak = page.evaluate('''([sel, kb]) => { const root = document.querySelector(sel), s = root.querySelector('.sheet'), r = s.getBoundingClientRect(), bad = [];
                    for (let y = 4; y < innerHeight; y += 12) for (let x = 4; x < innerWidth; x += 24) {
                      if (y < r.top + 16 && (x < r.left + 16 || x > r.right - 16)) continue;   // coins arrondis
                      const e = document.elementFromPoint(x, y), inSheet = s.contains(e), inRoot = root.contains(e);
                      const want = y >= innerHeight - kb ? !inSheet : y < r.top ? inRoot && !inSheet : inSheet;
                      if (!want) bad.push([x, y, e && (e.className || e.tagName)]);
                    }
                    return bad.slice(0, 4); }''', [LIVE_SHEET, kb])
                R.check(not leak, f'{t} feuille coupée net, page couverte par le voile {leak}')
                shot(page, LOT, f'k1-clavier-ouvert-{t}')
                page.evaluate("() => document.getElementById('fakeKb').remove()")
                page.evaluate('() => __kb(0)')
                page.wait_for_timeout(200)
                back = page.evaluate("s => [document.documentElement.classList.contains('kb-open'), Math.round(document.querySelector(s + ' .sheet').getBoundingClientRect().bottom), innerHeight]", LIVE_SHEET)
                R.check(not back[0] and abs(back[1] - back[2]) <= 1, f'{t} clavier refermé : feuille revenue en bas {back}')
                R.check(not page.errors, f'{t} clavier : aucune erreur JS {page.errors[:2]}')


HIDE = """() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }"""
SHOW = """() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }"""


def big_title(page):
    """Jour affiché : en tête de la ligne du plan (le grand titre dit toujours « Nutrition », panel vague 4)."""
    return page.inner_text('.diet-plan-from__day').strip()


def t_jour_et_retirer(bench, eng, dev, theme):
    """Retour de Maxence du 10/11 : l'app rouverte restait sur « Hier » (ses ajouts partaient sur la veille), et un
    aliment du plan ne se retirait pas. Jour passé : « Revenir à aujourd'hui », toast « Ajouté à hier · Dîner », oublié au
    retour dans l'app après quelques minutes et sur une route restaurée ; aliment du plan : retirer, remettre, quantité."""
    t = tag(dev, theme) + '-jour'
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, with_plan(NOW))
        page.click('.diet-home__open')
        page.wait_for_selector('.nutrition-view .diet-sum')
        R.check(big_title(page) == "Aujourd'hui" and page.locator('[data-action="diet-today"]').count() == 0, f'{t} aujourd\'hui par défaut, sans bouton de retour')
        # Hier, choisi dans la frise : titre, bouton « Revenir à aujourd'hui », ajout sur hier dit dans le toast
        page.click('.diet-week__day[data-day="2026-11-04"]')
        page.wait_for_timeout(300)
        R.check(big_title(page) == 'Hier' and page.locator('[data-action="diet-today"]').is_visible(), f'{t} hier : titre et « Revenir à aujourd\'hui »')
        layout(page, t, 'hier')
        shot(page, LOT, f'j1-hier-{t}')
        page.click('[data-action="diet-day-add"][data-meal="m4"]')
        page.wait_for_selector('#dietFoodSearch')
        page.fill('#dietFoodSearch', 'huile olive')
        page.wait_for_timeout(200)
        page.locator('#dietFoodList .diet-cand').first.click()
        qty_grams(page, '10')
        page.wait_for_timeout(400)
        R.check('Ajouté à hier · Dîner' in toast(page), f'{t} toast « Ajouté à hier · Dîner » ({toast(page)!r})')
        R.check(page.evaluate("!!data.dietLog['2026-11-04']?.extras?.m4 && !data.dietLog['2026-11-05']"), f'{t} ajout enregistré sur hier')
        page.evaluate("document.querySelectorAll('.toast').forEach(x => x.remove())")
        page.click('[data-action="diet-today"]')
        page.wait_for_timeout(300)
        R.check(big_title(page) == "Aujourd'hui" and page.evaluate('currentRoute()') == 'nutrition', f'{t} « Revenir à aujourd\'hui »')
        # Hier choisi, app quittée 6 minutes : aujourd'hui au retour (1 minute : hier gardé)
        page.click('.diet-week__day[data-day="2026-11-04"]')
        page.wait_for_timeout(300)
        page.evaluate(HIDE)
        page.clock.run_for(60_000)
        page.evaluate(SHOW)
        page.wait_for_timeout(200)
        R.check(big_title(page) == 'Hier', f'{t} retour après 1 min : hier gardé')
        page.evaluate(HIDE)
        page.clock.run_for(5 * 60_000)
        page.evaluate(SHOW)
        page.wait_for_timeout(300)
        R.check(big_title(page) == "Aujourd'hui" and page.evaluate('currentRoute()') == 'nutrition', f'{t} retour après 6 min : aujourd\'hui ({page.evaluate("currentRoute()")})')
        # Route d'hier restaurée (retour système, historique) sans choix dans la frise : aujourd'hui
        page.evaluate("navigate(makeRoute('nutrition', '2026-11-04'), { replace: true })")
        page.wait_for_timeout(300)
        R.check(big_title(page) == "Aujourd'hui", f'{t} route d\'hier restaurée : aujourd\'hui')
        # Retirer l'œuf pour aujourd'hui : feuille de l'aliment, ligne barrée « Remettre », totaux recalculés, Annuler
        page.click('.diet-meal[data-meal="m1"] .diet-item[data-item="i1"]')
        page.wait_for_selector(f'{LIVE_SHEET} [data-swap="off"]')
        sw = page.inner_text('.diet-swap')
        R.check('Changer la quantité' in sw and "Retirer pour aujourd'hui" in sw, f'{t} feuille : quantité et retirer')
        R.check(small_targets(page, '.sheet button.diet-cand') == [], f'{t} feuille : 44 pt')
        page.locator(f'{LIVE_SHEET} [data-swap="off"]').scroll_into_view_if_needed()
        shot(page, LOT, f'j2-feuille-aliment-{t}')
        meal0 = page.evaluate("Math.round(dietDayProgress(data, data.dietActive).meals[0].macros.kcal)")
        egg = page.evaluate("Math.round(dietItemMacros(data.dietPlans.d_masse01.meals[0].items[0]).kcal)")
        page.click(f'{LIVE_SHEET} [data-swap="off"]')
        page.wait_for_timeout(400)
        row = page.locator('.diet-item--off[data-item="i1"]')
        R.check(row.count() == 1 and 'Remettre' in row.inner_text() and 'Retiré aujourd' in row.inner_text(), f'{t} ligne barrée « Remettre »')
        after = page.evaluate("Math.round(dietDayProgress(data, data.dietActive).meals[0].macros.kcal)")
        R.check(abs(after - (meal0 - egg)) <= 1, f'{t} repas recalculé ({meal0} - {egg} = {after})')
        R.check(page.evaluate("data.dietPlans.d_masse01.meals[0].items.length") == 2, f'{t} le plan ne change pas')
        R.check("Retiré pour aujourd'hui" in toast(page), f'{t} toast avec Annuler ({toast(page)!r})')
        layout(page, t, 'aliment retiré')
        page.evaluate("document.querySelector('.diet-meal[data-meal=\"m1\"]').scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'j3-aliment-retire-{t}')
        page.locator('.toast__action').click()
        page.wait_for_timeout(300)
        R.check(page.locator('.diet-item--off').count() == 0, f'{t} Annuler : remis')
        page.click('.diet-meal[data-meal="m1"] .diet-item[data-item="i1"]')
        page.click(f'{LIVE_SHEET} [data-swap="off"]')
        page.wait_for_timeout(400)
        page.evaluate("document.querySelectorAll('.toast').forEach(x => x.remove())")
        page.click('.diet-item--off[data-item="i1"]')
        page.wait_for_timeout(300)
        R.check(page.locator('.diet-item--off').count() == 0 and abs(page.evaluate("Math.round(dietDayProgress(data, data.dietActive).meals[0].macros.kcal)") - meal0) <= 1, f'{t} « Remettre » d\'un toucher')
        # Changer la quantité de la banane : 60 g au lieu de 120, « Prévu : 120 g »
        page.click('.diet-meal[data-meal="m1"] .diet-item[data-item="i2"]')
        page.wait_for_selector(f'{LIVE_SHEET} [data-swap="qty"]')
        page.click(f'{LIVE_SHEET} [data-swap="qty"]')
        qty_grams(page, '60')
        page.wait_for_timeout(400)
        R.check(page.evaluate("dietDayProgress(data, data.dietActive).swaps.i2?.g") == 60, f'{t} quantité du jour : 60 g')
        R.check('Prévu' in page.inner_text('.diet-item[data-item="i2"]') and page.evaluate("data.dietPlans.d_masse01.meals[0].items[1].g") == 120, f'{t} « Prévu : 120 g », plan inchangé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


def t_minuit(bench):
    """Écran Nutrition, puis carte de l'accueil, ouverts avant minuit : après minuit, la nouvelle journée, et ce qu'on coche y va."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone 13']
    eve = local_ms(2026, 11, 5, 23, 58, tz=PARIS)
    with bench.frozen_page(eve, eng, 'iPhone 13', 'dark') as page:
        open_app(page, 'dark', with_plan(eve))
        page.click('.diet-home__open')
        page.wait_for_selector('.nutrition-view .diet-sum')
        page.click('.diet-meal[data-meal="m1"] [data-action="diet-check"]')
        page.wait_for_timeout(200)
        page.clock.run_for(150_000)   # 00 h 00 min 30, écran ouvert
        page.wait_for_timeout(300)
        day = page.get_attribute('.diet-week__day--on', 'data-day')
        R.check(big_title(page) == "Aujourd'hui" and day == '2026-11-06' and page.locator('.diet-meal--done').count() == 0, f'minuit écran ouvert : nouvelle journée ({day})')
        page.click('.diet-meal[data-meal="m1"] [data-action="diet-check"]')
        page.wait_for_timeout(200)
        R.check(page.evaluate("[data.dietLog['2026-11-05']?.done, data.dietLog['2026-11-06']?.done]") == [['m1'], ['m1']], 'coché après minuit : sur le nouveau jour, la veille intacte')
        R.check(not page.errors, f'minuit : aucune erreur JS {page.errors[:2]}')
    eve = local_ms(2026, 11, 5, 23, 59, tz=PARIS)
    with bench.frozen_page(eve, eng, 'iPhone 13', 'light') as page:
        open_app(page, 'light', with_plan(eve))
        page.click('.diet-home [data-action="diet-check"]')
        page.wait_for_timeout(200)
        R.check(page.locator('.diet-home__meal--next[data-meal="m2"]').count() == 1, 'accueil 23 h 59 : petit-déjeuner coché')
        page.clock.run_for(90_000)
        page.wait_for_timeout(300)
        R.check(page.locator('.diet-home__meal--next[data-meal="m1"]').count() == 1 and page.locator('.diet-home__meal--done').count() == 0,
                f'minuit : carte de l\'accueil sur la nouvelle journée ({page.inner_text(".diet-home")!r})')
        R.check(not page.errors, f'minuit accueil : aucune erreur JS {page.errors[:2]}')


# ── Vague 4 (demandes de Maxence) ───────────────────────────

def t_vague4(bench, eng, dev, theme):
    """Vague 4 : carte de l'accueil (nom du plan, tous les repas), légende des macros, « Créer « … » » en tête,
    étiquettes cru / cuit, rappel « Pesé cuit ? » avec la version cuite prise d'un toucher."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, with_plan(NOW))
        card = page.locator('.diet-home')
        card.scroll_into_view_if_needed()
        R.check(nb(page.inner_text('.diet-home__plan')) == 'Prise de masse', f'{t} v4 carte : nom du plan')
        rows = page.locator('.diet-home__meal')
        names = [nb(x) for x in page.locator('.diet-home__mname').all_inner_texts()]
        R.check(names == ['Petit-déjeuner', 'Déjeuner', 'Collation', 'Dîner'], f'{t} v4 carte : les 4 repas ({names})')
        kc = [nb(x) for x in page.locator('.diet-home__mkcal').all_inner_texts()]
        R.check(len(kc) == 4 and all(re.fullmatch(r'\d[\d ]* kcal', k) for k in kc), f'{t} v4 carte : kcal de chaque repas ({kc})')
        R.check(page.locator('.diet-home [data-action="diet-check"]').count() == 1
                and page.locator('.diet-home__meal--next[data-meal="m1"] [data-action="diet-check"]').count() == 1, f'{t} v4 carte : un seul bouton, sur le prochain repas')
        lbl = page.get_attribute('.diet-home__open', 'aria-label') or ''
        R.check('Prise de masse' in lbl and 'Déjeuner' in lbl and 'Dîner' in lbl and lbl.endswith('Ouvrir'), f'{t} v4 carte : VoiceOver dit le plan et les repas ({lbl[:90]!r})')
        R.check(page.evaluate("[...document.querySelectorAll('.diet-home__mtext')].every(e => e.getAttribute('aria-hidden') === 'true')"), f'{t} v4 carte : lignes cachées à VoiceOver (dites par le bouton)')
        h = page.evaluate("document.querySelector('.diet-home').getBoundingClientRect().height")
        R.check(rows.count() == 4 and h < 330, f'{t} v4 carte : compacte ({round(h)} px)')
        layout(page, t, 'v4 carte de l\'accueil')
        shot(page, LOT, f'v4-1-carte-{t}')
        page.click('.diet-home [data-action="diet-check"]')
        page.wait_for_timeout(300)
        R.check(page.locator('.diet-home__meal--done[data-meal="m1"]').count() == 1 and page.locator('.diet-home__meal--next[data-meal="m2"] .diet-check').count() == 1,
                f'{t} v4 carte : coché d\'un toucher, le suivant prend le bouton')
        shot(page, LOT, f'v4-2-carte-cochee-{t}')
        # Toucher une ligne (pas le bouton) : ouvre Nutrition ; légende des lettres une fois sous « Repas »
        page.locator('.diet-home__meal[data-meal="m3"] .diet-home__mtext').click()
        page.wait_for_selector('.nutrition-view .diet-sum')
        leg = page.locator('.nutrition-view .diet-legend')
        R.check(leg.count() == 1 and nb(leg.inner_text()) == 'P protéines · G glucides · L lipides' and leg.get_attribute('aria-hidden') == 'true',
                f'{t} v4 Nutrition : légende des macros, une fois ({leg.count()})')
        layout(page, t, 'v4 Nutrition légende')
        # Recherche : « whey » absent de Ciqual → « Créer « whey » » en tête, nom prérempli
        open_editor(page)
        R.check(page.locator('.diet-plan-view .diet-legend').count() == 1, f'{t} v4 éditeur : légende des macros')
        page.locator('[data-action="diet-add-food"]').nth(2).click()
        page.wait_for_selector('#dietFoodSearch')
        page.fill('#dietFoodSearch', 'whey')
        page.wait_for_timeout(200)
        first = page.locator('#dietFoodList > *').first
        R.check('diet-cand--create' in (first.get_attribute('class') or '') and nb(first.locator('.diet-cand__name').inner_text()) == 'Créer « whey »',
                f'{t} v4 recherche : « Créer « whey » » en tête')
        R.check(page.locator('.diet-pick > .diet-cand--new').count() == 1, f'{t} v4 recherche : « Créer un aliment » reste en bas')
        shot(page, LOT, f'v4-3-creer-en-tete-{t}')
        first.click()
        page.wait_for_selector('#dietFoodName')
        R.check(page.input_value('#dietFoodName') == 'Whey', f'{t} v4 créer : nom prérempli ({page.input_value("#dietFoodName")!r})')
        page.click(f'{LIVE_SHEET} .sheet__btn--cancel')
        page.wait_for_timeout(350)
        # Riz blanc : trouvé pile, pas de « Créer » ; étiquettes cru / cuit
        page.locator('[data-action="diet-add-food"]').nth(2).click()
        page.wait_for_selector('#dietFoodSearch')
        page.fill('#dietFoodSearch', 'riz blanc')
        page.wait_for_timeout(200)
        R.check(page.locator('#dietFoodList .diet-cand--create').count() == 0, f'{t} v4 recherche : « riz blanc » trouvé pile, pas de « Créer »')
        tags = page.evaluate("""[...document.querySelectorAll('#dietFoodList .diet-cand')].map(b => [b.querySelector('.diet-cand__name')?.textContent, b.querySelector('.diet-tag')?.textContent || ''])""")
        crus = [n for n, tg in tags if tg == 'cru']
        cuits = [n for n, tg in tags if tg == 'cuit']
        R.check('Riz blanc, cru' in crus and 'Riz blanc, cuit, sans sel ajouté' in cuits, f'{t} v4 recherche : étiquettes cru et cuit ({len(crus)} cru, {len(cuits)} cuit)')
        R.check(page.locator('#dietFoodList .diet-legend').count() == 1, f'{t} v4 recherche : légende des macros')
        # Barre de la feuille mesurée après son animation d'ouverture (en CI, mesurée pendant : « Annuler » à 40 pt)
        page.wait_for_function("s => [...document.querySelectorAll(s)].every(e => !e.getAnimations().length)", arg=f'{LIVE_SHEET}, {LIVE_SHEET} *')
        st = small_targets(page, f'{LIVE_SHEET} button')
        if st:   # détail pour comprendre un échec en CI (taille de chaque bouton trop petit, taille de la fenêtre)
            st = page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled).map(e => [e.textContent.trim().slice(0, 12), e.getBoundingClientRect()])
                .filter(([, r]) => r.width < 44 || r.height < 44).map(([n, r]) => n + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)).concat(['vue ' + innerWidth + 'x' + innerHeight])""", f'{LIVE_SHEET} button')
        R.check(not st, f'{t} v4 recherche : 44 pt {st}')
        ct = cut_texts(page, LIVE_SHEET)
        R.check(not ct, f'{t} v4 recherche : aucun texte coupé {ct}')
        shot(page, LOT, f'v4-4-cru-cuit-{t}')
        # Riz blanc cru choisi : « Pesé cuit ? Choisis la version cuite. », un toucher prend le riz cuit
        pick_food(page, 'riz blanc', 'Riz blanc, cru')
        page.wait_for_selector(f'{LIVE_SHEET} .qty__twin')
        tw = nb(page.inner_text(f'{LIVE_SHEET} .qty__twin'))
        R.check('Pesé cuit ? Choisis la version cuite.' in tw and 'Riz blanc, cuit, sans sel ajouté' in tw, f'{t} v4 quantité : rappel cru / cuit ({tw!r})')
        R.check(page.input_value(f'{LIVE_SHEET} #qtyVal') == '100', f'{t} v4 quantité : 100 g d\'office')
        R.check(small_targets(page, f'{LIVE_SHEET} button') == [] and not cut_texts(page, LIVE_SHEET), f'{t} v4 quantité : 44 pt, aucun texte coupé')
        shot(page, LOT, f'v4-5-pese-cuit-{t}')
        page.click(f'{LIVE_SHEET} [data-qtwin]')
        page.wait_for_timeout(400)
        page.wait_for_selector(f'{LIVE_SHEET} #qtyVal, .ios-dialog__input')
        R.check(page.locator(f'{LIVE_SHEET} .qty__twin').count() == 0, f'{t} v4 version cuite : pas de second rappel')
        qty_grams(page, '180')
        page.wait_for_timeout(400)
        it = page.evaluate("data.dietPlans.d_masse01.meals[2].items.at(-1)")
        R.check(it and it['food'] == RIZ and it['g'] == 180, f'{t} v4 version cuite ajoutée ({it and it["name"]}, {it and it["g"]} g)')
        R.check(not page.errors, f'{t} v4 aucune erreur JS {page.errors[:2]}')


def t_vague4_six_repas(bench):
    """Carte de l'accueil avec 6 repas : 3 autour du prochain et « et 3 autres », iPhone SE en texte agrandi."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone SE']
    plan = json.loads(json.dumps(PLAN))
    plan['meals'] += [{'id': 'm5', 'name': 'Collation du soir', 'items': [food_item(BANANE, 120, 'i9')]},
                      {'id': 'm6', 'name': 'Avant de dormir', 'items': [food_item(OEUF, 100, 'i10')]}]
    d = ppl_v2_today(now_ms=NOW)
    d['dietPlans'] = {'d_masse01': plan}
    d['dietActive'] = 'd_masse01'
    d['dietLog'] = {'2026-11-05': {'plan': 'd_masse01', 'done': ['m1', 'm2', 'm3'], 'swaps': {}}}
    for theme in ('light', 'dark'):
        with bench.frozen_page(NOW, eng, 'iPhone SE', theme) as page:
            open_app(page, theme, json.dumps(d, ensure_ascii=False))
            page.locator('.diet-home').scroll_into_view_if_needed()
            ids = page.evaluate("[...document.querySelectorAll('.diet-home__meal')].map(e => e.dataset.meal)")
            R.check(ids == ['m3', 'm4', 'm5'] and nb(page.inner_text('.diet-home__more')) == 'et 3 autres', f'{theme} 6 repas : 3 autour du prochain, « et 3 autres » ({ids})')
            layout(page, f'SE-{theme}', '6 repas')
            shot(page, LOT, f'v4-6-six-repas-iPhone_SE-{theme}')
            # Texte agrandi : rien de coupé, 44 pt, pas de défilement de côté
            page.add_style_tag(content='html { font-size: 28px !important; }')
            page.evaluate("window.dispatchEvent(new Event('resize'))")
            page.wait_for_timeout(300)
            R.check(page.evaluate("document.documentElement.classList.contains('type-xl')"), f'{theme} texte agrandi actif')
            page.locator('.diet-home').scroll_into_view_if_needed()
            layout(page, f'SE-{theme}', '6 repas texte agrandi')
            shot(page, LOT, f'v4-7-six-repas-xl-iPhone_SE-{theme}')


def t_vague4_plein(bench):
    """Mes aliments plein (200) : prévenu, jamais le plus ancien retiré ; ajouter sans garder ; Gérer Mes aliments, retirer, Annuler."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone 13']
    d = ppl_v2_today(now_ms=NOW)
    d['dietPlans'] = {'d_masse01': PLAN}
    d['dietActive'] = 'd_masse01'
    d['dietFoods'] = [{'id': f'f{i}', 'name': f'Aliment perso {i}', 'fam': 'p', 'per': {'k': 100, 'p': 10, 'c': 10, 'f': 1}} for i in range(200)]
    seed_json = json.dumps(d, ensure_ascii=False)
    for theme in ('dark', 'light'):
        with bench.frozen_page(NOW, eng, 'iPhone 13', theme) as page:
            open_app(page, theme, seed_json)
            open_editor(page)

            def create(name):
                page.locator('[data-action="diet-add-food"]').nth(2).click()
                page.wait_for_selector('#dietFoodSearch')
                page.click('.diet-cand--new')
                page.wait_for_selector('#dietFoodName')
                page.fill('#dietFoodName', name)
                page.fill('#dietFoodP', '20')
                page.click('.sheet__btn--confirm')
                page.wait_for_selector('.ios-dialog')
            create('Barre maison')
            msg = page.inner_text('.ios-dialog')
            R.check('Mes aliments est plein' in msg and '200' in msg, f'{theme} plein : prévenu ({msg[:60]!r})')
            shot(page, LOT, f'v4-8-plein-{theme}')
            tap_dialog(page, 'Ajouter sans le garder')
            qty_grams(page, '50')
            page.wait_for_timeout(400)
            R.check(page.evaluate("data.dietPlans.d_masse01.meals[2].items.at(-1).name") == 'Barre maison', f'{theme} plein : ajouté au repas')
            R.check(page.evaluate("[data.dietFoods.length, data.dietFoods.at(-1).id, data.dietFoods.some(x => x.name === 'Barre maison')]") == [200, 'f199', False],
                    f'{theme} plein : rien retiré, pas gardé')
            # Gérer Mes aliments : la liste, retirer, Annuler
            create('Barre maison 2')
            tap_dialog(page, 'Gérer Mes aliments')
            page.wait_for_selector('.diet-foods-view')
            R.check('200 sur 200' in nb(page.inner_text('.diet-foods-view')) and page.locator('.diet-foods-view .diet-low').count() == 1, f'{theme} Mes aliments : 200 sur 200, plein dit')
            R.check(page.locator('.diet-foods-view [data-action="diet-food-menu"]').count() == 200, f'{theme} Mes aliments : la liste')
            layout(page, theme, 'Mes aliments')
            shot(page, LOT, f'v4-9-mes-aliments-{theme}')
            page.locator('.diet-foods-view [data-action="diet-food-menu"]').first.click()
            tap_dialog(page, 'Retirer de Mes aliments')
            page.wait_for_timeout(300)
            R.check(page.evaluate("[data.dietFoods.length, data.dietFoods[0].id, data.dietFoodsGone]") == [199, 'f1', ['f0']], f'{theme} retiré, noté pour la synchro')
            R.check('199 sur 200' in nb(page.inner_text('.diet-foods-view')) and 'Retiré : Aliment perso 0' in toast(page), f'{theme} retiré : compteur et toast')
            page.locator('.toast__action').click()
            page.wait_for_timeout(300)
            R.check(page.evaluate("[data.dietFoods.length, data.dietFoods[0].id, data.dietFoodsGone ?? null]") == [200, 'f0', None], f'{theme} Annuler : remis à sa place')
            # Réglages de la nutrition : entrée « Mes aliments »
            page.evaluate("navigate('diet-settings')")
            page.wait_for_selector('[data-action="go-diet-foods"]')
            R.check('200' in page.inner_text('[data-action="go-diet-foods"]'), f'{theme} réglages : Mes aliments et son nombre')
            R.check(not page.errors, f'{theme} plein : aucune erreur JS {page.errors[:2]}')


run_main(R, [t_journee, t_creer_plan, t_coach_eleve, t_unites, t_jour_et_retirer, t_vague4],
         once=[t_sans_base, t_ancienne_coche, t_invitation, t_plan_neuf_puis_coach, t_clavier, t_minuit, t_vague4_six_repas, t_vague4_plein])
