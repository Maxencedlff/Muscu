"""Séries notées par bras (docs/UNILATERAL.md) : curl concentration avec un drop set sur les deux bras (G, G allégé,
D, D allégé), repos seulement après le second côté, second côté pré-rempli, enregistrement et historique ; « Noter
chaque bras à part » ; exercices à deux bras inchangés ; texte agrandi."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'unilateral'
R = Results(LOT)
APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def uni_data():
    """Données réalistes + « Curl concentration » en tête de la séance Pull, fait la dernière fois en séries ordinaires
    (14 kg × 10, 10, 9) : une ancienne séance, sans second côté."""
    d = ppl_v2_today()
    d['programmes']['ppl']['exercises']['pull'].insert(0, make_ex('cc1curlc', 'Curl concentration', 3))
    last = max((h for h in d['history'] if h['category'] == 'pull' and h.get('programme', 'ppl') == 'ppl'), key=lambda h: h['date'])
    last['exercises'].insert(0, {'exId': 'cc1curlc', 'name': 'Curl concentration',
                                 'sets': [{'weight': '14', 'reps': '10'}, {'weight': '14', 'reps': '10'}, {'weight': '14', 'reps': '9'}]})
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


def start(page, cat='pull'):
    page.evaluate(f"startSession('{cat}')")
    page.wait_for_selector('.view.session')
    settle(page)


def skip_rest(page):
    for sel in ('.rest-overlay [data-action="skip-rest"]', '.rest-mini__skip'):
        if page.locator(sel).count():
            page.locator(sel).first.click()
            break
    settle(page)


def center(page, sel):
    page.evaluate("s => document.querySelector(s)?.scrollIntoView({ block: 'center' })", sel)
    settle(page)


def cut_texts(page, sel):
    """Textes coupés (débordement) parmi les éléments visibles de sel."""
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1)
        .map(e => e.textContent.trim())""", sel)


SIDE1_DROP = '[data-action="sub-%s"][data-ei="0"][data-si="2"][data-k="0"]:not([data-side])'
SIDE2_DROP = '[data-action="sub-%s"][data-ei="0"][data-si="2"][data-k="0"][data-side="2"]'
SIDE2 = '[data-action="side-%s"][data-ei="0"][data-si="2"]'


