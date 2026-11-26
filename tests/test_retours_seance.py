"""Retours des pratiquants du 26/11 sur la séance (Inès, Karim, puis 16 juges sur captures).

- « À battre » de l'accueil repris sous l'exercice, même calcul, avec sa raison ; cases toujours sur « Avant » (17/11) ;
  « Mettre 42,5 kg » remplace la puce ↑ de l'en-tête.
- Première fois : « une charge que tu pourrais soulever 15 fois, et fais-en 12 » (le nombre de la case).
- Note : une seule entrée visible (« Note » au pied de la carte) ; la case « Avant » ne montre que la valeur d'avant,
  l'icône pleine seulement quand la série a une note.
- RIR d'une série en cluster ou drop set : une fois le dernier bloc validé, jamais entre la série et ses blocs.
- Toutes les séries validées : grand « Terminer la séance » en bas.
- Bloc de cluster : « reps » en indication (plus « max », pris pour une valeur) ; « Retirer » à la place du × rond.
- « Disques » écrit sous le numéro (le dessin passait pour une cible) ; « 20 kg de chaque côté · Total : 60 kg ».
- Série rouverte : coche verte comme une série validée ; « Annuler » sur une ligne sous la série, plus dans « Avant ».
- Feuille des techniques : une phrase sous chaque choix.
- Programme : « Superset : de 2 à 5 exercices ».
Captures : $PPL_SCRATCH/shots/retours_seance/.
Lancer : PPL_DEV="iPhone SE" PPL_THEME=dark python3 test_retours_seance.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'retours_seance'
R = Results(LOT)


def start(page, cat):
    page.evaluate(f"startSession('{cat}')")
    page.wait_for_selector('.view.session')
    settle(page)


def norm(s):
    return ' '.join((s or '').replace(' ', ' ').split())


def push_at_top():
    """Dernière séance Push : toutes les séries du 1er exercice au haut de la fourchette (12) → hausse de charge due."""
    d = ppl_v2_today()
    last = max((h for h in d['history'] if h['category'] == 'push'), key=lambda h: h['date'])
    for s in last['exercises'][0]['sets']:
        s['reps'] = '12'
    return d


def t_objectif(bench, eng, dev, theme):
    t = f'{dev}-{theme} objectif'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, json.dumps(push_at_top(), ensure_ascii=False))
        page.wait_for_selector('.hero .targets__row')
        home = norm(page.locator('.hero .targets__row').first.locator('.targets__target').text_content())
        start(page, 'push')
        card = page.locator('.ex-card[data-ei="0"]')
        beat = norm(card.locator('.ex-beat__txt b').text_content())
        R.check(beat == f'À battre : {home}', f'{t} même objectif que l\'accueil ({beat!r} / {home!r})')
        why = norm(card.locator('.ex-beat__txt span').text_content())
        R.check(why == 'Plus lourd, donc moins de reps : c\'est normal.', f'{t} la raison en une phrase ({why!r})')
        sets = page.evaluate('activeSession.exercises[0].sets.filter(s => !s.warmup).map(s => [s.weight, s.reps, s.prev?.weight, s.prev?.reps])')
        R.check(all(w == pw and r == pr for w, r, pw, pr in sets), f'{t} cases = « Avant », jamais l\'objectif (17/11) {sets}')
        R.check(card.locator('.ex-card__head .bump-chip').count() == 0, f'{t} plus de puce ↑ dans l\'en-tête (une seule place)')
        btn = card.locator('.ex-beat [data-action="bump-weight"]')
        R.check(btn.count() == 1 and norm(btn.text_content()).startswith('Mettre '), f'{t} « Mettre … kg » dans la ligne')
        shot(page, LOT, f'{dev}-{theme}-01-objectif')
        btn.click(); settle(page)
        R.check(card.locator('[data-action="bump-weight"]').count() == 0 and card.locator('.ex-beat').count() == 1,
                f'{t} hausse mise : le bouton s\'en va, l\'objectif reste')
        # Un exercice sans hausse due : « une rep de plus »
        texts = [norm(x) for x in page.locator('.ex-beat__txt span').all_text_contents()]
        R.check('Une rep de plus que la dernière fois.' in texts, f'{t} ailleurs : « Une rep de plus » ({texts[:3]})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:3]}')


def t_premiere_fois(bench, eng, dev, theme):
    t = f'{dev}-{theme} première fois'
    with bench.page(eng, dev, theme) as page:
        d = ppl_v2_today()
        d['programmes']['ppl']['exercises']['push'].insert(0, make_ex('neuf1', 'Développé couché machine', 3))
        seed(page, theme, json.dumps(d, ensure_ascii=False))
        start(page, 'push')
        first = norm(page.locator('.ex-card[data-ei="0"] .ex-first').text_content())
        reps = page.locator('[data-action="set-reps"][data-ei="0"][data-si="0"]').input_value()
        R.check(first == f'Première fois : prends une charge que tu pourrais soulever {int(reps) + 3} fois, et fais-en {reps}',
                f'{t} la consigne dit le nombre de la case ({first!r}, case {reps})')
        R.check(page.locator('.ex-card[data-ei="0"] .ex-beat').count() == 0, f'{t} pas d\'objectif à battre')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:3]}')


def t_notes_undo(bench, eng, dev, theme):
    t = f'{dev}-{theme} notes'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        start(page, 'push')
        card = page.locator('.ex-card[data-ei="0"]')
        R.check(card.locator('.set-note-btn .icon').count() == 0, f'{t} aucune icône « note » sous « Avant » sans note')
        R.check(card.locator('.ex-foot-note').count() == 1, f'{t} une seule entrée « Note » visible (pied de la carte)')
        # La case « Avant » ouvre toujours la note de la série (demande du 16/11) ; une note écrite montre l'icône pleine
        page.evaluate("activeSession.exercises[0].sets[1].note = 'épaule OK'; render()"); settle(page)
        R.check(card.locator('.session-set[data-si="1"] .set-note-btn use').get_attribute('href') == '#i-note.fill', f'{t} note écrite : icône pleine')
        # Valider : « Annuler » sur une ligne sous la série, « Avant » garde sa valeur
        prev = norm(card.locator('.session-set[data-si="0"] .set-note-btn__val').inner_text())
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); settle(page)
        row = card.locator('.set-swipe').first
        R.check(row.locator('.ex-undo--set [data-action="sess-undo"]').count() == 1 and page.locator('.set-undo').count() == 0,
                f'{t} « Annuler » sous la série, plus dans « Avant »')
        R.check(norm(row.locator('.session-set .set-note-btn__val').inner_text()) == prev.replace('Avant ', ''), f'{t} « Avant » garde sa valeur')
        shot(page, LOT, f'{dev}-{theme}-02-annuler-sous-la-serie')
        sess_undo(page)
        R.check(not page.evaluate('activeSession.exercises[0].sets[0].done'), f'{t} Annuler défait la série')
        # Série rouverte : même coche verte qu'une série validée
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); settle(page)
        page.click('.session-set--done[data-ei="0"][data-si="0"]'); settle(page)
        g = page.evaluate("""() => { const e = document.querySelector('.set-check--edit'); if (!e) return null;
            const d = document.createElement('span'); d.className = 'set-check set-check--done'; e.parentNode.append(d);
            const r = [getComputedStyle(e).backgroundColor, getComputedStyle(d).backgroundColor]; d.remove(); return r; }""")
        R.check(g and g[0] == g[1], f'{t} « Corriger » : coche verte comme une série validée {g}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:3]}')


def t_cluster(bench, eng, dev, theme):
    t = f'{dev}-{theme} cluster'
    with bench.page(eng, dev, theme) as page:
        d = ppl_v2_today()
        d['rirOn'] = True
        seed(page, theme, json.dumps(d, ensure_ascii=False))
        start(page, 'legs')   # Squat barre
        card = page.locator('.ex-card[data-ei="0"]')
        R.check(norm(card.locator('.set-plates__lbl').inner_text()) == 'Disques' and card.locator('.set-plates .icon').count() == 0,
                f'{t} « Disques » écrit sous le numéro, sans le dessin')
        page.click('.ex-card[data-ei="0"] .set-plates'); page.wait_for_selector('.sess-sheet--plates'); settle(page)
        res = norm(page.locator('.pl__result').inner_text())
        R.check('de chaque côté' in res and 'Total : ' in res and ' kg' in res.split('de chaque côté')[0], f'{t} disques avec unités ({res!r})')
        page.keyboard.press('Escape'); settle(page)
        page.evaluate("closeSessSheets?.()"); settle(page)
        # Technique : une phrase sous chaque choix
        page.click('[data-action="tech-set"][data-ei="0"][data-si="1"]'); settle(page)
        subs = page.locator('.ios-dialog__btn-sub').all_inner_texts()
        R.check(len(subs) == 5 and all(subs), f'{t} une phrase sous chacune des 5 techniques ({subs})')
        shot(page, LOT, f'{dev}-{theme}-03-techniques')
        tap_dialog(page, 'Cluster'); settle(page)
        sub_r = page.locator('[data-action="sub-reps"][data-ei="0"][data-si="1"][data-k="0"]')
        R.check(sub_r.get_attribute('placeholder') == 'reps', f'{t} bloc : « reps » en indication, plus « max »')
        R.check(norm(card.locator('.tech__x').inner_text()) == 'Retirer', f'{t} « Retirer » écrit, plus un × rond')
        # Séries 1 et 2 validées : pas de RIR entre la série 2 et son bloc
        page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); settle(page)
        page.click('[data-action="validate-set"][data-ei="0"][data-si="1"]'); settle(page)
        R.check(card.locator('.rir').count() == 0, f'{t} pas de RIR entre la série et son bloc')
        sub_r.fill('3')
        page.click('[data-action="sub-validate"][data-ei="0"][data-si="1"][data-k="0"]'); settle(page)
        rir = card.locator('.tech + .rir')
        R.check(rir.count() == 1, f'{t} dernier bloc validé : « Reps en réserve » sous le bloc')
        shot(page, LOT, f'{dev}-{theme}-04-rir-apres-bloc')
        rir_pret(page)
        rir.locator('[data-rir="1"]').click(); settle(page)
        R.check(page.evaluate('activeSession.exercises[0].sets[1].rir') in (1, '1'), f'{t} RIR noté sur la série du cluster')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:3]}')


def t_terminer(bench, eng, dev, theme):
    t = f'{dev}-{theme} terminer'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        start(page, 'pull')
        R.check(page.locator('.session-finish-btn').count() == 0, f'{t} pas de grand bouton tant que des séries restent')
        page.evaluate("activeSession.exercises.forEach(ex => ex.sets.forEach(s => { s.done = true; s.reps = s.reps || '10'; })); render()"); settle(page)
        btn = page.locator('.session-finish-btn')
        R.check(btn.count() == 1 and norm(btn.inner_text()) == 'Terminer la séance', f'{t} tout validé : « Terminer la séance » en bas')
        btn.scroll_into_view_if_needed(); settle(page)
        shot(page, LOT, f'{dev}-{theme}-05-terminer')
        btn.click(); settle(page)
        R.check(page.locator('.ios-dialog').count() == 1, f'{t} même action que « Terminer » en haut (choix Enregistrer)')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:3]}')


def o_superset_texte(bench):
    with bench.page('chromium', 'Pixel 7', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json())
        n = page.evaluate("SS_MAX")
        R.check(n == 5, f'superset : 5 exercices au plus ({n})')
        src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'js/features/programme-editor.js'), encoding='utf-8').read()
        R.check('Superset : de 2 à ${SS_MAX} exercices' in src and '2 ou 3 exercices' not in src, 'aide du superset alignée sur la feuille (2 à 5)')


def o_captures(bench):
    """iPhone SE (normal et AX33) et iPhone 13, sombre et clair : objectif, séance commencée, cluster."""
    for dev in ('iPhone SE', 'iPhone 13'):
        for theme in THEMES:
            for ax in ((False, True) if dev == 'iPhone SE' else (False,)):
                with bench.page('webkit', dev, theme) as page:
                    seed(page, theme, json.dumps(push_at_top(), ensure_ascii=False))
                    if ax:
                        page.add_style_tag(content='html { font-size: 28px !important; }')
                        page.evaluate("document.documentElement.classList.add('type-xl'); window.dispatchEvent(new Event('resize'))")
                    start(page, 'push')
                    tag = f'{dev}-{theme}{"-AX33" if ax else ""}'
                    shot(page, LOT, f'cap-{tag}-a-seance')
                    page.click('[data-action="validate-set"][data-ei="0"][data-si="0"]'); settle(page)
                    page.evaluate("window.scrollTo(0, 0)"); settle(page)
                    shot(page, LOT, f'cap-{tag}-b-validee')
                    R.check(not page.errors, f'capture {tag} : aucune erreur JS {page.errors[:3]}')


run_main(R, [t_objectif, t_premiere_fois, t_notes_undo, t_cluster, t_terminer], once=[o_superset_texte, o_captures])
