"""Regard neuf du 16/11, chantier « mots et accès » (yn2).

- Noms des séances en clair là où la place le permet : « Pousser (Push) » (accueil, programme, bilan) ; la mini-barre
  et l'historique gardent le nom court.
- Séance libre en direct : une ligne sous les séances de l'accueil, séance vide où l'on ajoute ses exercices, sans
  rien écrire dans les programmes ; enregistrée sous le programme FREE.
- Carte « Sauvegarde tes séances » après 3 séances sans compte ni sauvegarde récente, fermable.
- Export CSV des séances dans Réglages › Données › Sauvegarde, par la feuille de partage.
- Texte agrandi : le compteur de la séance grossit (20 px au plus), la barre d'onglets reste comme iOS.
Captures : $PPL_SCRATCH/shots/lotmots_yn2/.
Lancer : PPL_DEV="iPhone SE" PPL_THEME=dark python3 test_mots_yn2.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'mots_yn2'
R = Results(LOT)
PLAIN = {'Pousser (Push)', 'Tirer (Pull)', 'Jambes (Legs)'}


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def no_side_scroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')


def t_accueil(bench, eng, dev, theme):
    """Noms en clair, ligne « Séance libre », carte de sauvegarde (fermable)."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.wait_for_selector('.hero__name')
        name = page.inner_text('.hero__name').strip()
        R.check(name in PLAIN, f'{t} accueil : prochaine séance en clair ({name!r})')
        others = page.locator('.home-list .home-cell__name').all_inner_texts()
        R.check(others and all(o.strip() in PLAIN for o in others), f'{t} accueil : autres séances en clair {others}')
        free = page.locator('.home-free [data-action="start-free-session"]')
        R.check(free.count() == 1 and 'Séance libre' in free.inner_text(), f'{t} accueil : ligne « Séance libre »')
        R.check(free.count() == 1 and free.bounding_box()['height'] >= 44, f'{t} « Séance libre » : 44 pt au moins')
        # Ordre : les séances, la séance libre, puis la carte de sauvegarde (jamais devant l'entraînement)
        order = page.evaluate("""() => { const a = document.querySelector('.home-free'), b = document.querySelector('.backup-card');
            return !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); }""")
        R.check(order, f'{t} accueil : carte « Sauvegarde tes séances » sous les séances')
        card = page.locator('.backup-card')
        R.check(card.count() == 1 and 'Sauvegarde tes séances' in card.inner_text(), f'{t} carte de sauvegarde (3 séances, sans compte ni export)')
        phone = page.evaluate('phoneName()')
        R.check(card.count() == 1 and ('cet iPhone' if phone == 'iPhone' else 'ce téléphone') in card.inner_text(), f'{t} carte : le bon appareil ({phone})')
        R.check(no_side_scroll(page), f'{t} accueil : pas de défilement de côté')
        shot(page, LOT, f'1-accueil-{t}')
        page.evaluate("document.documentElement.classList.add('type-xl')")
        page.wait_for_timeout(150)
        R.check(no_side_scroll(page), f'{t} accueil, texte agrandi : pas de défilement de côté')
        cut = page.evaluate("""() => [...document.querySelectorAll('.home-free .home-cell__name, .home-free .home-cell__sub, .backup-card .account-card__title')]
            .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent)""")
        R.check(not cut, f'{t} texte agrandi : rien de coupé {cut}')
        page.locator('.home-free').scroll_into_view_if_needed()
        shot(page, LOT, f'1b-accueil-grand-texte-{t}')
        page.evaluate("document.documentElement.classList.remove('type-xl')")
        # Le bouton propose un compte ou un fichier
        page.click('[data-action="backup-card-open"]')
        page.wait_for_timeout(300)
        labels = page.locator('.ios-dialog__btn').all_inner_texts()
        R.check('Exporter un fichier' in labels and 'Annuler' in labels, f'{t} carte : compte ou fichier {labels}')
        tap_dialog(page, 'Annuler')
        page.click('[data-action="backup-card-close"]')
        page.wait_for_timeout(200)
        R.check(page.locator('.backup-card').count() == 0 and (ls(page, 'ppl_backup_card_closed') or '').isdigit(), f'{t} carte fermée, date retenue')
        R.check(not page.errors, f'{t} accueil : aucune erreur JS {page.errors}')


