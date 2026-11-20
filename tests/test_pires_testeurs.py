"""« Pire équipe de testeurs » : chaque champ de saisie reçoit les pires valeurs, tapées ou collées.

Champs : ceux de tools/champs/registre.mjs (inventaire statique, `node tools/champs/inventaire.mjs`), atteints ici par
une recette (ouvrir, champ, valider, lire ce qui est enregistré). Valeurs : vide, espaces seuls, espaces insécables,
caractères invisibles (U+200B), 1 caractère, la limite exacte, limite + 1, 5 000 caractères collés, emoji ZWJ et lettres
à accents combinés, texte RTL, retours à la ligne, HTML et script (`<img src=x onerror=…>`), injection SQL, et pour les
nombres : négatif, 0, très grand, « 12,5 » et « 12.5 », « 1e9 », « NaN », « Infinity », zéros en tête, « 12abc »,
chiffres arabes. Plus le double toucher sur Valider.

Après chaque valeur :
- aucune erreur JS, aucune charge exécutée (window.__hits), aucun élément ni attribut injecté ;
- la page ne défile pas en largeur, aucun texte du champ ou de ce qui l'affiche ne déborde ;
- ce qui est enregistré (localStorage, ce que le faux serveur reçoit : tests/fake_account.py) respecte la règle du champ
  (longueur, bornes, caractère visible, pas de moitié d'emoji) ;
- une valeur refusée l'est avec un message (toast, texte d'erreur, champ signalé) et ne change rien ;
- les valeurs valables désignées (« 12,5 », « 72,5 »…) sont bien acceptées, telles quelles.

Par appareil et thème. Lancer : PPL_URL=http://localhost:8731/ PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_pires_testeurs.py
(ou run_all.py pires_testeurs). Rien ne sort sur le réseau (compte et serveur simulés).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'pires_testeurs'
R = Results(LOT)

HOOK = "window.__x = t => { (window.__hits = window.__hits || []).push(String(t)); };"
LIFT = '\U0001F3CB️‍♂️'         # 🏋️‍♂️ : séquence ZWJ
IMG = '"><img src=x onerror=__x(\'img\')>'
SCR = '<script>__x(\'script\')</script>'
SQL = "'; drop table sessions; --"
RTL = '‮' + 'مرحبا שלום' + ' abc'
ACCENTS = 'Pé clé dé'          # é en deux points de code (e + accent combinant)


def textes(maxlen):
    """Pires textes pour un champ de `maxlen` caractères : (nom, valeur)."""
    return [('vide', ''), ('espaces', '    '), ('insécables', '   '), ('invisibles', '​​﻿'),
            ('1 caractère', 'a'), ('limite', 'L' * maxlen), ('limite + 1', 'M' * (maxlen + 1)), ('5 000 collés', 'Z' * 5000),
            ('emoji', LIFT * 30), ('accents combinés', ACCENTS), ('RTL', RTL), ('retours à la ligne', 'ligne 1\nligne 2\r\nligne 3'),
            ('html', IMG), ('script', SCR), ('sql', SQL), ('mot long', 'Anticonstitutionnellementissimement' * 3)]


NOMBRES = [('vide', ''), ('espace', ' '), ('négatif', '-5'), ('zéro', '0'), ('très grand', '99999999'), ('1e9', '1e9'),
           ('NaN', 'NaN'), ('Infinity', 'Infinity'), ('virgule', '12,5'), ('point', '12.5'), ('zéros en tête', '0007'),
           ('lettres', '12abc'), ('deux virgules', '2,5,5'), ('chiffres arabes', '١٢'), ('html', IMG), ('5 000 collés', '9' * 5000)]

# Ce que montre un refus : toast, message d'erreur d'une feuille, champ signalé, bouton grisé
REFUS = r"""() => {
  const vis = e => e && e.offsetParent !== null && (e.textContent || '').trim() !== '';
  if ([...document.querySelectorAll('.toast')].some(vis)) return 'toast';
  if ([...document.querySelectorAll('[role="alert"], .diet-form__err, .coach-sheet__hint--bad, .auth__error, #coachReqError')].some(vis)) return 'message';
  if (document.querySelector('[aria-invalid="true"]')) return 'champ signalé';
  return '';
}"""

# Inspection : exécutions, injections, largeur, textes qui débordent (feuilles et dialogues compris), moitiés d'emoji
INSPECT = r"""(needle) => {
  const injected = [];
  for (const e of document.body.querySelectorAll('*')) {
    const tag = e.tagName.toLowerCase();
    if (tag === 'img' && e.getAttribute('src') === 'x') injected.push('img src=x');
    if (tag === 'script' && /__x/.test(e.textContent)) injected.push('script');
    for (const a of e.attributes) if (/^on/i.test(a.name) && /__x/.test(a.value)) injected.push(`${tag}[${a.name}]`);
  }
  const de = document.documentElement;
  // Textes qui débordent de leur boîte sans coupure prévue (ellipse) : ceux qui contiennent la valeur tapée
  const over = needle ? [...document.querySelectorAll('#app *, .sheet-root *, .ios-dialog *, .sess-sheet *')].filter(e =>
      e.offsetParent && e.children.length === 0 && !e.matches('input, textarea, svg, use, .visually-hidden, .sr-text, .visually-hidden *, .sr-text *')
      && (e.textContent || '').includes(needle) && e.scrollWidth > e.clientWidth + 1
      && getComputedStyle(e).textOverflow !== 'ellipsis' && getComputedStyle(e).display !== 'inline')
    .map(e => e.className || e.tagName).slice(0, 3) : [];
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const half = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (lone.test(localStorage.getItem(k) || '')) half.push(k); }
  return { hits: window.__hits || [], injected, sw: de.scrollWidth, cw: de.clientWidth, over, half };
}"""


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, account=False, ppl=None):
    page.add_init_script(HOOK)
    if account:
        page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
        page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    page.route('https://world.openfoodfacts.org/**', lambda route: route.abort())
    if ppl is None:   # plan de diète minimal : la feuille du sel et les repas existent
        d = ppl_v2_today()
        d['dietPlans'] = {'d_test01': {'name': 'Test', 'targets': {'kcal': 2000}, 'meals': [{'id': 'm1', 'name': 'Repas', 'items': []}]}}
        d['dietActive'] = 'd_test01'
        ppl = json.dumps(d, ensure_ascii=False)
    seed(page, theme, ppl, extra={'ppl_welcome_seen': '1'})
    settle(page)


def signin(page, username='max', social=True):
    page.evaluate("""async ([u, en]) => {
        await accountSignInWith('apple', async () => 'add');
        if (u) await accountSaveProfile({ username: u });
        if (en) await socialEnable(true);
    }""", [username, social])
    settle(page)


def act(page, name, **data):
    """Lance une action de l'app comme un toucher sur son bouton (sans attendre la fin : un dialogue peut s'ouvrir)."""
    page.evaluate("""([n, d]) => { const b = document.createElement('button'); Object.entries(d).forEach(([k, v]) => { b.dataset[k] = v; });
        document.body.appendChild(b); handleAction(new Event('click'), b, n); setTimeout(() => b.remove(), 0); }""", [name, data])
    settle(page)


def tap(page, sel):
    """Toucher d'un bouton ; s'il reste masqué 8 s (clavier, toast du moteur WebKit de test), clic envoyé à l'élément et
    avertissement affiché : la saisie reste vérifiée, le masquage est signalé sans faire échouer le lot."""
    try:
        page.click(sel, timeout=8000)
    except Exception as e:
        print(f'  AVERTISSEMENT : {sel} pas touchable ({str(e).splitlines()[0][:80]}), clic envoyé à l\'élément', flush=True)
        page.locator(sel).first.dispatch_event('click')
    settle(page)


def close_all(page):
    """Ferme dialogues et feuilles restés ouverts (valeur refusée) : on repart d'un écran propre."""
    for _ in range(4):
        if page.locator('.ios-dialog').count():
            c = page.locator('.ios-dialog__btn--cancel')
            if c.count():
                c.first.click()
            else:
                page.keyboard.press('Escape')
            settle(page)
        elif page.locator('.sheet-root').count():
            page.evaluate("document.querySelectorAll('.sheet-root').forEach(s => s._close ? s._close() : s.remove())")
            settle(page)
        else:
            break
    page.evaluate("document.querySelectorAll('.toast').forEach(t => t.remove())")


