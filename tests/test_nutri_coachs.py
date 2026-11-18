"""Retours des coachs du 18/11 (docs/NUTRITION_V1.md, « Retours des coachs du 18/11 ») :
- éditeur du coach : recherche d'abord (« Produit de marque ? Scanner » ensuite), « Crème de riz », semaine de 7 jours,
  copier un repas vers des jours cochés, « Mettre pareil sur les 7 jours » (confirmation, Annuler), objectifs en
  fourchette (eau, sel, repère de l'OMS dit au coach), aperçu par jour et envoi à plusieurs élèves ;
- élève : plan entraînement / repos choisi par la séance du jour, « Changer » d'un toucher, « Remplacer » visible
  (riz blanc cuit 175 g pour 350 g de pomme de terre), eau en verres (3 à 5 L, verres de 1 L), sel du jour et sel ajouté.
iPhone SE et iPhone 13, clair et sombre, texte agrandi sur iPhone SE. Captures : $PPL_SCRATCH/shots/lotnutri_coachs/.
Lancer : python3 test_nutri_coachs.py (ou run_all.py nutri_coachs).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from fake_account import FAKE_ACCOUNT

LOT = 'nutri_coachs'
R = Results(LOT)
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
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, json.dumps(d, ensure_ascii=False), extra={'ppl_welcome_seen': '1'})
    page.wait_for_timeout(300)


def signin(page, username):
    page.evaluate("async u => { await accountSignInWith('apple', async () => 'add'); await accountSaveProfile({ username: u }); }", username)
    page.wait_for_timeout(200)


def toast(page):
    return nb(page.locator('.toast').inner_text()) if page.locator('.toast').count() else ''


def big_text(page):
    page.add_style_tag(content='html { font-size: 28px !important; }')
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    page.wait_for_timeout(300)


def layout(page, t, name, scope):
    R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} {name} : pas de défilement horizontal')
    small = page.evaluate("""s => [...document.querySelectorAll(s + ' button')].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", scope)
    R.check(not small, f'{t} {name} : cibles de 44 pt {small}')
    cut = page.evaluate("""s => [...document.querySelectorAll(s + ' *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .sr-text') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""", scope)
    R.check(not cut, f'{t} {name} : aucun texte coupé {cut}')
    R.check(not page.errors, f'{t} {name} : aucune erreur JS {page.errors[:2]}')


