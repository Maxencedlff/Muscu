"""Série guidée au tempo sur un exercice à un bras (rowing bûcheron un bras) : préparation, reps du premier bras,
« Change de bras » 5 s, reps du second bras, puis seulement la série validée pour les deux bras et le repos.
« Bras suivant » au premier bras, reps différentes (la série passe par bras), reprise après l'arrière-plan au bon
bras, premier bras choisi à droite. Aussi : le sélecteur « Reps en réserve » ignore le toucher qui suit la validation.
L'horloge est avancée en déplaçant les horodatages de l'effort (comme test_vacuum.py), tempo court 1-0-1-0."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'tempo_bras'
R = Results(LOT)
APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def tempo_data():
    """Données réalistes + « Rowing bûcheron un bras » guidé au son (tempo 1-0-1-0, préparation 5 s) en tête du Pull."""
    d = ppl_v2_today()
    ex = make_ex('rb1rowb', 'Rowing bûcheron un bras', 3)
    ex.update({'tempo': '1-0-1-0', 'tempoGuide': True, 'tempoPrep': 5})
    d['programmes']['ppl']['exercises']['pull'].insert(0, ex)
    d['rirOn'] = True
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


def start(page, reps='2', side_first=None):
    page.evaluate("startSession('pull')")
    page.wait_for_selector('.view.session')
    page.evaluate("""([reps, first]) => { const ex = activeSession.exercises[0];
        if (first) ex.sideFirst = first;
        ex.sets.forEach(s => { s.reps = reps; s.weight = '20'; }); persistSession(); render(); }""", [reps, side_first])
    settle(page)


def sub(page):
    return ' '.join(page.inner_text('#effortSub').split())


def tick(page, field, at_ms):
    """Place l'horloge de l'effort à at_ms après start (ou side2Start), puis un rendu. La minuterie de l'effort est
    arrêtée : l'écran reste à cet instant pour les vérifications et les captures (le temps réel ne s'y ajoute pas)."""
    page.evaluate("""([f, at]) => { clearInterval(effortInterval); effortInterval = null;
        activeSession.effort[f] = Date.now() - at; updateEffortUI(); }""", [field, at_ms])
    settle(page)


def freeze(page):
    page.evaluate("clearInterval(effortInterval); effortInterval = null")


def play(page):
    """▶ de la première série du rowing"""
    b = page.locator('.ex-card[data-ei="0"] .set-play').first
    b.scroll_into_view_if_needed()
    b.click()
    page.wait_for_selector('.rs--effort')
    freeze(page)
    settle(page)


def t_tempo_deux_bras(bench, eng, dev, theme):
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, tempo_data())
        start(page)
        R.check(page.evaluate("unilateralLimb(activeSession.exercises[0])") == 'bras', f'{t} rowing bûcheron reconnu à un bras')
        play(page)
        e = page.evaluate("activeSession.effort")
        R.check(e.get('sides') == 2 and e.get('reps') == 2 and e.get('reps2') == 2, f'{t} effort à deux côtés {e}')
        R.check(sub(page) == 'Bras gauche · Mets-toi en place', f'{t} préparation « {sub(page)} »')
        shot(page, LOT, f'{t}-prep')
        tick(page, 'start', 500)    # rep 1 du bras gauche
        R.check(sub(page) == 'Bras gauche · Rep 1 sur 2', f'{t} bras gauche « {sub(page)} »')
        R.check(page.inner_text('#effortStop').strip() == 'Bras suivant', f'{t} bouton « Bras suivant » au premier bras')
        shot(page, LOT, f'{t}-bras1')
        tick(page, 'start', 4050)   # fin du bras gauche (4 s) : changement de bras
        R.check(sub(page) == 'Change de bras', f'{t} changement « {sub(page)} »')
        R.check(page.inner_text('#effortTime').strip() == '5', f'{t} 5 s pour changer de bras ({page.inner_text("#effortTime")})')
        R.check(page.evaluate("activeSession.exercises[0].sets[0].done") is False and page.evaluate("restActive") is False,
                f'{t} série pas encore validée, aucun repos pendant le changement')
        shot(page, LOT, f'{t}-changement')
        tick(page, 'start', 9500)   # rep 1 du bras droit
        R.check(sub(page) == 'Bras droit · Rep 1 sur 2', f'{t} bras droit « {sub(page)} »')
        R.check(page.inner_text('#effortStop').strip() == 'Arrêter', f'{t} bouton « Arrêter » au second bras')
        shot(page, LOT, f'{t}-bras2')
        tick(page, 'start', 13_100)   # fin du bras droit : série validée, repos
        s = page.evaluate("activeSession.exercises[0].sets[0]")
        R.check(s['done'] and s['reps'] == '2' and 'side2' not in s, f'{t} mêmes reps des deux bras : une ligne {s}')
        R.check(page.evaluate("restActive") is True and page.evaluate("!activeSession.effort"), f'{t} repos lancé après le bras droit')
        R.check(sess_undo_text(page).startswith('Série 1 validée'), f'{t} « Série 1 validée » ({sess_undo_text(page)!r})')
        shot(page, LOT, f'{t}-valide')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def once_bras_suivant(bench):
    """« Bras suivant » au premier bras (1 rep sur 3), « Commencer » pendant le changement, arrière-plan au second bras,
    reprise au même bras et à la même rep ; reps différentes : la série passe par bras (tout l'exercice) ; premier bras
    choisi à droite ; « Annuler » rend la série comme avant."""
    eng, dev = 'chromium', 'iPhone 13'
    with bench.page(eng, dev, 'light') as page:
        seed(page, 'light', tempo_data())
        start(page, reps='3', side_first='droit')
        play(page)
        page.click('#effortStop'); freeze(page); settle(page)   # « Commencer » : la préparation passée
        tick(page, 'start', 2500)                          # 1 rep faite, rep 2 en cours
        R.check(sub(page) == 'Bras droit · Rep 2 sur 3', f'premier bras à droite « {sub(page)} »')
        page.click('#effortStop'); settle(page)            # « Bras suivant »
        e = page.evaluate("activeSession.effort")
        R.check(e.get('side1Reps') == 1 and sub(page) == 'Change de bras', f'1 rep gardée, changement de bras ({sub(page)}, {e.get("side1Reps")})')
        R.check(page.evaluate("activeSession.exercises[0].sets[0].done") is False, '« Bras suivant » ne valide pas la série')
        page.click('#effortStop'); settle(page)            # « Commencer » : le second bras tout de suite
        tick(page, 'side2Start', 2500)
        R.check(sub(page) == 'Bras gauche · Rep 2 sur 3', f'second bras « {sub(page)} »')
        # Arrière-plan puis retour : nouvelle préparation, puis le même bras à la même rep
        page.evaluate("pauseTempo(activeSession.effort); resumeTempoAfterPause(activeSession.effort); updateEffortUI()")
        freeze(page); settle(page)
        e = page.evaluate("activeSession.effort")
        R.check(sub(page) == 'Bras gauche · Mets-toi en place' and e.get('firstRep2') == 2 and e.get('side1Reps') == 1,
                f'reprise au bras gauche, rep 2 ({sub(page)}, {e})')
        tick(page, 'side2Start', 500)
        R.check(sub(page) == 'Bras gauche · Rep 2 sur 3', f'reprise : « {sub(page)} »')
        tick(page, 'side2Start', 4100)                     # reps 2 et 3 : fin
        sets = page.evaluate("activeSession.exercises[0].sets")
        s = sets[0]
        R.check(s['done'] and s['reps'] == '1' and s.get('side2', {}).get('reps') == '3' and s['side2'].get('done') is True,
                f'bras droit 1, bras gauche 3 : série par bras, les deux validés {s}')
        R.check(s['side2'].get('weight') == '20', f'charge du second bras reprise du premier ({s["side2"].get("weight")})')
        R.check(all('side2' in x for x in sets), 'tout l\'exercice passe par bras')
        R.check(page.evaluate("restActive") is True, 'repos lancé après le second bras')
        # « Annuler » : la série à refaire, l'exercice de nouveau sur une ligne
        sess_undo(page); settle(page)
        sets = page.evaluate("activeSession.exercises[0].sets")
        R.check(not sets[0]['done'] and not any('side2' in x for x in sets), f'« Annuler » : série à faire, sur une ligne {sets[0]}')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')


def once_rir_toucher(bench):
    """Sélecteur « Reps en réserve » : un toucher dans les 700 ms après son apparition est ignoré, un toucher après est
    pris (séance du 22/11 : « 4+ » noté sans le vouloir, le doigt encore sur la série validée)."""
    with bench.page('chromium', 'iPhone 13', 'light') as page:
        seed(page, 'light', tempo_data())
        start(page)
        # Validation puis toucher dans la foulée, dans la même tâche (bien moins de 700 ms)
        rir = page.evaluate("""() => { document.querySelector('[data-action="validate-set"][data-ei="1"][data-si="0"]').click();
            document.querySelector('[data-action="set-rir"][data-ei="1"][data-si="0"][data-rir="4"]')?.click();
            return activeSession.exercises[1].sets[0].rir ?? null; }""")
        R.check(page.evaluate("activeSession.exercises[1].sets[0].done") is True, 'série validée')
        R.check(rir is None, f'toucher juste après l\'apparition : ignoré ({rir})')
        page.wait_for_timeout(750)
        page.evaluate("document.querySelector('[data-action=\"set-rir\"][data-ei=\"1\"][data-si=\"0\"][data-rir=\"2\"]').click()")
        settle(page)
        R.check(page.evaluate("activeSession.exercises[1].sets[0].rir") == 2, 'toucher après 700 ms : pris (2 en réserve)')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')


run_main(R, [t_tempo_deux_bras], once=[once_bras_suivant, once_rir_toucher])
