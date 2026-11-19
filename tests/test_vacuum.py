"""Vacuum abdominal : noté en maintiens (secondes), chrono guidé, records en secondes, transverse seul.

Vérifie : fiche de la Bibliothèque (personnage sans aucun rouge, « Transverse (profond) », consignes) ; séance
(« N° », « + Maintien », chrono guidé « Expire… », « Respire petit… », maintien validé en secondes) ; Progrès
(« Plus long maintien », « Temps total sous tension », aucune série comptée aux abdominaux) ; ancienne séance
en séries × reps toujours lisible dans l'Historique. Texte agrandi : rien de coupé, pas de défilement horizontal.
Captures : $PPL_SCRATCH/shots/lotvacuum/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_vacuum.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'vacuum'
R = Results(LOT)

NOW = local_ms(2026, 11, 16, 18, 0, tz=PARIS)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def vacuum_data(now):
    """Programme Jambes avec du vacuum ; une séance d'avant en séries × reps (sans mesure), deux en secondes."""
    d = ppl_v2_today(now_ms=now)
    d['programmes']['ppl']['exercises']['legs'].append(make_ex('vacuum01', 'Vacuum', 5))
    def entry(i, days, sets, measure=None):
        ex = {'exId': 'vacuum01', 'name': 'Vacuum', 'sets': [{'weight': '', 'reps': str(r)} for r in sets]}
        if measure:
            ex['measure'] = measure
        return {'id': f'hvac{i}', 'programme': 'ppl', 'category': 'legs', 'date': now - days * DAY,
                'duration': 20 * 60_000, 'notes': '', 'exercises': [ex]}
    d['history'] += [entry(0, 9, [12, 12, 12]), entry(1, 5, [10, 10, 10, 10, 10], 'time'), entry(2, 2, [15, 15, 12, 12, 12], 'time')]
    d['history'].sort(key=lambda h: -h['date'])
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


def open_app(page, theme):
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, vacuum_data(NOW))
    settle(page)


def big_text(page, on=True):
    page.evaluate("""on => { const h = document.documentElement; h.style.fontSize = on ? '24px' : '';
        h.classList.toggle('type-xl', on); window.dispatchEvent(new Event('resize')); }""", on)
    settle(page)


def layout_ok(page):
    """Pas de défilement horizontal, aucun texte de cellule coupé au bord."""
    return page.evaluate("""() => document.documentElement.scrollWidth <= innerWidth + 1
        && [...document.querySelectorAll('.cell__title, .cell__sub, .exhero__cap, .rs__resume')].every(e => e.scrollWidth <= e.clientWidth + 1 || getComputedStyle(e).textOverflow !== 'ellipsis')""")


