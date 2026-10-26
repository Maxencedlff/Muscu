"""Réglages › Guide de l'app : liste des sujets, recherche, chaque sujet ouvert puis refermé.

Parcours complet sur iPhone 13 et iPhone SE (WebKit), clair et sombre ; sur les autres appareils,
la liste et un sujet seulement. Vérifie : retour vers Réglages puis vers la liste, aucun défilement
horizontal, aucun texte coupé, cibles d'au moins 44 pt, titres pour VoiceOver, rien au pointerdown.
Captures : $PPL_SCRATCH/shots/lotguide/ (liste et 4 sujets représentatifs).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_guide.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'guide'
R = Results(LOT)
FULL_DEVICES = ('iPhone 13', 'iPhone SE')
SHOT_TOPICS = ('tempo', 'sante', 'noter-serie', 'creer-programme')

# Texte coupé : élément dont le contenu dépasse sa boîte (ellipsis ou overflow), ou qui sort de l'écran
CLIPPED_JS = """() => [...document.querySelectorAll('#app .cell__title, #app .cell__sub, #app .group-title, #app .guide-lead, #app .guide-steps li, #app .guide-badge, #app .navbar__large, #app .navbar__title')]
    .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0')
    .filter(el => { const r = el.getBoundingClientRect();
        return el.scrollWidth > el.clientWidth + 1 || r.right > innerWidth + 1 || r.left < -1; })
    .map(el => el.className + ' : ' + el.textContent.trim().slice(0, 40))"""
SMALL_TARGETS_JS = """() => [...document.querySelectorAll('#app button, #app input')]
    .filter(el => el.getClientRects().length)
    .map(el => { const r = el.getBoundingClientRect(); return [el.textContent.trim().slice(0, 30) || el.getAttribute('aria-label'), Math.round(r.width), Math.round(r.height)]; })
    .filter(([, w, h]) => w < 44 || h < 44)"""
NO_HSCROLL_JS = 'document.documentElement.scrollWidth <= innerWidth + 1'


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_guide(page, theme):
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())   # mises à jour à chaud : jamais de réseau
    seed(page, theme, ppl_v2_today_json())
    page.click('[data-action="go-settings"]')
    page.wait_for_selector('.settings-view')
    cell = page.locator('[data-action="go-guide"]')
    cell.scroll_into_view_if_needed()
    page.wait_for_timeout(150)
    cell.click()
    page.wait_for_selector('.guide-view')
    page.wait_for_timeout(150)


def check_screen(page, t, what):
    R.check(page.evaluate(NO_HSCROLL_JS), f'{t} {what} : pas de défilement horizontal')
    clipped = page.evaluate(CLIPPED_JS)
    R.check(not clipped, f'{t} {what} : aucun texte coupé {clipped}')
    small = page.evaluate(SMALL_TARGETS_JS)
    R.check(not small, f'{t} {what} : cibles d\'au moins 44 pt {small}')


def t_guide(bench, eng, dev, theme):
    t = tag(dev, theme)
    full = dev in FULL_DEVICES
    with bench.page(eng, dev, theme) as page:
        open_guide(page, theme)
        topics = page.evaluate('GUIDE_TOPICS.map(x => ({ id: x.id, title: x.title, steps: x.steps.length, iphone: !!x.iphone, related: (x.related || []).length }))')
        sections = page.evaluate('GUIDE_SECTIONS.map(s => s.title)')

        # ── Liste ──
        R.check(page.locator('.navbar__title').inner_text().strip() == 'Guide', f'{t} titre « Guide »')
        R.check(page.locator('.navbar__back').get_attribute('aria-label') == 'Retour : Réglages', f'{t} retour vers Réglages')
        R.check(page.locator('.guide-row').count() == len(topics), f'{t} un bouton par sujet ({page.locator(".guide-row").count()}/{len(topics)})')
        heads = [h.strip().lower() for h in page.locator('#guideList h2.group-title').all_inner_texts()]
        R.check(heads == [s.lower() for s in sections], f'{t} sections en titres h2 {heads}')
        R.check(page.locator('.guide-row .guide-ic[aria-hidden="true"]').count() == len(topics), f'{t} pastilles masquées à VoiceOver')
        R.check(page.locator('.guide-row .cell__sub').count() == sum(1 for x in topics if x['iphone']), f'{t} sujets iPhone signalés')
        check_screen(page, t, 'liste')
        if full:
            shot(page, LOT, f'liste-{t}')
            page.screenshot(path=os.path.join(SHOTS, f'lot{LOT}', f'liste-entiere-{t}.png'), full_page=True)

        # iOS : rien ne doit changer au pointerdown (sinon Safari avale le tap)
        row = page.locator('.guide-row').first
        before = page.evaluate("document.querySelector('#guideList').innerHTML")
        row.dispatch_event('pointerdown')
        page.wait_for_timeout(120)
        R.check(page.evaluate("document.querySelector('#guideList').innerHTML") == before, f'{t} rien ne change au pointerdown')
        row.dispatch_event('pointerup')

        # ── Recherche ──
        search = page.locator('#guideSearch')
        search.fill('tempo')
        page.wait_for_timeout(100)
        ids = page.evaluate("[...document.querySelectorAll('#guideList .guide-row')].map(b => b.dataset.id)")
        R.check('tempo' in ids and len(ids) < len(topics), f'{t} recherche « tempo » {ids}')
        R.check(page.evaluate("document.activeElement?.id") == 'guideSearch', f'{t} recherche : le champ garde le focus')
        search.fill('SANTE')
        page.wait_for_timeout(100)
        R.check(page.locator('.guide-row[data-id="sante"]').count() == 1, f'{t} recherche sans accent ni majuscule')
        search.fill('zzzz')
        page.wait_for_timeout(100)
        R.check(page.locator('#guideList .empty-note').inner_text().strip() == 'Aucun sujet ne correspond.', f'{t} recherche vide : message')
        search.fill('')
        page.wait_for_timeout(100)
        R.check(page.locator('.guide-row').count() == len(topics), f'{t} recherche effacée : tout revient')
        page.evaluate('document.activeElement?.blur?.()')

        # ── Chaque sujet : ouvert, vérifié, refermé ──
        todo = topics if full else topics[:1]
        for x in todo:
            btn = page.locator(f'.guide-row[data-id="{x["id"]}"]')
            btn.scroll_into_view_if_needed()
            btn.click()
            page.wait_for_selector('.guide-topic')
            page.wait_for_timeout(60)
            w = f'{t} {x["id"]}'
            R.check(page.locator('h1.navbar__large').inner_text().strip() == x['title'], f'{w} : titre h1')
            R.check(page.locator('.guide-steps li').count() == x['steps'], f'{w} : {x["steps"]} étapes')
            R.check(page.locator('.guide-badge').count() == (1 if x['iphone'] else 0), f'{w} : mention iPhone')
            R.check(page.locator('.guide-topic .guide-row').count() == x['related'], f'{w} : voir aussi')
            R.check(page.locator('.navbar__back').get_attribute('aria-label') == 'Retour : Guide', f'{w} : retour vers Guide')
            check_screen(page, t, x['id'])
            if full and x['id'] in SHOT_TOPICS:
                shot(page, LOT, f'sujet-{x["id"]}-{t}')
            page.click('[data-action="back"]')
            page.wait_for_selector('.guide-view')
            page.wait_for_timeout(40)

        # « Voir aussi » : le sujet lié remplace le sujet affiché, le retour mène à la liste
        page.locator('.guide-row[data-id="tempo"]').click()
        page.wait_for_selector('.guide-topic')
        page.locator('.guide-topic .guide-row').first.click()
        page.wait_for_timeout(100)
        R.check(page.evaluate('nav.stacks[nav.tab].filter(r => r.startsWith("guide-topic")).length') == 1, f'{t} voir aussi : un seul sujet dans la pile')
        page.click('[data-action="back"]')
        page.wait_for_selector('.guide-view')
        page.click('[data-action="back"]')
        page.wait_for_selector('.settings-view')
        R.check(True, f'{t} retour jusqu\'aux Réglages')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_guide])
