"""Niveau de force : Bibliothèque › Exercice, Progrès › Exercice, bilan, Réglages › Entraînement › Sexe,
et cibles / séance qui partent de la dernière séance faite.

Données : 6 semaines de séances (lundi, mercredi, vendredi) sur trois exercices à barre, 80 kg × 5 à la fin,
poids du corps 80 kg. L'heure de l'app est figée au lundi 2/11/2026, 10 h.
Captures dans $PPL_SCRATCH/shots/niveau-force/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_niveau_force.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import json
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from donnees_realistes import six_mois

LOT = 'niveau-force'
R = Results(LOT)
OUT = os.path.join(SHOTS, 'niveau-force')
NOW = datetime(2026, 11, 2, 10, 0)


def frozen():
    return """(() => {
      const RealDate = Date, NOW = new RealDate(2026, 10, 2, 10, 0).getTime();
      window.Date = class extends RealDate {
        constructor(...a) { if (a.length) super(...a); else super(NOW); }
        static now() { return NOW; }
      };
    })()"""


def ms(dt):
    # Heure locale du navigateur : Playwright garde celle de la machine, comme datetime sans fuseau
    return int(dt.timestamp() * 1000)


def barbell_data(body_kg=80.0, sex=None):
    """6 semaines : 70 → 75 kg puis 80 kg × 5 sur développé couché, squat et rowing à la barre."""
    d = six_mois()
    names = [('dcb', 'Développé couché barre'), ('sqb', 'Squat barre'), ('rwb', 'Rowing barre')]
    history = []
    for w in range(6, 0, -1):
        load = 70 + (6 - w) * 5 if w >= 5 else 80
        for k, day in enumerate((0, 2, 4)):
            date = NOW - timedelta(days=7 * w) + timedelta(days=day, hours=8)
            history.append({'id': f'w{w}k{k}', 'programme': 'ppl', 'category': 'push', 'date': ms(date), 'duration': 50 * 60_000,
                            'notes': '', 'exercises': [{'exId': i, 'name': n, 'sets': [{'weight': str(load), 'reps': '5'}] * 3} for i, n in names]})
    history.sort(key=lambda h: -h['date'])
    d['history'] = history
    d['bodyWeightKg'] = body_kg
    if sex:
        d['strengthSex'] = sex
    for c in d['programmes']['ppl']['timers']:
        d['programmes']['ppl']['timers'][c] = history[0]['date']
    return json.dumps(d, ensure_ascii=False)


def open_app(bench, eng, dev, theme, data):
    cm = bench.page(eng, dev, theme)
    page = cm.__enter__()
    page.add_init_script(frozen())
    seed(page, theme, data)
    return cm, page


def snap(page, name):
    os.makedirs(OUT, exist_ok=True)
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(OUT, name.replace(' ', '_') + '.png'), full_page=False)


def open_library(page, name):
    page.evaluate(f"switchTab('programme'); navigate(makeRoute('library-ex', {json.dumps(name)}))")
    page.wait_for_selector('.library-ex')
    page.wait_for_timeout(200)


def t_niveau(bench, eng, dev, theme):
    tag = f'{dev}-{theme}'
    cm, page = open_app(bench, eng, dev, theme, barbell_data(sex='male'))
    try:
        # Bibliothèque › Développé couché barre : 80 × 5 → 1RM est. 93,3 kg, 1,17 × 80 kg → Novice, intermédiaire à 96 kg
        open_library(page, 'Développé couché barre')
        txt = page.inner_text('.library-ex')
        R.check('niveau de force' in txt.lower() and 'Novice' in txt, f'{tag} fiche : niveau Novice')
        R.check('Intermédiaire à 96 kg' in txt, f'{tag} fiche : palier suivant en kg')
        R.check('1,17 × ton poids' in txt, f'{tag} fiche : rapport au poids du corps')
        R.check('Repères hommes pour 80 kg' in txt and 'OpenPowerlifting' in txt, f'{tag} fiche : repères et source')
        page.locator('.strength-scale').scroll_into_view_if_needed()
        snap(page, f'fiche-niveau-{dev}-{theme}')
        page.locator('[data-action="strength-info"]').click()
        page.wait_for_selector('.ios-dialog')
        R.check('OpenPowerlifting' in page.inner_text('.ios-dialog'), f'{tag} « i » : source citée')
        tap_dialog(page, 'OK')
        # Ni variante, ni rowing, ni développé militaire : pas de niveau
        for n in ('Développé couché haltères', 'Rowing barre', 'Développé militaire barre'):
            open_library(page, n)
            R.check('niveau de force' not in page.locator('.library-ex').last.inner_text().lower(), f'{tag} {n} : pas de niveau')

        # Progrès › Exercice : niveau
        page.evaluate("switchTab('progress'); navigate(makeRoute('stats-ex', 'sqb'))")
        page.wait_for_selector('.stats-ex .strength-scale')
        txt = page.inner_text('.stats-ex')
        R.check('niveau de force' in txt.lower(), f'{tag} Progrès › Exercice : niveau')
        page.locator('.strength-scale').scroll_into_view_if_needed()
        snap(page, f'progres-niveau-{dev}-{theme}')

        # Bilan : niveau des exercices principaux de la séance
        html = page.evaluate('summaryStrengthHtml(data.history[0])')
        R.check('Niveau de force' in html and 'Squat barre' in html and 'Rowing' not in html, f'{tag} bilan : niveaux de la séance')

        # Cibles et séance partent de la dernière séance faite (aucune décharge ne les change) : palier de charge
        # proposé, toutes les séries prévues préremplies
        page.evaluate("""data.programmes.ppl.exercises.push = [['dcb', 'Développé couché barre'], ['sqb', 'Squat barre']]
          .map(([id, name]) => ({ id, name, sets: 3, repMax: 5 })); save(); switchTab('train'); render();""")
        push = page.evaluate("targetsCard('push')")
        R.check('À battre' in push and '82,5 kg' in push and 'targets__gain' in push, f'{tag} cibles Push : palier de charge depuis la dernière séance')
        page.evaluate("startSession('push')")
        page.wait_for_selector('.ex-card')
        sess = page.evaluate("activeSession.exercises.map(e => e.sets.map(s => s.weight + '×' + s.reps).join(' '))")
        R.check(sess == ['80×5 80×5 80×5'] * 2, f'{tag} séance : 3 séries préremplies depuis la dernière séance {sess}')
        page.evaluate("endSession()")
        R.check(not page.errors, f'{tag} niveau : aucune erreur JS {page.errors}')
    finally:
        cm.__exit__(None, None, None)

    # Sans sexe indiqué : 1RM estimé sans palier, choix proposé dans la fiche, puis repères femmes
    cm, page = open_app(bench, eng, dev, theme, barbell_data(body_kg=60))
    try:
        open_library(page, 'Développé couché barre')
        txt = page.inner_text('.library-ex')
        R.check('1RM est. ~93,3 kg' in txt and page.locator('.library-ex .strength-scale').count() == 0, f'{tag} sans sexe : 1RM sans palier')
        R.check(not any(lvl in txt for lvl in ('Novice', 'Intermédiaire', 'Avancé', 'Élite')), f'{tag} sans sexe : aucun niveau affiché')
        ask = page.locator('.library-ex [data-action="set-strength-sex"]')
        R.check(ask.count() == 1, f'{tag} sans sexe : « Indiquer mon sexe »')
        ask.scroll_into_view_if_needed()
        snap(page, f'fiche-sans-sexe-{dev}-{theme}')
        R.check(page.evaluate('summaryStrengthHtml(data.history[0])') == '', f'{tag} sans sexe : bilan sans niveau')
        ask.click()
        page.wait_for_selector('.ios-dialog')
        snap(page, f'choix-sexe-{dev}-{theme}')
        tap_dialog(page, 'Femme')
        R.check(page.evaluate('data.strengthSex') == 'female' and json.loads(ls(page, 'ppl_v2')).get('strengthSex') == 'female',
                f'{tag} Femme choisie et gardée')
        page.wait_for_selector('.library-ex .strength-scale')
        txt = page.inner_text('.library-ex')
        R.check('Repères femmes pour 60 kg' in txt and 'Élite' in txt, f'{tag} femme 60 kg : 93,3 / 60 = 1,56 → Élite')
        R.check(not page.errors, f'{tag} sans sexe : aucune erreur JS {page.errors}')
    finally:
        cm.__exit__(None, None, None)

    # Réglages › Entraînement › Sexe : « Ne pas préciser »
    cm, page = open_app(bench, eng, dev, theme, barbell_data())
    try:
        page.evaluate("navigate('settings')")
        page.wait_for_selector('.settings-view')
        cell = page.locator('.settings-view [data-action="set-strength-sex"]')
        R.check(cell.count() == 1 and '—' in cell.inner_text(), f'{tag} réglages : Sexe non renseigné')
        cell.scroll_into_view_if_needed()
        snap(page, f'reglages-sexe-{dev}-{theme}')
        cell.click()
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'Ne pas préciser')
        cell = page.locator('.settings-view [data-action="set-strength-sex"]')
        R.check('Non précisé' in cell.inner_text() and page.evaluate('data.strengthSex') == 'none', f'{tag} réglages : Ne pas préciser')
        open_library(page, 'Squat barre')
        txt = page.inner_text('.library-ex')
        R.check('Pas de palier sans sexe indiqué' in txt and page.locator('.library-ex [data-action="set-strength-sex"]').count() == 0,
                f'{tag} Ne pas préciser : pas de palier, pas de relance')
        R.check(not page.errors, f'{tag} réglages : aucune erreur JS {page.errors}')
    finally:
        cm.__exit__(None, None, None)

    # Sans poids du corps : invitation à le saisir
    cm, page = open_app(bench, eng, dev, theme, barbell_data(body_kg=None, sex='male'))
    try:
        open_library(page, 'Squat barre')
        R.check(page.locator('.library-ex [data-action="set-body-weight"]').count() == 1, f'{tag} sans poids : « Ajoute ton poids du corps »')
    finally:
        cm.__exit__(None, None, None)


run_main(R, [t_niveau])
