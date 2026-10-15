"""Données de test réalistes et outils partagés par les tests Playwright de PPL Training.

- ppl_v2_today() : donnée au format actuel (avant le lot 1) : SANS champ schema ni exId,
  ~9 semaines d'historique push/pull/legs à charges progressives, une séance Perso avec emoji,
  quelques entrées sans champ programme, des reps stockées en nombre, un PR faussé.
- old_active_session() : un ppl_active_session au format d'avant le lot 1.
"""
import json
import os
import time
import contextlib

BASE_URL = os.environ.get('PPL_URL', 'http://localhost:8731/')
SCRATCH = os.environ.get('PPL_SCRATCH', '/tmp/ppl-tests')
SHOTS = os.path.join(SCRATCH, 'shots')

DEVICES = [
    ('webkit', 'iPhone 13'),
    ('webkit', 'iPhone SE'),
    ('chromium', 'Pixel 7'),
    ('chromium', 'Galaxy S8'),
    ('chromium', 'Galaxy S9+'),
]
THEMES = ['dark', 'light']

DAY = 86400_000

# Identifiants fixes des exercices (comme ceux générés par uid() dans l'app)
PUSH = [('p1dcouch', 'Développé couché haltères', 4, 22.5), ('p2dincli', 'Développé incliné haltères', 3, 18),
        ('p3ecarte', 'Écarté haltères plat', 3, 10), ('p4milita', 'Développé militaire haltères', 4, 16),
        ('p5elevat', 'Élévations latérales', 4, 6), ('p6extric', 'Extension triceps poulie', 3, 20)]
PULL = [('l1rowing', 'Rowing haltère unilatéral', 4, 24), ('l2tirver', 'Tirage vertical prise large', 4, 45),
        ('l3tirhor', 'Tirage horizontal câble', 3, 40), ('l4curlbi', 'Curl biceps haltères', 3, 10),
        ('l5curlma', 'Curl marteau', 3, 12)]
LEGS = [('g1squatb', 'Squat barre', 4, 60), ('g2presse', 'Presse à cuisses', 4, 120),
        ('g3fentes', 'Fentes marchées haltères', 3, 14), ('g4legcur', 'Leg curl machine', 3, 30),
        ('g5extqua', 'Extension quadriceps', 3, 35), ('g6mollet', 'Mollets debout', 4, None)]
CUSTOM_ID = 'cs4k2m9q'
CUSTOM = [('c1curlpu', 'Curl pupitre', 3, 20), ('c2extnuq', 'Extension nuque', 3, 14)]

REPS = {4: [10, 10, 9, 8], 3: [12, 10, 10]}


def fmt_w(w):
    if w is None:
        return ''
    return ('%g' % w)


def calc1rm(w, r):
    w = float(w or 0); r = int(r or 0)
    if w <= 0 or r <= 0 or r > 12:
        return None
    return round(w * (1 + r / 30) * 10) / 10


def make_ex(eid, name, sets):
    return {'id': eid, 'name': name, 'sets': sets, 'lastWeight': '', 'lastReps': '',
            'pr': None, 'est1RM': None, 'target': None, 'rest': None}


