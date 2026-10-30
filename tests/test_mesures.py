"""Progrès › Mesures : mensurations et photos de progression, 100 % sur l'appareil.

Vérifie : l'écran Progrès mène à Mesures sans montrer de photo ; saisie datée de plusieurs mesures ;
courbe d'une mesure, dernière valeur et écart ; suppression d'une mesure ; ajout d'une photo par le
champ fichier (image générée ici), galerie par date, comparaison de deux dates, suppression ;
pouces avec l'unité lbs ; rien dans le profil synchronisé ; « Supprimer toutes les données » efface
mensurations et photos (IndexedDB).
Captures : $PPL_SCRATCH/shots/lotmesures/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_mesures.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import json
import os
import struct
import sys
import time
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'mesures'
R = Results(LOT)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def png_file(name, w, h, rgb):
    """Petite image PNG unie (sans dépendance), écrite dans le dossier de travail des tests."""
    os.makedirs(SCRATCH, exist_ok=True)
    path = os.path.join(SCRATCH, name)
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as fh:
        fh.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                 + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
    return path


def measures_data(now, unit='kg'):
    d = ppl_v2_today(now_ms=now)
    d['unit'] = unit
    d['bodyMeasures'] = {'waist': [{'date': now - i * 7 * DAY, 'cm': 82 - i * 0.5} for i in range(6)],
                         'chest': [{'date': now - 14 * DAY, 'cm': 95.5}]}
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
    now = int(time.time() * 1000)
    with bench.page(eng, dev, theme) as page:
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
        R.check(page.locator('.bm-in').count() == 10 and page.input_value('#bmDate') == time.strftime('%Y-%m-%d'), f'{t} feuille : 10 champs, date du jour')
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


def t_photos(bench, eng, dev, theme):
    t = tag(dev, theme)
    now = int(time.time() * 1000)
    face = png_file('photo-face.png', 300, 400, (200, 80, 80))
    back = png_file('photo-dos.png', 1500, 2000, (80, 80, 200))
    with bench.page(eng, dev, theme) as page:
        open_measures(page, theme, now)
        R.check(page.evaluate("photosAll().then(l => l.length)") == 0 and page.locator('.pgal__item').count() == 0, f'{t} aucune photo au départ')
        R.check(page.locator('[data-action="photo-add"]').count() == 1, f'{t} bouton Ajouter une photo')
        R.check(page.locator('#photoFile').get_attribute('accept') == 'image/*', f'{t} champ fichier : images seulement')

        # Première photo : face, aujourd'hui
        page.set_input_files('#photoFile', face)
        page.wait_for_selector('.sheet-root .pnew__img')
        page.wait_for_timeout(300)
        R.check(page.locator('.pnew__pose [aria-checked="true"]').inner_text() == 'Face', f'{t} pose Face par défaut')
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.pgal__item', timeout=5000)
        page.wait_for_timeout(300)
        R.check(page.locator('.pgal__item').count() == 1 and 'Face' in page.locator('.pgal__item').first.inner_text(), f'{t} galerie : une photo Face')
        R.check('1 photo' in page.inner_text('#photosBox') and 'sur l\'appareil' in page.inner_text('#photosBox'), f'{t} poids total affiché')
        R.check(page.locator('.pcmp').count() == 0, f'{t} pas de comparaison avec une seule photo')

        # Deuxième photo : dos, grande image (réduite à 1200 px), datée du 1er septembre
        page.set_input_files('#photoFile', back)
        page.wait_for_selector('.sheet-root .pnew__img')
        page.wait_for_timeout(300)
        page.click('.pnew__pose [data-pose="back"]')
        page.fill('#phDate', '2026-09-01')
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.pcmp', timeout=8000)
        page.wait_for_timeout(300)
        photos = page.evaluate("photosAll().then(l => l.map(p => ({ pose: p.pose, w: p.w, h: p.h, type: p.type, big: p.bytes > 0 && p.bytes < 400000 })))")
        R.check(photos == [{'pose': 'face', 'w': 300, 'h': 400, 'type': 'image/jpeg', 'big': True},
                           {'pose': 'back', 'w': 900, 'h': 1200, 'type': 'image/jpeg', 'big': True}], f'{t} IndexedDB : JPEG réduit à 1200 px de haut {photos}')
        days = page.locator('.pgal__date').all_inner_texts()
        R.check(days == ['Aujourd\'hui', 'mar. 1 sept.'], f'{t} galerie par date, la plus récente d\'abord {days}')
        R.check(page.locator('.pcmp__img').count() == 2 and '59 jours' in page.inner_text('.pcmp__gap'), f'{t} comparaison : deux photos, écart en jours {page.inner_text(".pcmp__gap")!r}')
        R.check(page.locator('.view.stats img, .view.body-measures .group-title:has-text("Mensurations") img').count() == 0, f'{t} aucune image hors de la section Photos')
        shot(page, LOT, f'photos-{t}')
        # Changer la photo de droite : la même que la gauche → écart 0
        left = page.locator('#pcmp-a').input_value()
        page.select_option('#pcmp-b', left)
        page.wait_for_timeout(200)
        R.check('Même jour' in page.inner_text('.pcmp__gap'), f'{t} comparaison recalculée après le changement')

        # Ouvrir puis supprimer la photo de face
        page.locator('.pgal__item').first.click()
        page.wait_for_selector('.sheet-root .pview__img')
        page.wait_for_timeout(300)
        R.check('300 × 400 px' in page.inner_text('.sheet-root'), f'{t} photo ouverte avec ses dimensions')
        page.click('[data-action="photo-delete"]')
        tap_dialog(page, 'Supprimer')
        page.wait_for_selector('.sheet-root', state='detached', timeout=4000)
        page.wait_for_timeout(400)
        R.check(page.locator('.pgal__item').count() == 1 and page.evaluate("photosAll().then(l => l.length)") == 1, f'{t} photo supprimée de la galerie et d\'IndexedDB')
        R.check(not page.errors, f'{t} aucune erreur JS : {page.errors}')


def t_unite_pouces(bench, eng, dev, theme):
    t = tag(dev, theme)
    now = int(time.time() * 1000)
    with bench.page(eng, dev, theme) as page:
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
    """« Supprimer toutes les données » efface les mensurations et les photos (IndexedDB)."""
    now = int(time.time() * 1000)
    face = png_file('photo-face.png', 300, 400, (200, 80, 80))
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        open_measures(page, 'dark', now)
        page.set_input_files('#photoFile', face)
        page.wait_for_selector('.sheet-root .pnew__img')
        page.wait_for_timeout(300)
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.pgal__item', timeout=5000)
        R.check(page.evaluate("photosAll().then(l => l.length)") == 1, 'photo en place avant la suppression')
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
        R.check(page.evaluate("photosAll().then(l => l.length)") == 0, 'photos effacées d\'IndexedDB')
        R.check('bodyMeasures' not in (ls(page, 'ppl_v2') or ''), 'mensurations effacées')
        page.evaluate("navigate('body-measures')")
        page.wait_for_selector('.view.body-measures')
        page.wait_for_timeout(400)
        R.check(page.locator('.pgal__item').count() == 0 and page.locator('.bm-cell .cell__sub').count() == 0, 'écran Mesures vide après la suppression')
        R.check(not page.errors, f'aucune erreur JS : {page.errors}')


def t_export_inclut_mesures(bench):
    """L'export JSON contient les mensurations (pas les photos : elles ne sont pas dans data)."""
    now = int(time.time() * 1000)
    with bench.page('chromium', 'Pixel 7', 'light') as page:
        open_measures(page, 'light', now)
        payload = page.evaluate("JSON.stringify({ ...data, _theme: 'auto' })")
        R.check('"bodyMeasures"' in payload and '"waist"' in payload, 'export : mensurations présentes')
        R.check('buf' not in payload and 'mdlf-photos' not in payload, 'export : aucune photo')


