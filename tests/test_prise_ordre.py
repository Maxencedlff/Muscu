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


def data_with_past_grip():
    """Données de démo où la dernière séance Pull a fait le tirage vertical en pronation."""
    d = ppl_v2_today()
    h = next(x for x in d['history'] if x['id'] == 'hpu08')
    next(e for e in h['exercises'] if e['name'] == 'Tirage vertical prise large')['grip'] = {'hand': 'supination'}
    return json.dumps(d, ensure_ascii=False)


def t_prise(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, data_with_past_grip())
        # Programme › Exercice : « Tirage vertical prise large » → sens des mains seulement : ni la largeur (dans le nom),
        # ni ce qui la contredit (neutre, triangle, deux poignées : panel du 07/11)
        page.evaluate("navigate('editor:pull')")
        page.wait_for_selector('[data-action="edit-ex"][data-i="1"]')
        page.click('[data-action="edit-ex"][data-i="1"]')
        page.wait_for_selector('#exGrip .grip__chip')
        dims = page.evaluate("[...new Set([...document.querySelectorAll('#exGrip .grip__chip')].map(b => b.dataset.dim))]")
        R.check(dims == ['hand'], f'{t} éditeur : sens des mains seulement {dims}')
        hands = page.evaluate("[...document.querySelectorAll('#exGrip .grip__chip')].map(b => b.dataset.v)")
        R.check(hands == ['pronation', 'supination'], f'{t} éditeur : jamais « Neutre » sur une prise large {hands}')
        page.click('#exGrip [data-dim="hand"][data-v="pronation"]')
        page.click('#exGrip [data-dim="hand"][data-v="pronation"]')   # retouché : retiré
        R.check(page.locator('#exGrip [aria-pressed="true"]').count() == 0, f'{t} éditeur : second toucher retire le choix')
        page.click('#exGrip [data-dim="hand"][data-v="supination"]')
        foot = page.locator('#exGrip .group-foot').inner_text()
        R.check(foot.startswith('Prise en supination'), f'{t} éditeur : phrase « {foot[:40]} »')
        R.check(not small(page, '#exGrip .grip__chip'), f'{t} éditeur : pastilles de 44 px {small(page, "#exGrip .grip__chip")}')
        R.check(no_hscroll(page), f'{t} éditeur : pas de défilement de côté')
        page.locator('#exGrip').scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-1-editeur-prise')
        page.click('[data-action="save-ex"]')
        page.wait_for_timeout(500)
        R.check(pull_prog(page)[1].get('grip') == {'hand': 'supination'}, f'{t} éditeur : enregistrée {pull_prog(page)[1].get("grip")}')
        sub = page.locator('.ed-row[data-i="1"] .grip-sub').inner_text()
        R.check(sub == 'Prise en supination', f'{t} Programme › Séance : « {sub} »')
        R.check(page.locator('.ed-row[data-i="0"] .grip-sub').count() == 0, f'{t} sans prise : rien sous le nom')
        shot(page, LOT, f'{t}-2-seance-programme')

        # Séance : ligne sous le nom, puis feuille « Prise » au toucher
        page.evaluate("startSession('pull')")
        page.wait_for_selector('.view.session')
        line = page.locator('.ex-card[data-ei="1"] .ex-grip')
        R.check(line.count() == 1 and 'Prise en supination' in line.inner_text(), f'{t} séance : prise sous le nom')
        R.check(page.locator('.ex-card[data-ei="0"] .ex-grip').count() == 0, f'{t} séance : rien sans prise')
        R.check(page.locator('.ex-grip__photo').count() == 0, f'{t} séance : aucune photo vide')
        line.scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-3-seance-prise')
        line.click()
        page.wait_for_selector('.sess-sheet--grip .grip__chip')
        page.click('.sess-sheet--grip [data-dim="hand"][data-v="pronation"]')
        page.wait_for_timeout(150)
        R.check('Prise en pronation' in page.locator('.sess-sheet--grip .grip__now').inner_text(), f'{t} feuille : phrase suivie')
        R.check(not small(page, '.sess-sheet--grip button'), f'{t} feuille : boutons de 44 px {small(page, ".sess-sheet--grip button")}')
        shot(page, LOT, f'{t}-4-feuille-prise')
        page.click('.sess-sheet--grip [data-action="sheet-done"]')
        page.wait_for_timeout(400)
        R.check('Prise en pronation' in page.locator('.ex-card[data-ei="1"] .ex-grip').inner_text(), f'{t} séance : carte à jour')
        R.check(pull_prog(page)[1].get('grip') == {'hand': 'pronation'}, f'{t} séance : programme suivi (la prochaine fois)')
        # Menu ⋯ : « Prise » pour le tirage, pas pour le curl marteau
        page.click('.ex-card__more[data-ei="4"]')
        page.wait_for_timeout(300)
        R.check(page.locator('.ios-dialog__btn', has_text='Prise').count() == 0, f'{t} menu : pas de Prise au curl marteau')
        tap_dialog(page, 'Annuler')
        # La dernière fois (vraie séance de l'historique), autre prise : rappelée sous la ligne
        before = page.locator('.ex-card[data-ei="1"] .ex-grip__before')
        R.check(before.count() == 1 and before.inner_text() == 'Avant : prise en supination', f'{t} séance : « Avant » de la prise')
        # Reprise après fermeture puis enregistrement : la prise suit l'historique
        page.click('[data-action="validate-set"][data-ei="1"][data-si="0"]')
        page.wait_for_timeout(300)
        page.reload()
        page.wait_for_selector('#app > *')
        page.evaluate("navigate('session')")
        page.wait_for_selector('.view.session')
        R.check('Prise en pronation' in page.locator('.ex-card[data-ei="1"] .ex-grip').inner_text(), f'{t} reprise : prise gardée')
        g = page.evaluate("sessionHistoryEntry(activeSession.programme, activeSession.category).exercises.find(e => e.name.startsWith('Tirage vertical'))?.grip")
        R.check(g == {'hand': 'pronation'}, f'{t} historique : prise enregistrée {g}')
        R.check(no_hscroll(page), f'{t} séance : pas de défilement de côté')
        # Historique › Séance : la prise faite ce jour-là sous le nom
        page.evaluate("endSession()")
        page.evaluate("navigate(makeRoute('history-detail', 'hpu08'))")
        page.wait_for_selector('.hex')
        cell = page.locator('.hex', has_text='Tirage vertical prise large')
        R.check('Prise en supination' in cell.inner_text(), f'{t} historique : prise affichée')
        cell.scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-5-historique')
        # Séance passée modifiée (les champs de l'écran ne portent pas la prise) : la prise est gardée
        g = page.evaluate("""(() => {
            const h = data.history.find(x => x.id === 'hpu08');
            editSessionId = h.id; addProg = 'ppl'; addCat = 'pull'; addDate = localISO(h.date);
            storePastSession(h.exercises.map(e => ({ exId: e.exId, name: e.name, sets: e.sets.map(st => ({ ...st })) })));
            return data.history.find(x => x.id === 'hpu08').exercises.find(e => e.name === 'Tirage vertical prise large').grip;
        })()""")
        R.check(g == {'hand': 'supination'}, f'{t} séance passée modifiée : prise gardée {g}')
        R.check(not page.errors, f'{t} erreurs JS {page.errors}')


