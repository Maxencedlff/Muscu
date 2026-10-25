"""Compte (app iOS simulée) : Bienvenue, code par e-mail, pseudo, avatar, écran Compte, moyens de
connexion, suppression, carte de l'accueil.

L'app iOS et Supabase sont simulés (tests/fake_account.py) : aucune requête ne sort, aucun iPhone.
Captures : $PPL_SCRATCH/shots/lotcompte/ (chaque nouvel écran, clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_compte.py (ou run_all.py compte).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'compte'
R = Results(LOT)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme, ppl_v2=None, extra=None, opts=None):
    """App iOS simulée : coquille et Supabase factices, stockage vidé puis rempli."""
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps(opts or {}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2, extra=extra)
    page.wait_for_timeout(400)


def welcome_open(page):
    return page.locator('.auth .auth__page--welcome').count() == 1


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def overflowing(page):
    """Textes coupés dans le calque : éléments dont le contenu dépasse."""
    return page.evaluate("""() => [...document.querySelectorAll('.auth button, .auth p, .auth h1, .auth-btn span')]
        .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 30))""")


def small_targets(page, sel):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent)
        .map(e => e.getBoundingClientRect()).filter(r => r.width < 44 || r.height < 44).length""", sel)


def calls(page, kind):
    return page.evaluate('k => __sb.calls.filter(c => c[0] === k)', kind)


def age_session(page, seconds=3600):
    """Session ancienne : la dernière vraie connexion (claim amr) recule d'autant."""
    page.evaluate("""s => { const p = JSON.parse(atob(__sb.session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        p.amr.forEach(a => { a.timestamp -= s; }); __sb.session.access_token = 'h.' + btoa(JSON.stringify(p)).replace(/=+$/, '') + '.s'; }""", seconds)


NEW_ACCOUNT_NOTICE = 'Nouveau compte créé. Tu avais déjà un compte ?'
OWNER_1 = '00000000-0000-0000-0000-000000000002'   # premier compte créé par le faux serveur (1 : son identité)


def in_view(page, sel):
    """Élément entièrement visible sans défiler."""
    return page.evaluate("""s => { const e = document.querySelector(s); if (!e) return false;
        const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }""", sel)


def one_line(page, sel):
    """Libellés (span) des boutons qui passent sur deux lignes."""
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent)
        .filter(e => e.offsetHeight > parseFloat(getComputedStyle(e).lineHeight || 0) * 1.5 || e.scrollWidth > e.clientWidth + 1)
        .map(e => e.textContent)""", sel)


def t_welcome(bench, eng, dev, theme):
    """Premier lancement : Bienvenue une seule fois, « Commencer sans compte » mène à l'app."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        R.check(welcome_open(page), f'{t} Bienvenue au premier lancement')
        labels = page.locator('.auth .auth-btn').all_inner_texts()
        R.check([l.strip() for l in labels] == ['Continuer avec Apple', 'Continuer avec Google', 'Continuer avec un e\u2011mail'], f'{t} trois boutons {labels}')
        skip = page.locator('[data-action="auth-skip"]')
        R.check(skip.inner_text().strip() == 'Commencer sans compte', f'{t} « Commencer sans compte »')
        size = page.evaluate("getComputedStyle(document.querySelector('.auth__skip')).fontSize")
        R.check(float(size[:-2]) >= 17, f'{t} « Commencer sans compte » bien lisible ({size})')
        R.check(page.evaluate("document.getElementById('app').inert") is True, f'{t} app inerte sous le calque')
        R.check(small_targets(page, '.auth button') == 0, f'{t} cibles de 44 pt au moins')
        R.check(not overflowing(page), f'{t} aucun texte coupé {overflowing(page)}')
        R.check(no_hscroll(page), f'{t} pas de défilement horizontal')
        wrapped = page.evaluate("""[...document.querySelectorAll('.auth .auth-btn span')]
            .filter(s => s.offsetHeight > parseFloat(getComputedStyle(s).fontSize) * 1.7).map(s => s.textContent)""")
        R.check(not wrapped, f'{t} libellés des boutons sur une ligne {wrapped}')
        R.check(page.evaluate("getComputedStyle(document.querySelector('.auth-btn')).whiteSpace") == 'nowrap', f'{t} boutons : white-space nowrap')
        R.check('Déjà un compte ? Utilise le même moyen qu\'avant.' in page.inner_text('.auth'), f'{t} « Déjà un compte ? »')
        R.check(in_view(page, '.auth__skip') and in_view(page, '.auth__skip-note') and in_view(page, '.auth__foot'), f'{t} « Commencer sans compte » et les mentions visibles sans défiler')
        R.check(ls(page, 'ppl_welcome_seen') is None, f'{t} drapeau pas posé à l\'affichage')
        shot(page, LOT, f'1-bienvenue-{t}')
        # App fermée sans choix : Bienvenue revient
        page.reload()
        page.wait_for_selector('.auth__page--welcome')
        R.check(welcome_open(page), f'{t} sans choix : Bienvenue au lancement suivant')
        skip = page.locator('[data-action="auth-skip"]')
        skip.click()
        page.wait_for_timeout(400)
        R.check(ls(page, 'ppl_welcome_seen') == '1', f'{t} « Commencer sans compte » : drapeau posé')
        R.check(page.locator('.auth').count() == 0, f'{t} sans compte : calque fermé')
        R.check(page.evaluate('view') == 'dashboard' and page.locator('.onboard').count() == 1, f'{t} accueil et « Où t\'entraînes-tu ? »')
        R.check(page.locator('.account-card').count() == 0, f'{t} pas de carte compte après Bienvenue')
        page.reload()
        page.wait_for_selector('#app > *')
        page.wait_for_timeout(500)
        R.check(not welcome_open(page), f'{t} Bienvenue jamais deux fois')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Client Google pas encore configuré : bouton masqué
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, opts={'google': False})
        R.check(page.locator('.auth-btn--google').count() == 0 and page.locator('.auth-btn--apple').count() == 1, f'{t} Google masqué sans client ID')


