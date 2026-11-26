"""Techniques d'intensification : drop set, rest-pause, top set en séance, prescription du programme,
reprise après fermeture, historique, image partagée (docs/INTENSIFICATION.md)."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'intensif'
R = Results(LOT)
APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def start(page, cat):
    page.evaluate(f"startSession('{cat}')")
    page.wait_for_selector('.view.session')
    settle(page)


def skip_rest(page):
    for sel in ('.rest-overlay [data-action="skip-rest"]', '.rest-mini__skip'):
        if page.locator(sel).count():
            page.locator(sel).first.click()
            break
    settle(page)


def small_targets(page, sel, mini=44):
    """Zones de toucher (bouton ou son ::after) de moins de `mini` px."""
    return page.evaluate("""([sel, mini]) => [...document.querySelectorAll(sel)].map(b => {
        const r = b.getBoundingClientRect(), a = getComputedStyle(b, '::after');
        const padX = a.content && a.content !== 'none' ? -parseFloat(a.left || '0') : 0;
        const padY = a.content && a.content !== 'none' ? -parseFloat(a.top || '0') : 0;
        return [Math.round(r.width + 2 * (isNaN(padX) ? 0 : padX)), Math.round(r.height + 2 * (isNaN(padY) ? 0 : padY))];
    }).filter(([w, h]) => w < mini || h < mini)""", [sel, mini])


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def center(page, sel):
    page.evaluate("s => document.querySelector(s)?.scrollIntoView({ block: 'center' })", sel)
    settle(page)


def t_seance(bench, eng, dev, theme):
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        start(page, 'legs')   # Squat barre : 4 séries à 70 kg la dernière fois

        # ── Menu ⋯ : une seule entrée pour les techniques (panel du 06/11 : « Dernière série en drop set » faisait doublon)
        page.click('.ex-card[data-ei="0"] [data-action="ex-menu"]'); settle(page)
        tap_dialog(page, "Plus d'options"); settle(page)
        labels = page.locator('.ios-dialog__btn').all_inner_texts()
        R.check('Dernière série en drop set' not in labels and labels.count('Technique d\'intensification…') == 1, f'{t} menu ⋯ : une seule entrée technique ({labels})')
        tap_dialog(page, 'Annuler'); settle(page)
        # ── Numéro de la série 4 › Drop set : 2 touchers, sous-ligne à 80 % arrondie aux disques
        page.click('[data-action="tech-set"][data-ei="0"][data-si="3"]'); settle(page)
        tap_dialog(page, 'Drop set')
        s3 = page.evaluate("activeSession.exercises[0].sets[3]")
        R.check(s3.get('tech') == 'drop' and len(s3.get('sub', [])) == 1 and s3['sub'][0].get('auto') is True, f'{t} drop set posé sur la série 4 {s3.get("tech")}')
        sub_w = page.locator('[data-action="sub-weight"][data-ei="0"][data-si="3"][data-k="0"]')
        R.check(sub_w.input_value() == '55', f'{t} charge proposée : 80 % de 70 arrondi à la barre = 55 ({sub_w.input_value()})')
        cap = page.locator('.ex-card[data-ei="0"] .tech__name').inner_text()
        R.check(cap == 'Drop set', f'{t} titre « Drop set » sous la série ({cap})')
        R.check(not small_targets(page, '.tech__add, .tech__x, .set-tech-n, .session-set--sub .set-check-zone'), f'{t} zones de toucher ≥ 44 px {small_targets(page, ".tech__add, .tech__x, .set-tech-n, .session-set--sub .set-check-zone")}')
        R.check(no_hscroll(page), f'{t} pas de défilement horizontal')
        center(page, '.ex-card[data-ei="0"] .tech')
        shot(page, LOT, f'{t}-01-drop-pose')

        # Sous-série avant la série : refusée avec un message
        # ✓ grisé (aria-disabled, comme une série plus bas) : touché quand même, il explique
        page.click('[data-action="sub-validate"][data-ei="0"][data-si="3"][data-k="0"]', force=True); settle(page)
        R.check('Valide d\'abord la série 4' in sess_undo_text(page), f'{t} sous-série après sa série seulement (en ligne, pas de toast)')

        # ── Séries 1 à 4 ; après la 4 : pas de repos, le drop suit
        for si in range(3):
            page.click(f'[data-action="validate-set"][data-ei="0"][data-si="{si}"]'); settle(page); skip_rest(page)
        page.click('[data-action="validate-set"][data-ei="0"][data-si="3"]'); settle(page)
        # Panel du 07/11 : le toast dit d'abord ce que son bouton annule (la série), puis la technique qui suit
        R.check('Série 4 validée · puis drop set' in sess_undo_text(page) and page.locator('.toast').count() == 0,
                f'{t} « Annuler » en ligne : « Série 4 validée · puis drop set » ({sess_undo_text(page)!r})')
        R.check(page.evaluate("restActive") is False, f'{t} drop set : pas de repos avant le drop')
        R.check(page.locator('.session-set--subcur').count() == 1, f'{t} sous-ligne en cours mise en avant')
        # Reps du drop tapées, puis ✓ : charge proposée figée (plus « auto »)
        page.fill('[data-action="sub-reps"][data-ei="0"][data-si="3"][data-k="0"]', '6')
        page.click('[data-action="sub-validate"][data-ei="0"][data-si="3"][data-k="0"]'); settle(page)
        x = page.evaluate("activeSession.exercises[0].sets[3].sub[0]")
        R.check(x.get('done') is True and x['reps'] == '6' and x['weight'] == '55' and 'auto' not in x, f'{t} drop validé : 55 × 6 {x}')
        R.check(page.evaluate("restActive") is True, f'{t} dernier drop : repos habituel lancé')
        R.check('Drop 1 validé' in sess_undo_text(page), f'{t} « Drop 1 validé · Annuler » en ligne')
        # Panel vague 3 : « Annuler » dans la colonne Avant de la sous-série, à l'écran (la bande au-dessus de la carte en sortait)
        settle(page)   # défilement doux terminé
        pos = page.evaluate("""(() => { const b = document.querySelector('[data-action="sess-undo"]'); if (!b) return null;
            const r = b.getBoundingClientRect(), bar = document.querySelector('#app .navbar').getBoundingClientRect().bottom;
            return { place: b.closest('.session-set--sub[data-k="0"]') ? 'ligne' : b.closest('.ex-undo')?.nextElementSibling?.matches('.ex-card--collapsed[data-ei="0"]') ? 'carte repliée' : '?',
                     seen: r.top >= bar - 1 && r.bottom <= innerHeight - (document.querySelector('.rest-mini')?.getBoundingClientRect().height || 0) }; })()""")
        R.check(pos and pos['place'] != '?' and pos['seen'], f'{t} « Annuler » du drop dans sa ligne (ou au-dessus de la carte refermée), visible ({pos})')
        skip_rest(page)
        # Volume de l'exercice : le drop compte (55 × 6 = 330 de plus)
        vol = page.evaluate("exVolume(activeSession.exercises[0], activeSession.exercises[0].sets.filter(s => s.done))")
        base = page.evaluate("activeSession.exercises[0].sets.filter(s => s.done).reduce((a, s) => a + s.weight * s.reps, 0)")
        R.check(abs(vol - base - 330) < 0.01, f'{t} volume avec le drop ({vol} = {base} + 330)')
        # Exercice fini (drop compris) : la carte se replie ; rouverte, « + drop » ajoute une sous-ligne
        R.check(page.locator('.ex-card--collapsed[data-ei="0"]').count() == 1, f'{t} exercice fini : carte repliée')
        page.click('.ex-card[data-ei="0"] [data-action="toggle-ex"]'); settle(page)
        # + drop : une deuxième sous-ligne, 80 % de 55 → 45 (arrondi barre de 20 + paires de 2,5)
        page.click('[data-action="tech-add-sub"][data-ei="0"][data-si="3"]'); settle(page)
        R.check(page.locator('[data-action="sub-weight"][data-ei="0"][data-si="3"][data-k="1"]').input_value() == '45', f'{t} 2e drop : 45 kg proposés')
        center(page, '.ex-card[data-ei="0"] .tech')
        shot(page, LOT, f'{t}-02-drop-valide')

        # ── Numéro d'une série à faire : 2e toucher = rest-pause sur la Presse (même charge)
        page.click('[data-action="tech-set"][data-ei="1"][data-si="1"]'); settle(page)
        R.check(page.locator('.ios-dialog__btn').all_inner_texts()[:5] == ['Drop set', 'Rest-pause', 'Cluster', 'Lourde', 'Allégée'], f'{t} feuille : 5 techniques et Annuler')
        # Panel du 06/11 : « Top set et back-off la marquent » ne disait rien ; chaque technique expliquée en clair
        msg = page.inner_text('.ios-dialog__msg')
        R.check('Lourde : la série la plus lourde' in msg and 'Allégée : une série plus légère ensuite' in msg and 'la marquent' not in msg, f'{t} feuille : explication en clair ({msg!r})')
        tap_dialog(page, 'Rest-pause')
        w = page.evaluate("activeSession.exercises[1].sets[1].weight")
        R.check(page.locator('[data-action="sub-weight"][data-ei="1"][data-si="1"][data-k="0"]').input_value() == page.evaluate(f"fmtW('{w}', {{ plain: true }})"), f'{t} rest-pause : même charge que la série')
        # Top set sur la 1re série de la presse : étiquette sans sous-ligne
        page.click('[data-action="tech-set"][data-ei="1"][data-si="0"]'); settle(page)
        tap_dialog(page, 'Lourde')
        # Panel du 16/11 : top set en pastille dans la ligne de sa série (plus de ligne à part avec un ×)
        R.check(page.locator('.ex-card[data-ei="1"] .tech').count() == 1 and page.locator('.ex-card[data-ei="1"] .session-set[data-si="0"] .tech-pill').count() == 1
                and page.locator('.ex-card[data-ei="1"] .session-set--sub').count() == 1, f'{t} top set : pastille dans sa ligne, rest-pause : une sous-ligne')
        center(page, '.ex-card[data-ei="1"] .tech')
        shot(page, LOT, f'{t}-03-rest-pause-top-set')
        # Mollets debout (poids du corps) : technique possible ; Annuler ne pose rien
        page.click('[data-action="tech-set"][data-ei="1"][data-si="2"]'); settle(page)
        tap_dialog(page, 'Annuler')
        R.check(page.evaluate("activeSession.exercises[1].sets[2].tech") is None, f'{t} Annuler : rien posé')

        # ── Séance fermée puis rouverte : techniques et sous-séries restaurées
        page.reload(); page.wait_for_selector('#app > *'); settle(page)
        page.evaluate("navigate('session')"); page.wait_for_selector('.view.session'); settle(page)
        R.check(page.locator('.ex-card[data-ei="0"] .session-set--sub').count() == 2 and page.locator('.ex-card[data-ei="1"] .tech').count() == 1 and page.locator('.ex-card[data-ei="1"] .tech-pill').count() == 1, f'{t} reprise : sous-lignes restaurées')

        # ── Enregistrement : drop validé gardé, drop non fait écarté ; rest-pause sans sous-série validée : retiré
        page.evaluate("activeSession.exercises.slice(1).forEach(ex => ex.sets.forEach(s => { s.done = true; s.reps = s.reps || '10'; }))")
        page.click('[data-action="finish-session"]'); settle(page)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary'); settle(page)
        h = page.evaluate("data.history[0].exercises.slice(0, 2).map(e => e.sets.map(s => [s.tech ?? null, s.sub ?? null]))")
        R.check(h[0][3] == ['drop', [{'weight': '55', 'reps': '6'}]] and h[0][0] == [None, None], f'{t} historique : drop set 55 × 6 {h[0]}')
        R.check(h[1][0] == ['top', None] and h[1][1] == [None, None], f'{t} historique : top set gardé, rest-pause vide retiré {h[1][:2]}')
        recs = page.evaluate("data.history[0].records.map(r => [r.ex, r.kind, r.after])")
        R.check(not any(r[0] == 'Squat barre' and r[2] in (55, 45) for r in recs), f'{t} un drop ne bat aucun record {recs}')
        page.click('[data-action="summary-done"]'); settle(page)
        page.click('[data-action="go-history"]'); settle(page)
        page.locator('.hcell').first.click(); page.wait_for_selector('.view.history-detail'); settle(page)
        notes = page.locator('.hex__sets--note').all_inner_texts()
        R.check('Drop set série 4 : 55 kg × 6' in notes and any(n.startswith('Lourde série 1') for n in notes), f'{t} détail : lignes Drop set et Top set {notes}')
        page.locator('.hex__sets--note', has_text='Drop set').scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-04-historique')
        # Image partagée : détail des séries suivi du drop
        row = page.evaluate("shareStoryStats(data.history[0]).highlights.find(r => r.name === 'Squat barre')")
        R.check(row and row.get('sets', '').endswith(', drop set 55 kg × 6'), f'{t} partage : « {row and row.get("sets")} »')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_programme(bench, eng, dev, theme):
    """Programme › Exercice : technique prescrite, puis posée au démarrage de la séance (« Avant » repris)."""
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        d = ppl_v2_today()
        # La dernière séance push : drop set sur la dernière série du développé couché
        last = next(h for h in d['history'] if h['category'] == 'push')
        last['exercises'][0]['sets'][-1].update(tech='drop', sub=[{'weight': '20', 'reps': '7'}])
        seed(page, theme, json.dumps(d, ensure_ascii=False))
        page.evaluate("navigate(makeRoute('editor', 'push'))"); page.wait_for_selector('.view.editor'); settle(page)
        page.locator('.ed-row').first.click(); page.wait_for_selector('.view.ex-edit'); settle(page)
        cell = page.locator('[data-action="ex-intens"]')
        R.check(cell.count() == 1 and 'Aucune' in cell.inner_text(), f'{t} fiche : technique « Aucune »')
        cell.click(); settle(page)
        tap_dialog(page, 'Drop set')
        where = page.locator('[data-action="ex-intens-where"]')
        R.check('Drop set' in cell.inner_text() and where.count() == 1 and 'Dernière' in where.inner_text(), f'{t} fiche : technique, puis « Sur quelle série : Dernière » par défaut')
        cell.scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-05-fiche-programme')
        page.click('[data-action="save-ex"]'); page.wait_for_selector('.view.editor'); settle(page)
        R.check(page.evaluate("data.programmes.ppl.exercises.push[0].intens") == 'drop-last', f'{t} programme : intens enregistré')
        R.check('dernière en drop set' in page.locator('.ed-row').first.inner_text(), f'{t} liste : « dernière en drop set »')
        # Envoyé par un coach : le champ passe le nettoyage et l'import
        sent = page.evaluate("cleanSentProgramme(programmeToSent(data, 'ppl')).sessions.find(s => s.key === 'push').exercises[0].intens")
        R.check(sent == 'drop-last', f'{t} programme envoyé : intens gardé ({sent})')
        start(page, 'push')
        s = page.evaluate("activeSession.exercises[0].sets.at(-1)")
        sub_w = page.locator('[data-action="sub-weight"][data-ei="0"]').last.input_value()
        R.check(s.get('tech') == 'drop' and s['sub'][0]['prev'] == {'weight': '20', 'reps': '7'} and sub_w == '20', f'{t} séance : drop posé, « Avant » 20 × 7, charge 20 reprise ({sub_w}) {s.get("sub")}')
        prev = page.locator('.ex-card[data-ei="0"] .session-set--sub .set-prev').inner_text()
        R.check('20' in prev and '7' in prev, f'{t} colonne Avant de la sous-ligne ({prev})')
        R.check(page.evaluate("activeSession.exercises[1].sets.some(s => s.tech)") is False, f'{t} autres exercices sans technique')
        center(page, '.ex-card[data-ei="0"] .tech')
        shot(page, LOT, f'{t}-06-seance-prescrite')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def open_ex_edit(page, cat, i=0):
    page.evaluate(f"navigate(makeRoute('editor', '{cat}'))"); page.wait_for_selector('.view.editor'); settle(page)
    page.locator('.ed-row').nth(i).click(); page.wait_for_selector('.view.ex-edit'); settle(page)


def t_programme_series(bench, eng, dev, theme):
    """Retour d'un coach du 24/11 : le cluster sur la PREMIÈRE série. Programme › Exercice › Sur quelle série, enregistré,
    envoyé à l'élève, posé au démarrage ; cluster en 1re série en séance (pause de 20 s, puis repos habituel) ;
    « Plusieurs séries » (cases)."""
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        open_ex_edit(page, 'legs')   # Squat barre, 4 séries
        page.click('[data-action="ex-intens"]'); settle(page)
        tap_dialog(page, 'Cluster')
        page.click('[data-action="ex-intens-where"]'); settle(page)
        labels = page.locator('.ios-dialog__btn').all_inner_texts()
        R.check(labels[:6] == ['✓ Dernière (par défaut)', 'Première', 'Toutes', 'Série 2', 'Série 3', 'Plusieurs séries…'], f'{t} « Sur quelle série ? » : Dernière, Première, Toutes, Série n, Plusieurs ({labels})')
        shot(page, LOT, f'{t}-20-sur-quelle-serie')
        tap_dialog(page, 'Première')
        where = page.locator('[data-action="ex-intens-where"]')
        R.check('Première' in where.inner_text(), f'{t} fiche : « Première » affiché ({where.inner_text()!r})')
        where.scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-21-fiche-premiere')
        page.click('[data-action="save-ex"]'); page.wait_for_selector('.view.editor'); settle(page)
        ex = page.evaluate("data.programmes.ppl.exercises.legs[0]")
        R.check(ex.get('intens') == 'cluster-last' and ex.get('intensOn') == {'plan': 'cluster-last', 'sets': [1]}, f'{t} programme : clé d\'avant + séries choisies ({ex.get("intens")}, {ex.get("intensOn")})')
        R.check('1re en cluster' in page.locator('.ed-row').first.inner_text(), f'{t} liste : « 1re en cluster »')
        # Coach : la prescription envoyée porte la série choisie
        sent = page.evaluate("cleanSentProgramme(programmeToSent(data, 'ppl')).sessions.find(s => s.key === 'legs').exercises[0]")
        R.check(sent.get('intensOn') == {'plan': 'cluster-last', 'sets': [1]}, f'{t} programme envoyé : série 1 ({sent.get("intensOn")})')
        R.check('1re en cluster' in ' '.join(page.evaluate("coachExPlanParts(cleanSentProgramme(programmeToSent(data, 'ppl')).sessions.find(s => s.key === 'legs').exercises[0])")), f'{t} écran Envoyer : « 1re en cluster »')
        # Plusieurs séries : cases à cocher sur la Presse (4 séries) : 1 et 3
        open_ex_edit(page, 'legs', 1)
        page.click('[data-action="ex-intens"]'); settle(page)
        tap_dialog(page, 'Drop set')
        page.click('[data-action="ex-intens-where"]'); settle(page)
        tap_dialog(page, 'Plusieurs séries')
        boxes = page.locator('[data-action="ex-intens-set"]')
        R.check(boxes.count() == 4 and [b.get_attribute('aria-checked') for b in boxes.all()] == ['false', 'false', 'false', 'true'], f'{t} plusieurs : 4 cases, la dernière cochée')
        page.click('[data-action="ex-intens-set"][data-n="1"]'); settle(page)
        page.click('[data-action="ex-intens-set"][data-n="3"]'); settle(page)
        page.click('[data-action="ex-intens-set"][data-n="4"]'); settle(page)
        R.check([b.get_attribute('aria-checked') for b in boxes.all()] == ['true', 'false', 'true', 'false'] and 'Séries 1 et 3' in page.locator('[data-action="ex-intens-where"]').inner_text(), f'{t} plusieurs : séries 1 et 3 cochées, affichées')
        page.locator('[data-action="ex-intens-set"]').last.scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-22-plusieurs-series')
        page.click('[data-action="save-ex"]'); page.wait_for_selector('.view.editor'); settle(page)
        ex1 = page.evaluate("data.programmes.ppl.exercises.legs[1]")
        R.check(ex1.get('intens') == 'drop-last' and ex1.get('intensOn') == {'plan': 'drop-last', 'sets': [1, 3]}, f'{t} plusieurs : enregistré {ex1.get("intensOn")}')
        R.check('séries 1 et 3 en drop set' in page.locator('.ed-row').nth(1).inner_text(), f'{t} liste : « séries 1 et 3 en drop set »')

        # Séance : cluster sur la 1re série du squat, drops sur les séries 1 et 3 de la presse
        start(page, 'legs')
        R.check(page.evaluate("activeSession.exercises[0].sets.map(s => s.tech || null)") == ['cluster', None, None, None], f'{t} séance : cluster sur la série 1 seulement')
        R.check(page.evaluate("activeSession.exercises[1].sets.map(s => s.tech || null)") == ['drop', None, 'drop', None], f'{t} séance : drops sur les séries 1 et 3')
        R.check(page.locator('.ex-card[data-ei="0"] .tech').count() == 1, f'{t} bloc « Cluster » sous la série 1')
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); settle(page)
        nxt = ' '.join(page.locator('.rest-mini__next').text_content().replace(' ', ' ').split())
        R.check('Ensuite : Bloc 1' in nxt and page.locator('.session-set--subcur').count() == 1, f'{t} série 1 : pause de cluster, « Ensuite : Bloc 1 » ({nxt})')
        R.check(abs(page.evaluate("Math.round((restEndTime - Date.now()) / 1000)") - 20) <= 2, f'{t} pause de 20 s avant le bloc')
        center(page, '.ex-card[data-ei="0"] .tech')
        shot(page, LOT, f'{t}-23-seance-cluster-premiere')
        skip_rest(page)
        page.fill('[data-action="sub-reps"][data-ei="0"][data-si="0"][data-k="0"]', '3')
        page.click('[data-action="sub-validate"][data-ei="0"][data-si="0"][data-k="0"]'); settle(page)
        R.check(page.evaluate("restActive") is True and 'Série 2' in page.locator('.rest-mini__next').text_content(), f'{t} bloc fait : repos habituel, la série 2 est annoncée')
        R.check(abs(page.evaluate("Math.round((restEndTime - Date.now()) / 1000)") - page.evaluate("exRest(activeSession.exercises[0])")) <= 2, f'{t} repos de l\'exercice après le bloc')
        skip_rest(page)
        # Fin de séance (série par série) : volume avec le bloc, record jamais sur le bloc
        for si in (1, 2, 3):
            page.click(f'[data-action="validate-set"][data-ei="0"][data-si="{si}"]'); settle(page); skip_rest(page)
        vol = page.evaluate("exVolume(activeSession.exercises[0], activeSession.exercises[0].sets.filter(s => s.done))")
        base = page.evaluate("activeSession.exercises[0].sets.filter(s => s.done).reduce((a, s) => a + s.weight * s.reps, 0)")
        blk = page.evaluate("(s => s.weight * s.reps)(activeSession.exercises[0].sets[0].sub[0])")
        R.check(abs(vol - base - blk) < 0.01 and blk > 0, f'{t} volume : séries + bloc de la série 1 ({vol} = {base} + {blk})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_seance_series(bench, eng, dev, theme):
    """En séance, ⋯ › Plus d'options › Technique : drop set sur la 2e série (repos normal après la 1re, pas de repos
    avant le drop, repos habituel après) ; « Toutes les séries » en un geste, un seul « Annuler »."""
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        start(page, 'legs')
        page.click('.ex-card[data-ei="0"] [data-action="ex-menu"]'); settle(page)
        tap_dialog(page, "Plus d'options"); settle(page)
        tap_dialog(page, "Technique d'intensification"); settle(page)
        labels = page.locator('.ios-dialog__btn').all_inner_texts()
        R.check(len(labels) >= 6 and labels[0].startswith('Série 1') and labels[4] == 'Toutes les séries', f'{t} « Sur quelle série ? » : chaque série puis « Toutes les séries » ({labels})')
        shot(page, LOT, f'{t}-24-seance-sur-quelle-serie')
        tap_dialog(page, 'Série 2')
        tap_dialog(page, 'Drop set')
        R.check(page.evaluate("activeSession.exercises[0].sets.map(s => s.tech || null)") == [None, 'drop', None, None], f'{t} drop set sur la série 2')
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); settle(page)
        R.check(page.evaluate("restActive") is True, f'{t} série 1 : repos habituel')
        skip_rest(page)
        page.click('[data-action="validate-set"][data-ei="0"][data-si="1"]'); settle(page)
        R.check(page.evaluate("restActive") is False and 'Série 2 validée · puis drop set' in sess_undo_text(page), f'{t} série 2 : pas de repos, le drop suit ({sess_undo_text(page)!r})')
        page.fill('[data-action="sub-reps"][data-ei="0"][data-si="1"][data-k="0"]', '6')
        page.click('[data-action="sub-validate"][data-ei="0"][data-si="1"][data-k="0"]'); settle(page)
        R.check(page.evaluate("restActive") is True and 'Série 3' in page.locator('.rest-mini__next').text_content(), f'{t} drop fait : repos habituel, série 3 annoncée')
        skip_rest(page)
        center(page, '.ex-card[data-ei="0"] .tech')
        shot(page, LOT, f'{t}-25-seance-drop-serie2')
        # Toutes les séries de la presse en rest-pause, puis Annuler : rien ne reste
        page.click('.ex-card[data-ei="1"] [data-action="ex-menu"]'); settle(page)
        tap_dialog(page, "Plus d'options"); settle(page)
        tap_dialog(page, "Technique d'intensification"); settle(page)
        tap_dialog(page, 'Toutes les séries')
        labels = page.locator('.ios-dialog__btn').all_inner_texts()
        R.check(labels[:3] == ['Drop set', 'Rest-pause', 'Cluster'] and 'Lourde' not in labels, f'{t} toutes : drop set, rest-pause, cluster ({labels})')
        tap_dialog(page, 'Rest-pause')
        R.check(page.evaluate("activeSession.exercises[1].sets.every(s => s.tech === 'rp' && s.sub.length === 1)"), f'{t} toutes les séries en rest-pause')
        R.check('Rest-pause · toutes les séries' in sess_undo_text(page), f'{t} « Annuler » : « Rest-pause · toutes les séries » ({sess_undo_text(page)!r})')
        sess_undo(page)
        R.check(page.evaluate("activeSession.exercises[1].sets.every(s => !s.tech && !s.sub)"), f'{t} Annuler : plus aucune technique')
        R.check(page.evaluate("activeSession.exercises[0].sets[1].tech") == 'drop', f'{t} le drop du squat reste')
        R.check(no_hscroll(page), f'{t} pas de défilement horizontal')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_un_bras_series(bench, eng, dev, theme):
    """Exercice à un bras : programme « drop set sur la 1re série » ; bras gauche, son drop, bras droit, son drop, puis
    seulement le repos ; volume des deux côtés."""
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        d = ppl_v2_today()
        cc = make_ex('cc1curlc', 'Curl concentration', 3)
        cc.update(intens='drop-last', intensOn={'plan': 'drop-last', 'sets': [1]})
        d['programmes']['ppl']['exercises']['pull'].insert(0, cc)
        seed(page, theme, json.dumps(d, ensure_ascii=False))
        start(page, 'pull')
        sets = page.evaluate("activeSession.exercises[0].sets")
        R.check([s.get('tech') for s in sets] == ['drop', None, None] and all(s.get('side2') for s in sets) and sets[0]['side2'].get('sub'),
                f'{t} drop set sur la série 1, les deux bras, tout l\'exercice par bras')
        # Jamais fait : charge et reps à taper (la ligne du bras droit les reprend)
        page.fill('[data-action="set-weight"][data-ei="0"][data-si="0"]', '14')
        page.fill('[data-action="set-reps"][data-ei="0"][data-si="0"]', '10')
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); settle(page)
        R.check(page.evaluate("restActive") is False, f'{t} bras gauche : pas de repos, son drop suit')
        page.fill('[data-action="sub-reps"][data-ei="0"][data-si="0"][data-k="0"]:not([data-side])', '6')
        page.click('[data-action="sub-validate"][data-ei="0"][data-si="0"][data-k="0"]:not([data-side])'); settle(page)
        R.check(page.evaluate("restActive") is False, f'{t} drop du bras gauche : pas de repos, le bras droit suit')
        page.click('[data-action="side-validate"][data-ei="0"][data-si="0"]'); settle(page)
        R.check(page.evaluate("restActive") is False, f'{t} bras droit : pas de repos, son drop suit')
        page.fill('[data-action="sub-reps"][data-ei="0"][data-si="0"][data-k="0"][data-side="2"]', '5')
        page.click('[data-action="sub-validate"][data-ei="0"][data-si="0"][data-k="0"][data-side="2"]'); settle(page)
        R.check(page.evaluate("restActive") is True, f'{t} drop du bras droit : le repos seulement maintenant')
        s0 = page.evaluate("activeSession.exercises[0].sets[0]")
        vol = page.evaluate("setsVolume([activeSession.exercises[0].sets[0]])")
        w = lambda x: float(x.get('weight') or 0) * int(x.get('reps') or 0)
        exp = w(s0) + w(s0['sub'][0]) + w(s0['side2']) + w(s0['side2']['sub'][0])
        R.check(abs(vol - exp) < 0.01 and vol > 0, f'{t} volume : deux bras et leurs drops ({vol} = {exp})')
        skip_rest(page)
        center(page, '.ex-card[data-ei="0"] .tech')
        shot(page, LOT, f'{t}-26-un-bras-drop-serie1')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def in_view(page, sel):
    return page.evaluate("""s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect();
        return r.bottom > 60 && r.top < innerHeight - 60; }""", sel)


def t_saute(bench, eng, dev, theme):
    """Drop sauté : ni la carte ni l'écran ne s'y arrêtent ; rattrapé pendant un repos : le repos ne bouge pas."""
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        start(page, 'legs')
        page.evaluate("setTechOn(0, 0, 'drop')"); settle(page)
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); settle(page)
        R.check(page.locator('.session-set--subcur').count() == 1, f'{t} drop en cours juste après sa série')
        for si in (1, 2, 3):   # le drop est sauté : on enchaîne les séries
            page.click(f'[data-action="validate-set"][data-ei="0"][data-si="{si}"]'); settle(page)
            R.check(page.locator('.session-set--subcur').count() == 0 and in_view(page, '.session-set--current'),
                    f'{t} après la série {si + 1} : plus de drop mis en avant, série en cours visible')
            skip_rest(page)
        R.check(page.locator('.ex-card--collapsed[data-ei="0"]').count() == 1, f'{t} fin de l\'exercice : carte repliée malgré le drop sauté')
        # Rattrapage pendant le repos de la presse
        page.click('[data-action="validate-set"][data-ei="1"][data-si="0"]'); settle(page)
        end0 = page.evaluate('restActive && restEndTime')
        page.click('.ex-card[data-ei="0"] [data-action="toggle-ex"]'); settle(page)
        page.fill('[data-action="sub-reps"][data-ei="0"][data-si="0"][data-k="0"]', '6')
        page.click('[data-action="sub-validate"][data-ei="0"][data-si="0"][data-k="0"]'); settle(page)
        R.check(bool(end0) and page.evaluate('restActive && restEndTime') == end0, f'{t} rattrapage : repos en cours intact')
        R.check(page.evaluate('activeSession.exercises[0].sets[0].sub[0].done') is True, f'{t} rattrapage : drop noté')
        sess_undo(page)
        R.check(page.evaluate('restActive && restEndTime') == end0 and page.evaluate('activeSession.exercises[0].sets[0].sub[0].done') is False,
                f'{t} Annuler : drop à refaire, repos d\'avant gardé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_superset(bench, eng, dev, theme):
    """Drop set dans un superset : drop juste après A1 (sans repos), puis l'exercice B du tour, repos en fin de tour."""
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        start(page, 'push')
        page.evaluate("activeSession.exercises[0].ss = 'a1'; activeSession.exercises[1].ss = 'a1'; ssNormalize(activeSession.exercises); persistSession(); render()")
        page.evaluate("setTechOn(0, 0, 'drop')"); settle(page)
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); settle(page)
        R.check('puis drop set' in sess_undo_text(page) and page.evaluate('restActive') is False, f'{t} A1 : le drop suit, sans repos')
        R.check(page.locator('.ss-card .session-set--subcur').count() == 1, f'{t} drop mis en avant dans le tour')
        page.evaluate("document.querySelector('.ss-card .tech').scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'{t}-11-superset-drop')
        page.fill('[data-action="sub-reps"][data-ei="0"][data-si="0"][data-k="0"]', '6')
        page.click('[data-action="sub-validate"][data-ei="0"][data-si="0"][data-k="0"]'); settle(page)
        name1 = page.evaluate('activeSession.exercises[1].name')
        R.check(f'Drop 1 validé · enchaîne {name1}' in sess_undo_text(page)
                and page.evaluate('restActive') is False, f'{t} après le drop : « Drop 1 validé · enchaîne {name1} », pas de repos')
        page.click('[data-action="validate-set"][data-ei="1"][data-si="0"]'); settle(page)
        R.check(page.evaluate('restActive') is True, f'{t} fin du tour : repos')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_record_force(bench, eng, dev, theme):
    """Sous-série forgée 500 kg × 20 dans l'historique : records, meilleure série, 1RM, niveau de force inchangés."""
    if theme != 'dark' or dev not in ('iPhone 13', 'Pixel 7'):
        return
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        r = page.evaluate("""() => {
            const lift = strengthLiftOf('Squat barre');
            const snap = () => { const h = data.history.find(h => h.category === 'legs'), ex = h.exercises[0];
              return JSON.stringify([data.programmes.ppl.exercises.legs[0].pr, data.programmes.ppl.exercises.legs[0].est1RM,
                entryRecords(h, data.history), bestSet(ex.sets, ex), exPoint(h, ex).best1RM, exPoint(h, ex).maxLoad,
                lift ? liftBestE1rm(data.history, lift) : 'pas de repère']); };
            const before = snap();
            const h = data.history.find(h => h.category === 'legs');
            h.exercises[0].sets.at(-1).tech = 'drop'; h.exercises[0].sets.at(-1).sub = [{ weight: '500', reps: '20' }];
            recomputePRFromHistory(); dataVersion++;
            return { before, after: snap(), vol: exPoint(h, h.exercises[0]).volume };
        }""")
        R.check(r['before'] == r['after'] and 'pas de repère' not in r['before'], f'{t} sous-série forgée : records, 1RM et niveau de force inchangés {r}')
        R.check(r['vol'] > 10000, f'{t} mais elle compte dans le volume ({r["vol"]})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_ami_coach(bench, eng, dev, theme):
    """Séance d'un ami et d'un élève reçue du serveur simulé (même liste blanche que la migration
    20261106100000) : drop set, top set et prise (js/data/grips.js) affichés, valeurs forgées jamais montrées."""
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
        page.add_init_script(FAKE_ACCOUNT)
        page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
        seed(page, theme, ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
        settle(page)
        page.evaluate("""async () => {
            await accountSignInWith('apple', async () => 'add');
            await accountSaveProfile({ username: 'max' });
            await socialEnable(true);
        }""")
        settle(page)
        now = int(time.time() * 1000)
        sess = lambda sid: {'id': sid, 'date': now - 86400_000, 'duration': 3000_000, 'programme': 'ppl', 'category': 'pull', 'label': 'Pull',
                            'exercises': [{'name': 'Tirage vertical', 'grip': {'hand': 'neutre', 'width': 'geante', 'handle': 'fuite'},
                                           'sets': [{'weight': '60', 'reps': '10', 'tech': 'drop', 'sub': [{'weight': '46', 'reps': '5'}, {'weight': '1e9', 'reps': '3'}]},
                                                    {'weight': '70', 'reps': '3', 'tech': 'top'},
                                                    {'weight': '60', 'reps': '8', 'tech': 'myo', 'sub': [{'weight': '1', 'reps': '9'}]}]}]}
        page.evaluate("""([a, b]) => {
            const me = __sb.meId();
            __sb.makeCoach(me);
            const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', sessions: [a] });
            __sb.follow(me, lea, 'accepted');
            const tom = __sb.addPerson({ username: 'tom', social: false, sessions: [b] });
            __sb.link(me, tom, Date.now() - 5 * 86400000);
        }""", [sess('f1'), sess('c1')])
        page.evaluate('Promise.all([socialRefresh(), coachRefresh()])')
        settle(page)
        # Ami : détail de la séance
        page.click('.tabbar [data-tab="friends"]'); settle(page)
        page.click('.social-seg [data-seg="friends"]')   # compte coach : l'onglet Coach s'ouvre sur ses élèves
        page.wait_for_selector('.feed-card[data-id="f1"]')
        page.locator('.feed-card[data-id="f1"] .feed-card__main').click()
        page.wait_for_selector('.social-session-view')
        notes = page.locator('.social-session-view .hex__sets--note').all_inner_texts()
        R.check('Drop set série 1 : 46 kg × 5' in notes and 'Lourde série 2' in notes and 'Prise neutre' in notes, f'{t} ami : drop set, top set et prise ({notes})')
        d = page.inner_text('.social-session-view')
        R.check('myo' not in d.lower() and '× 9' not in d and 'geante' not in d and 'fuite' not in d, f'{t} ami : valeurs forgées jamais montrées')
        got = page.evaluate("social.feeds[''].rows.find(r => r.id === 'f1').s.exercises[0]")
        R.check(got.get('grip') == {'hand': 'neutre'} and got['sets'][0].get('sub') == [{'weight': '46', 'reps': '5'}] and 'tech' not in got['sets'][2], f'{t} ami : séance reçue nettoyée {got}')
        page.locator('.social-session-view .hex__sets--note', has_text='Drop set').scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-09-seance-ami')
        # Coach : séance de l'élève
        page.click('[data-action="back"]'); settle(page)
        page.click('.social-seg [data-seg="students"]'); page.wait_for_selector('.coach-team .coach-student-row')
        page.locator('.coach-student-row', has_text='tom').click(); page.wait_for_selector('.coach-sess')
        page.click('.coach-sess[data-id="c1"]'); page.wait_for_selector('.coach-session-view')
        notes = page.locator('.coach-session-view .hex__sets--note').all_inner_texts()
        R.check('Drop set série 1 : 46 kg × 5' in notes and 'Lourde série 2' in notes and 'Prise neutre' in notes, f'{t} coach : drop set, top set et prise ({notes})')
        R.check('myo' not in page.inner_text('.coach-session-view').lower(), f'{t} coach : technique inconnue jamais montrée')
        page.locator('.coach-session-view .hex__sets--note', has_text='Drop set').scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-10-seance-eleve')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def native_rest(page):
    """Appel natif simulé : texte de la notification de fin de repos et données de la Live Activity."""
    return page.evaluate("""() => {
        const keep = { isNative: Native.isNative, schedule: Native.scheduleRestEnd, live: Native.liveActivity };
        const got = {};
        Native.isNative = true;
        Native.scheduleRestEnd = (end, body) => { got.body = body; };
        Native.liveActivity = { start: p => { got.next = p.next; }, update: p => { got.next = p.next; }, end() {} };
        try { syncNativeRest(); } finally {
            Native.isNative = keep.isNative; Native.scheduleRestEnd = keep.schedule; Native.liveActivity = keep.live;
            restActivityLive = false;
        }
        return got;
    }""")


def t_pause_annonce(bench, eng, dev, theme):
    """Pause d'un rest-pause ou d'un cluster : « Ensuite », la notification et la Live Activity annoncent
    la reprise (ou le bloc) avec sa charge, pas la série suivante."""
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        start(page, 'legs')
        page.evaluate("setTechOn(0, 0, 'rp'); setTechOn(1, 0, 'cluster')")
        settle(page)
        name0, name1 = page.evaluate("activeSession.exercises.slice(0, 2).map(e => e.name)")
        kg0 = page.evaluate("fmtW(subWeightKg(activeSession.exercises[0].sets[0], 0), { plain: true })")
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); settle(page)
        R.check(page.evaluate("restActive && restTotal === 15"), f'{t} rest-pause : pause de 15 s')
        # VoiceOver : le bouton de la barre dit le temps restant (avant : « Repos en cours » seul)
        lbl = page.get_attribute('.rest-mini__main', 'aria-label')
        R.check(lbl.startswith('Repos, il reste ') and 'seconde' in lbl and lbl.endswith('ouvrir le détail'), f'{t} barre de repos : temps restant dit ({lbl})')
        # Panel du 06/11 : « Ensuite : Rowing haltère u… » coupé sur iPhone. Pendant la pause, la barre tait le nom
        # (l'exercice qu'on vient de faire, dit aux lecteurs d'écran) et montre la reprise entière
        vis = ' '.join(page.evaluate("[...document.querySelectorAll('.rest-mini__next > :not(.sr-text)')].map(e => e.textContent).join('')").replace(' ', ' ').split())
        R.check(vis.startswith(f'Ensuite : Mini-série 1 · {kg0} kg') and name0 not in vis and 'Série 2' not in vis, f'{t} rest-pause : « Ensuite » annonce la reprise, sans le nom ({vis})')
        R.check(page.locator('.rest-mini__next .sr-text').text_content().strip(', ') == name0, f'{t} rest-pause : nom de l\'exercice dit au lecteur d\'écran')
        R.check(page.evaluate("""(() => { const n = document.querySelector('.rest-mini__next'), r = n.getBoundingClientRect();
            return [...n.children].filter(e => !e.matches('.sr-text')).every(e => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= r.right + 1); })()"""),
            f'{t} rest-pause : ligne « Ensuite » jamais coupée')
        # Une seule chose en cours : la reprise, pas la série 2
        R.check(page.locator('.session-set--subcur').count() == 1 and page.locator('.session-set--current').count() == 0
                and page.locator('[aria-current="step"]').count() == 1, f'{t} rest-pause : seule la reprise est mise en avant')
        # Vague 3 : pas de toast, « Annuler » en ligne ; la mini-série à faire reste visible sous la barre
        R.check(page.evaluate("""(() => { const r = document.querySelector('.session-set--subcur').getBoundingClientRect();
            return !document.querySelector('.toast') && r.top >= document.querySelector('.navbar').getBoundingClientRect().bottom; })()"""),
            f'{t} rest-pause : la mini-série visible, aucun toast')
        shot(page, LOT, f'{t}-11-pause-reprise')
        # Panel du 07/11 (iPhone SE) : passé en haut, le toast cachait le titre « Reps en réserve » de la série validée
        rir = page.evaluate("""(() => { const t = document.querySelector('.toast'); if (!t) return 'pas de toast';
            const b = t.getBoundingClientRect(), ls = [...document.querySelectorAll('.rir')].filter(e => e.getBoundingClientRect().height > 0);
            return ls.length + ':' + ls.every(e => { const r = e.getBoundingClientRect(); return r.bottom <= b.top || r.top >= b.bottom; }); })()""")
        R.check(rir == 'pas de toast' or rir.endswith(':true'), f'{t} rest-pause : toast jamais sur « Reps en réserve » ({rir})')
        # « + mini-série » et × : 36 px dessinés, 44 px réellement touchables (::after), sans empiéter l'un sur l'autre
        center(page, '.ex-card[data-ei="0"] .tech__cap')
        hits = page.evaluate("""() => ['.tech__add', '.tech__x'].map(sel => { const b = document.querySelector('.ex-card[data-ei="0"] ' + sel), r = b.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2, h = 21, w = r.width / 2 + 3;   // 44 px à l'arrondi au pixel près (elementFromPoint)
            return [[cx - w, cy], [cx + w, cy], [cx, cy - h], [cx, cy + h]].every(([x, y]) => document.elementFromPoint(x, y)?.closest(sel) === b)
                && Math.round(r.height) + 12 >= 44; })""")
        R.check(hits == [True, True], f'{t} « + reprise » et × : zone de toucher réelle de 44 px ({hits})')
        nat = native_rest(page)
        R.check(nat.get('body', '').startswith(f'Mini-série 1 · {name0} · {kg0} kg'), f'{t} rest-pause : notification « {nat.get("body")} »')
        R.check(nat.get('next', {}).get('exercise') == f'{name0} · Mini-série 1' and nat['next'].get('load', '').startswith(f'{kg0} kg') and nat['next'].get('set') == 1,
                f'{t} rest-pause : Live Activity {nat.get("next")}')
        # Reprise validée (aucune autre à faire) : retour au repos habituel, la série 2 est annoncée
        page.fill('[data-action="sub-reps"][data-ei="0"][data-si="0"][data-k="0"]', '4')
        page.click('[data-action="sub-validate"][data-ei="0"][data-si="0"][data-k="0"]'); settle(page)
        R.check('Série 2' in page.locator('.rest-mini__next').text_content() and native_rest(page).get('body', '').startswith(f'Série 2 · {name0}'), f'{t} reprise faite : la série 2 est annoncée')
        # Cluster : « Bloc 1 »
        skip_rest(page)
        page.evaluate("activeSession.lastEi = 1; persistSession(); render()")
        page.click('[data-action="validate-set"][data-ei="1"][data-si="0"]'); settle(page)
        nxt = ' '.join(page.locator('.rest-mini__next').text_content().replace('\u00a0', ' ').split())
        R.check('Ensuite : Bloc 1' in nxt and page.locator('.session-set--current').count() == 0, f'{t} cluster : « Ensuite » annonce le bloc, seul mis en avant ({nxt})')
        nat = native_rest(page)
        R.check(nat.get('body', '').startswith(f'Bloc 1 · {name1}') and nat.get('next', {}).get('exercise') == f'{name1} · Bloc 1', f'{t} cluster : notification et Live Activity {nat}')
        R.check(no_hscroll(page), f'{t} pause : pas de défilement horizontal')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def once_static(bench):
    for f in ['js/data/intensif.js', 'js/features/session-intensif.js']:
        n = sum(1 for _ in open(os.path.join(APP_DIR, f), encoding='utf-8'))
        R.check(n <= 400, f'{f} : {n} lignes (400 au plus)')
    html = open(os.path.join(APP_DIR, 'index.html'), encoding='utf-8').read()
    sw = open(os.path.join(APP_DIR, 'sw.js'), encoding='utf-8').read()
    for f in ['js/data/intensif.js', 'js/features/session-intensif.js', 'js/features/programme-intensif.js']:
        R.check(f in html and '/' + f in sw, f'{f} chargé par index.html et mis en cache par sw.js')


def once_grand_texte(bench):
    """Texte agrandi (AX1 23 px, AX3 33 px), iPhone SE et 13 : la ligne « Rest-pause · 15 s » et ses boutons ne se recouvrent
    pas (panel seance-t1 : « + mini-série » recouvrait le nom et la pause en AX33), « kg » et « Reps » au-dessus de leurs cases."""
    for px in (23, 33):
        css = ("(() => { const st = document.createElement('style'); st.textContent = 'html { font: %dpx -apple-system, system-ui, sans-serif !important; }';"
               " const put = () => { if (!document.documentElement) return false; document.documentElement.appendChild(st); return true; };"
               " if (!put()) new MutationObserver((m, o) => { if (put()) o.disconnect(); }).observe(document, { childList: true }); })()") % px
        for dev in ('iPhone SE', 'iPhone 13'):
            t = f'{dev}-ax{px}'
            with bench.page('webkit', dev, 'light') as page:
                page.add_init_script(css)
                seed(page, 'light', ppl_v2_today_json())
                settle(page)
                start(page, 'legs')
                page.click('[data-action="tech-set"][data-ei="0"][data-si="1"]'); settle(page)
                tap_dialog(page, 'Rest-pause'); settle(page)
                g = page.evaluate("""() => { const cap = document.querySelector('.ex-card[data-ei="0"] .tech__cap');
                    const r = el => el.getBoundingClientRect(), cut = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
                    const add = cap.querySelector('.tech__add'), x = cap.querySelector('.tech__x'), txt = [cap.querySelector('.tech__name'), cap.querySelector('.tech__hint')];
                    const rg = document.createRange(); rg.selectNodeContents(add); const tr = rg.getBoundingClientRect(), ar = r(add);
                    const inside = tr.left >= ar.left - 0.5 && tr.right <= ar.right + 0.5 && tr.top >= ar.top - 0.5 && tr.bottom <= ar.bottom + 0.5;   // texte dans sa pastille
                    return { xl: document.documentElement.classList.contains('type-xl'),
                             overlap: txt.some(e => cut(r(e), r(add)) || cut(r(e), r(x))) || cut(r(add), r(x)), inside,
                             right: Math.round(r(cap).right - r(x).right) }; }""")
                R.check(not g['overlap'] and g['inside'], f'{t} « Rest-pause », « 15 s » et « + mini-série » ne se recouvrent pas {g}')
                if g['xl']:
                    al = page.evaluate("""() => { const card = document.querySelector('.ex-card[data-ei="0"]'), h = card.querySelectorAll('.sets__head > span');
                        const row = card.querySelector('.session-set'), c = el => { const b = el.getBoundingClientRect(); return b.left + b.width / 2; };
                        return [Math.round(c(h[2]) - c(row.querySelector('.set-input:not(.set-input--required)'))), Math.round(c(h[3]) - c(row.querySelector('.set-input--required')))]; }""")
                    R.check(all(abs(d) <= 3 for d in al), f'{t} « kg » et « Reps » centrés sur leurs cases (écarts {al} px)')
                center(page, '.ex-card[data-ei="0"] .tech')
                shot(page, LOT, f'{t}-grand-texte-rest-pause')


run_main(R, [t_seance, t_programme, t_programme_series, t_seance_series, t_un_bras_series, t_saute, t_superset, t_record_force, t_ami_coach, t_pause_annonce], once=[once_static, once_grand_texte])
