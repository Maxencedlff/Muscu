"""Données de test réalistes et outils partagés par les tests Playwright de PPL Training.

- ppl_v2_today() : donnée au format actuel (avant le lot 1) : SANS champ schema ni exId,
  ~9 semaines d'historique push/pull/legs à charges progressives, une séance Perso avec icône (ancien champ, plus affiché),
  quelques entrées sans champ programme, des reps stockées en nombre, un PR faussé.
- old_active_session() : un ppl_active_session au format d'avant le lot 1.
"""
import json
import os
import re
import time
import contextlib
import datetime
from zoneinfo import ZoneInfo

# ── Typographie française de l'app (frTypo, js/core/util.js) ──
# L'app pose une espace fine insécable (U+202F) avant ? ! ; et une espace insécable (U+00A0, panel vague 4) avant : »,
# après «, autour de « × » et entre un nombre et
# « kg » (et les autres unités, panel t5), et un trait d'union insécable (U+2011) dans « mois-ci ». Les textes lus par les tests sont ramenés à l'espace
# et au trait d'union simples, SEULEMENT à ces places : un U+202F de séparateur de milliers (« 1 080 ») reste tel quel ; un U+00A0 écrit par l'app à ces mêmes places (« 30 min ») est ramené aussi, et les
# vérifications gardent toute leur précision. typo_raw(page, js) lit un texte sans cette normalisation.
# Panel t5 : aussi entre un nombre et son unité ou son nom (FR_TYPO_UNITS), après « ≈ » et « sem. », avant « · ».
_TYPO_UNITS = ('kg|lb|min|h|j|s|t|g|kcal|km|cm|%|reps?|séances?|séries?|exercices?|jours?|semaines?|sem\\.|repas|records?'
               '|janv\\.|févr\\.|mars|avr\\.|mai|juin|juil\\.|août|sept\\.|oct\\.|nov\\.|déc\\.')
_TYPO_RE = re.compile('[\u202f\u00a0](?=[?!;:\u00bb])|(?<=\u00ab)[\u202f\u00a0]|\u2011|[\u202f\u00a0]\u00d7[\u202f\u00a0]|(?<=\\d)[\u202f\u00a0](?=(?i:' + _TYPO_UNITS + '))'
                      '|(?<=\u2248)[\u202f\u00a0]|(?<=sem\\.)[\u202f\u00a0](?=\\d)|[\u202f\u00a0](?=\u00b7 )'
                      # panel t6 : « L 1 », « 1 j 18 h », « repos 2:00 » ; mois en capitales (« 18 OCT. », text-transform lu par inner_text)
                      '|(?:(?<=^[A-ZÀ-Ýj])|(?<=[\\s(][A-ZÀ-Ýj]))[\u202f\u00a0](?=\\d)|(?<=[^\\W\\d_])[\u202f\u00a0](?=\\d{1,2}:\\d\\d)')
_TYPO_SUB = {'\u2011': '-'}   # « × » entouré d'espaces simples (lambda ci-dessous)


def typo_norm(v):
    """Ramène les espaces et traits d'union typographiques de frTypo à leur forme simple (récursif)."""
    if isinstance(v, str):
        return _TYPO_RE.sub(lambda m: _TYPO_SUB.get(m.group(0), ' \u00d7 ' if '\u00d7' in m.group(0) else ' '), v)
    if isinstance(v, list):
        return [typo_norm(x) for x in v]
    if isinstance(v, tuple):
        return tuple(typo_norm(x) for x in v)
    if isinstance(v, dict):
        return {k: typo_norm(x) for k, x in v.items()}
    return v


def _typo_patch():
    from playwright.sync_api import Page, Locator, Frame, ElementHandle
    for cls, names in ((Page, ('inner_text', 'text_content', 'evaluate', 'inner_html', 'content')),
                       (Frame, ('inner_text', 'text_content', 'evaluate')),
                       (Locator, ('inner_text', 'text_content', 'all_inner_texts', 'all_text_contents', 'evaluate', 'evaluate_all', 'inner_html')),
                       (ElementHandle, ('inner_text', 'text_content', 'evaluate'))):
        for n in names:
            f = getattr(cls, n)
            if getattr(f, '_typo', False):
                continue
            def wrap(f=f):
                def g(*a, **k):
                    return typo_norm(f(*a, **k))
                g._typo, g._raw = True, f
                return g
            setattr(cls, n, wrap())


def typo_raw(page, js, arg=None):
    """page.evaluate sans normalisation typographique (pour vérifier les espaces insécables elles-mêmes)."""
    from playwright.sync_api import Page
    return Page.evaluate._raw(page, js, arg)


_typo_patch()

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