def t_drop_deux_bras(bench, eng, dev, theme):
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, uni_data())
        start(page)
        R.check(page.evaluate("activeSession.exercises[0].name") == 'Curl concentration', f'{t} Curl concentration en tête')
        # Ancienne séance (sans second côté) : la séance démarre comme avant, aucune ligne de plus
        R.check(page.locator('.session-set--side').count() == 0 and page.locator('.sets__caption--side').count() == 0, f'{t} séries ordinaires : rien de nouveau')
        # Numéro de la série 3 › Drop set : sur un exercice à un bras, le drop existe de chaque côté
        page.click('[data-action="tech-set"][data-ei="0"][data-si="2"]'); settle(page)
        tap_dialog(page, 'Drop set')
        s = page.evaluate("activeSession.exercises[0].sets[2]")
        R.check(s.get('tech') == 'drop' and s.get('side2', {}).get('sub') and len(s['side2']['sub']) == 1, f'{t} drop set posé des deux côtés {s.get("side2")}')
        # Panel du 20/11 : tout l'exercice passe par bras, pas la seule série 3
        R.check(page.evaluate("activeSession.exercises[0].sets.every(s => !!s.side2)"), f'{t} les trois séries par bras')
        lbls = page.locator('.ex-card[data-ei="0"] .sets__caption--side').all_inner_texts()
        R.check(lbls == ['Bras gauche', 'Bras droit'] * 3, f'{t} côtés en titre au-dessus de leur groupe ({lbls})')
        # Ordre de la série 3 : titre gauche, la ligne, Drop set, son drop, titre droit, la ligne, Drop set, son drop
        order = page.evaluate("""[...document.querySelectorAll('.ex-card[data-ei="0"] .sets__caption--side, .ex-card[data-ei="0"] .session-set, .ex-card[data-ei="0"] .tech__name')]
            .filter(e => !e.matches('.session-set') || e.dataset.si === '2' || e.closest('.tech')).slice(-8).map(r => r.matches('.sets__caption--side') ? r.textContent.trim()
            : r.matches('.tech__name') ? 'Drop set' : r.matches('.session-set--side') ? 'D' : r.matches('.session-set--sub') ? (r.dataset.side === '2' ? 'D+1' : 'G+1') : 'G')""")
        R.check(order == ['Bras gauche', 'G', 'Drop set', 'G+1', 'Bras droit', 'D', 'Drop set', 'D+1'], f'{t} ordre G, G allégé, D, D allégé, chaque bloc titré ({order})')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} pas de défilement horizontal')
        R.check(not cut_texts(page, '.ex-card[data-ei="0"] .sets__caption--side, .ex-card[data-ei="0"] .tech__name'), f'{t} aucun texte coupé {cut_texts(page, ".ex-card[data-ei=\'0\'] .sets__caption--side")}')
        # « Drop 1 » en toutes lettres, plus « +1 » (panel du 20/11)
        tags = [x.replace('\n', ' ') for x in page.locator('.ex-card[data-ei="0"] .tech-tag').all_inner_texts()]
        R.check(tags == ['Drop 1', 'Drop 1'], f'{t} « Drop 1 » sur les deux bras ({tags})')
        center(page, '.ex-card[data-ei="0"] .tech')
        shot(page, LOT, f'{t}-01-drop-pose')

        # Séries 1 et 2 (bras gauche, bras droit sans repos entre les deux), puis la 3 (bras gauche) : le drop suit
        for si in range(2):
            page.click(f'[data-action="validate-set"][data-ei="0"][data-si="{si}"]'); settle(page)
            R.check(page.evaluate("restActive") is False, f'{t} série {si + 1} : pas de repos avant le bras droit')
            page.click(f'[data-action="side-validate"][data-ei="0"][data-si="{si}"]'); settle(page); skip_rest(page)
        page.click('[data-action="validate-set"][data-ei="0"][data-si="2"]'); settle(page)
        R.check(page.evaluate("restActive") is False, f'{t} série 3 : pas de repos avant le drop')
        R.check('Série 3 validée · puis drop set' in sess_undo_text(page), f'{t} « Série 3 validée · puis drop set » ({sess_undo_text(page)!r})')
        R.check(page.locator(SIDE1_DROP % 'reps').evaluate("e => !!e.closest('.session-set--subcur')"), f'{t} drop du bras gauche en cours')
        w1 = page.locator(SIDE1_DROP % 'weight').input_value()
        page.fill(SIDE1_DROP % 'reps', '6')
        page.click(SIDE1_DROP % 'validate'); settle(page)
        # Drop du bras gauche fait : toujours pas de repos, le bras droit suit, pré-rempli avec le bras gauche
        R.check(page.evaluate("restActive") is False, f'{t} drop gauche fait : pas de repos avant le bras droit')
        R.check('puis bras droit' in sess_undo_text(page), f'{t} « Drop 1 validé · puis bras droit » ({sess_undo_text(page)!r})')
        cur = page.evaluate("document.querySelector('.session-set--subcur')?.matches('.session-set--side[data-si=\"2\"]')")
        R.check(cur is True and page.locator('[aria-current="step"]').count() == 1, f'{t} bras droit seul en cours')
        # Compteur : la série 3 n'est pas finie tant que le bras droit et son drop attendent (panel du 20/11)
        cnt = page.locator('.ex-card[data-ei="0"] .ex-card__count [aria-hidden="true"]').inner_text()
        R.check(cnt == '2/3' and page.locator('#session-count').inner_text().startswith('2/'), f'{t} compteur à 2/3 tant que le bras droit attend ({cnt})')
        R.check(page.locator(SIDE2 % 'weight').input_value() == '14' and page.locator(SIDE2 % 'reps').input_value() == '9',
                f'{t} bras droit pré-rempli 14 × 9 ({page.locator(SIDE2 % "weight").input_value()} × {page.locator(SIDE2 % "reps").input_value()})')
        settle(page)
        shot(page, LOT, f'{t}-02-bras-droit')

        # Bras droit : un toucher (pareil que le gauche), puis son drop, pré-rempli avec celui du gauche
        page.click(SIDE2 % 'validate'); settle(page)
        R.check(page.evaluate("restActive") is False, f'{t} bras droit fait : pas de repos avant son drop')
        x = page.evaluate("activeSession.exercises[0].sets[2].side2")
        R.check(x.get('done') is True and x['weight'] == '14' and x['reps'] == '9' and 'auto' not in x, f'{t} bras droit validé 14 × 9 {x}')
        R.check(page.locator(SIDE2_DROP % 'weight').input_value() == w1 and page.locator(SIDE2_DROP % 'reps').input_value() == '6',
                f'{t} drop du bras droit : charge et reps du drop gauche ({page.locator(SIDE2_DROP % "weight").input_value()} / {w1})')
        R.check(page.locator(SIDE2_DROP % 'reps').evaluate("e => !!e.closest('.session-set--subcur')"), f'{t} drop du bras droit en cours')
        page.fill(SIDE2_DROP % 'reps', '5')
        page.click(SIDE2_DROP % 'validate'); settle(page)
        # Dernier bloc du second côté : le repos part enfin
        R.check(page.evaluate("restActive") is True, f'{t} drop droit fait : repos lancé')
        R.check(page.evaluate("restTotal") == page.evaluate("exRest(activeSession.exercises[0])"), f'{t} repos habituel de l\'exercice')
        # Volume : les deux bras et les deux drops
        vol = page.evaluate("exVolume(activeSession.exercises[0], activeSession.exercises[0].sets.filter(s => s.done))")
        exp = page.evaluate("""(() => { const s = activeSession.exercises[0].sets; const v = y => y.weight * y.reps;
            return v(s[0]) + v(s[0].side2) + v(s[1]) + v(s[1].side2) + v(s[2]) + v(s[2].sub[0]) + v(s[2].side2) + v(s[2].side2.sub[0]); })()""")
        R.check(abs(vol - exp) < 0.01, f'{t} volume des deux bras ({vol} = {exp})')
        # Carte repliée : le drop et les deux bras se voient (panel du 20/11)
        lines = [l.replace('\u00a0', ' ') for l in page.locator('.ex-card--collapsed[data-ei="0"] .ex-summary__line').all_inner_texts()]
        R.check(lines[1:] == [f'Drop {w1} kg × 6 · 2 bras'], f'{t} carte repliée : le drop et les deux bras {lines}')
        page.click('.ex-card[data-ei="0"] [data-action="toggle-ex"]'); settle(page)
        center(page, '.ex-card[data-ei="0"] .session-set--side')
        shot(page, LOT, f'{t}-03-repos-apres-bras-droit')

        # Enregistrement : second côté et drops gardés ; historique lisible
        skip_rest(page)
        page.evaluate("activeSession.exercises.slice(1).forEach(ex => ex.sets.forEach(s => { s.done = true; s.reps = s.reps || '10'; }))")
        page.click('[data-action="finish-session"]'); settle(page)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary'); settle(page)
        st = page.evaluate("data.history[0].exercises.find(e => e.name === 'Curl concentration').sets[2]")
        # Volume de la séance par rapport à la dernière fois (14 × 10, 10, 9 sur une ligne) : les deux bras refaits à
        # l'identique ne font pas une hausse, seuls les drops comptent
        R.check(st.get('side2') == {'weight': '14', 'reps': '9', 'sub': [{'weight': w1, 'reps': '5'}]} and st.get('sub') == [{'weight': w1, 'reps': '6'}],
                f'{t} historique : bras droit et son drop {st}')
        R.check(page.evaluate("JSON.parse(localStorage.getItem('ppl_v2')).history[0].exercises[0].sets[2].side2.reps") == '9', f'{t} enregistré sur l\'appareil')
        page.click('[data-action="summary-done"]'); settle(page)
        page.click('[data-action="go-history"]'); settle(page)
        page.locator('.hcell').first.click(); page.wait_for_selector('.view.history-detail'); settle(page)
        notes = [n.replace(' ', ' ').replace(' ', ' ') for n in page.locator('.hex__sets--note').all_inner_texts()]
        R.check(any(n.startswith('Drop set série 3, bras gauche') for n in notes) and 'Bras droit : 14 kg × 10, 10, 9' in notes
                and any(n.startswith('Drop set série 3, bras droit') for n in notes),
                f'{t} détail : lignes des deux bras {notes}')
        page.locator('.hex__sets--note', has_text='bras droit').first.scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-04-historique')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_par_bras(bench, eng, dev, theme):
    """⋯ › Plus d'options › « Noter chaque bras à part » : toutes les séries à faire, sans technique ; un exercice à deux
    bras n'a pas ce choix ; la séance suivante reprend par bras (« pré-remplir avec la dernière fois »)."""
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, uni_data())
        start(page)
        i_two = page.evaluate("activeSession.exercises.findIndex(e => e.name === 'Curl biceps haltères')")
        page.click(f'.ex-card[data-ei="{i_two}"] [data-action="ex-menu"]'); settle(page)
        tap_dialog(page, "Plus d'options"); settle(page)
        labels = page.locator('.ios-dialog__btn').all_inner_texts()
        R.check(not any('bras' in l for l in labels), f'{t} exercice à deux bras : aucun choix « bras » ({labels})')
        tap_dialog(page, 'Annuler'); settle(page)
        page.click('.ex-card[data-ei="0"] [data-action="ex-menu"]'); settle(page)
        tap_dialog(page, "Plus d'options"); settle(page)
        tap_dialog(page, 'Noter chaque bras à part'); settle(page)
        R.check(page.locator('.ex-card[data-ei="0"] .session-set--side').count() == 3, f'{t} trois séries par bras')
        R.check('Chaque bras noté à part' in sess_undo_text(page), f'{t} « Chaque bras noté à part · Annuler » ({sess_undo_text(page)!r})')
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); settle(page)
        R.check(page.evaluate("restActive") is False and 'Série 1 validée · puis bras droit' in sess_undo_text(page), f'{t} série 1 : bras droit sans repos ({sess_undo_text(page)!r})')
        page.click('[data-action="side-validate"][data-ei="0"][data-si="0"]'); settle(page)
        R.check(page.evaluate("restActive") is True, f'{t} bras droit : repos lancé')
        R.check(page.locator('.ex-card[data-ei="0"] .ex-card__count [aria-hidden="true"]').inner_text() == '1/3', f'{t} compteur à 1/3 après le bras droit')
        # Même chose que la dernière fois (14 × 10 des deux bras) : aucune hausse de volume affichée
        R.check(page.locator('.ex-card[data-ei="0"] .ex-vol__delta').count() == 0, f'{t} 14 × 10 refait des deux bras : +0, rien d\'affiché')
        R.check(page.evaluate("activeSession.exercises[0].sets[0].side2.reps") == '10', f'{t} bras droit pris tel que pré-rempli (10)')
        skip_rest(page)
        # Le second côté se rouvre au toucher, ses valeurs gardées
        page.click('[data-action="side-reopen"][data-ei="0"][data-si="0"]'); settle(page)
        R.check(page.evaluate("activeSession.exercises[0].sets[0].side2.done") is False and page.locator('[data-action="side-reps"][data-ei="0"][data-si="0"]').input_value() == '10', f'{t} bras droit rouvert, 10 gardé')
        page.click('[data-action="side-validate"][data-ei="0"][data-si="0"]'); settle(page)
        # Séance suivante : par bras d'office, « Avant » de chaque côté
        page.evaluate("activeSession.exercises.forEach(ex => ex.sets.forEach(s => { s.done = true; s.reps = s.reps || '10'; if (s.side2) { s.side2.done = true; s.side2.reps = '8'; s.side2.weight = '14'; delete s.side2.auto; } }))")
        page.click('[data-action="finish-session"]'); settle(page)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary'); settle(page)
        page.click('[data-action="summary-done"]'); settle(page)
        start(page)
        R.check(page.locator('.ex-card[data-ei="0"] .session-set--side').count() == 3, f'{t} séance suivante : de nouveau par bras')
        prev = page.locator('.ex-card[data-ei="0"] .session-set--side .set-prev').first.inner_text().replace(' ', ' ')
        R.check('14 × 8' in prev, f'{t} « Avant » du bras droit : 14 × 8 ({prev!r})')
        # Avant de valider quoi que ce soit : « +X kg de volume » absent (rien de plus que la dernière fois)
        R.check(page.locator('.ex-card[data-ei="0"] .ex-vol__delta').count() == 0, f'{t} pas de hausse de volume affichée au départ')
        # Premier bras : ⋯ › Plus d'options › Commencer par le bras droit, retenu pour l'exercice
        page.click('.ex-card[data-ei="0"] [data-action="ex-menu"]'); settle(page)
        tap_dialog(page, "Plus d'options"); settle(page)
        tap_dialog(page, 'Commencer par le bras droit'); settle(page)
        caps = page.locator('.ex-card[data-ei="0"] .sets__caption--side').all_inner_texts()[:2]
        R.check(caps == ['Bras droit', 'Bras gauche'] and page.evaluate("sideFirstPref('Curl concentration')") == 'droit', f'{t} commence par le bras droit ({caps})')
        # « Avant » suit son bras : la ligne du bras droit (désormais la première) montre 14 × 8, celle du gauche 14 × 10
        p1 = page.locator('.ex-card[data-ei="0"] .set-swipe .session-set[data-si="0"] .set-prev').first.inner_text().replace('\u00a0', ' ')
        p2 = page.locator('.ex-card[data-ei="0"] .session-set--side[data-si="0"] .set-prev').first.inner_text().replace('\u00a0', ' ')
        R.check('14 × 8' in p1 and '14 × 10' in p2, f'{t} « Avant » suit le bras ({p1!r} / {p2!r})')
        center(page, '.ex-card[data-ei="0"] .session-set--side')
        shot(page, LOT, f'{t}-05-par-bras')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def once_static(bench):
    html = open(os.path.join(APP_DIR, 'index.html'), encoding='utf-8').read()
    sw = open(os.path.join(APP_DIR, 'sw.js'), encoding='utf-8').read()
    for f in ['js/data/unilateral.js', 'js/features/session-unilateral.js']:
        n = sum(1 for _ in open(os.path.join(APP_DIR, f), encoding='utf-8'))
        R.check(n <= 400, f'{f} : {n} lignes (400 au plus)')
        R.check(f in html and '/' + f in sw, f'{f} chargé par index.html et mis en cache par sw.js')


