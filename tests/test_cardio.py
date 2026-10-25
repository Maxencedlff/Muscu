"""Course et vélo : allure du cardio (séance, historique, Progrès) et entraînements lus dans Apple Santé.

L'app iOS est simulée comme dans test_icone.py : coquille Capacitor factice injectée avant le
chargement, faux module MdlfHealth dont les entraînements sont dans window.__hk.list (format de
HealthPlugin.swift, workouts). Les autres modules natifs répondent {} sans rien faire.
Vérifie aussi la règle 5.1.3 : aucune ligne de Santé dans ppl_v2 (copie iCloud, compte).
Captures : $PPL_SCRATCH/shots/lotcardio/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_cardio.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'cardio'
R = Results(LOT)
H = 3600_000

FAKE_SHELL = """
window.__hk = { list: %s, calls: 0 };
window.Capacitor = {
  isNativePlatform: () => true,
  registerPlugin: (pluginName) => {
    if (pluginName === 'MdlfHealth') return {
      requestAuthorization: async () => ({ available: true, workouts: true }),
      saveWorkout: async () => ({ saved: true }),
      bodyMass: async () => ({ samples: [] }),
      workouts: async () => { __hk.calls++; return { workouts: __hk.list }; },
    };
    return new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) });
  },
};
"""


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def workouts(now):
    """Course de l'Apple Watch il y a 5 h, sortie vélo Strava il y a 2 jours, et la séance que MDLF a écrite."""
    run_end = now - 5 * H
    ride_end = now - 2 * DAY
    return [
        {'id': 'RUN1', 'activity': 'running', 'start': run_end - 27 * 60_000, 'end': run_end, 'duration': 27 * 60,
         'km': 5.2, 'source': 'Apple Watch de Max', 'productType': 'Watch6,1', 'indoor': False, 'own': False},
        {'id': 'RIDE1', 'activity': 'cycling', 'start': ride_end - 90 * 60_000, 'end': ride_end, 'duration': 90 * 60,
         'km': 42.3, 'source': 'Strava', 'productType': 'iPhone15,2', 'indoor': False, 'own': False},
        {'id': 'OWN', 'activity': 'running', 'start': now - 3 * DAY, 'end': now - 3 * DAY + 20 * 60_000, 'duration': 20 * 60,
         'km': 3, 'source': 'MDLF Training', 'productType': 'iPhone15,2', 'indoor': False, 'own': True},
    ]


def cardio_data(now, health=True):
    """Donnée réaliste + séance libre de cardio notée à la main il y a 10 jours (5 km en 30 min, 20 km de vélo en 50 min)."""
    d = ppl_v2_today(now_ms=now)
    d['healthOn'] = health
    for k, (run_km, run_min) in enumerate([('4.5', '28'), ('5', '30')]):
        d['history'].append({'id': f'hcardio{k}', 'programme': 'free', 'category': 'free', 'date': now - (17 - 7 * k) * DAY,
                             'duration': 60 * 60_000, 'notes': '', 'exercises': [
                                 {'name': 'Course à pied', 'measure': 'cardio', 'sets': [{'weight': '', 'reps': run_min, 'dist': run_km}]},
                                 {'name': 'Vélo d\'appartement', 'measure': 'cardio', 'sets': [{'weight': '', 'reps': '50', 'dist': '20'}]}]})
    d['history'].sort(key=lambda h: -h['date'])
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


def open_app(page, theme, now, native=True, active=None, health=True):
    if native:
        page.add_init_script(FAKE_SHELL % json.dumps(workouts(now)))
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, cardio_data(now, health), active=active)
    page.wait_for_timeout(300)


