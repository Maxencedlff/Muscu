"""Abonnement (Payant V1, app iOS simulée) : essai gratuit et bandeau des jours restants, fin d'essai
et mode lecture seule (Historique, Progrès, profil et export restent ouverts, rien n'est supprimé),
écran d'abonnement avec les prix LUS CHEZ STOREKIT, achat, restauration, code d'offre, Réglages ›
Abonnement, verrou éteint (rien ne bloque jamais), horloge de l'appareil trafiquée (ne débloque ni ne
bloque rien), hors ligne.
Règles du 28/10/2026 : essai rattaché à l'identifiant Apple (un nouveau compte sur un « iPhone » dont
l'identifiant Apple a déjà eu son essai n'en a pas de neuf ; sans preuve, essai plafonné verrou
allumé) et compte obligatoire pour enregistrer quand le verrou est allumé (rien ne change éteint).

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
           'period': {'unit': 'month', 'value': 1}, 'introEligible': False},
          {'id': YEARLY, 'displayName': 'MDLF Training annuel', 'description': 'Annuel',
           'displayPrice': '77,77 €', 'price': 77.77, 'currency': 'EUR',
           'period': {'unit': 'year', 'value': 1}, 'introEligible': False}]


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, ppl_v2=None, store=None, opts=None):
    """App lancée avec la coquille iOS, Supabase et StoreKit simulés. store : réglages de __st."""
    page.add_init_script('window.__fakeOpts = %s; window.__stOpts = %s;'
                         % (json.dumps({'oldAccounts': True, **(opts or {})}),
                            json.dumps({'paywallOn': True, 'products': PRICES, **(store or {})})))
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


def trial_started(page, days_ago):
    """Essai démarré il y a N jours, à l'heure du SERVEUR."""
    page.evaluate('n => __st.startTrial(n)', days_ago)
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
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        # Sans compte : aucun appel au droit d'accès, aucun bandeau ; verrou allumé, il faut un compte
        # (règle 2, voir t_compte_obligatoire)
        R.check(len(acalls(page, 'my_access')) == 0, f'{t} sans compte : aucun appel d\'accès')
        R.check(banner(page) == '' and page.evaluate('canWrite()') is False, f'{t} sans compte, verrou allumé : il faut un compte')
        signin(page, username='max')
        page.wait_for_timeout(500)
        # Première lecture : c'est my_access() qui crée la ligne et démarre l'essai, à l'heure du serveur
        R.check(len(acalls(page, 'my_access')) >= 1, f'{t} connexion : my_access appelé (essai démarré par le serveur)')
        R.check(page.evaluate("__st.ents[__sb.meId()].status") == 'trial', f'{t} essai créé côté serveur')
        R.check(page.evaluate('accessStatus()') == 'trial' and page.evaluate('daysLeft()') == 90, f'{t} essai de 90 jours')
        # Règle 1 : la preuve Apple est partie au lancement, l'identifiant de l'« iPhone » est lié
        R.check(page.evaluate('__st.appleLinks[__sb.meId()]') == ['dl-iphone-1'] and page.evaluate('access.state.apple_linked') is True,
                f'{t} connexion : identifiant Apple lié au compte')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        R.check('90 jours' in banner(page), f'{t} bandeau : jours restants ({banner(page)!r})')
        layout(page, t, 'accueil pendant l\'essai')
        shot(page, LOT, f'0-essai-accueil-{t}')
        # Démarrer une séance : rien ne bloque
        start_session(page)
        R.check(page.evaluate('!!activeSession'), f'{t} essai : séance démarrée')
        R.check(page.evaluate("currentView()") == 'session', f'{t} essai : écran de séance')
        # Essai bientôt fini : le bandeau suit le serveur
        page.evaluate("endSession(); routeTo('dashboard')")
        trial_started(page, 89)
        page.wait_for_timeout(250)
        R.check('1 jour' in banner(page), f'{t} dernier jour : bandeau au singulier ({banner(page)!r})')
        # Réglages › Abonnement : état et date de fin
        page.evaluate("navigate('settings')")
        page.wait_for_selector('[data-action="access-open-settings"]')
        cell = page.inner_text('[data-action="access-open-settings"]')
        R.check('Abonnement' in cell and 'jour' in cell, f'{t} Réglages : cellule Abonnement ({cell!r})')
        page.click('[data-action="access-open-settings"]')
        page.wait_for_selector('.pay-settings-view')
        txt = page.inner_text('.pay-settings-view')
        R.check('Essai gratuit' in txt and 'Fin de l\'essai' in txt, f'{t} Abonnement : état et date de fin ({txt[:120]!r})')
        R.check('Restaurer mes achats' in txt and 'J\'ai un code' in txt and 'J\'ai un code d\'offre Apple' in txt
                and 'Un code MDLF se saisit ici' in txt,
                f'{t} Abonnement : restaurer, les deux sortes de codes et leur explication')
        layout(page, t, 'Réglages › Abonnement')
        shot(page, LOT, f'1-reglages-abonnement-{t}')
        # Écran d'abonnement : prix lus chez StoreKit
        page.click('[data-action="pay-open"]')
        page.wait_for_selector('.pay-view')
        page.wait_for_timeout(400)
        txt = page.inner_text('.pay-view')
        R.check('7,77 €' in txt and '77,77 €' in txt, f'{t} formules : prix de StoreKit, pas écrits en dur ({txt[:160]!r})')
        R.check('Mensuel' in txt and 'Annuel' in txt and 'Conditions d\'utilisation' in txt and 'Confidentialité' in txt,
                f'{t} formules : deux formules et les liens obligatoires')
        R.check(len(store_calls(page, 'products')) >= 1, f'{t} formules : products() lu chez StoreKit')
        layout(page, t, 'écran d\'abonnement')
        shot(page, LOT, f'2-abonnement-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ─────────────────────────────────────────────────────────────
#  Fin d'essai : mode lecture seule sur tous les points d'écriture
# ─────────────────────────────────────────────────────────────
def t_lecture_seule(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        trial_started(page, 100)
        R.check(page.evaluate('accessStatus()') == 'expired' and page.evaluate('canWrite()') is False,
                f'{t} essai terminé : plus le droit d\'écrire')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        R.check('Abonnement nécessaire' in banner(page), f'{t} accueil : bandeau de fin d\'essai ({banner(page)!r})')
        layout(page, t, 'accueil après l\'essai')
        shot(page, LOT, f'3-fin-essai-accueil-{t}')
        # 1. Démarrer une séance : l'abonnement est proposé, aucune séance démarrée
        start_session(page)
        R.check(page.evaluate("currentView()") == 'paywall' and page.evaluate('!activeSession'),
                f'{t} démarrer : écran de fin d\'essai, aucune séance ({page.evaluate("currentView()")})')
        R.check('essai est terminé' in page.inner_text('.pay-view'), f'{t} écran de fin d\'essai')
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
        # 4. Enregistrer une séance en cours : la séance reste en cours, avec ses séries
        page.evaluate("""() => { access.state.can_write = true; startSession(firstSession()); access.state.can_write = false;
            validateSet(0, 0); }""")
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
        trial_started(page, 100)
        # Achat annulé : rien ne change
        page.evaluate("__st.fail.purchase = 'cancel'")
        page.evaluate("navigate(makeRoute('paywall', 'end'))")
        page.wait_for_selector('.pay-plan')
        page.wait_for_timeout(300)
        page.click(f'[data-action="pay-buy"][data-id="{MONTHLY}"]')
        page.wait_for_timeout(700)
        R.check(page.evaluate('canWrite()') is False and page.evaluate('accessStatus()') == 'expired'
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
        R.check('Abonné' in txt and 'Renouvellement' in txt and '2027' in txt and 'Gérer chez Apple' in txt,
                f'{t} Abonnement : état abonné et gestion chez Apple ({txt[:120]!r})')
        layout(page, t, 'Abonnement actif')
        shot(page, LOT, f'6-abonne-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Restauration sur un nouvel iPhone : l'achat est chez Apple, pas sur l'appareil
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        trial_started(page, 100)
        # Deux droits chez Apple en même temps : un abonnement et un « Accès offert »
        page.evaluate("""() => { __st.owned = { productId: 'com.mdlf.training.pro.monthly', originalId: 'apple-99',
            transactionId: 'tx-99', expiresAt: Date.now() + 20 * 86400000 };
            __st.ownedGift = { productId: 'com.mdlf.training.access.gift', originalId: 'apple-98',
            transactionId: 'tx-98', expiresAt: null }; }""")
        page.evaluate("navigate(makeRoute('paywall', 'end'))")
        page.wait_for_selector('[data-action="pay-restore"]')
        page.click('[data-action="pay-restore"]')
        page.wait_for_timeout(1500)
        R.check(page.evaluate('canWrite()') is True, f'{t} restauration : accès rendu')
        R.check(len(store_calls(page, 'restore')) == 1 and len(store_calls(page, 'finish')) == 2,
                f'{t} restauration : les deux droits envoyés puis terminés ({store_calls(page, "finish")})')
        R.check(len(page.evaluate('__st.calls.filter(c => c[0] === "verify")')) == 2,
                f'{t} restauration : un appel de vérification par droit')
        # Rien à restaurer : message clair, aucun droit inventé
        page.evaluate("""() => { __st.owned = null; __st.ownedGift = null; __st.ents[__sb.meId()] = { status: 'expired', gift: false,
            expires_at: null, trial_started_at: Date.now() - 200 * 86400000, product_id: null, original_transaction_id: null }; }""")
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
        trial_started(page, 100)
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
        # (ordre des statuts : gift > active > coach_team > trial > expired)
        page.evaluate("__st.emitTransaction('com.mdlf.training.pro.yearly')")
        page.wait_for_timeout(1200)
        R.check(page.evaluate("__st.ents[__sb.meId()].status") == 'active' and page.evaluate('canWrite()') is True,
                f'{t} code d\'offre : abonnement écrit par le serveur, accès ouvert')
        R.check(page.evaluate('accessStatus()') == 'gift', f'{t} accès à vie prioritaire sur l\'abonnement')
        R.check(len(store_calls(page, 'finish')) == 1, f'{t} code d\'offre : transaction terminée')
        # Transaction du non consommable « Accès offert » annoncée par Apple
        page.evaluate("__st.emitTransaction('com.mdlf.training.access.gift')")
        page.wait_for_timeout(1200)
        R.check(page.evaluate('accessStatus()') == 'gift' and page.evaluate('canWrite()') is True,
                f'{t} accès offert : statut gift')
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
        trial_started(page, 100)
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
        trial_started(page, 100)
        R.check(page.evaluate('canWrite()') is False, f'{t} essai terminé : bloqué')
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
        # D'abord pendant l'essai : tout passe, les séances arrivent sur le compte
        trial_started(page, 1)
        page.evaluate('syncNow()')
        page.wait_for_timeout(900)
        on_server = page.evaluate('(__sb.upserted || []).length')
        R.check(on_server > 0 and page.evaluate('account.error') is None, f'{t} pendant l\'essai : séances sauvegardées')
        R.check(page.evaluate('accountLockedCount()') == 0, f'{t} pendant l\'essai : rien de refusé')
        # Essai terminé : une nouvelle séance est refusée par le déclencheur du serveur
        trial_started(page, 200)
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
        trial_started(page, 1000)   # essai largement terminé
        R.check(page.evaluate('accessStatus()') == 'expired', f'{t} verrou éteint : essai terminé côté serveur')
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
        layout(page, t, 'Abonnement verrou éteint')
        shot(page, LOT, f'12-verrou-eteint-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


# ─────────────────────────────────────────────────────────────
#  Règle 1 (28/10) : l'essai est rattaché à l'identifiant Apple
# ─────────────────────────────────────────────────────────────
def t_iphone_deja_essaye(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        # Premier compte sur cet iPhone : essai complet, identifiant Apple lié
        signin(page, username='max')
        page.wait_for_timeout(300)
        first = page.evaluate('__sb.meId()')
        R.check(page.evaluate('daysLeft()') == 90 and page.evaluate("__st.appleIds['dl-iphone-1']") is not None,
                f'{t} premier compte : essai complet, identifiant Apple retenu')
        # 80 jours plus tard, il crée un second compte (nouvelle adresse) sur le même iPhone
        page.evaluate("__st.appleUsed('dl-iphone-1', 80)")
        page.evaluate('accountSignOut()')
        page.wait_for_timeout(300)
        page.evaluate("__sb.appleUser = 'apple-sub-2'")
        signin(page, username='max2')
        page.wait_for_timeout(500)
        R.check(page.evaluate('__sb.meId()') != first, f'{t} second compte : bien un autre compte')
        R.check(page.evaluate('__st.appleLinks[__sb.meId()]') == ['dl-iphone-1'], f'{t} second compte : même identifiant Apple')
        R.check(page.evaluate('accessStatus()') == 'trial' and page.evaluate('daysLeft()') == 10,
                f'{t} second compte : pas de nouvel essai, il reste 10 jours ({page.evaluate("daysLeft()")})')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        R.check('10 jours' in banner(page), f'{t} second compte : le bandeau le dit ({banner(page)!r})')
        shot(page, LOT, f'16-iphone-deja-essaye-{t}')
        # Plus tard encore (essai de l'identifiant Apple fini) : un troisième compte n'a plus rien
        page.evaluate("__st.appleUsed('dl-iphone-1', 120)")
        page.evaluate('accountSignOut()')
        page.wait_for_timeout(300)
        page.evaluate("__sb.appleUser = 'apple-sub-3'")
        signin(page, username='max3')
        page.wait_for_timeout(500)
        R.check(page.evaluate('accessStatus()') == 'expired' and page.evaluate('canWrite()') is False,
                f'{t} troisième compte : essai déjà utilisé par cet identifiant Apple')
        start_session(page)
        R.check(page.evaluate("currentView()") == 'paywall' and page.evaluate('!activeSession'),
                f'{t} troisième compte : l\'abonnement est proposé, aucune séance démarrée')
        R.check(page.locator('[data-action="pay-apple-verify"]').count() == 0, f'{t} identifiant lié : rien à vérifier')
        # Payer reste possible, et ouvre l'accès comme avant
        page.click(f'[data-action="pay-buy"][data-id="{MONTHLY}"]')
        page.wait_for_timeout(900)
        R.check(page.evaluate('canWrite()') is True and page.evaluate('accessStatus()') == 'active', f'{t} achat : accès rendu')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Sans preuve Apple (App Store pas connecté, TestFlight, client modifié) : rien ne bloque tout de
    # suite, l'essai est plafonné à 14 jours ; la preuve revenue, l'essai complet aussi
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'appleProof': 'unavailable'})
        signin(page, username='max')
        page.wait_for_timeout(300)
        R.check(page.evaluate('access.state.apple_linked') is False and page.evaluate('daysLeft()') == 14
                and page.evaluate('canWrite()') is True, f'{t} sans preuve : essai plafonné, rien de bloqué ({page.evaluate("daysLeft()")})')
        R.check(len(page.evaluate('__st.calls.filter(c => c[0] === "apple-link")')) == 0, f'{t} sans preuve : rien envoyé')
        trial_started(page, 20)
        R.check(page.evaluate('canWrite()') is False, f'{t} sans preuve, au-delà de 14 jours : plus d\'écriture')
        page.evaluate("navigate(makeRoute('paywall', 'end'))")
        page.wait_for_timeout(600)
        R.check(page.locator('[data-action="pay-apple-verify"]').count() == 1, f'{t} sans preuve : « Vérifier mon identifiant Apple » proposé')
        layout(page, t, 'abonnement sans preuve Apple')
        shot(page, LOT, f'17-sans-preuve-{t}')
        # Geste explicite : la fenêtre d'Apple (refresh) rend la preuve, l'essai complet revient
        page.evaluate("__st.fail.appleRefresh = 'ok'")
        page.click('[data-action="pay-apple-verify"]')
        page.wait_for_timeout(700)
        R.check(page.evaluate("__st.calls.filter(c => c[0] === 'appTransaction' && c[1] === 'refresh').length") == 1,
                f'{t} vérifier : fenêtre d\'Apple demandée une fois')
        R.check(page.evaluate('canWrite()') is True and page.evaluate('daysLeft()') == 70,
                f'{t} preuve reçue : essai complet depuis son départ ({page.evaluate("daysLeft()")})')
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
        R.check(page.evaluate('!activeSession'), f'{t} démarrer sans compte : aucune séance démarrée')
        shot(page, LOT, f'18-compte-obligatoire-{t}')
        page.click('.auth [data-action="auth-close"]')
        page.wait_for_timeout(400)
        # Séance passée : même invitation, rien n'est enregistré
        before = page.evaluate('data.history.length')
        page.evaluate("handleAction(null, document.createElement('div'), 'go-add-session'); null")
        page.wait_for_timeout(600)
        R.check(page.locator('.auth').count() == 1 and page.evaluate("currentView()") != 'add-session',
                f'{t} séance passée sans compte : invitation à se connecter')
        page.click('.auth [data-action="auth-close"]')
        page.wait_for_timeout(400)
        # Une séance commencée avant (verrou allumé ensuite) : la terminer garde la séance en cours
        page.evaluate("""() => { access.anon = false; startSession(firstSession()); access.anon = true; validateSet(0, 0); }""")
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
        # Connexion : l'essai démarre, et la séance peut être démarrée
        signin(page, username='max')
        page.wait_for_timeout(400)
        R.check(page.evaluate('canWrite()') is True and page.evaluate('accessStatus()') == 'trial', f'{t} connecté : essai démarré')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        start_session(page)
        R.check(page.evaluate('!!activeSession') and page.locator('.auth').count() == 0, f'{t} connecté : séance démarrée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_horloge(bench, eng, dev, theme):
    """Avancer ou reculer l'horloge de l'APPAREIL ne débloque ni ne bloque rien."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        trial_started(page, 1)
        R.check(page.evaluate('daysLeft()') == 89, f'{t} essai : 89 jours (heure du serveur)')
        # 1. Horloge avancée de 400 jours : l'essai court toujours, rien n'est bloqué
        page.evaluate('__st.deviceShift = 400 * 86400000')
        refresh_access(page)
        R.check(page.evaluate('daysLeft()') == 89 and page.evaluate('canWrite()') is True,
                f'{t} horloge avancée de 400 jours : essai intact, rien de bloqué')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        R.check('89 jours' in banner(page), f'{t} horloge avancée : bandeau inchangé ({banner(page)!r})')
        start_session(page)
        R.check(page.evaluate('!!activeSession'), f'{t} horloge avancée : séance démarrée quand même')
        page.evaluate('endSession()')
        # 2. Horloge reculée de 400 jours : pas d'essai rallongé, rien de bloqué non plus
        page.evaluate('__st.deviceShift = -400 * 86400000')
        refresh_access(page)
        R.check(page.evaluate('daysLeft()') == 89 and page.evaluate('canWrite()') is True,
                f'{t} horloge reculée : essai inchangé')
        # 3. Essai terminé côté serveur : avancer l'horloge ne DÉBLOQUE rien
        page.evaluate('__st.deviceShift = 0')
        trial_started(page, 200)
        R.check(page.evaluate('canWrite()') is False, f'{t} essai terminé : refusé')
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


def t_hors_ligne(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        trial_started(page, 10)
        R.check(page.evaluate('daysLeft()') == 80, f'{t} essai lu : 80 jours')
        # Relance hors ligne : le dernier état connu suffit, la salle sans réseau ne bloque personne
        page.evaluate("__st.fail.access = 'offline'; accessReset(account.user.id)")
        page.wait_for_timeout(300)
        R.check(page.evaluate('access.state') is None and page.evaluate('accessStatus()') == 'trial'
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
        R.check(page.evaluate('canWrite()') is True and page.evaluate('accessStatus()') == 'trial',
                f'{t} réseau revenu : essai retrouvé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Hors app iOS (navigateur) : aucun achat, l'écran invite à utiliser l'app
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), store={'store': False})
        signin(page, username='max')
        trial_started(page, 100)
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
        trial_started(page, 100)
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


run_main(R, [t_essai, t_lecture_seule, t_achat, t_achats_bloques, t_rattrapage, t_verrou_serveur,
             t_verrou_eteint, t_iphone_deja_essaye, t_compte_obligatoire, t_horloge, t_hors_ligne])