def put(page, sel, value):
    """Écrit la valeur comme un collage (respecte maxlength, déclenche input) ; les retours à la ligne d'un champ d'une
    ligne sont retirés par le navigateur, comme sur l'iPhone."""
    f = page.locator(sel).first
    f.fill('')
    if value:
        f.focus()
        page.keyboard.insert_text(value)
    settle(page)
    return f.input_value()


class Champ:
    """Recette d'un champ : ouvrir(page) l'affiche, sel le désigne, valider(page) envoie, lire(page) rend ce qui est
    gardé ; regle(avant, apres, saisi) rend la liste des fautes ; valables : [(saisi, attendu)] à accepter tels quels.
    reste : le champ reste affiché après une valeur acceptée (sinon il est rouvert)."""

    def __init__(self, cle, nom, ouvrir, sel, valider, lire, regle, valeurs, valables=(), reste=False, double=None, montre=None):
        self.cle, self.nom, self.ouvrir, self.sel, self.valider, self.lire = cle, nom, ouvrir, sel, valider, lire
        self.regle, self.valeurs, self.valables, self.reste, self.double, self.montre = regle, valeurs, list(valables), reste, double, montre


def ok_btn(sel='.ios-dialog__btn--preferred'):
    def f(page):
        tap(page, sel)
    return f


