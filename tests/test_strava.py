"""Strava (docs/STRAVA.md, app iOS simulée) : Réglages › Connexions › Strava sans compte, relier (bouton
officiel, Safari ouvert sur la page d'autorisation, état relu au retour au premier plan), envoyer une séance
depuis Historique › Séance (type d'activité, jamais les notes), « View on Strava », double envoi, séance non
envoyable (passée sans durée), accès retiré chez Strava, déconnexion (révoquée ou non confirmée), hors ligne.

L'app iOS et Supabase sont simulés (tests/fake_account.py) : aucune requête ne sort, aucun vrai jeton.
Captures : $PPL_SCRATCH/shots/lotstrava/ (clair et sombre).
Lancer : PPL_URL=http://localhost:8848/ PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_strava.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'strava'
R = Results(LOT)
MIN = 60_000

# Mêmes outils que test_coach.py (un import relancerait ses tests)
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

def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')

def small_targets(page, sel='#app button, .tabbar button'):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)

def cut_texts(page):
    """Textes coupés ou qui débordent de leur boîte (hors champs de saisie)."""
    return page.evaluate("""() => [...document.querySelectorAll('#app *, .tabbar *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .icon *, .visually-hidden') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
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

def toast(page):
    return page.locator('.toast').inner_text() if page.locator('.toast').count() else ''

def layout(page, t, name, tabbar=True):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page)
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')
    if tabbar:
        R.check(last_above_tabbar(page), f'{t} {name} : dernier élément au-dessus de la barre d\'onglets')


OPENED = 'window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; };'


def add_sessions(page):
    """Une séance terminée dans l'app (durée), une séance passée saisie à la main (sans durée)."""
    now = int(time.time() * 1000)
    page.evaluate("""([now, MIN]) => {
        data.history.unshift(
          { id: 'strv0001', programme: 'ppl', category: 'push', date: now - 2 * 3600000, duration: 52 * MIN, notes: 'genou sensible',
            exercises: [{ exId: 'p1', name: 'Développé couché', sets: [{ weight: '80', reps: '8' }, { weight: '80', reps: '7' }] }] },
          { id: 'strv0002', programme: 'ppl', category: 'legs', date: now - 26 * 3600000,
            exercises: [{ exId: 'l1', name: 'Squat', sets: [{ weight: '100', reps: '5' }] }] });
        save();
    }""", [now, MIN])


def back_to_foreground(page):
    """Retour de Safari : l'app revient au premier plan (visibilitychange)."""
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_timeout(400)


def open_strava_settings(page):
    page.evaluate("navigate('settings')")
    page.wait_for_selector('[data-action="strava-open-settings"]')
    page.click('[data-action="strava-open-settings"]')
    page.wait_for_selector('.strava-view')
    page.wait_for_timeout(300)


