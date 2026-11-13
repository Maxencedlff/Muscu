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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'cardio'
R = Results(LOT)
H = 3600_000

# Horloge figée le mercredi 28 octobre 2026 à 19 h, heure de Paris : la course de « il y a 5 h » tombe
# aujourd'hui quelle que soit l'heure du test (lancé entre minuit et 5 h, elle tombait hier).
NOW = local_ms(2026, 10, 28, 19, 0, tz=PARIS)


FAKE_SHELL = """
window.__hk = { list: %s, calls: 0 };
window.Capacitor = {
  isNativePlatform: () => true,
  registerPlugin: (pluginName) => {
    if (pluginName === 'MdlfHealth') return {
      requestAuthorization: async () => ({ available: true, workouts: true }),
      authorizationStatus: async () => ({ available: true, request: 'unnecessary' }),
      saveWorkout: async () => ({ saved: true }),
      saveWorkouts: async ({ workouts }) => ({ saved: workouts.length, total: workouts.length }),
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
    now = NOW
    with bench.frozen_page(NOW, eng, dev, theme) as page:
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
    now = NOW
    with bench.frozen_page(NOW, eng, dev, theme) as page:
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
    now = NOW
    active = {'activeSession': {'category': 'legs', 'programme': 'ppl', 'startedAt': now - 35 * 60_000, 'baseline': {}, 'exercises': [
        {'exId': 'n:course a pied', 'name': 'Course à pied', 'measure': 'cardio', 'sets': [
            {'weight': '', 'reps': '30', 'dist': '5', 'plannedWeight': '', 'prev': {'weight': '', 'reps': '28', 'dist': '4.5'}, 'done': True},
            {'weight': '', 'reps': '', 'plannedWeight': '', 'prev': None, 'done': False}]},
        {'exId': 'n:velo', 'name': 'Vélo', 'measure': 'cardio', 'sets': [
            {'weight': '', 'reps': '60', 'dist': '25', 'plannedWeight': '', 'prev': None, 'done': True},
            {'weight': '', 'reps': '', 'plannedWeight': '', 'prev': None, 'done': False}]}]},
        'sessionNotes': '', 'rest': None}
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, now, native=False, active=active, health=False)
        page.wait_for_selector('.pace-badge', timeout=4000)
        badges = page.locator('.pace-badge').all_inner_texts()
        R.check(badges == ['6:00 /km', '25 km/h'], f'{t} allure des séries validées : {badges}')
        label = page.locator('.session-set--done .sr-text').first.text_content() or ''
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


def machine_set(prev=None):
    return {'weight': '', 'reps': '', 'plannedWeight': '', 'prev': prev, 'done': False}


def shift_clock(page, sec):
    """Fait comme si sec secondes de chrono étaient passées (horodatage de départ reculé, séance enregistrée)."""
    page.evaluate("s => { activeSession.effort.start -= s * 1000; persistSession(); updateEffortUI(); }", sec)


def t_machines(bench, eng, dev, theme):
    """Machines de cardio : chrono, réglage noté au fil de l'effort (−/+, saisie directe, unité), rechargement en
    pleine séance, bilan (moyenne pondérée, temps à chaque valeur, étages), tapis à deux valeurs, rameur aux 500 m."""
    t = tag(dev, theme)
    now = NOW
    active = {'activeSession': {'category': 'legs', 'programme': 'ppl', 'startedAt': now - 10 * 60_000, 'baseline': {}, 'exercises': [
        {'exId': 'n:escaliers', 'name': 'Escaliers', 'measure': 'cardio', 'sets': [
            machine_set({'weight': '', 'reps': '20', 'machine': {'end': 1200, 'lvl': [[0, 7, 'level'], [300, 9, 'level']]}})]},
        {'exId': 'n:tapis', 'name': 'Tapis de course', 'measure': 'cardio', 'sets': [machine_set()]},
        {'exId': 'n:rameur', 'name': 'Rameur', 'measure': 'cardio', 'sets': [machine_set()]}]},
        'sessionNotes': '', 'rest': None}
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, now, native=False, active=active, health=False)
        plays = page.locator('.set-play')
        R.check(plays.count() == 3, f'{t} ▶ sur les trois machines ({plays.count()})')
        plays.first.click()
        page.wait_for_selector('.rs--machine .mach-slot')
        val = lambda sl='lvl': page.inner_text(f'.rs--machine .mach-val[data-slot="{sl}"]').strip()
        R.check(val() == '7', f'{t} départ au niveau du début de la dernière fois : {val()!r}')
        R.check(page.locator('.mach-units__btn[aria-pressed="true"]').inner_text() == 'Niveau', f'{t} unité Niveau par défaut')
        shot(page, LOT, f'machine-chrono-{t}')
        # 10 min au niveau 7, puis trois + d'affilée : un seul changement, niveau 10
        shift_clock(page, 600)
        for _ in range(3):
            page.click('.rs--machine [data-action="mach-step"][data-d="1"]')
        R.check(val() == '10', f'{t} + + + : niveau 10 ({val()!r})')
        log = page.evaluate("activeSession.effort.log.lvl")
        R.check(log[0] == [0, 7, 'level'] and len(log) == 2 and 600 <= log[1][0] <= 603 and log[1][1:] == [10, 'level'],
                f'{t} changement daté au chrono, un seul pour trois + : {log}')
        # Rechargement en pleine séance : chrono, valeur et journal repris
        page.reload()
        page.wait_for_selector('.rs--machine .mach-slot')
        R.check(val() == '10', f'{t} rechargement : niveau 10 gardé ({val()!r})')
        clock = page.inner_text('#effortTime')
        R.check(clock.startswith('10:'), f'{t} rechargement : chrono repris ({clock})')
        # 10 min plus tard : Marches/min, saisie directe de 80
        shift_clock(page, 600)
        page.click('.mach-units__btn[data-u="spm"]')
        R.check(val() == '—', f'{t} autre unité : rien de converti ({val()!r})')
        page.click('.rs--machine .mach-val[data-slot="lvl"]')
        page.fill('.mach-val--input', '80')
        page.keyboard.press('Enter')
        page.wait_for_timeout(150)
        R.check(val() == '80', f'{t} saisie directe : 80 marches/min ({val()!r})')
        shot(page, LOT, f'machine-spm-{t}')
        shift_clock(page, 300)
        page.click('#effortStop')
        page.wait_for_selector('.rs--review')
        review = page.inner_text('.rs--review')
        R.check('Niveau moyen 8,5' in review and '80 marches/min' in review, f'{t} bilan : moyenne pondérée et unités séparées')
        bars = page.locator('.mach-bar').count()
        R.check(bars == 3, f'{t} bilan : temps à chaque valeur ({bars} barres)')
        R.check(page.locator('#machDist').count() == 0, f'{t} escaliers : pas de distance')
        page.fill('#machX-floors', '42')
        shot(page, LOT, f'machine-bilan-{t}')
        page.click('[data-action="mach-save"]')
        page.wait_for_selector('.ex-summary__line')   # exercice terminé : replié sur sa ligne
        s0 = page.evaluate("activeSession.exercises[0].sets[0]")
        R.check(s0['done'] and s0['reps'] == '25' and 1500 <= s0['machine']['end'] <= 1510 and s0['machine']['floors'] == 42,
                f'{t} série validée : 25 min, durée exacte, étages ({s0.get("reps")}, {s0.get("machine")})')
        line = page.locator('.ex-summary__line').first.inner_text()
        R.check(line == '25 min · niveau moy. 8,5 · 80 marches/min · 42 étages', f'{t} ligne de l\'exercice : {line!r}')
        page.evaluate("stopRest(); closeSessSheets(); removeRestUI()")

        # Tapis : vitesse et inclinaison suivies ensemble
        page.locator('.set-play').first.click()
        page.wait_for_selector('.rs--machine .mach-slot[data-slot="incl"]')
        R.check(page.locator('.rs--machine .mach-slot').count() == 2, f'{t} tapis : deux rangées')
        page.click('.rs--machine .mach-val[data-slot="speed"]')
        page.fill('.mach-val--input', '10,5')
        page.keyboard.press('Enter')
        page.wait_for_timeout(150)
        page.click('.rs--machine .mach-slot[data-slot="incl"] [data-action="mach-step"][data-d="1"]')
        page.click('.rs--machine .mach-slot[data-slot="incl"] [data-action="mach-step"][data-d="1"]')
        R.check(val('speed') == '10,5' and val('incl') == '0,5', f'{t} tapis : 10,5 km/h, 0,5 % ({val("speed")}, {val("incl")})')
        shot(page, LOT, f'machine-tapis-{t}')
        shift_clock(page, 900)
        page.click('.rs--machine .mach-slot[data-slot="speed"] [data-action="mach-step"][data-d="1"]')
        shift_clock(page, 900)
        page.click('#effortStop')
        page.wait_for_selector('.rs--review')
        page.fill('#machDist', '5,3')
        page.click('[data-action="mach-save"]')
        page.wait_for_timeout(300)
        s1 = page.evaluate("activeSession.exercises[1].sets[0]")
        R.check(s1['done'] and s1['dist'] == '5.3' and s1['reps'] == '30', f'{t} tapis : 5,3 km en 30 min ({s1.get("dist")}, {s1.get("reps")})')
        txt = page.locator('.ex-summary__line').nth(1).inner_text()
        R.check(('10,5 km/h moy.' in txt or '10,6 km/h moy.' in txt) and '0,5 %' in txt and '5:40 /km' in txt, f'{t} tapis : vitesse moyenne pondérée ({txt!r})')
        page.evaluate("stopRest(); closeSessSheets(); removeRestUI()")

        # Rameur : pas de réglage au chrono, temps aux 500 m calculé de la durée exacte
        page.locator('.set-play').first.click()
        page.wait_for_selector('.rs--machine')
        R.check(page.locator('.rs--machine .mach-slot').count() == 0, f'{t} rameur : aucun réglage suivi')
        shift_clock(page, 452)
        page.click('#effortStop')
        page.wait_for_selector('.rs--review #machDist')
        page.fill('#machDist', '2')
        page.wait_for_timeout(100)
        split = page.inner_text('#machSplit')
        R.check('1:53' in split, f'{t} rameur : 2 000 m en 7:32 = 1:53 /500 m ({split!r})')
        page.fill('#machX-damper', '5')
        shot(page, LOT, f'machine-rameur-{t}')
        page.click('[data-action="mach-save"]')
        page.wait_for_timeout(300)
        badges = page.locator('.ex-summary__line').nth(2).inner_text()
        R.check('1:53 /500 m' in badges and 'résistance 5' in badges, f'{t} rameur : ligne validée ({badges!r})')
        # Série rouverte : allure et réglage sous la ligne validée
        page.locator('.ex-summary').nth(2).click()
        page.wait_for_timeout(300)
        badge = page.locator('.session-set--done .mach-badge')
        R.check(badge.count() == 1 and badge.inner_text() == 'résistance 5', f'{t} rameur déplié : pastille du réglage')
        # La séance enregistrée garde les réglages (format de sessions.data)
        entry = page.evaluate("sessionHistoryEntry('ppl', 'legs').exercises.map(e => e.sets[0].machine)")
        R.check(entry[0]['lvl'][-1][1:] == [80, 'spm'] and entry[1]['speed'] and {k: v for k, v in entry[2].items() if k != 'at'} == {'end': 452, 'damper': 5},
                f'{t} séance enregistrée : réglages gardés {entry}')
        # Heure du départ de chaque chrono (Santé situe le cardio dans la séance) : dans les dernières 24 h
        now_ms = page.evaluate('Date.now()')
        R.check(all(isinstance(m.get('at'), int) and now_ms - 86400_000 < m['at'] <= now_ms for m in entry), f'{t} séance enregistrée : heure du chrono gardée')
        page.evaluate("stopRest(); closeSessSheets(); removeRestUI()")
        shot(page, LOT, f'machine-seance-{t}')

        R.check(not page.errors, f'{t} machines : aucune erreur JS {page.errors}')


def t_alias(bench, eng, dev, theme):
    """« Pec fly » est un alias de « Pec deck » : « = Pec deck » sous le nom (programme, Comment faire)."""
    t = tag(dev, theme)
    now = NOW
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, now, native=False, health=False)
        page.evaluate("navigate(makeRoute('library-ex', 'Pec fly'))")
        page.wait_for_selector('.view.library-ex')
        note = page.locator('.library-ex .ex-alias').inner_text().strip()
        R.check(note.endswith('= Pec deck') or note == '= Pec deck', f'{t} fiche : {note!r}')
        R.check(page.locator('.library-ex .navbar__title').inner_text().strip() == 'Pec fly', f'{t} fiche : titre = nom tapé')
        shot(page, LOT, f'alias-fiche-{t}')
        page.evaluate("navigate(makeRoute('library-ex', 'Pec deck'))")
        page.wait_for_timeout(300)
        R.check(page.locator('.view.library-ex .ex-alias').count() == 0, f'{t} fiche du nom exact : rien')
        # Programme › Exercice : suit la frappe
        page.evaluate("exDraft = null; navigate(makeRoute('ex-edit', 'push', 0))")
        page.wait_for_selector('#exName')
        page.fill('#exName', 'Dead lift')
        page.wait_for_timeout(150)
        R.check(page.inner_text('#exAlias').strip().endswith('= Soulevé de terre'), f'{t} édition : {page.inner_text("#exAlias")!r}')
        page.fill('#exName', 'Mon exercice')
        page.wait_for_timeout(150)
        R.check(page.inner_text('#exAlias').strip() == '', f'{t} édition : nom libre, rien')
        R.check(not page.errors, f'{t} alias : aucune erreur JS {page.errors}')


def t_pwa(bench, eng, dev, theme):
    """Dans le navigateur : aucune ligne de Santé, aucune lecture."""
    t = tag(dev, theme)
    now = NOW
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, now, native=False)
        page.click('.tabbar [data-action="go-history"]')
        page.wait_for_selector('.history')
        page.wait_for_timeout(300)
        R.check(page.locator('.hrow--health').count() == 0, f'{t} PWA : pas de ligne de Santé')
        R.check(not page.errors, f'{t} PWA : aucune erreur JS {page.errors}')


run_main(R, [t_historique, t_accueil, t_seance, t_machines, t_alias, t_pwa])
