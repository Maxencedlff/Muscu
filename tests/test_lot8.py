"""Lot 8 : programmes créés par l'utilisateur (plusieurs, nommés, séances et exercices au choix)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 8
R = Results(LOT)


def tag(device, theme):
    return f'{device}-{theme}'


def data(page):
    return json.loads(ls(page, 'ppl_v2') or '{}')


# Onglets dans l'ordre de TABS (js/ui/router.js), désignés par leur nom et non par leur rang
TAB_NAMES = ['train', 'history', 'progress', 'program', 'friends']


def tab(page, i):
    # Comme sur iOS, l'onglet garde sa pile : un second toucher revient à sa racine
    t = page.locator(f'.tabbar [data-tab="{TAB_NAMES[i]}"]')
    t.click()
    page.wait_for_timeout(300)
    t.click()
    page.wait_for_timeout(300)


def new_programme(page, name, start_label):
    page.click('[data-action="new-programme"]')
    page.wait_for_selector('.ios-dialog__input')
    page.fill('.ios-dialog__input', name)
    tap_dialog(page, 'Suivant')
    page.wait_for_selector('.ios-dialog--sheet')
    tap_dialog(page, start_label)
    # Programme vide : on arrive directement sur « Nouvelle séance »
    page.wait_for_selector('#csName' if start_label == 'Programme vide' else '.view.programmes')


def add_session(page, name, from_list=True):
    if from_list:
        page.click('[data-action="add-custom-session"]')
    page.wait_for_selector('#csName')
    page.fill('#csName', name)
    page.click('[data-action="save-cs-modal"]')
    # Nouvelle séance : la Bibliothèque s'ouvre en mode choix (mêmes groupes illustrés)
    page.wait_for_selector('.view.library.library--pick')


def open_pick(page, already_open=False):
    if not already_open:
        page.click('[data-action="add-ex"]')
    page.wait_for_selector('.view.library.library--pick')
    page.wait_for_timeout(300)


def save_ex(page):
    page.click('[data-action="save-ex"]')
    page.wait_for_timeout(400)


def t_programmes(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        _click = page.click
        def logged(sel, *a, **k):
            if os.environ.get('PPL_TRACE'): print('  clic', sel, page.evaluate('location.hash'), flush=True)
            return _click(sel, *a, **k)
        page.click = logged
        seed(page, theme, ppl_v2_today_json())
        tab(page, 3)

        # 1. Programme vide, nommé, avec une séance et deux exercices au choix
        new_programme(page, 'Force 5×5', 'Programme vide')
        d = data(page)
        pid = d['activeProgramme']
        R.check(pid.startswith('u_') and d['userProgrammes'][pid]['name'] == 'Force 5×5', f'{t} programme vide créé et actif')
        R.check(page.locator('.view.cs-edit').count() == 1, f'{t} programme vide : « Nouvelle séance » ouverte d\'office')
        add_session(page, 'Haut du corps', from_list=False)
        cats = list(data(page)['userProgrammes'][pid]['sessions'])
        R.check(len(cats) == 1, f'{t} séance ajoutée au programme {cats}')
        st = page.evaluate('nav.stacks.program')
        R.check(st[-2:] == [f'editor:{cats[0]}', f'lib-pick:{cats[0]}'], f'{t} séance créée : ses exercices, puis le choix dans la Bibliothèque {st}')
        # Ajout par la Bibliothèque : groupes illustrés, groupe Pectoraux, un exercice ; son réglage s'ouvre tout de suite
        open_pick(page, already_open=True)
        R.check(page.locator('.library--pick .mgcs .mgc[data-group="pectoraux"] .mgc__img').count() == 1, f'{t} choix : groupes illustrés de la Bibliothèque')
        R.check(page.locator('.library--pick #libSearch').count() == 1 and page.locator('.library--pick [data-action="lib-equip"]').count() >= 5, f'{t} choix : recherche et filtres de matériel')
        shot(page, LOT, f'choix-{t}')
        page.click('.library--pick .mgc[data-group="pectoraux"]'); page.wait_for_timeout(300)
        page.click('.library--pick [data-action="lib-pick"][data-name="Développé couché haltères"]')
        page.wait_for_selector('.view.ex-edit')
        R.check(page.input_value('#exName') == 'Développé couché haltères', f'{t} réglage ouvert d\'office, nom rempli')
        R.check(page.inner_text('#exSetsVal') == '3' and page.input_value('#exRepMax') == '12', f'{t} réglage : valeurs par défaut (3 séries, 12 reps en haut)')
        R.check(len(data(page)['programmes'][pid]['exercises'][cats[0]]) == 0, f'{t} rien d\'ajouté avant OK')
        page.click('[data-action="ex-sets"][data-d="1"]')
        page.click('[data-action="ex-rest"][data-s="120"]')
        page.fill('#exTarget', '22,5')
        shot(page, LOT, f'reglage-{t}')
        save_ex(page)
        page.wait_for_selector('.view.editor')
        ex0 = data(page)['programmes'][pid]['exercises'][cats[0]][0]
        R.check(ex0['name'] == 'Développé couché haltères' and ex0['sets'] == 4 and ex0['rest'] == 120 and ex0['target'] == 22.5,
                f'{t} OK enregistre le réglage {ex0}')
        # Exercice créé : nom, muscles, matériel puis réglage, sur le même écran
        open_pick(page)
        page.fill('#libSearch', 'tractions lestées'); page.wait_for_timeout(200)
        page.click('.library--pick [data-action="lib-pick-create"]')
        page.wait_for_selector('.view.ex-edit')
        R.check(page.input_value('#exName') == 'Tractions lestées', f'{t} création : nom repris (majuscule)')
        R.check(page.locator('#exMuscles').count() == 1 and page.locator('#exEquip [data-action="ex-equip"]').count() >= 5, f'{t} création : muscles et matériel')
        page.click('#exEquip [data-equip="barre"]')
        save_ex(page)
        page.wait_for_selector('.view.editor')
        R.check(page.evaluate("equipmentOf('Tractions lestées')") == 'barre', f'{t} création : matériel enregistré')
        # Ajout multiple : « Sélectionner », deux exercices cochés, réglages l'un après l'autre
        open_pick(page)
        page.click('.library--pick [data-action="lib-pick-multi"]'); page.wait_for_timeout(250)
        R.check(page.locator('.library--pick [data-action="lib-pick-add"]').is_disabled(), f'{t} multiple : Ajouter grisé sans choix')
        page.click('.library--pick .mgc[data-group="bras"]'); page.wait_for_timeout(300)
        rows = page.locator('.library--pick [data-action="lib-pick"][role="checkbox"]')
        R.check(page.locator('.library--pick .lib-pick-cancel').is_visible(), f'{t} multiple dans un groupe : « Annuler » pour sortir de la sélection')
        picked = [rows.nth(i).get_attribute('data-name') for i in range(2)]
        rows.nth(0).click(); rows.nth(1).click(); page.wait_for_timeout(150)
        R.check(rows.nth(0).get_attribute('aria-checked') == 'true', f'{t} multiple : case cochée')
        add_txt = page.inner_text('.library--pick [data-action="lib-pick-add"]')
        R.check('(2)' in add_txt, f'{t} multiple : « Ajouter (2) » {add_txt!r} {picked}')
        shot(page, LOT, f'choix-multiple-{t}')
        page.click('.library--pick [data-action="lib-pick-add"]')
        page.wait_for_selector('.view.ex-edit')
        R.check('1 sur 2' in page.inner_text('.view.ex-edit .navbar') and page.inner_text('[data-action="save-ex"]') == 'Suivant', f'{t} multiple : « 1 sur 2 », Suivant')
        hs = page.evaluate("[...document.querySelectorAll('.view.ex-edit .stepper button')].map(b => Math.round(b.getBoundingClientRect().height))")
        R.check(len(hs) == 4 and min(hs) >= 44, f'{t} réglage : boutons − et + d\'au moins 44 pt de haut {hs}')
        page.click('[data-action="ex-sets"][data-d="1"]')
        save_ex(page)
        R.check('2 sur 2' in page.inner_text('.view.ex-edit .navbar') and page.inner_text('[data-action="save-ex"]') == 'OK', f'{t} multiple : « 2 sur 2 », OK')
        save_ex(page)
        page.wait_for_selector('.view.editor')
        lst = data(page)['programmes'][pid]['exercises'][cats[0]]
        exs = [e['name'] for e in lst]
        R.check(exs == ['Développé couché haltères', 'Tractions lestées', *picked], f'{t} exercices choisis ajoutés {exs}')
        R.check(lst[2]['sets'] == 4 and lst[3]['sets'] == 3, f'{t} multiple : réglage de chacun gardé')
        # Retour depuis le réglage : la séance, jamais l'écran du choix
        R.check(page.evaluate('currentRoute()') == f'editor:{cats[0]}', f'{t} après OK : la séance')
        shot(page, LOT, f'editeur-{t}')
        # Retour : la liste des séances, pas l'écran du nom
        page.evaluate('goBack()')
        page.wait_for_selector('.view.programmes')
        page.wait_for_timeout(300)
        R.check('Force 5×5' in page.inner_text('.view.programmes') and 'Haut du corps' in page.inner_text('.view.programmes'),
                f'{t} retour : liste du programme avec la séance')

        # 2. La séance se fait depuis l'accueil
        tab(page, 0)
        page.click(f'[data-action="start-session"][data-cat="{cats[0]}"]')
        page.wait_for_selector('.view.session')
        page.fill('[data-action="set-weight"][data-ei="0"][data-si="0"]', '40')
        page.fill('[data-action="set-reps"][data-ei="0"][data-si="0"]', '5')
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]')
        page.wait_for_timeout(300)
        page.click('[data-action="finish-session"]')
        page.wait_for_selector('.ios-dialog--sheet')
        tap_dialog(page, 'Enregistrer')
        page.wait_for_timeout(600)
        h = data(page)['history'][0]
        R.check(h['programme'] == pid and h['category'] == cats[0], f'{t} séance enregistrée dans le programme {h.get("programme")}')

        # Bilan de fin : « Terminé » ramène à l'accueil
        if page.locator('[data-action="summary-done"]').count():
            page.click('[data-action="summary-done"]')
            page.wait_for_timeout(300)

        # 3. Un deuxième programme, copié de PPL, puis renommé
        tab(page, 3)
        new_programme(page, 'PPL du lundi', 'Copie de PPL')
        d = data(page)
        pid2 = d['activeProgramme']
        R.check(pid2 != pid and len(d['userProgrammes']) == 2, f'{t} deux programmes créés')
        R.check(len(d['programmes'][pid2]['exercises'].get('push', [])) >= 4, f'{t} copie de PPL avec ses exercices')
        page.click('[data-action="rename-programme"]')
        page.wait_for_selector('.ios-dialog__input')
        page.fill('.ios-dialog__input', 'PPL perso')
        tap_dialog(page, 'OK')
        R.check(data(page)['userProgrammes'][pid2]['name'] == 'PPL perso', f'{t} programme renommé')

        # Suppression d'une séance directement depuis son écran
        page.click('[data-action="open-prog-session"][data-cat="legs"]')
        page.wait_for_selector('.view.editor')
        page.click('[data-action="delete-custom-session"]')
        page.wait_for_selector('.ios-dialog--sheet')
        tap_dialog(page, 'Supprimer')
        page.wait_for_timeout(400)
        R.check('legs' not in data(page)['userProgrammes'][pid2]['sessions'], f'{t} séance supprimée depuis son écran')

        # 4. Le sélecteur liste les deux sous « Mes programmes »
        page.click('[data-action="go-my-programmes"]')
        page.wait_for_selector('.view.my-programmes')
        txt = page.inner_text('.view.my-programmes')
        R.check('Force 5×5' in txt and 'PPL perso' in txt and 'mes programmes' in txt.lower(), f'{t} sélecteur : mes programmes')
        shot(page, LOT, f'selecteur-{t}')
        page.locator('[data-action="select-prog"]', has_text='Force 5×5').first.click()
        tap_dialog(page, 'Changer de programme')
        R.check(data(page)['activeProgramme'] == pid, f'{t} bascule entre programmes créés')

        # 5. Suppression : l'historique reste lisible, le programme disparaît du sélecteur
        page.click('[data-action="delete-programme"]')
        page.wait_for_selector('.ios-dialog--sheet')
        tap_dialog(page, 'Supprimer le programme')
        d = data(page)
        R.check(d['activeProgramme'] == 'ppl' and d['userProgrammes'][pid]['archived'], f'{t} programme supprimé (archivé), retour à PPL')
        R.check(any(x['programme'] == pid for x in d['history']), f'{t} historique du programme conservé')
        tab(page, 1)
        R.check('Haut du corps' in page.inner_text('#app'), f'{t} historique affiche encore la séance du programme supprimé')
        tab(page, 3)
        page.click('[data-action="go-my-programmes"]')
        page.wait_for_selector('.view.my-programmes')
        R.check('Force 5×5' not in page.inner_text('.view.my-programmes'), f'{t} programme supprimé absent du sélecteur')

        # 6. Après rechargement, tout est conservé ; l'ancien « Perso » reste accessible
        page.reload()
        page.wait_for_selector('#app > *')
        d = data(page)
        R.check(d['userProgrammes'][pid2]['name'] == 'PPL perso' and d['customSessions'], f'{t} données conservées après rechargement')


run_main(R, [t_programmes])