# ─────────────────────────────────────────────────────────────
#  Appareils récents (iPhone 16 à 18, iPhone Air, iPhone Duo pliable)
#
# Hors de DEVICES : la suite par défaut reste raisonnable. PPL_DEVICES=recents (ou « tous », ou une liste de
# noms) les fait tourner dans n'importe quel lot (run_all.py, run_main, test_ecrans_recents.py).
# Profils faits main : ceux de Playwright du même nom ont la fenêtre de Safari (barres comprises, 402 × 681),
# alors que l'app iOS (Capacitor, WKWebView plein écran, viewport-fit=cover) a tout l'écran (402 × 874) avec
# des marges de sécurité (encoche / Dynamic Island en haut, barre d'accueil en bas). Ces marges sont simulées :
# le navigateur rend env(safe-area-inset-*) à 0, simulate_safe_area() les remplace par les vraies valeurs.
#
# Tailles en points (vérifiées le 06/11/2026) :
#   iPhone 16 Pro / 17 / 17 Pro / 18 Pro : 402 × 874, @3x, marges 62 haut / 34 bas (useyourloaf.com, iPhone 17 Screen Sizes)
#   iPhone 16 Pro Max / 17 Pro Max / 18 Pro Max : 440 × 956, @3x, marges 62 / 34
#   iPhone Air : 420 × 912, @3x, marges 68 / 34 (même source)
#   iPhone Duo (sorti en septembre 2026, iOS 27.1) : Apple n'a publié que les pixels (gigazine, tidbits,
#     iphoneincanada) : extérieur 5,4 po 1398 × 2034, intérieur 7,6 po 1878 × 2670, environ 430 à 460 ppp,
#     donc @3x comme les iPhone (l'iPad mini, à 326 ppp, est en @2x). Hypothèse : extérieur 466 × 678 points,
#     intérieur 626 × 890 (paysage 890 × 626). Marges supposées : fermé comme un iPhone à poinçon (59 / 34),
#     ouvert comme un iPad sans encoche (24 / 20). En plus, un pire cas « grand » façon iPad mini paysage
#     (1133 × 744, @2x) si l'écran ouvert se révélait en @2x (939 × 1335) : contenu étalé sur plus de 1100 px.
#   L'app ne déclare que le portrait (Info.plist) : en paysage sur le Duo ouvert, iOS peut la laisser en
#   portrait ; le paysage est testé comme pire cas (Split View, rotation forcée par le système).
# ─────────────────────────────────────────────────────────────
# Safari 26 fige la version d'iOS du user agent (18_x), comme les profils iPhone 17 de Playwright
IOS_UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 '
          '(KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1')


def _ios(w, h, safe, dpr=3):
    """Profil Playwright d'un iPhone récent (app plein écran) et ses marges (haut, droite, bas, gauche)."""
    return {'viewport': {'width': w, 'height': h}, 'screen': {'width': w, 'height': h}, 'device_scale_factor': dpr,
            'is_mobile': True, 'has_touch': True, 'user_agent': IOS_UA, 'default_browser_type': 'webkit'}, safe


RECENT_PROFILES = {
    'iPhone 17': _ios(402, 874, (62, 0, 34, 0)),             # aussi 16 Pro, 17 Pro, 18 Pro
    'iPhone 17 Pro Max': _ios(440, 956, (62, 0, 34, 0)),     # aussi 16 Pro Max, 18 Pro Max
    'iPhone Air': _ios(420, 912, (68, 0, 34, 0)),
    'iPhone Duo ferme': _ios(466, 678, (59, 0, 34, 0)),
    'iPhone Duo ouvert': _ios(626, 890, (24, 0, 20, 0)),
    'iPhone Duo paysage': _ios(890, 626, (24, 0, 20, 0)),
    'iPhone Duo grand paysage': _ios(1133, 744, (24, 0, 20, 0), dpr=2),
}
RECENT_DEVICES = [('webkit', n) for n in RECENT_PROFILES]
ALL_DEVICES = DEVICES + RECENT_DEVICES


def device_profile(p, name):
    """Profil d'un appareil : les nôtres d'abord (même nom qu'un profil Safari de Playwright), sinon p.devices."""
    return RECENT_PROFILES[name][0] if name in RECENT_PROFILES else p.devices[name]


def safe_insets(name):
    """Marges de sécurité simulées (haut, droite, bas, gauche) en points ; None hors appareils récents."""
    return RECENT_PROFILES[name][1] if name in RECENT_PROFILES else None


