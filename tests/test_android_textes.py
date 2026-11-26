"""Textes propres au système sur Android (panel du 26/11 : juges 11 et 16, Pixel 7) : l'app Android ne parle ni
d'Apple, ni d'iPhone, ni d'iCloud, ni de Face ID là où ce n'est pas vrai ; l'abonnement y est coupé proprement
(Google Play pas encore branché au serveur, Native.store.soon) ; bouton retour du système ; et l'app iOS garde ses
textes. Chromium avec l'agent utilisateur du Pixel 7 et une coquille Android simulée (tests/fake_account.py,
__fakeOpts.platform = 'android', avec les modules Compte et Abonnement que la coquille Android aura) ; Supabase et
le module d'achat sont simulés, aucune requête ne sort.
Captures : $PPL_SCRATCH/shots/lotandroid_textes/ (Pixel 7, sombre et clair).
Lancer : PPL_ONCE=1 python3 test_android_textes.py (ou run_all.py android_textes).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT
from fake_store import FAKE_STORE

LOT = 'android_textes'
R = Results(LOT)
YEARLY = 'com.mdlf.training.pro.yearly'
PRICES = [{'id': 'com.mdlf.training.pro.monthly', 'displayName': 'MDLF Training mensuel', 'description': 'Mensuel',
           'displayPrice': '7,77 €', 'price': 7.77, 'currency': 'EUR', 'period': {'unit': 'month', 'value': 1}, 'introEligible': True},
          {'id': YEARLY, 'displayName': 'MDLF Training annuel', 'description': 'Annuel',
           'displayPrice': '77,77 €', 'price': 77.77, 'currency': 'EUR', 'period': {'unit': 'year', 'value': 1}, 'introEligible': True}]
# Mots qui ne doivent jamais apparaître sur Android, sauf la mention vraie « abonnement pris sur iPhone »
APPLE = re.compile(r"Apple|iCloud|Face ID|Touch ID|Safari|Temps d'écran|trousseau|App Store|TestFlight|nouvel iPhone|cet iPhone|l'app iPhone")


def open_app(page, theme, platform):
    page.add_init_script('window.__fakeOpts = %s; window.__stOpts = %s;' % (
        json.dumps({'oldAccounts': True, 'platform': platform}), json.dumps({'paywallOn': True, 'products': PRICES})))
    page.add_init_script(FAKE_ACCOUNT)
    page.add_init_script(FAKE_STORE)
    page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
    settle(page)


def go(page, route):
    page.evaluate('r => navigate(r)', route)
    settle(page)


def apple_words(text):
    """Mentions d'Apple hors de la phrase vraie sur l'abonnement pris sur iPhone."""
    text = re.sub(r"[^.]*(pris sur iPhone|abonné sur iPhone|vient d'un iPhone)[^.]*\.", '', text)
    return sorted(set(APPLE.findall(text)))


def small_targets(page):
    return page.evaluate("""() => [...document.querySelectorAll('#app button, .tabbar button')].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""")


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def o_android(bench):
    for theme in THEMES:
        t = f'Pixel_7-{theme}'
        with bench.page('chromium', 'Pixel 7', theme) as page:
            open_app(page, theme, 'android')
            R.check(page.evaluate('Native.platform') == 'android', f'{t} coquille Android simulée')
            R.check('Android' in page.evaluate('navigator.userAgent'), f'{t} agent utilisateur Android (Pixel 7)')
            R.check(page.evaluate('Native.store.available') is False and page.evaluate('Native.store.soon') is True,
                    f'{t} achats coupés tant que Google Play n\'est pas branché')

            # Bienvenue et Compte : « téléphone », Google d'abord, jamais « Continuer avec Apple »
            page.evaluate("openAuthFlow({ step: 'welcome', closable: true })")
            settle(page)
            text = page.inner_text('body')
            R.check('nouveau téléphone' in text, f'{t} Bienvenue : « nouveau téléphone »')
            R.check(not apple_words(text), f'{t} Bienvenue : rien d\'Apple {apple_words(text)}')
            first = page.locator('.auth-buttons .auth-btn').first.inner_text()
            R.check('Google' in first, f'{t} Bienvenue : Google en premier ({first!r})')
            shot(page, LOT, f'bienvenue-{t}')
            page.evaluate("document.querySelectorAll('.auth').forEach(e => e.remove())")
            go(page, 'account')
            text = page.inner_text('#app')
            R.check('Health Connect' in text and not apple_words(text), f'{t} Compte : Health Connect, rien d\'Apple {apple_words(text)}')

            # Abonnement : message clair, aucun achat, aucun texte d'Apple
            page.evaluate("async () => { await accountSignInWith('google', async () => 'add'); await accountSaveProfile({ username: 'max' }); }")
            settle(page)
            page.evaluate('access.loadedAt = 0; accessRefresh()')
            settle(page)
            go(page, 'paywall')
            text = page.inner_text('#app')
            R.check('pas encore proposé sur Android' in text, f'{t} Abonnement : pas encore proposé sur Android')
            R.check(not apple_words(text), f'{t} Abonnement : rien d\'Apple {apple_words(text)}')
            R.check(page.locator('[data-action="pay-buy"], [data-action="pay-restore"], [data-action="pay-apple-code"]').count() == 0,
                    f'{t} Abonnement : ni formule, ni restauration, ni code de boutique')
            R.check(no_hscroll(page), f'{t} Abonnement : pas de défilement horizontal')
            R.check(not small_targets(page), f'{t} Abonnement : cibles d\'au moins 44 px {small_targets(page)}')
            shot(page, LOT, f'abonnement-{t}')
            go(page, 'subscription')
            text = page.inner_text('#app')
            R.check(not apple_words(text) and 'Gérer chez Apple' not in text, f'{t} Réglages › Abonnement : rien d\'Apple {apple_words(text)}')
            R.check('pas encore proposé sur Android' in text, f'{t} Réglages › Abonnement : où en est Android')
            shot(page, LOT, f'reglages-abonnement-{t}')

            # Réglages : pas de Services Apple ni de Safari
            go(page, 'settings')
            text = page.inner_text('#app')
            R.check(not apple_words(text), f'{t} Réglages : rien d\'Apple {apple_words(text)}')
            R.check('ouvertes dans le navigateur' in text, f'{t} Réglages : pages ouvertes dans le navigateur')
            shot(page, LOT, f'reglages-{t}')

            # Coffre à photos (pas de module sur Android) : ni Face ID ni trousseau iCloud promis
            cell = page.evaluate("photoVaultCellHtml().replace(/<[^>]+>/g, ' ')")
            R.check('bientôt sur Android' in cell and not apple_words(cell), f'{t} coffre : bientôt sur Android, rien d\'Apple')
            R.check(page.evaluate('Native.vault.available') is False, f'{t} coffre indisponible')

            # Bouton retour du système (historique de la vue web, comportement par défaut de Capacitor) :
            # il ferme d'abord la feuille ouverte, puis revient à l'écran précédent
            page.evaluate("dialog({ title: 'Essai', message: 'Retour', actions: [{ label: 'OK', style: 'preferred' }] })")
            page.wait_for_selector('.ios-dialog')
            settle(page)
            page.go_back()
            settle(page)
            R.check(page.locator('.ios-dialog:not(.ios-dialog--out)').count() == 0, f'{t} retour : ferme le dialogue')
            R.check(page.evaluate('currentView()') == 'settings', f'{t} retour : reste sur les Réglages après le dialogue')
            page.go_back()
            settle(page)
            R.check(page.evaluate('currentView()') != 'settings', f'{t} retour : écran précédent ({page.evaluate("currentView()")})')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def o_ios(bench):
    """La même coquille en iOS garde exactement ses textes d'Apple (Gérer chez Apple, identifiant Apple, Apple d'abord)."""
    t = 'iPhone_13-dark'
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        open_app(page, 'dark', 'ios')
        page.evaluate("openAuthFlow({ step: 'welcome', closable: true })")
        settle(page)
        R.check('Apple' in page.locator('.auth-buttons .auth-btn').first.inner_text(), f'{t} Bienvenue : Apple en premier')
        R.check('nouvel iPhone' in page.inner_text('body'), f'{t} Bienvenue : « nouvel iPhone »')
        page.evaluate("document.querySelectorAll('.auth').forEach(e => e.remove())")
        page.evaluate("async () => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: 'max' }); }")
        settle(page)
        page.evaluate('access.loadedAt = 0; accessRefresh()')
        settle(page)
        go(page, 'paywall')
        text = page.inner_text('#app')
        R.check('débité sur ton compte Apple' in text and 'Un seul essai gratuit par identifiant Apple' in text, f'{t} Abonnement : mentions d\'Apple')
        go(page, 'subscription')
        text = page.inner_text('#app')
        R.check('Gérer chez Apple' in text and 'réglages de l\'identifiant Apple' in text, f'{t} Réglages › Abonnement : Gérer chez Apple')
        go(page, 'settings')
        R.check('ouvertes dans Safari' in page.inner_text('#app'), f'{t} Réglages : Safari')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [], once=[o_android, o_ios])
