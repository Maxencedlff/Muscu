"""Essai coach par offre promotionnelle d'Apple (17/11/2026, docs/PAYANT_V1.md « Essai coach pour qui a déjà eu un
essai »), app iOS simulée : un coach validé qui a déjà eu l'essai particulier (StoreKit : plus d'offre de lancement
dans le groupe) voit « 2 mois offerts » sur les paliers coach, avec les mentions de la règle 3.1.2, et achète avec
l'offre signée par le serveur (fonction Edge coach-promo-offer). Sinon : l'essai de lancement normal, ou le prix
normal. Jamais d'achat au prix plein quand l'écran promettait des mois offerts : refus du serveur ou d'Apple, rien
n'est débité et l'écran repasse au prix normal.

StoreKit, Supabase et la fonction Edge sont simulés (tests/fake_account.py + tests/fake_store.py) : aucun achat réel.
Captures : $PPL_SCRATCH/shots/promo_coach/.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_promo_coach.py (ou run_all.py promo_coach).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT
from fake_store import FAKE_STORE

LOT = 'promo_coach'
R = Results(LOT)
C10 = 'com.mdlf.training.coach10.monthly'
C20Y = 'com.mdlf.training.coach20.yearly'


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, store=None):
    """Coquille iOS, Supabase et StoreKit simulés, verrou allumé, les 10 formules du faux StoreKit."""
    st_opts = {'paywallOn': True, **(store or {})}
    page.add_init_script('window.__fakeOpts = %s; window.__stOpts = %s;' % (json.dumps({'oldAccounts': True}), json.dumps(st_opts)))
    page.add_init_script(FAKE_ACCOUNT)
    page.add_init_script(FAKE_STORE)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)
    page.evaluate("""async () => {
        await accountSignInWith('apple', async () => 'add');
        await accountSaveProfile({ username: 'cyril' });
        __sb.makeCoach(__sb.meId()); await coachRefresh(); await coachProRefresh();
        access.loadedAt = 0; await accessRefresh(); }""")
    page.wait_for_timeout(300)


def promo_right(page, eligible=True, reason=None):
    """Droit côté serveur (coach_promo_state) pour le compte connecté."""
    page.evaluate('([e, r]) => { __st.coachPromo[__sb.meId()] = { eligible: e, reason: r }; }', [eligible, reason])


def coach_paywall(page):
    page.evaluate("navigate(makeRoute('paywall', 'offer', 'coach'))")
    page.wait_for_selector('.pay-view')
    page.wait_for_timeout(700)
    return page.inner_text('.pay-view')


def plans(page):
    return [x.replace('\n', ' ') for x in page.locator('.pay-plan').all_inner_texts()]


def calls(page, kind):
    return page.evaluate('k => __st.calls.filter(c => c[0] === k)', kind)


def toast(page):
    return page.locator('.toast').inner_text() if page.locator('.toast').count() else ''


def layout(page, t, name):
    R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} {name} : pas de défilement horizontal')
    small = page.evaluate("""() => [...document.querySelectorAll('#app button')].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""")
    R.check(not small, f'{t} {name} : cibles de 44 pt {small}')
    cut = page.evaluate("""() => [...document.querySelectorAll('.pay-view *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('svg, use, .icon *') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""")
    R.check(not cut, f'{t} {name} : aucun texte coupé {cut}')


def t_promo_offerte(bench, eng, dev, theme):
    """Le cas visé : essai particulier déjà eu, coach validé, jamais abonné coach → 2 mois offerts, achat signé."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, store={'introEligible': False})
        promo_right(page)
        txt = coach_paywall(page)
        pl = plans(page)
        R.check(len(pl) == 4 and all('2 mois offerts' in p for p in pl) and 'gratuits' not in ' '.join(pl),
                f'{t} paliers coach : « 2 mois offerts » sur chacun {pl}')
        # Règle 3.1.2 : le prix débité domine (en gros), l'offre en ligne secondaire ; durée, prix d'après, résiliation
        R.check(page.locator('.pay-plan__price').first.evaluate('e => e.textContent').startswith('15,99'),
                f'{t} prix en gros, pas l\'offre')
        R.check('Essai coach : 2 mois offerts, puis 15,99 € par mois' in txt and 'au moins 24 heures avant la fin de l\'essai' in txt
                and 'jamais eu d\'abonnement coach, une seule fois par compte' in txt and 'Conditions d\'utilisation' in txt,
                f'{t} mentions de l\'essai coach')
        R.check(page.locator('.pay-hero').inner_text().startswith('MDLF Training pour coachs') and 'Essai coach : 2 mois offerts' in txt,
                f'{t} haut de l\'écran : l\'essai coach')
        layout(page, t, 'essai coach')
        shot(page, LOT, f'01-essai-coach-{t}')
        # Annuel : même offre
        page.click('[data-action="pay-period"][data-period="year"]')
        page.wait_for_timeout(300)
        R.check(all('2 mois offerts' in p for p in plans(page)), f'{t} annuel : 2 mois offerts {plans(page)}')
        # Achat : signature demandée (non éligible au lancement), StoreKit appelé avec l'offre de CE produit
        page.click(f'[data-action="pay-buy"][data-id="{C20Y}"]')
        page.wait_for_timeout(1300)
        signs = page.evaluate('__st.promoSigned')
        buys = calls(page, 'purchase')
        R.check(len(signs) == 1 and signs[0]['productId'] == C20Y, f'{t} une signature demandée pour ce produit {signs}')
        R.check(len(buys) == 1 and buys[0][1] == C20Y and buys[0][3] == C20Y + '.essai2mois', f'{t} achat avec l\'offre signée {buys}')
        R.check('"introEligible":false' in calls(page, 'promoSign')[0][1], f'{t} éligibilité de lancement transmise')
        R.check(page.evaluate('accessStatus()') == 'active' and page.evaluate('canWrite()') is True, f'{t} abonnement coach actif')
        # Une seule fois : le serveur ferme l'offre dès qu'un abonnement coach existe
        page.evaluate("access.coachPromo = null")
        coach_paywall(page)
        R.check(not any('offerts' in p for p in plans(page)), f'{t} après l\'achat : plus d\'offre {plans(page)}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_sans_promo(bench, eng, dev, theme):
    """Essai de lancement encore accordé, déjà eu un abonnement coach, ancienne build : pas d'offre signée."""
    t = tag(dev, theme)
    # 1. Jamais abonné : l'essai de lancement d'Apple (2 mois coach dans App Store Connect, 3 dans le faux), sans signature
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        promo_right(page)
        coach_paywall(page)
        pl = plans(page)
        R.check(all('gratuits' in p for p in pl) and not any('offerts' in p for p in pl), f'{t} éligible au lancement : essai normal {pl}')
        page.click(f'[data-action="pay-buy"][data-id="{C10}"]')
        page.wait_for_timeout(1200)
        R.check(not page.evaluate('__st.promoSigned') and calls(page, 'purchase')[0][3] == '', f'{t} achat sans offre signée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    # 2. Déjà eu un abonnement coach (le serveur refuse) : prix normal
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, store={'introEligible': False})
        promo_right(page, False, 'had_coach')
        txt = coach_paywall(page)
        R.check(not any('offerts' in p or 'gratuits' in p for p in plans(page)) and 'Essai coach' not in txt
                and '15,99 € par mois ou' in txt and 'à la confirmation de l\'achat' in txt, f'{t} déjà coach : prix normal, mentions sans essai')
        shot(page, LOT, f'02-sans-essai-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    # 3. Build 68 (promoOffers absent) : jamais d'offre annoncée, même avec le droit
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, store={'introEligible': False, 'promoOffers': False})
        promo_right(page)
        coach_paywall(page)
        R.check(not any('offerts' in p for p in plans(page)), f'{t} ancienne build : pas d\'offre {plans(page)}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_refus(bench, eng, dev, theme):
    """Refus d'Apple ou du serveur au moment d'acheter : rien n'est débité, l'écran repasse au prix normal."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, store={'introEligible': False, 'promoRefused': True})
        promo_right(page)
        coach_paywall(page)
        page.click(f'[data-action="pay-buy"][data-id="{C10}"]')
        page.wait_for_timeout(1200)
        R.check('Rien n\'a été débité' in toast(page) and page.evaluate('accessStatus()') != 'active',
                f'{t} offre refusée par Apple : rien de débité ({toast(page)!r})')
        R.check(not page.evaluate('__st.owned'), f'{t} aucun abonnement chez Apple')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, store={'introEligible': False})
        promo_right(page)
        coach_paywall(page)
        # Le droit tombe entre l'affichage et l'achat (autre appareil, administrateur) : aucun achat lancé
        promo_right(page, False, 'had_coach')
        page.click(f'[data-action="pay-buy"][data-id="{C10}"]')
        page.wait_for_timeout(1200)
        R.check(not calls(page, 'purchase'), f'{t} refus du serveur : StoreKit jamais appelé')
        R.check('Rien n\'a été débité' in toast(page), f'{t} refus du serveur : dit ({toast(page)!r})')
        R.check(not any('offerts' in p for p in plans(page)), f'{t} refus du serveur : prix normal ensuite {plans(page)}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_promo_offerte, t_sans_promo, t_refus])
