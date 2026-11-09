"""Import depuis Hevy et Strong (Réglages › Données › Importer depuis une autre app) : aperçu, liens, import,
historique, programme créé, Progrès et records, doublons, unité, fichier refusé."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'import'
R = Results(LOT)
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'donnees')


def tag(device, theme):
    return f'{device}-{theme}'


def csv_file(name):
    with open(os.path.join(DATA_DIR, name), 'rb') as fh:
        return {'name': name, 'mimeType': 'text/csv', 'buffer': fh.read()}


def toast_text(page, timeout=3000):
    try:
        page.wait_for_selector('.toast', timeout=timeout)
        return page.locator('.toast').inner_text()
    except Exception:
        return ''


def open_import(page, file):
    """Depuis l'accueil : Réglages › Sauvegarde, « Importer depuis une autre app », fichier donné ; attend la feuille d'aperçu."""
    page.click('[data-action="go-settings"]')
    page.wait_for_selector('[data-action="go-backup"]')
    page.click('[data-action="go-backup"]')
    page.wait_for_selector('[data-action="import-other-app"]')
    with page.expect_file_chooser() as fc:
        page.click('[data-action="import-other-app"]')
    fc.value.set_files(files=[file])
    page.wait_for_selector('.sheet-root:not(.sheet-root--out) .imp', timeout=5000)
    page.wait_for_timeout(400)


def rows(page):
    """Lignes « libellé : valeur » de l'aperçu."""
    return {r.split('\n')[0].strip(): r.split('\n')[-1].strip() for r in page.locator('#impSheet .sheet-list__row:not(.imp-row)').all_inner_texts()}


def tab(page, name):
    t = page.locator(f'.tabbar [data-tab="{name}"]')
    t.click(); page.wait_for_timeout(300)
    t.click(); page.wait_for_timeout(300)


