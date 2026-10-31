"""Récaps de la semaine, du mois et de l'année : carte « Ta semaine » de l'accueil (dimanche soir, lundi),
Progrès › Récaps, écrans qui s'enchaînent, partage d'un écran en image story 1080 × 1920, réglage.

Données : tests/donnees_realistes.py (6 mois, dernière séance le 15/10/2026). L'heure de l'app est figée
(Date remplacé avant le chargement) : lundi 19/10/2026 pour la carte, 5/12/2026 pour le bilan de l'année.
Les images produites sont écrites dans $PPL_SCRATCH/shots/recaps/ pour être regardées.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_recaps.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import base64
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa
from donnees_realistes import six_mois_json

LOT = 'recaps'
R = Results(LOT)
OUT = os.path.join(SHOTS, 'recaps')

# Heure figée dans la page (heure locale du navigateur), posée avant tout script de l'app
def frozen(y, m, d, h=10, mi=0):
    return f"""(() => {{
      const RealDate = Date, NOW = new RealDate({y}, {m - 1}, {d}, {h}, {mi}).getTime();
      window.Date = class extends RealDate {{
        constructor(...a) {{ if (a.length) super(...a); else super(NOW); }}
        static now() {{ return NOW; }}
      }};
    }})()"""

FAKE_SHARE = """() => {
  window.__shared = [];
  navigator.canShare = o => !!(o && o.files && o.files.length);
  navigator.share = async o => { const f = o.files[0]; window.__shared.push({ name: f.name, type: f.type, size: f.size, title: o.title }); };
}"""


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def png_size(data_url):
    raw = base64.b64decode(data_url.split(',', 1)[1])
    if raw[:8] != b'\x89PNG\r\n\x1a\n':
        return None, raw
    return struct.unpack('>II', raw[16:24]), raw


def save_png(raw, name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.png')
    with open(path, 'wb') as fh:
        fh.write(raw)
    return path


def open_page(bench, eng, dev, theme, when, **extra):
    """Page prête : heure figée, données réalistes, faux partage."""
    cm = bench.page(eng, dev, theme, **extra)
    page = cm.__enter__()
    page.add_init_script(frozen(*when))
    seed(page, theme, six_mois_json())
    page.evaluate(FAKE_SHARE)
    return cm, page


def recap_state(page):
    return page.evaluate("""() => {
      const pages = [...document.querySelectorAll('.recap-page')];
      const active = document.querySelector('.recap-page.is-active');
      const track = document.querySelector('#recapTrack');
      return { n: pages.length, ids: pages.map(p => p.getAttribute('aria-label').slice(0, 60)),
               active: active ? +active.dataset.index : -1,
               dots: document.querySelectorAll('#recapDots i').length,
               onIdx: [...document.querySelectorAll('#recapDots i')].findIndex(d => d.classList.contains('is-on')),
               kicker: active?.querySelector('.recap-page__kicker')?.textContent,
               value: active?.querySelector('.recap-page__value')?.textContent,
               caption: active?.querySelector('.recap-page__caption')?.textContent,
               scroll: track ? Math.round(track.scrollLeft / Math.max(1, track.clientWidth)) : -1,
               sw: document.documentElement.scrollWidth, vw: innerWidth,
               prevOff: document.querySelector('[data-action="recap-prev"]')?.disabled,
               nextOff: document.querySelector('[data-action="recap-next"]')?.disabled };
    }""")


def share_current(page, t, where, name):
    """« Partager » sur l'écran affiché : aperçu 9:16, image PNG 1080 × 1920 non vide, fichier remis au partage."""
    page.click('[data-action="recap-share"]')
    page.wait_for_selector('.share-preview__img')
    page.wait_for_function("!document.querySelector('.share-preview__send').disabled", timeout=8000)
    m = page.evaluate("""() => {
      const f = document.querySelector('.share-preview__frame').getBoundingClientRect();
      const c = document.querySelector('.share-preview__img');
      return { ratio: f.width / f.height, label: c.getAttribute('aria-label'), url: c.toDataURL('image/png') };
    }""")
    R.check(abs(m['ratio'] - 9 / 16) < .02, f'{t} {where} : aperçu au format 9:16')
    R.check(m['label'] and (m['label'].startswith('Ta ') or m['label'].startswith('Ton ')), f'{t} {where} : image décrite pour VoiceOver ({m["label"][:60]})')
    size, raw = png_size(m['url'])
    R.check(size == (1080, 1920), f'{t} {where} : image PNG 1080 × 1920 ({size})')
    R.check(len(raw) > 40_000, f'{t} {where} : image non vide ({len(raw)} octets)')
    path = save_png(raw, name)
    page.click('[data-action="share-story-send"]')
    page.wait_for_timeout(500)
    sh = page.evaluate('window.__shared')
    R.check(sh and sh[-1]['type'] == 'image/png' and sh[-1]['name'].startswith('mdlf-training-recap-') and sh[-1]['size'] > 40_000,
            f'{t} {where} : fichier PNG remis au partage {sh[-1] if sh else None}')
    R.check(page.locator('.sheet-root').count() == 0, f'{t} {where} : aperçu fermé après le partage')
    return path, sh[-1]['name'] if sh else ''


