"""Lot 3 : architecture, navigation et accueil (critères d'acceptation du plan)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 3
R = Results(LOT)


def tag(device, theme):
    return f'{device}-{theme}'


def route(page):
    return page.evaluate('location.hash')


def settle(page, ms=450):
    page.wait_for_timeout(ms)  # fin des transitions d'écran


def tab(page, name):
    page.click(f'.tabbar [data-tab="{name}"]')
    settle(page)


def tabbar_top(page):
    return page.evaluate("document.querySelector('.tabbar').getBoundingClientRect().top")


def last_content_bottom(page):
    """Bas du dernier élément visible de la vue, une fois défilé tout en bas."""
    # Juste après un changement d'onglet, WebKit peut encore limiter le défilement (vue en
    # transition) : on redemande le bas jusqu'à l'atteindre vraiment, au lieu d'une attente fixe.
    for _ in range(30):
        page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
        page.wait_for_timeout(100)
        if page.evaluate('Math.abs(scrollY + innerHeight - document.documentElement.scrollHeight) <= 1'):
            break
    return page.evaluate("""() => {
        let b = 0;
        for (const el of document.querySelectorAll('.view *')) {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            if (r.height > 0 && r.width > 0 && cs.visibility !== 'hidden' && cs.position !== 'fixed' && !el.closest('.navbar')) b = Math.max(b, r.bottom);
        }
        return b; }""")


# ─────────────────────────────────────────────────────────────

def t_home(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        R.check(page.locator('.view.dashboard').count() == 1, f'{t} accueil affiché')
        tabs = page.locator('.tabbar [role="tab"]')
        R.check(tabs.count() == 4, f'{t} tab bar : 4 onglets')
        labels = tabs.all_inner_texts()
        R.check([l.strip() for l in labels] == ['Entraînement', 'Historique', 'Progrès', 'Programme'], f'{t} libellés des onglets {labels}')
        hs = [tabs.nth(i).bounding_box()['height'] for i in range(tabs.count())]
        R.check(min(hs) >= 44, f'{t} onglets >= 44 pt ({hs})')
        R.check(page.locator('.tabbar [aria-selected="true"]').inner_text().strip() == 'Entraînement', f'{t} onglet actif = Entraînement')
        R.check(page.locator('.header-actions').count() == 0, f'{t} plus de .header-actions')
        btn = page.locator('.hero__btn')
        R.check(btn.inner_text().strip() == 'Démarrer' and btn.get_attribute('aria-label') == 'Démarrer Push', f'{t} carte « Démarrer » ({btn.inner_text()})')
        R.check(page.locator('.hero__name').inner_text().strip().upper() == 'PUSH', f'{t} grand titre PUSH')
        box = btn.bounding_box()
        R.check(box['y'] + box['height'] <= tabbar_top(page), f'{t} « Démarrer » visible sans défiler')
        info = page.locator('.hero__info').inner_text()
        R.check(info.startswith('Dernière fois : '), f'{t} « {info} »')
        cells = page.locator('.home-cell[data-action="session-actions"]')
        R.check(cells.count() == 2, f'{t} 2 autres séances en cellules')
        R.check(all(cells.nth(i).bounding_box()['height'] >= 60 for i in range(cells.count())), f'{t} cellules de 60 px')
        rings = page.locator('.rings').inner_text()
        R.check('séances' in rings and 'volume' in rings and 'affilée' in rings, f'{t} anneaux séances / volume / régularité')
        R.check(page.locator('.week__day').count() == 7, f'{t} calendrier de la semaine')
        R.check(page.locator('.targets__row').count() == 3, f'{t} carte « À battre aujourd\'hui » : 3 exercices')
        R.check(page.locator('.streak-badge, .order-badge, .card__cooldown, .prog-pill').count() == 0, f'{t} anciens badges retirés')
        shot(page, LOT, f'accueil-{t}')
        # Feuille d'actions d'une cellule, puis « Voir les exercices » dans une feuille modale
        cells.first.click(); page.wait_for_timeout(300)
        acts = page.locator('.ios-dialog__btn').all_inner_texts()
        R.check('Démarrer' in acts and 'Voir les exercices' in acts and 'Annuler' in acts, f'{t} feuille d\'actions {acts}')
        tap_dialog(page, 'Voir les exercices')
        sh = page.locator('.sheet[role="dialog"][aria-modal="true"]')
        R.check(sh.count() == 1 and sh.locator('.sheet-list__row').count() == 5, f'{t} feuille « Voir les exercices »')
        shot(page, LOT, f'feuille-{t}')
        page.click('.sheet__btn--confirm'); page.wait_for_timeout(350)
        R.check(page.locator('.sheet-root').count() == 0, f'{t} feuille fermée par OK')
        # Toutes les séances en récupération : « Démarrer quand même »
        d = ppl_v2_today()
        now = page.evaluate('Date.now()')
        for k in ('push', 'pull', 'legs'):
            d['programmes']['ppl']['timers'][k] = now - 3600_000 * {'push': 58, 'pull': 30, 'legs': 2}[k]
        seed(page, theme, json.dumps(d, ensure_ascii=False))
        R.check(page.locator('.hero__btn').inner_text().strip() == 'Démarrer quand même', f'{t} séance pas prête : « Démarrer quand même »')
        wait = page.locator('.hero__wait').inner_text()
        R.check('Prochaine séance prête dans 14 h' in wait, f'{t} « {wait} »')
        R.check(not any(ch.isdigit() and ':' in wait for ch in wait), f'{t} pas de secondes')
        shot(page, LOT, f'accueil-recup-{t}')
        R.check(not page.errors, f'{t} accueil : aucune erreur JS {page.errors}')


def t_back_stack(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        R.check(route(page) == '#train', f'{t} démarrage sur #train ({route(page)})')
        tab(page, 'history')
        R.check(page.locator('.view.history').count() == 1 and route(page) == '#history', f'{t} onglet Historique')
        shot(page, LOT, f'historique-{t}')
        # Fusion : la liste ouvre le détail de la séance (lot 5), plus le crayon
        page.locator('[data-action="open-history"]').first.click(); settle(page)
        R.check(page.locator('.view.history-detail').count() == 1, f'{t} Historique › séance')
        page.go_back(); settle(page)
        R.check(page.locator('.view.history').count() == 1, f'{t} retour système → Historique')
        page.go_back(); settle(page)
        R.check(page.locator('.view.dashboard').count() == 1 and route(page) == '#train', f'{t} 2e retour → Entraînement')
        # Pile conservée par onglet ; toucher l'onglet actif revient à la racine
        page.click('[data-action="go-settings"]'); settle(page)
        R.check(page.locator('.navbar__back').inner_text().strip() == 'Entraînement', f'{t} retour « ‹ Entraînement »')
        tab(page, 'progress')
        R.check(page.locator('.view.stats').count() == 1, f'{t} onglet Progrès')
        tab(page, 'train')
        R.check(page.locator('.view.settings-view').count() == 1, f'{t} pile de l\'onglet conservée')
        tab(page, 'train')
        R.check(page.locator('.view.dashboard').count() == 1, f'{t} onglet actif touché → racine')
        tab(page, 'program')
        R.check(page.locator('.view.programmes').count() == 1 and page.locator('.navbar__large').inner_text() == 'Programme', f'{t} onglet Programme')
        page.click('.navbar [data-action="go-settings"]'); settle(page)
        R.check(page.locator('.view.settings-view').count() == 1, f'{t} Programme › Réglages')
        page.click('[data-action="back"]'); settle(page)
        R.check(page.locator('.view.programmes').count() == 1, f'{t} bouton retour → Programme')
        R.check(not page.errors, f'{t} pile : aucune erreur JS {page.errors}')


def t_scroll(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        tab(page, 'history')
        # Fusion : historique paginé par 3 mois (lot 5), donc plus court
        page.evaluate('window.scrollTo(0, 900)'); page.wait_for_timeout(200)
        y0 = page.evaluate('scrollY')
        R.check(abs(y0 - 900) <= 2, f'{t} historique défilé à 900 ({y0})')
        # Un bouton de modification visible à l'écran
        page.evaluate("""() => { const top = document.querySelector('.navbar').getBoundingClientRect().bottom;
            const bottom = document.querySelector('.tabbar').getBoundingClientRect().top;
            const b = [...document.querySelectorAll('[data-action="open-history"]')]
            .find(b => { const r = b.getBoundingClientRect(); return r.top > top && r.bottom < bottom; }); b.click(); }""")
        settle(page)
        R.check(page.locator('.view.history-detail').count() == 1 and page.evaluate('scrollY') == 0, f'{t} écran suivant affiché en haut')
        page.click('.navbar [data-action="back"]'); settle(page)
        y1 = page.evaluate('scrollY')
        R.check(page.locator('.view.history').count() == 1 and abs(y1 - 900) <= 2, f'{t} retour : scrollY restauré ({y1})')
        # Fusion : ▲▼ remplacés par le mode Modifier (lot 5) ; micro-action = basculer Modifier/OK
        tab(page, 'program')
        page.locator('[data-action="open-prog-session"]').first.click(); settle(page)
        page.evaluate('window.scrollTo(0, 30)'); page.wait_for_timeout(150)
        y2 = page.evaluate('scrollY')
        page.click('[data-action="toggle-edit-mode"]'); page.wait_for_timeout(200)
        y3 = page.evaluate('scrollY')
        # Le mode Modifier retire « Ajouter un exercice » : la page peut raccourcir sous la position gardée
        y_max = page.evaluate('document.documentElement.scrollHeight - innerHeight')
        R.check(y3 == min(y2, y_max), f'{t} micro-action : scrollY inchangé ({y2} → {y3}, max {y_max})')
        tab(page, 'program')
        # La tab bar ne recouvre jamais le dernier élément
        for name in ('train', 'history', 'progress', 'program'):
            tab(page, name)
            b = last_content_bottom(page)
            R.check(b <= tabbar_top(page) + 0.5, f'{t} {name} : dernier élément au-dessus de la tab bar ({b:.0f} / {tabbar_top(page):.0f})')
        R.check(not page.errors, f'{t} défilement : aucune erreur JS {page.errors}')


def t_live(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        page.click('[data-action="start-session"][data-cat="push"]'); settle(page)
        R.check(page.locator('.view.session').count() == 1 and route(page) == '#train/session', f'{t} séance ouverte ({route(page)})')
        R.check(page.locator('.tabbar').is_hidden(), f'{t} tab bar masquée pendant la séance')
        down = page.locator('.view.session [data-action="back"]')
        R.check(down.get_attribute('aria-label') == 'Réduire la séance', f'{t} chevron « Réduire la séance »')
        shot(page, LOT, f'seance-{t}')
        page.locator('[data-action="validate-set"]').first.click(); page.wait_for_timeout(200)
        if page.locator('.rest-overlay [data-action="minimize-rest"]').count():
            page.click('.rest-overlay [data-action="minimize-rest"]'); page.wait_for_timeout(100)
        down.click(); settle(page)
        live = page.locator('.livebar')
        R.check(page.locator('.view.dashboard').count() == 1 and live.is_visible(), f'{t} mini-barre sur l\'accueil')
        R.check('Push' in live.inner_text() and '1/21' in live.inner_text(), f'{t} mini-barre « {live.inner_text()} »')
        R.check(page.locator('.hero__btn').inner_text().strip() == 'Reprendre' and 'En cours' in page.locator('.hero__info').inner_text(), f'{t} accueil : « Reprendre »')
        R.check(live.bounding_box()['height'] == 56, f'{t} mini-barre 56 px')
        shot(page, LOT, f'minibarre-{t}')
        for name in ('history', 'progress', 'program'):
            tab(page, name)
            R.check(live.is_visible(), f'{t} mini-barre visible dans {name}')
            lb = live.bounding_box(); tt = tabbar_top(page)
            R.check(lb['y'] + lb['height'] <= tt, f'{t} mini-barre au-dessus de la tab bar ({name})')
            b = last_content_bottom(page)
            R.check(b <= lb['y'] + 0.5, f'{t} {name} : contenu non masqué par la mini-barre ({b:.0f} / {lb["y"]:.0f})')
        live.click(); settle(page)
        R.check(page.locator('.view.session').count() == 1, f'{t} tap mini-barre → séance')
        page.go_back(); settle(page)
        R.check(page.locator('.view.programmes').count() == 1 and live.is_visible(), f'{t} retour système depuis la séance → onglet d\'origine')
        R.check(not page.errors, f'{t} séance : aucune erreur JS {page.errors}')


def t_dirty(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        tab(page, 'history')
        page.locator('[data-action="open-history"]').first.click(); settle(page)
        page.locator('[data-action="edit-session"]').first.click(); settle(page)
        r = page.locator('[data-action="add-reps"]').first
        r.fill('7')
        R.check(page.evaluate("sessionStorage.getItem('ppl_add_draft') !== null"), f'{t} brouillon gardé dans sessionStorage')
        page.click('[data-action="cancel-add-session"]'); page.wait_for_timeout(300)
        acts = page.locator('.ios-dialog__btn').all_inner_texts()
        R.check(acts == ['Ignorer les modifications', 'Continuer la modification'], f'{t} feuille « Ignorer les modifications » {acts}')
        shot(page, LOT, f'ignorer-{t}')
        tap_dialog(page, 'Continuer la modification')
        R.check(page.locator('.view.add-session').count() == 1, f'{t} « Continuer » garde l\'écran')
        page.click('[data-action="cancel-add-session"]'); page.wait_for_timeout(300)
        tap_dialog(page, 'Ignorer les modifications'); settle(page)
        # Fusion : on entre par le détail de la séance (lot 5), « Ignorer » y ramène
        R.check(page.locator('.view.history-detail').count() == 1, f'{t} « Ignorer » → écran précédent')
        R.check(page.evaluate("sessionStorage.getItem('ppl_add_draft')") is None, f'{t} brouillon effacé')
        R.check(not page.errors, f'{t} modifications : aucune erreur JS {page.errors}')


# Animations de transition d'écran en cours (View Transitions ou glissement)
VT_COUNT = """document.getAnimations().filter(a => String(a.effect && a.effect.pseudoElement || '').includes('view-transition')).length
    + (document.documentElement.dataset.navDir ? 1 : 0)"""


def t_motion(bench, eng, dev, theme):
    with bench.page(eng, dev, theme, reduced_motion='reduce') as page:
        page.add_init_script('window.__pplTransitions = true')
        seed(page, theme, ppl_v2_today_json())
        t = tag(dev, theme)
        page.click('.tabbar [data-tab="history"]')
        n = page.evaluate(VT_COUNT)
        R.check(n == 0, f'{t} mouvement réduit : aucune animation ({n})')
        page.locator('[data-action="open-history"]').first.click()
        n = page.evaluate(VT_COUNT)
        R.check(n == 0 and page.locator('.view.history-detail').count() == 1, f'{t} mouvement réduit : écran empilé sans animation ({n})')
    with bench.page(eng, dev, theme) as page:
        page.add_init_script('window.__pplTransitions = true')
        seed(page, theme, ppl_v2_today_json())
        if page.evaluate("typeof document.startViewTransition === 'function'"):
            page.click('.tabbar [data-tab="history"]'); settle(page)
            page.locator('[data-action="open-history"]').first.click()
            page.wait_for_timeout(60)
            R.check(page.evaluate("document.documentElement.dataset.navDir") == 'push', f'{t} transition « push » jouée')
            settle(page)


# ─────────────────────────────────────────────────────────────
#  Tests uniques

def o_restore(bench):
    with bench.page('chromium', 'Pixel 7', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json(), active=old_active_session())
        R.check(route(page) == '#train/session' and page.locator('.view.session').count() == 1, f'restauration : #train/session ({route(page)})')
        page.go_back(); settle(page)
        R.check(page.locator('.view.dashboard').count() == 1 and page.locator('.livebar').is_visible(), 'restauration : retour système → accueil + mini-barre')
        R.check(page.evaluate('location.pathname') == '/', 'restauration : l\'app ne se ferme pas')
        # Fin de séance : plus de séance dans la pile, retour sans écran fantôme
        page.click('.livebar'); settle(page)
        page.click('[data-action="finish-session"]'); page.wait_for_timeout(300)
        tap_dialog(page, 'Enregistrer la séance'); settle(page)
        # Fusion : le bilan du lot 4 s'intercale (Entraînement › Bilan), sans tab bar
        R.check(page.locator('.view.summary').count() == 1 and route(page) == '#train/summary' and page.locator('.tabbar').is_hidden(), f'fin de séance : bilan ({route(page)})')
        page.click('[data-action="summary-done"]'); settle(page)
        R.check(page.locator('.view.dashboard').count() == 1 and page.locator('.livebar').is_hidden(), 'fin de séance : accueil sans mini-barre')
        page.go_forward(); settle(page)
        R.check(page.locator('.view.session').count() == 0, 'fin de séance : avancer ne rouvre pas une séance close')
        R.check(not page.errors, f'restauration : aucune erreur JS {page.errors}')


def o_edge_swipe(bench):
    for eng, dev in (('chromium', 'Pixel 7'), ('webkit', 'iPhone 13')):
        with bench.page(eng, dev, 'light') as page:
            page.add_init_script("Object.defineProperty(navigator, 'standalone', { get: () => true })")
            seed(page, 'light', ppl_v2_today_json())
            page.click('[data-action="go-settings"]'); settle(page)
            ok = page.evaluate("""async () => {
                try { new Touch({ identifier: 0, target: document.body, clientX: 0, clientY: 0 }); } catch (e) { return 'no-touch'; }
                const mk = x => new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 300 });
                const fire = (type, x) => document.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [mk(x)], changedTouches: [mk(x)], bubbles: true }));
                fire('touchstart', 6);
                for (let x = 20; x <= 260; x += 40) { fire('touchmove', x); await new Promise(r => setTimeout(r, 30)); }
                const mid = !!document.querySelector('.edge-layer');
                fire('touchend', 260);
                return mid ? 'ok' : 'no-layer';
            }""")
            if ok == 'no-touch':
                print(f'  ({dev} : TouchEvent indisponible, geste non testé)')
                continue
            settle(page, 600)
            R.check(ok == 'ok', f'{dev} geste de bord : écran précédent dessous ({ok})')
            R.check(page.locator('.view.dashboard').count() == 1 and route(page) == '#train', f'{dev} geste de bord → retour')
            R.check(not page.errors, f'{dev} geste : aucune erreur JS {page.errors}')


TESTS = [t_home, t_back_stack, t_scroll, t_live, t_dirty, t_motion]

if __name__ == '__main__':
    run_main(R, TESTS, once=[o_restore, o_edge_swipe])
