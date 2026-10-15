"""Lot 4 : séance active, repos et bilan (critères d'acceptation du plan)."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 4
R = Results(LOT)


def tag(device, theme):
    return f'{device}-{theme}'


def start(page, cat='push'):
    page.click(f'[data-action="start-session"][data-cat="{cat}"]')
    page.wait_for_selector('.view.session')
    page.wait_for_timeout(150)


def row_inputs(page, ei, si):
    w = page.locator(f'[data-action="set-weight"][data-ei="{ei}"][data-si="{si}"]')
    r = page.locator(f'[data-action="set-reps"][data-ei="{ei}"][data-si="{si}"]')
    v = page.locator(f'[data-action="validate-set"][data-ei="{ei}"][data-si="{si}"]')
    return w, r, v


def blur(page):
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.wait_for_timeout(120)


FIT_JS = """() => {
  const bad = [];
  const cv = document.createElement('canvas').getContext('2d');
  document.querySelectorAll('.set-row2 .set-input').forEach(i => {
    const cs = getComputedStyle(i);
    cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const w = cv.measureText(i.value || i.placeholder).width;
    const avail = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (w > avail + 0.5) bad.push(`champ « ${i.value} » ${w.toFixed(1)} > ${avail}`);
  });
  document.querySelectorAll('.set-prev, .set-val, .set-n, .sets__head > span, .ex-card__count, .ex-card__name, .ex-card__sub, .session-sub, .rest-mini__timer, .rest-mini__btn, .rest-mini__skip, .bump-chip, .add-set-link')
    .forEach(e => { if (e.scrollWidth > e.clientWidth + 1) bad.push(`${e.className} « ${e.textContent.trim().slice(0, 24)} »`); });
  return bad;
}"""

OVERLAP_JS = """() => {
  const row = document.querySelector('.set-row2--current'), bar = document.querySelector('.rest-mini');
  if (!row || !bar) return { ok: false, why: !row ? 'pas de série courante' : 'pas de barre' };
  const a = row.getBoundingClientRect(), b = bar.getBoundingClientRect();
  const inter = !(a.bottom <= b.top || a.top >= b.bottom);
  return { ok: !inter && a.top >= 0 && a.bottom <= innerHeight, row: [a.top, a.bottom], bar: [b.top, b.bottom], vh: innerHeight };
}"""


def t_flow(bench, eng, dev, theme):
    """Pré-remplissage, saisie pendant le repos, mesures, annuler, balayage, + Série, retrait, feuilles, bilan."""
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        start(page)
        R.check(page.locator('[aria-current="step"]').count() == 1, f'{t} une seule série courante (aria-current)')
        R.check(page.locator('.prev-session').count() == 0 and page.locator('.rest-btn').count() == 0, f'{t} encart « Séance du » et boutons Repos par ligne supprimés')
        sub = page.locator('.session-sub').inner_text()
        R.check(sub.startswith('0/21 · ') and ':' in sub, f'{t} sous-titre « 0/21 · m:ss » ({sub})')
        # Toutes les séries non faites sont modifiables
        R.check(page.locator('.ex-card[data-ei="0"] .set-input').count() == 8, f'{t} 4 séries modifiables dès le départ')
        w0, r0, v0 = row_inputs(page, 0, 0)
        R.check(w0.input_value() == '32,5' and r0.input_value() == '10', f'{t} pré-remplissage 32,5 × 10')
        R.check(w0.get_attribute('inputmode') == 'decimal' and r0.get_attribute('inputmode') == 'numeric' and w0.get_attribute('enterkeyhint') == 'next', f'{t} inputmode et enterkeyhint')
        # Mesures
        m = page.evaluate("""() => {
          const z = document.querySelector('[aria-current="step"] .set-check-zone').getBoundingClientRect();
          const i = document.querySelector('[aria-current="step"] .set-input').getBoundingClientRect();
          const mo = document.querySelector('.ex-card__more').getBoundingClientRect();
          const fs = parseFloat(getComputedStyle(document.querySelector('.set-input')).fontSize);
          return { zw: z.width, zh: z.height, ih: i.height, mw: mo.width, mh: mo.height, fs };
        }""")
        R.check(m['zw'] >= 48 and m['zh'] >= 48, f'{t} zone ✓ ≥ 48×48 ({m["zw"]:.0f}×{m["zh"]:.0f})')
        R.check(m['ih'] >= 44 and m['fs'] >= 16, f'{t} champs ≥ 44 de haut et ≥ 16 px ({m["ih"]:.0f}, {m["fs"]})')
        R.check(m['mw'] >= 44 and m['mh'] >= 44, f'{t} bouton ⋯ ≥ 44 pt')
        w0.fill('31,25')
        blur(page)
        bad = page.evaluate(FIT_JS)
        R.check(not bad, f'{t} aucun texte tronqué {bad}')
        R.check(page.evaluate("activeSession.exercises[0].sets[0].weight") == '31.25', f'{t} 31,25 enregistré')
        R.check(page.evaluate("document.querySelectorAll('.view.session').length") == 1, f'{t} saisie sans render (DOM conservé)')
        shot(page, LOT, f'seance-{t}')
        # Un tap sur ✓ : série validée, barre de repos, toast « Annuler »
        w0.fill('35'); blur(page)
        page.locator('[data-action="validate-set"][data-ei="0"][data-si="0"]').click()
        page.wait_for_timeout(700)
        R.check(page.evaluate('activeSession.exercises[0].sets[0].done') and page.evaluate('restActive'), f'{t} série validée et repos lancé')
        R.check(page.locator('.rest-mini').is_visible(), f'{t} barre de repos visible')
        R.check('Série 1 validée' in page.locator('.toast').inner_text() and page.locator('.toast__action').count() == 1, f'{t} toast « Série 1 validée · Annuler »')
        ov = page.evaluate(OVERLAP_JS)
        R.check(ov['ok'], f'{t} la barre ne recouvre pas la série courante {ov}')
        bar = page.evaluate("(() => { const b = document.querySelector('.rest-mini').getBoundingClientRect(); return { h: b.height, l: b.left, r: innerWidth - b.right, bottom: innerHeight - b.bottom }; })()")
        R.check(80 <= bar['h'] <= 110 and abs(bar['l'] - 16) < 1 and abs(bar['r'] - 16) < 1, f'{t} barre ~96 px, marges 16 px {bar}')
        btns = page.evaluate("[...document.querySelectorAll('.rest-mini button')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })")
        R.check(all(h >= 44 and w >= 44 for w, h in btns), f'{t} boutons de la barre ≥ 44 {btns}')
        lay = page.evaluate("""(() => { const m = document.querySelector('.rest-mini__timer').getBoundingClientRect();
            const b = document.querySelector('.rest-mini__btn').getBoundingClientRect(); return [m.right, b.left]; })()""")
        R.check(lay[0] <= lay[1], f'{t} chrono de la barre sans chevauchement {lay}')
        R.check('Ensuite : Développé couché haltères · S2' in page.locator('.rest-mini__next').inner_text(), f'{t} ligne « Ensuite »')
        shot(page, LOT, f'repos-barre-{t}')
        # Pendant le repos, les champs de la série suivante restent modifiables
        w1, r1, v1 = row_inputs(page, 0, 1)
        r1.fill('8')
        R.check(page.evaluate("String(activeSession.exercises[0].sets[1].reps)") == '8' and page.evaluate('restActive'), f'{t} saisie pendant le repos')
        R.check(page.evaluate("document.body.classList.contains('kb-open')"), f'{t} barre masquée pendant la saisie')
        blur(page)
        # −15 / +15
        e0 = page.evaluate('restEndTime')
        page.click('.rest-mini [data-d="15"]')
        R.check(abs(page.evaluate('restEndTime') - e0 - 15000) < 5, f'{t} +15 s')
        page.click('.rest-mini [data-d="-15"]')
        R.check(abs(page.evaluate('restEndTime') - e0) < 5, f'{t} −15 s')
        # Annuler une validation
        v1.click(); page.wait_for_timeout(300)
        R.check(page.evaluate('activeSession.exercises[0].sets[1].done'), f'{t} série 2 validée')
        page.click('.toast__action'); page.wait_for_timeout(250)
        R.check(not page.evaluate('activeSession.exercises[0].sets[1].done') and not page.evaluate('restActive'), f'{t} Annuler : done=false et repos arrêté')
        R.check(page.locator('.rest-mini').count() == 0, f'{t} Annuler : barre retirée')
        # Feuille détaillée du repos
        v1.click(); page.wait_for_timeout(400)
        page.click('[data-action="expand-rest"]'); page.wait_for_timeout(400)
        R.check(page.locator('.sess-sheet--rest').count() == 1 and page.locator('.rs__ring svg').count() == 1, f'{t} feuille du repos ouverte')
        R.check(page.locator('#customRest').count() == 0, f'{t} plus de champ « Durée en secondes »')
        page.click('.rs-seg__btn[data-secs="120"]'); page.wait_for_timeout(150)
        R.check(page.evaluate('restTotal') == 120 and 115 <= page.evaluate('restTimeLeft') <= 120, f'{t} préréglage 2:00')
        R.check('Reprise à' in page.locator('.rs__resume').inner_text(), f'{t} heure de reprise affichée')
        ph = page.evaluate("document.querySelector('.sess-sheet__panel').getBoundingClientRect().height <= innerHeight - 16")
        R.check(ph, f'{t} hauteur de la feuille bornée')
        shot(page, LOT, f'repos-feuille-{t}')
        page.mouse.click(20, 30); page.wait_for_timeout(350)
        R.check(page.locator('.sess-sheet').count() == 0 and page.evaluate('restActive'), f'{t} tap sur le fond : feuille fermée, repos continue')
        page.click('.rest-mini__skip'); page.wait_for_timeout(150)
        R.check(not page.evaluate('restActive') and page.locator('.rest-mini').count() == 0, f'{t} Passer')
        # Toucher une série validée la rouvre sur place
        page.click('[data-action="edit-set"][data-ei="0"][data-si="0"]')
        R.check(page.locator('.modal-overlay').count() == 0 and page.locator('.set-row2--editing #editSetWeight').count() == 1, f'{t} édition sur place (pas de modale)')
        page.fill('#editSetReps', '9')
        page.click('[data-action="save-edit-set"]'); page.wait_for_timeout(150)
        R.check(page.evaluate("activeSession.exercises[0].sets[0].reps") == '9', f'{t} série corrigée sur place')
        # Balayage : supprimer une série
        n0 = page.evaluate('activeSession.exercises[0].sets.length')
        box = page.locator('.ex-card[data-ei="0"] .set-swipe').nth(3).locator('.set-prev').bounding_box()
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.mouse.down()
        page.mouse.move(box['x'] + box['width'] / 2 - 130, box['y'] + box['height'] / 2 + 3, steps=8)
        page.mouse.up(); page.wait_for_timeout(300)
        R.check(page.locator('.set-swipe--open .set-del').count() == 1, f'{t} balayage : « Supprimer » révélé')
        shot(page, LOT, f'balayage-{t}')
        page.locator('.set-swipe--open .set-del').click(); page.wait_for_timeout(150)
        R.check(page.evaluate('activeSession.exercises[0].sets.length') == n0 - 1, f'{t} balayage : série supprimée')
        # + Série
        page.click('[data-action="add-set"][data-ei="0"]'); page.wait_for_timeout(100)
        R.check(page.evaluate('activeSession.exercises[0].sets.length') == n0, f'{t} « + Série » ajoute une série')
        # Retirer l'exercice : séance seulement
        name1 = page.evaluate('activeSession.exercises[1].name')
        page.click('[data-action="ex-menu"][data-ei="1"]'); page.wait_for_timeout(300)
        labels = page.locator('.ios-dialog__btn').all_inner_texts()
        R.check(all(x in labels for x in ['Monter', 'Descendre', "Remplacer l'exercice", 'Régler le repos', 'Relancer le repos', "Retirer l'exercice"]), f'{t} menu ⋯ complet {labels}')
        tap_dialog(page, "Retirer l'exercice")
        R.check(page.evaluate('activeSession.exercises.length') == 5 and name1 not in page.evaluate('activeSession.exercises.map(e => e.name)'), f'{t} exercice retiré de la séance')
        R.check(page.evaluate('data.programmes.ppl.exercises.push.length') == 6, f'{t} programme inchangé')
        # Repos d'un exercice : préréglages sans clavier
        page.click('[data-action="set-ex-rest"][data-ei="0"]'); page.wait_for_timeout(350)
        R.check(page.locator('.sess-sheet--exrest input').count() == 0, f'{t} réglage du repos sans champ')
        page.click('.sess-sheet--exrest [data-secs="180"]')
        page.click('.sess-sheet--exrest [data-d="15"]')
        R.check(page.evaluate("data.programmes.ppl.exercises.push.find(e => e.id === 'p1dcouch').rest") == 195, f'{t} repos de l\'exercice 3:15 enregistré')
        page.click('.sess-sheet--exrest [data-action="sheet-done"]'); page.wait_for_timeout(300)
        R.check('Repos 3:15' in page.locator('.ex-card[data-ei="0"] .ex-card__sub').inner_text(), f'{t} ligne « Repos 3:15 »')
        # Ajouter un exercice : recherche insensible aux accents
        page.click('[data-action="add-session-ex"]'); page.wait_for_timeout(350)
        page.fill('#axSearch', 'developpe')
        items = page.locator('#axList .ax__item').all_inner_texts()
        R.check(any('Développé' in x for x in items) and 'Créer' in items[-1], f'{t} recherche « developpe » {items[:3]}…')
        page.click('[data-action="ax-sets"][data-d="1"]')
        R.check(page.locator('#axSets').inner_text() == '4', f'{t} compteur de séries')
        shot(page, LOT, f'ajout-exercice-{t}')
        page.fill('#axSearch', 'Pompes lestées')
        page.locator('.ax__item--create').click(); page.wait_for_timeout(250)
        R.check(page.evaluate('activeSession.exercises.at(-1).name') == 'Pompes lestées' and page.evaluate('activeSession.exercises.at(-1).sets.length') == 4, f'{t} exercice créé avec 4 séries')
        # Delta de volume jamais rouge : série plus légère que la dernière fois (une baisse ne s'affiche plus)
        w, r, v = row_inputs(page, 1, 0)
        w.fill('5'); blur(page); v.click(); page.wait_for_timeout(300)
        page.click('.rest-mini__skip')
        reds = page.evaluate("""[...document.querySelectorAll('.ex-vol__delta')].map(e => getComputedStyle(e).color)
            .filter(c => /255, (69|59), (58|48)/.test(c))""")
        R.check(not reds, f'{t} delta de volume jamais rouge {reds}')
        # Terminer → bilan
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(250)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary')
        R.check(page.locator('.sum-title').inner_text() == 'Push', f'{t} bilan : titre')
        recs = page.locator('.sum-record').all_inner_texts()
        R.check(len(recs) == 1 and 'Développé couché haltères' in recs[0] and 'Record charge' in recs[0], f'{t} bilan : records attendus {recs}')
        R.check(page.locator('.sum-tile').count() == 3, f'{t} bilan : 3 tuiles')
        page.fill('#summaryNotes', 'Bonne séance, épaule OK')
        page.wait_for_timeout(450)
        R.check(page.evaluate('data.history[0].notes') == 'Bonne séance, épaule OK', f'{t} bilan : notes dans data.history[0]')
        R.check(json.loads(ls(page, 'ppl_v2'))['history'][0]['notes'] == 'Bonne séance, épaule OK', f'{t} bilan : notes persistées')
        shot(page, LOT, f'bilan-{t}')
        bh = page.locator('.sum-done').bounding_box()
        R.check(bh['height'] >= 50, f'{t} bouton Terminé 50 px')
        page.click('.sum-done'); page.wait_for_timeout(200)
        R.check(page.locator('.view.dashboard').count() == 1 and page.evaluate('activeSession') is None, f'{t} Terminé : retour à l\'accueil')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def restore_session():
    """Séance Push en cours : 3 exercices finis, le 4e à moitié, repos en cours."""
    now = int(time.time() * 1000)
    exs = []
    for i, (eid, name, nsets, base) in enumerate(PUSH):
        sets = []
        for si in range(nsets):
            done = i < 3 or (i == 3 and si < 2)
            w = fmt_w(base + 2.5 * 4)
            sets.append({'weight': w, 'reps': '10', 'plannedWeight': w, 'prev': {'weight': w, 'reps': '10'}, 'done': done})
        exs.append({'exId': eid, 'name': name, 'sets': sets})
    end = now + 50_000
    return {'activeSession': {'category': 'push', 'programme': 'ppl', 'startedAt': now - 40 * 60_000, 'exercises': exs, 'lastEi': 3},
            'sessionNotes': '', 'rest': {'endTime': end, 'minimized': True, 'total': 90}}, end


def t_restore(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        a, end = restore_session()
        seed(page, theme, ppl_v2_today_json(), active=a)
        t = tag(dev, theme)
        page.wait_for_timeout(500)
        R.check(page.evaluate('restEndTime') == end and page.locator('.rest-mini').count() == 1, f'{t} restauration : repos restant exact')
        cur = page.evaluate("(() => { const r = document.querySelector('.set-row2--current'); return r && [r.dataset.ei, r.dataset.si]; })()")
        R.check(cur == ['3', '2'], f'{t} restauration : série courante = exercice 4, série 3 ({cur})')
        ov = page.evaluate(OVERLAP_JS)
        R.check(ov['ok'], f'{t} restauration : série courante visible, non recouverte {ov}')
        mid = (ov['row'][0] + ov['row'][1]) / 2 if 'row' in ov else 0
        R.check(abs(mid - ov.get('vh', 0) / 2) < ov.get('vh', 0) * 0.2, f'{t} restauration : série centrée ({mid:.0f} / {ov.get("vh")})')
        R.check(page.locator('.ex-card--collapsed').count() == 3, f'{t} exercices finis repliés')
        line = page.locator('.ex-card--collapsed .ex-summary__line').first.inner_text()
        R.check(line.startswith('4 × 10 · 32,5'), f'{t} résumé replié « {line} »')
        shot(page, LOT, f'restauration-{t}')
        page.locator('.ex-card--collapsed .ex-summary').first.click(no_wait_after=True); page.wait_for_timeout(300)
        R.check(page.locator('.ex-card[data-ei="0"] .set-row2--done').count() == 4, f'{t} exercice replié : se déplie au tap')
        # Fin du repos : « C'est reparti »
        page.evaluate('restEndTime = Date.now() + 300')
        page.wait_for_timeout(700)
        R.check("C'est reparti" in (page.locator('.rest-mini').inner_text() if page.locator('.rest-mini').count() else ''), f'{t} fin du repos : « C\'est reparti »')
        R.check(page.locator('.timer-flash').count() == 0, f'{t} pas de flash plein écran')
        page.wait_for_timeout(2200)
        R.check(page.locator('.rest-mini').count() == 0, f'{t} barre retirée après 2 s')
        R.check(not page.errors, f'{t} restauration : aucune erreur JS {page.errors}')


def t_bump(bench):
    """Puce « ↑ +2,5 kg » quand toutes les séries précédentes ont atteint 12 reps."""
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        d = ppl_v2_today()
        last = next(h for h in d['history'] if h['category'] == 'push')
        for s in last['exercises'][0]['sets']:
            s['reps'] = '12'
        seed(page, 'dark', json.dumps(d, ensure_ascii=False))
        start(page)
        R.check(page.locator('.ex-card[data-ei="0"] .bump-chip').count() == 1 and page.locator('.bump-chip').count() == 1, 'progression : puce sur le seul exercice éligible')
        shot(page, LOT, 'progression-iPhone_13-dark')
        before = page.evaluate('activeSession.exercises[0].sets.map(s => s.weight)')
        page.click('.bump-chip'); page.wait_for_timeout(150)
        after = page.evaluate('activeSession.exercises[0].sets.map(s => s.weight)')
        R.check(all(abs(float(a) - float(b) - 2.5) < 1e-6 for a, b in zip(after, before)), f'progression : +2,5 kg appliqué {before} → {after}')
        R.check(page.locator('.bump-chip').count() == 0, 'progression : puce retirée après usage')


def t_keyboard(bench):
    """Entrée : poids → reps → validation."""
    with bench.page('chromium', 'Pixel 7', 'light') as page:
        seed(page, 'light', ppl_v2_today_json())
        start(page)
        w, r, v = row_inputs(page, 0, 0)
        w.focus(); page.wait_for_timeout(80)
        sel = page.evaluate('[document.activeElement.selectionStart, document.activeElement.selectionEnd, document.activeElement.value.length]')
        # Demande de Maxence (15/10) : toucher un champ ne sélectionne plus tout son contenu
        R.check(not (sel[2] > 0 and sel[0] == 0 and sel[1] == sel[2]), f'clavier : contenu non sélectionné au focus {sel}')
        # iOS avale le tap si du contenu apparaît au toucher : le bouton Supprimer ne doit pas se révéler au pointerdown
        v.dispatch_event('pointerdown', {'clientX': 10, 'clientY': 10, 'bubbles': True})
        revealed = page.evaluate("() => !!document.querySelector('.set-swipe--swiping, .set-swipe--open')")
        v.dispatch_event('pointerup', {'bubbles': True})
        R.check(not revealed, 'toucher une série ne révèle pas « Supprimer » (sinon double tap sur iPhone)')
        page.keyboard.press('Enter')
        R.check(page.evaluate("document.activeElement.dataset.action") == 'set-reps', 'clavier : Entrée passe aux reps')
        page.keyboard.press('Enter'); page.wait_for_timeout(300)
        R.check(page.evaluate('activeSession.exercises[0].sets[0].done'), 'clavier : Entrée valide la série')


TESTS = [t_flow, t_restore]

if __name__ == '__main__':
    run_main(R, TESTS, once=[t_bump, t_keyboard])