def t_hevy(bench, eng, dev, theme):
    """Hevy : aperçu, lien à la main, import, historique, programme, Progrès, record, réimport sans doublon."""
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, None)
        skip_questions(page)
        t = tag(dev, theme)
        open_import(page, csv_file('hevy_exemple.csv'))
        R.check(page.locator('.sheet__title').inner_text() == 'Import Hevy', f'{t} aperçu : titre')
        lead = page.locator('#impSheet .imp__lead').inner_text()
        R.check(lead.startswith('7 séances du 14 janv. au 1 févr. 2026'), f'{t} aperçu : « {lead} »')
        rw = rows(page)
        R.check(rw.get('Séances à ajouter') == '7' and rw.get('Exercices reconnus') == '16 / 17' and rw.get('Exercices créés sous leur nom') == '1', f'{t} aperçu : {rw}')
        R.check(page.locator('#impSheet .imp-row__name', has_text='Svend Press (Plate)').count() == 1, f'{t} aperçu : non reconnu listé')
        R.check(page.locator('#impSheet .imp__switch').count() == 1 and page.locator('#impSheet .imp__ctl').count() == 0, f'{t} aperçu : échauffements proposés, unité connue (kg)')
        R.check(page.locator('.sheet__btn--confirm').inner_text() == 'Importer', f'{t} aperçu : bouton Importer')
        shot(page, LOT, f'apercu-hevy-{t}')
        # Zones de toucher ≥ 44 px dans la feuille
        small = page.evaluate("""[...document.querySelectorAll('.sheet-root button')].filter(b => { const r = b.getBoundingClientRect(); return r.width && r.height && (r.height < 44 || r.width < 44); }).map(b => b.className + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height))""")
        R.check(not small, f'{t} aperçu : boutons < 44 px {small}')
        # Relier « Svend Press (Plate) » à « Rotations russes »
        page.click('[data-action="imp-link"][data-raw="Svend Press (Plate)"]')
        page.wait_for_selector('#impSearch')
        R.check(page.locator('.imp-pick').count() >= 1, f'{t} lien : suggestions proposées sans rien taper')
        page.fill('#impSearch', 'rotations')
        page.wait_for_timeout(150)
        shot(page, LOT, f'lien-{t}')
        page.locator('.imp-pick', has_text='Rotations russes').first.click()
        page.wait_for_timeout(500)
        R.check(page.locator('.sheet-root:not(.sheet-root--out)').count() == 1, f'{t} lien : feuille de lien fermée, aperçu toujours là')
        rw = rows(page)
        R.check(rw.get('Exercices reconnus') == '17 / 17' and 'Exercices créés sous leur nom' not in rw, f'{t} lien : aperçu mis à jour {rw}')
        R.check(page.locator('#impSheet .imp-row__sub', has_text='→ Rotations russes').count() == 1, f'{t} lien : affiché sous le nom')
        # Échauffements gardés puis non
        page.click('[data-action="imp-warmups"]')
        page.wait_for_timeout(200)
        R.check(page.locator('[data-action="imp-warmups"]').get_attribute('aria-checked') == 'true', f'{t} échauffements : interrupteur')
        page.click('[data-action="imp-warmups"]')
        page.wait_for_timeout(200)
        # Importer
        page.click('.sheet__btn--confirm')
        txt = toast_text(page)
        R.check(txt.startswith('Import réussi : 7 séances') and 'Annuler' in txt, f'{t} import : toast « {txt} »')
        d = json.loads(ls(page, 'ppl_v2'))
        R.check(len(d['history']) == 7 and d['userProgrammes'].get('u_hevy', {}).get('name') == 'Hevy' and 'u_hevy' in d['myProgrammes'] and d['activeProgramme'] == 'ppl',
                f'{t} import : 7 séances, programme Hevy créé, actif inchangé')
        labels = sorted(s['label'] for s in d['userProgrammes']['u_hevy']['sessions'].values())
        R.check(labels == ['Cardio', 'Leg Day', 'Pull Day', 'Push Day'], f'{t} import : séances du programme {labels}')
        R.check(all(any(e['name'] == 'Rotations russes' for e in h['exercises']) for h in d['history'] if h['date'] == max(x['date'] for x in d['history'] if any(e['name'] in ('Rotations russes', 'Svend Press (Plate)') for e in x['exercises']))),
                f'{t} import : lien appliqué')
        R.check(json.loads(ls(page, 'ppl_v2_backup'))['history'] == [], f'{t} import : copie d\'avant gardée')
        # Historique : les séances portent le nom de la séance Hevy
        page.wait_for_timeout(IMPORT_UNDO_WAIT)
        tab(page, 'history')
        titles = page.evaluate("[...document.querySelectorAll('.hcell__title')].map(e => e.textContent)")
        R.check(len(titles) == 7 and 'Push Day' in titles and 'Cardio' in titles, f'{t} historique : {titles}')
        subs = page.evaluate("[...document.querySelectorAll('.hcell__prog')].map(e => e.textContent)")
        R.check(any('Hevy' in s for s in subs), f'{t} historique : mention du programme après le titre {subs[:2]}')
        page.locator('.hcell', has_text='Push Day').first.click()
        page.wait_for_selector('.view.history-detail, .hdetail, .view')
        page.wait_for_timeout(300)
        body = page.locator('#app').inner_text()
        R.check('Développé couché barre' in body and '82,5' in body, f'{t} détail : exercice reconnu et charges')
        shot(page, LOT, f'detail-{t}')
        # Progrès : record du développé couché = 82,5 kg × 8 (échauffements écartés)
        tab(page, 'progress')
        page.wait_for_selector('[data-action="open-stats-ex"]')
        page.locator('[data-action="open-stats-ex"]', has_text='Développé couché barre').first.click()
        page.wait_for_selector('.stats-ex')
        page.wait_for_timeout(300)
        cells = {c.split('\n')[0].strip(): c.split('\n')[-1].strip() for c in page.locator('.stats-ex .cell').all_inner_texts() if '\n' in c}
        R.check(cells.get('Record') == '82,5 kg × 8', f'{t} progrès : record {cells.get("Record")}')
        R.check(cells.get('Record 1RM est.', '').startswith('~104,5'), f'{t} progrès : 1RM {cells.get("Record 1RM est.")}')
        shot(page, LOT, f'progres-{t}')
        # Réimport du même fichier : rien à ajouter
        tab(page, 'train')
        open_import(page, csv_file('hevy_exemple.csv'))
        rw = rows(page)
        R.check(rw.get('Séances à ajouter') == '0' and rw.get('Déjà dans l\'historique') == '7', f'{t} réimport : {rw}')
        page.click('.sheet__btn--confirm')
        txt = toast_text(page)
        R.check(txt.startswith('Rien à importer'), f'{t} réimport : « {txt} »')
        R.check(len(json.loads(ls(page, 'ppl_v2'))['history']) == 7, f'{t} réimport : toujours 7 séances')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