def t_seance_libre(bench, eng, dev, theme):
    """Séance libre en direct : vide, choix du premier exercice, rien dans les programmes, enregistrée hors programme."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        before = page.evaluate('JSON.stringify(data.programmes)')
        page.click('[data-action="start-free-session"]')
        page.wait_for_selector('.view.session')
        page.wait_for_selector('#axSearch')
        R.check(page.evaluate('[activeSession.programme, activeSession.category, activeSession.exercises.length]') == ['free', 'free', 0],
                f'{t} séance libre : vide, hors programme')
        R.check(page.locator('#axToProg').count() == 0, f'{t} séance libre : pas de « Ajouter au programme »')
        R.check('Séance libre' in page.inner_text('.navbar__title-main'), f'{t} séance libre : titre')
        shot(page, LOT, f'2-libre-choix-{t}')
        page.locator('[data-action="ax-pick"]').first.click()
        page.wait_for_timeout(400)
        R.check(page.evaluate('activeSession.exercises.length') == 1, f'{t} séance libre : premier exercice ajouté')
        R.check(page.evaluate('JSON.stringify(data.programmes)') == before and not page.evaluate("'free' in data.programmes"),
                f'{t} séance libre : programmes inchangés')
        shot(page, LOT, f'3-libre-exercice-{t}')
        # Accueil pendant la séance : la ligne dit « Reprendre »
        page.evaluate("routeTo('dashboard')")
        page.wait_for_selector('.home-free')
        R.check(page.locator('.home-free [data-action="resume-session"]').count() == 1 and 'Reprendre' in page.inner_text('.home-free'),
                f'{t} accueil : séance libre en cours, « Reprendre »')
        page.click('.home-free [data-action="resume-session"]')
        page.wait_for_selector('.view.session')
        page.evaluate("activeSession.exercises[0].sets.forEach(s => { s.weight = s.weight || '20'; s.reps = s.reps || '10'; s.done = true; }); persistSession(); render()")
        page.click('[data-action="finish-session"]')
        page.wait_for_timeout(300)
        tap_dialog(page, 'Enregistrer la séance')
        page.wait_for_selector('.view.summary')
        h = page.evaluate('[data.history[0].programme, data.history[0].category, data.history[0].exercises.length]')
        R.check(h == ['free', 'free', 1], f'{t} séance libre enregistrée hors programme {h}')
        R.check(page.inner_text('.sum-title').strip() == 'Séance libre', f'{t} bilan : « Séance libre »')
        R.check(not page.evaluate("'free' in data.programmes"), f'{t} bilan : aucun programme « free » créé')
        R.check(not page.errors, f'{t} séance libre : aucune erreur JS {page.errors}')


def t_csv(bench, eng, dev, theme):
    """Réglages › Données › Sauvegarde : export CSV, une ligne par série, par la feuille de partage."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.evaluate("navigate('backup')")
        page.wait_for_selector('[data-action="export-csv"]')
        R.check('Exporter les séances (CSV)' in page.inner_text('[data-action="export-csv"]'), f'{t} Sauvegarde : « Exporter les séances (CSV) »')
        R.check(no_side_scroll(page), f'{t} Sauvegarde : pas de défilement de côté')
        shot(page, LOT, f'4-sauvegarde-{t}')
        # Feuille de partage simulée : le fichier remis est lu
        page.evaluate("""() => { window.shareOrDownload = async (file, title) => { window.__shared = { name: file.name, type: file.type, title, text: await file.text() }; return 'shared'; }; }""")
        page.click('[data-action="export-csv"]')
        page.wait_for_function('window.__shared')
        f = page.evaluate('window.__shared')
        lines = f['text'].lstrip('﻿').split('\r\n')
        sets = page.evaluate('data.history.reduce((a, h) => a + h.exercises.reduce((b, e) => b + e.sets.length + e.sets.reduce((c, s) => c + subSetsOf(s).length, 0), 0), 0)')
        R.check(f['name'].startswith('mdlf-seances-') and f['name'].endswith('.csv') and f['type'] == 'text/csv', f'{t} CSV : nom et type {f["name"]}')
        R.check(lines[0] == 'Date;Séance;Exercice;Série;Kg;Reps;RIR;Note', f'{t} CSV : en-tête {lines[0]!r}')
        R.check(len([x for x in lines[1:] if x]) == sets, f'{t} CSV : une ligne par série ({len(lines) - 2} pour {sets})')
        R.check(not page.evaluate('data.lastExport'), f'{t} CSV : ne compte pas comme une sauvegarde')
        R.check(not page.errors, f'{t} CSV : aucune erreur JS {page.errors}')


def t_compteur(bench, eng, dev, theme):
    """Texte agrandi : le compteur de la séance grossit, la barre d'onglets reste à 10 px comme iOS."""
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.click('.hero__btn')
        page.wait_for_selector('.view.session #session-count')
        size = lambda: page.evaluate("parseFloat(getComputedStyle(document.querySelector('.navbar__title-sub')).fontSize)")
        normal = size()
        page.evaluate("document.documentElement.classList.add('type-xl'); document.documentElement.style.fontSize = '24px'")
        page.wait_for_timeout(150)
        big = size()
        R.check(big > normal and big <= 20, f'{t} compteur : {normal} px → {big} px en texte agrandi (20 au plus)')
        cut = page.evaluate("(() => { const e = document.querySelector('.navbar__title-sub'); return e.scrollWidth > e.clientWidth + 1; })()")
        R.check(not cut, f'{t} compteur agrandi : entier')
        shot(page, LOT, f'5-compteur-grand-texte-{t}')
        R.check(not page.errors, f'{t} compteur : aucune erreur JS {page.errors}')


def t_titre_barre(bench, eng, dev, theme):
    """Barre de la séance : « Pousser (Push) » quand il tient en entier, sinon le nom court, jamais coupé."""
    t = tag(dev, theme)
    st = """(() => { const m = document.querySelector('#app .navbar__title-main');
        return { text: m.textContent.trim(), cut: m.scrollWidth > m.clientWidth + 1 }; })()"""
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.click('.hero__btn')
        page.wait_for_selector('.view.session')
        s = page.evaluate(st)
        short = page.evaluate('sessionMeta(activeSession.category, activeSession.programme).label')
        R.check(s['text'] in PLAIN | {short} and not s['cut'], f'{t} barre de séance : nom entier {s}')
        if page.viewport_size['width'] >= 390:
            R.check(s['text'] in PLAIN, f'{t} barre de séance : nom en clair sur un grand écran {s}')
        page.evaluate("document.documentElement.classList.add('type-xl'); document.documentElement.style.fontSize = '24px'; render()")
        page.wait_for_timeout(150)
        s = page.evaluate(st)
        R.check(s['text'] in PLAIN | {short} and not s['cut'], f'{t} barre de séance, texte agrandi : nom entier {s}')
        shot(page, LOT, f'6-titre-barre-grand-texte-{t}')
        R.check(not page.errors, f'{t} titre de la barre : aucune erreur JS {page.errors}')


run_main(R, [t_accueil, t_seance_libre, t_csv, t_compteur, t_titre_barre])