def sheet_ok(page):
    tap(page, '.sheet__btn--confirm')


# ── Règles communes ──────────────────────────────────────────

def regle_texte(maxlen, obligatoire, une_ligne=True):
    def r(avant, apres, saisi):
        fautes = []
        if apres == avant:
            return fautes
        if not isinstance(apres, str):
            return fautes if apres is None and not obligatoire else [f'valeur gardée {apres!r}']
        if len(apres) > maxlen:
            fautes.append(f'{len(apres)} caractères gardés (> {maxlen})')
        if apres != apres.strip():
            fautes.append('espaces autour gardés')
        vis = apres.translate({ord(c): None for c in ' \t\n\r  ​‌‍‎‏﻿⁠'})
        if apres and not vis:
            fautes.append(f'texte invisible gardé {apres!r}')
        if obligatoire and not apres:
            fautes.append('nom vide gardé')
        if une_ligne and ('\n' in apres or '\r' in apres):
            fautes.append('retour à la ligne gardé dans un champ d\'une ligne')
        return fautes
    return r


def regle_nombre(lo, hi, entier=False, vide_ok=True):
    def r(avant, apres, saisi):
        if apres == avant or (apres is None and vide_ok):
            return []
        try:
            v = float(apres)
        except (TypeError, ValueError):
            return [f'valeur gardée {apres!r}']
        if v != v or v in (float('inf'), float('-inf')):
            return [f'valeur non finie {apres!r}']
        fautes = []
        if not lo - 1e-9 <= v <= hi + 1e-9:
            fautes.append(f'{v} hors de {lo} à {hi}')
        if entier and v != int(v):
            fautes.append(f'{v} pas entier')
        return fautes
    return r


# ── Recettes ─────────────────────────────────────────────────

def ex_edit(page):
    page.evaluate("exDraft = null; navigate(makeRoute('ex-edit', 'push', 0))")
    page.wait_for_selector('#exName')
    settle(page)


def save_ex(page):
    tap(page, '[data-action="save-ex"]')
    if page.locator('.ios-dialog').count():   # « Renommer aussi dans l'historique ? » : non
        close_all(page)


LIRE_EX = "(() => { const e = prog().exercises.push[0]; return e ? { name: e.name, target: e.target, repMax: e.repMax, repMin: e.repMin ?? null, tempo: e.tempo ?? null } : null; })()"


def champ_ex(key):
    return lambda page: (page.evaluate(LIRE_EX) or {}).get(key)


def cs_open(page):
    page.evaluate("void openNewSession()")
    page.wait_for_selector('#csName')


def cs_lire(page):
    return page.evaluate("Object.values(userSessions(isUserProg(data.activeProgramme) ? data.activeProgramme : 'custom') || {}).map(s => s.label).sort().join('|')")


def cs_regle(avant, apres, saisi):
    if apres == avant:
        return []
    neuf = [x for x in apres.split('|') if x not in avant.split('|')]
    return [f for n in neuf for f in regle_texte(40, True)(None, n, saisi)] + ([] if len(neuf) <= 1 else [f'{len(neuf)} séances créées'])


def cs_valider(page):
    tap(page, '[data-action="save-cs-modal"]')


def dialog_field(action, **data):
    def f(page):
        act(page, action, **data)
        page.wait_for_selector('.ios-dialog__input')
    return f


def session_open(page):
    if not page.evaluate('!!activeSession'):
        page.evaluate("startSession('push')")
    page.wait_for_selector('.view.session')
    settle(page)


