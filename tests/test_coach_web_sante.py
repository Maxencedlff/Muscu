"""Appli web du coach, vague 3 (docs/COACH_WEB.md, « Vague 3 : pas, sommeil, cardio ») : colonnes Pas, Sommeil et
Cardio de la fiche Semaines dans les trois moteurs (Chromium, Firefox, WebKit), à 1440, 1180 et 820 px (tactile en
tablette), en sombre et en clair.

    python3 tests/test_coach_web_sante.py
    PPL_ENGINES=chromium python3 tests/test_coach_web_sante.py

Faux Supabase de tests/fake_account.py (coach_student_health, coach_student_weeks avec health), données de
COACH_WEB_SEED et COACH_WEB_HEALTH_SEED (tests/coach_web_fixtures.py) : aucun réseau, code factice. Un navigateur à la
fois, sans fenêtre. Captures des échecs dans $PPL_SCRATCH/shots/coach-web-sante-echecs/.
"""
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright  # noqa: E402
import fixtures  # noqa: E402,F401  (textes lus ramenés aux espaces simples : typo_norm)
from coach_web_fixtures import static_server, launch, open_desk  # noqa: E402
from test_coach_web import check, no_hscroll, small_targets  # noqa: E402

ENGINES = [e for e in os.environ.get('PPL_ENGINES', 'chromium,firefox,webkit').split(',') if e]
SIZES = [(1440, 900, False), (1180, 820, True), (820, 1180, True)]
FAILS = os.path.join(os.environ.get('PPL_SCRATCH', '/tmp/ppl-tests'), 'shots', 'coach-web-sante-echecs')
HEADS = ['Pas par jour', 'Sommeil par nuit', 'Cardio par jour']   # intitulé et précision (deux lignes)
OFF = 'ne partage pas ses pas, son sommeil ni son cardio (réglage dans l\'app iPhone : Partager avec mon coach)'
# Valeurs attendues de COACH_WEB_HEALTH_SEED (jour i : il y a i jours ; S48 = jours 0 et 1, S47 = jours 2 à 8, sans le 4)
#  S48 : pas 7000, 7400 → 7 200 ; sommeil 400, 415 → 407,5 → 6 h 48 ; cardio 20 (un jour)
#  S47 : pas 7800, 8200, 7400, 7800, 8200 (le 5 sans pas) → 7 880 ; sommeil 430, 445, 415, 430, 445, 400 → 427,5 → 7 h 08 ;
#        cardio 35 (jour 3), 30 (jour 6) → 32,5 → 33 min/j
WANT = {
    'S48': (('7 200', 'Moyenne sur 2 jours'), ('6 h 48', 'Moyenne sur 2 nuits'), ('20 min/j', 'Moyenne sur 1 jour')),
    'S47': (('7 880', 'Moyenne sur 5 jours'), ('7 h 08', 'Moyenne sur 6 nuits'), ('33 min/j', 'Moyenne sur 2 jours')),
}


def sp(t):
    return (t or '').replace(' ', ' ').replace(' ', ' ').strip()


def go_student(page, who='window.__lea'):
    page.evaluate(f"location.hash = '#/eleve/' + {who}")
    page.wait_for_selector('table.wk tbody tr')


def heads(page):
    return [' '.join(sp(t).split()) for t in page.locator('table.wk thead th').all_inner_texts()]


def cells(page, week):
    """Textes visibles (sans le texte pour lecteurs d'écran) et title des cases Pas, Sommeil, Cardio d'une semaine."""
    return page.evaluate("""([week, names]) => {
      const hs = [...document.querySelectorAll('table.wk thead th')].map(t => t.innerText.trim().split(/\s+/).join(' '));
      const row = [...document.querySelectorAll('table.wk tbody tr')].find(r => r.querySelector('th .wn').textContent === week);
      return names.map(n => { const c = row.children[hs.indexOf(n)]; const k = c.cloneNode(true); k.querySelectorAll('.sr').forEach(x => x.remove());
        return [k.textContent.trim(), c.getAttribute('title'), (c.querySelector('.sr') || {}).textContent || null]; });
    }""", [week, HEADS])


def check_lea(page, tag):
    check(heads(page)[7:10] == HEADS, f'{tag} : colonnes {heads(page)}')
    for week, want in WANT.items():
        got = cells(page, week)
        for (text, title), (gtext, gtitle, gsr) in zip(want, got):
            check(sp(gtext) == text and gtitle == title, f'{tag} : {week} {gtext!r} {gtitle!r}, attendu {text!r} {title!r}')
            check(gsr and title.lower() in sp(gsr), f'{tag} : {week} texte lu {gsr!r}')


def common(page, tag, theme):
    bg = page.evaluate('getComputedStyle(document.body).backgroundColor')
    check(bg == ('rgb(0, 0, 0)' if theme == 'dark' else 'rgb(242, 242, 247)'), f'{tag} : fond {bg}')
    no_hscroll(page, tag)
    small = small_targets(page)
    check(not small, f'{tag} : cibles de moins de 44 px {small[:5]}')
    check(not page.evaluate('window.__csp || []'), f'{tag} : CSP {page.evaluate("window.__csp")}')
    check(not page.errors, f'{tag} : erreurs {page.errors}')
    keys = page.evaluate("Object.keys(localStorage).filter(k => !['mdlf_push_ask', 'mdlf_push_remind'].includes(k)).sort()")
    # Rien des élèves : seules la session et l'heure du dernier geste (embarquée : pas même la session)
    check(set(keys) <= {'mdlf-coach-web-auth', 'mdlf_coach_web_active'}, f'{tag} : localStorage {keys}')


