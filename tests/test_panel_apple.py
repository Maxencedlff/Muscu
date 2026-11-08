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


def t_annuler_en_ligne(bench):
    """En séance, aucun toast flottant (panels de la vague 3) : « Annuler » en ligne, à sa place, 6 s.
    Série validée : dans la colonne « Avant » de la série, feuille Repos ouverte ou non ; Plus tard : une ligne au-dessus
    de la carte déplacée ; rien ne recouvre rien, VoiceOver l'annonce."""
    for eng, dev in PHONES:
        t = tag(dev, 'light')
        with bench.page(eng, dev, 'light') as page:
            start_session(page)
            page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]')
            page.wait_for_timeout(450)
            row = page.locator('.ex-card[data-ei="0"] .session-set').first
            R.check(page.locator('.toast').count() == 0 and row.locator('[data-action="sess-undo"]').count() == 1,
                    f'{t} série validée : pas de toast, « Annuler » dans sa ligne')
            said = page.evaluate("document.getElementById('sr-polite').textContent")
            R.check('validée' in said and 'Annuler' in said, f'{t} VoiceOver : état annoncé ({said!r})')
            if page.locator('[data-action="expand-rest"]').count():
                page.click('[data-action="expand-rest"]'); page.wait_for_selector('.sess-sheet--rest'); page.wait_for_timeout(400)
                R.check(page.locator('.toast').count() == 0, f'{t} feuille Repos : aucun toast sur ses contrôles')
                page.evaluate('closeSessSheets()'); page.wait_for_timeout(300)
            shot(page, LOT, f'annuler-serie-{t}')
            page.click('.ex-card[data-ei="0"] [data-action="sess-undo"]')
            page.wait_for_timeout(300)
            R.check(not page.evaluate("activeSession.exercises[0].sets[0].done") and page.locator('[data-action="sess-undo"]').count() == 0,
                    f'{t} « Annuler » touché : série dévalidée, bouton parti')
            # Plus tard : la ligne « Mis en dernier · Annuler » au-dessus de la carte déplacée
            name0 = page.evaluate("activeSession.exercises[0].name")
            page.click('[data-action="ex-later"][data-ei="0"]')
            page.wait_for_timeout(400)
            m = page.evaluate("""n => { const u = document.querySelector('.ex-undo'); if (!u) return null; const card = u.nextElementSibling;
                return { text: u.textContent.trim(), next: card && card.textContent.includes(n), toast: !!document.querySelector('.toast') }; }""", name0)
            R.check(m and m['text'].startswith('Mis en dernier') and m['next'] and not m['toast'], f'{t} Plus tard : ligne au-dessus de la carte déplacée {m}')
            page.wait_for_timeout(6300)
            R.check(page.locator('.ex-undo, [data-action="sess-undo"]').count() == 0, f'{t} après 6 s : la ligne s\'en va')
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
            # VoiceOver : durées en minutes et secondes, jamais « 1:30 » lu comme une heure (panels de la vague 3)
            sp = page.evaluate("""() => ({ seg: [...document.querySelectorAll('.sess-sheet--rest .rs-seg__btn')].map(b => b.getAttribute('aria-label')),
                timer: document.querySelector('.sess-sheet--rest .rs__time').getAttribute('aria-label'),
                link: document.querySelector('.ex-rest-link').getAttribute('aria-label') })""")
            R.check(sp['seg'][:2] == ['1 minute', '1 minute 30'] and sp['timer'].startswith('Il reste 1 minute') and ':' not in sp['link'] and 'minute' in sp['link'],
                    f'{t} durées parlées {sp}')
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
    """Menu ⋯ d'un exercice (iPhone SE) : Remplacer, la prise, Plus tard visibles sans défiler, liste qui ne défile pas,
    fond opaque, « Retirer l'exercice » à part juste au-dessus d'« Annuler »."""
    for theme in ('dark', 'light'):
        t = tag('iPhone SE', theme)
        with bench.page('webkit', 'iPhone SE', theme) as page:
            start_session(page, theme)
            page.evaluate("activeSession.exercises[0].name = 'Tirage vertical prise serrée'; render()")   # mouvement avec une prise
            page.click('.ex-card__more[data-ei="0"]')
            page.wait_for_selector('.ios-dialog--sheet')
            page.wait_for_timeout(450)
            m = page.evaluate("""() => { const d = document.querySelector('.ios-dialog--sheet'), groups = [...d.querySelectorAll('.ios-dialog__group')];
                const btn = l => [...d.querySelectorAll('.ios-dialog__btn')].find(b => b.textContent.trim().startsWith(l));
                const seen = l => { const b = btn(l); if (!b) return null; const r = b.getBoundingClientRect(), g = b.closest('.ios-dialog__group').getBoundingClientRect();
                  return r.top >= g.top - 1 && r.bottom <= g.bottom + 1 && r.bottom <= innerHeight; };
                const bg = getComputedStyle(groups[0]).backgroundColor;
                return { labels: [...groups[0].querySelectorAll('.ios-dialog__btn')].map(b => b.textContent.trim()), replace: seen("Remplacer"), prise: seen('Choisir la prise'),
                         later: seen('Plus tard') ?? seen('Faire maintenant'), scrolls: groups[0].scrollHeight > groups[0].clientHeight + 2, opaque: !bg.startsWith('rgba'), bg,
                         ownGroup: groups.indexOf(btn("Retirer l'exercice").closest('.ios-dialog__group')) === groups.length - 2, cancelLast: groups.at(-1).textContent.trim() === 'Annuler' }; }""")
            R.check(m['replace'] and m['prise'] in (True, None) and m['later'] and not m['scrolls'] and m['opaque'] and m['ownGroup'] and m['cancelLast'],
                    f'{t} menu ⋯ : actions fréquentes visibles sans défiler, fond opaque, « Retirer » à part {m}')
            shot(page, LOT, f'menu-exercice-{t}')
            tap_dialog(page, "Plus d'options")
            page.wait_for_timeout(400)
            more = page.locator('.ios-dialog__btn').all_inner_texts()
            R.check('Régler le repos' in more and 'Muscles ciblés' in more, f'{t} « Plus d\'options » : réglages rares {more}')
            tap_dialog(page, 'Annuler')
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
            since = page.locator('.chart-head__since').inner_text().strip()
            R.check(since.startswith('depuis '), f'{t} tendance : sa période est dite ({since!r})')
            page.locator('#exChart').scroll_into_view_if_needed()
            shot(page, LOT, f'courbe-{t}')
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
                const al = s => { const m = s.match(/[\\d.]+/g); return m.length > 3 ? Number(m[3]) : 1; };
                return { base: rgb(getComputedStyle(d).backgroundColor), top: rgb(a.backgroundColor), o: parseFloat(a.opacity) * al(a.backgroundColor) }; })""")
            seen = [[round(b * (1 - d['o']) + c * d['o']) for b, c in zip(d['base'], d['top'])] for d in dots]
            gaps = [round(_delta_e(seen[i], seen[i + 1])) for i in range(len(seen) - 1)]
            # Entretien / Travaillé et Travaillé / Objectif atteint nettement distincts (vague 3 : les deux premiers trop proches)
            R.check(len(gaps) == 4 and gaps[1] >= 35 and gaps[2] >= 30 and min(gaps) >= 12, f'{t} paliers voisins distincts (Pas travaillé › Gros volume) {gaps}')
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
                # Courbe d'un exercice, Mes programmes, journal Nutrition : le nom de l'écran précédent (panels de la vague 3)
                lbl = "(() => { const b = document.querySelector('#app .navbar__back'); return b.classList.contains('navbar__back--icon') ? 'chevron' : b.querySelector('.navbar__back-label').textContent; })()"
                page.click('.tabbar [data-action="go-stats"]'); page.wait_for_selector('[data-action="open-stats-ex"]')
                page.locator('[data-action="open-stats-ex"]').first.click(); page.wait_for_selector('.view.stats-ex'); page.wait_for_timeout(400)
                got = [page.evaluate(lbl)]
                page.click('.tabbar [data-tab="program"]'); page.wait_for_timeout(400)
                page.evaluate("navigate('my-programmes')"); page.wait_for_selector('.view.my-programmes'); page.wait_for_timeout(400)
                got.append(page.evaluate(lbl))
                page.click('.tabbar [data-tab="train"]'); page.wait_for_timeout(400)
                page.click('.tabbar [data-tab="train"]'); page.wait_for_timeout(400)   # onglet actif touché : racine
                page.evaluate("navigate('nutrition')"); page.wait_for_timeout(500)
                got.append(page.evaluate(lbl))
                R.check(got == ['Progrès', 'Programme', 'Entraînement'], f'{t} retours titrés (courbe, Mes programmes, Nutrition) {got}')
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


def t_toast_hors_seance(bench):
    """Hors séance : une seule place (en bas, au-dessus de la barre d'onglets), fond opaque, la page garde sa hauteur
    sous le contenu, et le toast part au changement d'écran."""
    for eng, dev in PHONES:
        t = tag(dev, 'light')
        with bench.page(eng, dev, 'light') as page:
            seed(page, 'light', ppl_v2_today_json())
            page.evaluate("showToast('Message de test')")
            page.wait_for_timeout(300)
            m = page.evaluate("""() => { const t = document.querySelector('.toast').getBoundingClientRect(), tab = document.querySelector('.tabbar').getBoundingClientRect();
                const bg = getComputedStyle(document.querySelector('.toast')).backgroundColor, room = getComputedStyle(document.querySelector('#app'), '::after').height;
                return { above: t.bottom <= tab.top, opaque: !bg.startsWith('rgba'), room: parseFloat(room) >= t.height }; }""")
            R.check(m['above'] and m['opaque'] and m['room'], f'{t} toast : au-dessus de la barre, opaque, place gardée sous le contenu {m}')
            page.wait_for_timeout(900)
            page.click('.tabbar [data-action="go-stats"]')
            page.wait_for_timeout(400)
            R.check(page.locator('.toast').count() == 0, f'{t} changement d\'écran : le toast simple s\'en va aussi')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

def t_modifier_cibles(bench):
    """Accueil (iPhone SE) : « Modifier » sur la même ligne que « À battre aujourd'hui », pas seul en dessous."""
    for eng, dev in PHONES:
        t = tag(dev, 'light')
        with bench.page(eng, dev, 'light') as page:
            seed(page, 'light', ppl_v2_today_json())
            m = page.evaluate("""() => { const t = document.querySelector('.targets__title').getBoundingClientRect(), e = document.querySelector('.targets__edit').getBoundingClientRect();
                return { same: e.top < t.bottom && e.bottom > t.top, right: e.left >= t.right - 1 }; }""")
            R.check(m['same'] and m['right'], f'{t} « Modifier » à droite du titre, sur sa ligne {m}')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_rest_pause_mots(bench):
    """Rest-pause (iPhone SE et 17) : la pause dite en entier (« 15 s »), un seul mot pour la sous-série (« mini-série »),
    plus de « RP1 » dans la colonne Série."""
    for eng, dev in (('webkit', 'iPhone SE'), ('webkit', 'iPhone 17')):
        t = tag(dev, 'dark')
        with bench.page(eng, dev, 'dark') as page:
            start_session(page, 'dark')
            page.click('[data-action="tech-set"][data-ei="0"][data-si="0"]')
            page.wait_for_selector('.ios-dialog__btn'); page.wait_for_timeout(300)
            tap_dialog(page, 'Rest-pause')
            page.wait_for_timeout(400)
            m = page.evaluate("""() => { const h = document.querySelector('.tech__hint'), tg = document.querySelector('.session-set--sub .tech-tag, .session-set--sub .set-n');
                return { hint: h && h.textContent, shown: !!h && h.getBoundingClientRect().width > 0 && h.scrollWidth <= h.clientWidth + 1,
                         tag: tg && tg.textContent.trim(), add: document.querySelector('[data-action="tech-add-sub"]')?.textContent.trim() }; }""")
            R.check(m['hint'] == '15 s' and m['shown'] and m['tag'] == '1' and 'mini-série' in (m['add'] or ''), f'{t} rest-pause : « 15 s » entier, « 1 », « + mini-série » {m}')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_roue_meme_couleur(bench):
    """La roue des Réglages : la même couleur (d'action) sur l'accueil et sur Programme."""
    for theme in ('light', 'dark'):
        t = tag('iPhone 13', theme)
        with bench.page('webkit', 'iPhone 13', theme) as page:
            seed(page, theme, ppl_v2_today_json())
            c1 = page.evaluate("getComputedStyle(document.querySelector('.dashboard [data-action=\"go-settings\"]')).color")
            page.click('.tabbar [data-tab="program"]'); page.wait_for_timeout(400)
            c2 = page.evaluate("getComputedStyle(document.querySelector('.programmes [data-action=\"go-settings\"]')).color")
            R.check(c1 == c2, f'{t} roue : même couleur partout ({c1} / {c2})')


run_main(R, [], once=[t_roue_meme_couleur, t_rest_pause_mots, t_modifier_cibles, t_toast_hors_seance, t_info_jamais_seul, t_retour_titre, t_silhouette_paliers, t_progres_tendance, t_titre_replie, t_annuler_en_ligne, t_repos_44, t_superset_noms, t_objectif_pas_bouton, t_menu_exercice])