SET_W = '.session-set[data-ei="0"][data-si="0"] input.set-input:not(.set-input--required)'
SET_R = '.session-set[data-ei="0"][data-si="0"] input.set-input--required'


def set_valider(page):
    # Le champ de reps se redessine à la frappe : bouton relu au moment du toucher
    tap(page, '[data-action="validate-set"][data-ei="0"][data-si="0"]')
    for s in ('.rest-overlay [data-action="skip-rest"]', '.rest-mini__skip'):
        if page.locator(s).count():
            page.locator(s).first.click()
            settle(page)
            break


def set_lire(page):
    return page.evaluate("(() => { const s = activeSession?.exercises[0].sets[0]; return s && s.done ? { w: s.weight, r: s.reps } : null; })()")


def set_reset(page):
    """Série 1 rouverte pour la valeur suivante : séance recommencée (plus simple et sûr que l'édition)."""
    page.evaluate("activeSession = null; persistSession && persistSession(); startSession('push')")
    page.wait_for_selector('.view.session')
    settle(page)


def set_regle(cle):
    def r(avant, apres, saisi):
        if not apres:
            return []
        v = apres[cle]
        if cle == 'w':
            if v in ('', None):
                return []
            return regle_nombre(0, 1000)(None, v, saisi)
        return regle_nombre(1, 100, entier=True)(None, v, saisi)
    return r


