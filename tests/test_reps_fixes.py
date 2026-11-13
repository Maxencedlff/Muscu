"""Reps fixes (« 4 × 12 », demande des coachs partenaires, vague 4) : éditeur Fourchette / Fixe, accueil,
séance (reps reprises, ligne de l'exercice, puce de charge, VoiceOver). Côté coach (envoi et aperçu de
l'élève) : test_coach.py.

Captures : $PPL_SCRATCH/shots/lotreps_fixes/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_reps_fixes.py (ou sans variable : tous les appareils).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'reps_fixes'
R = Results(LOT)
NB = ' '


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_ex(page, i=0):
    page.evaluate("r => navigate(r)", 'programmes')
    page.wait_for_selector('.programmes')
    page.click('[data-action="open-prog-session"][data-cat="pull"]')
    page.wait_for_selector('.view.editor')
    page.click(f'.ed-row[data-i="{i}"]')
    page.wait_for_selector('.view.ex-edit')


def t_reps_fixes(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        open_ex(page)
        mode = page.locator('#exProg [data-action="ex-rep-mode"]')
        R.check(mode.count() == 2 and [mode.nth(k).inner_text().strip() for k in range(2)] == ['Fourchette', 'Fixe'], f'{t} éditeur : Fourchette ou Fixe')
        R.check(page.locator('#exProg [data-action="ex-rep-mode"][data-fixed="false"]').get_attribute('aria-pressed') == 'true', f'{t} éditeur : Fourchette par défaut')
        R.check(page.locator('#exProg .segmented').get_attribute('aria-label') == 'Répétitions', f'{t} VoiceOver : groupe « Répétitions »')
        R.check(page.locator('#exRepMin').get_attribute('placeholder') == '8', f'{t} bas vide : 8 indiqué sous un haut de 12')
        box = mode.nth(1).bounding_box()
        R.check(box['height'] >= 32, f'{t} Fixe : hauteur du segment ({box["height"]:.0f})')
        # Un seul tap sur Fixe : un seul champ, le nombre gardé
        mode.nth(1).click()
        page.wait_for_timeout(120)
        R.check(page.locator('#exRepMin').count() == 0 and page.input_value('#exRepMax') == '12', f'{t} Fixe : un seul champ, 12 gardé')
        R.check(page.locator('#exRepMax').get_attribute('aria-label') == 'Reps par série, toujours le même nombre', f'{t} Fixe : champ nommé pour VoiceOver')
        foot = page.locator('#exProg .group-foot').inner_text()
        R.check(f'4{NB}×{NB}12' in foot or '4 × 12' in foot, f'{t} Fixe : « 4 × 12 » sous la rubrique ({foot!r})')
        # « 4 × 12 » suit le nombre de séries
        page.click('[data-action="ex-sets"][data-d="1"]')
        page.wait_for_timeout(80)
        R.check('5' in page.locator('#exProg .group-foot [aria-hidden="true"]').inner_text(), f'{t} Fixe : « 5 × 12 » après une série de plus')
        page.click('[data-action="ex-sets"][data-d="-1"]')
        page.locator('#exProg').scroll_into_view_if_needed()
        shot(page, LOT, f'01-editeur-fixe-{t}')
        page.click('[data-action="save-ex"]')
        page.wait_for_selector('.view.editor')
        ex = page.evaluate('data.programmes.ppl.exercises.pull[0]')
        R.check(ex.get('repFixed') is True and ex.get('repMax') == 12 and 'repMin' not in ex, f'{t} Fixe 12 enregistré ({ {k: ex.get(k) for k in ("repFixed", "repMax", "repMin")} })')
        sub = page.locator('.ed-row[data-i="0"] .cell__sub:has(.visually-hidden)').first.inner_text()
        R.check(f'4{NB}×{NB}12' in sub, f'{t} liste de la séance : « 4 × 12 » ({sub!r})')
        R.check(page.locator('.ed-row[data-i="0"] .visually-hidden').first.text_content() == '4 séries de 12 reps', f'{t} VoiceOver : « 4 séries de 12 reps »')
        shot(page, LOT, f'02-liste-{t}')
        # Rouvert : Fixe coché ; retour en fourchette, haut 10 sans bas → de 6 à 10, plus de repFixed
        page.click('.ed-row[data-i="0"]')
        page.wait_for_selector('.view.ex-edit')
        R.check(page.locator('[data-action="ex-rep-mode"][data-fixed="true"]').get_attribute('aria-pressed') == 'true', f'{t} rouvert : Fixe coché')
        page.click('[data-action="ex-rep-mode"][data-fixed="false"]')
        page.fill('#exRepMax', '10')
        page.click('[data-action="save-ex"]')
        page.wait_for_selector('.view.editor')
        ex = page.evaluate('data.programmes.ppl.exercises.pull[0]')
        R.check('repFixed' not in ex and ex.get('repMax') == 10 and ex.get('repMin') == 6, f'{t} Fourchette, bas vide : de 6 à 10 ({ex.get("repMin")}–{ex.get("repMax")})')
        # Fixe 1 rep refusé en fourchette, accepté en Fixe
        page.click('.ed-row[data-i="0"]')
        page.wait_for_selector('.view.ex-edit')
        page.fill('#exRepMin', '')
        page.fill('#exRepMax', '1')
        page.click('[data-action="save-ex"]')
        page.wait_for_timeout(150)
        R.check(page.evaluate('view') == 'ex-edit', f'{t} fourchette d\'1 rep : refusée')
        page.click('[data-action="ex-rep-mode"][data-fixed="true"]')
        page.fill('#exRepMax', '12')
        page.click('[data-action="save-ex"]')
        page.wait_for_selector('.view.editor')
        R.check(page.evaluate('fixedReps(data.programmes.ppl.exercises.pull[0])') == 12, f'{t} repassé en 4 × 12')

        # Accueil : objectif plafonné à 12 (meilleure série d'avant 10 → 11)
        target = page.evaluate("exerciseTarget('pull', data.programmes.ppl.exercises.pull[0])")
        R.check(target['text'].endswith('× 11') and target['gain'] == '1 rep', f'{t} accueil : + 1 rep vers 12 ({target})')
        page.evaluate("data.programmes.ppl.exercises.pull.push({ id: 'neuf', name: 'Pull-over poulie', sets: 4, repMax: 12, repFixed: true }); save()")
        R.check(page.evaluate("exerciseTarget('pull', data.programmes.ppl.exercises.pull.at(-1)).text") == f'4{NB}×{NB}12', f'{t} accueil : jamais fait, « 4 × 12 » au programme')

        # Séance : reps d'avant ramenées à 12, « 4 × 12 » sur la carte, puce quand tout est à 12
        page.evaluate("""() => {
            const h = data.history.find(x => x.category === 'pull' && (x.programme || 'ppl') === 'ppl' && x.exercises.some(e => e.name === 'Rowing haltère unilatéral'));
            h.exercises.find(e => e.name === 'Rowing haltère unilatéral').sets.forEach(s => { s.reps = '13'; });
            h.date = Math.max(...data.history.filter(x => x.category === 'pull').map(x => x.date)) + 1; save();
        }""")
        page.evaluate("r => navigate(r)", 'home')
        page.evaluate("startSession('pull')")
        page.wait_for_selector('.view.session')
        page.wait_for_timeout(200)
        reps = page.evaluate('activeSession.exercises[0].sets.filter(s => !s.warmup).map(s => s.reps)')
        R.check(all(r == '12' for r in reps), f'{t} séance : reps d\'avant (13) ramenées à 12 {reps}')
        card = page.locator('.ex-card[data-ei="0"]').first
        R.check(f'4{NB}×{NB}12' in card.inner_text(), f'{t} séance : « 4 × 12 » sur la carte')
        chip = card.locator('[data-action="bump-weight"]')
        R.check(chip.count() == 1, f'{t} séance : puce de charge (toutes les séries à 12 et plus)')
        page.evaluate("document.querySelectorAll('.toast').forEach(e => e.remove())")   # message de l'étape « 1 rep refusée »
        shot(page, LOT, f'03-seance-{t}')
        if chip.count():
            chip.click()
            page.wait_for_timeout(150)
            reps = page.evaluate('activeSession.exercises[0].sets.filter(s => !s.warmup).map(s => s.reps)')
            R.check(all(r == '12' for r in reps), f'{t} charge augmentée : toujours 12 reps {reps}')
            weights = page.evaluate('activeSession.exercises[0].sets.filter(s => !s.warmup).map(s => s.weight)')
            R.check(len(set(weights)) == 1, f'{t} charge augmentée sur toutes les séries {weights}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:3]}')


run_main(R, [t_reps_fixes])
