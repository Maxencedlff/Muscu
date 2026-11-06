"""Social V2 (docs/SOCIAL_V2.md, app iOS simulée) : l'onglet s'appelle Social, et Coach pour un compte coach.
- Pratiquant sans coach : onglet « Social », rien du coach en tête, « Rejoindre un coach » discret en bas ;
  carte de séance (nom, durée, volume, séries, record en or, muscles), réagir et « Commenter » (la séance
  s'ouvre sur ses commentaires) ; fil vide accueillant avec « Inviter un ami » (feuille de partage).
- Coach : onglet « Coach » (icône du coach), ouvert sur le segment Élèves : résumé de la semaine (records, à
  relancer, nouveautés) et élèves triés ; un toucher pour voir qui a progressé, deux pour la fiche d'un élève ;
  segment Social pour ses amis et son fil, Élèves gardé au retour d'une fiche.
- Élève : onglet « Social », « Mon coach » en tête (un toucher).
- Rien au pointerdown, cibles de 44 pt, aucun texte coupé, pas de défilement horizontal, aucune erreur.

L'app iOS et Supabase sont simulés (tests/fake_account.py) : aucune requête ne sort. Horloge figée au mercredi
25 novembre 2026, 10 h (Paris). Captures : $PPL_SCRATCH/shots/lotsocialv2/ (chaque écran, clair et sombre).
Lancer : PPL_URL=http://127.0.0.1:8782/ PPL_DEV="iPhone 13" PPL_THEME=dark python3 tests/test_social_v2.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'socialv2'
R = Results(LOT)
NOW = local_ms(2026, 11, 25, 10, tz=PARIS)   # mercredi
H = 3600_000


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
    page.add_init_script(FAKE_ACCOUNT)
    # Feuille de partage du navigateur : le texte partagé est gardé pour le test
    page.add_init_script('window.__shared = []; navigator.share = async o => { window.__shared.push(o); };')
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(now_ms=NOW), extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username='max', enable=True):
    page.evaluate("""async ([u, en]) => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: u, avatar: '😎' });
        if (en) await socialEnable(true); }""", [username, enable])
    page.wait_for_timeout(200)


def layout(page, t, name):
    R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} {name} : pas de défilement horizontal')
    small = page.evaluate("""() => [...document.querySelectorAll('#app button, #app input, .tabbar button')].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""")
    R.check(not small, f'{t} {name} : cibles de 44 pt {small}')
    cut = page.evaluate("""() => [...document.querySelectorAll('#app *, .tabbar *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, select, option, svg, use, .icon *, .visually-hidden, .sr-text') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""")
    R.check(not cut, f'{t} {name} : aucun texte coupé {cut}')


def tab_label(page):
    return page.inner_text('.tabbar [data-tab="friends"] .tabbar__label').strip()


def tab_icon(page):
    return page.get_attribute('.tabbar [data-tab="friends"] use', 'href')


def open_tab(page):
    page.click('.tabbar [data-tab="friends"]')
    page.wait_for_timeout(600)


LEGS = [{'name': 'Squat', 'sets': [{'weight': '60', 'reps': '8', 'warmup': True}, {'weight': '120', 'reps': '5'}, {'weight': '125', 'reps': '3'}]},
        {'name': 'Presse à cuisses', 'sets': [{'weight': '200', 'reps': '10'}, {'weight': '200', 'reps': '10'}]},
        {'name': 'Leg curl', 'sets': [{'weight': '45', 'reps': '12'}]}]


def friends(page):
    """Léa (suivie) : une séance Legs il y a 2 h avec un record noté (Squat 125 kg) ; Tom : demande reçue."""
    lea = [{'id': 'l0', 'date': NOW - 2 * H, 'duration': 58 * 60_000, 'programme': 'ppl', 'category': 'legs', 'label': 'Legs', 'exercises': LEGS,
            'records': [{'ex': 'Squat', 'kind': 'charge', 'before': 120, 'after': 125}, {'ex': 'Presse à cuisses', 'kind': 'charge', 'before': 190, 'after': 200}]},
           {'id': 'l1', 'date': NOW - 50 * H, 'duration': 40 * 60_000, 'programme': 'ppl', 'category': 'legs', 'label': 'Legs', 'exercises': LEGS[1:], 'records': []}]
    return page.evaluate("""(lea) => {
        const me = __sb.meId();
        const L = __sb.addPerson({ username: 'lea', avatar: '🦊', sessions: lea });
        __sb.follow(me, L, 'accepted'); __sb.follow(L, me, 'accepted');
        __sb.so.seenAt[me] = Date.now() + 1;
        return { lea: L };
    }""", lea)


def students(page):
    """Trois élèves : zoe (un record cette semaine : Squat, en charge et en reps), hugo (9 jours sans séance), nina (nouvelle séance pas vue)."""
    def s(prefix, days, rec=False):
        return [{'id': f'{prefix}{i}', 'date': days_back_ms(NOW, d, 18, tz=PARIS), 'duration': 3_000_000, 'programme': 'ppl', 'category': 'push', 'label': 'Push',
                 'exercises': [{'name': 'Squat', 'sets': [{'weight': '100', 'reps': '5'}]}],
                 'records': [{'ex': 'Squat', 'kind': 'charge', 'before': 100, 'after': 105}, {'ex': 'Squat', 'kind': 'reps', 'before': 5, 'after': 6, 'w': 105}] if rec and i == 0 else []}
                for i, d in enumerate(days)]
    people = {'zoe': s('z', [1, 8, 10, 15], rec=True), 'hugo': s('h', [9, 11, 16]), 'nina': s('n', [0, 7, 14])}
    return page.evaluate("""(people) => {
        const me = __sb.meId();
        __sb.makeCoach(me);
        const ids = {};
        for (const [u, ss] of Object.entries(people)) {
          ids[u] = __sb.addPerson({ username: u, avatar: '🐼', social: false, sessions: ss });
          __sb.link(me, ids[u], Date.now() - 60 * 86400000);
          __sb.co.links.find(l => l.student === ids[u]).seen = u === 'nina' ? Date.now() - 2 * 86400000 : Date.now();
        }
        return ids;
    }""", people)


# ─────────────────────────────────────────────────────────────

def t_pratiquant(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page)
        friends(page)
        page.evaluate('Promise.all([socialRefresh(), coachRefresh()])')
        page.wait_for_timeout(300)
        R.check(tab_label(page) == 'Social' and tab_icon(page) == '#i-person.2', f'{t} onglet « Social », icône des personnes ({tab_label(page)!r})')
        open_tab(page)
        page.wait_for_selector('.feed-card[data-id="l0"]')
        R.check(page.inner_text('.friends-view .navbar__large').strip() == 'Social', f'{t} grand titre « Social »')
        R.check(page.locator('.social-seg').count() == 0, f'{t} pratiquant : pas de segments')
        # Pas de bruit coach en tête : rien avant la recherche, « Rejoindre un coach » sous le fil
        R.check(page.locator('#coachCell .cell').count() == 0, f'{t} rien du coach en tête')
        join_below = page.evaluate("document.querySelector('#coachJoin [data-action=coach-join-start]').getBoundingClientRect().top > document.querySelector('.feed').getBoundingClientRect().bottom")
        R.check(join_below, f'{t} « Rejoindre un coach » sous le fil')
        # Carte : séance, chiffres, record en or, muscles, réagir, commenter
        card = page.locator('.feed-card[data-id="l0"]')
        txt = card.inner_text().replace(' ', ' ').replace(' ', ' ')
        R.check('lea' in txt and 'il y a 2 h' in txt and 'Legs' in txt, f'{t} carte : qui, quand, quoi ({txt!r})')
        stats = [x.replace(' ', ' ').replace(' ', ' ') for x in card.locator('.feed-card__stat').all_inner_texts()]
        R.check(len(stats) == 3 and stats[0].startswith('58 min') and 'Durée' in stats[0] and 'Volume' in stats[1] and stats[2].startswith('5') and 'Séries' in stats[2],
                f'{t} carte : durée, volume, 5 séries sans l\'échauffement ({stats})')
        rec = card.locator('.feed-card__rec').inner_text().replace(' ', ' ').replace(' ', ' ')
        R.check(rec.startswith('🏆 Record · ') and rec.endswith(' kg +1'),
                f'{t} carte : record le plus marquant, et combien d\'autres ({rec!r})')
        color = page.evaluate("getComputedStyle(document.querySelector('.feed-card__rec')).color")
        gold = page.evaluate("(() => { const d = document.createElement('span'); d.style.color = 'var(--gold-text)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; })()")
        R.check(color == gold, f'{t} record en or ({color} / {gold})')
        chips = card.locator('.feed-card__chip').all_inner_texts()
        R.check(1 <= len(chips) <= 3 and 'Quadriceps' in chips, f'{t} carte : muscles travaillés ({chips})')
        R.check(card.locator('.react').count() == 1 and card.locator('[data-action="social-open-comments"]').count() == 1, f'{t} carte : réagir et commenter')
        R.check(page.locator('.feed-card[data-id="l1"] .feed-card__rec').count() == 0, f'{t} séance sans record : pas de pastille')
        layout(page, t, 'Social')
        shot(page, LOT, f'1-social-{t}')
        # Rien au pointerdown ; « Commenter » au clic : la séance, ouverte sur ses commentaires
        page.evaluate("document.querySelector('.feed-card[data-id=l0] [data-action=social-open-comments]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
        page.wait_for_timeout(300)
        R.check(page.evaluate('view') == 'friends', f'{t} pointerdown seul : rien ne s\'ouvre')
        card.locator('[data-action="social-open-comments"]').click()
        page.wait_for_selector('.social-session-view #commentsList')
        page.wait_for_timeout(500)
        top = page.evaluate("document.querySelector('#commentsList').previousElementSibling.getBoundingClientRect().top")
        nav = page.evaluate("document.querySelector('.navbar').getBoundingClientRect().bottom")
        # Sous la barre, ou la page défilée jusqu'en bas quand elle est trop courte pour les y amener
        bottom = page.evaluate('scrollY >= document.documentElement.scrollHeight - innerHeight - 2')
        R.check(page.evaluate('scrollY') > 0 and (nav - 2 <= top <= nav + 120 or bottom), f'{t} « Commenter » : commentaires sous la barre ({top} / {nav})')
        shot(page, LOT, f'2-commenter-{t}')
        page.click('[data-action="back"]')
        page.wait_for_selector('.feed-card[data-id="l0"]')
        # Mon profil : « Modifier » et « Inviter un ami »
        page.click('.navbar [data-action="social-me"]')
        page.wait_for_selector('.social-me-view .athlete')
        page.wait_for_timeout(400)
        R.check(page.locator('.social-me-view [data-action="social-edit-profile"]').count() == 1 and page.locator('.social-me-view [data-action="social-invite"]').count() == 1,
                f'{t} Mon profil : Modifier et Inviter un ami')
        layout(page, t, 'Mon profil')
        shot(page, LOT, f'3-mon-profil-{t}')
        page.click('.social-me-view [data-action="social-edit-profile"]')
        page.wait_for_selector('.account-view')
        R.check(page.evaluate('nav.tab') == 'friends', f'{t} Modifier : compte empilé dans l\'onglet')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_fil_vide(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page)
        open_tab(page)
        page.wait_for_selector('#friendsBody [data-action="social-invite"]')
        body = page.inner_text('#friendsBody')
        R.check('Ton fil t\'attend' in body and 'max' in body and 'Séances de tes amis' not in body, f'{t} fil vide : accueil et mon pseudo ({body!r})')
        layout(page, t, 'fil vide')
        shot(page, LOT, f'4-fil-vide-{t}')
        page.evaluate("(() => { Native.shareText = async (text, title) => { window.__shared.push({ text, title }); return 'shared'; }; })()")   # feuille de partage d'iOS
        page.click('#friendsBody [data-action="social-invite"]')
        page.wait_for_timeout(300)
        shared = page.evaluate('window.__shared')
        R.check(len(shared) == 1 and 'mon pseudo est max' in shared[0]['text'] and 'onglet Social' in shared[0]['text'], f'{t} Inviter un ami : feuille de partage ({shared})')
        page.click('[data-action="social-find"]')
        R.check(page.evaluate('document.activeElement.id') == 'socialSearch', f'{t} Rechercher un pseudo : le champ prend la main')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_coach(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page)
        friends(page)
        ids = students(page)
        page.evaluate('Promise.all([socialRefresh(), coachRefresh()])')
        page.wait_for_timeout(400)
        R.check(tab_label(page) == 'Coach' and tab_icon(page) == '#i-coach', f'{t} compte coach : onglet « Coach », icône du coach ({tab_label(page)!r}, {tab_icon(page)!r})')
        R.check(page.get_attribute('.tabbar [data-tab="friends"]', 'aria-label').startswith('Coach, '), f'{t} badge annoncé avec « Coach »')
        # « Voir qui a progressé » : un toucher depuis n'importe quel onglet
        touches = 1
        open_tab(page)
        page.wait_for_selector('.friends-view .coach-team .team-week')
        page.wait_for_selector('.coach-student-row[data-signal="records"]')
        page.wait_for_timeout(300)
        R.check(page.inner_text('.friends-view .navbar__large').strip() == 'Coach', f'{t} grand titre « Coach »')
        R.check(page.get_attribute('.social-seg [data-seg="students"]', 'aria-pressed') == 'true', f'{t} ouvert sur Élèves')
        week = [x.replace('\n', ' ') for x in page.locator('.team-week__tile').all_inner_texts()]
        R.check(week == ['↑ 1 record', '1 à relancer', '1 nouveauté'], f'{t} cette semaine : records, à relancer, nouveautés ({week})')
        R.check(page.locator('.team-week__tile--up').count() == 1 and page.locator('.team-week__tile--warn').count() == 1, f'{t} couleurs : vert et orange')
        aria = page.get_attribute('.team-week', 'aria-label')
        R.check(aria == 'Cette semaine : 1 record, 1 élève à relancer, 1 nouveauté à lire.', f'{t} VoiceOver : une phrase ({aria!r})')
        zoe = page.locator('.coach-student-row', has_text='zoe')
        R.check('1 record' in zoe.inner_text(), f'{t} qui a progressé : zoe, en {touches} toucher')
        R.check(page.locator('.feed-card, #socialSearch').count() == 0, f'{t} Élèves : ni fil ni recherche')
        layout(page, t, 'Coach › Élèves')
        shot(page, LOT, f'5-coach-eleves-{t}')
        # Fiche d'un élève : deux touchers
        page.evaluate("document.querySelector('.coach-student-row').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
        page.wait_for_timeout(300)
        R.check(page.evaluate('view') == 'friends', f'{t} pointerdown seul : rien ne s\'ouvre')
        zoe.click()
        touches += 1
        page.wait_for_selector('.coach-student-view')
        R.check(touches == 2 and page.evaluate('view') == 'coach-student', f'{t} fiche d\'un élève en {touches} touchers')
        R.check(page.get_attribute('.navbar__back', 'aria-label') == 'Retour : Coach', f'{t} retour « Coach »')
        page.click('[data-action="back"]')
        page.wait_for_selector('.coach-team .coach-student-row')
        R.check(page.get_attribute('.social-seg [data-seg="students"]', 'aria-pressed') == 'true', f'{t} retour : toujours Élèves')
        # Segment Social : ses amis, son fil, Mon profil
        page.click('.social-seg [data-seg="friends"]')
        page.wait_for_selector('.feed-card[data-id="l0"]')
        R.check(page.locator('#socialSearch').count() == 1 and page.locator('.coach-student-row').count() == 0, f'{t} Social : recherche et fil, sans les élèves')
        R.check(page.locator('#coachJoin .cell').count() == 0, f'{t} coach : pas de « Rejoindre un coach »')
        layout(page, t, 'Coach › Social')
        shot(page, LOT, f'6-coach-social-{t}')
        page.click('.social-seg [data-seg="students"]')
        page.wait_for_selector('.coach-team .coach-student-row')
        # Retirer un élève depuis sa fiche : retour au segment Élèves
        page.locator('.coach-student-row', has_text='hugo').click()
        page.wait_for_selector('[data-action="coach-remove"]')
        page.click('[data-action="coach-remove"]')
        page.wait_for_timeout(300)
        tap_dialog(page, "Retirer l'élève")
        page.wait_for_timeout(600)
        R.check(page.evaluate('view') == 'friends' and page.evaluate('nav.stacks.friends.length') == 1 and page.locator('.coach-student-row').count() == 2,
                f'{t} élève retiré : retour à Élèves ({page.evaluate("nav.stacks.friends")})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_eleve(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, username='lea', enable=False)
        page.evaluate("""() => { const c = __sb.addPerson({ username: 'coach.alex', avatar: '🦁', social: false }); __sb.makeCoach(c); __sb.link(c, __sb.meId(), Date.now() - 20 * 86400000); }""")
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        R.check(tab_label(page) == 'Social', f'{t} élève : onglet « Social »')
        open_tab(page)
        page.wait_for_selector('#coachCell [data-action="coach-open-mine"]')
        R.check('coach.alex' in page.inner_text('#coachCell'), f'{t} « Mon coach » en tête')
        R.check(page.locator('#coachJoin .cell').count() == 0 and page.locator('.social-seg').count() == 0, f'{t} élève : ni « Rejoindre » ni segments')
        layout(page, t, 'Social de l\'élève')
        shot(page, LOT, f'7-eleve-{t}')
        page.click('#coachCell [data-action="coach-open-mine"]')
        page.wait_for_selector('.coach-mine-view')
        R.check(page.evaluate('view') == 'coach-mine', f'{t} Mon coach en un toucher depuis l\'onglet')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_pratiquant, t_fil_vide, t_coach, t_eleve])
