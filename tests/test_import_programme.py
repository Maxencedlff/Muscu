"""Importer un programme (docs/IMPORT_PROGRAMME.md) : Programme › Ajouter un programme › « Importer un programme »,
texte collé, écran « Vérifier l'import » (ligne source au-dessus, compris dessous, « À vérifier » et « Pas compris »
sans orange), correction d'un exercice d'un toucher, enregistrement, correction retenue au prochain import, PDF texte,
fiche d'un élève (coach). Captures en clair et en sombre."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_plan_reader import FAKE_PLAN_READER
from fake_account import FAKE_ACCOUNT

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


# Modules natifs simulés (tests/fake_plan_reader.py) : le vrai pont js/platform/plan-reader.js les lit, comme sur l'iPhone
def _w(text, x, y):
    return {'text': text, 'box': {'x': x, 'y': y, 'w': len(text) * 0.012, 'h': 0.02}}


NOISY_PAGE = {'width': 1000, 'height': 1400, 'text': '', 'lines': [
    {'text': 'Lundi - Pecs', 'confidence': 0.9, 'box': {'x': 0.05, 'y': 0.05, 'w': 0.2, 'h': 0.02}, 'words': []},
    {'text': 'Dévelopé couche 4x1O', 'confidence': 0.8, 'box': {'x': 0.05, 'y': 0.1, 'w': 0.4, 'h': 0.02},
     'words': [_w('Dévelopé', 0.05, 0.1), _w('couche', 0.16, 0.1), _w('4x1O', 0.3, 0.1)]},
    {'text': 'Ecarté poulie 3x15 repos 1min', 'confidence': 0.8, 'box': {'x': 0.05, 'y': 0.14, 'w': 0.5, 'h': 0.02}, 'words': []}]}
BLANK_PAGE = {'width': 1000, 'height': 1400, 'text': '', 'lines': []}


def open_native(bench, theme, opts):
    """Page de l'app iOS simulée, modules de lecture et de dictée présents (réglages __pr de fake_plan_reader.py)."""
    ctx = bench.page('webkit', 'iPhone 13', theme)
    page = ctx.__enter__()
    page.add_init_script('window.__pr = %s;' % json.dumps(opts, ensure_ascii=False))
    page.add_init_script(FAKE_PLAN_READER)
    page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
    seed(page, theme, None)
    skip_questions(page)
    open_paste(page)
    return ctx, page


def dictate_steps(page, n_confirm):
    """Dicter › Pas à pas, puis n_confirm fois « Suivant »."""
    page.click('[data-action="pimp-dictate"]')
    page.wait_for_selector('.ios-dialog')
    page.locator('.ios-dialog button', has_text='Pas à pas').click()
    page.wait_for_selector('#pimpDict')
    settle(page)
    for _ in range(n_confirm):
        page.click('.sheet-root:not(.sheet-root--out) .sheet__btn--confirm')
        settle(page)


