"""Mise en page tablette (docs/IPAD.md) : tous les écrans principaux sur iPad, en clair et en sombre.

Appareils (tests/fixtures.py, IPAD_PROFILES) : iPad 13 pouces en portrait (1024 × 1366) et en paysage (1366 × 1024),
iPad mini en portrait (744 × 1133) et en paysage (1133 × 744), iPad 11 pouces en paysage (1194 × 834), Split View à
moitié (678) et étroit (507). Même parcours et mêmes contrôles que les iPhone
récents (tests/test_ecrans_recents.py : défilement horizontal, marges, textes coupés, boutons de 44 pt, largeur de
lecture), plus ceux de la tablette :
  - largeur régulière (≥ 1100 points, paysage) : barre latérale à gauche (icône et nom, onglet actif sur fond gris),
    contenu à sa droite ;
  - largeur moyenne (744 à 1099) : barre d'onglets en bas, contenu plus large qu'une colonne d'iPhone ;
  - Split View étroit (< 744) : exactement la mise en page de l'iPhone (barre d'onglets en bas, pleine largeur) ;
  - dès 900 points : Accueil, Progrès, Réglages, Nutrition et page d'un programme en deux colonnes, sans
    titre de groupe laissé seul en bas d'une colonne ; en dessous, une seule colonne ;
  - écrans pleins (séance, bilan) : une colonne de 720 au plus, centrée.
En paysage (t_paysage) : toucher un muscle de Progrès ne fait pas défiler la page et sa carte d'info reste à l'écran
(audit B1), feuille sheet() au centre sans poignée, mini-barre de séance à droite de la barre latérale, texte agrandi
(AX33) sans texte coupé. Une fois : rotation à chaud (t_rotation), et un iPhone (17) et l'iPhone Duo ouvert en grand
paysage ne prennent JAMAIS la mise en page tablette.

    PPL_URL=http://localhost:8790/ python3 tests/test_ipad.py
    PPL_DEV="iPad 13 paysage" PPL_THEME=dark python3 tests/test_ipad.py
Captures : $PPL_SCRATCH/shots/lotipad/.
"""
import contextlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
import fixtures
from test_ecrans_recents import parcours, NOW, donnees

LOT = 'ipad'
R = Results(LOT)
MAX_LECTURE = 760   # une carte ou un paragraphe plus large est étalé (colonne de lecture de la tablette : 720)
LARGE = 1100        # largeur régulière (paysage) : barre latérale
DEUX_COLONNES = 900 # écrans de survol en deux colonnes (13 pouces en portrait, paysage)
MOYEN = 744         # iPad mini en portrait : contenu élargi, barre d'onglets en bas

ETAT_JS = r"""() => {
  const W = document.documentElement.clientWidth, H = innerHeight;
  const bar = document.querySelector('.tabbar'), app = document.querySelector('#app > .view');
  const r = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  const actif = document.querySelector('.tabbar .tabbar__btn--active');
  const libelles = [...document.querySelectorAll('.tabbar .tabbar__label')].map(e => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0);
  // Deux colonnes (css/tablet.css) : grille de l'Accueil (.tablet-col) ou colonnes CSS (column-count) ; blocs visibles
  // du conteneur de l'écran affiché à plusieurs abscisses
  const grilles = [...document.querySelectorAll('#app > .view > .home, #app > .view > .scr')].filter(g => g.offsetParent).map(g => {
    const s = getComputedStyle(g);
    if (s.display !== 'grid' && (parseInt(s.columnCount, 10) || 1) < 2) return 1;
    return new Set([...g.children].filter(c => c.getBoundingClientRect().height > 0).map(c => Math.round(c.getBoundingClientRect().left))).size;
  });
  // Titres de groupe seuls en bas d'une colonne : le bloc suivant commence dans une autre colonne
  const orphelins = [...document.querySelectorAll('#app > .view > .scr .group-title')].filter(t => {
    const n = t.nextElementSibling; if (!n || !t.offsetParent) return false;
    return Math.abs(n.getBoundingClientRect().left - t.getBoundingClientRect().left) > 4;
  }).map(t => t.textContent.trim().slice(0, 30));
  return { W, H, tablet: document.documentElement.classList.contains('tablet'), bar: r(bar), app: r(app),
           actifFond: actif ? getComputedStyle(actif).backgroundColor : null, libelles, grilles, orphelins };
}"""


