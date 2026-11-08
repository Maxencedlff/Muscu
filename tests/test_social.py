"""Social (Social V1 et V2, app iOS simulée) : onglet Social et ses trois états, badge, activation, recherche,
demandes, fil (Bravo, détail, pagination), profil d'un autre (s'abonner, annuler, se désabonner,
bloquer, signaler), Gérer, Désactiver, Historique › Séance (Visible sur mon profil, qui a réagi),
bilan de fin de séance (Visible sur mon profil, œil barré dans l'Historique), hors ligne, tranche d'âge
partagée par Apple (moins de 15 ans : Social masqué, désactivé sur le serveur, Historique › Séance sans Social ni
commentaires, « Rejoindre un coach » masqué ; 15-17 ans : séances masquées par défaut ; refus : rien ne change).

L'app iOS et Supabase sont simulés (tests/fake_account.py, règles de docs/SOCIAL_V1.md) : aucune requête
ne sort. Captures : $PPL_SCRATCH/shots/lotsocial/ (chaque nouvel écran, clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_social.py (ou run_all.py social).
"""
import json
import time
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'social'
R = Results(LOT)
DAY = 86400_000


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
        && e.textContent.trim() && !e.matches('input, svg, use, .icon *') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
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


def layout(page, t, name):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page)
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')
    R.check(last_above_tabbar(page), f'{t} {name} : dernier élément au-dessus de la barre d\'onglets')


def toast(page):
    return page.locator('.toast').inner_text() if page.locator('.toast').count() else ''


# ─────────────────────────────────────────────────────────────

def t_tabbar_sans_compte(bench, eng, dev, theme):
    """Cinq onglets aux libellés entiers ; sans compte : explication et « Se connecter »."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        tabs = page.locator('.tabbar [role="tab"]')
        labels = [x.strip() for x in tabs.all_inner_texts()]
        R.check(labels == ['Entraînement', 'Historique', 'Progrès', 'Programme', 'Social'], f'{t} 5 onglets {labels}')
        cut = page.evaluate("""[...document.querySelectorAll('.tabbar__label')].filter(l => l.scrollWidth > l.clientWidth + .5
            || l.getBoundingClientRect().width > l.parentElement.getBoundingClientRect().width).map(l => l.textContent)""")
        R.check(not cut, f'{t} libellés entiers {cut}')
        widths = [tabs.nth(i).bounding_box()['width'] for i in range(5)]
        R.check(min(widths) >= 44 and min(tabs.nth(i).bounding_box()['height'] for i in range(5)) >= 44, f'{t} onglets de 44 pt ({widths})')
        R.check(page.locator('.tabbar__badge').count() == 0, f'{t} sans compte : pas de badge')
        friends_tab(page)
        R.check(page.evaluate('view') == 'friends' and page.evaluate('location.hash') == '#friends', f'{t} onglet Social ouvert')
        body = page.inner_text('#friendsBody')
        R.check('Entraîne-toi avec tes amis' in body and page.locator('[data-action="social-sign-in"]').inner_text().strip() == 'Se connecter', f'{t} sans compte : explication et « Se connecter »')
        R.check(calls(page, 'social_state') == [], f'{t} sans compte : aucun appel au serveur')
        layout(page, t, 'sans compte')
        shot(page, LOT, f'1-sans-compte-{t}')
        page.click('[data-action="social-sign-in"]')
        page.wait_for_selector('.account-view')
        R.check(page.locator('.account-view .auth-btn').count() >= 2, f'{t} « Se connecter » → écran Compte')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_activation(bench, eng, dev, theme):
    """Social pas activé : pseudo obligatoire, case 15 ans, règles, « Activer »."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username=None)
        friends_tab(page)
        page.wait_for_selector('[data-action="social-enable"]')
        R.check(page.locator('[data-action="social-choose-username"] .cell__value').inner_text().strip() == 'Choisir', f'{t} sans pseudo : « Choisir »')
        btn = page.locator('[data-action="social-enable"]')
        R.check(btn.is_disabled(), f'{t} « Activer » grisé sans pseudo ni âge')
        age = page.locator('[data-action="social-age"]')
        age.click()
        R.check(page.locator('[data-action="social-age"]').get_attribute('aria-checked') == 'true', f'{t} case 15 ans cochée')
        R.check(page.locator('[data-action="social-enable"]').is_disabled(), f'{t} toujours grisé sans pseudo')
        # Panels de la vague 3 : grisé, il reste à sa place et opaque, sans rien recouvrir (interrupteur, note)
        g = page.evaluate("""() => { const b = document.querySelector('[data-action=social-enable]'), r = b.getBoundingClientRect(), cs = getComputedStyle(b);
            const over = [...document.querySelectorAll('[data-action=social-age], .group-foot')].some(e => { const q = e.getBoundingClientRect(); return q.bottom > r.top + 1 && q.top < r.bottom - 1; });
            return { pos: cs.position, op: cs.opacity, over }; }""")
        R.check(g['pos'] == 'static' and g['op'] == '1' and not g['over'], f'{t} « Activer » grisé : à sa place, opaque, ne recouvre rien {g}')
        foot = page.inner_text('.group-foot:has(.link-inline[data-action="social-rules"])')
        R.check('jamais montrés à tes amis' in foot and 'coach' not in foot, f'{t} pied : rien n\'est montré aux amis, sans coach ({foot!r})')
        shot(page, LOT, f'2-activation-sans-pseudo-{t}')
        # Pseudo choisi par l'écran du pseudo (calque du compte)
        page.click('[data-action="social-choose-username"]')
        page.wait_for_selector('#authUsername')
        lead = page.inner_text('.auth__lead')
        R.check('Tes amis te trouveront avec ce pseudo' in lead and 'toi seul' not in lead, f'{t} écran du pseudo : texte du social V1 ({lead!r})')
        page.fill('#authUsername', 'max.dlf')
        page.wait_for_timeout(700)
        page.click('[data-role="save"]')
        page.wait_for_timeout(600)
        R.check(page.locator('.auth').count() == 0, f'{t} pseudo enregistré')
        R.check(page.locator('[data-action="social-choose-username"] .cell__value').inner_text().strip() == 'max.dlf', f'{t} pseudo affiché sur la carte')
        R.check(page.locator('[data-action="social-enable"]').is_enabled(), f'{t} « Activer » actif')
        layout(page, t, 'activation')
        page.wait_for_timeout(2500)   # fin du toast « Pseudo enregistré »
        # Panel Apple du 08/11 : « Activer » collé au-dessus de la barre d'onglets, visible sans défiler (iPhone SE compris)
        page.evaluate('scrollTo(0, 0)'); page.wait_for_timeout(300)
        box = page.evaluate("(() => { const b = document.querySelector('[data-action=social-enable]').getBoundingClientRect(), t = document.querySelector('.tabbar').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, tab: t.top }; })()")
        R.check(box['top'] >= 0 and box['bottom'] <= box['tab'] + 1, f'{t} « Activer » visible sans défiler, au-dessus de la barre d\'onglets {box}')
        shot(page, LOT, f'2b-activer-colle-{t}')
        page.evaluate("document.querySelector('[data-action=social-enable]').scrollIntoView({ block: 'center' })"); page.wait_for_timeout(300)
        R.check(page.evaluate("document.querySelector('[data-action=social-enable]').getBoundingClientRect().bottom <= document.querySelector('.tabbar').getBoundingClientRect().top"), f'{t} « Activer » atteint en défilant')
        # Élève suivi (panel du 06/11) : la phrase absolue était fausse, son coach voit les notes de séance
        page.evaluate("async () => { const c = __sb.addPerson({ username: 'max', social: false }); __sb.makeCoach(c); __sb.link(c, __sb.meId()); await coachRefresh(); render(); }")
        page.wait_for_timeout(400)
        foot = page.inner_text('.group-foot:has(.link-inline[data-action="social-rules"])')
        R.check('jamais montrés à tes amis' in foot and 'Ton coach, lui, voit tes séances et leurs notes' in foot, f'{t} pied : ce que voit le coach dit ({foot!r})')
        shot(page, LOT, f'2-activation-{t}')
        # Règles de la communauté
        page.click('#friendsBody [data-action="social-rules"]')
        page.wait_for_selector('.social-rules-view')
        txt = page.inner_text('.social-rules-view')
        R.check('15 ans' in txt and '24 heures' in txt and 'contact@mdlf.app' in txt, f'{t} règles : 15 ans, 24 h, contact')
        layout(page, t, 'règles')
        shot(page, LOT, f'2b-regles-{t}')
        page.click('[data-action="back"]')
        page.wait_for_selector('[data-action="social-enable"]')
        R.check(page.locator('[data-action="social-age"]').get_attribute('aria-checked') == 'true', f'{t} case gardée au retour')
        page.click('[data-action="social-enable"]')
        page.wait_for_selector('#socialSearch')
        R.check(calls(page, 'social_enable') == [{'age_ok': True}], f'{t} social_enable(age_ok: true) {calls(page, "social_enable")}')
        R.check(page.locator('.navbar [data-action="social-me"]').count() == 1, f'{t} activé : mon avatar (Mon profil) en haut à droite')
        empty = page.inner_text('#friendsBody')
        R.check('Ton fil t\'attend' in empty and 'max.dlf' in empty and page.locator('#friendsBody [data-action="social-invite"]').count() == 1, f'{t} fil vide : accueil, mon pseudo, « Inviter un ami » ({empty!r})')
        # Une seule recherche : le champ au-dessus du fil, plus de bouton « Rechercher un pseudo » en double (panel du 08/11)
        R.check(page.locator('#socialSearch').count() == 1 and page.locator('[data-action="social-find"]').count() == 0, f'{t} fil vide : une seule recherche (le champ)')
        layout(page, t, 'activé vide')
        shot(page, LOT, f'3-active-vide-{t}')
        # Cache : relancé hors ligne, l'onglet reste activé
        page.evaluate('__sb.fail.social = "offline"')
        R.check(json.loads(ls(page, 'mdlf_social'))['enabled'] is True, f'{t} état activé gardé sur l\'appareil')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def setup_friends(page):
    """Léa (suivie, 25 séances dont une masquée et une supprimée), Tom (demande reçue), Zoé (inconnue),
    Ugo (m'a bloqué)."""
    lea = sessions('l', 23)
    lea[20]['date'] = lea[19]['date']   # deux séances à la même milliseconde, à la jonction des pages
    return page.evaluate("""(s) => {
        const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', sessions: s.lea });
        const tom = __sb.addPerson({ username: 'tom' });
        const zoe = __sb.addPerson({ username: 'zoe', avatar: '🐼' });
        const ugo = __sb.addPerson({ username: 'ugo' });
        const me = __sb.meId();
        __sb.follow(me, lea, 'accepted');
        __sb.follow(tom, me, 'pending');
        __sb.block(ugo, me);
        __sb.so.seenAt[me] = Date.now() + 1;   // relations d'avant : rien de nouveau dans l'activité (test_reactions.py)
        return { lea, tom, zoe, ugo, me };
    }""", {'lea': lea + sessions('lh', 1, start_days=0, hidden=True) + sessions('ld', 1, start_days=0, deleted=True)})