def t_historique(bench, eng, dev, theme):
    t = tag(dev, theme)
    now = int(time.time() * 1000)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, now)
        page.click('.tabbar [data-action="go-history"]')
        page.wait_for_selector('.hrow--health', timeout=4000)
        rows = page.locator('.hrow--health')
        R.check(rows.count() == 2, f'{t} 2 lignes de Santé (celle écrite par MDLF écartée) : {rows.count()}')
        first = rows.first.inner_text()
        R.check('Course' in first and '5,2 km · 27 min · 5:12 /km · Apple Watch' in first, f'{t} ligne de course : {first!r}')
        R.check('Vélo' in rows.nth(1).inner_text() and 'Strava' in rows.nth(1).inner_text() and '28,2 km/h' in rows.nth(1).inner_text(),
                f'{t} ligne vélo : {rows.nth(1).inner_text()!r}')
        R.check(rows.locator('button, [data-action]').count() == 0, f'{t} lignes de Santé non modifiables')
        R.check('hk:' not in (ls(page, 'ppl_v2') or ''), f'{t} 5.1.3 : rien de Santé dans ppl_v2')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} pas de défilement horizontal')
        shot(page, LOT, f'historique-{t}')

        rows.first.click()
        page.wait_for_timeout(300)
        R.check(page.evaluate('currentView()') == 'history', f'{t} toucher une ligne de Santé ne mène nulle part')
        page.fill('#histSearch', 'strava')
        page.wait_for_timeout(200)
        R.check(page.locator('.hrow--health').count() == 1 and page.locator('.hrow:not(.hrow--health)').count() == 0,
                f'{t} recherche « strava » : la sortie vélo seule')
        page.fill('#histSearch', '')

        # Séance notée à la main : allure dans le détail
        page.evaluate("navigate(makeRoute('history-detail', 'hcardio1'))")
        page.wait_for_selector('.history-detail')
        txt = page.inner_text('.history-detail')
        R.check('5 km · 30 min · 6:00 /km' in txt, f'{t} détail : allure de la course')
        R.check('20 km · 50 min · 24 km/h' in txt, f'{t} détail : vitesse du vélo')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_accueil(bench, eng, dev, theme):
    t = tag(dev, theme)
    now = int(time.time() * 1000)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, now)
        page.wait_for_function('window.__hk.calls > 0 && healthEntries().length > 0', timeout=4000)
        page.wait_for_timeout(300)
        st = page.evaluate("(() => { const s = catStatus('legs'); return { ready: s.ready, by: s.by && s.by.entry.id, why: s.by && recoveryReason(s.by) }; })()")
        R.check(st['ready'] is False and st['by'] == 'hk:RUN1', f'{t} jambes en récupération après la course : {st}')
        R.check(st['why'] and st['why'].endswith("aujourd'hui, Course (Apple Watch)"), f'{t} raison : {st["why"]!r}')
        R.check(page.locator('[data-status-cat="legs"] .home-cell__status--ready').count() == 0, f'{t} Legs pas prête à l\'accueil')
        page.evaluate("""document.querySelector('[data-status-cat="legs"]')?.scrollIntoView({ block: 'center' })""")
        shot(page, LOT, f'accueil-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_seance(bench, eng, dev, theme):
    """Séance en cours : allure sous la série de course validée ; Progrès › Course à pied : courbe d'allure."""
    t = tag(dev, theme)
    now = int(time.time() * 1000)
    active = {'activeSession': {'category': 'legs', 'programme': 'ppl', 'startedAt': now - 35 * 60_000, 'baseline': {}, 'exercises': [
        {'exId': 'n:course a pied', 'name': 'Course à pied', 'measure': 'cardio', 'sets': [
            {'weight': '', 'reps': '30', 'dist': '5', 'plannedWeight': '', 'prev': {'weight': '', 'reps': '28', 'dist': '4.5'}, 'done': True},
            {'weight': '', 'reps': '', 'plannedWeight': '', 'prev': None, 'done': False}]},
        {'exId': 'n:velo', 'name': 'Vélo', 'measure': 'cardio', 'sets': [
            {'weight': '', 'reps': '60', 'dist': '25', 'plannedWeight': '', 'prev': None, 'done': True},
            {'weight': '', 'reps': '', 'plannedWeight': '', 'prev': None, 'done': False}]}]},
        'sessionNotes': '', 'rest': None}
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, now, native=False, active=active, health=False)
        page.wait_for_selector('.pace-badge', timeout=4000)
        badges = page.locator('.pace-badge').all_inner_texts()
        R.check(badges == ['6:00 /km', '25 km/h'], f'{t} allure des séries validées : {badges}')
        label = page.locator('.session-set--done').first.get_attribute('aria-label')
        R.check('6 minutes au kilomètre' in label, f'{t} VoiceOver : {label!r}')
        page.locator('.pace-badge').first.scroll_into_view_if_needed()
        shot(page, LOT, f'seance-{t}')

        page.evaluate("routeTo('stats'); navigate(makeRoute('stats-ex', [...exerciseIndex().values()].find(i => i.name === 'Course à pied').exId))")
        page.wait_for_selector('.stats-ex')
        modes = page.locator('.stats-ex .segmented__btn').all_inner_texts()
        R.check(modes == ['Durée', 'Distance', 'Allure'], f'{t} Progrès : courbes du cardio {modes}')
        page.click('[data-action="stats-cardio-mode"][data-mode="pace"]')
        page.wait_for_timeout(250)
        head = page.inner_text('.chart-head__val')
        R.check(head == '6:00 /km', f'{t} Progrès : dernière allure {head!r}')
        trend = page.locator('.chart-head__trend')
        R.check(trend.count() == 1 and 'txt-up' in trend.get_attribute('class'), f'{t} Progrès : allure plus rapide = progrès (vert)')
        txt = page.inner_text('.stats-ex')
        R.check('Meilleure allure' in txt and 'Plus longue distance' in txt, f'{t} Progrès : records du cardio')
        shot(page, LOT, f'progres-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_pwa(bench, eng, dev, theme):
    """Dans le navigateur : aucune ligne de Santé, aucune lecture."""
    t = tag(dev, theme)
    now = int(time.time() * 1000)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, now, native=False)
        page.click('.tabbar [data-action="go-history"]')
        page.wait_for_selector('.history')
        page.wait_for_timeout(300)
        R.check(page.locator('.hrow--health').count() == 0, f'{t} PWA : pas de ligne de Santé')
        R.check(not page.errors, f'{t} PWA : aucune erreur JS {page.errors}')


run_main(R, [t_historique, t_accueil, t_seance, t_pwa])