def t_photo_dictee(bench):
    """Avec les modules de l'iPhone : « Photo », « Scanner » et « Dicter » en haut ; scan de deux pages avec « Page N
    sur M » ; photo bruitée comprise ; dictée pas à pas (réponse vide redemandée, Annuler abandonne tout).
    Sans module (navigateur) : seulement Coller et Choisir un fichier."""
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        seed(page, 'dark', None)
        skip_questions(page)
        open_paste(page)
        R.check(page.locator('[data-action="pimp-photo"], [data-action="pimp-dictate"]').count() == 0, 'sans module : ni Photo ni Dicter')
    for theme in ('dark', 'light'):
        opts = {'pages': [NOISY_PAGE, BLANK_PAGE], 'pageDelay': 500,
                'dictation': {'onDevice': True, 'speech': 'authorized', 'microphone': 'authorized', 'partials': ['développé'],
                              'final': '', 'finals': ['développé couché', '4 séries de 8 repos 2 minutes']}}
        ctx, page = open_native(bench, theme, opts)
        try:
            page.wait_for_selector('[data-action="pimp-dictate"]')
            settle(page)
            acts = [page.locator(f'[data-action="{a}"]').count() for a in ('pimp-photo', 'pimp-scan', 'pimp-dictate', 'pimp-file')]
            R.check(acts == [1, 1, 1, 1], f'{theme} module : Photo, Scanner, Dicter, Fichier {acts}')
            # Photo, Scanner et Dicter en haut, au-dessus de la zone de texte, visibles sans défiler (audit m7)
            tops = page.evaluate("""() => ['pimp-photo', 'pimp-scan', 'pimp-dictate'].map(a => document.querySelector(`[data-action="${a}"]`).getBoundingClientRect().bottom)
                .concat([document.querySelector('#pimpText').getBoundingClientRect().top, innerHeight])""")
            R.check(max(tops[:3]) <= tops[3] and max(tops[:3]) <= tops[4], f'{theme} Photo, Scanner, Dicter au-dessus du texte et à l\'écran {tops}')
            foot = page.locator('.view:not(.view--out) .group-foot').last.inner_text()
            R.check('sans être envoyés' in foot and 'corrections' in foot, f'{theme} ce qui part, dit en clair : « {foot} »')
            check_layout(page, theme, 'texte à coller, module')
            shot(page, LOT, f'coller-module-iPhone_13-{theme}')
            page.click('[data-action="pimp-scan"]')
            page.wait_for_function("document.querySelector('#pimpProgress')?.textContent === 'Page 1 sur 2'", timeout=5000)
            if theme == 'dark':
                shot(page, LOT, 'lecture-pages-iPhone_13-dark')
            page.wait_for_selector('.pimp-row')
            settle(page)
            R.check(page.evaluate('__pr.progress') == [[0, 2], [1, 2], [2, 2]], f'{theme} scan : progression {page.evaluate("__pr.progress")}')
            R.check(page.locator('.sheet-root:not(.sheet-root--out)').count() == 0, f'{theme} scan : feuille de lecture fermée')
            rows = page.locator('.pimp-row .cell__title').all_inner_texts()
            subs = page.locator('.pimp-row .cell__sub.num').all_inner_texts()
            R.check(rows == ['Développé couché barre', 'Écarté poulie vis-à-vis'], f'{theme} scan bruité : {rows}')
            R.check(subs[:1] == ['4 × 10'], f'{theme} scan : « 4x1O » lu 4 × 10 {subs}')
            pick = [c for c in page.evaluate('__pr.calls') if c[1] == 'pick'][-1][2]
            R.check(pick['source'] == 'scan' and len(pick['customWords']) > 100, 'scan : vocabulaire de la bibliothèque donné à Vision')
            if theme == 'dark':
                # Annuler pendant la lecture : cancelRead, aucun écran Vérifier
                page.click('[data-action="pimp-edit-text"]')
                page.wait_for_selector('[data-action="pimp-scan"]')
                page.click('[data-action="pimp-scan"]')
                page.wait_for_function("document.querySelector('#pimpProgress')?.textContent === 'Page 1 sur 2'", timeout=5000)
                page.click('.sheet-root:not(.sheet-root--out) .sheet__btn--cancel')
                page.wait_for_timeout(1300)
                R.check(any(c[1] == 'cancelRead' for c in page.evaluate('__pr.calls')) and page.locator('#pimpText').count() == 1,
                        'scan : Annuler arrête la lecture')
                # Dictée pas à pas : exercice puis séries
                dictate_steps(page, 0)
                R.check(page.locator('.sheet-root:not(.sheet-root--out) .sheet__title').inner_text() == 'Quel exercice ?', 'dictée guidée : 1re question')
                shot(page, LOT, 'dictee-guidee-iPhone_13-dark')
                page.click('.sheet-root:not(.sheet-root--out) .sheet__btn--confirm')
                page.locator('.sheet-root:not(.sheet-root--out) .sheet__title', has_text='Combien de séries').wait_for()
                page.click('.sheet-root:not(.sheet-root--out) .sheet__btn--confirm')
                page.locator('.sheet-root:not(.sheet-root--out) [data-action="pimp-dict-end"]').wait_for()
                page.click('.sheet-root:not(.sheet-root--out) [data-action="pimp-dict-end"]')
                page.wait_for_selector('.pimp-row')
                settle(page)
                rows = page.locator('.pimp-row .cell__title').all_inner_texts()
                subs = page.locator('.pimp-row .cell__sub.num').all_inner_texts()
                R.check(rows == ['Développé couché barre'] and subs[:1] == ['4 × 8 · repos 2:00'], f'dictée guidée : {rows} {subs}')
                # Réponse vide : la même question revient, rien ne se décale
                page.evaluate("__pr.dictation.finals = ['', 'tirage vertical', '3 séries de 12']")
                page.click('[data-action="pimp-edit-text"]')
                page.wait_for_selector('[data-action="pimp-dictate"]')
                dictate_steps(page, 1)
                R.check(page.locator('.sheet-root:not(.sheet-root--out) .sheet__title').inner_text() == 'Quel exercice ?', 'dictée : réponse vide, même question')
                page.click('.sheet-root:not(.sheet-root--out) .sheet__btn--confirm')
                page.locator('.sheet-root:not(.sheet-root--out) .sheet__title', has_text='Combien de séries').wait_for()
                page.click('.sheet-root:not(.sheet-root--out) .sheet__btn--confirm')
                page.locator('.sheet-root:not(.sheet-root--out) [data-action="pimp-dict-end"]').wait_for()
                page.click('.sheet-root:not(.sheet-root--out) [data-action="pimp-dict-end"]')
                page.wait_for_selector('.pimp-row')
                settle(page)
                rows = page.locator('.pimp-row .cell__title').all_inner_texts()
                subs = page.locator('.pimp-row .cell__sub.num').all_inner_texts()
                R.check(rows == ['Tirage vertical prise large'] and subs[:1] == ['3 × 12'], f'dictée après réponse vide : {rows} {subs}')
                # Annuler : toute la dictée est abandonnée, l'écran ne change pas
                page.evaluate("__pr.dictation.finals = ['squat', '5 séries de 5']")
                page.click('[data-action="pimp-edit-text"]')
                page.wait_for_selector('[data-action="pimp-dictate"]')
                dictate_steps(page, 1)
                page.locator('.sheet-root:not(.sheet-root--out) .sheet__title', has_text='Combien de séries').wait_for()
                page.click('.sheet-root:not(.sheet-root--out) .sheet__btn--cancel')
                settle(page)
                R.check(page.locator('#pimpText').count() == 1 and page.locator('.pimp-row').count() == 0, 'dictée : Annuler abandonne tout')
            R.check(not page.errors, f'{theme} module : aucune erreur JS {page.errors}')
        finally:
            ctx.__exit__(None, None, None)


