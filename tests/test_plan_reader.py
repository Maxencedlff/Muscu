"""Pont de lecture et de dictée d'un programme (js/platform/plan-reader.js) dans la vraie page de l'app, avec les
modules natifs simulés (tests/fake_plan_reader.py) : lecture d'une feuille numérisée, d'un fichier choisi, dictée
avec partiels puis texte final, refus clair hors ligne, coquille d'avant les modules, et navigateur (« Disponible
dans l'app iPhone »). Aucun écran ne s'en sert encore (le moteur d'analyse, js/data/plan-parser.js, viendra s'y
brancher) : ce test vérifie le transport dans le vrai moteur JS, sous la vraie CSP.
Lancer : PPL_ONCE=1 python3 test_plan_reader.py (ou run_all.py plan_reader).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_plan_reader import FAKE_PLAN_READER, PAGE

LOT = 'plan_reader'
R = Results(LOT)


def open_app(bench, shell=True, opts=None):
    ctx = bench.page('chromium', 'iPhone 13', 'dark')
    page = ctx.__enter__()
    if opts is not None:
        page.add_init_script('window.__pr = %s;' % json.dumps(opts, ensure_ascii=False))
    if shell:
        page.add_init_script(FAKE_PLAN_READER)
    page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
    seed(page, 'dark', ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
    settle(page)
    return ctx, page


def o_lecture(bench):
    ctx, page = open_app(bench)
    try:
        R.check(page.evaluate('PlanReader.available && PlanReader.dictation.available'), 'modules présents')
        r = page.evaluate("PlanReader.pick('scan', { customWords: ['Développé couché', 'développé couché', 'Rowing barre'] })")
        R.check(r['ok'] and r['source'] == 'scan' and len(r['pages']) == 1, f'feuille numérisée lue {r}')
        R.check(r['pages'][0]['text'] == PAGE['text'], 'texte rendu tel quel')
        R.check(r['pages'][0]['lines'][1]['words'][5] == {'text': '90s', 'box': {'x': 0.72, 'y': 0.12, 'w': 0.06, 'h': 0.03}},
                'mots et boîtes (colonnes du tableau)')
        calls = page.evaluate('__pr.calls')
        R.check(calls[-1] == ['reader', 'pick', {'source': 'scan', 'limit': 5, 'customWords': ['Développé couché', 'Rowing barre']}],
                f'options envoyées au module {calls[-1]}')
        page.evaluate("__pr.error = 'CANCELED'")
        R.check(page.evaluate("PlanReader.pick('photos').then(r => r.reason)") == 'canceled', 'fermé sans choisir')
        # Fichier d'un <input type="file"> : PDF → readPdfScan en base64
        r = page.evaluate("PlanReader.readFile(new File(['%PDF-1.4'], 'prog.pdf', { type: 'application/pdf' }), { maxPages: 3 })")
        R.check(r['ok'] and r['pageCount'] == 1 and r['hasTextLayer'] is False, f'PDF scanné lu {r.get("reason")}')
        last = page.evaluate('__pr.calls.at(-1)')
        R.check(last[1] == 'readPdfScan' and last[2]['maxPages'] == 3 and last[2]['base64'] == 'JVBERi0xLjQ=', f'base64 sans en-tête {last}')
        R.check(not page.errors, f'aucune erreur JS {page.errors[:2]}')
    finally:
        ctx.__exit__(None, None, None)


def o_dictee(bench):
    ctx, page = open_app(bench)
    try:
        r = page.evaluate("""async () => {
            const partials = []; let final = null;
            const started = await PlanReader.dictation.start({ contextualStrings: ['Squat'], onPartial: t => partials.push(t), onFinal: f => { final = f; } });
            await new Promise(r => setTimeout(r, 120));
            const stopped = await PlanReader.dictation.stop();
            return { started, partials, final, stopped, start: __pr.calls.find(c => c[1] === 'start')[2] };
        }""")
        R.check(r['started'] == {'ok': True, 'onDevice': True}, f'dictée lancée sur l\'iPhone {r["started"]}')
        R.check(r['partials'] == ['Développé', 'Développé couché'], f'partiels {r["partials"]}')
        R.check(r['final'] and r['final']['text'] == 'Développé couché 4 séries de 8' and len(r['final']['segments']) == 6, 'texte final')
        R.check(r['stopped']['ok'] and r['stopped']['text'] == r['final']['text'], 'stop rend le même texte')
        R.check(r['start']['allowServer'] is False and r['start']['contextualStrings'] == ['Squat'], f'options {r["start"]}')
        R.check(not page.errors, f'aucune erreur JS {page.errors[:2]}')
    finally:
        ctx.__exit__(None, None, None)
    # iPhone qui ne sait pas reconnaître le français hors ligne : refus clair, jamais de serveur sans accord
    ctx, page = open_app(bench, opts={'dictation': {'onDevice': False, 'speech': 'authorized', 'microphone': 'authorized',
                                                    'partials': [], 'final': 'Squat'}})
    try:
        r = page.evaluate('PlanReader.dictation.start()')
        R.check(r == {'ok': False, 'reason': 'offline', 'message': 'Dictée hors ligne indisponible sur cet appareil'}, f'refus hors ligne {r}')
        r = page.evaluate('PlanReader.dictation.start({ allowServer: true })')
        R.check(r == {'ok': True, 'onDevice': False}, f'serveurs seulement après accord {r}')
    finally:
        ctx.__exit__(None, None, None)


def o_sans_module(bench):
    # Coquille iPhone d'avant ces modules : mise à jour demandée
    ctx, page = open_app(bench, opts={'noModules': True})
    try:
        r = page.evaluate("PlanReader.pick('scan')")
        R.check(r['reason'] == 'outdated', f'build d\'avant : {r}')
        R.check(page.evaluate('__pr.calls.length') == 0, 'aucun appel au module absent')
    finally:
        ctx.__exit__(None, None, None)
    # Navigateur : repli web
    ctx, page = open_app(bench, shell=False)
    try:
        r = page.evaluate("Promise.all([PlanReader.pick('photos'), PlanReader.dictation.start(), PlanReader.sources()])")
        R.check(r[0] == {'ok': False, 'reason': 'web', 'message': "Disponible dans l'app iPhone"} and r[1]['reason'] == 'web', f'repli web {r[:2]}')
        R.check(r[2] == {'photos': False, 'camera': False, 'scan': False}, 'aucune source dans le navigateur')
        R.check(not page.errors, f'aucune erreur JS {page.errors[:2]}')
    finally:
        ctx.__exit__(None, None, None)


run_main(R, [], once=[o_lecture, o_dictee, o_sans_module])
