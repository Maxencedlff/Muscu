"""Entraînement intelligent : carte « Conseil d'entraînement » de l'accueil (semaine plus légère conseillée,
commencée, terminée, reprise des charges), réglage, niveau de force (Bibliothèque › Exercice, Progrès ›
Exercice, bilan), stagnation dans Progrès › Exercice.

Données : 6 semaines de séances (lundi, mercredi, vendredi) sur trois exercices à barre, charges qui montent
deux semaines puis stagnent, poids du corps 80 kg. L'heure de l'app est figée au lundi 2/11/2026, 10 h.
Captures dans $PPL_SCRATCH/shots/entrainement/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_entrainement.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import json
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from donnees_realistes import six_mois

LOT = 'entrainement'
R = Results(LOT)
OUT = os.path.join(SHOTS, 'entrainement')
NOW = datetime(2026, 11, 2, 10, 0)


def frozen():
    return f"""(() => {{
      const RealDate = Date, NOW = new RealDate(2026, 10, 2, 10, 0).getTime();
      window.Date = class extends RealDate {{
        constructor(...a) {{ if (a.length) super(...a); else super(NOW); }}
        static now() {{ return NOW; }}
      }};
    }})()"""


def ms(dt):
    # Heure locale du navigateur : Playwright garde celle de la machine, comme datetime sans fuseau
    return int(dt.timestamp() * 1000)


def stalled_data(body_kg=80.0, silhouette=None):
    """6 semaines : 70 → 75 kg puis 80 kg × 5 sans progrès sur trois exercices à barre."""
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
    if silhouette:
        d['silhouette'] = silhouette
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
    page.screenshot(path=os.path.join(OUT, name.replace(' ', '_').replace('+', 'plus') + '.png'), full_page=False)


def t_carte(bench, eng, dev, theme):
    tag = f'{dev}-{theme}'
    cm, page = open_app(bench, eng, dev, theme, stalled_data())
    try:
        card = page.locator('.ti-card')
        R.check(card.count() == 1, f'{tag} accueil : carte « Conseil d\'entraînement »')
        txt = card.inner_text()
        R.check('Semaine plus légère conseillée' in txt, f'{tag} carte : titre ({txt[:80]!r})')
        R.check('6 semaines chargées d\'affilée' in txt, f'{tag} carte : semaines tirées des séances')
        R.check('Développé couché barre' in txt and 'autre' in txt, f'{tag} carte : exercices qui stagnent nommés')
        R.check('Environ 5 séries par séance au lieu de 9' in txt, f'{tag} carte : séries de la personne')
        # Lisible en entier (rien de coupé ni de débordant) et boutons d'au moins 44 pt
        box = page.evaluate("""() => { const c = document.querySelector('.ti-card'); const r = c.getBoundingClientRect();
          const btns = [...c.querySelectorAll('button')].map(b => b.getBoundingClientRect());
          return { over: c.scrollWidth > c.clientWidth + 1, right: r.right <= innerWidth, minH: Math.min(...btns.map(b => b.height)) }; }""")
        R.check(not box['over'] and box['right'], f'{tag} carte : rien ne déborde {box}')
        R.check(box['minH'] >= 44, f'{tag} carte : boutons de 44 pt au moins {box}')
        page.locator('.ti-card').scroll_into_view_if_needed()
        snap(page, f'carte-conseil-{dev}-{theme}')

        page.locator('[data-action="training-why"]').click()
        page.wait_for_selector('.ios-dialog')
        R.check('Bell' in page.inner_text('.ios-dialog'), f'{tag} « Pourquoi ? » : source citée')
        tap_dialog(page, 'OK')

        page.locator('[data-action="deload-start"]').click()
        page.wait_for_timeout(300)
        dl = page.evaluate('data.deload')
        R.check(dl and dl['end'] - dl['start'] == 7 * DAY, f'{tag} Commencer : décharge de 7 jours enregistrée {dl}')
        txt = page.locator('.ti-card').inner_text()
        R.check('Jusqu\'au' in txt and 'Terminer la décharge' in txt, f'{tag} décharge en cours : carte ({txt[:80]!r})')
        page.locator('.ti-card').scroll_into_view_if_needed()
        snap(page, f'carte-en-cours-{dev}-{theme}')
        R.check(json.loads(ls(page, 'ppl_v2')).get('deload') == dl, f'{tag} décharge gardée dans ppl_v2')

        page.locator('[data-action="deload-stop"]').click()
        page.wait_for_timeout(300)
        txt = page.locator('.ti-card').inner_text()
        R.check('Reprends tes charges d\'avant' in txt and '80 kg × 5' in txt, f'{tag} reprise : charges d\'avant ({txt[:120]!r})')
        page.locator('.ti-card').scroll_into_view_if_needed()
        snap(page, f'carte-reprise-{dev}-{theme}')
        page.locator('[data-action="deload-resume-hide"]').click()
        page.wait_for_timeout(300)
        R.check(page.locator('.ti-card').count() == 0, f'{tag} reprise masquée : plus de carte (décharge comptée)')
        R.check(not page.errors, f'{tag} carte : aucune erreur JS {page.errors}')
    finally:
        cm.__exit__(None, None, None)

    # « Pas maintenant » puis réglage coupé
    cm, page = open_app(bench, eng, dev, theme, stalled_data())
    try:
        page.locator('[data-action="deload-later"]').click()
        page.wait_for_timeout(300)
        R.check(page.locator('.ti-card').count() == 0 and page.evaluate('data.deloadSnooze') > 0, f'{tag} Pas maintenant : carte repoussée')
        page.evaluate("delete data.deloadSnooze; save(); navigate('settings')")
        page.wait_for_selector('.settings-view')
        sw = page.locator('[data-action="setting-training-tips"]')
        R.check(sw.get_attribute('aria-checked') == 'true', f'{tag} réglage : allumé par défaut')
        sw.click(); page.wait_for_timeout(200)
        R.check(sw.get_attribute('aria-checked') == 'false' and page.evaluate('data.trainingTipsOff') is True, f'{tag} réglage coupé')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        R.check(page.locator('.ti-card').count() == 0, f'{tag} réglage coupé : pas de carte')
        R.check(not page.errors, f'{tag} réglage : aucune erreur JS {page.errors}')
    finally:
        cm.__exit__(None, None, None)


def t_niveau(bench, eng, dev, theme):
    tag = f'{dev}-{theme}'
    cm, page = open_app(bench, eng, dev, theme, stalled_data())
    try:
        # Bibliothèque › Développé couché barre : 80 × 5 → 1RM est. 93,3 kg, 1,17 × 80 kg → novice (1,00), intermédiaire à 100 kg
        page.evaluate("switchTab('programme'); navigate(makeRoute('library-ex', 'Développé couché barre'))")
        page.wait_for_selector('.library-ex .ti-scale')
        txt = page.inner_text('.library-ex')
        R.check('niveau de force' in txt.lower() and 'Novice' in txt, f'{tag} fiche : niveau Novice')
        R.check('Intermédiaire à 100 kg' in txt, f'{tag} fiche : palier suivant en kg')
        R.check('1,17 × ton poids' in txt, f'{tag} fiche : rapport au poids du corps')
        R.check('Repères hommes pour 80 kg' in txt and 'Strength Level' in txt, f'{tag} fiche : repères et source')
        page.locator('.ti-scale').scroll_into_view_if_needed()
        snap(page, f'fiche-niveau-{dev}-{theme}')
        page.locator('[data-action="strength-info"]').click()
        page.wait_for_selector('.ios-dialog')
        R.check('95 %' in page.inner_text('.ios-dialog'), f'{tag} « i » : percentiles expliqués')
        tap_dialog(page, 'OK')
        # Une variante n'a pas de repères
        page.evaluate("navigate(makeRoute('library-ex', 'Développé couché haltères'))")
        page.wait_for_timeout(300)
        R.check('niveau de force' not in page.locator('.library-ex').last.inner_text().lower(), f'{tag} variante haltères : pas de niveau')

        # Progrès › Exercice : stagnation et niveau
        page.evaluate("switchTab('progress'); navigate(makeRoute('stats-ex', 'sqb'))")
        page.wait_for_selector('.stats-ex .ti-scale')
        txt = page.inner_text('.stats-ex')
        R.check('Pas de nouveau 1RM est. depuis' in txt, f'{tag} Progrès › Exercice : stagnation')
        R.check('niveau de force' in txt.lower(), f'{tag} Progrès › Exercice : niveau')
        page.locator('.ti-scale').scroll_into_view_if_needed()
        snap(page, f'progres-stagnation-{dev}-{theme}')

        # Bilan : niveau des exercices principaux de la séance
        html = page.evaluate('summaryStrengthHtml(data.history[0])')
        R.check('Niveau de force' in html and 'Squat barre' in html, f'{tag} bilan : niveaux de la séance')
        R.check(not page.errors, f'{tag} niveau : aucune erreur JS {page.errors}')
    finally:
        cm.__exit__(None, None, None)

    # Sans poids du corps : invitation à le saisir ; silhouette Femme : repères femmes
    cm, page = open_app(bench, eng, dev, theme, stalled_data(body_kg=None))
    try:
        page.evaluate("switchTab('programme'); navigate(makeRoute('library-ex', 'Squat barre'))")
        page.wait_for_selector('.library-ex')
        R.check(page.locator('.library-ex [data-action="set-body-weight"]').count() == 1, f'{tag} sans poids : « Ajoute ton poids du corps »')
    finally:
        cm.__exit__(None, None, None)
    cm, page = open_app(bench, eng, dev, theme, stalled_data(body_kg=60, silhouette='female'))
    try:
        page.evaluate("switchTab('programme'); navigate(makeRoute('library-ex', 'Développé couché barre'))")
        page.wait_for_selector('.library-ex .ti-scale')
        txt = page.inner_text('.library-ex')
        R.check('Repères femmes pour 60 kg' in txt and 'Élite' in txt, f'{tag} femme 60 kg : 93,3 / 60 = 1,56 → Élite')
    finally:
        cm.__exit__(None, None, None)


run_main(R, [t_carte, t_niveau])
