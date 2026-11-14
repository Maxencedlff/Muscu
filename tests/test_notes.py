"""Notes : d'exercice (menu ⋯, relue la fois suivante sous le nom), de série (série validée rouverte, indicateur,
Historique) et de séance (bilan, remontrée en haut de la même séance). Fiche de la bibliothèque, Effacer, VoiceOver,
texte agrandi."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'notes'
R = Results(LOT)

EX_NOTE = 'siège cran 4'
SET_NOTE = 'épaule gauche sensible'
SESSION_NOTE = 'Finir par les mollets'


def start(page, cat):
    page.evaluate(f"startSession('{cat}')")
    page.wait_for_selector('.view.session')
    page.wait_for_timeout(200)


def skip_rest(page):
    for sel in ('.rest-overlay [data-action="skip-rest"]', '.rest-mini__skip'):
        if page.locator(sel).count():
            page.locator(sel).first.click()
            break
    page.wait_for_timeout(120)


def val(page, ei, si):
    b = page.locator(f'[data-action="validate-set"][data-ei="{ei}"][data-si="{si}"]')
    b.scroll_into_view_if_needed(); b.click(); page.wait_for_timeout(600)
    skip_rest(page)


def type_note(page, text):
    f = page.locator('.ios-dialog__input')
    f.fill(text)
    page.wait_for_timeout(100)


def not_clipped(page, sel):
    """Aucun texte de ces éléments n'est coupé (texte agrandi : il passe à la ligne)."""
    return page.evaluate("""sel => [...document.querySelectorAll(sel)].every(e => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1)""", sel)