def t_editeur(bench):
    """Coach : semaine de 7 jours, recherche avant scan, « Crème de riz », copies, objectifs en fourchette, aperçu, envoi."""
    for dev in DEVS:
        for theme in ('light', 'dark'):
            t = tag(dev, theme)
            with bench.frozen_page(NOW, ENG[dev], dev, theme) as page:
                d = ppl_v2_today(now_ms=NOW)
                d['dietPlans'] = {'d_seche001': plan_coach()}
                d['dietConsent'] = {'on': True, 'at': '2026-11-01T10:00:00.000Z'}   # accord déjà donné : pas de question
                d['dietConsentAsked'] = True
                open_app(page, theme, d, account=True)
                signin(page, 'max')
                lea = page.evaluate("""() => { const me = __sb.meId(); __sb.makeCoach(me);
                    const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false }); __sb.link(me, lea);
                    const tom = __sb.addPerson({ username: 'tom', avatar: '🐼', social: false }); __sb.link(me, tom);
                    for (const s of [lea, tom]) __sb.co.shares.push({ student: s, coach: me, kind: 'diet', granted_at: new Date().toISOString() });
                    return lea; }""")
                page.evaluate('coachRefresh()')
                page.wait_for_timeout(300)
                page.evaluate("switchTab('program', { reset: true }); navigate('diet-plans')")
                page.wait_for_selector('.diet-plans-view')
                R.check('Mes diètes' in page.inner_text('.diet-plans-view'), f'{t} coach : « Mes diètes »')
                page.evaluate("navigate(makeRoute('diet-plan', 'd_seche001'))")
                page.wait_for_selector('[data-action="diet-days-mode"]')
                page.wait_for_timeout(800)
                # Jours : semaine
                page.click('[data-action="diet-days-mode"]')
                page.wait_for_selector('.ios-dialog__btn')
                page.wait_for_timeout(400)
                tap_dialog(page, 'Semaine (lundi à dimanche)')
                page.wait_for_timeout(300)
                R.check(page.locator('.diet-dayrow').count() == 7 and toast(page).startswith('7 jours, copies du premier jour') and 'Annuler' in toast(page), f'{t} semaine : 7 jours, toast clair, Annuler ({toast(page)!r})')
                # Semaine réaliste pour les captures : mardi, samedi et dimanche de repos, 2 000 kcal et moins de féculents
                page.evaluate("""() => { const p = data.dietPlans.d_seche001; p.days.kinds = ['t', 'r', 't', 't', 't', 'r', 'r'];
                    for (const i of [0, 4, 5]) { const o = p.days.more[i]; o.targets = { ...o.targets, kcal: 2000, c: 200 };
                      o.meals[1].items[0].g = 50; o.meals[1].items[1].g = 120; o.meals[0].items[0].g = 250; } save(); render(); }""")
                page.wait_for_timeout(200)
                layout(page, t, 'vue des jours', '.diet-plan-view .scr')
                shot(page, LOT, f'1-semaine-{t}')
                # Lundi
                page.click('.diet-dayrow[data-dayi="0"]')
                page.wait_for_selector('.diet-dayswipe')
                R.check(page.locator('.diet-daypick .diet-week__day').count() == 7, f'{t} lundi : choix des 7 jours')
                page.click('[data-action="diet-day-set-kind"][data-k="t"]')
                layout(page, t, 'lundi', '.diet-plan-view .scr')
                shot(page, LOT, f'2-lundi-{t}')
                # Ajouter un aliment : recherche d'abord, scan ensuite
                page.locator('[data-action="diet-add-food"]').first.click()
                page.wait_for_selector('.sheet .diet-pick')
                order = page.evaluate("[...document.querySelectorAll('.sheet .diet-pick > *')].map(e => e.className.split(' ').pop())")
                R.check(order.index('diet-pick__search') < order.index('diet-cand--scan'), f'{t} feuille : recherche avant le scan ({order[:3]})')
                scan = nb(page.inner_text('.sheet .diet-cand--scan')).strip()
                R.check(scan in ('Produit de marque ? Scanner', 'Produit de marque ? Saisir le code-barres'), f'{t} « {scan} »')
                page.fill('#dietFoodSearch', 'crème de riz')
                page.wait_for_timeout(250)
                first = nb(page.locator('.sheet .diet-pick__list .diet-cand').first.inner_text())
                R.check('Crème de riz' in first and 'Valeurs Ciqual : Farine de riz' in first, f'{t} « Crème de riz », source dite ({first[:60]!r})')
                shot(page, LOT, f'3-recherche-{t}')
                page.locator('.sheet .diet-pick__list .diet-cand').first.click()
                page.wait_for_timeout(300)
                if page.locator('.ios-dialog__input').count():
                    page.fill('.ios-dialog__input', '60')
                    tap_dialog(page, 'OK')
                else:
                    page.click('.sheet__btn--confirm')
                page.wait_for_timeout(300)
                R.check(toast(page).startswith('Ajouté : Crème de riz') and 'Annuler' in toast(page), f'{t} ajout : toast avec Annuler ({toast(page)!r})')
                R.check(page.evaluate("data.dietPlans.d_seche001.meals[0].items.some(x => x.name === 'Crème de riz' && x.food === 9520)"), f'{t} crème de riz dans le lundi')
                # Copier le déjeuner vers mardi et jeudi
                page.locator('[data-action="diet-meal-menu"]').first.click()
                tap_dialog(page, "Copier vers d'autres jours…")
                page.wait_for_selector('.sheet .diet-dpick')
                page.click('.sheet [data-dpick="1"]')
                page.click('.sheet [data-dpick="3"]')
                shot(page, LOT, f'4-copier-repas-{t}')
                page.click('.sheet__btn--confirm')
                page.wait_for_timeout(300)
                got = page.evaluate("[1, 3, 2].map(i => data.dietPlans.d_seche001.days.more[i - 1].meals[0].items.some(x => x.name === 'Crème de riz'))")
                R.check(got == [True, True, False], f'{t} déjeuner copié vers mardi et jeudi, pas mercredi ({got})')
                # Mettre pareil sur les 7 jours : confirmation, puis Annuler
                page.click('[data-action="diet-day-all"]')
                page.wait_for_selector('.ios-dialog')
                R.check('Mettre lundi sur les 7 jours' in nb(page.inner_text('.ios-dialog')), f'{t} confirmation sobre')
                tap_dialog(page, 'Remplacer')
                R.check(page.evaluate("data.dietPlans.d_seche001.days.more.every(o => o.meals[0].items.some(x => x.name === 'Crème de riz'))"), f'{t} 7 jours pareils')
                page.locator('.toast__action').click()
                page.wait_for_timeout(250)
                R.check(not page.evaluate("data.dietPlans.d_seche001.days.more[1].meals[0].items.some(x => x.name === 'Crème de riz')"), f'{t} Annuler : mercredi comme avant')
                # Jours de repos : mardi marqué repos, le lundi passé en repos se copie d'un toucher vers « les autres jours de repos »
                page.click('[data-action="diet-goto-day"][data-dayi="1"]')
                page.click('[data-action="diet-day-set-kind"][data-k="r"]')
                page.click('[data-action="diet-goto-day"][data-dayi="0"]')
                page.click('[data-action="diet-day-set-kind"][data-k="r"]')
                same = page.locator('[data-action="diet-day-same"]')
                R.check(same.count() == 1 and 'mardi' in same.inner_text(), f'{t} « Copier vers les autres jours de repos » : mardi')
                same.scroll_into_view_if_needed()
                shot(page, LOT, f'2b-jours-repos-{t}')
                same.click()
                tap_dialog(page, 'Copier')
                R.check(toast(page).startswith('Lundi copié : mardi') and page.evaluate("data.dietPlans.d_seche001.days.kinds[1]") == 'r', f'{t} lundi copié sur mardi, jour de repos ({toast(page)!r})')
                page.locator('.toast__action').click()
                page.wait_for_timeout(250)
                page.click('[data-action="diet-day-set-kind"][data-k="t"]')
                page.wait_for_timeout(400)
                # Objectifs : eau 3 à 5 L, sel 3 à 7 g (repère de l'OMS dit, rien de bloqué)
                page.click('[data-action="diet-targets"]')
                page.wait_for_selector('#dietT_saltMax')
                page.wait_for_timeout(400)   # feuille ouverte
                page.fill('#dietT_saltMax', '7')
                page.wait_for_timeout(300)
                R.check("moins de 5 g" in nb(page.inner_text('#dietTSaltNote')), f'{t} sel au-dessus de 5 g : repère de l\'OMS dit au coach')
                shot(page, LOT, f'5-objectifs-{t}')
                if dev == 'iPhone SE':
                    big_text(page)
                    layout(page, t + '-xl', 'objectifs', '.sheet')
                    shot(page, LOT, f'5b-objectifs-xl-{t}')
                page.click('.sheet__btn--confirm')
                page.wait_for_timeout(300)
                R.check(page.evaluate("data.dietPlans.d_seche001.targets.saltMax") == 7, f'{t} sel 7 g gardé')
                # Aperçu et envoi à deux élèves
                page.evaluate("navigate(makeRoute('diet-send', 'd_seche001'))")
                page.wait_for_selector('.diet-send-view')
                R.check(page.locator('.diet-sendday').count() == 7, f'{t} aperçu : 7 jours')
                txt = nb(page.inner_text('.diet-sendday >> nth=0'))
                R.check('kcal' in txt and 'Eau 3 à 5 L' in txt and 'Sel 3 à 7 g' in txt, f'{t} aperçu du lundi : kcal, eau, sel ({txt[:120]!r})')
                page.click('[data-action="diet-send-all"]')
                layout(page, t, 'aperçu', '.diet-send-view')
                shot(page, LOT, f'6-apercu-{t}')
                page.click('#dietSendGo')
                page.wait_for_selector('.ios-dialog')
                dlg = nb(page.inner_text('.ios-dialog'))
                R.check('Envoyer « Sèche semaine 1 » à lea et tom ?' in dlg and 'Ce qu\'il a déjà coché reste' in dlg and 'Samedi : il manque 173 kcal' in dlg and 'Mardi : 122 kcal en trop' in dlg and 'Revoir les jours' in dlg, f'{t} confirmation : élèves nommés, jours incomplets dits ({dlg[:120]!r})')
                shot(page, LOT, f'6b-confirmation-{t}')
                tap_dialog(page, 'Envoyer')
                page.wait_for_timeout(800)
                sent = page.evaluate("__sb.co.progs.filter(p => p.id === dietSentId('d_seche001')).map(p => [p.student, p.data.v, p.data.diet.days.mode, p.data.diet.meals.length])")
                R.check(len(sent) == 2 and all(s[1] == 1 and s[2] == 'week' and s[3] == 4 for s in sent), f'{t} envoyé à 2 élèves, format v1 + jours ({sent})')
                R.check(page.evaluate("!!data.dietPlans.d_seche001"), f'{t} le plan reste dans Mes diètes')
                R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


