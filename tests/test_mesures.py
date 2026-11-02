"""Progrès › Mesures : mensurations et photos de progression, 100 % sur l'appareil.

Vérifie : l'écran Progrès mène à Mesures sans montrer de photo ; saisie datée de plusieurs mesures ;
courbe d'une mesure, dernière valeur et écart ; suppression d'une mesure ; entrée du coffre à photos
(les photos elles-mêmes : test_coffre.py) ; pouces avec l'unité lbs ; rien dans le profil synchronisé ;
« Supprimer toutes les données » efface les mensurations.
Captures : $PPL_SCRATCH/shots/lotmesures/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_mesures.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'mesures'
R = Results(LOT)

# Horloge figée le lundi 2 novembre 2026 à 23 h 10, heure de Paris : après le passage à l'heure d'hiver
# et tard le soir, là où un écart compté en tranches de 24 h se trompe d'un jour (du 1er septembre à midi :
# 62 jours du calendrier, mais 62,5 « jours » de 24 h). Toutes les dates du test partent de cet instant.
NOW = local_ms(2026, 11, 2, 23, 10, tz=PARIS)
TODAY = '2026-11-02'


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def measures_data(now, unit='kg'):
    d = ppl_v2_today(now_ms=now)
    d['unit'] = unit
    # Une mesure par semaine à 9 h (jours du calendrier), la plus récente aujourd'hui
    d['bodyMeasures'] = {'waist': [{'date': days_back_ms(now, i * 7, 9, tz=PARIS), 'cm': 82 - i * 0.5} for i in range(6)],
                         'chest': [{'date': days_back_ms(now, 14, 9, tz=PARIS), 'cm': 95.5}]}
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


def open_measures(page, theme, now, unit='kg'):
    seed(page, theme, measures_data(now, unit))
    page.click('.tabbar [data-action="go-stats"]')
    page.wait_for_selector('.view.stats')
    page.click('[data-action="go-body-measures"]')
    page.wait_for_selector('.view.body-measures')
    page.wait_for_timeout(400)   # lecture des photos dans IndexedDB


def t_mensurations(bench, eng, dev, theme):
    t = tag(dev, theme)
    now = NOW
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        seed(page, theme, measures_data(now))
        page.click('.tabbar [data-action="go-stats"]')
        page.wait_for_selector('.view.stats')
        cell = page.locator('[data-action="go-body-measures"]')
        R.check(cell.count() == 1 and 'Mensurations et photos' in cell.inner_text() and 'Privé' in cell.inner_text(), f'{t} Progrès : ligne Mesures avec la mention Privé')
        R.check(page.locator('.view.stats img[src^="blob:"], .view.stats .pgal, .view.stats .pcmp').count() == 0, f'{t} Progrès : aucune vignette de photo')
        cell.click()
        page.wait_for_selector('.view.body-measures')
        rows = page.locator('.bm-cell')
        R.check(rows.count() == 10, f'{t} 10 mensurations listées : {rows.count()}')
        waist = page.locator('.bm-cell[data-key="waist"]').inner_text()
        R.check('82 cm' in waist and '+0,5 cm' in waist, f'{t} taille : dernière valeur et écart {waist!r}')
        R.check('—' in page.locator('.bm-cell[data-key="hips"]').inner_text(), f'{t} hanches sans mesure : tiret')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} pas de défilement horizontal')
        shot(page, LOT, f'mesures-{t}')

        # Saisie datée de deux mesures (les autres restent vides)
        page.click('[data-action="bm-add"]')
        page.wait_for_selector('.sheet-root .bm-in')
        page.wait_for_timeout(300)
        R.check(page.locator('.bm-in').count() == 10 and page.input_value('#bmDate') == TODAY, f'{t} feuille : 10 champs, date du jour')
        page.fill('.bm-in[data-key="chest"]', '96,2')
        page.fill('.bm-in[data-key="hips"]', '5')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(300)
        R.check(page.locator('.sheet-root').count() == 1 and page.get_attribute('.bm-in[data-key="hips"]', 'aria-invalid') == 'true', f'{t} 5 cm refusé, feuille gardée')
        page.fill('.bm-in[data-key="hips"]', '97')
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.sheet-root', state='detached', timeout=4000)
        page.wait_for_timeout(300)
        chest = page.locator('.bm-cell[data-key="chest"]').inner_text()
        hips = page.locator('.bm-cell[data-key="hips"]').inner_text()
        R.check('96,2 cm' in chest and '+0,7 cm' in chest, f'{t} poitrine mise à jour avec écart {chest!r}')
        R.check('97 cm' in hips and 'Aujourd' in hips, f'{t} hanches du jour {hips!r}')
        # Mesure datée dans le passé : rangée à sa date, la plus récente reste la dernière
        page.click('[data-action="bm-add"]')
        page.wait_for_selector('.sheet-root .bm-in')
        page.wait_for_timeout(300)
        page.fill('#bmDate', '2026-10-01')
        page.fill('.bm-in[data-key="hips"]', '98')
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.sheet-root', state='detached', timeout=4000)
        page.wait_for_timeout(300)
        hips = page.locator('.bm-cell[data-key="hips"]').inner_text()
        R.check('97 cm' in hips and '−1 cm' in hips, f'{t} mesure du 1er octobre rangée avant celle du jour {hips!r}')
        stored = json.loads(ls(page, 'ppl_v2'))
        R.check(stored['bodyMeasures']['hips'][0]['cm'] == 97 and len(stored['bodyMeasures']['waist']) == 6, f'{t} ppl_v2 : mensurations enregistrées en cm')
        R.check(page.evaluate("!('bodyMeasures' in profilePayload(data)) && SYNC_LOCAL_ONLY.includes('bodyMeasures')"), f'{t} jamais dans le profil synchronisé')

        # Courbe d'une mesure, écarts, ajout d'une seule mesure, suppression
        page.click('.bm-cell[data-key="waist"]')
        page.wait_for_selector('.view.body-measure')
        page.wait_for_timeout(300)
        aria = page.get_attribute('#exChart canvas', 'aria-label') or ''
        R.check(aria.startswith('Taille : de 79,5 cm') and 'à 82 cm' in aria, f'{t} courbe décrite pour VoiceOver {aria!r}')
        head = page.inner_text('.chart-head')
        R.check('82 cm' in head and '+0,5 cm' in head, f'{t} en-tête : dernière valeur et écart {head!r}')
        R.check('+2,5 cm' in page.inner_text('.view.body-measure'), f'{t} écart depuis la première mesure')
        R.check(page.locator('.bm-entry').count() == 6, f'{t} 6 mesures dans l\'historique')
        box = page.locator('.bm-del').first.bounding_box()
        R.check(box and box['width'] >= 44 and box['height'] >= 44, f'{t} bouton Supprimer d\'au moins 44 px : {box}')
        # Pose du doigt sur la courbe : bulle avec la date et la valeur
        c = page.locator('#exChart canvas').bounding_box()
        page.mouse.move(c['x'] + 4, c['y'] + 100)
        page.mouse.down()
        page.wait_for_timeout(100)
        R.check('79,5 cm' in page.inner_text('#exChart .chart-bubble'), f'{t} bulle de la première mesure {page.inner_text("#exChart .chart-bubble")!r}')
        page.mouse.up()
        shot(page, LOT, f'courbe-{t}')

        page.click('[data-action="bm-add-one"]')
        page.wait_for_selector('.sheet-root .bm-in')
        page.wait_for_timeout(300)
        R.check(page.locator('.bm-in').count() == 1, f'{t} feuille d\'une seule mesure')
        page.fill('.bm-in', '81,2')
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.sheet-root', state='detached', timeout=4000)
        page.wait_for_timeout(300)
        head = page.inner_text('.chart-head')
        R.check('81,2 cm' in head and '−0,3 cm' in head, f'{t} mesure du jour remplacée, écart recalculé {head!r}')
        R.check(page.locator('.bm-entry').count() == 6, f'{t} toujours 6 mesures (une par jour)')
        page.locator('.bm-del').first.click()
        tap_dialog(page, 'Supprimer')
        page.wait_for_timeout(300)
        R.check(page.locator('.bm-entry').count() == 5 and '81,5 cm' in page.inner_text('.chart-head'), f'{t} mesure supprimée, la précédente redevient la dernière')
        R.check(not page.errors, f'{t} aucune erreur JS : {page.errors}')


def t_unite_pouces(bench, eng, dev, theme):
    t = tag(dev, theme)
    now = NOW
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_measures(page, theme, now, unit='lbs')
        waist = page.locator('.bm-cell[data-key="waist"]').inner_text()
        R.check('32,3 in' in waist and '+0,2 in' in waist, f'{t} lbs : taille en pouces {waist!r}')
        R.check('pouces' in page.inner_text('.view.body-measures'), f'{t} note d\'unité en pouces')
        page.click('[data-action="bm-add"]')
        page.wait_for_selector('.sheet-root .bm-in')
        page.wait_for_timeout(300)
        page.fill('.bm-in[data-key="neck"]', '15')
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.sheet-root', state='detached', timeout=4000)
        page.wait_for_timeout(300)
        stored = json.loads(ls(page, 'ppl_v2'))
        R.check(stored['bodyMeasures']['neck'][0]['cm'] == 38.1, f'{t} 15 in enregistrés en cm : {stored["bodyMeasures"].get("neck")}')
        R.check('15 in' in page.locator('.bm-cell[data-key="neck"]').inner_text(), f'{t} réaffiché en pouces')


def t_tout_supprimer(bench):
    """« Supprimer toutes les données » efface les mensurations (le coffre à photos : test_coffre.py)."""
    now = NOW
    with bench.frozen_page(NOW, 'webkit', 'iPhone 13', 'dark') as page:
        open_measures(page, 'dark', now)
        page.evaluate("navigate('backup')")
        page.wait_for_selector('.backup-view [data-action="export"]')
        R.check('pas tes photos' in page.inner_text('.backup-view'), 'Réglages › Sauvegarde : l\'export n\'inclut pas les photos, dit sous le groupe')
        page.evaluate("navigate('settings')")
        page.wait_for_selector('[data-action="wipe-data"]')
        page.click('[data-action="wipe-data"]')
        page.wait_for_selector('.ios-dialog')
        R.check('mensurations et photos' in page.inner_text('.ios-dialog'), 'la confirmation cite les mensurations et les photos')
        tap_dialog(page, 'Tout supprimer')
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'Supprimer')
        page.wait_for_timeout(600)
        R.check('bodyMeasures' not in (ls(page, 'ppl_v2') or ''), 'mensurations effacées')
        R.check('bodyMeasures' not in (ls(page, 'ppl_v2_backup') or ''), 'copie de secours sans les mensurations')
        page.evaluate("navigate('body-measures')")
        page.wait_for_selector('.view.body-measures')
        page.wait_for_timeout(400)
        R.check(page.locator('.bm-cell .cell__sub').count() == 0, 'écran Mesures vide après la suppression')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


def t_export_inclut_mesures(bench):
    """L'export JSON contient les mensurations (pas les photos : elles ne sont pas dans data)."""
    now = NOW
    with bench.frozen_page(NOW, 'chromium', 'Pixel 7', 'light') as page:
        open_measures(page, 'light', now)
        payload = page.evaluate("JSON.stringify({ ...data, _theme: 'auto' })")
        R.check('"bodyMeasures"' in payload and '"waist"' in payload, 'export : mensurations présentes')
        R.check('buf' not in payload and 'mdlf-photos' not in payload, 'export : aucune photo')