def menu_pick(page, ei, label):
    page.click(f'.ex-card__more[data-ei="{ei}"]')
    page.wait_for_timeout(300)
    tap_dialog(page, label)
    page.wait_for_timeout(400)


def t_ordre(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.evaluate("startSession('pull')")
        page.wait_for_selector('.view.session')
        start = names(page)
        R.check(page.locator('[data-action="ex-later"]').count() == 1, f'{t} « Plus tard » seulement sur l\'exercice en cours')
        R.check(page.locator('.ex-card[data-ei="0"] [data-action="ex-later"]').inner_text().strip() == 'Plus tard', f'{t} libellé « Plus tard »')
        R.check(page.locator('[data-action="ex-later"] .icon--arrow-down-to-line').count() == 1 and page.locator('[data-action="ex-later"] .icon--chevron-down').count() == 0,
                f'{t} « Plus tard » : flèche vers la ligne, pas le chevron de « Réduire la séance »')
        R.check(page.locator('[data-action="ex-now"]').count() == 0, f'{t} pas de « Faire maintenant » en bas des cartes')
        R.check(not small(page, '.order-link'), f'{t} bouton de 44 px {small(page, ".order-link")}')
        R.check(no_hscroll(page), f'{t} pas de défilement de côté')
        shot(page, LOT, f'{t}-6-ordre-bouton')

        # Menu ⋯ › Faire maintenant : le 4e passe avant l'exercice en cours et devient celui en cours
        page.click('.ex-card__more[data-ei="3"]')
        page.wait_for_timeout(300)
        first = page.locator('.ios-dialog__btn').first.inner_text().strip()
        R.check(first == 'Faire maintenant', f'{t} menu : « {first} » en tête')
        top = page.evaluate("document.querySelector('.ios-dialog__btn').getBoundingClientRect().top")
        R.check(top >= 0, f'{t} menu : premier choix visible, pas coupé en haut ({top})')
        shot(page, LOT, f'{t}-7-ordre-menu')
        tap_dialog(page, 'Faire maintenant')
        page.wait_for_timeout(400)
        R.check(names(page) == [start[3], start[0], start[1], start[2], start[4]], f'{t} maintenant : ordre {names(page)}')
        R.check(cur_name(page) == start[3] and current(page) == [0, 0], f'{t} maintenant : série en cours suivie ({cur_name(page)})')
        R.check('Mis en cours' in page.locator('.toast').last.inner_text(), f'{t} maintenant : message')
        R.check(page.evaluate("(r => r && r.top > 60 && r.bottom < innerHeight)(document.querySelector('.session-set--current')?.getBoundingClientRect())"), f'{t} maintenant : série en cours visible')
        page.locator('.toast button', has_text='Annuler').last.click()
        page.wait_for_timeout(300)
        R.check(names(page) == start and cur_name(page) == start[0], f'{t} Annuler : ordre d\'avant')

        # Une série faite, puis Plus tard : l'exercice passe en dernier avec sa série validée, le suivant prend la main
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]')
        page.wait_for_timeout(300)
        skip_rest(page)
        page.click('.ex-card[data-ei="0"] [data-action="ex-later"]')
        page.wait_for_timeout(400)
        R.check(names(page) == start[1:] + [start[0]], f'{t} plus tard : en dernier {names(page)}')
        R.check(cur_name(page) == start[1], f'{t} plus tard : le suivant est en cours ({cur_name(page)})')
        R.check(page.locator('.toast').last.inner_text().startswith('Mis en dernier'), f'{t} plus tard : message')
        R.check(page.evaluate('activeSession.exercises.at(-1).sets[0].done'), f'{t} plus tard : série validée gardée')
        shot(page, LOT, f'{t}-8-ordre-plus-tard')

        # Superset déjà commencé : « Faire maintenant » reprend le membre le moins avancé, le tour n'est pas cassé
        page.evaluate("activeSession.exercises[2].ss = 'g'; activeSession.exercises[3].ss = 'g'; activeSession.exercises[2].sets[0].done = true; persistSession(); render()")
        sup = [names(page)[2], names(page)[3]]
        later = page.locator('.ss-card [data-action="ex-later"]')
        R.check(later.count() == 0, f'{t} superset pas en cours : pas de bouton')
        menu_pick(page, 3, 'Faire maintenant')
        xs = page.evaluate('activeSession.exercises.map(e => [e.name, e.ss || null])')
        R.check([x[0] for x in xs[:2]] == sup and xs[0][1] == 'g' and xs[1][1] == 'g', f'{t} superset : en tête, entier {xs}')
        R.check(cur_name(page) == sup[1], f'{t} superset commencé : 2e membre en cours ({cur_name(page)})')
        lbl = page.locator('.ss-card [data-action="ex-later"]').get_attribute('aria-label')
        R.check(sup[0] in lbl and sup[1] in lbl, f'{t} superset : bouton annoncé avec ses membres « {lbl} »')
        shot(page, LOT, f'{t}-9-ordre-superset')

        # Fermeture de l'app : ordre et série en cours gardés
        page.reload()
        page.wait_for_selector('#app > *')
        page.evaluate("navigate('session')")
        page.wait_for_selector('.view.session')
        R.check([x[0] for x in page.evaluate('activeSession.exercises.map(e => [e.name])')] == [x[0] for x in xs], f'{t} reprise : ordre gardé')
        R.check(cur_name(page) == sup[1], f'{t} reprise : série en cours gardée')
        R.check(not page.errors, f'{t} erreurs JS {page.errors}')


