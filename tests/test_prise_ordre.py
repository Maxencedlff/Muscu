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
    settle(page)


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
        settle(page)
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
        settle(page)
        R.check('Prise en pronation' in page.locator('.sess-sheet--grip .grip__now').inner_text(), f'{t} feuille : phrase suivie')
        R.check(not small(page, '.sess-sheet--grip button'), f'{t} feuille : boutons de 44 px {small(page, ".sess-sheet--grip button")}')
        shot(page, LOT, f'{t}-4-feuille-prise')
        page.click('.sess-sheet--grip [data-action="sheet-done"]')
        settle(page)
        R.check('Prise en pronation' in page.locator('.ex-card[data-ei="1"] .ex-grip').inner_text(), f'{t} séance : carte à jour')
        R.check(pull_prog(page)[1].get('grip') == {'hand': 'pronation'}, f'{t} séance : programme suivi (la prochaine fois)')
        # Menu ⋯ : « Prise » pour le tirage, pas pour le curl marteau
        page.click('.ex-card__more[data-ei="4"]')
        settle(page)
        R.check(page.locator('.ios-dialog__btn', has_text='Prise').count() == 0, f'{t} menu : pas de Prise au curl marteau')
        tap_dialog(page, 'Annuler')
        # La dernière fois (vraie séance de l'historique), autre prise : rappelée sous la ligne
        before = page.locator('.ex-card[data-ei="1"] .ex-grip__before')
        R.check(before.count() == 1 and before.inner_text() == 'Avant : prise en supination', f'{t} séance : « Avant » de la prise')
        # Reprise après fermeture puis enregistrement : la prise suit l'historique
        page.click('[data-action="validate-set"][data-ei="1"][data-si="0"]')
        settle(page)
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
    settle(page)
    tap_dialog(page, label)
    settle(page)


