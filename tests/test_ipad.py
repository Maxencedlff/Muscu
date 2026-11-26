"""Mise en page tablette (docs/IPAD.md) : tous les écrans principaux sur iPad, en clair et en sombre.

Appareils (tests/fixtures.py, IPAD_PROFILES) : iPad 13 pouces en portrait (1024 × 1366) et en paysage (1366 × 1024),
iPad mini (744 × 1133), Split View à moitié (678) et étroit (507). Même parcours et mêmes contrôles que les iPhone
récents (tests/test_ecrans_recents.py : défilement horizontal, marges, textes coupés, boutons de 44 pt, largeur de
lecture), plus ceux de la tablette :
  - largeur régulière (≥ 1100 points, paysage) : barre latérale à gauche (icône et nom, onglet actif sur fond gris),
    contenu à sa droite ;
  - largeur moyenne (744 à 1099) : barre d'onglets en bas, contenu plus large qu'une colonne d'iPhone ;
  - Split View étroit (< 744) : exactement la mise en page de l'iPhone (barre d'onglets en bas, pleine largeur) ;
  - dès 900 points : Accueil, Progrès, Réglages, Nutrition et page d'un programme en deux colonnes, sans
    titre de groupe laissé seul en bas d'une colonne ; en dessous, une seule colonne ;
  - écrans pleins (séance, bilan) : une colonne de 720 au plus, centrée.
Et une fois : un iPhone (17) et l'iPhone Duo ouvert en grand paysage ne prennent JAMAIS la mise en page tablette.

    PPL_URL=http://localhost:8790/ python3 tests/test_ipad.py
    PPL_DEV="iPad 13 paysage" PPL_THEME=dark python3 tests/test_ipad.py
Captures : $PPL_SCRATCH/shots/lotipad/.
"""
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
  // Deux colonnes (css/tablet.css : column-count) : conteneur de l'écran affiché, blocs visibles à plusieurs abscisses
  const grilles = [...document.querySelectorAll('#app > .view > .home, #app > .view > .scr')].filter(g => g.offsetParent).map(g => {
    if ((parseInt(getComputedStyle(g).columnCount, 10) || 1) < 2) return 1;
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


TESTS = [t_ipad]

if __name__ == '__main__':
    if not os.environ.get('PPL_DEVICES') and not os.environ.get('PPL_DEV'):
        os.environ['PPL_DEVICES'] = 'ipad'
    run_main(R, TESTS, once=[t_iphone_inchange])
