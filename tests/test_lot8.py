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


def tab(page, i):
    # Comme sur iOS, l'onglet garde sa pile : un second toucher revient à sa racine
    t = page.locator('.tabbar [role=tab]').nth(i)
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
    page.wait_for_selector('.view.programmes')


def add_session(page, name):
    page.click('[data-action="add-custom-session"]')
    page.wait_for_selector('#csName')
    page.fill('#csName', name)
    page.click('[data-action="save-cs-modal"]')
    page.wait_for_selector('.view.programmes')


def add_exercise(page, name):
    page.click('[data-action="add-ex"]')
    page.wait_for_selector('#axSearch')
    page.fill('#axSearch', name)
    page.wait_for_timeout(150)
    page.locator('[data-action="ax-pick"]', has_text=name).first.click()
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
        R.check('Force 5×5' in page.inner_text('.view.programmes'), f'{t} nom affiché dans Programme')
        add_session(page, 'Haut du corps')
        cats = list(data(page)['userProgrammes'][pid]['sessions'])
        R.check(len(cats) == 1, f'{t} séance ajoutée au programme {cats}')
        page.click(f'[data-action="open-prog-session"][data-cat="{cats[0]}"]')
        page.wait_for_selector('.view.editor')
        add_exercise(page, 'Développé couché haltères')
        page.wait_for_timeout(400)
        add_exercise(page, 'Tractions lestées')
        page.wait_for_timeout(300)
        exs = [e['name'] for e in data(page)['programmes'][pid]['exercises'][cats[0]]]
        R.check(exs == ['Développé couché haltères', 'Tractions lestées'], f'{t} exercices choisis ajoutés {exs}')
        shot(page, LOT, f'editeur-{t}')

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
        page.click('[data-action="go-prog-picker"]')
        page.wait_for_selector('.view.prog-picker')
        txt = page.inner_text('.view.prog-picker')
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
        page.click('[data-action="go-prog-picker"]')
        page.wait_for_selector('.view.prog-picker')
        R.check('Force 5×5' not in page.inner_text('.view.prog-picker'), f'{t} programme supprimé absent du sélecteur')

        # 6. Après rechargement, tout est conservé ; l'ancien « Perso » reste accessible
        page.reload()
        page.wait_for_selector('#app > *')
        d = data(page)
        R.check(d['userProgrammes'][pid2]['name'] == 'PPL perso' and d['customSessions'], f'{t} données conservées après rechargement')


run_main(R, [t_programmes])
