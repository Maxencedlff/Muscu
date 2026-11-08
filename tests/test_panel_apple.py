"""Corrections du panel d'ergonomie Apple (vague 3, 08/11/2026) : un test par sujet, sur iPhone 13 et iPhone SE.

Les sujets propres au coffre à photos et aux photos de bilan sont dans test_coffre.py et test_photos_bilan.py
(leur coquille iOS factice y est déjà) ; ici, le reste : titre repris par la barre au défilement, bouton retour,
séance (toast, repos, superset, objectif, menu ⋯), Progrès, Nutrition, Social, Coach.
Captures : $PPL_SCRATCH/shots/lotpanel_apple/.
Lancer : PPL_URL=http://127.0.0.1:8799/ python3 tests/test_panel_apple.py (ou run_all.py panel_apple).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'panel_apple'
R = Results(LOT)
PHONES = (('webkit', 'iPhone 13'), ('webkit', 'iPhone SE'))


def tag(dev, theme):
    return f'{dev}-{theme}'.replace(' ', '_')


def t_titre_replie(bench):
    """Titre posé dans le contenu (séance de l'historique) : la barre le reprend dès qu'il sort de l'écran."""
    for eng, dev in PHONES:
        t = tag(dev, 'light')
        with bench.page(eng, dev, 'light') as page:
            seed(page, 'light', ppl_v2_today_json())
            page.click('.tabbar [data-action="go-history"]')
            page.wait_for_selector('.view.history')
            page.locator('[data-action="open-history"]').first.click()
            page.wait_for_selector('.view.history-detail .scr-title')
            page.wait_for_timeout(300)
            st = lambda: page.evaluate("""() => { const b = document.querySelector('#app .navbar'), ti = b.querySelector('.navbar__title');
                return { echo: b.classList.contains('navbar--echo'), collapsed: b.classList.contains('navbar--collapsed'),
                         text: ti.textContent, op: getComputedStyle(ti).opacity, hidden: ti.getAttribute('aria-hidden'),
                         h1: document.querySelector('#app .scr-title').textContent.trim() }; }""")
            s = st()
            R.check(s['echo'] and not s['collapsed'] and s['text'] == s['h1'] and s['op'] == '0' and s['hidden'] == 'true',
                    f'{t} titre dans le contenu : barre prête, titre compact caché {s}')
            page.evaluate('window.scrollTo(0, 400)')
            page.wait_for_timeout(500)
            s = st()
            R.check(s['collapsed'] and s['text'] == s['h1'] and float(s['op']) > .9, f'{t} défilé : la barre montre « {s["h1"]} » {s}')
            shot(page, LOT, f'titre-replie-{t}')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def start_session(page, theme='light', cat='push'):
    seed(page, theme, ppl_v2_today_json())
    page.click(f'[data-action="start-session"][data-cat="{cat}"]')
    page.wait_for_selector('.view.session')
    page.wait_for_timeout(300)


def validate_first_set(page):
    page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]')
    page.wait_for_selector('[data-action="expand-rest"]')
    page.click('[data-action="expand-rest"]')   # le repos s'agrandit en feuille (et son voile)
    page.wait_for_selector('.sess-sheet--rest')
    page.wait_for_timeout(450)