IMPORT_UNDO_WAIT = 100   # ms : le toast reste, la synchro n'est pas en jeu sans compte


def t_strong(bench, eng, dev, theme):
    """Strong : unité à choisir (lb), durée, programme Strong, record en livres ; fichier inconnu refusé ; Annuler."""
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, None)
        skip_questions(page)
        t = tag(dev, theme)
        open_import(page, csv_file('strong_exemple.csv'))
        R.check(page.locator('.sheet__title').inner_text() == 'Import Strong', f'{t} strong : titre')
        rw = rows(page)
        R.check(rw.get('Séances à ajouter') == '6' and rw.get('Exercices reconnus') == '16 / 17', f'{t} strong : aperçu {rw}')
        R.check(page.locator('#impSheet .imp__ctl').count() == 1, f'{t} strong : unité demandée (colonne Weight sans unité)')
        page.click('[data-action="imp-unit"][data-val="lbs"]')
        page.wait_for_timeout(200)
        R.check(page.locator('[data-action="imp-unit"][data-val="lbs"]').get_attribute('aria-pressed') == 'true', f'{t} strong : lb choisi')
        shot(page, LOT, f'apercu-strong-{t}')
        page.click('.sheet__btn--confirm')
        txt = toast_text(page)
        R.check(txt.startswith('Import réussi : 6 séances') and '1 exercice créé' in txt, f'{t} strong : toast « {txt} »')
        d = json.loads(ls(page, 'ppl_v2'))
        upper = sorted(d['history'], key=lambda h: h['date'])[0]
        R.check(upper['duration'] == 65 * 60000 and upper['exercises'][0]['name'] == 'Développé couché barre' and upper['exercises'][0]['sets'][0]['weight'] == '36.287',
                f'{t} strong : durée 1h 5m, 80 lb → 36,287 kg {upper["exercises"][0]["sets"][0]}')
        R.check('Bent Over Row (Barbell) : Dos bien droit' in upper.get('notes', ''), f'{t} strong : notes d\'exercice jointes')
        R.check(d['userProgrammes'].get('u_strong', {}).get('name') == 'Strong', f'{t} strong : programme créé')
        # « Annuler » dans le toast : la donnée d'avant revient
        page.click('.toast__action')
        page.wait_for_timeout(300)
        d2 = json.loads(ls(page, 'ppl_v2'))
        R.check(d2['history'] == [] and 'u_strong' not in d2['userProgrammes'], f'{t} strong : Annuler restaure la donnée d\'avant')
        # Fichier qui n'est pas un export connu
        page.wait_for_timeout(300)
        if page.locator('[data-action="import-other-app"]').count() == 0:
            page.evaluate("navigate('backup')")
            page.wait_for_selector('[data-action="import-other-app"]')
        with page.expect_file_chooser() as fc:
            page.click('[data-action="import-other-app"]')
        fc.value.set_files(files=[{'name': 'x.csv', 'mimeType': 'text/csv', 'buffer': b'a,b\n1,2\n'}])
        txt = toast_text(page)
        R.check(txt.startswith('Fichier non reconnu'), f'{t} fichier inconnu : « {txt} »')
        R.check(page.locator('.sheet-root').count() == 0, f'{t} fichier inconnu : pas de feuille')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_merge_existing(bench):
    """Historique existant : rien n'est perdu, l'exercice du même nom partage son identifiant et sa courbe."""
    with bench.page('chromium', 'Pixel 7', 'dark') as page:
        raw = ppl_v2_today_json()
        seed(page, 'dark', raw)
        before = json.loads(page.evaluate('JSON.stringify(data)'))   # après migration au chargement
        n = len(before['history'])
        open_import(page, csv_file('hevy_exemple.csv'))
        page.click('.sheet__btn--confirm')
        txt = toast_text(page)
        R.check(txt.startswith('Import réussi : 7 séances'), f'fusion : « {txt} »')
        d = json.loads(ls(page, 'ppl_v2'))
        R.check(len(d['history']) == n + 7, f'fusion : {n} + 7 séances')
        kept = {h['id']: h for h in d['history']}
        R.check(all(kept.get(h['id']) and kept[h['id']]['exercises'] == h['exercises'] for h in before['history']), 'fusion : séances existantes intactes')
        strip = lambda ex: {k: v for k, v in ex.items() if k not in ('pr', 'est1RM', 'lastWeight', 'lastReps')}
        same_prog = all([strip(e) for e in d['programmes']['ppl']['exercises'][c]] == [strip(e) for e in before['programmes']['ppl']['exercises'][c]] for c in before['programmes']['ppl']['exercises'])
        R.check(d['activeProgramme'] == before['activeProgramme'] and same_prog, 'fusion : programme PPL inchangé (hors PR recalculés)')
        squat_id = next(e['id'] for e in d['programmes']['ppl']['exercises']['legs'] if e['name'] == 'Squat barre')
        imported_squat = [e for h in d['history'] if h.get('programme') == 'u_hevy' for e in h['exercises'] if e['name'] == 'Squat barre']
        R.check(imported_squat and all(e['exId'] == squat_id for e in imported_squat), 'fusion : Squat barre importé partage l\'identifiant du programme PPL')
        R.check(not page.errors, f'fusion : aucune erreur JS {page.errors}')


