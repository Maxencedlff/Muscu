"""Suivi de la diète par le coach (docs/NUTRITION_V1.md, « Suivi de la diète par le coach ») :
- élève : case « Suivi de ma diète » dans Partager avec mon coach, décochée par défaut, rien d'envoyé avant ; cochée, un
  résumé par jour part (repas, kcal, eau, sel ; jamais un aliment) ; une coche le renvoie 5 s après ; décochée, tout est
  effacé du serveur ; serveur d'avant : pas de case ;
- coach : carte « Diète » de la fiche (7 jours en pastilles, légende des seuils, détail d'un jour au toucher, semaine
  d'avant), « Non partagé par l'élève » sans chiffre, signal « 3 jours hors diète » dans Mes élèves ;
- toast plus serré dont seul le bouton se touche, rond à cocher de la carte de l'accueil à 26 pt dans 44 pt.
iPhone SE et iPhone 13, clair et sombre, texte agrandi sur iPhone SE. Faux serveur : tests/fake_account.py (__sb).
Captures : $PPL_SCRATCH/shots/lotsuivi_diete/. Lancer : python3 test_suivi_diete.py (ou run_all.py suivi_diete).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'suivi_diete'
R = Results(LOT)

# Mêmes outils et même plan que test_nutri_coachs.py (un import relancerait ses tests)
# Mercredi 18 novembre 2026, 12 h 30 à Paris
NOW = local_ms(2026, 11, 18, 12, 30, tz=PARIS)
TODAY = '2026-11-18'
ENG = dict((d, e) for e, d in ALL_DEVICES)
DEVS = ['iPhone SE', 'iPhone 13']

PDT = {'id': 'i1', 'name': "Pomme de terre, bouillie/cuite à l'eau", 'food': 4003, 'fam': 'f', 'g': 350, 'per': {'k': 81, 'p': 1.8, 'c': 16.8, 'f': 0.3, 's': 0.05}}
POULET = {'id': 'i2', 'name': 'Poulet, filet sans peau grillé/poêlé', 'food': 36018, 'fam': 'v', 'g': 180, 'per': {'k': 121, 'p': 26.2, 'c': 0, 'f': 1.8, 's': 0.2}}
PAIN = {'id': 'i3', 'name': 'Pain blanc (par ex. : baguette, boule…)', 'food': 7001, 'fam': 'f', 'g': 80, 'per': {'k': 287, 'p': 9.1, 'c': 58.3, 'f': 1.4, 's': 1.25}}


def ciq(iid, name, code, fam, g, k, p, c, f, s):
    return {'id': iid, 'name': name, 'food': code, 'fam': fam, 'g': g, 'per': {'k': k, 'p': p, 'c': c, 'f': f, 's': s}}


# Plan réaliste (valeurs Ciqual 2025) : 2 232 kcal prévues pour 2 300 visées, glucides et lipides fixés aussi
def plan_coach():
    return {'name': 'Sèche semaine 1', 'targets': {'kcal': 2300, 'p': 150, 'c': 270, 'f': 55, 'water': 5, 'waterMin': 3, 'saltMin': 3, 'saltMax': 5}, 'meals': [
        {'id': 'm1', 'name': 'Déjeuner', 'items': [dict(PDT), dict(POULET), ciq('i4', "Huile d'olive vierge extra", 17270, 'g', 15, 899, 0.2, 0, 99.9, 0)]},
        {'id': 'm2', 'name': 'Dîner', 'items': [dict(PAIN), ciq('i5', 'Riz blanc, cuit, sans sel ajouté', 9104, 'f', 250, 155, 3.3, 33.2, 0.7, 0.05),
                                               ciq('i6', 'Boeuf, steak haché 5% MG cuit', 6251, 'v', 150, 155, 25.5, 0, 5.8, 0.16)]},
        {'id': 'm3', 'name': 'Petit-déjeuner', 'items': [ciq('i7', "Flocons d'avoine", 32140, 'f', 80, 369, 11.4, 57.7, 7.8, 0.01),
                                                         ciq('i8', 'Fromage blanc, nature, 0% MG', 19644, 'l', 250, 48, 7.2, 4.2, 0, 0.09),
                                                         ciq('i9', 'Banane, chair sans peau, crue', 13005, 'r', 120, 88, 1.1, 19.7, 0, 0)]},
        {'id': 'm4', 'name': 'Collation', 'items': [ciq('i10', 'Amande, émondée, sans sel ajouté', 15041, 'g', 30, 631, 25.8, 8.8, 52.5, 0.05)]}]}


def nb(v):
    return (v or '').replace(' ', ' ').replace(' ', ' ')


def tag(dev, theme):
    return f'{dev}-{theme}'.replace(' ', '_')


def open_app(page, theme, d, account=False):
    if account:
        page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True}))
        page.add_init_script(FAKE_ACCOUNT)
    page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
    seed(page, theme, json.dumps(d, ensure_ascii=False), extra={'ppl_welcome_seen': '1'})
    settle(page)


def signin(page, username):
    page.evaluate("async u => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: u }); }", username)
    settle(page)


def toast(page):
    return nb(page.locator('.toast').inner_text()) if page.locator('.toast').count() else ''


def big_text(page):
    page.add_style_tag(content='html { font-size: 28px !important; }')
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    settle(page)


def layout(page, t, name, scope):
    R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} {name} : pas de défilement horizontal')
    small = page.evaluate("""s => [...document.querySelectorAll(s + ' button')].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", scope)
    R.check(not small, f'{t} {name} : cibles de 44 pt {small}')
    cut = page.evaluate("""s => [...document.querySelectorAll(s + ' *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .sr-text, .visually-hidden') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""", scope)
    R.check(not cut, f'{t} {name} : aucun texte coupé {cut}')
    R.check(not page.errors, f'{t} {name} : aucune erreur JS {page.errors[:2]}')



