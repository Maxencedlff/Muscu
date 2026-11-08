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


def t_objectif_pas_bouton(bench):
    """« Objectif 32 kg × 10 » en couleur de texte (pas le bleu d'action de « Repos 2:00 », qui est un bouton)."""
    for theme in ('light', 'dark'):
        t = tag('iPhone 13', theme)
        with bench.page('webkit', 'iPhone 13', theme) as page:
            start_session(page, theme)
            c = page.evaluate("""() => { const g = document.querySelector('.ex-card[data-ei="0"] .ex-goal'), n = document.querySelector('.ex-card[data-ei="0"] .ex-card__name');
                const tint = document.querySelector('.navbar__text, .navbar__back, [data-action="finish-session"]');
                return { goal: getComputedStyle(g).color, label: getComputedStyle(n).color, tint: getComputedStyle(tint).color,
                         weight: getComputedStyle(g).fontWeight, tag: g.tagName, action: g.closest('button, [data-action]') ? 'oui' : 'non' }; }""")
            R.check(c['goal'] == c['label'] and c['goal'] != c['tint'] and int(c['weight']) >= 600 and c['action'] == 'non',
                    f'{t} objectif : couleur de texte, en gras, pas dans un bouton {c}')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_menu_exercice(bench):
    """Menu ⋯ d'un exercice (iPhone SE) : sections, « Retirer l'exercice » visible sans défiler, juste au-dessus d'« Annuler »."""
    for theme in ('dark', 'light'):
        t = tag('iPhone SE', theme)
        with bench.page('webkit', 'iPhone SE', theme) as page:
            start_session(page, theme)
            page.click('.ex-card__more[data-ei="0"]')
            page.wait_for_selector('.ios-dialog--sheet')
            page.wait_for_timeout(400)
            m = page.evaluate("""() => { const d = document.querySelector('.ios-dialog--sheet'), groups = [...d.querySelectorAll('.ios-dialog__group')];
                const rm = [...d.querySelectorAll('.ios-dialog__btn')].find(b => b.textContent.includes("Retirer l'exercice"));
                const r = rm.getBoundingClientRect();
                return { sects: [...d.querySelectorAll('.ios-dialog__sect')].map(e => e.textContent), groups: groups.length,
                         ownGroup: groups.indexOf(rm.closest('.ios-dialog__group')) === groups.length - 2,
                         visible: r.top >= 0 && r.bottom <= innerHeight, cancelLast: groups.at(-1).textContent.trim() === 'Annuler' }; }""")
            R.check(m['sects'] == ['Ordre', 'Exercice', 'Séries et repos'] and m['groups'] == 3 and m['ownGroup'] and m['visible'] and m['cancelLast'],
                    f'{t} menu ⋯ : 3 sections, « Retirer l\'exercice » à part et visible, « Annuler » en bas {m}')
            shot(page, LOT, f'menu-exercice-{t}')
            tap_dialog(page, "Retirer l'exercice")
            page.wait_for_timeout(300)
            if page.locator('.ios-dialog').count():
                page.locator('.ios-dialog__btn--destructive').last.click()
                page.wait_for_timeout(300)
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_progres_tendance(bench):
    """Progrès : la tendance d'un exercice dans la liste est celle que montre sa fiche à l'ouverture (Charge max)."""
    for eng, dev in PHONES:
        t = tag(dev, 'light')
        with bench.page(eng, dev, 'light') as page:
            seed(page, 'light', ppl_v2_today_json())
            page.evaluate("statsMode = 'volume'")   # dernière courbe vue : le volume d'un autre exercice
            page.click('.tabbar [data-action="go-stats"]')
            page.wait_for_selector('[data-action="open-stats-ex"][data-ex="p1dcouch"]')
            row = page.locator('[data-action="open-stats-ex"][data-ex="p1dcouch"]')
            trend = row.locator('.prow__trend').inner_text().strip()
            n = page.evaluate("data.history.filter(h => h.exercises.some(e => e.exId === 'p1dcouch')).length")
            pts = page.evaluate("""() => document.querySelector('[data-ex="p1dcouch"] .spark polyline').getAttribute('points').trim().split(' ').length""")
            row.click()
            page.wait_for_selector('.view.stats-ex .chart-head')
            on = page.locator('.view.stats-ex .segmented__btn--active').inner_text().strip()
            fiche = page.locator('.chart-head__trend').inner_text().strip() if page.locator('.chart-head__trend').count() else ''
            R.check(on == 'Charge max' and trend and fiche == trend, f'{t} liste {trend!r} = fiche {fiche!r} sur « {on} »')
            R.check(pts == n, f'{t} mini-courbe : toutes les séances, comme la tendance ({pts} points, {n} séances)')
            # Courbe : abscisses proportionnelles aux dates (pas au rang)
            ok = page.evaluate("""() => { const st = chartState, n = st.dates.length, x = st.geom.xp, d = st.dates;
                const span = x(n - 1) - x(0), dspan = d[n - 1] - d[0];
                return n > 2 && d.every((t, i) => Math.abs((x(i) - x(0)) / span - (t - d[0]) / dspan) < 0.002); }""")
            R.check(ok, f'{t} courbe : points espacés selon leur date')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def _lab(rgb):
    f = lambda x: x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    r, g, b = (f(c / 255) for c in rgb)
    X, Y, Z = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    h = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    return 116 * h(Y) - 16, 500 * (h(X) - h(Y)), 200 * (h(Y) - h(Z))


