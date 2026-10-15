"""Lot 7 (navigation) : corrections de la vérification finale.

1. Séance rouverte depuis un autre onglet : le bilan va dans #train/summary, le retour ne coince pas sans tab bar.
2. Le retour système ferme les dialogues iOS (feuille de suppression, menu ⋯) au lieu de reculer dessous.
3. À la racine, le retour système ferme la feuille d'actions au lieu de quitter l'app.
4. « Annuler » ne touche pas le titre, grille d'icônes sans débordement (écrans étroits).
5. Le toast ne recouvre pas la barre de navigation.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 7
R = Results(LOT)


def settle(page, ms=450):
    page.wait_for_timeout(ms)


def route(page):
    return page.evaluate('location.hash')


def tag(dev, theme):
    return f'{dev}-{theme}'


def t_summary_tab(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        page.click('[data-action="start-session"][data-cat="push"]'); settle(page)
        page.locator('[data-action="validate-set"]').first.click(); page.wait_for_timeout(200)
        if page.locator('.rest-overlay [data-action="minimize-rest"]').count():
            page.click('.rest-overlay [data-action="minimize-rest"]'); page.wait_for_timeout(100)
        page.locator('.view.session [data-action="back"]').click(); settle(page)
        page.click('.tabbar [data-tab="program"]'); settle(page)
        page.click('.livebar'); settle(page)
        R.check(route(page) == '#program/session', f'{t} séance rouverte depuis Programme ({route(page)})')
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(300)
        tap_dialog(page, 'Enregistrer la séance'); settle(page)
        R.check(route(page) == '#train/summary' and page.locator('.view.summary').count() == 1, f'{t} bilan dans #train/summary ({route(page)})')
        page.click('[data-action="summary-done"]'); settle(page)
        R.check(route(page) == '#train' and page.locator('.tabbar').is_visible(), f'{t} « Terminé » → #train ({route(page)})')
        page.go_back(); settle(page)
        r = route(page)
        R.check('summary' not in r and 'session' not in r, f'{t} retour après le bilan : pas de bilan ni de séance ({r})')
        R.check(page.locator('.tabbar').is_visible(), f'{t} retour après le bilan : tab bar visible')
        R.check(page.locator('.navbar [data-action="back"]').count() == 0, f'{t} retour après le bilan : racine d\'onglet')
        shot(page, LOT, f'apres_bilan_retour_{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_back_dialogs(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        start_url = page.url
        # 3. Feuille d'actions à la racine : le retour la ferme, l'app reste
        page.locator('[data-action="session-actions"]').first.click(); page.wait_for_timeout(350)
        R.check(page.locator('.ios-dialog').count() == 1, f'{t} feuille d\'actions ouverte')
        page.go_back(); settle(page)
        R.check(page.url.startswith(BASE_URL) and page.locator('.view.dashboard').count() == 1, f'{t} retour : l\'app reste ouverte ({page.url})')
        R.check(page.locator('.ios-dialog').count() == 0, f'{t} retour : feuille d\'actions fermée')
        # Feuille fermée par « Annuler » puis retour : pas de pression perdue (on sort de l'app)
        # 2. Historique › séance › Supprimer, puis retour : dialogue fermé, rien supprimé
        page.click('.tabbar [data-tab="history"]'); settle(page)
        page.locator('[data-action="open-history"]').first.click(); settle(page)
        n0 = page.evaluate('data.history.length')
        page.click('[data-action="delete-session"]'); page.wait_for_timeout(350)
        R.check(page.locator('.ios-dialog').count() == 1, f'{t} feuille de suppression ouverte')
        page.go_back(); settle(page)
        R.check(page.locator('.ios-dialog').count() == 0, f'{t} retour : feuille de suppression fermée')
        R.check(page.locator('.view.history-detail').count() == 1, f'{t} retour : on reste sur la séance ({route(page)})')
        R.check(page.evaluate('data.history.length') == n0, f'{t} rien supprimé')
        # Annuler puis retour système : on revient à la liste en un seul retour
        page.click('[data-action="delete-session"]'); page.wait_for_timeout(350)
        tap_dialog(page, 'Annuler'); settle(page, 300)
        page.go_back(); settle(page)
        R.check(route(page) == '#history' and page.locator('.view.history').count() == 1, f'{t} Annuler puis retour → liste ({route(page)})')
        # Supprimer depuis le dialogue : retour à la liste, une séance en moins, pile cohérente
        page.locator('[data-action="open-history"]').first.click(); settle(page)
        page.click('[data-action="delete-session"]'); page.wait_for_timeout(350)
        tap_dialog(page, 'Supprimer'); settle(page)
        R.check(route(page) == '#history' and page.evaluate('data.history.length') == n0 - 1, f'{t} suppression → liste ({route(page)})')
        # En séance : menu ⋯ puis retour → menu fermé, séance toujours affichée
        page.click('.tabbar [data-tab="train"]'); settle(page)
        page.click('[data-action="start-session"][data-cat="push"]'); settle(page)
        page.locator('[data-action="ex-menu"]').first.click(); page.wait_for_timeout(350)
        R.check(page.locator('.ios-dialog').count() == 1, f'{t} menu ⋯ ouvert')
        page.go_back(); settle(page)
        R.check(page.locator('.ios-dialog').count() == 0 and page.locator('.view.session').count() == 1, f'{t} retour : menu ⋯ fermé, séance affichée ({route(page)})')
        page.go_back(); settle(page)
        R.check(route(page) == '#train' and page.locator('.livebar').is_visible(), f'{t} second retour → accueil + mini-barre ({route(page)})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_narrow_navbar(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        page.click('.tabbar [data-tab="program"]'); settle(page)
        page.evaluate("handleAction(new Event('click'), document.body, 'add-custom-session')"); settle(page)
        gap = page.evaluate("""() => {
            const rg = document.createRange(); rg.selectNodeContents(document.querySelector('.navbar__text'));
            const a = rg.getBoundingClientRect();
            const rt = document.createRange(); rt.selectNodeContents(document.querySelector('.navbar__title'));
            const ti = rt.getBoundingClientRect();
            return ti.left - a.right; }""")
        R.check(gap >= 6, f'{t} Nouvelle séance : « Annuler » ne touche pas le titre ({gap:.1f})')
        over = page.evaluate("""() => { const g = document.querySelector('.emoji-grid').parentElement.getBoundingClientRect();
            return [...document.querySelectorAll('.emoji-btn')].filter(b => b.getBoundingClientRect().right > g.right + 0.5).length; }""")
        R.check(over == 0, f'{t} grille d\'icônes sans débordement ({over})')
        shot(page, LOT, f'seance_perso_{t}')
        # Modifier la séance (historique)
        page.goto(BASE_URL); page.wait_for_selector('#app > *')
        page.click('.tabbar [data-tab="history"]'); settle(page)
        page.locator('[data-action="open-history"]').first.click(); settle(page)
        page.click('[data-action="edit-session"]'); settle(page)
        gap = page.evaluate("""() => {
            const rg = document.createRange(); rg.selectNodeContents(document.querySelector('.navbar__text'));
            const a = rg.getBoundingClientRect();
            const rt = document.createRange(); rt.selectNodeContents(document.querySelector('.navbar__title'));
            const ti = rt.getBoundingClientRect();
            return ti.left - a.right; }""")
        R.check(gap >= 6, f'{t} Modifier la séance : « Annuler » ne touche pas le titre ({gap:.1f})')
        shot(page, LOT, f'modifier_seance_{t}')
        # 5. Toast : jamais sur la barre de navigation
        page.goto(BASE_URL); page.wait_for_selector('#app > *')
        page.evaluate("showToast('Programme : Upper / Lower', { duration: 6000 })")
        page.wait_for_timeout(350)
        tb = page.evaluate("document.querySelector('.toast').getBoundingClientRect().top")
        nb = page.evaluate("document.querySelector('.navbar').getBoundingClientRect().bottom")
        R.check(tb > nb + 40, f'{t} toast sous la barre de navigation ({tb:.0f} / {nb:.0f})')
        tab_top = page.evaluate("document.querySelector('.tabbar').getBoundingClientRect().top")
        bb = page.evaluate("document.querySelector('.toast').getBoundingClientRect().bottom")
        R.check(bb <= tab_top, f'{t} toast au-dessus de la tab bar ({bb:.0f} / {tab_top:.0f})')
        shot(page, LOT, f'toast_{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


TESTS = [t_summary_tab, t_back_dialogs, t_narrow_navbar]

if __name__ == '__main__':
    run_main(R, TESTS, once=[])
