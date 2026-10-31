"""Abonnement (Payant V1, MODÈLE B, app iOS simulée) : l'essai gratuit de 3 mois est l'offre de
lancement d'Apple, lue chez StoreKit (« 3 mois gratuits, puis 77,77 € par an », ou le prix normal si
l'essai a déjà servi) ; sans abonnement, plus d'essai maison : mode lecture seule verrou allumé
(Historique, Progrès, profil et export restent ouverts, rien n'est supprimé) ; mentions de la règle
3.1.2 d'Apple ; achat, restauration, codes ; séance commencée avec le droit d'écrire qui s'enregistre
même si l'accès a pris fin ; compte obligatoire verrou allumé ; verrou éteint (rien ne bloque) ;
horloge de l'appareil trafiquée ; hors ligne.

L'app iOS, StoreKit et Supabase sont simulés (tests/fake_account.py + tests/fake_store.py, règles de
docs/PAYANT_V1.md) : aucune requête ne sort, aucun achat réel.
Captures : $PPL_SCRATCH/shots/lotpayant/ (chaque écran, clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_payant.py (ou run_all.py payant).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT
from fake_store import FAKE_STORE

LOT = 'payant'
R = Results(LOT)
DAY = 86400_000
MONTHLY = 'com.mdlf.training.pro.monthly'
YEARLY = 'com.mdlf.training.pro.yearly'
# Prix volontairement inhabituels : s'ils s'affichent, ils viennent bien de StoreKit. Les clés sont
# celles du vrai module Swift (displayPrice affichable, price numérique), cf. fake_store.py
PRICES = [{'id': MONTHLY, 'displayName': 'MDLF Training mensuel', 'description': 'Mensuel',
           'displayPrice': '7,77 €', 'price': 7.77, 'currency': 'EUR',
           'period': {'unit': 'month', 'value': 1}, 'introEligible': True},
          {'id': YEARLY, 'displayName': 'MDLF Training annuel', 'description': 'Annuel',
           'displayPrice': '77,77 €', 'price': 77.77, 'currency': 'EUR',
           'period': {'unit': 'year', 'value': 1}, 'introEligible': True}]


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, ppl_v2=None, store=None, opts=None):
    """App lancée avec la coquille iOS, Supabase et StoreKit simulés. store : réglages de __st."""
    st_opts = {'paywallOn': True, 'products': PRICES, **(store or {})}
    if st_opts.get('products') == 'all':
        del st_opts['products']   # le catalogue complet du faux StoreKit : 10 abonnements et l'accès à vie
    else:
        st_opts.setdefault('lifetimeProduct', None)   # deux formules seulement (prix inhabituels)
    page.add_init_script('window.__fakeOpts = %s; window.__stOpts = %s;'
                         % (json.dumps({'oldAccounts': True, **(opts or {})}), json.dumps(st_opts)))
    page.add_init_script(FAKE_ACCOUNT)
    page.add_init_script(FAKE_STORE)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2, extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username='max'):
    page.evaluate("""async (u) => {
        await accountSignInWith('apple', async () => 'add');
        if (u) await accountSaveProfile({ username: u });
    }""", username)
    page.wait_for_timeout(200)


def refresh_access(page):
    page.evaluate('access.loadedAt = 0; accessRefresh()')
    page.wait_for_timeout(350)


def subscribed(page, days=365, intro=False, product=YEARLY):
    """Abonnement écrit par le serveur (intro : dans l'offre de lancement d'Apple, l'essai gratuit)."""
    page.evaluate('([p, d, i]) => __st.subscribe(p, d, { intro: i })', [product, days, intro])
    refresh_access(page)


def ended(page, hours_ago):
    """L'abonnement a pris fin il y a N heures (Apple l'a fermé), à l'heure du SERVEUR."""
    page.evaluate('h => __st.endAccess(h)', hours_ago)
    refresh_access(page)


def acalls(page, fn):
    return page.evaluate('f => __st.calls.filter(c => c[0] === "access" && c[1] === f)', fn)


def store_calls(page, fn):
    return page.evaluate('f => __st.calls.filter(c => c[0] === f)', fn)


def code_sheet(page, code, ok=True):
    """Feuille du code cadeau MDLF : saisie puis Valider ; texte d'aide si la feuille reste ouverte."""
    page.wait_for_selector('#payCode')
    page.fill('#payCode', code)
    page.click('.sheet__btn--confirm')
    page.wait_for_timeout(500)
    return '' if ok else (page.inner_text('#payCodeHelp') if page.locator('#payCode').count() else '')


def toast(page):
    return page.locator('.toast').inner_text() if page.locator('.toast').count() else ''


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small_targets(page, sel='#app button, .tabbar button'):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def cut_texts(page):
    """Textes coupés, hors « ... exercices » de la carte d'accueil : ce repli existe avant ce lot
    (visible sur iPhone SE même sans compte et sans bandeau), il ne vient pas de l'abonnement."""
    return page.evaluate("""() => [...document.querySelectorAll('#app *, .tabbar *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .icon *, .visually-hidden, .home-card__aside-more') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""")


def last_above_tabbar(page):
    page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
    page.wait_for_timeout(150)
    r = page.evaluate("""() => { const scr = document.querySelector('#app .scr'); const last = scr && [...scr.querySelectorAll('*')].filter(e => e.offsetParent).pop();
        const bar = document.querySelector('.tabbar'); if (!last || !bar || bar.hidden) return true;
        return last.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top + .5; }""")
    page.evaluate('window.scrollTo(0, 0)')
    return r


def layout(page, t, name, tabbar=True):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page)
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')
    if tabbar:
        R.check(last_above_tabbar(page), f'{t} {name} : dernier élément au-dessus de la barre d\'onglets')


def banner(page):
    b = page.locator('.pay-banner')
    return b.first.inner_text().replace('\n', ' ') if b.count() else ''


def start_session(page):
    """Touche « Démarrer » sur l'accueil (ou la première séance proposée)."""
    page.evaluate("switchTab('train')")
    page.wait_for_timeout(250)
    btn = page.locator('[data-action="start-session"]').first
    btn.click()
    page.wait_for_timeout(600)


