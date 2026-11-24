"""Défis (docs/DEFIS.md) : section de l'accueil, ajout d'un toucher avec Annuler (délai de garde), fiche (chiffres,
calendrier, jour corrigé), création depuis la bibliothèque, 4 défis au plus, pause et arrêt, passage de minuit, ligne
« Lancer un défi » sans défi, texte agrandi sur iPhone SE, récap du mois avec et sans le bloc Défis (réglage).

Captures : $PPL_SCRATCH/shots/lotdefis/ (clair et sombre).
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_defis.py (ou run_all.py defis).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'defis'
R = Results(LOT)
# Mercredi 4 novembre 2026, 18 h 30 à Paris (comme les captures du panel)
NOW = local_ms(2026, 11, 4, 18, 30, tz=PARIS)


def jour(now, n):
    return datetime.datetime.fromtimestamp(days_back_ms(now, n, 12, tz=PARIS) / 1000, ZoneInfo(PARIS)).date().isoformat()


def defis(now=NOW):
    """100 pompes par jour depuis 18 jours (2 jours manqués, 63 aujourd'hui) ; 20 tractions par jour depuis 8 jours (12)."""
    def ajout(k, n, h, nb):
        return {'id': f'e{k}{n}x{h}', 'n': nb, 'at': days_back_ms(now, n, h, tz=PARIS)}
    pompes = {}
    for n in range(18, 0, -1):
        pompes[jour(now, n)] = [ajout('p', n, 8, 40)] if n in (11, 6) else [ajout('p', n, 8, 30), ajout('p', n, 12, 40), ajout('p', n, 19, 30)]
    pompes[jour(now, 0)] = [ajout('p', 0, 8, 30), ajout('p', 0, 13, 33)]
    tractions = {jour(now, n): [ajout('t', n, 9, 10), ajout('t', n, 18, 10)] for n in range(8, 0, -1)}
    tractions[jour(now, 0)] = [ajout('t', 0, 9, 12)]
    return {
        'dpompes1': {'id': 'dpompes1', 'name': 'Pompes', 'measure': 'reps', 'goals': [{'from': jour(now, 18), 'n': 100}], 'start': jour(now, 18),
                     'length': 30, 'remind': None, 'pauses': [], 'at': days_back_ms(now, 18, 8, tz=PARIS), 'log': pompes, 'gone': []},
        'dtract01': {'id': 'dtract01', 'name': 'Tractions pronation', 'measure': 'reps', 'goals': [{'from': jour(now, 8), 'n': 20}], 'start': jour(now, 8),
                     'length': 0, 'remind': None, 'pauses': [], 'at': days_back_ms(now, 8, 9, tz=PARIS), 'log': tractions, 'gone': []},
    }


def data_json(now=NOW, with_defis=True, **extra):
    d = ppl_v2_today(now_ms=now)
    if with_defis:
        d['defis'] = defis(now)
    d.update(extra)
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def nb(v):
    return (v or '').replace(' ', ' ').replace(' ', ' ')


def open_app(page, theme, ppl_v2):
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, ppl_v2, extra={'ppl_welcome_seen': '1'})
    settle(page)


def total(page, did='dpompes1', day=None):
    return page.evaluate('([i, d]) => defiDayTotal(data.defis[i], d || localISO())', [did, day])


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def small_targets(page, sel):
    return page.evaluate("""s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && !e.disabled)
        .filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30))""", sel)


def cut_texts(page, scope):
    return page.evaluate("""s => [...document.querySelectorAll(s + ' *')].filter(e => e.offsetParent && e.children.length === 0
        && e.textContent.trim() && !e.matches('input, textarea, svg, use, .sr-text') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
        .map(e => e.textContent.trim().slice(0, 30))""", scope)


def layout(page, t, name, scope):
    R.check(no_hscroll(page), f'{t} {name} : pas de défilement horizontal')
    st = small_targets(page, f'{scope} button')
    R.check(not st, f'{t} {name} : cibles de 44 pt {st}')
    ct = cut_texts(page, scope)
    R.check(not ct, f'{t} {name} : aucun texte coupé {ct}')
    R.check(not page.errors, f'{t} {name} : aucune erreur JS {page.errors[:2]}')


