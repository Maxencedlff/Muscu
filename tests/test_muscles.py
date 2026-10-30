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
MUSCLE_IDS = ['chest', 'front_delts', 'side_delts', 'rear_delts', 'traps', 'lats', 'lower_back', 'biceps', 'brachialis',
              'triceps', 'forearms', 'abs', 'glutes', 'quads', 'hamstrings', 'adductors', 'calves']


def tag(device, theme):
    return f'{device}-{theme}'


# Onglets dans l'ordre de TABS (js/ui/router.js), désignés par leur nom et non par leur rang
TAB_NAMES = ['train', 'history', 'progress', 'program', 'friends']


def tab(page, i):
    t = page.locator(f'.tabbar [data-tab="{TAB_NAMES[i]}"]')
    t.click()
    page.wait_for_timeout(300)
    t.click()
    page.wait_for_timeout(300)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def heat(page, muscle):
    """Opacité de chaleur d'un muscle dans la carte de Progrès (0 : neutre, aucun calque coloré)."""
    return page.evaluate("""m => {
        const z = document.querySelector(`.mcard__map [data-muscle="${m}"]`);
        return z ? parseFloat(z.dataset.heat || '0') : 0;
    }""", muscle)


def next_sunday_evening_ms():
    """Dimanche prochain à 20 h (heure locale), en millisecondes"""
    import datetime
    d = datetime.datetime.now().replace(hour=20, minute=0, second=0, microsecond=0)
    d += datetime.timedelta(days=(6 - d.weekday()) % 7 or 7)
    return int(d.timestamp() * 1000)


