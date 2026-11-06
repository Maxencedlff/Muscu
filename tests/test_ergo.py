"""Ergonomie (audit du 05/11/2026) : objectif du jour en séance, reps en réserve, Progrès (4 semaines,
derniers records, invitation), bilan (ligne de progrès, « Terminé » toujours visible), ligne « Ensuite »,
pastille des records dans l'historique, roue des Réglages, feuille « Ajouter un exercice » (Récents).

Lancer : PPL_URL=http://localhost:8767/ python3 tests/test_ergo.py (ou run_all.py ergo).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'ergo'
R = Results(LOT)


def tag(dev, theme):
    return f'{dev}-{theme}'


def skip_rest(page):
    for sel in ('.rest-overlay [data-action="skip-rest"]', '.rest-mini__skip'):
        if page.locator(sel).count():
            page.locator(sel).first.click()
            break
    page.wait_for_timeout(120)


def in_view(page, sel):
    return page.evaluate("""s => { const e = document.querySelector(s); if (!e) return false;
        const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; }""", sel)


def t_seance(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        # Roue des Réglages : la même sur l'accueil et sur Programme
        R.check(page.locator('.dashboard .navbar [data-action="go-settings"] .icon--gear').count() == 1, f'{t} accueil : roue des Réglages')
        target = page.locator('.targets__row').first.locator('.targets__target').inner_text()
        page.click('[data-action="start-session"][data-cat="push"]')
        page.wait_for_selector('.view.session')

        # 1. Objectif sous le nom, le même texte que l'accueil
        goal = page.locator('.ex-card[data-ei="0"] .ex-goal')
        R.check(goal.count() == 1 and goal.inner_text().strip() == f'Objectif {target}', f'{t} objectif en séance = accueil ({goal.inner_text() if goal.count() else None!r} / {target!r})')
        fs = page.evaluate("parseFloat(getComputedStyle(document.querySelector('.ex-goal')).fontSize)")
        R.check(fs >= 12, f'{t} objectif : police {fs}px')
        # Série qui le bat : « Objectif atteint »
        r = page.locator('[data-action="set-reps"][data-ei="0"][data-si="0"]')
        r.fill(str(int(r.input_value() or r.get_attribute('placeholder')) + 1))
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); page.wait_for_timeout(300)
        R.check(page.locator('.ex-card[data-ei="0"] .ex-goal--done').inner_text().strip() == 'Objectif atteint', f'{t} objectif atteint')
        # 5. Volume en clair
        d = page.locator('.ex-card[data-ei="0"] .ex-vol__delta')
        R.check(d.count() == 1 and d.inner_text().endswith('de volume'), f'{t} « +… de volume »')
        # 11. Ligne « Ensuite » : la série jamais coupée
        if page.locator('.rest-mini__next').count():
            ok = page.evaluate("""(() => { const n = document.querySelector('.rest-mini__next'), t = n.querySelector('.rest-mini__tail');
                return t.getBoundingClientRect().right <= n.getBoundingClientRect().right + 1 && t.scrollWidth <= t.clientWidth + 1; })()""")
            R.check(ok, f'{t} « Ensuite » : série entière')
        skip_rest(page)
        # 2. Reps en réserve (donnée existante : sélecteur montré), pastilles 44 × 44, libellé en clair
        R.check(page.locator('.rir__lbl').inner_text().strip() == 'Reps en réserve', f'{t} libellé « Reps en réserve »')
        sizes = page.evaluate("[...document.querySelectorAll('.rir__btn')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })")
        R.check(len(sizes) == 5 and all(w >= 44 and h >= 44 for w, h in sizes), f'{t} pastilles 44 × 44 {sizes}')
        R.check(page.evaluate("(() => { const r = document.querySelector('.rir').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()"), f'{t} sélecteur dans l\'écran')
        # 11. En-têtes de colonnes à 12 px au moins
        small = page.evaluate("[...document.querySelectorAll('.sets__head')].map(e => parseFloat(getComputedStyle(e).fontSize)).filter(s => s < 12)")
        R.check(not small, f'{t} en-têtes de colonnes ≥ 12 px {small}')

        # B. Feuille « Ajouter un exercice » : Récents en tête, sans les exercices de la séance
        page.click('[data-action="add-session-ex"]'); page.wait_for_selector('#axSearch'); page.wait_for_timeout(350)
        hints = page.locator('#axList .ax__hint').all_inner_texts()
        R.check(hints[:2] == ['Récents', 'Mêmes muscles que ta séance'], f'{t} sections {hints}')
        first = page.locator('#axList .ax__item').first.get_attribute('data-name')
        R.check(first == 'Squat barre', f'{t} 1er récent : le dernier exercice fait ({first})')
        push = page.evaluate("activeSession.exercises.map(e => e.name)")
        R.check(not any(page.locator(f'#axList [data-name="{n}"]').count() for n in push), f'{t} exercices de la séance absents')
        hs = page.evaluate("[document.querySelector('#axSearch'), ...document.querySelectorAll('.ax__chip, .ax-stepper button')].map(e => Math.round(e.getBoundingClientRect().height)).filter(h => h < 44)")
        R.check(not hs, f'{t} recherche, puces et ± à 44 px {hs}')
        rows = page.evaluate("[...document.querySelectorAll('.sess-sheet--addex .ax__equip, .sess-sheet--addex .mf__row')].map(r => r.scrollHeight <= 50)")
        R.check(rows and all(rows), f'{t} filtres sur une ligne chacun {rows}')
        # Deux touchers : ouvrir la feuille, toucher l'exercice récent
        R.check(in_view(page, '#axList [data-name="Squat barre"]'), f'{t} récent visible sans défiler')
        page.locator('#axList [data-name="Squat barre"]').click(); page.wait_for_timeout(350)
        R.check(page.evaluate("activeSession.exercises.at(-1).name") == 'Squat barre', f'{t} ajouté en 2 touchers')
        # Recherche : liste directe, sans sections
        page.click('[data-action="add-session-ex"]'); page.wait_for_selector('#axSearch'); page.wait_for_timeout(300)
        page.fill('#axSearch', 'curl')
        R.check(page.locator('#axList .ax__hint', has_text='Récents').count() == 0, f'{t} recherche : liste directe')
        page.evaluate('closeSessSheets()'); page.wait_for_timeout(300)

        # 4. Bilan : ligne de progrès, « Terminé » visible sans défiler
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(300)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary'); page.wait_for_timeout(500)
        line = page.locator('.sum-line').inner_text().strip()
        R.check(line.startswith('1 record battu · +1 rep sur développé couché'), f'{t} ligne du bilan ({line!r})')
        R.check(page.locator('.sum-line .medal').count() == 1, f'{t} médaille du record')
        R.check(in_view(page, '.sum-done'), f'{t} « Terminé » visible sans défiler')
        shot(page, LOT, f'bilan-{t}')
        page.click('[data-action="summary-done"]'); page.wait_for_timeout(300)

        # 11. Historique : pastille des records notés
        page.evaluate("switchTab('history')"); page.wait_for_timeout(300)
        rec = page.locator('.hrow').first.locator('.hcell__rec')
        R.check(rec.count() == 1 and rec.inner_text().split(',')[0].strip().startswith('1'), f'{t} pastille record dans l\'historique')

        # 3. Progrès : derniers records en tête, 4 semaines par défaut
        page.evaluate("switchTab('progress')"); page.wait_for_timeout(400)
        R.check(page.locator('.stats-records .rec-row').count() == 3, f'{t} 3 derniers records')
        R.check(page.locator('.scr > .group-title').first.inner_text().strip().lower() == 'derniers records', f'{t} carte en tête')
        R.check(page.locator('[data-action="muscle-span"][data-span="month"]').get_attribute('aria-pressed') == 'true', f'{t} 4 semaines par défaut')

        # A. Programme : la même roue que l'accueil
        page.evaluate("switchTab('program')"); page.wait_for_timeout(300)
        R.check(page.locator('.navbar [data-action="go-settings"] .icon--gear').count() == 1
                and page.locator('.navbar [data-action="go-settings"]').inner_text().strip() == '', f'{t} Programme : la roue, pas le mot')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_nouveau(bench):
    """Nouvel utilisateur : reps en réserve non demandées ; réglage existant intact (tests/test_seance_outils.py)."""
    with bench.page('webkit', 'iPhone 13', 'light') as page:
        seed(page, 'light', None)
        skip_questions(page)
        R.check(page.evaluate('data.rirOn') is False, 'nouvel utilisateur : reps en réserve coupées')
        page.click('[data-action="start-session"]'); page.wait_for_selector('.view.session')
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); page.wait_for_timeout(300)
        R.check(page.locator('.rir').count() == 0, 'nouvel utilisateur : pas de sélecteur après la série')


run_main(R, [t_seance], once=[t_nouveau])