def day_iso(n):
    """AAAA-MM-JJ, n jours avant le mercredi 18/11/2026."""
    import datetime
    return (datetime.date(2026, 11, 18) - datetime.timedelta(days=n)).isoformat()


def jour(n, kcal, done, kind='t', water=2500, salt=4.2):
    names = ['Petit-déjeuner', 'Déjeuner', 'Collation', 'Dîner']
    return {'day': day_iso(n), 'plan': 'd_seche001', 'name': 'Sèche semaine 1', 'kind': kind,
            'meals': [{'n': m, 'ok': i < done} for i, m in enumerate(names)], 'kcal': kcal, 'p': round(kcal * 0.065), 'c': round(kcal * 0.11), 'f': round(kcal * 0.024),
            'goal': {'kcal': 2300, 'p': 150, 'c': 270, 'f': 55}, 'water': water, 'waterGoal': 5000, 'waterMin': 3000, 'salt': salt, 'saltMin': 3, 'saltMax': 5}


# Léa : une semaine réaliste (suivie, partielle, un jour sans rien, aujourd'hui en cours) ; Zoé : 3 jours à côté
LEA = [jour(0, 1120, 2), jour(1, 2240, 4), jour(2, 1980, 3, 'r'), jour(4, 2310, 4), jour(5, 1500, 2, 'r'), jour(6, 2190, 4), jour(9, 2300, 4)]
ZOE = [jour(1, 600, 1), jour(2, 450, 1), jour(3, 900, 1), jour(5, 2300, 4)]


def eleve_data():
    p = plan_coach()
    p['fromCoach'] = {'coachId': 'c1', 'name': 'max', 'sentAt': 1}
    d = ppl_v2_today(now_ms=NOW)
    d['dietPlans'] = {'dc_c1_sem': p}
    d['dietActive'] = 'dc_c1_sem'
    d['dietEmptyDays'] = False
    d['dietLog'] = {TODAY: {'plan': 'dc_c1_sem', 'done': ['m3', 'm1'], 'swaps': {}, 'meals': ['m1', 'm2', 'm3', 'm4']}}
    d['waterLog'] = {TODAY: [{'id': 'w1', 'ml': 1000, 'at': NOW - 3600_000}, {'id': 'w2', 'ml': 500, 'at': NOW}]}
    return d


def dcalls(page, fn):
    return page.evaluate('f => __sb.calls.filter(c => c[0] === "coach" && c[1] === f).map(c => JSON.parse(c[2]))', fn)