def t_toast_sur_repos(bench):
    """Toast « Série validée · Annuler » au-dessus du voile de la feuille Repos : son bouton reçoit le toucher."""
    for eng, dev in PHONES:
        t = tag(dev, 'light')
        with bench.page(eng, dev, 'light') as page:
            start_session(page)
            validate_first_set(page)
            hit = page.evaluate("""() => { const b = document.querySelector('.toast button'); if (!b) return null;
                const r = b.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return { text: b.textContent.trim(), onButton: b === e || b.contains(e) }; }""")
            R.check(hit and hit['onButton'], f'{t} feuille Repos ouverte : le bouton du toast reçoit le toucher {hit}')
            # Ni le titre de la feuille ni « Réduire » sous le toast
            over = page.evaluate("""() => { const t = document.querySelector('.toast').getBoundingClientRect();
                return [...document.querySelectorAll('.sess-sheet--rest button, .sess-sheet--rest h2, .sess-sheet--rest .rs__time')].filter(e => {
                  const b = e.getBoundingClientRect(); return b.height && b.bottom > t.top && b.top < t.bottom && b.right > t.left && b.left < t.right; })
                  .map(e => e.textContent.trim()); }""")
            R.check(not over, f'{t} le toast ne cache aucun bouton de la feuille Repos {over}')
            shot(page, LOT, f'toast-repos-{t}')
            done = page.evaluate("activeSession.exercises[0].sets[0].done")
            page.click('.toast button')
            page.wait_for_timeout(300)
            R.check(done and not page.evaluate("activeSession.exercises[0].sets[0].done"), f'{t} « Annuler » touché : série dévalidée')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_repos_44(bench):
    """Feuille Repos et repos de la fiche exercice : chaque durée fait 44 px de haut au moins."""
    for eng, dev in PHONES:
        t = tag(dev, 'dark')
        with bench.page(eng, dev, 'dark') as page:
            start_session(page, 'dark')
            validate_first_set(page)
            hs = page.evaluate("[...document.querySelectorAll('.sess-sheet--rest .rs-seg__btn')].map(b => Math.round(b.getBoundingClientRect().height))")
            R.check(len(hs) == 6 and min(hs) >= 44, f'{t} feuille Repos : durées de 44 px {hs}')
            shot(page, LOT, f'repos-44-{t}')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def make_superset(page):
    """⋯ du 1er exercice › Superset avec… › le 3e."""
    page.click('.ex-card__more[data-ei="0"]')
    page.wait_for_timeout(300)
    tap_dialog(page, 'Superset avec')
    page.wait_for_selector('.ssp')
    page.locator('.ssp .mpick__row').nth(1).click()
    page.click('.sheet__btn--confirm')
    page.wait_for_selector('.ss-card')
    page.wait_for_timeout(300)


def t_superset_noms(bench):
    """Superset sur iPhone SE : un nom long revient à la ligne (deux lignes au plus) au lieu d'être coupé."""
    for theme in ('dark', 'light'):
        t = tag('iPhone SE', theme)
        with bench.page('webkit', 'iPhone SE', theme) as page:
            start_session(page, theme)
            make_superset(page)
            page.evaluate("activeSession.exercises[0].name = 'Tirage vertical poulie prise serrée'; render()")
            page.wait_for_timeout(300)
            m = page.evaluate("""() => { const e = document.querySelector('.ss-member__name .ex-howto__text, .ss-member__name');
                const lh = parseFloat(getComputedStyle(e).lineHeight) || 20;
                const r = document.createRange(); r.selectNodeContents(e);
                return { text: e.textContent.trim(), lines: Math.round(r.getBoundingClientRect().height / lh), cut: e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1 }; }""")
            R.check(m['text'].startswith('Tirage vertical poulie prise serrée') and m['lines'] == 2 and not m['cut'], f'{t} superset : nom entier sur deux lignes {m}')
            # L'objectif reste sous le nom, sans le chevaucher
            gap = page.evaluate("""() => { const n = document.querySelector('.ss-member__name .ex-howto__text, .ss-member__name'), g = document.querySelector('.ex-goal--member');
                const r = document.createRange(); r.selectNodeContents(n); return Math.round(g.getBoundingClientRect().top - r.getBoundingClientRect().bottom); }""")
            R.check(gap >= 0, f'{t} superset : objectif sous le nom sur deux lignes (écart {gap} px)')
            shot(page, LOT, f'superset-noms-{t}')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [], once=[t_titre_replie, t_toast_sur_repos, t_repos_44, t_superset_noms])