def selected_devices(env=None):
    """Appareils choisis par PPL_DEVICES : vide → DEVICES ; « recents » → RECENT_DEVICES ; « tous » → les deux ;
    sinon des noms séparés par des virgules (« recents » permis dans la liste). Un nom inconnu arrête tout."""
    raw = os.environ.get('PPL_DEVICES', '') if env is None else env
    asked = [x.strip() for x in raw.split(',') if x.strip()]
    if not asked:
        return list(DEVICES)
    known = dict((d, e) for e, d in ALL_DEVICES)
    out = []
    for a in asked:
        group = RECENT_DEVICES if a == 'recents' else ALL_DEVICES if a == 'tous' else None
        if group is None:
            if a not in known:
                raise SystemExit(f'Appareil inconnu : {a} ; connus : recents, tous, {", ".join(known)}')
            group = [(known[a], a)]
        out += [x for x in group if x not in out]
    return out


def simulate_safe_area(ctx, insets):
    """Marges de sécurité de l'app iOS dans le navigateur : chaque env(safe-area-inset-*) des feuilles de style
    devient var(--sim-sai-*), fixé aux valeurs de l'appareil (même valeur de repli). Sur le contexte, avant la page."""
    top, right, bottom, left = insets
    def css(route):
        resp = route.fetch()
        body = resp.text().replace('env(safe-area-inset-', 'var(--sim-sai-')
        route.fulfill(response=resp, body=body, headers={**resp.headers, 'content-type': 'text/css; charset=utf-8'})
    ctx.route(re.compile(r'^https?://(127\.0\.0\.1|localhost)[:/].*\.css(\?.*)?$'), css)
    ctx.add_init_script(f"""(() => {{ const put = () => document.documentElement.style.cssText +=
        ';--sim-sai-top:{top}px;--sim-sai-right:{right}px;--sim-sai-bottom:{bottom}px;--sim-sai-left:{left}px';
        if (document.documentElement) put(); else addEventListener('DOMContentLoaded', put); }})();""")

DAY = 86400_000


# ─────────────────────────────────────────────────────────────
#  Dates et horloge figée
#
# Un test qui écrit « maintenant − 1 jour + 1 h » et attend « hier » échoue après 23 h ; un
# test qui attend « 59 jours » depuis une date en dur échoue le lendemain ; « N × 24 h » n'est pas
# N jours du calendrier autour d'un changement d'heure. Règle : un test dont le résultat dépend
# de la date ou de l'heure fige l'horloge de la page (bench.frozen_page(ms, ...)) et calcule ses
# données depuis ce même instant, en jours du calendrier (local_ms, days_back_ms).
# ─────────────────────────────────────────────────────────────

PARIS = 'Europe/Paris'   # fuseau de référence (heure d'hiver le dimanche 25 octobre 2026 à 3 h)


def local_ms(y, mo, d, h=12, mi=0, tz=None):
    """Horodatage (ms) d'une heure du calendrier : dans le fuseau `tz`, sinon celui de la machine
    (le même que le navigateur quand le contexte ne fixe pas timezone_id)."""
    return int(datetime.datetime(y, mo, d, h, mi, tzinfo=ZoneInfo(tz) if tz else None).timestamp() * 1000)


def days_back_ms(now_ms, days, h=12, mi=0, tz=None):
    """Le jour du calendrier `days` jours avant celui de `now_ms`, à h:mi (juste aux changements d'heure)."""
    zone = ZoneInfo(tz) if tz else None
    day = datetime.datetime.fromtimestamp(now_ms / 1000, zone).date() - datetime.timedelta(days=days)
    return local_ms(day.year, day.month, day.day, h, mi, tz)


