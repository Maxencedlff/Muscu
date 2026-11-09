"""Outils de la séance (lot 2) : feuille Disques, échauffement automatique, sélecteur RIR, réglage, historique."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'seance_outils'
R = Results(LOT)


def start(page, cat):
    # Seule la prochaine séance a un bouton « Démarrer » à l'accueil : démarrage direct de la séance voulue
    page.evaluate(f"startSession('{cat}')")
    page.wait_for_selector('.view.session')
    page.wait_for_timeout(200)


def skip_rest(page):
    for sel in ('.rest-overlay [data-action="skip-rest"]', '.rest-mini__skip'):
        if page.locator(sel).count():
            page.locator(sel).first.click()
            break
    page.wait_for_timeout(120)


def squat60_json():
    """Données des tests avec le Squat barre à 60 kg partout (le jeu commun monte à 70 kg) : 60 = barre de 20
    + un disque de 20 par côté, base des vérifications des disques et de l'échauffement."""
    d = ppl_v2_today()
    for h in d['history']:
        for e in h['exercises']:
            if e['name'] == 'Squat barre':
                for st in e['sets']:
                    st['weight'] = '60'
    for e in d['programmes']['ppl']['exercises']['legs']:
        if e['name'] == 'Squat barre':
            e.update(lastWeight='60', pr={'weight': '60', 'reps': '10'})
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


def rects_ok(page, sel, mini=44):
    """Toutes les zones de toucher (bouton ou son ::after) font au moins `mini` px."""
    return page.evaluate("""([sel, mini]) => [...document.querySelectorAll(sel)].map(b => {
        const r = b.getBoundingClientRect(), a = getComputedStyle(b, '::after');
        const pad = a.content && a.content !== 'none' ? -parseFloat(a.top || '0') : 0;   // inset négatif = zone élargie
        return [Math.round(r.width + 2 * (isNaN(pad) ? 0 : pad)), Math.round(r.height + 2 * (isNaN(pad) ? 0 : pad))];
    }).filter(([w, h]) => w < mini || h < mini)""", [sel, mini])