def ppl_v2_today(now_ms=None, weeks=9):
    now = now_ms or int(time.time() * 1000)
    history = []
    for k in range(weeks):
        back = (weeks - 1 - k) * 7 * DAY
        for cat, exs, days_ago in (('push', PUSH, 8), ('pull', PULL, 6), ('legs', LEGS, 4)):
            date = now - back - days_ago * DAY - 3 * 3600_000
            exercises = []
            for eid, name, nsets, base in exs:
                w = None if base is None else base + 2.5 * (k // 2)
                reps = REPS[nsets] if base is not None else [15, 15, 14, 12][:nsets]
                sets = []
                for r in reps:
                    # Quelques séries enregistrées avec reps en nombre (ancienne édition de série)
                    sets.append({'weight': fmt_w(w), 'reps': r if (k == 3 and cat == 'push') else str(r)})
                exercises.append({'name': name, 'sets': sets})
            if cat == 'pull' and k == 5:
                exercises.append({'name': 'Dips', 'sets': [{'weight': '', 'reps': '12'}, {'weight': '', 'reps': '10'}]})
            entry = {'id': 'h%s%02d' % (cat[:2], k), 'programme': 'ppl', 'category': cat, 'date': date,
                     'duration': (52 + k) * 60_000, 'notes': '', 'exercises': exercises}
            if k == 0:
                del entry['programme']  # entrées venues de ppl_v1
            if k == 6 and cat == 'legs':
                entry['notes'] = 'Genou un peu raide, "squat" léger <ok>'
            history.append(entry)
    # Séance Perso avec emoji
    for i in range(3):
        date = now - (20 - i * 7) * DAY
        history.append({'id': 'hcs%02d' % i, 'programme': 'custom', 'category': CUSTOM_ID, 'date': date,
                        'duration': 40 * 60_000, 'notes': 'Pump 💥' if i == 2 else '',
                        'exercises': [{'name': n, 'sets': [{'weight': fmt_w(b + i), 'reps': '10'}] * s}
                                      for _, n, s, b in CUSTOM]})
    history.sort(key=lambda h: -h['date'])

    def prog_ex(lst):
        return [make_ex(eid, name, s) for eid, name, s, _ in lst]

    ppl = {'exercises': {'push': prog_ex(PUSH), 'pull': prog_ex(PULL), 'legs': prog_ex(LEGS)},
           'timers': {}, 'cooldowns': {'push': 72, 'pull': 72, 'legs': 72}}
    custom = {'exercises': {CUSTOM_ID: prog_ex(CUSTOM)}, 'timers': {CUSTOM_ID: None}, 'cooldowns': {CUSTOM_ID: 72}}
    d = {'activeProgramme': 'ppl', 'programmes': {'ppl': ppl, 'custom': custom},
         'customSessions': {CUSTOM_ID: {'label': 'Bras 💥', 'icon': '💥', 'desc': 'Biceps · Triceps', 'color': '#ec4899'}},
         'defaultRest': 90, 'unit': 'kg', 'soundOn': True, 'vibrateOn': True, 'history': history,
         '_prRecomputed': True}
    # PR / dernière série comme les calculait l'app (ordre chronologique)
    for pkey, p in d['programmes'].items():
        for cat, lst in p['exercises'].items():
            sess = sorted([h for h in history if h.get('programme', 'ppl') == pkey and h['category'] == cat], key=lambda h: h['date'])
            if sess:
                p['timers'][cat] = sess[-1]['date']
            for ex in lst:
                for h in sess:
                    for he in h['exercises']:
                        if he['name'] != ex['name']:
                            continue
                        for st in he['sets']:
                            w = float(st['weight'] or 0); r = int(st['reps'] or 0)
                            ex['lastWeight'] = st['weight']; ex['lastReps'] = st['reps']
                            pw = float((ex['pr'] or {}).get('weight') or 0); pr = int((ex['pr'] or {}).get('reps') or 0)
                            if w > pw or (w == pw and r > pr):
                                ex['pr'] = {'weight': st['weight'], 'reps': st['reps']}
                            e1 = calc1rm(st['weight'], st['reps'])
                            if e1 and (not ex['est1RM'] or e1 > ex['est1RM']):
                                ex['est1RM'] = e1
    # PR faussé par une séance abandonnée (bug d'avant le lot 1)
    curl = next(e for e in ppl['exercises']['pull'] if e['id'] == 'l5curlma')
    curl['pr'] = {'weight': '40', 'reps': '6'}
    curl['est1RM'] = 48
    return d


def ppl_v2_today_json(**kw):
    # Sérialisation compacte, comme JSON.stringify(data) dans l'app
    return json.dumps(ppl_v2_today(**kw), ensure_ascii=False, separators=(',', ':'))


def old_active_session(now_ms=None, with_rest=False):
    """ppl_active_session d'avant le lot 1 : séries {weight, reps, done}, sans baseline ni prev."""
    now = now_ms or int(time.time() * 1000)
    exs = []
    for i, (eid, name, nsets, base) in enumerate(PULL):
        w = fmt_w(base + 10)
        sets = []
        for si in range(nsets):
            done = (i == 0 and si < 2)
            sets.append({'weight': w, 'reps': '10' if (i == 0) else '', 'done': done})
        exs.append({'exId': eid, 'name': name, 'sets': sets})
    exs.append({'exId': None, 'name': 'Shrugs', 'sets': [{'weight': '30', 'reps': '12', 'done': True}]})
    s = {'activeSession': {'category': 'pull', 'programme': 'ppl', 'startedAt': now - 25 * 60_000, 'exercises': exs},
         'sessionNotes': 'Bonne forme', 'rest': None}
    if with_rest:
        s['rest'] = {'endTime': now + 60_000, 'minimized': True}
    return s


# ─────────────────────────────────────────────────────────────
#  Outils Playwright
# ─────────────────────────────────────────────────────────────

class Bench:
    """Lance un navigateur par moteur et fabrique des contextes (appareil, thème)."""

    def __init__(self, p):
        self.p = p
        self.browsers = {}

    def browser(self, engine):
        if engine not in self.browsers:
            if engine == 'chromium':
                self.browsers[engine] = self.p.chromium.launch(args=['--mute-audio'])
            else:
                self.browsers[engine] = getattr(self.p, engine).launch()
        return self.browsers[engine]

    @contextlib.contextmanager
    def page(self, engine, device, theme, service_workers='block', **extra):
        ctx = self.browser(engine).new_context(**self.p.devices[device], color_scheme=theme,
                                               service_workers=service_workers, **extra)
        page = ctx.new_page()
        page.errors = []
        page.on('pageerror', lambda e: page.errors.append(str(e)))
        try:
            yield page
        finally:
            ctx.close()

    def close(self):
        for b in self.browsers.values():
            b.close()


def seed(page, theme, ppl_v2=None, active=None, extra=None, url=None):
    """Vide le stockage, injecte les données, puis recharge l'app."""
    # Le stockage est écrit depuis une page hors app : sinon le pagehide de l'app réécrirait ppl_active_session
    page.goto((url or BASE_URL) + 'manifest.json')
    page.evaluate("""([theme, d, a, extra]) => {
        localStorage.clear();
        localStorage.setItem('ppl_theme', theme);
        if (d !== null) localStorage.setItem('ppl_v2', d);
        if (a !== null) localStorage.setItem('ppl_active_session', a);
        for (const [k, v] of Object.entries(extra || {})) localStorage.setItem(k, v);
    }""", [theme, ppl_v2, None if active is None else json.dumps(active, ensure_ascii=False), extra or {}])
    page.goto(url or BASE_URL)
    page.wait_for_selector('#app > *')


def shot(page, lot, name):
    d = os.path.join(SHOTS, 'lot%s' % lot)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, name.replace(' ', '_').replace('+', 'plus') + '.png')
    page.wait_for_timeout(350)  # fin des animations d'apparition (toasts, feuilles)
    page.screenshot(path=path)
    return path