def t_semaine(bench, eng, dev, theme):
    """Lundi : carte « Ta semaine » sur l'accueil → récap de la semaine passée, écrans, partage, carte vue."""
    t = tag(dev, theme)
    cm, page = open_page(bench, eng, dev, theme, (2026, 10, 19, 10))
    try:
        card = page.locator('.recap-card')
        R.check(card.count() == 1 and card.is_visible(), f'{t} lundi : carte « Ta semaine » sur l\'accueil')
        txt = card.inner_text()
        R.check('ta semaine' in txt.lower() and '2 séances' in txt and '12 – 18 oct.' in txt, f'{t} carte : titre, semaine et chiffres réels ({txt.split(chr(10))[:3]})')
        m = page.evaluate("""() => { const c = document.querySelector('.recap-card__close').getBoundingClientRect(); return { w: c.width, h: c.height }; }""")
        R.check(m['w'] >= 44 and m['h'] >= 44, f'{t} carte : bouton Masquer ≥ 44 pt ({m["w"]:.0f}×{m["h"]:.0f})')
        shot(page, LOT, f'accueil-carte-{t}')

        page.click('.recap-card__open')
        page.wait_for_selector('.view.recap')
        page.wait_for_timeout(300)
        st = recap_state(page)
        R.check(st['n'] >= 5 and st['dots'] == st['n'], f'{t} récap semaine : {st["n"]} écrans et autant de points')
        R.check(st['active'] == 0 and st['onIdx'] == 0 and st['prevOff'] and not st['nextOff'], f'{t} récap semaine : premier écran actif, flèche gauche inactive')
        R.check(st['kicker'] == 'TA SEMAINE' and st['value'] == '2' and st['caption'] == 'séances', f'{t} récap semaine : « 2 séances » ({st["kicker"]}, {st["value"]} {st["caption"]})')
        R.check(st['sw'] <= st['vw'], f'{t} récap semaine : pas de défilement horizontal de la page ({st["sw"]} > {st["vw"]})')
        page.wait_for_timeout(600)   # fin de l'animation d'arrivée
        shot(page, LOT, f'recap-semaine-1-{t}')

        # Flèche suivante : deuxième écran, points et flèches suivent ; retour en arrière
        page.click('[data-action="recap-next"]')
        page.wait_for_timeout(700)
        st = recap_state(page)
        R.check(st['active'] == 1 and st['onIdx'] == 1 and st['scroll'] == 1 and not st['prevOff'], f'{t} récap semaine : flèche → deuxième écran ({st["active"]}, point {st["onIdx"]}, défilement {st["scroll"]})')
        shot(page, LOT, f'recap-semaine-2-{t}')
        path, name = share_current(page, t, 'écran 2', f'story-semaine-{st["active"]}-{t}')
        R.check(name.startswith('mdlf-training-recap-w2026-10-12-'), f'{t} récap semaine : nom du fichier {name}')
        page.wait_for_timeout(300)
        R.check(page.locator('.view.recap').count() == 1, f'{t} récap semaine : toujours sur le récap après le partage')

        # Dernier écran : le résumé, partagé lui aussi
        page.evaluate("() => { const tr = document.querySelector('#recapTrack'); tr.scrollTo({ left: tr.scrollWidth, behavior: 'instant' }); }")
        page.wait_for_timeout(500)
        st = recap_state(page)
        R.check(st['active'] == st['n'] - 1 and st['nextOff'] and 'EN CHIFFRES' in (st['kicker'] or ''), f'{t} récap semaine : balayage jusqu\'au résumé ({st["active"]}/{st["n"] - 1}, {st["kicker"]})')
        tiles = page.evaluate("[...document.querySelectorAll('.recap-page.is-active .recap-tile__lbl')].map(e => e.textContent)")
        R.check(tiles[:1] == ['Séances'] and 'Séries' in tiles, f'{t} résumé : tuiles {tiles}')
        shot(page, LOT, f'recap-semaine-resume-{t}')
        share_current(page, t, 'résumé', f'story-semaine-resume-{t}')

        # Retour à l'accueil : la carte a été vue, elle a disparu ; le récap reste dans Progrès › Récaps
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        R.check(page.locator('.recap-card').count() == 0, f'{t} carte vue : disparue de l\'accueil')
        R.check(ls(page, 'ppl_recap_seen') == 'w2026-10-12', f'{t} carte vue : semaine mémorisée ({ls(page, "ppl_recap_seen")})')
        page.evaluate("switchTab('progress')")
        page.wait_for_timeout(300)
        cell = page.locator('[data-action="go-recaps"]')
        R.check(cell.count() == 1 and 'Récaps' in cell.inner_text(), f'{t} Progrès : cellule « Récaps »')
        cell.click()
        page.wait_for_selector('.view.recaps')
        titles = page.evaluate("[...document.querySelectorAll('.recaps .group-title')].map(e => e.textContent.trim())")
        cells = page.evaluate("[...document.querySelectorAll('.recaps .cell__title')].map(e => e.textContent.trim())")
        R.check(titles == ['Mois', 'Semaines'], f'{t} Récaps : groupes {titles} (pas de bilan de l\'année en octobre)')
        R.check('12 – 18 octobre' in cells and 'Septembre 2026' in cells and 'Octobre 2026' not in cells, f'{t} Récaps : semaine passée et mois terminés {cells[:4]}')
        shot(page, LOT, f'recaps-liste-{t}')

        # Récap d'un mois
        page.click('[data-action="open-recap"][data-key="m2026-09"]')
        page.wait_for_selector('.view.recap')
        page.wait_for_timeout(600)
        st = recap_state(page)
        R.check(st['kicker'] == 'TON MOIS' and st['caption'] == 'séances' and st['n'] >= 6, f'{t} récap mois : {st["value"]} séances, {st["n"]} écrans')
        sub = page.evaluate("document.querySelector('.recap-page.is-active .recap-page__sub')?.textContent")
        R.check(sub == 'Septembre 2026', f'{t} récap mois : période ({sub})')
        shot(page, LOT, f'recap-mois-{t}')
        R.check(not page.errors, f'{t} semaine : aucune erreur JS {page.errors}')
    finally:
        cm.__exit__(None, None, None)