def t_ordre(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.evaluate("startSession('pull')")
        page.wait_for_selector('.view.session')
        start = names(page)
        R.check(page.locator('[data-action="ex-later"]').count() == 1, f'{t} « Plus tard » seulement sur l\'exercice en cours')
        R.check(page.locator('.ex-card[data-ei="0"] [data-action="ex-later"]').inner_text().strip() == 'Plus tard', f'{t} libellé « Plus tard »')
        R.check(page.locator('[data-action="ex-later"] .icon--arrow-turn-down-right').count() == 1 and page.locator('[data-action="ex-later"] .icon--chevron-down').count() == 0,
                f'{t} « Plus tard » : flèche qui tourne, pas le chevron de « Réduire la séance »')
        # Retour du 10/11 : « Faire maintenant » introuvable dans ⋯ ; un mot au pied de chaque autre exercice à faire
        R.check(page.locator('[data-action="ex-now"]').count() == len(start) - 1 and page.locator('.ex-card[data-ei="0"] [data-action="ex-now"]').count() == 0,
                f'{t} « Faire maintenant » au pied des autres exercices ({page.locator("[data-action=ex-now]").count()})')
        R.check(not small(page, '.order-link'), f'{t} bouton de 44 px {small(page, ".order-link")}')
        R.check(no_hscroll(page), f'{t} pas de défilement de côté')
        shot(page, LOT, f'{t}-6-ordre-bouton')

        # Menu ⋯ › Faire maintenant : le 4e passe avant l'exercice en cours et devient celui en cours
        page.click('.ex-card__more[data-ei="3"]')
        settle(page)
        first = page.locator('.ios-dialog__btn').first.inner_text().strip()
        now = page.evaluate("(() => { const b = [...document.querySelectorAll('.ios-dialog__btn')].find(x => x.textContent.trim() === 'Faire maintenant'); if (!b) return null; const r = b.getBoundingClientRect(), g = b.closest('.ios-dialog__group').getBoundingClientRect(); return r.top >= g.top && r.bottom <= g.bottom; })()")
        R.check(first == "Remplacer l'exercice" and now, f'{t} menu : « {first} » en tête, « Faire maintenant » visible sans défiler ({now})')
        top = page.evaluate("document.querySelector('.ios-dialog__btn').getBoundingClientRect().top")
        R.check(top >= 0, f'{t} menu : premier choix visible, pas coupé en haut ({top})')
        # Panel du 07/11 (iPhone SE) : dernier choix coupé à mi-hauteur sans indice ; le bas s'estompe tant qu'il en reste
        fade = page.evaluate("""(() => { const g = document.querySelector('.ios-dialog__group');
            return [g.scrollHeight - g.clientHeight > 2, g.classList.contains('ios-dialog__group--more')]; })()""")
        R.check(fade[0] == fade[1], f'{t} menu : bas estompé seulement s\'il reste des choix sous le pli {fade}')
        shot(page, LOT, f'{t}-7-ordre-menu')
        if fade[0]:
            page.evaluate("(g => { g.scrollTop = g.scrollHeight; })(document.querySelector('.ios-dialog__group'))"); settle(page)
            end = page.evaluate("""(() => { const g = document.querySelector('.ios-dialog__group'), b = [...g.querySelectorAll('.ios-dialog__btn')].at(-1).getBoundingClientRect();
                return [!g.classList.contains('ios-dialog__group--more'), b.bottom <= g.getBoundingClientRect().bottom + 1]; })()""")
            R.check(end == [True, True], f'{t} menu : en bas, dernier choix entier et plus d\'estompe {end}')
            shot(page, LOT, f'{t}-7b-ordre-menu-bas')
            page.evaluate("(g => { g.scrollTop = 0; })(document.querySelector('.ios-dialog__group'))"); settle(page)
        tap_dialog(page, 'Faire maintenant')
        settle(page)
        R.check(names(page) == [start[3], start[0], start[1], start[2], start[4]], f'{t} maintenant : ordre {names(page)}')
        sess_undo(page)
        R.check(names(page) == start, f'{t} Annuler : ordre d\'avant')
        # Même chose d'un toucher, au pied de la carte
        page.locator('.ex-card[data-ei="3"] [data-action="ex-now"]').scroll_into_view_if_needed()
        lbl = page.locator('.ex-card[data-ei="3"] [data-action="ex-now"]').get_attribute('aria-label')
        R.check(lbl.startswith(f'Faire maintenant : {start[3]}'), f'{t} pied de carte : annoncé « {lbl} »')
        page.click('.ex-card[data-ei="3"] [data-action="ex-now"]')
        settle(page)
        R.check(names(page) == [start[3], start[0], start[1], start[2], start[4]], f'{t} maintenant (pied de carte) : ordre {names(page)}')
        R.check(cur_name(page) == start[3] and current(page) == [0, 0], f'{t} maintenant : série en cours suivie ({cur_name(page)})')
        R.check('Mis en cours' in sess_undo_text(page), f'{t} maintenant : ligne « Mis en cours · Annuler »')
        R.check(page.evaluate("(r => r && r.top > 60 && r.bottom < innerHeight)(document.querySelector('.session-set--current')?.getBoundingClientRect())"), f'{t} maintenant : série en cours visible')
        sess_undo(page)
        R.check(names(page) == start and cur_name(page) == start[0], f'{t} Annuler : ordre d\'avant')

        # Une série faite, puis Plus tard : l'exercice passe en dernier avec sa série validée, le suivant prend la main
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]')
        settle(page)
        skip_rest(page)
        page.click('.ex-card[data-ei="0"] [data-action="ex-later"]')
        settle(page)
        R.check(names(page) == start[1:] + [start[0]], f'{t} plus tard : en dernier {names(page)}')
        R.check(cur_name(page) == start[1], f'{t} plus tard : le suivant est en cours ({cur_name(page)})')
        R.check(sess_undo_text(page) == f'{start[0]} mis en dernier', f'{t} plus tard : ligne « <nom> mis en dernier · Annuler »')
        settle(page)   # défilement doux vers le suivant
        R.check(page.evaluate("""() => { const u = document.querySelector('.ex-undo'), bar = document.querySelector('#app .navbar');
            const r = u && u.getBoundingClientRect(); return !!r && r.top >= (bar ? bar.getBoundingClientRect().bottom : 0) - 1 && r.bottom <= innerHeight; }"""),
            f'{t} plus tard : la ligne reste à l\'écran, au-dessus du suivant')
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
        settle(page)
        skip_rest(page)
        page.click('[data-action="validate-set"][data-ei="0"][data-si="1"]')
        settle(page)
        R.check(page.locator('.session-set--subcur').count() == 1, f'{t} drop set en attente sous la série 2')
        page.click('.ex-card[data-ei="0"] [data-action="ex-later"]')
        settle(page)
        R.check(names(page) == start[1:] + [start[0]] and cur_name(page) == start[1], f'{t} plus tard (drop en attente) : {start[1]} en cours ({cur_name(page)})')
        R.check(page.evaluate('activeSession.lastDone') is None and page.locator('.session-set--subcur').count() == 0, f'{t} plus tard : le drop repoussé n\'est plus « à faire »')
        vis = page.evaluate("""() => { const r = document.querySelector('.session-set--current')?.getBoundingClientRect();
            return !!r && r.top > 60 && r.bottom < innerHeight && document.querySelector('.session-set--current').closest('.ex-card').dataset.ei === '0'; }""")
        R.check(vis, f'{t} plus tard : la série en cours est à l\'écran')
        R.check(page.evaluate("activeSession.exercises.at(-1).sets[1].sub.length === 1"), f'{t} plus tard : le drop reste à remplir')
        shot(page, LOT, f'{t}-10-ordre-plus-tard-drop')
        sess_undo(page)
        settle(page)
        R.check(names(page) == start and page.locator('.session-set--subcur').count() == 1, f'{t} Annuler : ordre et drop en attente rendus')
        R.check(not page.errors, f'{t} erreurs JS {page.errors}')


def finish(page):
    page.click('[data-action="finish-session"]'); settle(page)
    tap_dialog(page, 'Enregistrer la séance')
    page.wait_for_selector('.view.summary'); settle(page)