def t_limites_reglages(bench):
    """Texte trop long : « Programme incomplet » dit à l'écran ; matériel changé = à vérifier ; Réglages › Corrections
    retenues liste et oublie (pierre tombale) ; dictée sans reconnaissance hors ligne : Dicter n'est pas proposé."""
    with bench.page('webkit', 'iPhone 13', 'light') as page:
        seed(page, 'light', None)
        skip_questions(page)
        open_paste(page)
        long_plan = 'Push\n' + '\n'.join(f'Squat {i % 5 + 1}x5 repos 2 min, note du coach {i}' for i in range(700))
        read_plan(page, long_plan)
        cut = page.locator('.pimp-cut').inner_text() if page.locator('.pimp-cut').count() else ''
        R.check('Programme incomplet' in cut and '20' in cut, f'texte trop long dit : « {cut} »')
        page.click('[data-action="pimp-edit-text"]')
        read_plan(page, 'Pull\nTirage horizontal machine 3x10\nWeighted dips 3x8')
        R.check(page.locator('.pimp-row--check', has_text='Tirage horizontal').count() == 1, 'matériel changé : à vérifier')
        subs = page.locator('.pimp-row', has_text='Weighted dips').locator('.cell__sub.num').inner_text()
        R.check('lesté' in subs, f'lest gardé : {subs}')
        shot(page, LOT, 'verifier-materiel-iPhone_13-light')
        page.evaluate("planLearnAlias('DC inc', 'Développé incliné barre'); planLearnAlias('tirage machine assis', 'Rowing machine'); save()")
        page.evaluate("routeTo('settings')")
        page.wait_for_selector('[data-action="go-plan-aliases"]')
        page.click('[data-action="go-plan-aliases"]')
        page.wait_for_selector('[data-action="pimp-alias"]')
        settle(page)
        R.check(page.locator('[data-action="pimp-alias"]').count() == 2, 'Corrections retenues : 2 lignes')
        check_layout(page, 'réglages', 'corrections retenues')
        shot(page, LOT, 'corrections-retenues-iPhone_13-light')
        page.locator('[data-action="pimp-alias"]').first.click()
        page.locator('.ios-dialog button', has_text='Oublier cette correction').click()
        settle(page)
        d = json.loads(ls(page, 'ppl_v2'))
        R.check(len(d.get('planAliases', {})) == 1 and len(d.get('planAliasesAt', {})) == 2, f'oubliée, pierre tombale datée {d.get("planAliasesAt")}')
        R.check(not page.errors, f'limites et réglages : aucune erreur JS {page.errors}')
    ctx, page = open_native(bench, 'dark', {'dictation': {'onDevice': False, 'speech': 'authorized', 'microphone': 'authorized', 'partials': [], 'final': ''}})
    try:
        page.wait_for_selector('[data-action="pimp-photo"]')
        page.wait_for_timeout(400)
        R.check(page.locator('[data-action="pimp-dictate"]').count() == 0, 'sans dictée hors ligne : Dicter absent')
        R.check(not page.errors, f'hors ligne : aucune erreur JS {page.errors}')
    finally:
        ctx.__exit__(None, None, None)


