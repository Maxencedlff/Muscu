"""Pas, sommeil et cardio de Santé partagés avec le coach, app de l'élève (docs/SANTE_COACH.md) :
- Réglages › Partager avec mon coach : case « Pas, sommeil et cardio » décochée par défaut, seulement dans la coquille
  iOS qui sait lire Santé (cachée dans le navigateur, sur une build antérieure, sur un serveur d'avant) ;
- cocher : feuille d'accord explicite (ce qui part, la fenêtre d'iOS annoncée), PUIS la fenêtre de Santé (jamais
  avant, jamais au lancement), puis l'envoi d'un résumé par jour (jour, pas, sommeil, cardio : rien d'autre) ;
- Santé n'a rien rendu : l'écran dit où vérifier l'accès ; décocher : confirmation, tout est effacé du serveur ;
- bilans : pas, cardio et sommeil en heures préremplis depuis Santé et corrigeables ; sommeil en échelle : seulement
  l'indication de Santé ; sans la coquille : à la main ;
- rien de Santé dans ppl_v2 (copie iCloud, règle Apple 5.1.3(ii)) ; cibles de 44 pt, aucun texte coupé, pas de
  défilement horizontal, aucune erreur JS.

Faux serveur : tests/fake_account.py (student_share_health_days, coach_student_health) et tests/fake_checkins.py ;
fausse coquille Santé (FAKE_HEALTH : format de HealthPlugin.swift, activityDays et sleep). Identifiants factices.
Horloge figée au mercredi 25 novembre 2026, 10 h (Paris). iPhone SE et iPhone 13, sombre et clair.
Captures : $PPL_SCRATCH/shots/lotsante/ et $PPL_CAPTURES.
Lancer : PPL_DEV="iPhone 13" python3 tests/test_sante_coach.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT
from fake_checkins import FAKE_CHECKINS

LOT = 'sante'
R = Results(LOT)
NOW = local_ms(2026, 11, 25, 10, tz=PARIS)
DEVS = ('iPhone SE', 'iPhone 13')
CAPTURES = os.environ.get('PPL_CAPTURES', '')

# Fausse coquille Santé posée par-dessus celle de fake_account.py. window.__hk.days : présence de la clé days
# (build du 25/11) ; window.__hk.calls : chaque appel ; données : 9 jours de pas, 7 nuits, deux sorties.
FAKE_HEALTH = """
(() => {
  const now = %d, H = 3600000, D = 86400000;
  const day = ms => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const steps = [6200, 11800, 9400, 12500, 7300, 8800, 10100, 4300, 13900].map((n, i) => ({ day: day(now - i * D), steps: n }));
  const sleep = [7.2, 6.5, 7.8, 8.1, 6.9, 7.4, 7.0].flatMap((h, i) => { const end = now - i * D - 3 * H; const start = end - h * H;
    return [{ start: start - 20 * 60000, end, stage: 'inBed' }, { start, end: start + h * H / 2, stage: 'core' }, { start: start + h * H / 2, end, stage: 'rem' }]; });
  const workouts = [{ start: now - D - 2 * H, end: now - D - 2 * H + 35 * 60000, duration: 35 * 60, activity: 'running' },
    { start: now - 3 * D, end: now - 3 * D + 50 * 60000, duration: 45 * 60, activity: 'cycling' }];
  window.__hk = { days: !window.__hkNoDays, empty: false, calls: [] };
  const health = {
    isAvailable: async () => ({ available: true }),
    authorizationStatus: async () => ({ available: true, request: 'unnecessary', extra: 'unnecessary', ...(__hk.days ? { days: 'shouldRequest' } : {}) }),
    requestAuthorization: async () => ({ available: true, workouts: true }),
    requestDaysAuthorization: async () => { __hk.calls.push('authorize'); return { available: true, asked: true }; },
    activityDays: async ({ days }) => { __hk.calls.push('activity:' + days); return __hk.empty ? { steps: [], workouts: [] } : { steps, workouts }; },
    sleep: async ({ days }) => { __hk.calls.push('sleep:' + days); return { samples: __hk.empty ? [] : sleep }; },
    bodyMass: async () => ({ samples: [] }),
    workouts: async () => ({ workouts: [] }),
  };
  const base = window.Capacitor;
  window.Capacitor = { ...base, registerPlugin: n => (n === 'MdlfHealth' ? health : base.registerPlugin(n)) };
})();
"""


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def capture(page, name):
    path = shot(page, LOT, name)
    if CAPTURES:
        os.makedirs(CAPTURES, exist_ok=True)
        page.screenshot(path=os.path.join(CAPTURES, name.replace(' ', '_') + '.png'))
    return path


def layout(page, t, name, scope='#app'):
    R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} {name} : pas de défilement horizontal')
    small = page.evaluate("""s => [...document.querySelectorAll(s + ' button, ' + s + ' input')].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", scope)
    R.check(not small, f'{t} {name} : cibles de 44 pt {small}')
    cut = page.evaluate("""s => [...document.querySelectorAll(s + ' *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .visually-hidden') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""", scope)
    R.check(not cut, f'{t} {name} : aucun texte coupé {cut}')
    R.check(not page.errors, f'{t} {name} : aucune erreur JS {page.errors[:2]}')