# Coquille iOS factice (build unique : NSCameraUsageDescription et NSPhotoLibraryUsageDescription dans
# Info.plist, PHOTOS_NATIVE_READY = true) : modules natifs muets
FAKE_SHELL = """
window.Capacitor = {
  isNativePlatform: () => true,
  registerPlugin: () => new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) }),
};
"""


def t_natif_avec_photos(bench, eng, dev, theme):
    """App iOS de la build qui a les autorisations : photos permises comme dans le navigateur (Mesures,
    Sauvegarde, confirmation de suppression), mensurations intactes."""
    t = tag(dev, theme)
    now = NOW
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        page.add_init_script(FAKE_SHELL)
        page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
        seed(page, theme, measures_data(now))
        R.check(page.evaluate('Native.isNative') is True and page.evaluate('photosAllowedHere()') is True, f'{t} natif : photos permises')
        page.click('.tabbar [data-action="go-stats"]')
        page.wait_for_selector('.view.stats')
        cell = page.locator('[data-action="go-body-measures"]')
        R.check(cell.count() == 1 and 'Mensurations et photos' in cell.inner_text(), f'{t} natif : ligne « Mensurations et photos »')
        cell.click()
        page.wait_for_selector('.view.body-measures')
        page.wait_for_timeout(400)
        R.check(page.locator('[data-action="go-photo-vault"]').count() == 1 and page.locator('.bm-cell').count() == 10, f'{t} natif : coffre à photos et mensurations')
        shot(page, LOT, f'natif-{t}')
        page.evaluate("navigate('settings')"); page.wait_for_selector('[data-action="wipe-data"]')
        page.click('[data-action="wipe-data"]'); page.wait_for_selector('.ios-dialog')
        R.check('photos' in page.inner_text('.ios-dialog').lower(), f'{t} natif : la confirmation cite les photos')
        R.check(not page.errors, f'{t} natif : aucune erreur JS {page.errors}')


run_main(R, [t_mensurations, t_unite_pouces, t_natif_avec_photos], once=[t_tout_supprimer, t_export_inclut_mesures])