def t_eleve(bench):
    for dev in DEVS:
        for theme in ('light', 'dark'):
            t = tag(dev, theme)
            with bench.frozen_page(NOW, ENG[dev], dev, theme) as page:
                open_app(page, theme, eleve_data(), account=True)
                signin(page, 'lea')
                me = page.evaluate("""() => { const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false }); __sb.makeCoach(max);
                    __sb.link(max, __sb.meId(), Date.now() - 20 * 86400000); return __sb.meId(); }""")
                page.evaluate('coachRefresh()')
                settle(page)
                page.evaluate("navigate('coach-share')")
                page.wait_for_selector('[data-action="coach-share-toggle"][data-kind="diet_log"]')
                settle(page)
                sw = page.locator('[data-action="coach-share-toggle"][data-kind="diet_log"]')
                R.check(sw.get_attribute('aria-checked') == 'false', f'{t} « Suivi de ma diète » décoché par défaut')
                R.check('Repas cochés, calories et macros, eau, sel' in nb(sw.inner_text()) and 'Tes 90 derniers jours partent aussi' in nb(sw.inner_text()), f'{t} ce que la case partage, dit dessous ({nb(sw.inner_text())!r})')
                R.check(dcalls(page, 'student_share_diet_days') == [], f'{t} par défaut : rien envoyé')
                txt = nb(page.inner_text('.coach-share-view'))
                R.check('le détail de tes aliments, les heures' in txt and 'gardée 90 jours au plus' in txt and txt.count('90 jours') == 1, f'{t} écran : ce que le coach verra, une fois')
                layout(page, t, 'partage', '.coach-share-view')
                shot(page, LOT, f'1-partage-off-{t}')
                sw.click()
                settle(page)
                R.check(sw.get_attribute('aria-checked') == 'true', f'{t} cochée')
                R.check(toast(page).startswith('Diète partagée avec ton coach') and 'Annuler' in toast(page), f'{t} toast ({toast(page)!r})')
                sent = page.evaluate(f"__sb.co.dietDays['{me}'] || []")
                R.check(len(sent) == 1 and sent[0]['day'] == TODAY and [m['ok'] for m in sent[0]['meals']] == [True, False, True, False] and sent[0]['water'] == 1500,
                        f'{t} envoi : aujourd\'hui, repas cochés, eau ({sent[:1]})')
                R.check('Poulet' not in json.dumps(sent, ensure_ascii=False) and 'Pomme de terre' not in json.dumps(sent, ensure_ascii=False), f'{t} aucun aliment envoyé')
                shot(page, LOT, f'2-partage-on-{t}')
                # Une coche : renvoyé 5 s après, une seule fois
                n0 = len(dcalls(page, 'student_share_diet_days'))
                page.evaluate("dietToggleMeal(data, 'dc_c1_sem', 'm2'); save();")
                page.clock.run_for(6000)
                settle(page)
                R.check(len(dcalls(page, 'student_share_diet_days')) == n0 + 1 and page.evaluate(f"__sb.co.dietDays['{me}'][0].meals[1].ok"), f'{t} coche renvoyée après 5 s')
                page.evaluate('save()')
                page.clock.run_for(6000)
                settle(page)
                R.check(len(dcalls(page, 'student_share_diet_days')) == n0 + 1, f'{t} rien de changé : rien renvoyé')
                # Décocher : confirmation d'abord (Annuler garde tout), puis effacé du serveur
                sw.click()
                page.wait_for_selector('.ios-dialog')
                dlg = nb(page.inner_text('.ios-dialog'))
                R.check('Arrêter le partage de ta diète ?' in dlg and 'max ne verra plus' in dlg, f'{t} arrêt : confirmation ({dlg[:90]!r})')
                tap_dialog(page, 'Annuler')
                settle(page)
                R.check(sw.get_attribute('aria-checked') == 'true' and page.evaluate(f"(__sb.co.dietDays['{me}'] || []).length") > 0, f'{t} Annuler : partage gardé')
                sw.click()
                page.wait_for_selector('.ios-dialog')
                tap_dialog(page, 'Arrêter')
                settle(page)
                R.check(page.evaluate(f"__sb.co.dietDays['{me}']") is None and 'supprimées du serveur' in toast(page), f'{t} décochée : effacé du serveur ({toast(page)!r})')
                R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')
    # Serveur d'avant la migration : pas de case
    with bench.frozen_page(NOW, ENG['iPhone 13'], 'iPhone 13', 'dark') as page:
        open_app(page, 'dark', eleve_data(), account=True)
        signin(page, 'lea')
        page.evaluate("""() => { __sb.fail.dietLog = 'missing'; const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false }); __sb.makeCoach(max); __sb.link(max, __sb.meId()); }""")
        page.evaluate('coachRefresh()')
        settle(page)
        page.evaluate("navigate('coach-share')")
        page.wait_for_selector('[data-action="coach-share-toggle"][data-kind="weight"]')
        R.check(page.locator('[data-kind="diet_log"]').count() == 0, 'serveur d\'avant : pas de case « Suivi de ma diète »')


