"""Programmes (racine de l'onglet Programme depuis le 19/11) : liste choisie et ordonnée (data.myProgrammes),
catalogue « Tous les programmes ».

Migration d'une donnée existante, ajout depuis la fiche d'un programme, toucher = page du programme (l'actif) ou fiche
avec « Utiliser ce programme », ordre (poignées ≡), retrait d'un programme intégré (il reste au catalogue), accès
depuis l'accueil.
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
    settle(page)


def tap(page, sel):
    page.click(sel)
    settle(page)


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

        # Onglet Programme : la liste Programmes à sa racine
        tab(page, 3)
        # Titre compact caché (visibility) tant que le grand titre est à l'écran (fd6000a) : lu par text_content
        R.check(page.evaluate('view') == 'my-programmes' and (page.locator('.navbar__title').text_content() or '').strip() == 'Programmes', f'{t} onglet : liste Programmes')
        ids = page.evaluate("[...document.querySelectorAll('.mp-list [data-action=\"open-my-prog\"]')].map(b => b.dataset.id)")
        R.check(ids == ['ppl', 'custom'], f'{t} liste dans l\'ordre de data.myProgrammes {ids}')
        R.check(page.locator('[data-id="ppl"] .mp-active').count() == 1 and page.locator('.mp-active').count() == 1, f'{t} « Programme actif » sur l\'actif seul')
        R.check(small_targets(page, '.view.my-programmes button') == 0 and no_hscroll(page), f'{t} Programmes : 44 pt, pas de défilement horizontal')
        shot(page, LOT, f'1-mes-programmes-{t}')

        # Ajouter un programme › Tous les programmes › Bro Split › Ajouter à mes programmes
        tap(page, '[data-action="go-prog-add"]')
        R.check(page.evaluate('view') == 'prog-add' and page.locator('.prog-add [data-action="new-programme"]').count() == 1, f'{t} Ajouter : « Créer un programme »')
        rows = page.locator('.prog-add [data-action="open-prog-info"]')
        R.check(rows.count() == 7, f'{t} catalogue : 7 programmes intégrés ({rows.count()})')
        R.check('3 séances par semaine' in rows.first.inner_text(), f'{t} catalogue : fréquence conseillée')
        # Vignettes : séances par semaine en gros (le personnage serait identique sur chaque ligne, « une icône = un sens ») ;
        # « Actif » sous le nom, pas à droite des séances
        thumbs = page.evaluate("""() => [...document.querySelectorAll('.prog-add [data-action="open-prog-info"] .psq--freq b')].map(b => b.textContent)""")
        R.check(len(thumbs) == 7 and len(set(thumbs)) >= 3, f'{t} catalogue : fréquence en vignette, qui varie {thumbs}')
        state = page.locator('.prog-add [data-id="ppl"] .prog-add__state')
        R.check(state.count() == 1 and state.inner_text().strip() == 'Actif' and page.locator('.prog-add [data-id="ppl"] .cell__value').count() == 0,
                f'{t} catalogue : « Actif » sous le nom de PPL')
        shot(page, LOT, f'2-ajouter-{t}')
        tap(page, '.prog-add [data-action="open-prog-info"][data-id="bro"]')
        R.check(page.evaluate('view') == 'prog-info', f'{t} fiche du programme')
        why = page.locator('.prog-info__why').inner_text()
        R.check(why.startswith('5 séances par semaine'), f'{t} fiche : pourquoi ({why[:40]})')
        R.check(page.locator('.prog-info__map .body-map[role="img"]').count() == 1, f'{t} fiche : personnage nommé pour VoiceOver')
        R.check(page.locator('.prog-info .prog-sess').count() == 5, f'{t} fiche : 5 séances')
        shot(page, LOT, f'3-fiche-{t}')
        tap(page, '[data-action="prog-info-add"]')
        R.check(stored(page) == ['ppl', 'custom', 'bro'], f'{t} ajouté en fin de liste, enregistré {stored(page)}')
        R.check('Déjà dans tes programmes' in page.inner_text('.prog-info__note') and 'programmes' not in page.inner_text('.prog-info__actions'), f'{t} fiche : légende « Déjà dans tes programmes », pas sous le bouton')
        R.check(page.evaluate('data.activeProgramme') == 'ppl', f'{t} ajouter n\'active pas')

        # Retour à la liste ; toucher Bro Split = sa fiche, « Utiliser ce programme » = sa page
        page.click('[data-action="back"]'); settle(page)
        page.click('[data-action="back"]'); settle(page)
        tap(page, '[data-action="open-my-prog"][data-id="bro"]')
        R.check(page.evaluate('view') == 'prog-info', f'{t} toucher un programme : sa fiche')
        tap(page, '[data-action="prog-info-use"]')
        R.check(page.evaluate('[data.activeProgramme, view]') == ['bro', 'programmes'], f'{t} activé, sa page')
        R.check(page.evaluate('nav.stacks.program') == ['my-programmes', 'programmes'], f'{t} page juste sous la liste {page.evaluate("nav.stacks.program")}')
        # Toucher l'actif : sa page ; Perso (créé, pas actif) : sa fiche
        page.click('[data-action="back"]'); settle(page)
        tap(page, '[data-action="open-my-prog"][data-id="custom"]')
        R.check(page.evaluate('view') == 'prog-info' and page.locator('[data-action="prog-info-use"]').count() == 1, f'{t} Perso : fiche et « Utiliser ce programme »')
        page.click('[data-action="back"]'); settle(page)
        tap(page, '[data-action="open-my-prog"][data-id="bro"]')
        R.check(page.evaluate('view') == 'programmes', f'{t} toucher l\'actif : sa page')
        page.click('[data-action="back"]'); settle(page)

        # Modifier : l'actif ne se retire pas ; Bro Split glissé en tête ; PPL retiré
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
        settle(page)
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
                f'{t} Utiliser : ajouté, activé, sa page {stored(page)}')

        # Accueil : le sous-titre « Programme … › » mène à la page du programme actif, sous la liste (panel t1)
        tab(page, 0)
        tap(page, '.dashboard [data-action="go-active-programme"]')
        R.check(page.evaluate('[view, nav.tab, nav.stacks.program]') == ['programmes', 'program', ['my-programmes', 'programmes']], f'{t} accueil : sous-titre vers la page du programme actif')
        page.reload()
        page.wait_for_selector('#app > *')
        R.check(page.evaluate('data.myProgrammes') == ['bro', 'custom', 'arnold'], f'{t} conservé après rechargement')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_mes_programmes])
