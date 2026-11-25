"""Bilans configurables, app de l'élève (docs/BILANS.md « App iPhone (élève) », maquette 8-bilan-iphone) :
- accueil : carte « Bilan à remplir » (nom, coach, date limite, Remplir) ; notification checkin / checkin_reminder → écran ;
- écran : préremplissage (dernière pesée, mensurations, jours de diète, séances de la période), échelles en radiogroup
  (aria-checked, bornes lues), oui/non, question libre, « Passer », brouillon gardé après « Plus tard » et un
  rechargement, envoi confirmé puis état « Envoyé », réponse du coach affichée ;
- photos : celles déjà envoyées par le circuit chiffré (coffre › cphSend) sont jointes au bilan ;
- cycle : jamais envoyé sans accord (refus no_consent du serveur), accord avec « J'ai 18 ans ou plus », retrait ; jamais
  proposé si la tranche d'âge d'Apple est 15-17 ans ;
- hors ligne : bilan gardé, envoyé une seule fois au retour du réseau ;
- un seul toucher (pointerdown ne change rien), cibles de 44 pt, aucun texte coupé, pas de défilement horizontal,
  texte agrandi (AX33), aucune erreur JS.

Faux serveur : tests/fake_account.py puis tests/fake_checkins.py. Identifiants et clés factices. Horloge figée au mardi
24 novembre 2026, 10 h (Paris). iPhone SE et iPhone 13, sombre et clair. Captures : $PPL_SCRATCH/shots/lotbilans/ et
$PPL_CAPTURES (dossier des captures à relire).
Lancer : PPL_URL=http://127.0.0.1:8779/ PPL_DEV="iPhone 13" python3 tests/test_bilans_eleve.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT, FAKE_VAULT as VAULT
from fake_checkins import FAKE_CHECKINS

LOT = 'bilans'
R = Results(LOT)
NOW = local_ms(2026, 11, 24, 10, tz=PARIS)
DAY = 86400000
DEVS = ('iPhone SE', 'iPhone 13')
CAPTURES = os.environ.get('PPL_CAPTURES', '')

ITEMS = [
    {'kind': 'weight', 'type': 'number', 'required': True},
    {'kind': 'measures', 'type': 'number', 'options': {'keys': ['waist', 'hips', 'thighL']}},
    {'kind': 'photos', 'type': 'photo', 'options': {'poses': ['face', 'side', 'back']}},
    {'kind': 'sleep', 'type': 'scale'},
    {'kind': 'energy', 'type': 'scale'},
    {'kind': 'hunger', 'type': 'scale'},
    {'kind': 'stress', 'type': 'scale', 'scale': 10},
    {'kind': 'diet_adherence', 'type': 'auto'},
    {'kind': 'training_adherence', 'type': 'auto'},
    {'kind': 'steps', 'type': 'number'},
    {'kind': 'pain', 'type': 'yesno'},
    {'kind': 'cycle', 'type': 'choice'},
    {'kind': 'custom', 'key': 'qdiffic01', 'type': 'text', 'label': 'Ta plus grande difficulté cette semaine ?'},
]


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def capture(page, name, full=True):
    """Capture de l'écran (lot) ; full : l'écran entier en tranches de la hauteur du téléphone (barres fixes à leur place,
    comme on le voit), name-1.png, name-2.png… dans $PPL_CAPTURES."""
    path = shot(page, LOT, name)
    if not CAPTURES:
        return path
    os.makedirs(CAPTURES, exist_ok=True)
    base = os.path.join(CAPTURES, name.replace(' ', '_'))
    if not full:
        page.screenshot(path=base + '.png')
        return path
    total, vh = page.evaluate('[document.documentElement.scrollHeight, innerHeight]')
    y, i = 0, 1
    while i <= 6:
        page.evaluate('y => window.scrollTo(0, y)', y)
        settle(page)
        page.screenshot(path=f'{base}-{i}.png')
        if y + vh >= total:
            break
        y += vh - 160
        i += 1
    page.evaluate('window.scrollTo(0, 0)')
    return path


def big_text(page):
    page.add_style_tag(content='html { font-size: 33px !important; }')
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    settle(page)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small_targets(page, scope='#app'):
    sel = f'{scope} button, {scope} input, {scope} textarea, .sheet button'
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => getComputedStyle(e).visibility !== 'hidden')
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def cut_texts(page, scope='#app'):
    return page.evaluate("""s => [...document.querySelectorAll(s + ' *, .sheet *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, select, option, svg, use, .icon *, .visually-hidden') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline'
        && getComputedStyle(e).visibility !== 'hidden')
        .map(e => e.textContent.trim().slice(0, 30))""", scope)


def unlabeled(page, scope):
    return page.evaluate("""s => [...document.querySelectorAll(s + ' button')].filter(e => e.offsetParent)
        .filter(e => !(e.getAttribute('aria-label') || e.textContent).trim()).length""", scope)


def layout(page, t, name, scope='#app'):
    """scope : la partie vérifiée (accueil : la carte du bilan seulement, les autres cartes ont leurs propres tests)."""
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page, scope)
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page, scope)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')
    R.check(unlabeled(page, scope) == 0, f'{t} {name} : chaque bouton a un nom parlé')


def toast(page):
    return page.locator('.toast').last.inner_text() if page.locator('.toast').count() else ''


def open_app(page, theme, vault=True):
    page.add_init_script('window.__fakeOpts = %s;' % json.dumps({'oldAccounts': True, 'uidStart': 1}))
    page.add_init_script(FAKE_ACCOUNT)
    page.add_init_script(FAKE_CHECKINS)
    if not vault:
        page.add_init_script('window.__noVault = true;')
    page.add_init_script(VAULT)
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2_today_json(now_ms=NOW), extra={'ppl_welcome_seen': '1'})
    settle(page)


def student_page(page, theme, items=ITEMS, cycle_asked=True, adult=True, **kw):
    """Je suis lea, élève d'alex (coach) ; alex m'a envoyé « Bilan de la semaine » il y a une heure, à rendre demain.
    Pesées, mensurations et diète connues de l'app ; adult : « 18 ans ou plus » déjà déclaré (photos de bilan) ; accord
    daté des bilans PAS encore donné (demandé au premier envoi). → { alex, lea, req }"""
    open_app(page, theme, **kw)
    ax = page.evaluate("() => __sb.addPerson({ username: 'alex', avatar: '🦁', social: false })")
    page.evaluate("""async u => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: u }); }""", 'lea')
    settle(page)
    ids = page.evaluate("""([ax, items, asked, adult]) => { const me = __sb.meId(); __sb.makeCoach(ax); __sb.link(ax, me, Date.now() - 40 * 86400000);
        if (!asked) __sb.ckCycleAsked = false;
        if (adult) __sb.co.adults[me] = new Date().toISOString();
        const req = __sb.ckRequest(ax, me, { name: 'Bilan de la semaine', items, sentAt: Date.now() - 3600000, dueAt: Date.now() + 86400000 });
        return { alex: ax, lea: me, req }; }""", [ax, items, cycle_asked, adult])
    # Ce que l'app sait : pesée de ce matin, mensurations, cinq jours de diète suivis sur sept (résumés du jour factices)
    page.evaluate("""now => { data.bodyWeightLog = [{ date: now - 2 * 3600000, kg: 62.2 }, { date: now - 3 * 86400000, kg: 62.9 }];
        data.bodyMeasures = { waist: [{ date: now - 2 * 86400000, cm: 68.5 }], hips: [{ date: now - 2 * 86400000, cm: 94.5 }] };
        save();
        window.dietShareDay = (d, day) => day === localISO(now - 3 * 86400000) ? null
          : ({ day, kcal: 2000, p: 150, goal: { kcal: day === localISO(now - 4 * 86400000) ? 2600 : 2000, p: 150 }, meals: [] }); }""", NOW)
    page.evaluate('coachRefresh()')
    settle(page)
    page.evaluate('checkinRefresh()')
    settle(page)
    page.evaluate('render()')
    settle(page)
    return ids


def open_bilan(page):
    page.click('.ck-home [data-action="ck-open"]')
    page.wait_for_selector('.ck-view .ck-head')
    settle(page)


def confirm_send(page, ax_name='alex'):
    page.click('.ck-view button.ck-send')
    page.wait_for_selector('.ios-dialog')
    # Premier envoi : accord daté pour les données de santé, puis la confirmation
    if 'Accord pour tes bilans' in page.inner_text('.ios-dialog'):
        tap_dialog(page, "J'accepte")
        page.wait_for_selector(f'.ios-dialog__btn:has-text("Envoyer à {ax_name}")')
    tap_dialog(page, f'Envoyer à {ax_name}')
    page.wait_for_selector('.ck-view--done')
    settle(page)


def sessions_expected(page, req):
    return page.evaluate("id => { const r = checkinById(id), p = checkinPeriod(r); return { done: (data.history || []).filter(h => h.date >= p.from && h.date < p.to).length, of: checkinPlanned(p.days, weeklyGoal()) }; }", req)


def t_remplir(bench, eng, dev, theme):
    """Carte d'accueil, préremplissage, échelles, brouillon après « Plus tard » et rechargement, envoi, réponse du coach."""
    if dev not in DEVS:
        R.skip(f'{dev} : bilans vérifiés sur iPhone SE et iPhone 13')
        return
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        ids = student_page(page, theme)
        card = page.locator('.ck-home')
        R.check(card.count() == 1, f'{t} accueil : carte « Bilan à remplir »')
        txt = card.inner_text()
        R.check('Bilan à remplir' in txt and 'Bilan de la semaine' in txt and "d'alex" in txt and 'à rendre demain' in txt, f'{t} carte : nom, coach, date ({txt!r})')
        card.scroll_into_view_if_needed()
        layout(page, t, 'Accueil', '.ck-home')
        capture(page, f'accueil-carte-{t}', full=False)
        # Un seul toucher : pointerdown ne change rien
        before = page.inner_html('#app')
        page.dispatch_event('.ck-home [data-action="ck-open"]', 'pointerdown')
        page.dispatch_event('.ck-home [data-action="ck-open"]', 'touchstart')
        R.check(page.inner_html('#app') == before, f'{t} carte : pointerdown ne révèle rien')
        open_bilan(page)
        head = page.inner_text('.ck-head')
        R.check("alex t'a demandé ton bilan" in head and 'Du 18 au 24 nov.' in head and 'à rendre demain' in head and 'minute' in head, f'{t} en-tête ({head!r})')
        R.check(page.inner_text('#ckTitle').strip() == 'Bilan de la semaine' and page.locator('.navbar:not(.navbar--collapsed) .navbar__title:visible').count() in (0, 1),
                f'{t} titre du bilan, une fois (repris par la barre au défilement)')
        # Préremplissage
        R.check(page.input_value('#ck-in-weight') == '62,2', f'{t} poids : dernière pesée ({page.input_value("#ck-in-weight")!r})')
        R.check("Ta dernière pesée, aujourd'hui" in page.inner_text('#ck-i-weight'), f'{t} poids : d\'où vient la valeur')
        R.check(page.input_value('#ck-in-measures-waist') == '68,5' and page.input_value('#ck-in-measures-hips') == '94,5'
                and page.input_value('#ck-in-measures-thighL') == '', f'{t} mensurations connues, cuisse à remplir')
        diet = page.inner_text('#ck-i-diet_adherence .ck-auto')
        R.check(diet == '5 jours sur 7', f'{t} diète : 5 jours sur 7 ({diet!r})')
        exp = sessions_expected(page, ids['req'])
        seances = page.inner_text('#ck-i-training_adherence .ck-auto')
        R.check(seances == f"{min(exp['done'], exp['of'])} sur {exp['of']}", f'{t} séances de la période ({seances!r}, attendu {exp})')
        R.check(page.input_value('#ck-in-steps') == '', f'{t} pas : à remplir (pas de lecture de Santé)')
        R.check(page.locator('#ck-i-cycle').count() == 0, f'{t} cycle : absent sans accord')
        R.check(page.locator('.ck-offer').count() == 1, f'{t} cycle : proposé, facultatif')
        # Échelle : radiogroup, aria-checked, bornes lues, focus gardé
        grp = page.locator('#ck-i-sleep [role="radiogroup"]')
        R.check(grp.count() == 1 and page.get_attribute('#ck-i-sleep [data-v="1"]', 'aria-label') == '1 sur 5, Mal'
                and page.get_attribute('#ck-i-sleep [data-v="5"]', 'aria-label') == '5 sur 5, Très bien', f'{t} sommeil : radiogroup, bornes lues')
        R.check(page.locator('#ck-i-stress [role="radio"]').count() == 10, f'{t} stress : échelle de 1 à 10')
        before = page.inner_html('#app')
        page.dispatch_event('#ck-i-sleep [data-v="3"]', 'pointerdown')
        R.check(page.inner_html('#app') == before, f'{t} échelle : pointerdown ne change rien')
        page.click('#ck-i-sleep [data-v="3"]')
        R.check(page.get_attribute('#ck-i-sleep [data-v="3"]', 'aria-checked') == 'true'
                and page.evaluate("document.activeElement?.matches('#ck-i-sleep [data-v=\"3\"]')"), f'{t} échelle : choisi, focus gardé')
        page.click('#ck-i-energy [data-v="4"]')
        page.click('#ck-i-pain [data-v="yes"]')
        R.check(page.locator('#ck-i-pain textarea').count() == 1, f'{t} douleurs : oui ouvre la précision')
        page.fill('#ck-i-pain textarea', 'Genou droit depuis jeudi')
        page.fill('#ck-in-qdiffic01', "La collation de 16 h au travail, je n'ai pas toujours le temps.")
        page.click('#ck-i-hunger [data-action="ck-skip"]')
        R.check('Passé' in page.inner_text('#ck-i-hunger'), f'{t} faim : passée')
        layout(page, t, 'Bilan')
        capture(page, f'bilan-{t}')
        # Plus tard, puis rechargement : le brouillon revient
        page.click('[data-action="ck-later"]')
        page.wait_for_selector('.view.dashboard')
        R.check('Brouillon gardé' in toast(page), f'{t} « Plus tard » : brouillon gardé ({toast(page)!r})')
        # Mémoire de l'app vidée (comme une app relancée : le faux serveur ne survit pas à un vrai rechargement) : le
        # brouillon vient de l'appareil
        R.check('collation' in (ls(page, 'mdlf_checkin_drafts') or ''), f'{t} brouillon écrit sur l\'appareil')
        page.evaluate("() => { ckReset(account.user.id); ckForm = { id: null, answers: {}, skipped: new Set(), from: {}, touched: new Set(), bad: new Set() }; }")
        page.evaluate('checkinRefresh()')
        settle(page)
        page.evaluate('render()')
        page.wait_for_selector('.ck-home')
        open_bilan(page)
        R.check(page.get_attribute('#ck-i-sleep [data-v="3"]', 'aria-checked') == 'true' and 'collation' in page.input_value('#ck-in-qdiffic01')
                and 'Genou' in page.input_value('#ck-i-pain textarea') and 'Passé' in page.inner_text('#ck-i-hunger'), f'{t} brouillon repris après rechargement')
        # Poids obligatoire vidé : rien ne part
        page.fill('#ck-in-weight', '')
        page.click('.ck-view button.ck-send')
        settle(page)
        R.check('Poids' in toast(page) and page.locator('.ios-dialog').count() == 0, f'{t} obligatoire vide : dit, rien ne part ({toast(page)!r})')
        page.fill('#ck-in-weight', '12')
        page.locator('#ck-in-weight').blur()
        page.click('.ck-view button.ck-send')
        settle(page)
        R.check('25' in page.inner_text('#ck-i-weight') and page.locator('.ios-dialog').count() == 0, f'{t} poids hors bornes : dit sous le champ')
        page.fill('#ck-in-weight', '62,4')
        confirm_send(page)
        R.check('Envoyé à alex' in page.inner_text('.ck-done'), f'{t} état « Envoyé »')
        R.check(page.evaluate("document.activeElement?.id") == 'ckTitle', f'{t} focus sur l\'état après l\'envoi')
        ans = page.evaluate("id => __sb.ck.answers[id]", ids['req'])
        R.check(ans and ans.get('weight') == 62.4 and ans.get('sleep') == 3 and ans.get('energy') == 4 and 'hunger' not in ans
                and ans.get('pain', {}).get('yes') is True and ans.get('measures') == {'waist': 68.5, 'hips': 94.5}
                and ans.get('diet_adherence') == {'done': 5, 'of': 7} and 'collation' in ans.get('qdiffic01', ''), f'{t} réponses reçues par le serveur ({ans})')
        n = page.evaluate("() => __sb.calls.filter(c => c[1] === 'student_checkin_answer').length")
        R.check(n == 1, f'{t} un seul envoi ({n})')
        h = page.evaluate("() => __sb.ck.health[__sb.meId()]")
        R.check(h and h.get('version') == 1 and h.get('at'), f'{t} accord daté enregistré au premier envoi ({h})')
        layout(page, t, 'Envoyé')
        capture(page, f'bilan-envoye-{t}', full=False)
        # Réponse du coach
        page.evaluate("id => __sb.ckReview(id, { reply: 'Belle semaine, garde ce sommeil.', score: 8 })", ids['req'])
        page.evaluate('checkinRefresh()')
        settle(page)
        done = page.inner_text('.ck-view--done')
        R.check('Réponse d\'alex' in done and 'Belle semaine' in done and 'Note' not in done and '8 sur 10' not in done, f'{t} réponse du coach, sans sa note')
        R.check('Tes réponses' in done and '62,4' in done.replace('\u202f', ' '), f'{t} récapitulatif de mes réponses gardé')
        capture(page, f'bilan-reponse-{t}', full=False)
        page.click('[data-action="back"]')
        page.wait_for_selector('.view.dashboard')
        R.check(page.locator('.ck-home').count() == 0 or 'Bilan à remplir' not in page.inner_text('.ck-home'), f'{t} accueil : plus de bilan à remplir')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_ax33(bench, eng, dev, theme):
    """Texte agrandi : rien de coupé, cibles de 44 pt, remplir et envoyer."""
    if dev not in DEVS:
        R.skip(f'{dev} : bilans vérifiés sur iPhone SE et iPhone 13')
        return
    t = tag(dev, theme) + '-AX33'
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        ids = student_page(page, theme)
        big_text(page)
        page.locator('.ck-home').scroll_into_view_if_needed()
        layout(page, t, 'Accueil', '.ck-home')
        capture(page, f'accueil-carte-{t}', full=False)
        open_bilan(page)
        layout(page, t, 'Bilan')
        icon_h = page.evaluate("() => document.querySelector('#ck-i-weight .ck-ico .icon').getBoundingClientRect().height")
        R.check(icon_h >= 30, f'{t} icônes agrandies avec le texte ({icon_h:.0f} px)')
        capture(page, f'bilan-{t}')
        page.click('#ck-i-sleep [data-v="4"]')
        confirm_send(page)
        R.check(page.evaluate("id => !!__sb.ck.requests.find(r => r.id === id).answered_at", ids['req']), f'{t} envoyé en texte agrandi')
        layout(page, t, 'Envoyé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_cycle(bench, eng, dev, theme):
    """Cycle : refusé par le serveur sans accord ; accord explicite (18 ans ou plus), phase envoyée ; retrait ;
    jamais proposé ni montré avec une tranche d'âge Apple 15-17 ans."""
    if dev not in DEVS:
        R.skip(f'{dev} : bilans vérifiés sur iPhone SE et iPhone 13')
        return
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        ids = student_page(page, theme)
        page.evaluate("() => __sb.ckHealth(__sb.meId())")
        # Serveur : une phase envoyée sans accord est refusée
        r = page.evaluate("async id => (await sb.rpc('student_checkin_answer', { request: id, answers: { weight: 62, cycle: 'luteal' } })).error?.message", ids['req'])
        R.check(r == 'no_consent', f'{t} serveur : no_consent sans accord ({r})')
        open_bilan(page)
        page.click('[data-action="ck-cycle-offer"]')
        page.wait_for_selector('.sheet .ckc__go')
        sh = page.inner_text('.sheet')
        R.check('voit seulement la phase' in sh and 'Retirer mon accord' in sh and page.is_disabled('.sheet .ckc__go'), f'{t} accord : ce que voit le coach, comment retirer, bouton éteint')
        layout(page, t, 'Accord du cycle')
        capture(page, f'cycle-accord-{t}', full=False)
        page.click('.sheet [data-ckc="adult"]')
        R.check(page.get_attribute('.sheet [data-ckc="adult"]', 'aria-checked') == 'true' and not page.is_disabled('.sheet .ckc__go'), f'{t} case cochée : bouton actif')
        page.click('.sheet .ckc__go')
        page.wait_for_selector('#ck-i-cycle')
        settle(page)
        R.check(page.locator('#ck-i-cycle [role="radio"]').count() == 5, f'{t} accord : cycle montré (5 choix)')
        page.click('#ck-i-cycle [data-v="follicular"]')
        R.check(page.get_attribute('#ck-i-cycle [data-v="follicular"]', 'aria-checked') == 'true', f'{t} phase choisie')
        layout(page, t, 'Bilan avec cycle')
        # Retrait : plus de cycle, retiré du brouillon
        page.click('#ck-i-cycle [data-action="ck-cycle-withdraw"]')
        tap_dialog(page, 'Retirer mon accord')
        settle(page)
        R.check(page.locator('#ck-i-cycle').count() == 0 and not page.evaluate("id => __sb.ck.cycle[__sb.meId()]", ids['req']), f'{t} retrait : cycle retiré')
        # Nouvel accord, envoi avec la phase
        page.click('[data-action="ck-cycle-offer"]')
        page.click('.sheet [data-ckc="adult"]')
        page.click('.sheet .ckc__go')
        page.wait_for_selector('#ck-i-cycle')
        page.click('#ck-i-cycle [data-v="luteal"]')
        confirm_send(page)
        ans = page.evaluate("id => __sb.ck.answers[id]", ids['req'])
        R.check(ans.get('cycle') == 'luteal', f'{t} phase envoyée avec l\'accord ({ans.get("cycle")})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')
    # Mineure (tranche 15-17 ans d'Apple) : ni proposition, ni suivi, même avec un accord ancien
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        ids = student_page(page, theme)
        page.evaluate("""() => { __sb.ck.cycle[__sb.meId()] = { coach: 'x', at: Date.now() };
            ageRange.stored = { status: 'sharing', lowerBound: 15, upperBound: 17, communicationLimits: false, at: Date.now() }; }""")
        page.evaluate('checkinRefresh()')
        settle(page)
        page.evaluate('render()')
        open_bilan(page)
        R.check(page.locator('#ck-i-cycle').count() == 0 and page.locator('[data-action="ck-cycle-offer"]').count() == 0, f'{t} 15-17 ans : cycle jamais proposé')
        R.check('18 ans' in page.inner_text('.ck-view'), f'{t} 15-17 ans : photos réservées aux 18 ans et plus, dit')
        r = page.evaluate("async () => (await checkinCycleSet(true, true)).kind")
        R.check(r == 'not_adult' and not page.evaluate("() => __sb.calls.some(c => c[1] === 'student_checkin_cycle')"), f'{t} 15-17 ans : accord refusé sans appel ({r})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_majeur_accord(bench, eng, dev, theme):
    """Libido et cycle réservés aux 18 ans et plus (déclaration demandée dans le bilan, refus du serveur sans elle) ;
    accord daté au premier envoi (annuler : rien ne part ; texte, version, date) ; retrait dans Mon coach."""
    if dev not in DEVS:
        R.skip(f'{dev} : bilans vérifiés sur iPhone SE et iPhone 13')
        return
    t = tag(dev, theme)
    items = [{'kind': 'sleep', 'type': 'scale'}, {'kind': 'libido', 'type': 'scale'}, {'kind': 'cycle', 'type': 'choice'}]
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        ids = student_page(page, theme, items=items, adult=False)
        open_bilan(page)
        R.check(page.locator('#ck-i-libido').count() == 0 and page.locator('[data-action="ck-cycle-offer"]').count() == 0, f'{t} sans déclaration : ni libido ni cycle')
        R.check(page.locator('.ck-offer--adult [data-action="ck-adult"]').count() == 1, f'{t} déclaration des 18 ans proposée')
        r = page.evaluate("async id => { await sb.rpc('student_checkin_consent', { accept: true, version: 1 }); const e = (await sb.rpc('student_checkin_answer', { request: id, answers: { libido: 3 } })).error?.message; await sb.rpc('student_checkin_consent', { accept: false }); return e; }", ids['req'])
        R.check(r == 'not_adult', f'{t} serveur : libido refusée sans déclaration ({r})')
        page.evaluate('checkinRefresh()')
        settle(page)
        layout(page, t, 'Bilan sans déclaration')
        capture(page, f'majeur-propose-{t}')
        page.click('[data-action="ck-adult"]')
        page.wait_for_selector('.ios-dialog')
        tap_dialog(page, "J'ai 18 ans ou plus")
        page.wait_for_selector('#ck-i-libido')
        settle(page)
        R.check(page.locator('.ck-offer--adult').count() == 0 and page.locator('[data-action="ck-cycle-offer"]').count() == 1, f'{t} déclaré : libido montrée, cycle proposé')
        page.click('#ck-i-libido [data-v="3"]')
        # Premier envoi : l'accord daté ; Annuler → rien ne part
        page.click('.ck-view button.ck-send')
        page.wait_for_selector('.ios-dialog')
        txt = page.inner_text('.ios-dialog')
        R.check("J'accepte d'envoyer à alex mes réponses de bilan (données de santé)." in txt and 'retirer' in txt, f'{t} texte de l\'accord ({txt!r})')
        layout(page, t, 'Accord des bilans', '.ios-dialog')
        capture(page, f'accord-bilans-{t}', full=False)
        tap_dialog(page, 'Annuler')
        R.check(not page.evaluate("() => __sb.calls.some(c => c[1] === 'student_checkin_answer' && c[2]?.answers?.libido)") and page.locator('.ck-view--done').count() == 0, f'{t} accord refusé : rien ne part')
        confirm_send(page)
        ans = page.evaluate("id => __sb.ck.answers[id]", ids['req'])
        R.check(ans.get('libido') == 3, f'{t} libido envoyée après la déclaration ({ans})')
        # Mon coach : accord daté, retrait
        page.evaluate("() => navigate('coach-mine')")
        page.wait_for_selector('[data-action="ck-health-withdraw"]')
        R.check('Donné le' in page.inner_text('[data-action="ck-health-withdraw"]'), f'{t} Mon coach : accord avec sa date')
        page.click('[data-action="ck-health-withdraw"]')
        tap_dialog(page, 'Retirer mon accord')
        settle(page)
        R.check(not page.evaluate("() => __sb.ck.health[__sb.meId()]") and page.locator('[data-action="ck-health-offer"]').count() == 1, f'{t} accord retiré')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_bloquer_coach(bench, eng, dev, theme):
    """Bloquer son coach : la feuille dit que la conversation est effacée et le suivi coupé, propose « Signaler d'abord »
    (les messages sont joints), puis bloque ; Gérer dit que débloquer ne reprend pas le suivi."""
    if dev != 'iPhone 13':
        R.skip(f'{dev} : blocage du coach vérifié sur iPhone 13')
        return
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        ids = student_page(page, theme)
        page.evaluate("ax => { __sb.msg(__sb.meId(), true, 'Salut, on fait le point ?'); blockFlow(ax); }", ids['alex'])
        page.wait_for_selector('.ios-dialog')
        txt = page.inner_text('.ios-dialog')
        R.check('Bloquer efface votre conversation et coupe le suivi.' in txt, f'{t} feuille : effet dit ({txt!r})')
        layout(page, t, 'Bloquer son coach', '.ios-dialog')
        capture(page, f'bloquer-coach-{t}', full=False)
        tap_dialog(page, "Signaler d'abord")
        page.wait_for_selector('.ios-dialog__btn:has-text("Harcèlement")')
        tap_dialog(page, 'Harcèlement')
        settle(page)
        R.check(page.evaluate("() => __sb.calls.some(c => c[1] === 'report_chat')"), f'{t} signalement envoyé avant le blocage')
        R.check(page.evaluate("ax => __sb.so.blocks.some(k => k.blocker === __sb.meId() && k.blocked === ax)", ids['alex']), f'{t} bloqué ensuite')
        R.check(not page.evaluate("() => __sb.linkOf(__sb.meId())"), f'{t} lien coach coupé')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_photos_hors_ligne(bench, eng, dev, theme):
    """Photos déjà envoyées par le circuit chiffré : jointes au bilan. Hors ligne : gardé, envoyé au retour du réseau,
    une seule fois. Ouverture par notification (bilan, rappel)."""
    if dev not in DEVS:
        R.skip(f'{dev} : bilans vérifiés sur iPhone SE et iPhone 13')
        return
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        ids = student_page(page, theme)
        # Coach prêt à recevoir, une photo de face envoyée après la demande (état ready du serveur)
        pid = page.evaluate("""async ax => { const s = await vaultImportKey(bytesToB64(vaultRandom(32)));
            const { rec } = await coachKeyMake(s, ax, vaultNewId()); __sb.co.pkeys[ax] = rec; __sb.co.adults[__sb.meId()] = new Date().toISOString();
            const id = crypto.randomUUID();
            __sb.co.photos.push({ id, student: __sb.meId(), coach: ax, key_id: rec.key_id, taken_on: localISO(), pose: 'face', epk: 'x', iv: 'y', state: 'ready',
              bytes: 1000, created_at: Date.now(), sent_at: new Date(Date.now() - 600000).toISOString() });
            await cphRefresh(); return id; }""", ids['alex'])
        # Notification : l'écran du bilan s'ouvre
        page.evaluate("id => openPushTarget({ kind: 'checkin_reminder', ref: id })", ids['req'])
        page.wait_for_selector('.ck-view .ck-head')
        settle(page)
        R.check(page.evaluate('view') == 'checkin', f'{t} rappel : écran du bilan')
        tiles = page.inner_text('.ck-tiles')
        R.check('Face' in tiles and 'Envoyée' in tiles and page.locator('.ck-tile[data-action="ck-photo"]').count() == 2, f'{t} photos : face envoyée, profil et dos à ajouter')
        layout(page, t, 'Bilan photos')
        page.locator('.ck-tiles').scroll_into_view_if_needed()
        capture(page, f'bilan-photos-{t}', full=False)
        # Hors ligne : gardé
        page.evaluate("() => { __sb.fail.checkins = 'offline'; }")
        confirm_send(page)
        done = page.inner_text('.ck-done')
        R.check('En attente du réseau' in done, f'{t} hors ligne : en attente ({done!r})')
        R.check(page.evaluate("id => !__sb.ck.requests.find(r => r.id === id).answered_at", ids['req']), f'{t} hors ligne : rien sur le serveur')
        page.click('[data-action="back"]')
        page.wait_for_selector('.view.dashboard')
        R.check(page.locator('.ck-home').count() == 0, f'{t} hors ligne : plus de carte « à remplir »')
        page.evaluate("() => { __sb.fail.checkins = null; window.dispatchEvent(new Event('online')); }")
        page.wait_for_function("id => !!__sb.ck.requests.find(r => r.id === id).answered_at", arg=ids['req'], timeout=8000)
        settle(page)
        ans = page.evaluate("id => __sb.ck.answers[id]", ids['req'])
        R.check(ans.get('photos') == {'ids': [pid]}, f'{t} photo jointe au bilan ({ans.get("photos")})')
        R.check(page.evaluate("id => __sb.ck.answers[id] && Object.keys(__sb.ck.answers[id]).length", ids['req']) >= 2, f'{t} retour du réseau : envoyé')
        page.evaluate("id => openPushTarget({ kind: 'checkin', ref: id })", ids['req'])
        page.wait_for_selector('.ck-view--done')
        R.check('Envoyé à alex' in page.inner_text('.ck-done'), f'{t} notification d\'un bilan envoyé : son état')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_remplir, t_ax33, t_cycle, t_majeur_accord, t_bloquer_coach, t_photos_hors_ligne])