def t_annee(bench, eng, dev, theme):
    """5 décembre : « Bilan de l'année » dans Récaps, écrans de l'année, partage du résumé."""
    t = tag(dev, theme)
    cm, page = open_page(bench, eng, dev, theme, (2026, 12, 5, 10))
    try:
        R.check(page.locator('.recap-card').count() == 0, f'{t} samedi 5 décembre : pas de carte')
        page.evaluate("switchTab('progress'); navigate('recaps')")
        page.wait_for_selector('.view.recaps')
        titles = page.evaluate("[...document.querySelectorAll('.recaps .group-title')].map(e => e.textContent.trim())")
        R.check(titles[:1] == ['Bilan de l\'année'], f'{t} décembre : groupe Bilan de l\'année en premier {titles}')
        cell = page.locator('[data-action="open-recap"][data-key="y2026"]')
        R.check(cell.count() == 1 and 'Bilan 2026' in cell.inner_text() and '78 séances' in cell.inner_text(), f'{t} décembre : cellule Bilan 2026 ({cell.inner_text().split(chr(10))[:2]})')
        cell.click()
        page.wait_for_selector('.view.recap')
        page.wait_for_timeout(600)
        st = recap_state(page)
        R.check(st['kicker'] == 'TON ANNÉE' and st['value'] == '78', f'{t} bilan : 78 séances ({st["kicker"]} {st["value"]})')
        labels = page.evaluate("[...document.querySelectorAll('.recap-page')].map(p => p.getAttribute('aria-label'))")
        R.check(any('mois le plus actif' in l for l in labels), f'{t} bilan : écran du mois le plus actif')
        R.check(labels[-1].startswith('Ton année, 2026 en chiffres : Séances 78'), f'{t} bilan : résumé « en chiffres » ({labels[-1][:70]})')
        R.check(any('record' in l for l in labels), f'{t} bilan : des records sur l\'année')
        shot(page, LOT, f'bilan-annee-{t}')
        page.evaluate("() => { const tr = document.querySelector('#recapTrack'); tr.scrollTo({ left: tr.scrollWidth, behavior: 'instant' }); }")
        page.wait_for_timeout(500)
        kick = page.evaluate("document.querySelector('.recap-page.is-active .recap-page__kicker')?.textContent")
        R.check(kick == 'TON ANNÉE EN CHIFFRES', f'{t} bilan : résumé ({kick})')
        lines = page.evaluate("[...document.querySelectorAll('.recap-page.is-active .recap-list__name')].map(e => e.textContent)")
        R.check(lines == ['Exercice n° 1', 'Record le plus marquant', 'Mois le plus actif'], f'{t} bilan : lignes {lines}')
        shot(page, LOT, f'bilan-annee-resume-{t}')
        share_current(page, t, 'bilan résumé', f'story-annee-resume-{t}')
        R.check(not page.errors, f'{t} année : aucune erreur JS {page.errors}')
    finally:
        cm.__exit__(None, None, None)


