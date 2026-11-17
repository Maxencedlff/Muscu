"""Eau (docs/EAU.md) : objectif en litres, ajouts d'un toucher (accueil et Nutrition), Annuler, quantité libre,
objectif changé par pas de 0,25 L, historique du jour et des 7 derniers jours, contenants perso, objectif fixé par le
coach dans le plan, petite carte seule sans plan, passage de minuit, texte agrandi sur iPhone SE.

Captures : $PPL_SCRATCH/shots/loteau/ (clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_eau.py (ou run_all.py eau).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'eau'
R = Results(LOT)
# Jeudi 5 novembre 2026, 13 h 40 à Paris
NOW = local_ms(2026, 11, 5, 13, 40, tz=PARIS)
TODAY = '2026-11-05'

ITEM = {'id': 'i1', 'name': 'Riz blanc, cuit', 'food': 9104, 'fam': 'f', 'g': 200, 'per': {'k': 145, 'p': 3, 'c': 31, 'f': 0.5}}
PLAN = {'name': 'Prise de masse', 'targets': {'kcal': 2600, 'p': 160}, 'meals': [
    {'id': 'm1', 'name': 'Petit-déjeuner', 'items': [dict(ITEM, id='i1')]},
    {'id': 'm2', 'name': 'Déjeuner', 'items': [dict(ITEM, id='i2')]},
    {'id': 'm3', 'name': 'Dîner', 'items': [dict(ITEM, id='i3')]},
]}


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def nb(v):
    return (v or '').replace(' ', ' ').replace(' ', ' ')


def data_json(now_ms, plan=True, water=True, **extra):
    d = ppl_v2_today(now_ms=now_ms)
    # Aucune séance aujourd'hui : l'objectif ne dépend pas du jour où l'historique de test tombe
    d['history'] = [h for h in d['history'] if h['date'] < now_ms - 86400000]
    if plan:
        d['dietPlans'] = {'d_masse01': PLAN}
        d['dietEmptyDays'] = False
        d['dietActive'] = 'd_masse01'
    if water:
        d['waterOn'] = True
    d['strengthSex'] = 'male'
    d.update(extra)
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


def open_app(page, theme, ppl_v2):
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2, extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def total(page, day=None):
    return page.evaluate('d => waterDayMl(data, d || localISO())', day)


def goal(page):
    return page.evaluate('waterState().goal.l')


def fr(v):
    s = ('%.2f' % v).rstrip('0').rstrip('.')
    return s.replace('.', ',')


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small_targets(page, sel):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def cut_texts(page, scope):
    return page.evaluate("""s => [...document.querySelectorAll(s + ' *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .sr-text') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""", scope)


def layout(page, t, name, scope):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page, f'{scope} button')
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page, scope)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')
    R.check(not page.errors, f'{t} {name} : aucune erreur JS {page.errors[:2]}')


def big_text(page):
    page.add_style_tag(content='html { font-size: 28px !important; }')
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    page.wait_for_timeout(300)


def t_parcours(bench, eng, dev, theme):
    """Accueil : « + Verre » ajoute tout de suite, Annuler retire ; Nutrition : boutons, Autre, objectif, historique."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, data_json(NOW))
        g = goal(page)
        R.check(g == 2, f'{t} repère : 2 L pour un homme sans séance aujourd\'hui ({g})')
        row = page.locator('.diet-home .water-home')
        R.check(row.count() == 1, f'{t} accueil : ligne Eau dans la carte Nutrition')
        R.check(page.locator('.water-home-card').count() == 0, f'{t} accueil : pas de seconde carte')
        R.check(nb(page.inner_text('.water-home__line')) == 'Eau\n0 / 2 L' or nb(page.inner_text('.water-home__line')).replace('\n', ' ') == 'Eau 0 / 2 L',
                f'{t} accueil : « Eau 0 / 2 L » ({page.inner_text(".water-home__line")!r})')
        row.scroll_into_view_if_needed()
        layout(page, t, 'accueil', '.diet-home')
        page.click('.water-add--home')
        page.wait_for_timeout(250)
        R.check(total(page) == 250, f'{t} « + Verre » : 25 cl ajoutés d\'un toucher ({total(page)})')
        toast = nb(page.inner_text('.toast')) if page.locator('.toast').count() else ''
        R.check(toast.startswith('+ 25 cl · 0,25 sur 2 L') and 'Annuler' in toast, f'{t} toast : {toast!r}')
        R.check('0,25' in nb(page.inner_text('.water-home__val')), f'{t} accueil : ligne mise à jour')
        shot(page, LOT, f'1-accueil-{t}')
        page.locator('.toast__action').click()
        page.wait_for_timeout(250)
        R.check(total(page) == 0, f'{t} Annuler : retiré')
        page.click('.water-add--home')
        page.wait_for_timeout(200)
        # Nutrition : la carte Eau
        page.click('.water-home__open')
        page.wait_for_selector('.nutrition-view .water-card')
        page.locator('.water-card').scroll_into_view_if_needed()
        txt = nb(page.inner_text('.water-card'))
        R.check('0,25 sur 2 L' in txt and 'Objectif conseillé' in txt, f'{t} Nutrition : « 0,25 sur 2 L » ({txt[:80]!r})')
        labels = [nb(x).replace('\n', ' ') for x in page.locator('.water-card__btns .water-add').all_inner_texts()]
        R.check(labels == ['Verre 25 cl', 'Bouteille 50 cl', '1 L', 'Autre'], f'{t} boutons rapides {labels}')
        layout(page, t, 'Nutrition', '.water-card')
        page.click('.water-card [data-ml="500"]')
        page.wait_for_timeout(200)
        page.click('.water-card [data-ml="1000"]')
        page.wait_for_timeout(200)
        R.check(total(page) == 1750, f'{t} bouteille et 1 L ({total(page)})')
        # Quantité libre : 33 cl
        page.click('.water-card [data-action="water-other"]')
        page.fill('.ios-dialog__input', '33')
        tap_dialog(page, 'Ajouter')
        R.check(total(page) == 2080, f'{t} Autre : 33 cl ({total(page)})')
        txt = nb(page.inner_text('.water-card'))
        R.check('Objectif atteint' in txt, f'{t} objectif atteint dit sobrement ({txt[:80]!r})')
        R.check(page.evaluate("getComputedStyle(document.querySelector('.water-bar__fill')).backgroundColor") ==
                page.evaluate("getComputedStyle(document.querySelector('.water-card__goal .icon')).color"), f'{t} jauge : le vert de l\'avancée')
        shot(page, LOT, f'2-nutrition-{t}')
        # Objectif : + 0,25 L
        page.click('.water-card__top')
        page.wait_for_selector('.sheet .water-gs')
        page.click('.sheet [data-wstep="1"]')
        R.check(nb(page.inner_text('#waterGsVal')) == '2,25 L', f'{t} objectif : pas de 0,25 L')
        shot(page, LOT, f'3-objectif-{t}')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(300)
        R.check(page.evaluate('data.waterGoalL') == 2.25 and 'sur 2,25 L' in nb(page.inner_text('.water-card')), f'{t} objectif choisi : 2,25 L')
        # Historique : supprimer le dernier ajout
        page.click('.water-card__log')
        page.wait_for_selector('.sheet .water-log')
        R.check(page.locator('.water-log__row').count() == 4 and page.locator('.water-log__day').count() == 7, f'{t} historique : 4 ajouts, 7 jours')
        layout(page, t, 'historique', '.sheet')
        shot(page, LOT, f'4-historique-{t}')
        page.locator('.water-log__del').first.click()
        page.wait_for_timeout(200)
        R.check(total(page) == 1750 and page.locator('.water-log__row').count() == 3, f'{t} historique : le dernier ajout supprimé ({total(page)})')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(300)
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


def t_seul_sans_plan(bench):
    """Sans plan de nutrition, l'eau suivie : une petite carte sur l'accueil, la carte Eau en tête de Nutrition ;
    iPhone SE, clair et sombre, puis texte agrandi."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone SE']
    for theme in ('light', 'dark'):
        t = f'SE-{theme}'
        with bench.frozen_page(NOW, eng, 'iPhone SE', theme) as page:
            open_app(page, theme, data_json(NOW, plan=False, waterLog={TODAY: [{'id': 'a1', 'ml': 500, 'at': NOW - 3600000}, {'id': 'a2', 'ml': 700, 'at': NOW - 600000}]}))
            card = page.locator('.water-home-card')
            R.check(card.count() == 1 and page.locator('.diet-home').count() == 0, f'{t} accueil : petite carte Eau seule')
            card.scroll_into_view_if_needed()
            R.check('1,2 / 2 L' in nb(page.inner_text('.water-home-card')), f'{t} « 1,2 / 2 L »')
            layout(page, t, 'carte seule', '.water-home-card')
            shot(page, LOT, f'5-accueil-seule-{t}')
            big_text(page)
            R.check(page.evaluate("document.documentElement.classList.contains('type-xl')"), f'{t} texte agrandi actif')
            page.locator('.water-home-card').scroll_into_view_if_needed()
            layout(page, t, 'carte seule, texte agrandi', '.water-home-card')
            shot(page, LOT, f'6-accueil-seule-xl-{t}')
            page.click('.water-home__open')
            page.wait_for_selector('.nutrition-view .water-card')
            order = page.evaluate("[...document.querySelectorAll('.nutrition-view .water-card, .nutrition-view .diet-empty')].map(e => e.className.split(' ')[0])")
            R.check(order == ['water-card', 'diet-empty'], f'{t} Nutrition : la carte Eau d\'abord ({order})')
            layout(page, t, 'Nutrition texte agrandi', '.water-card')
            shot(page, LOT, f'7-nutrition-xl-{t}')


def t_coach_objectif(bench):
    """Plan du coach avec targets.water = 3 L : affiché sans activer le suivi, objectif en lecture seule."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone 13']
    plan = dict(PLAN, targets={'kcal': 2600, 'water': 3}, fromCoach={'coachId': 'c1', 'name': 'max', 'sentAt': 1})
    with bench.frozen_page(NOW, eng, 'iPhone 13', 'dark') as page:
        open_app(page, 'dark', data_json(NOW, plan=False, water=False, dietPlans={'dc_c1_x': plan}, dietActive='dc_c1_x'))
        R.check('/ 3 L' in nb(page.inner_text('.diet-home .water-home')), 'coach : « / 3 L » dans la carte Nutrition')
        page.click('.water-home__open')
        page.wait_for_selector('.water-card')
        R.check('Objectif du plan' in page.inner_text('.water-card'), 'coach : « Objectif du plan »')
        page.click('.water-card__top')
        page.wait_for_selector('.sheet .water-gs')
        R.check('Fixé par max' in page.inner_text('.sheet') and page.locator('.sheet [data-wstep]').count() == 0, 'coach : objectif en lecture seule')
        shot(page, LOT, '8-coach-objectif-iPhone_13-dark')
        R.check(not page.errors, f'coach : aucune erreur JS {page.errors[:2]}')


def t_contenant(bench):
    """Réglages de la nutrition › Contenants : « Ma gourde 75 cl » devient un bouton de la carte Eau."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone 13']
    with bench.frozen_page(NOW, eng, 'iPhone 13', 'light') as page:
        open_app(page, 'light', data_json(NOW))
        page.click('.water-home__open')
        page.wait_for_selector('.water-card')
        page.click('[data-action="go-diet-settings"]')
        page.wait_for_selector('.diet-settings-view [data-action="water-toggle"]')
        R.check(page.get_attribute('[data-action="water-toggle"]', 'aria-checked') == 'true', 'réglages : « Suivre l\'eau » allumé')
        page.click('[data-action="go-water-cups"]')
        page.wait_for_selector('.water-cups-view')
        page.click('[data-action="water-cup-add"]')
        page.fill('#waterCupName', 'Ma gourde')
        page.fill('#waterCupMl', '75')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(300)
        R.check(page.evaluate('data.waterCups') == [{'id': page.evaluate('data.waterCups[0].id'), 'name': 'Ma gourde', 'ml': 750}], 'contenant gardé')
        shot(page, LOT, '9-contenants-iPhone_13-light')
        page.go_back()
        page.wait_for_timeout(300)
        page.go_back()
        page.wait_for_selector('.water-card')
        btn = page.locator('.water-card [data-ml="750"]')
        R.check(btn.count() == 1 and nb(btn.inner_text()).replace('\n', ' ') == 'Ma gourde 75 cl', 'bouton « Ma gourde 75 cl »')
        btn.click()
        page.wait_for_timeout(200)
        R.check(total(page) == 750, 'un toucher : 75 cl')
        R.check(not page.errors, f'contenant : aucune erreur JS {page.errors[:2]}')


def t_minuit(bench):
    """Accueil ouvert à 23 h 59 : après minuit, la jauge repart de zéro et l'ajout va au nouveau jour."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone 13']
    eve = local_ms(2026, 11, 5, 23, 59, tz=PARIS)
    with bench.frozen_page(eve, eng, 'iPhone 13', 'dark') as page:
        open_app(page, 'dark', data_json(eve))
        page.click('.water-add--home')
        page.wait_for_timeout(200)
        page.clock.run_for(90_000)
        page.wait_for_timeout(300)
        R.check('0 / 2 L' in nb(page.inner_text('.water-home__val')), f'minuit : jauge à zéro ({page.inner_text(".water-home__val")!r})')
        page.click('.water-add--home')
        page.wait_for_timeout(200)
        R.check([total(page, '2026-11-05'), total(page, '2026-11-06')] == [250, 250], 'minuit : chaque ajout sur son jour')
        R.check(not page.errors, f'minuit : aucune erreur JS {page.errors[:2]}')


def t_eteint(bench):
    """Suivi éteint : rien sur l'accueil, une ligne « Suivre l'eau » en bas de Nutrition qui l'allume."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone 13']
    with bench.frozen_page(NOW, eng, 'iPhone 13', 'light') as page:
        open_app(page, 'light', data_json(NOW, water=False))
        R.check(page.locator('.water-home').count() == 0, 'éteint : rien sur l\'accueil')
        page.click('.diet-home__open')
        page.wait_for_selector('.nutrition-view [data-action="water-on"]')
        page.click('[data-action="water-on"]')
        page.wait_for_selector('.water-card')
        R.check(page.evaluate('data.waterOn') is True, 'un toucher : suivi allumé')
        R.check(not page.errors, f'éteint : aucune erreur JS {page.errors[:2]}')


run_main(R, [t_parcours], once=[t_seul_sans_plan, t_coach_objectif, t_contenant, t_minuit, t_eteint])
