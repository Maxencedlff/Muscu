"""Suivi du coach (docs/COACH_SUIVI.md, app iOS simulée) :
- planification : côté coach, Mes élèves › Planning (une ligne par élève), « Mini cut · sem. 3/6 » dans la liste,
  groupe Planification de la fiche, planning d'un élève (frise, en cours, à venir, terminées), feuille d'une phase
  (ajout, chevauchement refusé, modification, suppression) ; côté élève, « Ta phase » dans Mon coach sans la note du
  coach, et la phase discrète sous le nom du coach dans l'onglet Amis ;
- bilan : l'élève coche « Mensurations » (tout décoché par défaut, envoi, nouvelle mesure renvoyée, textes de
  Progrès › Mesures adaptés, décocher efface) ; le coach voit le poids (courbe) et les mensurations (liste, courbe) ;
- serveur pas encore à jour (planification ou mensurations absentes, PGRST202) : rien ne s'affiche, aucune erreur ;
  hors ligne : message clair, rien de perdu.

L'app iOS et Supabase sont simulés (tests/fake_account.py, règles de 20261105000000_coach_planning.sql et
20261105010000_partage_mensurations.sql) : aucune requête ne sort. Horloge figée au mercredi 25 novembre 2026.
Captures : $PPL_SCRATCH/shots/lotsuivi/ (chaque écran, clair et sombre).
Lancer : PPL_DEV="iPhone 13" python3 test_coach_suivi.py (ou run_all.py coach_suivi).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'suivi'
R = Results(LOT)
NOW = local_ms(2026, 11, 25, 10, tz=PARIS)   # mercredi : le mini cut du lundi 9 nov. est en semaine 3 sur 6


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, opts=None):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True, **(opts or {})}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(now_ms=NOW), extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username):
    page.evaluate("""async u => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: u }); }""", username)
    page.wait_for_timeout(200)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small_targets(page, sel='#app button, .tabbar button, .sheet button, .sheet label.plan-chip'):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def cut_texts(page):
    return page.evaluate("""() => [...document.querySelectorAll('#app *, .tabbar *, .sheet *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, select, option, svg, use, .icon *, .visually-hidden') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""")


def toast(page):
    return page.locator('.toast').last.inner_text() if page.locator('.toast').count() else ''


def ccalls(page, fn):
    return page.evaluate('f => __sb.calls.filter(c => c[0] === "coach" && c[1] === f).map(c => JSON.parse(c[2]))', fn)


def layout(page, t, name):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page)
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')


def go(page, route_js, sel):
    page.evaluate(f"navigate({route_js})")
    page.wait_for_selector(sel)
    page.wait_for_timeout(400)


def setup_coach(page, phases=True, measures=True):
    """Je suis coach (max) ; Léa a un planning (reprise terminée, mini cut en cours, prise de masse à venir), partage son
    poids et ses mensurations ; Tom n'a rien."""
    d = DAY
    weights = [{'date': NOW - k * d, 'kg': kg} for k, kg in [(1, 61.4), (5, 61.7), (9, 61.9), (13, 62.3), (17, 62.6), (21, 62.8), (26, 63.0), (33, 63.1)]]
    meas = {'waist': [{'date': NOW - k * d, 'cm': cm} for k, cm in [(2, 71.5), (9, 72.0), (16, 72.8), (23, 73.5), (30, 74.0)]],
            'hips': [{'date': NOW - k * d, 'cm': cm} for k, cm in [(2, 92.0), (16, 92.5), (30, 93.0)]],
            'armR': [{'date': NOW - 2 * d, 'cm': 29.5}]}
    return page.evaluate("""([ph, w, m, me_]) => {
        const me = __sb.meId();
        __sb.makeCoach(me);
        const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false, sessions: [{ id: 's1', date: Date.now() - 86400000, duration: 3000000, programme: 'ppl', category: 'pull', label: 'Pull', exercises: [] }] });
        const tom = __sb.addPerson({ username: 'tom', avatar: '🐼', social: false });
        __sb.link(me, lea, Date.now() - 60 * 86400000);
        __sb.link(me, tom, Date.now() - 30 * 86400000);
        if (ph) {
          __sb.addPhase(lea, { goal: 'comeback', start: '2026-10-26', weeks: 2 });
          __sb.addPhase(lea, { goal: 'mini_cut', name: 'Mini cut Léa', start: '2026-11-09', weeks: 6, prog_name: 'Sèche 4 jours', note: 'Objectif −2 kg avant les fêtes' });
          __sb.addPhase(lea, { goal: 'bulk', start: '2026-12-21', weeks: 12 });
        }
        if (m) { __sb.share(lea, w); __sb.shareMeasures(lea, me_); }
        return { me, lea, tom };
    }""", [phases, weights, measures, meas])


def t_planning_coach(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'max')
        ids = setup_coach(page)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(400)
        # Mes élèves : cellule Planning, ligne « Mini cut Léa · sem. 3/6 »
        go(page, "'coach-students'", '.coach-students-view .coach-student-row')
        cell = page.locator('[data-action="plan-overview"]')
        R.check(cell.count() == 1 and '1 élève en phase cette semaine' in cell.inner_text(), f'{t} Mes élèves : cellule Planning ({cell.inner_text() if cell.count() else ""!r})')
        row = page.locator('.coach-student-row', has_text='lea').inner_text()
        R.check('Mini cut Léa · sem. 3/6' in row, f'{t} Mes élèves : où en est Léa ({row!r})')
        R.check('sem.' not in page.locator('.coach-student-row', has_text='tom').inner_text(), f'{t} Tom : rien de planifié, pas de ligne')
        layout(page, t, 'Mes élèves')
        shot(page, LOT, f'1-mes-eleves-{t}')
        # Vue d'ensemble
        cell.click()
        page.wait_for_selector('.coach-planning-view .plan-gantt__row')
        page.wait_for_timeout(300)
        rows = page.locator('.plan-gantt__row')
        R.check(rows.count() == 2, f'{t} planning : une ligne par élève')
        R.check(page.locator('.plan-gantt__row', has_text='lea').locator('.plan-gantt__bar').count() == 3, f'{t} planning : les 3 phases de Léa dans la fenêtre')
        R.check('Rien de planifié' in page.locator('.plan-gantt__row', has_text='tom').inner_text(), f'{t} planning : Tom, rien de planifié')
        lbl = page.locator('.plan-gantt__row', has_text='lea').get_attribute('aria-label') or ''
        R.check('Mini cut Léa, semaine 3 sur 6' in lbl, f'{t} planning : annoncé à VoiceOver ({lbl!r})')
        layout(page, t, 'Planning')
        shot(page, LOT, f'2-planning-{t}')
        # Fiche de Léa : carte de la phase en cours, sans la note pour… le coach la voit
        go(page, f"makeRoute('coach-student', '{ids['lea']}')", '.coach-student-view .plan-card')
        card = page.locator('.coach-student-view .plan-card').first.inner_text()
        R.check('Semaine 3 sur 6' in card and 'Mini cut Léa' in card and 'Programme : Sèche 4 jours' in card and 'Objectif −2 kg' in card,
                f'{t} fiche : phase en cours, programme et note du coach ({card!r})')
        R.check(page.locator('.plan-card .plan-weeks > .is-done').count() == 2 and page.locator('.plan-card .plan-weeks > .is-now').count() == 1,
                f'{t} fiche : 2 semaines faites, la 3e en cours')
        layout(page, t, 'Fiche (planification)')
        shot(page, LOT, f'3-fiche-planification-{t}')
        # Planning complet de Léa
        page.click('[data-action="plan-open"]')
        page.wait_for_selector('.coach-plan-view .plan-line')
        page.wait_for_timeout(300)
        txt = page.inner_text('.coach-plan-view')   # titres de groupe en capitales (CSS) : comparés en minuscules
        R.check('en cours' in txt.lower() and 'à venir' in txt.lower() and 'terminées' in txt.lower() and '3 phases' in txt, f'{t} planning de Léa : sections ({txt[:160]!r})')
        R.check(page.locator('.plan-line__seg').count() == 3, f'{t} frise : 3 segments')
        layout(page, t, 'Planning de Léa')
        shot(page, LOT, f'4-planning-lea-{t}')
        # Ajouter une phase : début proposé après la dernière (15 mars), 4 semaines par défaut, 5 après +
        page.click('.coach-plan-view [data-action="plan-add"]')
        page.wait_for_selector('.sheet .plan-form')
        page.wait_for_timeout(300)
        R.check(page.input_value('#planStart') == '2027-03-15', f'{t} nouvelle phase : début proposé le lendemain de la dernière ({page.input_value("#planStart")})')
        page.click('.plan-chip:has(input[value="cut"])')
        page.click('#planWeeksInc')
        R.check(page.inner_text('#planWeeks') == '5 semaines' and 'Fin le dimanche 18 avril' in page.inner_text('#planEnd'), f'{t} durée et fin ({page.inner_text("#planEnd")!r})')
        R.check(page.get_attribute('#planName', 'placeholder') == 'Sèche', f'{t} nom proposé : l\'objectif')
        layout(page, t, 'Nouvelle phase')
        shot(page, LOT, f'5-nouvelle-phase-{t}')
        page.fill('#planName', 'Sèche été')
        page.fill('#planNote', 'Vérifier le tour de taille chaque lundi')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(500)
        saved = ccalls(page, 'coach_plan_save')
        R.check(len(saved) == 1 and saved[0]['goal'] == 'cut' and saved[0]['weeks'] == 5 and saved[0]['start_date'] == '2027-03-15' and saved[0]['name'] == 'Sèche été',
                f'{t} enregistrée sur le serveur ({saved})')
        R.check(page.locator('.sheet').count() == 0 and 'ajoutée' in toast(page), f'{t} feuille fermée, toast ({toast(page)!r})')
        R.check(page.locator('.coach-plan-view .plan-card').count() == 4, f'{t} 4 phases à l\'écran')
        # Chevauchement : refusé avant l'envoi, la feuille reste ouverte
        page.click('.coach-plan-view [data-action="plan-add"]')
        page.wait_for_selector('.sheet .plan-form')
        page.click('.plan-chip:has(input[value="deload"])')
        page.fill('#planStart', '2026-12-01')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(400)
        R.check(page.locator('.sheet .plan-form').count() == 1 and 'Chevauche « Mini cut Léa »' in toast(page), f'{t} chevauchement refusé ({toast(page)!r})')
        R.check(len(ccalls(page, 'coach_plan_save')) == 1, f'{t} chevauchement : rien d\'envoyé')
        page.click('.sheet__btn--cancel')
        page.wait_for_timeout(400)
        # Modifier la phase en cours : feuille préremplie
        page.locator('.coach-plan-view .plan-card', has_text='Mini cut Léa').click()
        page.wait_for_selector('.sheet .plan-form')
        page.wait_for_timeout(300)
        R.check(page.input_value('#planName') == 'Mini cut Léa' and page.inner_text('#planWeeks') == '6 semaines'
                and page.is_checked('input[value="mini_cut"]') and page.input_value('#planProg') == 'Sèche 4 jours', f'{t} modifier : feuille préremplie')
        shot(page, LOT, f'6-modifier-phase-{t}')
        page.click('#planWeeksDec')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(500)
        R.check(ccalls(page, 'coach_plan_save')[-1]['weeks'] == 5 and ccalls(page, 'coach_plan_save')[-1]['phase_id'] is not None, f'{t} modifiée (5 semaines)')
        R.check('Semaine 3 sur 5' in page.inner_text('.coach-plan-view'), f'{t} carte à jour')
        # Supprimer la phase ajoutée
        page.locator('.coach-plan-view .plan-card', has_text='Sèche été').click()
        page.wait_for_selector('#planDelete')
        page.click('#planDelete')
        page.wait_for_timeout(400)
        tap_dialog(page, 'Supprimer')
        page.wait_for_timeout(400)
        R.check(len(ccalls(page, 'coach_plan_delete')) == 1 and page.locator('.coach-plan-view .plan-card').count() == 3, f'{t} phase supprimée')
        # Hors ligne : message clair, la feuille reste ouverte avec la saisie
        page.evaluate('__sb.fail.plan = "offline"')
        page.click('.coach-plan-view [data-action="plan-add"]')
        page.wait_for_selector('.sheet .plan-form')
        page.click('.plan-chip:has(input[value="maintain"])')
        page.fill('#planName', 'Garder')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(400)
        R.check('Internet' in toast(page) and page.input_value('#planName') == 'Garder', f'{t} hors ligne : message, saisie gardée ({toast(page)!r})')
        page.click('.sheet__btn--cancel')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_planning_eleve(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'lea')
        page.evaluate("""() => {
            const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false });
            __sb.makeCoach(max);
            __sb.link(max, __sb.meId(), Date.now() - 60 * 86400000);
            __sb.addPhase(__sb.meId(), { goal: 'mini_cut', start: '2026-11-09', weeks: 6, prog_name: 'Sèche 4 jours', note: 'NOTE PRIVÉE DU COACH' });
            __sb.addPhase(__sb.meId(), { goal: 'bulk', start: '2026-12-21', weeks: 12 });
        }""")
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(500)
        page.click('.tabbar [data-tab="friends"]')
        page.wait_for_timeout(500)
        sub = page.locator('[data-action="coach-open-mine"] .cell__sub').inner_text()
        R.check('max · Mini cut, semaine 3 sur 6' in sub, f'{t} Amis : phase discrète sous le coach ({sub!r})')
        shot(page, LOT, f'7-amis-eleve-{t}')
        page.click('[data-action="coach-open-mine"]')
        page.wait_for_selector('.coach-mine-view .plan-card')
        page.wait_for_timeout(300)
        txt = page.inner_text('.coach-mine-view')
        R.check('ta phase' in txt.lower() and 'Semaine 3 sur 6' in txt and 'Programme : Sèche 4 jours' in txt and 'Ensuite : Prise de masse' in txt, f'{t} Mon coach : ma phase ({txt[:200]!r})')
        R.check('NOTE PRIVÉE' not in page.content(), f'{t} la note du coach n\'arrive jamais chez l\'élève')
        R.check(page.locator('.coach-mine-view button.plan-card').count() == 0, f'{t} élève : carte en lecture seule')
        layout(page, t, 'Mon coach (phase)')
        shot(page, LOT, f'8-mon-coach-phase-{t}')
        # Déconnexion : le planning gardé pour le hors ligne quitte l'appareil
        R.check(page.evaluate("localStorage.getItem('mdlf_coach_plan')") is not None, f'{t} planning gardé sur l\'appareil (hors ligne)')
        page.evaluate("localStorage.setItem('mdlf_coach_share_m', JSON.stringify({ userId: __sb.meId(), coachId: 'x', hash: 'h' }))")
        page.evaluate('accountSignOut()')
        page.wait_for_timeout(400)
        R.check(page.evaluate("localStorage.getItem('mdlf_coach_plan')") is None and page.evaluate("localStorage.getItem('mdlf_coach_share_m')") is None,
                f'{t} déconnexion : mdlf_coach_plan et mdlf_coach_share_m effacés')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_echappement(bench, eng, dev, theme):
    """Nom de phase et programme hostiles (venus du serveur) : affichés comme du texte, jamais interprétés."""
    t = tag(dev, theme)
    evil = '<img src=x onerror="window.__xss=1">'
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'max')
        ids = setup_coach(page, measures=False)
        page.evaluate(f"""e => {{ const p = __sb.co.phases.find(x => x.goal === 'mini_cut'); p.name = e.slice(0, 40); p.prog_name = e.slice(0, 40); p.note = e; }}""", evil)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(400)
        for route, sel in [("'coach-students'", '.coach-students-view .coach-student-row'), ("'coach-planning'", '.coach-planning-view .plan-gantt__row'),
                           (f"makeRoute('coach-student', '{ids['lea']}')", '.coach-student-view .plan-card'), (f"makeRoute('coach-plan', '{ids['lea']}')", '.coach-plan-view .plan-card')]:
            go(page, route, sel)
            R.check(page.locator('#app img[src="x"]').count() == 0 and '<img' in page.inner_text('#app'), f'{t} {route} : texte hostile affiché tel quel')
        page.locator('.coach-plan-view .plan-card').first.click()
        page.wait_for_selector('.sheet .plan-form')
        page.wait_for_timeout(300)
        R.check(page.input_value('#planName') == evil[:40] and page.locator('.sheet img[src="x"]').count() == 0, f'{t} feuille : valeur du champ, pas du HTML')
        page.click('.sheet__btn--cancel')
        R.check(page.evaluate('window.__xss') is None, f'{t} aucun script exécuté')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_serveur_ancien(bench, eng, dev, theme):
    """Serveur sans planification ni mensurations (PGRST202) : rien ne s'affiche, aucune erreur."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'max')
        page.evaluate('__sb.fail.plan = "missing"; __sb.fail.measures = "missing"')
        ids = setup_coach(page, phases=False, measures=False)
        page.evaluate(f"__sb.share('{ids['lea']}', [{{ date: Date.now() - 86400000, kg: 61 }}, {{ date: Date.now() - 9 * 86400000, kg: 62 }}])")
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(400)
        go(page, "'coach-students'", '.coach-students-view .coach-student-row')
        R.check(page.locator('[data-action="plan-overview"]').count() == 0, f'{t} ancien serveur : pas de cellule Planning')
        go(page, f"makeRoute('coach-student', '{ids['lea']}')", '.coach-student-view .coach-join__who')
        page.wait_for_timeout(300)
        txt = page.inner_text('.coach-student-view')
        R.check('planification' not in txt.lower() and 'mensurations' not in txt.lower() and 'poids du corps' in txt.lower(), f'{t} ancien serveur : fiche sans planification ni mensurations, poids gardé')
        R.check(not page.errors, f'{t} ancien serveur : aucune erreur JS {page.errors}')
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'lea')
        page.evaluate("""() => { __sb.fail.plan = 'missing'; __sb.fail.measures = 'missing';
            const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false }); __sb.makeCoach(max); __sb.link(max, __sb.meId()); }""")
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(400)
        go(page, "'coach-share'", '.coach-share-view [data-action="coach-share-toggle"]')
        R.check(page.locator('[data-action="coach-share-toggle"]').count() == 1, f'{t} ancien serveur : la case du poids seule')
        go(page, "'coach-mine'", '.coach-mine-view .coach-join__who')
        R.check('ta phase' not in page.inner_text('.coach-mine-view').lower(), f'{t} ancien serveur : pas de phase')
        R.check(not page.errors, f'{t} ancien serveur (élève) : aucune erreur JS {page.errors}')


def t_mesures_eleve(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'lea')
        me = page.evaluate("""() => {
            const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false });
            __sb.makeCoach(max); __sb.link(max, __sb.meId(), Date.now() - 10 * 86400000);
            data.bodyMeasures = { waist: [{ date: Date.now() - 2 * 86400000, cm: 71.5 }, { date: Date.now() - 9 * 86400000, cm: 72 }], armR: [{ date: Date.now() - 2 * 86400000, cm: 29.5 }] };
            save(); return __sb.meId();
        }""")
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(400)
        go(page, "'coach-share'", '.coach-share-view [data-kind="measures"]')
        m = page.locator('[data-action="coach-share-toggle"][data-kind="measures"]')
        txt = page.inner_text('.coach-share-view')
        R.check(m.get_attribute('aria-checked') == 'false' and ccalls(page, 'student_share_measures') == [], f'{t} mensurations : décochées par défaut, rien d\'envoyé')
        R.check('chaque mensuration' in txt and 'photos' in txt and 'effacé du serveur' in txt, f'{t} texte : ce que voit le coach, pas les photos, révocable')
        layout(page, t, 'Partager (mensurations)')
        shot(page, LOT, f'9-partager-mensurations-{t}')
        m.click()
        page.wait_for_timeout(500)
        sent = ccalls(page, 'student_share_measures')
        R.check(len(sent) == 1 and sorted(sent[0]['measures']) == ['armR', 'waist'] and len(sent[0]['measures']['waist']) == 2, f'{t} cocher : mensurations envoyées ({sent})')
        R.check(page.locator('[data-action="coach-share-toggle"][data-kind="measures"]').get_attribute('aria-checked') == 'true'
                and '3 mesures partagées' in page.inner_text('.coach-share-view'), f'{t} coché, « 3 mesures partagées »')
        R.check(ccalls(page, 'student_share_weights') == [], f'{t} poids pas coché : aucune pesée envoyée')
        shot(page, LOT, f'10-partager-mensurations-on-{t}')
        # Progrès › Mesures : le texte dit que c'est partagé
        page.click('.tabbar [data-tab="train"]')
        go(page, "'body-measures'", '.body-measures .bm-private')
        R.check('Partagées avec ton coach' in page.inner_text('.bm-private'), f'{t} Mesures : « Partagées avec ton coach »')
        shot(page, LOT, f'11-mesures-partagees-{t}')
        # Nouvelle mesure : renvoyée
        page.click('[data-action="bm-add"]')
        page.wait_for_selector('.sheet .bm-in')
        page.fill('.bm-in[data-key="hips"]', '92')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(500)
        sent = ccalls(page, 'student_share_measures')
        R.check(len(sent) == 2 and 'hips' in sent[-1]['measures'], f'{t} nouvelle mesure renvoyée')
        # Décocher : effacé du serveur
        go(page, "'coach-share'", '.coach-share-view [data-kind="measures"]')
        page.click('[data-action="coach-share-toggle"][data-kind="measures"]')
        page.wait_for_timeout(400)
        R.check(page.evaluate(f"__sb.co.measures['{me}']") is None and page.evaluate('__sb.co.shares.length') == 0, f'{t} décocher : mensurations effacées')
        R.check('effacées du serveur' in toast(page), f'{t} toast ({toast(page)!r})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_bilan_coach(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'max')
        ids = setup_coach(page)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(400)
        go(page, f"makeRoute('coach-student', '{ids['lea']}')", '.coach-student-view [data-action="coach-open-measures"]')
        page.locator('[data-action="coach-open-measures"]').scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        txt = page.inner_text('.coach-student-view')
        R.check('poids du corps' in txt.lower() and '61,4 kg' in txt and page.locator('#exChart canvas').count() == 1, f'{t} fiche : poids et sa courbe')
        cell = page.inner_text('[data-action="coach-open-measures"]')
        R.check('3 mesures partagées' in cell and 'taille −2,5 cm depuis le début' in cell, f'{t} fiche : mensurations ({cell!r})')
        layout(page, t, 'Fiche (bilan)')
        shot(page, LOT, f'12-fiche-bilan-{t}')
        page.click('[data-action="coach-open-measures"]')
        page.wait_for_selector('.coach-measures-view .bm-cell')
        page.wait_for_timeout(300)
        R.check(page.locator('.coach-measures-view .bm-cell').count() == 3, f'{t} mensurations : 3 mesures')
        R.check('71,5 cm' in page.inner_text('.coach-measures-view'), f'{t} mensurations : dernière taille')
        layout(page, t, 'Mensurations de Léa')
        shot(page, LOT, f'13-mensurations-{t}')
        page.locator('.coach-measures-view .bm-cell', has_text='Taille').click()
        page.wait_for_selector('.coach-measure-view #exChart canvas')
        page.wait_for_timeout(500)
        mt = page.inner_text('.coach-measure-view')
        R.check('Taille' in mt and '−2,5 cm' in mt and page.locator('.coach-measure-view .cell').count() >= 6, f'{t} courbe de la taille et historique')
        layout(page, t, 'Courbe de la taille')
        shot(page, LOT, f'14-courbe-taille-{t}')
        # Léa arrête : la fiche relue n'a plus de mensurations
        page.evaluate(f"__sb.co.shares = __sb.co.shares.filter(x => x.kind !== 'measures'); delete __sb.co.measures['{ids['lea']}']")
        go(page, f"makeRoute('coach-student', '{ids['lea']}')", '.coach-student-view .coach-join__who')
        page.wait_for_timeout(400)
        R.check(page.locator('[data-action="coach-open-measures"]').count() == 0, f'{t} partage coupé : plus de mensurations')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_apercu_message(bench, eng, dev, theme):
    """Panel du 06/11 : message de Léa « coupé » sur la fiche (iPhone SE). Voulu : la cellule Messages montre un
    aperçu de deux lignes au plus (comme Messages d'iOS), le message entier est dans la conversation."""
    t = tag(dev, theme)
    body = "J'ai senti mon épaule sur le développé, je baisse la charge ?"
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'max')
        ids = setup_coach(page, phases=False, measures=False)
        page.evaluate("([lea, b]) => { __sb.msg(lea, false, b, Date.now() - 3 * 3600e3); }", [ids['lea'], body])
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(400)
        go(page, f"makeRoute('coach-student', '{ids['lea']}')", '.coach-student-view .chat-cell')
        page.wait_for_timeout(300)
        last = page.locator('.chat-cell__last')
        R.check(last.text_content() == body, f'{t} fiche : aperçu tiré du dernier message ({last.text_content()!r})')
        lines = page.evaluate("""() => { const e = document.querySelector('.chat-cell__last'), cs = getComputedStyle(e);
            return [cs.webkitLineClamp, Math.round(e.getBoundingClientRect().height / parseFloat(cs.lineHeight))]; }""")
        R.check(lines[0] == '2' and lines[1] <= 2, f'{t} fiche : aperçu sur deux lignes au plus {lines}')
        page.locator('.chat-cell').scroll_into_view_if_needed()
        shot(page, LOT, f'15-fiche-message-{t}')
        page.click('.chat-cell')
        page.wait_for_selector('.coach-chat-view .chat-msg')
        page.wait_for_timeout(300)
        bubble = page.locator('.chat-msg--theirs .chat-msg__bubble').last
        R.check(body in bubble.inner_text() and page.evaluate("(() => { const b = [...document.querySelectorAll('.chat-msg--theirs .chat-msg__bubble')].pop(); return b.scrollWidth <= b.clientWidth + 1 && b.scrollHeight <= b.clientHeight + 1; })()"),
                f'{t} conversation : message entier, jamais coupé')
        shot(page, LOT, f'16-conversation-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_planning_coach, t_planning_eleve, t_echappement, t_serveur_ancien, t_mesures_eleve, t_bilan_coach, t_apercu_message])
