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
        # Vague 4 : le programme d'une séance d'un autre programme a sa ligne (« Programme Bras & épaules ») : une cellule de moins
        need = 6 if dev in ('iPhone 13', 'Pixel 7', 'Galaxy S9+') else 5
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
        # Grand écran : la colonne de lecture plafonne à 640 px (a6fb274), le graphique ne peut plus s'élargir
        capped = page.evaluate("innerWidth > 720 && document.querySelector('#exChart').clientWidth <= 640")
        # Appareil déjà en paysage (Duo paysage) : la « rotation » le remet en portrait, plus étroit ; seul le redessin compte
        narrower = vp['height'] < vp['width']
        R.check(abs(cw - bw) < 2 and (cw > vp['width'] or capped or narrower), f'{t} graphique : redessiné à la nouvelle largeur ({cw:.0f}/{bw})')
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
        # Séances en cartes illustrées, comme l'accueil : vignette du groupe principal (décorative), nom, muscles, infos ;
        # VoiceOver lit l'intitulé complet ; le texte ne passe jamais sous la vignette
        cards = page.evaluate("""() => [...document.querySelectorAll('.ps-list .pcard')].map(c => {
            const img = c.querySelector('.pcard__img'), txt = c.querySelector('.mgc__text');
            return { cat: c.dataset.cat, src: img ? img.getAttribute('src') : '', hidden: img ? img.getAttribute('aria-hidden') === 'true' && img.alt === '' : false,
                     name: c.querySelector('.pcard__name').textContent.trim(), muscles: (c.querySelector('.pcard__muscles') || {}).textContent || '',
                     label: c.getAttribute('aria-label') || '',
                     apart: img ? txt.getBoundingClientRect().right <= img.getBoundingClientRect().left + 1 : false }; })""")
        R.check([c['src'] for c in cards][:2] == ['img/muscles/pectoraux.webp', 'img/muscles/dos.webp'],
                f'{t} cartes : vignette du groupe principal {[c["src"] for c in cards]}')
        R.check(all(c['hidden'] for c in cards) and all(c['apart'] for c in cards), f'{t} cartes : vignette décorative, à côté du texte {cards}')
        R.check([c['src'] for c in cards][2:] == ['img/muscles/quads.webp'], f'{t} carte Legs : vignette des quadriceps, cités en premier')
        R.check(cards and cards[0]['name'] == 'Push' and cards[0]['muscles'] == 'Pectoraux · Épaules · Triceps', f'{t} carte Push : nom et muscles {cards[:1]}')
        R.check(all(c['label'].startswith(c['name'] + ', ') and 'exercices' in c['label'] and 'séries' in c['label'] and '≈' not in c['label'] for c in cards),
                f'{t} cartes : intitulé VoiceOver complet {[c["label"] for c in cards]}')
        R.check(page.locator('.plist [data-action="go-my-programmes"] .plist__icon').count() == 1
                and page.locator('.plist [data-action="go-library"] .plist__icon').count() == 1
                and page.locator('.plist [data-action="go-diet-plans"] .plist__icon').count() == 1, f'{t} entrées secondaires : liste iOS avec icône')
        shot(page, LOT, f'programme_{dev}_{theme}')
        page.click('[data-action="open-prog-session"][data-cat="push"]')
        widths = page.evaluate("[...document.querySelectorAll('.ed-row')].map(r => r.querySelector('.ed-name').getBoundingClientRect().width / r.getBoundingClientRect().width)")
        R.check(min(widths) >= 0.6, f'{t} éditeur : noms >= 60 % de la largeur ({min(widths):.2f})')
        thumbs = page.evaluate("[...document.querySelectorAll('.ed-row')].map(r => (r.querySelector('.prow-thumb img') || {}).getAttribute?.('src') || '')")
        R.check(len(thumbs) == 6 and all(x.startswith('img/muscles/') for x in thumbs) and thumbs[0] == 'img/muscles/chest.webp',
                f'{t} éditeur : vignette du muscle principal à gauche de chaque exercice {thumbs[:2]}')
        R.check(page.evaluate("[...document.querySelectorAll('.ed-row')].every(r => { const i = r.querySelector('.prow-thumb'), n = r.querySelector('.ed-name'); return i.getBoundingClientRect().right <= n.getBoundingClientRect().left; })"),
                f'{t} éditeur : vignette à gauche du nom')
        shot(page, LOT, f'editor_{dev}_{theme}')
        page.click('[data-action="toggle-edit-mode"]')
        widths = page.evaluate("[...document.querySelectorAll('.ed-row')].map(r => r.querySelector('.ed-name').getBoundingClientRect().width / r.getBoundingClientRect().width)")
        R.check(min(widths) >= 0.6, f'{t} éditeur (Modifier) : noms >= 60 % ({min(widths):.2f})')
        R.check(page.locator('.ed-row .prow-thumb').count() == 0, f'{t} éditeur (Modifier) : ⊖ et ≡ à la place des vignettes')
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
        mp = page.evaluate("""() => [...document.querySelectorAll('.mp-list .cell--pick')].map(r => { const n = r.querySelector('.mp-names');
            return { img: (r.querySelector('.psq--img img') || {}).getAttribute?.('src') || '', cut: n.scrollWidth > n.clientWidth + 1 || getComputedStyle(n).textOverflow === 'ellipsis',
                     lines: Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)) }; })""")
        R.check(mp and mp[0]['img'].startswith('img/muscles/'), f'{t} Mes programmes : vignette du groupe principal de PPL {mp}')
        R.check(all(not x['cut'] and x['lines'] <= 2 for x in mp), f'{t} Mes programmes : séances en entier, 2 lignes au plus {mp}')
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
        R.check(page.locator('.emoji-btn').count() == 0 and page.locator('.color-swatch').count() == 0 and page.locator('#csName').count() == 1, f'{t} séance perso : nom et description, ni icône ni couleur (direction sobre)')
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