def freeze_clock(page, ms):
    """Horloge de la page partant de `ms` (puis elle avance normalement, minuteries comprises).
    À appeler avant la première navigation (seed)."""
    page.clock.install(time=ms / 1000)


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
            for j, (eid, name, nsets, base) in enumerate(exs):
                # +2,5 kg toutes les deux semaines, pas au même moment pour tous les exercices (sinon
                # chaque exercice bat son record la même semaine) ; charge finale identique pour tous
                w = None if base is None else base + 2.5 * min(4, (k + j % 3) // 2)
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
    # Séance Perso avec icône (ancien champ, plus affiché)
    for i in range(3):
        date = now - (20 - i * 7) * DAY
        history.append({'id': 'hcs%02d' % i, 'programme': 'custom', 'category': CUSTOM_ID, 'date': date,
                        'duration': 40 * 60_000, 'notes': 'Bonne congestion' if i == 2 else '',
                        'exercises': [{'name': n, 'sets': [{'weight': fmt_w(b + min(i, 1)), 'reps': '10'}] * s}
                                      for _, n, s, b in CUSTOM]})
    history.sort(key=lambda h: -h['date'])

    def prog_ex(lst):
        return [make_ex(eid, name, s) for eid, name, s, _ in lst]

    ppl = {'exercises': {'push': prog_ex(PUSH), 'pull': prog_ex(PULL), 'legs': prog_ex(LEGS)},
           'timers': {}, 'cooldowns': {'push': 72, 'pull': 72, 'legs': 72}}
    custom = {'exercises': {CUSTOM_ID: prog_ex(CUSTOM)}, 'timers': {CUSTOM_ID: None}, 'cooldowns': {CUSTOM_ID: 72}}
    d = {'activeProgramme': 'ppl', 'programmes': {'ppl': ppl, 'custom': custom},
         'customSessions': {CUSTOM_ID: {'label': 'Bras', 'icon': '💥', 'desc': 'Biceps · Triceps', 'color': '#ec4899'}},
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

_JS_FUNCTION = re.compile(r'^\s*(async\s+)?(function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)')


def as_function(expr):
    """Expression JS en chaîne → fonction fléchée ; une fonction est rendue telle quelle."""
    return expr if not isinstance(expr, str) or _JS_FUNCTION.match(expr) else f'() => ({expr})'


# ─────────────────────────────────────────────────────────────
#  Attendre que l'app soit au repos (au lieu d'attentes fixes)
#
# Avant le 18/11, les tests attendaient un délai fixe après chaque geste (page.wait_for_timeout(300) :
# ~1 580 attentes, ~590 s de sommeil par appareil et thème), trop court sur une machine lente, trop long
# partout ailleurs. settle(page) attend à la place un état observable : l'app n'a plus rien en cours.
# Le script IDLE_TRACKER, posé sur le contexte avant l'app, compte ce qui peut encore changer l'écran :
#   - les minuteries courtes (setTimeout ≤ 1 s : fermeture d'une feuille 220 ms, recherche 350 ms…) ; les
#     longues (annulation 3-6 s, synchro 4 s, toasts) ne comptent pas : aucun test n'attendait leur fin
#     avec un délai fixe ;
#   - les promesses lentes : fetch, crypto.subtle (coffre photos), IndexedDB, FileReader, toBlob ;
#   - les animations CSS et Web en cours qui finissent dans 1,5 s (getAnimations ; les infinies, les longues et
#     celles programmées plus tard, comme la sortie d'un toast, ne comptent pas) ; un défilement doux ;
#   - les boucles requestAnimationFrame courtes (compteurs animés, 0,6 s) ; une boucle qui dure plus de 0,7 s
#     (anneau du repos, animation d'un exercice) est l'ambiance de l'écran, pas une transition.
# L'app est au repos quand rien de tout ça n'est en cours pendant 30 ms d'affilée (une chaîne
# requestAnimationFrame → setTimeout(0), comme afterPaint, est vue en cours d'un bout à l'autre).
# Les wrappers suivent un remplacement de setTimeout (page.clock.install) : la minuterie simulée est comptée.
# ─────────────────────────────────────────────────────────────
IDLE_TRACKER = r"""(() => {
  if (window.__idle) return;
  const SHORT_MS = 1000, AMBIENT_RAF_MS = 700, QUIET_MS = 30, SCROLL_MS = 80;
  const perf = performance, now = () => perf.now();
  const rawRaf = window.requestAnimationFrame && window.requestAnimationFrame.bind(window);   // avant tout remplacement
  const S = window.__idle = { timers: new Map(), busy: 0, raf: new Set(), rafStreak: 0, rafLast: -1e9,
                              scrollAt: -1e9, since: 0, tok: null };
  const wrapped = new WeakSet();
  const mark = f => { wrapped.add(f); return f; };
  const wrapSet = orig => (typeof orig !== 'function' || wrapped.has(orig)) ? orig : mark(function (fn, ms, ...a) {
    const d = Number(ms) || 0;
    if (typeof fn !== 'function' || d > SHORT_MS) return orig.call(this, fn, ms, ...a);
    // Appelant : la première ligne de la pile hors de ce suivi et de la minuterie simulée (page.clock). Seules
    // comptent les minuteries posées par un script de l'app (adresse http) : celles de Playwright (moteur de
    // page.clock, attente de wait_for_function) et des scripts de test n'ont pas d'adresse, ignorées.
    const frames = (new Error().stack || '').split('\n').filter(l => /\S/.test(l) && !/^Error/.test(l)).slice(1)
      .filter(l => !/setTimeout/.test(l));
    if (!/https?:\/\//.test(frames[0] || '')) return orig.call(this, fn, ms, ...a);
    let id;
    id = orig.call(this, function (...b) { S.timers.delete(id); return fn.apply(this, b); }, ms, ...a);
    S.timers.set(id, d + ' ms (' + (frames[0] || '?').trim() + ')');
    return id;
  });
  const wrapClear = orig => (typeof orig !== 'function' || wrapped.has(orig)) ? orig : mark(function (id) {
    S.timers.delete(id); return orig.call(this, id);
  });
  // Boucles d'ambiance connues (anneau du repos, animation d'un exercice) : elles tournent tant que l'écran est
  // affiché, jamais au repos, donc pas suivies (les autres boucles longues passent après AMBIENT_RAF_MS)
  const AMBIENT_RAF = /\/js\/(features\/rest|ui\/exercise-anim)\.js/;
  const wrapRaf = orig => (typeof orig !== 'function' || wrapped.has(orig)) ? orig : mark(function (fn) {
    const caller = (new Error().stack || '').split('\n').filter(l => /\S/.test(l) && !/^Error/.test(l))[1] || '';
    if (AMBIENT_RAF.test(caller)) return orig.call(this, fn);
    const t = now();
    if (!S.raf.size && t - S.rafLast > 100) S.rafStreak = t;
    S.rafLast = t;
    let id;
    id = orig.call(this, function (...b) { S.raf.delete(id); S.rafLast = now(); return fn.apply(this, b); });
    S.raf.add(id);
    return id;
  });
  const wrapCancelRaf = orig => (typeof orig !== 'function' || wrapped.has(orig)) ? orig : mark(function (id) {
    S.raf.delete(id); return orig.call(this, id);
  });
  for (const [name, wrap] of [['setTimeout', wrapSet], ['clearTimeout', wrapClear], ['clearInterval', wrapClear],
                              ['requestAnimationFrame', wrapRaf], ['cancelAnimationFrame', wrapCancelRaf]]) {
    let cur = wrap(window[name]);
    try {
      Object.defineProperty(window, name, { configurable: true, enumerable: true,
                                            get: () => cur, set: v => { cur = wrap(v); } });
    } catch { /* propriété figée : non suivie */ }
  }
  const hold = p => { S.busy++; let done = false; const end = () => { if (!done) { done = true; S.busy--; } };
                      Promise.resolve(p).then(end, end); return p; };
  const wrapAsync = (obj, names) => { for (const n of names) { const f = obj && obj[n];
    if (typeof f === 'function') obj[n] = function (...a) { return hold(f.apply(this, a)); }; } };
  wrapAsync(window, ['fetch']);
  if (window.crypto && crypto.subtle) wrapAsync(crypto.subtle, ['encrypt', 'decrypt', 'digest', 'importKey',
    'exportKey', 'deriveKey', 'deriveBits', 'generateKey', 'sign', 'verify', 'wrapKey', 'unwrapKey']);
  const holdEvents = (target, ends) => { S.busy++; let done = false;
    const end = () => { if (!done) { done = true; S.busy--; } };
    for (const e of ends) target.addEventListener(e, end); };
  if (window.IDBFactory) { const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...a) { const r = open.apply(this, a); holdEvents(r, ['success', 'error', 'blocked']); return r; }; }
  if (window.IDBDatabase) { const tx = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...a) { const t = tx.apply(this, a); holdEvents(t, ['complete', 'abort', 'error']); return t; }; }
  if (window.FileReader) for (const n of ['readAsText', 'readAsDataURL', 'readAsArrayBuffer', 'readAsBinaryString']) {
    const f = FileReader.prototype[n];
    if (f) FileReader.prototype[n] = function (...a) { holdEvents(this, ['loadend']); return f.apply(this, a); }; }
  if (window.HTMLCanvasElement) { const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb, ...a) { S.busy++;
      return toBlob.call(this, (...b) => { S.busy--; return cb(...b); }, ...a); }; }
  addEventListener('scroll', () => { S.scrollAt = now(); }, { capture: true, passive: true });
  // Une animation compte si elle se joue (ou commence dans 250 ms) et finit dans 1,5 s : la sortie d'un
  // toast, programmée 1,8 s après son entrée, et les animations longues ou infinies sont l'ambiance de l'écran.
  const moving = a => {
    if (a.playState !== 'running' || !a.effect || !a.effect.getComputedTiming) return false;
    // L'anneau du repos, redessiné à chaque image par sa boucle d'ambiance, relance sa transition sans fin
    const el = a.effect.target;
    if (el && el.closest && el.closest('.rest-ring')) return false;
    const tm = a.effect.getComputedTiming(), lt = tm.localTime;
    if (lt == null || !Number.isFinite(tm.endTime)) return false;
    const delay = tm.delay || 0;
    if (delay - lt > 250) return false;
    return tm.endTime - Math.max(lt, delay) <= 1500;
  };
  const animating = () => document.getAnimations ? document.getAnimations().some(moving) : false;
  S.quiet = tok => {
    const t = now();
    // Deux images au moins depuis le début de l'attente : les événements de rendu (scroll, observateurs
    // d'intersection et de taille, début d'une transition de vue) qui suivent le geste sont passés
    if (tok !== S.tok) { S.tok = tok; S.since = 0; S.frames = 0;
      if (rawRaf) rawRaf(() => { S.frames++; rawRaf(() => { S.frames++; }); }); else S.frames = 2; }
    if (S.frames < 2) return false;
    const busy = S.timers.size || S.busy > 0 || t - S.scrollAt < SCROLL_MS
      || (S.raf.size && t - S.rafStreak < AMBIENT_RAF_MS) || animating();
    if (busy) { S.since = 0; if (S.log) S.last = S.why(); return false; }
    if (!S.since) S.since = t;
    return t - S.since >= QUIET_MS;
  };
  S.why = () => {   // ce qui empêche le repos (message d'erreur de settle)
    const t = now(), out = [];
    if ((S.frames || 0) < 2) out.push('images dessinées depuis le début de l\'attente : ' + (S.frames || 0) + ' sur 2 (la page ne dessine plus)');
    if (S.since) out.push('au repos depuis ' + Math.round(t - S.since) + ' ms');
    if (S.timers.size) out.push('minuteries ' + [...S.timers.values()].join(','));
    if (S.busy > 0) out.push('promesses ' + S.busy);
    if (t - S.scrollAt < SCROLL_MS) out.push('défilement');
    if (S.raf.size && t - S.rafStreak < AMBIENT_RAF_MS) out.push('requestAnimationFrame');
    for (const a of document.getAnimations ? document.getAnimations() : []) {
      if (moving(a))
        out.push('animation ' + (a.animationName || a.transitionProperty || a.id || '?') + ' sur ' +
                 ((a.effect.target && (a.effect.target.className || a.effect.target.tagName)) || '?'));
    }
    return out.join(' ; ');
  };
})();"""


# Animations CSS ramenées à 1 ms (délais gardés : la sortie d'un toast reste à 1,8 s), transitions coupées, défilement
# CSS sans douceur : chaque geste finit tout de suite dans son état final, au lieu de 250 à 450 ms d'animation
# attendus par settle. Les fichiers qui vérifient les animations elles-mêmes (nom, durée, mouvement réduit,
# élément présent le temps de son animation) gardent les vraies : fixtures.REAL_ANIMATIONS = True après l'import.
REAL_ANIMATIONS = False
FAST_ANIMATIONS = r"""(() => {
  // Transitions à 0 s, pas 1 ms : transition-property vaut « all » par défaut, une durée de 1 ms partout ferait de
  // chaque changement de style une transition (une lecture juste après rendrait l'ancienne valeur)
  const css = '*, *::before, *::after { animation-duration: 1ms !important; transition-duration: 0s !important;'
            + ' transition-delay: 0s !important;'
            + ' scroll-behavior: auto !important; }';
  const put = () => { try { const s = new CSSStyleSheet(); s.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, s]; } catch { /* navigateur sans CSSOM construit */ } };
  if (document.documentElement) put(); else addEventListener('DOMContentLoaded', put);
})();"""


def track_idle(ctx):
    """Pose IDLE_TRACKER sur un contexte (avant sa première page) : settle(page) s'en sert. Accélère aussi les
    animations CSS (FAST_ANIMATIONS), sauf si le fichier de test a mis REAL_ANIMATIONS à vrai."""
    ctx.add_init_script(IDLE_TRACKER)
    if not REAL_ANIMATIONS:
        ctx.add_init_script(FAST_ANIMATIONS)


_settle_tok = [0]


def settle(page, timeout=10_000):
    """Attend que l'app soit au repos (voir IDLE_TRACKER) : fin des transitions, minuteries courtes, réseau
    simulé et promesses lentes, au lieu d'un délai fixe. Échoue (TimeoutError) si l'app ne se pose jamais."""
    _settle_tok[0] += 1
    t0 = time.time()
    if os.environ.get('PPL_SETTLE_LOG'):
        page.evaluate('() => { if (window.__idle) window.__idle.log = true; }')
    try:
        page.wait_for_function('tok => !!window.__idle && window.__idle.quiet(tok)', arg=_settle_tok[0],
                               polling=15, timeout=timeout)
        # PPL_SETTLE_LOG=ms : signale les attentes plus longues (où l'app met du temps à se poser, et pourquoi)
        if os.environ.get('PPL_SETTLE_LOG') and (time.time() - t0) * 1000 > int(os.environ['PPL_SETTLE_LOG']):
            import traceback
            caller = traceback.extract_stack(limit=3)[0]
            print(f'  settle {1000 * (time.time() - t0):.0f} ms à {os.path.basename(caller.filename)}:{caller.lineno}'
                  f' : {page.evaluate("() => window.__idle.last")}', flush=True)
    except Exception as e:
        try:
            why = page.evaluate('() => window.__idle ? window.__idle.why() : "pas de suivi (IDLE_TRACKER absent)"')
        except Exception:
            why = '?'
        import traceback
        where = ' < '.join(f'{os.path.basename(f.filename)}:{f.lineno}' for f in traceback.extract_stack(limit=4)[:-1][::-1])
        raise TimeoutError(f'app jamais au repos en {timeout} ms ({where}) : {why}') from e


def until(page, js, timeout=5000):
    """Attend qu'une condition JS soit vraie (vrai) ou le délai écoulé (faux), sans lever d'exception :
    la vérification qui suit garde son libellé et son décompte, qu'elle réussisse ou non."""
    try:
        page.wait_for_function(js, polling=20, timeout=timeout)
        return True
    except Exception:
        return False


def rir_pret(page, timeout=3000):
    """Sélecteur « Reps en réserve » : attend la fin du délai où ses boutons ignorent les touchers (RIR_GUARD_MS après
    son apparition, js/features/session.js), comme un doigt qui revient après avoir validé la série."""
    page.wait_for_function("() => [...rirShownAt.values()].every(at => Date.now() - at >= RIR_GUARD_MS)", polling=50, timeout=timeout)


def wait_toast_gone(page, timeout=8000):
    """Attend que le toast affiché soit parti (durée 2,2 s, 4 s pour une erreur, puis sa sortie)."""
    until(page, '() => !document.querySelector(".toast")', timeout)
    settle(page)


def wait_toast_settled(page, timeout=3000):
    """Attend que les toasts affichés aient plus de 0,8 s : un changement d'écran ne retire que ceux-là
    (dropScreenToast, js/core/dialogs.js : un toast posé juste avant la navigation la suit)."""
    until(page, "() => [...document.querySelectorAll('.toast')].every(t => Date.now() - Number(t.dataset.at || 0) > 850)", timeout)


class Bench:
    """Lance un navigateur par moteur et fabrique des contextes (appareil, thème)."""

    def __init__(self, p=None):
        self._p = p
        self._pw = None
        self.browsers = {}

    @property
    def p(self):
        # Playwright démarré au premier besoin : l'arrêter sans avoir lancé de navigateur laisse une
        # TargetClosedError (Playwright 1.62), vue dans chaque processus qui ne lançait rien
        if self._p is None:
            from playwright.sync_api import sync_playwright
            self._pw = sync_playwright()
            self._p = self._pw.start()
        return self._p

    def browser(self, engine):
        if engine not in self.browsers:
            if engine == 'chromium':
                self.browsers[engine] = self.p.chromium.launch(args=['--mute-audio'])
            else:
                self.browsers[engine] = getattr(self.p, engine).launch()
        return self.browsers[engine]

    @contextlib.contextmanager
    def page(self, engine, device, theme, service_workers='block', clock=None, **extra):
        """clock : instant de départ figé (ms) ; avec timezone_id=PARIS, la même heure partout (CI en UTC)."""
        ctx = self.browser(engine).new_context(**device_profile(self.p, device), color_scheme=theme,
                                               service_workers=service_workers, **extra)
        track_idle(ctx)
        if safe_insets(device):
            simulate_safe_area(ctx, safe_insets(device))
        page = ctx.new_page()
        page.errors = []
        page.on('pageerror', lambda e: page.errors.append(str(e)))
        # Violations de la Content-Security-Policy (journalisées par index.html) : tout test qui en provoque
        # une échoue, pour qu'une CSP trop stricte ne casse jamais un écran en silence (audit du 12/11, m1).
        # Un test qui en provoque à dessein vide page.csp_violations.
        page.csp_violations = []
        # Une expression en chaîne (« document.x > 2 ») est évaluée par Playwright avec eval, que la CSP refuse
        # (pas de 'unsafe-eval') : elle devient une fonction, comme celles déjà écrites « () => … »
        wait_fn = page.wait_for_function
        page.wait_for_function = lambda expr, *a, **k: wait_fn(as_function(expr), *a, **k)
        page.on('console', lambda m: m.text.startswith('[CSP]') and page.csp_violations.append(m.text))
        if clock is not None:
            freeze_clock(page, clock)
        try:
            yield page
            if page.csp_violations:
                raise AssertionError(f'violation de la CSP : {page.csp_violations[:3]}')
        finally:
            ctx.close()

    def frozen_page(self, at, engine, device, theme, **extra):
        """Page dont l'horloge part de `at` (ms), à l'heure de Paris (voir « Dates et horloge figée »)."""
        return self.page(engine, device, theme, clock=at, timezone_id=PARIS, **extra)

    def close(self):
        for b in self.browsers.values():
            b.close()
        if self._pw is not None:
            self._p.stop()


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


def open_active_programme(page):
    """Onglet Programme : sa racine est la liste Programmes (vote du 19/11) ; toucher le programme actif ouvre sa page
    (séances, ordre, réglages). Sans effet si sa page est déjà affichée."""
    page.wait_for_selector('.view.my-programmes, .view.programmes')
    if page.locator('.view.programmes').count():
        return
    page.click('.view.my-programmes [data-action="open-my-prog"][data-id="%s"]' % page.evaluate('data.activeProgramme'))
    page.wait_for_selector('.view.programmes')


def skip_questions(page):
    """Premier lancement (aucune séance) : « Plus tard » sur les questions, comme l'ancienne carte."""
    btn = page.locator('.onb [data-action="onb-later"]')
    if btn.count():
        btn.click()
        settle(page)


def shot(page, lot, name):
    d = os.path.join(SHOTS, 'lot%s' % lot)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, name.replace(' ', '_').replace('+', 'plus') + '.png')
    settle(page)  # fin des animations d'apparition (toasts, feuilles)
    page.screenshot(path=path)
    return path


def ls(page, key):
    return page.evaluate('k => localStorage.getItem(k)', key)


def tap_dialog(page, label):
    """Touche un bouton des dialogues iOS de l'app (feuille ou alerte)."""
    page.locator('.ios-dialog__btn', has_text=label).first.click()
    settle(page)


class Results:
    def __init__(self, lot):
        self.lot = lot
        self.fails = []
        self.count = 0
        self.skipped = []

    def check(self, cond, label):
        self.count += 1
        if not cond:
            self.fails.append(label)
            print('  ÉCHEC :', label, flush=True)

    def skip(self, reason):
        """Exemption explicite : ce processus ne vérifie rien à dessein (appareil hors du périmètre du lot)."""
        self.skipped.append(reason)
        print('  IGNORÉ :', reason, flush=True)

    def done(self):
        """Code de sortie du lot. Un processus qui ne vérifie rien (0/0) échoue, sauf exemption par skip() :
        un lot qui se viderait par régression ne doit jamais passer pour un succès (audit du 12/11, m4)."""
        ok = self.count - len(self.fails)
        if self.count == 0 and self.skipped:
            print(f'Lot {self.lot} : 0/0 vérifications, ignoré à dessein ({self.skipped[0]})', flush=True)
            return 0
        if self.count == 0:
            print(f'  ÉCHEC : aucune vérification faite (0/0)', flush=True)
            print(f'Lot {self.lot} : 0/0 vérifications, ÉCHEC', flush=True)
            return 1
        print(f'Lot {self.lot} : {ok}/{self.count} vérifications OK', flush=True)
        return 1 if self.fails else 0


def run_main(R, tests, once=()):
    """Point d'entrée commun des test_lotN.py.

    Les tests `tests(bench, eng, dev, theme)` tournent pour chaque appareil et thème ;
    les tests `once(bench)` une seule fois. run_all.py lance un processus par
    (appareil, thème) via PPL_DEV / PPL_THEME, plus un processus PPL_ONCE=1.
    Sans variable, tout tourne dans ce processus (usage manuel).
    """
    import sys
    only = sys.argv[1:]
    if os.environ.get('PPL_LIST'):
        # Inventaire pour run_all.py : il ne planifie que les processus qui ont des tests à lancer
        print('PPL_LIST ' + json.dumps({'tests': len(tests), 'once': len(once)}), flush=True)
        sys.exit(0)
    dev_f, theme_f, once_only = os.environ.get('PPL_DEV'), os.environ.get('PPL_THEME'), os.environ.get('PPL_ONCE')
    bench = Bench()
    if not once_only:
        # PPL_DEV (un processus de run_all.py) peut viser un appareil récent ; sinon PPL_DEVICES choisit
        for eng, dev in (ALL_DEVICES if dev_f else selected_devices()):
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
    # Playwright arrêté (bench.close) avant la sortie : plus de TargetClosedError en fin de processus
    sys.exit(R.done())


def sess_undo_text(page):
    """« Annuler » en ligne en séance (sessionUndo) : texte de l'état (ligne au-dessus d'une carte, ou nom du bouton
    « Annuler » dans la ligne de la série) ; '' sans rien à annuler."""
    return page.evaluate("""(() => { const l = document.querySelector('.ex-undo__text'); if (l) return l.textContent;
        const b = document.querySelector('[data-action="sess-undo"]'); return b ? b.getAttribute('aria-label') : ''; })()""")


def sess_undo(page):
    """Touche « Annuler » en ligne (séance)."""
    page.locator('[data-action="sess-undo"]').first.click()
    settle(page)