def open_student(page, theme, health=True, days_key=True, items=None):
    """Je suis lea, élève d'alex. health : fausse coquille Santé ; days_key : build qui sait lire les pas.
    items : bilan envoyé par alex il y a une heure. → { alex, lea, req }"""
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True, 'uidStart': 1}))
    page.add_init_script(FAKE_ACCOUNT)
    page.add_init_script(FAKE_CHECKINS)
    if health:
        if not days_key:
            page.add_init_script('window.__hkNoDays = true;')
        page.add_init_script(FAKE_HEALTH % NOW)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(now_ms=NOW), extra={'ppl_welcome_seen': '1'})
    settle(page)
    ax = page.evaluate("() => __sb.addPerson({ username: 'alex', avatar: '🦁', social: false })")
    page.evaluate("async u => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: u }); }", 'lea')
    settle(page)
    ids = page.evaluate("""([ax, items]) => { const me = __sb.meId(); __sb.makeCoach(ax); __sb.link(ax, me, Date.now() - 40 * 86400000);
        const req = items ? __sb.ckRequest(ax, me, { name: 'Bilan de la semaine', items, sentAt: Date.now() - 3600000, dueAt: Date.now() + 86400000 }) : null;
        return { alex: ax, lea: me, req }; }""", [ax, items])
    page.evaluate('coachRefresh()')
    settle(page)
    return ids


def open_share(page):
    page.evaluate("navigate('coach-share')")
    page.wait_for_selector('.coach-share-view .cell[data-kind="weight"]')
    settle(page)