def t_mesures_hevy(bench, eng, dev, theme):
    """Mesures Hevy (Export Measurements) : même bouton, aperçu propre, import dans les pesées et Progrès › Mesures,
    jour déjà noté gardé, Annuler, réimport sans doublon."""
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, None)
        skip_questions(page)
        t = tag(dev, theme)
        page.evaluate("""() => { const d = new Date(2026, 0, 19, 9).getTime();
            data.bodyWeightLog = [{ date: d, kg: 75 }]; data.bodyMeasures = { waist: [{ date: d, cm: 90 }] }; save(); render(); }""")
        open_import(page, csv_file('hevy_mesures_exemple.csv'))
        R.check(page.locator('.sheet__title').inner_text() == 'Mesures Hevy', f'{t} mesures : titre')
        lead = page.locator('#impSheet .imp__lead').inner_text()
        R.check(lead == '4 jours de mesures du 5 janv. au 1 mars 2026.', f'{t} mesures : « {lead} »')
        rw = rows(page)
        R.check(rw == {'Pesées à ajouter': '3', 'Mensurations à ajouter': '30', 'Déjà notées ce jour-là': '2', 'Valeurs ou lignes ignorées': '2'}, f'{t} mesures : aperçu {rw}')
        foot = page.locator('#impSheet').inner_text()
        R.check("Pas suivis dans l'app : masse grasse, avant-bras, abdomen." in foot and 'jamais sur nos serveurs' in foot, f'{t} mesures : colonnes ignorées nommées')
        small = page.evaluate("""[...document.querySelectorAll('.sheet-root button')].filter(b => { const r = b.getBoundingClientRect(); return r.width && r.height && (r.height < 44 || r.width < 44); }).map(b => b.className)""")
        R.check(not small, f'{t} mesures : boutons < 44 px {small}')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} mesures : pas de défilement horizontal')
        page.click('.sheet__btn--confirm')
        txt = toast_text(page)
        R.check(txt.startswith('Import réussi : 3 pesées, 30 mensurations') and 'Annuler' in txt, f'{t} mesures : toast « {txt} »')
        d = json.loads(ls(page, 'ppl_v2'))
        R.check([p['kg'] for p in d['bodyWeightLog']] == [73.1, 73.9, 75, 74.2] and d['bodyWeightKg'] == 73.1, f'{t} mesures : pesées {d.get("bodyWeightLog")}')
        R.check([p['cm'] for p in d['bodyMeasures']['waist']] == [82, 83, 90, 84] and len(d['bodyMeasures']) == 10, f'{t} mesures : mensurations {list(d["bodyMeasures"])}')
        R.check(d['history'] == [], f'{t} mesures : aucune séance créée')
        # Progrès › Mesures : valeurs importées affichées
        page.wait_for_timeout(300)
        page.evaluate("navigate('body-measures')")
        page.wait_for_selector('.view.body-measures')
        cell = page.locator('[data-action="open-body-measure"][data-key="waist"]').inner_text()
        R.check('82' in cell and '1 mars' in cell, f'{t} mesures : Taille dans Progrès « {cell} »')
        # Réimport : rien de plus
        page.evaluate("navigate('backup')")
        page.wait_for_selector('[data-action="import-other-app"]')
        with page.expect_file_chooser() as fc:
            page.click('[data-action="import-other-app"]')
        fc.value.set_files(files=[csv_file('hevy_mesures_exemple.csv')])
        page.wait_for_selector('.sheet-root:not(.sheet-root--out) .imp', timeout=5000)
        page.wait_for_timeout(400)
        rw = rows(page)
        R.check(rw.get('Pesées à ajouter') == '0' and rw.get('Mensurations à ajouter') == '0' and rw.get('Déjà notées ce jour-là') == '35', f'{t} réimport mesures : {rw}')
        page.click('.sheet__btn--confirm')
        txt = toast_text(page)
        R.check(txt.startswith('Rien à importer : ces mesures sont déjà notées'), f'{t} réimport mesures : « {txt} »')
        R.check(len(json.loads(ls(page, 'ppl_v2'))['bodyWeightLog']) == 4, f'{t} réimport mesures : toujours 4 pesées')
        R.check(not page.errors, f'{t} mesures : aucune erreur JS {page.errors}')


