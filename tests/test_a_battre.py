"""« À battre aujourd'hui » de l'accueil (Maxence le 23/11) : tous les exercices de la séance, plus de « et 2 autres
exercices », et des reps en plus quand le cran de charge est gros (docs/PROGRESSION.md).

Cas réel : sa séance Épaules de 5 exercices (capture du 23/11). Avant : « 20,5 kg × 8 » au développé militaire après
18 × 12, « 10,5 kg × 12 » aux élévations latérales après 8 × 15.
Captures : $PPL_SCRATCH/shots/lota_battre/ (iPhone SE et 13, sombre et clair, texte normal et très grand).
Lancer : PPL_DEV="iPhone SE" PPL_THEME=dark python3 test_a_battre.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'a_battre'
R = Results(LOT)

# Séance Épaules (clé push du programme de test) : nom, séries de la dernière fois, cible attendue, gain attendu
EPAULES = [
    ('Développé militaire haltères', [('18', '12')] * 4, '18 kg × 13', '1 rep'),
    ('Élévations latérales', [('8', '15'), ('8', '14'), ('8', '13'), ('8', '12')], '8 kg × 16', '1 rep'),
    ('Oiseau (élévations arrière)', [('6.5', '12')] * 3, '6,5 kg × 13', '1 rep'),
    ('Élévations frontales', [('8', '10'), ('8', '9'), ('8', '9')], '8 kg × 11', '1 rep'),
    ('Shrug haltères', [('30', '11'), ('30', '11'), ('30', '10')], '30 kg × 12', '1 rep'),
]


def epaules_json():
    d = ppl_v2_today()
    d['programmes']['ppl']['exercises']['push'] = [make_ex(f'ep{i}', n, len(s)) for i, (n, s, _, _) in enumerate(EPAULES)]
    last = max((h for h in d['history'] if h['category'] == 'push'), key=lambda h: h['date'])
    last['exercises'] = [{'exId': f'ep{i}', 'name': n, 'sets': [{'weight': w, 'reps': r} for w, r in s]} for i, (n, s, _, _) in enumerate(EPAULES)]
    return json.dumps(d, ensure_ascii=False)


def norm(s):
    return ' '.join(s.replace(' ', ' ').split())


def rows(page):
    return page.evaluate("""() => [...document.querySelectorAll('.hero .targets__row')].map(r => ({
        name: r.querySelector('.targets__name').textContent, target: r.querySelector('.targets__target').textContent,
        gain: (r.querySelector('.targets__gain')?.textContent || '').replace(' de plus', ''),
        cut: [...r.querySelectorAll('.targets__target, .targets__before, .targets__gain')].some(e => e.scrollWidth > e.clientWidth + 1),
        right: r.getBoundingClientRect().right }))""")


def layout(page):
    return page.evaluate("""() => { const card = document.querySelector('.hero').getBoundingClientRect();
        const next = document.querySelector('.hero').nextElementSibling?.getBoundingClientRect();
        return { overflowX: document.documentElement.scrollWidth > innerWidth + 1, cardRight: card.right, w: innerWidth,
                 below: next ? next.top >= card.bottom - 1 : true,
                 btnFirst: !!(document.querySelector('.hero__btn').compareDocumentPosition(document.querySelector('.hero .targets')) & Node.DOCUMENT_POSITION_FOLLOWING) }; }""")


def check_home(page, t):
    page.wait_for_selector('.hero .targets__row')
    rs = rows(page)
    R.check(len(rs) == 5 and page.locator('.targets__more').count() == 0, f'{t} les 5 exercices, sans « et 2 autres » ({len(rs)})')
    got = [(norm(r['name']), norm(r['target']), norm(r['gain'])) for r in rs]
    want = [(n, c, g) for n, _, c, g in EPAULES]
    R.check(got == want, f'{t} cibles : des reps d\'abord quand le cran est gros {got}')
    R.check(not any(r['cut'] for r in rs), f'{t} cible, avant et gain jamais coupés')
    lay = layout(page)
    R.check(not lay['overflowX'] and lay['cardRight'] <= lay['w'] and lay['below'], f'{t} carte dans l\'écran, rien dessous recouvert {lay}')
    R.check(lay['btnFirst'], f'{t} Démarrer avant la liste : elle ne le repousse pas')


def t_a_battre(bench, eng, dev, theme):
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, epaules_json())
        check_home(page, t)
        # Très grands caractères (type-xl) : les 5 lignes restent lisibles, sans débordement
        page.add_style_tag(content='html { font-size: 28px !important; }')
        page.evaluate("window.dispatchEvent(new Event('resize'))")
        settle(page)
        check_home(page, f'{t} AX')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:3]}')


def o_captures(bench):
    """Captures locales Chromium (--mute-audio, Bench.browser) : iPhone SE et 13, sombre et clair, texte normal et AX."""
    for dev in ('iPhone SE', 'iPhone 13'):
        for theme in THEMES:
            with bench.page('chromium', dev, theme) as page:
                seed(page, theme, epaules_json())
                page.wait_for_selector('.hero .targets__row')
                shot(page, LOT, f'accueil_{dev}_{theme}_normal')
                page.locator('.hero .targets').scroll_into_view_if_needed()
                shot(page, LOT, f'accueil_{dev}_{theme}_normal_liste')
                page.add_style_tag(content='html { font-size: 28px !important; }')
                page.evaluate("window.dispatchEvent(new Event('resize'))")
                settle(page)
                page.locator('.hero .targets').scroll_into_view_if_needed()
                shot(page, LOT, f'accueil_{dev}_{theme}_AX_liste')
                R.check(len(rows(page)) == 5, f'capture {dev}-{theme} : 5 lignes')


run_main(R, [t_a_battre], once=[o_captures])