def t_fil(bench, eng, dev, theme):
    """Fil : cartes, liste blanche, Bravo, détail des séries, pagination ; demandes et badge."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        ids = setup_friends(page)
        page.evaluate('socialRefresh()')
        page.wait_for_timeout(300)
        badge = page.locator('.tabbar [data-tab="friends"] .tabbar__badge')
        R.check(badge.count() == 1 and badge.inner_text() == '1', f'{t} badge : 1 demande reçue')
        R.check(page.get_attribute('.tabbar [data-tab="friends"]', 'aria-label') == 'Social, 1 demande', f'{t} badge annoncé par VoiceOver')
        friends_tab(page)
        page.wait_for_selector('.feed-card')
        R.check(page.locator('.social-row', has_text='tom').count() == 1 and page.locator('[data-action="social-accept"]').count() == 1, f'{t} demande de tom avec « Accepter »')
        cards = page.locator('.feed-card')
        R.check(cards.count() == 20, f'{t} première page : 20 séances ({cards.count()})')
        R.check(page.locator('.feed-card[data-id="lh00"], .feed-card[data-id="ld00"]').count() == 0, f'{t} séances masquée et supprimée absentes')
        txt = page.inner_text('.feed')
        R.check('note privée' not in txt and '81' not in txt, f'{t} ni notes ni poids du corps')
        first = cards.first
        ft = first.inner_text().replace('\u202f', ' ').replace('\u00a0', ' ')
        R.check('lea' in ft and 'Push' in ft and 'Durée' in ft and 'Volume' in ft and '1,6 t' in ft and 'Séries' in ft, f'{t} carte : pseudo, nom, durée, volume, séries ({ft!r})')
        R.check(first.locator('.feed-card__chip').all_inner_texts()[:1] == ['Pectoraux'], f'{t} carte : muscles travaillés ({first.locator(".feed-card__chip").all_inner_texts()})')
        R.check(first.locator('[data-action="social-open-comments"]').count() == 1, f'{t} carte : « Commenter »')
        R.check(first.locator('.avatar').inner_text() == '🦊', f'{t} carte : avatar emoji')
        R.check(page.evaluate("Object.keys(social.feeds[''].rows[0].s).sort().join()") == 'category,date,duration,exercises,label,programme', f'{t} séance reçue : liste blanche seulement')
        layout(page, t, 'fil')
        shot(page, LOT, f'4-fil-{t}')
        # Pagination par curseur (done_at, owner, id de la dernière carte)
        last_id = page.evaluate("[...document.querySelectorAll('.feed-card')].pop().dataset.id")
        page.click('[data-action="social-more"]')
        page.wait_for_timeout(400)
        befores = [c for c in calls(page, 'feed') if c.get('before_at')]
        R.check(len(befores) == 1 and befores[0]['before_owner'] == ids['lea'] and befores[0]['before_id'] == last_id, f'{t} page suivante : curseur de la dernière carte {befores}')
        got = page.evaluate("[...document.querySelectorAll('.feed-card')].map(c => c.dataset.id)")
        R.check(len(got) == 23 and len(set(got)) == 23, f'{t} 23 séances, aucune perdue ni doublée (même milliseconde à la jonction) ({len(got)})')
        R.check(page.locator('[data-action="social-more"]').count() == 0, f'{t} fin du fil : plus de bouton')
        # Réaction (un toucher) : 👏 donné puis retiré (détail des réactions : test_reactions.py)
        bravo = page.locator('.feed-card').first.locator('.react')
        R.check(bravo.inner_text().strip() == '👏' and bravo.get_attribute('aria-label') == 'Réagir' and 'bravo' not in page.inner_text('#app').lower(),
                f'{t} bouton : 👏 seul, sans « Bravo » ({bravo.inner_text()!r})')
        bravo.click()
        page.wait_for_timeout(300)
        bravo = page.locator('.feed-card').first.locator('.react')
        R.check(bravo.get_attribute('aria-pressed') == 'true' and '👏 1' in page.locator('.feed-card').first.inner_text(), f'{t} bravo donné')
        R.check(page.evaluate('__sb.so.bravos.length') == 1, f'{t} bravo enregistré')
        R.check(small_targets(page, '.react') == [], f'{t} bravo : 44 pt')
        shot(page, LOT, f'4b-bravo-{t}')
        bravo.click()
        page.wait_for_timeout(300)
        R.check(page.locator('.feed-card').first.locator('.react').get_attribute('aria-pressed') == 'false' and page.evaluate('__sb.so.bravos.length') == 0, f'{t} bravo retiré')
        # Détail des séries
        page.locator('.feed-card').first.locator('.feed-card__main').click()
        page.wait_for_selector('.social-session-view')
        d = page.inner_text('.social-session-view')
        R.check('80 kg × 8 · 7' in d and 'Dips' in d and 'note privée' not in d, f'{t} détail des séries ({d[:120]!r})')
        # Volume : charge notée × reps, poids du corps non compté (Dips, Pompes) ; ni flèches ni notes
        vol = page.locator('.social-session-view .tile').first.inner_text()
        R.check('1,6 t' in vol and 'volume' in vol, f'{t} volume de la séance d\'un ami : 1 560 kg, soit 1,6 t ({vol!r})')
        R.check(page.locator('.social-session-view .review-trend, .social-session-view .review-notes').count() == 0, f'{t} séance d\'un ami : ni flèches ni notes')
        R.check(any(c.get('only_user') == ids['lea'] for c in calls(page, 'feed')), f'{t} séances visibles de l\'ami chargées pour les records')
        R.check(page.locator('.social-session-view .review-rec').count() == 0, f'{t} plus de 20 séances visibles : aucun record annoncé sur une partie seulement')
        R.check(page.locator('[data-action="social-report"][data-ref]').count() == 1, f'{t} « Signaler cette séance »')
        layout(page, t, 'séance d\'un ami')
        shot(page, LOT, f'5-seance-ami-{t}')
        page.click('[data-action="back"]')
        page.wait_for_selector('.feed-card')
        # Accepter tom : badge retiré
        page.click('[data-action="social-accept"]')
        page.wait_for_timeout(400)
        R.check(page.locator('.tabbar__badge').count() == 0 and page.locator('[data-action="social-accept"]').count() == 0, f'{t} demande acceptée : badge retiré')
        R.check(page.evaluate("__sb.so.follows.some(f => f.followee === __sb.meId() && f.status === 'accepted')"), f'{t} tom abonné')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_record_ami(bench, eng, dev, theme):
    """Séance d'un ami : volume (sans poids du corps, même avec le mien connu) et un record nommé."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        page.evaluate('data.bodyWeightKg = 90; save()')   # mon poids : ne doit jamais compter dans le volume d'un ami
        now = int(time.time() * 1000)
        legs = lambda i, d, w: {'id': i, 'date': now - d * DAY, 'duration': 2400_000, 'programme': 'ppl', 'category': 'legs', 'label': 'Legs',
                                'exercises': [{'name': 'Squat haltère', 'sets': [{'weight': w, 'reps': '12'}] * 4},
                                              {'name': 'Squat poids du corps', 'sets': [{'weight': '', 'reps': '12'}] * 3}]}
        sam = page.evaluate("""(s) => { const sam = __sb.addPerson({ username: 'sam', avatar: '🐻', sessions: s }); __sb.follow(__sb.meId(), sam, 'accepted'); return sam; }""",
                            [legs('s1', 1, '22.5'), legs('s2', 5, '20')])
        page.evaluate('socialRefresh()')
        page.wait_for_timeout(300)
        friends_tab(page)
        page.wait_for_selector('.feed-card[data-id="s1"]')
        page.locator('.feed-card[data-id="s1"] .feed-card__main').click()
        page.wait_for_selector('.social-session-view .review-rec')
        d = page.inner_text('.social-session-view')
        R.check(page.locator('.social-session-view .tile').first.inner_text().startswith('1,1 t'), f'{t} volume sans poids du corps : 1 080 kg, soit 1,1 t ({d[:200]!r})')
        rec = page.inner_text('.social-session-view .review-rec')
        R.check(page.locator('.social-session-view .review-rec').count() == 1 and 'Squat haltère' in rec and 'Record charge' in rec and '22,5 kg' in rec and 'avant' not in rec, f'{t} un record nommé, sans ancienne valeur ({rec!r})')
        R.check(page.locator('.social-session-view .review-trend').count() == 0, f'{t} aucune flèche')
        layout(page, t, 'séance d\'un ami avec record')
        shot(page, LOT, f'5b-seance-ami-record-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_record_note(bench, eng, dev, theme):
    """Records notés par l'app de l'ami : sur la carte du fil (« Record · Squat 100 kg ») et dans sa
    séance, même quand ses séances ne sont pas toutes chargées ; échauffement hors des séries et du volume."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        now = int(time.time() * 1000)
        top = {'id': 'n0', 'date': now - DAY, 'duration': 2400_000, 'programme': 'ppl', 'category': 'legs', 'label': 'Legs',
               'records': [{'ex': 'Gainage', 'kind': 'temps', 'before': 60, 'after': 75}, {'ex': 'Squat', 'kind': 'charge', 'before': 95, 'after': 100},
                           {'ex': 'Squat', 'kind': '1rm', 'before': 110, 'after': 115}],
               'exercises': [{'name': 'Squat', 'sets': [{'weight': '40', 'reps': '8', 'warmup': True}, {'weight': '100', 'reps': '5', 'rir': 1}]}]}
        # 25 séances visibles en tout : le fil n'en charge que 20
        page.evaluate("""(s) => { const id = __sb.addPerson({ username: 'nina', avatar: '🦊', sessions: s }); __sb.follow(__sb.meId(), id, 'accepted'); }""",
                      [top] + sessions('m', 24, start_days=2))
        page.evaluate('socialRefresh()')
        page.wait_for_timeout(300)
        friends_tab(page)
        page.wait_for_selector('.feed-card[data-id="n0"]')
        card = page.inner_text('.feed-card[data-id="n0"]').replace('\u202f', ' ').replace('\u00a0', ' ')
        R.check('Record · Squat 100 kg' in card, f'{t} carte : record le plus marquant ({card!r})')
        R.check(page.locator('.feed-card__rec').count() == 1, f'{t} seule la séance qui a des records notés en montre un')
        layout(page, t, 'fil avec record')
        shot(page, LOT, f'4c-fil-record-{t}')
        page.locator('.feed-card[data-id="n0"] .feed-card__main').click()
        page.wait_for_selector('.social-session-view .review-rec')
        rec = page.inner_text('.social-session-view .review-rec')
        R.check('Squat' in rec and 'Record charge' in rec and '100 kg' in rec, f'{t} séance : record noté sans recalcul ({rec!r})')
        tiles = page.locator('.social-session-view .tile').all_inner_texts()
        R.check(tiles[0].startswith('500') and tiles[2].startswith('1'), f'{t} échauffement hors du volume et des séries ({tiles})')
        d = page.inner_text('.social-session-view')
        R.check('Échauffement 40 kg × 8' in d.replace('\u202f', ' ').replace('\u00a0', ' ') and 'RIR' not in d, f'{t} échauffement à part, RIR réservé au coach')
        shot(page, LOT, f'5c-seance-ami-record-note-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_profil(bench, eng, dev, theme):
    """Recherche, s'abonner, annuler la demande, profil suivi, se désabonner, bloquer, signaler."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        ids = setup_friends(page)
        friends_tab(page)
        page.wait_for_selector('#socialSearch')
        page.fill('#socialSearch', '@Zo')
        page.wait_for_timeout(600)
        R.check(calls(page, 'search_profiles')[-1] == {'q': 'zo'}, f'{t} recherche normalisée {calls(page, "search_profiles")}')
        R.check(page.locator('.social-results .social-row').count() == 1 and 'zoe' in page.inner_text('.social-results'), f'{t} zoé trouvée')
        R.check(page.evaluate('document.activeElement.id') == 'socialSearch', f'{t} le champ garde le focus')
        layout(page, t, 'recherche')
        shot(page, LOT, f'6-recherche-{t}')
        page.click('.social-results [data-action="social-follow"]')
        page.wait_for_timeout(400)
        R.check('Demandé' in page.inner_text('.social-results'), f'{t} demande envoyée : « Demandé »')
        # Bloqué par ugo : invisible dans la recherche
        page.fill('#socialSearch', 'ug')
        page.wait_for_timeout(600)
        R.check('Aucun pseudo' in page.inner_text('#friendsBody'), f'{t} blocage : ugo introuvable')
        # Demande vers ugo (qui m'a bloqué) : répond comme une demande normale, rien n'est révélé
        r = page.evaluate(f"socialRequestFollow('{ids['ugo']}')")
        R.check(r == {'ok': True, 'data': 'requested'} and page.evaluate(f"socialRelation('{ids['ugo']}', social.state).status") == 'requested', f'{t} demande vers un bloquant : « Demandé », rien de révélé')
        R.check(page.evaluate(f"__sb.so.follows.filter(f => f.followee === '{ids['ugo']}').map(f => f.status).join()") == 'ghost', f'{t} demande fantôme côté serveur')
        R.check(page.evaluate(f"(() => {{ const me = __sb.meId(); __sb.session.user.id = '{ids['ugo']}'; const n = __sb.so.follows.filter(f => f.followee === '{ids['ugo']}' && f.status === 'pending').length; __sb.session.user.id = me; return n; }})()") == 0, f'{t} ugo ne voit aucune demande')
        page.fill('#socialSearch', '')
        page.wait_for_timeout(300)
        # Profil de zoé : demande en cours → « Annuler la demande »
        page.evaluate(f"navigate(makeRoute('social-profile', '{ids['zoe']}'))")
        page.wait_for_selector('.social-profile-view')
        R.check(page.locator('[data-action="social-cancel"]').inner_text().strip() == 'Annuler la demande', f'{t} profil : « Annuler la demande »')
        R.check('quand ta demande sera acceptée' in page.inner_text('.social-profile-view'), f'{t} séances pas encore visibles')
        layout(page, t, 'profil en attente')
        shot(page, LOT, f'7-profil-demande-{t}')
        page.click('[data-action="social-cancel"]')
        page.wait_for_timeout(400)
        R.check(page.locator('[data-action="social-follow"]').inner_text().strip() == 'Suivre', f'{t} demande annulée : « Suivre »')
        # Signaler zoé : motif, envoi, proposition de bloquer
        page.click('[data-action="social-report"]')
        page.wait_for_timeout(300)
        R.check(page.locator('.ios-dialog__btn').count() == 7, f'{t} six motifs et Annuler')
        shot(page, LOT, f'8-signaler-{t}')
        tap_dialog(page, 'Spam ou publicité')
        page.wait_for_timeout(300)
        rep = page.evaluate('__sb.so.reports')
        R.check(len(rep) == 1 and rep[0]['kind'] == 'profile' and rep[0]['reason'] == 'spam' and rep[0]['target_user'] == ids['zoe'], f'{t} signalement envoyé {rep}')
        R.check('24 heures' in page.inner_text('.ios-dialog'), f'{t} signalement : délai de 24 h dit')
        tap_dialog(page, 'OK')
        # Limite de 10 par jour : message traduit
        page.evaluate("for (let i = 0; i < 9; i++) __sb.so.reports.push({ by: __sb.meId() })")
        r = page.evaluate(f"socialReport({{ target: '{ids['zoe']}', kind: 'profile', reason: 'spam' }})")
        R.check(r == {'ok': False, 'kind': 'report_rate'} and 'demain' in page.evaluate("socialErrorText('report_rate')"), f'{t} 429 traduit {r}')
        # Profil de léa (suivie) : ses séances, se désabonner
        page.evaluate(f"navigate(makeRoute('social-profile', '{ids['lea']}'))")
        page.wait_for_selector('.social-profile-view .feed-card')
        R.check(page.locator('.social-profile-view .feed-card').count() == 20 and page.locator('.feed-card__who').count() == 0, f'{t} profil suivi : ses séances (feed only_user)')
        R.check(calls(page, 'feed')[-1].get('only_user') == ids['lea'], f'{t} feed(only_user)')
        layout(page, t, 'profil suivi')
        shot(page, LOT, f'9-profil-suivi-{t}')
        page.click('[data-action="social-unfollow"]')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Ne plus suivre')
        page.wait_for_timeout(400)
        R.check(page.locator('[data-action="social-follow"]').count() == 1 and page.locator('.feed-card').count() == 0, f'{t} désabonné : séances retirées')
        # Bloquer léa
        page.click('[data-action="social-block"]')
        page.wait_for_timeout(300)
        R.check('Personne n\'en est averti' in page.inner_text('.ios-dialog'), f'{t} blocage expliqué')
        tap_dialog(page, 'Bloquer')
        page.wait_for_timeout(400)
        R.check(page.evaluate(f"__sb.so.blocks.some(k => k.blocker === __sb.meId() && k.blocked === '{ids['lea']}')"), f'{t} léa bloquée')
        R.check(page.locator('[data-action="social-unblock"]').count() == 1 and page.locator('[data-action="social-report"]').count() == 0, f'{t} profil bloqué : « Débloquer » seulement')
        shot(page, LOT, f'9b-profil-bloque-{t}')
        page.click('.tabbar [data-tab="friends"]')
        page.wait_for_timeout(500)
        R.check(page.locator('.feed-card').count() == 0, f'{t} plus rien de léa dans le fil')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_gerer(bench, eng, dev, theme):
    """Mon profil › Abonnés (Retirer) et Abonnements ; Gérer : demandes envoyées (Annuler), bloqués (Débloquer), Désactiver."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        ids = setup_friends(page)
        page.evaluate("""(i) => { __sb.follow(i.zoe, i.me, 'accepted'); __sb.follow(i.me, i.tom, 'pending'); __sb.block(i.me, i.ugo); }""", ids)
        friends_tab(page)
        page.click('[data-action="social-me"]')
        page.wait_for_selector('.social-me-view')
        page.wait_for_timeout(300)
        page.click('[data-action="social-people"][data-list="followers"]')
        page.wait_for_selector('.social-people-view')
        R.check('zoe' in page.inner_text('.social-people-view'), f'{t} Abonnés : zoe')
        page.click('[data-action="social-remove-follower"]')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Retirer')
        page.wait_for_timeout(400)
        R.check(page.evaluate(f"!__sb.so.follows.some(f => f.follower === '{ids['zoe']}')"), f'{t} abonnée retirée')
        R.check('Personne ne te suit' in page.inner_text('.social-people-view'), f'{t} Abonnés : liste vide après le retrait')
        page.click('[data-action="back"]')
        page.wait_for_selector('.social-me-view')
        page.click('[data-action="social-people"][data-list="following"]')
        page.wait_for_selector('.social-people-view')
        R.check('lea' in page.inner_text('.social-people-view'), f'{t} Abonnements : lea')
        page.click('[data-action="back"]')
        page.wait_for_selector('.social-me-view')
        page.click('[data-action="social-manage"]')
        page.wait_for_selector('.social-manage-view')
        page.wait_for_timeout(300)
        txt = page.inner_text('.social-manage-view')
        for title in ['DEMANDES ENVOYÉES (1)', 'BLOQUÉS (1)']:
            R.check(title in txt.upper(), f'{t} Gérer : {title}')
        R.check('ABONNÉS (' not in txt.upper() and 'ABONNEMENTS (' not in txt.upper(), f'{t} Gérer : abonnés et abonnements passés dans Mon profil')
        layout(page, t, 'Gérer')
        shot(page, LOT, f'10-gerer-{t}')
        page.click('.social-manage-view [data-action="social-cancel"]')
        page.wait_for_timeout(400)
        R.check(page.evaluate(f"!__sb.so.follows.some(f => f.followee === '{ids['tom']}')"), f'{t} demande envoyée annulée')
        page.click('.social-manage-view [data-action="social-unblock"]')
        page.wait_for_timeout(400)
        R.check(page.evaluate('__sb.so.blocks.filter(k => k.blocker === __sb.meId()).length') == 0, f'{t} débloqué')
        page.click('[data-action="social-disable"]')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Désactiver')
        page.wait_for_timeout(500)
        R.check(page.evaluate('view') == 'friends' and page.locator('[data-action="social-enable"]').count() == 1, f'{t} désactivé : carte d\'activation')
        R.check(page.evaluate('!__sb.so.at[__sb.meId()]') and page.evaluate(f"__sb.so.follows.some(f => f.followee === '{ids['lea']}')"), f'{t} social_at retiré, relations gardées')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_masquer(bench, eng, dev, theme):
    """Historique › Séance : « Visible sur mon profil » éteint (hidden envoyé), qui a réagi, label envoyé, jamais bodyKg."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        sid = page.evaluate('data.history[0].id')
        page.evaluate("""(sid) => { const f = __sb.addPerson({ username: 'lea' }); const g = __sb.addPerson({ username: 'tom' });
            __sb.follow(f, __sb.meId()); __sb.follow(g, __sb.meId());   // une réaction compte tant que son auteur me suit
            __sb.so.bravos.push({ owner: __sb.meId(), sid, user: f }, { owner: __sb.meId(), sid, user: g }); data.history[0].bodyKg = 80; save(true); }""", sid)
        sent = page.evaluate('__sb.upserted.find(r => r.id === data.history[0].id).data')
        R.check(sent.get('label') and 'bodyKg' not in sent, f'{t} séance envoyée avec son nom, sans poids ({sent.get("label")})')
        page.click('.tabbar [data-tab="history"]')
        page.wait_for_timeout(300)
        page.click(f'[data-action="open-history"][data-id="{sid}"]')
        page.wait_for_selector('[data-action="history-hide"]')
        page.evaluate(f'socialLoadMyReactions().then(() => socialLoadWho("{sid}"))')   # réactions reçues depuis la dernière lecture
        page.wait_for_timeout(400)
        R.check(page.locator('.who-list .social-row').count() == 2 and 'RÉACTIONS (2)' in page.inner_text('.history-detail').upper(), f'{t} qui a réagi : 2 personnes')
        hide = page.locator('[data-action="history-hide"]')
        R.check(hide.get_attribute('aria-checked') == 'true' and 'Visible sur mon profil' in hide.inner_text(), f'{t} visible par défaut')
        hide.click()
        page.wait_for_timeout(200)
        R.check(page.locator('[data-action="history-hide"]').get_attribute('aria-checked') == 'false' and page.evaluate('data.history[0].hidden') is True, f'{t} masquée')
        foot = page.locator('[data-action="history-hide"]').locator('xpath=../following-sibling::div[contains(@class,"group-foot")][1]').inner_text()
        R.check(foot == 'Tes amis ne voient pas cette séance.', f'{t} masquée : note qui le dit ({foot!r})')
        R.check('REÇUES AVANT DE LA MASQUER' in page.inner_text('.history-detail').upper() and page.locator('.who-list .social-row').count() == 2, f'{t} masquée : réactions d\'avant')
        layout(page, t, 'séance masquée')
        page.evaluate("document.querySelector('[data-action=history-hide]').scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'11-masquer-{t}')
        page.evaluate('syncNow()')
        page.wait_for_timeout(300)
        last = page.evaluate(f"__sb.upserted.filter(r => r.id === '{sid}').pop().data")
        R.check(last.get('hidden') is True and 'bodyKg' not in last, f'{t} hidden envoyé à la synchro')
        page.locator('[data-action="history-hide"]').click()
        page.wait_for_timeout(200)
        page.evaluate('syncNow()')
        page.wait_for_timeout(300)
        last = page.evaluate(f"__sb.upserted.filter(r => r.id === '{sid}').pop().data")
        R.check('hidden' not in last and page.evaluate("!('hidden' in data.history[0])"), f'{t} de nouveau visible : champ absent')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def open_with_session(page, theme):
    """Comme open_app, avec une séance en cours (3 séries validées) reprise au lancement."""
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(), active=old_active_session(), extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def finish_to_summary(page):
    """Séance en cours (3 séries validées) terminée par « Enregistrer la séance » : bilan affiché."""
    page.click('[data-action="finish-session"]'); page.wait_for_timeout(250)
    tap_dialog(page, 'Enregistrer la séance')
    page.wait_for_selector('.view.summary')
    page.wait_for_timeout(200)


def t_bilan_visible(bench, eng, dev, theme):
    """Bilan : « Visible sur mon profil » seulement avec social activé, allumé par défaut ; éteint → hidden: true
    envoyé (rien d'autre ne change), œil barré « Masquée à tes abonnés » dans l'Historique, réglage repris
    dans Historique › Séance. Sans social : bilan inchangé."""
    t = tag(dev, theme)
    # Sans social (connecté, social non activé) : aucun interrupteur
    with bench.page(eng, dev, theme) as page:
        open_with_session(page, theme)
        signin(page, enable=False)
        page.wait_for_selector('[data-action="finish-session"]')
        finish_to_summary(page)
        R.check(page.locator('[data-action="summary-visible"]').count() == 0, f'{t} sans social : pas d\'interrupteur au bilan')
        R.check(not page.errors, f'{t} sans social : aucune erreur JS {page.errors}')
    with bench.page(eng, dev, theme) as page:
        open_with_session(page, theme)
        signin(page, enable=True)
        page.wait_for_selector('[data-action="finish-session"]')
        finish_to_summary(page)
        sw = page.locator('[data-action="summary-visible"]')
        R.check(sw.count() == 1, f'{t} social activé : interrupteur au bilan')
        txt = sw.inner_text()
        R.check('Visible sur mon profil' in txt and 'Tes amis verront cette séance (jamais tes notes ni ton poids).' in txt, f'{t} bilan : libellé et sous-texte ({txt!r})')
        R.check(sw.get_attribute('aria-checked') == 'true' and sw.get_attribute('role') == 'switch', f'{t} bilan : allumé par défaut')
        sid = page.evaluate('lastSummary.id')
        R.check(page.evaluate(f"!('hidden' in data.history.find(h => h.id === '{sid}'))"), f'{t} bilan : séance visible par défaut (hidden absent)')
        bb = sw.bounding_box()
        R.check(bb['height'] >= 44, f'{t} bilan : cible de 44 px ({bb["height"]})')
        page.fill('#summaryNotes', 'note du bilan')
        page.wait_for_timeout(400)
        page.evaluate('syncNow()'); page.wait_for_timeout(300)
        before = page.evaluate(f"__sb.upserted.filter(r => r.id === '{sid}').pop().data")
        sw.scroll_into_view_if_needed()
        sw.click(); page.wait_for_timeout(200)
        R.check(sw.get_attribute('aria-checked') == 'false' and page.locator('[data-action="summary-visible"] .switch--on').count() == 0, f'{t} bilan : éteint d\'un seul tap')
        R.check(page.evaluate(f"data.history.find(h => h.id === '{sid}').hidden") is True, f'{t} bilan éteint : hidden: true')
        R.check(page.locator('#summaryNotes').input_value() == 'note du bilan', f'{t} bilan : notes gardées après le tap')
        R.check(json.loads(ls(page, 'ppl_v2'))['history'][0].get('hidden') is True, f'{t} bilan éteint : hidden enregistré')
        R.check(no_hscroll(page), f'{t} bilan : pas de défilement horizontal')
        shot(page, LOT, f'13-bilan-visible-{t}')
        page.evaluate('syncNow()'); page.wait_for_timeout(300)
        after = page.evaluate(f"__sb.upserted.filter(r => r.id === '{sid}').pop().data")
        diff = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
        R.check(after.get('hidden') is True and diff == ['hidden'] and 'bodyKg' not in after, f'{t} synchro : seul hidden change ({diff})')
        page.click('.sum-done'); page.wait_for_timeout(250)
        # Historique : œil barré sur la séance masquée seulement
        page.click('.tabbar [data-tab="history"]'); page.wait_for_timeout(300)
        row = page.locator(f'[data-action="open-history"][data-id="{sid}"]')
        mark = row.locator('.hidden-mark')
        R.check(mark.count() == 1 and mark.get_attribute('aria-label') == 'Masquée à tes amis' and mark.get_attribute('role') == 'img', f'{t} Historique : œil barré et libellé VoiceOver')
        R.check(mark.locator('use').get_attribute('href') == '#i-eye.slash', f'{t} Historique : icône eye.slash du système d\'icônes')
        R.check(page.locator('.hidden-mark').count() == 1, f'{t} Historique : œil seulement sur la séance masquée')
        shot(page, LOT, f'14-historique-masquee-{t}')
        # Historique › Séance : même réglage, même libellé, éteint
        row.click()
        page.wait_for_selector('[data-action="history-hide"]')
        hs = page.locator('[data-action="history-hide"]')
        R.check('Visible sur mon profil' in hs.inner_text() and hs.get_attribute('aria-checked') == 'false', f'{t} Historique › Séance : même libellé, éteint')
        hs.click(); page.wait_for_timeout(200)
        R.check(page.evaluate(f"!('hidden' in data.history.find(h => h.id === '{sid}'))"), f'{t} Historique › Séance : rallumé, hidden retiré')
        page.click('[data-action="back"]'); page.wait_for_timeout(300)
        R.check(page.locator('.hidden-mark').count() == 0, f'{t} Historique : plus d\'œil une fois visible')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    # Réglages › Social et coach › Séances visibles par défaut : éteint → la séance suivante naît masquée, bilan éteint
    with bench.page(eng, dev, theme) as page:
        open_with_session(page, theme)
        signin(page, enable=False)
        page.evaluate("navigate('settings')"); page.wait_for_selector('[data-action="coach-open-settings"]')
        R.check(page.locator('[data-action="setting-visible-default"]').count() == 0, f'{t} Réglages sans social : pas de réglage de visibilité')
        page.evaluate('socialEnable(true).then(() => render())'); page.wait_for_timeout(300)
        sw = page.locator('[data-action="setting-visible-default"]')
        R.check(sw.count() == 1 and sw.get_attribute('aria-checked') == 'true' and sw.get_attribute('role') == 'switch', f'{t} Réglages › Social et coach : « Séances visibles par défaut » allumé')
        R.check(page.locator('.view.settings-view .group-title', has_text='Social et coach').count() == 1, f'{t} Réglages : groupe « Social et coach »')
        sw.scroll_into_view_if_needed(); sw.click(); page.wait_for_timeout(200)
        sw = page.locator('[data-action="setting-visible-default"]')
        R.check(sw.get_attribute('aria-checked') == 'false' and page.evaluate('data.sessionVisibleDefault') is False, f'{t} Réglages : éteint d\'un tap, enregistré')
        shot(page, LOT, f'15-reglages-visibles-{t}')
        page.evaluate("navigate('session')"); page.wait_for_selector('[data-action="finish-session"]')
        finish_to_summary(page)
        sw = page.locator('[data-action="summary-visible"]')
        sid = page.evaluate('lastSummary.id')
        R.check(sw.count() == 1 and sw.get_attribute('aria-checked') == 'false', f'{t} bilan : « Visible sur mon profil » prérempli éteint')
        R.check(page.evaluate(f"data.history.find(h => h.id === '{sid}').hidden") is True, f'{t} bilan : séance née masquée (hidden: true)')
        R.check(not page.errors, f'{t} réglage par défaut : aucune erreur JS {page.errors}')


def t_hors_ligne(bench, eng, dev, theme):
    """Hors ligne : le démarrage n'attend rien, l'onglet le dit et propose « Réessayer »."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        ids = setup_friends(page)
        page.evaluate('__sb.fail.social = "offline"; socialReset(account.user.id); localStorage.removeItem("mdlf_social"); socialReset(account.user.id); render()')
        friends_tab(page)
        page.wait_for_timeout(300)
        txt = page.inner_text('#friendsBody')
        R.check('Pas d\'Internet' in txt and page.locator('[data-action="social-retry"]').count() == 1, f'{t} hors ligne : message et « Réessayer » ({txt!r})')
        layout(page, t, 'hors ligne')
        shot(page, LOT, f'12-hors-ligne-{t}')
        page.evaluate('__sb.fail.social = null')
        page.click('[data-action="social-retry"]')
        page.wait_for_selector('.feed-card')
        R.check(page.locator('.feed-card').count() > 0, f'{t} réseau revenu : fil chargé')
        # Bravo hors ligne : annulé, message traduit
        page.evaluate('__sb.fail.social = "offline"')
        page.locator('.feed-card').first.locator('.react').click()
        page.wait_for_timeout(300)
        R.check(page.locator('.feed-card').first.locator('.react').get_attribute('aria-pressed') == 'false' and 'Pas d\'Internet' in toast(page), f'{t} bravo hors ligne annulé ({toast(page)!r})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    # Panel Apple du 08/11 : social activé (état connu), fil vide, hors ligne : un seul message, pas « demandes pas à jour »
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        friends_tab(page)
        page.wait_for_timeout(300)
        page.evaluate('async () => { __sb.fail.social = "offline"; await Promise.allSettled([socialRefresh(), socialLoadFeed("")]); render(); }')
        page.wait_for_timeout(300)
        txt = page.inner_text('#friendsBody')
        R.check(txt.count("Pas d'Internet") == 1 and 'demandes' not in txt and page.locator('[data-action="social-retry"]').count() == 1,
                f'{t} hors ligne, fil vide : un seul message ({txt!r})')
        # Une demande reçue affichée : la note la cite
        page.evaluate("""async () => { __sb.fail.social = null; const tom = __sb.addPerson({ username: 'tom' }); __sb.follow(tom, __sb.meId(), 'pending');
            await Promise.allSettled([socialRefresh(), socialLoadFeed('')]); __sb.fail.social = 'offline';
            await Promise.allSettled([socialRefresh(), socialLoadFeed('')]); render(); }""")
        page.wait_for_timeout(300)
        txt = page.inner_text('#friendsBody')
        R.check('demandes pas à jour' in txt and 'tom' in txt, f'{t} hors ligne avec une demande : la note la cite ({txt!r})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    # Serveur qui ne répond pas : l'app reste utilisable, l'onglet garde l'état connu (cache de l'appareil)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        page.evaluate('__sb.fail.social = "hang"; socialReset(account.user.id); void socialRefresh()')
        page.click('.tabbar [data-tab="history"]')
        page.wait_for_timeout(300)
        R.check(page.evaluate('view') == 'history', f'{t} serveur muet : navigation libre')
        friends_tab(page)
        R.check(page.locator('#socialSearch').count() == 1, f'{t} état activé repris du cache')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_age(bench, eng, dev, theme):
    """Tranche d'âge partagée par Apple (MdlfAgeRange simulé, js/data/age-range.js)."""
    t = tag(dev, theme)
    # Moins de 13 ans, Amis déjà activé : onglet masqué avec une explication, coach gardé, badge éteint
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), {'ageRange': {'status': 'sharing', 'upperBound': 12, 'communicationLimits': False}})
        signin(page, enable=True)
        setup_friends(page)
        friends_tab(page)
        page.wait_for_selector('#friendsBody :text("Social indisponible")')
        body = page.inner_text('#friendsBody')
        R.check('réservé aux 15 ans et plus' in body and 'Le reste de l\'app fonctionne normalement' in body, f'{t} moins de 13 ans : explication ({body!r})')
        R.check(page.locator('#socialSearch, .feed-card, [data-action="social-enable"], .navbar [data-action="social-me"]').count() == 0, f'{t} moins de 13 ans : ni recherche, ni fil, ni Mon profil')
        R.check(page.locator('#coachCell').count() == 1, f'{t} cellule du coach gardée')
        R.check(page.locator('.tabbar__badge').count() == 0, f'{t} badge du social éteint')
        R.check(page.evaluate('newSessionHidden()') is True, f'{t} nouvelle séance masquée aux abonnés')
        layout(page, t, 'âge masqué')
        shot(page, LOT, f'13-age-masque-{t}')
        page.click('.tabbar [data-tab="history"]')
        friends_tab(page)
        R.check(len([c for c in page.evaluate('__sb.calls') if c[0] == 'age']) == 1, f'{t} fenêtre d\'Apple demandée une seule fois')
        R.check(json.loads(ls(page, 'mdlf_age_range'))['status'] == 'sharing', f'{t} tranche gardée sur l\'appareil')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    # 15-17 ans : activation possible, séances masquées par défaut, dit sur la carte
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), {'ageRange': {'status': 'sharing', 'lowerBound': 15, 'upperBound': 17, 'communicationLimits': False}})
        signin(page)
        friends_tab(page)
        page.wait_for_selector('#friendsBody :text("masquées par défaut")')
        R.check(page.locator('[data-action="social-enable"]').count() == 1, f'{t} 15-17 ans : carte d\'activation')
        R.check(page.evaluate('sessionsVisibleByDefault()') is False, f'{t} 15-17 ans : séances masquées par défaut')
        layout(page, t, 'âge 15-17')
        shot(page, LOT, f'13-age-15-17-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    # Refus : comportement actuel
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), {'ageRange': {'status': 'declined'}})
        signin(page)
        friends_tab(page)
        page.wait_for_selector('[data-action="social-enable"]')
        page.wait_for_timeout(300)
        body = page.inner_text('#friendsBody')
        R.check('masquées par défaut' not in body and 'indisponibles' not in body, f'{t} refus : carte habituelle')
        R.check(page.evaluate('sessionsVisibleByDefault()') is True, f'{t} refus : réglage par défaut inchangé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_age_historique(bench, eng, dev, theme):
    """Tranche 'young' (13-15, seuils du Texas) sur un compte où Amis était activé : social_disable une fois,
    Historique › Séance sans « Visible sur mon profil » ni commentaires des autres, « Rejoindre un coach » masqué."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), {'ageRange': {'status': 'sharing', 'lowerBound': 13, 'upperBound': 15, 'communicationLimits': False}})
        signin(page, enable=True)
        sid = page.evaluate("""() => { const lea = __sb.addPerson({ username: 'lea' }), me = __sb.meId(), sid = data.history[0].id;
            __sb.follow(lea, me); __sb.comment(lea, me, sid, 'Bravo pour le développé !', Date.now() - 3600e3); return sid; }""")
        R.check(page.evaluate('socialEnabled()') is True, f'{t} avant la réponse d\'Apple : social activé')
        friends_tab(page)
        page.wait_for_selector('#friendsBody :text("Social indisponible")')
        page.wait_for_timeout(300)
        disables = page.evaluate('__sb.calls.filter(c => c[0] === "social" && c[1] === "social_disable").length')
        R.check(disables == 1, f'{t} Amis désactivé sur le serveur une fois ({disables})')
        R.check(page.evaluate('socialEnabled() === false && socialActivated() === false'), f'{t} Amis éteint, compte compris')
        R.check(page.locator('[data-action="coach-join-start"]').count() == 0, f'{t} « Rejoindre un coach » masqué (moins de 15 ans possible)')
        page.click('.tabbar [data-tab="history"]')
        page.wait_for_timeout(300)
        R.check(page.locator('.hidden-mark').count() == 0, f'{t} liste : pas d\'œil barré')
        page.click(f'[data-action="open-history"][data-id="{sid}"]')
        page.wait_for_selector('.history-detail')
        page.wait_for_timeout(400)
        txt = page.inner_text('.history-detail')
        R.check(page.locator('[data-action="history-hide"]').count() == 0 and 'Visible sur mon profil' not in txt, f'{t} séance : pas de « Visible sur mon profil »')
        R.check(page.locator('#commentsList, #commentInput').count() == 0 and 'Bravo pour le développé' not in txt, f'{t} séance : pas de commentaires des autres')
        R.check(len(calls(page, 'list_comments')) == 0, f'{t} commentaires jamais demandés')
        R.check(page.evaluate('newSessionHidden()') is True, f'{t} nouvelle séance masquée')
        layout(page, t, 'âge historique')
        shot(page, LOT, f'13-age-historique-{t}')
        page.evaluate("navigate('coach')")
        page.wait_for_selector('.coach-view :text("Coach indisponible")')
        R.check(page.locator('[data-action="coach-join"]').count() == 0, f'{t} Réglages › Coach : pas de « Rejoindre un coach »')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_tabbar_sans_compte, t_activation, t_fil, t_record_ami, t_record_note, t_profil, t_gerer, t_masquer, t_bilan_visible, t_hors_ligne, t_age, t_age_historique])