def coach_setup(page):
    return page.evaluate("""([lea, zoe]) => { const me = __sb.meId(); __sb.makeCoach(me);
        const ids = {};
        for (const [name, av] of [['lea', '🦊'], ['tom', '🐼'], ['zoe', '🦉']]) { ids[name] = __sb.addPerson({ username: name, avatar: av, social: false, sessions: [
          { id: 'h1', date: Date.now() - 86400000, duration: 3600000, programme: 'ppl', category: 'push', label: 'Push', exercises: [{ name: 'Développé couché', sets: [{ weight: '60', reps: '8' }] }] }] });
          __sb.link(me, ids[name], Date.now() - 60 * 86400000); }
        __sb.shareDiet(ids.lea, lea); __sb.shareDiet(ids.zoe, zoe);
        return ids; }""", [LEA, ZOE])


def t_coach(bench):
    for dev in DEVS:
        for theme in ('light', 'dark'):
            t = tag(dev, theme)
            with bench.frozen_page(NOW, ENG[dev], dev, theme) as page:
                d = ppl_v2_today(now_ms=NOW)
                open_app(page, theme, d, account=True)
                signin(page, 'max')
                ids = coach_setup(page)
                page.evaluate('coachRefresh()')
                settle(page)
                # Mes élèves : Zoé à relancer pour sa diète
                page.evaluate("navigate('coach-students')")
                page.wait_for_selector('.coach-students-view')
                settle(page)
                txt = nb(page.inner_text('.coach-students-view'))
                R.check('Diète pas suivie 3 jours' in txt and 'Diète\n3 sur 7 suivis' in txt or 'Diète 3 sur 7 suivis' in txt.replace('\n', ' ') and 'Diète non partagée' in txt, f'{t} Mes élèves : « Diète manquée 3 jours », jours suivis de Léa ({txt[:400]!r})')
                R.check(page.evaluate(f"coachStudentProgress(coachStudent('{ids['zoe']}')).tone") == 'warn'
                        and page.evaluate(f"coachStudentProgress(coachStudent('{ids['lea']}')).tone") != 'warn', f'{t} Zoé à relancer, pas Léa')
                shot(page, LOT, f'3-eleves-{t}')
                # Fiche de Zoé : la carte dit pourquoi elle est à relancer et propose de lui écrire
                page.evaluate(f"navigate(makeRoute('coach-student', '{ids['zoe']}'))")
                page.wait_for_selector('.cdiet__warn')
                settle(page)
                warn = nb(page.inner_text('.cdiet__warn'))
                R.check('zoe n\'a pas suivi sa diète ces 3 derniers jours' in warn and 'Écrire à zoe' in warn and 'Moyenne' in nb(page.inner_text('.cdiet')), f'{t} Zoé : pourquoi et « Écrire à zoe » ({warn!r})')
                page.locator('.cdiet__days').scroll_into_view_if_needed()
                shot(page, LOT, f'3b-fiche-zoe-{t}')
                page.click('.cdiet__write')
                page.wait_for_selector('#chatInput')
                draft = page.input_value('#chatInput')
                R.check('ça se passe comment avec la diète ces derniers jours' in draft and dcalls(page, 'chat_send') == [], f'{t} message prêt, pas envoyé ({draft!r})')

                # Fiche de Léa : carte Diète
                page.evaluate(f"navigate(makeRoute('coach-student', '{ids['lea']}'))")
                page.wait_for_selector('.cdiet__days')
                settle(page)
                page.locator('.cdiet').scroll_into_view_if_needed()
                dots = page.evaluate("[...document.querySelectorAll('.cdiet__days .cdiet__dot')].map(e => e.className.replace('cdiet__dot cdiet__dot--', ''))")
                R.check(dots == ['ok', 'off', 'ok', 'none', 'part', 'ok', 'today'], f'{t} 7 pastilles : suivi, pas suivi, rien, partiel, en cours ({dots})')
                card = nb(page.inner_text('.cdiet'))
                R.check('3 jours suivis · 1 partiel' in card and 'calories à 10 % près de l\'objectif du jour et protéines à 90 % au moins' in nb(page.text_content('.cdiet__rule')), f'{t} compte et seuils dits ({card[:200]!r})')
                R.check('Mardi 17 novembre' in card, f'{t} hier choisi d\'office (aujourd\'hui pas fini)')
                layout(page, t, 'carte diète', '.coach-student-view .scr')
                shot(page, LOT, f'4-fiche-diete-{t}')
                # Toucher lundi (partiel) : détail
                page.click(f'.cdiet__day[data-day="{day_iso(2)}"]')
                settle(page)
                det = nb(page.inner_text('.cdiet'))
                R.check('Lundi 16 novembre' in det and 'Repos' in det and '3 sur 4' in det and 'pas coché : Dîner' in det
                        and '1 980 / 2 300 kcal' in det and '14 % sous l\'objectif' in det and 'objectif 3 à 5 L · 0,5 L sous l\'objectif' in det and 'Partiel : calories 14 % sous l\'objectif' in det and 'Protéines' in det, f'{t} détail du lundi ({det[-400:]!r})')
                R.check(page.locator(f'.cdiet__day[data-day="{day_iso(2)}"]').get_attribute('aria-pressed') == 'true', f'{t} jour choisi marqué')
                shot(page, LOT, f'5-detail-jour-{t}')
                # Semaine d'avant
                page.click('[data-action="coach-diet-week"][data-dir="1"]')
                settle(page)
                R.check('Du 5 nov. au 11 nov.' in nb(page.inner_text('.cdiet__range')), f'{t} semaine d\'avant ({nb(page.inner_text(".cdiet__range"))!r})')
                # Tom : non partagé, aucun chiffre
                page.evaluate(f"navigate(makeRoute('coach-student', '{ids['tom']}'))")
                page.wait_for_selector('.cdiet-off')
                off = nb(page.inner_text('.cdiet-off'))
                R.check('Diète non partagée' in off and 'kcal' not in off, f'{t} Tom : « Non partagé par l\'élève » ({off!r})')
                page.locator('.cdiet-off').scroll_into_view_if_needed()
                shot(page, LOT, f'9-non-partage-{t}')
                if dev == 'iPhone SE':
                    page.evaluate(f"navigate(makeRoute('coach-student', '{ids['lea']}'))")
                    page.wait_for_selector('.cdiet__days')
                    big_text(page)
                    page.locator('.cdiet').scroll_into_view_if_needed()
                    layout(page, t, 'carte diète, texte agrandi', '.coach-student-view .scr')
                    shot(page, LOT, f'6-fiche-diete-grand-texte-{t}')
                R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


