"""Retours des explorateurs et des juges du 26/11 sur la Nutrition, la visite et les défis (Gérard, Inès, Karim).

Un contrôle par point corrigé :
  - accueil sans plan : « Noter ce que je mange » crée le plan et ouvre la journée (avant : 13 touchers par Programme) ;
  - plan sans aliment ni objectif : la carte reste, jamais « 0 sur 0 kcal » ;
  - repas noté à la main : son rond se coche, sur l'accueil (bug : aria-pressed restait false) comme à l'écran Nutrition ;
  - visite : Nutrition, Défis et Historique en plus ;
  - Objectifs du jour au grand texte : l'unité reste avec son champ, « g / g/kg » est un vrai bouton ;
  - recherche « poulet » : le cuit d'abord, « cru » écrit une fois, invite entière, aucun bouton invisible pour VoiceOver ;
  - durée d'un défi au grand texte : trois segments de 44 pt qui ne se chevauchent pas ;
  - bandeau d'annulation retiré au geste suivant, frise à une lettre, légende sans « · » en début de ligne.
Captures : $PPL_SCRATCH/shots/lotretours_nutrition/.
Lancer : PPL_DEV="iPhone SE" PPL_THEME=dark python3 test_retours_nutrition.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'retours_nutrition'
R = Results(LOT)
NOW = local_ms(2026, 11, 5, 13, 40, tz=PARIS)
SHOT_DIR = os.path.join(SHOTS, 'lot' + LOT)
AX33 = "() => { const h = document.documentElement; h.style.fontSize = '33px'; h.classList.add('type-xl'); render(); }"


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def shot(page, name):
    os.makedirs(SHOT_DIR, exist_ok=True)
    page.screenshot(path=os.path.join(SHOT_DIR, name.replace(' ', '_') + '.png'))


def fresh(page, theme, d=None):
    seed(page, theme, json.dumps(d or ppl_v2_today(now_ms=NOW), ensure_ascii=False), extra={'ppl_welcome_seen': '1'})
    settle(page)


def tap(page, sel):
    page.locator(sel).first.click()
    settle(page)


def poulet_item():
    return {'name': 'Poulet, filet sans peau grillé/poêlé', 'food': 36018, 'fam': 'v', 'g': 150, 'per': {'k': 141, 'p': 30, 'c': 0, 'f': 2}}


def t_accueil_et_coche(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        fresh(page, theme)
        # 1. Accueil sans plan : une ligne claire, un toucher ouvre la journée
        row = page.locator('.diet-start [data-action="diet-home-start"]')
        R.check(row.count() == 1 and 'Noter ce que je mange' in row.inner_text(), f'{t} accueil sans plan : « Noter ce que je mange »')
        row.scroll_into_view_if_needed()
        shot(page, f'accueil-sans-plan-{t}')
        tap(page, '.diet-start [data-action="diet-home-start"]')
        R.check(page.evaluate('currentView()') == 'nutrition' and page.evaluate('!!dietActivePlan(data)'),
                f'{t} un toucher : plan créé, journée ouverte')
        R.check(page.locator('.diet-meal').count() == 4, f'{t} journée : les 4 repas')
        # 2. Retour à l'accueil : la carte du plan, sans « 0 sur 0 kcal »
        page.evaluate("goBack()")
        settle(page)
        card = page.locator('.diet-home')
        txt = card.inner_text() if card.count() else ''
        R.check(card.count() == 1 and 'sur 0' not in txt and 'Ajouter' in txt, f'{t} plan vide : la carte reste, avec « Ajouter » ({txt!r})')
        # 3. Déjeuner noté à la main puis coché depuis l'accueil : coché à l'écran (bug du 26/11)
        page.evaluate("""it => { const m = dietActivePlan(data).meals[1]; dietAddExtra(data, data.dietActive, m.id, it); save(); render(); }""", poulet_item())
        settle(page)
        btn = page.locator('.diet-home [data-action="diet-check"]')
        R.check(btn.count() == 1, f'{t} accueil : rond du Déjeuner noté à la main')
        btn.first.click()
        settle(page)
        R.check(page.locator('.diet-home .diet-home__meal--done').count() == 1, f'{t} accueil : Déjeuner coché à l\'écran')
        R.check(page.evaluate("Math.round(dietDayProgress(data, data.dietActive, dietDayKey()).eaten.kcal)") == 212, f'{t} mangé inchangé : 212 kcal')
        page.locator('.diet-home').scroll_into_view_if_needed()
        shot(page, f'accueil-coche-{t}')
        # 4. Écran Nutrition (repas vides) : le rond sur un repas noté, décoché puis recoché
        page.evaluate("navigate('nutrition')")
        settle(page)
        meal = page.locator('.diet-meal').nth(1)
        chk = meal.locator('[data-action="diet-check"]')
        R.check(chk.count() == 1 and chk.get_attribute('aria-pressed') == 'true', f'{t} Nutrition : le repas noté a son rond, coché')
        chk.click()
        settle(page)
        chk = page.locator('.diet-meal').nth(1).locator('[data-action="diet-check"]')
        R.check(chk.get_attribute('aria-pressed') == 'false', f'{t} Nutrition : décoché')
        # Bandeau « Décoché · Annuler » retiré au geste suivant
        R.check(page.locator('.toast--action').count() == 1, f'{t} bandeau Annuler affiché')
        chk.click()
        settle(page)
        R.check(page.locator('.toast--action').count() == 0, f'{t} bandeau retiré au geste suivant')
        R.check(page.locator('.diet-meal').nth(1).locator('[data-action="diet-check"]').get_attribute('aria-pressed') == 'true', f'{t} recoché')
        # Défiler vers la carte Eau est aussi le geste suivant (2e tour des juges du 27/11 : le bandeau cachait « Bouteille »)
        page.evaluate("window.scrollTo(0, 0)")
        page.evaluate("showToast('Remplacé par Riz blanc', { action: 'Annuler', duration: 6000, onAction() {} })")
        page.wait_for_timeout(400)
        page.evaluate("document.documentElement.style.minHeight = '3000px'; window.scrollBy(0, 10)")
        page.wait_for_timeout(50)
        page.evaluate("window.scrollBy(0, 300)")
        page.wait_for_timeout(450)
        R.check(page.locator('.toast--action').count() == 0, f'{t} bandeau retiré en défilant')
        page.evaluate("document.documentElement.style.minHeight = ''")
        # Frise à une lettre, comme l'accueil ; légende sans « · » orphelin
        letters = page.evaluate("[...document.querySelectorAll('.diet-week__letter')].map(e => e.textContent)")
        R.check(all(len(x) == 1 for x in letters), f'{t} frise : une lettre par jour {letters}')
        leg = page.evaluate("document.querySelector('.diet-legend')?.innerHTML || ''")
        R.check(leg == '' or '&nbsp;·' in leg, f'{t} légende : « · » insécable')
        shot(page, f'nutrition-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_grand_texte(bench, eng, dev, theme):
    if dev != 'iPhone SE':
        return
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        d = ppl_v2_today(now_ms=NOW)
        d['bodyWeightKg'] = 80
        fresh(page, theme, d)
        page.evaluate(AX33)
        settle(page)
        tap(page, '.diet-start [data-action="diet-home-start"]')
        # Frise : dates séparées, rond du jour dans l'écran
        geo = page.evaluate("""() => { const n = [...document.querySelectorAll('.diet-week__num')].map(e => e.getBoundingClientRect());
            return { gaps: n.slice(1).map((r, i) => r.left - n[i].right), right: n[n.length - 1].right, w: innerWidth }; }""")
        R.check(min(geo['gaps']) >= 2 and geo['right'] <= geo['w'], f'{t} AX33 frise : dates séparées, dans l\'écran {geo}')
        bars = page.evaluate("""() => [...document.querySelectorAll('.diet-bar__label')].filter(e => e.scrollWidth > e.clientWidth + 1).length""")
        R.check(bars == 0, f'{t} AX33 bilan : noms des macros entiers')
        shot(page, f'nutrition-ax33-{t}')
        # Objectifs du jour : l'unité avec son champ, un vrai bouton g / g/kg
        page.evaluate("navigate(makeRoute('diet-plan', data.dietActive))")
        settle(page)
        tap(page, '[data-action="diet-targets"]')
        page.wait_for_selector('#dietT_p')
        page.wait_for_timeout(400)
        geo = page.evaluate("""() => ['kcal', 'p', 'c', 'f'].map(k => { const i = document.getElementById('dietT_' + k), u = i.nextElementSibling;
            const a = i.getBoundingClientRect(), b = u.getBoundingClientRect(); return { k, same: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 12 }; })""")
        R.check(all(g['same'] for g in geo), f'{t} AX33 objectifs : unité sur la ligne de son champ {geo}')
        ub = page.evaluate("""() => { const b = document.querySelector('[data-tunit]'); if (!b) return null; const r = b.getBoundingClientRect();
            return { bg: getComputedStyle(b).backgroundColor, w: r.width, h: r.height, ph: document.getElementById('dietT_c').placeholder }; }""")
        R.check(ub and ub['bg'] not in ('rgba(0, 0, 0, 0)', 'transparent') and ub['w'] >= 44 and ub['h'] >= 44, f'{t} g / g/kg : bouton visible de 44 pt {ub}')
        R.check(ub and ub['ph'] == '—', f'{t} champ vide : un tiret, plus « Aucun »')
        shot(page, f'objectifs-ax33-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_recherche(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        fresh(page, theme)
        tap(page, '.diet-start [data-action="diet-home-start"]')
        tap(page, '[data-action="diet-day-add"]')
        page.wait_for_selector('#dietFoodSearch')
        page.fill('#dietFoodSearch', 'poulet')
        page.wait_for_function("document.querySelectorAll('#dietFoodList .diet-cand[data-pick]').length > 5")
        names = page.evaluate("[...document.querySelectorAll('#dietFoodList .diet-cand[data-pick] .diet-cand__name')].slice(0, 6).map(e => e.textContent)")
        tags = page.evaluate("[...document.querySelectorAll('#dietFoodList .diet-cand[data-pick]')].slice(0, 6).map(e => e.querySelector('.diet-tag')?.textContent || '')")
        R.check(names and 'grillé' in names[0] and tags[0] == 'cuit', f'{t} « poulet » : le filet grillé en tête ({names[:2]})')
        all_rows = page.evaluate("""[...document.querySelectorAll('#dietFoodList .diet-cand[data-pick]')].map(e => [e.querySelector('.diet-cand__name').textContent, e.querySelector('.diet-tag')?.textContent || ''])""")
        twice = [n for n, tg in all_rows if tg == 'cru' and ' cru' in n.lower()]
        R.check(not twice, f'{t} « cru » écrit une seule fois {twice[:2]}')
        ph = page.evaluate("(() => { const i = document.getElementById('dietFoodSearch'); return { ph: i.placeholder, label: i.getAttribute('aria-label') }; })()")
        R.check(ph['ph'] == 'Rechercher' and ph['label'] == 'Rechercher un aliment', f'{t} invite courte, nom complet pour VoiceOver {ph}')
        hid = page.evaluate("(() => { const b = [...document.querySelectorAll('.sheet__btn--confirm')].pop(); return b ? b.getAttribute('aria-hidden') === 'true' && b.disabled : null; })()")
        R.check(hid is True, f'{t} bouton sans libellé hors de VoiceOver')
        shot(page, f'recherche-poulet-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_defi_duree(bench, eng, dev, theme):
    if dev != 'iPhone SE':
        return
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        fresh(page, theme)
        page.evaluate(AX33)
        settle(page)
        tap(page, '[data-action="defi-new"]')
        page.wait_for_selector('.sess-sheet--addex [data-action="ax-pick"][data-name="Pompes"]')
        page.click('.sess-sheet--addex [data-action="ax-pick"][data-name="Pompes"]')
        page.wait_for_selector('.defi-form__len [data-len]')
        page.wait_for_timeout(400)
        rs = page.evaluate("[...document.querySelectorAll('.defi-form__len [data-len]')].map(e => { const r = e.getBoundingClientRect(); return [r.top, r.bottom, r.height]; })")
        ok = len(rs) == 3 and all(h >= 44 for _, _, h in rs) and all(rs[i + 1][0] >= rs[i][1] - 0.5 for i in range(2))
        R.check(ok, f'{t} AX33 durée : 3 segments de 44 pt sans chevauchement {rs}')
        shot(page, f'defi-duree-ax33-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_visite(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        fresh(page, theme)
        page.evaluate("handleAction(new Event('click'), document.body, 'tour-replay')")
        page.wait_for_selector('.tour .tour__head', timeout=8000)
        titles = []
        for _ in range(9):
            settle(page)
            page.wait_for_timeout(250)
            titles.append(page.inner_text('.tour__title'))
            if page.inner_text('.tour__next').strip() == "C'est parti":
                break
            page.click('.tour [data-action="tour-next"]')
        R.check(titles[:1] == ['Démarrer'] and titles[1] in ('Au programme', 'À battre aujourd\'hui')
                and titles[2:] == ['Nutrition', 'Défis', 'Historique', 'Progrès', 'Programme'],
                f'{t} visite : Nutrition, Défis et Historique ({titles})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_accueil_et_coche, t_grand_texte, t_recherche, t_defi_duree, t_visite])
