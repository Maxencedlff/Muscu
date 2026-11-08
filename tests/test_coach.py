"""Coach (Coach V1, app iOS simulée) : parcours de l'élève (Réglages › Coach, code, aperçu, Accepter,
cellule « Mon coach » de l'onglet Social sans avoir activé le social, badge, carte de l'accueil, programme reçu
ajouté, consignes dans Programme › Séance et dans la séance, commentaire dans Historique, mise à jour
d'un programme modifié avec la question avant d'écraser, Quitter mon coach) et du coach (Mes élèves,
nouvelles séances, « Ton programme », invitation partagée et retirée, séances d'un élève sans poids du
corps, commentaire, envoi d'un programme avec consignes, Retirer l'élève ; onglet « Coach » ouvert sur
ses élèves, docs/SOCIAL_V2.md), hors ligne.

L'app iOS et Supabase sont simulés (tests/fake_account.py, règles de docs/COACH_V1.md) : aucune requête ne
sort. Captures : $PPL_SCRATCH/shots/lotcoach/ (chaque écran, clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_coach.py (ou run_all.py coach).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'coach'
R = Results(LOT)
DAY = 86400_000

# Horloge figée le mercredi 28 octobre 2026 à 23 h 10, heure de Paris (3 jours après le passage à l'heure
# d'hiver) : « hier », « en 7 jours » et les nouveautés ne dépendent plus de l'heure ni du jour du test.
# Tard le soir exprès : une séance posée à « maintenant − 1 jour + 1 h » tomberait aujourd'hui.
NOW = local_ms(2026, 10, 28, 23, 10, tz=PARIS)


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


def code_sheet(page, code, ok=True):
    """Feuille du code : saisie (ou texte collé), Suivant ; renvoie le texte d'aide (erreur) si la feuille reste ouverte."""
    page.wait_for_selector('#coachCode')
    page.fill('#coachCode', code)
    page.click('.sheet__btn--confirm')
    page.wait_for_timeout(500)
    if ok:
        return ''
    return page.inner_text('#coachCodeHelp') if page.locator('#coachCode').count() else ''


def tab_badge(page):
    b = page.locator('.tabbar [data-tab="friends"] .tabbar__badge')
    return b.inner_text() if b.count() else ''


# Programme du coach (perso, deux séances, superset, tempo, consignes)
COACH_PROG = {
    'name': 'Force', 'consigne': 'Trois séances par semaine, un jour de repos entre deux.',
    'sessions': [
        {'key': 'sA', 'label': 'Haut', 'color': '#FF9500', 'exercises': [
            {'name': 'Développé couché', 'sets': 4, 'rest': 120, 'tempo': '3-1-1-0', 'repMin': 8, 'repMax': 12, 'intens': 'drop-last',
             'grip': {'width': 'serree'}, 'consigne': 'Coudes serrés, descends en 3 secondes.'},
            {'name': 'Rowing haltère unilatéral', 'sets': 4, 'ss': 'g1'},
            {'name': 'Pompes', 'sets': 3, 'ss': 'g1', 'consigne': 'Gainage serré.'}]},
        {'key': 'sB', 'label': 'Bas', 'color': '#34C759', 'exercises': [
            {'name': 'Squat barre', 'sets': 5, 'repMax': 5}]},
    ],
}


def setup_student(page):
    """Max est coach avec un code actif ; je suis connectée (lea), sans le social activé."""
    return page.evaluate("""() => {
        const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false });
        __sb.makeCoach(max);
        __sb.co.invites.push({ code: 'K7M2QX9P', coach: max, expires: Date.now() + 7 * 86400000 });
        return { max, me: __sb.meId() };
    }""")


