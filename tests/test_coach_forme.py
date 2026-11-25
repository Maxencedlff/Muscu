"""Accord du mot « coach » (docs/COACH_FORME.md, app iOS simulée, faux serveur de tests/fake_account.py) :
- coach validé : Réglages › Coach › « Tes élèves lisent », un seul choix (« Mon coach », « Ma coach », « Ne pas
  préciser ») envoyé au serveur ; le titre de son affiche suit (« Nouvelle coach ») ;
- élève d'une coach « elle » : « Ma coach » dans Social, en titre de Mon coach, « Ta coach depuis le… », « Écris à
  ta coach » ; aucun « ton coach » ni « Mon coach » visible ;
- serveur d'avant (migration pas appliquée) : « Mon coach » comme avant, aucun message ni erreur.
Horloge figée au dimanche 22 novembre 2026. Captures : $PPL_SCRATCH/shots/lotforme/.
Lancer : PPL_URL=http://127.0.0.1:8779/ PPL_DEV="iPhone 13" python3 tests/test_coach_forme.py
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'forme'
R = Results(LOT)
NOW = local_ms(2026, 11, 22, 10, tz=PARIS)
# Accord masculin écrit en dur, interdit à l'écran d'un élève d'une coach (le balayage unitaire le vérifie dans le code)
MASC = re.compile(r"\b(ton|mon|du|au|ce|un) coach\b", re.I)


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(now_ms=NOW), extra={'ppl_welcome_seen': '1'})
    settle(page)


def signin(page, username):
    page.evaluate("""async u => { await accountSignInWith('apple', async () => 'add');
        await accountSaveProfile({ username: u, avatar: '🦁' }); await socialEnable(true); }""", username)


def visible_text(page):
    return page.evaluate("() => document.querySelector('#app').innerText")


def t_coach_choisit(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'camille_coach')
        page.evaluate("async () => { __sb.makeCoach(__sb.meId()); await coachRefresh(); await coachProRefresh(); }")
        page.evaluate("routeTo('settings'); navigate('coach')")
        page.wait_for_selector('[data-action="coach-form-set"]', timeout=8000)
        settle(page)
        picks = page.locator('[data-action="coach-form-set"]')
        R.check(picks.count() == 3 and page.locator('[data-action="coach-form-set"][aria-checked="true"]').count() == 0,
                f'{t} Réglages › Coach : trois choix, aucun coché au départ')
        R.check('Tes élèves lisent' in visible_text(page), f'{t} titre « Tes élèves lisent »')
        page.locator('[data-action="coach-form-set"][data-v="elle"]').scroll_into_view_if_needed()
        page.click('[data-action="coach-form-set"][data-v="elle"]')
        page.wait_for_function("() => __sb.co.forms && __sb.co.forms[__sb.meId()] === 'elle'", timeout=8000)
        settle(page)
        R.check(page.get_attribute('[data-action="coach-form-set"][data-v="elle"]', 'aria-checked') == 'true',
                f'{t} « Ma coach » coché, envoyé au serveur')
        R.check(page.evaluate("myOwnCoachForm()") == 'elle' and page.evaluate("coachFormStore().pending") is False,
                f'{t} forme gardée sur l\'appareil, plus en attente')
        shot(page, LOT, f'01-reglages-forme-{t}')
        # Affiche : le titre suit la forme (silhouette homme laissée : c'est la forme qui accorde)
        m = page.evaluate("""() => coachPosterModel({ name: 'Camille', code: 'K7M2QX9PR4TD', silhouette: 'male', form: myOwnCoachForm() }).title""")
        R.check(m == 'NOUVELLE COACH', f'{t} affiche : « NOUVELLE COACH » ({m})')
        # Hors ligne : le choix reste, en attente, puis part à l'état lu suivant
        page.evaluate("__sb.fail.form = 'offline'")
        page.click('[data-action="coach-form-set"][data-v="neutre"]')
        page.wait_for_function("() => coachFormStore().pending === true", timeout=8000)
        R.check(page.evaluate("__sb.co.forms[__sb.meId()]") == 'elle', f'{t} hors ligne : rien parti')
        page.evaluate("async () => { __sb.fail.form = null; await coachRefresh(); }")
        page.wait_for_function("() => __sb.co.forms[__sb.meId()] === 'neutre' && coachFormStore().pending === false", timeout=8000)
        R.check(True, f'{t} retour du réseau : choix « Ne pas préciser » envoyé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_eleve_ma_coach(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'lea')
        page.evaluate("""async () => { const c = __sb.addPerson({ username: 'camille_coach', avatar: '🦊', social: false }); __sb.makeCoach(c);
            __sb.setForm(c, 'elle'); __sb.link(c, __sb.meId(), Date.now() - 3 * 86400000); await coachRefresh(); }""")
        page.wait_for_function("() => myCoachForm() === 'elle'", timeout=8000)
        page.evaluate("routeTo('friends')")
        page.wait_for_selector('[data-action="coach-open-mine"]', timeout=8000)
        settle(page)
        R.check(page.inner_text('[data-action="coach-open-mine"] .cell__title') == 'Ma coach', f'{t} Social : « Ma coach »')
        shot(page, LOT, f'02-social-ma-coach-{t}')
        page.click('[data-action="coach-open-mine"]')
        page.wait_for_selector('.coach-mine-view', timeout=8000)
        settle(page)
        txt = visible_text(page)
        R.check('Ta coach depuis le' in txt, f'{t} Mon coach : « Ta coach depuis le… »')
        title = page.evaluate("coachRouteTitle('coach-mine')")
        R.check(title == 'Ma coach', f'{t} titre de l\'écran : « Ma coach » ({title})')
        R.check(not MASC.search(txt), f'{t} Mon coach : aucun accord au masculin ({MASC.findall(txt)})')
        R.check('Quitter ma coach' in txt or page.locator('[data-action="coach-leave"]').count() == 0, f'{t} « Quitter ma coach »')
        shot(page, LOT, f'03-mon-coach-ma-coach-{t}')
        # Erreurs et textes des données : accordés aussi
        err = page.evaluate("coachErrorText('tier_full')")
        R.check(err.startswith('Ta coach a atteint') and ' elle doit ' in err, f'{t} erreur « Ta coach… elle doit… » ({err})')
        R.check(page.evaluate("coachErrorText('already_coached')") == "Tu as déjà une coach. Quitte-la d'abord dans Réglages › Coach.",
                f'{t} « Tu as déjà une coach. Quitte-la… »')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_rejoindre_coach(bench, eng, dev, theme):
    """Juste après « Accepter » : « camille_coach est ta coach » (forme lue tout de suite, pas l'accord par défaut)."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'lea')
        code = page.evaluate("""() => { const c = __sb.addPerson({ username: 'camille_coach', avatar: '🦊', social: false }); __sb.makeCoach(c);
            __sb.setForm(c, 'elle'); return __sb.co.permCode[c]; }""")
        R.check(page.evaluate("myCoachForm()") is None, f'{t} avant de rejoindre : forme inconnue')
        page.evaluate("async c => { const r = await coachPreview(c); if (!r.ok) throw new Error(r.kind); routeTo('friends'); navigate(makeRoute('coach-join', c)); }", code)
        page.wait_for_selector('[data-action="coach-age"]', timeout=8000)
        settle(page)
        if page.get_attribute('[data-action="coach-accept"]', 'disabled') is not None:
            page.click('[data-action="coach-age"]')
            page.wait_for_selector('[data-action="coach-accept"]:not([disabled])', timeout=5000)
        page.click('[data-action="coach-accept"]')
        page.wait_for_selector('.ios-dialog', timeout=8000)
        title = page.inner_text('.ios-dialog .ios-dialog__title') if page.locator('.ios-dialog .ios-dialog__title').count() else page.inner_text('.ios-dialog')
        R.check('camille_coach est ta coach' in title, f'{t} après Rejoindre : « … est ta coach » ({title!r})')
        msg = page.inner_text('.ios-dialog')
        R.check('Social › Ma coach' in msg, f'{t} après Rejoindre : « Social › Ma coach »')
        shot(page, LOT, f'04-rejoindre-ta-coach-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_serveur_davant(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'lea')
        page.evaluate("""async () => { __sb.fail.form = 'missing'; const c = __sb.addPerson({ username: 'camille_coach', avatar: '🦊', social: false });
            __sb.makeCoach(c); __sb.setForm(c, 'elle'); __sb.link(c, __sb.meId(), Date.now() - 3 * 86400000); await coachRefresh(); }""")
        page.evaluate("routeTo('friends')")
        page.wait_for_selector('[data-action="coach-open-mine"]', timeout=8000)
        settle(page)
        R.check(page.inner_text('[data-action="coach-open-mine"] .cell__title') == 'Mon coach' and page.evaluate("myCoachForm()") is None,
                f'{t} serveur d\'avant : « Mon coach » comme avant')
        n = page.evaluate("__sb.calls.filter(c => c[1] === 'coach_form').length")
        page.evaluate("async () => { await coachRefresh(); await coachRefresh(); }")
        R.check(page.evaluate("__sb.calls.filter(c => c[1] === 'coach_form').length") == n, f'{t} fonction absente : plus relue de la session')
        R.check(page.locator('.toast--error').count() == 0 and not page.errors, f'{t} aucun message ni erreur {page.errors}')


run_main(R, [t_coach_choisit, t_eleve_ma_coach, t_rejoindre_coach, t_serveur_davant])