def t_outils(bench, eng, dev, theme):
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, squat60_json())
        start(page, 'legs')   # Squat barre (barre, 60 kg la dernière fois), Presse à cuisses (machine)

        # ── Disques : bouton sur la série à faire du Squat barre seulement
        R.check(page.locator('.ex-card[data-ei="0"] .set-plates').count() == 1, f'{t} bouton Disques sur la série courante du Squat barre')
        R.check(page.locator('.ex-card[data-ei="1"] .set-plates').count() == 0, f'{t} pas de Disques sur la presse à cuisses')
        R.check(not rects_ok(page, '.set-plates'), f'{t} bouton Disques ≥ 44 px')
        # Panels de la vague 3 : le numéro de la série reste, le petit disque à côté
        R.check(page.locator('.ex-card[data-ei="0"] .set-plates .num').inner_text().strip() == '1' and page.locator('.ex-card[data-ei="0"] .set-plates .icon--plate').count() == 1,
                f'{t} Disques : numéro de la série gardé, disque à côté')
        shot(page, LOT, f'{t}-disques-numero')
        page.click('.ex-card[data-ei="0"] .set-plates')
        page.wait_for_selector('.sess-sheet--plates')
        page.wait_for_timeout(350)
        R.check(page.locator('#plTarget').inner_text() == '60', f'{t} cible = charge de la série (60)')
        res = page.locator('.pl__result').inner_text()
        R.check('Par côté : 20' in res and '60 kg' in res, f'{t} 60 kg = barre 20 + un disque de 20 par côté ({res})')
        R.check(page.locator('.pl__plate').count() == 1, f'{t} un disque dessiné')
        R.check(not rects_ok(page, '.sess-sheet--plates button'), f'{t} boutons de la feuille ≥ 44 px {rects_ok(page, ".sess-sheet--plates button")}')
        shot(page, LOT, f'{t}-01-disques')
        # +2,5 → 62,5 : 20 + 1,25 ; barre 15 → 20 + 2,5 + 1,25 ; disque de 1,25 retiré → 62,5 inatteignable, 60 proposé
        page.click('[data-action="pl-adj"][data-d="1"]'); page.wait_for_timeout(100)
        R.check(page.locator('#plTarget').inner_text() == '62,5' and '20 + 1,25' in page.locator('.pl__result').inner_text(), f'{t} +2,5 kg : 20 + 1,25 par côté')
        page.click('[data-action="pl-bar"][data-bar="15"]'); page.wait_for_timeout(100)
        R.check('20 + 2,5 + 1,25' in page.locator('.pl__result').inner_text(), f'{t} barre de 15 : 20 + 2,5 + 1,25')
        R.check(page.evaluate("JSON.parse(localStorage.getItem('ppl_v2')).plates?.bar?.kg") == 15, f'{t} barre mémorisée')
        page.click('[data-action="pl-plate"][data-plate="1.25"]'); page.wait_for_timeout(100)
        res = page.locator('.pl__result').inner_text()
        # 62,5 inatteignable : 60 au plus proche, déjà la charge de la série → pas de bouton « Mettre 60 kg »
        R.check('au plus proche' in res and '60 kg' in res and page.locator('.pl__apply').count() == 0, f'{t} sans 1,25 : charge atteignable proposée, déjà dans la série ({res})')
        # Sans 1,25, le pas est de 5 kg (2 × 2,5) : 67,5 inatteignable, 65 au plus proche (15 + 2 × 25),
        # différent de la série → un toucher la reporte
        page.click('[data-action="pl-adj"][data-d="1"]'); page.wait_for_timeout(100)
        res = page.locator('.pl__result').inner_text()
        R.check('65 kg au plus proche' in res and page.locator('.pl__apply').count() == 1, f'{t} 67,5 : 65 proposé, bouton pour le reporter ({res})')
        page.click('[data-action="pl-apply"]'); page.wait_for_timeout(200)
        R.check(page.evaluate("activeSession.exercises[0].sets[0].weight") == '65', f'{t} charge atteignable reportée dans la série')
        shot(page, LOT, f'{t}-02-disques-ajuste')
        page.click('.sess-sheet--plates [data-action="sheet-done"]'); page.wait_for_timeout(300)
        R.check(page.locator('.sess-sheet--plates').count() == 0, f'{t} feuille fermée')
        # Retour à 60 pour la suite (échauffement calculé sur 60)
        page.evaluate("activeSession.exercises[0].sets[0].weight = '60'; persistSession(); render()"); page.wait_for_timeout(200)

        # ── Échauffement : depuis le menu ⋯ du Squat barre (barre 15, disques sans 1,25 : pas de 5 kg)
        page.click('.ex-card[data-ei="0"] [data-action="ex-menu"]'); page.wait_for_timeout(300)
        tap_dialog(page, "Plus d'options"); page.wait_for_timeout(300)
        labels = page.locator('.ios-dialog__btn').all_inner_texts()
        R.check('Ajouter un échauffement' in labels and 'Disques' in labels, f'{t} menu : échauffement et Disques ({labels})')
        tap_dialog(page, 'Ajouter un échauffement')
        page.wait_for_selector('.sess-sheet--warmup'); page.wait_for_timeout(300)
        rows = page.locator('.wu__set').all_inner_texts()
        R.check(rows == ['25 kg × 8', '35 kg × 5', '50 kg × 3'], f'{t} 40/60/80 % de 60 kg arrondis à 5 kg : {rows}')
        note = page.locator('.wu__note').inner_text()
        R.check(note == '3 séries légères pour préparer tes muscles. Elles ne comptent pas dans tes records.', f'{t} phrase simple, nombre réel de séries ({note!r})')
        shot(page, LOT, f'{t}-03-echauffement-feuille')
        page.click('[data-action="wu-add"]'); page.wait_for_timeout(400)
        sets = page.evaluate("activeSession.exercises[0].sets.map(s => [s.warmup === true, s.weight, s.reps])")
        R.check(sets[:3] == [[True, '25', '8'], [True, '35', '5'], [True, '50', '3']] and not sets[3][0], f'{t} 3 séries warmup:true insérées avant le travail {sets[:4]}')
        R.check(page.locator('.ex-card[data-ei="0"] .sets__caption').text_content().strip() == 'Échauffement', f'{t} titre gris « Échauffement »')   # capitales par CSS
        R.check(page.locator('.ex-card[data-ei="0"] .session-set--warmup').count() == 3, f'{t} 3 lignes grises')
        nums = page.locator('.ex-card[data-ei="0"] .set-n').all_inner_texts()
        # Série en cours (1er échauffement) : le bouton Disques remplace son numéro
        cur_plates = page.locator('.ex-card[data-ei="0"] .session-set--current .set-plates').count() == 1
        R.check(cur_plates and nums[1:3] == ['É', 'É'] and nums[3:5] == ['1', '2'] if len(nums) >= 5 else False, f'{t} numérotation : (Disques) É É puis 1, 2 ({nums[:6]})')
        R.check(page.evaluate("JSON.parse(localStorage.getItem('ppl_active_session')).activeSession.exercises[0].sets[0].warmup") is True, f'{t} séance sauvegardée avec l\'échauffement')
        page.evaluate("document.querySelector('.ex-card[data-ei=\"0\"]').scrollIntoView()")
        shot(page, LOT, f'{t}-04-echauffement-seance')
        # Valider l'échauffement 1 : pas de RIR (série d'échauffement), pas de volume, toast « Échauffement 1 validé »
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); page.wait_for_timeout(300)
        R.check('Échauffement 1 validé' in sess_undo_text(page), f'{t} échauffement validé, « Annuler » en ligne')
        R.check(page.locator('.ex-card[data-ei="0"] .rir').count() == 0, f'{t} pas de sélecteur RIR sur un échauffement')
        R.check(page.locator('.ex-card[data-ei="0"] .ex-vol__delta').count() == 0, f'{t} échauffement sans volume comparé')
        skip_rest(page)
        for si in (1, 2):
            page.click(f'[data-action="validate-set"][data-ei="0"][data-si="{si}"]'); page.wait_for_timeout(150); skip_rest(page)

        # ── RIR : après la 1re série de travail, un sélecteur facultatif (un seul tap pour valider reste inchangé)
        page.click('[data-action="validate-set"][data-ei="0"][data-si="3"]'); page.wait_for_timeout(300)
        R.check(page.evaluate("activeSession.exercises[0].sets[3].done") is True and 'Série 1 validée' in sess_undo_text(page), f'{t} série 1 de travail validée en un tap')
        skip_rest(page)
        rir = page.locator('.ex-card[data-ei="0"] .rir')
        R.check(rir.count() == 1 and page.locator('.rir__btn').count() == 5, f'{t} sélecteur RIR sous la série validée (5 choix)')
        R.check(page.locator('.rir__btn').all_inner_texts() == ['0', '1', '2', '3', '4+'], f'{t} choix 0 à 4+')
        R.check(page.locator('.rir__help').inner_text() == 'Facultatif : combien tu aurais pu en faire de plus', f'{t} RIR jamais noté : son sens en une phrase')
        R.check(not rects_ok(page, '.rir__btn'), f'{t} boutons RIR ≥ 44 px {rects_ok(page, ".rir__btn")}')
        ov = page.evaluate("(() => { const r = document.querySelector('.rir').getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; })()")
        R.check(ov, f'{t} sélecteur RIR dans l\'écran')
        page.click('.rir__btn[data-rir="2"]'); page.wait_for_timeout(250)
        R.check(page.evaluate("activeSession.exercises[0].sets[3].rir") == 2, f'{t} RIR 2 enregistré')
        R.check(page.locator('.rir__help').count() == 0, f'{t} un RIR noté : la phrase s\'en va')
        R.check(page.locator('.rir__rpe').inner_text() == 'RPE 8' and page.locator('.rir__btn[data-rir="2"]').get_attribute('aria-pressed') == 'true', f'{t} équivalence RPE 8 affichée')
        R.check(page.evaluate("JSON.parse(localStorage.getItem('ppl_active_session')).activeSession.exercises[0].sets[3].rir") == 2, f'{t} RIR sauvegardé avec la séance')
        page.evaluate("document.querySelector('.ex-card[data-ei=\"0\"] .rir').scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'{t}-05-rir')
        page.click('.rir__btn[data-rir="2"]'); page.wait_for_timeout(200)
        R.check(page.evaluate("activeSession.exercises[0].sets[3].rir") is None, f'{t} même tap : RIR effacé')
        page.click('.rir__btn[data-rir="0"]'); page.wait_for_timeout(200)
        R.check(page.locator('.rir__rpe').inner_text() == 'RPE 10', f'{t} RIR 0 = RPE 10')
        # Série suivante : le sélecteur passe sur elle, la précédente garde un badge « RIR 0 »
        page.click('[data-action="validate-set"][data-ei="0"][data-si="4"]'); page.wait_for_timeout(300); skip_rest(page)
        R.check(page.locator('.ex-card[data-ei="0"] .set-swipe:has(.session-set[data-si="3"]) .rir-badge').inner_text() == '0 en réserve' and page.locator('.rir .rir__btn[data-si="4"]').count() == 5, f'{t} badge sur la série 1, sélecteur sur la série 2')
        # Volume de l'exercice : les 3 échauffements ne comptent pas (2 × 60 × 8 = 960 contre 2 × 60 × 10 = 1200 l'an dernier : pas de hausse affichée)
        vol = page.evaluate("exVolume(activeSession.exercises[0], activeSession.exercises[0].sets.filter(s => s.done))")
        R.check(vol == 60 * 8 * 2 or vol == page.evaluate("workSets(activeSession.exercises[0].sets).filter(s => s.done).reduce((a, s) => a + s.weight * s.reps, 0)"), f'{t} volume sans l\'échauffement ({vol})')

        # ── Enregistrement : warmup et rir dans l'historique, affichés ; records et séries sans l'échauffement
        page.evaluate("activeSession.exercises.slice(1).forEach(ex => { ex.sets = [ex.sets[0]]; ex.sets[0].done = true; ex.sets[0].reps = ex.sets[0].reps || '10'; })")
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(250)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary'); page.wait_for_timeout(300)
        h = page.evaluate("data.history[0].exercises[0].sets.map(s => [s.warmup ?? null, s.rir ?? null, s.weight])")
        R.check(h[:3] == [[True, None, '25'], [True, None, '35'], [True, None, '50']] and h[3] == [None, 0, '60'] and h[4][1] is None, f'{t} historique : warmup et rir enregistrés {h}')
        R.check(page.locator('.sum-tile__value').nth(2).inner_text().strip() in ('7', '7 séries'), f'{t} bilan : 7 séries de travail (2 + 5), échauffement exclu ({page.locator(".sum-tile__value").all_inner_texts()})')
        page.click('[data-action="summary-done"]'); page.wait_for_timeout(300)
        page.click('[data-action="go-history"]'); page.wait_for_timeout(300)
        page.locator('.hcell').first.click(); page.wait_for_selector('.view.history-detail'); page.wait_for_timeout(300)
        notes = page.locator('.hex__sets--note').all_inner_texts()
        R.check(any(n.startswith('Échauffement 25 kg × 8') for n in notes) and any(n.startswith('Reps en réserve : 0 · —') for n in notes), f'{t} détail : lignes Échauffement et Reps en réserve {notes}')
        work = page.locator('.hex__sets').first.inner_text()
        R.check(work.startswith('60 kg × ') and '25 kg' not in work and '35 kg' not in work and work.count('·') == 1, f'{t} détail : deux séries de travail seules ({work})')
        shot(page, LOT, f'{t}-06-historique')
        # Progrès › Exercice : courbe Effort proposée pour le Squat barre
        page.evaluate("navigate(makeRoute('stats-ex', 'g1squatb'))"); page.wait_for_selector('.view.stats-ex'); page.wait_for_timeout(300)
        modes = page.locator('.segmented__btn').all_inner_texts()
        R.check('Effort' in modes, f'{t} Progrès : mode Effort proposé ({modes})')
        page.click('[data-action="stats-mode"][data-mode="effort"]'); page.wait_for_timeout(400)
        R.check(page.locator('.chart-head__val').inner_text() == 'RPE 10' and page.locator('.chart-head__trend').count() == 0, f'{t} courbe Effort : RPE 10, sans tendance en %')
        shot(page, LOT, f'{t}-07-effort')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_reglage(bench):
    """Réglage « Noter le RIR » : désactivé, plus de sélecteur ; restauration d'une séance avec échauffement."""
    with bench.page('chromium', 'Pixel 7', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json())
        page.evaluate("navigate('settings')"); page.wait_for_selector('.settings-view'); page.wait_for_timeout(200)
        sw = page.locator('[data-action="setting-rir"]')
        R.check(sw.count() == 1 and sw.get_attribute('aria-checked') == 'true', 'réglage RIR présent et actif par défaut')
        sw.click(); page.wait_for_timeout(200)
        R.check(page.evaluate("JSON.parse(localStorage.getItem('ppl_v2')).rirOn") is False, 'réglage désactivé enregistré')
        page.evaluate("navigate('dashboard')"); page.wait_for_timeout(200)
        start(page, 'push')
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); page.wait_for_timeout(300)
        R.check(page.locator('.rir').count() == 0 and page.evaluate("activeSession.exercises[0].sets[0].done") is True, 'sélecteur absent, validation inchangée')
        # Séance restaurée : échauffement et RIR gardés après rechargement
        page.evaluate("activeSession.exercises[0].sets.unshift({ weight: '10', reps: '8', done: true, warmup: true }); activeSession.exercises[0].sets[1].rir = 1; persistSession()")
        page.reload(); page.wait_for_selector('.view.session'); page.wait_for_timeout(300)
        R.check(page.locator('.session-set--warmup').count() == 1 and page.evaluate("activeSession.exercises[0].sets[1].rir") == 1, 'séance restaurée avec échauffement et RIR')
        R.check(page.locator('.ex-card[data-ei="0"] .set-n').all_inner_texts()[:2] == ['É', '1'], 'numérotation après restauration')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')