def t_eleve(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(now_ms=NOW))
        signin(page, username='lea')
        ids = setup_student(page)
        # Sans coach : « Rejoindre un coach » en tête, au-dessus de la carte d'activation (panel du 07/11)
        friends_tab(page)
        join = page.locator('[data-action="coach-join-start"]')
        R.check(join.count() == 1 and 'Tu as un code de ton coach' in join.inner_text() and page.locator('[data-action="coach-open-mine"]').count() == 0, f'{t} sans coach : cellule « Rejoindre un coach »')
        # Panel du 07/11 : sous la carte « Entraîne-toi avec tes amis », la cellule finissait sous la barre d'onglets
        pos = page.evaluate("""(() => { const j = document.querySelector('[data-action=coach-join-start]').getBoundingClientRect(),
            h = document.querySelector('.social-hero'), tb = document.querySelector('.tabbar').getBoundingClientRect().top;
            return !!h && j.bottom <= h.getBoundingClientRect().top + 1 && j.top >= 0 && j.bottom <= tb + 1; })()""")
        R.check(pos, f'{t} sans coach ni amis : « Rejoindre un coach » au-dessus de la carte des amis, visible sans défiler')
        R.check(page.locator('#coachCell [data-action="coach-join-start"]').count() == 1 and page.locator('#coachCell .coach-cell--mine').count() == 0, f'{t} sans coach : « Rejoindre un coach » en tête, pas de « Mon coach »')
        R.check(page.inner_text('.tabbar [data-tab="friends"] .tabbar__label') == 'Social', f'{t} élève : onglet « Social »')
        layout(page, t, 'Social sans coach')
        shot(page, LOT, f'0-amis-rejoindre-{t}')
        # Réglages › Coach (depuis l'onglet Entraînement : l'onglet Social garde sa racine)
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
        page.wait_for_selector('#coachCode')
        R.check(page.get_attribute('#coachCode', 'autocapitalize') == 'characters' and page.evaluate("document.activeElement.id") == 'coachCode', f'{t} champ du code : capitales, actif')
        R.check(page.locator('#coachCode').bounding_box()['height'] >= 44, f'{t} champ du code : 44 pt')
        help_ = code_sheet(page, 'abc', ok=False)
        R.check('Code introuvable' in help_ and page.input_value('#coachCode') == 'abc', f'{t} code mal formé : erreur dans la feuille, saisie gardée ({help_!r})')
        help_ = code_sheet(page, 'ZZZZZZZZ', ok=False)
        R.check('expiré' in help_ and page.input_value('#coachCode') == 'ZZZZZZZZ', f'{t} code inconnu : erreur entière dans la feuille ({help_!r})')
        shot(page, LOT, f'1b-code-faux-{t}')
        page.click('.sheet__btn--cancel')
        page.wait_for_timeout(300)
        # Bon code (minuscules et tiret acceptés) : aperçu du coach et de ce qu'il verra
        # Message d'invitation collé entier : le code est trouvé
        page.click('[data-action="coach-join"]')
        code_sheet(page, page.evaluate("coachInviteText('K7M2QX9P')"))
        page.wait_for_selector('.coach-join-view')
        txt = page.inner_text('.coach-join-view')
        R.check('max' in txt and 'ce que max verra' in txt.lower() and 'masquées' in txt and 'poids' in txt, f'{t} aperçu : coach et ce qu\'il verra')
        R.check('Des messages' in txt and 'Effacés quand le suivi s\'arrête' in txt, f'{t} aperçu : le coach pourra écrire des messages')
        R.check(ccalls(page, 'coach_preview')[-1] == {'code': 'K7M2QX9P'} and not ccalls(page, 'coach_join'), f'{t} aperçu sans rien créer')
        layout(page, t, 'aperçu du coach')
        shot(page, LOT, f'2-apercu-{t}')
        # Âge déclaré avant d'accepter (même règle que les amis)
        # Panel du 07/11 : « Jamais… ton poids » alors que le poids (et les mensurations) peuvent être partagés
        never = page.locator('.coach-join__item', has_text='Le reste').inner_text()
        R.check('poids' not in never and 'Ton poids et tes mensurations' in txt and 'Partager avec mon coach' in txt and 'Des plans diète' in txt,
                f'{t} aperçu : poids et mensurations « seulement si tu le choisis », plans diète listés')
        R.check(page.locator('[data-action="coach-accept"]').is_disabled() and page.get_attribute('[data-action="coach-accept"]', 'aria-describedby') == 'coachAgeHint',
                f'{t} « Accepter » grisé, décrit par l\'interrupteur 15 ans')
        # Panel du 07/11 : l'interrupteur sous la liste passait sous le pied collé ; il est dans le pied, avec « Accepter »
        vis = page.evaluate("""(() => { const tb = document.querySelector('.tabbar').getBoundingClientRect().top;
            return ['[data-action=coach-age]', '[data-action=coach-accept]'].every(s => { const b = document.querySelector(s).getBoundingClientRect();
              return b.top >= 0 && b.bottom <= tb + 1 && b.height >= 43; }); })()""")
        R.check(vis, f'{t} interrupteur 15 ans et « Accepter » visibles sans défiler, 44 pt')
        foot = page.evaluate("Math.round(document.querySelector('.coach-join__foot').getBoundingClientRect().height)")
        R.check(foot <= 130 and page.locator('.coach-join__foot [data-action="coach-age"]').count() == 1, f'{t} pied collé : interrupteur et « Accepter » seulement ({foot} px)')
        page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)"); page.wait_for_timeout(200)
        last = page.evaluate("""(() => { const f = document.querySelector('.coach-join__foot').getBoundingClientRect(),
            items = [...document.querySelectorAll('.coach-join-view .coach-join__item')].at(-1).getBoundingClientRect();
            return items.bottom <= f.top + 1; })()""")
        R.check(last, f'{t} en bas : la dernière ligne au-dessus du pied, jamais dessous')
        page.evaluate("window.scrollTo(0, 0)"); page.wait_for_timeout(100)
        page.click('[data-action="coach-age"]')
        R.check(page.locator('[data-action="coach-age"]').get_attribute('aria-checked') == 'true' and page.locator('[data-action="coach-accept"]').is_enabled()
                and 'btn--primary' in page.get_attribute('[data-action="coach-accept"]', 'class'), f'{t} case 15 ans cochée : « Accepter » bouton principal')
        R.check(page.evaluate('socialAgeOk') is True, f'{t} même déclaration que pour les amis')
        page.click('[data-action="coach-accept"]')
        page.wait_for_selector('.coach-view [data-action="coach-leave"]')
        R.check(page.evaluate(f"__sb.co.links.some(l => l.coach === '{ids['max']}' && l.student === __sb.meId())"), f'{t} lien créé')
        R.check("C'est fait" in page.inner_text('.ios-dialog') and 'Social › Mon coach' in page.inner_text('.ios-dialog'), f'{t} message de bienvenue')
        tap_dialog(page, 'OK')
        shot(page, LOT, f'3-reglages-suivi-{t}')
        # Le coach envoie un programme : badge et carte de l'accueil
        page.evaluate("""([max, prog]) => { __sb.co.progs.push({ coach: max, student: __sb.meId(), id: 'u_force', data: prog, sent_at: new Date().toISOString(), seen: false }); }""", [ids['max'], COACH_PROG])
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        R.check(tab_badge(page) == '1', f'{t} badge de l\'onglet Social : 1 programme ({tab_badge(page)!r})')
        page.click('.tabbar [data-tab="train"]')
        page.wait_for_timeout(400)
        page.wait_for_selector('.coach-home')
        R.check('Nouveau programme de max' in page.inner_text('.coach-home') and 'Force' in page.inner_text('.coach-home'), f'{t} carte de l\'accueil')
        R.check(small_targets(page, '.coach-home button') == [], f'{t} carte : 44 pt')
        shot(page, LOT, f'4-accueil-carte-{t}')
        # Onglet Social sans le social activé : cellule « Mon coach » en haut, carte d'activation dessous
        friends_tab(page)
        cell = page.locator('[data-action="coach-open-mine"]')
        R.check(cell.count() == 1 and 'max' in cell.inner_text(), f'{t} Social : cellule Mon coach')
        R.check(page.locator('[data-action="social-enable"]').count() == 1, f'{t} social pas activé : carte d\'activation dessous')
        R.check(page.evaluate("document.querySelector('.coach-cell').getBoundingClientRect().top < document.querySelector('.social-optional').getBoundingClientRect().top"), f'{t} cellule en haut')
        # Panel du 07/11 : avec un coach, les amis sont en plus, pas l'étape suivante (plus de gros « Activer » bleu)
        en = page.locator('[data-action="social-enable"]')
        R.check(page.locator('.social-hero').count() == 0 and 'Amis (facultatif)' in page.text_content('#app') and en.inner_text().strip() == 'Ajouter aussi des amis'
                and 'btn--secondary' in en.get_attribute('class'), f'{t} amis facultatifs : titre de groupe et bouton secondaire')
        layout(page, t, 'Social avec coach')
        shot(page, LOT, f'5-amis-cellule-{t}')
        cell.click()
        page.wait_for_selector('.coach-mine-view .coach-prog')
        R.check('Trois séances par semaine' in page.inner_text('.coach-prog'), f'{t} Mon coach : consigne du programme')
        # Aperçu des exercices avant d'ajouter
        page.click('[data-action="coach-prog-toggle"]')
        page.wait_for_selector('.coach-prog__preview')
        R.check('Squat barre' in page.inner_text('.coach-prog__preview') and 'Coudes serrés' in page.inner_text('.coach-prog__preview'), f'{t} aperçu des exercices avant d\'ajouter')
        pv = page.locator('.coach-prog__preview li').first.inner_text().replace('\u00a0', ' ')
        R.check('8 à 12 reps' in pv and 'dernière en drop set' in pv and 'Prise serrée' in pv, f'{t} aperçu : fourchette, technique et prise ({pv!r})')
        # Panel du 07/11 : un 5 × 5 (seul le haut réglé) affichait « Squat barre · 5 séries » sans les reps
        sq = page.locator('.coach-prog__preview li', has_text='Squat barre').first.inner_text().replace('\u00a0', ' ')
        R.check('5 séries · 5 reps' in sq, f'{t} aperçu : reps fixes du coach ({sq!r})')
        R.check(page.evaluate("document.querySelector('.coach-prog__btn').getBoundingClientRect().height") < 60, f'{t} « Ajouter à mes programmes » sur une ligne')
        R.check(page.get_attribute('.coach-prog [data-action="coach-add-prog"]', 'aria-label') == 'Ajouter Force à mes programmes', f'{t} VoiceOver : bouton Ajouter nommé')
        layout(page, t, 'Mon coach')
        shot(page, LOT, f'6-mon-coach-{t}')
        page.click('.coach-prog [data-action="coach-add-prog"]')
        page.wait_for_timeout(400)
        R.check('Passer à « Force »' in page.inner_text('.ios-dialog'), f'{t} ajouté : proposition de passer au programme')
        tap_dialog(page, 'Passer à ce programme')
        page.wait_for_timeout(300)
        R.check(page.evaluate('data.activeProgramme') == 'u_c00000000_u_force', f'{t} programme u_c<id> actif')
        R.check(page.evaluate("__sb.co.progs[0].seen") is True and tab_badge(page) == '', f'{t} programme vu : badge retiré')
        R.check('Dans tes programmes' in page.inner_text('.coach-prog'), f'{t} carte : « Dans tes programmes »')
        up = page.evaluate('data.userProgrammes.u_c00000000_u_force')
        R.check(up['fromCoach']['name'] == 'max' and up['consigne'].startswith('Trois'), f'{t} fromCoach et consigne gardés')
        # Reconnaissable : accueil et Mes programmes
        page.evaluate("routeTo('dashboard')")
        page.wait_for_timeout(300)
        R.check('De ton coach max' in page.inner_text('.dashboard'), f'{t} accueil : « De ton coach max »')
        R.check(page.locator('.hero__desc').count() == 1 and 'Pectoraux' in page.inner_text('.hero__desc'), f'{t} accueil : muscles de la séance du coach')
        page.evaluate("routeTo('programmes')")
        page.wait_for_timeout(300)
        R.check('trois séances par semaine' in page.inner_text('.programmes').lower(), f'{t} page Programme : consigne générale')
        page.evaluate("navigate('my-programmes')")
        page.wait_for_timeout(300)
        R.check('De ton coach max' in page.inner_text('#app'), f'{t} Mes programmes : « De ton coach max »')
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
        page.wait_for_timeout(400)
        R.check(page.evaluate("(() => { const r = document.querySelector('.coach-tip[data-ex=\"\"]').getBoundingClientRect(); return r.top >= document.querySelector('.navbar').getBoundingClientRect().bottom - 1; })()"), f'{t} séance ouverte en haut : consigne générale visible')
        R.check(page.locator('.coach-tip').count() == 3, f'{t} séance : consigne du programme, d\'un exercice et du superset ({page.locator(".coach-tip").count()})')
        tip = page.locator('.coach-tip[data-ex]:not([data-ex=""])').first
        R.check(tip.get_attribute('aria-expanded') == 'true' and 'Coudes serrés' in tip.inner_text(), f'{t} consigne dépliée')
        shot(page, LOT, f'8-seance-consigne-{t}')
        R.check(small_targets(page, '.coach-tip') == [], f'{t} consigne : 44 pt')
        tip.click()
        page.wait_for_timeout(200)
        R.check(page.locator('.coach-tip[data-ex]:not([data-ex=""])').first.get_attribute('aria-expanded') == 'false', f'{t} consigne repliée d\'un seul toucher')
        R.check(page.evaluate('coachNotesHint()').find('Ton coach voit tes notes') > 0, f'{t} bilan : « Ton coach voit tes notes »')
        page.evaluate("activeSession = null; persistSession(); routeTo('dashboard')")
        page.wait_for_timeout(200)
        # Panel du 07/11 : Squat à reps fixes (« 5 reps ») fait à 72,5 × 8 la dernière fois : l'objectif disait
        # « 75 kg × 3 » face à « 5 reps » et aux cases 72,5 × 5 ; désormais 75 kg × 5 partout
        page.evaluate("""() => { const ex = data.programmes.u_c00000000_u_force.exercises.sB[0];
            data.history.push({ id: 'h-sq', programme: 'u_c00000000_u_force', category: 'sB', date: Date.now() - 2 * 86400000, duration: 1800000,
              exercises: [{ exId: ex.id, name: ex.name, sets: Array.from({ length: 5 }, () => ({ weight: '72.5', reps: '8', done: true })) }] });
            save(); }""")
        tg = page.evaluate("targetsHtml('sB')").replace('\u00a0', ' ')
        R.check('75 kg × 5' in tg and '× 3' not in tg, f'{t} accueil : « 75 kg × 5 » pour un 5 reps fixes')
        page.evaluate("startSession('sB')")
        page.wait_for_selector('.ex-card[data-ei="0"] .ex-goal')
        card = page.locator('.ex-card[data-ei="0"]')
        goal = card.locator('.ex-goal').inner_text().replace('\u00a0', ' ').strip()
        reps = [card.locator(f'[data-action="set-reps"][data-si="{i}"]').input_value() for i in range(5)]
        R.check(goal == 'Objectif 75 kg × 5' and '5 reps' in card.inner_text() and reps == ['5'] * 5,
                f'{t} séance : objectif, « 5 reps » et cases d\'accord ({goal!r}, {reps})')
        page.click('.ex-card[data-ei="0"] [data-action="bump-weight"]')
        page.wait_for_timeout(200)
        w = page.evaluate("activeSession.exercises[0].sets.map(s => s.weight + '×' + s.reps)")
        R.check(w == ['75×5'] * 5, f'{t} puce ↑ 2,5 kg : 75 × 5 comme l\'objectif ({w})')
        page.evaluate("activeSession = null; persistSession(); data.history = data.history.filter(h => h.id !== 'h-sq'); save(); routeTo('dashboard')")
        page.wait_for_timeout(200)
        # Commentaire du coach sur une séance : Historique › Séance
        page.evaluate('syncNow()')
        page.wait_for_timeout(300)
        sid = page.evaluate('data.history[0].id')
        page.evaluate("""([max, sid]) => { __sb.co.notes.push({ coach: max, student: __sb.meId(), sid, text: 'Belle séance, garde ce rythme.', updated_at: new Date().toISOString(), seen: false }); }""", [ids['max'], sid])
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        R.check(tab_badge(page) == '1', f'{t} commentaire : badge 1')
        # Carte de l'accueil, marque dans la liste de l'Historique
        page.evaluate("render()")
        page.wait_for_selector('.coach-home--note')
        R.check('max a commenté ta séance' in page.inner_text('.coach-home--note'), f'{t} accueil : « max a commenté ta séance »')
        shot(page, LOT, f'8b-accueil-commentaire-{t}')
        page.click('.tabbar [data-tab="history"]')
        page.evaluate("routeTo('history')")
        page.wait_for_timeout(300)
        R.check(page.locator(f'[data-action="open-history"][data-id="{sid}"] .coach-mark').count() == 1, f'{t} Historique : marque sur la séance commentée')
        page.click(f'[data-action="open-history"][data-id="{sid}"]')
        page.wait_for_selector('.coach-note')
        R.check('commentaire de ton coach' in page.inner_text('.history-detail').lower() and 'Belle séance' in page.inner_text('.coach-note'), f'{t} Historique : commentaire du coach')
        page.wait_for_timeout(300)
        R.check(page.evaluate('__sb.co.notes[0].seen') is True and tab_badge(page) == '', f'{t} commentaire vu : badge retiré')
        page.evaluate("document.querySelector('.coach-note').scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'9-historique-commentaire-{t}')
        # Mise à jour d'un programme modifié par l'élève : question avant d'écraser
        page.evaluate("data.programmes.u_c00000000_u_force.exercises.sB[0].sets = 3; save();")
        v2 = json.loads(json.dumps(COACH_PROG))
        v2['sessions'][0]['exercises'][0]['sets'] = 5
        page.evaluate("""(prog) => { const p = __sb.co.progs[0]; p.data = prog; p.sent_at = new Date(Date.now() + 5000).toISOString(); p.seen = false; }""", v2)
        page.evaluate('coachRefresh()')
        page.evaluate("routeTo('friends'); navigate('coach-mine')")
        page.wait_for_selector('.coach-prog [data-action="coach-add-prog"]')
        R.check('Mettre à jour' in page.inner_text('.coach-prog'), f'{t} nouvel envoi : « Mettre à jour »')
        before_id = page.evaluate('data.programmes.u_c00000000_u_force.exercises.sA[0].id')
        page.click('.coach-prog [data-action="coach-add-prog"]')
        page.wait_for_timeout(300)
        R.check('Remplacer tes changements' in page.inner_text('.ios-dialog'), f'{t} programme modifié : question avant d\'écraser')
        shot(page, LOT, f'10-conflit-{t}')
        tap_dialog(page, 'Garder ma version')
        page.wait_for_timeout(300)
        R.check(page.evaluate('data.programmes.u_c00000000_u_force.exercises.sB[0].sets') == 3 and page.evaluate('data.programmes.u_c00000000_u_force.exercises.sA[0].sets') == 4, f'{t} « Garder ma version » : rien d\'écrasé')
        R.check(page.locator('[data-action="coach-take-prog"]').count() == 1 and 'gardé ta version' in page.inner_text('.coach-prog'), f'{t} version refusée : « Prendre la version de max » proposé')
        shot(page, LOT, f'10b-garder-{t}')
        page.click('[data-action="coach-take-prog"]')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Prendre sa version')
        page.wait_for_timeout(300)
        R.check(page.evaluate('data.programmes.u_c00000000_u_force.exercises.sA[0].sets') == 5 and page.evaluate('data.programmes.u_c00000000_u_force.exercises.sB[0].sets') == 5, f'{t} « Prendre la version de max » plus tard')
        # Nouvel envoi sans la séance Bas : séance en cours sur ce programme, la mise à jour attend
        v3 = json.loads(json.dumps(v2))
        v3['sessions'] = v3['sessions'][:1]
        page.evaluate("""() => data.history.unshift({ id: 'hbas', programme: 'u_c00000000_u_force', category: 'sB', date: Date.now() - 3600000, duration: 2400000,
            exercises: [{ name: 'Squat barre', sets: [{ weight: '60', reps: '5' }] }] })""")
        page.evaluate('save()')
        page.evaluate("""(prog) => { const p = __sb.co.progs[0]; p.data = prog; p.sent_at = new Date(Date.now() + 10000).toISOString(); p.seen = false; }""", v3)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        page.evaluate("startSession('sA'); routeTo('friends'); navigate('coach-mine')")
        page.wait_for_selector('.coach-prog [data-action="coach-add-prog"]')
        page.click('.coach-prog [data-action="coach-add-prog"]')
        page.wait_for_timeout(300)
        R.check('Termine d\'abord ta séance' in page.inner_text('.ios-dialog'), f'{t} séance en cours : mise à jour repoussée')
        tap_dialog(page, 'OK')
        R.check(not page.evaluate("data.userProgrammes.u_c00000000_u_force.sessions.sB.retired"), f'{t} séance en cours : rien de changé')
        page.evaluate("activeSession = null; persistSession(); render()")
        page.wait_for_timeout(200)
        page.click('.coach-prog [data-action="coach-add-prog"]')
        page.wait_for_timeout(300)
        if page.locator('.ios-dialog').count():
            tap_dialog(page, 'Prendre la nouvelle version')
        page.wait_for_timeout(300)
        R.check(page.evaluate('data.programmes.u_c00000000_u_force.exercises.sA[0].sets') == 5 and page.evaluate('data.programmes.u_c00000000_u_force.exercises.sA[0].id') == before_id, f'{t} mis à jour, identifiant d\'exercice gardé')
        R.check(page.evaluate("sessionKeys('u_c00000000_u_force').join()") == 'sA' and page.evaluate("data.userProgrammes.u_c00000000_u_force.sessions.sB.retired") is True, f'{t} séance retirée par le coach : plus listée')
        page.click('.tabbar [data-tab="history"]')
        page.evaluate("routeTo('history')")
        page.wait_for_timeout(400)
        R.check('Bas' in page.locator('[data-action="open-history"][data-id="hbas"]').inner_text(), f'{t} Historique : la séance retirée garde son nom')
        page.click('.tabbar [data-tab="friends"]')
        page.wait_for_selector('[data-action="coach-leave"]')
        # Hors ligne au démarrage : Mon coach repris de l'appareil (coach, commentaires, programmes)
        page.evaluate('__sb.fail.coach = "offline"; coachReset(account.user.id); coachRefresh()')
        page.wait_for_timeout(400)
        page.evaluate("render()")
        page.wait_for_timeout(200)
        txt = page.inner_text('.coach-mine-view')
        R.check('max' in txt and 'Belle séance' in txt and 'Force' in txt and 'Pas d' in txt, f'{t} hors ligne : Mon coach gardé sur l\'appareil')
        # « Vu » hors ligne : renvoyé au retour du réseau
        page.evaluate('syncNow()')
        page.wait_for_timeout(300)
        page.evaluate("(max) => { __sb.co.notes.push({ coach: max, student: __sb.meId(), sid: 'hbas', text: 'Bien joué', updated_at: new Date().toISOString(), seen: false }); }", ids['max'])
        page.evaluate("coach.inbox.notes.push({ session_id: 'hbas', text: 'Bien joué', updatedAt: Date.now(), seen: false }); coachMarkInboxSeen('note', 'hbas')")
        page.wait_for_timeout(300)
        R.check(page.evaluate("__sb.co.notes.find(n => n.sid === 'hbas').seen") is False and len(page.evaluate('coachSeenQueue()')) == 1, f'{t} « vu » hors ligne mis en attente')
        page.evaluate('__sb.fail.coach = null; coachRefresh()')
        page.wait_for_timeout(500)
        R.check(page.evaluate("__sb.co.notes.find(n => n.sid === 'hbas').seen") is True and len(page.evaluate('coachSeenQueue()')) == 0, f'{t} « vu » renvoyé au retour du réseau')
        # Quitter mon coach
        page.click('[data-action="coach-leave"]')
        page.wait_for_timeout(300)
        R.check('Les programmes déjà ajoutés restent' in page.inner_text('.ios-dialog'), f'{t} quitter : expliqué')
        tap_dialog(page, 'Quitter mon coach')
        page.wait_for_timeout(500)
        R.check(page.evaluate('__sb.co.links.length') == 0 and page.evaluate("!!data.userProgrammes.u_c00000000_u_force"), f'{t} lien supprimé, programme gardé')
        R.check(page.locator('[data-action="coach-open-mine"]').count() == 0, f'{t} plus de cellule Mon coach')
        R.check(page.evaluate("coachFromLine('u_c00000000_u_force')") == 'Reçu de max', f'{t} coach quitté : « Reçu de max »')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def setup_coach(page):
    """Je suis coach (max) ; Léa (35 séances dont une masquée, une avec mon programme, notes et poids), Tom (aucune séance)."""
    # Une séance par jour du calendrier à 10 h, la plus récente hier ; vues par le coach jusqu'à il y a 3 jours, 9 h
    lea = []
    for i in range(35):
        lea.append({'id': f'l{i:02d}', 'date': days_back_ms(NOW, i + 1, 10, tz=PARIS), 'duration': 50 * 60_000, 'programme': 'ppl', 'category': 'push', 'label': 'Push',
                    'notes': 'Épaule un peu raide' if i == 0 else '', 'bodyKg': 61, 'healthSaved': True,
                    'exercises': [{'name': 'Développé couché', 'sets': [{'weight': '40', 'reps': '8'}, {'weight': '40', 'reps': '7'}]},
                                  {'name': 'Rowing', 'ss': 'g1', 'sets': [{'weight': '20', 'reps': '10'}]},
                                  {'name': 'Pompes', 'ss': 'g1', 'sets': [{'weight': '', 'reps': '15'}]}]})
    lea[0].update({'programme': 'u_c00000000_u_force', 'category': 'sA', 'label': 'Haut'})
    lea[0]['exercises'] = lea[0]['exercises'][:2]   # Pompes prévues mais pas faites
    lea[1]['hidden'] = True
    return page.evaluate("""([s, seen]) => {
        const me = __sb.meId();
        __sb.makeCoach(me);
        const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false, sessions: s });
        const tom = __sb.addPerson({ username: 'tom' });
        __sb.link(me, lea, Date.now() - 20 * 86400000);
        __sb.link(me, tom);
        __sb.co.links.find(l => l.student === lea).seen = seen;
        // Mon programme Force
        data.userProgrammes.u_force = { name: 'Force', archived: false, sessions: {
          sA: { label: 'Haut', icon: '', desc: '', color: '#FF9500' }, sB: { label: 'Bas', icon: '', desc: '', color: '#34C759' } } };
        data.programmes.u_force = { timers: {}, cooldowns: {}, exercises: {
          sA: [{ id: 'e1', name: 'Développé couché', sets: 4, rest: 120, lastWeight: '80', repMin: 8, repMax: 12, intens: 'rp-last', grip: { width: 'large' } }, { id: 'e2', name: 'Rowing', sets: 4, ss: 'g1' }, { id: 'e3', name: 'Pompes', sets: 3, ss: 'g1' }],
          sB: [{ id: 'e4', name: 'Squat barre', sets: 5 }] } };
        data.myProgrammes.push('u_force'); save();
        return { me, lea, tom };
    }""", [lea, days_back_ms(NOW, 3, 9, tz=PARIS)])


def t_coach(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(now_ms=NOW))
        signin(page, username='max')
        ids = setup_coach(page)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        R.check(tab_badge(page) == '3', f'{t} badge : 3 nouvelles séances de Léa ({tab_badge(page)!r})')
        R.check('nouveauté' in (page.get_attribute('.tabbar [data-tab="friends"]', 'aria-label') or ''), f'{t} badge annoncé par VoiceOver')
        # Compte coach : l'onglet s'appelle Coach et s'ouvre sur ses élèves (segment Élèves), sans toucher de plus
        R.check(page.inner_text('.tabbar [data-tab="friends"] .tabbar__label') == 'Coach', f'{t} coach : onglet « Coach »')
        friends_tab(page)
        page.wait_for_selector('.friends-view .coach-team .coach-student-row')
        R.check(page.locator('.social-seg [data-seg="students"]').get_attribute('aria-pressed') == 'true', f'{t} coach : segment Élèves ouvert')
        R.check(page.locator('[data-action="coach-open-students"]').count() == 0, f'{t} plus de cellule « Mes élèves » à toucher')
        row = page.locator('.coach-student-row', has_text='lea')
        rt = row.inner_text()
        R.check('Haut · ton programme · hier' in rt, f'{t} dernière séance « Haut · ton programme · hier » ({rt!r})')
        # Panel du 07/11 (iPhone SE) : « programm / e » coupé en plein mot ; chaque mot tient sur une ligne
        broken = page.evaluate("""[...document.querySelectorAll('.coach-student-row .cell__sub')].flatMap(el => {
            const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), out = [];
            for (let n; (n = w.nextNode());) for (const m of n.textContent.matchAll(/\\S+/g)) {
              const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
              const tops = new Set([...r.getClientRects()].map(x => Math.round(x.top)));
              if (tops.size > 1) out.push(m[0]); }
            return out; })""")
        R.check(broken == [], f'{t} Mes élèves : aucun mot coupé en deux {broken}')
        R.check(row.locator('.progress-sig').count() == 1 and row.locator('.progress-sig').inner_text().strip() and ' '.join(row.locator('.coach-count').inner_text().split()) == '3 séances', f'{t} signal de la semaine et nouvelles séances')
        # Panel du 06/11 : pastille rouge « 3 » sans sens à côté de la bulle des messages ; désormais haltère + nombre
        R.check(row.locator('.coach-count--sessions .icon').count() == 1 and 'nouvelles séances' in row.locator('.visually-hidden').first.text_content(), f'{t} pastille des séances : haltère, nombre et « séances » écrit')
        R.check('Aucune séance' in page.locator('.coach-student-row', has_text='tom').inner_text(), f'{t} élève sans séance')
        layout(page, t, 'Mes élèves')
        shot(page, LOT, f'11-mes-eleves-{t}')
        # Invitation : code créé et partagé, puis retiré ; double toucher : un seul code
        page.evaluate("(() => { const b = document.querySelector('[data-action=coach-invite]'); handleAction(null, b, 'coach-invite'); handleAction(null, b, 'coach-invite'); })()")
        page.wait_for_timeout(500)
        codes = page.evaluate('coach.state.invites.map(i => i.code)')
        R.check(len(codes) == 1 and page.locator('.coach-invite').count() == 1, f'{t} code d\'invitation créé ({codes})')
        R.check(len(ccalls(page, 'coach_create_invite')) == 1, f'{t} double toucher : un seul code créé ({len(ccalls(page, "coach_create_invite"))})')
        R.check('onglet Social › Rejoindre un coach' in page.evaluate(f"coachInviteText('{codes[0]}')") if codes else False, f'{t} invitation : dit où aller')
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
        miss = page.locator('.coach-session-view .review-ex--missing')
        R.check('3/11' in d and miss.count() == 1 and 'Pompes' in miss.inner_text() and 'pas fait' in miss.inner_text(), f'{t} séance de mon programme : séries faites sur prévues, exercice non fait grisé')
        R.check(page.locator('.coach-session-view .review-notes').count() == 1 and page.locator('.review-notes--pain').count() == 0, f'{t} notes en haut, sans encadré orange (« raide » n\'est pas un mot de douleur)')
        R.check('1re séance Haut' in d, f'{t} 35 séances chargées, aucune autre Haut : « 1re séance Haut »')
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
        R.check('masquée à ses amis' in page.inner_text('.coach-session-view'), f'{t} séance masquée visible du coach')
        page.click('[data-action="back"]')
        page.wait_for_selector('.coach-sess')
        # Envoyer un programme avec consignes
        page.click('[data-action="coach-send"]')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Force')
        page.wait_for_selector('.coach-send-view')
        page.fill('.coach-textarea[data-prog]', 'Trois séances par semaine.')
        page.fill('.coach-textarea[data-ex="e1"]', 'Coudes serrés.')
        # Brouillon gardé : retour arrière puis retour sur l'écran
        page.click('[data-action="back"]')
        page.wait_for_selector('.coach-student-view')
        page.evaluate(f"navigate(makeRoute('coach-send', '{ids['lea']}', 'u_force'))")
        page.wait_for_selector('.coach-send-view')
        R.check(page.input_value('.coach-textarea[data-prog]') == 'Trois séances par semaine.' and page.input_value('.coach-textarea[data-ex="e1"]') == 'Coudes serrés.', f'{t} brouillon des consignes gardé')
        sub = page.locator('.coach-send-ex').first.inner_text().replace('\u00a0', ' ')
        R.check('4 séries · 8 à 12 reps · dernière en rest-pause · repos' in sub and 'Prise large' in sub, f'{t} envoi : fourchette, technique et prise ({sub!r})')
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
        page.wait_for_timeout(300)
        page.wait_for_timeout(400)
        R.check(page.locator('.coach-sent[data-prog="u_force"] .coach-sent__state--unseen').inner_text() == 'Pas encore ouvert', f'{t} programme envoyé : « Pas encore ouvert » tout de suite')
        page.evaluate("__sb.co.progs.find(p => p.id === 'u_force').seen = true; coachRefresh()")
        page.wait_for_timeout(400)
        R.check('pas encore de séance avec' in page.locator('.coach-sent[data-prog="u_force"]').inner_text(), f'{t} programme vu sans séance : « Vu, pas encore de séance avec »')
        # Renvoi d'un programme déjà vu : de nouveau « Pas encore ouvert », sans attendre
        page.evaluate(f"navigate(makeRoute('coach-send', '{ids['lea']}', 'u_force'))")
        page.wait_for_selector('.coach-send-view')
        page.click('[data-action="coach-send-go"]')
        page.wait_for_timeout(600)
        R.check(page.locator('.coach-sent[data-prog="u_force"] .coach-sent__state--unseen').count() == 1, f'{t} renvoi : « Pas encore ouvert » tout de suite')
        layout(page, t, 'programmes envoyés')
        shot(page, LOT, f'13b-envoyes-{t}')
        # Programme intégré : la consigne du programme est reprise au renvoi
        page.evaluate("data.myProgrammes.includes('ppl') || data.myProgrammes.push('ppl')")
        page.evaluate(f"navigate(makeRoute('coach-send', '{ids['lea']}', 'ppl'))")
        page.wait_for_selector('.coach-send-view')
        page.fill('.coach-textarea[data-prog]', 'Push Pull Legs, deux fois.')
        page.click('[data-action="coach-send-go"]')
        page.wait_for_timeout(500)
        page.evaluate(f"navigate(makeRoute('coach-send', '{ids['lea']}', 'ppl'))")
        page.wait_for_selector('.coach-send-view')
        R.check(page.input_value('.coach-textarea[data-prog]') == 'Push Pull Legs, deux fois.', f'{t} programme intégré : consigne reprise au renvoi')
        page.click('[data-action="back"]')
        page.wait_for_timeout(300)
        # Retirer un élève
        page.evaluate(f"navigate(makeRoute('coach-student', '{ids['tom']}'))")
        page.wait_for_selector('[data-action="coach-remove"]')
        page.click('[data-action="coach-remove"]')
        page.wait_for_timeout(300)
        R.check('ne pourra plus revenir avec tes codes' in page.inner_text('.ios-dialog'), f'{t} retirer : plus de retour avec mes codes, dit')
        tap_dialog(page, "Retirer l'élève")
        page.wait_for_timeout(500)
        R.check('ne fait plus partie de tes élèves' in toast(page), f'{t} toast neutre ({toast(page)!r})')
        R.check(page.evaluate(f"!__sb.co.links.some(l => l.student === '{ids['tom']}')") and page.evaluate('view') == 'friends', f'{t} élève retiré : retour au segment Élèves')
        R.check(page.locator('.coach-student-row').count() == 1, f'{t} plus qu\'un élève')
        R.check(page.locator('[data-action="coach-allow"]').count() == 1 and 'tom' in page.inner_text('.coach-team'), f'{t} liste « Retirés »')
        layout(page, t, 'Mes élèves avec retirés')
        shot(page, LOT, f'19-retires-{t}')
        page.click('[data-action="coach-allow"]')
        page.wait_for_timeout(500)
        R.check(page.evaluate('__sb.co.bans.length') == 0 and page.locator('[data-action="coach-allow"]').count() == 0, f'{t} « Autoriser à revenir »')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_recap(bench, eng, dev, theme):
    """Séance d'un élève relue par le coach : référence, notes avec douleur, cases (volume et écart sans
    poids du corps, même le mien connu ; durée), records nommés, flèches contre la dernière fois que
    l'élève a fait l'exercice (même dans une autre séance), poids du corps en reps, règle du volume."""
    t = tag(dev, theme)
    now = NOW
    S = lambda w, r, n: [{'weight': w, 'reps': r}] * n
    zoe = [
        {'id': 'z0', 'date': now - DAY, 'duration': 37 * 60_000, 'programme': 'ppl', 'category': 'legs', 'label': 'Legs',
         'notes': 'Genou gauche un peu douloureux sur la fin.', 'bodyKg': 58,
         'exercises': [{'name': 'Squat haltère', 'sets': S('22.5', '12', 4)}, {'name': 'Squat poids du corps', 'sets': S('', '12', 3)},
                       {'name': 'Soulevé de terre roumain', 'sets': S('16', '12', 4)}, {'name': 'Mollets debout haltères', 'sets': S('18', '15', 4)}]},
        {'id': 'z1', 'date': now - 4 * DAY, 'duration': 40 * 60_000, 'programme': 'ppl', 'category': 'push', 'label': 'Push',
         'exercises': [{'name': 'Développé couché', 'sets': S('40', '8', 3)}, {'name': 'Soulevé de terre roumain', 'sets': S('14', '12', 3)}]},
        {'id': 'z2', 'date': now - 8 * DAY, 'duration': 30 * 60_000, 'programme': 'ppl', 'category': 'legs', 'label': 'Legs',
         'exercises': [{'name': 'Squat haltère', 'sets': S('20', '12', 3) + S('20', '10', 1)}, {'name': 'Squat poids du corps', 'sets': S('', '10', 3)},
                       {'name': 'Soulevé de terre roumain', 'sets': S('16', '12', 4)}, {'name': 'Mollets debout haltères', 'sets': S('18', '15', 4)}]},
    ]
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(now_ms=NOW))
        signin(page, username='max')
        uid = page.evaluate("""(s) => { const me = __sb.meId(); __sb.makeCoach(me);
            const zoe = __sb.addPerson({ username: 'zoe', avatar: '🐼', social: false, sessions: s }); __sb.link(me, zoe);
            data.bodyWeightKg = 90; save(); return zoe; }""", zoe)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        page.evaluate(f"navigate(makeRoute('coach-student', '{uid}'))")
        page.wait_for_selector('.coach-sess[data-id="z0"]')
        page.click('.coach-sess[data-id="z0"]')
        page.wait_for_selector('.coach-session-view')
        d = page.inner_text('.coach-session-view').replace('\u202f', ' ').replace('\u00a0', ' ')
        R.check('vs Legs du' in page.inner_text('.review-vs'), f'{t} référence : la Legs d\'avant, pas la Push')
        notes = page.locator('.review-notes--pain')
        R.check(notes.count() == 1 and 'douloureux' in notes.inner_text() and 'À lire' in notes.inner_text(), f'{t} notes en haut, encadré orange')
        R.check(page.evaluate("document.querySelector('.review-notes').compareDocumentPosition(document.querySelector('.tiles')) & Node.DOCUMENT_POSITION_FOLLOWING") > 0, f'{t} notes au-dessus des cases')
        tiles = [x.replace('\u202f', ' ').replace('\n', ' ') for x in page.locator('.coach-session-view .tile').all_inner_texts()]
        R.check(len(tiles) == 4, f'{t} 4 cases ({tiles})')
        R.check(tiles[0].startswith('2,9 t') and '+6 %' in tiles[0] and page.locator('.tile__delta--up').count() == 1, f'{t} volume sans poids du corps, +6 % en vert ({tiles[0]!r})')
        R.check('+23 %' in tiles[1], f'{t} durée : écart de plus de 20 % dit ({tiles[1]!r})')
        R.check('15' in tiles[2] and '4' in tiles[3], f'{t} séries et exercices ({tiles[2:]!r})')
        recs = page.locator('.coach-session-view .review-rec').all_inner_texts()
        R.check(len(recs) == 2 and 'Squat haltère' in recs[0] and 'avant 20 kg' in recs[0] and '22,5 kg' in recs[0], f'{t} record de charge nommé avec l\'ancienne valeur ({recs})')
        R.check(len(recs) == 2 and 'Squat poids du corps' in recs[1] and 'Record reps' in recs[1], f'{t} record de reps au poids du corps ({recs})')
        rows = [x.replace('\u202f', ' ') for x in page.locator('.coach-session-view .review-ex').all_inner_texts()]
        R.check('↑ +2,5 kg' in rows[0] and 'préc. 20 kg × 12 · 12 · 12 · 10' in rows[0] and '1,1 t' in rows[0], f'{t} squat : flèche, volume (1 080 kg), précédent ({rows[0]!r})')
        R.check('36 reps' in rows[1] and '↑ +6 reps' in rows[1], f'{t} poids du corps : « 36 reps » et +6 ({rows[1]!r})')
        R.check('↑ +2 kg' in rows[2] and 'préc. 14 kg × 12' in rows[2], f'{t} référence par exercice : la Push du jour 4 ({rows[2]!r})')
        R.check('=' in rows[3] and '↓' not in d, f'{t} égalité : « = » ({rows[3]!r})')
        R.check(page.locator('.review-trend--up').count() == 3 and page.locator('.review-trend--same').count() == 1, f'{t} hausses en vert, égalité en gris')
        R.check('poids du corps non compté' in page.inner_text('.review-rule'), f'{t} règle du volume affichée')
        layout(page, t, 'relecture d\'une séance')
        shot(page, LOT, f'14b-relecture-{t}')
        # Plus ancienne séance : rien à comparer, aucune flèche ni record
        page.click('[data-action="back"]')
        page.wait_for_selector('.coach-sess[data-id="z2"]')
        page.click('.coach-sess[data-id="z2"]')
        page.wait_for_selector('.coach-session-view')
        R.check('1re séance Legs' in page.inner_text('.coach-session-view') and page.locator('.review-trend, .review-rec').count() == 0, f'{t} première séance : « 1re séance Legs », ni flèche ni record')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_rir(bench, eng, dev, theme):
    """Séance d'un élève : RIR noté et échauffement montrés au coach, échauffement hors volume et séries,
    records notés par l'app de l'élève pris tels quels."""
    t = tag(dev, theme)
    now = int(time.time() * 1000)
    s = [{'id': 'y0', 'date': now - DAY, 'duration': 30 * 60_000, 'programme': 'ppl', 'category': 'legs', 'label': 'Legs',
          'records': [{'ex': 'Squat haltère', 'kind': 'reps', 'before': 10, 'after': 12, 'w': 20}],
          'exercises': [{'name': 'Squat haltère', 'sets': [{'weight': '10', 'reps': '8', 'warmup': True}, {'weight': '20', 'reps': '12', 'rir': 2}, {'weight': '20', 'reps': '12'}]}]}]
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        uid = page.evaluate("""(s) => { const me = __sb.meId(); __sb.makeCoach(me);
            const id = __sb.addPerson({ username: 'yan', avatar: '🐼', social: false, sessions: s }); __sb.link(me, id); return id; }""", s)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        page.evaluate(f"navigate(makeRoute('coach-student', '{uid}'))")
        page.wait_for_selector('.coach-sess[data-id="y0"]')
        page.click('.coach-sess[data-id="y0"]')
        page.wait_for_selector('.coach-session-view .review-rec')
        d = page.inner_text('.coach-session-view').replace('\u202f', ' ').replace('\u00a0', ' ')
        R.check('Reps en réserve : 2 · —' in d, f'{t} reps en réserve notées visibles ({d[:400]!r})')
        R.check('Échauffement 10 kg × 8' in d, f'{t} échauffement à part')
        tiles = [x.replace('\u202f', ' ') for x in page.locator('.coach-session-view .tile').all_inner_texts()]
        R.check(tiles[0].startswith('480') and tiles[2].startswith('2'), f'{t} échauffement hors volume et séries ({tiles})')
        rec = page.inner_text('.coach-session-view .review-rec').replace('\u202f', ' ')
        R.check('Record reps' in rec and 'avant 20 kg × 10' in rec and '20 kg × 12' in rec, f'{t} record noté ({rec!r})')
        R.check("sans l'échauffement" in page.inner_text('.review-rule'), f'{t} règle du volume à jour')
        shot(page, LOT, f'14c-relecture-rir-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_pseudo(bench, eng, dev, theme):
    """Sans pseudo : l'app le fait choisir avant de rejoindre ; le serveur le demande aussi (username_required)."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(now_ms=NOW))
        signin(page, username=None)
        ids = setup_student(page)
        # Le serveur refuse sans pseudo (contrat), message traduit
        r = page.evaluate("coachPreview('K7M2QX9P')")
        R.check(r == {'ok': False, 'kind': 'username_required'} and 'pseudo' in page.evaluate("coachErrorText('username_required')"), f'{t} username_required traduit {r}')
        page.evaluate("navigate('coach')")
        page.wait_for_selector('[data-action="coach-join"]')
        page.click('[data-action="coach-join"]')
        page.wait_for_timeout(300)
        R.check('Choisis un pseudo' in page.inner_text('.ios-dialog'), f'{t} sans pseudo : expliqué')
        tap_dialog(page, 'Choisir')
        page.wait_for_selector('#authUsername')
        R.check('Ton coach te reconnaîtra avec ce pseudo' in page.inner_text('.auth__lead'), f'{t} écran du pseudo : texte du coach')
        page.fill('#authUsername', 'lea.fit')
        page.wait_for_timeout(700)
        page.click('[data-role="save"]')
        page.wait_for_timeout(700)
        code_sheet(page, 'K7M2QX9P')
        page.wait_for_selector('.coach-join-view')
        R.check(page.evaluate('coach.preview.person.since') is None, f'{t} aperçu : since null')
        page.click('[data-action="coach-age"]')
        page.click('[data-action="coach-accept"]')
        page.wait_for_timeout(600)
        R.check(page.evaluate('__sb.co.links.length') == 1, f'{t} pseudo choisi puis coach rejoint')
        if page.locator('.ios-dialog').count():
            tap_dialog(page, 'OK')
        # Rejoindre une seconde fois le même coach (coupure réseau) : renvoie le coach, sans erreur
        r = page.evaluate("coachJoin('K7M2QX9P')")
        R.check(r['ok'] is True and r['data']['username'] == 'max' and page.evaluate('__sb.co.links.length') == 1, f'{t} adhésion rejouée : sans erreur ni doublon')
        # Retirée par le coach : une ligne le dit dans l'onglet Social, une fois ; ses codes ne marchent plus
        page.evaluate("__sb.session.user.id = __sb.co.links[0].coach")
        page.evaluate("(me) => coachRpc('coach_remove_student', { student: me })", ids['me'])
        page.wait_for_timeout(200)
        page.evaluate("__sb.session.user.id = '%s'" % ids['me'])
        page.evaluate("routeTo('friends'); coachRefresh()")
        page.wait_for_timeout(500)
        R.check('Tu ne suis plus max' in page.inner_text('#coachCell') and page.locator('[data-action="coach-join-start"]').count() == 1, f'{t} coach perdu : dit dans l\'onglet Social')
        shot(page, LOT, f'18-coach-perdu-{t}')
        page.click('[data-action="coach-lost-ok"]')
        page.wait_for_timeout(200)
        R.check('Tu ne suis plus' not in page.inner_text('#coachCell'), f'{t} ligne fermée')
        r = page.evaluate("coachPreview('K7M2QX9P')")
        R.check(r == {'ok': False, 'kind': 'invalid_code'}, f'{t} retirée : les codes de ce coach ne marchent plus {r}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_saisie(bench, eng, dev, theme):
    """Une relecture du coach ne redessine pas l'écran pendant une saisie (recherche de l'Historique)."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(now_ms=NOW))
        signin(page, username='lea')
        ids = setup_student(page)
        page.click('.tabbar [data-tab="history"]')
        page.wait_for_timeout(400)
        page.focus('#histSearch')
        page.keyboard.type('Dév')
        page.evaluate('coach.loadedAt = 0; coachRefresh()')
        page.wait_for_timeout(400)
        R.check(page.evaluate("document.activeElement?.id") == 'histSearch' and page.input_value('#histSearch') == 'Dév', f'{t} relecture sans changement : saisie intacte')
        # Changement réel (devenue élève) pendant la saisie : toujours pas de redessin
        page.evaluate(f"__sb.link('{ids['max']}', __sb.meId()); coachRefresh()")
        page.wait_for_timeout(500)
        R.check(page.evaluate("document.activeElement?.id") == 'histSearch' and page.input_value('#histSearch') == 'Dév', f'{t} changement pendant la saisie : focus gardé')
        R.check(tab_badge(page) == '' and page.evaluate('coachRole().hasCoach') is True, f'{t} état lu malgré tout')
        # Un commentaire arrive pendant la saisie : la bulle n'apparaît pas pendant la frappe, mais au focusout
        sid = page.evaluate("(data.history.find(h => h.category === 'push') || data.history[0]).id")
        R.check(page.locator(f'[data-action="open-history"][data-id="{sid}"]').count() == 1, f'{t} séance « push » visible sous « Dév »')
        page.evaluate(f"""(sid) => {{ const max = __sb.co.links[0].coach; __sb.co.notes.push({{ coach: max, student: __sb.meId(), sid, text: 'Super', updated_at: new Date().toISOString(), seen: false }}); coachRefresh(); }}""", sid)
        page.wait_for_timeout(500)
        R.check(page.evaluate("document.activeElement?.id") == 'histSearch', f'{t} commentaire pendant la saisie : focus gardé')
        R.check(page.locator(f'[data-action="open-history"][data-id="{sid}"] .coach-mark').count() == 0, f'{t} bulle pas affichée pendant la saisie')
        page.evaluate("document.querySelector('#histSearch').blur()")
        page.wait_for_timeout(300)
        R.check(page.locator(f'[data-action="open-history"][data-id="{sid}"] .coach-mark').count() == 1, f'{t} bulle affichée au focusout')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_cache_online(bench, eng, dev, theme):
    """Démarrage depuis le cache en ligne : « Ajouter » relit l'état puis ajoute, sans faux « Pas d'Internet »."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(now_ms=NOW))
        signin(page, username='lea')
        ids = setup_student(page)
        page.evaluate("""([max, prog]) => { __sb.link(max, __sb.meId());
            __sb.co.progs.push({ coach: max, student: __sb.meId(), id: 'u_force', data: prog, sent_at: new Date().toISOString(), seen: false }); }""", [ids['max'], COACH_PROG])
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(400)
        # L'app garde la boîte sur l'appareil, programmes réduits à leurs métadonnées (nom, date, vu)
        R.check(json.loads(ls(page, 'mdlf_coach_inbox'))['inbox']['programmes'][0].get('meta') is True, f'{t} cache : programme en métadonnées')
        # Redémarrage en ligne depuis le cache : état pas encore relu, la carte s'affiche
        page.evaluate('coachReset(account.user.id)')
        page.wait_for_timeout(80)
        R.check(page.evaluate('coach.error') is None and page.evaluate("coach.inbox.programmes.some(p => p.meta)"), f'{t} cache chargé, état pas encore lu')
        # « Ajouter » touché tout de suite : pas de faux hors ligne, l'état est relu puis le programme ajouté
        page.evaluate("addCoachProgrammeFlow('u_force'); null")   # sans await : le flux ouvre ensuite une feuille
        page.wait_for_timeout(700)
        if page.locator('.ios-dialog').count():
            tap_dialog(page, 'Plus tard')
        R.check('Pas d' not in toast(page) and page.evaluate("!!data.userProgrammes.u_c00000000_u_force"), f'{t} ajout depuis le cache en ligne : programme ajouté ({toast(page)!r})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_hors_ligne(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(now_ms=NOW))
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
        help_ = code_sheet(page, 'K7M2QX9P', ok=False)
        R.check('Pas d' in help_ and page.input_value('#coachCode') == 'K7M2QX9P', f'{t} rejoindre hors ligne : message dans la feuille, saisie gardée ({help_!r})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    # Sans compte : Réglages › Coach explique et propose de se connecter
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(now_ms=NOW))
        page.evaluate("navigate('coach')")
        page.wait_for_selector('.coach-view [data-action="social-sign-in"]')
        R.check(page.evaluate("__sb.calls.filter(c => c[0] === 'coach').length") == 0, f'{t} sans compte : aucun appel')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ─────────────────────────────────────────────────────────────
#  Devenir coach : une demande vérifiée à la main (carte professionnelle), puis code permanent
# ─────────────────────────────────────────────────────────────

def t_demande_coach(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        page.evaluate("navigate('coach')")
        page.wait_for_timeout(700)
        cell = page.locator('[data-action="coach-request-open"]')
        R.check(cell.count() == 1 and 'Devenir coach' in cell.inner_text(), f'{t} Réglages › Coach : entrée « Devenir coach »')
        cell.click()
        page.wait_for_selector('.coach-req-view')
        page.wait_for_timeout(400)
        txt = page.inner_text('.coach-req-view')
        R.check('réservé aux éducateurs sportifs diplômés titulaires d\'une carte professionnelle' in txt and 'ministère des Sports, sous 48 h' in txt,
                f'{t} demande : explication honnête')
        R.check(page.locator('#coachReqName').count() == 1 and page.locator('#coachReqCard').count() == 1
                and page.locator('#coachReqDiploma option').count() == 8, f'{t} demande : nom, numéro de carte, diplôme')
        layout(page, t, 'demande coach')
        shot(page, LOT, f'30-demande-coach-{t}')
        # Numéro mal formé : refus sur l'appareil, rien n'est envoyé
        page.fill('#coachReqName', 'Maxence Martin')
        page.fill('#coachReqCard', 'ab1')
        page.select_option('#coachReqDiploma', 'BPJEPS')
        page.click('[data-action="coach-request-send"]')
        page.wait_for_timeout(400)
        R.check('Numéro de carte introuvable' in page.inner_text('#coachReqError')
                and page.evaluate("__sb.calls.filter(c => c[0] === 'coach' && c[1] === 'coach_request_submit').length") == 0,
                f'{t} numéro mal formé : refusé sans appel')
        page.fill('#coachReqCard', '049 12 ED 0123')
        page.click('[data-action="coach-request-send"]')
        page.wait_for_timeout(700)
        txt = page.inner_text('.coach-req-view')
        req = page.evaluate("__sb.co.requests[__sb.meId()]")
        R.check(req and req['card_number'] == '04912ED0123' and req['diploma'] == 'BPJEPS' and 'En vérification' in txt,
                f'{t} demande envoyée : en vérification ({req})')
        # Panel du 06/11 (iPhone SE) : « Demande » et le statut se chevauchaient (« DemandEn cours de vérification »)
        ov = page.evaluate("""(() => { const c = [...document.querySelectorAll('.coach-req-view .cell')].find(e => e.querySelector('.cell__value')), t = c.querySelector('.cell__title'), v = c.querySelector('.cell__value');
            return [t.scrollWidth <= t.clientWidth + 1, t.getBoundingClientRect().right <= v.getBoundingClientRect().left + 1]; })()""")
        R.check(ov == [True, True], f'{t} demande : « Demande » et le statut côte à côte, sans chevauchement {ov}')
        R.check(page.evaluate('__sb.co.alerts') == 1, f'{t} administrateur prévenu (coach-request-alert)')
        R.check(not page.evaluate('coachRole().isCoach'), f'{t} demande en attente : pas encore coach')
        shot(page, LOT, f'31-demande-en-cours-{t}')
        # Refusée, avec le motif
        page.evaluate("async () => { __sb.rejectCoach(__sb.meId(), 'Carte introuvable sur le site du ministère.'); coachPro.loadedAt = 0; await coachProRefresh(); }")
        page.wait_for_timeout(400)
        txt = page.inner_text('.coach-req-view')
        R.check('Refusée' in txt and 'Motif : Carte introuvable sur le site du ministère.' in txt and 'Faire une nouvelle demande' in txt,
                f'{t} demande refusée : motif affiché')
        # Validée : rôle coach, code permanent, abonnement coach
        page.evaluate("async () => { __sb.makeCoach(__sb.meId()); await coachRefresh(); coachPro.loadedAt = 0; await coachProRefresh(); }")
        page.wait_for_timeout(400)
        R.check('Validée' in page.inner_text('.coach-req-view'), f'{t} demande validée')
        page.evaluate("navigate('coach')")
        page.wait_for_timeout(800)
        txt = page.inner_text('.coach-view')
        code = page.evaluate("coachPro.code")
        R.check(code and len(code) == 12 and formatted(code) in txt and 'sans date de fin' in txt and 'abonnement coach' in txt.lower(),
                f'{t} coach validé : code permanent et abonnement ({code})')
        layout(page, t, 'Réglages › Coach validé')
        shot(page, LOT, f'32-coach-valide-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # L'élève rejoint avec le code permanent (12 caractères, tirets), et un palier plein le refuse
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), opts={})
        signin(page, username='lea')
        code = page.evaluate("""() => { const c = __sb.addPerson({ username: 'lucas', social: false }); __sb.makeCoach(c);
            window.__coach = c; return __sb.co.permCode[c]; }""")
        r = page.evaluate("async c => (await coachPreview(c)).ok", f'{code[:4]}-{code[4:8]}-{code[8:]}'.lower())
        R.check(r is True, f'{t} code permanent accepté avec tirets et minuscules')
        page.evaluate("""() => { window.__st = { paywallOn: true }; __sb.setTier(__coach, 'com.mdlf.training.coach10.monthly');
            for (let i = 0; i < 10; i++) __sb.link(__coach, __sb.addPerson({ username: 'e' + i, social: false })); }""")
        r = page.evaluate("async c => await coachJoin(c)", code)
        R.check(r == {'ok': False, 'kind': 'tier_full'} and 'passer au palier supérieur' in page.evaluate("coachErrorText('tier_full')"),
                f'{t} palier plein : élève refusé, message clair ({r})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def formatted(code):
    return f'{code[:4]}-{code[4:8]}-{code[8:]}'


run_main(R, [t_demande_coach, t_eleve, t_coach, t_recap, t_rir, t_pseudo, t_saisie, t_cache_online, t_hors_ligne])