def ls(page, key):
    return page.evaluate('k => localStorage.getItem(k)', key)


def tap_dialog(page, label):
    """Touche un bouton des dialogues iOS de l'app (feuille ou alerte)."""
    page.locator('.ios-dialog__btn', has_text=label).first.click()
    page.wait_for_timeout(260)


class Results:
    def __init__(self, lot):
        self.lot = lot
        self.fails = []
        self.count = 0

    def check(self, cond, label):
        self.count += 1
        if not cond:
            self.fails.append(label)
            print('  ÉCHEC :', label, flush=True)

    def done(self):
        print(f'Lot {self.lot} : {self.count - len(self.fails)}/{self.count} vérifications OK', flush=True)
        return 1 if self.fails else 0


def run_main(R, tests, once=()):
    """Point d'entrée commun des test_lotN.py.

    Les tests `tests(bench, eng, dev, theme)` tournent pour chaque appareil et thème ;
    les tests `once(bench)` une seule fois. run_all.py lance un processus par
    (appareil, thème) via PPL_DEV / PPL_THEME, plus un processus PPL_ONCE=1.
    Sans variable, tout tourne dans ce processus (usage manuel).
    """
    import sys
    from playwright.sync_api import sync_playwright
    only = sys.argv[1:]
    dev_f, theme_f, once_only = os.environ.get('PPL_DEV'), os.environ.get('PPL_THEME'), os.environ.get('PPL_ONCE')
    with sync_playwright() as p:
        bench = Bench(p)
        if not once_only:
            for eng, dev in DEVICES:
                if dev_f and dev != dev_f:
                    continue
                for theme in THEMES:
                    if theme_f and theme != theme_f:
                        continue
                    for fn in tests:
                        if only and fn.__name__ not in only:
                            continue
                        try:
                            fn(bench, eng, dev, theme)
                        except Exception as e:
                            R.check(False, f'{dev}-{theme} {fn.__name__} : exception {str(e).splitlines()[0]}')
        if once_only or not (dev_f or theme_f):
            for fn in once:
                if only and fn.__name__ not in only:
                    continue
                try:
                    fn(bench)
                except Exception as e:
                    R.check(False, f'{fn.__name__} : exception {str(e).splitlines()[0]}')
        bench.close()
    sys.exit(R.done())
