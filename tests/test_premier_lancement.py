"""Premier lancement : trois questions (où, combien de fois, niveau), puis le programme conseillé.

Nouvel utilisateur seulement ; « Retour », « Plus tard », silhouette, « Commencer » (programme, filtre
de matériel, objectif de la semaine) et « Voir les autres programmes ». La règle de choix elle-même est
testée sans navigateur (tests/unit/onboarding.mjs).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'premier_lancement'
R = Results(LOT)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def step(page):
    return page.evaluate("document.querySelector('.onb .onb__page')?.className.match(/onb__page--(\\w+)/)?.[1] || null")


def tap(page, sel):
    page.click(sel)
    page.wait_for_timeout(350)


def small_targets(page):
    return page.evaluate("""() => [...document.querySelectorAll('.onb button')].filter(e => e.offsetParent)
        .map(e => e.getBoundingClientRect()).filter(r => r.width < 44 || r.height < 44).length""")


def overflowing(page):
    return page.evaluate("""() => [...document.querySelectorAll('.onb button, .onb p, .onb h1, .onb .cell__title, .onb .cell__sub')]
        .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 30))""")


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def t_parcours(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        R.check(page.evaluate("document.getElementById('app').inert") is True, f'{t} app inerte sous les questions')
        R.check(page.locator('.onb [data-action="onb-back"]').count() == 0, f'{t} 1re question : pas de Retour')
        R.check(page.locator('.onb #onbTitle').inner_text().startswith('Où t'), f'{t} « Où t\'entraînes-tu ? »')
        R.check(page.locator('.onb [data-action="onb-place"]').count() == 3, f'{t} trois lieux')
        R.check(page.get_attribute('.onb__progress', 'aria-valuenow') == '1', f'{t} avancement 1 sur 3')
        R.check(small_targets(page) == 0 and not overflowing(page) and no_hscroll(page), f'{t} lieu : 44 pt, rien de coupé {overflowing(page)}')
        shot(page, LOT, f'1-ou-{t}')

        tap(page, '[data-action="onb-place"][data-val="salle"]')
        R.check(step(page) == 'freq', f'{t} un toucher : question suivante')
        labels = [x.strip() for x in page.locator('.onb [data-action="onb-freq"] .cell__title').all_inner_texts()]
        R.check(labels == ['2 fois', '3 fois', '4 fois', '5 fois ou plus'], f'{t} fréquences {labels}')
        R.check(small_targets(page) == 0 and not overflowing(page), f'{t} fréquence : 44 pt, rien de coupé')
        tap(page, '[data-action="onb-freq"][data-val="3"]')
        R.check(step(page) == 'level', f'{t} niveau')
        R.check(page.locator('.onb [data-action="onb-level"]').count() == 2, f'{t} deux niveaux')

        # Retour : réponse précédente cochée
        tap(page, '[data-action="onb-back"]')
        R.check(step(page) == 'freq' and page.get_attribute('[data-action="onb-freq"][data-val="3"]', 'aria-pressed') == 'true',
                f'{t} Retour : « 3 fois » coché')
        tap(page, '[data-action="onb-freq"][data-val="3"]')
        tap(page, '[data-action="onb-level"][data-val="confirme"]')
        R.check(step(page) == 'result', f'{t} résultat')
        R.check(page.locator('#onbTitle').inner_text().strip() == 'PPL', f'{t} salle, 3 fois, déjà entraîné : PPL')
        rows = page.locator('.onb .prog-sess').all_inner_texts()
        R.check(len(rows) == 3 and 'pousser' in rows[0] and 'pectoraux' in rows[0], f'{t} séances en clair {rows[:1]}')
        R.check(page.locator('.onb [data-action="onb-later"]').count() == 0, f'{t} résultat : pas de « Plus tard »')

        # Niveau débutant : Full Body, phrase explicative
        tap(page, '[data-action="onb-back"]')
        tap(page, '[data-action="onb-level"][data-val="debutant"]')
        R.check(page.locator('#onbTitle').inner_text().strip() == 'Full Body', f'{t} débutant, 3 fois : Full Body')
        R.check(page.locator('.onb__reason').inner_text().strip() == '3 séances par semaine, tout le corps à chaque fois. Idéal pour débuter.',
                f'{t} phrase du Full Body')

        # Silhouettes : Femme et Homme côte à côte, muscles du programme surlignés, un toucher choisit
        bodies = page.locator('.onb .onb__body')
        R.check(bodies.count() == 2 and bodies.nth(0).get_attribute('aria-label') == 'Silhouette femme'
                and bodies.nth(1).get_attribute('aria-label') == 'Silhouette homme', f'{t} deux silhouettes nommées pour VoiceOver')
        R.check(page.locator('.onb [data-action="onb-silhouette"][data-val="male"]').get_attribute('aria-pressed') == 'true', f'{t} homme par défaut')
        lit = page.evaluate("[...document.querySelectorAll('.onb__body[data-val=\"male\"] [data-muscle][data-heat]')].map(p => p.dataset.muscle)")
        R.check({'chest', 'quads', 'lats'} <= set(lit), f'{t} muscles du Full Body surlignés {sorted(set(lit))[:6]}')
        R.check(page.locator('.onb .segmented').count() == 0, f'{t} plus de contrôle segmenté')
        tap(page, '.onb [data-action="onb-silhouette"][data-val="female"]')
        R.check(page.evaluate('data.silhouette') == 'female' and page.evaluate('data.onboarded') is False and step(page) == 'result',
                f'{t} femme choisie, résultat toujours là')
        R.check(page.locator('.onb [data-val="female"]').get_attribute('aria-pressed') == 'true'
                and 'onb__body--on' in page.locator('.onb [data-val="female"]').get_attribute('class'), f'{t} silhouette choisie encadrée, état annoncé')
        R.check(small_targets(page) == 0 and not overflowing(page) and no_hscroll(page), f'{t} résultat : 44 pt, rien de coupé {overflowing(page)}')
        R.check(page.evaluate("(() => { const r = document.querySelector('[data-action=\"onb-start\"]').getBoundingClientRect(); return r.bottom <= innerHeight; })()"),
                f'{t} « Commencer » visible sans défiler')
        R.check(int(page.evaluate("getComputedStyle(document.querySelector('.onb__actions')).zIndex") or 0) >= 2, f'{t} boutons du bas au-dessus des séparateurs de la liste')
        shot(page, LOT, f'2-resultat-{t}')

        # Application fermée avant la fin : les questions reviennent
        page.reload()
        page.wait_for_selector('.onb__page--place')
        R.check(page.evaluate('data.onboarded') is False, f'{t} sans choix : questions au lancement suivant')

        tap(page, '[data-action="onb-place"][data-val="halteres"]')
        tap(page, '[data-action="onb-freq"][data-val="4"]')
        tap(page, '[data-action="onb-level"][data-val="debutant"]')
        R.check(page.locator('#onbTitle').inner_text().strip() == 'Maison haltères', f'{t} haltères : Maison haltères')
        tap(page, '[data-action="onb-start"]')
        page.wait_for_timeout(300)
        got = page.evaluate('[data.activeProgramme, data.exEquip, data.weeklyGoal, data.onboarded]')
        R.check(got == ['maison_halteres', 'halteres', 4, True], f'{t} Commencer : programme, matériel, objectif {got}')
        R.check(page.evaluate('data.myProgrammes') == ['maison_halteres'], f'{t} Mes programmes : le conseil seul')
        R.check(page.locator('.onb').count() == 0 and page.evaluate('view') == 'dashboard', f'{t} accueil après Commencer')
        R.check(page.evaluate("document.getElementById('app').inert") is False, f'{t} app de nouveau active')
        page.reload()
        page.wait_for_selector('#app > *')
        page.wait_for_timeout(400)
        R.check(page.locator('.onb').count() == 0, f'{t} questions jamais deux fois')
        R.check(page.evaluate('trainingLevel()') == 'debutant', f'{t} niveau gardé (repère de la bulle des muscles)')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_plus_tard_et_autres(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        # « Plus tard » : rien d'imposé, comme l'ancienne carte
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        tap(page, '[data-action="onb-place"][data-val="rien"]')
        tap(page, '.onb [data-action="onb-later"]')
        got = page.evaluate('[data.activeProgramme, data.exEquip, data.weeklyGoal ?? null, data.onboarded]')
        R.check(got == ['ppl', 'all', None, True] and page.locator('.onb').count() == 0, f'{t} Plus tard : rien de changé {got}')

        # « Voir les autres programmes » : conseil appliqué et coché dans la liste
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        tap(page, '[data-action="onb-place"][data-val="salle"]')
        tap(page, '[data-action="onb-freq"][data-val="5"]')
        tap(page, '[data-action="onb-level"][data-val="debutant"]')
        R.check(page.locator('#onbTitle').inner_text().strip() == 'Upper / Lower', f'{t} débutant, 5 fois : Upper / Lower')
        tap(page, '[data-action="onb-others"]')
        page.wait_for_selector('.view.prog-add')
        row = page.locator('.prog-add [data-action="open-prog-info"][data-id="upper_lower"]')
        R.check('Actif' in row.inner_text(), f'{t} Voir les autres : catalogue, Upper / Lower actif')
        R.check(page.evaluate('[data.activeProgramme, data.myProgrammes]') == ['upper_lower', ['upper_lower']], f'{t} conseil appliqué et dans Mes programmes')
        R.check(page.evaluate('[data.weeklyGoal, data.onboarded]') == [5, True], f'{t} objectif 5, questions passées')

        # Utilisateur existant (séances) : rien
        seed(page, theme, ppl_v2_today_json())
        page.wait_for_timeout(400)
        R.check(page.locator('.onb').count() == 0, f'{t} utilisateur existant : pas de questions')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_parcours, t_plus_tard_et_autres])