def recettes():
    T = textes
    out = [
        Champ('features/programme-editor.js#exName', 'Nom d\'un exercice', ex_edit, '#exName', save_ex, champ_ex('name'),
              regle_texte(80, True), T(80), valables=[('Curl pupitre', 'Curl pupitre'), (LIFT + ' Squat', LIFT + ' Squat')],
              montre=lambda page: (page.evaluate("navigate('programmes')"), settle(page))),
        Champ('features/programme-editor.js#exTarget', 'Objectif de charge', ex_edit, '#exTarget', save_ex, champ_ex('target'),
              regle_nombre(0.25, 1000), NOMBRES, valables=[('12,5', 12.5), ('12.5', 12.5), ('0007', 7)]),
        Champ('features/programme-editor.js#exRepMax', 'Haut de fourchette', ex_edit, '#exRepMax', save_ex, champ_ex('repMax'),
              regle_nombre(1, 100, entier=True, vide_ok=False), NOMBRES, valables=[('10', 10), ('0010', 10)]),
        Champ('features/programme-editor.js#exTempoIn', 'Tempo (fiche)', ex_edit, '#exTempoIn', save_ex, champ_ex('tempo'),
              lambda a, b, s: [] if b in (a, None) or (isinstance(b, str) and len(b) <= 12) else [f'tempo gardé {b!r}'],
              T(12) + [('chiffres', '3110')], valables=[('3-1-1', '3-1-1-0')]),
        Champ('features/custom-session.js#csName', 'Nom d\'une séance', cs_open, '#csName', cs_valider, cs_lire, cs_regle,
              T(40), valables=[('Séance A', None)],
              double=('[data-action="save-cs-modal"]', lambda p: len([x for x in cs_lire(p).split('|') if x]))),
        Champ('features/settings.js:askNumber:Repos par défaut', 'Repos par défaut', dialog_field('setting-rest'), '.ios-dialog__input',
              ok_btn(), lambda p: p.evaluate('data.defaultRest'), regle_nombre(10, 600, entier=True), NOMBRES, valables=[('90', 90), ('0120', 120)]),
        Champ('features/settings.js:askProfileNumber:Taille', 'Taille', dialog_field('set-profile-height'), '.ios-dialog__input',
              ok_btn(), lambda p: p.evaluate('data.heightCm ?? null'), regle_nombre(100, 250, entier=True), NOMBRES + [('décimale', '175,5')],
              valables=[('182', 182)]),
        Champ('features/settings.js:askProfileNumber:Âge', 'Âge', dialog_field('set-profile-age'), '.ios-dialog__input',
              ok_btn(), lambda p: p.evaluate('data.birthYear ?? null'),
              lambda a, b, s: [] if b in (a, None) else regle_nombre(1900, 2030, entier=True)(None, b, s), NOMBRES, valables=[]),
        Champ('features/apple-services.js:askNumber:Poids du corps', 'Poids du corps', dialog_field('set-body-weight'), '.ios-dialog__input',
              ok_btn(), lambda p: p.evaluate('data.bodyWeightKg ?? null'), regle_nombre(25, 300), NOMBRES,
              valables=[('72,5', 72.5), ('72.5', 72.5)]),
        Champ('features/session-tools.js:askNumber:Autre disque', 'Autre disque', None, '.ios-dialog__input', ok_btn(), None, None, NOMBRES),
        Champ('features/program-generator-ui.js:askText:Haltères fixes', 'Haltères fixes',
              lambda p: (p.evaluate("void openProgGen()"), settle(p), act(p, 'gen-db-loads'), p.wait_for_selector('.ios-dialog__input')),
              '.ios-dialog__input', ok_btn(), lambda p: p.evaluate('genAns.dbLoads'),
              lambda a, b, s: [] if b == a else ([f'charge hors bornes {b}'] if any(not 0.5 <= x <= 80 for x in b) or len(b) > 20 else []),
              T(100) + [('négatif', '4 -8'), ('1e3', '4 1e3'), ('tableur', '4,8,12')],
              valables=[('4 8 12', [4, 8, 12]), ('12,5 17,5', [12.5, 17.5]), ('4,8,12', [4, 8, 12])]),
        Champ('features/session.js#set-input', 'Charge d\'une série', session_open, SET_W, set_valider, set_lire, set_regle('w'),
              NOMBRES, valables=[('22,5', None), ('0', None)]),
        Champ('features/session.js#set-input~2', 'Reps d\'une série', session_open, SET_R, set_valider, set_lire, set_regle('r'),
              NOMBRES, valables=[('10', None)]),
        Champ('features/nutrition-ui.js:dialog:Sel ajouté', 'Sel ajouté',
              lambda p: (p.evaluate("void dietSaltSheet(dietDayKey())"), p.wait_for_selector('[data-salt="other"]'),
                         p.click('[data-salt="other"]'), p.wait_for_selector('.ios-dialog__input')),
              '.ios-dialog__input', ok_btn(), lambda p: p.evaluate("saltAddedG(data, dietDayKey())"),
              lambda a, b, s: [] if b == a else regle_nombre(0.1, 20)(None, round(b - a, 3), s), NOMBRES, valables=[('1,5', None)]),
        Champ('features/water-ui.js:dialog:Quantité bue', 'Eau bue', dialog_field('water-other'), '.ios-dialog__input', ok_btn(),
              lambda p: p.evaluate("waterDayMl(data, localISO())"),
              lambda a, b, s: [] if b == a else regle_nombre(10, 3000, entier=True)(None, b - a, s), NOMBRES, valables=[('33', None), ('33,5', None)]),
        Champ('features/water-ui.js#waterCupName', 'Nom d\'un contenant',
              lambda p: (act(p, 'water-cup-add'), p.wait_for_selector('#waterCupName'), p.fill('#waterCupMl', '75')),
              '#waterCupName', sheet_ok, lambda p: p.evaluate("(data.waterCups || []).map(c => c.name).join('|')"),
              lambda a, b, s: [f for n in b.split('|') if n and n not in a.split('|') for f in regle_texte(24, True)(None, n, s)],
              T(24), double=('.sheet__btn--confirm', lambda p: p.evaluate("(data.waterCups || []).length"), "data.waterCups = []; save()")),
        Champ('features/body-measures-ui.js#field', 'Mensuration (taille)',
              lambda p: (act(p, 'bm-add-one', key='waist'), p.wait_for_selector('.bm-in')),
              '.bm-in', sheet_ok, lambda p: p.evaluate("(data.bodyMeasures?.waist || []).map(x => x.cm)"),
              lambda a, b, s: [] if b == a else regle_nombre(10, 250)(None, b[0], s), NOMBRES, valables=[('80,5', None)]),
        Champ('features/diet-editor.js#dietFoodName', 'Nom d\'un aliment créé',
              lambda p: (p.evaluate("void dietNewFood()"), p.wait_for_selector('#dietFoodName'), p.fill('#dietFoodK', '120')),
              '#dietFoodName', sheet_ok, lambda p: p.evaluate("(data.dietFoods || []).map(f => f.name).join('|')"),
              lambda a, b, s: [f for n in b.split('|') if n and n not in a.split('|') for f in regle_texte(80, True)(None, n, s)], T(80)),
        Champ('features/diet-editor.js#diet-field__input', 'Aliment : énergie pour 100 g',
              lambda p: (p.evaluate("void dietNewFood()"), p.wait_for_selector('#dietFoodK'), p.fill('#dietFoodName', 'Test')),
              '#dietFoodK', sheet_ok, lambda p: p.evaluate("(data.dietFoods || []).map(f => f.per.k)"),
              lambda a, b, s: [] if b == a else regle_nombre(0, 900, entier=True)(None, b[-1] if b else None, s), NOMBRES,
              valables=[('120,4', None)]),
        Champ('features/summary.js#summaryNotes', 'Notes du bilan', None, '#summaryNotes', None, None, None, []),
    ]
    return [c for c in out if c.ouvrir]