def t_notes(bench, eng, dev, theme):
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        start(page, 'legs')   # Squat barre, Presse à cuisses…
        R.check(page.locator('.ex-note, .sess-lastnote, .set-note-dot').count() == 0, f'{t} aucune note : rien d\'affiché')

        # ── Note d'exercice : menu ⋯ › « Ajouter une note », alerte à champ (140 caractères)
        val(page, 0, 0)
        page.locator('.ex-card[data-ei="0"] [data-action="ex-menu"]').click(); page.wait_for_timeout(300)
        R.check(page.locator('.ios-dialog__btn', has_text='Ajouter une note').count() == 1, f'{t} menu ⋯ : « Ajouter une note »')
        tap_dialog(page, 'Ajouter une note')
        R.check(page.locator('.ios-dialog__input').get_attribute('maxlength') == '140', f'{t} champ borné à 140 caractères')
        R.check(page.locator('.ios-dialog__input').get_attribute('aria-label') == 'Note', f'{t} champ nommé pour VoiceOver')
        R.check(page.locator('.ios-dialog__btn', has_text='Effacer').count() == 0, f'{t} pas d\'« Effacer » sans note')
        type_note(page, EX_NOTE)
        shot(page, LOT, f'{t}-1-saisie')
        tap_dialog(page, 'Enregistrer'); page.wait_for_timeout(200)
        R.check(page.evaluate("activeSession.exercises[0].note") == EX_NOTE, f'{t} note posée sur l\'exercice de la séance')
        line = page.locator('.ex-card[data-ei="0"] .ex-note')
        R.check(line.count() == 1 and EX_NOTE in line.inner_text() and line.inner_text().startswith('Note'), f'{t} note sous le nom ({line.inner_text() if line.count() else ""})')

        # ── Note de série : série validée touchée (rouverte), puis « Ajouter une note » sous ses champs
        val(page, 1, 0)
        row = page.locator('.session-set--done[data-ei="1"][data-si="0"]')
        R.check(row.locator('.set-note-dot').count() == 0, f'{t} série sans note : pas d\'indicateur')
        R.check(page.locator('.set-note-link').count() == 0, f'{t} lien de note seulement sur une série rouverte')
        row.click(); page.wait_for_timeout(250)
        link = page.locator('.session-set--editing .set-note-link')
        R.check(link.count() == 1, f'{t} série rouverte : « Ajouter une note »')
        shot(page, LOT, f'{t}-4-serie-rouverte')
        link.click(); page.wait_for_timeout(300)
        R.check(page.locator('.ios-dialog__title').inner_text().startswith('Note'), f'{t} alerte de la note de série')
        type_note(page, SET_NOTE)
        tap_dialog(page, 'Enregistrer'); page.wait_for_timeout(200)
        R.check(page.evaluate("activeSession.exercises[1].sets[0].note") == SET_NOTE, f'{t} note posée sur la série')
        R.check(page.evaluate("activeSession.exercises[1].sets[0].done") is True and page.evaluate("editingSet") is None, f'{t} série toujours validée, refermée')
        dot = page.locator('.session-set--done[data-ei="1"][data-si="0"] .set-note-dot')
        R.check(dot.count() == 1, f'{t} indicateur de note sur la série')
        dot.scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-5-serie-indicateur')
        box = dot.bounding_box() if dot.count() else None
        R.check(box is not None and round(box['width']) == 10, f'{t} indicateur de 10 px ({box})')
        spoken = page.locator('.session-set--done[data-ei="1"][data-si="0"] .sr-text').text_content()
        R.check(SET_NOTE in spoken, f'{t} VoiceOver lit la note de la série ({spoken})')
        # Le toucher de validation ne déclenche jamais la note
        val(page, 1, 1)
        R.check(page.locator('.ios-dialog').count() == 0 and page.evaluate("activeSession.exercises[1].sets[1].note") is None, f'{t} valider une série n\'ouvre aucune note')

        # ── Fin de séance : note du bilan
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(250)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary'); page.wait_for_timeout(300)
        page.fill('#summaryNotes', SESSION_NOTE); page.wait_for_timeout(400)
        page.click('[data-action="summary-done"]'); page.wait_for_timeout(300)
        h = page.evaluate("data.history[0]")
        R.check(h['notes'] == SESSION_NOTE, f'{t} note de séance enregistrée')
        R.check(h['exercises'][0].get('note') == EX_NOTE, f'{t} note d\'exercice dans l\'historique')
        presse = next((e for e in h['exercises'] if e['name'] == 'Presse à cuisses'), {})
        R.check(presse.get('sets', [{}])[0].get('note') == SET_NOTE and 'note' not in presse.get('sets', [{}, {}])[1], f'{t} note de série dans l\'historique')
        stored = page.evaluate("JSON.parse(localStorage.getItem('ppl_v2')).history[0].exercises[0].note")
        R.check(stored == EX_NOTE, f'{t} note enregistrée sur l\'appareil')
        # Synchro du compte : la séance part entière (notes comprises), jamais vers les abonnés
        payload = page.evaluate("sessionPayload(data.history[0])")
        R.check(payload['exercises'][0].get('note') == EX_NOTE, f'{t} synchro : la note part avec la séance')
        pub = page.evaluate("cleanPublicSession(sessionPayload(data.history[0]))")
        R.check(all('note' not in e and all('note' not in s for s in e['sets']) for e in pub['exercises']) and 'notes' not in pub, f'{t} Social : aucune note')

        # ── Historique › Séance : notes d'exercice et de série, note de séance
        page.evaluate("navigate(makeRoute('history-detail', data.history[0].id))")
        page.wait_for_selector('.history-detail'); page.wait_for_timeout(300)
        notes = page.locator('.history-detail .hex__note').all_inner_texts()
        R.check(any(EX_NOTE in n for n in notes), f'{t} historique : note d\'exercice ({notes})')
        R.check(any('Série 1' in n and SET_NOTE in n for n in notes), f'{t} historique : note de la série 1 ({notes})')
        R.check(SESSION_NOTE in page.locator('.history-detail .hnotes').inner_text(), f'{t} historique : note de séance')
        R.check(not_clipped(page, '.hex__note'), f'{t} historique : notes jamais coupées')
        page.locator('.hex__note').first.scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-3-historique')

        # ── Fiche de l'exercice (Bibliothèque) : À propos (dernière note) et Historique (notes)
        page.evaluate("navigate(makeRoute('library-ex', 'Squat barre'))")
        page.wait_for_selector('.library-ex'); page.wait_for_timeout(300)
        R.check(EX_NOTE in page.locator('#expanel-about .ex-notecell').first.inner_text(), f'{t} fiche › À propos : dernière note')
        page.click('[data-action="lib-ex-tab"][data-tab="history"]'); page.wait_for_timeout(200)
        R.check(EX_NOTE in page.locator('#expanel-history .ex-notecell').first.inner_text(), f'{t} fiche › Historique : notes')

        # ── Même séance, la fois suivante : note de la dernière fois en haut, dernière note sous le nom
        page.evaluate("routeTo('dashboard')"); page.wait_for_timeout(200)
        start(page, 'legs')
        top = page.locator('.sess-lastnote')
        R.check(top.count() == 1 and SESSION_NOTE in top.inner_text() and 'Note de la dernière fois' in top.inner_text(), f'{t} note de séance remontrée en haut')
        line = page.locator('.ex-card[data-ei="0"] .ex-note')
        R.check(line.count() == 1 and 'Dernière note' in line.inner_text() and EX_NOTE in line.inner_text(), f'{t} dernière note sous le nom ({line.inner_text() if line.count() else ""})')
        R.check(line.get_attribute('aria-label') == f'Dernière note : {EX_NOTE}. Modifier la note', f'{t} VoiceOver lit la dernière note')
        R.check(not_clipped(page, '.ex-note__text, .sess-lastnote__text'), f'{t} notes de la séance jamais coupées')
        R.check(page.locator('.ex-note').evaluate("e => e.getBoundingClientRect().height >= 44"), f'{t} ligne touchable sur 44 px')
        shot(page, LOT, f'{t}-2-carte')
        # Une note d'une autre séance du programme ne remonte pas ici
        R.check(page.evaluate("lastSessionNote('ppl', 'push')") is None, f'{t} note de séance : seulement la même séance')
        page.click('[data-action="sess-lastnote-close"]'); page.wait_for_timeout(200)
        R.check(page.locator('.sess-lastnote').count() == 0 and page.evaluate("activeSession.lastNoteOff") is True, f'{t} note de la dernière fois fermée (et gardée fermée)')

        # Toucher la dernière note : la modifier pour cette séance
        line.click(); page.wait_for_timeout(300)
        R.check(page.locator('.ios-dialog__input').input_value() == EX_NOTE, f'{t} alerte préremplie avec la note')
        R.check(page.locator('.ios-dialog__btn', has_text='Effacer').count() == 1, f'{t} « Effacer » proposé')
        type_note(page, 'siège cran 5')
        tap_dialog(page, 'Enregistrer'); page.wait_for_timeout(200)
        R.check(page.evaluate("activeSession.exercises[0].note") == 'siège cran 5', f'{t} note modifiée pour cette séance')
        R.check(page.evaluate("data.history[0].exercises[0].note") == EX_NOTE, f'{t} la séance passée garde sa note')
        # Effacer : la note de la séance, puis celle de la dernière fois (retirée de sa séance)
        page.locator('.ex-card[data-ei="0"] .ex-note').click(); page.wait_for_timeout(300)
        tap_dialog(page, 'Effacer'); page.wait_for_timeout(200)
        R.check(page.evaluate("activeSession.exercises[0].note") is None and 'Dernière note' in page.locator('.ex-card[data-ei="0"] .ex-note').inner_text(), f'{t} Effacer : note de la séance retirée, dernière note revenue')
        page.locator('.ex-card[data-ei="0"] .ex-note').click(); page.wait_for_timeout(300)
        tap_dialog(page, 'Effacer'); page.wait_for_timeout(200)
        R.check(page.locator('.ex-card[data-ei="0"] .ex-note').count() == 0 and page.evaluate("data.history[0].exercises[0].note") is None, f'{t} Effacer : dernière note retirée de sa séance')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_repliee(bench, eng, dev, theme):
    """Exercice terminé : icône « note » au bout de la carte repliée, note sous le résumé."""
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        start(page, 'legs')
        n = page.evaluate("activeSession.exercises[0].sets.length")
        for si in range(n):
            val(page, 0, si)
        card = page.locator('.ex-card--collapsed[data-ei="0"]')
        btn = card.locator('.ex-note-btn')
        R.check(btn.count() == 1 and btn.get_attribute('aria-label') == 'Ajouter une note, Squat barre', f'{t} carte repliée : icône « note » nommée')
        R.check(btn.evaluate("b => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }"), f'{t} icône touchable sur 44 px')
        btn.click(); page.wait_for_timeout(300)
        type_note(page, 'prise serrée')
        tap_dialog(page, 'Enregistrer'); page.wait_for_timeout(200)
        R.check(page.locator('.ex-card--collapsed[data-ei="0"]').count() == 1, f'{t} la carte reste repliée')
        page.evaluate("window.scrollTo(0, 0)")
        shot(page, LOT, f'{t}-6-repliee')
        R.check('prise serrée' in page.locator('.ex-card--collapsed[data-ei="0"] .ex-summary__note').inner_text(), f'{t} note sous le résumé')
        R.check(page.locator('.ex-card--collapsed[data-ei="0"] .ex-note-btn').get_attribute('aria-label') == 'Modifier la note, Squat barre', f'{t} icône : « Modifier la note »')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_ancienne_version(bench):
    """Champs facultatifs : une donnée avec des notes inconnues ou trop longues est nettoyée, rien ne plante."""
    with bench.page('webkit', 'iPhone 13', 'light') as page:
        d = ppl_v2_today()
        d['history'][0]['exercises'][0]['note'] = 'x' * 500
        d['history'][0]['exercises'][0]['sets'][0]['note'] = {'pas': 'un texte'}
        seed(page, 'light', json.dumps(d, ensure_ascii=False))
        ex = page.evaluate("data.history[0].exercises[0]")
        R.check(len(ex.get('note', '')) == 140, 'note trop longue bornée à 140')
        R.check('note' not in ex['sets'][0], 'note de série illisible retirée')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')


