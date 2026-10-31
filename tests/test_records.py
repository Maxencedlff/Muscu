"""Records notés dans la séance (js/data/records.js) : bilan de fin de séance (maintien, allure sur 5 km,
jamais à égalité ni la première fois), champ records enregistré et envoyé avec la séance, Historique ›
Séance (groupe Records), Progrès › Exercice (plus long maintien, allures sur distances fixes, médaille).

Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_records.py (ou run_all.py records).
Captures : $PPL_SCRATCH/shots/lotrecords/.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'records'
R = Results(LOT)
DAY = 86400_000


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def legs(i, days, gainage, course_min, course_km, squat='60'):
    now = int(time.time() * 1000)
    return {'id': i, 'date': now - days * DAY, 'duration': 40 * 60_000, 'programme': 'ppl', 'category': 'legs', 'notes': '',
            'exercises': [{'name': 'Gainage (planche)', 'measure': 'time', 'sets': [{'weight': '', 'reps': gainage}]},
                          {'name': 'Course à pied', 'measure': 'cardio', 'sets': [{'weight': '', 'reps': course_min, 'dist': course_km}]},
                          {'name': 'Fentes', 'sets': [{'weight': '', 'reps': '12'}]},
                          {'exId': 'g1squatb', 'name': 'Squat barre', 'sets': [{'weight': squat, 'reps': '8'}]}]}


def t_records(bench, eng, dev, theme):
    t = tag(dev, theme)
    d = ppl_v2_today()
    d['history'] = [h for h in d['history'] if h['category'] != 'legs']
    d['history'] = [legs('l1', 3, '60', '30', '6')] + d['history']
    now = int(time.time() * 1000)
    active = {'activeSession': {'category': 'legs', 'programme': 'ppl', 'startedAt': now - 30 * 60_000, 'exercises': [
        {'exId': None, 'name': 'Gainage (planche)', 'measure': 'time', 'sets': [{'weight': '', 'reps': '75', 'done': True}]},
        {'exId': None, 'name': 'Course à pied', 'measure': 'cardio', 'sets': [{'weight': '', 'reps': '31', 'dist': '6.4', 'done': True}]},
        # Égalité (12 reps, comme la dernière fois) : jamais un record
        {'exId': None, 'name': 'Fentes', 'sets': [{'weight': '', 'reps': '12', 'done': True}]},
        # Jamais fait avant : la première fois ne compte pas
        {'exId': None, 'name': 'Chaise contre le mur', 'measure': 'time', 'sets': [{'weight': '', 'reps': '90', 'done': True}]},
        {'exId': 'g1squatb', 'name': 'Squat barre', 'sets': [{'weight': '40', 'reps': '8', 'warmup': True, 'done': True}, {'weight': '60', 'reps': '8', 'done': True}]},
    ]}, 'sessionNotes': '', 'rest': None}
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, json.dumps(d, ensure_ascii=False), active=active, extra={'ppl_welcome_seen': '1'})
        page.wait_for_timeout(300)
        page.wait_for_selector('.view.session')
        # Badges en direct : ceux qui seront notés (maintien, allure), jamais à égalité, la première fois ni à l'échauffement
        live = page.evaluate("activeSession.exercises.map(ex => ex.sets.map(s => liveSetBadge(ex, s, livePrior(ex))))")
        R.check(live == [['Record temps'], ['Record 5 km'], [''], [''], ['', '']], f'{t} séance : badges en direct ({live})')
        R.check(page.locator('.ex-card--collapsed .ex-summary__line svg').count() == 2, f'{t} séance : médaille sur les 2 exercices à record')
        page.locator('.ex-card--collapsed [data-action="toggle-ex"]').nth(1).click(); page.wait_for_timeout(200)
        badges = page.locator('.session-set .pr-badge').all_inner_texts()
        R.check(badges == ['Record 5 km'], f'{t} séance : badge de la course ouverte ({badges})')
        R.check(page.locator('.session-set--done .set-badge').count() == 1, f'{t} séance : badge et allure dans une même rangée')
        shot(page, LOT, f'0-badges-{t}')
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(250)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary')
        recs = [x.replace(' ', ' ').replace(' ', ' ') for x in page.locator('.sum-record').all_inner_texts()]
        R.check(any('Gainage' in x and 'Record temps' in x and '1 min 15' in x for x in recs), f'{t} bilan : record de maintien ({recs})')
        R.check(any('Course' in x and 'Record 5 km' in x and '4:51 /km' in x for x in recs), f'{t} bilan : allure sur 5 km ({recs})')
        R.check(not any('Fentes' in x or 'Chaise' in x or 'Squat' in x for x in recs), f'{t} bilan : ni égalité, ni première fois, ni échauffement ({recs})')
        shot(page, LOT, f'1-bilan-{t}')
        saved = page.evaluate('data.history[0].records')
        kinds = sorted(r['kind'] for r in saved)
        R.check(kinds == ['allure', 'distance', 'duree', 'temps'], f'{t} records notés dans la séance ({kinds})')
        R.check(all(r['kind'] != '1rm' for r in saved), f'{t} jamais le 1RM estimé')
        page.click('.sum-done'); page.wait_for_timeout(200)
        # Historique › Séance : groupe Records
        hid = page.evaluate('data.history[0].id')
        page.evaluate(f"navigate(makeRoute('history-detail', '{hid}'))")
        page.wait_for_selector('.history-detail .review-rec')
        cells = page.locator('.history-detail .review-rec').all_inner_texts()
        R.check(len(cells) == 4 and any('avant 1 min' in c for c in cells), f'{t} historique : 4 records avec l\'ancienne valeur ({cells})')
        page.locator('.history-detail .review-rec').first.scroll_into_view_if_needed()
        shot(page, LOT, f'2-historique-{t}')
        # Progrès › Exercice : Course (allures sur distances fixes) et Gainage (plus long maintien, médaille)
        key = page.evaluate("[...exerciseIndex().values()].find(i => i.name === 'Course à pied').exId")
        page.evaluate(f"navigate(makeRoute('stats-ex', '{key}'))")
        page.wait_for_selector('.stats-ex')
        txt = page.inner_text('.stats-ex').replace(' ', ' ').replace(' ', ' ')
        R.check('Meilleure allure 5 km' in txt and 'Meilleure allure 1 km' in txt and 'Meilleure allure 10 km' not in txt and 'Plus longue durée' in txt, f'{t} fiche course : allures sur distances fixes ({txt[:300]!r})')
        R.check(page.locator('.stats-ex .stats-rec').count() == 1, f'{t} fiche course : médaille sur la séance du record')
        shot(page, LOT, f'3-fiche-course-{t}')
        key = page.evaluate("[...exerciseIndex().values()].find(i => i.name === 'Gainage (planche)').exId")
        page.evaluate(f"navigate(makeRoute('stats-ex', '{key}'))")
        page.wait_for_selector('.stats-ex')
        txt = page.inner_text('.stats-ex')
        R.check('Plus long maintien' in txt and '1 min 15' in txt.replace(' ', ' '), f'{t} fiche gainage : plus long maintien')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')



def t_badges_series(bench, eng, dev, theme):
    """Badges en direct sur plusieurs séries : calculés par exercice comme les records notés, chaque record sur
    la série qui le fait, jamais sur une série qui en égale une plus tôt dans la séance."""
    t = tag(dev, theme)
    d = ppl_v2_today()
    d['history'] = [h for h in d['history'] if h['category'] != 'legs']
    d['history'] = [legs('l1', 3, '60', '30', '6', squat='100')] + d['history']
    now = int(time.time() * 1000)
    done = lambda w, r, **k: {'weight': w, 'reps': r, 'done': True, **k}
    active = {'activeSession': {'category': 'legs', 'programme': 'ppl', 'startedAt': now - 30 * 60_000, 'exercises': [
        # Charge, puis reps à la charge d'avant, puis une série qui égale la 1re : un seul record (charge)
        {'exId': 'g1squatb', 'name': 'Squat barre', 'sets': [done('102.5', '2'), done('100', '9'), done('102.5', '2')]},
        # Allure et distance par la 1re série, durée par la 2e
        {'exId': None, 'name': 'Course à pied', 'measure': 'cardio', 'sets': [done('', '31', dist='6.4'), done('', '40', dist='6.1')]},
    ]}, 'sessionNotes': '', 'rest': None}
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, json.dumps(d, ensure_ascii=False), active=active, extra={'ppl_welcome_seen': '1'})
        page.wait_for_selector('.view.session')
        live = page.evaluate("activeSession.exercises.map(ex => ex.sets.map(s => liveSetBadge(ex, s, livePrior(ex))))")
        R.check(live == [['Record charge', '', ''], ['Record 5 km', 'Record durée']], f'{t} séries : badges par exercice ({live})')
        page.locator('.ex-card--collapsed [data-action="toggle-ex"]').first.click(); page.wait_for_timeout(200)
        badges = page.locator('.session-set .pr-badge').all_inner_texts()
        R.check(badges == ['Record charge'], f'{t} séries : un seul badge sur le squat ouvert ({badges})')
        shot(page, LOT, f'4-badges-series-{t}')
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(250)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary')
        saved = page.evaluate('data.history[0].records')
        squat = [(r['kind'], r['after']) for r in saved if r['ex'] == 'Squat barre']
        R.check(squat == [('charge', 102.5)], f'{t} séries : record noté du squat = le badge ({squat})')
        course = sorted(r['kind'] for r in saved if r['ex'] == 'Course à pied')
        R.check(course == ['allure', 'distance', 'duree'], f'{t} séries : records de la course ({course})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_records, t_badges_series])