def essai(page, t, c, nom, saisi):
    """Une valeur dans un champ : écrite, validée, vérifiée. Rend ce qui est gardé après."""
    if not page.locator(c.sel).count():
        close_all(page)
        c.ouvrir(page)
    avant = c.lire(page)
    errs = len(page.errors)
    page.evaluate("window.__hits = []")
    shown = put(page, c.sel, saisi)
    c.valider(page)
    apres = c.lire(page)
    lbl = f'{t} {c.nom} [{nom}]'
    fautes = c.regle(avant, apres, saisi)
    R.check(not fautes, f'{lbl} : donnée gardée valable ({fautes}, saisi {saisi[:40]!r})')
    needle = shown.strip()[:12] if shown.strip() and apres != avant else ''
    r = page.evaluate(INSPECT, needle)
    R.check(not r['hits'] and not r['injected'], f'{lbl} : rien d\'exécuté ni d\'injecté {r["hits"]} {r["injected"]}')
    R.check(r['sw'] <= r['cw'] + 1, f'{lbl} : pas de défilement horizontal ({r["sw"]} > {r["cw"]})')
    R.check(not r['over'], f'{lbl} : aucun texte qui déborde {r["over"]}')
    R.check(not r['half'], f'{lbl} : aucune moitié d\'emoji enregistrée {r["half"]}')
    R.check(len(page.errors) == errs, f'{lbl} : aucune erreur JS {page.errors[errs:]}')
    if apres == avant and shown.strip() and page.locator(c.sel).count():
        R.check(page.evaluate(REFUS) != '', f'{lbl} : refus dit (toast, message ou champ signalé)')
    return avant, apres


# Thème clair : la donnée ne dépend pas du thème, seul l'affichage est revérifié (valeurs longues ou exotiques)
VISUELS = {'limite', '5 000 collés', 'emoji', 'RTL', 'html', 'mot long', 'accents combinés', 'virgule', 'très grand'}


def run_champ(page, t, c, complet=True):
    c.ouvrir(page)
    for nom, saisi in c.valeurs:
        if not complet and nom not in VISUELS:
            continue
        essai(page, t, c, nom, saisi)
        if c.sel == SET_W or c.sel == SET_R:
            set_reset(page)
    for saisi, attendu in (c.valables if complet else []):
        if not page.locator(c.sel).count():
            close_all(page)
            c.ouvrir(page)
        avant, apres = essai(page, t, c, f'valable {saisi}', saisi)
        if attendu is None:
            R.check(apres != avant, f'{t} {c.nom} : « {saisi} » accepté ({apres!r})')
        else:
            R.check(apres == attendu, f'{t} {c.nom} : « {saisi} » enregistré tel quel ({apres!r} au lieu de {attendu!r})')
        if c.sel in (SET_W, SET_R):
            set_reset(page)
    if c.double and complet:   # (bouton, nombre d'éléments gardés) : un double toucher sur Valider n'ajoute qu'une fois
        btn, compte, *prep = c.double
        close_all(page)
        if prep:   # place libre (4 contenants au plus…)
            page.evaluate(prep[0])
        c.ouvrir(page)
        put(page, c.sel, 'Double toucher')
        n0 = compte(page)
        page.locator(btn).first.dblclick()
        settle(page)
        R.check(compte(page) == n0 + 1, f'{t} {c.nom} : double toucher sur Valider, un seul ajout ({n0} → {compte(page)})')
    if c.montre:
        c.montre(page)
        r = page.evaluate(INSPECT, '')
        R.check(r['sw'] <= r['cw'] + 1, f'{t} {c.nom} : l\'écran qui affiche la valeur ne défile pas en largeur')
    close_all(page)