# Coquille iOS factice (build sans NSCameraUsageDescription) : modules natifs muets
FAKE_SHELL = """
window.Capacitor = {
  isNativePlatform: () => true,
  registerPlugin: () => new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) }),
};
"""


def t_natif_sans_photos(bench, eng, dev, theme):
    """App iOS dont la build n'a pas l'autorisation de l'appareil photo : aucune photo nulle part (le champ
    « image/* » proposerait « Prendre une photo » et iOS tuerait l'app), mensurations intactes."""
    t = tag(dev, theme)
    now = int(time.time() * 1000)
    with bench.page(eng, dev, theme) as page:
        page.add_init_script(FAKE_SHELL)
        page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
        seed(page, theme, measures_data(now))
        R.check(page.evaluate('Native.isNative') is True and page.evaluate('photosAllowedHere()') is False, f'{t} natif : photos non permises')
        page.click('.tabbar [data-action="go-stats"]')
        page.wait_for_selector('.view.stats')
        cell = page.locator('[data-action="go-body-measures"]')
        R.check(cell.count() == 1 and cell.locator('.cell__title').inner_text() == 'Mensurations', f'{t} natif : ligne « Mensurations »')
        cell.click()
        page.wait_for_selector('.view.body-measures')
        page.wait_for_timeout(400)
        txt = page.inner_text('.view.body-measures')
        R.check(page.locator('#photoFile, #photosBox, [data-action="photo-add"], .pgal, .pcmp').count() == 0 and 'photo' not in txt.lower(), f'{t} natif : écran Mesures sans photos')
        R.check(page.locator('.bm-cell').count() == 10 and 'jamais sur nos serveurs' in txt, f'{t} natif : mensurations et mention de confidentialité')
        shot(page, LOT, f'natif-{t}')
        page.evaluate("navigate('backup')"); page.wait_for_selector('.backup-view')
        R.check('photo' not in page.inner_text('.backup-view').lower(), f'{t} natif : Sauvegarde ne parle pas de photos')
        page.evaluate("navigate('settings')"); page.wait_for_selector('[data-action="wipe-data"]')
        page.click('[data-action="wipe-data"]'); page.wait_for_selector('.ios-dialog')
        R.check('photo' not in page.inner_text('.ios-dialog').lower() and 'mensurations' in page.inner_text('.ios-dialog'), f'{t} natif : confirmation sans photos')
        R.check(page.evaluate("JSON.stringify(GUIDE_SECTIONS).toLowerCase().includes('photo de progression') || JSON.stringify(GUIDE_SECTIONS).includes('[Ajouter une photo]')") is False, f'{t} natif : guide sans photos de progression')


run_main(R, [t_mensurations, t_photos, t_unite_pouces, t_natif_sans_photos], once=[t_tout_supprimer, t_export_inclut_mesures])