def t_persist(bench, eng, dev, theme):
    """Série ajoutée, tour de superset ajouté, élastique choisi : la séance est écrite tout de suite (même
    appelée sans clic, par le registre des actions) et retrouvée après un rechargement."""
    t = f'{dev}-{theme}'
    stored = "(() => JSON.parse(localStorage.getItem('ppl_active_session')).activeSession.exercises)()"
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        start(page, 'legs')
        n0 = page.evaluate('activeSession.exercises[0].sets.length')
        page.locator('[data-action="add-set"][data-ei="0"]').scroll_into_view_if_needed()
        page.click('[data-action="add-set"][data-ei="0"]'); page.wait_for_timeout(200)
        page.reload(); page.wait_for_selector('#app > *'); page.wait_for_timeout(300)
        page.evaluate("navigate('session')"); page.wait_for_selector('.view.session'); page.wait_for_timeout(200)
        R.check(page.evaluate('activeSession.exercises[0].sets.length') == n0 + 1, f'{t} série ajoutée puis rechargement : la série est là')
        R.check(page.locator('.ex-card[data-ei="0"] .session-set:not(.session-set--sub)').count() >= n0 + 1, f'{t} série ajoutée : affichée après rechargement')
        # Sans clic (handleAction direct) : écrite par l'action elle-même
        page.evaluate("handleAction(null, document.querySelector('[data-action=\"add-set\"][data-ei=\"0\"]'), 'add-set')")
        R.check(page.evaluate(f'{stored}[0].sets.length') == n0 + 2, f'{t} add-set : séance écrite par l\'action')
        page.evaluate("activeSession.exercises[1].ss = 'g'; activeSession.exercises[2].ss = 'g'; persistSession(); render()")
        n1, n2 = page.evaluate('[1, 2].map(i => activeSession.exercises[i].sets.length)')
        # Panel du 07/11 : « + Tour » nommé pour VoiceOver avec les exercices du superset
        lbl = page.get_attribute('[data-action="add-round"][data-ei="1"]', 'aria-label')
        R.check(lbl == 'Ajouter un tour, ' + ', '.join(page.evaluate('[1, 2].map(i => activeSession.exercises[i].name)')), f'{t} « + Tour » nommé ({lbl!r})')
        page.evaluate("handleAction(null, { dataset: { ei: '1' } }, 'add-round')")
        R.check(page.evaluate(f'[1, 2].map(i => {stored}[i].sets.length)') == [n1 + 1, n2 + 1], f'{t} add-round : tour écrit pour les deux exercices')
        page.evaluate("handleAction(null, { dataset: { ei: '3', kg: '15' } }, 'set-band')")
        R.check(all(w == '15' for w in page.evaluate(f"{stored}[3].sets.filter(s => !s.done && !s.warmup).map(s => s.weight)")), f'{t} set-band : charge de l\'élastique écrite')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


TESTS = [t_outils, t_persist]

if __name__ == '__main__':
    run_main(R, TESTS, once=[t_reglage])
