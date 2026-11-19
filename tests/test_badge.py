"""Badge « Carte pro déclarée » des coachs (docs/COACH_V1.md, « Badge carte pro ») : le coach déclare son numéro de
carte dans Réglages › Coach (format refusé dans la feuille, prérempli avec sa demande, changé, retiré ; suspendu et
retiré par l'administrateur ; serveur sans le badge : section cachée) ; l'élève voit le badge dans l'aperçu
« Rejoindre » et dans Mon coach, jamais le numéro ; « Signaler ce badge » part dans la file des signalements (alerte
dès le premier), suspend le badge à partir de 2 comptes différents, un même compte ne compte qu'une fois ; profil d'un autre coach ; compte bloqué : pas de badge. Texte agrandi sur iPhone SE.

L'app iOS et Supabase sont simulés (tests/fake_account.py, règles de 20261117090000_badge_carte_pro.sql) : aucune
requête ne sort. Captures : $PPL_SCRATCH/shots/lotbadge/ (chaque écran, clair et sombre).
Lancer : PPL_DEV="iPhone SE" PPL_THEME=dark python3 test_badge.py (ou run_all.py badge).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'badge'
R = Results(LOT)
NUM = '04912ED0123'
LABEL = 'Carte pro déclarée'


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
    page.add_init_script(FAKE_ACCOUNT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
    settle(page)


def signin(page, username, enable=False):
    page.evaluate("""async ([u, en]) => {
        await accountSignInWith('apple', async () => 'add');
        if (u) await accountSaveProfile({ username: u });
        if (en) await socialEnable(true);
    }""", [username, enable])
    settle(page)


def ccalls(page, fn):
    return page.evaluate('f => __sb.calls.filter(c => c[0] === "coach" && c[1] === f).map(c => JSON.parse(c[2]))', fn)


def layout(page, t, name):
    R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} {name} : pas de défilement horizontal')
    small = page.evaluate("""() => [...document.querySelectorAll('#app button, .tabbar button')].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""")
    R.check(not small, f'{t} {name} : cibles de 44 pt {small}')
    cut = page.evaluate("""() => [...document.querySelectorAll('.card-badge, .card-badge *, #app .cell__title, #app .cell__value')]
        .filter(e => e.offsetParent && e.children.length === 0 && e.textContent.trim() && !e.matches('svg, use')
          && (e.scrollWidth > e.clientWidth + 1) && getComputedStyle(e).display !== 'inline').map(e => e.textContent.trim().slice(0, 30))""")
    R.check(not cut, f'{t} {name} : aucun texte coupé {cut}')


def badge_text(page):
    loc = page.locator('#app .card-badge')
    return loc.first.inner_text().strip() if loc.count() else ''


def big_text(page):
    page.add_style_tag(content='html { font-size: 28px !important; }')
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    settle(page)


def t_coach_declare(bench, eng, dev, theme):
    """Coach validé : déclare sa carte, la voit sur Mon profil, change de numéro, retire le badge ; suspendu, retiré."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'max', enable=True)
        page.evaluate(f"""async () => {{ await coachRequestSubmit({{ cardName: 'Max Dupont', cardNumber: '{NUM}', diploma: 'BPJEPS' }});
            __sb.makeCoach(__sb.meId()); await coachRefresh(); }}""")
        page.evaluate("navigate('coach')")
        page.wait_for_selector('[data-action="coach-card-declare"]')
        txt = page.inner_text('.coach-view')
        R.check('Carte professionnelle' in txt and 'Déclarer ma carte pro' in txt and 'Seuls toi et l\'administrateur' in txt
                and 'suppression du compte' in txt, f'{t} Réglages › Coach : section Carte professionnelle, numéro privé, usurpation')
        layout(page, t, 'section carte, sans déclaration')
        page.locator('[data-action="coach-card-declare"]').scroll_into_view_if_needed()
        shot(page, LOT, f'1-reglages-sans-carte-{t}')
        # Feuille : préremplie avec le numéro de la demande, format refusé sans appel
        page.click('[data-action="coach-card-declare"]')
        page.wait_for_selector('#coachCardNum')
        R.check(page.input_value('#coachCardNum') == NUM and page.get_attribute('#coachCardNum', 'autocapitalize') == 'characters',
                f'{t} feuille : préremplie avec le numéro de la demande, capitales')
        R.check(page.locator('#coachCardNum').bounding_box()['height'] >= 44, f'{t} champ du numéro : 44 pt')
        page.fill('#coachCardNum', '12345')
        page.click('.sheet__btn--confirm')
        settle(page)
        R.check('04912ED0123' in page.inner_text('#coachCardHelp') and page.input_value('#coachCardNum') == '12345'
                and not ccalls(page, 'coach_card_declare'), f'{t} numéro mal formé : erreur dans la feuille, saisie gardée, aucun appel')
        shot(page, LOT, f'2-feuille-erreur-{t}')
        page.fill('#coachCardNum', '049 12-ed.0123')
        page.click('.sheet__btn--confirm')
        settle(page)
        card = page.evaluate("__sb.co.cards[__sb.meId()]")
        R.check(card and card['card_number'] == NUM and card['status'] == 'declared', f'{t} carte déclarée, numéro normalisé ({card})')
        txt = page.inner_text('.coach-view')
        R.check(NUM in txt and 'Déclarée le' in txt and 'Affiché' in txt and 'Changer de numéro' in txt and 'Retirer le badge' in txt,
                f'{t} section : numéro, date, badge affiché')
        R.check('pas une carte vérifiée' in txt, f'{t} le coach sait que le badge ne vaut pas vérification')
        layout(page, t, 'section carte déclarée')
        page.locator('[data-action="coach-card-withdraw"]').scroll_into_view_if_needed()
        shot(page, LOT, f'3-reglages-declaree-{t}')
        # Mon profil : la pastille, jamais le numéro
        page.evaluate("navigate('social-me')")
        page.wait_for_selector('.social-me-view .card-badge')
        R.check(badge_text(page) == LABEL and NUM not in page.inner_text('#app'), f'{t} Mon profil : « {LABEL} », sans numéro')
        layout(page, t, 'Mon profil')
        shot(page, LOT, f'4-mon-profil-{t}')
        # Changer de numéro, puis retirer
        page.evaluate("navigate('coach')")
        page.wait_for_selector('[data-action="coach-card-withdraw"]')
        page.click('[data-action="coach-card-declare"]:has-text("Changer de numéro")')
        page.wait_for_selector('#coachCardNum')
        R.check(page.input_value('#coachCardNum') == NUM, f'{t} changer : numéro actuel prérempli')
        page.fill('#coachCardNum', '02a24ed0042')
        page.click('.sheet__btn--confirm')
        settle(page)
        R.check(page.evaluate("__sb.co.cards[__sb.meId()].card_number") == '02A24ED0042' and '02A24ED0042' in page.inner_text('.coach-view'),
                f'{t} numéro changé (Corse)')
        page.click('[data-action="coach-card-withdraw"]')
        tap_dialog(page, 'Retirer')
        settle(page)
        R.check(page.evaluate("!__sb.co.cards[__sb.meId()]") and page.locator('[data-action="coach-card-declare"]', has_text='Déclarer ma carte pro').count() == 1,
                f'{t} badge retiré : section revenue à « Déclarer »')
        # Suspendu après un signalement : ni changement, ni retrait ; puis retiré par l'administrateur
        page.evaluate(f"async () => {{ __sb.setCard(__sb.meId(), '{NUM}', 'suspended'); coachPro.loadedAt = 0; await coachProRefresh(); }}")
        settle(page)
        txt = page.inner_text('.coach-view')
        R.check('Suspendu' in txt and 'signalements' in txt and page.locator('[data-action="coach-card-withdraw"]').count() == 0
                and page.locator('[data-action="coach-card-declare"]').count() == 0, f'{t} suspendu : expliqué, sans bouton')
        page.locator('.coach-view .group-foot', has_text='signalements').scroll_into_view_if_needed()
        shot(page, LOT, f'5-reglages-suspendu-{t}')
        R.check(page.evaluate(f"(async () => (await coachCardDeclare('04912ED0999')).kind)()") == 'card_suspended', f'{t} suspendu : changement refusé')
        page.evaluate(f"async () => {{ __sb.setCard(__sb.meId(), '{NUM}', 'removed', {{ removed_reason: 'Numéro d\\'une autre personne.' }}); coachPro.loadedAt = 0; await coachProRefresh(); }}")
        settle(page)
        txt = page.inner_text('.coach-view')
        R.check('Retiré' in txt and 'Motif : Numéro d\'une autre personne.' in txt and 'contact@mdlf.app' in txt, f'{t} retiré : motif et contact')
        # Aucun texte du badge ne promet une vérification
        R.check(not re.search(r'certifi|carte vérifiée|badge vérifié', page.inner_text('#app'), re.I), f'{t} jamais « vérifiée » ni « certifié »')
        # Serveur sans le badge (migration pas appliquée) : section cachée, pas d'erreur
        page.evaluate("async () => { __sb.fail.card = 'missing'; coachPro.card = null; coachPro.loadedAt = 0; await coachProRefresh(); }")
        settle(page)
        R.check('Carte professionnelle' not in page.inner_text('.coach-view') and 'Ton code coach' in page.inner_text('.coach-view'),
                f'{t} serveur sans le badge : section cachée, le reste affiché')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def setup_coach(page, social=False):
    return page.evaluate(f"""() => {{
        const max = __sb.addPerson({{ username: 'max', avatar: '🦁', social: {'true' if social else 'false'} }});
        __sb.makeCoach(max); __sb.setCard(max, '{NUM}');
        __sb.co.invites.push({{ code: 'K7M2QX9P', coach: max, expires: Date.now() + 7 * 86400000 }});
        return max;
    }}""")