def unlabeled(page, scope):
    """Boutons sans nom parlé (VoiceOver) : ni texte ni aria-label."""
    return page.evaluate("""s => [...document.querySelectorAll(s + ' button')].filter(e => e.offsetParent)
        .filter(e => !(e.getAttribute('aria-label') || e.textContent).trim()).length""", scope)


def big_text(page):
    page.add_style_tag(content='html { font-size: 33px !important; }')
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    settle(page)


def t_parcours(bench, eng, dev, theme):
    """Accueil : deux cartes ; « +10 » ajoute tout de suite, Annuler ignoré pendant le délai de garde puis retire ;
    fiche : chiffres, calendrier, mention Progrès, jour passé corrigé."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme, data_json())
        page.locator('#homeDefis').scroll_into_view_if_needed()
        cards = page.locator('.defis-home .defi-card')
        R.check(cards.count() == 2, f'{t} accueil : deux défis ({cards.count()})')
        val = nb(page.inner_text('.defi-card:first-child .defi-card__val'))
        R.check(val.replace('\n', ' ') == '63 / 100 reps', f'{t} accueil : « 63 / 100 reps » ({val!r})')
        steps = [nb(x) for x in page.locator('.defi-card:first-child .defi-add').all_inner_texts()]
        R.check(steps == ['+5', '+10', '+20', 'Autre'], f'{t} pas de 100 pompes {steps}')
        steps = [nb(x) for x in page.locator('.defi-card:nth-child(2) .defi-add').all_inner_texts()]
        R.check(steps == ['+1', '+5', 'Autre'], f'{t} pas de 20 tractions {steps}')
        R.check('5 jours de suite' in page.inner_text('.defi-card:first-child .defi-foot'), f'{t} série : 5 jours de suite')
        layout(page, t, 'accueil', '.defis-home')
        R.check(unlabeled(page, '.defis-home') == 0, f'{t} VoiceOver : chaque bouton a un nom')
        shot(page, LOT, f'1-accueil-{t}')
        page.click('[data-action="defi-add"][data-id="dpompes1"][data-n="10"]')
        R.check(total(page) == 73, f'{t} « +10 » : 73 ({total(page)})')
        R.check(page.locator('.defi-card:first-child .defi-foot__undo').count() == 1, f'{t} Annuler à la place de la série')
        page.click('.defi-card:first-child .defi-foot__undo')
        R.check(total(page) == 73, f'{t} Annuler touché trop vite (double toucher) : ignoré')
        page.wait_for_timeout(800)
        shot(page, LOT, f'2-ajout-{t}')
        page.click('.defi-card:first-child .defi-foot__undo')
        settle(page)
        R.check(total(page) == 63, f'{t} Annuler : retiré ({total(page)})')
        R.check('5 jours de suite' in page.inner_text('.defi-card:first-child .defi-foot'), f'{t} la série revient')
        # Fiche
        page.click('[data-action="defi-open"][data-id="dpompes1"]')
        page.wait_for_selector('.defi-view')
        txt = nb(page.inner_text('.defi-view'))
        for want in ('Jours tenus', '16 sur 18', "Record d'un jour", 'Total', 'ne comptent pas dans Progrès', 'Tenu', 'Manqué', 'Jour 19 sur 30'):
            R.check(want in txt, f'{t} fiche : « {want} »')
        R.check(page.locator('.defi-cal__dot--done').count() >= 3, f'{t} calendrier : jours tenus en vert')
        layout(page, t, 'fiche', '.defi-view')
        R.check(unlabeled(page, '.defi-view') == 0, f'{t} fiche VoiceOver : chaque bouton a un nom')
        shot(page, LOT, f'3-fiche-{t}')
        # Mois précédent : les jours manqués d'octobre
        page.click('.defi-cal__nav[aria-label="Mois précédent"]')
        settle(page)
        R.check(page.locator('.defi-cal__dot--missed').count() == 2, f'{t} octobre : 2 jours manqués ({page.locator(".defi-cal__dot--missed").count()})')
        page.locator('.defi-cal').scroll_into_view_if_needed()
        shot(page, LOT, f'4-calendrier-{t}')
        # Corriger le jour manqué le plus récent (6 jours avant)
        d6 = jour(NOW, 6)
        page.click(f'.defi-cal__cell[data-day="{d6}"]')
        page.wait_for_selector('.ios-dialog__input')
        page.fill('.ios-dialog__input', '100')
        tap_dialog(page, 'OK')
        R.check(total(page, day=d6) == 100, f'{t} jour corrigé : 100 ({total(page, day=d6)})')
        R.check(page.evaluate("defiStats(data.defis.dpompes1).held") == 17, f'{t} 17 jours tenus après correction')
        page.locator('.toast__action').click()
        settle(page)
        R.check(total(page, day=d6) == 40, f'{t} correction annulée : 40')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


def t_creation(bench):
    """« Nouveau défi » : suggestions en tête, Dips, objectif proposé, Lancer ; au 4e défi, plus de « Nouveau défi »."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone 13']
    with bench.frozen_page(NOW, eng, 'iPhone 13', 'light') as page:
        open_app(page, 'light', data_json())
        page.click('[data-action="defi-new"]')
        page.wait_for_selector('.sess-sheet--addex .ax__hint')
        hints = page.locator('.sess-sheet--addex .ax__hint').all_inner_texts()
        R.check(hints[:1] == ['Suggestions'], f'création : suggestions en tête {hints[:2]}')
        names = page.locator('.sess-sheet--addex .ax__item').all_inner_texts()[:4]
        R.check(any('Dips' in n for n in names) and not any(n.startswith('Pompes\n') for n in names), f'création : pompes déjà en cours, pas proposées {names}')
        R.check(page.locator('#axSets').count() == 0, 'création : pas de réglage « Séries »')
        page.click('.sess-sheet--addex [data-action="ax-pick"][data-name="Dips"]')
        page.wait_for_selector('.defi-form')
        R.check(page.input_value('#defiGoal') == '50', 'objectif proposé : 50')
        page.fill('#defiGoal', '0')
        page.click('.sheet__btn--confirm')
        R.check('de 1 à' in page.inner_text('#defiErr'), 'objectif 0 refusé, dit sous le champ')
        page.fill('#defiGoal', '40')
        page.click('.defi-form [data-len="60"]')
        shot(page, LOT, '5-creation')
        page.click('.sheet__btn--confirm')
        settle(page)
        R.check(page.evaluate("defiList(data).map(c => [c.name, defiGoal(c), c.length])") == [['Pompes', 100, 30], ['Tractions pronation', 20, 0], ['Dips', 40, 60]],
                f'trois défis {page.evaluate("defiList(data).map(c => c.name)")}')
        page.evaluate("defiCreate(data, { name: 'Burpees', goal: 30 }); save(); render()")
        settle(page)
        R.check(page.locator('[data-action="defi-new"]').count() == 0, '4 défis : plus de « Nouveau défi »')
        R.check(not page.errors, f'création : aucune erreur JS {page.errors[:2]}')