def controles_tablette(page, t, nom):
    o = page.evaluate(ETAT_JS)
    W, H, bar, app = o['W'], o['H'], o['bar'], o['app']
    R.check(o['tablet'], f'{t} {nom} : classe tablet posée sur un iPad')
    R.check(not o['orphelins'], f'{t} {nom} : aucun titre de groupe seul en bas d\'une colonne {o["orphelins"]}')
    if not app:
        return
    if not bar or bar['w'] == 0:
        # Plein écran (séance, bilan) : une colonne de saisie centrée, jamais étalée
        R.check(app['w'] <= 721 or W < MOYEN, f"{t} {nom} : écran plein centré sur une colonne ({app['w']:.0f} px)")
        R.check(abs(app['l'] - (W - app['r'])) <= 2, f"{t} {nom} : colonne centrée ({app['l']:.0f} / {W - app['r']:.0f})")
        return
    if W >= LARGE:
        R.check(bar['l'] <= 0.5 and bar['h'] >= H - 1 and bar['w'] <= 300, f'{t} {nom} : barre latérale à gauche sur toute la hauteur {bar}')
        R.check(all(o['libelles']), f'{t} {nom} : chaque onglet de la barre latérale a son nom')
        R.check(o['actifFond'] not in (None, 'rgba(0, 0, 0, 0)', 'transparent'), f"{t} {nom} : onglet actif sur fond gris ({o['actifFond']})")
        R.check(app['l'] >= bar['r'] - 0.5, f"{t} {nom} : l'écran commence à droite de la barre latérale ({app['l']:.0f} ≥ {bar['r']:.0f})")
    else:
        R.check(abs(bar['b'] - H) <= 1 and bar['w'] >= W - 1, f'{t} {nom} : barre d\'onglets en bas, sur toute la largeur {bar}')
        if W >= MOYEN:
            R.check(app['w'] > 660, f"{t} {nom} : contenu plus large qu'une colonne d'iPhone ({app['w']:.0f} px)")
        else:
            R.check(abs(app['w'] - W) <= 1, f"{t} {nom} : Split View étroit, pleine largeur comme sur iPhone ({app['w']:.0f} / {W})")
    if W >= DEUX_COLONNES and nom in ('accueil', 'progres', 'reglages', 'nutrition', 'programme'):
        R.check(any(n >= 2 for n in o['grilles']), f'{t} {nom} : deux colonnes {o["grilles"]}')
    if W < DEUX_COLONNES:
        R.check(not any(n >= 2 for n in o['grilles']), f'{t} {nom} : une seule colonne sous {DEUX_COLONNES} points {o["grilles"]}')


ENGINES = [e for e in os.environ.get('PPL_ENGINES', 'webkit,chromium').split(',') if e]


def t_ipad(bench, eng, dev, theme):
    """Parcours dans WebKit (moteur de l'iPad) et Chromium (PPL_ENGINES), quel que soit le moteur du profil."""
    if dev not in IPAD_PROFILES:
        R.skip(f'{dev} : pas un iPad, hors du lot')
        return
    for e in ENGINES:
        parcours(bench, e, dev, theme, safe_insets(dev), R, f'{LOT}', MAX_LECTURE, en_plus=controles_tablette,
                 suffixe='' if e == 'webkit' else '-chromium')


def t_iphone_inchange(bench):
    """Les iPhone (même l'iPhone Duo ouvert, plus large qu'un iPad mini) gardent leur mise en page : pas de classe
    tablet, barre d'onglets en bas, aucune règle de la tablette appliquée."""
    for dev in ('iPhone 17', 'iPhone Duo grand paysage'):
        with bench.frozen_page(NOW, 'webkit', dev, 'dark', locale='fr-FR') as page:
            seed(page, 'dark', donnees(), extra={'ppl_welcome_seen': '1'})
            settle(page)
            o = page.evaluate(ETAT_JS)
            R.check(not o['tablet'], f'{dev} : pas de classe tablet')
            R.check(o['bar'] and abs(o['bar']['b'] - o['H']) <= 1 and o['bar']['h'] < 120, f"{dev} : barre d'onglets en bas {o['bar']}")
            R.check(not any(n >= 2 for n in o['grilles']), f'{dev} : aucune grille en colonnes {o["grilles"]}')
            R.check(not page.errors, f'{dev} : aucune erreur JS {page.errors[:2]}')


# ─────────────────────────────────────────────────────────────
#  Paysage (barre latérale) : gestes et états que le parcours ne voit pas
# ─────────────────────────────────────────────────────────────
# Fin des animations finies (feuille qui monte), comme dans test_ecrans_recents.py
FIN_JS = """() => document.getAnimations().every(a => a.playState !== 'running' || (a.effect && a.effect.getTiming().iterations === Infinity))"""
INFO_JS = """() => { const e = document.querySelector('.atlas-info'); if (!e || e.hidden) return null; const b = e.getBoundingClientRect();
  return { t: Math.round(b.top), b: Math.round(b.bottom), H: innerHeight, y: Math.round(scrollY) }; }"""
