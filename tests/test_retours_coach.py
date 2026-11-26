"""Retours de Sophie (coach, 45 ans, iPhone SE, 26/11/2026) et des juges sur captures, mode coach de l'app :
- « Créer un programme pour camille » depuis sa fiche, sans détour par l'onglet Programme ; le programme créé ne devient
  JAMAIS le programme actif du coach sans qu'il le demande (fiche, onglet Programme « Pour moi / Pour un élève ») ; il se
  règle dans sa page sans être activé (séance, exercices) puis « Envoyer à camille » ;
- deux gestes, deux mots : « Envoyer à un élève » (choix de l'élève puis Envoyer) et « Partager une copie » (feuille de
  partage, sinon copié avec un toast) ;
- fiche : « Charges par exercice » (courbe sur plusieurs semaines), « Envoyer un bilan » (vraie demande de bilan,
  coach_checkin_send_now, jamais un commentaire), dernière demande et son état ;
- chiffres qui concordent : records de la liste = somme des cartes de séances ; volume de la carte de tête = volume de
  la séance ; pas de « 0 record » avant la lecture ;
- inviter un élève : un geste crée ET partage, un code encore bon est repris (aucun doublon) ;
- textes : validation du rôle, « 7 derniers jours » sans mini-barres, note du volume sans jargon ;
- fourchette 8–12 : le bas est une vraie valeur (pas un texte d'exemple), et part dans l'envoi (repMin) ;
- juges : « Lourde / Allégée » en français, palier conseillé mis en avant, compteurs de l'onglet Coach qui s'additionnent.

App iOS et Supabase simulés (tests/fake_account.py, tests/fake_checkins.py) : aucune requête ne sort. Identifiants factices.
Captures : $PPL_SCRATCH/shots/lotretours_coach/ (clair et sombre).
Lancer : PPL_URL=http://127.0.0.1:8795/ PPL_DEV="iPhone SE" PPL_THEME=dark python3 tests/test_retours_coach.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT
from fake_checkins import FAKE_CHECKINS

LOT = 'retours_coach'
R = Results(LOT)
NOW = local_ms(2026, 11, 3, 18, 0, tz=PARIS)   # mardi
DAY = 86_400_000

# Feuille de partage simulée : chaque texte partagé est gardé ; window.__shareFail = 'NotAllowedError' la fait refuser
# (geste expiré, comme Safari après un appel réseau) ; le presse-papiers est simulé aussi
SHARE_STUB = r"""
window.__shared = []; window.__copied = [];
navigator.share = async o => {
  if (window.__shareFail) { const e = new Error('refusé'); e.name = window.__shareFail; throw e; }
  window.__shared.push(o.text);
};
try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied.push(t); } } }); } catch {}
"""


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, checkins=True):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
    page.add_init_script(FAKE_ACCOUNT)
    if checkins:
        page.add_init_script(FAKE_CHECKINS)
    page.add_init_script(SHARE_STUB)
    page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(now_ms=NOW), extra={'ppl_welcome_seen': '1'})
    settle(page)
    # Coquille iOS simulée : la feuille de partage d'iOS (Native.shareText) garde le texte partagé
    page.evaluate("Native.shareText = async t => { window.__shared.push(t); return 'shared'; }")


def signin(page, username):
    page.evaluate("""async u => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: u }); }""", username)
    settle(page)


def camille_sessions():
    """8 semaines de Haut / Legs, Squat barre de 60 à 80 kg ; deux records cette semaine (Haut d'hier, Push du 1er)."""
    out = []
    for i, d in enumerate([1, 2, 4, 9, 16, 23, 30, 37, 44, 51]):
        kg = 80 - d * 0.4
        squat = {'name': 'Squat barre', 'sets': [{'weight': '40', 'reps': '8', 'warmup': True}, {'weight': f'{kg:g}', 'reps': '8'}, {'weight': f'{kg:g}', 'reps': '7'}]}
        bench = {'name': 'Développé couché', 'sets': [{'weight': f'{50 + (60 - d) * 0.1:.1f}', 'reps': '10'}] * 3}
        recs = [{'ex': 'Squat barre', 'kind': 'charge', 'before': kg - 2.5, 'after': kg}] if d in (1, 2) else []
        out.append({'id': f'c{i:02d}', 'date': days_back_ms(NOW, d, 18, tz=PARIS), 'duration': 50 * 60_000, 'programme': 'ppl',
                    'category': 'push', 'label': 'Haut' if i % 2 == 0 else 'Push', 'exercises': [squat, bench], 'records': recs})
    return out


def setup_coach(page, invites=False):
    ids = page.evaluate("""s => {
        const me = __sb.meId();
        __sb.makeCoach(me);
        const camille = __sb.addPerson({ username: 'camille', avatar: '🦊', social: false, sessions: s });
        __sb.link(me, camille, Date.now() - 20 * 86400000);
        __sb.co.links.find(l => l.student === camille).seen = Date.now();
        const leo = __sb.addPerson({ username: 'leo', avatar: '🐻', social: false, sessions: [] });
        __sb.link(me, leo, Date.now() - 10 * 86400000);
        // Mon programme à moi, « Force », réglé avec une fourchette dont le bas n'est pas écrit (8 à 12 par défaut)
        data.userProgrammes.u_force = { name: 'Force', archived: false, sessions: { sA: { label: 'Jambes', icon: '', desc: '', color: '#34C759' } } };
        data.programmes.u_force = { timers: {}, cooldowns: {}, exercises: { sA: [{ id: 'e1', name: 'Presse à cuisses', sets: 3, repMax: 12 }] } };
        data.myProgrammes.push('u_force'); save();
        return { me, camille, leo };
    }""", camille_sessions())
    page.evaluate('coachRefresh()')
    settle(page)
    return ids


def fiche(page, uid):
    page.evaluate(f"routeTo('friends'); navigate(makeRoute('coach-student', '{uid}'))")
    page.wait_for_selector('.coach-student-view .coach-sess')
    settle(page)


def ccalls(page, fn):
    return page.evaluate('f => __sb.calls.filter(c => c[1] === f).map(c => JSON.parse(c[2] || "null"))', fn)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small_targets(page, sel):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def fill_dialog(page, text):
    page.wait_for_selector('.ios-dialog__input')
    page.fill('.ios-dialog__input', text)


# ── 1 et 2. Programme créé pour l'élève, jamais activé ─────────────
def t_programme_eleve(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'sophie')
        ids = setup_coach(page)
        active0 = page.evaluate('data.activeProgramme')
        fiche(page, ids['camille'])
        page.click('[data-action="coach-send"]')
        page.wait_for_selector('.ios-dialog__btn:has-text("Créer un programme pour camille")')
        btns = page.evaluate("[...document.querySelectorAll('.ios-dialog__btn')].map(b => b.innerText.trim())")
        R.check(btns[0] == 'Créer un programme pour camille' and 'Force' in btns, f'{t} Envoyer un programme : « Créer un programme pour camille » en premier, puis mes programmes ({btns})')
        shot(page, LOT, f'01-envoyer-choix-{t}')
        tap_dialog(page, 'Créer un programme pour camille')
        fill_dialog(page, 'Camille débutante')
        tap_dialog(page, 'Suivant')
        tap_dialog(page, 'Copie du PPL') if page.locator('.ios-dialog__btn', has_text='Copie du PPL').count() else tap_dialog(page, 'Copie de PPL')
        page.wait_for_selector('.programmes [data-action="prog-send-student"]')
        settle(page)
        st = page.evaluate("""() => { const id = Object.keys(data.userProgrammes).find(k => data.userProgrammes[k].name === 'Camille débutante');
            return { id, active: data.activeProgramme, focus: progFocusId(), mine: data.myProgrammes.includes(id), view, tab: nav.tab }; }""")
        R.check(st['id'] and st['active'] == active0 and st['focus'] == st['id'] and st['mine'], f'{t} programme créé, PAS activé ({st})')
        sub = page.inner_text('.programmes .prog-page__state')
        R.check('Tes séances restent sur' in sub and 'Programme actif' not in sub, f'{t} page : « Tes séances restent sur … » ({sub!r})')
        btn = page.locator('.programmes [data-action="prog-send-student"]')
        R.check(btn.inner_text().strip() == 'Envoyer à camille' and btn.get_attribute('data-uid') == ids['camille'], f'{t} page : « Envoyer à camille »')
        R.check(no_hscroll(page) and not small_targets(page, '.programmes button'), f'{t} page : sans débordement, cibles de 44 pt')
        shot(page, LOT, f'02-programme-pour-camille-{t}')
        # Réglage sans activer : une séance du programme, ses exercices modifiés là, pas dans PPL
        page.locator('.programmes [data-action="open-prog-session"]').first.click()
        page.wait_for_selector('.editor, .view')
        settle(page)
        cat = page.evaluate("routeParams(currentRoute())[0]")
        before = page.evaluate("cat => JSON.stringify(data.programmes.ppl?.exercises?.[cat] || [])", cat)
        page.evaluate(f"(() => {{ const l = prog().exercises['{cat}']; l[0].sets = 5; save(); }})()")
        chk = page.evaluate(f"(() => ({{ mine: data.programmes['{st['id']}'].exercises['{cat}'][0].sets, ppl: JSON.stringify(data.programmes.ppl?.exercises?.['{cat}'] || []), active: data.activeProgramme }}))()")
        R.check(chk['mine'] == 5 and chk['ppl'] == before and chk['active'] == active0, f'{t} séance réglée : son programme changé, PPL intact, actif inchangé')
        page.evaluate('goBack()')
        settle(page)
        # Envoyer à camille → écran Envoyer → envoi
        page.click('.programmes [data-action="prog-send-student"]')
        page.wait_for_selector('.coach-send-view')
        page.click('[data-action="coach-send-go"]')
        settle(page)
        sent = ccalls(page, 'coach_send_programme')
        R.check(sent and sent[-1]['prog_id'] == st['id'] and sent[-1]['student'] == ids['camille'], f'{t} envoyé à camille ({[s["prog_id"] for s in sent]})')
        # L'accueil du coach : toujours son programme
        page.evaluate("switchTab('train', { reset: true })")
        settle(page)
        R.check(page.evaluate('data.activeProgramme') == active0 and page.evaluate('progFocusId()') == active0, f'{t} accueil : son programme à lui')
        # Widget et séance : le programme actif, même pendant le réglage
        page.evaluate(f"routeTo('program'); navigate(makeRoute('programmes', '{st['id']}'))")
        settle(page)
        R.check(page.evaluate('progFocusId()') == st['id'] and page.evaluate('onActiveProgramme(() => progFocusId())') == active0, f'{t} onActiveProgramme : l\'actif pendant le réglage')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_creer_pour_qui(bench, eng, dev, theme):
    t = tag(dev, theme)
    if theme != 'dark':
        return
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'sophie')
        setup_coach(page)
        active0 = page.evaluate('data.activeProgramme')
        for who, expect_active in (('Pour un élève', False), ('Pour moi', True)):
            page.evaluate("switchTab('program', { reset: true }); navigate('prog-add')")
            page.wait_for_selector('.prog-add [data-action="new-programme"]')
            page.click('.prog-add [data-action="new-programme"]')
            fill_dialog(page, f'Essai {who}')
            tap_dialog(page, 'Suivant')
            tap_dialog(page, 'Programme vide')
            page.wait_for_selector('.ios-dialog__btn:has-text("Pour un élève")')
            if who == 'Pour un élève':
                shot(page, LOT, f'03-pour-qui-{t}')
            tap_dialog(page, who)
            settle(page)
            id_ = page.evaluate(f"Object.keys(data.userProgrammes).find(k => data.userProgrammes[k].name === 'Essai {who}')")
            act = page.evaluate('data.activeProgramme')
            R.check((act == id_) == expect_active and (expect_active or act == active0), f'{t} « {who} » : actif = {act == id_} (attendu {expect_active})')
            page.evaluate('goBack()')   # première séance (programme vide) : retour à la page
            settle(page)
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ── 3. Envoyer à un élève / Partager une copie ─────────────────────
def t_envoyer_partager(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'sophie')
        ids = setup_coach(page)
        page.evaluate("activateProgramme('u_force'); save(); switchTab('program', { reset: true }); navigate('programmes')")
        page.wait_for_selector('.programmes [data-action="share-programme"]')
        settle(page)
        labels = page.evaluate("[...document.querySelectorAll('.programmes [data-action=\"prog-send-student\"], .programmes [data-action=\"share-programme\"]')].map(b => b.innerText.trim())")
        R.check(labels == ['Envoyer à un élève', 'Partager une copie'], f'{t} deux boutons, deux mots ({labels})')
        icons = page.evaluate("[...document.querySelectorAll('.programmes [data-action=\"prog-send-student\"] use, .programmes [data-action=\"share-programme\"] use')].map(u => u.getAttribute('href'))")
        R.check(icons == ['#i-paperplane', '#i-square.and.arrow.up'], f'{t} une icône, un sens ({icons})')
        shot(page, LOT, f'04-envoyer-partager-{t}')
        # Partager : feuille de partage
        page.click('[data-action="share-programme"]')
        settle(page)
        R.check(page.evaluate('window.__shared.length') == 1 and 'Force' in page.evaluate('window.__shared[0]'), f'{t} Partager une copie : feuille de partage')
        # Navigateur (hors app) dont la feuille est refusée (geste expiré) : copié, et on le dit
        page.evaluate("Native.isNative = false; window.__shareFail = 'NotAllowedError'")
        page.click('[data-action="share-programme"]')
        settle(page)
        R.check(page.evaluate('window.__copied.length') == 1 and 'Copié' in page.inner_text('.toast'), f'{t} partage refusé : copié avec un toast')
        page.evaluate("Native.isNative = true; window.__shareFail = null")
        # Envoyer à un élève : choix de l'élève, puis Envoyer
        page.click('[data-action="prog-send-student"]')
        page.wait_for_selector('.ios-dialog__btn:has-text("camille")')
        btns = page.evaluate("[...document.querySelectorAll('.ios-dialog__btn')].map(b => b.innerText.trim())")
        R.check(btns[:2] == ['camille', 'leo'], f'{t} choix de l\'élève ({btns})')
        tap_dialog(page, 'camille')
        page.wait_for_selector('.coach-send-view')
        R.check('Pour camille' in page.inner_text('.coach-send-view .scr-sub'), f'{t} écran Envoyer pour camille')
        # Sans compte coach : un seul bouton, « Partager ce programme »
        page.evaluate("coach.state.is_coach = false; render()")
        page.evaluate("goBack()")
        settle(page)
        R.check(page.locator('.programmes [data-action="prog-send-student"]').count() == 0 and page.inner_text('.programmes [data-action="share-programme"]').strip() == 'Partager ce programme',
                f'{t} sans compte coach : « Partager ce programme » seul')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ── 4. Fiche : courbe de charge, bilan, chiffres ───────────────────
