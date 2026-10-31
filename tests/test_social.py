"""Amis (Social V1, app iOS simulée) : onglet Amis et ses trois états, badge, activation, recherche,
demandes, fil (Bravo, détail, pagination), profil d'un autre (s'abonner, annuler, se désabonner,
bloquer, signaler), Gérer, Désactiver, Historique › Séance (Visible sur mon profil, bravos reçus),
bilan de fin de séance (Visible sur mon profil, œil barré dans l'Historique), hors ligne.

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
        R.check(labels == ['Entraînement', 'Historique', 'Progrès', 'Programme', 'Amis'], f'{t} 5 onglets {labels}')
        cut = page.evaluate("""[...document.querySelectorAll('.tabbar__label')].filter(l => l.scrollWidth > l.clientWidth + .5
            || l.getBoundingClientRect().width > l.parentElement.getBoundingClientRect().width).map(l => l.textContent)""")
        R.check(not cut, f'{t} libellés entiers {cut}')
        widths = [tabs.nth(i).bounding_box()['width'] for i in range(5)]
        R.check(min(widths) >= 44 and min(tabs.nth(i).bounding_box()['height'] for i in range(5)) >= 44, f'{t} onglets de 44 pt ({widths})')
        R.check(page.locator('.tabbar__badge').count() == 0, f'{t} sans compte : pas de badge')
        friends_tab(page)
        R.check(page.evaluate('view') == 'friends' and page.evaluate('location.hash') == '#friends', f'{t} onglet Amis ouvert')
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
        R.check(page.evaluate("document.querySelector('[data-action=social-enable]').getBoundingClientRect().bottom <= document.querySelector('.tabbar').getBoundingClientRect().top"), f'{t} « Activer » visible sans défiler')
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
        R.check(page.locator('[data-action="social-manage"]').count() == 1, f'{t} activé : « Gérer » en haut à droite')
        R.check('Rien pour l\'instant' in page.inner_text('#friendsBody'), f'{t} fil vide expliqué')
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
        R.check(page.get_attribute('.tabbar [data-tab="friends"]', 'aria-label') == 'Amis, 1 demande', f'{t} badge annoncé par VoiceOver')
        friends_tab(page)
        page.wait_for_selector('.feed-card')
        R.check(page.locator('.social-row', has_text='tom').count() == 1 and page.locator('[data-action="social-accept"]').count() == 1, f'{t} demande de tom avec « Accepter »')
        cards = page.locator('.feed-card')
        R.check(cards.count() == 20, f'{t} première page : 20 séances ({cards.count()})')
        R.check(page.locator('.feed-card[data-id="lh00"], .feed-card[data-id="ld00"]').count() == 0, f'{t} séances masquée et supprimée absentes')
        txt = page.inner_text('.feed')
        R.check('note privée' not in txt and '81' not in txt, f'{t} ni notes ni poids du corps')
        first = cards.first
        R.check('lea' in first.inner_text() and 'Push' in first.inner_text() and 'Développé couché, Dips, Élévations latérales et 2 autres' in first.inner_text(), f'{t} carte : pseudo, nom, résumé ({first.inner_text()!r})')
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
        # Bravo : donné puis retiré
        bravo = page.locator('.feed-card').first.locator('.bravo')
        bravo.click()
        page.wait_for_timeout(300)
        bravo = page.locator('.feed-card').first.locator('.bravo')
        R.check(bravo.get_attribute('aria-pressed') == 'true' and '1 bravo' in page.locator('.feed-card').first.inner_text(), f'{t} bravo donné')
        R.check(page.evaluate('__sb.so.bravos.length') == 1, f'{t} bravo enregistré')
        R.check(small_targets(page, '.bravo') == [], f'{t} bravo : 44 pt')
        shot(page, LOT, f'4b-bravo-{t}')
        bravo.click()
        page.wait_for_timeout(300)
        R.check(page.locator('.feed-card').first.locator('.bravo').get_attribute('aria-pressed') == 'false' and page.evaluate('__sb.so.bravos.length') == 0, f'{t} bravo retiré')
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
        R.check(page.locator('.social-session-view .review-rec').count() == 1 and 'Squat haltère' in rec and 'Record charge' in rec and '22,5 kg × 12' in rec and 'avant' not in rec, f'{t} un record nommé, sans ancienne valeur ({rec!r})')
        R.check(page.locator('.social-session-view .review-trend').count() == 0, f'{t} aucune flèche')
        layout(page, t, 'séance d\'un ami avec record')
        shot(page, LOT, f'5b-seance-ami-record-{t}')
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
        R.check(page.locator('[data-action="social-follow"]').inner_text().strip() == 'S\'abonner', f'{t} demande annulée : « S\'abonner »')
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
        tap_dialog(page, 'Se désabonner')
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
    """Gérer : abonnés (Retirer), abonnements, demandes envoyées (Annuler), bloqués (Débloquer), Désactiver."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        ids = setup_friends(page)
        page.evaluate("""(i) => { __sb.follow(i.zoe, i.me, 'accepted'); __sb.follow(i.me, i.tom, 'pending'); __sb.block(i.me, i.ugo); }""", ids)
        friends_tab(page)
        page.click('[data-action="social-manage"]')
        page.wait_for_selector('.social-manage-view')
        page.wait_for_timeout(300)
        txt = page.inner_text('.social-manage-view')
        for title in ['ABONNÉS (1)', 'ABONNEMENTS (1)', 'DEMANDES ENVOYÉES (1)', 'BLOQUÉS (1)']:
            R.check(title in txt.upper(), f'{t} Gérer : {title}')
        layout(page, t, 'Gérer')
        shot(page, LOT, f'10-gerer-{t}')
        page.click('[data-action="social-remove-follower"]')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Retirer')
        page.wait_for_timeout(400)
        R.check(page.evaluate(f"!__sb.so.follows.some(f => f.follower === '{ids['zoe']}')"), f'{t} abonnée retirée')
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
    """Historique › Séance : « Visible sur mon profil » éteint (hidden envoyé), « N bravos », label envoyé, jamais bodyKg."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, enable=True)
        sid = page.evaluate('data.history[0].id')
        page.evaluate("""(sid) => { const f = __sb.addPerson({ username: 'lea' }); const g = __sb.addPerson({ username: 'tom' });
            __sb.so.bravos.push({ owner: __sb.meId(), sid, user: f }, { owner: __sb.meId(), sid, user: g }); data.history[0].bodyKg = 80; save(true); }""", sid)
        sent = page.evaluate('__sb.upserted.find(r => r.id === data.history[0].id).data')
        R.check(sent.get('label') and 'bodyKg' not in sent, f'{t} séance envoyée avec son nom, sans poids ({sent.get("label")})')
        page.click('.tabbar [data-tab="history"]')
        page.wait_for_timeout(300)
        page.click(f'[data-action="open-history"][data-id="{sid}"]')
        page.wait_for_selector('[data-action="history-hide"]')
        page.evaluate('socialLoadMyBravos()')   # bravos reçus depuis la dernière lecture
        page.wait_for_timeout(400)
        R.check(page.locator('.social-bravos-mine').inner_text().strip() == '2 bravos', f'{t} « 2 bravos »')
        hide = page.locator('[data-action="history-hide"]')
        R.check(hide.get_attribute('aria-checked') == 'true' and 'Visible sur mon profil' in hide.inner_text(), f'{t} visible par défaut')
        hide.click()
        page.wait_for_timeout(200)
        R.check(page.locator('[data-action="history-hide"]').get_attribute('aria-checked') == 'false' and page.evaluate('data.history[0].hidden') is True, f'{t} masquée')
        foot = page.locator('[data-action="history-hide"]').locator('xpath=../following-sibling::div[contains(@class,"group-foot")][1]').inner_text()
        R.check(foot == 'Tes abonnés ne voient pas cette séance.', f'{t} masquée : note qui le dit ({foot!r})')
        R.check(page.locator('.social-bravos-mine').inner_text().strip() == '2 bravos reçus avant de la masquer', f'{t} masquée : bravos d\'avant')
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
    """Bilan : « Visible sur mon profil » seulement avec Amis activé, allumé par défaut ; éteint → hidden: true
    envoyé (rien d'autre ne change), œil barré « Masquée à tes abonnés » dans l'Historique, réglage repris
    dans Historique › Séance. Sans Amis : bilan inchangé."""
    t = tag(dev, theme)
    # Sans Amis (connecté, social non activé) : aucun interrupteur
    with bench.page(eng, dev, theme) as page:
        open_with_session(page, theme)
        signin(page, enable=False)
        page.wait_for_selector('[data-action="finish-session"]')
        finish_to_summary(page)
        R.check(page.locator('[data-action="summary-visible"]').count() == 0, f'{t} sans Amis : pas d\'interrupteur au bilan')
        R.check(not page.errors, f'{t} sans Amis : aucune erreur JS {page.errors}')
    with bench.page(eng, dev, theme) as page:
        open_with_session(page, theme)
        signin(page, enable=True)
        page.wait_for_selector('[data-action="finish-session"]')
        finish_to_summary(page)
        sw = page.locator('[data-action="summary-visible"]')
        R.check(sw.count() == 1, f'{t} Amis activé : interrupteur au bilan')
        txt = sw.inner_text()
        R.check('Visible sur mon profil' in txt and 'Tes abonnés verront cette séance (jamais tes notes ni ton poids).' in txt, f'{t} bilan : libellé et sous-texte ({txt!r})')
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
        R.check(mark.count() == 1 and mark.get_attribute('aria-label') == 'Masquée à tes abonnés' and mark.get_attribute('role') == 'img', f'{t} Historique : œil barré et libellé VoiceOver')
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
    # Réglages › Amis et coach › Séances visibles par défaut : éteint → la séance suivante naît masquée, bilan éteint
    with bench.page(eng, dev, theme) as page:
        open_with_session(page, theme)
        signin(page, enable=False)
        page.evaluate("navigate('settings')"); page.wait_for_selector('[data-action="coach-open-settings"]')
        R.check(page.locator('[data-action="setting-visible-default"]').count() == 0, f'{t} Réglages sans Amis : pas de réglage de visibilité')
        page.evaluate('socialEnable(true).then(() => render())'); page.wait_for_timeout(300)
        sw = page.locator('[data-action="setting-visible-default"]')
        R.check(sw.count() == 1 and sw.get_attribute('aria-checked') == 'true' and sw.get_attribute('role') == 'switch', f'{t} Réglages › Amis et coach : « Séances visibles par défaut » allumé')
        R.check(page.locator('.view.settings-view .group-title', has_text='Amis et coach').count() == 1, f'{t} Réglages : groupe « Amis et coach »')
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
        page.locator('.feed-card').first.locator('.bravo').click()
        page.wait_for_timeout(300)
        R.check(page.locator('.feed-card').first.locator('.bravo').get_attribute('aria-pressed') == 'false' and 'Pas d\'Internet' in toast(page), f'{t} bravo hors ligne annulé ({toast(page)!r})')
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


run_main(R, [t_tabbar_sans_compte, t_activation, t_fil, t_record_ami, t_profil, t_gerer, t_masquer, t_bilan_visible, t_hors_ligne])