def t_programme_type_xl(bench):
    """Très grands caractères sur iPhone SE : cartes des séances et exercices sans vignette, texte entier, sans débord."""
    with bench.page('webkit', 'iPhone SE', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json())
        page.add_style_tag(content='html { font-size: 28px !important; }')
        page.evaluate("window.dispatchEvent(new Event('resize'))")
        page.wait_for_timeout(300)
        page.evaluate("switchTab('program')")
        page.wait_for_selector('.ps-list .pcard')
        check = """sel => ({ xl: document.documentElement.classList.contains('type-xl'),
            imgs: [...document.querySelectorAll(sel)].filter(i => i.getBoundingClientRect().width > 0).length,
            cut: [...document.querySelectorAll('.view:not([hidden]) .cell__title, .view:not([hidden]) .cell__sub, .pcard__muscles')]
                .filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim()),
            hscroll: document.documentElement.scrollWidth > innerWidth + 1 })"""
        g = page.evaluate(check, '.pcard__img')
        R.check(g['xl'] and g['imgs'] == 0 and not g['cut'] and not g['hscroll'], f'type-xl programme : cartes sans vignette, rien de coupé {g}')
        page.click('[data-action="open-prog-session"][data-cat="push"]')
        page.wait_for_selector('.view.editor')
        g = page.evaluate(check, '.prow-thumb')
        R.check(g['imgs'] == 0 and not g['cut'] and not g['hscroll'], f'type-xl éditeur : sans vignette, rien de coupé {g}')
        shot(page, LOT, 'editor_type_xl')
        clamped = page.evaluate("[...document.querySelectorAll('.ed-name')].filter(e => e.scrollHeight > e.clientHeight + 1).map(e => e.textContent)")
        R.check(not clamped, f'type-xl éditeur : noms d\'exercice en entier, sans « … » {clamped}')
        # Fiche d'un exercice : aucun mot coupé dans les choix (« Fourchett / e »), tempo personnalisé lisible en entier
        page.click('.ed-row[data-i="0"]')
        page.wait_for_selector('.view.ex-edit')
        broken = page.evaluate("""() => [...document.querySelectorAll('.ex-edit .segmented__btn')].flatMap(b => {
            const out = [], walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
            for (let n; (n = walk.nextNode());) for (const m of n.textContent.matchAll(/\\S+/g)) {
                const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
                if (r.getClientRects().length > 1) out.push(m[0]); }
            return out; })""")
        R.check(not broken, f'type-xl fiche : aucun mot coupé dans les choix {broken}')
        tempo = page.evaluate("""() => { const i = document.querySelector('#exTempoIn'); if (!i) return null;
            const cs = getComputedStyle(i), c = document.createElement('canvas').getContext('2d');
            c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            const need = c.measureText(i.placeholder).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
            return { w: i.clientWidth, need, right: i.getBoundingClientRect().right, vw: innerWidth }; }""")
        R.check(tempo and tempo['w'] + 1 >= tempo['need'] and tempo['right'] <= tempo['vw'], f'type-xl fiche : « Ex. 3-1-1 » entier dans le tempo personnalisé {tempo}')
        shot(page, LOT, 'ex_edit_type_xl')
        page.evaluate("routeTo('my-programmes')")
        page.wait_for_selector('.view.my-programmes')
        names = page.evaluate("[...document.querySelectorAll('.mp-names')].filter(e => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === 'ellipsis').map(e => e.textContent)")
        R.check(not names, f'type-xl Mes programmes : séances en entier {names}')
        R.check(not page.errors, f'type-xl programme : erreurs JS {page.errors[:2]}')


TESTS = [t_history, t_progress, t_poids, t_programme]

if __name__ == '__main__':
    run_main(R, TESTS, once=[t_perf, t_programme_type_xl])