def once_grand_texte(bench):
    """Texte agrandi (AX33) sur iPhone SE et iPhone 13 : lignes des deux bras lisibles, rien de coupé ni de recouvert."""
    css = ("(() => { const st = document.createElement('style'); st.textContent = 'html { font: 33px -apple-system, system-ui, sans-serif !important; }';"
           " const put = () => { if (!document.documentElement) return false; document.documentElement.appendChild(st); return true; };"
           " if (!put()) new MutationObserver((m, o) => { if (put()) o.disconnect(); }).observe(document, { childList: true }); })()")
    for dev in ('iPhone SE', 'iPhone 13'):
        for theme in ('light', 'dark'):
            t = f'{dev}-{theme}-ax33'
            with bench.page('webkit', dev, theme) as page:
                page.add_init_script(css)
                seed(page, theme, uni_data())
                settle(page)
                start(page)
                page.evaluate("setTechOn(0, 2, 'drop')"); settle(page)
                for si in range(2):
                    page.click(f'[data-action="validate-set"][data-ei="0"][data-si="{si}"]'); settle(page)
                    page.click(f'[data-action="side-validate"][data-ei="0"][data-si="{si}"]'); settle(page); skip_rest(page)
                page.click('[data-action="validate-set"][data-ei="0"][data-si="2"]'); settle(page)
                page.fill(SIDE1_DROP % 'reps', '6')
                page.click(SIDE1_DROP % 'validate'); settle(page)
                g = page.evaluate("""() => { const row = document.querySelector('.session-set--side[data-si="2"]'), r = row.getBoundingClientRect();
                    const kids = [...row.querySelectorAll('.set-prev, .set-input, .set-check-zone')].filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect());
                    const cut = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
                    return { inRow: kids.every(k => k.left >= r.left - 1 && k.right <= r.right + 1), overlap: kids.some((a, i) => kids.some((b, j) => j > i && cut(a, b))),
                             hscroll: document.documentElement.scrollWidth > innerWidth + 1, seen: r.top >= document.querySelector('#app .navbar').getBoundingClientRect().bottom - 1 && r.bottom <= innerHeight }; }""")
                R.check(g['inRow'] and not g['overlap'] and not g['hscroll'], f'{t} ligne du bras droit : rien ne dépasse ni ne se recouvre {g}')
                R.check(g['seen'], f'{t} ligne du bras droit à l\'écran quand elle est en cours {g}')
                R.check(not cut_texts(page, '.ex-card[data-ei="0"] .sets__caption--side'), f'{t} « Bras gauche », « Bras droit » entiers')
                # « Annuler » (ou « Note ») de la colonne Avant ne touche jamais le rond ✓ de sa ligne (panel du 20/11)
                gap = page.evaluate("""() => Math.min(...[...document.querySelectorAll('.ex-card[data-ei="0"] .session-set')].map(r => {
                    const a = r.querySelector('.set-undo, .set-note-btn, .set-prev'), c = r.querySelector('.set-check');
                    if (!a || !c) return 99; const ra = a.getBoundingClientRect(), rc = c.getBoundingClientRect();
                    return ra.bottom <= rc.top || ra.top >= rc.bottom ? 99 : rc.left - ra.right; }))""")
                R.check(gap >= 8, f'{t} au moins 8 px entre « Annuler » ou « Note » et le rond ✓ ({gap} px)')
                # « + drop » et × : 44 px dessinés
                sz = page.evaluate("""[...document.querySelectorAll('.ex-card[data-ei="0"] .tech__add, .ex-card[data-ei="0"] .tech__x')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })""")
                R.check(sz and all(w >= 44 and h >= 44 for w, h in sz), f'{t} « + drop » et × d\'au moins 44 px ({sz})')
                shot(page, LOT, f'{t}-grand-texte-bras-droit')


run_main(R, [t_drop_deux_bras, t_par_bras], once=[once_static, once_grand_texte])
