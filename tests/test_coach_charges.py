"""Charge prescrite par le coach (16/11/2026, js/data/coach-presc.js, docs/COACH_V1.md « Charge prescrite ») :
le coach prescrit 60 kg × 8 (reps fixes) et une fourchette 3 à 5 avec top set à 100 kg et back-off à 90 kg depuis
l'écran Envoyer (saisie au clavier numérique, bornes, « Reprendre sa dernière fois »), l'envoi les porte, la
prescription est reprise au renvoi ; l'élève reçoit, ses cases sont pré-remplies, « Coach : 60 kg × 8 » sous le nom,
« Avant » garde la dernière fois ; il valide à 62,5 kg et le coach voit l'écart dans la séance. Rétrocompatibilité :
programme sans charge, séance comme avant. Panel du 16/11 : étiquettes top set / back-off dans la ligne de leur
série, sans × sur un programme du coach.

App iOS et Supabase simulés (tests/fake_account.py) : aucune requête ne sort. Captures : $PPL_SCRATCH/shots/coach_charges/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_coach_charges.py (ou run_all.py coach_charges).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'coach_charges'
R = Results(LOT)
NOW = local_ms(2026, 11, 16, 18, 0, tz=PARIS)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(now_ms=NOW), extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username):
    page.evaluate("""async u => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: u }); }""", username)
    page.wait_for_timeout(200)


def small_targets(page, sel):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def toast(page):
    return page.locator('.toast').inner_text() if page.locator('.toast').count() else ''


def txt(page, sel):
    return page.inner_text(sel).replace(' ', ' ').replace(' ', ' ')


# Séance passée de Léa avec le squat (vue par le coach : « Reprendre sa dernière fois »)
def lea_sessions():
    return [{'id': 'l01', 'date': NOW - 3 * 86400_000, 'duration': 50 * 60_000, 'programme': 'ppl', 'category': 'legs', 'label': 'Legs',
             'exercises': [{'name': 'Squat barre', 'sets': [{'weight': '57.5', 'reps': '8'}, {'weight': '57.5', 'reps': '8'}, {'weight': '57.5', 'reps': '7'}]}]}]


def setup_coach(page, sessions):
    return page.evaluate("""s => {
        const me = __sb.meId();
        __sb.makeCoach(me);
        const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false, sessions: s });
        __sb.link(me, lea, Date.now() - 20 * 86400000);
        data.userProgrammes.u_force = { name: 'Force', archived: false, sessions: { sA: { label: 'Jambes', icon: '', desc: '', color: '#34C759' } } };
        data.programmes.u_force = { timers: {}, cooldowns: {}, exercises: { sA: [
          { id: 'e1', name: 'Squat barre', sets: 3, repMax: 8, repFixed: true },
          { id: 'e2', name: 'Soulevé de terre', sets: 4, repMin: 3, repMax: 5, intens: 'topback' },
          { id: 'e3', name: 'Gainage', sets: 3, measure: 'time' }] } };
        data.myProgrammes.push('u_force'); save();
        return { me, lea };
    }""", sessions)


def t_charges(bench, eng, dev, theme):
    t = tag(dev, theme)
    # ── 1. Le coach prescrit ─────────────────────────────────
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'max')
        ids = setup_coach(page, lea_sessions())
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        # Fiche de Léa d'abord (ses séances chargées : sa dernière fois est connue), puis Envoyer
        page.evaluate(f"routeTo('friends'); navigate(makeRoute('coach-student', '{ids['lea']}'))")
        page.wait_for_selector('.coach-sess')
        page.evaluate(f"navigate(makeRoute('coach-send', '{ids['lea']}', 'u_force'))")
        page.wait_for_selector('.coach-send-view')
        b1 = page.locator('.coach-presc-btn[data-ex="e1"]')
        R.check(b1.inner_text() == 'Prescrire une charge' and page.locator('.coach-presc-btn[data-ex="e3"]').count() == 0,
                f'{t} envoi : « Prescrire une charge » sur les exercices en reps, pas sur le gainage')
        R.check(not small_targets(page, '.coach-presc-btn'), f'{t} envoi : bouton de 44 pt')
        shot(page, LOT, f'1-envoi-sans-charge-{t}')
        b1.click()
        page.wait_for_selector('.coach-presc-view')
        R.check(page.get_attribute('#cpLoad', 'inputmode') == 'decimal' and page.get_attribute('#cpMax', 'inputmode') == 'numeric', f'{t} clavier numérique')
        R.check(page.locator('[data-action="coach-presc-mode"][data-fixed="true"]').get_attribute('aria-pressed') == 'true' and page.input_value('#cpMax') == '8',
                f'{t} reps reprises du programme : 8 fixes')
        last = page.locator('[data-action="coach-presc-last"]')
        R.check(last.count() == 1 and '57,5 kg × 8' in last.inner_text().replace(' ', ' '), f'{t} « Reprendre sa dernière fois » : 57,5 kg × 8')
        last.click()
        page.wait_for_timeout(200)
        R.check(page.input_value('#cpLoad') == '57,5', f'{t} dernière fois reprise ({page.input_value("#cpLoad")!r})')
        # Validation : bornes et demi-kilos
        for bad in ['600', '60,3', 'abc']:
            page.fill('#cpLoad', bad)
            page.click('[data-action="coach-presc-ok"]')
            page.wait_for_timeout(250)
            R.check(page.locator('.coach-presc-view').count() == 1 and page.get_attribute('#cpLoad', 'aria-invalid') == 'true' and 'demi-kilo' in toast(page),
                    f'{t} « {bad} » refusé ({toast(page)!r})')
        page.fill('#cpLoad', '60')
        R.check(no_hscroll(page) and not small_targets(page, '.coach-presc-view button'), f'{t} écran Charge et reps : sans débordement, 44 pt')
        shot(page, LOT, f'2-charge-et-reps-{t}')
        page.click('[data-action="coach-presc-ok"]')
        page.wait_for_selector('.coach-send-view')
        R.check(txt(page, '.coach-presc-btn[data-ex="e1"]').startswith('Charge : 60 kg × 8'), f'{t} envoi : « Charge : 60 kg × 8 » ({txt(page, ".coach-presc-btn[data-ex=e1]")!r})')
        # Fourchette 3 à 5, top set à 100, back-off à 90
        page.click('.coach-presc-btn[data-ex="e2"]')
        page.wait_for_selector('.coach-presc-view')
        R.check(page.input_value('#cpMin') == '3' and page.input_value('#cpMax') == '5' and 'Top set' in txt(page, '.coach-presc-view'), f'{t} fourchette 3 à 5, séries nommées')
        page.fill('#cpLoad', '90')
        page.fill('#cpSet0', '100')
        page.click('[data-action="coach-presc-ok"]')
        page.wait_for_selector('.coach-send-view')
        R.check(txt(page, '.coach-presc-btn[data-ex="e2"]').startswith('Charge : 100 kg puis 90 kg × 3–5'), f'{t} envoi : top set puis back-off ({txt(page, ".coach-presc-btn[data-ex=e2]")!r})')
        aria = page.get_attribute('.coach-presc-btn[data-ex="e1"]', 'aria-label')
        R.check('60 kilos, 8 reps' in aria, f'{t} VoiceOver : « 60 kilos, 8 reps » ({aria!r})')
        shot(page, LOT, f'3-envoi-avec-charges-{t}')
        page.click('[data-action="coach-send-go"]')
        page.wait_for_timeout(500)
        prog = page.evaluate("__sb.co.progs.find(p => p.id === 'u_force').data")
        xs = prog['sessions'][0]['exercises']
        R.check(xs[0].get('load') == 60 and xs[0].get('repFixed') is True and xs[0].get('repMax') == 8 and 'loads' not in xs[0], f'{t} envoyé : 60 kg × 8 {xs[0]}')
        R.check(xs[1].get('load') == 90 and xs[1].get('loads') == [100] and xs[1].get('repMin') == 3 and xs[1].get('intens') == 'topback', f'{t} envoyé : 100 puis 90, 3 à 5 {xs[1]}')
        R.check('load' not in xs[2], f'{t} gainage : rien de prescrit')
        R.check(page.evaluate("data.programmes.u_force.exercises.sA[0].load") is None, f'{t} mon programme n\'est pas touché')
        # Semaine suivante : la prescription est reprise, je la change et je renvoie
        page.evaluate(f"navigate(makeRoute('coach-send', '{ids['lea']}', 'u_force'))")
        page.wait_for_selector('.coach-send-view')
        R.check(txt(page, '.coach-presc-btn[data-ex="e1"]').startswith('Charge : 60 kg × 8'), f'{t} renvoi : prescription reprise')
        page.click('[data-action="back"]')
        R.check(not page.errors, f'{t} coach : aucune erreur JS {page.errors}')

    # ── 2. L'élève reçoit et s'entraîne ──────────────────────
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'lea')
        max_id = page.evaluate("""p => { const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false }); __sb.makeCoach(max);
            __sb.link(max, __sb.meId(), Date.now() - 20 * 86400000);
            __sb.co.progs.push({ coach: max, student: __sb.meId(), id: 'u_force', data: p, sent_at: new Date().toISOString(), seen: false }); return max; }""", prog)
        page.evaluate("coachRefresh()")
        page.wait_for_timeout(300)
        page.evaluate("routeTo('friends'); navigate('coach-mine')")
        page.wait_for_selector('.coach-prog [data-action="coach-add-prog"]')
        page.click('.coach-prog [data-action="coach-add-prog"]')
        page.wait_for_timeout(400)
        tap_dialog(page, 'Passer à ce programme')
        page.wait_for_timeout(300)
        pid = page.evaluate('data.activeProgramme')
        R.check(pid.startswith('u_c') and page.evaluate(f"data.programmes['{pid}'].exercises.sA[0].load") == 60, f'{t} programme importé avec sa charge ({pid})')
        # Sa dernière fois : 57,5 kg × 8 au squat
        page.evaluate(f"""() => {{ const ex = data.programmes['{pid}'].exercises.sA;
            data.history.unshift({{ id: 'h-sq', programme: '{pid}', category: 'sA', date: Date.now() - 3 * 86400000, duration: 3000000,
              exercises: [{{ exId: ex[0].id, name: 'Squat barre', sets: [{{ weight: '57.5', reps: '8' }}, {{ weight: '57.5', reps: '8' }}, {{ weight: '57.5', reps: '7' }}] }},
                          {{ exId: ex[1].id, name: 'Soulevé de terre', sets: [{{ weight: '100', reps: '4' }}, {{ weight: '100', reps: '4' }}, {{ weight: '100', reps: '4' }}, {{ weight: '100', reps: '4' }}] }}] }});
            save(); }}""")
        # Accueil : « Coach : 60 kg × 8 »
        page.evaluate("routeTo('dashboard')")
        page.wait_for_timeout(300)
        R.check('Coach : 60 kg × 8' in txt(page, '.dashboard'), f'{t} accueil : « Coach : 60 kg × 8 »')
        page.evaluate("startSession('sA')")
        page.wait_for_selector('.view.session')
        page.wait_for_timeout(300)
        card = '.ex-card[data-ei="0"]'
        goal = txt(page, f'{card} .ex-goal')
        R.check(goal.startswith('Coach : 60 kg × 8'), f'{t} séance : « Coach : 60 kg × 8 » ({goal!r})')
        R.check(page.locator(f'{card} .ex-goal .visually-hidden').text_content() == 'Prescrit par ton coach : 60 kilos, 8 reps', f'{t} VoiceOver : prescription lue')
        w = [page.input_value(f'{card} [data-action="set-weight"][data-si="{i}"]') for i in range(3)]
        r = [page.input_value(f'{card} [data-action="set-reps"][data-si="{i}"]') for i in range(3)]
        R.check(w == ['60', '60', '60'] and r == ['8', '8', '8'], f'{t} cases pré-remplies 60 × 8 ({w}, {r})')
        R.check('57,5' in txt(page, f'{card} .session-set[data-si="0"] .set-prev'), f'{t} « Avant » : la dernière fois (57,5)')
        R.check(page.locator(f'{card} .bump-chip').count() == 0, f'{t} pas de puce ↑')
        # Top set et back-off : pastille dans la ligne de sa série, back-off à 90, pas de ×
        dl = '.ex-card[data-ei="1"]'
        dw = [page.input_value(f'{dl} [data-action="set-weight"][data-si="{i}"]') for i in range(4)]
        dr = [page.input_value(f'{dl} [data-action="set-reps"][data-si="{i}"]') for i in range(4)]
        R.check(dw == ['100', '90', '90', '90'] and dr == ['4', '3', '3', '3'], f'{t} soulevé : 100 × 4 puis 90 × 3 ({dw}, {dr})')
        R.check(page.locator(f'{dl} .session-set[data-si="0"] .tech-pill').inner_text().startswith('Top set')
                and page.locator(f'{dl} .session-set[data-si="1"] .tech-pill').inner_text().startswith('Back-off')
                and page.locator(f'{dl} .tech').count() == 0 and page.locator(f'{dl} .tech__x').count() == 0,
                f'{t} étiquettes dans la ligne de leur série, sans ×')
        R.check(txt(page, f'{dl} .ex-goal').startswith('Coach : 100 kg puis 90 kg × 3–5'), f'{t} soulevé : « Coach : 100 kg puis 90 kg × 3–5 »')
        R.check(no_hscroll(page), f'{t} séance : pas de défilement horizontal')
        shot(page, LOT, f'4-seance-eleve-{t}')
        page.evaluate(f"document.querySelector('{dl}').scrollIntoView({{ block: 'start' }})")
        page.wait_for_timeout(200)
        shot(page, LOT, f'5-seance-top-backoff-{t}')
        # Il prend 62,5 kg : rien ne l'en empêche
        page.evaluate(f"document.querySelector('{card}').scrollIntoView({{ block: 'start' }})")
        page.fill(f'{card} [data-action="set-weight"][data-si="0"]', '62,5')
        page.click(f'{card} [data-action="validate-set"][data-si="0"]')
        page.wait_for_timeout(300)
        if page.locator('.ios-dialog').count():
            tap_dialog(page, 'Valider')
        R.check(page.evaluate("activeSession.exercises[0].sets[0]")['weight'] == '62.5' and page.evaluate("activeSession.exercises[0].sets[0].done") is True, f'{t} série validée à 62,5 kg')
        page.evaluate("activeSession.exercises[0].sets.slice(1).forEach(s => { s.done = true; }); activeSession.exercises.slice(1).forEach(ex => ex.sets.forEach(s => { s.done = true; s.reps = s.reps || '30'; }))")
        page.click('[data-action="finish-session"]')
        page.wait_for_timeout(250)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary')
        entry = page.evaluate("data.history[0]")
        sq = entry['exercises'][0]
        R.check([s['weight'] for s in sq['sets']][0] == '62.5' and sq.get('presc') == {'kg': [60, 60, 60], 'lo': 8, 'hi': 8}, f'{t} historique : fait 62,5, prescrit 60 {sq.get("presc")}')
        R.check(not page.errors, f'{t} élève : aucune erreur JS {page.errors}')

    # ── 3. Le coach voit l'écart ─────────────────────────────
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'max')
        ids = setup_coach(page, [entry] + lea_sessions())
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        page.evaluate(f"routeTo('friends'); navigate(makeRoute('coach-student', '{ids['lea']}'))")
        page.wait_for_selector('.coach-sess')
        page.click(f'.coach-sess[data-id="{entry["id"]}"]')
        page.wait_for_selector('.coach-session-view')
        gap = page.locator('.coach-presc-gap')
        gaps = [g.replace(' ', ' ').replace(' ', ' ') for g in gap.all_inner_texts()]
        R.check(any(g.startswith('Prescrit 60 kg × 8 · série 1 à 62,5 kg') for g in gaps), f'{t} coach : écart prescrit / fait {gaps}')
        R.check(any(g.startswith('Prescrit 100 kg puis 90 kg × 3–5') for g in gaps), f'{t} coach : top set et back-off prescrits {gaps}')
        gap.first.scroll_into_view_if_needed()
        shot(page, LOT, f'6-coach-ecart-{t}')
        R.check(not page.errors, f'{t} coach : aucune erreur JS {page.errors}')


def t_sans_charge(bench, eng, dev, theme):
    """Rétrocompatibilité : programme du coach sans charge (ou envoyé par une version d'avant) : séance comme avant."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'lea')
        prog = {'name': 'Base', 'sessions': [{'key': 'sA', 'label': 'Jambes', 'color': '#34C759', 'exercises': [
            {'name': 'Squat barre', 'sets': 3, 'repMin': 8, 'repMax': 12}]}]}
        page.evaluate("""p => { const max = __sb.addPerson({ username: 'max', social: false }); __sb.makeCoach(max); __sb.link(max, __sb.meId());
            __sb.co.progs.push({ coach: max, student: __sb.meId(), id: 'u_base', data: p, sent_at: new Date().toISOString(), seen: false }); }""", prog)
        page.evaluate("coachRefresh()")
        page.wait_for_timeout(300)
        page.evaluate("routeTo('friends'); navigate('coach-mine')")
        page.wait_for_selector('.coach-prog [data-action="coach-add-prog"]')
        page.click('.coach-prog [data-action="coach-add-prog"]')
        page.wait_for_timeout(400)
        tap_dialog(page, 'Passer à ce programme')
        page.wait_for_timeout(300)
        pid = page.evaluate('data.activeProgramme')
        page.evaluate(f"""() => {{ const ex = data.programmes['{pid}'].exercises.sA[0];
            data.history.unshift({{ id: 'h-b', programme: '{pid}', category: 'sA', date: Date.now() - 86400000, duration: 3000000,
              exercises: [{{ exId: ex.id, name: ex.name, sets: [{{ weight: '60', reps: '10' }}, {{ weight: '60', reps: '10' }}, {{ weight: '60', reps: '9' }}] }}] }}); save(); }}""")
        page.evaluate("startSession('sA')")
        page.wait_for_selector('.view.session')
        goal = txt(page, '.ex-card[data-ei="0"] .ex-goal')
        R.check(goal.startswith('Objectif 60 kg × 11') and 'Coach' not in goal, f'{t} sans charge : objectif comme avant ({goal!r})')
        R.check(page.evaluate("activeSession.exercises[0].sets.map(s => s.weight)") == ['60', '60', '60'], f'{t} sans charge : la dernière fois')
        R.check(not page.evaluate("activeSession.exercises[0].sets.some(s => s.pk)"), f'{t} sans charge : aucune prescription posée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_charges, t_sans_charge])