def t_code(bench, eng, dev, theme):
    """Connexion par code : adresse, code faux, expiré, renvoi, bon code, pseudo et avatar du nouveau compte."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        page.click('.auth [data-action="auth-email"]')
        page.wait_for_selector('#authEmail')
        email = page.locator('#authEmail')
        R.check(email.get_attribute('type') == 'email' and email.get_attribute('autocomplete') == 'email', f'{t} champ e-mail (type, autocomplete)')
        send = page.locator('[data-role="send"]')
        page.fill('#authEmail', 'max@exemple')
        R.check(send.is_disabled(), f'{t} adresse incomplète : bouton grisé')
        page.fill('#authEmail', ' Max@Exemple.fr ')
        R.check(send.is_enabled(), f'{t} adresse valable : bouton actif')
        shot(page, LOT, f'2-email-{t}')
        send.click()
        page.wait_for_selector('#authCode')
        R.check(calls(page, 'otp') == [['otp', 'max@exemple.fr', True]], f'{t} code demandé, adresse normalisée {calls(page, "otp")}')
        code = page.locator('#authCode')
        R.check(code.get_attribute('inputmode') == 'numeric' and code.get_attribute('autocomplete') == 'one-time-code', f'{t} champ code (clavier numérique, remplissage auto)')
        resend = page.locator('#authResend')
        R.check(resend.is_disabled() and '(' in resend.inner_text(), f'{t} « Renvoyer » grisé avec décompte : {resend.inner_text()}')

        # Mauvais code : envoyé tout seul au 6e chiffre, message clair, champ vidé
        code.type('00000')
        page.wait_for_timeout(150)
        R.check(len(calls(page, 'verify')) == 0, f'{t} rien d\'envoyé avant le 6e chiffre')
        code.type('0')
        page.wait_for_timeout(400)
        R.check(len(calls(page, 'verify')) == 1, f'{t} envoi automatique au 6e chiffre')
        err = page.locator('#authError').inner_text()
        R.check('Code incorrect' in err and err.endswith('.'), f'{t} code faux : {err}')
        R.check(code.input_value() == '000000' and code.get_attribute('aria-invalid') == 'true', f'{t} chiffres gardés et signalés')
        sel = page.evaluate("[document.activeElement.id, authCode.selectionStart, authCode.selectionEnd]")
        R.check(sel == ['authCode', 0, 6], f'{t} code faux sélectionné {sel}')
        R.check(code.get_attribute('placeholder') == '······', f'{t} placeholder en points')
        R.check(ls(page, 'mdlf_pending_code') and 'max@exemple.fr' in ls(page, 'mdlf_pending_code'), f'{t} adresse et heure d\'envoi gardées')
        shot(page, LOT, f'3-code-{t}')
        # Retaper par-dessus la sélection remplace le code
        code.type('11')
        R.check(code.input_value() == '11', f'{t} saisie après erreur : remplace le code ({code.input_value()})')

        # Code expiré (envoyé il y a 11 min)
        page.evaluate('flow.sentAt -= 11 * 60_000')
        page.fill('#authCode', '654321')
        page.wait_for_timeout(400)
        R.check('expiré' in page.locator('#authError').inner_text(), f'{t} code expiré : {page.locator("#authError").inner_text()}')

        # Renvoi : actif après 60 s, nouveau code demandé, message effacé
        page.wait_for_timeout(1100)
        R.check(resend.is_enabled() and resend.inner_text().strip() == 'Renvoyer le code', f'{t} « Renvoyer » actif après 60 s')
        resend.click()
        page.wait_for_timeout(400)
        R.check(len(calls(page, 'otp')) == 2 and resend.is_disabled(), f'{t} code renvoyé, bouton de nouveau grisé')
        R.check(page.locator('#authError').inner_text() == '', f'{t} message effacé')
        R.check('Seul le dernier code reçu est valable.' in page.inner_text('.auth__lead'), f'{t} code renvoyé : « Seul le dernier code » à l\'écran')
        page.fill('#authCode', '999999')
        page.wait_for_timeout(400)
        R.check('Seul le dernier code reçu est valable.' in page.locator('#authError').inner_text(), f'{t} code renvoyé : rappel dans l\'erreur')
        shot(page, LOT, f'3b-code-renvoye-{t}')

        # iOS ferme l'app pendant la lecture du mail : réouverture sur l'écran du code
        page.reload()
        page.wait_for_selector('#authCode')
        page.wait_for_timeout(200)
        R.check('max@exemple.fr' in page.inner_text('.auth') and page.locator('[data-action="auth-back"]').count() == 1, f'{t} app rouverte sur l\'écran du code, Bienvenue dessous')
        R.check(ls(page, 'ppl_welcome_seen') is None, f'{t} pas encore de choix : drapeau absent')

        # Changer d'adresse : retour au champ, adresse gardée
        page.click('[data-action="auth-change-email"]')
        page.wait_for_selector('#authEmail')
        R.check(page.input_value('#authEmail') == 'max@exemple.fr', f'{t} changer d\'adresse : champ prérempli')
        page.click('[data-role="send"]')
        page.wait_for_selector('#authCode')

        # Bon code collé avec une espace : compte tout neuf → pseudo
        page.fill('#authCode', '123 456')
        page.wait_for_selector('#authUsername')
        page.wait_for_timeout(300)
        R.check(page.locator('[data-action="auth-later"]').count() == 1 and page.locator('[data-action="auth-close"]').count() == 0, f'{t} pseudo : « Plus tard », pas d\'Annuler')
        notice = page.locator('.auth__notice')
        R.check(notice.count() == 1 and NEW_ACCOUNT_NOTICE in notice.inner_text(), f'{t} iPhone vide + compte neuf : « Nouveau compte créé »')
        R.check(page.locator('[data-action="auth-cancel-account"]').count() == 1, f'{t} « Annuler ce compte et me reconnecter autrement »')
        R.check(page.evaluate('account.user?.email') == 'max@exemple.fr', f'{t} connecté')
        R.check(ls(page, 'ppl_welcome_seen') == '1' and ls(page, 'mdlf_pending_code') is None, f'{t} connexion : drapeau posé, code oublié')
        R.check(page.locator('[data-role="save"]').is_disabled(), f'{t} « Continuer » grisé sans pseudo')
        bg = page.evaluate("getComputedStyle(document.querySelector('[data-role=save]')).opacity")
        R.check(bg == '1', f'{t} bouton désactivé opaque (lisible) {bg}')
        shot(page, LOT, f'4-pseudo-{t}')
        page.fill('#authUsername', 'Pris')
        page.wait_for_timeout(700)
        st = page.locator('#authUsernameStatus').inner_text()
        R.check('C\'est ton pseudo ?' in st and 'même moyen' in st, f'{t} premier pseudo pris : sans doute déjà un compte ({st})')
        R.check(page.locator('[data-role="save"]').is_disabled(), f'{t} pseudo pris : « Continuer » grisé')
        shot(page, LOT, f'4b-pseudo-pris-{t}')
        page.fill('#authUsername', 'a!')
        page.wait_for_timeout(500)
        R.check('caractères' in page.locator('#authUsernameStatus').inner_text(), f'{t} pseudo trop court')
        page.fill('#authUsername', 'Hélène Dupont')
        page.wait_for_timeout(700)
        st = page.locator('#authUsernameStatus').inner_text()
        R.check('Disponible' in st and '@helene_dupont' in st, f'{t} pseudo normalisé annoncé : {st}')
        R.check(page.locator('[data-role="save"]').is_enabled(), f'{t} pseudo valable : « Continuer » actif')

        # Avatar : grille d'emojis, choix coché, retour au pseudo
        page.click('[data-action="auth-open-avatar"]')
        page.wait_for_selector('.avatar-grid')
        R.check(page.locator('.avatar-pick').count() == 30, f'{t} 30 emojis')
        R.check(page.locator('.avatar-pick[aria-pressed="true"]').get_attribute('aria-label') == 'Flamme', f'{t} emoji par défaut coché')
        R.check(small_targets(page, '.avatar-pick') == 0, f'{t} emojis : 44 pt au moins')
        page.click('.avatar-pick[aria-label="Renard"]')
        R.check(page.locator('.avatar-pick[aria-pressed="true"]').get_attribute('aria-label') == 'Renard', f'{t} Renard coché')
        R.check(no_hscroll(page), f'{t} grille sans défilement horizontal')
        cols = page.evaluate("getComputedStyle(document.querySelector('.avatar-grid')).gridTemplateColumns.split(' ').length")
        R.check(cols == 5, f'{t} grille de 5 colonnes ({cols})')
        R.check(page.locator('.auth__bar [data-action="auth-avatar-done"]').count() == 1 and page.locator('.auth__page [data-action="auth-avatar-done"]').count() == 0, f'{t} « OK » dans la barre du haut')
        R.check(in_view(page, '[data-action="auth-avatar-done"]'), f'{t} « OK » visible')
        shot(page, LOT, f'5-avatar-{t}')
        page.click('[data-action="auth-avatar-done"]')
        page.wait_for_selector('#authUsername')
        R.check('🦊' in page.locator('.auth__avatar').inner_text(), f'{t} avatar repris sur l\'écran du pseudo')
        R.check(page.input_value('#authUsername') == 'Hélène Dupont', f'{t} saisie gardée')
        page.click('[data-role="save"]')
        page.wait_for_timeout(500)
        R.check(page.locator('.auth').count() == 0, f'{t} pseudo enregistré : calque fermé')
        prof = page.evaluate('Object.values(__sb.profiles)[0]')
        R.check(prof and prof['username'] == 'helene_dupont' and prof['avatar_emoji'] == '🦊', f'{t} profil envoyé {prof}')
        R.check(ls(page, 'ppl_v2') and 'helene' not in ls(page, 'ppl_v2'), f'{t} pseudo absent des données synchronisées (ppl_v2)')
        R.check(page.evaluate("document.getElementById('app').inert") is False, f'{t} app de nouveau utilisable')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_restore(bench, eng, dev, theme):
    """Données restaurées (copie des Documents) ou utilisateur existant : jamais l'écran Bienvenue."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, opts={'backup': ppl_v2_today_json()})
        page.wait_for_timeout(800)
        R.check(page.evaluate('(data.history || []).length') > 10, f'{t} copie restaurée')
        R.check(not welcome_open(page), f'{t} pas de Bienvenue après restauration')
        R.check(ls(page, 'ppl_welcome_seen') is None, f'{t} drapeau non posé')
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        R.check(not welcome_open(page), f'{t} utilisateur existant : pas de Bienvenue')
        card = page.locator('.account-card')
        R.check(card.count() == 1 and 'Sauvegarde tes séances' in card.inner_text() and 'Créer un compte' in card.inner_text(), f'{t} carte de l\'accueil')
        R.check(small_targets(page, '.account-card button') == 0, f'{t} carte : cibles de 44 pt')
        h = page.evaluate("document.querySelector('.account-card').getBoundingClientRect().height")
        # Une ligne (≈ 64 px) ; sur iPhone SE l'action passe sous le titre
        R.check(h <= (110 if page.viewport_size['width'] < 375 else 72), f'{t} carte compacte ({h:.0f} px)')
        R.check(page.evaluate("document.querySelector('.hero__btn').getBoundingClientRect().bottom < document.querySelector('.account-card').getBoundingClientRect().top"), f'{t} carte sous « Démarrer »')
        R.check(in_view(page, '.hero__btn'), f'{t} « Démarrer » visible')
        shot(page, LOT, f'6-carte-accueil-{t}')
        page.click('[data-action="account-card-close"]')
        page.wait_for_timeout(300)
        R.check(page.locator('.account-card').count() == 0, f'{t} carte fermée')
        page.reload()
        page.wait_for_selector('#app > *')
        page.wait_for_timeout(500)
        R.check(page.locator('.account-card').count() == 0 and not welcome_open(page), f'{t} carte fermée pour de bon')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def method_value(page, provider):
    return page.locator(f'.method-cell--{provider} .cell__value').inner_text().strip()


