"""Le même exercice deux fois dans une séance, et le rôle d'un bloc (js/data/blocks.js, docs/SEANCE_OUTILS.md) : retour
d'un testeur du 26/11, 2 séries d'Extension quadriceps en pré-fatigue au début, les vraies séries à la fin.

- Programme › Séance : « Déjà dans la séance » reste écrit, le toucher ajoute un bloc de plus ; Programme › Exercice ›
  Rôle ; la liste dit « Extension quadriceps (2e) » et « Pré-fatigue ».
- Séance : titre « Pré-fatigue », séries numérotées, « Avant » du même bloc (jamais les séries lourdes), aucun record
  sur la pré-fatigue, un seul record pour l'exercice ; ajout du même exercice en séance (« Déjà dans la séance ») ;
  menu ⋯ › Plus d'options › Rôle ; historique ; « À battre » de l'accueil.
- Une fois : synchro du compte (un 2e appareil retrouve blocs, rôles et « Avant »), programme envoyé par le coach
  (doublon et rôle reçus, repris à l'envoi suivant), envoi par le coach depuis l'app, données lues par l'app d'avant
  (PPL_OLD_URL : la version publiée servie à part ; sans elle, ce contrôle est sauté).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'blocs'
R = Results(LOT)
EXT = 'Extension quadriceps'


def tag(dev, theme):
    return f'{dev}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_legs_editor(page):
    page.evaluate("routeTo('programmes'); navigate(makeRoute('editor', 'legs'))")
    page.wait_for_selector('.view.editor')
    settle(page)


def add_prefat_block(page, t):
    """Programme › Séance Jambes › Ajouter un exercice › Extension quadriceps (déjà là) › 2 séries, Pré-fatigue › OK,
    puis le bloc monté en tête (pré-fatigue au début)."""
    open_legs_editor(page)
    page.click('.view.editor [data-action="add-ex"]')
    page.wait_for_selector('#libSearch')
    page.fill('#libSearch', 'Extension quadri')
    settle(page)
    row = page.locator(f'[data-action="lib-pick"][data-name="{EXT}"]').first
    R.check(row.count() == 1 and 'Déjà dans la séance' in row.inner_text() and row.get_attribute('aria-disabled') is None,
            f'{t} bibliothèque : « Déjà dans la séance » dit, mais choisissable')
    row.click()
    page.wait_for_selector('.view.ex-edit')
    settle(page)
    R.check(page.locator('#exRole [data-role="normal"]').get_attribute('aria-pressed') == 'true', f'{t} rôle Normal par défaut')
    page.click('[data-action="ex-sets"][data-d="-1"]')
    page.click('#exRole [data-role="prefat"]')
    settle(page)
    R.check(page.locator('#exRole [data-role="prefat"]').get_attribute('aria-pressed') == 'true', f'{t} Pré-fatigue choisie')
    page.locator('#exRole').scroll_into_view_if_needed()
    shot(page, LOT, f'{t}-01-programme-exercice-role')
    page.click('[data-action="save-ex"]')
    page.wait_for_selector('.view.editor')
    settle(page)
    page.evaluate("(() => { const xs = prog().exercises.legs; xs.unshift(xs.pop()); save(); render(); })()")
    settle(page)
    return page.evaluate("prog().exercises.legs.map(e => ({ id: e.id, exId: e.exId || null, occ: e.occ || 1, role: e.role || null, sets: e.sets, name: e.name }))")


def validate(page, ei, si, w=None, reps=None):
    if w is not None:
        page.fill(f'[data-action="set-weight"][data-ei="{ei}"][data-si="{si}"]', w)
    if reps is not None:
        page.fill(f'[data-action="set-reps"][data-ei="{ei}"][data-si="{si}"]', reps)
    page.click(f'[data-action="validate-set"][data-ei="{ei}"][data-si="{si}"]')
    settle(page)
    for sel in ('.rest-overlay [data-action="skip-rest"]', '.rest-mini__skip'):
        if page.locator(sel).count():
            page.locator(sel).first.click()
            settle(page)
            break


def t_blocs(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        xs = add_prefat_block(page, t)
        pre, main = xs[0], next(x for x in xs[1:] if x['name'] == EXT)
        R.check(pre['role'] == 'prefat' and pre['occ'] == 2 and pre['exId'] == 'g5extqua' and pre['id'] != 'g5extqua' and pre['sets'] == 2,
                f'{t} bloc de plus : son id, suivi commun, rang 2, 2 séries, pré-fatigue {pre}')
        R.check(main['id'] == 'g5extqua' and main['occ'] == 1 and main['role'] is None, f'{t} 1er bloc inchangé {main}')
        names = page.locator('.view.editor .ed-name').all_inner_texts()
        R.check(names[0] == EXT and f'{EXT} (2e)' in names, f'{t} liste : « {EXT} » en tête, « {EXT} (2e) » plus bas ({names})')
        sub0 = page.locator('.view.editor .ed-row').first.inner_text()
        R.check('Pré-fatigue' in sub0, f'{t} liste : rôle dit en clair ({sub0!r})')
        shot(page, LOT, f'{t}-02-programme-seance')

        # Accueil : « À battre » ne propose rien pour la pré-fatigue
        rows = page.evaluate("""(() => { const d = document.createElement('div'); d.innerHTML = targetsHtml('legs');
            return [...d.querySelectorAll('.targets__row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim()); })()""")
        R.check(rows and rows[0].startswith(EXT) and 'Pré-fatigue' in rows[0] and '×' not in rows[0] and any(r.startswith(f'{EXT} (2e)') and '×' in r for r in rows),
                f'{t} À battre : pré-fatigue sans objectif, le vrai bloc avec le sien ({rows})')

        # Séance : la pré-fatigue en tête
        page.evaluate("startSession('legs')")
        page.wait_for_selector('.view.session')
        settle(page)
        a = page.evaluate("activeSession.exercises.map(e => ({ exId: e.exId, occ: e.occ || 1, role: e.role || null, warm: e.sets.map(s => !!s.warmup), prev: e.sets.map(s => s.prev && s.prev.weight) }))")
        ext_i = next(i for i, e in enumerate(a) if i > 0 and e['exId'] == 'g5extqua')
        R.check(a[0]['role'] == 'prefat' and a[0]['occ'] == 2 and all(a[0]['warm']) and a[0]['exId'] == 'g5extqua', f'{t} séance : bloc de pré-fatigue {a[0]}')
        R.check(not any(a[0]['prev']), f'{t} jamais fait en pré-fatigue : « Avant » vide, pas les séries lourdes ({a[0]["prev"]})')
        R.check(all(a[ext_i]['prev']) and not any(a[ext_i]['warm']), f'{t} vrai bloc : « Avant » de la dernière fois ({a[ext_i]["prev"]})')
        card0 = page.locator('.ex-card[data-ei="0"]')
        R.check(card0.locator('.sets__caption').first.inner_text() == 'Pré-fatigue', f'{t} titre « Pré-fatigue » en tête des séries')
        nums = card0.locator('.set-n.num, .set-plates .num').all_inner_texts()
        R.check(nums[:2] == ['1', '2'] or nums[:1] == ['2'] or nums == ['1', '2'], f'{t} pré-fatigue : séries numérotées ({nums})')
        head = page.locator(f'.ex-card[data-ei="{ext_i}"] .ex-card__name').inner_text()
        R.check(head.startswith(f'{EXT} (2e)'), f'{t} carte du vrai bloc : « {EXT} (2e) » ({head!r})')
        shot(page, LOT, f'{t}-03-seance-prefatigue')
        validate(page, 0, 0, '20', '15')
        validate(page, 0, 1, '20', '15')
        R.check(page.locator('.ex-card[data-ei="0"] .pr-badge').count() == 0, f'{t} aucun record sur la pré-fatigue')

        # Le même exercice ajouté en séance : « Déjà dans la séance », 3e bloc, puis rôle Échauffement par le menu ⋯
        page.click('[data-action="add-session-ex"]')
        page.wait_for_selector('#axSearch')
        page.fill('#axSearch', 'Extension quadri')
        settle(page)
        item = page.locator(f'.ax__item[data-name="{EXT}"]').first
        R.check(item.count() == 1 and 'Déjà dans la séance' in item.inner_text(), f'{t} feuille d\'ajout : « Déjà dans la séance »')
        item.click()
        settle(page)
        ext_i = page.evaluate("activeSession.exercises.findIndex(e => e.exId === 'g5extqua' && !e.occ)")
        added = page.evaluate("activeSession.exercises.find(e => e.occ === 3)")
        R.check(added and added['exId'] == 'g5extqua', f'{t} ajout en séance : 3e bloc du même exercice {added and added.get("occ")}')
        ai = page.evaluate("activeSession.exercises.findIndex(e => e.occ === 3)")
        labels = sorted(page.evaluate("activeSession.exercises.filter(e => e.exId === 'g5extqua').map(exLabel)"))
        R.check(labels == [EXT, f'{EXT} (2e)', f'{EXT} (3e)'], f'{t} trois blocs nommés de haut en bas ({labels})')
        page.click(f'.ex-card[data-ei="{ai}"] [data-action="ex-menu"]')
        settle(page)
        tap_dialog(page, 'Plus d\'options')
        R.check(page.locator('.ios-dialog__btn', has_text='Rôle : Normal').count() == 1, f'{t} menu ⋯ › Plus d\'options : « Rôle : Normal »')
        tap_dialog(page, 'Rôle : Normal')
        shot(page, LOT, f'{t}-04-menu-role')
        R.check(page.locator('.ios-dialog__btn', has_text='Normal (actuel)').count() == 1, f'{t} rôle actuel dit en clair')
        R.check(page.locator(f'.ex-card[data-ei="0"] .ex-card__sub', has_text='Record').count() == 0, f'{t} pas de record à viser sur la pré-fatigue')
        tap_dialog(page, 'Échauffement')
        ex3 = page.evaluate(f"activeSession.exercises[{ai}]")
        R.check(ex3.get('role') == 'warmup' and all(s.get('warmup') for s in ex3['sets']), f'{t} rôle Échauffement : séries marquées')
        R.check(page.locator(f'.ex-card[data-ei="{ai}"] .set-n--warm').count() >= 1, f'{t} échauffement : « É »')
        R.check(page.evaluate("data.programmes.ppl.exercises.legs.length") == 7, f'{t} bloc ajouté en séance : le programme ne change pas')

        # Vrai bloc : record sur 80 kg (charge jamais faite)
        validate(page, ext_i, 0, '50', '10')
        R.check(page.locator(f'.ex-card[data-ei="{ext_i}"] .pr-badge').count() >= 1 or page.locator(f'.ex-card[data-ei="{ext_i}"] .medal, .ex-card--collapsed[data-ei="{ext_i}"]').count() >= 1,
                f'{t} record sur le vrai bloc')
        page.evaluate(f"activeSession.exercises.forEach((ex, i) => {{ if (i !== {ai}) ex.sets.forEach(s => {{ s.done = true; s.reps = s.reps || '10'; s.weight = s.weight || s.prev?.weight || '' }}); }})")
        page.evaluate(f"activeSession.exercises.splice({ai}, 1); persistSession(); render()")
        settle(page)
        page.click('[data-action="finish-session"]')
        settle(page)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary')
        settle(page)
        h = page.evaluate("data.history[0]")
        ext = [e for e in h['exercises'] if e['exId'] == 'g5extqua']
        R.check(len(ext) == 2 and {e.get('occ', 1) for e in ext} == {1, 2}, f'{t} historique : deux blocs, un suivi ({[(e.get("occ"), e.get("role")) for e in ext]})')
        pe = next(e for e in ext if e.get('occ') == 2)
        R.check(pe.get('role') == 'prefat' and all(s.get('warmup') for s in pe['sets']), f'{t} historique : pré-fatigue marquée')
        recs = [r for r in (h.get('records') or []) if r['ex'] == EXT]
        R.check(len(recs) == 1 and recs[0]['after'] == 50, f'{t} un seul record pour l\'exercice, le vrai bloc ({recs})')
        R.check(page.evaluate("exVolume(data.history[0].exercises.find(e => e.occ === 2))") == 0, f'{t} pré-fatigue hors volume')
        page.click('[data-action="summary-done"]')
        settle(page)

        # Séance suivante : « Avant » de chaque bloc = SON bloc de la dernière fois
        page.evaluate("data.programmes.ppl.skipped = { legs: Date.now() }; startSession('legs')")
        page.wait_for_selector('.view.session')
        settle(page)
        ext_i = page.evaluate("activeSession.exercises.findIndex(e => e.exId === 'g5extqua' && !e.occ)")
        p0 = page.evaluate("activeSession.exercises[0].sets.map(s => s.prev && s.prev.weight)")
        pm = page.evaluate(f"activeSession.exercises[{ext_i}].sets[0].prev.weight")
        R.check(p0 == ['20', '20'], f'{t} pré-fatigue : « Avant » 20 kg, pas les séries lourdes ({p0})')
        R.check(pm == '50', f'{t} vrai bloc : « Avant » 50 kg ({pm})')
        page.evaluate("(() => { const n = document.querySelector('.ex-card[data-ei=\"0\"]'); n && n.scrollIntoView({ block: 'start' }); })()")
        shot(page, LOT, f'{t}-05-seance-avant')
        # Séance abandonnée, app relancée (WebKit : la transition de fin de séance vers l'historique ne se posait pas
        # toujours dans le temps d'attente) ; l'historique est déjà enregistré
        page.evaluate("endSession()")
        page.reload()
        page.wait_for_selector('#app > *')
        page.evaluate("routeTo('history')")
        settle(page)
        page.locator('.hcell').first.click()
        page.wait_for_selector('.view.history-detail')
        settle(page)
        txt = page.inner_text('.view.history-detail')
        R.check(f'{EXT} (2e)' in txt and 'Pré-fatigue' in txt, f'{t} détail de l\'historique : « (2e) » et « Pré-fatigue »')
        R.check('Échauffement :' not in txt.split('Pré-fatigue')[1][:80], f'{t} pré-fatigue lue comme des séries, sans « Échauffement : »')
        page.locator('.hex__name', has_text=EXT).first.scroll_into_view_if_needed()
        shot(page, LOT, f'{t}-06-historique')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ── Compte, coach, version d'avant ───────────────────────────────────────────

NOW = local_ms(2026, 11, 26, 18, 0, tz=PARIS)


def open_account_app(page, theme, ppl_v2=None):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
    seed(page, theme, ppl_v2, extra={'ppl_welcome_seen': '1'})
    settle(page)


def signin(page, username='max'):
    page.evaluate("""async u => { await accountSignInWith('apple', async () => 'add'); if (u) await accountSaveProfile({ username: u }); }""", username)
    settle(page)


def blocks_data():
    """Données réalistes + bloc de pré-fatigue en tête de Jambes, déjà fait une fois (20 kg × 15, 15)."""
    d = ppl_v2_today(now_ms=NOW)
    legs = d['programmes']['ppl']['exercises']['legs']
    blk = make_ex('g5pre002', EXT, 2)
    blk.update({'exId': 'g5extqua', 'occ': 2, 'role': 'prefat'})
    legs.insert(0, blk)
    last = max((h for h in d['history'] if h['category'] == 'legs'), key=lambda h: h['date'])
    for h in d['history']:
        for e in h['exercises']:
            e.setdefault('exId', next((x['id'] for x in legs if x['name'] == e['name'] and 'exId' not in x), None) or ('n:' + e['name'].lower()))
    last['exercises'].insert(0, {'exId': 'g5extqua', 'name': EXT, 'occ': 2, 'role': 'prefat',
                                 'sets': [{'weight': '20', 'reps': '15', 'warmup': True}, {'weight': '20', 'reps': '15', 'warmup': True}]})
    d['schema'] = 6
    return d


def once_synchro(bench):
    """Appareil A : programme à blocs et séance faite, envoyés au compte. Appareil B (neuf, même compte) : il retrouve
    le bloc, son rôle et « Avant » de chaque bloc ; ses envois gardent rang et rôle."""
    for theme in ('light',):
        t = f'synchro-{theme}'
        with bench.frozen_page(NOW, 'chromium', 'Pixel 7', theme) as a:
            open_account_app(a, theme, json.dumps(blocks_data(), ensure_ascii=False))
            signin(a)
            a.evaluate('syncNow()')
            settle(a)
            a.wait_for_function("() => (window.__sb.upserted || []).length > 0 && __sb.calls.some(c => c[1] === 'profiles' && c[2] === 'upsert')", timeout=10_000)
            rows = a.evaluate("""(() => { const m = new Map(); for (const r of __sb.upserted) m.set(r.id, r); return [...m.values()]
                .map(r => ({ id: r.id, data: r.data, deleted_at: r.deleted_at || null, updated_at: new Date().toISOString() })); })()""")
            # Profil envoyé (le faux serveur ne garde pas l'upsert du profil) : celui que l'app envoie, profilePayload
            doc = a.evaluate("JSON.parse(JSON.stringify(profilePayload(data)))")
            a_me = a.evaluate('__sb.meId()')
            sent = next(r for r in rows if any(e.get('occ') == 2 for e in r['data'].get('exercises', [])))
            pe = next(e for e in sent['data']['exercises'] if e.get('occ') == 2)
            R.check(pe.get('role') == 'prefat' and pe['exId'] == 'g5extqua' and all(s.get('warmup') for s in pe['sets']), f'{t} séance envoyée : rang, rôle, séries marquées {pe}')
            blk = doc['programmes']['ppl']['exercises']['legs'][0]
            R.check(blk.get('exId') == 'g5extqua' and blk.get('occ') == 2 and blk.get('role') == 'prefat', f'{t} profil envoyé : bloc du programme {blk}')
            R.check(not a.errors, f'{t} A sans erreur {a.errors}')
        with bench.frozen_page(NOW, 'webkit', 'iPhone 13', theme) as b:
            open_account_app(b, theme, None)
            # Même compte que A (identifiants du faux serveur numérotés dans l'ordre : le 1er compte créé)
            me = a_me
            b.evaluate("""([rows, doc, me]) => { window.__sb.remoteRows = rows; (window.__sb.docs ||= {})[me] = doc;
                (window.__sb.docAt ||= {})[me] = '2026-11-21T10:00:00.000000+00:00'; }""", [rows, doc, me])
            signin(b)
            R.check(b.evaluate('__sb.meId()') == me, f'{t} B : même compte que A')
            b.evaluate('syncNow()')
            settle(b)
            b.wait_for_function("() => (data.history || []).length > 0 && data.programmes.ppl.exercises.legs.some(e => e.occ === 2)", timeout=10_000)
            legs = b.evaluate("data.programmes.ppl.exercises.legs.map(e => [e.id, e.exId || null, e.occ || 1, e.role || null])")
            R.check(legs[0] == ['g5pre002', 'g5extqua', 2, 'prefat'], f'{t} B : bloc reçu {legs[0]}')
            b.evaluate("data.programmes.ppl.skipped = { legs: Date.now() }; startSession('legs')")
            b.wait_for_selector('.view.session')
            settle(b)
            p0 = b.evaluate("activeSession.exercises[0].sets.map(s => s.prev && s.prev.weight)")
            R.check(p0 == ['20', '20'], f'{t} B : « Avant » de la pré-fatigue ({p0})')
            R.check(b.locator('.ex-card[data-ei="0"] .sets__caption').first.inner_text() == 'Pré-fatigue', f'{t} B : titre « Pré-fatigue »')
            shot(b, LOT, f'{t}-appareil-B-seance')
            R.check(not b.errors, f'{t} B sans erreur {b.errors}')


COACH_PROG = {
    'name': 'Jambes coach', 'sessions': [{'key': 'sA', 'label': 'Jambes', 'color': '#34C759', 'exercises': [
        {'name': EXT, 'sets': 2, 'repMax': 15, 'repFixed': True, 'role': 'prefat', 'load': 20},
        {'name': 'Squat barre', 'sets': 4, 'repMin': 6, 'repMax': 8},
        {'name': EXT, 'sets': 3, 'repMin': 8, 'repMax': 12, 'load': 50},
    ]}],
}


def once_coach(bench):
    """Élève : programme du coach avec le même exercice deux fois et un rôle ; ajouté, séance, puis nouvel envoi (blocs
    repris). Coach dans l'app : un programme à blocs part avec ses deux blocs et son rôle."""
    for theme in ('dark', 'light'):
        t = f'coach-{theme}'
        with bench.frozen_page(NOW, 'webkit', 'iPhone 13', theme) as page:
            open_account_app(page, theme, ppl_v2_today_json(now_ms=NOW))
            signin(page, 'lea')
            ids = page.evaluate("""() => { const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false }); __sb.makeCoach(max);
                __sb.link(max, __sb.meId()); return { max }; }""")
            page.evaluate("""([max, prog]) => { __sb.co.progs.push({ coach: max, student: __sb.meId(), id: 'p_jambes', data: prog, sent_at: new Date().toISOString(), seen: false }); }""",
                          [ids['max'], COACH_PROG])
            page.evaluate('coachRefresh()')
            settle(page)
            page.click('.tabbar [data-tab="friends"]')
            settle(page)
            page.click('[data-action="coach-open-mine"]')
            page.wait_for_selector('.coach-mine-view .coach-prog')
            settle(page)
            page.click('.coach-prog [data-action="coach-add-prog"]')
            settle(page)
            tap_dialog(page, 'Passer à ce programme')
            pid = page.evaluate('data.activeProgramme')
            xs = page.evaluate(f"data.programmes[{json.dumps(pid)}].exercises.sA.map(e => ({{ id: e.id, exId: e.exId || null, occ: e.occ || 1, role: e.role || null, load: e.load ?? null }}))")
            R.check(len(xs) == 3 and xs[0]['role'] == 'prefat' and xs[2]['exId'] == xs[0]['id'] and xs[2]['occ'] == 2, f'{t} reçu : deux blocs, un suivi, rôle {xs}')
            page.evaluate("startSession('sA')")
            page.wait_for_selector('.view.session')
            settle(page)
            s0 = page.evaluate("activeSession.exercises[0]")
            R.check(s0.get('role') == 'prefat' and s0['sets'][0]['weight'] == '20' and all(s.get('warmup') for s in s0['sets']), f'{t} séance : charge du coach sur la pré-fatigue, séries marquées')
            R.check(page.locator('.ex-card[data-ei="2"] .ex-card__name').inner_text().startswith(f'{EXT} (2e)'), f'{t} séance : « {EXT} (2e) »')
            shot(page, LOT, f'{t}-seance-programme-coach')
            page.evaluate("endSession()")
            # Nouvel envoi du même programme : blocs repris (même id, même rang)
            page.evaluate("""([max, prog]) => { __sb.co.progs = __sb.co.progs.filter(p => p.id !== 'p_jambes');
                __sb.co.progs.push({ coach: max, student: __sb.meId(), id: 'p_jambes', data: prog, sent_at: new Date(Date.now() + 60000).toISOString(), seen: false }); }""",
                          [ids['max'], {**COACH_PROG, 'sessions': [{**COACH_PROG['sessions'][0], 'exercises': [dict(COACH_PROG['sessions'][0]['exercises'][0], sets=3), *COACH_PROG['sessions'][0]['exercises'][1:]]}]}])
            page.evaluate('coachRefresh()')
            settle(page)
            page.evaluate(f"importCoachProgramme(data, coach.inbox.programmes.find(p => p.id === 'p_jambes'), {{ user_id: {json.dumps(ids['max'])}, username: 'max' }}); save()")
            again = page.evaluate(f"data.programmes[{json.dumps(pid)}].exercises.sA.map(e => ({{ id: e.id, exId: e.exId || null, occ: e.occ || 1, role: e.role || null, sets: e.sets }}))")
            R.check([(x['id'], x['occ']) for x in again] == [(x['id'], x['occ']) for x in xs] and again[0]['sets'] == 3, f'{t} nouvel envoi : blocs repris {again}')
            R.check(not page.errors, f'{t} élève sans erreur {page.errors}')

        # Coach dans l'app : son programme à blocs part tel quel
        with bench.frozen_page(NOW, 'chromium', 'Pixel 7', theme) as page:
            open_account_app(page, theme, json.dumps(blocks_data(), ensure_ascii=False))
            signin(page, 'max')
            st = page.evaluate("""async () => { const me = __sb.meId(); __sb.makeCoach(me); const lea = __sb.addPerson({ username: 'lea', avatar: '🐯', social: false });
                __sb.link(me, lea); await coachRefresh(); const r = await coachSendProgramme(lea, 'ppl'); return { r, lea }; }""")
            R.check(st['r'].get('ok') is True, f'{t} coach : envoi accepté {st["r"]}')
            sent = page.evaluate("__sb.co.progs.find(p => p.id === 'ppl').data")
            legs = next(s for s in sent['sessions'] if s['key'] == 'legs')['exercises']
            exts = [e for e in legs if e['name'] == EXT]
            R.check(len(exts) == 2 and exts[0].get('role') == 'prefat' and 'role' not in exts[1], f'{t} coach : deux blocs, rôle envoyé {exts}')
            R.check(not page.errors, f'{t} coach sans erreur {page.errors}')


def once_version_avant(bench):
    """Données écrites par cette version (programme à blocs, séances à rang et rôle), lues par l'app publiée avant elle
    (PPL_OLD_URL) : aucune erreur, accueil, séance, historique et progrès s'affichent ; la séance démarre."""
    old = os.environ.get('PPL_OLD_URL')
    if not old:
        # En CI, l'app d'avant est toujours servie (tests/app_avant.sh) : son absence est une erreur
        if os.environ.get('CI'):
            R.check(False, 'PPL_OLD_URL absent en CI (tests/app_avant.sh)')
        else:
            R.skip('PPL_OLD_URL absent : version d\'avant non servie')
        return
    for eng, dev in (('webkit', 'iPhone 13'), ('chromium', 'Pixel 7')):
        t = f'avant-{dev}'
        with bench.frozen_page(NOW, eng, dev, 'dark') as page:
            seed(page, 'dark', json.dumps(blocks_data(), ensure_ascii=False), url=old)
            settle(page)
            R.check(page.locator('#app > *').count() > 0 and not page.evaluate("typeof dataBroken !== 'undefined' && dataBroken"), f'{t} app d\'avant : donnée lue, pas d\'écran de secours')
            page.evaluate("data.programmes.ppl.skipped = { legs: Date.now() }; startSession('legs')")
            page.wait_for_selector('.view.session')
            settle(page)
            n = page.evaluate("activeSession.exercises.filter(e => e.name === 'Extension quadriceps').length")
            R.check(n == 2, f'{t} app d\'avant : les deux blocs en séance ({n})')
            page.evaluate("activeSession.exercises.forEach(ex => ex.sets.forEach(s => { s.done = true; s.reps = s.reps || '10'; s.weight = s.weight || '20' }))")
            page.click('[data-action="finish-session"]')
            settle(page)
            tap_dialog(page, 'Enregistrer la séance')
            page.wait_for_selector('.view.summary')
            settle(page)
            page.evaluate("routeTo('history')")
            settle(page)
            page.locator('.hcell').first.click()
            settle(page)
            page.evaluate("routeTo('progress')")
            settle(page)
            # Relue par cette version : la séance de l'app d'avant (exId = id du bloc) rejoint le suivi commun
            saved = page.evaluate("localStorage.getItem('ppl_v2')")
            R.check(not page.errors, f'{t} app d\'avant sans erreur {page.errors}')
        with bench.frozen_page(NOW, eng, dev, 'dark') as page:
            seed(page, 'dark', saved)
            settle(page)
            h = page.evaluate("data.history[0].exercises.filter(e => e.name === 'Extension quadriceps').map(e => [e.exId, e.occ || 1, e.role || null])")
            # Rattachée au suivi et au rang, sans rôle ni série marquée (audit B1 : l'app d'avant n'a rien marqué)
            R.check(sorted(h) == [['g5extqua', 1, None], ['g5extqua', 2, None]], f'{t} relue ici : séance d\'avant rattachée au suivi ({h})')
            R.check(not page.errors, f'{t} relue sans erreur {page.errors}')


run_main(R, [t_blocs], once=[once_synchro, once_coach, once_version_avant])