# ── Aide de l'IA (docs/IMPORT_IA.md) : fausse fonction plan-import-ai, jamais d'appel à Anthropic ──
DOUBT = """Lundi - Push
Développé couché 4x8
Zorglub 3x12
Squat 5x5"""
FAKE_AI = """window.__aiCalls = [];
window.__aiMode = 'ok';
window.__fakePlanAi = async (body, fail) => {
  window.__aiCalls.push(JSON.parse(JSON.stringify(body)));
  await new Promise(r => setTimeout(r, 400));
  if (window.__aiMode === 'quota') return fail(429, { error: 'quota_user' });
  if (window.__aiMode === 'budget') return fail(503, { error: 'quota_global' });
  return { data: { ok: true, mode: 'lines', results: body.targets.map((t, i) => /Zorglub/.test(t.text)
    ? { i, name: 'Curl barre', presc: { sets: 3, repMin: 12, repMax: 12 }, confidence: 'sure', level: 'sure', why: [] }
    : { i, name: null, presc: {}, confidence: 'unreadable', level: 'unknown', why: ['illisible'] }),
    usage: { calls: [], cached: 0, escalated: 0, usd: 0 } }, error: null };
};"""


def open_signed(bench, theme, signed=True):
    ctx = bench.page('webkit', 'iPhone 13', theme)
    page = ctx.__enter__()
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
    page.add_init_script(FAKE_ACCOUNT)
    page.add_init_script(FAKE_AI)
    page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
    seed(page, theme, None, extra={'ppl_welcome_seen': '1'})
    settle(page)
    skip_questions(page)
    if signed:
        page.evaluate("async () => { await accountSignInWith('apple', async () => 'add'); }")
        settle(page)
    open_paste(page)
    return ctx, page


def toast_text(page):
    page.wait_for_selector('.toast', timeout=5000)
    return page.locator('.toast').last.inner_text()


