"""Supersets : création depuis la séance, enchaînement sans repos, repos à la fin du tour, exercice
fait seul, reprise après fermeture de l'app, retrait ; création dans Programme › Séance.

Captures : $PPL_SCRATCH/shots/lotsuperset/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_superset.py (ou sans variable : tous les appareils).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'superset'
R = Results(LOT)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def resting(page):
    return page.evaluate("document.querySelector('.view.session')?.classList.contains('session--resting')")


def current(page):
    return page.evaluate("(e => e ? [+e.dataset.ei, +e.dataset.si] : null)(document.querySelector('.session-set--current'))")


def skip_rest(page):
    for sel in ('.rest-overlay [data-action="skip-rest"]', '.rest-mini__skip'):
        loc = page.locator(sel)
        if loc.count() and loc.first.is_visible():
            loc.first.click()
            break
    page.wait_for_timeout(200)


def validate(page, ei, si):
    page.click(f'[data-action="validate-set"][data-ei="{ei}"][data-si="{si}"]')
    page.wait_for_timeout(350)


def push_prog(page):
    return json.loads(ls(page, 'ppl_v2'))['programmes']['ppl']['exercises']['push']


def t_seance(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.click('[data-action="start-session"][data-cat="push"]')
        page.wait_for_selector('.view.session')
        names = [n.strip() for n in page.locator('.ex-card__name').all_inner_texts()]

        # ⋯ du 1er exercice › Superset avec… › le 3e
        page.click('.ex-card__more[data-ei="0"]')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Superset avec')
        page.wait_for_selector('.ssp')
        page.locator('.ssp .mpick__row').nth(1).click()
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(500)
        R.check(page.locator('.ss-card').count() == 1, f'{t} une carte de superset')
        members = [n.strip() for n in page.locator('.ss-member__name').all_inner_texts()]
        R.check(members == [names[0], names[2]], f'{t} le 3e exercice rejoint le 1er {members}')
        R.check([x.strip() for x in page.locator('.ss-member .ss-tag').all_inner_texts()] == ['A1', 'A2'], f'{t} lettres A1, A2')
        prog = push_prog(page)
        R.check(prog[0].get('ss') and prog[0].get('ss') == prog[1].get('ss') and prog[1]['name'] == names[2], f'{t} enregistré dans le programme')
        shot(page, LOT, f'{t}-1-carte')

        # A1 : pas de repos, A2 devient la série courante ; A2 : repos
        validate(page, 0, 0)
        R.check(not resting(page), f'{t} pas de repos après A1')
        R.check(current(page) == [1, 0], f'{t} série courante A2 S1 ({current(page)})')
        R.check('Enchaîne' in page.locator('.toast').last.inner_text(), f'{t} toast « Enchaîne »')
        # « Annuler » puis revalider A1 : on enchaîne toujours
        page.locator('.toast button', has_text='Annuler').last.click()
        page.wait_for_timeout(300)
        validate(page, 0, 0)
        R.check(not resting(page) and current(page) == [1, 0], f'{t} Annuler puis revalider : enchaîne ({current(page)})')
        validate(page, 1, 0)
        R.check(resting(page), f'{t} repos à la fin du tour')
        R.check(current(page) == [0, 1], f'{t} tour 2 : A1 S2 ({current(page)})')
        shot(page, LOT, f'{t}-2-repos')
        skip_rest(page)

        # A1 refait seul deux fois de suite (A2 pris) : la 2e fois, repos
        validate(page, 0, 1)
        R.check(not resting(page), f'{t} A1 S2 : on enchaîne')
        validate(page, 0, 2)
        R.check(resting(page), f'{t} A1 deux fois de suite : repos')
        skip_rest(page)

        # Fermeture puis reprise de l'app au milieu : le groupe et la série courante reviennent
        page.reload()
        page.wait_for_selector('#app > *')
        if not page.locator('.view.session').count():
            page.click('[data-action="resume-session"]')
            page.wait_for_selector('.view.session')
        R.check(page.locator('.ss-card').count() == 1, f'{t} reprise : superset gardé')
        R.check(current(page) == [1, 1], f'{t} reprise : A2 S2 à faire ({current(page)})')

        # Retirer du superset : séance et programme
        page.click('.ss-member .ex-card__more[data-ei="0"]')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Retirer du superset')
        page.wait_for_timeout(400)
        R.check(page.locator('.ss-card').count() == 0, f'{t} superset défait')
        R.check(not any(e.get('ss') for e in push_prog(page)), f'{t} programme défait')
        R.check(not page.errors, f'{t} erreurs JS {page.errors}')


def t_editeur(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.evaluate("navigate('editor:pull')")
        page.wait_for_selector('[data-action="ed-superset"]')
        page.click('[data-action="ed-superset"]')
        page.wait_for_selector('.ssp')
        page.locator('.ssp .mpick__row').nth(3).click()
        page.locator('.ssp .mpick__row').nth(4).click()
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(500)
        tags = [x.strip() for x in page.locator('.ed-row .ss-tag').all_inner_texts()]
        R.check(tags == ['A1', 'A2'], f'{t} éditeur : pastilles {tags}')
        pull = json.loads(ls(page, 'ppl_v2'))['programmes']['ppl']['exercises']['pull']
        R.check(pull[3].get('ss') and pull[3]['ss'] == pull[4].get('ss'), f'{t} éditeur : groupe enregistré')
        shot(page, LOT, f'{t}-3-editeur')
        # Programme › Exercice › Retirer, appliqué par OK
        page.click('[data-action="edit-ex"][data-i="4"]')
        page.wait_for_selector('[data-action="ex-ss-leave"]')
        page.click('[data-action="ex-ss-leave"]')
        page.click('[data-action="save-ex"]')
        page.wait_for_timeout(500)
        pull = json.loads(ls(page, 'ppl_v2'))['programmes']['ppl']['exercises']['pull']
        R.check(not any(e.get('ss') for e in pull), f'{t} éditeur : retiré du superset')
        R.check(not page.errors, f'{t} éditeur : erreurs JS {page.errors}')


if __name__ == '__main__':
    run_main(R, [t_seance, t_editeur])
