"""Lot 7 (séance) : corrections de la vérification finale."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = '7_seance'
R = Results(LOT)


def start(page, cat='push'):
    page.click(f'[data-action="start-session"][data-cat="{cat}"]')
    page.wait_for_selector('.view.session')


def skip_rest(page):
    for sel in ('.rest-overlay [data-action="skip-rest"]', '.rest-mini__skip'):
        if page.locator(sel).count():
            page.locator(sel).first.click()
            break
    page.wait_for_timeout(120)


def t_seance(bench, eng, dev, theme):
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        start(page)
        page.wait_for_timeout(200)

        # Virgule décimale dans les champs kg (valeurs et indications)
        vals = page.evaluate("[...document.querySelectorAll('[data-action=\"set-weight\"]')].map(i => i.value + '|' + i.placeholder)")
        R.check(all('.' not in v for v in vals), f'{t} champs kg sans point décimal {vals[:4]}')

        # Colonne Préc. sur une seule ligne, hauteurs régulières
        prev = page.evaluate("""[...document.querySelectorAll('.set-prev')].map(e => {
            const lh = parseFloat(getComputedStyle(e).lineHeight);
            return [e.textContent, e.getBoundingClientRect().height <= lh * 1.5, e.scrollWidth <= e.clientWidth + 1];
        })""")
        R.check(all(p[1] for p in prev), f'{t} Préc. sur une ligne {[p[0] for p in prev if not p[1]]}')
        R.check(all(p[2] for p in prev), f'{t} Préc. non tronquée {[p[0] for p in prev if not p[2]]}')
        shot(page, LOT, f'{t}-01-tableau')

        # Saisie avec virgule acceptée, delta gris tant que l'exercice n'est pas fini
        w = page.locator('[data-action="set-weight"][data-ei="0"][data-si="0"]')
        r = page.locator('[data-action="set-reps"][data-ei="0"][data-si="0"]')
        w.fill('35,5'); r.fill('11')
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]')
        page.wait_for_timeout(200)
        R.check(page.evaluate('activeSession.exercises[0].sets[0].weight') in ('35.5', 35.5), f'{t} « 35,5 » enregistré 35.5')
        bg = page.evaluate("getComputedStyle(document.querySelector('.toast')).backgroundColor")
        R.check('rgba' not in bg or bg.endswith(', 1)'), f'{t} toast de séance opaque ({bg})')
        skip_rest(page)
        d = page.locator('.ex-card[data-ei="0"] .ex-vol__delta')
        R.check(d.count() == 1 and 'ex-vol__delta--up' not in (d.get_attribute('class') or ''),
                f'{t} delta 1/4 présent et gris')
        shot(page, LOT, f'{t}-02-delta-gris')

        # Série baissée : pas de « −… kg » dans l'en-tête
        page.evaluate("activeSession.exercises[0].sets.forEach((s, i) => { if (!s.done) { s.weight = '5'; s.reps = '5'; } })")
        for si in (1, 2, 3):
            page.click(f'[data-action="validate-set"][data-ei="0"][data-si="{si}"]')
            page.wait_for_timeout(120)
            skip_rest(page)
            sub = page.locator('.ex-card[data-ei="0"] .ex-card__sub')
            if sub.count():
                R.check('−' not in sub.inner_text(), f'{t} pas de delta négatif en séance (série {si + 1})')

        # Exercice fini en hausse : delta vert
        page.evaluate("activeSession.exercises[0].sets.forEach(s => { s.weight = '40'; s.reps = '12'; }); openDone.add(activeSession.exercises[0]); render()")
        d = page.locator('.ex-card[data-ei="0"] .ex-vol__delta')
        R.check(d.count() == 1 and 'ex-vol__delta--up' in (d.get_attribute('class') or ''), f'{t} delta vert une fois fini')

        # Bilan : pas de toast sur « Terminé », baisse sans double signe
        page.evaluate("activeSession.exercises[0].sets.forEach(s => { s.weight = '5'; s.reps = '5'; })")
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(250)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary')
        page.wait_for_timeout(300)
        tb = page.evaluate("(() => { const t = document.querySelector('.toast'), b = document.querySelector('.sum-done'); if (!t) return null; const a = t.getBoundingClientRect(), c = b.getBoundingClientRect(); return [t.textContent, a.bottom <= c.top && a.top < 120]; })()")
        R.check(tb is not None and 'Annuler' not in tb[0] and tb[1], f'{t} toast du bilan hors du bouton Terminé {tb}')
        dl = page.locator('.sum-tile__delta')
        if dl.count():
            R.check('−' not in dl.inner_text(), f'{t} bilan : flèche sans signe moins ({dl.inner_text()})')
        shot(page, LOT, f'{t}-03-bilan')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


TESTS = [t_seance]

if __name__ == '__main__':
    run_main(R, TESTS, once=[])