def plan_eleve():
    p = plan_coach()
    # Jour de repos : glucides baissés (riz 120 g, pain 50 g, pomme de terre 250 g), 2 000 kcal
    rest = json.loads(json.dumps({'meals': p['meals'], 'targets': {'kcal': 2000, 'p': 150, 'c': 200, 'f': 55, 'water': 5, 'waterMin': 3, 'saltMin': 3, 'saltMax': 5}}))
    rest['meals'][0]['items'][0]['g'] = 250
    rest['meals'][1]['items'][0]['g'] = 50
    rest['meals'][1]['items'][1]['g'] = 120
    p['days'] = {'mode': 'session', 'more': [rest]}
    p['fromCoach'] = {'coachId': 'c1', 'name': 'max', 'sentAt': 1}
    return p


def t_eleve(bench):
    """Élève : jour de repos sans séance, « Changer » d'un toucher, Remplacer, eau en verres, sel."""
    for dev in DEVS:
        for theme in ('light', 'dark'):
            t = tag(dev, theme)
            with bench.frozen_page(NOW, ENG[dev], dev, theme) as page:
                d = ppl_v2_today(now_ms=NOW)
                d['history'] = [h for h in d['history'] if h['date'] < NOW - 86400000]
                d['dietPlans'] = {'dc_c1_seche': plan_eleve()}
                d['dietActive'] = 'dc_c1_seche'
                d['dietEmptyDays'] = False
                open_app(page, theme, d)
                # Matin, pas encore de séance : pas « repos » d'office, la question du jour (accueil et Nutrition)
                R.check(page.locator('.diet-home .diet-home__ask').count() == 1, f'{t} accueil : « Séance aujourd\'hui ? » sur la carte Nutrition')
                R.check(page.evaluate("dietDayProgress(data, data.dietActive).goal.kcal") == 2300, f'{t} avant la réponse : menu du jour d\'entraînement')
                page.locator('.diet-home').scroll_into_view_if_needed()
                layout(page, t, 'accueil question', '.diet-home')
                shot(page, LOT, f'7a-accueil-question-{t}')
                page.evaluate("navigate('nutrition')")
                page.wait_for_selector('.nutrition-view .diet-dayask')
                shot(page, LOT, f'7b-question-{t}')
                page.click('.nutrition-view .diet-dayask [data-v="r"]')
                page.wait_for_selector('.nutrition-view .diet-dayline:not(.diet-dayask)')
                line = nb(page.inner_text('.diet-dayline'))
                R.check("Aujourd'hui : jour de repos" in line and 'Changer' in line and 'Pas de séance prévue' in line, f'{t} « Non » : jour de repos, retenu ({line[:70]!r})')
                R.check(page.evaluate("data.dietLog[localISO()].kindBy") == 'ask', f'{t} réponse gardée pour la journée')
                R.check(page.evaluate("dietDayProgress(data, data.dietActive).goal.kcal") == 2000, f'{t} repos : 2 000 kcal')
                layout(page, t, 'jour de repos', '.nutrition-view')
                shot(page, LOT, f'7-eleve-repos-{t}')
                page.click('[data-action="diet-day-kind"]')
                page.wait_for_timeout(250)
                R.check("jour d'entraînement" in nb(page.inner_text('.diet-dayline')) and page.evaluate("dietDayProgress(data, data.dietActive).goal.kcal") == 2300,
                        f'{t} « Changer » : jour d\'entraînement, 2 300 kcal')
                shot(page, LOT, f'8-eleve-entrainement-{t}')
                # Remplacer : visible sur l'aliment, quantité calculée
                row = page.locator('.diet-item[data-item="i1"]')
                R.check('Remplacer' in row.inner_text(), f'{t} « Remplacer » écrit sur l\'aliment')
                row.click()
                page.wait_for_selector('.sheet .diet-cands')
                cands = [nb(x) for x in page.locator('.sheet .diet-cand[data-swap]').all_inner_texts()]
                riz = [c for c in cands if c.startswith('Riz blanc, cuit')]
                R.check(riz and '175 g cuit' in riz[0] and '−13 kcal' in riz[0], f'{t} 350 g de pomme de terre → riz blanc cuit 175 g, −13 kcal ({riz[:1]})')
                R.check('Même quantité de glucides' in nb(page.inner_text('.sheet .diet-swap__rule')), f'{t} règle dite')
                page.wait_for_timeout(400)   # feuille ouverte (fin de l'animation) avant de mesurer les cibles
                layout(page, t, 'remplacer', '.sheet')
                shot(page, LOT, f'9-remplacer-{t}')
                page.locator('.sheet .diet-cand[data-swap]', has_text='Riz blanc, cuit').first.click()
                page.wait_for_timeout(300)
                R.check(page.evaluate("dietDay(data, data.dietActive, localISO()).swaps.i1.g") == 175, f'{t} remplacé : 175 g de riz')
                # Eau en verres : 3 à 5 L, verres de 1 L
                page.locator('.water-card').scroll_into_view_if_needed()
                R.check(page.locator('.water-cup').count() == 5 and 'objectif 3 à 5 L' in nb(page.inner_text('.water-card__val')), f'{t} eau : 5 verres de 1 L, 3 à 5 L')
                page.locator('.water-cup').first.click()
                page.wait_for_timeout(250)
                R.check(page.evaluate("waterDayMl(data, localISO())") == 1000 and page.locator('.water-cup--on').count() == 1, f'{t} un verre coché : 1 L')
                R.check(page.locator('.water-card [data-ml="250"]').count() >= 1, f'{t} boutons rapides gardés')
                layout(page, t, 'eau', '.water-card')
                shot(page, LOT, f'10-eau-{t}')
                # Sel : ligne du bilan, sel ajouté
                page.locator('.diet-salt').scroll_into_view_if_needed()
                R.check('objectif 3 à 5 g' in nb(page.inner_text('.diet-salt')), f'{t} sel : « objectif 3 à 5 g »')
                R.check('Pincée' in page.inner_text('.diet-salt__add') and '0,4' in nb(page.inner_text('.diet-salt__add')), f'{t} « + Pincée 0,4 g » dit ce qu\'il ajoute')
                page.click('.diet-salt__add')
                page.wait_for_timeout(200)
                R.check(abs(page.evaluate("saltAddedG(data, localISO())") - 0.4) < 1e-6 and 'Annuler' in toast(page), f'{t} pincée ajoutée d\'un toucher, Annuler')
                page.click('.diet-salt__open')
                page.wait_for_selector('.sheet .diet-saltsheet')
                page.click('.sheet [data-salt="6"]')
                page.wait_for_timeout(200)
                R.check(abs(page.evaluate("saltAddedG(data, localISO())") - 6.4) < 1e-6, f'{t} cuillère à café : 6 g de plus')
                R.check('USDA' in page.inner_text('.sheet .diet-saltsheet'), f'{t} source des mesures dite')
                layout(page, t, 'sel', '.sheet')
                shot(page, LOT, f'11-sel-{t}')
                page.click('.sheet__btn--confirm')
                page.wait_for_timeout(300)
                if dev == 'iPhone SE':
                    big_text(page)
                    page.evaluate('window.scrollTo(0, 0)')
                    layout(page, t + '-xl', 'Nutrition', '.nutrition-view .scr')
                    shot(page, LOT, f'12-eleve-xl-{t}')
                    page.locator('.water-card').scroll_into_view_if_needed()
                    shot(page, LOT, f'12b-eau-xl-{t}')
                R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


