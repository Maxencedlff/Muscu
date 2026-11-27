"""Importer un programme (docs/IMPORT_PROGRAMME.md) : Programme › Ajouter un programme › « Importer un programme »,
texte collé, écran « Vérifier l'import » (ligne source au-dessus, compris dessous, « À vérifier » et « Pas compris »
sans orange), correction d'un exercice d'un toucher, enregistrement, correction retenue au prochain import, PDF texte,
fiche d'un élève (coach). Captures en clair et en sombre."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'import_programme'
R = Results(LOT)

PLAN = """Programme PPL - Coach Sam

LUNDI - PUSH
- DC 4x8-10 2min
- DI haltères 3x10 1'30
- Élév lat 4x15 (dernière série en drop set)
- DC inc smith 3x12
A1) Curl haltères 3x12
A2) Ext triceps corde 3x12

Mercredi : repos

Jeudi - Legs
Squat 5x5 à 100 kg, 3 min de repos
RDL 4x8
Sissy squat 3x15
Mollets 4x15-20"""


def open_paste(page):
    page.evaluate("routeTo('prog-add')")
    page.wait_for_selector('.view.prog-add [data-action="plan-import"]')
    page.click('.view.prog-add [data-action="plan-import"]')
    page.wait_for_selector('#pimpText')
    settle(page)


def read_plan(page, text):
    page.fill('#pimpText', text)
    page.click('[data-action="pimp-read"]')
    page.wait_for_selector('.pimp-row')
    settle(page)


def check_layout(page, t, what):
    small = page.evaluate("""() => [...document.querySelectorAll('.view:not(.view--out) button')].filter(b => {
        const r = b.getBoundingClientRect(); return r.width && r.height && r.height < 43.5 && !b.closest('.navbar'); }).map(b => b.innerText.trim()).slice(0, 5)""")
    R.check(not small, f'{t} {what} : zones de toucher ≥ 44 pt {small}')
    R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} {what} : pas de défilement horizontal')


def t_import_texte(bench, eng, dev, theme):
    t = f'{dev}-{theme}'
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, None)
        skip_questions(page)
        open_paste(page)
        check_layout(page, t, 'texte à coller')
        shot(page, LOT, f'coller-{dev.replace(" ", "_")}-{theme}')
        read_plan(page, PLAN)
        lead = page.locator('.pimp-lead').inner_text()
        R.check('10 exercices compris' in lead, f'{t} résumé « {lead} »')
        labels = page.locator('.pimp-sess > span').all_inner_texts()
        R.check(labels == ['Lundi - Push', 'Jeudi - Legs'], f'{t} séances {labels} (repos ignoré)')
        rows = page.locator('.pimp-row .cell__title').all_inner_texts()
        R.check(rows[0] == 'Développé couché barre' and any('Soulevé de terre roumain' in r for r in rows), f'{t} exercices {rows}')
        R.check(page.locator('.pimp-row--unknown').count() >= 1, f'{t} « Sissy squat » pas compris : surligné')
        # Surlignage sobre : aucune couleur orange sur les lignes (réservée aux boutons)
        bg = page.evaluate("getComputedStyle(document.querySelector('.pimp-row--unknown')).backgroundColor")
        orange = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--orange').trim()")
        R.check(orange.lower() not in bg.lower() and 'rgb(255, 159' not in bg and 'rgb(255, 149' not in bg, f'{t} fond de « Pas compris » : {bg}, pas d\'orange')
        check_layout(page, t, 'vérifier')
        shot(page, LOT, f'verifier-{dev.replace(" ", "_")}-{theme}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_corriger_enregistrer(bench):
    """Une ligne corrigée d'un toucher, le programme enregistré, la correction reconnue au prochain import."""
    with bench.page('webkit', 'iPhone 13', 'light') as page:
        seed(page, 'light', None)
        skip_questions(page)
        open_paste(page)
        read_plan(page, PLAN)
        row = page.locator('.pimp-row', has_text='DC inc smith').first
        R.check(row.count() == 1, 'ligne « DC inc smith » présente')
        row.click()
        page.wait_for_selector('.ios-dialog')
        page.locator('.ios-dialog button', has_text='exercice').first.click()
        page.wait_for_selector('#pimpSearch')
        page.fill('#pimpSearch', 'développé incliné smith')
        page.locator('.imp-pick', has_text='Développé incliné smith').first.click()
        settle(page)
        title = page.locator('.pimp-row', has_text='DC inc smith').locator('.cell__title').inner_text()
        R.check(title == 'Développé incliné smith', f'exercice corrigé : {title}')
        page.click('[data-action="pimp-save"]')
        settle(page)
        d = json.loads(ls(page, 'ppl_v2'))
        pid = d['activeProgramme']
        prog = d['userProgrammes'].get(pid, {})
        R.check(prog.get('name') == 'Programme PPL - Coach Sam', f'programme enregistré et actif : {prog.get("name")}')
        ex = d['programmes'][pid]['exercises'][prog['order'][0]]
        R.check([e['name'] for e in ex][:3] == ['Développé couché barre', 'Développé incliné haltères', 'Élévations latérales'], f'exercices {[e["name"] for e in ex]}')
        R.check(ex[0]['sets'] == 4 and ex[0]['repMin'] == 8 and ex[0]['repMax'] == 10 and ex[0]['rest'] == 120, f'prescription {ex[0]}')
        R.check(ex[2].get('intens') == 'drop-last', f'drop set {ex[2]}')
        R.check(ex[4].get('ss') and ex[4].get('ss') == ex[5].get('ss'), 'superset A1/A2')
        R.check(d.get('planAliases') and 'Développé incliné smith' in d['planAliases'].values(), f'correction retenue {d.get("planAliases")}')
        R.check(page.locator('.view:not(.view--out)').first.count() == 1, 'page du programme ouverte')
        # Retour : plus d'écran d'import dans la pile
        R.check(page.evaluate("nav.stacks[nav.tab].every(r => !r.startsWith('plan-import'))"), 'écrans d\'import retirés de la pile')
        # Prochain import : la correction est reconnue d'office
        open_paste(page)
        read_plan(page, 'Push\nDC inc smith 4x10')
        R.check(page.locator('.pimp-row .cell__title').first.inner_text() == 'Développé incliné smith', 'correction reconnue au prochain import')
        R.check(page.locator('.pimp-row--check, .pimp-row--unknown').count() == 0, 'ligne apprise : sûre')
        R.check(not page.errors, f'aucune erreur JS {page.errors}')


