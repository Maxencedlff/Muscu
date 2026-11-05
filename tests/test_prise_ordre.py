"""Prise d'un exercice (Programme › Exercice, séance, historique) et ordre de la séance (Faire maintenant,
Plus tard, superset déplacé en entier, Annuler, reprise après fermeture de l'app). Demandes des coachs
partenaires des 03 et 05/11/2026 : docs/PRISES.md.

Captures : $PPL_SCRATCH/shots/lotprise/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_prise_ordre.py (ou sans variable : tous les appareils).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'prise'
R = Results(LOT)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small(page, sel):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def current(page):
    return page.evaluate("(e => e ? [+e.dataset.ei, +e.dataset.si] : null)(document.querySelector('.session-set--current'))")


def cur_name(page):
    return page.evaluate("(c => c ? activeSession.exercises[c.ei].name : null)(currentSet())")


def names(page):
    return page.evaluate('activeSession.exercises.map(e => e.name)')


def pull_prog(page):
    return json.loads(ls(page, 'ppl_v2'))['programmes']['ppl']['exercises']['pull']


def skip_rest(page):
    for sel in ('.rest-overlay [data-action="skip-rest"]', '.rest-mini__skip'):
        loc = page.locator(sel)
        if loc.count() and loc.first.is_visible():
            loc.first.click()
            break
    page.wait_for_timeout(200)


def t_prise(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        # Programme › Exercice : « Tirage vertical prise large » → sens des mains et poignée, pas la largeur
        page.evaluate("navigate('editor:pull')")
        page.wait_for_selector('[data-action="edit-ex"][data-i="1"]')
        page.click('[data-action="edit-ex"][data-i="1"]')
        page.wait_for_selector('#exGrip .grip__chip')
        dims = page.evaluate("[...new Set([...document.querySelectorAll('#exGrip .grip__chip')].map(b => b.dataset.dim))]")
        R.check(dims == ['hand', 'tool'], f'{t} éditeur : sens des mains et poignée seulement {dims}')
        page.click('#exGrip [data-dim="hand"][data-v="pronation"]')
        page.click('#exGrip [data-dim="hand"][data-v="pronation"]')   # retouché : retiré
        R.check(page.locator('#exGrip [aria-pressed="true"]').count() == 0, f'{t} éditeur : second toucher retire le choix')
        page.click('#exGrip [data-dim="hand"][data-v="neutre"]')
        page.click('#exGrip [data-dim="tool"][data-v="poignees"]')
        foot = page.locator('#exGrip .group-foot').inner_text()
        R.check(foot.startswith('Prise neutre · Deux poignées'), f'{t} éditeur : phrase « {foot[:40]} »')
        R.check(not small(page, '#exGrip .grip__chip'), f'{t} éditeur : pastilles de 44 px {small(page, "#exGrip .grip__chip")}')
        R.check(no_hscroll(page), f'{t} éditeur : pas de défilement de côté')
        page.locator('#exGrip').scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-1-editeur-prise')
        page.click('[data-action="save-ex"]')
        page.wait_for_timeout(500)
        R.check(pull_prog(page)[1].get('grip') == {'hand': 'neutre', 'tool': 'poignees'}, f'{t} éditeur : enregistrée {pull_prog(page)[1].get("grip")}')
        sub = page.locator('.ed-row[data-i="1"] .grip-sub').inner_text()
        R.check(sub == 'Prise neutre · Deux poignées', f'{t} Programme › Séance : « {sub} »')
        R.check(page.locator('.ed-row[data-i="0"] .grip-sub').count() == 0, f'{t} sans prise : rien sous le nom')
        shot(page, LOT, f'{t}-2-seance-programme')

        # Séance : ligne sous le nom, puis feuille « Prise » au toucher
        page.evaluate("startSession('pull')")
        page.wait_for_selector('.view.session')
        line = page.locator('.ex-card[data-ei="1"] .ex-grip')
        R.check(line.count() == 1 and 'Prise neutre · Deux poignées' in line.inner_text(), f'{t} séance : prise sous le nom')
        R.check(page.locator('.ex-card[data-ei="0"] .ex-grip').count() == 0, f'{t} séance : rien sans prise')
        R.check(page.locator('.ex-grip__photo').count() == 0, f'{t} séance : aucune photo vide')
        line.scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-3-seance-prise')
        line.click()
        page.wait_for_selector('.sess-sheet--grip .grip__chip')
        page.click('.sess-sheet--grip [data-dim="hand"][data-v="supination"]')
        page.wait_for_timeout(150)
        R.check('Prise en supination · Deux poignées' in page.locator('.sess-sheet--grip .grip__now').inner_text(), f'{t} feuille : phrase suivie')
        R.check(not small(page, '.sess-sheet--grip button'), f'{t} feuille : boutons de 44 px {small(page, ".sess-sheet--grip button")}')
        shot(page, LOT, f'{t}-4-feuille-prise')
        page.click('.sess-sheet--grip [data-action="sheet-done"]')
        page.wait_for_timeout(400)
        R.check('Prise en supination' in page.locator('.ex-card[data-ei="1"] .ex-grip').inner_text(), f'{t} séance : carte à jour')
        R.check(pull_prog(page)[1].get('grip') == {'hand': 'supination', 'tool': 'poignees'}, f'{t} séance : programme suivi (la prochaine fois)')
        # Menu ⋯ : « Prise » pour le tirage, pas pour le curl marteau
        page.click('.ex-card__more[data-ei="4"]')
        page.wait_for_timeout(300)
        R.check(page.locator('.ios-dialog__btn', has_text='Prise').count() == 0, f'{t} menu : pas de Prise au curl marteau')
        tap_dialog(page, 'Annuler')
        # La dernière fois, autre prise : rappelée sous la ligne
        page.evaluate("lastPerf(activeSession.programme, activeSession.category, activeSession.exercises[1]).ex.grip = { hand: 'pronation' }; render()")
        before = page.locator('.ex-card[data-ei="1"] .ex-grip__before')
        R.check(before.count() == 1 and before.inner_text() == 'Avant : prise en pronation', f'{t} séance : « Avant » de la prise')
        # Reprise après fermeture puis enregistrement : la prise suit l'historique
        page.click('[data-action="validate-set"][data-ei="1"][data-si="0"]')
        page.wait_for_timeout(300)
        page.reload()
        page.wait_for_selector('#app > *')
        page.evaluate("navigate('session')")
        page.wait_for_selector('.view.session')
        R.check('Prise en supination' in page.locator('.ex-card[data-ei="1"] .ex-grip').inner_text(), f'{t} reprise : prise gardée')
        g = page.evaluate("sessionHistoryEntry(activeSession.programme, activeSession.category).exercises.find(e => e.name.startsWith('Tirage vertical'))?.grip")
        R.check(g == {'hand': 'supination', 'tool': 'poignees'}, f'{t} historique : prise enregistrée {g}')
        R.check(no_hscroll(page), f'{t} séance : pas de défilement de côté')
        # Historique › Séance : la prise sous le nom
        hid = page.evaluate("""(() => { const h = data.history[0]; h.exercises[0].grip = { hand: 'neutre', width: 'serree' };
            h.exercises[0].name = 'Tirage vertical'; save(); return h.id; })()""")
        page.evaluate("endSession()")
        page.evaluate(f"navigate(makeRoute('history-detail', '{hid}'))")
        page.wait_for_selector('.hex')
        R.check('Prise serrée neutre' in page.locator('.hex').first.inner_text(), f'{t} historique : prise affichée')
        shot(page, LOT, f'{t}-5-historique')
        R.check(not page.errors, f'{t} erreurs JS {page.errors}')


def t_ordre(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.evaluate("startSession('pull')")
        page.wait_for_selector('.view.session')
        start = names(page)
        R.check(page.locator('.ex-card[data-ei="0"] [data-action="ex-later"]').count() == 1, f'{t} « Plus tard » sur l\'exercice en cours')
        R.check(page.locator('[data-action="ex-now"]').count() == len(start) - 1, f'{t} « Faire maintenant » sur les autres')
        R.check(not small(page, '.order-link'), f'{t} boutons de 44 px {small(page, ".order-link")}')
        R.check(no_hscroll(page), f'{t} pas de défilement de côté')
        page.locator('.ex-card[data-ei="3"]').scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-6-ordre-boutons')

        # Faire maintenant : le 4e passe en tête et devient l'exercice en cours, en un toucher
        page.click('.ex-card[data-ei="3"] [data-action="ex-now"]')
        page.wait_for_timeout(400)
        R.check(names(page) == [start[3], start[0], start[1], start[2], start[4]], f'{t} maintenant : ordre {names(page)}')
        R.check(cur_name(page) == start[3] and current(page) == [0, 0], f'{t} maintenant : série en cours suivie ({cur_name(page)})')
        R.check('Exercice avancé' in page.locator('.toast').last.inner_text(), f'{t} maintenant : toast')
        R.check(page.evaluate("(r => r && r.top > 60 && r.bottom < innerHeight)(document.querySelector('.session-set--current')?.getBoundingClientRect())"), f'{t} maintenant : série en cours visible')
        shot(page, LOT, f'{t}-7-ordre-maintenant')
        page.locator('.toast button', has_text='Annuler').last.click()
        page.wait_for_timeout(300)
        R.check(names(page) == start and cur_name(page) == start[0], f'{t} Annuler : ordre d\'avant')

        # Une série faite, puis Plus tard : l'exercice passe en dernier avec sa série validée
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]')
        page.wait_for_timeout(300)
        skip_rest(page)
        page.click('.ex-card[data-ei="0"] [data-action="ex-later"]')
        page.wait_for_timeout(400)
        R.check(names(page) == start[1:] + [start[0]], f'{t} plus tard : en dernier {names(page)}')
        R.check(cur_name(page) == start[1], f'{t} plus tard : le suivant est en cours ({cur_name(page)})')
        R.check(page.evaluate('activeSession.exercises.at(-1).sets[0].done'), f'{t} plus tard : série validée gardée')

        # Superset : déplacé en entier, jamais coupé
        page.evaluate("activeSession.exercises[2].ss = 'g'; activeSession.exercises[3].ss = 'g'; persistSession(); render()")
        sup = [names(page)[2], names(page)[3]]
        R.check(page.locator('.ss-card [data-action="ex-now"]').count() == 1, f'{t} superset : un seul bouton pour le groupe')
        page.click('.ss-card [data-action="ex-now"]')
        page.wait_for_timeout(400)
        xs = page.evaluate('activeSession.exercises.map(e => [e.name, e.ss || null])')
        R.check([x[0] for x in xs[:2]] == sup and xs[0][1] == 'g' and xs[1][1] == 'g', f'{t} superset : en tête, entier {xs}')
        R.check(cur_name(page) == sup[0], f'{t} superset : 1er membre en cours ({cur_name(page)})')
        shot(page, LOT, f'{t}-8-ordre-superset')

        # Fermeture de l'app : ordre et série en cours gardés
        page.reload()
        page.wait_for_selector('#app > *')
        page.evaluate("navigate('session')")
        page.wait_for_selector('.view.session')
        R.check([x[0] for x in page.evaluate('activeSession.exercises.map(e => [e.name])')] == [x[0] for x in xs], f'{t} reprise : ordre gardé')
        R.check(cur_name(page) == sup[0], f'{t} reprise : série en cours gardée')

        # Menu ⋯ : « Faire maintenant » en tête du menu d'un autre exercice
        last = len(xs) - 1
        page.click(f'.ex-card__more[data-ei="{last}"]')
        page.wait_for_timeout(300)
        first = page.locator('.ios-dialog__btn').first.inner_text().strip()
        R.check(first == 'Faire maintenant', f'{t} menu : « {first} » en tête')
        top = page.evaluate("document.querySelector('.ios-dialog__btn').getBoundingClientRect().top")
        R.check(top >= 0, f'{t} menu : premier choix visible, pas coupé en haut ({top})')
        shot(page, LOT, f'{t}-9-ordre-menu')
        tap_dialog(page, 'Faire maintenant')
        page.wait_for_timeout(400)
        R.check(cur_name(page) == xs[last][0], f'{t} menu : exercice en cours ({cur_name(page)})')
        R.check(not page.errors, f'{t} erreurs JS {page.errors}')


if __name__ == '__main__':
    run_main(R, [t_prise, t_ordre])