def t_ordre_sous_serie(bench, eng, dev, theme):
    """Plus tard pendant un drop set en attente : l'écran suit l'exercice qui prend la main, pas celui repoussé."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.evaluate("startSession('pull')")
        page.wait_for_selector('.view.session')
        start = names(page)
        page.evaluate("activeSession.exercises.forEach(ex => ex.sets.forEach(s => { s.weight ||= '20'; s.reps ||= '10'; })); setTechOn(0, 1, 'drop')")
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]')
        page.wait_for_timeout(300)
        skip_rest(page)
        page.click('[data-action="validate-set"][data-ei="0"][data-si="1"]')
        page.wait_for_timeout(300)
        R.check(page.locator('.session-set--subcur').count() == 1, f'{t} drop set en attente sous la série 2')
        page.click('.ex-card[data-ei="0"] [data-action="ex-later"]')
        page.wait_for_timeout(900)
        R.check(names(page) == start[1:] + [start[0]] and cur_name(page) == start[1], f'{t} plus tard (drop en attente) : {start[1]} en cours ({cur_name(page)})')
        R.check(page.evaluate('activeSession.lastDone') is None and page.locator('.session-set--subcur').count() == 0, f'{t} plus tard : le drop repoussé n\'est plus « à faire »')
        vis = page.evaluate("""() => { const r = document.querySelector('.session-set--current')?.getBoundingClientRect();
            return !!r && r.top > 60 && r.bottom < innerHeight && document.querySelector('.session-set--current').closest('.ex-card').dataset.ei === '0'; }""")
        R.check(vis, f'{t} plus tard : la série en cours est à l\'écran')
        R.check(page.evaluate("activeSession.exercises.at(-1).sets[1].sub.length === 1"), f'{t} plus tard : le drop reste à remplir')
        shot(page, LOT, f'{t}-10-ordre-plus-tard-drop')
        page.locator('.toast button', has_text='Annuler').last.click()
        page.wait_for_timeout(500)
        R.check(names(page) == start and page.locator('.session-set--subcur').count() == 1, f'{t} Annuler : ordre et drop en attente rendus')
        R.check(not page.errors, f'{t} erreurs JS {page.errors}')


if __name__ == '__main__':
    run_main(R, [t_prise, t_ordre, t_ordre_sous_serie])
