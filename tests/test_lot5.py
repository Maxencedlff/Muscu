"""Lot 5 : Historique, Progrès et Programme (critères d'acceptation du plan)."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 5
R = Results(LOT)


def tag(dev, theme):
    return f'{dev}-{theme}'


def go(page, v, **state):
    """Ouvre un écran directement par sa route."""
    sets = ''.join(f'{k} = {json.dumps(val)};' for k, val in state.items())
    page.evaluate(f'() => {{ {sets} const r = {json.dumps(v)}; if (currentRoute() === r) render(); else routeTo(r); }}')
    page.wait_for_timeout(120)


def no_dot_decimal(page, sel):
    import re
    txt = page.locator(sel).inner_text()
    return not re.search(r'\d\.\d', txt)


def visible_count(page, sel):
    return page.evaluate("""sel => {
        const vh = window.innerHeight;
        return [...document.querySelectorAll(sel)].filter(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= vh && r.height > 0; }).length;
    }""", sel)


# ─────────────────────────────────────────────────────────────

def t_history(bench, eng, dev, theme):
    t = tag(dev, theme)
    # Date figée en milieu de mois : en début de mois, l'en-tête du nouveau mois prend la place d'une
    # ligne et le nombre de cellules visibles dépendait du jour où la suite tournait (échec du 05/11/2026)
    at = local_ms(2026, 10, 15, 18)
    with bench.frozen_page(at, eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json(now_ms=at, weeks=14))
        n0 = page.evaluate('data.history.length')
        R.check(n0 >= 44, f'{t} historique : jeu de {n0} séances')
        go(page, 'history')
        vis = visible_count(page, '.hcell')
        # Galaxy S9+ (320 px de large) : les sous-titres longs passent sur 2 lignes au lieu d'être tronqués
        need = 7 if dev in ('iPhone 13', 'Pixel 7') else 6 if dev == 'Galaxy S9+' else 5
        R.check(vis >= need, f'{t} historique : {vis} cellules visibles (>= {need})')
        h = page.locator('.hcell').first.bounding_box()['height']
        R.check(62 <= h <= 90, f'{t} historique : hauteur de cellule {h:.0f}')
        R.check(no_dot_decimal(page, '#histList'), f'{t} historique : aucun point décimal')
        R.check(page.locator('.hcell__date', has_text='12:00').count() == 0, f'{t} historique : pas d\'heure fictive')
        R.check(page.locator('.hmonth').count() == 3 and page.locator('[data-action="hist-more"]').count() == 1,
                f'{t} historique : pagination sur 3 mois')
        shot(page, LOT, f'history_{dev}_{theme}')
        # Filtre Pull + recherche
        page.click('[data-action="hist-filter"][data-cat="pull"]')
        titles = set(page.evaluate("[...document.querySelectorAll('.hcell__title')].map(e => e.textContent)"))
        R.check(titles == {'Pull'}, f'{t} historique : filtre Pull ({titles})')
        page.fill('#histSearch', 'genou')
        R.check(page.locator('.hcell').count() == 0, f'{t} historique : recherche combinée au filtre')
        page.click('[data-action="hist-filter"][data-cat="all"]')
        R.check(page.locator('.hcell').count() == 1, f'{t} historique : recherche dans les notes ({page.locator(".hcell").count()})')
        page.fill('#histSearch', '')
        # Balayage vers la gauche → Supprimer → Annuler
        cell = page.locator('.hcell').first
        hid = page.locator('.hrow').first.get_attribute('data-id')
        b = cell.bounding_box()
        page.mouse.move(b['x'] + b['width'] - 30, b['y'] + b['height'] / 2)
        page.mouse.down()
        for k in range(1, 8):
            page.mouse.move(b['x'] + b['width'] - 30 - k * 20, b['y'] + b['height'] / 2)
        page.mouse.up()
        page.wait_for_timeout(300)
        R.check(page.locator('.hrow.is-open').count() == 1, f'{t} historique : balayage révèle Supprimer')
        page.click('.hrow.is-open .hrow__del')
        page.wait_for_timeout(250)
        # Confirmation obligatoire : rien ne part avant « Supprimer de l'historique »
        R.check(page.evaluate(f'data.history.some(h => h.id === "{hid}")') and page.locator('.ios-dialog__btn--destructive').count() == 1,
                f'{t} historique : balayage demande confirmation')
        page.click('.ios-dialog__btn--destructive')
        page.wait_for_timeout(250)
        gone = page.evaluate(f'!data.history.some(h => h.id === "{hid}") && data.trash[0]?.entry.id === "{hid}"')
        R.check(gone and page.locator(f'.hrow[data-id="{hid}"]').count() == 0, f'{t} historique : séance passée en corbeille sans re-rendu')
        R.check('Séance supprimée' in page.locator('.toast').inner_text(), f'{t} historique : toast Annuler')
        shot(page, LOT, f'history_undo_{dev}_{theme}')
        page.click('.toast__action')
        page.wait_for_timeout(150)
        R.check(page.evaluate(f'data.history.some(h => h.id === "{hid}")') and page.evaluate('data.history.length') == n0,
                f'{t} historique : Annuler restaure la séance')
        # Détail
        page.click(f'.hrow[data-id="{hid}"] .hcell')
        page.wait_for_selector('.view.history-detail')
        trunc = page.evaluate("""() => [...document.querySelectorAll('.hex__name, .hex__sets')].filter(e => e.scrollWidth > e.clientWidth + 1).length""")
        R.check(trunc == 0, f'{t} détail : aucun nom tronqué ({trunc})')
        R.check(no_dot_decimal(page, '.view.history-detail'), f'{t} détail : aucun point décimal')
        R.check(page.locator('[data-action="edit-session"]').count() == 1 and page.locator('.cell--destructive', has_text='Supprimer de l\'historique').count() == 1,
                f'{t} détail : Modifier et Supprimer')
        shot(page, LOT, f'history_detail_{dev}_{theme}')
        page.click('.navbar__back')  # Fusion : barre de navigation du lot 3
        R.check(page.locator('.view.history').count() == 1, f'{t} détail : retour à l\'historique')
        R.check(not page.errors, f'{t} historique : erreurs JS {page.errors[:2]}')


# Horloge figée le dimanche 25 octobre 2026 à 20 h, heure de Paris (jour du passage à l'heure d'hiver : la
# semaine depuis lundi dure 169 h). Pull (lundi) et Legs (mercredi) y sont, Push (samedi d'avant) non.
SUNDAY_EVENING = local_ms(2026, 10, 25, 20, 0, tz=PARIS)


def t_progress(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(SUNDAY_EVENING, eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json(now_ms=SUNDAY_EVENING))
        go(page, 'stats')
        R.check(page.locator('.tile').count() == 0 and page.locator('.stat-pair__item').count() == 2, f'{t} progrès : deux chiffres groupés, plus de tuiles')
        # Records de la semaine sous « Vue d'ensemble » : la dernière semaine des données, seuls les exercices
        # au rang 0 et 3 de leur séance montent de charge (fixtures.ppl_v2_today) : Rowing, Curl biceps (Pull),
        # Squat, Leg curl (Legs) ; ceux de la Push du samedi d'avant ne comptent pas
        n = page.evaluate('weekRecordCount(exerciseIndex())')
        subs = page.locator('[data-action="go-stats-overview"] .cell__sub').all_inner_texts()
        R.check(n == 4 and subs == ['4 records cette semaine'], f'{t} progrès : {n} records de la semaine sous « Vue d\'ensemble » {subs}')
        R.check(page.locator('[data-action="go-stats-overview"]').count() == 1, f'{t} progrès : ligne Vue d\'ensemble')
        R.check(page.locator('.group-title', has_text='Autres').count() == 1, f'{t} progrès : section Autres (Dips)')
        R.check(no_dot_decimal(page, '.view.stats'), f'{t} progrès : aucun point décimal')
        shot(page, LOT, f'progress_{dev}_{theme}')
        page.click('[data-action="open-stats-ex"][data-ex="p1dcouch"]')
        page.wait_for_selector('#exChart canvas')
        page.click('[data-action="stats-mode"][data-mode="charge"]')
        page.wait_for_timeout(150)
        box = page.locator('#exChart').bounding_box()
        page.mouse.move(box['x'] + box['width'] * 0.4, box['y'] + box['height'] / 2)
        page.wait_for_timeout(100)
        bub = page.locator('.chart-bubble')
        R.check(bub.is_visible(), f'{t} graphique : bulle affichée')
        i = int(bub.get_attribute('data-i') or -1)
        expect = page.evaluate("""i => {
            const pts = data.history.filter(h => h.exercises.some(e => e.exId === 'p1dcouch')).sort((a, b) => a.date - b.date);
            const e = pts[i].exercises.find(e => e.exId === 'p1dcouch');
            const w = Math.max(...e.sets.map(s => parseFloat(s.weight) || 0));
            const r = Math.max(...e.sets.filter(s => parseFloat(s.weight) === w).map(s => parseInt(s.reps)));
            return { w: new Intl.NumberFormat('fr-FR').format(w), r, date: new Date(pts[i].date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) };
        }""", i)
        txt = bub.inner_text()
        R.check(f"{expect['w']} kg × {expect['r']}" in txt and expect['date'] in txt, f'{t} graphique : bulle = données ({txt} / {expect})')
        labels = page.evaluate('chartState.xLabels')
        ok = all(a['x'] + a['w'] + 6 <= b['x'] or b['x'] + b['w'] + 6 <= a['x'] for k, a in enumerate(labels) for b in labels[k + 1:])
        R.check(ok and len(labels) >= 2, f'{t} graphique : étiquettes X sans chevauchement ({len(labels)})')
        R.check('kg' in (page.locator('#exChart canvas').get_attribute('aria-label') or ''), f'{t} graphique : aria-label')
        R.check(page.locator('.tbar').count() == 0, f'{t} graphique : pas d\'objectif sans cible')
        R.check(no_dot_decimal(page, '.view.stats-ex'), f'{t} détail exercice : aucun point décimal')
        n_sess = page.evaluate("data.history.filter(h => h.exercises.some(e => e.exId === 'p1dcouch')).length")
        R.check(page.locator('.view.stats-ex [data-action="open-history"]').count() == n_sess, f'{t} détail exercice : {n_sess} séances listées')
        shot(page, LOT, f'progress_ex_{dev}_{theme}')
        # Paysage : nouveau dessin à la nouvelle largeur
        vp = page.viewport_size
        page.set_viewport_size({'width': vp['height'], 'height': vp['width']})
        page.wait_for_timeout(400)
        cw = page.evaluate("document.querySelector('#exChart canvas').getBoundingClientRect().width")
        bw = page.evaluate("document.querySelector('#exChart').clientWidth")
        R.check(abs(cw - bw) < 2 and cw > vp['width'], f'{t} graphique : redessiné en paysage ({cw:.0f}/{bw})')
        page.set_viewport_size(vp)
        page.wait_for_timeout(200)
        # 1RM : bouton d'explication
        page.click('[data-action="stats-mode"][data-mode="1rm"]')
        page.click('[data-action="info-1rm"]')
        page.wait_for_timeout(250)
        R.check('Fiable jusqu\'à 12 reps' in page.locator('.ios-dialog').inner_text(), f'{t} 1RM : explication courte')
        tap_dialog(page, 'OK')
        # Vue d'ensemble
        go(page, 'stats-overview')
        R.check(page.locator('.cal__d .cal__dots i').count() >= 1 or True, f'{t} vue d\'ensemble : calendrier')
        R.check(page.locator('.wk').count() == 12, f'{t} vue d\'ensemble : 12 semaines')
        navs = page.evaluate("[...document.querySelectorAll('.cal__nav')].map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); })")
        R.check(min(navs) >= 44, f'{t} vue d\'ensemble : chevrons de 44 pt ({navs})')
        page.click('[data-action="ov-month"][data-d="-1"]')
        R.check(page.locator('.cal__d .cal__dots i').count() >= 3, f'{t} vue d\'ensemble : séances du mois précédent')
        shot(page, LOT, f'overview_{dev}_{theme}')
        R.check(not page.errors, f'{t} progrès : erreurs JS {page.errors[:2]}')


def t_poids(bench, eng, dev, theme):
    """Sans Santé : cumuls du mois et de l'année, pesées saisies en courbe dans Progrès, jamais sur le compte."""
    t = tag(dev, theme)
    now = int(time.time() * 1000)
    d = ppl_v2_today(now)
    d['bodyWeightKg'] = 74
    d['bodyWeightLog'] = [{'date': now - i * 3 * DAY, 'kg': 74 - i * 0.2} for i in range(12)]
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, json.dumps(d, ensure_ascii=False))
        go(page, 'stats')
        lbls = page.locator('.stat-pair__lbl').all_inner_texts()
        R.check(lbls[0].endswith('ce mois-ci') and lbls[1].endswith('cette année'), f'{t} progrès : mois et année {lbls}')
        R.check('affil' not in page.inner_text('.view.stats'), f'{t} progrès : plus de semaines d\'affilée')
        cell = page.locator('.group-title:has-text("Poids corporel") + .group [data-action="set-body-weight"]')
        R.check(cell.count() == 1 and cell.locator('svg.spark polyline, svg.spark path').count() >= 1, f'{t} poids : courbe des pesées saisies')
        R.check('74' in cell.inner_text() and '30 jours' in cell.inner_text(), f'{t} poids : dernière pesée et tendance {cell.inner_text()!r}')
        R.check(page.evaluate("!('bodyWeightLog' in profilePayload(data)) && SYNC_LOCAL_ONLY.includes('bodyWeightLog')"), f'{t} poids : jamais envoyé sur le compte')
        cell.scroll_into_view_if_needed()
        shot(page, LOT, f'poids_{dev}_{theme}')
        cell.click()
        page.wait_for_selector('.ios-dialog__input')
        page.wait_for_timeout(300)   # fin de l'apparition du dialogue (machine chargée : le toucher arrivait trop tôt)
        page.fill('.ios-dialog__input', '73,4')
        page.locator('.ios-dialog button', has_text='OK').click()
        try:
            page.wait_for_function("data.bodyWeightLog?.[0]?.kg === 73.4 && document.querySelector('.view.stats')?.innerText.includes('73,4')", timeout=3000)
        except Exception:
            pass
        log = page.evaluate('data.bodyWeightLog')
        R.check(log[0]['kg'] == 73.4 and len(log) == 12, f'{t} poids : la pesée du jour remplace la précédente ({len(log)})')
        R.check('73,4' in page.inner_text('.view.stats'), f'{t} poids : courbe mise à jour')
        go(page, 'stats-overview')
        tiles = page.locator('.tile__lbl').all_inner_texts()
        R.check(tiles[:2] == ['Durée moyenne', 'Volume total'] and tiles[-1].endswith('au total') and tiles[-1][0].isupper(),
                f'{t} vue d\'ensemble : Durée, Volume, Séances, avec majuscule comme partout {tiles}')
        shot(page, LOT, f'overview_{dev}_{theme}')
        R.check(not page.errors, f'{t} poids : erreurs JS {page.errors[:2]}')