def t_fiche(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'sophie')
        ids = setup_coach(page)
        # Liste : rien avant la lecture de la progression, puis la même somme que les cartes
        page.evaluate("progress.loadedAt = 0; progress.available = null")
        html = page.evaluate("coachTeamWeekHtml(coach.state.students)")
        R.check(html == '', f'{t} liste : pas de « 0 record » avant la lecture')
        page.evaluate("routeTo('friends'); navigate('coach-students')")
        page.wait_for_selector('.coach-student-row[data-signal]')
        settle(page)
        sig = page.locator('.coach-student-row', has_text='camille').locator('.progress-sig').inner_text()
        fiche(page, ids['camille'])
        cards = page.evaluate("""() => [...document.querySelectorAll('.coach-sess')].filter(b => {
            const s = coachSessionOf(b.dataset.uid, b.dataset.id); return s && Date.now() - s.doneAt <= 7 * 86400000; })
            .reduce((a, b) => a + (parseInt(b.querySelector('.hcell__rec')?.textContent) || 0), 0)""")
        R.check(f'{cards} records en 7 jours' in sig, f'{t} records : liste « {sig} » = cartes des séances ({cards})')
        # Volume : carte de tête = page de la séance
        hero = page.inner_text('.cstu-hero')
        page.click('.cstu-hero [data-action="coach-open-session"]')
        page.wait_for_selector('.coach-session-view')
        vol = page.evaluate("[...document.querySelectorAll('.coach-session-view .tile')].find(x => x.innerText.includes('Volume'))?.querySelector('.tile__val').innerText")
        R.check(vol and vol in hero, f'{t} volume : carte de tête et séance d\'accord ({vol!r} dans {hero!r})')
        foot = page.inner_text('.review-rule')
        R.check('lest ajouté' not in foot and 'aide déduite' not in foot and foot.startswith('Volume : charge × reps'), f'{t} note du volume sans jargon ({foot!r})')
        page.evaluate('goBack()')
        settle(page)
        # 7 derniers jours : une phrase, plus de mini-barres
        wk = page.inner_text('.progress-week')
        R.check(page.locator('.progress-week .wkbars').count() == 0 and 'par 7 jours' not in wk and "Les 7 jours d'avant" in wk, f'{t} 7 derniers jours en mots ({wk!r})')
        # Courbe de charge
        cell = page.locator('[data-action="coach-ex-progress"]')
        R.check(cell.count() == 1 and 'Squat barre' in cell.inner_text(), f'{t} fiche : « Charges par exercice » ({cell.inner_text() if cell.count() else ""!r})')
        shot(page, LOT, f'05-fiche-{t}')
        page.screenshot(path=os.path.join(SHOTS, f'lot{LOT}', f'05b-fiche-entiere-{t}.png'), full_page=True)
        cell.click()
        page.wait_for_selector('.coach-exp-view #exChart canvas')
        settle(page)
        R.check(page.inner_text('.coach-exp-view .scr-title') == 'Squat barre' and '+' in page.inner_text('.coach-exp-view .scr-sub'), f'{t} courbe : Squat barre, en hausse')
        R.check(page.locator('.coach-exp-row').count() == 2, f'{t} courbe : ses deux exercices')
        R.check(no_hscroll(page) and not small_targets(page, '.coach-exp-view button'), f'{t} courbe : sans débordement, 44 pt')
        shot(page, LOT, f'06-courbe-{t}')
        page.locator('.coach-exp-row', has_text='Développé couché').click()
        settle(page)
        R.check(page.inner_text('.coach-exp-view .scr-title') == 'Développé couché', f'{t} courbe : un toucher change d\'exercice')
        page.evaluate('goBack()')
        settle(page)
        # Envoyer un bilan : vrai bilan, jamais un commentaire
        page.wait_for_selector('[data-action="coach-ck-send"]')
        page.click('[data-action="coach-ck-send"]')
        page.wait_for_selector('.ios-dialog__btn:has-text("Hebdo")')
        shot(page, LOT, f'07-bilan-choix-{t}')
        tap_dialog(page, 'Express')
        settle(page)
        sends = ccalls(page, 'coach_checkin_send_now')
        R.check(len(sends) == 1 and sends[0]['students'] == [ids['camille']] and not ccalls(page, 'coach_set_note'), f'{t} bilan : coach_checkin_send_now, pas de commentaire')
        R.check(page.evaluate("__sb.ck.requests.filter(r => r.student === arguments[0]).length", ids['camille']) == 1 if False else
                page.evaluate(f"__sb.ck.requests.filter(r => r.student === '{ids['camille']}').length") == 1, f'{t} bilan : demande créée pour camille')
        foot = page.locator('[data-action="coach-ck-send"]').locator('xpath=../following-sibling::div[1]').inner_text()
        R.check('Express' in foot and 'pas encore rempli' in foot, f'{t} bilan : dernière demande sous l\'action ({foot!r})')
        # Deuxième envoi du même bilan : pas doublé, et on le dit
        page.click('[data-action="coach-ck-send"]')
        page.wait_for_selector('.ios-dialog__btn:has-text("Express")')
        tap_dialog(page, 'Express')
        settle(page)
        R.check('déjà ce bilan' in page.inner_text('.toast'), f'{t} bilan : pas de doublon')
        shot(page, LOT, f'08-bilan-envoye-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_bilan_serveur_ancien(bench, eng, dev, theme):
    t = tag(dev, theme)
    if theme != 'light':
        return
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, checkins=False)
        signin(page, 'sophie')
        ids = setup_coach(page)
        fiche(page, ids['camille'])
        R.check(page.locator('[data-action="coach-ck-send"]').count() == 0, f'{t} serveur sans les bilans : pas d\'action')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ── Inviter : un geste, sans doublon ───────────────────────────────