def t_compte(bench, eng, dev, theme):
    """Écran Compte : connexion Apple, pseudo, avatar, moyens de connexion (ajout, retrait), déconnexion."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), opts={'oldAccounts': True})
        page.click('[data-action="go-settings"]')
        page.wait_for_selector('.settings-view')
        cell = page.locator('.account-cell')
        R.check(cell.count() == 1 and 'Se connecter' in cell.inner_text(), f'{t} Réglages : cellule « Se connecter » en tête')
        R.check(page.evaluate("document.querySelector('.scr').firstElementChild.classList.contains('account-head')"), f'{t} cellule tout en haut')
        cell.click()
        page.wait_for_selector('.account-view')
        R.check(page.locator('.account-view .auth-btn').count() == 3, f'{t} Compte (déconnecté) : trois moyens')
        R.check(not one_line(page, '.account-view .auth-btn span'), f'{t} Compte : boutons sur une ligne {one_line(page, ".account-view .auth-btn span")}')
        R.check('tu peux masquer ton e' in page.inner_text('.account-foot') and page.evaluate("getComputedStyle(document.querySelector('.account-foot')).textAlign") == 'center', f'{t} mention centrée')
        shot(page, LOT, f'7-compte-deconnecte-{t}')

        # Apple (compte existant : pas de pseudo demandé)
        page.click('.account-view .auth-btn--apple')
        page.wait_for_timeout(600)
        R.check(page.locator('.auth').count() == 0, f'{t} compte existant : pas d\'écran pseudo')
        R.check(page.locator('.account-hero__name').inner_text() == 'Mon compte', f'{t} sans pseudo : « Mon compte »')
        R.check('Apple' in page.locator('.account-hero__sub').inner_text(), f'{t} « Connecté avec Apple »')
        R.check(method_value(page, 'apple') == 'Relié' and method_value(page, 'google') == 'Ajouter' and method_value(page, 'email') == 'Ajouter', f'{t} moyens : Apple relié')

        # Apple seul : impossible à retirer
        page.click('.method-cell--apple')
        page.wait_for_timeout(300)
        R.check('seul moyen de connexion' in page.inner_text('.ios-dialog'), f'{t} dernier moyen : retrait refusé')
        tap_dialog(page, 'OK')
        R.check(calls(page, 'unlink') == [], f'{t} aucun retrait envoyé')

        # Google : ajout, puis déjà relié à un autre compte, puis retrait
        page.click('.method-cell--google')
        page.wait_for_timeout(500)
        R.check(method_value(page, 'google') == 'Relié', f'{t} Google ajouté')
        R.check(calls(page, 'link') == [['link', 'google']], f'{t} linkIdentity Google')
        page.click('.method-cell--google')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Retirer Google')
        page.wait_for_timeout(400)
        R.check(method_value(page, 'google') == 'Ajouter', f'{t} Google retiré')
        page.evaluate('__sb.fail.link = true')
        page.click('.method-cell--google')
        page.wait_for_timeout(500)
        R.check('Ce compte Google a déjà son propre compte MDLF. Connecte-toi avec Google' in page.inner_text('.ios-dialog'), f'{t} identity_already_exists → marche à suivre')
        shot(page, LOT, f'9b-deja-relie-{t}')
        tap_dialog(page, 'OK')
        page.evaluate('__sb.fail.link = false')

        # E-mail : ajout par code
        page.click('.method-cell--email')
        page.wait_for_selector('#authEmail')
        R.check('Ajouter une adresse e\u2011mail' in page.inner_text('.auth'), f'{t} ajout d\'e-mail : titre')
        page.fill('#authEmail', 'max@exemple.fr')
        page.click('[data-role="send"]')
        page.wait_for_selector('#authCode')
        R.check(calls(page, 'updateUser') == [['updateUser', 'max@exemple.fr']], f'{t} code de confirmation demandé')
        page.fill('#authCode', '123456')
        page.wait_for_timeout(600)
        R.check(calls(page, 'verify')[-1][3] == 'email_change', f'{t} vérification email_change')
        R.check(method_value(page, 'email') == 'Relié' and 'max@exemple.fr' in page.inner_text('.method-cell--email'), f'{t} e-mail relié avec son adresse')

        # Pseudo et avatar depuis l'écran Compte
        page.click('[data-action="account-edit-username"]')
        page.wait_for_selector('#authUsername')
        R.check(page.locator('[data-action="auth-close"]').count() == 1 and page.locator('[data-action="auth-later"]').count() == 0, f'{t} pseudo (modification) : Annuler, pas « Plus tard »')
        page.fill('#authUsername', 'max.dlf')
        page.wait_for_timeout(500)
        page.click('[data-role="save"]')
        page.wait_for_timeout(500)
        R.check(page.locator('.account-hero__name').inner_text() == 'max.dlf', f'{t} pseudo affiché')
        R.check(page.locator('.account-hero button').count() == 0, f'{t} en-tête sans lien « Modifier »')
        page.click('[data-action="account-edit-avatar"]')
        page.wait_for_selector('.avatar-grid')
        page.click('.avatar-pick[aria-label="Pieuvre"]')
        page.click('[data-action="auth-avatar-done"]')
        page.wait_for_timeout(500)
        R.check('🐙' in page.locator('.account-hero .avatar').inner_text(), f'{t} avatar affiché')
        R.check('Avatar' not in (page.locator('.toast').inner_text() if page.locator('.toast').count() else ''), f'{t} pas de toast « Avatar enregistré »')
        R.check(page.locator('.method-cell--google .icon').count() == 0 and method_value(page, 'google') == 'Ajouter', f'{t} « Ajouter » sans chevron')
        R.check('Il en faut au moins un.' in page.inner_text('.account-view'), f'{t} « Il en faut au moins un »')
        R.check(small_targets(page, '.account-view .cell') == 0, f'{t} cellules de 44 pt')
        R.check(no_hscroll(page), f'{t} pas de défilement horizontal')
        shot(page, LOT, f'8-compte-{t}')
        page.evaluate("document.querySelector('.method-cell').scrollIntoView({ block: 'center' })")
        shot(page, LOT, f'9-compte-moyens-{t}')

        # Réglages : cellule façon identifiant Apple
        page.click('[data-action="back"]')
        page.wait_for_selector('.settings-view')
        txt = page.locator('.account-cell').inner_text()
        R.check('max.dlf' in txt and '🐙' in txt and 'Compte et sauvegarde' in txt, f'{t} Réglages : avatar et pseudo {txt!r}')
        gap = page.evaluate("""() => { const b = document.querySelector('.navbar__back'), l = document.querySelector('.navbar__back-label'), ti = document.querySelector('.navbar__title');
            const right = l && l.offsetParent ? l.getBoundingClientRect().right : b.querySelector('.icon').getBoundingClientRect().right;
            const r = ti.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(ti); const tr = range.getBoundingClientRect();
            return { gap: tr.left - right, cut: !!(l && l.offsetParent && l.scrollWidth > l.clientWidth + 1) }; }""")
        R.check(gap['gap'] >= 8 and not gap['cut'], f'{t} Réglages : retour séparé du titre {gap}')
        shot(page, LOT, f'10-reglages-{t}')

        # Déconnexion
        page.click('.account-cell')
        page.wait_for_selector('.account-view')
        # Une séance pas encore partie : dite dans la feuille, avec le moyen pour revenir
        page.evaluate("data.history.unshift({ ...data.history[0], id: 'pas-encore-partie', date: Date.now() }); clearTimeout(syncTimer)")
        page.click('[data-action="account-sign-out"]')
        page.wait_for_timeout(300)
        txt = page.inner_text('.ios-dialog')
        R.check('1 séance pas encore sauvegardée' in txt and 'partira quand tu te reconnecteras' in txt and 'utilise Apple' in txt, f'{t} déconnexion : séance en attente et moyen rappelés {txt!r}')
        shot(page, LOT, f'11-deconnexion-{t}')
        tap_dialog(page, 'Se déconnecter')
        page.wait_for_timeout(400)
        R.check(page.locator('.account-view .auth-btn').count() == 3, f'{t} déconnecté : boutons de connexion')
        R.check(ls(page, 'mdlf_signed_out') == '1', f'{t} déconnexion voulue retenue')
        page.click('[data-action="back"]')
        page.click('[data-action="back"]')
        page.wait_for_timeout(400)
        R.check(page.locator('.account-card').count() == 0, f'{t} déconnexion voulue : pas de carte de reconnexion')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_delete(bench, eng, dev, theme):
    """Compte e-mail : suppression après un nouveau code (connexion récente exigée)."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        page.evaluate("navigate('account')")
        page.wait_for_selector('.account-view')
        page.click('.account-view [data-action="auth-email"]')
        page.fill('#authEmail', 'max@exemple.fr')
        page.click('[data-role="send"]')
        page.wait_for_selector('#authCode')
        page.fill('#authCode', '123456')
        page.wait_for_timeout(500)
        R.check(page.locator('.auth__notice').count() == 1, f'{t} séances sur l\'iPhone : avertissement « Nouveau compte » aussi')
        if page.locator('[data-action="auth-later"]').count():
            page.click('[data-action="auth-later"]')
            page.wait_for_timeout(300)
        # Session vieillie : la suppression doit redemander un code
        age_session(page)
        page.click('[data-action="account-delete"]')
        page.wait_for_timeout(300)
        R.check('confirmeras ton identité' in page.inner_text('.ios-dialog'), f'{t} suppression : confirmation d\'identité annoncée')
        R.check('Tes autres appareils seront déconnectés et garderont leurs séances.' in page.inner_text('.ios-dialog'), f'{t} suppression : autres appareils')
        tap_dialog(page, 'Supprimer mon compte')
        page.wait_for_selector('#authCode')
        R.check(calls(page, 'otp')[-1] == ['otp', 'max@exemple.fr', False], f'{t} nouveau code, sans création de compte {calls(page, "otp")[-1]}')
        R.check(page.locator('[data-action="auth-change-email"]').count() == 0, f'{t} pas de « Changer d\'adresse »')
        page.fill('#authCode', '123456')
        page.wait_for_timeout(700)
        R.check(len(calls(page, 'invoke')) == 1, f'{t} fonction delete-account appelée une fois')
        R.check('Compte supprimé' in page.inner_text('.ios-dialog'), f'{t} compte supprimé')
        tap_dialog(page, 'Les garder sur cet iPhone')
        page.wait_for_timeout(300)
        R.check(page.evaluate('account.user') is None and page.evaluate('(data.history || []).length') > 10, f'{t} déconnecté, séances gardées')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_securite_compte(bench, eng, dev, theme):
    """Compte Google : ligne E-mail « Actif » sans ajout, reconnexion avant d'ajouter un moyen, suppression
    refusée 24 h après une liaison, retrait d'Apple révoqué ; compte Apple : suppression avec un code frais."""
    t = tag(dev, theme)
    # Compte Google ancien (créé il y a 30 jours : une liaison d'aujourd'hui n'est pas « avec le compte »)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, opts={'oldAccounts': True})
        page.click('.auth .auth-btn--google')
        page.wait_for_timeout(600)
        R.check(page.locator('.auth').count() == 0 and page.evaluate('!!account.user'), f'{t} Google : compte existant, connecté')
        page.evaluate("navigate('account')")
        page.wait_for_selector('.account-view')

        # E-mail : l'adresse Google reçoit déjà les codes, rien à « ajouter »
        R.check(method_value(page, 'email') == 'Actif' and 'max@gmail.com' in page.inner_text('.method-cell--email'), f'{t} Google : e-mail « Actif » avec l\'adresse')
        page.click('.method-cell--email')
        page.wait_for_timeout(300)
        R.check('max@gmail.com' in page.inner_text('.ios-dialog') and page.locator('.auth').count() == 0, f'{t} e-mail : explication, pas d\'écran d\'ajout')
        tap_dialog(page, 'OK')
        R.check(calls(page, 'updateUser') == [], f'{t} aucun changement d\'e-mail demandé')

        # Session ancienne : nouvelle connexion avant d'ajouter Apple
        age_session(page)
        page.click('.method-cell--apple')
        page.wait_for_timeout(300)
        R.check('ajouter un moyen de connexion' in page.inner_text('.ios-dialog'), f'{t} ajout : reconnexion demandée')
        shot(page, LOT, f'12-reconnexion-ajout-{t}')
        tap_dialog(page, 'Avec Google')
        page.wait_for_timeout(600)
        R.check(calls(page, 'link') == [['link', 'apple']] and method_value(page, 'apple') == 'Relié', f'{t} Apple relié après la reconnexion')

        # Suppression refusée : moyen relié il y a moins de 24 h (rien n'est demandé à Apple ni au serveur)
        n_apple = len(calls(page, 'apple'))
        page.click('[data-action="account-delete"]')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Supprimer mon compte')
        page.wait_for_timeout(400)
        R.check('Suppression possible plus tard' in page.inner_text('.ios-dialog') and 'moins de 24 heures' in page.inner_text('.ios-dialog'), f'{t} suppression : attente de 24 h expliquée')
        shot(page, LOT, f'13-suppression-24h-{t}')
        tap_dialog(page, 'OK')
        R.check(calls(page, 'invoke') == [] and len(calls(page, 'apple')) == n_apple, f'{t} ni connexion Apple ni appel serveur')
        # Le serveur refuse aussi (appel direct, sans passer par l'écran)
        st = page.evaluate("sb.functions.invoke('delete-account', { body: {} }).then(r => r.error?.context?.status)")
        R.check(st == 403 and page.evaluate('!!account.user'), f'{t} serveur : 403, compte intact')

        # Retrait d'Apple : connexion Apple (code frais), retrait, puis révocation
        page.click('.method-cell--apple')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Retirer Apple')
        page.wait_for_timeout(700)
        inv = calls(page, 'invoke')
        R.check(method_value(page, 'apple') == 'Ajouter' and inv and inv[-1][1] == 'revoke-apple' and 'code-apple-' in inv[-1][2], f'{t} Apple retiré puis révoqué avec un code frais {inv}')
        R.check(page.locator('.ios-dialog').count() == 0, f'{t} révoqué : pas de marche à suivre à la main')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Compte Apple ancien : la suppression passe par une connexion Apple et son code tout frais
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), opts={'oldAccounts': True})
        page.evaluate("navigate('account')")
        page.wait_for_selector('.account-view')
        page.click('.account-view .auth-btn--apple')
        page.wait_for_timeout(600)
        age_session(page, 30 * 86400)
        st = page.evaluate("sb.functions.invoke('delete-account', { body: {} }).then(r => r.error?.context?.status)")
        R.check(st == 401 and page.evaluate('!!account.user'), f'{t} compte Apple sans code : refusé (401)')
        page.click('[data-action="account-delete"]')
        page.wait_for_timeout(300)
        R.check('Apple te demandera' in page.inner_text('.ios-dialog'), f'{t} Apple : confirmation annoncée')
        tap_dialog(page, 'Supprimer mon compte')
        page.wait_for_timeout(700)
        inv = calls(page, 'invoke')
        R.check(inv[-1][1] == 'delete-account' and 'code-apple-' in inv[-1][2], f'{t} code Apple frais envoyé {inv[-1]}')
        R.check('Compte supprimé' in page.inner_text('.ios-dialog'), f'{t} compte Apple supprimé')
        tap_dialog(page, 'Les garder sur cet iPhone')
        page.wait_for_timeout(300)
        R.check(page.evaluate('account.user') is None, f'{t} déconnecté')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_reconnect(bench, eng, dev, theme):
    """iPhone restauré : stockage revenu, session du Trousseau perdue → carte qui nomme le moyen d'avant."""
    t = tag(dev, theme)
    cache = json.dumps({'userId': OWNER_1, 'method': 'apple', 'username': 'max.dlf', 'avatar': '🦊', 'changedAt': None, 'stored': True})
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), extra={'mdlf_sync_owner': OWNER_1, 'mdlf_profile': cache, 'ppl_welcome_seen': '1'}, opts={'oldAccounts': True})
        page.wait_for_timeout(300)
        card = page.locator('.account-card')
        txt = card.inner_text() if card.count() else ''
        R.check('Reconnecte-toi pour reprendre la sauvegarde' in txt and 'Tu étais connecté avec Apple · max.dlf' in txt, f'{t} carte de reconnexion {txt!r}')
        R.check(small_targets(page, '.account-card button') == 0, f'{t} reconnexion : cibles de 44 pt')
        R.check(in_view(page, '.hero__btn'), f'{t} reconnexion : « Démarrer » visible')
        shot(page, LOT, f'6b-carte-reconnexion-{t}')
        page.click('[data-action="go-settings"]')
        page.wait_for_selector('.settings-view')
        R.check('Reconnecte-toi' in page.inner_text('.account-cell'), f'{t} Réglages : cellule « Reconnecte-toi »')
        page.click('.account-cell')
        page.wait_for_selector('.account-view')
        R.check('Tu étais connecté avec Apple · max.dlf' in page.inner_text('.account-hero'), f'{t} Compte : moyen d\'avant rappelé')
        shot(page, LOT, f'7b-compte-reconnexion-{t}')
        page.click('[data-action="back"]')
        page.click('[data-action="back"]')
        page.wait_for_selector('.account-card')
        page.click('[data-action="account-reconnect"]')
        page.wait_for_timeout(800)
        R.check(page.evaluate('account.user?.id') == OWNER_1 and calls(page, 'apple'), f'{t} « Me reconnecter avec Apple » : même compte')
        R.check(page.locator('.ios-dialog').count() == 0, f'{t} même compte : pas de feuille de fusion')
        toast = page.locator('.toast').inner_text() if page.locator('.toast').count() else ''
        R.check('séances sauvegardées' in toast, f'{t} toast : séances envoyées ({toast})')
        R.check(page.locator('.account-card').count() == 0, f'{t} connecté : carte retirée')
        shot(page, LOT, f'6c-toast-connexion-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Carte fermée : plus proposée
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), extra={'mdlf_sync_owner': OWNER_1, 'mdlf_profile': cache, 'ppl_welcome_seen': '1'})
        page.click('[data-action="account-reconnect-close"]')
        page.wait_for_timeout(300)
        page.reload()
        page.wait_for_selector('#app > *')
        page.wait_for_timeout(500)
        R.check(page.locator('.account-card').count() == 0, f'{t} carte de reconnexion fermée pour de bon')