def t_mesures_annuler(bench):
    """Mesures Hevy : « Annuler » remet la donnée d'avant."""
    with bench.page('chromium', 'Pixel 7', 'light') as page:
        seed(page, 'light', None)
        skip_questions(page)
        open_import(page, csv_file('hevy_mesures_exemple.csv'))
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.toast__action', timeout=3000)
        page.locator('.toast__action').first.click()
        page.wait_for_timeout(400)
        d = json.loads(ls(page, 'ppl_v2'))
        R.check(not d.get('bodyWeightLog') and not d.get('bodyMeasures'), f'mesures : Annuler remet la donnée d\'avant {list(d.get("bodyMeasures") or {})}')
        R.check(not page.errors, f'mesures annuler : aucune erreur JS {page.errors}')


def t_capture_mesures(bench):
    """Captures iPhone 15 Pro, clair et sombre : aperçu de l'import des mesures Hevy."""
    for theme in ('light', 'dark'):
        with bench.page('webkit', 'iPhone 15 Pro', theme) as page:
            seed(page, theme, None)
            skip_questions(page)
            open_import(page, csv_file('hevy_mesures_exemple.csv'))
            shot(page, LOT, f'apercu-mesures-iPhone_15_Pro-{theme}')
            R.check(not page.errors, f'iPhone 15 Pro {theme} : aucune erreur JS {page.errors}')


def t_mesures_limite(bench):
    """Mesures Hevy : journal presque plein (400 par mesure), les valeurs déjà notées restent toutes, l'aperçu
    nomme celles du fichier qui n'entrent pas ; captures iPhone 15 Pro clair et sombre."""
    for theme in ('light', 'dark'):
        with bench.page('webkit', 'iPhone 15 Pro', theme) as page:
            seed(page, theme, None)
            skip_questions(page)
            # 398 tailles notées en 2019-2020 : 2 places libres pour les 4 tailles (plus récentes) du fichier
            page.evaluate("""() => { const s = new Date(2019, 0, 1, 12).getTime();
                data.bodyMeasures = { waist: Array.from({ length: 398 }, (_, i) => ({ date: s + i * 86400000, cm: 90 })) }; save(); render(); }""")
            open_import(page, csv_file('hevy_mesures_exemple.csv'))
            rw = rows(page)
            R.check(rw.get('Mensurations à ajouter') == '29' and rw.get('Pesées à ajouter') == '4', f'{theme} limite : aperçu {rw}')
            foot = page.locator('#impSheet').inner_text()
            R.check('2 mesures anciennes non importées : limite de 400 par mesure' in foot, f'{theme} limite : non importées nommées « {foot} »')
            R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{theme} limite : pas de défilement horizontal')
            shot(page, LOT, f'apercu-mesures-limite-iPhone_15_Pro-{theme}')
            page.click('.sheet__btn--confirm')
            page.wait_for_selector('.toast', timeout=3000)
            d = json.loads(ls(page, 'ppl_v2'))
            waist = d['bodyMeasures']['waist']
            R.check(len(waist) == 400 and sum(1 for p in waist if p['cm'] == 90) == 398, f'{theme} limite : les 398 tailles notées restent ({len(waist)})')
            R.check([p['cm'] for p in waist[:2]] == [82, 83], f'{theme} limite : les 2 plus récentes du fichier {waist[:2]}')
            R.check(not page.errors, f'{theme} limite : aucune erreur JS {page.errors}')


run_main(R, [t_hevy, t_strong, t_mesures_hevy], once=[t_merge_existing, t_mesures_annuler, t_mesures_limite, t_capture_mesures])