def t_partage(bench, eng, dev, theme):
    """Case, accord explicite, fenêtre de Santé au geste seulement, résumé par jour envoyé, décocher efface tout."""
    if dev not in DEVS:
        R.skip(f'{dev} : partage Santé vérifié sur iPhone SE et iPhone 13')
        return
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        ids = open_student(page, theme)
        R.check(page.evaluate('__hk.calls') == [], f'{t} lancement : Santé jamais lue ni demandée ({page.evaluate("__hk.calls")})')
        open_share(page)
        cell = page.locator('.cell[data-kind="health"]')
        R.check(cell.count() == 1, f'{t} case « Pas, sommeil et cardio » présente')
        R.check(cell.get_attribute('aria-checked') == 'false', f'{t} décochée par défaut')
        sub = cell.inner_text()
        R.check('Pas, sommeil et cardio' in sub and 'pas, heures de sommeil et minutes de cardio' in sub, f'{t} ce qui part, dit sur la case ({sub!r})')
        foot = page.inner_text('.coach-share-view')
        R.check('le nombre de pas, la durée de sommeil et les minutes de cardio' in foot, f'{t} pied : ce que voit le coach')
        R.check('fréquence cardiaque' in foot, f'{t} pied : ce qui ne part jamais')
        layout(page, t, 'Partager')
        capture(page, f'partage-off-{t}')
        # Cocher : feuille d'accord d'abord, et la fenêtre de Santé seulement après « Partager »
        cell.click()
        page.wait_for_selector('.ios-dialog')
        dlg = page.inner_text('.ios-dialog')
        R.check('Partager tes pas, ton sommeil et ton cardio avec alex' in dlg and 'Santé va te demander l\'accès' in dlg, f'{t} accord explicite ({dlg[:80]!r})')
        R.check(page.evaluate('__hk.calls') == [], f'{t} rien demandé à Santé avant l\'accord')
        capture(page, f'partage-accord-{t}')
        tap_dialog(page, 'Annuler')
        R.check(page.evaluate("() => !__sb.co.shares.some(x => x.kind === 'health')") and page.evaluate('__hk.calls') == [], f'{t} Annuler : rien')
        cell.click()
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'Partager')
        page.wait_for_function("me => (__sb.co.healthDays[me] || []).length > 0", arg=ids['lea'], timeout=6000)
        settle(page)
        R.check(page.evaluate('__hk.calls')[:3] == ['authorize', 'activity:92', 'sleep:92'], f'{t} fenêtre de Santé au geste, puis lecture ({page.evaluate("__hk.calls")})')
        sent = page.evaluate("me => __sb.co.healthDays[me]", ids['lea'])
        keys = sorted({k for d in sent for k in d})
        R.check(keys == ['cardio', 'day', 'sleep', 'steps'], f'{t} rien d\'autre que jour, pas, sommeil, cardio ({keys})')
        R.check(len(sent) == 9 and sent[0]['steps'] == 6200, f'{t} 9 jours, aujourd\'hui en tête ({len(sent)}, {sent[0]})')
        yday = sent[1]
        R.check(yday['sleep'] == 390 and yday['cardio'] == 35, f'{t} hier : 6 h 30 endormi (le temps au lit écarté), 35 min de course ({yday})')
        R.check(page.locator('.cell[data-kind="health"]').get_attribute('aria-checked') == 'true', f'{t} cochée')
        st = page.locator('.cell[data-kind="health"]').inner_text()
        R.check('9 jours visibles' in st, f'{t} état : jours visibles ({st!r})')
        R.check('steps' not in (ls(page, 'ppl_v2') or '') and 'sleep' not in json.loads(ls(page, 'ppl_v2') or '{}'), f'{t} 5.1.3 : rien de Santé dans ppl_v2')
        layout(page, t, 'Partager (coché)')
        capture(page, f'partage-on-{t}')
        # Décocher : confirmation, tout effacé côté serveur
        page.locator('.cell[data-kind="health"]').click()
        page.wait_for_selector('.ios-dialog')
        R.check('9 jours partagés' in page.inner_text('.ios-dialog'), f'{t} arrêter : ce qui sera effacé')
        tap_dialog(page, 'Arrêter')
        page.wait_for_function("me => !__sb.co.shares.some(x => x.student === me && x.kind === 'health')", arg=ids['lea'], timeout=4000)
        R.check(page.evaluate("me => !__sb.co.healthDays[me]", ids['lea']), f'{t} décoché : jours effacés du serveur')
        R.check(page.evaluate("localStorage.getItem('mdlf_coach_share_h')") is None, f'{t} décoché : empreinte retirée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


def t_cachee(bench, eng, dev, theme):
    """Navigateur, build antérieure, serveur d'avant : pas de case, rien de lu. Santé vide : où vérifier l'accès."""
    if dev != 'iPhone 13':
        R.skip(f'{dev} : cas sans la coquille vérifiés sur iPhone 13')
        return
    t = tag(dev, theme)
    for label, kw, prep in [('build antérieure', {'days_key': False}, None), ('serveur d\'avant', {}, "__sb.fail.health = 'missing'")]:
        with bench.frozen_page(NOW, eng, dev, theme) as page:
            open_student(page, theme, **kw)
            if prep:
                page.evaluate(prep)
            open_share(page)
            R.check(page.locator('.cell[data-kind="health"]').count() == 0, f'{t} {label} : pas de case')
            R.check(page.locator('.cell[data-kind="diet_log"]').count() == 1, f'{t} {label} : les autres cases restent')
            R.check(page.evaluate('__hk.calls') == [], f'{t} {label} : Santé jamais lue')
            R.check(not page.errors, f'{t} {label} : aucune erreur JS {page.errors[:2]}')
    # Santé ne rend rien (accès refusé dans Réglages : iOS ne le dit pas)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        ids = open_student(page, theme)
        page.evaluate('__hk.empty = true')
        open_share(page)
        page.locator('.cell[data-kind="health"]').click()
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'Partager')
        page.wait_for_function("me => __sb.co.shares.some(x => x.student === me && x.kind === 'health')", arg=ids['lea'], timeout=4000)
        settle(page)
        txt = page.inner_text('.coach-share-view')
        R.check('Rien de lu dans Santé' in txt and 'Accès aux données et appareils' in txt, f'{t} Santé vide : où vérifier ({txt[-200:]!r})')
        layout(page, t, 'Partager (Santé vide)')
        capture(page, f'partage-vide-{t}')


