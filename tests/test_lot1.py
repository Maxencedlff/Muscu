"""Lot 1 : intégrité et robustesse des données (critères d'acceptation du plan)."""
import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from playwright.sync_api import sync_playwright

LOT = 1
R = Results(LOT)
APP_DIR = '/mnt/c/Users/maxde/ppl-training'


def tag(device, theme):
    return f'{device}-{theme}'


def toast_text(page, timeout=2500):
    try:
        page.wait_for_selector('.toast', timeout=timeout)
        return page.locator('.toast').inner_text()
    except Exception:
        return ''


def start(page, cat='push'):
    page.click(f'[data-action="start-session"][data-cat="{cat}"]')
    page.wait_for_selector('.view.session')


def skip_rest(page):
    if page.locator('.rest-overlay [data-action="skip-rest"]').count():
        page.click('.rest-overlay [data-action="skip-rest"]')
    elif page.locator('.rest-mini__skip').count():
        page.click('.rest-mini__skip')
    page.wait_for_timeout(100)


def active_inputs(page, ei=0):
    si = page.evaluate(f'activeSession.exercises[{ei}].sets.findIndex(s => !s.done)')
    w = page.locator(f'[data-action="set-weight"][data-ei="{ei}"][data-si="{si}"]')
    r = page.locator(f'[data-action="set-reps"][data-ei="{ei}"][data-si="{si}"]')
    v = page.locator(f'[data-action="validate-set"][data-ei="{ei}"][data-si="{si}"]')
    return si, w, r, v


def pr_of(page, cat, eid):
    return page.evaluate(f"(() => {{ const e = data.programmes.ppl.exercises['{cat}'].find(e => e.id === '{eid}'); return e.pr; }})()")


# ─────────────────────────────────────────────────────────────