def _delta_e(a, b):
    return sum((x - y) ** 2 for x, y in zip(_lab(a), _lab(b))) ** .5


def t_silhouette_paliers(bench):
    """Progrès › carte Muscles : chaque palier de la légende se distingue de son voisin (écart de couleur CIELAB),
    « Travaillé » et « Objectif atteint » surtout (avant : deux opacités du même orange, écart d'environ 17)."""
    for theme in ('light', 'dark'):
        t = tag('iPhone 13', theme)
        with bench.page('webkit', 'iPhone 13', theme) as page:
            seed(page, theme, ppl_v2_today_json())
            page.click('.tabbar [data-action="go-stats"]')
            page.wait_for_selector('.mlegend__dot')
            dots = page.evaluate("""() => [...document.querySelectorAll('.mcard .mlegend__dot, .mlegend__dot')].slice(0, 5).map(d => {
                const rgb = s => s.match(/[\\d.]+/g).slice(0, 3).map(Number), a = getComputedStyle(d, '::after');
                return { base: rgb(getComputedStyle(d).backgroundColor), top: rgb(a.backgroundColor), o: parseFloat(a.opacity) }; })""")
            seen = [[round(b * (1 - d['o']) + c * d['o']) for b, c in zip(d['base'], d['top'])] for d in dots]
            gaps = [round(_delta_e(seen[i], seen[i + 1])) for i in range(len(seen) - 1)]
            R.check(len(gaps) == 4 and gaps[2] >= 40 and min(gaps) >= 12, f'{t} paliers voisins distincts (Pas travaillé › Gros volume) {gaps}')
            page.locator('.mcard').first.scroll_into_view_if_needed()
            shot(page, LOT, f'silhouette-paliers-{t}')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_retour_titre(bench):
    """Bouton retour : le titre de l'écran précédent quand la place le permet (« ‹ Entraînement » au-dessus de « Réglages »
    sur iPhone 13, le titre se décale au besoin), jamais collé au titre ni coupé ; sinon « Retour » ou le chevron seul."""
    for eng, dev in PHONES:
        for theme in ('light', 'dark'):
            t = tag(dev, theme)
            with bench.page(eng, dev, theme) as page:
                seed(page, theme, ppl_v2_today_json())
                page.click('.dashboard [data-action="go-settings"]')
                page.wait_for_selector('.settings-view')
                page.wait_for_timeout(400)
                b = page.evaluate("""() => { const b = document.querySelector('#app .navbar__back'), l = b.querySelector('.navbar__back-label'), ti = b.closest('.navbar__bar').querySelector('.navbar__title');
                    const r = document.createRange(); r.selectNodeContents(ti); const tr = r.getBoundingClientRect(), shown = !!l.offsetParent;
                    return { text: shown ? l.textContent : '', gap: shown ? Math.round(tr.left - (l.getBoundingClientRect().left + l.scrollWidth)) : 99,
                             cut: l.scrollWidth > l.clientWidth + 1 || ti.scrollWidth > ti.clientWidth + 1, title: ti.textContent }; }""")
                R.check(b['gap'] >= 8 and not b['cut'] and b['title'] == 'Réglages', f'{t} retour séparé du titre, rien de coupé {b}')
                if dev == 'iPhone 13':
                    R.check(b['text'] == 'Entraînement', f'{t} « ‹ Entraînement » et non « ‹ Retour » {b}')
                shot(page, LOT, f'retour-titre-{t}')
                R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_info_jamais_seul(bench):
    """ⓘ après un nom d'exercice : toujours sur la même ligne que le dernier mot, sur chaque carte de la séance."""
    for eng, dev in PHONES:
        t = tag(dev, 'light')
        with bench.page(eng, dev, 'light') as page:
            for cat in ('push',):
                start_session(page, 'light', cat)
                cards = page.evaluate("""() => [...document.querySelectorAll('.ex-card__name .ex-howto__text')].map(e => {
                    const tail = e.querySelector('.ex-howto__tail'), ic = tail && tail.querySelector('.icon');
                    if (!tail || !ic) return { name: e.textContent, ok: false };
                    const rs = [...tail.getClientRects()], i = ic.getBoundingClientRect(), last = rs[rs.length - 1];
                    return { name: e.textContent.trim(), ok: rs.length === 1 && i.top >= last.top - 2 && i.bottom <= last.bottom + 2 }; })""")
                bad = [c['name'] for c in cards if not c['ok']]
                R.check(cards and not bad, f'{t} {cat} : ⓘ avec le dernier mot sur {len(cards)} cartes {bad}')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [], once=[t_info_jamais_seul, t_retour_titre, t_silhouette_paliers, t_progres_tendance, t_titre_replie, t_toast_sur_repos, t_repos_44, t_superset_noms, t_objectif_pas_bouton, t_menu_exercice])