def t_moments(bench):
    """Quand la carte apparaît : dimanche 20 h oui, dimanche 17 h non, mercredi non ; Masquer ; réglage ; sans données."""
    eng, dev, theme = 'webkit', 'iPhone 13', 'dark'
    for when, expect, label in (((2026, 10, 18, 20), True, 'dimanche 20 h'), ((2026, 10, 18, 17), False, 'dimanche 17 h'),
                                ((2026, 10, 21, 20), False, 'mercredi'), ((2026, 10, 26, 10), False, 'lundi 26 : semaine du 19 sans séance')):
        cm, page = open_page(bench, eng, dev, theme, when)
        try:
            n = page.locator('.recap-card').count()
            R.check((n == 1) == expect, f'{label} : carte {"présente" if expect else "absente"} ({n})')
            if expect:
                R.check(page.locator('.recap-card [data-key="w2026-10-12"]').count() >= 1, f'{label} : la semaine qui se termine')
                # Masquer : la carte part, le récap reste dans Progrès
                page.click('.recap-card__close')
                page.wait_for_timeout(300)
                R.check(page.locator('.recap-card').count() == 0 and 'Progrès › Récaps' in page.inner_text('.toast'), f'{label} : Masquer retire la carte avec un mot')
                page.evaluate("switchTab('progress'); navigate('recaps')")
                page.wait_for_selector('.view.recaps')
                R.check(page.locator('[data-key="w2026-10-12"]').count() == 1, f'{label} : la semaine reste listée dans Récaps')
            R.check(not page.errors, f'{label} : aucune erreur JS {page.errors}')
        finally:
            cm.__exit__(None, None, None)

    # Réglage : la carte peut être coupée (Réglages › Affichage), et remise
    cm, page = open_page(bench, eng, dev, theme, (2026, 10, 19, 10))
    try:
        page.evaluate("navigate('settings')")
        page.wait_for_selector('.settings-view')
        sw = page.locator('[data-action="setting-recap-card"]')
        R.check(sw.count() == 1 and sw.get_attribute('aria-checked') == 'true', 'réglage : interrupteur « Carte Ta semaine » allumé')
        sw.click(); page.wait_for_timeout(200)
        R.check(sw.get_attribute('aria-checked') == 'false' and page.evaluate('data.recapCardOff') is True, 'réglage : coupé → data.recapCardOff')
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        R.check(page.locator('.recap-card').count() == 0, 'réglage coupé : pas de carte le lundi')
        page.evaluate("navigate('settings')")
        page.wait_for_selector('.settings-view')
        page.locator('[data-action="setting-recap-card"]').click(); page.wait_for_timeout(200)
        R.check(page.evaluate('data.recapCardOff') is None, 'réglage remis : champ retiré')
        R.check(not page.errors, f'réglage : aucune erreur JS {page.errors}')
    finally:
        cm.__exit__(None, None, None)

    # Sans données : rien d'inventé, ni carte ni liste
    with bench.page(eng, dev, theme) as page:
        page.add_init_script(frozen(2026, 10, 19, 10))
        seed(page, theme, None)
        skip_questions(page)
        R.check(page.locator('.recap-card').count() == 0, 'sans données : pas de carte')
        page.evaluate("switchTab('progress'); navigate('recaps')")
        page.wait_for_selector('.view.recaps')
        R.check(page.locator('.recaps .empty-note').count() == 1 and page.locator('.recaps .cell').count() == 0, 'sans données : état vide, aucune cellule')
        page.evaluate("navigate(makeRoute('recap', 'w2026-10-12'))")
        page.wait_for_timeout(200)
        R.check('Aucune séance' in page.inner_text('.view.recap'), 'récap d\'une semaine vide : message, pas de chiffre')
        R.check(not page.errors, f'sans données : aucune erreur JS {page.errors}')

    # Réduction des animations : aucune animation d'arrivée
    cm, page = open_page(bench, eng, dev, theme, (2026, 10, 19, 10), reduced_motion='reduce')
    try:
        page.click('.recap-card__open')
        page.wait_for_selector('.view.recap')
        anim = page.evaluate("getComputedStyle(document.querySelector('.recap-page.is-active .recap-page__hero')).animationName")
        R.check(anim == 'none', f'prefers-reduced-motion : pas d\'animation ({anim})')
    finally:
        cm.__exit__(None, None, None)


run_main(R, [t_semaine, t_annee], once=[t_moments])
