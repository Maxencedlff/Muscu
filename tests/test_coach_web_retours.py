"""Appli web du coach : corrections des juges du 26/11 (docs/COACH_WEB.md, « Retours des juges du 26/11 ») dans les trois
moteurs (Chromium, Firefox, WebKit), à 1440 px et 820 px (tablette tactile), en sombre et en clair.

    python3 tests/test_coach_web_retours.py
    PPL_ENGINES=chromium python3 tests/test_coach_web_retours.py
    PPL_COACH_URL=http://127.0.0.1:8797/ python3 tests/test_coach_web_retours.py   # serveur déjà lancé à la racine

1. Nutrition : objectif et prévu nommés (en-tête du plan, repas cochés, chiffres du jour), écart des repas signalé ;
2. Élèves : « Sans programme » seulement sans programme ni phase en cours ; fin de phase et phase terminée à prévoir ;
3. Programme : écart entre la charge prescrite et la dernière fois, charge suivante en un clic, séries en français ;
4. Bilans : photos ouvertes sur l'ordinateur relié (plus de « l'appli web ne sait pas encore ») ;
5. Messages : notifications coupées dites simplement ;
6. Semaines : tableau large qui défile avec la colonne Semaine collée et une ligne qui le dit ;
7. Élèves : légende des pastilles « Diète (7 j) » ;
8. « Plan de nutrition » partout (plus de « Plans diète », « Mes diètes », « Créer une diète »).

Faux Supabase de tests/fake_account.py, élèves de tests/coach_web_fixtures.py (aucun réseau, code factice), plus deux
élèves ajoutés ici : Thomas (phase de force en cours, sans programme envoyé, comme la démo du 26/11) et Paul (phase
terminée). Un navigateur à la fois, sans fenêtre. Captures des échecs dans $PPL_SCRATCH/shots/coach-web-retours-echecs/.
"""
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright  # noqa: E402
import fixtures  # noqa: E402,F401  (textes lus ramenés aux espaces simples : typo_norm)
from coach_web_fixtures import static_server, launch, open_desk  # noqa: E402
from test_coach_web import check, no_hscroll, small_targets  # noqa: E402
from test_coach_web_v4 import wait_js, go, tap  # noqa: E402

ENGINES = [e for e in os.environ.get('PPL_ENGINES', 'chromium,firefox,webkit').split(',') if e]
SIZES = [(1440, 900, False), (820, 1180, True)]
FAILS = os.path.join(os.environ.get('PPL_SCRATCH', '/tmp/ppl-tests'), 'shots', 'coach-web-retours-echecs')

# Thomas : bloc de force de 12 semaines commencé il y a 80 jours (sem. 12 sur 12, fin dans 4 jours), aucune phase
# après, aucun programme envoyé (il garde le sien) ; Paul : sèche finie il y a 12 jours, rien après, aucun programme.
EXTRA = r"""
(() => {
  const sb = window.__sb, co = sb.co, coach = window.__coachId, now = Date.now();
  const iso = k => { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const ses = (id, k) => ({ id, date: now - k * 86400e3, duration: 3600000, label: 'Force', category: 'legs',
    exercises: [{ name: 'Squat', measure: 'reps', sets: [{ weight: '140', reps: '3' }, { weight: '140', reps: '3' }] }], records: [] });
  const add = (username, sessions, phase) => {
    const id = sb.addPerson({ username, social: false, sessions });
    sb.link(coach, id, now - 90 * 86400e3);
    co.links.find(x => x.student === id).seen = now - 86400e3;
    sb.addPhase(id, phase);
    return id;
  };
  window.__thomas = add('thomas', [ses('th1', 1), ses('th2', 3), ses('th3', 5)], { goal: 'strength', start: iso(80), weeks: 12 });
  window.__paul = add('paul', [ses('pa1', 2), ses('pa2', 4)], { goal: 'cut', start: iso(40), weeks: 4 });
})();
"""


def sp(t):
    """Espaces fines et insécables (frTypoNode de l'app) ramenées à des espaces simples."""
    return t.replace('\u202f', ' ').replace('\u00a0', ' ')


def common(page, tag, theme):
    bg = page.evaluate('getComputedStyle(document.body).backgroundColor')
    check(bg == ('rgb(0, 0, 0)' if theme == 'dark' else 'rgb(242, 242, 247)'), f'{tag} : fond {bg}')
    no_hscroll(page, tag)
    small = small_targets(page)
    check(not small, f'{tag} : cibles de moins de 44 px {small[:5]}')


def row_text(page, who):
    return sp(page.locator(f'.lst a.row[data-student="{page.evaluate(who)}"]').first.inner_text())


SHOTS = os.path.join(os.environ.get('PPL_SCRATCH', '/tmp/ppl-tests'), 'shots', 'coach-web-retours')


def snap(page, engine, w, theme, name):
    """Capture de relecture (sombre et clair), Chromium à 1440 px seulement."""
    if engine != 'chromium' or w != 1440:
        return
    os.makedirs(SHOTS, exist_ok=True)
    page.screenshot(path=os.path.join(SHOTS, f'{name}-{theme}.png'))