# ─────────────────────────────────────────────────────────────
#  Essai gratuit : bandeau, Réglages, et rien de bloqué
# ─────────────────────────────────────────────────────────────
def t_essai(bench, eng, dev, theme):
    """Modèle B : pas d'essai maison ; l'essai gratuit est l'offre de lancement d'Apple."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        R.check(len(acalls(page, 'my_access')) == 0, f'{t} sans compte : aucun appel d\'accès')
        R.check(banner(page) == '' and page.evaluate('canWrite()') is False, f'{t} sans compte, verrou allumé : il faut un compte')
        signin(page, username='max')
        page.wait_for_timeout(500)
        # Compte tout neuf, verrou allumé : aucun droit, aucun essai maison
        R.check(len(acalls(page, 'my_access')) >= 1, f'{t} connexion : my_access appelé')
        R.check(page.evaluate('accessStatus()') == 'none' and page.evaluate('canWrite()') is False,
                f'{t} compte neuf : pas d\'essai maison, pas de droit ({page.evaluate("accessStatus()")})')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        # Le bandeau dit ce qui bloque (abonnement nécessaire, ou séances de l'iPhone refusées par le
        # compte), jamais plus « il te reste N jours »
        R.check(('Abonnement nécessaire' in banner(page) or 'pas sauvegardée' in banner(page)) and 'il te reste' not in banner(page),
                f'{t} accueil : plus de bandeau « il te reste N jours » ({banner(page)!r})')
        # Écran d'abonnement : l'offre de lancement lue chez StoreKit, et les mentions de la règle 3.1.2
        page.evaluate("navigate(makeRoute('paywall', 'offer'))")
        page.wait_for_selector('.pay-plan')
        page.wait_for_timeout(400)
        txt = page.inner_text('.pay-view')
        R.check('77,77 € par an' in txt and '7,77 € par mois' in txt and txt.count('3 mois gratuits') >= 2,
                f'{t} formules : prix et essai lus chez StoreKit ({txt[:220]!r})')
        # Règle 3.1.2(c) : le prix débité domine, l'essai est secondaire ; le texte du haut dit que
        # l'abonnement continue tout seul ; ce que donne l'abonnement est dit
        sizes = page.evaluate("""() => { const b = document.querySelector('.pay-plan');
            const px = s => parseFloat(getComputedStyle(b.querySelector(s)).fontSize);
            return [px('.pay-plan__price'), px('.pay-plan__trial')]; }""")
        R.check(sizes[0] > sizes[1], f'{t} formule : prix en gros, essai en ligne secondaire {sizes}')
        R.check('3 mois gratuits, puis l\'abonnement continue sauf si tu le résilies au moins 24 heures avant la fin de l\'essai' in txt
                and 'choisis de continuer' not in txt and 'tu l\'arrêtes' not in txt, f'{t} texte du haut exact (règle des 24 h)')
        R.check('tu enregistres de nouvelles séances' in txt and 'l\'export restent ouverts' in txt, f'{t} ce que donne l\'abonnement')
        R.check('Essai gratuit de 3 mois, puis 7,77 € par mois ou 77,77 € par an' in txt
                and 'renouvelle automatiquement pour la même période' in txt and 'au même prix' not in txt
                and 'sauf si tu le résilies au moins 24 heures avant la fin de l\'essai' in txt and 'résilier à tout moment' in txt
                and 'Conditions d\'utilisation' in txt and 'Confidentialité' in txt,
                f'{t} mentions 3.1.2 : durée, prix après l\'essai, renouvellement, résiliation, liens')
        R.check('Un identifiant Apple n\'a droit qu\'à un seul essai gratuit' in txt, f'{t} un essai par identifiant Apple : dit')
        layout(page, t, 'écran d\'abonnement avec essai')
        shot(page, LOT, f'2-abonnement-{t}')
        # Achat : Apple donne l'essai (offre de lancement), le serveur écrit un abonnement actif
        page.click(f'[data-action="pay-buy"][data-id="{YEARLY}"]')
        page.wait_for_timeout(1200)
        R.check(page.evaluate('accessStatus()') == 'active' and page.evaluate('canWrite()') is True
                and page.evaluate('access.state.intro_offer') is True, f'{t} essai d\'Apple : abonnement actif, offre en cours')
        page.evaluate("navigate('subscription')")
        page.wait_for_selector('.pay-settings-view')
        page.wait_for_timeout(500)
        txt = page.inner_text('.pay-settings-view')
        R.check('Essai gratuit jusqu\'au' in txt and 'puis 77,77 € par an' in txt,
                f'{t} Réglages : « Essai gratuit jusqu\'au <date>, puis <prix> » ({txt[:200]!r})')
        R.check('Restaurer mes achats' in txt and 'J\'ai un code' in txt and 'J\'ai un code d\'offre Apple' in txt,
                f'{t} Abonnement : restaurer et les deux sortes de codes')
        layout(page, t, 'Réglages › Abonnement en essai')
        shot(page, LOT, f'1-reglages-essai-{t}')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        R.check(banner(page) == '', f'{t} en essai : aucun bandeau ({banner(page)!r})')
        start_session(page)
        R.check(page.evaluate('!!activeSession'), f'{t} en essai : séance démarrée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Essai déjà utilisé sur cet identifiant Apple : StoreKit ne propose plus l'offre, prix normal
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'introEligible': False})
        signin(page, username='max')
        page.evaluate("navigate(makeRoute('paywall', 'end'))")
        page.wait_for_selector('.pay-plan')
        page.wait_for_timeout(400)
        txt = page.inner_text('.pay-view')
        R.check('gratuit' not in txt.split('Restaurer')[0].lower().replace('essai gratuit', '') and '77,77 €' in txt
                and 'Essai gratuit de' not in txt, f'{t} sans droit à l\'essai : prix normal, aucun essai promis ({txt[:200]!r})')
        R.check('77,77 € par an selon la formule' in txt.replace('7,77 € par mois ou ', ''), f'{t} sans essai : mentions de prix et période')
        shot(page, LOT, f'2b-abonnement-sans-essai-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ─────────────────────────────────────────────────────────────
#  Fin d'essai : mode lecture seule sur tous les points d'écriture
# ─────────────────────────────────────────────────────────────

def t_lecture_seule(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        refresh_access(page)
        R.check(page.evaluate('accessStatus()') == 'none' and page.evaluate('canWrite()') is False,
                f'{t} sans abonnement : pas le droit d\'écrire')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        R.check('Abonnement nécessaire' in banner(page) or 'pas sauvegardée' in banner(page), f'{t} accueil : bandeau du mode lecture seule ({banner(page)!r})')
        layout(page, t, 'accueil après l\'essai')
        shot(page, LOT, f'3-fin-essai-accueil-{t}')
        # 1. Démarrer une séance : l'abonnement est proposé, aucune séance démarrée
        start_session(page)
        R.check(page.evaluate("currentView()") == 'paywall' and page.evaluate('!activeSession'),
                f'{t} démarrer : écran de fin d\'essai, aucune séance ({page.evaluate("currentView()")})')
        R.check('Abonnement nécessaire' in page.inner_text('.pay-view'), f'{t} écran d\'abonnement')
        layout(page, t, 'fin d\'essai')
        shot(page, LOT, f'4-fin-essai-{t}')
        page.evaluate("routeTo('dashboard')")
        page.wait_for_timeout(250)
        # 2. Ajouter une séance passée
        page.evaluate("handleAction(null, document.createElement('div'), 'go-add-session'); null")   # sans await
        page.wait_for_timeout(600)
        R.check(page.evaluate("currentView()") == 'paywall', f'{t} séance passée : abonnement proposé')
        page.evaluate("routeTo('dashboard')")
        page.wait_for_timeout(250)
        # 3. Modifier une séance de l'historique
        sid = page.evaluate('data.history[0].id')
        before = page.evaluate('data.history.length')
        page.evaluate("""id => { const el = document.createElement('div'); el.dataset.id = id;
            handleAction(null, el, 'edit-session'); }""", sid)   # l'action ne rend rien : jamais d'attente
        page.wait_for_timeout(600)
        R.check(page.evaluate("currentView()") == 'paywall', f'{t} modifier : abonnement proposé')
        R.check(page.evaluate('data.history.length') == before, f'{t} rien n\'est supprimé de l\'historique')
        page.evaluate("routeTo('dashboard')")
        page.wait_for_timeout(250)
        # 4. Enregistrer une séance en cours commencée SANS le droit d'écrire : la séance reste en cours
        page.evaluate("""() => { startSession(firstSession()); validateSet(0, 0); }""")
        R.check(page.evaluate('activeSession.writeOk') is False, f'{t} séance commencée sans droit : notée')
        page.wait_for_timeout(300)
        done = page.evaluate('activeSession.exercises[0].sets.filter(s => s.done).length')
        # Sans await : « Terminer » ouvre une feuille, la promesse n'est tenue qu'après le choix
        page.evaluate("handleAction(null, document.createElement('div'), 'finish-session'); null")
        page.wait_for_timeout(500)
        if page.locator('.ios-dialog').count():
            tap_dialog(page, 'Enregistrer')
        page.wait_for_timeout(900)
        R.check(page.evaluate("currentView()") == 'paywall', f'{t} enregistrer : abonnement proposé')
        R.check(page.evaluate('!!activeSession') and page.evaluate('activeSession.exercises[0].sets.filter(s => s.done).length') == done,
                f'{t} enregistrer refusé : la séance en cours est intacte')
        R.check(page.evaluate('data.history.length') == before, f'{t} enregistrer refusé : rien d\'ajouté ni de perdu')
        # 5. Historique, Progrès, profil et export restent ouverts
        page.evaluate("switchTab('history')")
        page.wait_for_timeout(400)
        R.check(page.evaluate("currentView()") == 'history' and page.locator('[data-action="open-history"]').count() > 0,
                f'{t} lecture seule : Historique ouvert')
        shot(page, LOT, f'5-historique-ouvert-{t}')
        page.evaluate("switchTab('progress')")
        page.wait_for_timeout(400)
        R.check(page.evaluate("currentView()") == 'stats', f'{t} lecture seule : Progrès ouvert')
        page.evaluate("navigate('account')")
        page.wait_for_timeout(400)
        R.check(page.evaluate("currentView()") == 'account', f'{t} lecture seule : profil ouvert')
        exported = page.evaluate("""async () => { const before = location.href;
            const ok = await exportData('dark'); return [ok, currentView()]; }""")
        R.check(exported[0] is not False and exported[1] != 'paywall', f'{t} lecture seule : export possible {exported}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ─────────────────────────────────────────────────────────────
#  Achat, restauration, code d'offre
# ─────────────────────────────────────────────────────────────
def t_achat(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        refresh_access(page)
        # Achat annulé : rien ne change
        page.evaluate("__st.fail.purchase = 'cancel'")
        page.evaluate("navigate(makeRoute('paywall', 'end'))")
        page.wait_for_selector('.pay-plan')
        page.wait_for_timeout(300)
        page.click(f'[data-action="pay-buy"][data-id="{MONTHLY}"]')
        page.wait_for_timeout(700)
        R.check(page.evaluate('canWrite()') is False and page.evaluate('accessStatus()') == 'none'
                and page.evaluate("__st.ents[__sb.meId()].product_id") is None,
                f'{t} achat annulé : aucun droit donné')
        R.check(len(store_calls(page, 'finish')) == 0, f'{t} achat annulé : aucune transaction terminée')
        # Achat accepté : JWS vérifié par le serveur, droit écrit, transaction terminée APRÈS
        page.evaluate("__st.fail.purchase = null")
        page.click(f'[data-action="pay-buy"][data-id="{YEARLY}"]')
        page.wait_for_timeout(1200)
        R.check(len(page.evaluate('__st.calls.filter(c => c[0] === "verify")')) == 1, f'{t} achat : verify-purchase appelé')
        R.check(page.evaluate("__st.ents[__sb.meId()].status") == 'active'
                and page.evaluate("__st.ents[__sb.meId()].product_id") == YEARLY, f'{t} achat : droit écrit par le serveur')
        R.check(page.evaluate('canWrite()') is True and page.evaluate('accessStatus()') == 'active', f'{t} achat : accès rendu')
        R.check(len(store_calls(page, 'finish')) == 1 and page.evaluate('__st.open.length') == 0,
                f'{t} achat : transaction terminée chez Apple après l\'accord du serveur')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(350)
        R.check(banner(page) == '', f'{t} abonné : plus de bandeau ({banner(page)!r})')
        start_session(page)
        R.check(page.evaluate('!!activeSession'), f'{t} abonné : séance démarrée')
        page.evaluate("endSession(); navigate('subscription')")
        page.wait_for_selector('.pay-settings-view')
        txt = page.inner_text('.pay-settings-view')
        R.check('Essai gratuit' in txt and 'Essai gratuit jusqu\'au' in txt and 'Gérer chez Apple' in txt,
                f'{t} Abonnement : état abonné et gestion chez Apple ({txt[:120]!r})')
        layout(page, t, 'Abonnement actif')
        shot(page, LOT, f'6-abonne-{t}')
        # Supprimer son compte avec un abonnement en cours : Apple continue de facturer, on le dit et on
        # mène à « Gérer chez Apple » avant toute suppression
        page.evaluate("navigate('account')")
        page.wait_for_selector('[data-action="account-delete"]')
        page.click('[data-action="account-delete"]')
        page.wait_for_selector('.ios-dialog')
        dlg = page.inner_text('.ios-dialog')
        R.check('continuera d\'être facturé par Apple' in dlg and 'Gérer chez Apple' in dlg and 'Supprimer mon compte' in dlg,
                f'{t} suppression avec abonnement : facturation et gestion chez Apple ({dlg[:160]!r})')
        shot(page, LOT, f'6b-suppression-abonne-{t}')
        page.evaluate("() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; }")
        tap_dialog(page, 'Gérer chez Apple')
        page.wait_for_timeout(300)
        R.check(page.evaluate('window.__opened') == ['https://apps.apple.com/account/subscriptions'] and page.evaluate('!!account.user'),
                f'{t} « Gérer chez Apple » : réglages d\'abonnement ouverts, compte intact')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Restauration sur un nouvel iPhone : l'achat est chez Apple, pas sur l'appareil
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        refresh_access(page)
        # L'abonnement est chez Apple (nouvel iPhone), pas encore sur le serveur
        page.evaluate("""() => { __st.owned = { productId: 'com.mdlf.training.pro.monthly', originalId: 'apple-99',
            transactionId: 'tx-99', expiresAt: Date.now() + 20 * 86400000 }; }""")
        page.evaluate("navigate(makeRoute('paywall', 'end'))")
        page.wait_for_selector('[data-action="pay-restore"]')
        page.click('[data-action="pay-restore"]')
        page.wait_for_timeout(1500)
        R.check(page.evaluate('canWrite()') is True, f'{t} restauration : accès rendu')
        R.check(len(store_calls(page, 'restore')) == 1 and len(store_calls(page, 'finish')) == 1,
                f'{t} restauration : le droit envoyé puis terminé ({store_calls(page, "finish")})')
        R.check(len(page.evaluate('__st.calls.filter(c => c[0] === "verify")')) == 1,
                f'{t} restauration : un appel de vérification')
        # Rien à restaurer : message clair, aucun droit inventé
        page.evaluate("""() => { __st.owned = null; __st.ents[__sb.meId()] = { status: 'none', gift: false, gift_until: null,
            expires_at: null, product_id: null, original_transaction_id: null, intro: false, ended: null }; }""")
        refresh_access(page)
        page.click('[data-action="pay-restore"]')
        page.wait_for_timeout(900)
        R.check('restaurer' in toast(page).lower() or 'Aucun achat' in toast(page), f'{t} rien à restaurer : message ({toast(page)!r})')
        R.check(page.evaluate('canWrite()') is False, f'{t} rien à restaurer : aucun droit inventé')
        # Transaction déjà rattachée à un autre compte : refusée
        page.evaluate("""() => { __st.taken['apple-77'] = 'un-autre-compte';
            __st.owned = { productId: 'com.mdlf.training.pro.monthly', originalId: 'apple-77', transactionId: 'tx-77', expiresAt: Date.now() + 20 * 86400000 }; }""")
        page.click('[data-action="pay-restore"]')
        page.wait_for_timeout(1000)
        dlg = page.inner_text('.ios-dialog') if page.locator('.ios-dialog').count() else ''
        R.check('autre compte' in dlg and 'Voir mon compte' in dlg,
                f'{t} transaction prise : refus expliqué avec une action ({dlg[:120]!r})')
        R.check(page.evaluate('canWrite()') is False, f'{t} transaction prise : aucun accès')
        shot(page, LOT, f'7-restauration-refusee-{t}')
        tap_dialog(page, 'Plus tard')
        # La même transaction n'est pas réenvoyée à Apple : elle reste ouverte mais le quota est épargné
        before = len(page.evaluate('__st.calls.filter(c => c[0] === "verify")'))
        page.click('[data-action="pay-restore"]')
        page.wait_for_timeout(900)
        if page.locator('.ios-dialog').count():
            tap_dialog(page, 'Plus tard')
        R.check(len(page.evaluate('__st.calls.filter(c => c[0] === "verify")')) == before,
                f'{t} transaction prise : plus jamais réenvoyée sur ce compte')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Codes : le code cadeau MDLF se saisit dans l'app, le code d'offre Apple ouvre la fenêtre d'Apple
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        refresh_access(page)
        page.evaluate("__st.addCode('K7M2QX9PR4TD', { kind: 'days', days: 30 }); "
                      "__st.addCode('VTEK7M2QX9PR', { kind: 'lifetime' }); "
                      "__st.addCode('ZPREK7M2QX94', { kind: 'days', days: 30, expires: Date.now() - 1000 }); null")
        page.evaluate("navigate(makeRoute('paywall', 'end'))")
        page.wait_for_selector('[data-action="pay-code"]')
        # Code mal formé : refusé sur l'appareil, aucun essai brûlé côté serveur
        page.click('[data-action="pay-code"]')
        R.check(code_sheet(page, 'abc', ok=False).startswith('Code introuvable'), f'{t} code mal formé : erreur dans la feuille')
        R.check(len(acalls(page, 'redeem_gift_code')) == 0, f'{t} code mal formé : rien n\'est envoyé au serveur')
        # Code inconnu, puis expiré : refus du serveur, SANS exception, saisie gardée
        help_ = code_sheet(page, 'ZZZZZZZZZZZZ', ok=False)
        R.check('existe pas' in help_ and page.input_value('#payCode') == 'ZZZZZZZZZZZZ',
                f'{t} code inconnu : refus expliqué, saisie gardée ({help_!r})')
        help_ = code_sheet(page, 'ZPREK7M2QX94', ok=False)
        R.check('expiré' in help_, f'{t} code expiré : refus expliqué ({help_!r})')
        R.check(page.evaluate('canWrite()') is False, f'{t} codes refusés : aucun accès donné')
        shot(page, LOT, f'8-code-refuse-{t}')
        # Bon code, saisi avec des espaces et des minuscules
        code_sheet(page, 'k7m2 qx9p-r4td')
        page.wait_for_timeout(600)
        R.check(page.evaluate('canWrite()') is True and page.evaluate('accessStatus()') == 'gift',
                f'{t} code cadeau : jours offerts, accès rendu')
        R.check('Code accepté' in toast(page), f'{t} code cadeau : message ({toast(page)!r})')
        # Le même code deux fois : refusé, l'accès reste
        page.click('[data-action="pay-code"]')
        help_ = code_sheet(page, 'K7M2QX9PR4TD', ok=False)
        R.check('déjà utilisé' in help_, f'{t} même code deux fois : refusé ({help_!r})')
        page.click('.sheet__btn--cancel')
        page.wait_for_timeout(300)
        # Code à vie
        page.click('[data-action="pay-code"]')
        code_sheet(page, 'VTEK7M2QX9PR')
        page.wait_for_timeout(600)
        R.check(page.evaluate("__st.ents[__sb.meId()].gift") is True and page.evaluate('accessStatus()') == 'gift',
                f'{t} code à vie : accès offert')
        R.check(page.evaluate('accessUntil()') is None, f'{t} code à vie : aucune date de fin')
        # Code d'offre Apple : sa propre fenêtre, la transaction arrive par l'écouteur
        page.evaluate("navigate(makeRoute('paywall', 'end'))")
        page.wait_for_selector('[data-action="pay-apple-code"]')
        page.click('[data-action="pay-apple-code"]')
        page.wait_for_timeout(600)
        R.check(len(store_calls(page, 'redeemCode')) == 1, f'{t} code Apple : feuille d\'Apple ouverte')
        R.check('Apple' in toast(page), f'{t} code Apple : message clair ({toast(page)!r})')
        # Feuille d'Apple fermée : ni succès ni erreur
        page.evaluate("document.querySelectorAll('.toast').forEach(e => e.remove()); __st.fail.redeem = 'cancel'")
        page.click('[data-action="pay-apple-code"]')
        page.wait_for_timeout(600)
        R.check(toast(page) == '', f'{t} feuille de codes fermée : aucun message ({toast(page)!r})')
        page.evaluate("__st.fail.redeem = null")
        # Apple annonce la transaction du code d'offre utilisé (écouteur Transaction.updates) :
        # l'abonnement est écrit par le serveur, mais l'accès à vie du code cadeau passe devant
        # (ordre des statuts : gift > active > coach_team > expired > none)
        page.evaluate("__st.emitTransaction('com.mdlf.training.pro.yearly')")
        page.wait_for_timeout(1200)
        R.check(page.evaluate("__st.ents[__sb.meId()].status") == 'active' and page.evaluate('canWrite()') is True,
                f'{t} code d\'offre : abonnement écrit par le serveur, accès ouvert')
        R.check(page.evaluate('accessStatus()') == 'gift', f'{t} accès à vie prioritaire sur l\'abonnement')
        R.check(len(store_calls(page, 'finish')) == 1, f'{t} code d\'offre : transaction terminée')
        # L'ancien « Accès offert » d'Apple n'existe plus : refusé (produit inconnu) et terminé
        n = len(store_calls(page, 'finish'))
        page.evaluate("__st.emitTransaction('com.mdlf.training.access.gift', { expiresAt: null })")
        page.wait_for_timeout(1000)
        R.check(len(store_calls(page, 'finish')) == n + 1 and page.evaluate("__st.ents[__sb.meId()].product_id") != 'com.mdlf.training.access.gift',
                f'{t} ancien accès offert : refusé, transaction terminée')
        # Une transaction d'une autre app est refusée et terminée pour ne pas revenir
        n = len(store_calls(page, 'finish'))
        page.evaluate("__st.emitTransaction('com.mdlf.training.pro.monthly', { bundleId: 'com.autre.app' })")
        page.wait_for_timeout(1000)
        R.check(len(store_calls(page, 'finish')) == n + 1 and page.evaluate('__st.open.length') == 0,
                f'{t} autre app : transaction refusée et terminée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ─────────────────────────────────────────────────────────────
#  Verrou éteint, horloge de l'appareil, hors ligne, navigateur
# ─────────────────────────────────────────────────────────────
def t_achats_bloques(bench, eng, dev, theme):
    """Temps d'écran : les achats sont bloqués sur l'iPhone, l'écran ne propose rien à acheter."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'canMakePayments': False})
        signin(page, username='max')
        refresh_access(page)
        page.evaluate("navigate(makeRoute('paywall', 'end'))")
        page.wait_for_timeout(800)
        txt = page.inner_text('.pay-view')
        R.check(page.locator('.pay-plan').count() == 0 and 'bloqués sur cet iPhone' in txt,
                f'{t} achats bloqués : aucune formule, message clair ({txt[:140]!r})')
        R.check('Temps d\'écran' in txt, f'{t} achats bloqués : on dit où regarder')
        R.check(page.locator('[data-action="pay-restore"]').count() == 1
                and page.locator('[data-action="pay-code"]').count() == 1,
                f'{t} achats bloqués : restauration et code cadeau encore possibles')
        layout(page, t, 'achats bloqués')
        shot(page, LOT, f'13-achats-bloques-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_rattrapage(bench, eng, dev, theme):
    """Achat déjà chez Apple mais inconnu du serveur : rattrapé au lancement, sans rien demander."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        refresh_access(page)
        R.check(page.evaluate('canWrite()') is False, f'{t} sans abonnement : bloqué')
        # L'abonnement existe chez Apple (achat perdu par le réseau, nouvel iPhone) mais pas au serveur
        page.evaluate("""() => { __st.owned = { productId: 'com.mdlf.training.pro.yearly', originalId: 'apple-50',
            transactionId: 'tx-50', expiresAt: Date.now() + 300 * 86400000 }; }""")
        before = len(store_calls(page, 'restore'))
        page.evaluate('accessBoot()')
        page.wait_for_timeout(1500)
        R.check(page.evaluate('canWrite()') is True and page.evaluate('accessStatus()') == 'active',
                f'{t} rattrapage : accès rendu au lancement')
        R.check(len(store_calls(page, 'current')) >= 1 and len(store_calls(page, 'restore')) == before,
                f'{t} rattrapage : current() lu, sans demander le mot de passe Apple')
        R.check(len(store_calls(page, 'finish')) == 1, f'{t} rattrapage : transaction terminée')
        # Déjà rattrapé : on ne relit plus rien
        n = len(store_calls(page, 'current'))
        page.evaluate('accessBoot()')
        page.wait_for_timeout(800)
        R.check(len(store_calls(page, 'current')) == n, f'{t} rien à rattraper : aucun appel de plus')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_verrou_serveur(bench, eng, dev, theme):
    """Le serveur refuse l'enregistrement d'une séance nouvelle (paywall_locked) : rien n'est perdu,
    ce n'est pas une erreur de synchro, et le reste de la synchro continue."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        # D'abord abonné : tout passe, les séances arrivent sur le compte
        subscribed(page, 30)
        page.evaluate('syncNow()')
        page.wait_for_timeout(900)
        on_server = page.evaluate('(__sb.upserted || []).length')
        R.check(on_server > 0 and page.evaluate('account.error') is None, f'{t} abonné : séances sauvegardées')
        R.check(page.evaluate('accountLockedCount()') == 0, f'{t} abonné : rien de refusé')
        # Abonnement fini depuis 2 jours (au-delà de la grâce) : une séance nouvelle est refusée
        ended(page, 48)
        before = page.evaluate('data.history.length')
        page.evaluate("""() => { data.history.unshift({ id: 'apres-essai', programme: 'ppl', category: 'push',
            date: Date.now(), duration: 3000000, notes: '', exercises: [{ name: 'Dips', sets: [{ weight: '', reps: '12' }] }] });
            data.unit = 'kg'; data.defaultRest = 95; save(); }""")
        page.evaluate('syncNow()')
        page.wait_for_timeout(1200)
        R.check(len(page.evaluate('__st.calls.filter(c => c[0] === "locked")')) >= 1, f'{t} verrou : le serveur a refusé la séance')
        # Rien n'est perdu, rien n'est marqué envoyé, et ce n'est PAS une erreur de synchro
        R.check(page.evaluate('data.history.length') == before + 1
                and page.evaluate("!!data.history.find(h => h.id === 'apres-essai')"),
                f'{t} verrou : la séance reste sur l\'iPhone')
        R.check(page.evaluate('account.error') is None, f'{t} verrou : aucune erreur de synchro ({page.evaluate("account.error")!r})')
        R.check(page.evaluate("JSON.parse(localStorage.getItem('mdlf_sync_' + account.user.id)).pushed['apres-essai']") is None,
                f'{t} verrou : la séance refusée n\'est pas marquée sauvegardée')
        R.check(page.evaluate('accountLockedCount()') == 1, f'{t} verrou : une séance en attente')
        # Le reste de la synchro passe quand même : le profil (unité, repos, programmes) est parti
        R.check(page.evaluate("__sb.calls.filter(c => c[0] === 'db' && c[1] === 'profiles' && c[2] === 'upsert').length") >= 1,
                f'{t} verrou : le profil est sauvegardé malgré la séance refusée')
        # Les séances d'avant restent sur le compte, une correction de l'une d'elles passe encore
        page.evaluate("data.history.find(h => h.id !== 'apres-essai').notes = 'corrigée'; save()")
        n_locked = len(page.evaluate('__st.calls.filter(c => c[0] === "locked")'))
        page.evaluate('syncNow()')
        page.wait_for_timeout(1200)
        R.check(page.evaluate("(__sb.upserted || []).some(r => r.data && r.data.notes === 'corrigée')"),
                f'{t} verrou : une correction d\'une séance déjà sur le compte passe')
        R.check(len(page.evaluate('__st.calls.filter(c => c[0] === "locked")')) == n_locked,
                f'{t} verrou : la séance refusée n\'est pas renvoyée en boucle')
        # L'accueil propose l'abonnement et dit ce qui n'est pas sauvegardé
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(400)
        R.check('pas sauvegardée' in banner(page), f'{t} verrou : l\'accueil le dit ({banner(page)!r})')
        layout(page, t, 'séance refusée par le compte')
        shot(page, LOT, f'14-verrou-serveur-{t}')
        page.click('.pay-banner')
        page.wait_for_timeout(500)
        R.check(page.evaluate("currentView()") == 'paywall', f'{t} verrou : le bandeau mène à l\'abonnement')
        # Code cadeau accepté : la séance refusée repart toute seule
        page.evaluate("__st.addCode('K7M2QX9PR4TD', { kind: 'days', days: 30 }); null")
        page.click('[data-action="pay-code"]')
        code_sheet(page, 'K7M2QX9PR4TD')
        page.wait_for_timeout(1500)
        R.check(page.evaluate('canWrite()') is True, f'{t} code accepté : droit rendu')
        R.check(page.evaluate("(__sb.upserted || []).some(r => r.id === 'apres-essai')"),
                f'{t} droit rendu : la séance gardée part toute seule')
        R.check(page.evaluate('accountLockedCount()') == 0, f'{t} droit rendu : plus rien en attente')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_verrou_eteint(bench, eng, dev, theme):
    t = tag(dev, theme)
    # Sans compte, verrou éteint : RIEN ne change (règle 2), la séance démarre et s'enregistre
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'paywallOn': False})
        page.wait_for_timeout(300)
        R.check(page.evaluate('access.anon') is False and page.evaluate('canWrite()') is True,
                f'{t} sans compte, verrou éteint : rien ne bloque')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        start_session(page)
        R.check(page.evaluate('!!activeSession') and page.locator('.auth').count() == 0,
                f'{t} sans compte, verrou éteint : séance démarrée sans invitation')
        before = page.evaluate('data.history.length')
        page.evaluate('validateSet(0, 0)')
        page.wait_for_timeout(200)
        page.evaluate("handleAction(null, document.createElement('div'), 'finish-session'); null")
        page.wait_for_timeout(500)
        if page.locator('.ios-dialog').count():
            tap_dialog(page, 'Enregistrer')
        page.wait_for_timeout(900)
        R.check(page.evaluate('data.history.length') == before + 1 and page.locator('.auth').count() == 0,
                f'{t} sans compte, verrou éteint : séance enregistrée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'paywallOn': False})
        signin(page, username='max')
        R.check(page.evaluate('accessStatus()') == 'none', f'{t} verrou éteint : aucun abonnement')
        R.check(page.evaluate('canWrite()') is True and page.evaluate('paywallOn()') is False,
                f'{t} verrou éteint : rien ne bloque')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        R.check(banner(page) == '', f'{t} verrou éteint : aucun bandeau ({banner(page)!r})')
        start_session(page)
        R.check(page.evaluate('!!activeSession') and page.evaluate("currentView()") == 'session',
                f'{t} verrou éteint : séance démarrée')
        # Enregistrer la séance : elle part dans l'historique comme avant
        before = page.evaluate('data.history.length')
        page.evaluate('validateSet(0, 0)')
        page.wait_for_timeout(200)
        page.evaluate("handleAction(null, document.createElement('div'), 'finish-session'); null")   # sans await
        page.wait_for_timeout(500)
        if page.locator('.ios-dialog').count():
            tap_dialog(page, 'Enregistrer')
        page.wait_for_timeout(900)
        R.check(page.evaluate('data.history.length') == before + 1, f'{t} verrou éteint : séance enregistrée')
        # Séance passée et modification : rien ne demande d'abonnement
        page.evaluate("routeTo('dashboard'); handleAction(null, document.createElement('div'), 'go-add-session'); null")
        page.wait_for_timeout(600)
        R.check(page.evaluate("currentView()") == 'add-session', f'{t} verrou éteint : séance passée ouverte')
        # L'horloge de l'appareil avancée ne change rien non plus
        page.evaluate('__st.deviceShift = 400 * 86400000')
        refresh_access(page)
        R.check(page.evaluate('canWrite()') is True, f'{t} verrou éteint, horloge avancée : rien ne bloque')
        # Réglages : l'état est dit en clair, sans rien promettre
        page.evaluate("routeTo('settings')")
        page.wait_for_selector('[data-action="access-open-settings"]')
        R.check('Tout est ouvert' in page.inner_text('[data-action="access-open-settings"]'),
                f'{t} verrou éteint : Réglages le disent')
        page.click('[data-action="access-open-settings"]')
        page.wait_for_selector('.pay-settings-view')
        R.check('Tout est ouvert pour l\'instant' in page.inner_text('.pay-settings-view'), f'{t} Abonnement : verrou éteint expliqué')
        # B-1 : verrou éteint, AUCUNE formule proposée (l'essai d'Apple serait grillé pour rien) ;
        # restaurer, gérer chez Apple et les codes restent
        R.check(page.locator('[data-action="pay-open"]').count() == 0, f'{t} verrou éteint : pas de « Voir les formules »')
        R.check(page.locator('[data-action="pay-restore"]').count() == 1 and page.locator('[data-action="pay-manage"]').count() == 1,
                f'{t} verrou éteint : restaurer et gérer chez Apple restent')
        page.evaluate("navigate(makeRoute('paywall', 'offer'))")
        page.wait_for_timeout(700)
        ptxt = page.inner_text('.pay-view')
        R.check(page.locator('.pay-plan').count() == 0 and 'Tout est ouvert' in ptxt and '€' not in ptxt
                and len(store_calls(page, 'purchase')) == 0, f'{t} verrou éteint : écran d\'abonnement sans formule ni prix ({ptxt[:140]!r})')
        R.check(page.locator('[data-action="pay-restore"]').count() == 1, f'{t} verrou éteint : restaurer encore possible')
        shot(page, LOT, f'12b-verrou-eteint-sans-formule-{t}')
        layout(page, t, 'Abonnement verrou éteint')
        shot(page, LOT, f'12-verrou-eteint-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ─────────────────────────────────────────────────────────────
#  Règle 2 (28/10) : compte obligatoire quand le verrou est allumé
# ─────────────────────────────────────────────────────────────
def t_compte_obligatoire(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        page.wait_for_timeout(300)
        # Le verrou est lu sans compte, et rien d'autre
        R.check(len(page.evaluate("__st.calls.filter(c => c[0] === 'app_config' && c[1] === 'anon')")) >= 1,
                f'{t} sans compte : verrou lu dans app_config')
        R.check(len(acalls(page, 'my_access')) == 0, f'{t} sans compte : aucun droit d\'accès demandé')
        R.check(page.evaluate('canWrite()') is False and page.evaluate('accessSignInRequired()') is True,
                f'{t} sans compte, verrou allumé : il faut un compte')
        # Démarrer une séance : invitation à se connecter (Apple, Google, e-mail), aucune séance démarrée
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        start_session(page)
        page.wait_for_selector('.auth')
        txt = page.inner_text('.auth')
        R.check('Un compte pour enregistrer' in txt and 'Continuer avec Apple' in txt and 'e‑mail' in txt,
                f'{t} démarrer sans compte : invitation à se connecter ({txt[:120]!r})')
        R.check('Commencer sans compte' not in txt and page.locator('.auth [data-action="auth-close"]').count() == 1,
                f'{t} invitation : on peut fermer, sans « Commencer sans compte »')
        R.check('auth-btn--apple' in (page.locator('.auth .auth-buttons button').first.get_attribute('class') or ''),
                f'{t} invitation : « Continuer avec Apple » en premier')
        R.check(page.evaluate('!activeSession'), f'{t} démarrer sans compte : aucune séance démarrée')
        shot(page, LOT, f'18-compte-obligatoire-{t}')
        page.click('.auth [data-action="auth-close"]')
        page.wait_for_timeout(400)
        # Verrou jamais lu (serveur injoignable) depuis plus de 7 jours, mais pas encore mis en service
        # (PAYWALL_LAUNCHED faux, livré ainsi) : rien ne bloque
        page.evaluate("__st.fail.config = 'offline'; access.anon = null; access.firstSeen = Date.now() - 8 * 86400000")
        R.check(page.evaluate('PAYWALL_LAUNCHED') is False and page.evaluate('canWrite()') is True,
                f'{t} verrou jamais lu, pas mis en service : rien ne bloque')
        # Mis en service (mise à jour à chaud de l'allumage) : une lecture est demandée, pas un compte
        page.evaluate("accessLaunch.on = true")
        start_session(page)
        page.wait_for_timeout(300)
        dlg = page.inner_text('.ios-dialog') if page.locator('.ios-dialog').count() else ''
        R.check('Internet' in dlg and page.locator('.auth').count() == 0 and page.evaluate('!activeSession'),
                f'{t} verrou jamais lu depuis 8 jours : lecture demandée ({dlg[:80]!r})')
        shot(page, LOT, f'20-verrou-jamais-lu-{t}')
        tap_dialog(page, 'OK')
        page.evaluate("__st.fail.config = null; access.firstSeen = Date.now(); accessLaunch.on = PAYWALL_LAUNCHED")
        refreshed = page.evaluate('accessAnonRefresh()')
        R.check(refreshed is True, f'{t} réseau revenu : verrou relu')
        # Séance passée : même invitation, rien n'est enregistré
        before = page.evaluate('data.history.length')
        page.evaluate("handleAction(null, document.createElement('div'), 'go-add-session'); null")
        page.wait_for_timeout(600)
        R.check(page.locator('.auth').count() == 1 and page.evaluate("currentView()") != 'add-session',
                f'{t} séance passée sans compte : invitation à se connecter')
        page.click('.auth [data-action="auth-close"]')
        page.wait_for_timeout(400)
        # Une séance commencée SANS le droit d'écrire (verrou allumé, sans compte) : la terminer garde la
        # séance en cours et invite à se connecter
        page.evaluate("""() => { startSession(firstSession()); validateSet(0, 0); }""")
        page.wait_for_timeout(300)
        page.evaluate("handleAction(null, document.createElement('div'), 'finish-session'); null")
        page.wait_for_timeout(500)
        if page.locator('.ios-dialog').count():
            tap_dialog(page, 'Enregistrer')
        page.wait_for_timeout(700)
        R.check(page.locator('.auth').count() == 1 and page.evaluate('!!activeSession') and page.evaluate('data.history.length') == before,
                f'{t} enregistrer sans compte : invitation, séance en cours intacte, rien de perdu')
        page.click('.auth [data-action="auth-close"]')
        page.wait_for_timeout(400)
        page.evaluate('endSession()')
        # Historique, Progrès et export restent ouverts sans compte
        page.evaluate("switchTab('history')")
        page.wait_for_timeout(400)
        R.check(page.evaluate("currentView()") == 'history' and page.locator('.auth').count() == 0, f'{t} sans compte : Historique ouvert')
        page.evaluate("switchTab('progress')")
        page.wait_for_timeout(400)
        R.check(page.evaluate("currentView()") == 'stats', f'{t} sans compte : Progrès ouvert')
        exported = page.evaluate("async () => { const ok = await exportData('dark'); return [ok, currentView(), !!document.querySelector('.auth')]; }")
        R.check(exported[0] is not False and exported[2] is False, f'{t} sans compte : export possible {exported}')
        # Connexion : pas d'essai maison ; avec l'essai d'Apple pris, la séance peut être démarrée
        signin(page, username='max')
        page.wait_for_timeout(400)
        R.check(page.evaluate('accessStatus()') == 'none' and page.evaluate('canWrite()') is False, f'{t} connecté : pas d\'essai maison')
        subscribed(page, 90, intro=True)
        R.check(page.evaluate('canWrite()') is True, f'{t} essai d\'Apple pris : droit d\'écrire')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        start_session(page)
        R.check(page.evaluate('!!activeSession') and page.locator('.auth').count() == 0, f'{t} connecté : séance démarrée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_version_min(bench, eng, dev, theme):
    """Version minimale (app_config.min_build) : une build native plus ancienne demande sa mise à jour,
    avec ou sans compte ; à jour, ou min_build à 0, rien n'est affiché."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'appBuild': 25, 'minBuild': 30, 'paywallOn': False})
        page.wait_for_selector('.min-build', timeout=5000)
        txt = page.inner_text('.min-build')
        R.check('Mets à jour l\'app' in txt and 'Tes séances restent sur cet iPhone' in txt,
                f'{t} build trop ancienne : écran de mise à jour ({txt[:120]!r})')
        page.evaluate("() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; }")
        page.click('.min-build__btn')
        R.check(page.evaluate('window.__opened.length') == 1 and 'testflight.apple.com' in page.evaluate('window.__opened[0]'),
                f'{t} « Mettre à jour » : lien de mise à jour ouvert')
        R.check(page.evaluate('data.history.length') > 0, f'{t} build trop ancienne : séances intactes sur l\'iPhone')
        shot(page, LOT, f'21-version-min-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    # À jour, ou aucune version minimale : rien
    for opts, name in (({'appBuild': 30, 'minBuild': 30}, 'build à jour'), ({'appBuild': 25, 'minBuild': 0}, 'min_build à 0')):
        with bench.page(eng, dev, theme) as page:
            open_app(page, theme, ppl_v2_today_json(), store={**opts, 'paywallOn': False})
            page.wait_for_timeout(800)
            R.check(page.locator('.min-build').count() == 0, f'{t} {name} : aucun écran de mise à jour')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_horloge(bench, eng, dev, theme):
    """Avancer ou reculer l'horloge de l'APPAREIL ne débloque ni ne bloque rien."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        subscribed(page, 89, intro=True)
        until = page.evaluate('accessIntroUntil()')
        R.check(until is not None and page.evaluate('canWrite()') is True, f'{t} essai d\'Apple : fin donnée par le serveur')
        # 1. Horloge avancée de 400 jours : la fin d'essai est celle du serveur, rien n'est bloqué
        page.evaluate('__st.deviceShift = 400 * 86400000')
        refresh_access(page)
        R.check(page.evaluate('accessIntroUntil()') == until and page.evaluate('canWrite()') is True,
                f'{t} horloge avancée de 400 jours : rien ne change')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        start_session(page)
        R.check(page.evaluate('!!activeSession'), f'{t} horloge avancée : séance démarrée quand même')
        page.evaluate('endSession()')
        # 2. Horloge reculée : pas de rallonge, rien de bloqué non plus
        page.evaluate('__st.deviceShift = -400 * 86400000')
        refresh_access(page)
        R.check(page.evaluate('accessIntroUntil()') == until and page.evaluate('canWrite()') is True, f'{t} horloge reculée : inchangé')
        # 3. Abonnement fini côté serveur : décaler l'horloge ne DÉBLOQUE rien
        page.evaluate('__st.deviceShift = 0')
        ended(page, 48)
        R.check(page.evaluate('canWrite()') is False, f'{t} abonnement fini : refusé')
        for shift in (400, -400, 8):
            page.evaluate('n => { __st.deviceShift = n * 86400000; }', shift)
            refresh_access(page)
            R.check(page.evaluate('canWrite()') is False, f'{t} horloge décalée de {shift} jours : toujours refusé')
        # 4. Hors ligne, horloge avancée : le dernier état connu ne donne jamais de droit en plus
        page.evaluate("__st.deviceShift = 0; __st.fail.access = 'offline'")
        page.evaluate('accessReset(account.user.id)')
        page.wait_for_timeout(200)
        R.check(page.evaluate('canWrite()') is False, f'{t} hors ligne : refus gardé')
        page.evaluate('__st.deviceShift = 30 * 86400000')
        R.check(page.evaluate('canWrite()') is False, f'{t} hors ligne et horloge avancée : toujours refusé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_grace(bench, eng, dev, theme):
    """Séance COMMENCÉE avec le droit d'écrire : « Terminer » l'enregistre même si l'accès a pris fin
    pendant la séance, et le serveur l'accepte (grâce bornée)."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        subscribed(page, 30)
        # Les séances de l'iPhone refusées avant l'abonnement repartent d'abord : on attend qu'elles
        # soient sur le compte, sinon elles seraient refusées à nouveau à la fin de l'accès
        page.evaluate('syncNow()')
        page.wait_for_function('accountLockedCount() === 0', timeout=10000)
        page.wait_for_timeout(300)
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        start_session(page)
        R.check(page.evaluate('!!activeSession && activeSession.writeOk') is True, f'{t} séance commencée avec le droit')
        page.evaluate('validateSet(0, 0)')
        # L'abonnement prend fin pendant la séance (maintenant, après son début)
        page.wait_for_timeout(300)
        ended(page, 0)
        R.check(page.evaluate('canWrite()') is False, f'{t} accès fini pendant la séance')
        before = page.evaluate('data.history.length')
        page.evaluate("handleAction(null, document.createElement('div'), 'finish-session'); null")
        page.wait_for_timeout(500)
        if page.locator('.ios-dialog').count():
            tap_dialog(page, 'Enregistrer')
        page.wait_for_timeout(900)
        R.check(page.evaluate('data.history.length') == before + 1 and page.evaluate("currentView()") != 'paywall',
                f'{t} « Terminer » : séance enregistrée, pas d\'écran d\'abonnement')
        page.evaluate('syncNow()')
        page.wait_for_timeout(1200)
        sid = page.evaluate('data.history[0].id')
        R.check(page.evaluate('id => (__sb.upserted || []).some(r => r.id === id)', sid) and page.evaluate('accountLockedCount()') == 0,
                f'{t} le serveur l\'accepte dans sa grâce')
        # La séance suivante, commencée après la fin : porte fermée
        page.evaluate("routeTo('dashboard')")
        page.wait_for_timeout(300)
        start_session(page)
        R.check(page.evaluate('!activeSession') and page.evaluate("currentView()") == 'paywall', f'{t} séance suivante : abonnement proposé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

def t_hors_ligne(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        page.evaluate('__st.giveGift()')
        refresh_access(page)
        R.check(page.evaluate('accessStatus()') == 'gift', f'{t} accès à vie (code maison) lu')
        # Relance hors ligne : le dernier état connu suffit, la salle sans réseau ne bloque personne
        page.evaluate("__st.fail.access = 'offline'; accessReset(account.user.id)")
        page.wait_for_timeout(300)
        R.check(page.evaluate('access.state') is None and page.evaluate('accessStatus()') == 'gift'
                and page.evaluate('canWrite()') is True, f'{t} hors ligne : état gardé sur l\'appareil')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        start_session(page)
        R.check(page.evaluate('!!activeSession'), f'{t} hors ligne : séance démarrée')
        page.evaluate('endSession()')
        # Plus de 7 jours sans réseau : l'app ne se prolonge pas elle-même, l'état est redemandé
        page.evaluate('__st.deviceShift = 8 * 86400000; accessReset(account.user.id)')
        page.wait_for_timeout(300)
        R.check(page.evaluate('accessStale()') is True and page.evaluate('canWrite()') is False,
                f'{t} 8 jours hors ligne : droit périmé, état à redemander')
        page.evaluate("navigate(makeRoute('paywall', 'end'))")
        page.wait_for_timeout(600)
        txt = page.inner_text('.pay-view')
        R.check('Pas d\'Internet' in txt, f'{t} hors ligne : écran d\'abonnement le dit ({txt[:120]!r})')
        R.check('n\'ont pas pu' in txt or 'pas encore proposées' in txt or 'Chargement' in txt or '7,77' in txt,
                f'{t} hors ligne : les formules ne plantent pas ({txt[:200]!r})')
        layout(page, t, 'abonnement hors ligne')
        shot(page, LOT, f'9-hors-ligne-{t}')
        # Réseau revenu : le serveur fait foi et l'essai reprend
        page.evaluate("__st.fail.access = null; __st.deviceShift = 0")
        page.evaluate('accessRefresh()')
        page.wait_for_timeout(500)
        R.check(page.evaluate('canWrite()') is True and page.evaluate('accessStatus()') == 'gift',
                f'{t} réseau revenu : accès retrouvé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Hors app iOS (navigateur) : aucun achat, l'écran invite à utiliser l'app
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'store': False})
        signin(page, username='max')
        refresh_access(page)
        page.evaluate("navigate(makeRoute('paywall', 'end'))")
        page.wait_for_timeout(600)
        txt = page.inner_text('.pay-view')
        R.check(page.locator('.pay-plan').count() == 0 and 'sur iPhone' in txt,
                f'{t} navigateur : aucune formule, message clair ({txt[:140]!r})')
        R.check(len(store_calls(page, 'products')) == 0, f'{t} navigateur : StoreKit jamais appelé')
        layout(page, t, 'abonnement hors app')
        shot(page, LOT, f'10-hors-app-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Produits inconnus d'Apple (contrat Paid Apps pas signé) : rien ne plante, aucun prix
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'missing': [MONTHLY, YEARLY]})
        signin(page, username='max')
        refresh_access(page)
        page.evaluate("navigate(makeRoute('paywall', 'end'))")
        page.wait_for_timeout(700)
        txt = page.inner_text('.pay-view')
        R.check(page.locator('.pay-plan').count() == 0 and 'pas encore proposées' in txt,
                f'{t} formules absentes chez Apple : message clair ({txt[:140]!r})')
        R.check('€' not in txt, f'{t} formules absentes : aucun prix affiché')
        R.check(page.locator('[data-action="pay-restore"]').count() == 1, f'{t} formules absentes : restauration encore possible')
        layout(page, t, 'formules absentes')
        shot(page, LOT, f'11-formules-absentes-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ─────────────────────────────────────────────────────────────
#  Tarifs du 30/10 : particulier, coach validé (paliers), élève avec le code de son coach
# ─────────────────────────────────────────────────────────────

C10 = 'com.mdlf.training.coach10.monthly'


def paywall(page, tab=None, pre=None):
    route = "makeRoute('paywall', 'offer'%s)" % (f", 'coach'{', ' + json.dumps(pre) if pre else ''}" if tab == 'coach' else '')
    page.evaluate(f"navigate({route})")
    page.wait_for_selector('.pay-view')
    page.wait_for_timeout(600)
    return page.inner_text('.pay-view')


def make_me_coach(page):
    page.evaluate("async () => { __sb.makeCoach(__sb.meId()); await coachRefresh(); await coachProRefresh(); }")
    page.wait_for_timeout(300)


def plans_text(page):
    return [x.replace('\n', ' ') for x in page.locator('.pay-plan').all_inner_texts()]


def t_tarifs(bench, eng, dev, theme):
    t = tag(dev, theme)
    # 1. Particulier : prix lus chez StoreKit, « soit 8,5 mois » calculé, aucune formule coach
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'products': 'all'})
        signin(page, username='max')
        refresh_access(page)
        txt = paywall(page)
        pl = plans_text(page)
        R.check(len(pl) == 3 and '6,49 € par mois' in pl[0] and '55,00 € par an' in pl[1] and 'soit 8,5 mois' in pl[1]
                and 'soit' not in pl[0] and 'À vie' in pl[2], f'{t} particulier : mensuel, annuel « soit 8,5 mois », à vie {pl}')
        R.check(page.locator('.pay-tabs').count() == 0 and '15,99' not in txt and 'élèves' not in ' '.join(pl),
                f'{t} pas coach : aucun palier coach visible')
        R.check('Tu es coach ?' in txt, f'{t} pas coach : lien vers la demande')
        R.check('Essai gratuit de 3 mois, puis 6,49 € par mois ou 55,00 € par an' in txt and 'au moins 24 heures avant la fin de l\'essai' in txt
                and 'Conditions d\'utilisation' in txt and 'Conditions de vente' in txt and 'Confidentialité' in txt, f'{t} particulier : mentions 3.1.2')
        layout(page, t, 'abonnement particulier')
        shot(page, LOT, f'20-tarifs-particulier-{t}')
        # Le lien mène à la demande, pas à un achat
        page.click('[data-action="coach-request-open"]')
        page.wait_for_timeout(500)
        R.check(page.evaluate('currentView()') == 'coach-request', f'{t} « Tu es coach ? » : écran de demande')
        # 2. Coach validé : onglet Coach, 4 paliers, mensuel puis annuel
        make_me_coach(page)
        txt = paywall(page, 'coach')
        pl = plans_text(page)
        R.check(page.locator('.pay-tabs .segmented__btn').count() == 2 and len(pl) == 4
                and '15,99 € par mois' in pl[0] and '10 élèves' in pl[0] and 'Conseillé' in pl[0]
                and '29,99 € par mois' in pl[3] and 'illimités' in pl[3], f'{t} coach : 4 paliers mensuels {pl}')
        R.check('Tu suis 0 élève' in txt and 'ton propre accès complet' in txt, f'{t} coach : élèves suivis, accès compris')
        R.check('3 mois gratuits' in pl[0] and 'Essai gratuit de 3 mois, puis 15,99 € par mois' in txt, f'{t} coach : essai de 3 mois, mentions')
        layout(page, t, 'abonnement coach')
        shot(page, LOT, f'21-tarifs-coach-{t}')
        page.click('[data-action="pay-period"][data-period="year"]')
        page.wait_for_timeout(300)
        pl = plans_text(page)
        R.check(len(pl) == 4 and '134,99 € par an' in pl[0] and all('soit 8,5 mois' in x for x in pl), f'{t} coach annuel : « soit 8,5 mois » {pl}')
        page.click('[data-action="pay-period"][data-period="month"]')
        page.wait_for_timeout(200)
        # Onglet Particulier toujours là pour un coach
        page.click('[data-action="pay-tab"][data-tab="pro"]')
        page.wait_for_timeout(400)
        R.check(len(plans_text(page)) == 3 and 'Tu es coach ?' not in page.inner_text('.pay-view'), f'{t} coach : onglet Particulier')
        # 3. Palier plein : 10 élèves sur 10 → bandeau, palier suivant mis en avant, formule en cours marquée
        page.evaluate("""async (p) => { const me = __sb.meId(); __sb.setTier(me, p);
            for (let i = 0; i < 10; i++) __sb.link(me, __sb.addPerson({ username: 'eleve' + i, social: false }));
            await coachRefresh(); coachPro.loadedAt = 0; await coachProRefresh(); }""", C10)
        page.evaluate("navigate('coach-students')")
        page.wait_for_timeout(700)
        b = page.locator('.coach-tier-banner')
        R.check(b.count() == 1 and '10 élèves sur 10 : passe au palier supérieur' in b.inner_text(), f'{t} palier plein : bandeau ({b.count()})')
        shot(page, LOT, f'22-palier-plein-{t}')
        b.click()
        page.wait_for_timeout(700)
        pl = plans_text(page)
        R.check(page.evaluate('currentView()') == 'paywall' and 'Ta formule' in pl[0] and 'Conseillé' in pl[1] and '20 élèves' in pl[1],
                f'{t} montée de palier : 20 élèves conseillé, 10 élèves « Ta formule » {pl}')
        R.check(page.locator(f'[data-action="pay-buy"][data-id="{C10}"]').is_disabled(), f'{t} formule en cours : pas rachetable')
        # Achat du palier suivant : même groupe Apple, accès complet
        page.click('[data-action="pay-buy"][data-id="com.mdlf.training.coach20.monthly"]')
        page.wait_for_timeout(1200)
        R.check(page.evaluate('accessStatus()') == 'active' and page.evaluate('canWrite()') is True, f'{t} palier coach acheté : accès complet')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # 4. Élève avec le code de son coach : −25 % pendant 12 mois, sans essai, code d'offre d'Apple
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'products': 'all'})
        signin(page, username='lea')
        page.evaluate("""async () => { const c = __sb.addPerson({ username: 'lucas', social: false }); __sb.makeCoach(c);
            __sb.link(c, __sb.meId()); window.__opened = []; window.open = u => { __opened.push(String(u)); return null; };
            await coachRefresh(); }""")
        refresh_access(page)
        txt = paywall(page)
        card = page.locator('.pay-student')
        ctext = card.inner_text().replace('\n', ' ') if card.count() else ''
        R.check(card.count() == 1 and 'Offre élève de lucas' in ctext and '4,89 €' in ctext
                and 'par mois pendant 12 mois, puis 6,49 € par mois. Sans essai gratuit.' in ctext, f'{t} élève : offre −25 % ({ctext!r})')
        R.check(page.locator('.pay-plan').count() == 0 and '3 mois gratuits' not in txt, f'{t} élève : pas de formule avec essai')
        R.check('25 % de moins pendant 12 mois' in txt and 'renouvelle automatiquement' in txt and 'au moins 24 heures' in txt
                and 'Conditions d\'utilisation' in txt, f'{t} élève : mentions 3.1.2')
        layout(page, t, 'abonnement élève')
        shot(page, LOT, f'23-tarifs-eleve-{t}')
        page.click('[data-action="pay-student"]')
        page.wait_for_timeout(700)
        opened = page.evaluate('__opened')
        R.check(len(opened) == 1 and 'apps.apple.com/redeem' in opened[0] and 'code=STUDENTCODE01' in opened[0],
                f'{t} élève : page d\'Apple ouverte avec le code {opened}')
        page.click('[data-action="pay-student"]')
        page.wait_for_timeout(600)
        R.check(page.evaluate('__opened.length') == 2 and 'code=STUDENTCODE01' in page.evaluate('__opened[1]'), f'{t} élève : même code redonné')
        # Déjà abonné une fois : plus d'offre élève, formules habituelles
        page.evaluate("__st.everSubscribed = true; access.studentOffer = null; delete __st.offerGiven[__sb.meId()]")
        page.click('[data-action="pay-student"]')
        page.wait_for_timeout(700)
        R.check(page.locator('.pay-plan').count() == 3 and 'premier abonnement' in page.inner_text('.pay-view'), f'{t} élève déjà abonné : formules habituelles')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # 5. Verrou éteint (TestFlight) : rien d'achetable, ni paliers coach ni offre élève
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'products': 'all', 'paywallOn': False})
        signin(page, username='max')
        make_me_coach(page)
        page.evaluate("""async () => { const c = __sb.addPerson({ username: 'lucas', social: false }); __sb.makeCoach(c);
            __sb.link(c, __sb.meId()); await coachRefresh(); }""")
        refresh_access(page)
        for tab in (None, 'coach'):
            txt = paywall(page, tab)
            R.check(page.locator('.pay-plan, .pay-student, .pay-tabs, [data-action="pay-student"]').count() == 0 and '€' not in txt,
                    f'{t} verrou éteint ({tab or "particulier"}) : rien à acheter')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ─────────────────────────────────────────────────────────────
#  Payant plus : accès à vie (achat unique), abonné qui y passe, TestFlight, accès offert à vie
# ─────────────────────────────────────────────────────────────

LIFE = 'com.mdlf.training.lifetime'


def sub_text(page):
    page.evaluate("navigate('subscription')")
    page.wait_for_selector('.pay-settings-view')
    page.wait_for_timeout(500)
    return page.inner_text('.pay-settings-view')


def t_vie(bench, eng, dev, theme):
    t = tag(dev, theme)
    # 1. Sans abonnement : carte « À vie » sous les deux formules, mentions propres, achat
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'products': 'all'})
        signin(page, username='max')
        refresh_access(page)
        txt = paywall(page)
        pl = plans_text(page)
        R.check(len(pl) == 3 and '89,99 € en une fois' in pl[2] and 'Un seul paiement, sans abonnement' in pl[2]
                and 'mois gratuits' not in pl[2] and 'soit' not in pl[2], f'{t} à vie : carte sous les formules {pl}')
        R.check('Accès à vie : 89,99 € en une fois, débité sur ton compte Apple à la confirmation de l\'achat. Pas d\'abonnement, rien ne se renouvelle.' in txt
                and 'l\'achat à vie ne l\'arrête pas' in txt, f'{t} à vie : mentions (achat unique, abonnement en cours)')
        R.check('Essai gratuit de 3 mois, puis 6,49 € par mois ou 55,00 € par an' in txt, f'{t} à vie : mentions des abonnements sans le prix à vie')
        layout(page, t, 'abonnement avec accès à vie')
        shot(page, LOT, f'40-a-vie-formules-{t}')
        page.click(f'[data-action="pay-buy"][data-id="{LIFE}"]')
        page.wait_for_timeout(1200)
        R.check(page.evaluate('accessLifetime()') == 'purchase' and page.evaluate('canWrite()') is True
                and page.evaluate('accessUntil()') is None, f'{t} à vie acheté : accès sans fin')
        R.check(len(store_calls(page, 'finish')) == 1 and page.locator('.ios-dialog').count() == 0,
                f'{t} à vie acheté : transaction terminée, pas d\'abonnement à résilier')
        txt = sub_text(page)
        R.check('Accès à vie' in txt and 'Renouvellement' not in txt and 'Passer à l\'accès à vie' not in txt
                and 'Voir les formules' not in txt and 'continue d\'être facturé' not in txt, f'{t} Réglages › Abonnement : accès à vie ({txt[:120]!r})')
        layout(page, t, 'Abonnement à vie')
        shot(page, LOT, f'41-a-vie-reglages-{t}')
        txt = paywall(page)
        R.check(page.locator('.pay-plan').count() == 0 and 'Tu as l\'accès à vie' in txt, f'{t} à vie : rien d\'autre à acheter')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # 2. Abonné qui passe à l'accès à vie : prévenu avant, « Gérer chez Apple » après
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'products': 'all'})
        signin(page, username='max')
        subscribed(page, 300)
        page.evaluate("() => { window.__opened = []; window.open = u => { window.__opened.push(String(u)); return null; }; }")
        txt = sub_text(page)
        cell = page.locator('[data-action="pay-open"][data-reason="life"]')
        R.check(cell.count() == 1 and 'Passer à l\'accès à vie' in txt, f'{t} abonné : « Passer à l\'accès à vie »')
        cell.click()
        page.wait_for_selector('.pay-view')
        page.wait_for_timeout(600)
        txt = page.inner_text('.pay-view')
        pl = plans_text(page)
        R.check(len(pl) == 1 and '89,99 € en une fois' in pl[0] and 'Accès à vie' in txt and 'l\'achat à vie ne l\'arrête pas' in txt,
                f'{t} passage à vie : seule la carte à vie, abonnement en cours signalé {pl}')
        layout(page, t, 'passage à vie')
        shot(page, LOT, f'42-passage-a-vie-{t}')
        page.click(f'[data-action="pay-buy"][data-id="{LIFE}"]')
        page.wait_for_selector('.ios-dialog')
        dlg = page.inner_text('.ios-dialog')
        R.check('Ton abonnement continue' in dlg and 'continue d\'être facturé' in dlg, f'{t} passage à vie : abonnement à résilier ({dlg[:100]!r})')
        shot(page, LOT, f'43-abonnement-continue-{t}')
        tap_dialog(page, 'Gérer chez Apple')
        R.check(page.evaluate('window.__opened') == ['https://apps.apple.com/account/subscriptions'], f'{t} « Gérer chez Apple » ouvert')
        txt = sub_text(page)
        R.check('Accès à vie' in txt and 'Ton abonnement Apple continue d\'être facturé' in txt, f'{t} Réglages : abonnement à résilier rappelé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # 3. TestFlight (Sandbox) : achat à vie de test, 7 jours ; AUCUN code d'offre élève demandé (il ne
    #    s'utiliserait pas par la page d'Apple et userait un des 3 codes de l'élève)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'products': 'all', 'environment': 'sandbox'})
        signin(page, username='lea')
        page.evaluate("""async () => { const c = __sb.addPerson({ username: 'lucas', social: false }); __sb.makeCoach(c);
            __sb.link(c, __sb.meId()); window.__opened = []; window.open = u => { __opened.push(String(u)); return null; };
            await coachRefresh(); }""")
        refresh_access(page)
        paywall(page)
        page.click('[data-action="pay-student"]')
        page.wait_for_timeout(700)
        sent = [json.loads(c[2]).get('env') for c in acalls(page, 'student_offer_code')]
        toast = page.inner_text('.toast') if page.locator('.toast').count() else ''
        R.check(sent == [] and len(store_calls(page, 'environment')) == 1 and page.evaluate('window.__opened') == []
                and 'TestFlight' in toast, f'{t} TestFlight : aucun code d\'offre élève demandé ni ouvert {sent} ({toast!r})')
        page.evaluate("__st.everSubscribed = true; access.studentOffer = { error: 'not_new' }")
        paywall(page)
        page.click(f'[data-action="pay-buy"][data-id="{LIFE}"]')
        page.wait_for_timeout(1200)
        txt = sub_text(page)
        R.check(page.evaluate('accessLifetime()') == 'test' and 'Accès à vie (test)' in txt and 'Fin du test' in txt
                and 'quelques jours' in txt, f'{t} TestFlight : achat à vie de test ({txt[:140]!r})')
        shot(page, LOT, f'44-a-vie-test-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

        # 3 bis. Rachat après les 7 jours (examen d'Apple renvoyé plus tard, même identifiant Sandbox) :
        #   StoreKit rend la même transaction, le serveur garde la fin du test. L'app ne dit JAMAIS
        #   « Accès à vie activé » ni « Achats restaurés » quand rien ne s'ouvre, et ne propose plus la
        #   carte « À vie » qui ne donnerait rien
        page.evaluate('__st.serverShift = 8 * 86400000')
        refresh_access(page)
        R.check(page.evaluate('accessStatus()') == 'expired' and page.evaluate('accessLifeTestUsed()') is True
                and page.evaluate('canWrite()') is False, f'{t} test Sandbox fini : accès fermé, test connu')
        txt = sub_text(page)
        R.check('Achat de test terminé' in txt and 'Passer à l\'accès à vie' not in txt,
                f'{t} test Sandbox fini : Réglages le disent ({txt[:160]!r})')
        txt = paywall(page)
        pl = plans_text(page)
        R.check(len(pl) == 2 and all('en une fois' not in p for p in pl) and 'Achat de test terminé' in txt,
                f'{t} test Sandbox fini : plus de carte « À vie » {pl}')
        layout(page, t, 'test Sandbox fini')
        shot(page, LOT, f'46-a-vie-test-fini-{t}')
        r = page.evaluate(f'accessBuy({json.dumps(LIFE)})')
        R.check(r == {'ok': False, 'kind': 'life_test_over'} and page.evaluate('canWrite()') is False,
                f'{t} rachat à vie après le test : pas de succès annoncé {r}')
        page.evaluate('document.querySelector(".toast")?.remove()')
        page.click('[data-action="pay-restore"]')
        page.wait_for_timeout(1200)
        msg = page.locator('.toast').inner_text() if page.locator('.toast').count() else ''
        R.check('Achats restaurés' not in msg and 'test' in msg and '7 jours' in msg,
                f'{t} restaurer après le test : pas de « Achats restaurés » ({msg!r})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # 4. Accès offert à vie (administrateur ou code) : rien à acheter ; App Store : code de Production
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'products': 'all'})
        signin(page, username='max')
        page.evaluate('__st.giveGift()')
        refresh_access(page)
        txt = sub_text(page)
        R.check('Accès offert à vie' in txt and 'Passer à l\'accès à vie' not in txt, f'{t} accès offert à vie : Réglages')
        txt = paywall(page)
        R.check(page.locator('.pay-plan').count() == 0 and 'On t\'a offert l\'accès à vie' in txt, f'{t} accès offert à vie : rien à acheter')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # 5. Coach avec un palier : pas de « Passer à l'accès à vie » ; puis accès à vie offert (coach
    #    partenaire) : also_sub faux, aucune invitation à résilier le palier (il donne le nombre d'élèves)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'products': 'all'})
        signin(page, username='cyril')
        refresh_access(page)
        make_me_coach(page)
        paywall(page, 'coach')
        page.click(f'[data-action="pay-buy"][data-id="{C10}"]')
        page.wait_for_timeout(1200)
        txt = sub_text(page)
        R.check(page.evaluate('access.currentProduct') == C10 and 'Changer de palier coach' in txt
                and page.locator('[data-action="pay-open"][data-reason="life"]').count() == 0,
                f'{t} abonné coach : pas de passage à vie ({txt[:120]!r})')
        page.evaluate('__st.giveGift()')
        refresh_access(page)
        txt = sub_text(page)
        R.check(page.evaluate('accessLifetime()') == 'gift' and page.evaluate('accessAlsoSub()') is False
                and 'Accès offert à vie' in txt and 'continue d\'être facturé' not in txt and 'résilier' not in txt,
                f'{t} coach à vie avec palier : aucune invitation à résilier ({txt[:160]!r})')
        layout(page, t, 'coach à vie avec palier')
        shot(page, LOT, f'45-coach-a-vie-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_vie, t_tarifs, t_essai, t_lecture_seule, t_achat, t_achats_bloques, t_rattrapage, t_verrou_serveur,
             t_verrou_eteint, t_compte_obligatoire, t_version_min, t_horloge, t_grace, t_hors_ligne])
