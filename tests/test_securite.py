"""Sécurité de l'affichage et de la donnée (audit du 18/10/2026, constats 1, 2, 3 et 10).

- Donnée hostile (stockée ou importée) : chaque champ texte contient une balise qui appelle
  window.__x si elle est interprétée. On parcourt toutes les routes, avec et sans séance en cours,
  pour un programme intégré, un programme perso et une séance perso : __x ne doit jamais être appelé.
- Un nom avec des chevrons (« Bras <Hiver> & épaules ») s'affiche tel quel.
- « Supprimer toutes les données » garde la copie de secours après relancement.
Lancer : python3 test_securite.py (tests uniques, WebKit iPhone 13 et Chromium Pixel 7).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'securite'
R = Results(LOT)
ENGINES = [('webkit', 'iPhone 13'), ('chromium', 'Pixel 7')]
HOOK = "window.__x = t => { (window.__hits = window.__hits || []).push(t); };"


def P(t):
    """Charge qui sort d'un attribut ou d'un texte et appelle __x si elle est interprétée."""
    return f"'\"><img src=x onerror=__x('{t}')>"


def hostile(now):
    ex = {'id': 'e1', 'name': P('exname'), 'sets': 3, 'rest': P('rest'), 'target': P('target'), 'repMax': P('repMax'),
          'muscles': [P('muscle'), 'chest'], 'lastWeight': P('lw'), 'lastReps': P('lr'),
          'pr': {'weight': P('prw'), 'reps': P('prr')}, 'est1RM': P('1rm')}
    hist = lambda hid, prog, cat, dt: {
        'id': hid, 'programme': prog, 'category': cat, 'date': now - dt, 'duration': P('duration'), 'notes': P('notes'),
        'exercises': [{'exId': 'e1', 'name': P('hexname'), 'sets': [{'weight': '60', 'reps': '8'}]},
                      {'exId': P('exid'), 'name': 'Squat', 'sets': [{'weight': '80', 'reps': '5'}]}]}
    return {
        'schema': 3, 'activeProgramme': 'ppl',
        'programmes': {
            'ppl': {'exercises': {'push': [ex], 'pull': [], 'legs': []}, 'timers': {}, 'cooldowns': {'push': P('cooldown')}},
            'u_a': {'exercises': {'s1': [dict(ex)]}, 'timers': {}, 'cooldowns': {}},
            'custom': {'exercises': {'cs1': [dict(ex)]}, 'timers': {}, 'cooldowns': {}},
            P('progkey'): {'exercises': {}, 'timers': {}, 'cooldowns': {}},
        },
        'customSessions': {'cs1': {'label': P('cslabel'), 'icon': P('csicon'), 'desc': P('csdesc'), 'color': '#ff0000'}},
        'userProgrammes': {'u_a': {'name': P('upname'), 'archived': False,
                                   'sessions': {'s1': {'label': P('uplabel'), 'icon': P('upicon'), 'desc': P('updesc'), 'color': '#00ff00'}}}},
        'defaultRest': 90, 'unit': 'kg', 'soundOn': True, 'vibrateOn': True, 'lastExport': P('lastExport'),
        'history': [hist('h1', 'ppl', 'push', 3600e3), hist('h2', 'u_a', 's1', 7200e3), hist('h3', 'custom', 'cs1', 9000e3),
                    hist('h4', P('hprog'), P('hcat'), 11000e3)],
    }


def active(now, prog, cat):
    return {'activeSession': {'category': cat, 'programme': prog, 'startedAt': now - 600e3, 'baseline': {},
                              'exercises': [{'exId': 'e1', 'name': P('asname'), 'rest': P('asrest'), 'sets': [
                                  {'weight': P('asw'), 'reps': P('asr'), 'plannedWeight': P('aspw'),
                                   'prev': {'weight': P('prevw'), 'reps': P('prevr')}, 'done': False}]}]},
            'sessionNotes': P('sessnotes'), 'rest': {'endTime': now + 60e3, 'minimized': True, 'total': 90}}


ROUTES = ['dashboard', 'programmes', 'editor:{c}', 'ex-edit:{c}:0', 'history', 'history-detail:{h}', 'stats',
          'stats-ex:e1', 'stats-overview', 'stats-muscles', 'settings', 'summary', 'prog-picker', 'cs-edit',
          'add-session', 'session']
CASES = [('ppl', 'push', 'h1'), ('u_a', 's1', 'h2'), ('custom', 'cs1', 'h3')]


def sweep(page, label, cat, hid):
    for r in ROUTES:
        r = r.format(c=cat, h=hid)
        page.evaluate('r => navigate(r)', r)
        page.wait_for_timeout(120)
    # Aperçu de la story depuis le détail de la séance
    page.evaluate('r => navigate(r)', f'history-detail:{hid}')
    btn = page.locator('[data-action*="share"]')
    if btn.count():
        btn.first.click()
        page.wait_for_timeout(600)
    hits = page.evaluate('window.__hits || []')
    R.check(not hits, f'{label} : aucune balise interprétée {sorted(set(hits))}')


def t_hostile(bench):
    now = int(time.time() * 1000)
    for eng, dev in ENGINES:
        for prog, cat, hid in CASES:
            for with_active in (False, True):
                d = hostile(now)
                d['activeProgramme'] = prog
                label = f'{eng} {prog} {"séance en cours" if with_active else "sans séance"}'
                with bench.page(eng, dev, 'dark') as page:
                    page.add_init_script(HOOK)
                    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
                    seed(page, 'dark', json.dumps(d), active(now, prog, cat) if with_active else None)
                    sweep(page, label, cat, hid)

        # Même donnée passée par l'import (et donc par sanitizeData)
        with bench.page(eng, dev, 'dark') as page:
            page.add_init_script(HOOK)
            page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
            seed(page, 'dark', None)
            res = page.evaluate('t => importText(t)', json.dumps(hostile(now)))
            R.check(res.get('ok') is True, f'{eng} import du jeu hostile accepté (nettoyé) {res}')
            ex = page.evaluate("() => JSON.parse(localStorage.getItem('ppl_v2')).programmes.ppl.exercises.push[0]")
            R.check('repMax' not in ex and ex.get('rest') is None and ex.get('target') is None, f'{eng} import : repMax, repos et objectif invalides retirés {ex}')
            R.check(ex.get('muscles') == ['chest'], f'{eng} import : seuls les identifiants de muscles restent {ex.get("muscles")}')
            sweep(page, f'{eng} après import', 'push', 'h1')
            R.check(not page.errors, f'{eng} import : aucune erreur JS {page.errors[:3]}')


def t_chevrons(bench):
    """Sans malveillance : un nom avec des chevrons s'affiche tel quel, sans créer d'élément."""
    now = int(time.time() * 1000)
    name = 'Bras <Hiver> & épaules'
    d = json.loads(ppl_v2_today_json())
    d['userProgrammes'] = {'u_b': {'name': name, 'archived': False, 'sessions': {'s1': {'label': 'Bras', 'icon': '💪', 'desc': '', 'color': '#AF52DE'}}}}
    d['programmes']['u_b'] = {'exercises': {'s1': [{'id': 'b1', 'name': 'Curl', 'sets': 3}]}, 'timers': {}, 'cooldowns': {}}
    d['history'].insert(0, {'id': 'hb', 'programme': 'u_b', 'category': 's1', 'date': now - 3600e3, 'notes': '<ok>',
                            'exercises': [{'exId': 'b1', 'name': 'Curl', 'sets': [{'weight': '12', 'reps': '10'}]}]})
    for eng, dev in ENGINES:
        with bench.page(eng, dev, 'light') as page:
            seed(page, 'light', json.dumps(d, ensure_ascii=False))
            page.evaluate("r => navigate(r)", 'history')
            page.wait_for_timeout(250)
            R.check(f'Programme {name}' in page.inner_text('#app'), f'{eng} historique : nom affiché tel quel')
            R.check(page.locator('hiver').count() == 0, f'{eng} historique : aucun élément <hiver>')
            page.evaluate("r => navigate(r)", 'history-detail:hb')
            page.wait_for_timeout(250)
            txt = page.inner_text('#app')
            R.check(name in txt and '<ok>' in txt, f'{eng} détail : nom et note affichés tels quels')
            page.evaluate("r => navigate(r)", 'stats')
            page.wait_for_timeout(250)
            R.check(page.locator('hiver').count() == 0, f'{eng} Progrès : aucun élément <hiver>')


def t_wipe(bench):
    """« Supprimer toutes les données » : la copie de secours survit au lancement suivant."""
    for eng, dev in ENGINES:
        with bench.page(eng, dev, 'dark') as page:
            seed(page, 'dark', ppl_v2_today_json())
            n = page.evaluate('data.history.length')
            page.evaluate("r => navigate(r)", 'settings')
            page.locator('[data-action="wipe-data"]').click()
            page.wait_for_timeout(300)
            tap_dialog(page, 'Tout supprimer')
            tap_dialog(page, 'Supprimer')
            R.check(page.evaluate('data.history.length') == 0, f'{eng} données supprimées')
            backup = lambda: (json.loads(ls(page, 'ppl_v2_backup') or '{}').get('history') or [])
            R.check(len(backup()) == n, f'{eng} copie de secours faite ({len(backup())}/{n})')
            page.reload()
            page.wait_for_selector('#app > *')
            R.check(len(backup()) == n, f'{eng} copie de secours conservée après relancement ({len(backup())}/{n})')
            R.check(json.loads(ls(page, 'ppl_v2')).get('schema') == 3, f'{eng} donnée vide au schéma courant')
            R.check(not page.errors, f'{eng} aucune erreur JS {page.errors[:3]}')


run_main(R, [], once=[t_hostile, t_chevrons, t_wipe])