def t_eleve_semaine(bench):
    """Élève, plan à 7 jours : « Mercredi · Repos », la semaine s'ouvre, on glisse d'un jour à l'autre."""
    for theme in ('light', 'dark'):
        t = tag('iPhone SE', theme)
        with bench.frozen_page(NOW, ENG['iPhone SE'], 'iPhone SE', theme) as page:
            p = plan_coach()
            p['days'] = {'mode': 'week', 'kinds': ['t', 't', 'r', 't', 't', 'r', 'r'], 'more': [{'meals': p['meals'], 'targets': {'kcal': 2300 if k == 't' else 2000}} for k in 'trttrr']}
            p['fromCoach'] = {'coachId': 'c1', 'name': 'max', 'sentAt': 1}
            d = ppl_v2_today(now_ms=NOW)
            d['dietPlans'] = {'dc_c1_sem': p}
            d['dietActive'] = 'dc_c1_sem'
            d['dietEmptyDays'] = False
            open_app(page, theme, d)
            page.evaluate("navigate('nutrition')")
            page.wait_for_selector('.diet-dayline')
            R.check('Mercredi · Repos' in nb(page.inner_text('.diet-dayline')), f'{t} « Mercredi · Repos »')
            page.click('.diet-dayline [data-action="diet-open-day"]')
            page.wait_for_selector('.diet-dayswipe')
            R.check(page.evaluate("routeParams(currentRoute())[1]") == '2', f'{t} la semaine s\'ouvre sur mercredi')
            shot(page, LOT, f'13-semaine-eleve-{t}')
            box = page.locator('.diet-dayswipe').bounding_box()
            y = box['y'] + 200
            # Glissé simulé (WebKit refuse new Touch) : événements avec touches et changedTouches posés à la main
            page.evaluate("""y => { const el = document.querySelector('.diet-dayswipe h2, .diet-dayswipe .group-title') || document.querySelector('.diet-dayswipe');
                const fire = (type, x) => { const e = new Event(type, { bubbles: true }); const t = [{ clientX: x, clientY: y }];
                  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : t }); Object.defineProperty(e, 'changedTouches', { value: t }); el.dispatchEvent(e); };
                fire('touchstart', 260); fire('touchend', 120); }""", y)
            page.wait_for_timeout(300)
            R.check(page.evaluate("routeParams(currentRoute())[1]") == '3', f'{t} glissé vers la gauche : jeudi')
            layout(page, t, 'jour de la semaine', '.diet-plan-view .scr')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


run_main(R, [], once=[t_editeur, t_eleve, t_eleve_semaine])