def t_strava(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        page.add_init_script(OPENED)
        open_app(page, theme, ppl_v2_today_json())
        # Sans compte : il en faut un, aucun appel
        open_strava_settings(page)
        R.check(page.locator('.strava-view [data-action="social-sign-in"]').count() == 1, f'{t} sans compte : « Se connecter »')
        R.check(page.evaluate("__sb.calls.filter(c => c[0] === 'strava').length") == 0, f'{t} sans compte : aucun appel à Strava')
        shot(page, LOT, f'0-sans-compte-{t}')

        signin(page, username='lea')
        add_sessions(page)
        open_strava_settings(page)
        btn = page.locator('[data-action="strava-connect"]')
        R.check(btn.count() == 1 and page.locator('[data-action="strava-connect"] img[src="img/strava/connect-with-strava.svg"]').count() == 1,
                f'{t} pas relié : bouton officiel « Connect with Strava »')
        box = btn.bounding_box()
        R.check(box and box['height'] >= 44 and abs(box['height'] - 48) < 1, f'{t} bouton : 48 pt de haut ({box})')
        R.check('Jamais tes notes' in page.inner_text('.strava-view'), f'{t} pas relié : ce qui part et ce qui ne part jamais')
        layout(page, t, 'Strava pas relié')
        shot(page, LOT, f'1-pas-relie-{t}')

        # Relier : Safari s'ouvre sur la page d'autorisation, puis retour dans l'app
        btn.click()
        page.wait_for_timeout(400)
        opened = page.evaluate('window.__opened')
        R.check(len(opened) == 1 and opened[0].startswith('https://www.strava.com/oauth/authorize?') and 'scope=activity%3Awrite' in opened[0],
                f'{t} relier : page d\'autorisation ouverte ({opened})')
        R.check('reviens ici' in page.inner_text('.strava-view'), f'{t} relier : consigne pendant Safari')
        shot(page, LOT, f'2-dans-safari-{t}')
        page.evaluate('__sb.stravaAuthorize("Léa")')
        back_to_foreground(page)
        txt = page.inner_text('.strava-view')
        R.check('Compte Strava' in txt and 'Léa' in txt and 'Déconnecter Strava' in txt, f'{t} retour : relié, prénom affiché ({txt!r})')
        layout(page, t, 'Strava relié')
        shot(page, LOT, f'3-relie-{t}')
        # Réglages : la cellule le dit
        page.click('[data-action="back"]')
        page.wait_for_selector('[data-action="strava-open-settings"]')
        R.check('Relié' in page.inner_text('[data-action="strava-open-settings"]'), f'{t} Réglages : cellule « Relié »')

        # Séance passée sans durée : pas d'envoi proposé
        page.evaluate("navigate(makeRoute('history-detail', 'strv0002'))")
        page.wait_for_timeout(400)
        R.check(page.locator('[data-action="strava-export"]').count() == 0, f'{t} séance passée sans durée : rien à envoyer')

        # Séance terminée : envoyer, puis View on Strava
        page.evaluate("navigate(makeRoute('history-detail', 'strv0001'))")
        page.wait_for_selector('[data-action="strava-export"]')
        send = page.locator('[data-action="strava-export"]')
        R.check('Envoyer vers Strava' in send.inner_text() and send.bounding_box()['height'] >= 44, f'{t} Historique › Séance : « Envoyer vers Strava »')
        shot(page, LOT, f'4-envoyer-{t}')
        send.click()
        page.wait_for_selector('[data-action="strava-view"]')
        sent = page.evaluate('__sb.st.sent')
        R.check(len(sent) == 1 and sent[0]['sport_type'] == 'WeightTraining' and sent[0]['elapsed_time'] == 52 * 60 and sent[0]['session_id'] == 'strv0001',
                f'{t} envoi : séance de musculation, durée ({sent})')
        R.check('genou' not in str(sent) and 'Développé couché : 80 kg × 8 · 7' in sent[0]['description'], f'{t} envoi : séries, jamais les notes')
        R.check('Envoyée sur Strava' in toast(page), f'{t} envoi : toast ({toast(page)!r})')
        link = page.locator('[data-action="strava-view"]')
        R.check(link.inner_text().strip() == 'View on Strava' and link.bounding_box()['height'] >= 44, f'{t} « View on Strava » (charte), 44 pt')
        R.check(page.evaluate("getComputedStyle(document.querySelector('.strava-view-link')).fontWeight") in ('700', 'bold'), f'{t} « View on Strava » en gras')
        layout(page, t, 'séance envoyée')
        shot(page, LOT, f'5-envoyee-{t}')
        link.click()
        page.wait_for_timeout(200)
        R.check(page.evaluate('window.__opened.at(-1)') == 'https://www.strava.com/activities/16000000001', f'{t} « View on Strava » ouvre l\'activité')
        # Une seule activité même si on relance l'envoi (autre appareil, cache vidé)
        r = page.evaluate("stravaExport(data.history.find(h => h.id === 'strv0001'))")
        R.check(r.get('ok') and r.get('already') and len(page.evaluate('__sb.st.sent')) == 1, f'{t} second envoi : déjà sur Strava ({r})')

        # Accès retiré chez Strava : message clair, plus relié
        page.evaluate("data.history.unshift({ id: 'strv0003', programme: 'ppl', category: 'pull', date: Date.now() - 3600000, duration: 40 * 60000, exercises: [{ name: 'Tractions', sets: [{ weight: '', reps: '8' }] }] }); save();")
        page.evaluate("__sb.stravaRevokeAtStrava()")
        page.evaluate("navigate(makeRoute('history-detail', 'strv0003'))")
        page.wait_for_selector('[data-action="strava-export"]')
        page.click('[data-action="strava-export"]')
        page.wait_for_timeout(500)
        R.check('plus relié' in toast(page) and page.locator('[data-action="strava-export"]').count() == 0, f'{t} accès retiré chez Strava : « plus relié » ({toast(page)!r})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')

    # Déconnexion (révoquée, puis non confirmée), hors ligne
    with bench.page(eng, dev, theme) as page:
        page.add_init_script(OPENED)
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='lea')
        page.evaluate('__sb.stravaAuthorize("Léa")')
        page.evaluate('stravaRefresh()')
        open_strava_settings(page)
        page.click('[data-action="strava-disconnect"]')
        page.wait_for_selector('.ios-dialog__btn')
        shot(page, LOT, f'6-deconnecter-{t}')
        tap_dialog(page, 'Déconnecter')
        page.wait_for_timeout(400)
        R.check(page.locator('[data-action="strava-connect"]').count() == 1 and 'Strava déconnecté' in toast(page), f'{t} déconnecté : bouton de liaison revenu, toast')
        R.check(ls(page, 'mdlf_strava') and '"connected":false' in ls(page, 'mdlf_strava'), f'{t} déconnecté : cache à jour')
        # Strava ne confirme pas : l'app propose de retirer l'accès chez Strava
        page.evaluate('__sb.stravaAuthorize("Léa"); __sb.st.revokeFails = true')
        page.evaluate('stravaRefresh()')
        page.wait_for_selector('[data-action="strava-disconnect"]')
        page.click('[data-action="strava-disconnect"]')
        tap_dialog(page, 'Déconnecter')
        page.wait_for_timeout(300)
        R.check('applications autorisées' in page.inner_text('body'), f'{t} révocation non confirmée : explication')
        tap_dialog(page, 'Ouvrir Strava')
        R.check(page.evaluate('window.__opened.at(-1)') == 'https://www.strava.com/settings/apps', f'{t} révocation non confirmée : strava.com/settings/apps')
        # Hors ligne : écran et relecture
        # Dernier état gardé sur l'appareil : affiché, « pas à jour »
        page.evaluate('__sb.fail.strava = "offline"; stravaReset(account.user.id); stravaRefresh()')
        page.wait_for_timeout(300)
        page.evaluate('render()')
        R.check('pas à jour' in page.inner_text('.strava-view') and page.locator('[data-action="strava-connect"]').count() == 1, f'{t} hors ligne avec cache : dernier état, « pas à jour »')
        # Rien de gardé : message et « Réessayer »
        page.evaluate('localStorage.removeItem("mdlf_strava"); stravaReset(account.user.id); stravaRefresh()')
        page.wait_for_timeout(300)
        page.evaluate('render()')
        txt = page.inner_text('.strava-view')
        R.check('Pas d\'Internet' in txt and page.locator('[data-action="strava-retry"]').count() == 1, f'{t} hors ligne : message et « Réessayer » ({txt!r})')
        shot(page, LOT, f'7-hors-ligne-{t}')
        page.evaluate('__sb.fail.strava = null')
        page.click('[data-action="strava-retry"]')
        page.wait_for_selector('[data-action="strava-connect"]')
        R.check(True, f'{t} réseau revenu')
        # Déconnexion du compte : cache Strava vidé
        page.evaluate('accountSignOut()')
        page.wait_for_timeout(400)
        R.check(ls(page, 'mdlf_strava') is None, f'{t} déconnexion du compte : cache Strava vidé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_bilan(bench, eng, dev, theme):
    """Bilan d'une séance qui vient de finir : « Envoyer vers Strava », la note en cours de saisie reste."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        page.add_init_script(OPENED)
        page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
        page.add_init_script(FAKE_ACCOUNT)
        page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
        seed(page, theme, ppl_v2_today_json(), active=old_active_session(), extra={'ppl_welcome_seen': '1'})
        page.wait_for_timeout(300)
        signin(page, username='lea')
        page.evaluate('__sb.stravaAuthorize("Léa")')
        page.evaluate('stravaRefresh()')
        page.wait_for_timeout(200)
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(250)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary [data-action="strava-export"]')
        page.fill('#summaryNotes', 'note du bilan')
        page.click('[data-action="strava-export"]')
        page.wait_for_selector('.view.summary [data-action="strava-view"]')
        sent = page.evaluate('__sb.st.sent')
        R.check(len(sent) == 1 and 'note du bilan' not in str(sent), f'{t} bilan : séance envoyée sans la note ({sent})')
        R.check(page.input_value('#summaryNotes') == 'note du bilan', f'{t} bilan : note gardée après l\'envoi')
        shot(page, LOT, f'8-bilan-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_strava, t_bilan])