COUPES_JS = """() => [...document.querySelectorAll('#app *, .tabbar *')].filter(e => !e.children.length && e.textContent.trim()
  && e.getBoundingClientRect().width > 1 && !e.closest('[aria-hidden=true], .sr-text, .visually-hidden, [class*="sr-"]') && getComputedStyle(e).display !== 'inline'
  && getComputedStyle(e).overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 30)).slice(0, 5)"""


def t_paysage(bench, eng, dev, theme):
    """Largeur régulière seulement (barre latérale) : toucher un muscle, feuille sheet(), mini-barre, texte agrandi."""
    if dev not in IPAD_PROFILES or IPAD_PROFILES[dev][0]['viewport']['width'] < LARGE:
        R.skip(f'{dev} : pas de barre latérale, hors de ce test')
        return
    for e in ENGINES:
        t = f'{dev}-{theme}{"" if e == "webkit" else "-chromium"}-paysage'.replace(' ', '_')
        with bench.frozen_page(NOW, e, dev, theme, locale='fr-FR') as page:
            seed(page, theme, donnees(), extra={'ppl_welcome_seen': '1'})
            settle(page)
            sat, _, sab, _ = safe_insets(dev)

            # 1. Toucher un muscle de Progrès (audit B1) : la barre latérale est en haut (top 0), rien ne doit la
            #    prendre pour une barre d'onglets du bas ; la page ne défile pas, la carte d'info reste à l'écran
            page.locator('.tabbar [data-tab="progress"]').first.click()
            page.wait_for_selector('.view.stats .body-map')
            page.wait_for_function("() => [...document.querySelectorAll('.view.stats .body-map__base')].every(i => i.complete && i.naturalWidth)")
            settle(page)
            fig = page.locator('.view.stats .body-map').filter(visible=True).first.bounding_box()
            y0 = page.evaluate('scrollY')
            page.mouse.click(fig['x'] + fig['width'] * 0.27, fig['y'] + fig['height'] * 0.33)
            with contextlib.suppress(Exception):   # sous charge, la carte peut tarder (vu sur le PC chargé, 26/11)
                page.wait_for_selector('.atlas-info:not([hidden])', timeout=5000)
            page.wait_for_timeout(900)   # fenêtre du double toucher (ATLAS_DOUBLE_MS), puis défilement éventuel
            info = page.evaluate(INFO_JS)
            R.check(info is not None, f'{t} toucher un muscle : carte d\'info ouverte')
            if info:
                R.check(info['y'] == y0, f"{t} toucher un muscle : la page ne défile pas ({y0} → {info['y']})")
                R.check(info['t'] >= sat and info['b'] <= info['H'] - sab, f'{t} toucher un muscle : carte d\'info à l\'écran {info}')
            tip = page.evaluate("() => { const e = document.querySelector('.body-tip'); if (!e) return null; const b = e.getBoundingClientRect(); return [b.top, b.bottom, innerHeight]; }")
            if tip:
                R.check(tip[0] >= 0 and tip[1] <= tip[2], f'{t} bulle du personnage dans l\'écran {tip}')

            # 2. Feuille sheet() : au centre, coins arrondis, sans poignée, dans les marges
            page.evaluate("() => { window.__sheetDone = sheet({ title: 'Mensurations', confirm: 'OK', body: '<p class=\"sheet-empty\">Rien à saisir</p>' }); }")
            page.wait_for_selector('.sheet-root .sheet')
            with contextlib.suppress(Exception):
                page.wait_for_function(FIN_JS, timeout=3000)
            sh = page.evaluate("""() => { const s = document.querySelector('.sheet-root .sheet').getBoundingClientRect(), g = document.querySelector('.sheet-root .sheet__grabber');
              return { l: s.left, r: innerWidth - s.right, t: s.top, b: innerHeight - s.bottom, grab: !!g && g.getBoundingClientRect().height > 0,
                       radius: parseFloat(getComputedStyle(document.querySelector('.sheet-root .sheet')).borderBottomLeftRadius) }; }""")
            # Centrée entre les marges de sécurité (24 en haut, 20 en bas sur iPad)
            R.check(abs(sh['l'] - sh['r']) <= 2 and abs((sh['t'] - sat) - (sh['b'] - sab)) <= 2, f'{t} feuille au centre de l\'écran {sh}')
            R.check(sh['t'] >= sat + 24 - 0.5 and sh['b'] >= sab + 24 - 0.5, f'{t} feuille dans les marges {sh}')
            R.check(not sh['grab'] and sh['radius'] >= 12, f'{t} feuille de formulaire : sans poignée, coins du bas arrondis {sh}')
            shot(page, LOT, f'{t}-feuille')
            page.locator('.sheet-root .sheet__btn--cancel, .sheet-root [data-sheet="cancel"]').first.click()
            page.wait_for_selector('.sheet-root', state='detached')

            # 3. Mini-barre de la séance avec la barre latérale : dans le contenu, jamais sur la barre
            page.locator('.tabbar [data-tab="train"]').first.click()
            page.wait_for_selector('.view.dashboard')
            page.locator('.view.dashboard [data-action="start-session"]').first.click()
            page.wait_for_selector('.view.session')
            page.locator('.view.session [data-action="back"]').first.click()
            page.wait_for_selector('.livebar:not([hidden])')
            settle(page)
            lb = page.evaluate("""() => { const l = document.querySelector('.livebar').getBoundingClientRect(), b = document.querySelector('.tabbar').getBoundingClientRect(),
              v = document.querySelector('#app > .view').getBoundingClientRect(); return { l: l.left, r: l.right, b: l.bottom, side: b.right, vl: v.left, vr: v.right, H: innerHeight }; }""")
            R.check(lb['l'] >= lb['side'] + 8 and lb['l'] >= lb['vl'] - 1 and lb['r'] <= lb['vr'] + 1, f'{t} mini-barre dans le contenu, à droite de la barre latérale {lb}')
            R.check(lb['b'] <= lb['H'] - sab, f'{t} mini-barre au-dessus de la barre d\'accueil {lb}')
            shot(page, LOT, f'{t}-mini-barre')

            # 4. Texte agrandi (AX33) : barre latérale et écrans sans texte coupé, onglets de 44 pt au moins
            page.evaluate("""() => { const h = document.documentElement; h.style.fontSize = '33px'; h.classList.add('type-xl', 'type-xxl'); render(); }""")
            for tab, sel in (('train', '.view.dashboard'), ('progress', '.view.stats'), ('program', '.view.my-programmes, .view.programmes')):
                page.locator(f'.tabbar [data-tab="{tab}"]').first.click()
                page.wait_for_selector(sel)
                settle(page)
                coupes = page.evaluate(COUPES_JS)
                R.check(not coupes, f'{t} AX33 {tab} : aucun texte coupé {coupes}')
                btns = page.evaluate("[...document.querySelectorAll('.tabbar .tabbar__btn')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })")
                R.check(all(w >= 44 and h >= 44 for w, h in btns), f'{t} AX33 {tab} : onglets de 44 pt au moins {btns}')
                lab = page.evaluate("parseFloat(getComputedStyle(document.querySelector('.tabbar__label')).fontSize)")
                R.check(lab > 17, f'{t} AX33 : les noms de la barre latérale grandissent avec le texte ({lab} px)')
                shot(page, LOT, f'{t}-ax33-{tab}')
            R.check(not page.errors, f'{t} aucune erreur JS {page.errors[:2]}')