def t_pause_arret(bench):
    """Pause : la carte dit « En pause » sans boutons ; Arrêter (confirmation) : dans Défis terminés, Annuler le remet."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone 13']
    with bench.frozen_page(NOW, eng, 'iPhone 13', 'dark') as page:
        open_app(page, 'dark', data_json())
        page.click('[data-action="defi-open"][data-id="dtract01"]')
        page.wait_for_selector('.defi-view')
        page.click('[data-action="defi-pause"]')
        settle(page)
        R.check(page.evaluate("defiPaused(data.defis.dtract01)") is True, 'en pause')
        page.click('.navbar [data-action="back"]')
        settle(page)
        card = page.locator('.defi-card--paused')
        R.check(card.count() == 1 and 'En pause' in card.inner_text(), 'accueil : « En pause »')
        R.check(card.locator('.defi-add').count() == 0, 'en pause : pas de boutons')
        page.click('[data-action="defi-open"][data-id="dpompes1"]')
        page.wait_for_selector('.defi-view')
        page.locator('[data-action="defi-stop"]').scroll_into_view_if_needed()
        page.click('[data-action="defi-stop"]')
        tap_dialog(page, 'Arrêter le défi')
        page.wait_for_selector('.view.dashboard')
        R.check(page.evaluate("defiList(data).length") == 1 and page.locator('[data-action="defi-ended"]').count() == 1, 'arrêté : ligne Défis terminés')
        page.locator('.toast__action').click()
        settle(page)
        R.check(page.evaluate("defiList(data).length") == 2, 'Annuler : défi remis')
        R.check(not page.errors, f'pause : aucune erreur JS {page.errors[:2]}')


def t_minuit(bench):
    """Accueil ouvert à 23 h 59 : après minuit, le jour repart de zéro et l'ajout va au nouveau jour."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone 13']
    eve = local_ms(2026, 11, 4, 23, 59, tz=PARIS)
    with bench.frozen_page(eve, eng, 'iPhone 13', 'dark') as page:
        open_app(page, 'dark', data_json(eve))
        page.click('[data-action="defi-add"][data-id="dpompes1"][data-n="5"]')
        settle(page)
        page.clock.run_for(120_000)
        settle(page)
        val = nb(page.inner_text('.defi-card:first-child .defi-card__val')).replace('\n', ' ')
        R.check(val == '0 / 100 reps', f'minuit : 0 / 100 ({val!r})')
        R.check(page.locator('.defi-card:first-child .defi-ring__arc').count() == 0, 'minuit : anneau vide à 0')
        page.click('[data-action="defi-add"][data-id="dpompes1"][data-n="5"]')
        settle(page)
        R.check([total(page, day='2026-11-04'), total(page, day='2026-11-05')] == [68, 5], 'minuit : chaque ajout sur son jour')
        R.check(not page.errors, f'minuit : aucune erreur JS {page.errors[:2]}')