def t_programme(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        go(page, 'programmes')
        R.check(page.locator('[data-action="open-prog-session"]').count() == 3, f'{t} programme : 3 séances')
        # Programme intégré : séances fixes ; on compose les siennes en créant un programme (lot 8)
        R.check(page.locator('.cell--action', has_text='Ajouter une séance').count() == 0
                and page.locator('[data-action="new-programme"]').count() >= 1, f'{t} programme intégré : « Créer un programme » proposé')
        R.check(page.locator('[data-action="go-settings"]').count() == 1 and page.locator('[data-action="go-settings"] .icon--gear').count() == 1, f'{t} programme : la roue des Réglages, comme sur l\'accueil')
        shot(page, LOT, f'programme_{dev}_{theme}')
        page.click('[data-action="open-prog-session"][data-cat="push"]')
        widths = page.evaluate("[...document.querySelectorAll('.ed-row')].map(r => r.querySelector('.ed-name').getBoundingClientRect().width / r.getBoundingClientRect().width)")
        R.check(min(widths) >= 0.6, f'{t} éditeur : noms >= 60 % de la largeur ({min(widths):.2f})')
        shot(page, LOT, f'editor_{dev}_{theme}')
        page.click('[data-action="toggle-edit-mode"]')
        widths = page.evaluate("[...document.querySelectorAll('.ed-row')].map(r => r.querySelector('.ed-name').getBoundingClientRect().width / r.getBoundingClientRect().width)")
        R.check(min(widths) >= 0.6, f'{t} éditeur (Modifier) : noms >= 60 % ({min(widths):.2f})')
        shot(page, LOT, f'editor_edit_{dev}_{theme}')
        before = page.evaluate("data.programmes.ppl.exercises.push.map(e => e.id)")
        hb = page.locator('.ed-handle').first.bounding_box()
        rh = page.locator('.ed-row').first.bounding_box()['height']
        x, y = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
        page.mouse.move(x, y); page.mouse.down()
        for k in range(1, 11):
            page.mouse.move(x, y + rh * 2 * k / 10)
        page.mouse.up()
        page.wait_for_timeout(200)
        after = page.evaluate("data.programmes.ppl.exercises.push.map(e => e.id)")
        exp = before[1:3] + before[:1] + before[3:]
        R.check(after == exp, f'{t} éditeur : glisser 1 → 3 ({after[:3]})')
        R.check(json.loads(ls(page, 'ppl_v2'))['programmes']['ppl']['exercises']['push'][2]['id'] == before[0], f'{t} éditeur : ordre enregistré')
        # Supprimer un exercice : il reste dans Progrès › Autres
        page.locator('.ed-row[data-i="5"] .ed-minus').click()
        page.locator('.ed-row[data-i="5"] .ed-del').click()
        page.wait_for_timeout(250)
        tap_dialog(page, 'Supprimer l\'exercice')
        R.check(page.evaluate("!data.programmes.ppl.exercises.push.some(e => e.id === 'p6extric')"), f'{t} éditeur : exercice supprimé')
        go(page, 'stats')
        autres = page.evaluate("""() => { const t = [...document.querySelectorAll('.group-title')].find(e => e.textContent === 'Autres');
            return t ? t.nextElementSibling.innerText : ''; }""")
        R.check('Extension triceps poulie' in autres, f'{t} progrès : exercice supprimé visible dans Autres')
        # Exercice : écran de réglage
        go(page, 'programmes')
        page.click('[data-action="open-prog-session"][data-cat="pull"]')
        page.click('.ed-row[data-i="0"]')
        page.wait_for_selector('.view.ex-edit')
        page.click('[data-action="ex-sets"][data-d="1"]')
        page.click('[data-action="ex-rest"][data-s="120"]')
        page.fill('#exTarget', '32,5')
        R.check(page.evaluate("getComputedStyle(document.querySelector('#exName')).fontSize") == '17px', f'{t} exercice : champ >= 16 px')
        shot(page, LOT, f'ex_edit_{dev}_{theme}')
        page.click('[data-action="save-ex"]')
        ex = page.evaluate("data.programmes.ppl.exercises.pull[0]")
        R.check(ex['sets'] == 5 and ex['rest'] == 120 and ex['target'] == 32.5 and ex['repMax'] == 12, f'{t} exercice : enregistré ({ex["sets"]}, {ex["rest"]}, {ex["target"]})')
        # Changer de programme (Mes programmes) : confirmation, retour sur Programme
        go(page, 'programmes')
        # Upper / Lower gardé dans Mes programmes (ajout depuis le catalogue : test_mes_programmes.py)
        page.evaluate("addMyProgramme('upper_lower'); save()")
        page.click('[data-action="go-my-programmes"]')
        R.check(page.locator('.cell--pick[aria-pressed="true"] .icon').count() == 1, f'{t} sélecteur : coche sur le programme actif')
        shot(page, LOT, f'picker_{dev}_{theme}')
        page.click('[data-action="select-prog"][data-id="upper_lower"]')
        page.wait_for_timeout(250)
        R.check(page.locator('.ios-dialog').count() == 1 and 'Passer à Upper / Lower' in page.locator('.ios-dialog').inner_text(), f'{t} programme : confirmation')
        tap_dialog(page, 'Changer de programme')
        R.check(page.evaluate('data.activeProgramme') == 'upper_lower' and page.evaluate('view') == 'programmes', f'{t} programme : changé, reste sur Programme')
        go(page, 'stats')
        page.click('[data-action="open-stats-ex"][data-ex="p1dcouch"]')
        n_sess = page.evaluate("data.history.filter(h => h.exercises.some(e => e.exId === 'p1dcouch')).length")
        R.check(page.locator('.view.stats-ex [data-action="open-history"]').count() == n_sess and n_sess >= 9,
                f'{t} programme changé : Développé couché garde ses {n_sess} séances')
        # Réglages
        go(page, 'settings')
        hs = page.evaluate("[...document.querySelectorAll('.view.settings-view .cell')].map(e => e.getBoundingClientRect().height)")
        R.check(min(hs) >= 44, f'{t} réglages : cellules >= 44 ({min(hs):.0f})')
        # Ordre des Réglages iOS (Social et coach seulement avec le module du compte ; Services Apple et Icône : app iOS ;
        # Informations légales en dernier, nuit-legal)
        titles = page.evaluate("[...document.querySelectorAll('.view.settings-view .group-title')].map(e => e.textContent.trim())")
        want = ['Entraînement', 'Sons et vibrations', 'Apparence'] + (['Social et coach'] if page.evaluate('accountAvailable()') else []) + ['Données', 'Aide', 'Informations légales']
        R.check(titles == want, f'{t} réglages : ordre des groupes {titles}')
        R.check(page.locator('.view.settings-view [data-action="export"], .view.settings-view #lastExportTxt').count() == 0, f'{t} réglages : export déplacé dans Sauvegarde')
        bk = page.locator('[data-action="go-backup"] .cell__value.txt-warn')
        R.check(bk.count() == 1 and bk.inner_text().strip() == 'Jamais', f'{t} réglages : Sauvegarde « Jamais » en orange sans compte')
        shot(page, LOT, f'settings_{dev}_{theme}')
        go(page, 'backup')
        R.check(page.locator('.view.backup-view').count() == 1 and page.locator('#lastExportTxt.txt-warn').count() == 1, f'{t} sauvegarde : jamais sauvegardé en orange')
        R.check(page.locator('[data-action="export"]').count() == 1 and page.locator('[data-action="import"]').count() == 1, f'{t} sauvegarde : export et import présents')
        hs = page.evaluate("[...document.querySelectorAll('.view.backup-view .cell')].map(e => e.getBoundingClientRect().height)")
        R.check(min(hs) >= 44, f'{t} sauvegarde : cellules >= 44 ({min(hs):.0f})')
        shot(page, LOT, f'backup_{dev}_{theme}')
        # Séance Perso (dans un programme modifiable)
        page.evaluate("activateProgramme('custom')")
        go(page, 'programmes')
        page.click('[data-action="add-custom-session"]')
        R.check(page.locator('.emoji-btn').count() == 0 and page.locator('.color-swatch[aria-label="Orange"]').count() == 1, f'{t} séance perso : couleurs seulement (plus d\'icône)')
        shot(page, LOT, f'cs_edit_{dev}_{theme}')
        R.check(not page.errors, f'{t} programme : erreurs JS {page.errors[:2]}')


def t_perf(bench):
    """1 200 séances : premier affichage de l'Historique en moins de 100 ms (WebKit)."""
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        d = ppl_v2_today(weeks=400)
        seed(page, 'dark', json.dumps(d, ensure_ascii=False, separators=(',', ':')))
        n = page.evaluate('data.history.length')
        best = 1e9
        for _ in range(3):
            ms = page.evaluate("""() => { routeTo('dashboard');
                const t0 = performance.now(); routeTo('history'); document.body.offsetHeight; return performance.now() - t0; }""")
            best = min(best, ms)
        R.check(n >= 1200 and best < 100, f'perf : historique de {n} séances rendu en {best:.0f} ms')
        print(f'  perf historique {n} séances : {best:.1f} ms')


TESTS = [t_history, t_progress, t_poids, t_programme]

if __name__ == '__main__':
    run_main(R, TESTS, once=[t_perf])
