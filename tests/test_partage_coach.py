"""Partage avec le coach (app iOS simulée) : côté élève, Réglages › Social et coach › « Partager avec mon coach »
(seulement avec un coach, tout décoché par défaut, texte de ce que le coach verra, cocher envoie les pesées
saisies, une nouvelle pesée suit, décocher efface, quitter le coach arrête, hors ligne) ; côté coach, la courbe
du poids sur la fiche d'un élève qui le partage et le volume de ses séances qui compte son poids du corps
(pied de page adapté), rien pour un élève qui ne partage pas.

L'app iOS et Supabase sont simulés (tests/fake_account.py, règles de 20261031300000_partage_coach.sql) :
aucune requête ne sort. Captures : $PPL_SCRATCH/shots/lotpartage/ (chaque écran, clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_partage_coach.py (ou run_all.py partage_coach).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'partage'
R = Results(LOT)
DAY = 86400_000


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


def friends_tab(page):
    page.click('.tabbar [data-tab="friends"]')
    page.wait_for_timeout(500)


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


def ccalls(page, fn):
    return page.evaluate('f => __sb.calls.filter(c => c[0] === "coach" && c[1] === f).map(c => JSON.parse(c[2]))', fn)


def layout(page, t, name, tabbar=True):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page)
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')
    if tabbar:
        R.check(last_above_tabbar(page), f'{t} {name} : dernier élément au-dessus de la barre d\'onglets')


def setup_student(page, weights=True):
    """Max est mon coach (je suis lea) ; j'ai 3 pesées saisies dans l'app."""
    now = int(time.time() * 1000)
    return page.evaluate("""([now, w]) => {
        const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false });
        __sb.makeCoach(max);
        __sb.link(max, __sb.meId(), Date.now() - 10 * 86400000);
        if (w) { data.bodyWeightLog = [{ date: now - 86400000, kg: 61.4 }, { date: now - 8 * 86400000, kg: 62 }, { date: now - 20 * 86400000, kg: 62.8 }]; data.bodyWeightKg = 61.4; save(); }
        return { max, me: __sb.meId() };
    }""", [now, weights])


def open_settings_share(page):
    page.click('.tabbar [data-tab="train"]')
    page.evaluate("navigate('settings')")
    page.wait_for_selector('.settings-view')
    page.wait_for_timeout(300)


def t_eleve(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='lea')
        # Sans coach : pas de cellule
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(300)
        open_settings_share(page)
        R.check(page.locator('[data-action="coach-open-share"]').count() == 0, f'{t} sans coach : pas de « Partager avec mon coach »')
        ids = setup_student(page)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(400)
        page.evaluate('render()')
        cell = page.locator('.settings-view [data-action="coach-open-share"]')
        R.check(cell.count() == 1 and 'Rien' in cell.inner_text(), f'{t} Réglages › Social et coach : « Partager avec mon coach · Rien » ({cell.inner_text() if cell.count() else ""!r})')
        R.check(ccalls(page, 'student_share_weights') == [], f'{t} par défaut : aucune pesée envoyée')
        R.check(page.evaluate(f"__sb.co.weights['{ids['me']}']") is None, f'{t} par défaut : rien sur le serveur')
        cell.click()
        page.wait_for_selector('.coach-share-view [data-action="coach-share-toggle"]')
        sw = page.locator('[data-action="coach-share-toggle"][data-kind="weight"]')
        txt = page.inner_text('.coach-share-view')
        R.check(sw.count() == 1 and sw.get_attribute('aria-checked') == 'false', f'{t} case du poids, décochée')
        R.check(page.locator('[data-action="coach-share-toggle"]').count() == 2, f'{t} deux cases : poids et mensurations (docs/COACH_SUIVI.md)')
        R.check('Sommeil' not in txt and 'Pas' not in txt.replace('Partager', '') and 'cardiaque' not in txt, f'{t} sommeil, pas, FC : pas encore affichés')
        R.check('date et le poids de chaque pesée' in txt and 'données de Santé' in txt and 'arrêter à tout moment' in txt and 'effacé du serveur' in txt,
                f'{t} texte : ce que le coach verra, rien de Santé, révocable')
        layout(page, t, 'Partager (décoché)')
        shot(page, LOT, f'1-partager-off-{t}')
        # Cocher : consentement puis envoi des pesées saisies, rien d'autre
        sw.click()
        page.wait_for_timeout(500)
        R.check(page.locator('[data-action="coach-share-toggle"][data-kind="weight"]').get_attribute('aria-checked') == 'true', f'{t} case cochée')
        sent = ccalls(page, 'student_share_weights')
        R.check(len(sent) == 1 and [w['kg'] for w in sent[0]['weights']] == [61.4, 62, 62.8] and all(set(w) == {'date', 'kg'} for w in sent[0]['weights']),
                f'{t} cocher : les 3 pesées envoyées, date et kg seulement ({sent})')
        R.check('3 pesées partagées' in page.inner_text('.coach-share-view'), f'{t} « 3 pesées partagées depuis le … »')
        R.check('partagé' in toast(page).lower(), f'{t} toast de confirmation ({toast(page)!r})')
        # Les séances ne portent jamais le poids (stockage séparé)
        R.check(page.evaluate("JSON.stringify(__sb.upserted || []).includes('bodyKg')") is False, f'{t} jamais de bodyKg dans les séances envoyées')
        layout(page, t, 'Partager (coché)')
        shot(page, LOT, f'2-partager-on-{t}')
        # Nouvelle pesée : renvoyée
        page.evaluate('logBodyWeight(61, Date.now()); save(); coachShareWeightsChanged()')
        page.wait_for_timeout(300)
        sent = ccalls(page, 'student_share_weights')
        R.check(len(sent) == 2 and sent[-1]['weights'][0]['kg'] == 61, f'{t} nouvelle pesée envoyée ({len(sent)})')
        # Décocher : tout est effacé du serveur
        page.click('[data-action="coach-share-toggle"][data-kind="weight"]')
        page.wait_for_timeout(400)
        R.check(page.locator('[data-action="coach-share-toggle"][data-kind="weight"]').get_attribute('aria-checked') == 'false', f'{t} décoché')
        R.check(page.evaluate(f"__sb.co.weights['{ids['me']}']") is None and page.evaluate('__sb.co.shares.length') == 0, f'{t} décocher : pesées et consentement effacés')
        page.evaluate('logBodyWeight(60.5, Date.now()); coachShareWeightsChanged()')
        page.wait_for_timeout(300)
        R.check(len(ccalls(page, 'student_share_weights')) == 2, f'{t} décoché : plus rien ne part')
        # Recocher puis quitter le coach : la cellule disparaît, le partage est effacé
        page.click('[data-action="coach-share-toggle"][data-kind="weight"]')
        page.wait_for_timeout(400)
        page.evaluate('coachLeave()')
        page.wait_for_timeout(500)
        R.check(page.evaluate('__sb.co.shares.length') == 0 and page.evaluate(f"__sb.co.weights['{ids['me']}']") is None, f'{t} quitter : partage effacé')
        open_settings_share(page)
        R.check(page.locator('[data-action="coach-open-share"]').count() == 0, f'{t} quitter : plus de cellule')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_hors_ligne(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='lea')
        setup_student(page)
        page.evaluate('coachRefresh()')
        page.wait_for_timeout(400)
        page.evaluate("navigate('coach-share')")
        page.wait_for_selector('[data-action="coach-share-toggle"][data-kind="weight"]')
        page.evaluate('__sb.fail.coach = "offline"')
        page.click('[data-action="coach-share-toggle"][data-kind="weight"]')
        page.wait_for_timeout(400)
        R.check(page.locator('[data-action="coach-share-toggle"][data-kind="weight"]').get_attribute('aria-checked') == 'false', f'{t} hors ligne : reste décoché')
        R.check('Internet' in toast(page), f'{t} hors ligne : message clair ({toast(page)!r})')
        R.check(page.evaluate('__sb.co.shares.length') == 0, f'{t} hors ligne : rien de coché sur le serveur')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def setup_coach(page):
    """Je suis coach (max) ; Léa partage son poids (pesées), Tom non. Séances avec tractions (poids du corps)."""
    now = int(time.time() * 1000)

    def sess(prefix, n):
        return [{'id': f'{prefix}{i:02d}', 'date': now - (i * 7 + 1) * DAY, 'duration': 50 * 60_000, 'programme': 'ppl', 'category': 'pull', 'label': 'Pull',
                 'bodyKg': 99, 'exercises': [{'name': 'Tractions pronation', 'sets': [{'weight': '', 'reps': '10'}, {'weight': '', 'reps': '8'}]},
                                              {'name': 'Rowing barre', 'sets': [{'weight': '50', 'reps': '10'}]}]} for i in range(n)]
    weights = [{'date': now - d * DAY, 'kg': kg} for d, kg in [(2, 61.4), (9, 61.9), (16, 62.3), (23, 62.6), (30, 63.0), (37, 63.1)]]
    return page.evaluate("""([sl, st, w]) => {
        const me = __sb.meId();
        __sb.makeCoach(me);
        const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false, sessions: sl });
        const tom = __sb.addPerson({ username: 'tom', avatar: '🐼', social: false, sessions: st });
        __sb.link(me, lea, Date.now() - 60 * 86400000);
        __sb.link(me, tom, Date.now() - 60 * 86400000);
        __sb.share(lea, w);
        return { me, lea, tom };
    }""", [sess('l', 5), sess('t', 2), weights])


def t_coach(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        open_app(page, theme, ppl_v2_today_json())
        signin(page, username='max')
        ids = setup_coach(page)
        page.evaluate('data.bodyWeightKg = 95; save(); coachRefresh()')   # mon poids : jamais celui de l'élève
        page.wait_for_timeout(300)
        page.evaluate(f"navigate(makeRoute('coach-student', '{ids['lea']}'))")
        page.wait_for_selector('.coach-student-view .coach-sess')
        page.wait_for_timeout(500)
        txt = page.inner_text('.coach-student-view')
        R.check('poids du corps' in txt.lower() and '61,4 kg' in txt and '−1,6 kg sur 30 jours' in txt, f'{t} fiche : poids, tendance ({txt[:200]!r})')
        R.check(page.locator('#exChart canvas').count() == 1 and 'Poids du corps : de 63,1 kg' in (page.get_attribute('#exChart canvas', 'aria-label') or ''),
                f'{t} courbe dessinée et décrite pour VoiceOver ({page.get_attribute("#exChart canvas", "aria-label")!r})')
        R.check('lea partage son poids avec toi' in txt and 'Partagé depuis le' in txt and '..' not in txt, f'{t} fiche : d\'où vient la courbe')
        layout(page, t, 'fiche avec poids')
        shot(page, LOT, f'3-fiche-poids-{t}')
        # Séance : volume avec le poids de Léa (61,4 kg) pour les tractions, pied de page adapté
        page.locator('.coach-sess').first.click()
        page.wait_for_selector('.coach-session-view')
        page.wait_for_timeout(300)
        st = page.inner_text('.coach-session-view')
        share = page.evaluate("bodyShare({ name: 'Tractions pronation' })")
        expect = page.evaluate(f"fmtVolume(500 + 61.4 * {share} * 18)")
        R.check(expect in st, f'{t} séance : volume avec son poids ({expect!r})')
        R.check('poids du corps compté (61,4 kg' in st, f'{t} séance : pied de page « poids du corps compté »')
        layout(page, t, 'séance avec poids')
        shot(page, LOT, f'4-seance-poids-{t}')
        # Tom ne partage pas : ni courbe, ni poids dans le volume
        page.evaluate(f"navigate(makeRoute('coach-student', '{ids['tom']}'))")
        page.wait_for_selector('.coach-student-view .coach-sess')
        page.wait_for_timeout(400)
        R.check('ne partage pas son poids' in page.inner_text('.coach-student-view') and page.locator('#exChart').count() == 0 and page.locator('.coach-weight-off').count() == 1, f'{t} élève sans partage : pas de courbe (groupe expliqué, aucun chiffre)')
        page.locator('.coach-sess').first.click()
        page.wait_for_selector('.coach-session-view')
        st = page.inner_text('.coach-session-view')
        R.check('poids du corps non compté' in st and page.evaluate("fmtVolume(500)") in st, f'{t} sans partage : volume d\'avant (lest seul)')
        # Léa coupe le partage : la fiche relue n'a plus rien
        page.evaluate(f"__sb.co.shares = []; delete __sb.co.weights['{ids['lea']}']")
        page.evaluate(f"navigate(makeRoute('coach-student', '{ids['lea']}'))")
        page.wait_for_selector('.coach-student-view .coach-sess')
        page.wait_for_timeout(500)
        R.check('ne partage pas son poids' in page.inner_text('.coach-student-view') and page.locator('#exChart').count() == 0 and page.locator('.coach-weight-off').count() == 1, f'{t} partage coupé : courbe partie (groupe expliqué, aucun chiffre)')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_eleve, t_hors_ligne, t_coach])