def t_eleve_signale(bench, eng, dev, theme):
    """Élève : badge dans l'aperçu « Rejoindre » et dans Mon coach, sans numéro ; 1er signalement : alerte, rien ne change ; deux fois : une seule."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'lea')
        max_id = setup_coach(page)
        page.evaluate("navigate('coach')")
        page.wait_for_selector('[data-action="coach-join"]')
        page.click('[data-action="coach-join"]')
        page.wait_for_selector('#coachCode')
        page.fill('#coachCode', 'K7M2QX9P')
        page.click('.sheet__btn--confirm')
        page.wait_for_selector('.coach-join-view')
        page.wait_for_selector('.coach-join-view .card-badge')
        R.check(badge_text(page) == LABEL and NUM not in page.inner_text('#app'), f'{t} aperçu « Rejoindre » : « {LABEL} », sans numéro')
        R.check(ccalls(page, 'coach_card_badge')[-1] == {'coach': max_id}, f'{t} badge lu pour ce coach')
        layout(page, t, 'aperçu Rejoindre')
        shot(page, LOT, f'6-apercu-rejoindre-{t}')
        page.click('[data-action="coach-age"]')
        page.click('[data-action="coach-accept"]')
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'OK')
        page.evaluate("navigate('coach-mine')")
        page.wait_for_selector('.coach-mine-view .card-badge')
        R.check(badge_text(page) == LABEL and NUM not in page.inner_text('#app'), f'{t} Mon coach : badge, sans numéro')
        rep = page.locator('[data-action="coach-card-report"]')
        R.check(rep.count() == 1 and rep.inner_text().strip() == 'Signaler ce badge', f'{t} Mon coach : « Signaler ce badge »')
        page.locator('.coach-mine-view .coach-join__who').scroll_into_view_if_needed()
        shot(page, LOT, f'7-mon-coach-{t}')
        rep.scroll_into_view_if_needed()
        layout(page, t, 'Mon coach')
        # Signaler : confirmation, ligne dans la file commune, badge suspendu et caché tout de suite, alerte demandée
        rep.click()
        page.wait_for_selector('.ios-dialog')
        R.check('vérifiera la carte' in page.inner_text('.ios-dialog') and 'ne saura pas que c\'est toi' in page.inner_text('.ios-dialog'),
                f'{t} confirmation : vérification et anonymat expliqués')
        shot(page, LOT, f'8-signaler-confirmation-{t}')
        tap_dialog(page, 'Signaler')
        settle(page)
        rows = page.evaluate("__sb.so.reports.filter(r => r.target_ref === 'coach_card')")
        R.check(len(rows) == 1 and rows[0]['target_user'] == max_id and rows[0]['kind'] == 'profile' and rows[0]['notified'] is True,
                f'{t} 1er signalement dans la file commune, alerte e-mail demandée ({rows})')
        R.check('Signalement envoyé' in (page.locator('.toast').inner_text() if page.locator('.toast').count() else ''), f'{t} toast « Signalement envoyé »')
        # 1er signalement : rien ne change à l'écran ni sur le serveur
        R.check(page.evaluate(f"__sb.co.cards['{max_id}'].status") == 'declared', f'{t} 1 seul compte : badge pas suspendu')
        R.check(page.locator('.coach-mine-view .card-badge').count() == 1, f'{t} 1er signalement : badge toujours affiché')
        # Le même compte une 2e fois : ne compte pas, le dit
        wait_toast_gone(page)   # le toast suivant doit être le nouveau
        page.click('[data-action="coach-card-report"]')
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'Signaler')
        settle(page)
        R.check(page.evaluate("__sb.so.reports.filter(r => r.target_ref === 'coach_card').length") == 1
                and page.evaluate(f"__sb.co.cards['{max_id}'].status") == 'declared', f'{t} même compte deux fois : compté une fois')
        R.check('déjà signalé' in (page.locator('.toast').inner_text() if page.locator('.toast').count() else ''), f'{t} toast « Tu as déjà signalé ce badge »')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_profil_autre(bench, eng, dev, theme):
    """Profil d'un coach dans Social : badge et « Signaler ce badge » ; bloqué : rien ; pas coach : rien. Texte agrandi."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme)
        signin(page, 'lea', enable=True)
        max_id = setup_coach(page, social=True)
        nina = page.evaluate("() => __sb.addPerson({ username: 'nina', avatar: '🦊', social: true })")
        page.evaluate(f"navigate(makeRoute('social-profile', '{max_id}'))")
        page.wait_for_selector('.social-profile-view .card-badge')
        R.check(badge_text(page) == LABEL and NUM not in page.inner_text('#app'), f'{t} profil d\'un coach : badge, sans numéro')
        R.check(page.locator('[data-action="coach-card-report"]').count() == 1, f'{t} profil : « Signaler ce badge »')

        layout(page, t, 'profil d\'un coach')
        shot(page, LOT, f'9-profil-coach-{t}')
        if dev == 'iPhone SE':
            big_text(page)
            layout(page, t, 'profil d\'un coach, texte agrandi')
            R.check(page.evaluate("(() => { const b = document.querySelector('.card-badge').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; })()"),
                    f'{t} texte agrandi : badge dans l\'écran')
            shot(page, LOT, f'9b-profil-coach-grand-texte-{t}')
        # nina l'a déjà signalé : mon signalement (2e compte différent) le suspend, le badge disparaît
        page.evaluate(f"""() => {{ __sb.so.reports.push({{ id: __sb.so.reports.length + 1, by: '{nina}', target_user: '{max_id}', kind: 'profile',
            target_ref: 'coach_card', reason: 'autre', details: 'Badge', notified: true, at: Date.now() }}); }}""")
        page.locator('[data-action="coach-card-report"]').scroll_into_view_if_needed()
        page.click('[data-action="coach-card-report"]')
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'Signaler')
        # Signalement, alerte, puis relecture du badge et redessin : attendus sans délai fixe (lent sous charge)
        try:
            page.wait_for_function("() => !document.querySelector('.social-profile-view .card-badge')", timeout=8000)
        except Exception:
            pass
        R.check(page.evaluate(f"__sb.co.cards['{max_id}'].status") == 'suspended', f'{t} 2e compte différent : badge suspendu')
        R.check(page.locator('.social-profile-view .card-badge').count() == 0 and page.locator('[data-action="coach-card-report"]').count() == 0,
                f'{t} 2e compte différent : badge et bouton disparus')
                # Pas coach : aucun badge ni bouton
        page.evaluate(f"navigate(makeRoute('social-profile', '{nina}'))")
        page.wait_for_selector('.social-profile-view')
        settle(page)
        R.check(page.locator('.card-badge').count() == 0 and page.locator('[data-action="coach-card-report"]').count() == 0, f'{t} profil d\'un non-coach : rien')
        # Bloqué : le badge n'est plus montré
        page.evaluate(f"async () => {{ __sb.block('{max_id}', __sb.meId()); await coachBadgeLoad('{max_id}', {{ force: true }}); }}")
        R.check(page.evaluate(f"coachBadgeShown('{max_id}')") is False, f'{t} bloqué : badge caché')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_coach_declare, t_eleve_signale, t_profil_autre])