def t_local(bench, eng, dev, theme):
    """Champs gardés sur l'appareil : programme, séance, réglages, nutrition, eau, mensurations."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        page.evaluate("data.history = []; save()")   # sans historique : renommer un exercice ne demande rien
        seul = os.environ.get('PPL_CHAMPS_SEUL')   # mise au point : un seul champ (partie de son nom)
        # Moitié des champs avec toutes les valeurs en sombre, l'autre moitié en clair ; chaque thème revoit aussi
        # l'affichage des autres (valeurs longues ou exotiques) : tout est couvert par appareil, en moins de 10 min
        for i, c in enumerate(recettes()):
            if seul and seul not in c.nom:
                continue
            t0 = time.time()
            try:
                run_champ(page, t, c, complet=(i % 2 == 0) == (theme == 'dark'))
                if os.environ.get('PPL_CHAMPS_LOG'):
                    print(f'  {c.nom} : {time.time() - t0:.1f} s', flush=True)
            except Exception as e:
                R.check(False, f'{t} {c.nom} : exception {str(e).splitlines()[0]}')
                close_all(page)
        shot(page, LOT, f'local-{t}')


# ── Champs qui partent au serveur (simulé) ───────────────────

def t_serveur(bench, eng, dev, theme):
    """Commentaire et demande de coach : ce que reçoit le faux serveur (thème sombre : la donnée ne dépend pas du thème)."""
    if theme != 'dark':
        return
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, account=True)
        signin(page)
        page.evaluate('syncNow()')
        settle(page)
        ids = page.evaluate("""() => {
            const now = Date.now();
            const s = [{ id: 'l01', date: now - 86400e3, duration: 3e6, programme: 'ppl', category: 'push', label: 'Push',
                         exercises: [{ name: 'Développé couché', sets: [{ weight: '80', reps: '8' }] }] }];
            const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', sessions: s }), me = __sb.meId();
            __sb.follow(me, lea); __sb.follow(lea, me);
            return { lea, me };
        }""")
        tap(page, '.tabbar [data-tab="friends"]')
        page.wait_for_selector('.feed-card')
        page.locator('.feed-card').first.locator('.feed-card__main').click()
        page.wait_for_selector('#commentInput')
        settle(page)
        mine = "__sb.so.comments.filter(c => c.user === __sb.meId()).map(c => c.body)"
        for nom, saisi in textes(500):
            n0 = len(page.evaluate(mine))
            errs = len(page.errors)
            page.evaluate("window.__hits = []")
            put(page, '#commentInput', saisi)
            send = page.locator('.comment-compose__send')
            if not send.is_disabled():
                tap(page, '.comment-compose__send')
            got = page.evaluate(mine)
            lbl = f'{t} commentaire [{nom}]'
            new = got[n0:]
            R.check(len(new) <= 1, f'{lbl} : un envoi au plus ({len(new)})')
            for b in new:
                R.check(0 < len(b) <= 500 and b.strip() == b and b.translate({ord(c): None for c in '   ​﻿\n'}) != '',
                        f'{lbl} : envoyé valable pour le serveur ({len(b)} caractères)')
            if not new and saisi.strip('   ​﻿\n'):
                R.check(send.is_disabled() or page.evaluate(REFUS) != '', f'{lbl} : refus dit (bouton grisé ou message)')
            r = page.evaluate(INSPECT, (saisi.strip()[:12] if new else ''))
            R.check(not r['hits'] and not r['injected'], f'{lbl} : rien d\'exécuté ni d\'injecté {r["hits"]} {r["injected"]}')
            R.check(r['sw'] <= r['cw'] + 1, f'{lbl} : pas de défilement horizontal')
            R.check(not r['over'], f'{lbl} : aucun texte qui déborde {r["over"]}')
            R.check(len(page.errors) == errs, f'{lbl} : aucune erreur JS {page.errors[errs:]}')
        # Double toucher sur Envoyer : un seul commentaire
        n0 = len(page.evaluate(mine))
        put(page, '#commentInput', 'Double toucher')
        page.locator('.comment-compose__send').dblclick()
        settle(page)
        R.check(len(page.evaluate(mine)) == n0 + 1, f'{t} commentaire : double toucher, un seul envoi')
        shot(page, LOT, f'commentaires-{t}')

        # Demande de coach : nom et numéro de carte tels que le serveur les reçoit
        page.evaluate("navigate('coach-request')")
        page.wait_for_selector('#coachReqName')
        settle(page)
        sent = "__sb.calls.filter(c => c[0] === 'coach' && c[1] === 'coach_request_submit').map(c => c[2])"
        for nom, saisi in textes(80):
            close_all(page)
            if not page.locator('#coachReqName').count():
                page.evaluate("navigate('coach-request')")
                page.wait_for_selector('#coachReqName')
            n0 = len(page.evaluate(sent))
            errs = len(page.errors)
            put(page, '#coachReqName', saisi)
            put(page, '#coachReqCard', '04/912 ED.0123')
            page.select_option('#coachReqDiploma', index=1)
            tap(page, '[data-action="coach-request-send"]')
            calls = page.evaluate(sent)[n0:]
            lbl = f'{t} demande de coach [{nom}]'
            for a in calls:
                a = a if isinstance(a, dict) else json.loads(a)
                nm = a.get('card_name', '')
                R.check(2 <= len(nm) <= 80 or (len(nm) > 80 and len([c for c in nm]) <= 80), f'{lbl} : nom de 2 à 80 caractères ({len(nm)})')
                R.check(a.get('card_number') == '04912ED0123', f'{lbl} : numéro normalisé comme le serveur ({a.get("card_number")!r})')
            if not calls and saisi.strip():
                R.check(page.evaluate(REFUS) != '', f'{lbl} : refus dit')
            R.check(len(page.errors) == errs, f'{lbl} : aucune erreur JS {page.errors[errs:]}')
            R.check(not page.evaluate(INSPECT, '')['injected'], f'{lbl} : rien d\'injecté')
            if calls:   # demande envoyée : on l'annule pour la valeur suivante
                page.evaluate("__sb.co.requests && (__sb.co.requests = {})")
        # Valeur valable : envoyée, carte « 04/912 ED.0123 » normalisée comme le serveur (avant : refusée par l'app)
        close_all(page)
        page.evaluate("navigate('coach-request')")
        page.wait_for_selector('#coachReqName')
        n0 = len(page.evaluate(sent))
        put(page, '#coachReqName', 'Jean Dupont')
        put(page, '#coachReqCard', '04/912 ED.0123')
        page.select_option('#coachReqDiploma', index=1)
        tap(page, '[data-action="coach-request-send"]')
        got = page.evaluate(sent)[n0:]
        R.check(len(got) == 1 and (got[0] if isinstance(got[0], dict) else json.loads(got[0])).get('card_number') == '04912ED0123',
                f'{t} demande de coach valable envoyée, carte normalisée ({got})')
        R.check(not page.errors, f'{t} serveur : aucune erreur JS {page.errors}')


def t_recherches(bench, eng, dev, theme):
    """Champs de recherche (bibliothèque, historique, ajout d'un exercice) : pires valeurs, rien ne casse (thème clair)."""
    if theme != 'light':
        return
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        ecrans = [('bibliothèque', "routeTo('library')", '#libSearch'),
                  ('historique', "routeTo('history')", '#histSearch'),
                  ('ajouter un exercice', "startSession('push'); void openAddExSheet()", '#axSearch')]
        for nom_e, go, sel in ecrans:
            try:
                page.evaluate(go)
                page.wait_for_selector(sel)
                settle(page)
            except Exception as e:
                R.check(False, f'{t} {nom_e} : écran introuvable {str(e).splitlines()[0]}')
                continue
            ml = int(page.get_attribute(sel, 'maxlength') or 0)
            R.check(ml > 0, f'{t} {nom_e} : recherche bornée (maxlength {ml})')
            for nom, saisi in textes(ml or 100):
                errs = len(page.errors)
                page.evaluate("window.__hits = []")
                v = put(page, sel, saisi)
                r = page.evaluate(INSPECT, '')
                lbl = f'{t} {nom_e} [{nom}]'
                R.check(len(v) <= (ml or 10**9), f'{lbl} : {len(v)} caractères dans le champ')
                R.check(not r['hits'] and not r['injected'], f'{lbl} : rien d\'exécuté ni d\'injecté')
                R.check(r['sw'] <= r['cw'] + 1, f'{lbl} : pas de défilement horizontal')
                R.check(len(page.errors) == errs, f'{lbl} : aucune erreur JS {page.errors[errs:]}')
                if sel == '#axSearch' and nom in ('espaces', 'insécables', 'invisibles'):
                    R.check(page.locator('.ax__item--create').count() == 0, f'{lbl} : pas de « Créer » un exercice sans nom')
            put(page, sel, '')
        close_all(page)


if __name__ == '__main__':
    run_main(R, [t_local, t_serveur, t_recherches])   # t_serveur en sombre, t_recherches en clair (voir leur garde)