def t_migration(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        raw = ppl_v2_today_json()
        seed(page, theme, raw)
        t = tag(dev, theme)
        R.check(page.locator('.view.dashboard').count() == 1, f'{t} migration : accueil affiché')
        info = page.evaluate("""() => ({ schema: data.schema, n: data.history.length,
            allIds: data.history.every(h => h.exercises.every(e => !!e.exId)),
            dips: data.history.flatMap(h => h.exercises).find(e => e.name === 'Dips')?.exId,
            curl: data.programmes.ppl.exercises.pull.find(e => e.id === 'l5curlma').pr,
            flag: '_prRecomputed' in data })""")
        R.check(info['schema'] == 3, f'{t} migration : schema 3')
        R.check(info['n'] == 30, f'{t} migration : nombre de séances conservé ({info["n"]})')
        R.check(info['allIds'], f'{t} migration : 100 % des exercices ont un exId')
        R.check(info['dips'] == 'n:dips', f'{t} migration : exercice hors programme -> n:dips ({info["dips"]})')
        R.check(info['curl'] and info['curl']['weight'] == '22', f'{t} migration : PR faussé recalculé ({info["curl"]})')
        R.check(not info['flag'], f'{t} migration : _prRecomputed retiré')
        R.check(ls(page, 'ppl_v2_backup') == raw, f'{t} migration : ppl_v2_backup identique octet pour octet')
        stored = json.loads(ls(page, 'ppl_v2'))
        R.check(stored.get('schema') == 3, f'{t} migration : schéma 3 persisté')
        # Idempotence : un 2e chargement ne touche ni la sauvegarde ni les exId
        ids1 = [e['exId'] for h in stored['history'] for e in h['exercises']]
        page.reload(); page.wait_for_selector('.view.dashboard')
        stored2 = json.loads(ls(page, 'ppl_v2'))
        ids2 = [e['exId'] for h in stored2['history'] for e in h['exercises']]
        R.check(ids1 == ids2 and ls(page, 'ppl_v2_backup') == raw, f'{t} migration idempotente')
        # Un ancien export se ré-importe sans perte
        page.click('[data-action="go-settings"]')
        shot(page, LOT, f'reglages-{t}')
        with page.expect_file_chooser() as fc:
            page.click('[data-action="import"]')
            tap_dialog(page, 'Choisir un fichier')
        fc.value.set_files(files=[{'name': 'old.json', 'mimeType': 'application/json', 'buffer': raw.encode()}])
        txt = toast_text(page)
        R.check('Import réussi : 30 séances' in txt, f'{t} ré-import ancien export : « {txt} »')
        R.check(page.evaluate('data.history.length') == 30, f'{t} ré-import : 30 séances')
        R.check(not page.errors, f'{t} migration : aucune erreur JS {page.errors}')
        page.click('[data-action="back"]')
        shot(page, LOT, f'accueil-{t}')


def t_session_pr(bench, eng, dev, theme):
    """Pré-remplissage, PR exact sans badge, 35×6 = Record charge, abandon sans toucher au PR."""
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        start(page)
        reps = page.evaluate("activeSession.exercises[0].sets.map(s => s.reps)")
        R.check([str(r) for r in reps] == ['10', '10', '9', '8'], f'{t} pré-remplissage série par série {reps}')
        prev = page.evaluate("activeSession.exercises[0].sets.map(s => s.prev && s.prev.reps)")
        R.check([str(r) for r in prev] == ['10', '10', '9', '8'], f'{t} prev conservé {prev}')
        si, w, r, v = active_inputs(page)
        R.check(w.input_value() == '32,5' and r.input_value() == '10', f'{t} champs pré-remplis 32,5 × 10')
        v.click(); page.wait_for_timeout(150)
        skip_rest(page)
        R.check(page.locator('.pr-badge').count() == 0, f'{t} refaire exactement le PR : aucun badge')
        R.check(page.evaluate("activeSession.exercises[0].sets[1].reps") in ('10', 10), f'{t} reps de la série 2 non écrasées')
        si, w, r, v = active_inputs(page)
        w.fill('35'); r.fill('6'); v.click(); page.wait_for_timeout(150)
        skip_rest(page)
        badge = page.locator('.pr-badge').all_inner_texts()
        R.check(badge == ['Record charge'], f'{t} 35×6 : badge « Record charge » {badge}')
        R.check(page.evaluate("activeSession.exercises[0].sets[2].weight") == '35', f'{t} charge modifiée recopiée sur la série suivante')
        R.check(page.evaluate("String(activeSession.exercises[0].sets[2].reps)") == '9', f'{t} reps prévues de la série suivante gardées')
        pr = pr_of(page, 'push', 'p1dcouch')
        R.check(pr == {'weight': '32.5', 'reps': '10'}, f'{t} PR inchangé pendant la séance {pr}')
        shot(page, LOT, f'seance-badge-{t}')
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(250)
        tap_dialog(page, 'Abandonner la séance')
        tap_dialog(page, 'Abandonner')
        stored = json.loads(ls(page, 'ppl_v2'))
        spr = next(e for e in stored['programmes']['ppl']['exercises']['push'] if e['id'] == 'p1dcouch')['pr']
        R.check(spr == {'weight': '32.5', 'reps': '10'}, f'{t} abandon : PR stocké inchangé {spr}')
        R.check(page.evaluate('activeSession') is None and ls(page, 'ppl_active_session') is None, f'{t} abandon : séance close')
        R.check(not page.errors, f'{t} séance : aucune erreur JS {page.errors}')


def t_fix_typo(bench, eng, dev, theme):
    """Valider 325, corriger en 32,5, terminer : PR juste."""
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        start(page)
        si, w, r, v = active_inputs(page)
        w.fill('325'); r.fill('11'); v.click(); page.wait_for_timeout(150)
        skip_rest(page)
        page.click('[data-action="edit-set"][data-ei="0"][data-si="0"]')
        page.fill('#editSetWeight', '32,5')
        shot(page, LOT, f'modifier-serie-{t}')
        page.click('[data-action="save-edit-set"]'); page.wait_for_timeout(150)
        R.check(page.evaluate("activeSession.exercises[0].sets[0].weight") == '32.5', f'{t} 32,5 accepté (virgule)')
        R.check(page.locator('.pr-badge').all_inner_texts() == ['Record reps'], f'{t} 32,5×11 : « Record reps »')
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(250)
        tap_dialog(page, 'Enregistrer la séance')
        txt = toast_text(page)
        R.check('Séance enregistrée' in txt, f'{t} séance enregistrée « {txt} »')
        pr = pr_of(page, 'push', 'p1dcouch')
        R.check(pr == {'weight': '32.5', 'reps': '11'}, f'{t} PR juste après correction {pr}')
        h = page.evaluate('data.history[0]')
        R.check(all(e.get('exId') for e in h['exercises']) and h['exercises'][0]['exId'] == 'p1dcouch', f'{t} séance enregistrée avec exId')
        R.check(page.evaluate('data.history.length') == 31, f'{t} 31 séances')


def t_bounds(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        start(page)
        si, w, r, v = active_inputs(page)
        r.fill('0'); v.click()
        txt = toast_text(page)
        R.check('Reps entre 1 et 100' in txt, f'{t} reps 0 refusées « {txt} »')
        R.check(r.get_attribute('aria-invalid') == 'true' and 'set-input--error' in (r.get_attribute('class') or ''), f'{t} reps 0 : champ signalé')
        shot(page, LOT, f'erreur-reps-{t}')
        R.check(not page.evaluate('activeSession.exercises[0].sets[0].done'), f'{t} reps 0 : série non validée')
        r.fill('10')
        R.check(r.get_attribute('aria-invalid') is None, f'{t} saisie corrigée : erreur retirée')
        w.fill('-40'); v.click()
        txt = toast_text(page)
        R.check('Poids entre 0 et 1000 kg' in txt, f'{t} poids -40 refusé « {txt} »')
        R.check(not page.evaluate('activeSession.exercises[0].sets[0].done'), f'{t} poids -40 : série non validée')
        r.fill('101'); w.fill('30'); v.click()
        R.check(not page.evaluate('activeSession.exercises[0].sets[0].done'), f'{t} reps 101 refusées')
        # Séance passée : date vide ou future refusée, valeurs vides avec placeholder
        page.click('[data-action="back"]')
        page.click('[data-action="go-history"]')
        page.click('[data-action="go-add-session"]')
        page.wait_for_selector('.view.add-session')
        save = page.locator('[data-action="save-past-session"]')
        R.check(save.is_disabled(), f'{t} séance passée : Enregistrer désactivé sans reps')
        first_w = page.locator('[data-action="add-weight"]').first
        first_r = page.locator('[data-action="add-reps"]').first
        R.check(first_w.input_value() == '' and first_w.get_attribute('placeholder') == '32,5', f'{t} séance passée : vide + placeholder 32,5')
        R.check(first_r.get_attribute('placeholder') == '10', f'{t} séance passée : placeholder reps 10')
        shot(page, LOT, f'seance-passee-{t}')
        page.click('[data-action="add-copy-prev"]')
        R.check(page.locator('[data-action="add-reps"]').first.input_value() == '10', f'{t} « Reprendre la dernière séance » recopie les valeurs')
        R.check(not save.is_disabled(), f'{t} Enregistrer actif après saisie')
        page.evaluate("document.getElementById('addDate').value = ''")
        save.click()
        txt = toast_text(page)
        R.check('Choisis une date' in txt, f'{t} date vide refusée « {txt} »')
        page.evaluate("document.getElementById('addDate').value = '2099-01-01'")
        page.click('[data-action="save-past-session"]')
        txt = toast_text(page)
        R.check('Choisis une date' in txt, f'{t} date future refusée « {txt} »')
        R.check(page.evaluate('data.history.length') == 30, f'{t} rien enregistré avec une date invalide')
        timer_before = page.evaluate("data.programmes.ppl.timers.push")
        page.evaluate("document.getElementById('addDate').value = new Date(Date.now() - 40*86400000).toISOString().slice(0,10)")
        page.click('[data-action="save-past-session"]')
        txt = toast_text(page)
        R.check('Séance ajoutée' in txt, f'{t} séance passée ajoutée « {txt} »')
        R.check(page.evaluate("data.programmes.ppl.timers.push") == timer_before, f'{t} séance ancienne : délai de récupération inchangé')
        # Modifier une séance d'un autre programme (Perso)
        # Fusion : on passe par le détail de la séance (lot 5)
        page.locator('.view.history [data-action="open-history"][data-id="hcs02"]').click()
        page.wait_for_selector('.view.history-detail')
        page.locator('[data-action="edit-session"][data-id="hcs02"]').click()
        page.wait_for_selector('.view.add-session')
        R.check('Modifier la séance' in page.locator('.navbar__title').inner_text(), f'{t} séance Perso modifiable depuis PPL')
        shot(page, LOT, f'modifier-perso-{t}')
        page.click('[data-action="save-past-session"]')
        txt = toast_text(page)
        R.check('Séance modifiée' in txt, f'{t} toast « Séance modifiée » « {txt} »')
        h = page.evaluate("data.history.find(h => h.id === 'hcs02')")
        R.check(h['programme'] == 'custom' and len(h['exercises']) == 2 and all(e.get('exId') for e in h['exercises']), f'{t} séance Perso gardée dans son programme')
        R.check(not page.errors, f'{t} bornes : aucune erreur JS {page.errors}')


def t_rename(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        accept = theme == 'light'
        page.click('[data-action="go-editor"]')
        page.click('[data-action="edit-ex"][data-i="0"]')
        page.fill('#exName', 'DC haltères')  # Fusion : écran Programme › Exercice (lot 5)
        page.click('[data-action="save-ex"]'); page.wait_for_timeout(250)
        msg = page.locator('.ios-dialog__msg').inner_text()
        R.check('9 séances contiennent cet exercice' in msg, f'{t} renommage : « {msg} »')
        shot(page, LOT, f'renommer-{t}')
        tap_dialog(page, 'Renommer partout' if accept else 'Annuler')
        names = page.evaluate("[...new Set(data.history.flatMap(h => h.exercises).filter(e => e.exId === 'p1dcouch').map(e => e.name))]")
        R.check(names == (['DC haltères'] if accept else ['Développé couché haltères']), f'{t} historique renommé={accept} {names}')
        # Fusion : Progrès › Exercice (lot 5) remplace les cartes de statistiques
        page.click('.tabbar [data-tab="progress"]')
        page.click('[data-action="open-stats-ex"][data-ex="p1dcouch"]')
        page.wait_for_selector('#exChart canvas')
        txt = page.locator('.view.stats-ex').inner_text()
        R.check(('DC haltères' if accept else 'Développé couché haltères') in txt, f'{t} statistiques : courbe conservée après renommage')
        shot(page, LOT, f'stats-renomme-{t}')
        # Démarrer la séance : pré-remplissage toujours lié par exId
        page.click('.tabbar [data-tab="train"]'); page.wait_for_timeout(200)
        page.click('.tabbar [data-tab="train"]')  # onglet actif touché : retour à l'accueil
        start(page)
        R.check(page.evaluate("activeSession.exercises[0].sets.map(s => String(s.reps)).join('/')") == '10/10/9/8', f'{t} pré-remplissage conservé après renommage')


def t_import_bad(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        raw = ppl_v2_today_json()
        seed(page, theme, raw)
        t = tag(dev, theme)
        before = ls(page, 'ppl_v2')
        bad = '{"activeProgramme":"ppl","programmes":{},"history":[{"id":"x","date":1,"category":"push"}]}'
        page.click('[data-action="go-settings"]')
        with page.expect_file_chooser() as fc:
            page.click('[data-action="import"]')
            tap_dialog(page, 'Choisir un fichier')
        fc.value.set_files(files=[{'name': 'bad.json', 'mimeType': 'application/json', 'buffer': bad.encode()}])
        txt = toast_text(page)
        R.check('Fichier invalide' in txt, f'{t} import corrompu : toast d\'erreur « {txt} »')
        shot(page, LOT, f'import-invalide-{t}')
        R.check(ls(page, 'ppl_v2') == before and page.evaluate('data.history.length') == 30, f'{t} import corrompu : données intactes')
        page.click('[data-action="setting-sound"]')  # une écriture après l'échec
        page.reload(); page.wait_for_selector('#app > *')
        R.check(page.locator('.view.dashboard').count() == 1 and page.locator('.rescue').count() == 0, f'{t} import corrompu : pas d\'écran noir au relancement')
        R.check(page.evaluate('data.history.length') == 30, f'{t} import corrompu : 30 séances après relance')
        # Import valide puis « Annuler » : la donnée d'avant revient
        small = ppl_v2_today(); small['history'] = small['history'][:5]
        page.click('[data-action="go-settings"]')
        with page.expect_file_chooser() as fc:
            page.click('[data-action="import"]')
            tap_dialog(page, 'Choisir un fichier')
        fc.value.set_files(files=[{'name': 'ok.json', 'mimeType': 'application/json', 'buffer': json.dumps(small).encode()}])
        txt = toast_text(page)
        R.check('Import réussi : 5 séances' in txt and page.locator('.toast__action').count() == 1, f'{t} import valide « {txt} »')
        shot(page, LOT, f'import-annuler-{t}')
        R.check(json.loads(ls(page, 'ppl_v2_backup'))['history'].__len__() == 30, f'{t} import : copie de sauvegarde faite')
        page.click('.toast__action')
        R.check(page.evaluate('data.history.length') == 30 and len(json.loads(ls(page, 'ppl_v2'))['history']) == 30, f'{t} « Annuler » restaure les données')


def t_storage_full(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        start(page)
        si, w, r, v = active_inputs(page)
        v.click(); page.wait_for_timeout(150)
        skip_rest(page)
        filled = page.evaluate("""() => {
            let chunk = 'x'.repeat(1 << 20), i = 0, total = 0;
            while (chunk.length >= 1) {
                try { localStorage.setItem('fill_' + (i++), chunk); total += chunk.length; }
                catch { chunk = chunk.slice(0, chunk.length >> 1); }
            }
            return total;
        }""")
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(250)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_timeout(200)
        title = page.locator('.ios-dialog__title').all_inner_texts()
        R.check('Espace de stockage plein' in title, f'{t} stockage plein : dialogue affiché {title} ({filled} car.)')
        R.check('Exporte tes données pour ne pas perdre cette séance.' in page.locator('.ios-dialog__msg').inner_text(), f'{t} stockage plein : message')
        shot(page, LOT, f'stockage-plein-{t}')
        tap_dialog(page, 'Plus tard')
        R.check('Séance enregistrée' not in (page.locator('.toast').all_inner_texts() or [''])[0] if page.locator('.toast').count() else True, f'{t} stockage plein : pas de « Séance enregistrée ! »')
        R.check(page.evaluate('activeSession !== null') and page.locator('.view.session').count() == 1, f'{t} stockage plein : séance toujours active')
        R.check(page.evaluate('data.history.length') == 30, f'{t} stockage plein : pas d\'entrée fantôme')
        # Place libérée : la séance s'enregistre normalement
        page.evaluate("Object.keys(localStorage).filter(k => k.startsWith('fill_')).forEach(k => localStorage.removeItem(k))")
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(250)
        tap_dialog(page, 'Enregistrer la séance')
        R.check('Séance enregistrée' in toast_text(page) and page.evaluate('data.history.length') == 31, f'{t} après libération : séance enregistrée une seule fois')


def t_old_session(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json(), active=old_active_session())
        t = tag(dev, theme)
        R.check(page.locator('.view.session').count() == 1, f'{t} ancienne séance restaurée')
        info = page.evaluate("({ b: !!activeSession.baseline.l1rowing, prev: activeSession.exercises[0].sets.every(s => 'prev' in s), notes: sessionNotes })")
        R.check(info['b'] and info['prev'] and info['notes'] == 'Bonne forme', f'{t} ancienne séance complétée {info}')
        shot(page, LOT, f'ancienne-seance-{t}')
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(250)
        tap_dialog(page, 'Enregistrer la séance')
        R.check('Séance enregistrée' in toast_text(page), f'{t} ancienne séance terminée')
        h = page.evaluate('data.history[0]')
        ids = {e['name']: e['exId'] for e in h['exercises']}
        R.check(h['category'] == 'pull' and ids.get('Rowing haltère unilatéral') == 'l1rowing' and ids.get('Shrugs') == 'n:shrugs', f'{t} ancienne séance : exId {ids}')
        R.check(not page.errors, f'{t} ancienne séance : aucune erreur JS {page.errors}')


def t_rest_drift(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        start(page)
        si, w, r, v = active_inputs(page)
        v.click(); page.wait_for_timeout(200)
        end0 = page.evaluate('restEndTime')
        for i in range(10):
            page.evaluate("""() => {
                const set = s => { Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
                                    document.dispatchEvent(new Event('visibilitychange')); };
                set('hidden'); set('visible');
            }""")
            page.wait_for_timeout(120)
        end1 = page.evaluate('restEndTime')
        saved = json.loads(ls(page, 'ppl_active_session'))['rest']['endTime']
        R.check(abs(end1 - end0) < 1000 and saved == end1, f'{t} 10 allers-retours : dérive {end1 - end0} ms')
        shot(page, LOT, f'repos-{t}')
    with bench.page(eng, dev, theme) as page:
        a = old_active_session(with_rest=True)
        seed(page, theme, ppl_v2_today_json(), active=a)
        R.check(page.evaluate('restEndTime') == a['rest']['endTime'] and page.locator('.rest-mini').count() == 1, f'{tag(dev, theme)} restauration : heure de fin du repos exacte')


def t_rescue(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        good = ppl_v2_today_json()
        seed(page, theme, '{"programmes": [cassé', extra={'ppl_v2_backup': good})
        t = tag(dev, theme)
        R.check(page.locator('.rescue').count() == 1, f'{t} écran de secours affiché')
        btns = page.locator('.rescue button').all_inner_texts()
        R.check(btns == ['Restaurer la sauvegarde précédente', 'Exporter les données brutes', 'Réinitialiser'], f'{t} secours : boutons {btns}')
        R.check(ls(page, 'ppl_v2') == '{"programmes": [cassé', f'{t} secours : donnée brute non écrasée')
        shot(page, LOT, f'secours-{t}')
        with page.expect_download() as dl:
            page.click('#rescueExport')
        R.check(dl.value.suggested_filename.startswith('muscu-donnees-brutes'), f'{t} secours : export brut')
        page.click('#rescueRestore')
        page.wait_for_selector('.view.dashboard')
        R.check(page.evaluate('data.history.length') == 30, f'{t} secours : sauvegarde restaurée')


def t_custom_delete(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        d = ppl_v2_today(); d['activeProgramme'] = 'custom'
        seed(page, theme, json.dumps(d, ensure_ascii=False))
        t = tag(dev, theme)
        start(page, CUSTOM_ID)
        page.click('[data-action="back"]')
        page.click('[data-action="go-programmes"]')
        # Fusion : Programme › Séance (lot 5) porte la ligne « Nom, icône et couleur »
        page.click(f'[data-action="open-prog-session"][data-cat="{CUSTOM_ID}"]')
        page.click(f'[data-action="edit-custom-session"][data-id="{CUSTOM_ID}"]')
        page.click('[data-action="delete-custom-session"]'); page.wait_for_timeout(250)
        R.check(page.locator('.ios-dialog__title').inner_text() == 'Cette séance est en cours', f'{t} suppression Perso : séance en cours signalée')
        tap_dialog(page, 'Supprimer')
        msg = page.locator('.ios-dialog__msg').inner_text()
        R.check('3 séances de l\'historique seront effacées' in msg, f'{t} suppression Perso : « {msg} »')
        shot(page, LOT, f'suppr-perso-{t}')
        tap_dialog(page, 'Supprimer')
        R.check(page.evaluate('activeSession') is None and ls(page, 'ppl_active_session') is None, f'{t} suppression Perso : séance abandonnée')
        R.check(page.evaluate("data.history.filter(h => h.programme === 'custom').length") == 0, f'{t} suppression Perso : historique effacé')
        page.go_back()  # bouton retour Android : ne doit rien casser
        page.wait_for_timeout(300)
        if page.url != BASE_URL:
            page.go_forward()
        page.wait_for_selector('#app > *')
        R.check(page.evaluate("data.history.length") == 27 and page.evaluate("activeSession") is None,
                f'{t} retour système : app et données intactes')
        R.check(not page.errors, f'{t} suppression Perso : aucune erreur JS {page.errors}')


def t_service_worker(bench):
    """Cache d'abord + bannière de mise à jour, sur une copie servie à part (sw autorisé)."""
    tmp = os.path.join(SCRATCH, 'sw-copy')
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(APP_DIR, tmp, ignore=shutil.ignore_patterns('.git', '*.txt'))
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8742'], cwd=tmp, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    url = 'http://localhost:8742/'
    try:
        for eng, dev in (('chromium', 'Pixel 7'), ('webkit', 'iPhone 13')):
            for theme in THEMES:
                t = tag(dev, theme)
                with bench.page(eng, dev, theme, service_workers='allow') as page:
                    seed(page, theme, ppl_v2_today_json(), url=url)
                    page.evaluate("navigator.serviceWorker.ready")
                    page.reload(); page.wait_for_selector('.view.dashboard')
                    ctrl = page.evaluate("!!navigator.serviceWorker.controller")
                    R.check(ctrl, f'{t} SW : page contrôlée')
                    if eng == 'chromium':  # WebKit de Playwright ne gère pas le mode hors ligne avec un SW
                        page.context.set_offline(True)
                        page.reload(); page.wait_for_selector('.view.dashboard', timeout=5000)
                        R.check(page.locator('.view.dashboard').count() == 1, f'{t} SW : ouverture hors ligne')
                        page.context.set_offline(False)
                    else:
                        # Sans réseau vers le serveur : la coquille vient du cache
                        src = page.evaluate("caches.keys().then(k => Promise.all(k.map(n => caches.open(n).then(c => c.keys())))).then(a => a.flat().length)")
                        R.check(src >= 9, f'{t} SW : coquille en cache ({src} fichiers)')
                    page.click('[data-action="go-settings"]')
                    page.click('[data-action="force-update"]')
                    txt = toast_text(page, 5000)
                    R.check('Tu as la dernière version' in txt, f'{t} SW : « {txt} »')
                    # Nouvelle version publiée
                    sw = open(os.path.join(tmp, 'sw.js'), encoding='utf-8').read()
                    open(os.path.join(tmp, 'sw.js'), 'w', encoding='utf-8').write(sw.replace("const CACHE = '", "const CACHE = 't" + str(int(time.time())) + "-"))
                    page.evaluate("swReg.update()")
                    try:
                        page.wait_for_selector('.update-banner', timeout=8000)
                    except Exception:
                        pass
                    R.check(page.locator('.update-banner').count() == 1, f'{t} SW : bannière « Nouvelle version disponible »')
                    shot(page, LOT, f'maj-{t}')
                    page.click('.update-banner__btn')
                    page.wait_for_selector('.view.dashboard', timeout=8000)
                    page.wait_for_timeout(500)
                    R.check(page.locator('.update-banner').count() == 0, f'{t} SW : mise à jour appliquée')
                with bench.page(eng, dev, theme, service_workers='allow') as page:
                    # Pendant une séance : pas de bannière
                    seed(page, theme, ppl_v2_today_json(), url=url)
                    page.evaluate("navigator.serviceWorker.ready")
                    page.reload(); page.wait_for_selector('.view.dashboard')
                    start(page)
                    sw = open(os.path.join(tmp, 'sw.js'), encoding='utf-8').read()
                    open(os.path.join(tmp, 'sw.js'), 'w', encoding='utf-8').write(sw.replace("const CACHE = '", "const CACHE = 's"))
                    page.evaluate("swReg.update()")
                    page.wait_for_timeout(2500)
                    R.check(page.locator('.update-banner').count() == 0, f'{t} SW : aucune bannière pendant la séance')
    finally:
        srv.terminate()
        shutil.rmtree(tmp, ignore_errors=True)


TESTS = [t_migration, t_session_pr, t_fix_typo, t_bounds, t_rename, t_import_bad,
         t_storage_full, t_old_session, t_rest_drift, t_rescue, t_custom_delete]

if __name__ == '__main__':
    run_main(R, TESTS, once=[t_service_worker])