def t_aide_ia(bench):
    """Le moteur hésite : bouton plein « Lire avec l'aide de l'IA » ; accord explicite (Anthropic nommé) ; seules les
    lignes douteuses partent, sans nom ; chargement, puis l'écran Vérifier corrigé ; quota et plafond : message clair,
    le résultat du moteur reste ; plan sûr : simple lien neutre ; sans compte : connexion demandée. Clair et sombre."""
    for theme in ('light', 'dark'):
        ctx, page = open_signed(bench, theme)
        try:
            read_plan(page, DOUBT)
            ai = page.locator('[data-action="pimp-ai"].btn--primary')
            R.check(ai.count() == 1, f'{theme} moteur hésitant : bouton plein proposé')
            R.check(page.locator('[data-action="pimp-save"].btn--secondary').count() == 1, f'{theme} un seul bouton plein : Enregistrer passe en gris')
            check_layout(page, theme, 'aide de l\'IA proposée')
            shot(page, LOT, f'ia-proposee-iPhone_13-{theme}')
            ai.click()
            page.wait_for_selector('.ios-dialog')
            sheet = page.locator('.ios-dialog').inner_text()
            R.check('Anthropic' in sheet and 'sans ton nom' in sheet, f'{theme} accord explicite, destinataire nommé : « {sheet[:160]} »')
            R.check(page.evaluate('window.__aiCalls.length') == 0, f'{theme} rien d\'envoyé avant l\'accord')
            shot(page, LOT, f'ia-accord-iPhone_13-{theme}')
            page.locator('.ios-dialog button', has_text='Envoyer').first.click()
            page.wait_for_selector('.pimp-ai [role="status"]')
            R.check('Lecture avec l' in page.locator('.pimp-ai').inner_text(), f'{theme} état de chargement')
            page.wait_for_selector('.pimp-ai-done', timeout=8000)
            settle(page)
            calls = page.evaluate('window.__aiCalls')
            R.check(len(calls) == 1 and calls[0]['mode'] == 'lines', f'{theme} un seul envoi, mode lignes : {[c.get("mode") for c in calls]}')
            texts = [t['text'] for t in calls[0]['targets']] if calls else []
            R.check(texts and all('Développé couché' not in t and 'Squat' not in t for t in texts), f'{theme} seules les lignes douteuses : {texts}')
            R.check(set(calls[0].keys()) == {'mode', 'targets'} and all(set(t.keys()) == {'text', 'prev', 'next', 'session'} for t in calls[0]['targets']), f'{theme} rien d\'autre que le texte du plan')
            row = page.locator('.pimp-row', has_text='Zorglub')
            R.check(row.locator('.cell__title').inner_text() == 'Curl barre' and 'Lu avec l' in row.inner_text(), f'{theme} ligne corrigée : {row.inner_text()[:80]}')
            R.check(page.locator('[data-action="pimp-ai"]').count() == 0, f'{theme} aide déjà utilisée : plus proposée')
            check_layout(page, theme, 'relu par l\'IA')
            shot(page, LOT, f'ia-relu-iPhone_13-{theme}')
            # Correction de l'IA gardée par le coach : apprise par le moteur
            page.click('[data-action="pimp-save"]')
            settle(page)
            d = json.loads(ls(page, 'ppl_v2'))
            R.check(d.get('planAliases', {}).get('zorglub') == 'Curl barre' or 'Curl barre' in d.get('planAliases', {}).values(), f'{theme} correction de l\'IA apprise : {d.get("planAliases")}')
            R.check(not page.errors, f'{theme} aide de l\'IA : aucune erreur JS {page.errors}')
        finally:
            ctx.__exit__(None, None, None)
    # Quota du jour, plafond du mois : message clair, le résultat du moteur reste
    ctx, page = open_signed(bench, 'light')
    try:
        for mode, words in (('quota', '20 lectures'), ('budget', 'en pause')):
            page.evaluate(f"window.__aiMode = '{mode}'")
            read_plan(page, DOUBT)
            before = page.locator('.pimp-row .cell__title').all_inner_texts()
            page.click('[data-action="pimp-ai"]')
            page.wait_for_selector('.ios-dialog')
            page.locator('.ios-dialog button', has_text='Envoyer').first.click()
            msg = toast_text(page)
            R.check(words in msg and 'moteur reste' in msg, f'{mode} : message clair « {msg} »')
            settle(page)
            R.check(page.locator('.pimp-row .cell__title').all_inner_texts() == before, f'{mode} : résultat du moteur gardé')
            R.check(page.locator('[data-action="pimp-ai"]').count() == 1, f'{mode} : l\'aide reste proposée')
            shot(page, LOT, f'ia-{mode}-iPhone_13-light')
            wait_toast_gone(page)
            page.click('[data-action="pimp-edit-text"]')
            page.wait_for_selector('#pimpText')
        # Plan sûr : lien neutre en bas, jamais orange
        read_plan(page, 'Lundi\nDéveloppé couché 4x8\nSquat 5x5\nTractions 4x8\nRowing barre 4x10')
        link = page.locator('.pimp-ai-link')
        R.check(link.count() == 1 and page.locator('[data-action="pimp-ai"].btn--primary').count() == 0, 'plan sûr : simple lien, pas de bouton plein')
        color = page.evaluate("getComputedStyle(document.querySelector('.pimp-ai-link')).color")
        tint = page.evaluate("getComputedStyle(document.querySelector('[data-action=\"pimp-save\"]')).backgroundColor")
        R.check(color != tint, f'lien neutre ({color}), pas la teinte orange ({tint})')
        shot(page, LOT, 'ia-lien-neutre-iPhone_13-light')
        R.check(not page.errors, f'quota et lien : aucune erreur JS {page.errors}')
    finally:
        ctx.__exit__(None, None, None)
    # Sans compte : connexion demandée, rien d'envoyé
    ctx, page = open_signed(bench, 'dark', signed=False)
    try:
        read_plan(page, DOUBT)
        page.click('[data-action="pimp-ai"]')
        page.wait_for_selector('.ios-dialog')
        R.check('Connecte-toi' in page.locator('.ios-dialog').inner_text(), 'sans compte : connexion demandée')
        R.check(page.evaluate('window.__aiCalls.length') == 0, 'sans compte : rien d\'envoyé')
        R.check(not page.errors, f'sans compte : aucune erreur JS {page.errors}')
    finally:
        ctx.__exit__(None, None, None)


run_main(R, [t_import_texte], once=[t_corriger_enregistrer, t_pdf, t_photo_dictee, t_limites_reglages, t_aide_ia])
