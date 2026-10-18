"""Ordre des séances d'un programme perso : ordre de création, puis « Modifier l'ordre » (poignée ≡).

Cas réel : un programme de 7 séances nommées par jour, créées dans l'ordre de la semaine.
Captures : $PPL_SCRATCH/shots/lotordre/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_ordre.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'ordre'
R = Results(LOT)
JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
PID = 'u_semaine'


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def semaine_json():
    d = json.loads(ppl_v2_today_json())
    # Clés « s… » comme celles que crée l'app (newSessionId), dans l'ordre de la semaine
    sessions = {f's{j[:3].lower()}x{i}': {'label': j, 'icon': '', 'desc': '', 'color': '#FF9500'} for i, j in enumerate(JOURS)}
    d['userProgrammes'] = {PID: {'name': 'Ma semaine', 'archived': False, 'sessions': sessions}}
    d['programmes'][PID] = {'exercises': {k: [{'id': f'e{k}', 'name': 'Développé couché', 'sets': 3}] for k in sessions},
                            'timers': {k: None for k in sessions}, 'cooldowns': {k: 72 for k in sessions}}
    d['activeProgramme'] = PID
    return json.dumps(d, ensure_ascii=False)


def labels(page, sel):
    return [e.strip() for e in page.locator(sel).all_inner_texts()]


def t_ordre(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, semaine_json())
        # Accueil : séance proposée = la première de la semaine, les autres dans l'ordre
        R.check(page.locator('.hero__name').inner_text().strip() == 'Lundi', f'{t} accueil : Lundi proposé en premier')
        R.check(labels(page, '.home-cell__name')[:6] == JOURS[1:], f'{t} accueil : séances dans l\'ordre de la semaine')

        page.evaluate("r => navigate(r)", 'programmes')
        page.wait_for_selector('.programmes')
        R.check(labels(page, '[data-action="open-prog-session"] .cell__title') == JOURS, f'{t} programme : ordre de création')

        page.click('[data-action="toggle-prog-order"]')
        page.wait_for_selector('.ps-handle')
        R.check(page.locator('[data-action="open-prog-session"]').count() == 0, f'{t} mode Modifier : les séances ne s\'ouvrent pas')
        R.check(page.locator('[data-action="add-custom-session"]').count() == 0, f'{t} mode Modifier : pas d\'ajout')
        names = [page.locator('.ps-handle').nth(i).get_attribute('aria-label') for i in range(7)]
        R.check(names[0] == 'Déplacer Lundi', f'{t} poignée nommée pour VoiceOver ({names[0]})')
        box = page.locator('.ps-handle').nth(0).bounding_box()
        R.check(box['width'] >= 44 and box['height'] >= 44, f'{t} poignée : cible 44 pt ({box["width"]:.0f}×{box["height"]:.0f})')
        shot(page, LOT, f'modifier_{t}')

        # Dimanche glissé tout en haut : liste entière à l'écran, comme le ferait l'utilisateur (iPhone SE compris)
        page.evaluate("document.querySelector('.ps-list').previousElementSibling.scrollIntoView({ block: 'start' })")
        page.wait_for_timeout(150)
        vh = page.viewport_size['height']
        lb = page.locator('.ps-list').bounding_box()
        R.check(lb['y'] >= 0 and lb['y'] + lb['height'] <= vh, f'{t} 7 séances visibles d\'un coup ({lb["y"]:.0f}–{lb["y"] + lb["height"]:.0f} / {vh})')
        hb = page.locator('.ps-handle').nth(6).bounding_box()
        rh = page.locator('.ps-row').first.bounding_box()['height']
        x, y = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        for k in range(1, 13):
            page.mouse.move(x, y - rh * 6 * k / 12)
        page.mouse.up()
        page.wait_for_selector('.ps-row')
        attendu = JOURS[6:] + JOURS[:6]
        R.check(labels(page, '.ps-row .cell__title') == attendu, f'{t} glisser Dimanche en tête {labels(page, ".ps-row .cell__title")[:3]}')
        stored = json.loads(ls(page, 'ppl_v2'))['userProgrammes'][PID]['sessions']
        R.check([v['label'] for v in stored.values()] == attendu, f'{t} ordre enregistré')

        page.click('[data-action="toggle-prog-order"]')
        page.wait_for_selector('[data-action="open-prog-session"]')
        R.check(page.locator('[data-action="toggle-prog-order"]').inner_text().strip() == "Modifier l'ordre", f'{t} OK : retour à la liste')

        page.reload()
        page.wait_for_selector('#app > *')
        page.evaluate("r => navigate(r)", 'programmes')
        page.wait_for_selector('.programmes')
        R.check(labels(page, '[data-action="open-prog-session"] .cell__title') == attendu, f'{t} ordre conservé après relancement')
        # La séance s'ouvre toujours d'un tap
        page.locator('[data-action="open-prog-session"]').first.click()
        page.wait_for_selector('.view.editor')
        R.check('Dimanche' in page.locator('.navbar').first.inner_text(), f'{t} tap : la séance s\'ouvre')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:3]}')

    # Programme intégré : ordre fixe, pas de bouton
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.evaluate("r => navigate(r)", 'programmes')
        page.wait_for_selector('.programmes')
        R.check(page.locator('[data-action="toggle-prog-order"]').count() == 0, f'{t} programme intégré : pas de « Modifier l\'ordre »')


run_main(R, [t_ordre])
