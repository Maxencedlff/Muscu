"""Ordre des séances d'un programme perso : ordre de création, puis « Modifier l'ordre » (poignée ≡).
Sans glisser (VoiceOver, clavier) : la poignée est un bouton qui ouvre Monter / Descendre, place annoncée.

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
        R.check(page.locator('.hero__name').inner_text().strip().lower() == 'lundi', f'{t} accueil : Lundi proposé en premier')
        R.check(labels(page, '.home-cell__name')[:6] == JOURS[1:], f'{t} accueil : séances dans l\'ordre de la semaine')

        page.evaluate("r => navigate(r)", 'programmes')
        page.wait_for_selector('.programmes')
        R.check(labels(page, '[data-action="open-prog-session"] .cell__title') == JOURS, f'{t} programme : ordre de création')

        # 19/11 : une ligne « Ordre des séances » dans la liste (plus un petit lien gris dans le titre)
        row = page.locator('.ps-list [data-action="toggle-prog-order"]')
        R.check(row.count() == 1 and row.inner_text().strip() == 'Ordre des séances', f'{t} ligne « Ordre des séances » dans la liste')
        rb = row.bounding_box()
        R.check(rb['height'] >= 44, f'{t} ligne « Ordre des séances » : cible 44 pt ({rb["height"]:.0f})')
        row.click()
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
        settle(page)
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
        R.check(page.locator('[data-action="toggle-prog-order"]').inner_text().strip() == 'Ordre des séances', f'{t} OK : retour à la liste')

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


def t_accueil_ordre(bench, eng, dev, theme):
    """Accueil → « Changer l'ordre » → glisser → accueil à jour : rotation dans l'ordre (retour de Maxence, 19/11)."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        d = json.loads(semaine_json())
        keys = list(d['userProgrammes'][PID]['sessions'])
        # Mardi fait il y a 2 jours : la rotation propose Mercredi, puis Jeudi… jusqu'à Mardi
        two_days = 2 * 86400_000
        seed(page, theme, json.dumps(d, ensure_ascii=False))
        page.evaluate("""([pid, k, ms]) => { const date = Date.now() - ms; data.programmes[pid].timers[k] = date;
            data.history.unshift({ id: 'hmardi', date, programme: pid, category: k, exercises: [{ name: 'Développé couché', sets: [{ weight: '40', reps: '10' }] }] });
            save(); render(); }""", [PID, keys[1], two_days])
        page.wait_for_timeout(200)
        R.check(page.locator('.hero__name').inner_text().strip() == 'Mercredi', f'{t} accueil : la suivante de Mardi (Mercredi)')
        R.check(page.locator('#homeNext').inner_text().strip() == 'Ensuite', f'{t} titre « Ensuite » (dans l\'ordre)')
        attendu = JOURS[3:] + JOURS[:2]
        R.check(labels(page, '.home-cell__name')[:6] == attendu, f'{t} Ensuite en boucle {labels(page, ".home-cell__name")[:6]}')
        page.click('[data-action="toggle-home-order"]')
        page.wait_for_selector('.ho-handle')
        R.check(labels(page, '.ho-row .cell__title') == JOURS, f'{t} mode ordre : toutes les séances, ordre du programme')
        shot(page, LOT, f'accueil_ordre_{t}')
        # Glisser Mercredi (3e) tout en bas
        page.locator('.home-order').scroll_into_view_if_needed()
        hb = page.locator('.ho-handle').nth(2).bounding_box()
        rh = page.locator('.ho-row').first.bounding_box()['height']
        x, y = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        for k in range(1, 13):
            page.mouse.move(x, y + rh * 4 * k / 12)
        page.mouse.up()
        page.wait_for_selector('.ho-row')
        nouvel = ['Lundi', 'Mardi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche', 'Mercredi']
        R.check(labels(page, '.ho-row .cell__title') == nouvel, f'{t} glisser : Mercredi en dernier {labels(page, ".ho-row .cell__title")}')
        stored = json.loads(ls(page, 'ppl_v2'))['userProgrammes'][PID]
        R.check([stored['sessions'][k]['label'] for k in stored['order']] == nouvel, f'{t} ordre enregistré')
        page.click('[data-action="toggle-home-order"]')
        page.wait_for_selector('.hero__name')
        R.check(page.locator('.hero__name').inner_text().strip() == 'Jeudi', f'{t} accueil à jour : Jeudi suit Mardi')
        R.check(labels(page, '.home-cell__name')[:6] == ['Vendredi', 'Samedi', 'Dimanche', 'Mercredi', 'Lundi', 'Mardi'], f'{t} Ensuite à jour')
        shot(page, LOT, f'accueil_apres_{t}')
        # La feuille d'une séance propose aussi « Changer l'ordre »
        page.locator('.home-cell[data-action="session-actions"]').first.click()
        page.wait_for_selector('.ios-dialog--sheet')
        R.check(page.locator('.ios-dialog__btn', has_text="Changer l'ordre").count() == 1, f'{t} feuille : « Changer l\'ordre »')
        tap_dialog(page, "Changer l'ordre")
        page.wait_for_selector('.ho-handle')
        R.check(page.locator('.ho-row').count() == 7, f'{t} feuille : ouvre le mode ordre')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:3]}')

    # Programme intégré : selon la récupération, « Autres séances », pas de « Changer l'ordre »
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        R.check(page.locator('[data-action="toggle-home-order"]').count() == 0, f'{t} PPL : pas de « Changer l\'ordre »')
        R.check(page.locator('#homeNext').inner_text().strip() == 'Autres séances', f'{t} PPL : « Autres séances »')