def t_inviter(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'sophie')
        setup_coach(page)
        page.evaluate("coachPro.code = null; routeTo('friends'); navigate('coach-students')")
        page.wait_for_selector('[data-action="coach-invite"]')
        n0 = len(ccalls(page, 'coach_create_invite'))
        page.click('[data-action="coach-invite"]')
        settle(page)
        shared = page.evaluate('window.__shared')
        codes = page.evaluate("coach.state.invites.map(i => i.code)")
        R.check(len(ccalls(page, 'coach_create_invite')) == n0 + 1 and len(shared) == 1 and codes and codes[0] in shared[0], f'{t} un toucher : code créé ET partagé ({codes})')
        page.click('[data-action="coach-invite"]')
        settle(page)
        R.check(len(ccalls(page, 'coach_create_invite')) == n0 + 1 and len(page.evaluate('window.__shared')) == 2 and codes[0] in page.evaluate('window.__shared[1]'),
                f'{t} deuxième toucher : le même code repartagé, aucun doublon')
        shot(page, LOT, f'09-inviter-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ── Fourchette : affichée et envoyée ───────────────────────────────
def t_fourchette(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'sophie')
        ids = setup_coach(page)
        fiche(page, ids['camille'])
        page.evaluate(f"navigate(makeRoute('coach-send', '{ids['camille']}', 'u_force'))")
        page.wait_for_selector('.coach-send-view')
        page.click('.coach-presc-btn[data-ex="e1"]')
        page.wait_for_selector('.coach-presc-view')
        R.check(page.input_value('#cpMin') == '8' and page.input_value('#cpMax') == '12', f'{t} bas de fourchette : une vraie valeur, 8 ({page.input_value("#cpMin")!r})')
        shot(page, LOT, f'10-fourchette-{t}')
        page.fill('#cpLoad', '100')
        page.click('[data-action="coach-presc-ok"]')
        page.wait_for_selector('.coach-send-view')
        txt = page.inner_text('.coach-presc-btn[data-ex="e1"]')
        R.check('100 kg × 8–12' in txt, f'{t} envoi : « 100 kg × 8–12 » ({txt!r})')
        page.click('[data-action="coach-send-go"]')
        settle(page)
        ex = ccalls(page, 'coach_send_programme')[-1]['data']['sessions'][0]['exercises'][0]
        R.check(ex.get('repMin') == 8 and ex.get('repMax') == 12 and ex.get('load') == 100, f'{t} envoi : fourchette 8 à 12 ET charge ({ex})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ── Textes et juges ────────────────────────────────────────────────
def t_textes(bench, eng, dev, theme):
    t = tag(dev, theme)
    if theme != 'dark':
        return
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'sophie')
        setup_coach(page)
        R.check(page.evaluate("TECHS.top.label") == 'Lourde' and page.evaluate("TECHS.backoff.label") == 'Allégée', f'{t} Lourde / Allégée en français')
        # Onglet Coach : Messages + Mes amis = pastille
        page.evaluate("routeTo('friends')")
        settle(page)
        segs = page.evaluate("[...document.querySelectorAll('.social-seg .segmented__btn')].map(b => b.innerText.trim())")
        R.check(segs[0] == 'Élèves' and segs[1].startswith('Messages') and segs[2].startswith('Mes amis'), f'{t} segments ({segs})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_programme_eleve, t_creer_pour_qui, t_envoyer_partager, t_fiche, t_bilan_serveur_ancien, t_inviter, t_fourchette, t_textes])