def t_vide_et_xl(bench):
    """Sans défi : une seule ligne « Lancer un défi », pas de carte vide. iPhone SE, texte AX33 : rien de coupé."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone SE']
    for theme in ('light', 'dark'):
        t = f'SE-{theme}'
        with bench.frozen_page(NOW, eng, 'iPhone SE', theme) as page:
            open_app(page, theme, data_json(with_defis=False))
            sec = page.locator('.defis-home')
            R.check(sec.locator('button').count() == 1 and 'Lancer un défi' in sec.inner_text(), f'{t} vide : une ligne')
            R.check(sec.locator('.defi-card').count() == 0, f'{t} vide : pas de carte')
            sec.scroll_into_view_if_needed()
            shot(page, LOT, f'6-vide-{t}')
            page.evaluate(f"data.defis = {json.dumps(defis())}; save(); render()")
            settle(page)
            big_text(page)
            page.locator('#homeDefis').scroll_into_view_if_needed()
            layout(page, t, 'accueil AX33', '.defis-home')
            shot(page, LOT, f'7-accueil-xl-{t}')
            page.click('[data-action="defi-open"][data-id="dpompes1"]')
            page.wait_for_selector('.defi-view')
            layout(page, t, 'fiche AX33', '.defi-view')
            shot(page, LOT, f'8-fiche-xl-{t}')


def t_progres(bench):
    """Les reps des défis ne comptent pas dans Progrès : historique et séries par muscle inchangés."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone 13']
    with bench.frozen_page(NOW, eng, 'iPhone 13', 'light') as page:
        open_app(page, 'light', data_json(with_defis=False))
        before = page.evaluate("JSON.stringify([data.history.length, recapStats(recapPeriod('month', Date.now() - 20 * 86400000))?.sets])")
        page.evaluate(f"data.defis = {json.dumps(defis())}; save(); render()")
        page.click('[data-action="defi-add"][data-id="dpompes1"][data-n="20"]')
        after = page.evaluate("JSON.stringify([data.history.length, recapStats(recapPeriod('month', Date.now() - 20 * 86400000))?.sets])")
        R.check(before == after, f'Progrès inchangé ({before} → {after})')


