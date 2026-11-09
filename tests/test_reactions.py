"""Réactions et Mon profil (app iOS simulée) : réaction d'un toucher et par appui long (bulle de choix),
rangée de choix sur la séance d'un ami, « qui a réagi » sur mes séances (Historique et Mon profil),
« 👏 2 » dans l'Historique, écran Mon profil (chiffres, activité, mes séances vues par mes abonnés,
Gérer), pastille de l'onglet Social remise à zéro à l'ouverture de Mon profil.

L'app iOS et Supabase sont simulés (tests/fake_account.py, règles de
supabase/migrations/20261031200000_reactions_profil.sql) : aucune requête ne sort.
Captures : $PPL_SCRATCH/shots/lotreactions/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_reactions.py (ou run_all.py reactions).
"""
import json
import re
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'reactions'
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
        && e.textContent.trim() && !e.matches('input, svg, use, .icon *, .visually-hidden, .sr-text') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""")


def toast(page):
    return page.locator('.toast').inner_text() if page.locator('.toast').count() else ''



def layout(page, t, name):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page)
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')


def long_press(page, locator, ms=650):
    # Au centre de l'écran d'abord : sur un petit écran (iPhone SE), le bouton peut être sous la barre d'onglets
    locator.evaluate("e => e.scrollIntoView({ block: 'center' })")
    page.wait_for_timeout(100)
    box = locator.bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    page.mouse.down()
    page.wait_for_timeout(ms)
    page.mouse.up()
    page.wait_for_timeout(250)


def setup(page):
    """Léa (suivie, 3 séances, me suit), Paul (me suit), Tom (demande reçue), Zoé (a accepté ma demande).
    Mes séances envoyées au serveur ; Léa a réagi 🔥 à la plus récente, Paul 👏."""
    page.evaluate('syncNow()')
    page.wait_for_timeout(300)
    return page.evaluate("""(s) => {
        const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', sessions: s });
        const paul = __sb.addPerson({ username: 'paul', avatar: '🐻' });
        const tom = __sb.addPerson({ username: 'tom' });
        const zoe = __sb.addPerson({ username: 'zoe', avatar: '🐼' });
        const me = __sb.meId();
        const t = Date.now();
        __sb.follow(me, lea, 'accepted');
        __sb.follow(lea, me, 'accepted');
        __sb.follow(paul, me, 'accepted');
        __sb.follow(tom, me, 'pending');
        __sb.follow(me, zoe, 'accepted');
        __sb.so.at[me] = t - 30 * 86400e3;
        __sb.so.follows.forEach(f => { f.at = t - 40 * 86400e3; });   // relations d'avant l'activation : rien de nouveau
        // Ma séance la plus récente (data.history est trié du plus récent au plus ancien)
        const sid = data.history[0].id;
        __sb.react(lea, me, sid, 'fire', t - 2 * 3600e3);
        __sb.react(paul, me, sid, 'clap', t - 26 * 3600e3);
        // Zoé a accepté ma demande il y a 10 min : nouveauté
        __sb.so.follows.find(f => f.follower === me && f.followee === zoe).at = t - 600e3;
        return { lea, paul, tom, zoe, me, sid };
    }""", sessions('l', 3))


def t_reagir(bench, eng, dev, theme):
    """Un toucher : 👏 ; appui long : bulle de choix (5 réactions, 44 pt, Échap) ; séance d'un ami : rangée."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        ids = setup(page)
        friends_tab(page)
        page.wait_for_selector('.feed-card')
        card = page.locator('.feed-card').first
        btn = card.locator('.react')
        R.check(btn.get_attribute('aria-describedby') == 'reactHint' and page.locator('#reactHint').count() == 1, f'{t} consigne VoiceOver de l\'appui long')
        # Appui long : la bulle s'ouvre, rien n'est posé
        long_press(page, btn)
        R.check(page.locator('.react-picker').count() == 1, f'{t} appui long : bulle ouverte')
        R.check(page.evaluate('__sb.so.bravos.filter(b => b.user === __sb.meId()).length') == 0, f'{t} appui long : aucun 👏 posé en plus')
        R.check(page.locator('.react-picker__btn').count() == 5, f'{t} bulle : 5 réactions')
        labels = page.evaluate("[...document.querySelectorAll('.react-picker__btn')].map(b => b.getAttribute('aria-label'))")
        R.check(labels == ['Applaudissements', 'Chaud', 'Costaud', 'Record', 'Impressionnant'], f'{t} bulle : noms VoiceOver {labels}')
        R.check(small_targets(page, '.react-picker__btn') == [], f'{t} bulle : 44 pt')
        r = page.evaluate("(() => { const p = document.querySelector('.react-picker').getBoundingClientRect(); return [p.left >= 0, p.right <= innerWidth, p.top >= 0]; })()")
        R.check(all(r), f'{t} bulle dans l\'écran {r}')
        shot(page, LOT, f'1-bulle-{t}')
        page.keyboard.press('Escape')
        page.wait_for_timeout(150)
        R.check(page.locator('.react-layer').count() == 0, f'{t} Échap ferme la bulle')
        long_press(page, page.locator('.feed-card').first.locator('.react'))
        page.locator('.react-picker__btn[data-kind="fire"]').click()
        page.wait_for_timeout(400)
        mine = page.evaluate("__sb.so.bravos.filter(b => b.user === __sb.meId()).map(b => b.kind)")
        R.check(mine == ['fire'], f'{t} 🔥 choisi et envoyé {mine}')
        btn = page.locator('.feed-card').first.locator('.react')
        R.check(btn.get_attribute('aria-pressed') == 'true' and btn.inner_text().strip() == '🔥' and btn.get_attribute('aria-label') == 'Retirer ma réaction (Chaud)', f'{t} bouton : ma réaction 🔥 seule, sans texte ({btn.inner_text()!r})')
        R.check(calls(page, 'set_reaction')[-1]['kind'] == 'fire', f'{t} set_reaction(kind: fire)')
        # Changer : une seule par personne
        long_press(page, btn)
        page.locator('.react-picker__btn[data-kind="trophy"]').click()
        page.wait_for_timeout(400)
        R.check(page.evaluate("__sb.so.bravos.filter(b => b.user === __sb.meId()).map(b => b.kind)") == ['trophy'], f'{t} réaction changée, une seule')
        # Un toucher : retirer
        page.locator('.feed-card').first.locator('.react').click()
        page.wait_for_timeout(400)
        R.check(page.evaluate("__sb.so.bravos.filter(b => b.user === __sb.meId()).length") == 0 and page.locator('.feed-card').first.locator('.react').get_attribute('aria-pressed') == 'false', f'{t} un toucher sur ma réaction la retire')
        # Séance d'un ami : rangée des cinq, sans geste
        page.locator('.feed-card').first.locator('.feed-card__main').click()
        page.wait_for_selector('.react-row')
        R.check(page.locator('.react-row__btn').count() == 5 and small_targets(page, '.react-row__btn') == [], f'{t} séance d\'un ami : 5 réactions de 44 pt')
        page.locator('.react-row__btn[data-kind="strong"]').click()
        page.wait_for_timeout(400)
        R.check(page.locator('.react-row__btn[data-kind="strong"]').get_attribute('aria-pressed') == 'true' and 'Ta réaction : Costaud' in page.inner_text('.react-row__foot'), f'{t} rangée : 💪 posée')
        layout(page, t, 'séance d\'un ami')
        page.evaluate("document.querySelector('.react-row').scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'2-seance-ami-{t}')
        page.locator('.react-row__btn[data-kind="strong"]').click()
        page.wait_for_timeout(400)
        R.check(page.evaluate("__sb.so.bravos.filter(b => b.user === __sb.meId()).length") == 0, f'{t} rangée : retouchée, retirée')
        # Hors ligne : affichée tout de suite puis annulée
        page.evaluate('__sb.fail.social = "offline"')
        page.locator('.react-row__btn[data-kind="wow"]').click()
        page.wait_for_timeout(400)
        R.check(page.locator('.react-row__btn--on').count() == 0 and 'Pas d\'Internet' in toast(page), f'{t} hors ligne : réaction annulée ({toast(page)!r})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_mon_profil(bench, eng, dev, theme):
    """Pastille (demande + nouveautés), Mon profil : chiffres, activité, mes séances et qui a réagi, activité vue."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        ids = setup(page)
        page.evaluate('socialRefresh()')
        page.wait_for_timeout(300)
        badge = page.locator('.tabbar [data-tab="friends"] .tabbar__badge')
        # 1 demande (Tom) + 3 nouveautés : réactions de Léa (2 h) et de Paul (hier), Zoé qui a accepté (10 min)
        n = page.evaluate('socialBadge()')
        R.check(badge.count() == 1 and badge.inner_text() == str(n) and n == 4, f'{t} pastille : demande + nouveautés ({badge.inner_text() if badge.count() else None}, {n})')
        R.check('nouveautés' in page.get_attribute('.tabbar [data-tab="friends"]', 'aria-label'), f'{t} pastille annoncée « nouveautés »')
        friends_tab(page)
        me_btn = page.locator('.navbar [data-action="social-me"]')
        R.check(me_btn.locator('.me-btn__dot').count() == 1 and 'nouveaut' in me_btn.get_attribute('aria-label'), f'{t} mon avatar : point des nouveautés')
        R.check(small_targets(page, '.navbar [data-action="social-me"]') == [], f'{t} mon avatar : 44 pt')
        me_btn.click()
        page.wait_for_selector('.social-me-view')
        page.wait_for_timeout(500)
        txt = page.inner_text('.social-me-view')
        stats = page.evaluate("[...document.querySelectorAll('.me-stat')].map(b => b.innerText.replace(/\\s+/g, ' ').trim())")
        R.check(stats[1] == '2 te suivent' and stats[2] == '2 suivis' and stats[0].endswith('séances visibles'), f'{t} chiffres {stats}')
        # Vague 3 : dernière séance, chiffres dans l'ordre du fil (Durée, Volume, Séries), libellé sous la valeur
        facts = page.locator('.last__fact-lbl').all_inner_texts()
        order = [x for x in ['Durée', 'Volume', 'Séries', 'Série'] if x in facts]
        R.check(facts and facts == order, f'{t} Mon profil : chiffres dans l\'ordre du fil ({facts})')
        # Carte d'athlète : membre depuis, régularité lue par VoiceOver ; grands titres de section
        R.check(page.locator('.athlete__sub').inner_text().startswith('Membre depuis '), f'{t} « {page.locator(".athlete__sub").inner_text()} »')
        reg = page.locator('.reg[role="img"]')
        R.check(reg.count() == 1 and 'par semaine en moyenne sur' in reg.get_attribute('aria-label') and 'cette semaine' in reg.get_attribute('aria-label'), f'{t} régularité : résumé VoiceOver {reg.get_attribute("aria-label") if reg.count() else None!r}')
        R.check(page.locator('.reg__bar').count() == 12 and page.locator('.reg__bar--now').count() == 1, f'{t} régularité : 12 barres, la semaine en cours marquée')
        titles = page.locator('.social-me-view h2.group-title--large').all_inner_texts()
        R.check(titles[0] == 'Mes séances' and titles[-1] == 'Activité', f'{t} grands titres {titles}')
        # Activité groupée : les réactions de Léa et Paul à la même séance tiennent en une ligne
        group = page.locator('.activity-row--group')
        gtxt = group.locator('.social-row__text').inner_text() if group.count() == 1 else ''
        R.check(group.count() == 1 and gtxt.startswith('2 réactions sur ') and 'lea, paul' in gtxt and re.search(r'il y a [12] h', gtxt), f'{t} activité : réactions groupées ({gtxt!r})')
        R.check('zoe a accepté ta demande' in txt, f'{t} activité : demande acceptée')
        order = page.evaluate("[...document.querySelectorAll('.activity-row__text')].map(e => e.innerText.split(' ')[0])")
        R.check(order[:2] == ['zoe', '2'], f'{t} activité : du plus récent au plus ancien {order}')
        R.check(page.locator('.activity .social-row').count() == 3, f'{t} activité : 3 lignes avant « Tout voir »')
        R.check(page.locator('.activity-row__new').count() == 2, f'{t} nouveautés marquées : Zoé et le groupe ({page.locator(".activity-row__new").count()})')
        # « Tout voir » : la suite, dont la demande de Tom avec « Accepter »
        page.click('[data-action="social-activity-more"]')
        page.wait_for_timeout(300)
        txt = page.inner_text('.social-me-view')
        R.check('tom veut voir tes séances' in txt and page.locator('.activity [data-action="social-accept"]').count() == 1, f'{t} activité : demande reçue avec « Accepter »')
        R.check('lea a commencé à te suivre' in txt, f'{t} activité : abonnée')
        # Vu : pastille éteinte (reste la demande de Tom), serveur prévenu
        R.check(len(calls(page, 'mark_activity_seen')) == 1, f'{t} mark_activity_seen appelé')
        R.check(badge.inner_text() == '1' and me_btn.count() == 0, f'{t} pastille : la demande seule ({badge.inner_text()})')
        # Mes séances : la dernière en grand, avec ses réactions (sans bouton) et qui a réagi
        own = page.locator('.social-me-view .last')
        R.check(own.count() == 1 and own.locator('.react').count() == 0 and '👏🔥 2' in own.inner_text() and 'lea +1' in own.inner_text(), f'{t} ma dernière séance : réactions sans bouton ({own.inner_text()!r})')
        R.check('note' not in own.inner_text() and 'note' not in page.inner_text('.social-me-view .mysess-list'), f'{t} mes séances : liste blanche')
        n_own = page.evaluate('socialFeed(SOCIAL_ME).rows.length')
        R.check(n_own >= 2 and page.locator('.mysess').count() == min(3, n_own - 1), f'{t} mes séances : la suite en aperçu, 3 au plus ({n_own} visibles)')
        layout(page, t, 'Mon profil')
        shot(page, LOT, f'3-mon-profil-{t}')
        page.evaluate("document.getElementById('meSessions').scrollIntoView()")
        shot(page, LOT, f'3b-mon-profil-seances-{t}')
        own.locator('.last__main').click()
        page.wait_for_selector('.social-session-view')
        page.wait_for_timeout(400)
        who = page.evaluate("[...document.querySelectorAll('.who-list .social-row')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())")
        R.check(len(who) == 2 and 'lea' in who[0] and '🔥' in who[0] and 'paul' in who[1] and '👏' in who[1], f'{t} ma séance : qui a réagi {who}')
        R.check(page.locator('.react-row').count() == 0 and page.locator('[data-action="social-report"]').count() == 0, f'{t} ma séance : ni réagir ni signaler')
        layout(page, t, 'ma séance vue par les autres')
        shot(page, LOT, f'4-ma-seance-{t}')
        page.click('[data-action="back"]')
        page.wait_for_selector('.social-me-view')
        # Ligne des réactions groupées : vers ma séance (Historique › Séance), avec qui a réagi
        page.locator('.activity-row--group [data-action="social-open-my-session"]').click()
        page.wait_for_selector('.history-detail')
        page.wait_for_timeout(500)
        R.check(page.locator('.history-detail .who-list .social-row').count() == 2 and 'RÉACTIONS (2)' in page.inner_text('.history-detail').upper(), f'{t} Historique › Séance : qui a réagi')
        page.evaluate("document.querySelector('.who-list').scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'5-historique-qui-{t}')
        # Retirer Paul de mes abonnés : sa réaction ne compte plus
        page.evaluate(f"socialRemoveFollower('{ids['paul']}')")
        page.wait_for_timeout(500)
        R.check(page.locator('.history-detail .who-list .social-row').count() == 1, f'{t} abonné retiré : plus dans la liste')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_mon_profil_suite(bench, eng, dev, theme):
    """Mon profil : section Records (records récents de l'historique), « Tout voir » des séances, aperçu gardé hors ligne."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        setup(page)
        page.evaluate('socialRefresh()')
        page.wait_for_timeout(300)
        friends_tab(page)
        page.click('.navbar [data-action="social-me"]')
        page.wait_for_selector('.social-me-view .last')
        page.wait_for_timeout(300)
        # Records : valeurs fixées par l'historique de test (ppl_v2_today, tests/fixtures.py), pas relues dans
        # l'app. Charge +2,5 kg toutes les deux semaines, plafonnée à +10 kg : à la dernière semaine (k = 8),
        # seuls les exercices j % 3 == 0 montent encore. Séances les plus récentes : Legs (il y a 4 j : Squat
        # barre 60 → 70 kg, Leg curl 30 → 40 kg), Bras (6 j : charges égales, pas de record), Pull (6 j 3 h :
        # Rowing 24 → 34 kg). Trois records au plus, un par exercice, du plus récent.
        want = [('Squat barre', '70 kg'), ('Leg curl machine', '40 kg'), ('Rowing haltère unilatéral', '34 kg')]
        titles = page.locator('.social-me-view h2.group-title--large').all_inner_texts()
        got = list(zip(page.locator('.rec-row .cell__title').all_inner_texts(),
                       [v.strip() for v in page.locator('.rec-row .rec-row__val').all_inner_texts()]))
        R.check('Records' in titles and got == want, f'{t} records : {got} (attendu {want}, titres {titles})')
        subs = page.locator('.rec-row .cell__sub').all_inner_texts()
        R.check(len(subs) == 3 and all('2,5 kg' in x for x in subs), f'{t} records : date et gain ↑ 2,5 kg ({subs})')
        # Dernière séance : VoiceOver lit le titre visible puis les chiffres, libellé avant valeur
        spoken = page.locator('.last__main .sr-text').inner_text() if page.locator('.last__main .sr-text').count() else ''
        R.check(re.search(r'\d+ séries?', spoken) and 'volume ' in spoken, f'{t} dernière séance : chiffres lus ({spoken!r})')
        # « Tout voir » des séances : toutes, en cartes du fil
        n_own = page.evaluate('socialFeed(SOCIAL_ME).rows.length')
        btn = page.locator('[data-action="social-me-sessions-all"]')
        R.check(btn.count() == 1 and btn.inner_text().strip().startswith('Tout voir'), f'{t} mes séances : « Tout voir » ({n_own} visibles)')
        if btn.count():
            btn.click()
            page.wait_for_timeout(300)
            R.check(page.locator('.social-me-view .last').count() == 0 and page.locator('.social-me-view .feed-card').count() == n_own,
                    f'{t} « Tout voir » : {page.locator(".social-me-view .feed-card").count()} cartes sur {n_own}')
            layout(page, t, 'Mon profil, toutes mes séances')
        # Hors ligne : l'aperçu reste, avec la note du fil
        page.click('[data-action="back"]')
        page.wait_for_timeout(300)
        page.evaluate('__sb.fail.social = "offline"')
        page.click('.navbar [data-action="social-me"]')
        page.wait_for_selector('.social-me-view .last')
        page.wait_for_timeout(500)
        note = page.locator('.social-me-view .social-inline-error')
        R.check(note.count() == 1 and 'Pas d\'Internet' in note.inner_text() and page.locator('.mysess').count() >= 1,
                f'{t} hors ligne : aperçu gardé avec la note ({note.inner_text() if note.count() else None!r})')
        shot(page, LOT, f'3c-mon-profil-hors-ligne-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_historique(bench, eng, dev, theme):
    """Historique : « 🔥 2 » sur une séance qui a reçu des réactions (la plus fréquente + total), rien sinon."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        ids = setup(page)
        page.evaluate(f"__sb.react('{ids['paul']}', __sb.meId(), '{ids['sid']}', 'fire')")   # Paul passe à 🔥 : 🔥 2
        page.evaluate('socialRefresh()')   # comme au retour au premier plan
        page.wait_for_timeout(300)
        page.click('.tabbar [data-tab="history"]')
        page.wait_for_timeout(600)
        mark = page.locator(f'.hrow[data-id="{ids["sid"]}"] .react-mark')
        R.check(mark.count() == 1 and mark.inner_text().strip() == '🔥 2', f'{t} « 🔥 2 » ({mark.inner_text() if mark.count() else None})')
        R.check(mark.get_attribute('aria-label') == '2 réactions : 2 Chaud', f'{t} « 🔥 2 » annoncé par VoiceOver')
        R.check(page.locator('.react-mark').count() == 1, f'{t} séances sans réaction : rien')
        R.check(not cut_texts(page) and no_hscroll(page), f'{t} liste : rien de coupé')
        shot(page, LOT, f'6-historique-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_reagir, t_mon_profil, t_mon_profil_suite, t_historique])