def t_communs(bench):
    """Toast plus serré, seul son bouton se touche ; rond à cocher de la carte de l'accueil dessiné à 26 pt."""
    for theme in ('light', 'dark'):
        t = tag('iPhone SE', theme)
        with bench.frozen_page(NOW, ENG['iPhone SE'], 'iPhone SE', theme) as page:
            open_app(page, theme, eleve_data())
            page.wait_for_selector('.diet-home')
            page.locator('.diet-home').scroll_into_view_if_needed()
            settle(page)
            ring = page.evaluate("""() => { const b = document.querySelector('.diet-home__mstate .diet-check'); if (!b) return null;
                const r = b.getBoundingClientRect(), p = getComputedStyle(b, '::before');
                return [Math.round(r.width), Math.round(r.height), Math.round(r.width - parseFloat(p.left) - parseFloat(p.right))]; }""")
            R.check(ring == [44, 44, 26], f'{t} rond de l\'accueil : 26 pt dessiné, 44 pt touchés ({ring})')
            shot(page, LOT, f'7-accueil-{t}')
            page.evaluate("showToast('Repas coché', { action: 'Annuler', onAction: () => {} })")
            settle(page)
            pe = page.evaluate("[getComputedStyle(document.querySelector('.toast')).pointerEvents, getComputedStyle(document.querySelector('.toast__action')).pointerEvents, Math.round(document.querySelector('.toast').getBoundingClientRect().height)]")
            R.check(pe[0] == 'none' and pe[1] == 'auto' and pe[2] <= 52, f'{t} toast : texte traversant, bouton touchable, 52 pt au plus ({pe})')
            shot(page, LOT, f'8-toast-{t}')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


run_main(R, [], once=[t_eleve, t_coach, t_communs])