def t_progress(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        # Historique : push il y a 8 jours, pull il y a 6, legs il y a 4. Horloge figée un dimanche soir :
        # « Cette semaine » part du lundi, pull et legs y sont, push (vendredi d'avant) non
        sunday = next_sunday_evening_ms()
        page.clock.install(time=sunday / 1000)
        seed(page, theme, ppl_v2_today_json(now_ms=sunday))
        tab(page, 2)
        card = page.locator('.mcard')
        R.check(card.count() == 1, f'{t} carte « Muscles » dans Progrès')
        R.check(bases_loaded(page, '.mcard__map') == 2, f'{t} personnage : face et dos affichés (images chargées)')
        R.check(heat(page, 'lats') > 0 and heat(page, 'quads') > 0, f'{t} semaine : dos et jambes colorés')
        R.check(heat(page, 'chest') == 0, f'{t} semaine : pectoraux neutres (push il y a 8 jours)')
        low = page.locator('.mlow').inner_text()
        R.check('Pectoraux' in low and 'Grand dorsal' not in low, f'{t} peu travaillés : « {low} »')
        sr = page.locator('.mcard .visually-hidden li').all_inner_texts()
        R.check(len(sr) == 17 and any(x.startswith('Grand dorsal : ') and 'série' in x for x in sr), f'{t} liste VoiceOver {sr[:2]}')
        R.check(page.locator('.mcard__map[aria-hidden="true"]').count() == 1, f'{t} dessin masqué à VoiceOver')
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
        R.check(rows == 17, f'{t} séries par muscle : 17 lignes ({rows})')
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
        skip_questions(page)
        tab(page, 2)
        R.check(page.locator('.mcard').count() == 1, f'{t} carte présente sans historique')
        R.check('Aucune séance' in page.locator('.mcard').inner_text(), f'{t} état vide')
        R.check(all(heat(page, m) == 0 for m in ('chest', 'quads', 'lats')), f'{t} silhouette neutre')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_editor(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        # Exercice créé par la personne en tête de séance ; ancien choix (version précédente) sur un exercice intégré
        page.evaluate("""() => { const xs = data.programmes.ppl.exercises.push;
            xs[0].muscles = ['calves']; xs[0].musclesSecondary = ['abs'];
            xs.unshift(makeExercise('Développé maison', 3)); save(); }""")
        tab(page, 3)
        page.click('[data-action="open-prog-session"][data-cat="push"]')
        page.wait_for_selector('.view.editor')
        lines = page.locator('.ed-row .ex-muscles').all_inner_texts()
        R.check(lines[:2] == ['Pectoraux', 'Mollets'] and 'Épaules' in lines, f'{t} Programme › Séance : muscles sous les noms {lines}')
        shot(page, LOT, f'editeur-{t}')

        # Exercice de la bibliothèque à l'ancien choix : respecté, affiché comme modifié
        page.click('.ed-row[data-i="1"]')
        page.wait_for_selector('.view.ex-edit')
        R.check('Modifiés' in page.locator('[data-action="pick-ex-muscles"]').inner_text(), f'{t} ancien choix : « Modifiés »')
        R.check(page.locator('#exMuscles .mpill--main').all_inner_texts() == ['Mollets'], f'{t} ancien choix respecté')
        R.check(page.locator('[data-action="reset-ex-muscles"]').count() == 1, f'{t} « Rétablir » proposé')
        # Le nom saisi met les muscles à jour en direct ; un nom inventé rend le choix automatique
        page.fill('#exName', 'Curl marteau corde')
        page.wait_for_timeout(150)
        R.check('Personnalisés' in page.locator('[data-action="pick-ex-muscles"]').inner_text(), f'{t} choix gardé au renommage')
        page.click('[data-action="cancel-ex"]')
        page.wait_for_timeout(300)
        page.locator('.ios-dialog__btn--destructive').click()
        page.wait_for_selector('.view.editor')
        R.check(page.evaluate("data.programmes.ppl.exercises.push[1].muscles") == ['calves'], f'{t} ancien choix gardé tel quel')
        page.evaluate("delete data.programmes.ppl.exercises.push[1].muscles; delete data.programmes.ppl.exercises.push[1].musclesSecondary; save(); render()")
        page.click('.ed-row[data-i="1"]')
        page.wait_for_selector('.view.ex-edit')
        page.fill('#exName', 'Curl marteau corde')
        page.wait_for_timeout(150)
        pills = page.locator('#exMuscles .mpill').all_inner_texts()
        R.check(pills == ['Brachial', 'Biceps', 'Avant-bras'], f'{t} reconnaissance en direct {pills}')
        R.check('Automatique' in page.locator('[data-action="pick-ex-muscles"]').inner_text(), f'{t} nom inventé : automatique')
        page.fill('#exName', 'Développé couché haltères')
        page.wait_for_timeout(150)
        R.check('Vérifiés' in page.locator('[data-action="pick-ex-muscles"]').inner_text(), f'{t} nom de la bibliothèque : « Vérifiés »')
        page.click('[data-action="cancel-ex"]')
        page.wait_for_timeout(300)
        if page.locator('.ios-dialog__btn--destructive').count():
            page.locator('.ios-dialog__btn--destructive').click()
        page.wait_for_selector('.view.editor')

        # Exercice de la personne : choix manuel, Biceps seul
        page.click('.ed-row[data-i="0"]')
        page.wait_for_selector('.view.ex-edit')
        R.check('Automatique' in page.locator('[data-action="pick-ex-muscles"]').inner_text(), f'{t} muscles automatiques')
        page.fill('#exName', 'Développé couché haltères')
        page.wait_for_timeout(150)
        R.check('Vérifiés' in page.locator('[data-action="pick-ex-muscles"]').inner_text(), f'{t} nom de la bibliothèque saisi : muscles vérifiés')
        page.fill('#exName', 'Développé maison')
        page.wait_for_timeout(150)
        page.click('[data-action="pick-ex-muscles"]')
        page.wait_for_selector('.mpick')
        shot(page, LOT, f'choix-{t}')
        R.check(page.locator('.mpick__row[data-muscle="chest"]').get_attribute('aria-checked') == 'true', f'{t} pectoraux cochés')
        # Trois états : principal → secondaire → retiré ; les secondaires devinés arrivent pré-cochés
        R.check(page.locator('.mpick__row[data-muscle="triceps"]').get_attribute('aria-checked') == 'mixed', f'{t} secondaire pré-coché')
        page.click('.mpick__row[data-muscle="chest"]')
        R.check(page.locator('.mpick__row[data-muscle="chest"]').get_attribute('aria-checked') == 'mixed', f'{t} principal → secondaire')
        page.click('.mpick__row[data-muscle="chest"]')
        page.click('.mpick__row[data-muscle="biceps"]')
        R.check(page.locator('.mpick__row[data-muscle="biceps"]').get_attribute('aria-checked') == 'true', f'{t} case cochée au toucher')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(350)
        R.check(page.locator('#exMuscles .mpill--main').all_inner_texts() == ['Biceps'], f'{t} choix affiché')
        R.check('Pectoraux' not in page.locator('#exMuscles .mpill').all_inner_texts(), f'{t} muscle retiré')
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


def pick_state(page, muscle):
    return page.locator(f'.mpick__row[data-muscle="{muscle}"]').get_attribute('aria-checked')


def t_library_muscles(bench, eng, dev, theme):
    """Muscles vérifiés d'un exercice de la bibliothèque : modifier (confirmation, Annuler, Modifier), puis rétablir."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        tab(page, 3)
        page.click('[data-action="open-prog-session"][data-cat="push"]')
        page.wait_for_selector('.view.editor')
        page.click('.ed-row[data-i="0"]')
        page.wait_for_selector('.view.ex-edit')
        pick = page.locator('[data-action="pick-ex-muscles"]')
        # Par défaut : muscles vérifiés, sans « Rétablir »
        R.check('Modifier les muscles' in pick.inner_text() and 'Vérifiés' in pick.inner_text(), f'{t} défaut : « Modifier les muscles · Vérifiés »')
        R.check(page.locator('#exMuscles .mpill').all_inner_texts() == ['Pectoraux', 'Épaules antérieures', 'Triceps'], f'{t} muscles du catalogue')
        R.check(page.locator('[data-action="reset-ex-muscles"]').count() == 0, f'{t} défaut : pas de « Rétablir »')
        R.check('vérifiés' in page.locator('#exMuscles .group-foot').inner_text(), f'{t} pied : muscles vérifiés')
        R.check(pick.bounding_box()['height'] >= 44, f'{t} rangée de 44 pt au moins')
        page.locator('#exMuscles').evaluate("el => el.scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'biblio-defaut-{t}')

        # Modifier : la feuille n'a pas de bouton de retour (rien à rétablir), la validation demande confirmation
        pick.click()
        page.wait_for_selector('.mpick')
        R.check(page.locator('.mpick__auto').count() == 0, f'{t} feuille : pas de « Rétablir » sans choix')
        page.click('.mpick__row[data-muscle="biceps"]')
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.ios-dialog--alert')
        title = page.locator('.ios-dialog__title').inner_text()
        btns = page.locator('.ios-dialog__btn').all_inner_texts()
        R.check(title == 'Modifier les muscles vérifiés ?', f'{t} confirmation : titre « {title} »')
        R.check(btns == ['Annuler', 'Modifier'], f'{t} confirmation : boutons {btns}')
        page.wait_for_timeout(350)   # fin de l'animation d'ouverture
        R.check(all(b['height'] >= 44 for b in [x.bounding_box() for x in page.locator('.ios-dialog__btn').all()]), f'{t} boutons de 44 pt')
        shot(page, LOT, f'biblio-confirmation-{t}')
        page.locator('.ios-dialog__btn', has_text='Annuler').click()
        page.wait_for_timeout(350)
        R.check(page.locator('#exMuscles .mpill').all_inner_texts() == ['Pectoraux', 'Épaules antérieures', 'Triceps'], f'{t} Annuler : rien ne change')
        R.check('Vérifiés' in pick.inner_text(), f'{t} Annuler : toujours vérifiés')

        # Valider : Biceps en principal en plus
        pick.click()
        page.wait_for_selector('.mpick')
        page.click('.mpick__row[data-muscle="biceps"]')
        R.check(pick_state(page, 'biceps') == 'true', f'{t} biceps coché')
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.ios-dialog--alert')
        page.locator('.ios-dialog__btn', has_text='Modifier').click()
        page.wait_for_timeout(400)
        R.check(page.locator('#exMuscles .mpill--main').all_inner_texts() == ['Pectoraux', 'Biceps'], f'{t} choix affiché')
        R.check('Modifiés' in pick.inner_text(), f'{t} état : « Modifiés »')
        R.check('modifiés par toi' in page.locator('#exMuscles .group-foot').inner_text(), f'{t} pied : modifiés par toi')
        reset = page.locator('[data-action="reset-ex-muscles"]')
        R.check(reset.inner_text() == 'Rétablir les muscles par défaut' and reset.bounding_box()['height'] >= 44, f'{t} « Rétablir les muscles par défaut »')
        page.locator('#exMuscles').evaluate("el => el.scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'biblio-modifie-{t}')
        # Nouveau changement d'un choix déjà modifié : pas de nouvelle question
        pick.click()
        page.wait_for_selector('.mpick')
        R.check(page.locator('.mpick__auto').inner_text() == 'Rétablir les muscles par défaut', f'{t} feuille : « Rétablir » proposé')
        page.click('.mpick__row[data-muscle="triceps"]')   # secondaire → retiré
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(400)
        R.check(page.locator('.ios-dialog--alert').count() == 0, f'{t} déjà modifiés : pas de confirmation')
        page.click('[data-action="save-ex"]')
        page.wait_for_selector('.view.editor')
        ex0 = page.evaluate("data.programmes.ppl.exercises.push[0]")
        R.check(ex0.get('muscles') == ['chest', 'biceps'] and ex0.get('musclesSecondary') == ['front_delts'], f'{t} choix enregistré {ex0.get("muscles")} {ex0.get("musclesSecondary")}')
        R.check(page.locator('.ed-row[data-i="0"] .ex-muscles').inner_text() == 'Pectoraux · Biceps', f'{t} liste à jour')

        # Progrès › Exercice : même état, « Rétablir » annulable par le toast
        page.evaluate("navigate(makeRoute('stats-ex', 'p1dcouch'))")
        page.wait_for_selector('.view.stats-ex .mpanel')
        R.check('Modifiés' in page.locator('.view.stats-ex [data-action="declare-muscles"]').inner_text(), f'{t} Progrès › Exercice : « Modifiés »')
        page.locator('.view.stats-ex [data-action="reset-muscles"]').scroll_into_view_if_needed()
        page.locator('.view.stats-ex [data-action="reset-muscles"]').click()
        page.wait_for_timeout(300)
        R.check(page.locator('.view.stats-ex .mpill').all_inner_texts() == ['Pectoraux', 'Épaules antérieures', 'Triceps'], f'{t} rétabli : muscles vérifiés')
        R.check(page.locator('.view.stats-ex [data-action="reset-muscles"]').count() == 0, f'{t} rétabli : bouton retiré')
        R.check('muscles' not in page.evaluate("data.programmes.ppl.exercises.push[0]"), f'{t} rétabli : choix effacé')
        page.locator('.toast__action').click()
        page.wait_for_timeout(300)
        R.check(page.evaluate("data.programmes.ppl.exercises.push[0].muscles") == ['chest', 'biceps'], f'{t} toast Annuler : choix remis')
        page.locator('.view.stats-ex [data-action="reset-muscles"]').click()
        page.wait_for_timeout(300)
        stored = json.loads(ls(page, 'ppl_v2'))['programmes']['ppl']['exercises']['push'][0]
        R.check('muscles' not in stored, f'{t} rétabli écrit dans ppl_v2')

        # Fiche de la bibliothèque : choix par le nom, confirmation, puis rétablir
        page.evaluate("navigate(makeRoute('library-ex', 'Curl marteau'))")
        page.wait_for_selector('.view.library-ex')
        page.locator('.view.library-ex [data-action="declare-muscles"]').scroll_into_view_if_needed()
        page.locator('.view.library-ex [data-action="declare-muscles"]').click()
        page.wait_for_selector('.mpick')
        page.click('.mpick__row[data-muscle="forearms"]')   # principal → secondaire
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.ios-dialog--alert')
        page.locator('.ios-dialog__btn', has_text='Modifier').click()
        page.wait_for_timeout(400)
        R.check(page.evaluate("data.exerciseMusclesSecondary['curl marteau']") == ['forearms'], f'{t} fiche : choix par le nom')
        R.check(page.locator('.view.library-ex [data-action="reset-muscles"]').count() == 1, f'{t} fiche : « Rétablir »')
        page.locator('.view.library-ex [data-action="reset-muscles"]').click()
        page.wait_for_timeout(300)
        R.check(page.evaluate("data.exerciseMuscles === undefined"), f'{t} fiche : rétabli')
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


def bases_loaded(page, sel):
    """Nombre d'images de base (face, dos) chargées et décodées dans la carte sel."""
    page.wait_for_function("""s => [...document.querySelectorAll(s + ' .body-map__base')].every(i => i.complete)""", arg=sel, timeout=5000)
    return page.evaluate("""s => [...document.querySelectorAll(s + ' .body-map__base')].filter(i => i.naturalWidth > 0).length""", sel)


def body_of(page, sel):
    return page.evaluate('s => document.querySelector(s)?.dataset.body || null', sel)


def t_silhouette(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        # Premier lancement : choix sur l'écran de résultat des questions, sans le quitter
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        for sel in ('[data-action="onb-place"][data-val="salle"]', '[data-action="onb-freq"][data-val="3"]', '[data-action="onb-level"][data-val="debutant"]'):
            page.click(sel)
            page.wait_for_timeout(300)
        seg = page.locator('.onb [data-action="onb-silhouette"]')
        R.check(seg.count() == 2, f'{t} premier lancement : les deux silhouettes sur le résultat')
        R.check(page.locator('.onb [data-val="male"]').get_attribute('aria-pressed') == 'true', f'{t} homme par défaut')
        page.click('.onb [data-action="onb-silhouette"][data-val="female"]')
        page.wait_for_timeout(250)
        R.check(page.evaluate('data.silhouette') == 'female' and page.evaluate('data.onboarded') is False, f'{t} femme choisie, résultat toujours là')
        R.check(page.locator('.onb [data-val="female"]').get_attribute('aria-pressed') == 'true', f'{t} état annoncé (aria-pressed)')
        R.check(no_hscroll(page), f'{t} premier lancement : pas de défilement horizontal')
        shot(page, LOT, f'silhouette-accueil-{t}')

        # Données existantes : homme ; Réglages › Apparence › Silhouette, puis Progrès, fiche et story suivent.
        # Horloge figée un dimanche soir : la semaine contient pull et legs, quel que soit le jour du test
        sunday = next_sunday_evening_ms()
        page.clock.install(time=sunday / 1000)
        seed(page, theme, ppl_v2_today_json(now_ms=sunday))
        tab(page, 2)
        R.check(body_of(page, '.mcard__map') == 'male', f'{t} données existantes : silhouette homme')
        tab(page, 0)
        page.click('[data-action="go-settings"]')
        page.wait_for_selector('.view.settings-view')
        page.locator('[data-action="set-silhouette"][data-val="female"]').scroll_into_view_if_needed()
        page.click('[data-action="set-silhouette"][data-val="female"]')
        page.wait_for_timeout(250)
        R.check(page.locator('[data-action="set-silhouette"][data-val="female"]').get_attribute('aria-pressed') == 'true', f'{t} réglage : Femme sélectionné')
        R.check(no_hscroll(page), f'{t} réglages : pas de défilement horizontal')
        shot(page, LOT, f'silhouette-reglages-{t}')
        tab(page, 2)
        R.check(body_of(page, '.mcard__map') == 'female', f'{t} Progrès : silhouette femme')
        R.check(bases_loaded(page, '.mcard__map') == 2, f'{t} personnage femme : face et dos affichés')
        R.check('img/body/female/' in page.evaluate("document.querySelector('.mcard__map .body-map__base').src"), f'{t} images du personnage femme')
        R.check(heat(page, 'lats') > 0, f'{t} silhouette femme : coloration identique')
        page.locator('.mcard').scroll_into_view_if_needed()
        shot(page, LOT, f'silhouette-progres-{t}')
        page.locator('[data-action="open-stats-ex"][data-ex="p1dcouch"]').click()
        page.wait_for_selector('.view.stats-ex')
        R.check(body_of(page, '.mpanel__map') == 'female', f'{t} fiche exercice : silhouette femme')
        R.check(page.evaluate("bodySilhouette()") == 'female', f'{t} story partagée : personnage femme (bodyMapImage suit le réglage)')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# Point d'un muscle à l'écran, tiré directement de son calque (pixel opaque le plus proche du centre
# de sa forme) : indépendant de la détection de l'app (js/ui/body-tip.js), qui est ce qu'on vérifie
MUSCLE_POINT_JS = """async ([sel, m, view]) => {
  const map = document.querySelector(sel), fig = map.querySelector('.body-map__' + view);
  const img = await bodyLoadImage(bodyImgUrl(map.dataset.body, view, m));
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data, W = c.width, N = W * c.height;
  let sx = 0, sy = 0, n = 0;
  // Moitié gauche seulement : un muscle pair (bras, jambes) a son centre entre les deux côtés
  const half = i => i % W < W / 2;
  for (let i = 0; i < N; i++) if (half(i) && d[i * 4 + 3] > 200) { sx += i % W; sy += (i / W) | 0; n++; }
  let best = null, bd = Infinity;
  for (let i = 0; i < N; i++) if (half(i) && d[i * 4 + 3] > 250) {
    const dd = (i % W - sx / n) ** 2 + (((i / W) | 0) - sy / n) ** 2;
    if (dd < bd) { bd = dd; best = [i % W, (i / W) | 0]; }
  }
  const r = fig.getBoundingClientRect();
  return [r.left + best[0] / W * r.width, r.top + best[1] / c.height * r.height];
}"""


def tap_muscle(page, sel, muscle, view):
    x, y = page.evaluate(MUSCLE_POINT_JS, [sel, muscle, view])
    page.mouse.click(x, y)
    # Premier toucher d'une vue : cartes d'étiquettes calculées avant l'ouverture (plus long sous charge)
    try:
        page.wait_for_selector('.btip', timeout=3000)
    except Exception:
        pass
    page.wait_for_timeout(250)


def tip_text(page):
    tip = page.locator('.btip')
    return ' '.join(tip.inner_text().split()) if tip.count() else ''


def tip_inside(page):
    """La bulle tient dans l'écran, au-dessus de la barre d'onglets."""
    return page.evaluate("""() => { const r = document.querySelector('.btip').getBoundingClientRect();
        const bar = document.querySelector('.tabbar').getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= bar.top; }""")


def tip_rect(page):
    return page.evaluate("""() => { const r = document.querySelector('.btip').getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom), innerWidth,
                Math.round(document.querySelector('.tabbar').getBoundingClientRect().top)]; }""")


def tip_covers_selector(page):
    return page.evaluate("""() => { const a = document.querySelector('.btip').getBoundingClientRect();
        const b = document.querySelector('.mcard .segmented').getBoundingClientRect();
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }""")


def t_tip(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        tab(page, 2)
        page.click('[data-action="muscle-span"][data-span="month"]')
        page.wait_for_timeout(250)
        page.locator('.mcard__map').scroll_into_view_if_needed()
        R.check(bases_loaded(page, '.mcard__map') == 2, f'{t} bulle : personnage chargé')
        tap_muscle(page, '.mcard__map', 'chest', 'front')
        txt = tip_text(page)
        R.check(txt.startswith('Pectoraux') and re.search(r'\d+ séries en 4 semaines, soit [\d,]+ par semaine', txt)
                and 'Repère : 10 à 20 par semaine' in txt, f'{t} bulle pectoraux : « {txt} »')
        lvl = page.evaluate("muscleLoad('month').levels.chest")
        R.check(page.evaluate("MUSCLE_LEVEL_WORDS")[lvl] in txt, f'{t} bulle : palier en mots (légende) {lvl}')
        R.check(not tip_covers_selector(page), f'{t} bulle : sélecteur de période jamais couvert')
        leg = ' '.join(page.locator('.mcard .mlegend').inner_text().split())
        R.check(all(w in leg for w in ('Pas travaillé', 'Entretien 1–4', 'Travaillé 5–9', 'Objectif atteint 10–19', 'Gros volume 20+'))
                and 'en moyenne par semaine' in leg, f'{t} légende 4 semaines : « {leg} »')
        lines = page.evaluate("new Set([...document.querySelectorAll('.mcard .mlegend__item')].map(e => Math.round(e.getBoundingClientRect().top))).size")
        R.check(lines <= (3 if page.viewport_size['width'] < 360 else 2), f'{t} légende compacte : {lines} ligne(s) de paliers')
        R.check(page.locator('.btip[role="dialog"][aria-labelledby="btipTitle"]').count() == 1, f'{t} bulle : rôle et nom')
        R.check(tip_inside(page), f'{t} bulle dans l\'écran, au-dessus des onglets {tip_rect(page)}')
        R.check(page.locator('.mcard__map .body-map__front .body-map__hl[data-muscle="chest"]').count() == 1
                and page.locator('.body-map__hl').count() == 1, f'{t} pectoraux mis en valeur sur la face')
        anim = lambda: page.evaluate("getComputedStyle(document.querySelector('.body-map__hl > i')).animationName")
        R.check(anim() == 'body-hl', f'{t} mise en valeur : pulsation douce')
        page.emulate_media(reduced_motion='reduce')
        R.check(anim() == 'none', f'{t} réduire les animations : pas de pulsation')
        page.emulate_media(reduced_motion='no-preference')
        shot(page, LOT, f'bulle-face-{t}')
        n_chest = int(re.search(r'(\d+) séries?', txt).group(1))
        # Un autre muscle, de dos : la bulle suit
        tap_muscle(page, '.mcard__map', 'lats', 'back')
        txt = tip_text(page)
        R.check(txt.startswith('Grand dorsal') and page.locator('.btip').count() == 1, f'{t} bulle grand dorsal : « {txt} »')
        R.check(not tip_covers_selector(page), f'{t} bulle dos : sélecteur non couvert')
        n_lats = int(re.search(r'(\d+) séries?', txt).group(1))
        shot(page, LOT, f'bulle-dos-{t}')
        # Toucher hors d'un muscle : entre les deux vues (fond), puis sur la tête (zone grise) : fermée
        f, b = (page.locator(f'.mcard__map .body-map__{v}').bounding_box() for v in ('front', 'back'))
        tr = page.locator('.btip').bounding_box()
        gx = (f['x'] + f['width'] + b['x']) / 2
        # Écran étroit (Galaxy S9+) : la bulle couvre tout l'entre-deux sous les épaules, le fond entre les têtes reste libre
        gy = next(f['y'] + f['height'] * k for k in (.55, .7, .85, .95, .3, .2, .12, .06)
                  if not (tr['x'] <= gx <= tr['x'] + tr['width'] and tr['y'] <= f['y'] + f['height'] * k <= tr['y'] + tr['height']))
        page.mouse.click(gx, gy)
        page.wait_for_timeout(300)
        R.check(page.locator('.btip').count() == 0, f'{t} toucher le fond : bulle fermée')
        R.check(page.locator('.body-map__hl').count() == 0, f'{t} bulle fermée : mise en valeur retirée')
        tap_muscle(page, '.mcard__map', 'calves', 'front')
        R.check(tip_text(page).startswith('Mollets'), f'{t} bulle mollets : « {tip_text(page)} »')
        page.mouse.click(f['x'] + f['width'] / 2, f['y'] + f['height'] * .04)
        page.wait_for_timeout(300)
        R.check(page.locator('.btip').count() == 0, f'{t} toucher la tête (zone grise) : bulle fermée')
        tap_muscle(page, '.mcard__map', 'lats', 'back')
        page.locator('.mlegend').click()
        page.wait_for_timeout(200)
        R.check(page.locator('.btip').count() == 0, f'{t} toucher ailleurs : bulle fermée')
        tap_muscle(page, '.mcard__map', 'lats', 'back')
        page.click('[data-action="muscle-span"][data-span="week"]')
        page.wait_for_timeout(250)
        R.check(page.locator('.btip').count() == 0, f'{t} changement de période : bulle fermée')
        leg = ' '.join(page.locator('.mcard .mlegend').inner_text().split())
        R.check(leg.endswith('séries par semaine') and 'moyenne' not in leg, f'{t} légende semaine : « {leg} »')
        tap_muscle(page, '.mcard__map', 'lats', 'back')
        txt = tip_text(page)
        R.check(re.search(r'\d+ séries? depuis lundi', txt), f'{t} bulle semaine : « {txt} »')
        page.locator('.mlegend').click()
        page.wait_for_timeout(200)
        # Niveau débutant (premier lancement) : repère à 10
        page.evaluate("data.level = 'debutant'")
        tap_muscle(page, '.mcard__map', 'lats', 'back')
        R.check('Repère : 10 par semaine' in tip_text(page), f'{t} débutant : « {tip_text(page)} »')
        page.evaluate("delete data.level")
        page.locator('.mlegend').click()
        page.wait_for_timeout(200)
        page.click('[data-action="muscle-span"][data-span="month"]')
        page.wait_for_timeout(250)
        # Lien : « Séries par muscle », mêmes chiffres, ligne du muscle mise en avant
        tap_muscle(page, '.mcard__map', 'chest', 'front')
        page.locator('.btip [data-action="go-stats-muscles"]').click()
        page.wait_for_selector('.view.stats-muscles')
        page.wait_for_timeout(300)
        val = lambda m: int(page.locator(f'.mrow[data-muscle="{m}"] .cell__value').inner_text())
        R.check(val('chest') == n_chest and val('lats') == n_lats, f'{t} bulle = Séries par muscle ({n_chest}, {n_lats})')
        R.check(page.locator('.mrow--focus[data-muscle="chest"]').count() == 1, f'{t} ligne Pectoraux mise en avant')
        R.check(page.locator('.btip').count() == 0, f'{t} bulle fermée après le lien')
        page.click('[data-action="back"]')
        page.wait_for_selector('.view.stats')
        # Fiche exercice : principal / secondaire
        page.locator('[data-action="open-stats-ex"][data-ex="p1dcouch"]').click()
        page.wait_for_selector('.view.stats-ex .mpanel')
        page.locator('.mpanel').scroll_into_view_if_needed()
        bases_loaded(page, '.mpanel__map')
        w = page.locator('.mpanel__map').bounding_box()['width']
        R.check(w >= 200, f'{t} fiche : personnage agrandi ({w:.0f} px)')
        R.check(page.locator('.mpanel__map .body-map__m--sec[data-muscle="triceps"]').count() >= 1, f'{t} fiche : triceps en secondaire')
        tap_muscle(page, '.mpanel__map', 'chest', 'front')
        R.check(tip_text(page) == 'Pectoraux Muscle principal', f'{t} fiche : « {tip_text(page)} »')
        tap_muscle(page, '.mpanel__map', 'triceps', 'back')
        R.check(tip_text(page) == 'Triceps Muscle secondaire', f'{t} fiche : « {tip_text(page)} »')
        R.check(page.locator('.mpanel__map .body-map__back .body-map__hl[data-muscle="triceps"]').count() == 1
                and page.locator('.body-map__hl').count() == 1, f'{t} fiche : triceps mis en valeur, seul')
        R.check(tip_inside(page), f'{t} fiche : bulle dans l\'écran')
        shot(page, LOT, f'bulle-fiche-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def once_static(bench):
    files = ['js/data/muscles.js', 'js/data/exercise-catalogue.js', 'js/data/muscle-load.js', 'js/ui/body-map.js', 'js/ui/body-tip.js', 'js/features/muscles.js', 'js/features/muscle-tip.js', 'css/muscles.css']
    for f in files:
        n = sum(1 for _ in open(os.path.join(APP_DIR, f), encoding='utf-8'))
        R.check(n <= 400, f'{f} : {n} lignes (400 au plus)')
    css = open(os.path.join(APP_DIR, 'css/muscles.css'), encoding='utf-8').read()
    R.check(not re.findall(r'#[0-9a-fA-F]{3,8}\b|rgba?\(', css), 'muscles.css : couleurs en tokens seulement')
    # Carte dessinée dans un canvas (story de partage) : images chargées, muscle teinté de la couleur voulue
    with bench.page('chromium', 'Pixel 7', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json())
        px = page.evaluate("""async () => {
            const c = await bodyMapImage({ chest: 1 }, { view: 'front', body: 'male', colors: { heat: '#FF0000', bright: .5 } });
            if (!c) return null;
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let red = 0, gray = 0;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i + 3] < 200) continue;
              if (d[i] > 80 && d[i + 1] < 40 && d[i + 2] < 40) red++; else if (Math.abs(d[i] - d[i + 2]) < 12) gray++;
            }
            return { w: c.width, red, gray };
        }""")
        R.check(px and px['red'] > 2000 and px['gray'] > 20000, f'bodyMapImage : base grise et pectoraux teintés en rouge {px}')


run_main(R, [t_progress, t_empty, t_editor, t_library_muscles, t_add_sheet, t_silhouette, t_tip], once=[once_static])