def matrix_case(browser, url, engine, w, h, touch, theme):
    tag = f'{engine} {w}px {theme}'
    ctx, page = open_desk(browser, url, width=w, height=h, theme=theme, touch=touch, v4=True, checkins=True, health=True, pre=EXTRA)
    try:
        # ── 2 et 7 : tableau Élèves ──
        tap(page, '[data-action=filter][data-filter=all]', touch)
        t = row_text(page, 'window.__thomas')
        check('Sans programme' not in t and 'Suit son propre programme' in t, f'{tag} : Thomas suit une phase sans programme envoyé {t!r}')
        check('Fin de phase dans 4 jours : prévoir la suite' in t, f'{tag} : fin de phase à prévoir {t!r}')
        t = row_text(page, 'window.__paul')
        check('terminée le' in t and 'Phase terminée : prévoir la suite' in t and 'Sans programme' in t, f'{tag} : phase terminée {t!r}')
        hugo = sp(page.locator('.lst a.row:has-text("hugo")').first.inner_text())
        check('Sans programme' in hugo, f'{tag} : Hugo, ni programme ni phase {hugo!r}')
        ines = sp(page.locator('.lst a.row:has-text("ines")').first.inner_text())
        check('Fin de phase dans 5 jours' in ines, f'{tag} : Inès, mini sèche qui finit {ines!r}')
        tap(page, '[data-action=filter][data-filter=noprog]', touch)
        names = page.locator('.lst a.row .who-t b').all_inner_texts()
        check(sorted(names) == ['hugo', 'paul'], f'{tag} : segment Sans programme {names}')
        leg = page.locator('#diet-legend')
        check(leg.is_visible(), f'{tag} : légende des pastilles diète')
        lt = sp(leg.inner_text())
        check(all(x in lt for x in ('Diète (7 j)', 'Suivi', 'Partiel', 'Pas suivi', 'Rien de noté')), f'{tag} : légende {lt!r}')
        tap(page, '[data-action=filter][data-filter=todo]', touch)
        common(page, f'{tag} élèves', theme)

        snap(page, engine, w, theme, '1-eleves')
        # ── 8 : « plan de nutrition » partout ──
        nav = page.locator('.nav-i[href="#/plans-diete"]:visible').first.inner_text()
        check('Plans de nutrition' in nav, f'{tag} : navigation {nav!r}')
        go(page, '#/plans-diete', '.dt-pl')
        check(page.locator('h1.title').inner_text() == 'Plans de nutrition', f'{tag} : titre {page.locator("h1.title").inner_text()!r}')

        snap(page, engine, w, theme, '2-plans')
        # ── 1 : Nutrition de Léa, objectif et prévu nommés ──
        go(page, '#/eleve/LEA/nutrition', '.nt-day')
        line = sp(page.locator('#nt-plan-line').inner_text())
        check(line.startswith('Objectif 1 800 kcal par jour, repas prévus 1 364 kcal'), f'{tag} : en-tête du plan {line!r}')
        gap = sp(page.locator('#nt-plan-gap').inner_text())
        check('Il manque 436 kcal' in gap and 'Modifier ce plan' in gap, f'{tag} : écart des repas {gap!r}')
        ck = sp(page.locator('#nt-ck-kcal').inner_text())
        check('Repas cochés : 1 364 kcal prévus par ton plan.' in ck and 'lea a noté 1 780 kcal' in ck and '416 de plus' in ck, f'{tag} : repas cochés {ck!r}')
        mac = sp(page.locator('.mac').inner_text())
        check('1 780 kcal' in mac and 'objectif 1 800 kcal' in mac and ' sur ' not in mac, f'{tag} : chiffres du jour {mac!r}')
        check('noté par lea' in page.locator('#h-nt-mac').inner_text(), f'{tag} : titre du jour')
        text = sp(page.inner_text('main'))
        for bad in ('Plan diète', 'Plans diète', 'Mes diètes', 'Créer une diète'):
            check(bad not in text, f'{tag} : « {bad} » encore affiché')
        common(page, f'{tag} nutrition', theme)

        snap(page, engine, w, theme, '3-nutrition')
        # ── 3 : Programme, écart de charge et vocabulaire ──
        go(page, '#/eleve/LEA/programme', '.pg-row[data-k]')
        first = page.locator('.pg-row[data-k]').first
        ft = sp(first.inner_text())
        check('Prescrit 45 kg, fait 55 kg' in ft and 'Prescrire 57,5 kg' in ft, f'{tag} : écart de charge {ft!r}')
        check('Top set' not in ft and 'Back-off' not in ft and 'Lourde' in ft, f'{tag} : séries en français {ft!r}')
        common(page, f'{tag} programme', theme)

        snap(page, engine, w, theme, '4-programme')
        # ── 4 : Bilans, photos sur l'ordinateur relié ──
        go(page, '#/eleve/LEA/bilans', '.rv-cur')
        # Encadré des photos d'abord « Chargement… » : attendu qu'il ait lu l'état du lien (Firefox, machine chargée)
        wait_js(page, "!document.querySelector('main').innerText.includes('Chargement…')")
        bt = sp(page.inner_text('main'))
        check('ne sait pas encore' not in bt and 'Relier cet ordinateur' in bt, f'{tag} : photos de bilan {bt[:300]!r}')

        snap(page, engine, w, theme, '5-bilans')
        # ── 5 : Messages, notifications coupées ──
        go(page, '#/eleve/LEA/messages', '.bub')
        off = sp(page.locator('.chat-off .grow').inner_text())
        check(off == 'Notifications coupées chez lea : ton message sera là dès que lea ouvrira l\'app.', f'{tag} : notifications {off!r}')
        # Un mot à coller dans un SMS pour prévenir l'élève (2e tour des juges du 27/11)
        nudge = page.locator('.chat-off [data-ms="nudge"]')
        check(nudge.count() == 1 and 'prévenir lea' in nudge.inner_text(), f'{tag} : bouton « Copier un mot pour prévenir lea »')

        snap(page, engine, w, theme, '6-messages')
        # ── 6 : Semaines, tableau large ──
        go(page, '#/eleve/LEA', 'table.wk')
        info = page.evaluate("""(() => { const s = document.querySelector('.tscroll'), th = s.querySelector('tbody th[scope=row]');
          return { more: s.classList.contains('more'), over: s.scrollWidth - s.clientWidth, hint: !document.getElementById('wk-hint').hidden,
            pos: getComputedStyle(th).position, bg: getComputedStyle(th).backgroundColor }; })()""")
        check(info['pos'] == 'sticky' and info['bg'] not in ('rgba(0, 0, 0, 0)', 'transparent'), f'{tag} : colonne Semaine collée et opaque {info}')
        if info['over'] > 1:
            check(info['more'] and info['hint'], f'{tag} : tableau plus large, indice affiché {info}')
            page.evaluate("(() => { const s = document.querySelector('.tscroll'); s.scrollLeft = s.scrollWidth; })()")
            wait_js(page, "document.getElementById('wk-hint').hidden")
            stuck = page.evaluate("""(() => { const s = document.querySelector('.tscroll'), th = s.querySelector('tbody th[scope=row]');
              return Math.abs(th.getBoundingClientRect().left - s.getBoundingClientRect().left); })()""")
            check(stuck < 2, f'{tag} : colonne Semaine restée à gauche ({stuck} px)')
        else:
            check(not info['hint'], f'{tag} : tout tient, pas d\'indice {info}')
        check(w > 1300 or info['over'] > 1, f'{tag} : à {w} px, Léa (santé, mensurations, bilans) déborde {info}')
        common(page, f'{tag} semaines', theme)
        snap(page, engine, w, theme, '7-semaines')
        check(not page.evaluate('window.__csp || []'), f'{tag} : CSP {page.evaluate("window.__csp")}')
        check(not page.errors, f'{tag} : erreurs {page.errors}')
    except Exception:
        os.makedirs(FAILS, exist_ok=True)
        page.screenshot(path=os.path.join(FAILS, tag.replace(' ', '_') + '.png'), full_page=True)
        raise
    finally:
        ctx.close()