def t_second_account(bench, eng, dev, theme):
    """Nouvel iPhone, autre moyen qu'avant : le compte vide créé par erreur est supprimé à l'annulation."""
    t = tag(dev, theme)
    # Écran du pseudo : « Annuler ce compte et me reconnecter autrement »
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        page.click('.auth .auth-btn--google')
        page.wait_for_selector('#authUsername')
        uid = page.evaluate('account.user.id')
        page.click('[data-action="auth-cancel-account"]')
        page.wait_for_timeout(700)
        inv = calls(page, 'invoke')
        R.check(inv and inv[-1][1] == 'delete-account' and page.evaluate('id => !__sb.users[id]', uid), f'{t} compte vide supprimé sur le serveur {inv}')
        R.check(page.evaluate('account.user') is None and ls(page, 'mdlf_sync_owner') is None, f'{t} déconnecté, appareil détaché')
        R.check(welcome_open(page), f'{t} retour aux moyens de connexion')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Feuille de fusion, « Annuler » : le compte qui vient d'être créé est supprimé, l'iPhone reste à l'ancien
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json(), extra={'mdlf_sync_owner': 'ancien-compte', 'ppl_welcome_seen': '1'})
        page.evaluate("navigate('account')")
        page.wait_for_selector('.account-view')
        page.click('.account-view .auth-btn--apple')
        page.wait_for_timeout(500)
        txt = page.inner_text('.ios-dialog')
        R.check('les retirer les effacerait' in txt and 'exporte' not in txt, f'{t} feuille de fusion simplifiée {txt!r}')
        shot(page, LOT, f'12b-fusion-{t}')
        tap_dialog(page, 'Annuler')
        page.wait_for_timeout(600)
        inv = calls(page, 'invoke')
        R.check(inv and inv[-1][1] == 'delete-account' and 'code-apple-' in inv[-1][2], f'{t} compte neuf supprimé (preuve Apple) {inv}')
        R.check(page.evaluate('Object.keys(__sb.users).length') == 0, f'{t} aucun compte vide laissé')
        R.check(ls(page, 'mdlf_sync_owner') == 'ancien-compte' and ls(page, 'mdlf_signed_out') is None, f'{t} iPhone toujours rattaché à l\'ancien compte')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_offline(bench, eng, dev, theme):
    """Hors ligne : « Pas d'Internet » pour Apple, synchro relancée au retour du réseau."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, opts={'oldAccounts': True})
        page.context.set_offline(True)
        page.click('.auth .auth-btn--apple')
        page.wait_for_timeout(300)
        err = page.locator('#authError').inner_text()
        R.check('Pas d\'Internet' in err and not calls(page, 'apple'), f'{t} Apple hors ligne : {err!r}')
        page.context.set_offline(False)
        page.click('.auth .auth-btn--apple')
        page.wait_for_timeout(600)
        R.check(page.evaluate('!!account.user'), f'{t} connecté une fois en ligne')
        page.wait_for_timeout(300)
        page.context.set_offline(True)
        n = len(calls(page, 'db'))
        page.context.set_offline(False)
        page.wait_for_timeout(500)
        R.check(len(calls(page, 'db')) > n, f'{t} réseau revenu : synchro relancée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_avatar_refuse(bench, eng, dev, theme):
    """Emoji pas encore dans la liste blanche du serveur : erreur propre, rien de cassé."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, opts={'oldAccounts': True, 'refuseAvatars': ['🦬']})
        page.click('.auth .auth-btn--apple')
        page.wait_for_timeout(600)
        page.evaluate("navigate('account')")
        page.wait_for_selector('.account-view')
        page.click('[data-action="account-edit-avatar"]')
        page.wait_for_selector('.avatar-grid')
        page.click('.avatar-pick[aria-label="Bison"]')
        page.click('[data-action="auth-avatar-done"]')
        page.wait_for_timeout(500)
        err = page.locator('#authError').inner_text()
        R.check('pas encore disponible' in err and page.locator('.avatar-grid').count() == 1, f'{t} avatar refusé par le serveur : {err!r}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_pwa(bench, eng, dev, theme):
    """Navigateur (PWA) : rien du compte n'apparaît."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
        seed(page, theme, None)
        page.wait_for_timeout(400)
        R.check(page.locator('.auth').count() == 0 and page.locator('.account-card').count() == 0, f'{t} PWA : ni Bienvenue ni carte')
        page.click('[data-action="go-settings"]')
        page.wait_for_selector('.settings-view')
        R.check(page.locator('.account-cell').count() == 0, f'{t} PWA : pas de cellule compte')


run_main(R, [t_welcome, t_code, t_restore, t_reconnect, t_second_account, t_offline, t_avatar_refuse, t_compte, t_delete, t_securite_compte, t_pwa])