def t_pdf(bench):
    """PDF texte (pdf.js embarqué) : tableau remis en colonnes, puis vérification."""
    pdf = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'donnees', 'programme_tableau.pdf')
    if not os.path.exists(pdf):
        R.check(False, f'PDF de test absent : {pdf}')
        return
    for eng, dev in (('chromium', 'Pixel 7'), ('webkit', 'iPhone 13')):
        with bench.page(eng, dev, 'dark') as page:
            seed(page, 'dark', None)
            skip_questions(page)
            open_paste(page)
            with page.expect_file_chooser() as fc:
                page.click('[data-action="pimp-file"]')
            with open(pdf, 'rb') as fh:
                fc.value.set_files(files=[{'name': 'programme.pdf', 'mimeType': 'application/pdf', 'buffer': fh.read()}])
            page.wait_for_selector('.pimp-row', timeout=20000)
            settle(page)
            rows = page.locator('.pimp-row .cell__title').all_inner_texts()
            subs = page.locator('.pimp-row .cell__sub.num').all_inner_texts()
            R.check(rows[:2] == ['Squat barre', 'Presse à cuisses'], f'{dev} PDF : exercices {rows}')
            R.check(subs and subs[0].startswith('5 × 5') and 'repos 3:00' in subs[0], f'{dev} PDF : prescription {subs[:2]}')
            R.check(not page.errors, f'{dev} PDF : aucune erreur JS {page.errors}')


run_main(R, [t_import_texte], once=[t_corriger_enregistrer, t_pdf])