def matrix_case(browser, url, engine, w, h, touch, theme):
    tag = f'{engine} {w}px {theme}'
    ctx, page = open_desk(browser, url, width=w, height=h, theme=theme, touch=touch, health=True)
    try:
        go_student(page)
        check_lea(page, tag)
        check(OFF not in page.inner_text('main'), f'{tag} : Léa partage, pas de phrase « ne partage pas »')
        check('pas, sommeil et cardio' in sp(page.locator('.tbl-col .gfoot').inner_text()), f'{tag} : pied du tableau')
        # Le tableau défile dans son cadre, jamais la page
        common(page, f'{tag} fiche', theme)
        # Semaines sans relevé (au-delà de 56 jours) : « — »
        more = page.locator('[data-action=more-weeks]')
        more.tap() if touch else more.click()
        old = cells(page, 'S37')
        check(all(sp(t) == '—' and ti is None for t, ti, _ in old), f'{tag} : S37 sans valeur {old}')
        # Tom ne partage pas : aucune colonne, la phrase
        page.evaluate("location.hash = '#/'")
        page.wait_for_selector('.lst a.row')
        go_student(page, 'window.__students[1]')
        check(not any(x in heads(page) for x in HEADS), f'{tag} : Tom, colonnes {heads(page)}')
        foot = sp(page.locator('.tbl-col .gfoot').inner_text())
        check(f'tom {OFF}' in foot, f'{tag} : Tom, phrase {foot!r}')
        common(page, f'{tag} fiche sans partage', theme)
    except Exception:
        os.makedirs(FAILS, exist_ok=True)
        page.screenshot(path=os.path.join(FAILS, tag.replace(' ', '_') + '.png'), full_page=True)
        raise
    finally:
        ctx.close()


def journeys(browser, url, engine):
    """Un appel, repli page par page, serveur sans la migration, faux hôte iPad."""
    # Un seul appel pour la fiche (coach_student_weeks rend health)
    ctx, page = open_desk(browser, url, width=1440, health=True)
    try:
        go_student(page)
        calls = page.evaluate("__sb.calls.filter(c => c[0] === 'coach' && c[1].startsWith('coach_student') && c[1] !== 'coach_student_checkins' && c[2].includes(window.__lea)).map(c => c[1])")
        check(calls == ['coach_student_weeks'], f'un seul appel attendu : {calls}')
        check(not page.errors, f'un appel : erreurs {page.errors}')
    finally:
        ctx.close()

    # Serveur sans coach_student_weeks : repli page par page, coach_student_health lu à part, mêmes valeurs
    ctx, page = open_desk(browser, url, width=1180, height=820, touch=True, health=True, pre="window.__sb.fail.weeks = 'missing';")
    try:
        go_student(page)
        calls = page.evaluate("[...new Set(__sb.calls.filter(c => c[0] === 'coach' && c[1].startsWith('coach_student') && c[1] !== 'coach_student_checkins').map(c => c[1]))].sort()")
        check('coach_student_health' in calls and 'coach_student_sessions' in calls, f'repli : {calls}')
        check_lea(page, 'repli')
        check(not page.errors, f'repli : erreurs {page.errors}')
    finally:
        ctx.close()

    # Serveur sans la migration de la vague 3 (et sans celle des semaines) : rien, ni colonne ni phrase, rien ne casse
    for pre, where in (("window.__sb.fail.health = 'missing'; window.__sb.fail.weeks = 'missing';", 'sans les deux migrations'),
                       ("window.__sb.fail.health = 'missing';", 'sans la migration de la vague 3')):
        ctx, page = open_desk(browser, url, width=1440, health=True, pre=pre)
        try:
            for who in ('window.__lea', 'window.__students[1]'):
                go_student(page, who)
                check(not any(x in heads(page) for x in HEADS), f'{where} : colonnes {heads(page)}')
                check('ne partage pas ses pas' not in page.inner_text('main'), f'{where} : aucune phrase')
                check(page.locator('table.wk tbody tr.cur').inner_text().startswith('S48'), f'{where} : semaine en cours')
                page.evaluate("location.hash = '#/'")
                page.wait_for_selector('.lst a.row')
            check(not page.errors, f'{where} : erreurs {page.errors}')
        finally:
            ctx.close()

    # Grand écran (iPad) : page embarquée par l'app avec le faux hôte, mêmes colonnes
    for w, h in ((1180, 820), (820, 1180)):
        ctx, page = open_desk(browser, url, width=w, height=h, touch=True, login=False, host=True, health=True)
        try:
            page.wait_for_selector('.lst')
            check(page.locator('#login-email').count() == 0, 'hôte : pas d\'écran de connexion')
            go_student(page)
            check_lea(page, f'hôte {w}px')
            common(page, f'hôte {w}px', 'dark')
        finally:
            ctx.close()


def main():
    with sync_playwright() as pw, static_server() as url:
        for engine in ENGINES:
            browser = launch(pw, engine)
            try:
                for theme in ('dark', 'light'):
                    for w, h, touch in SIZES:
                        matrix_case(browser, url, engine, w, h, touch, theme)
                        print(f'ok  {engine} {w}px {theme}', flush=True)
                journeys(browser, url, engine)
                print(f'ok  {engine} : un appel, repli, sans migration, hôte iPad', flush=True)
            except Exception:
                traceback.print_exc()
                sys.exit(1)
            finally:
                browser.close()
    print('Vague 3 (pas, sommeil, cardio) de l\'appli web du coach : OK')


if __name__ == '__main__':
    main()
