"""Muscles : silhouette de Progrès, séries par muscle, muscles des exercices (listes, fiche, choix)."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'muscles'
R = Results(LOT)
APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MUSCLE_IDS = ['chest', 'front_delts', 'side_delts', 'rear_delts', 'traps', 'lats', 'lower_back', 'biceps',
              'triceps', 'forearms', 'abs', 'glutes', 'quads', 'hamstrings', 'adductors', 'calves']


def tag(device, theme):
    return f'{device}-{theme}'


def tab(page, i):
    t = page.locator('.tabbar [role=tab]').nth(i)
    t.click()
    page.wait_for_timeout(300)
    t.click()
    page.wait_for_timeout(300)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def heat(page, muscle):
    """Opacité de chaleur d'un muscle dans la carte de Progrès (0 : neutre)."""
    return page.evaluate("""m => {
        const z = document.querySelector(`.mcard__map [data-muscle="${m}"]`);
        return z ? parseFloat(z.getAttribute('fill-opacity') || '0') : -1;
    }""", muscle)


def t_progress(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        # Historique : push il y a 8 jours, pull il y a 6, legs il y a 4 (semaine : dos et jambes)
        seed(page, theme, ppl_v2_today_json())
        tab(page, 2)
        card = page.locator('.mcard')
        R.check(card.count() == 1, f'{t} carte « Muscles » dans Progrès')
        drawn = set(page.evaluate("[...document.querySelectorAll('.mcard__map [data-muscle]')].map(z => z.dataset.muscle)"))
        R.check(drawn == set(MUSCLE_IDS), f'{t} silhouette : tous les muscles dessinés {set(MUSCLE_IDS) ^ drawn}')
        R.check(heat(page, 'lats') > 0 and heat(page, 'quads') > 0, f'{t} semaine : dos et jambes colorés')
        R.check(heat(page, 'chest') == 0, f'{t} semaine : pectoraux neutres (push il y a 8 jours)')
        low = page.locator('.mlow').inner_text()
        R.check('Pectoraux' in low and 'Grand dorsal' not in low, f'{t} peu travaillés : « {low} »')
        sr = page.locator('.mcard .visually-hidden li').all_inner_texts()
        R.check(len(sr) == 16 and any(x.startswith('Grand dorsal : ') and 'série' in x for x in sr), f'{t} liste VoiceOver {sr[:2]}')
        R.check(page.locator('svg.mcard__map[aria-hidden="true"]').count() == 1, f'{t} dessin masqué à VoiceOver')
        R.check(no_hscroll(page), f'{t} Progrès : pas de défilement horizontal')
        card.scroll_into_view_if_needed()
        shot(page, LOT, f'progres-semaine-{t}')

        page.click('[data-action="muscle-span"][data-span="month"]')
        page.wait_for_timeout(250)
        R.check(page.locator('[data-action="muscle-span"][data-span="month"]').get_attribute('aria-pressed') == 'true', f'{t} 4 semaines sélectionné')
        R.check(heat(page, 'chest') > 0, f'{t} 4 semaines : pectoraux colorés')
        page.locator('.mcard').scroll_into_view_if_needed()
        shot(page, LOT, f'progres-4semaines-{t}')

        page.click('[data-action="go-stats-muscles"]')
        page.wait_for_selector('.view.stats-muscles')
        rows = page.locator('.mrow').count()
        R.check(rows == 16, f'{t} séries par muscle : 16 lignes ({rows})')
        vals = [int(v) for v in page.locator('.mrow .cell__value').all_inner_texts()]
        R.check(vals == sorted(vals, reverse=True) and vals[0] > 0, f'{t} lignes triées par séries {vals[:4]}')
        R.check(page.locator('[data-action="muscle-span"][data-span="month"]').get_attribute('aria-pressed') == 'true', f'{t} période gardée')
        R.check(no_hscroll(page), f'{t} détail : pas de défilement horizontal')
        shot(page, LOT, f'detail-{t}')
        page.click('[data-action="back"]')
        page.wait_for_selector('.view.stats')

        # Progrès › Exercice : muscles ciblés
        page.locator('[data-action="open-stats-ex"][data-ex="p1dcouch"]').click()
        page.wait_for_selector('.view.stats-ex')
        pills = page.locator('.mpanel .mpill').all_inner_texts()
        R.check(pills[:1] == ['Pectoraux'] and 'Triceps' in pills, f'{t} fiche exercice : pastilles {pills}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_empty(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, None)
        tab(page, 2)
        R.check(page.locator('.mcard').count() == 1, f'{t} carte présente sans historique')
        R.check('Aucune séance' in page.locator('.mcard').inner_text(), f'{t} état vide')
        R.check(all(heat(page, m) == 0 for m in ('chest', 'quads', 'lats')), f'{t} silhouette neutre')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_editor(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        tab(page, 3)
        page.click('[data-action="open-prog-session"][data-cat="push"]')
        page.wait_for_selector('.view.editor')
        lines = page.locator('.ed-row .ex-muscles').all_inner_texts()
        R.check(lines[:1] == ['Pectoraux'] and 'Épaules' in lines, f'{t} Programme › Séance : muscles sous les noms {lines}')
        shot(page, LOT, f'editeur-{t}')

        page.click('.ed-row[data-i="0"]')
        page.wait_for_selector('.view.ex-edit')
        R.check('Automatique' in page.locator('[data-action="pick-ex-muscles"]').inner_text(), f'{t} muscles automatiques')
        # Le nom saisi met les muscles à jour en direct
        page.fill('#exName', 'Curl marteau corde')
        page.wait_for_timeout(150)
        pills = page.locator('#exMuscles .mpill').all_inner_texts()
        R.check(pills == ['Biceps', 'Avant-bras'], f'{t} reconnaissance en direct {pills}')
        page.fill('#exName', 'Développé couché haltères')

        # Choix manuel : Biceps seul
        page.click('[data-action="pick-ex-muscles"]')
        page.wait_for_selector('.mpick')
        shot(page, LOT, f'choix-{t}')
        R.check(page.locator('.mpick__row[data-muscle="chest"]').get_attribute('aria-checked') == 'true', f'{t} pectoraux cochés')
        page.click('.mpick__row[data-muscle="chest"]')
        page.click('.mpick__row[data-muscle="biceps"]')
        R.check(page.locator('.mpick__row[data-muscle="biceps"]').get_attribute('aria-checked') == 'true', f'{t} case cochée au toucher')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(350)
        R.check(page.locator('#exMuscles .mpill').all_inner_texts() == ['Biceps'], f'{t} choix affiché')
        R.check('Personnalisés' in page.locator('[data-action="pick-ex-muscles"]').inner_text(), f'{t} « Personnalisés »')
        page.click('[data-action="save-ex"]')
        page.wait_for_selector('.view.editor')
        ex0 = page.evaluate("data.programmes.ppl.exercises.push[0]")
        R.check(ex0.get('muscles') == ['biceps'], f'{t} choix enregistré {ex0.get("muscles")}')
        stored = json.loads(ls(page, 'ppl_v2'))['programmes']['ppl']['exercises']['push'][0]
        R.check(stored.get('muscles') == ['biceps'], f'{t} choix écrit dans ppl_v2')
        R.check(page.locator('.ed-row[data-i="0"] .ex-muscles').inner_text() == 'Biceps', f'{t} liste à jour')

        # Retour à l'automatique
        page.click('.ed-row[data-i="0"]')
        page.wait_for_selector('.view.ex-edit')
        page.click('[data-action="pick-ex-muscles"]')
        page.wait_for_selector('.mpick__auto')
        page.click('.mpick__auto')
        page.wait_for_timeout(350)
        page.click('[data-action="save-ex"]')
        page.wait_for_selector('.view.editor')
        R.check('muscles' not in page.evaluate("data.programmes.ppl.exercises.push[0]"), f'{t} champ retiré (automatique)')
        R.check(no_hscroll(page), f'{t} pas de défilement horizontal')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_add_sheet(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        tab(page, 3)
        page.click('[data-action="open-prog-session"][data-cat="push"]')
        page.wait_for_selector('.view.editor')
        page.click('[data-action="add-ex"]')
        page.wait_for_selector('#axSearch')
        page.fill('#axSearch', 'souleve')
        page.wait_for_timeout(150)
        items = page.locator('#axList .ax__item').all_inner_texts()
        R.check(any(x.startswith('Soulevé de terre') and 'Fessiers' in x for x in items), f'{t} bibliothèque et muscles dans la recherche {items[:2]}')
        shot(page, LOT, f'ajout-{t}')
        page.locator('[data-action="ax-pick"][data-name="Soulevé de terre"]').click()
        page.wait_for_timeout(400)
        names = [e['name'] for e in page.evaluate('data.programmes.ppl.exercises.push')]
        R.check(names[-1] == 'Soulevé de terre', f'{t} exercice de la bibliothèque ajouté {names[-1]}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def once_static(bench):
    files = ['js/data/muscles.js', 'js/data/muscle-load.js', 'js/ui/body-map.js', 'js/features/muscles.js', 'css/muscles.css']
    for f in files:
        n = sum(1 for _ in open(os.path.join(APP_DIR, f), encoding='utf-8'))
        R.check(n <= 400, f'{f} : {n} lignes (400 au plus)')
    css = open(os.path.join(APP_DIR, 'css/muscles.css'), encoding='utf-8').read()
    R.check(not re.findall(r'#[0-9a-fA-F]{3,8}\b|rgba?\(', css), 'muscles.css : couleurs en tokens seulement')
    # Silhouette autonome (story de partage) : rendue en image sans variable CSS
    with bench.page('chromium', 'Pixel 7', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json())
        ok = page.evaluate("""() => new Promise(res => {
            const svg = bodyMapSvg({ chest: 1, quads: .5 }, { standalone: true, captions: true, colors: bodyMapColors() });
            const img = new Image();
            img.onload = () => res(!svg.includes('var(--') && img.naturalWidth > 0);
            img.onerror = () => res(false);
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        })""")
        R.check(ok, 'bodyMapSvg autonome : chargé comme image, couleurs résolues')


run_main(R, [t_progress, t_empty, t_editor, t_add_sheet], once=[once_static])
