"""Visite de l'accueil (js/features/tour.js, logique dans js/data/tour.js ; tests unitaires : tests/unit/tour.mjs).

Première arrivée sur l'accueil après les questions : voile, trou sur le vrai élément, bulle « Étape 1 sur 7 » ;
« Passer », « Suivant » jusqu'à « C'est parti », ne revient pas au lancement suivant, « Revoir la visite » dans
Réglages › Aide, étape sautée quand son élément manque, rotation, réduire les animations, utilisateur existant
(aucune visite), texte agrandi AX33 sur iPhone SE. Sombre et clair.
Captures : PPL_TUTO_SHOTS (par défaut ~/.local/share/mdlf/panel/tuto/t1/), iPhone 13 et iPhone SE seulement.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'tuto'
R = Results(LOT)
SHOT_DIR = os.environ.get('PPL_TUTO_SHOTS', os.path.expanduser('~/.local/share/mdlf/panel/tuto/t1'))
SHOT_DEVICES = ('iPhone 13', 'iPhone SE')
AX33 = """(() => { const st = document.createElement('style'); st.textContent = 'html { font: 33px -apple-system, system-ui, sans-serif !important; }';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st)); })()"""
TITLES = ['Démarrer', 'Au programme', 'Nutrition', 'Défis', 'Historique', 'Progrès', 'Programme']


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def tshot(page, dev, name):
    if dev not in SHOT_DEVICES:
        return
    os.makedirs(SHOT_DIR, exist_ok=True)
    settle(page)
    page.wait_for_timeout(300)   # fin du glissement du trou et de la bulle
    page.screenshot(path=os.path.join(SHOT_DIR, name.replace(' ', '_').replace('+', 'plus') + '.png'))


def onboard(page, theme):
    """Nouvel utilisateur : les trois questions puis « Commencer » ; la visite s'ouvre sur l'accueil."""
    seed(page, theme, None)
    page.evaluate("checkTypeSize()")   # texte agrandi posé après le chargement (AX33) : relu comme au changement d'iOS
    page.wait_for_selector('.onb__page--place')
    for sel in ('[data-action="onb-place"][data-val="salle"]', '[data-action="onb-freq"][data-val="3"]',
                '[data-action="onb-level"][data-val="confirme"]', '[data-action="onb-start"]'):
        page.click(sel)
        settle(page)
    page.wait_for_selector('.tour .tour__head', timeout=8000)
    settle(page)
    page.wait_for_timeout(300)


STATE = """() => {
  const q = s => document.querySelector(s), r = el => { const b = el.getBoundingClientRect(); return { top: b.top, left: b.left, bottom: b.bottom, right: b.right, width: b.width, height: b.height }; };
  const tour = q('.tour');
  if (!tour) return null;
  const step = tour__steps();
  return {
    count: q('.tour__count')?.textContent, title: q('.tour__title')?.textContent, text: q('.tour__text')?.textContent,
    next: q('.tour__next')?.textContent, focus: document.activeElement?.id,
    hole: r(q('.tour__hole')), bubble: r(q('.tour__bubble')), skip: r(q('.tour__skip')), nextBox: r(q('.tour__next')),
    target: step ? r(step) : null, vw: innerWidth, vh: innerHeight,
    inert: document.getElementById('app').inert, modal: tour.getAttribute('aria-modal'),
    labelled: q('#' + tour.getAttribute('aria-labelledby'))?.textContent,
    overflow: [...tour.querySelectorAll('.tour__title, .tour__text, .tour__count, button')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent),
    seen: data.tour ?? null,
  };
  function tour__steps() { const s = tour_cur(); return s ? document.querySelector(s.sel) : null; }
  function tour_cur() { return window.tourCurrent ? tourCurrent() : null; }
}"""


def state(page):
    page.evaluate("window.tourCurrent = () => tour.root ? tour.steps[tour.i] : null")
    return page.evaluate(STATE)


def inside(a, b, tol=1.5):
    """a contenu dans b (rectangles)"""
    return a['top'] >= b['top'] - tol and a['left'] >= b['left'] - tol and a['bottom'] <= b['bottom'] + tol and a['right'] <= b['right'] + tol


def overlaps(a, b):
    return not (a['bottom'] <= b['top'] or a['top'] >= b['bottom'] or a['right'] <= b['left'] or a['left'] >= b['right'])


def check_step(t, st, i, n, title):
    view = {'top': 0, 'left': 0, 'bottom': st['vh'], 'right': st['vw']}
    R.check(st['count'] == f'Étape {i} sur {n}' and st['title'] == title, f'{t} étape {i} : « {st["count"]} », « {st["title"]} » (attendu {title})')
    R.check(st['focus'] == 'tourTitle' and st['modal'] == 'true' and st['inert'] is True
            and st['labelled'].startswith(f'Étape {i} sur {n}'), f'{t} étape {i} : VoiceOver sur la bulle, app inerte dessous')
    R.check(st['target'] is not None and st['target']['top'] >= -1 and st['target']['top'] < st['vh'], f'{t} étape {i} : élément dans l\'écran')
    # Le trou couvre l'élément (rogné seulement s'il est plus haut que la place laissée par la bulle)
    tgt = st['target']
    vis = {**tgt, 'bottom': min(tgt['bottom'], st['hole']['bottom'])}
    R.check(inside(vis, st['hole'], 2) and st['hole']['height'] >= 40, f'{t} étape {i} : trou sur l\'élément')
    R.check(inside(st['bubble'], view) and not overlaps(st['bubble'], st['hole']), f'{t} étape {i} : bulle dans l\'écran, à côté du trou')
    for k in ('skip', 'nextBox'):
        R.check(inside(st[k], view) and st[k]['height'] >= 44 and st[k]['width'] >= 44, f'{t} étape {i} : {k} visible, 44 pt')
    R.check(not st['overflow'], f'{t} étape {i} : rien de coupé {st["overflow"]}')
    R.check(len(st['text']) <= 120 and '!' not in st['text'], f'{t} étape {i} : texte court et sobre ({len(st["text"])} signes)')


def t_parcours(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        onboard(page, theme)
        st = state(page)
        n = len(TITLES)
        R.check(st['seen'] == 'seen', f'{t} visite notée vue dès l\'ouverture')
        for i, title in enumerate(TITLES, 1):
            st = state(page)
            check_step(t, st, i, n, title)
            R.check(st['next'] == ('C\'est parti' if i == n else 'Suivant'), f'{t} étape {i} : bouton « {st["next"]} »')
            tshot(page, dev, f'{i}-{title.lower().replace(" ", "-")}-{t}')
            if i < n:
                page.click('.tour [data-action="tour-next"]')
                settle(page)
                page.wait_for_function(f"document.querySelector('.tour__count')?.textContent === 'Étape {i + 1} sur {n}'")
        page.click('.tour [data-action="tour-next"]')
        settle(page)
        R.check(page.locator('.tour').count() == 0 and page.evaluate("document.getElementById('app').inert") is False,
                f'{t} « C\'est parti » : visite fermée, app utilisable')
        R.check(page.evaluate('data.tour') == 'seen' and ls(page, 'ppl_v2') and '"tour":"seen"' in ls(page, 'ppl_v2'),
                f'{t} mémorisée sur l\'appareil (ppl_v2)')

        # Ne revient pas : relance de l'app
        page.reload()
        page.wait_for_selector('#app > *')
        page.wait_for_timeout(1500)
        R.check(page.locator('.tour').count() == 0, f'{t} relance : pas de visite')

        # Réglages › Aide › Revoir la visite : accueil, étape 1
        page.evaluate("navigate('settings')")
        page.wait_for_selector('.view.settings-view')
        cell = page.locator('.view.settings-view [data-action="tour-replay"]')
        R.check(cell.count() == 1 and cell.inner_text().strip() == 'Revoir la visite' and cell.bounding_box()['height'] >= 44,
                f'{t} Réglages › Aide : « Revoir la visite »')
        R.check(page.locator('.view.settings-view .group-title:text-is("Aide") + .group [data-action="tour-replay"]').count() == 1,
                f'{t} dans le groupe Aide')
        if dev in SHOT_DEVICES:
            cell.scroll_into_view_if_needed()
            tshot(page, dev, f'5-reglages-aide-{t}')
        cell.click()
        page.wait_for_selector('.tour .tour__head', timeout=8000)
        settle(page)
        page.wait_for_timeout(300)
        st = state(page)
        R.check(page.evaluate('currentView()') == 'dashboard', f'{t} Revoir la visite : retour à l\'accueil')
        check_step(t, st, 1, n, 'Démarrer')

        # Rotation (iPhone 13) : le trou suit l'élément
        if dev == 'iPhone 13':
            page.click('.tour [data-action="tour-next"]')
            settle(page)
            page.set_viewport_size({'width': 844, 'height': 390})
            page.wait_for_timeout(500)
            st = state(page)
            R.check(st['vw'] == 844 and st['title'] == 'Au programme', f'{t} paysage : même étape')
            tgt = st['target']
            vis = {**tgt, 'bottom': min(tgt['bottom'], st['hole']['bottom'])}
            R.check(inside(vis, st['hole'], 2) and inside(st['bubble'], {'top': 0, 'left': 0, 'bottom': 390, 'right': 844}),
                    f'{t} paysage : trou sur l\'élément, bulle dans l\'écran')
            tshot(page, dev, f'6-paysage-{t}')
            page.set_viewport_size({'width': 390, 'height': 664})
            page.wait_for_timeout(300)
        page.click('.tour [data-action="tour-skip"]')
        settle(page)
        R.check(page.locator('.tour').count() == 0, f'{t} Passer : fermée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_passer_et_existant(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme, reduced_motion='reduce') as page:
        onboard(page, theme)
        dur = page.evaluate("getComputedStyle(document.querySelector('.tour__hole')).transitionDuration")
        R.check(all(float(x.strip().rstrip('s') or 0) == 0 for x in dur.split(',')), f'{t} réduire les animations : rien ne glisse ({dur})')
        page.click('.tour [data-action="tour-skip"]')
        settle(page)
        R.check(page.locator('.tour').count() == 0 and page.evaluate('data.tour') == 'seen', f'{t} Passer dès l\'étape 1 : fermée, vue')
        page.reload()
        page.wait_for_selector('#app > *')
        page.wait_for_timeout(1500)
        R.check(page.locator('.tour').count() == 0, f'{t} Passer : ne revient pas')

        # Élément manquant : l'étape est sautée, jamais de blocage
        page.evaluate("data.tour = 'due'; save(true); render()")
        page.wait_for_selector('.tour .tour__head', timeout=8000)
        page.evaluate("document.querySelector('.hero .targets')?.remove()")
        page.click('.tour [data-action="tour-next"]')
        settle(page)
        R.check(page.locator('.tour__title').inner_text() == 'Programme', f'{t} élément absent : étape sautée')
        page.evaluate("document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.remove())")
        page.click('.tour [data-action="tour-next"]')
        settle(page)
        R.check(page.locator('.tour').count() == 0 and page.evaluate("document.getElementById('app').inert") is False,
                f'{t} plus aucun élément : visite fermée, app utilisable')

        # Utilisateur existant (séances, questions passées depuis longtemps) : jamais de visite
        seed(page, theme, ppl_v2_today_json())
        page.wait_for_timeout(1500)
        R.check(page.locator('.tour').count() == 0 and page.evaluate('data.tour ?? null') is None, f'{t} utilisateur existant : pas de visite')
        # « Plus tard » sur les questions : la visite part aussi
        seed(page, theme, None)
        page.wait_for_selector('.onb__page--place')
        page.click('.onb [data-action="onb-later"]')
        page.wait_for_selector('.tour .tour__head', timeout=8000)
        R.check(page.locator('.tour__count').inner_text() == 'Étape 1 sur 7', f'{t} Plus tard : visite à l\'accueil')
        page.keyboard.press('Escape')
        settle(page)
        R.check(page.locator('.tour').count() == 0, f'{t} Échap : fermée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_ax33(bench, eng, dev, theme):
    """Très grand texte (AX33, 33 px) sur iPhone SE : bulle entière dans l'écran, Passer et Suivant visibles."""
    if dev != 'iPhone SE':
        return
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        page.add_init_script(AX33)
        onboard(page, theme)
        R.check(page.evaluate("document.documentElement.classList.contains('type-xxl')"), f'{t} AX33 : très grand texte')
        n = len(TITLES)
        for i, title in enumerate(TITLES, 1):
            st = state(page)
            check_step(t, st, i, n, title)
            tshot(page, dev, f'ax33-{i}-{title.lower().replace(" ", "-")}-{t}')
            page.click('.tour [data-action="tour-next"]')
            settle(page)
        R.check(page.locator('.tour').count() == 0, f'{t} AX33 : C\'est parti, fermée')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


run_main(R, [t_parcours, t_passer_et_existant, t_ax33])