def t_recap(bench):
    """Récap d'octobre : un écran Défis (total et jours tenus) ; réglage coupé : plus d'écran, ni dans le résumé."""
    eng = dict((d, e) for e, d in ALL_DEVICES)['iPhone 13']
    for theme in ('light', 'dark'):
        with bench.frozen_page(NOW, eng, 'iPhone 13', theme) as page:
            open_app(page, theme, data_json())
            ids = page.evaluate("recapPages(recapStats(recapPeriodFromKey('m2026-10'))).map(p => p.id)")
            R.check('defis' in ids, f'{theme} récap d\'octobre : écran Défis ({ids})')
            pg = page.evaluate("recapPages(recapStats(recapPeriodFromKey('m2026-10'))).find(p => p.id === 'defis')")
            R.check(pg and pg['title'] == 'Pompes' and 'jours tenus sur' in pg['caption'], f'{theme} écran Défis : {pg and pg["caption"]}')
            page.evaluate("openRecap('m2026-10')")
            page.wait_for_selector('.recap')
            page.evaluate(f"recapIndex = {ids.index('defis')}; render()")
            page.wait_for_timeout(1200)
            R.check(page.locator('.recap-page.is-active[data-id="defis"]').count() == 1, f'{theme} écran Défis affiché')
            shot(page, LOT, f'9-recap-defis-{theme}')
            # Image partagée de cet écran (canvas de la story)
            png = page.evaluate("""async () => { const st = recapStats(recapPeriodFromKey('m2026-10'));
                const pg = recapPages(st).find(p => p.id === 'defis'); const { canvas: c } = await renderRecapStory(pg, st);
                return c.toDataURL('image/png'); }""")
            if theme == 'dark' and png:
                import base64
                d = os.path.join(SHOTS, 'lot' + LOT)
                os.makedirs(d, exist_ok=True)
                with open(os.path.join(d, '9-recap-defis-image.png'), 'wb') as f:
                    f.write(base64.b64decode(png.split(',', 1)[1]))
            R.check(bool(png), f'{theme} image partagée de l\'écran Défis dessinée')
            R.check(not page.errors, f'{theme} récap : aucune erreur JS {page.errors[:2]}')
            # Réglage : Réglages › Apparence › Défis dans les récaps
            page.evaluate("navigate('settings')")
            page.wait_for_selector('[data-action="setting-defis-recap"]')
            R.check(page.get_attribute('[data-action="setting-defis-recap"]', 'aria-checked') == 'true', f'{theme} réglage allumé par défaut')
            page.locator('[data-action="setting-defis-recap"]').scroll_into_view_if_needed()
            page.click('[data-action="setting-defis-recap"]')
            settle(page)
            shot(page, LOT, f'10-reglage-{theme}')
            ids = page.evaluate("recapPages(recapStats(recapPeriodFromKey('m2026-10'))).map(p => p.id)")
            lines = page.evaluate("recapPages(recapStats(recapPeriodFromKey('m2026-10'))).at(-1).lines.map(l => l[0]).join('|')")
            R.check('defis' not in ids and 'Défi' not in lines, f'{theme} réglage coupé : pas de bloc ({ids})')
            # Mois sans défi (septembre) : jamais de bloc vide
            page.click('[data-action="setting-defis-recap"]')
            sept = page.evaluate("(recapPages(recapStats(recapPeriodFromKey('m2026-09'))) || []).map(p => p.id)")
            R.check('defis' not in sept, f'{theme} septembre sans défi : pas de bloc')


if __name__ == '__main__':
    run_main(R, [t_parcours], once=[t_creation, t_pause_arret, t_minuit, t_vide_et_xl, t_progres, t_recap])