def sr_text(page):
    """Dernière annonce VoiceOver (région live #sr-polite, remplie 30 ms après)."""
    settle(page)
    return page.locator('#sr-polite').inner_text().strip()


def focused_label(page):
    return page.evaluate("document.activeElement?.getAttribute('aria-label') || ''")


def t_monter_descendre(bench, eng, dev, theme):
    """Réordonner sans glisser : poignée = bouton nommé, feuille Monter / Descendre, place annoncée, focus gardé."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        d = json.loads(semaine_json())
        k0 = list(d['userProgrammes'][PID]['sessions'])[0]
        # Lundi : trois exercices, les deux derniers en superset (Monter / Descendre ne coupe jamais un superset)
        d['programmes'][PID]['exercises'][k0] = [
            {'id': 'ea', 'name': 'Squat', 'sets': 3},
            {'id': 'eb', 'name': 'Rowing barre', 'sets': 3, 'ss': 'g1'},
            {'id': 'ec', 'name': 'Tractions', 'sets': 3, 'ss': 'g1'},
        ]
        seed(page, theme, json.dumps(d, ensure_ascii=False))
        page.evaluate("r => navigate(r)", 'programmes')
        page.wait_for_selector('.programmes')
        page.click('[data-action="toggle-prog-order"]')
        page.wait_for_selector('.ps-handle')

        # Arbre d'accessibilité : un bouton par poignée, nommé
        lundi = page.get_by_role('button', name='Déplacer Lundi')
        R.check(lundi.count() == 1, f'{t} poignée = bouton « Déplacer Lundi » dans l\'arbre d\'accessibilité')
        # Clavier / VoiceOver : activer la poignée ouvre la feuille ; Lundi, premier, ne peut que descendre
        lundi.focus()
        page.keyboard.press('Enter')
        page.wait_for_selector('.ios-dialog--sheet')
        btns = [b.strip() for b in page.locator('.ios-dialog__btn').all_inner_texts()]
        R.check(btns == ['Descendre', 'Annuler'], f'{t} premier : Descendre seulement {btns}')
        R.check('1 sur 7' in page.locator('.ios-dialog').inner_text(), f'{t} feuille : place actuelle « 1 sur 7 »')
        shot(page, LOT, f'monter_feuille_{t}')
        tap_dialog(page, 'Descendre')
        settle(page)
        R.check(labels(page, '.ps-row .cell__title')[:3] == ['Mardi', 'Lundi', 'Mercredi'], f'{t} Descendre : Lundi 2e {labels(page, ".ps-row .cell__title")[:3]}')
        stored = json.loads(ls(page, 'ppl_v2'))['userProgrammes'][PID]['sessions']
        R.check([v['label'] for v in stored.values()][:2] == ['Mardi', 'Lundi'], f'{t} Descendre : enregistré')
        R.check(sr_text(page) == 'Lundi, 2 sur 7', f'{t} annonce « Lundi, 2 sur 7 » ({sr_text(page)})')
        R.check(focused_label(page) == 'Déplacer Lundi', f'{t} focus gardé sur la poignée déplacée ({focused_label(page)})')
        # Monter depuis le milieu : les deux choix, puis retour en tête
        page.keyboard.press('Enter')
        page.wait_for_selector('.ios-dialog--sheet')
        btns = [b.strip() for b in page.locator('.ios-dialog__btn').all_inner_texts()]
        R.check(btns == ['Monter', 'Descendre', 'Annuler'], f'{t} milieu : Monter et Descendre {btns}')
        tap_dialog(page, 'Monter')
        settle(page)
        R.check(labels(page, '.ps-row .cell__title') == JOURS, f'{t} Monter : ordre d\'origine')
        R.check(sr_text(page) == 'Lundi, 1 sur 7', f'{t} annonce « Lundi, 1 sur 7 »')
        # Annuler ne bouge rien
        page.keyboard.press('Enter')
        page.wait_for_selector('.ios-dialog--sheet')
        tap_dialog(page, 'Annuler')
        R.check(labels(page, '.ps-row .cell__title') == JOURS, f'{t} Annuler : rien ne bouge')
        # Un toucher (sans glisser) sur la poignée ouvre aussi la feuille
        page.locator('.ps-handle').nth(6).click()
        page.wait_for_selector('.ios-dialog--sheet')
        btns = [b.strip() for b in page.locator('.ios-dialog__btn').all_inner_texts()]
        R.check(btns == ['Monter', 'Annuler'], f'{t} toucher : feuille ouverte, dernier = Monter seulement {btns}')
        tap_dialog(page, 'Annuler')

        # Éditeur de séance : exercices, superset jamais coupé
        page.click('[data-action="toggle-prog-order"]')
        page.locator('[data-action="open-prog-session"]').first.click()
        page.wait_for_selector('.view.editor')
        page.click('[data-action="toggle-edit-mode"]')
        page.wait_for_selector('.ed-handle')
        squat = page.get_by_role('button', name='Déplacer Squat')
        R.check(squat.count() == 1, f'{t} éditeur : poignée « Déplacer Squat » dans l\'arbre')
        squat.focus()
        page.keyboard.press('Enter')
        page.wait_for_selector('.ios-dialog--sheet')
        tap_dialog(page, 'Descendre')
        settle(page)
        names = lambda: page.evaluate("prog().exercises[editorCatOf()].map(e => e.name)")
        R.check(names() == ['Rowing barre', 'Tractions', 'Squat'], f'{t} éditeur : Squat passe sous le superset entier {names()}')
        R.check(sr_text(page) == 'Squat, 3 sur 3', f'{t} éditeur : annonce « Squat, 3 sur 3 » ({sr_text(page)})')
        R.check(focused_label(page) == 'Déplacer Squat', f'{t} éditeur : focus gardé ({focused_label(page)})')
        # Dans le superset : Tractions monte au-dessus de Rowing, sans sortir du groupe
        page.get_by_role('button', name='Déplacer Tractions').focus()
        page.keyboard.press('Enter')
        page.wait_for_selector('.ios-dialog--sheet')
        btns = [b.strip() for b in page.locator('.ios-dialog__btn').all_inner_texts()]
        R.check(btns == ['Monter', 'Annuler'], f'{t} éditeur : dernier du superset, Monter seulement {btns}')
        tap_dialog(page, 'Monter')
        settle(page)
        R.check(names() == ['Tractions', 'Rowing barre', 'Squat'], f'{t} éditeur : ordre dans le superset {names()}')
        R.check(page.evaluate("prog().exercises[editorCatOf()].slice(0, 2).every(e => e.ss)"), f'{t} éditeur : superset gardé')
        shot(page, LOT, f'monter_editeur_{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:3]}')


run_main(R, [t_ordre, t_accueil_ordre, t_monter_descendre])