def t_ajout_ordre(bench, eng, dev, theme):
    """Retour du 10/11 : exercice ajouté en séance « Ensuite » (pas à la fin), retenu au programme ; ordre changé gardé
    pour la prochaine fois depuis le bilan (« Garder cet ordre »)."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.evaluate("startSession('pull')")
        page.wait_for_selector('.view.session')
        start = names(page)
        n0 = len(page.evaluate("activeSession.exercises[0].sets"))
        for si in range(n0):
            page.click(f'[data-action="validate-set"][data-ei="0"][data-si="{si}"]'); settle(page)
            skip_rest(page)
        # Premier exercice fini : « Ensuite » par défaut, juste avant le 2e (il devient le deuxième)
        page.click('[data-action="add-session-ex"]'); page.wait_for_selector('#axSearch'); settle(page)
        place = page.evaluate("[...document.querySelectorAll('[data-action=ax-place]')].map(b => [b.textContent.trim(), b.getAttribute('aria-pressed'), b.getAttribute('aria-label')])")
        R.check([p[:2] for p in place] == [['Ensuite', 'true'], ['À la fin', 'false']], f'{t} ajout : Ensuite par défaut {place}')
        R.check(place and place[0][2] == f'Ensuite, juste avant {start[1]}', f'{t} ajout : VoiceOver dit où ({place[0][2] if place else ""})')
        R.check(not small(page, '[data-action="ax-place"]'), f'{t} ajout : choix de 44 px {small(page, "[data-action=ax-place]")}')
        R.check(no_hscroll(page), f'{t} ajout : pas de défilement de côté')
        shot(page, LOT, f'{t}-11-ajout-ensuite')
        prog0 = [e['name'] for e in pull_prog(page)]
        page.click('#axToProg')
        page.fill('#axSearch', 'Face pull')
        page.locator('#axList .ax__item', has_text='Face pull').first.click(); settle(page)
        added = page.evaluate("activeSession.exercises[1].name")
        R.check(names(page)[0] == start[0] and added.startswith('Face pull') and names(page)[2:] == start[1:], f'{t} ajout : en 2e position {names(page)}')
        R.check(cur_name(page) == added, f'{t} ajout : c\'est lui qui suit ({cur_name(page)})')
        prog = [e['name'] for e in pull_prog(page)]
        R.check(prog[1] == added, f'{t} ajout : 2e aussi dans le programme (la prochaine fois) {prog}')
        shot(page, LOT, f'{t}-12-ajout-place')
        sess_undo(page)
        R.check(names(page) == start and [e['name'] for e in pull_prog(page)] == prog0, f'{t} Annuler : retiré de la séance et du programme')

        # « À la fin » : comme avant
        page.click('[data-action="add-session-ex"]'); page.wait_for_selector('#axSearch'); settle(page)
        page.click('[data-action="ax-place"][data-place="end"]')
        R.check(page.locator('[data-action="ax-place"][data-place="end"]').get_attribute('aria-pressed') == 'true', f'{t} « À la fin » choisi')
        page.fill('#axSearch', 'Face pull')
        page.locator('#axList .ax__item', has_text='Face pull').first.click(); settle(page)
        R.check(names(page)[:-1] == start and names(page)[-1].startswith('Face pull'), f'{t} à la fin {names(page)}')
        sess_undo(page)

        # Faire maintenant sur le 4e, une série de chaque, puis bilan : « Garder cet ordre » met le 4e en 2e au programme
        page.locator('.ex-card[data-ei="3"] [data-action="ex-now"]').click(); settle(page)
        page.click('[data-action="validate-set"][data-ei="1"][data-si="0"]'); settle(page)
        skip_rest(page)
        finish(page)
        row = page.locator('[data-action="summary-keep-order"]')
        R.check(row.count() == 1, f'{t} bilan : « Garder cet ordre » proposé')
        R.check(not small(page, '[data-action="summary-keep-order"]'), f'{t} bilan : ligne de 44 px')
        row.scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-13-bilan-garder-ordre')
        before = [e['name'] for e in pull_prog(page)]
        row.click(); settle(page)
        after = [e['name'] for e in pull_prog(page)]
        R.check(after == [start[0], start[3], start[1], start[2]] + start[4:], f'{t} bilan : programme dans l\'ordre fait {after} (avant {before})')
        R.check('Ordre gardé' in page.locator('#sumOrder').inner_text() and page.evaluate("document.activeElement?.id") == 'sumOrder', f'{t} bilan : « Ordre gardé », focus pour VoiceOver')
        page.click('[data-action="summary-done"]'); settle(page)
        page.evaluate("startSession('pull')")
        page.wait_for_selector('.view.session')
        R.check(names(page)[:2] == [start[0], start[3]], f'{t} séance suivante : le nouvel ordre {names(page)[:3]}')
        page.evaluate("endSession()")
        R.check(not page.errors, f'{t} erreurs JS {page.errors}')


if __name__ == '__main__':
    run_main(R, [t_prise, t_ordre, t_ordre_sous_serie, t_ajout_ordre])
