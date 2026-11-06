"""Nutrition V1 (docs/NUTRITION_V1.md) : plan diète créé sans coach (Programme › Plans diète, recherche
dans la base Ciqual, quantité, objectifs), journée dans Entraînement › Nutrition (frise, anneau, repas
cochés d'un toucher, repas suivant, remplacement d'un aliment pour la journée), carte de l'accueil
(cocher le prochain repas sans ouvrir l'écran), plan envoyé par le coach (fiche de l'élève, canal des
programmes) et reçu par l'élève (carte de l'accueil, « Suivre ce plan », Mon coach), base indisponible.

L'app iOS et Supabase sont simulés (tests/fake_account.py) : aucune requête ne sort. Captures :
$PPL_SCRATCH/shots/lotnutrition/ (chaque écran, clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_nutrition.py (ou run_all.py nutrition).
"""
import json
import os
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
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def cut_texts(page, scope='#app'):
    return page.evaluate("""s => [...document.querySelectorAll(s + ' *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .sr-text') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""", scope)


def layout(page, t, name, scope='#app'):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page, f'{scope} button, .tabbar button')
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page, scope)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')
    R.check(not page.errors, f'{t} {name} : aucune erreur JS {page.errors[:2]}')


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
        shot(page, LOT, f'1-accueil-{t}')
        # Cocher depuis l'accueil : un seul toucher, le repas suivant prend la place
        page.click('.diet-home [data-action="diet-check"]')
        page.wait_for_timeout(250)
        R.check(page.evaluate("dietDayProgress(data, data.dietActive).meals[0].done") is True, f'{t} accueil : petit-déjeuner coché d\'un toucher')
        R.check('Déjeuner' in page.inner_text('.diet-home'), f'{t} accueil : le déjeuner passe devant')
        R.check(page.evaluate("JSON.parse(localStorage.getItem('ppl_v2')).dietLog['2026-11-05'].done[0]") == 'm1', f'{t} coche enregistrée')
        # Écran Nutrition
        page.click('.diet-home__open')
        page.wait_for_selector('.nutrition-view .diet-sum')
        txt = page.inner_text('.nutrition-view')
        R.check("Aujourd'hui" in txt and 'Prise de masse' in txt, f'{t} Nutrition : titre et plan')
        R.check('sur 2 600 kcal' in txt.replace(' ', ' ').replace('\xa0', ' '), f'{t} Nutrition : objectif de calories du plan')
        R.check(page.locator('.diet-week__day').count() == 7 and page.get_attribute('.diet-week__day--on', 'data-day') == '2026-11-05', f'{t} frise : 7 jours, aujourd\'hui choisi')
        R.check(page.locator('.diet-meal--done').count() == 1 and page.locator('.diet-meal--done .diet-item').count() == 0, f'{t} repas coché replié')
        R.check(page.locator('.diet-meal--next[data-meal="m2"]').count() == 1 and 'ensuite' in page.inner_text('.diet-meal--next').lower(), f'{t} déjeuner marqué « Ensuite »')
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
        R.check(page.locator('.diet-meal[data-meal="m1"] .diet-item').count() == 2, f'{t} repas coché déplié au toucher')
        # Journée complète
        for m in ('m3', 'm4'):
            page.click(f'.diet-meal[data-meal="{m}"] [data-action="diet-check"]')
            page.wait_for_timeout(250)
        R.check('Journée complète' in page.inner_text('.diet-sum'), f'{t} journée complète')
        shot(page, LOT, f'4-journee-complete-{t}')
        # Hier : frise, jour vide
        page.click('.diet-week__day[data-day="2026-11-04"]')
        page.wait_for_timeout(300)
        R.check(page.inner_text('.navbar__large').strip() == 'Hier' and page.locator('.diet-meal--done').count() == 0, f'{t} hier : rien de coché')
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
        page.fill('.ios-dialog__input', 'Ma sèche')
        tap_dialog(page, 'Créer')
        page.wait_for_selector('.diet-plan-view')
        R.check(page.locator('[data-action="diet-add-food"]').count() == 4, f'{t} plan neuf : 4 repas')
        R.check(page.evaluate('data.dietActive') == page.evaluate("Object.keys(data.dietPlans)[0]"), f'{t} premier plan : suivi')
        # Ajouter du riz cuit au petit-déjeuner : recherche, choix, 150 g
        page.locator('[data-action="diet-add-food"]').first.click()
        page.wait_for_selector('#dietFoodSearch')
        R.check(page.evaluate("document.activeElement.id") == 'dietFoodSearch', f'{t} recherche active (clavier)')
        page.fill('#dietFoodSearch', 'riz cuit')
        page.wait_for_timeout(200)
        R.check(page.locator('#dietFoodList .diet-cand').count() >= 5, f'{t} recherche : résultats')
        shot(page, LOT, f'6-recherche-{t}')
        first = page.locator('#dietFoodList .diet-cand .diet-cand__name').first.inner_text()
        page.locator('#dietFoodList .diet-cand').first.click()
        page.wait_for_selector('.ios-dialog__input')
        page.fill('.ios-dialog__input', '150')
        tap_dialog(page, 'OK')
        page.wait_for_timeout(300)
        it = page.evaluate("Object.values(data.dietPlans)[0].meals[0].items[0]")
        R.check(it and it['name'] == first and it['g'] == 150 and it['per']['k'] > 0, f'{t} aliment ajouté avec ses valeurs ({it and it["name"]})')
        R.check('150 g' in page.inner_text('.diet-plan-view'), f'{t} éditeur : quantité affichée')
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
        page.wait_for_selector('.ios-dialog__input')
        page.fill('.ios-dialog__input', '200')
        tap_dialog(page, 'OK')
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
        R.check(page.locator('.diet-low').count() == 1 and '1 200 kcal' in page.inner_text('.diet-low'), f'{t} total sous 1 200 kcal : message de santé, rien de bloqué')
        layout(page, t, 'éditeur du plan')
        shot(page, LOT, f'8-editeur-{t}')
        page.evaluate("goBack()")
        page.wait_for_selector('.diet-plans-view')
        R.check('Suivi' in page.inner_text('.diet-plans-view'), f'{t} liste : plan suivi')
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
        page.wait_for_timeout(500)
        R.check("Ton élève doit d'abord accepter les plans diète dans son app." in toast(page) and not page.evaluate("__sb.co.progs.length"), f'{t} coach : refus clair sans l\'accord de l\'élève')
        page.evaluate(f"__sb.co.shares.push({{ student: '{uid}', coach: __sb.meId(), kind: 'diet', granted_at: new Date().toISOString() }})")
        page.click('[data-action="coach-send-diet"]')
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'Sèche Léa')
        page.wait_for_timeout(500)
        sent = page.evaluate("__sb.co.progs.find(p => p.id === 'diet_lea00001')")
        R.check(sent and sent['data']['kind'] == 'diet' and 'name' not in sent['data'] and sent['data']['diet']['name'] == 'Sèche Léa', f'{t} coach : plan envoyé par le canal des programmes, sans nom au premier niveau')
        page.wait_for_timeout(300)
        g = page.inner_text('.coach-student-view')
        R.check('Sèche Léa' in g and 'Pas encore ouvert' in g, f'{t} fiche : plan envoyé, pas encore ouvert')
        R.check('diet_' not in g and 'Programme supprimé' not in g, f'{t} fiche : le plan n\'est pas listé comme un programme')
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
        R.check('de max' in page.inner_text('.diet-plan-from') and 'Bois 2 L par jour.' in page.inner_text('.nutrition-view'), f'{t} élève : plan du coach et sa consigne')
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
            page.wait_for_timeout(2600)   # toast « Journée complète, bravo » parti
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
            page.click('.diet-invite [data-action="diet-coach-accept"]')
            page.wait_for_selector('.ios-dialog')
            tap_dialog(page, 'Accepter')
            page.wait_for_timeout(500)
            R.check(page.evaluate("data.dietCoachConsent.on") is True and 'Plan secret' in page.inner_text('#app'), f'{theme} serveur d\'avant : accord gardé sur l\'appareil, plan affiché')
            R.check(not page.errors, f'{theme} invitation : aucune erreur JS {page.errors[:2]}')


run_main(R, [t_journee, t_creer_plan, t_coach_eleve], once=[t_sans_base, t_ancienne_coche, t_invitation, t_plan_neuf_puis_coach])