def t_fiche(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        page.evaluate("navigate(makeRoute('library-ex', 'Vacuum'))")
        page.wait_for_selector('.view.library-ex')
        settle(page)
        hero = page.locator('.exhero--deep')
        R.check(hero.count() == 1, f'{t} fiche : vignette du muscle profond')
        R.check(page.locator('.library-ex .body-map [data-muscle]').count() == 0, f'{t} fiche : aucun calque de muscle (aucun rouge)')
        R.check(page.locator('.library-ex img[src*="img/muscles/abs"]').count() == 0, f'{t} fiche : pas l\'image des abdominaux')
        txt = page.inner_text('.view.library-ex')
        R.check('Transverse, muscle profond, invisible en surface' in txt, f'{t} fiche : légende de la vignette')
        R.check('Transverse (profond)' in txt and 'Abdominaux' not in txt.split('Muscles')[-1][:80], f'{t} fiche : Muscles = Transverse (profond)')
        R.check('Durée' in txt, f'{t} fiche : mesure Durée')
        cues = page.evaluate("[...document.querySelectorAll('.library-ex .howto__cues li')].map(li => li.textContent)")
        R.check(cues[:2] == ['Débute couché sur le dos, genoux pliés ; puis à quatre pattes, assis, debout',
                             'Expire tout ton air, puis rentre le bas du ventre vers la colonne'] and len(cues) == 5
                and 'Bloquer sa respiration' in txt, f'{t} fiche : consignes réécrites {cues}')
        R.check(layout_ok(page), f'{t} fiche : mise en page')
        shot(page, LOT, f'fiche-{t}')
        page.evaluate("document.querySelector('.view.library-ex .group-title, .view.library-ex .exhowto')?.scrollIntoView()")
        shot(page, LOT, f'fiche-consignes-{t}')
        big_text(page)
        page.evaluate("render()")
        settle(page)
        R.check(layout_ok(page), f'{t} fiche texte agrandi : mise en page')
        shot(page, LOT, f'fiche-xl-{t}')
        R.check(not page.errors, f'{t} fiche : aucune erreur JS {page.errors}')


def t_seance(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        page.evaluate("startSession('legs')")
        page.wait_for_selector('.view.session')
        ei = page.evaluate("activeSession.exercises.findIndex(e => e.name === 'Vacuum')")
        R.check(ei >= 0 and page.evaluate(f"activeSession.exercises[{ei}].measure") == 'time', f'{t} séance : vacuum en durée')
        # Les séries d'avant du vacuum : celles de la dernière séance en secondes (15 · 15 · 12…)
        prev = page.evaluate(f"activeSession.exercises[{ei}].sets.map(s => s.prev && s.prev.reps)")
        R.check(prev[:2] == ['15', '15'], f'{t} séance : « Avant » = dernière séance en secondes {prev}')
        # Le vacuum devient l'exercice en cours : séries des autres validées
        page.evaluate(f"""ei => {{ activeSession.exercises.forEach((e, i) => {{ if (i !== ei) e.sets.forEach(s => {{ s.done = true; s.reps = s.reps || '10'; }}); }});
            persistSession(); render(); }}""", ei)
        settle(page)
        card = page.locator(f'.ex-card[data-ei="{ei}"]')
        card.scroll_into_view_if_needed()
        R.check(card.locator('.sets__head').inner_text().split()[0] == 'N°', f'{t} séance : colonne N°')
        head = card.locator('.sets__head').inner_text()
        R.check('kg' not in head and 'lb' not in head, f'{t} séance : pas de colonne de charge « {head} »')
        R.check(card.locator('.session-set .set-input:not(.set-input--required)').evaluate_all("es => es.every(e => !e.offsetParent)"),
                f'{t} séance : champ de charge masqué')
        R.check('Maintien' in card.locator('.add-set-link').first.inner_text(), f'{t} séance : « + Maintien »')
        R.check(card.locator('.ex-thumb').count() == 0, f'{t} séance : pas de vignette rouge')
        R.check(card.locator('.set-play').count() == 1, f'{t} séance : ▶ du chrono')
        shot(page, LOT, f'seance-carte-{t}')
        card.locator('.set-play').click()
        page.wait_for_selector('.rs--effort')
        settle(page)
        R.check(page.inner_text('#effortSub').strip() == 'Expire tout ton air', f'{t} chrono : préparation « {page.inner_text("#effortSub")} »')
        R.check(page.inner_text('.rs--effort').count('Maintien 1 sur 5') == 1, f'{t} chrono : « Maintien 1 sur 5 »')
        shot(page, LOT, f'chrono-prep-{t}')
        page.evaluate("activeSession.effort.start -= 7000; updateEffortUI()")   # 2 s dans le maintien
        settle(page)
        sub = page.inner_text('#effortSub').strip()
        R.check(sub == 'Respire petit, dos immobile', f'{t} chrono : pendant le maintien « {sub} »')
        R.check(page.inner_text('#effortTime').strip() in ('0:13', '0:12'), f'{t} chrono : décompte depuis 15 s ({page.inner_text("#effortTime")})')
        shot(page, LOT, f'chrono-maintien-{t}')
        big_text(page)
        R.check(layout_ok(page), f'{t} chrono texte agrandi : mise en page')
        shot(page, LOT, f'chrono-xl-{t}')
        big_text(page, False)
        page.evaluate("activeSession.effort.start -= 20000; updateEffortUI()")
        settle(page)
        s0 = page.evaluate(f"activeSession.exercises[{ei}].sets[0]")
        R.check(s0['done'] and s0['reps'] == '15' and s0['weight'] == '', f'{t} maintien validé en secondes {s0}')
        R.check(not page.errors, f'{t} séance : aucune erreur JS {page.errors}')


def t_progres(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        abs_sets = page.evaluate("[muscleLoad('month').sets.abs, muscleLoad('week').sets.abs]")
        base = page.evaluate("""() => { const h = data.history; data.history = h.filter(x => !x.id.startsWith('hvac'));
            const r = [muscleLoad('month').sets.abs, muscleLoad('week').sets.abs]; data.history = h; return r; }""")
        R.check(abs_sets == base, f'{t} Progrès : aucune série de vacuum comptée aux abdominaux {abs_sets} = {base}')
        page.click('.tabbar [data-action="go-stats"]')
        page.wait_for_selector('.view.stats')
        settle(page)
        shot(page, LOT, f'progres-{t}')
        page.evaluate("navigate(makeRoute('stats-ex', 'vacuum01'))")
        page.wait_for_selector('.view.stats-ex')
        settle(page)
        txt = page.inner_text('.view.stats-ex')
        R.check('Plus long maintien' in txt and '15 s' in txt, f'{t} Progrès › Vacuum : plus long maintien 15 s')
        R.check('Temps total sous tension' in txt and '1 min 56' in txt, f'{t} Progrès › Vacuum : temps total (50 + 66 s)')
        R.check('1RM' not in txt and ' kg' not in txt, f'{t} Progrès › Vacuum : ni 1RM ni kg')
        R.check(page.locator('.view.stats-ex [data-action="stats-mode"]').count() == 2, f'{t} Progrès › Vacuum : Plus long / Temps total')
        R.check(page.locator('.view.stats-ex [data-action="open-history"]').count() == 2, f'{t} Progrès › Vacuum : 2 séances en secondes (l\'ancienne reste dans l\'Historique)')
        R.check(page.locator('.view.stats-ex .body-map [data-muscle]').count() == 0, f'{t} Progrès › Vacuum : aucun muscle en rouge')
        R.check(layout_ok(page), f'{t} Progrès › Vacuum : mise en page')
        shot(page, LOT, f'progres-vacuum-{t}')
        big_text(page)
        page.evaluate("render()")
        settle(page)
        R.check(layout_ok(page), f'{t} Progrès › Vacuum texte agrandi : mise en page')
        shot(page, LOT, f'progres-vacuum-xl-{t}')
        big_text(page, False)
        # Ancienne séance (séries × reps) : lisible, rien de perdu
        page.evaluate("navigate(makeRoute('history-detail', 'hvac0'))")
        settle(page)
        old = page.evaluate("JSON.stringify(data.history.find(h => h.id === 'hvac0').exercises[0])")
        R.check('"measure":"reps"' in old and old.count('"reps":"12"') == 3, f'{t} ancienne séance gardée en répétitions {old}')
        body = page.inner_text('#app')
        R.check('12, 12, 12 reps' in body or '12 · 12 · 12 reps' in body, f'{t} ancienne séance lisible en reps')
        shot(page, LOT, f'ancienne-seance-{t}')
        R.check(not page.errors, f'{t} Progrès : aucune erreur JS {page.errors}')


run_main(R, [t_fiche, t_seance, t_progres])