def t_rotation(bench):
    """Rotation à chaud sur l'iPad 13 pouces : portrait → paysage → portrait, sans recharger. La barre d'onglets passe à
    gauche puis revient en bas, l'Accueil garde ses deux colonnes fixes, rien ne déborde."""
    for e in ENGINES:
        with bench.frozen_page(NOW, e, 'iPad 13 portrait', 'dark', locale='fr-FR') as page:
            seed(page, 'dark', donnees(), extra={'ppl_welcome_seen': '1'})
            settle(page)
            for w, h, lateral in ((1024, 1366, False), (1366, 1024, True), (1024, 1366, False)):
                page.set_viewport_size({'width': w, 'height': h})
                settle(page)
                o = page.evaluate(ETAT_JS)
                bar = o['bar']
                ok = (bar['l'] <= 0.5 and bar['h'] >= h - 1) if lateral else (abs(bar['b'] - h) <= 1 and bar['w'] >= w - 1)
                R.check(ok, f'rotation {e} {w}×{h} : barre {"latérale" if lateral else "d onglets en bas"} {bar}')
                R.check(any(n >= 2 for n in o['grilles']), f'rotation {e} {w}×{h} : Accueil en deux colonnes {o["grilles"]}')
                R.check(page.evaluate('document.documentElement.scrollWidth') <= w, f'rotation {e} {w}×{h} : pas de défilement horizontal')
                if lateral:
                    R.check(o['app']['l'] >= bar['r'] - 0.5, f'rotation {e} : écran à droite de la barre latérale {o["app"]}')
            R.check(not page.errors, f'rotation {e} : aucune erreur JS {page.errors[:2]}')


TESTS = [t_ipad, t_paysage]

if __name__ == '__main__':
    if not os.environ.get('PPL_DEVICES') and not os.environ.get('PPL_DEV'):
        os.environ['PPL_DEVICES'] = 'ipad'
    run_main(R, TESTS, once=[t_iphone_inchange, t_rotation])
