"""Mes programmes : liste choisie et ordonnée (data.myProgrammes), catalogue « Tous les programmes ».

Migration d'une donnée existante, ajout depuis la fiche d'un programme, activation, ordre (poignées ≡),
retrait d'un programme intégré (il reste au catalogue), « Utiliser ce programme », accès depuis l'accueil.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'mes_programmes'
R = Results(LOT)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def tab(page, i):
    page.locator('.tabbar [role=tab]').nth(i).click()
    page.wait_for_timeout(350)


def tap(page, sel):
    page.click(sel)
    page.wait_for_timeout(400)


def stored(page):
    return json.loads(ls(page, 'ppl_v2'))['myProgrammes']


def small_targets(page, sel):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent)
        .map(e => e.getBoundingClientRect()).filter(r => r.height < 44).length""", sel)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def t_mes_programmes(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        R.check(page.evaluate('data.myProgrammes') == ['ppl', 'custom'], f'{t} migration : actif puis Perso utilisé {page.evaluate("data.myProgrammes")}')

        # Onglet Programme › Mes programmes
        tab(page, 3)
        R.check('Mes programmes' in page.inner_text('[data-action="go-my-programmes"]'), f'{t} onglet : ligne « Mes programmes »')
        R.check(page.locator('[data-action="new-programme"]').count() == 1, f'{t} onglet : « Créer un programme » toujours là')
        tap(page, '[data-action="go-my-programmes"]')
        R.check(page.evaluate('view') == 'my-programmes' and page.locator('.navbar__title').inner_text().strip() == 'Mes programmes', f'{t} écran Mes programmes')
        ids = page.evaluate("[...document.querySelectorAll('.mp-list [data-action=\"select-prog\"]')].map(b => b.dataset.id)")
        R.check(ids == ['ppl', 'custom'], f'{t} liste dans l\'ordre de data.myProgrammes {ids}')
        R.check(page.locator('[data-action="select-prog"][data-id="ppl"]').get_attribute('aria-pressed') == 'true', f'{t} coche sur l\'actif')
        R.check(small_targets(page, '.view.my-programmes button') == 0 and no_hscroll(page), f'{t} Mes programmes : 44 pt, pas de défilement horizontal')
        shot(page, LOT, f'1-mes-programmes-{t}')

        # Ajouter un programme › Tous les programmes › Bro Split › Ajouter à mes programmes
        tap(page, '[data-action="go-prog-add"]')
        R.check(page.evaluate('view') == 'prog-add' and page.locator('.prog-add [data-action="new-programme"]').count() == 1, f'{t} Ajouter : « Créer un programme »')
        rows = page.locator('.prog-add [data-action="open-prog-info"]')
        R.check(rows.count() == 7, f'{t} catalogue : 7 programmes intégrés ({rows.count()})')
        R.check('3 séances par semaine' in rows.first.inner_text(), f'{t} catalogue : fréquence conseillée')
        shot(page, LOT, f'2-ajouter-{t}')
        tap(page, '.prog-add [data-action="open-prog-info"][data-id="bro"]')
        R.check(page.evaluate('view') == 'prog-info', f'{t} fiche du programme')
        why = page.locator('.prog-info__why').inner_text()
        R.check(why.startswith('5 séances par semaine'), f'{t} fiche : pourquoi ({why[:40]})')
        R.check(page.locator('.prog-info__map svg[role="img"]').count() == 1, f'{t} fiche : silhouette nommée pour VoiceOver')
        R.check(page.locator('.prog-info .prog-sess').count() == 5, f'{t} fiche : 5 séances')
        shot(page, LOT, f'3-fiche-{t}')
        tap(page, '[data-action="prog-info-add"]')
        R.check(stored(page) == ['ppl', 'custom', 'bro'], f'{t} ajouté en fin de liste, enregistré {stored(page)}')
        R.check('Dans mes programmes' in page.inner_text('.prog-info__actions'), f'{t} fiche : « Dans mes programmes »')
        R.check(page.evaluate('data.activeProgramme') == 'ppl', f'{t} ajouter n\'active pas')

        # Retour à Mes programmes, toucher = activer (confirmation), retour à l'onglet
        page.click('[data-action="back"]'); page.wait_for_timeout(400)
        page.click('[data-action="back"]'); page.wait_for_timeout(400)
        tap(page, '[data-action="select-prog"][data-id="bro"]')
        tap_dialog(page, 'Changer de programme')
        R.check(page.evaluate('[data.activeProgramme, view]') == ['bro', 'programmes'], f'{t} activé, retour à Programme')

        # Modifier : l'actif ne se retire pas ; Bro Split glissé en tête ; PPL retiré
        tap(page, '[data-action="go-my-programmes"]')
        tap(page, '[data-action="toggle-my-prog-edit"]')
        R.check(page.locator('.mp-row[data-id="bro"] .ed-minus').count() == 0, f'{t} actif : pas de ⊖')
        R.check(page.locator('.mp-row[data-id="ppl"] .ed-minus').get_attribute('aria-label') == 'Retirer PPL', f'{t} ⊖ nommé « Retirer PPL »')
        R.check(page.locator('.mp-handle').first.get_attribute('aria-label') == 'Déplacer PPL', f'{t} poignée nommée')
        shot(page, LOT, f'4-modifier-{t}')
        hb = page.locator('.mp-handle').nth(2).bounding_box()
        rh = page.locator('.mp-row').first.bounding_box()['height']
        x, y = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
        page.mouse.move(x, y); page.mouse.down()
        for k in range(1, 11):
            page.mouse.move(x, y - rh * 2 * k / 10)
        page.mouse.up()
        page.wait_for_timeout(300)
        R.check(stored(page) == ['bro', 'ppl', 'custom'], f'{t} glisser Bro Split en tête {stored(page)}')
        tap(page, '.mp-row[data-id="ppl"] .ed-minus')
        tap(page, '.mp-row[data-id="ppl"] [data-action="remove-my-prog"]')
        R.check(stored(page) == ['bro', 'custom'], f'{t} PPL retiré {stored(page)}')
        R.check(page.evaluate('!!data.programmes.ppl'), f'{t} retiré : exercices de PPL gardés')
        tap(page, '[data-action="toggle-my-prog-edit"]')

        # Utiliser ce programme (catalogue) : ajouté et activé ; PPL toujours au catalogue
        tap(page, '[data-action="go-prog-add"]')
        R.check(page.locator('.prog-add [data-id="ppl"]').count() == 1, f'{t} PPL toujours au catalogue')
        tap(page, '.prog-add [data-action="open-prog-info"][data-id="arnold"]')
        tap(page, '[data-action="prog-info-use"]')
        R.check(page.evaluate('[data.activeProgramme, view]') == ['arnold', 'programmes'] and stored(page) == ['bro', 'custom', 'arnold'],
                f'{t} Utiliser : ajouté, activé, retour à Programme {stored(page)}')

        # Accueil : le sous-titre « Programme … › » mène à Mes programmes
        tab(page, 0)
        tap(page, '.dashboard [data-action="go-my-programmes"]')
        R.check(page.evaluate('view') == 'my-programmes', f'{t} accueil : sous-titre vers Mes programmes')
        back = page.locator('.navbar__back').get_attribute('aria-label')
        R.check(back == 'Retour : Entraînement', f'{t} retour vers l\'accueil ({back})')
        page.reload()
        page.wait_for_selector('#app > *')
        R.check(page.evaluate('data.myProgrammes') == ['bro', 'custom', 'arnold'], f'{t} conservé après rechargement')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_mes_programmes])