ITEMS_H = [
    {'kind': 'steps', 'type': 'number'},
    {'kind': 'cardio', 'type': 'number'},
    {'kind': 'sleep', 'type': 'number'},
    {'kind': 'energy', 'type': 'scale'},
]
ITEMS_SCALE = [{'kind': 'sleep', 'type': 'scale'}, {'kind': 'steps', 'type': 'number'}]


def open_bilan(page):
    page.evaluate('checkinRefresh()')
    settle(page)
    page.evaluate('render()')
    settle(page)
    page.click('.ck-home [data-action="ck-open"]')
    page.wait_for_selector('.ck-view .ck-head')
    settle(page)
    page.wait_for_function("() => document.querySelector('.ck-item[data-key=\"steps\"] input')?.value !== ''", timeout=4000)
    settle(page)


def t_bilan(bench, eng, dev, theme):
    """Pas, cardio, sommeil en heures préremplis et corrigeables ; sommeil en échelle : l'indication seule."""
    if dev not in DEVS:
        R.skip(f'{dev} : bilans vérifiés sur iPhone SE et iPhone 13')
        return
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        ids = open_student(page, theme, items=ITEMS_H)
        open_bilan(page)
        val = lambda k: page.locator(f'.ck-item[data-key="{k}"] input').input_value()
        # Période : les 7 jours qui finissent aujourd'hui ; Santé : 6200, 11800, 9400, 12500, 7300, 8800, 10100 → 9443
        R.check(val('steps') == '9443', f'{t} pas : moyenne de la période ({val("steps")})')
        R.check(val('cardio') == '80', f'{t} cardio : 35 + 45 min ({val("cardio")})')
        R.check(val('sleep') == '7,3', f'{t} sommeil : 7,3 h par nuit ({val("sleep")})')
        helps = page.inner_text('.ck-view')
        R.check('Moyenne lue dans Santé' in helps and 'Minutes de cardio lues dans Santé' in helps and 'par nuit en moyenne sur 7 nuits, d\'après Santé' in helps,
                f'{t} d\'où viennent les chiffres')
        R.check(page.evaluate('__hk.calls').count('authorize') == 0, f'{t} bilan : aucune fenêtre d\'autorisation')
        layout(page, t, 'Bilan Santé', '.ck-view')
        page.locator('.ck-item[data-key="steps"]').scroll_into_view_if_needed()
        capture(page, f'bilan-sante-{t}')
        # Corriger : le chiffre de l'élève l'emporte, il part tel quel
        page.fill('.ck-item[data-key="cardio"] input', '95')
        page.locator('.ck-item[data-key="cardio"] input').blur()
        settle(page)
        page.click('.ck-view [data-action="ck-pick"][data-key="energy"][data-v="4"]')
        page.click('.ck-view button.ck-send')
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, 'Envoyer à alex')
        page.wait_for_selector('.ck-view--done')
        ans = page.evaluate("id => __sb.ck.answers[id]", ids['req'])
        R.check(ans.get('steps') == 9443 and ans.get('cardio') == 95 and ans.get('sleep') == 7.3, f'{t} envoyé : corrigé gardé ({ans})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_student(page, theme, items=ITEMS_SCALE)
        open_bilan(page)
        sl = page.locator('.ck-item[data-key="sleep"]')
        R.check(sl.locator('[aria-checked="true"]').count() == 0, f'{t} échelle : aucun ressenti deviné')
        R.check('par nuit en moyenne sur 7 nuits, d\'après Santé' in sl.inner_text(), f'{t} échelle : indication de Santé ({sl.inner_text()!r})')
        layout(page, t, 'Bilan échelle', '.ck-view')
        sl.scroll_into_view_if_needed()
        capture(page, f'bilan-echelle-{t}')
    # Sans la coquille Santé : à la main, aucune indication
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_student(page, theme, health=False, items=ITEMS_H)
        page.evaluate('checkinRefresh()')
        settle(page)
        page.evaluate('render()')
        settle(page)
        page.click('.ck-home [data-action="ck-open"]')
        page.wait_for_selector('.ck-view .ck-head')
        settle(page)
        R.check(page.locator('.ck-item[data-key="steps"] input').input_value() == '', f'{t} sans Santé : pas à la main')
        R.check('Heures de sommeil par nuit' in page.inner_text('.ck-view'), f'{t} sans Santé : aide du sommeil en heures')
        R.check(not page.errors, f'{t} sans Santé : aucune erreur JS {page.errors[:2]}')


run_main(R, [t_partage, t_cachee, t_bilan])