def t_grand_texte(bench):
    """Texte agrandi (type-xl) sur iPhone SE : notes longues lues en entier, rien de coupé, pas de défilement de côté."""
    with bench.page('webkit', 'iPhone SE', 'dark') as page:
        d = ppl_v2_today()
        legs = max((h for h in d['history'] if h['category'] == 'legs'), key=lambda h: h['date'])
        legs['notes'] = 'Genou droit à surveiller, finir par les mollets et 10 minutes de vélo.'
        legs['exercises'][0]['note'] = 'Siège cran 4, pieds largeur épaules, descendre sous la parallèle sans arrondir le dos.'
        seed(page, 'dark', json.dumps(d, ensure_ascii=False))
        page.add_style_tag(content='html { font-size: 28px !important; }')
        page.evaluate("window.dispatchEvent(new Event('resize'))")
        start(page, 'legs')
        page.wait_for_timeout(300)
        R.check(page.locator('.sess-lastnote').count() == 1 and page.locator('.ex-card[data-ei="0"] .ex-note').count() == 1, 'type-xl : notes affichées')
        R.check(not_clipped(page, '.ex-note__text, .sess-lastnote__text, .ex-note, .sess-lastnote'), 'type-xl : notes jamais coupées')
        R.check(page.evaluate("document.documentElement.scrollWidth <= innerWidth"), 'type-xl : aucun défilement de côté')
        shot(page, LOT, 'iPhone_SE-dark-type-xl')
        R.check(not page.errors, f'type-xl : aucune erreur JS {page.errors}')


TESTS = [t_notes, t_repliee]

if __name__ == '__main__':
    run_main(R, TESTS, once=[t_ancienne_version, t_grand_texte])
