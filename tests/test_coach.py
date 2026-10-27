"""Coach (Coach V1, app iOS simulée) : parcours de l'élève (Réglages › Coach, code, aperçu, Accepter,
cellule « Mon coach » de l'onglet Amis sans avoir activé Amis, badge, carte de l'accueil, programme reçu
ajouté, consignes dans Programme › Séance et dans la séance, commentaire dans Historique, mise à jour
d'un programme modifié avec la question avant d'écraser, Quitter mon coach) et du coach (Mes élèves,
nouvelles séances, « Ton programme », invitation partagée et retirée, séances d'un élève sans poids du
corps, commentaire, envoi d'un programme avec consignes, Retirer l'élève), hors ligne.

L'app iOS et Supabase sont simulés (tests/fake_account.py, règles de docs/COACH_V1.md) : aucune requête ne
sort. Captures : $PPL_SCRATCH/shots/lotcoach/ (chaque écran, clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_coach.py (ou run_all.py coach).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'coach'
R = Results(LOT)
DAY = 86400_000


# Mêmes outils que test_social.py (un import relancerait ses tests)
def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, ppl_v2=None, opts=None):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True, **(opts or {})}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2, extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username='max', enable=False):
    """Connexion Apple (compte existant), pseudo, social activé ou non : sans passer par les écrans."""
    page.evaluate("""async ([u, en]) => {
        await accountSignInWith('apple', async () => 'add');
        if (u) await accountSaveProfile({ username: u });
        if (en) await socialEnable(true);
    }""", [username, enable])
    page.wait_for_timeout(200)


def sessions(prefix, n, start_days=1, **extra):
    """Séances d'un ami au format de l'historique (avec ce que la liste blanche doit retirer)."""
    import time
    now = int(time.time() * 1000)
    out = []
    for i in range(n):
        out.append({'id': f'{prefix}{i:02d}', 'date': now - (start_days + i) * DAY, 'duration': (45 + i) * 60_000,
                    'programme': 'ppl', 'category': 'push', 'label': 'Push',
                    'notes': 'note privée', 'bodyKg': 81, 'healthSaved': True,
                    'exercises': [{'name': 'Développé couché', 'sets': [{'weight': '80', 'reps': '8'}, {'weight': '80', 'reps': '7'}]},
                                  {'name': 'Dips', 'sets': [{'weight': '', 'reps': '12'}]},
                                  {'name': 'Élévations latérales', 'sets': [{'weight': '8', 'reps': '15'}]},
                                  {'name': 'Pompes', 'sets': [{'weight': '', 'reps': '20'}]},
                                  {'name': 'Extension triceps', 'sets': [{'weight': '20', 'reps': '12'}]}], **extra})
    return out


def friends_tab(page):
    page.click('.tabbar [data-tab="friends"]')
    page.wait_for_timeout(500)


def calls(page, fn):
    return page.evaluate('f => __sb.calls.filter(c => c[0] === "social" && c[1] === f).map(c => JSON.parse(c[2]))', fn)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small_targets(page, sel='#app button, .tabbar button'):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def cut_texts(page):
    """Textes coupés ou qui débordent de leur boîte (hors champs de saisie)."""
    return page.evaluate("""() => [...document.querySelectorAll('#app *, .tabbar *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .icon *, .visually-hidden') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""")


def last_above_tabbar(page):
    """Fin de l'écran défilé : le dernier élément passe au-dessus de la barre d'onglets."""
    page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
    page.wait_for_timeout(150)
    r = page.evaluate("""() => { const scr = document.querySelector('#app .scr'); const last = scr && [...scr.querySelectorAll('*')].filter(e => e.offsetParent).pop();
        const bar = document.querySelector('.tabbar'); if (!last || !bar || bar.hidden) return true;
        return last.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top + .5; }""")
    page.evaluate('window.scrollTo(0, 0)')
    return r


def toast(page):
    return page.locator('.toast').inner_text() if page.locator('.toast').count() else ''



def ccalls(page, fn):
    return page.evaluate('f => __sb.calls.filter(c => c[0] === "coach" && c[1] === f).map(c => JSON.parse(c[2]))', fn)


def layout(page, t, name, tabbar=True):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page)
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')
    if tabbar:
        R.check(last_above_tabbar(page), f'{t} {name} : dernier élément au-dessus de la barre d\'onglets')


def tab_badge(page):
    b = page.locator('.tabbar [data-tab="friends"] .tabbar__badge')
    return b.inner_text() if b.count() else ''


# Programme du coach (perso, deux séances, superset, tempo, consignes)
COACH_PROG = {
    'name': 'Force', 'consigne': 'Trois séances par semaine, un jour de repos entre deux.',
    'sessions': [
        {'key': 'sA', 'label': 'Haut', 'color': '#FF9500', 'exercises': [
            {'name': 'Développé couché', 'sets': 4, 'rest': 120, 'tempo': '3-1-1-0', 'consigne': 'Coudes serrés, descends en 3 secondes.'},
            {'name': 'Rowing haltère unilatéral', 'sets': 4, 'ss': 'g1'},
            {'name': 'Pompes', 'sets': 3, 'ss': 'g1', 'consigne': 'Gainage serré.'}]},
        {'key': 'sB', 'label': 'Bas', 'color': '#34C759', 'exercises': [
            {'name': 'Squat barre', 'sets': 5, 'repMax': 5}]},
    ],
}


def setup_student(page):
    """Max est coach avec un code actif ; je suis connectée (lea), sans Amis activé."""
    return page.evaluate("""() => {
        const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false });
        __sb.makeCoach(max);
        __sb.co.invites.push({ code: 'K7M2QX9P', coach: max, expires: Date.now() + 7 * 86400000 });
        return { max, me: __sb.meId() };
    }""")


def t_eleve(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='lea')
        ids = setup_student(page)
        # Sans coach : pas de cellule dans Amis
        friends_tab(page)
        R.check(page.locator('.coach-cell').count() == 0, f'{t} sans coach : pas de cellule')
        # Réglages › Coach (depuis l'onglet Entraînement : l'onglet Amis garde sa racine)
        page.click('.tabbar [data-tab="train"]')
        page.wait_for_timeout(300)
        page.evaluate("navigate('settings')")
        page.wait_for_selector('[data-action="coach-open-settings"]')
        R.check('Rejoindre' in page.inner_text('[data-action="coach-open-settings"]'), f'{t} Réglages : cellule Coach « Rejoindre »')
        page.click('[data-action="coach-open-settings"]')
        page.wait_for_selector('[data-action="coach-join"]')
        layout(page, t, 'Réglages › Coach')
        shot(page, LOT, f'1-reglages-coach-{t}')
        # Code mal formé, puis code inconnu : messages clairs
        page.click('[data-action="coach-join"]')
        page.fill('.ios-dialog__input', 'abc')
        tap_dialog(page, 'Suivant')
        page.wait_for_timeout(300)
        R.check('bonne forme' in toast(page), f'{t} code mal formé refusé ({toast(page)!r})')
        page.click('[data-action="coach-join"]')
        page.fill('.ios-dialog__input', 'ZZZZZZZZ')
        tap_dialog(page, 'Suivant')
        page.wait_for_timeout(400)
        R.check('expiré' in toast(page), f'{t} code inconnu : invalid_code traduit ({toast(page)!r})')
        # Bon code (minuscules et tiret acceptés) : aperçu du coach et de ce qu'il verra
        page.wait_for_timeout(2600)
        page.click('[data-action="coach-join"]')
        page.fill('.ios-dialog__input', 'k7m2-qx9p')
        tap_dialog(page, 'Suivant')
        page.wait_for_selector('.coach-join-view')
        txt = page.inner_text('.coach-join-view')
        R.check('max' in txt and 'ce que max verra' in txt.lower() and 'masquées' in txt and 'poids' in txt, f'{t} aperçu : coach et ce qu\'il verra')
        R.check(ccalls(page, 'coach_preview')[-1] == {'code': 'K7M2QX9P'} and not ccalls(page, 'coach_join'), f'{t} aperçu sans rien créer')
        layout(page, t, 'aperçu du coach')
        shot(page, LOT, f'2-apercu-{t}')
        page.click('[data-action="coach-accept"]')
        page.wait_for_selector('.coach-view [data-action="coach-leave"]')
        R.check(page.evaluate(f"__sb.co.links.some(l => l.coach === '{ids['max']}' && l.student === __sb.meId())"), f'{t} lien créé')
        R.check('max est ton coach' in toast(page), f'{t} toast de confirmation ({toast(page)!r})')
        shot(page, LOT, f'3-reglages-suivi-{t}')
        # Le coach envoie un programme : badge et carte de l'accueil
        page.evaluate("""([max, prog]) => { __sb.co.progs.push({ coach: max, student: __sb.meId(), id: 'u_force', data: prog, sent_at: new Date().toISOString(), seen: false }); }""", [ids['max'], COACH_PROG])
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        R.check(tab_badge(page) == '1', f'{t} badge de l\'onglet Amis : 1 programme ({tab_badge(page)!r})')
        page.click('.tabbar [data-tab="train"]')
        page.wait_for_timeout(400)
        page.wait_for_selector('.coach-home')
        R.check('Nouveau programme de max' in page.inner_text('.coach-home') and 'Force' in page.inner_text('.coach-home'), f'{t} carte de l\'accueil')
        R.check(small_targets(page, '.coach-home button') == [], f'{t} carte : 44 pt')
        shot(page, LOT, f'4-accueil-carte-{t}')
        # Onglet Amis sans Amis activé : cellule « Mon coach » en haut, carte d'activation dessous
        friends_tab(page)
        cell = page.locator('[data-action="coach-open-mine"]')
        R.check(cell.count() == 1 and 'max' in cell.inner_text(), f'{t} Amis : cellule Mon coach')
        R.check(page.locator('[data-action="social-enable"]').count() == 1, f'{t} Amis pas activé : carte d\'activation dessous')
        R.check(page.evaluate("document.querySelector('.coach-cell').getBoundingClientRect().top < document.querySelector('.social-hero').getBoundingClientRect().top"), f'{t} cellule en haut')
        layout(page, t, 'Amis avec coach')
        shot(page, LOT, f'5-amis-cellule-{t}')
        cell.click()
        page.wait_for_selector('.coach-mine-view .coach-prog')
        R.check('Trois séances par semaine' in page.inner_text('.coach-prog'), f'{t} Mon coach : consigne du programme')
        layout(page, t, 'Mon coach')
        shot(page, LOT, f'6-mon-coach-{t}')
        page.click('.coach-prog [data-action="coach-add-prog"]')
        page.wait_for_timeout(400)
        R.check('Passer à « Force »' in page.inner_text('.ios-dialog'), f'{t} ajouté : proposition de passer au programme')
        tap_dialog(page, 'Passer à ce programme')
        page.wait_for_timeout(300)
        R.check(page.evaluate('data.activeProgramme') == 'u_cu_force', f'{t} programme u_c<id> actif')
        R.check(page.evaluate("__sb.co.progs[0].seen") is True and tab_badge(page) == '', f'{t} programme vu : badge retiré')
        R.check('Dans tes programmes' in page.inner_text('.coach-prog'), f'{t} carte : « Dans tes programmes »')
        up = page.evaluate('data.userProgrammes.u_cu_force')
        R.check(up['fromCoach']['name'] == 'max' and up['consigne'].startswith('Trois'), f'{t} fromCoach et consigne gardés')
        # Gardés par la synchro du profil
        page.evaluate('syncNow()')
        page.wait_for_timeout(300)
        # Programme › Séance : consignes du programme et de l'exercice
        page.evaluate("routeTo('programmes'); navigate(makeRoute('editor', 'sA'))")
        page.wait_for_selector('.editor')
        ed = page.inner_text('.editor')
        R.check('consigne de max' in ed.lower() and 'Coudes serrés' in ed and 'Gainage serré' in ed, f'{t} Programme › Séance : consignes')
        layout(page, t, 'Programme › Séance')
        shot(page, LOT, f'7-programme-consignes-{t}')
        # Séance : consigne sous le nom, repliable d'un toucher
        page.evaluate("startSession('sA')")
        page.wait_for_selector('.coach-tip')
        R.check(page.locator('.coach-tip').count() == 2, f'{t} séance : 2 consignes (exercice seul et superset) ({page.locator(".coach-tip").count()})')
        tip = page.locator('.coach-tip').first
        R.check(tip.get_attribute('aria-expanded') == 'true' and 'Coudes serrés' in tip.inner_text(), f'{t} consigne dépliée')
        shot(page, LOT, f'8-seance-consigne-{t}')
        R.check(small_targets(page, '.coach-tip') == [], f'{t} consigne : 44 pt')
        tip.click()
        page.wait_for_timeout(200)
        R.check(page.locator('.coach-tip').first.get_attribute('aria-expanded') == 'false', f'{t} consigne repliée d\'un seul toucher')
        page.evaluate("activeSession = null; persistSession(); routeTo('dashboard')")
        page.wait_for_timeout(200)
        # Commentaire du coach sur une séance : Historique › Séance
        sid = page.evaluate('data.history[0].id')
        page.evaluate("""([max, sid]) => { __sb.co.notes.push({ coach: max, student: __sb.meId(), sid, text: 'Belle séance, garde ce rythme.', updated_at: new Date().toISOString(), seen: false }); }""", [ids['max'], sid])
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        R.check(tab_badge(page) == '1', f'{t} commentaire : badge 1')
        page.click('.tabbar [data-tab="history"]')
        page.wait_for_timeout(300)
        page.click(f'[data-action="open-history"][data-id="{sid}"]')
        page.wait_for_selector('.coach-note')
        R.check('commentaire de max' in page.inner_text('.history-detail').lower() and 'Belle séance' in page.inner_text('.coach-note'), f'{t} Historique : commentaire du coach')
        page.wait_for_timeout(300)
        R.check(page.evaluate('__sb.co.notes[0].seen') is True and tab_badge(page) == '', f'{t} commentaire vu : badge retiré')
        page.evaluate("document.querySelector('.coach-note').scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'9-historique-commentaire-{t}')
        # Mise à jour d'un programme modifié par l'élève : question avant d'écraser
        page.evaluate("data.programmes.u_cu_force.exercises.sB[0].sets = 3; save();")
        v2 = json.loads(json.dumps(COACH_PROG))
        v2['sessions'][0]['exercises'][0]['sets'] = 5
        page.evaluate("""(prog) => { const p = __sb.co.progs[0]; p.data = prog; p.sent_at = new Date(Date.now() + 5000).toISOString(); p.seen = false; }""", v2)
        page.evaluate('coachRefresh()')
        page.evaluate("routeTo('friends'); navigate('coach-mine')")
        page.wait_for_selector('.coach-prog [data-action="coach-add-prog"]')
        R.check('Mettre à jour' in page.inner_text('.coach-prog'), f'{t} nouvel envoi : « Mettre à jour »')
        before_id = page.evaluate('data.programmes.u_cu_force.exercises.sA[0].id')
        page.click('.coach-prog [data-action="coach-add-prog"]')
        page.wait_for_timeout(300)
        R.check('Remplacer tes changements' in page.inner_text('.ios-dialog'), f'{t} programme modifié : question avant d\'écraser')
        shot(page, LOT, f'10-conflit-{t}')
        tap_dialog(page, 'Garder ma version')
        page.wait_for_timeout(300)
        R.check(page.evaluate('data.programmes.u_cu_force.exercises.sB[0].sets') == 3 and page.evaluate('data.programmes.u_cu_force.exercises.sA[0].sets') == 4, f'{t} « Garder ma version » : rien d\'écrasé')
        R.check('Dans tes programmes' in page.inner_text('.coach-prog'), f'{t} version refusée plus proposée')
        # Nouvel envoi accepté : identifiants gardés
        page.evaluate("""() => { const p = __sb.co.progs[0]; p.sent_at = new Date(Date.now() + 10000).toISOString(); p.seen = false; }""")
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        page.click('.coach-prog [data-action="coach-add-prog"]')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Prendre la nouvelle version')
        page.wait_for_timeout(300)
        R.check(page.evaluate('data.programmes.u_cu_force.exercises.sA[0].sets') == 5 and page.evaluate('data.programmes.u_cu_force.exercises.sA[0].id') == before_id, f'{t} mis à jour, identifiant d\'exercice gardé')
        # Quitter mon coach
        page.click('[data-action="coach-leave"]')
        page.wait_for_timeout(300)
        R.check('Les programmes déjà ajoutés restent' in page.inner_text('.ios-dialog'), f'{t} quitter : expliqué')
        tap_dialog(page, 'Quitter mon coach')
        page.wait_for_timeout(500)
        R.check(page.evaluate('__sb.co.links.length') == 0 and page.evaluate("!!data.userProgrammes.u_cu_force"), f'{t} lien supprimé, programme gardé')
        R.check(page.locator('.coach-cell').count() == 0, f'{t} plus de cellule Mon coach')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def setup_coach(page):
    """Je suis coach (max) ; Léa (35 séances dont une masquée, une avec mon programme, notes et poids), Tom (aucune séance)."""
    now = int(time.time() * 1000)
    lea = []
    for i in range(35):
        lea.append({'id': f'l{i:02d}', 'date': now - (i + 1) * DAY + 3600_000, 'duration': 50 * 60_000, 'programme': 'ppl', 'category': 'push', 'label': 'Push',
                    'notes': 'Épaule un peu raide' if i == 0 else '', 'bodyKg': 61, 'healthSaved': True,
                    'exercises': [{'name': 'Développé couché', 'sets': [{'weight': '40', 'reps': '8'}, {'weight': '40', 'reps': '7'}]},
                                  {'name': 'Rowing', 'ss': 'g1', 'sets': [{'weight': '20', 'reps': '10'}]},
                                  {'name': 'Pompes', 'ss': 'g1', 'sets': [{'weight': '', 'reps': '15'}]}]})
    lea[0].update({'programme': 'u_cu_force', 'category': 'sA', 'label': 'Haut'})
    lea[1]['hidden'] = True
    return page.evaluate("""(s) => {
        const me = __sb.meId();
        __sb.makeCoach(me);
        const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false, sessions: s });
        const tom = __sb.addPerson({ username: 'tom' });
        __sb.link(me, lea, Date.now() - 20 * 86400000);
        __sb.link(me, tom);
        __sb.co.links.find(l => l.student === lea).seen = Date.now() - 3 * 86400000;
        // Mon programme Force
        data.userProgrammes.u_force = { name: 'Force', archived: false, sessions: {
          sA: { label: 'Haut', icon: '', desc: '', color: '#FF9500' }, sB: { label: 'Bas', icon: '', desc: '', color: '#34C759' } } };
        data.programmes.u_force = { timers: {}, cooldowns: {}, exercises: {
          sA: [{ id: 'e1', name: 'Développé couché', sets: 4, rest: 120, lastWeight: '80' }, { id: 'e2', name: 'Rowing', sets: 4, ss: 'g1' }, { id: 'e3', name: 'Pompes', sets: 3, ss: 'g1' }],
          sB: [{ id: 'e4', name: 'Squat barre', sets: 5 }] } };
        data.myProgrammes.push('u_force'); save();
        return { me, lea, tom };
    }""", lea)


def t_coach(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        ids = setup_coach(page)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        R.check(tab_badge(page) == '3', f'{t} badge : 3 nouvelles séances de Léa ({tab_badge(page)!r})')
        R.check('nouveauté' in (page.get_attribute('.tabbar [data-tab="friends"]', 'aria-label') or ''), f'{t} badge annoncé par VoiceOver')
        friends_tab(page)
        cell = page.locator('[data-action="coach-open-students"]')
        R.check(cell.count() == 1 and '2 élèves' in cell.inner_text() and cell.locator('.coach-count').inner_text() == '3', f'{t} Amis : cellule Mes élèves et pastille')
        cell.click()
        page.wait_for_selector('.coach-students-view')
        row = page.locator('.coach-student-row', has_text='lea')
        rt = row.inner_text()
        R.check('Haut · ton programme · hier' in rt, f'{t} dernière séance « Haut · ton programme · hier » ({rt!r})')
        R.check('séances en 7 jours' in rt and row.locator('.coach-count').inner_text() == '3', f'{t} séances sur 7 jours et nouvelles séances')
        R.check('Aucune séance' in page.locator('.coach-student-row', has_text='tom').inner_text(), f'{t} élève sans séance')
        layout(page, t, 'Mes élèves')
        shot(page, LOT, f'11-mes-eleves-{t}')
        # Invitation : code créé et partagé, puis retiré
        page.click('[data-action="coach-invite"]')
        page.wait_for_timeout(400)
        codes = page.evaluate('coach.state.invites.map(i => i.code)')
        R.check(len(codes) == 1 and page.locator('.coach-invite').count() == 1, f'{t} code d\'invitation créé ({codes})')
        R.check(page.evaluate("__sb.calls.some(c => c[0] === 'coach' && c[1] === 'coach_create_invite')"), f'{t} coach_create_invite appelé')
        layout(page, t, 'Mes élèves avec code')
        shot(page, LOT, f'12-invitation-{t}')
        R.check(page.evaluate(f"coachInviteText('{codes[0]}')").count(codes[0]) == 1 and ' - ' not in page.evaluate(f"coachInviteText('{codes[0]}')"), f'{t} texte d\'invitation')
        page.click('[data-action="coach-revoke-invite"]')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Retirer le code')
        page.wait_for_timeout(400)
        R.check(page.locator('.coach-invite').count() == 0, f'{t} code retiré')
        # Séances de Léa : vues à l'ouverture, « Ton programme », liste blanche
        row = page.locator('.coach-student-row', has_text='lea')
        row.click()
        page.wait_for_selector('.coach-sess')
        page.wait_for_timeout(300)
        R.check(ccalls(page, 'coach_mark_seen') == [{'student': ids['lea']}], f'{t} coach_mark_seen à l\'ouverture')
        R.check(tab_badge(page) == '', f'{t} séances vues : badge retiré')
        R.check(page.locator('.coach-sess').count() == 30, f'{t} 30 séances par page ({page.locator(".coach-sess").count()})')
        R.check(page.locator('.coach-sess[data-id="l00"] .coach-tag').inner_text() == 'Ton programme' and page.locator('.coach-sess[data-id="l01"] .coach-tag').count() == 0, f'{t} « Ton programme » sur la bonne séance')
        R.check('61' not in page.inner_text('.coach-student-view'), f'{t} jamais le poids du corps')
        R.check(page.evaluate(f"Object.keys(coachSessions('{ids['lea']}').rows[0].s).includes('bodyKg')") is False, f'{t} séance reçue sans bodyKg')
        layout(page, t, 'séances d\'un élève')
        shot(page, LOT, f'13-eleve-{t}')
        page.click('[data-action="coach-more"]')
        page.wait_for_timeout(400)
        got = page.evaluate("[...document.querySelectorAll('.coach-sess')].map(c => c.dataset.id)")
        R.check(len(got) == 35 and len(set(got)) == 35, f'{t} page suivante : 35 séances sans doublon ({len(got)})')
        befores = [c for c in ccalls(page, 'coach_student_sessions') if c.get('before_at')]
        R.check(len(befores) == 1 and befores[0]['before_id'] == 'l29', f'{t} curseur (done_at, id) {befores}')
        # Détail d'une séance (notes comprises, masquée visible) et commentaire
        page.click('.coach-sess[data-id="l00"]')
        page.wait_for_selector('.coach-session-view')
        d = page.inner_text('.coach-session-view')
        R.check('Épaule un peu raide' in d and 'Ton programme' in d and 'Force' in d and '40 kg × 8 · 7' in d, f'{t} détail : séries, notes, programme ({d[:160]!r})')
        layout(page, t, 'séance d\'un élève')
        shot(page, LOT, f'14-seance-eleve-{t}')
        page.click('[data-action="coach-comment"]')
        page.wait_for_selector('#coachSheetText')
        page.fill('#coachSheetText', 'Belle séance, garde 2 minutes de repos.')
        shot(page, LOT, f'15-commentaire-{t}')
        # Hors ligne : message clair, texte gardé pour le prochain essai
        page.evaluate('__sb.fail.coach = "offline"')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(500)
        R.check('Pas d\'Internet' in toast(page) and not page.evaluate('__sb.co.notes.length'), f'{t} commentaire hors ligne : message ({toast(page)!r})')
        page.evaluate('__sb.fail.coach = null')
        page.wait_for_timeout(300)
        page.click('[data-action="coach-comment"]')
        page.wait_for_selector('#coachSheetText')
        R.check(page.input_value('#coachSheetText').startswith('Belle séance'), f'{t} commentaire hors ligne : rien de perdu')
        page.click('.sheet__btn--confirm')
        page.wait_for_timeout(500)
        notes = page.evaluate('__sb.co.notes')
        R.check(len(notes) == 1 and notes[0]['sid'] == 'l00' and notes[0]['text'].startswith('Belle'), f'{t} commentaire enregistré {notes}')
        R.check('Belle séance' in page.inner_text('.coach-session-view .coach-note') and 'Modifier le commentaire' in page.inner_text('.coach-session-view'), f'{t} commentaire affiché')
        page.click('[data-action="back"]')
        page.wait_for_selector('.coach-sess')
        R.check(page.locator('.coach-sess[data-id="l00"] .coach-tag--note').count() == 1, f'{t} séance « Commentée »')
        # Séance masquée aux abonnés : visible du coach, et dit
        page.click('.coach-sess[data-id="l01"]')
        page.wait_for_selector('.coach-session-view')
        R.check('masquée à ses abonnés' in page.inner_text('.coach-session-view'), f'{t} séance masquée visible du coach')
        page.click('[data-action="back"]')
        page.wait_for_selector('.coach-sess')
        # Envoyer un programme avec consignes
        page.click('[data-action="coach-send"]')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Force')
        page.wait_for_selector('.coach-send-view')
        page.fill('.coach-textarea[data-prog]', 'Trois séances par semaine.')
        page.fill('.coach-textarea[data-ex="e1"]', 'Coudes serrés.')
        layout(page, t, 'envoi d\'un programme')
        shot(page, LOT, f'16-envoi-{t}')
        page.click('[data-action="coach-send-go"]')
        page.wait_for_timeout(500)
        progs = page.evaluate('__sb.co.progs')
        ok = len(progs) == 1 and progs[0]['id'] == 'u_force' and progs[0]['student'] == ids['lea']
        p = progs[0]['data'] if progs else {}
        R.check(ok and p.get('consigne') == 'Trois séances par semaine.' and p['sessions'][0]['exercises'][0].get('consigne') == 'Coudes serrés.', f'{t} programme envoyé avec consignes')
        R.check(ok and p['sessions'][0]['exercises'][1].get('ss') == 'g1' and 'lastWeight' not in json.dumps(p), f'{t} supersets envoyés, sans charges')
        R.check(page.evaluate("data.programmes.u_force.exercises.sA[0].consigne") == 'Coudes serrés.', f'{t} consignes gardées pour le prochain envoi')
        R.check(page.evaluate('view') == 'coach-student' and 'envoyé à lea' in toast(page), f'{t} retour à l\'élève, toast ({toast(page)!r})')
        # Retirer un élève
        page.evaluate(f"navigate(makeRoute('coach-student', '{ids['tom']}'))")
        page.wait_for_selector('[data-action="coach-remove"]')
        page.click('[data-action="coach-remove"]')
        page.wait_for_timeout(300)
        tap_dialog(page, "Retirer l'élève")
        page.wait_for_timeout(500)
        R.check(page.evaluate(f"!__sb.co.links.some(l => l.student === '{ids['tom']}')") and page.evaluate('view') == 'coach-students', f'{t} élève retiré')
        R.check(page.locator('.coach-student-row').count() == 1, f'{t} plus qu\'un élève')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_hors_ligne(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='lea')
        page.evaluate('__sb.fail.coach = "offline"; coachReset(account.user.id)')
        page.evaluate("navigate('coach')")
        page.wait_for_timeout(500)
        txt = page.inner_text('.coach-view')
        R.check('Pas d\'Internet' in txt and page.locator('[data-action="coach-retry"]').count() == 1, f'{t} hors ligne : message et « Réessayer » ({txt!r})')
        layout(page, t, 'hors ligne')
        shot(page, LOT, f'17-hors-ligne-{t}')
        page.evaluate('__sb.fail.coach = null')
        page.click('[data-action="coach-retry"]')
        page.wait_for_selector('[data-action="coach-join"]')
        R.check(True, f'{t} réseau revenu')
        # Rejoindre hors ligne : rien de perdu, message clair
        page.evaluate('__sb.fail.coach = "offline"')
        page.click('[data-action="coach-join"]')
        page.fill('.ios-dialog__input', 'K7M2QX9P')
        tap_dialog(page, 'Suivant')
        page.wait_for_timeout(400)
        R.check('Pas d\'Internet' in toast(page), f'{t} rejoindre hors ligne ({toast(page)!r})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    # Sans compte : Réglages › Coach explique et propose de se connecter
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        page.evaluate("navigate('coach')")
        page.wait_for_selector('.coach-view [data-action="social-sign-in"]')
        R.check(page.evaluate("__sb.calls.filter(c => c[0] === 'coach').length") == 0, f'{t} sans compte : aucun appel')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_eleve, t_coach, t_hors_ligne])