def journey(browser, url, engine):
    """Charge suivante en un clic, puis envoi : la lourde à 57,5 kg, les allégées suivent du même écart."""
    ctx, page = open_desk(browser, url, width=1440, v4=True)
    try:
        go(page, '#/eleve/LEA/programme', '.pg-row[data-k]')
        k = page.locator('.pg-row[data-k]').first.get_attribute('data-k')
        page.click(f'[data-pg=use-next][data-k="{k}"]')
        wait_js(page, f"document.getElementById('pg-ld0-{k}').value === '57,5'")
        vals = [page.input_value(f'#pg-ld{j}-{k}') for j in range(4)]
        check(vals == ['57,5', '52,5', '52,5', '52,5'], f'{engine} : charges après « Prescrire 57,5 kg » {vals}')
        check(page.locator(f'[data-pg=use-next][data-k="{k}"]').count() == 0, f'{engine} : plus de proposition une fois appliquée')
        check(page.locator('.savebar.stick').count() == 1, f'{engine} : changement pas encore envoyé, barre collée')
        page.click('[data-pg=send]')
        wait_js(page, "!document.querySelector('.savebar.stick')")
        ex = page.evaluate("window.__sb.co.progs.find(p => p.student === window.__lea && p.id === 'seche4').data.sessions[0].exercises[0]")
        check(ex['loads'] == [57.5, 52.5, 52.5, 52.5] and ex['intens'] == 'topback', f'{engine} : programme envoyé {ex}')
        check(not page.errors, f'{engine} : erreurs {page.errors}')
    except Exception:
        os.makedirs(FAILS, exist_ok=True)
        page.screenshot(path=os.path.join(FAILS, f'{engine}_parcours.png'), full_page=True)
        raise
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
                        print(f'ok  {engine} {w}px {theme}')
                journey(browser, url, engine)
                print(f'ok  {engine} charge suivante')
            except Exception:
                traceback.print_exc()
                sys.exit(1)
            finally:
                browser.close()
    print('Retours des juges du 26/11 sur l\'appli web du coach : OK')


if __name__ == '__main__':
    main()
