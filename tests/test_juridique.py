"""Juridique (app iOS simulée) : lettre d'information (inscription par consentement explicite, jamais
cochée d'avance, désinscription, hors ligne et « Réessayer », changement de compte, connexion faite sur
l'écran Compte, compte Apple seul sans adresse) et liens vers les pages juridiques
(Réglages › Informations légales).

L'app iOS et Supabase sont simulés (tests/fake_account.py) : aucune requête ne sort, aucun e-mail.
Règles : docs/NEWSLETTER.md et docs/JURIDIQUE.md.
Captures : $PPL_SCRATCH/shots/lotjuridique/ (clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_juridique.py (ou run_all.py juridique).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'juridique'
R = Results(LOT)
SWITCH = '[data-action="newsletter-toggle"]'


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme):
    page.add_init_script('window.__fakeOpts = {};')
    page.add_init_script(FAKE_ACCOUNT)
    # window.open noté au lieu d'ouvrir Safari
    page.add_init_script('window.__opened = []; window.open = u => { window.__opened.push(String(u)); return null; };')
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username='max', provider='google'):
    """Google : le compte a une adresse (celle de Google). Apple : aucune adresse (comme dans l'app)."""
    page.evaluate("""async ([u, p]) => {
        await accountSignInWith(p, async () => 'add');
        if (u) await accountSaveProfile({ username: u });
    }""", [username, provider])
    page.wait_for_timeout(200)


def open_account(page):
    page.evaluate("navigate('account')")
    page.wait_for_selector('.account-view')
    page.wait_for_timeout(400)


def nl_calls(page, fn=None):
    return page.evaluate('f => __sb.calls.filter(c => c[0] === "newsletter" && (!f || c[1] === f))', fn)


def checked(page):
    return page.get_attribute(SWITCH, 'aria-checked')


def toast(page):
    return page.locator('.toast').inner_text() if page.locator('.toast').count() else ''


def layout_ok(page, t, what):
    R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} {what} : pas de défilement horizontal')
    small = page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.height < 44; })
        .map(e => e.textContent.trim().slice(0, 30))""", '.account-view .cell, .settings-view .cell')
    R.check(not small, f'{t} {what} : cellules de 44 px au moins {small}')


def t_newsletter(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        signin(page)
        open_account(page)
        sw = page.locator(SWITCH)
        # 1. Jamais coché d'avance, rien envoyé sans geste
        R.check(sw.count() == 1 and checked(page) == 'false' and not sw.is_disabled(), f'{t} interrupteur éteint par défaut ({checked(page)})')
        R.check([c[1] for c in nl_calls(page)] == ['newsletter_state'], f'{t} seul l\'état est lu à l\'ouverture {nl_calls(page)}')
        foot = page.inner_text('#newsletterConsent')
        R.check('Je veux recevoir par e-mail la lettre d\'information' in foot and 'désinscrire à tout moment' in foot
                and 'adresse de ton compte' in foot, f'{t} texte du consentement sous l\'interrupteur')
        R.check(page.get_attribute(SWITCH, 'aria-describedby') == 'newsletterConsent', f'{t} VoiceOver lit le texte du consentement')
        R.check('Désactivée' in page.inner_text('#newsletterSub'), f'{t} état « Désactivée »')
        layout_ok(page, t, 'compte')
        sw.scroll_into_view_if_needed()
        shot(page, LOT, f'1-newsletter-eteinte-{t}')
        # 2. Inscription : un toucher, la version du texte part, pas de date de l'appareil
        sw.click()
        page.wait_for_timeout(400)
        sub = nl_calls(page, 'newsletter_subscribe')
        R.check(len(sub) == 1 and json.loads(sub[0][2]) == {'consent_version': 'v1'}, f'{t} inscription : version seule envoyée {sub}')
        R.check(checked(page) == 'true' and 'Inscrit depuis le' in page.inner_text('#newsletterSub'), f'{t} inscrit, date du serveur affichée')
        R.check('Inscription enregistrée' in toast(page), f'{t} toast d\'inscription ({toast(page)})')
        shot(page, LOT, f'2-newsletter-inscrit-{t}')
        # 3. Retour sur l'écran : état relu, toujours inscrit
        page.evaluate("navigate('settings')")
        page.wait_for_timeout(300)
        page.evaluate("newsletter.loadedAt = 0")
        open_account(page)
        R.check(checked(page) == 'true', f'{t} inscription relue chez le serveur')
        # 4. Désinscription : un toucher, plus rien côté serveur
        page.locator(SWITCH).click()
        page.wait_for_timeout(400)
        R.check(checked(page) == 'false' and page.evaluate('Object.keys(__sb.nl.subs).length') == 0, f'{t} désinscrit, ligne supprimée')
        R.check('désinscrit' in toast(page), f'{t} toast de désinscription ({toast(page)})')
        # 5. Hors ligne au toucher : rien ne change, la raison est dite
        page.evaluate("__sb.fail.newsletter = 'offline'")
        page.locator(SWITCH).click()
        page.wait_for_timeout(400)
        R.check(checked(page) == 'false' and 'Pas de connexion' in toast(page), f'{t} hors ligne : reste éteint, raison dite ({toast(page)})')
        # 6. Hors ligne à l'ouverture : état inconnu, interrupteur désactivé (aucune inscription supposée)
        page.evaluate("newsletterReset(account.user.id)")
        page.evaluate("navigate('settings')")
        page.wait_for_timeout(200)
        open_account(page)
        R.check(page.locator(SWITCH).is_disabled() and checked(page) == 'false'
                and 'indisponible' in page.inner_text('#newsletterSub'), f'{t} état inconnu : désactivé, raison dite')
        # 6 bis. « Réessayer » sur place, le réseau revenu : l'état est relu, l'interrupteur revient
        page.evaluate("__sb.fail.newsletter = null")
        retry = page.locator('[data-action="newsletter-retry"]')
        R.check(retry.count() == 1, f'{t} bouton « Réessayer » après l\'échec')
        if retry.count():
            retry.click()
            page.wait_for_timeout(400)
        R.check(not page.locator(SWITCH).is_disabled() and page.locator('[data-action="newsletter-retry"]').count() == 0,
                f'{t} « Réessayer » : interrupteur de nouveau actif')
        # 7. Lien Confidentialité de la lettre
        page.click('[data-action="newsletter-privacy"]')
        R.check(page.evaluate('__opened.at(-1)') == 'https://mdlf.app/privacy.html#newsletter', f'{t} lien vers la confidentialité de la lettre')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_changement_compte(bench, eng, dev, theme):
    """Un autre compte sur le même iPhone ne voit jamais l'inscription du précédent."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'max')
        open_account(page)
        page.locator(SWITCH).click()
        page.wait_for_timeout(400)
        R.check(checked(page) == 'true', f'{t} premier compte inscrit')
        page.evaluate("async () => { await accountSignOut(); }")
        page.wait_for_timeout(300)
        page.evaluate("__sb.googleSub = 'google-sub-2'")
        signin(page, 'lea')
        open_account(page)
        R.check(checked(page) == 'false', f'{t} second compte : pas inscrit ({checked(page)})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_connexion_sur_compte(bench, eng, dev, theme):
    """Première connexion faite depuis l'écran Compte (ouvert déconnecté) : l'état est lu sans quitter l'écran."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        open_account(page)
        R.check(page.locator('.account-view--out').count() == 1 and page.locator(SWITCH).count() == 0, f'{t} écran Compte déconnecté')
        signin(page)   # même appel que le bouton « Continuer avec Google » de cet écran, sans navigation
        page.wait_for_timeout(400)
        R.check(page.locator(SWITCH).count() == 1 and not page.locator(SWITCH).is_disabled(), f'{t} interrupteur actif sans quitter l\'écran')
        R.check('Désactivée' in page.inner_text('#newsletterSub'), f'{t} état lu, plus « Chargement… »')
        R.check(len(nl_calls(page, 'newsletter_state')) == 1, f'{t} état lu une seule fois {nl_calls(page)}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_apple_seul(bench, eng, dev, theme):
    """Compte créé avec Apple seul (aucune adresse) : inscription impossible et expliquée, possible dès
    qu'une adresse e-mail est reliée au compte."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'max', 'apple')
        open_account(page)
        sw = page.locator(SWITCH)
        R.check(sw.is_disabled() and checked(page) == 'false', f'{t} Apple seul : interrupteur éteint et désactivé')
        R.check('Ajoute une connexion Google ou e-mail à ton compte pour recevoir la lettre.' in page.inner_text('#newsletterSub'),
                f'{t} Apple seul : ce qu\'il faut ajouter est dit')
        sw.click(force=True)
        page.wait_for_timeout(300)
        R.check(not nl_calls(page, 'newsletter_subscribe') and checked(page) == 'false', f'{t} Apple seul : aucune inscription envoyée')
        # Le serveur refuse aussi (appel direct, comme une ancienne version de l'app)
        r = page.evaluate("newsletterSet(true)")
        R.check(r == {'ok': False, 'kind': 'no_email'}, f'{t} serveur : no_email {r}')
        sw.scroll_into_view_if_needed()
        shot(page, LOT, f'4-newsletter-apple-seul-{t}')
        # Adresse e-mail reliée au compte, l'écran ouvert : l'état est relu, l'inscription devient possible
        page.evaluate("""async () => { const at = Date.now(); await accountLinkEmailStart('max@example.test');
            return accountLinkEmailVerify('max@example.test', __sb.code, at); }""")
        page.wait_for_timeout(400)
        R.check(not page.locator(SWITCH).is_disabled() and 'Désactivée' in page.inner_text('#newsletterSub'),
                f'{t} adresse ajoutée : interrupteur actif')
        page.locator(SWITCH).click()
        page.wait_for_timeout(400)
        R.check(checked(page) == 'true', f'{t} adresse ajoutée : inscription possible')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_liens(bench, eng, dev, theme):
    """Réglages › Informations légales : quatre pages, ouvertes dans Safari, sans compte."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        page.evaluate("navigate('settings')")
        page.wait_for_selector('.settings-view, .view')
        page.wait_for_timeout(300)
        cells = page.locator('[data-action="open-legal"]')
        R.check(cells.count() == 4, f'{t} quatre pages juridiques ({cells.count()})')
        for i in range(cells.count()):
            cells.nth(i).click()
            page.wait_for_timeout(100)
        opened = page.evaluate('__opened')
        R.check(opened == ['https://mdlf.app/privacy.html', 'https://mdlf.app/cgu.html', 'https://mdlf.app/cgv.html',
                           'https://mdlf.app/mentions-legales.html'], f'{t} pages ouvertes {opened}')
        cells.first.scroll_into_view_if_needed()
        shot(page, LOT, f'3-reglages-informations-legales-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_confidentialite(bench, eng, dev, theme):
    """privacy.html telle que publiée sur mdlf.app : sauvegardes chiffrées de la base (90 jours chez GitHub,
    copies locales), ce qui reste après la suppression du compte, copie iCloud sans donnée de santé,
    en français puis en anglais, lisible sur téléphone (audit du 12/11/2026, docs/REVUE_APPLE.md 6.3 et 6.5)."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        page.goto(BASE_URL + 'privacy.html')
        page.wait_for_selector('h1')
        body = page.inner_text('body')
        R.check('mise à jour le 12 novembre 2026' in body and 'updated November 12, 2026' in body, f'{t} date du 12/11 (FR et EN)')
        fr, en = body.split('Data stored on your device')[0], body.split('Data stored on your device')[-1]
        R.check('Sauvegardes de la base' in fr and '90 jours' in fr and 'GitHub' in fr and '30 dernières copies' in fr,
                f'{t} FR : sauvegardes chiffrées, durée, GitHub, copies locales')
        R.check('Database backups' in en and '90 days' in en and 'GitHub' in en and 'last 30 copies' in en,
                f'{t} EN : encrypted backups, duration, GitHub, local copies')
        R.check('restent seulement dans les sauvegardes chiffrées' in fr and 'remains only in the encrypted backups' in en,
                f'{t} ce qui reste après la suppression du compte (FR et EN)')
        R.check('Cette copie iCloud ne contient ni ton poids' in fr and 'This iCloud copy contains neither your body weight' in en,
                f'{t} copie iCloud sans donnée de santé (FR et EN)')
        R.check(page.locator('#sauvegardes').is_visible() and page.locator('#backups').count() == 1, f'{t} ancres des sauvegardes')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} confidentialité : pas de défilement horizontal')
        page.locator('#sauvegardes').scroll_into_view_if_needed()
        shot(page, LOT, f'4-confidentialite-sauvegardes-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_newsletter, t_changement_compte, t_connexion_sur_compte, t_apple_seul, t_liens, t_confidentialite])
