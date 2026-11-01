"""Récaps de la semaine, du mois et de l'année : carte « Ta semaine » de l'accueil (dimanche, lundi matin),
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
               id: active?.dataset.id, tone: active?.dataset.tone,
               kicker: active?.querySelector('.rp-kicker')?.textContent,
               value: active?.querySelector('.rp-num')?.dataset.count || active?.querySelector('.rp-num')?.textContent,
               caption: active?.querySelector('.rp-caption')?.textContent,
               share: document.querySelector('#recapShareLbl')?.textContent,
               tabbar: !!document.querySelector('.tabbar') && !document.querySelector('.tabbar').hidden,
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
    """Dimanche 20 h : carte « Ta semaine » sous la séance du jour → récap de la semaine, écrans, partage, carte vue."""
    t = tag(dev, theme)
    cm, page = open_page(bench, eng, dev, theme, (2026, 10, 18, 20))
    try:
        card = page.locator('.recap-card')
        R.check(card.count() == 1 and card.is_visible(), f'{t} dimanche 20 h : carte « Ta semaine » sur l\'accueil')
        # Record d'allure : « 4:51 » reste un seul nombre géant (l'unité « /km » de l'écran ne l'ampute pas)
        sv = page.evaluate("[recapSplitValue('4:51'), recapSplitValue('16,1\u00a0t'), recapSplitValue('1 min 15')]")
        R.check(sv[0]['num'] == '4:51' and sv[1]['num'] == '16,1' and sv[2]['num'] == '1', f'{t} chiffre géant : allure entière ({sv})')
        txt = card.inner_text()
        R.check('ta semaine' in txt.lower() and '2 séances' in txt and '12 – 18 oct.' in txt.lower(), f'{t} carte : titre, semaine et chiffres réels ({txt.split(chr(10))[:3]})')
        m = page.evaluate("""() => {
          const card = document.querySelector('.recap-card'), c = document.querySelector('.recap-card__close').getBoundingClientRect();
          const chips = [...card.querySelectorAll('.recap-card__chip')].map(e => ({ t: e.textContent, h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) || 20 }));
          const fig = card.querySelector('.recap-card__fig')?.getBoundingClientRect(), title = card.querySelector('.recap-card__title').getBoundingClientRect();
          return { w: c.width, h: c.height, prev: card.previousElementSibling?.className || '', chips,
                   overlap: fig ? (c.bottom > fig.top && c.left < fig.right && fig.top < c.bottom - 30) : false,
                   titleClear: title.right <= c.left + 4 || title.top >= c.bottom - 4,
                   bg: getComputedStyle(card).backgroundColor, label: card.querySelector('.recap-card__open').textContent.replace(/\s+/g, ' ').trim(),
                   hasAria: card.querySelector('.recap-card__open').hasAttribute('aria-label') };
        }""")
        R.check(m['w'] >= 44 and m['h'] >= 44, f'{t} carte : bouton Masquer ≥ 44 pt ({m["w"]:.0f}×{m["h"]:.0f})')
        R.check(m['prev'].startswith('hero'), f'{t} carte : juste sous la séance du jour ({m["prev"]})')
        R.check(any(c['t'] == '16,1\u00a0t' for c in m['chips']) and all(c['h'] < 2 * c['lh'] for c in m['chips']), f'{t} carte : « 16,1 t » insécable, pastilles sur une ligne {m["chips"]}')
        R.check(m['titleClear'], f'{t} carte : le titre ne passe pas sous le bouton Masquer')
        R.check(m['label'].startswith('Ta semaine · 12 – 18 oct. 2 séances') and m['label'].endswith('Voir mon récap') and not m['hasAria'], f'{t} carte : un seul bouton, lu comme il est écrit ({m["label"][:70]})')
        black = m['bg'] in ('rgb(0, 0, 0)',)
        R.check(black == (theme == 'dark'), f'{t} carte : noir pur en sombre, citron vert en clair ({m["bg"]})')
        shot(page, LOT, f'accueil-carte-{t}')

        page.click('.recap-card__open')
        page.wait_for_selector('.view.recap')
        page.wait_for_timeout(300)
        st = recap_state(page)
        R.check(st['n'] >= 5 and st['dots'] == st['n'], f'{t} récap semaine : {st["n"]} écrans et autant de barres')
        R.check(st['active'] == 0 and st['onIdx'] == 0 and st['prevOff'] and not st['nextOff'], f'{t} récap semaine : premier écran actif, flèche gauche inactive')
        R.check(st['kicker'] == 'TA SEMAINE' and st['value'] == '2' and st['caption'] == 'séances' and st['tone'] == 'lime', f'{t} récap semaine : « 2 séances » ({st["kicker"]}, {st["value"]} {st["caption"]}, {st["tone"]})')
        R.check(st['sw'] <= st['vw'], f'{t} récap semaine : pas de défilement horizontal de la page ({st["sw"]} > {st["vw"]})')
        R.check(not st['tabbar'], f'{t} récap semaine : plein écran, sans barre d\'onglets')
        page.wait_for_timeout(700)   # fin de l'animation d'arrivée et du compteur
        R.check(page.evaluate("document.querySelector('.recap-page.is-active .rp-num').textContent") == '2', f'{t} récap semaine : le compteur s\'arrête sur la vraie valeur')
        shot(page, LOT, f'recap-semaine-1-{t}')

        # Toucher sur la droite de l'écran : écran suivant ; petite semaine : le record d'abord, avec son bouton
        box = page.locator('.recap-page.is-active').bounding_box()
        page.mouse.click(box['x'] + box['width'] * .8, box['y'] + box['height'] * .5)
        page.wait_for_timeout(800)
        st = recap_state(page)
        R.check(st['active'] == 1 and st['onIdx'] == 1 and st['scroll'] == 1 and not st['prevOff'], f'{t} récap semaine : toucher à droite → deuxième écran ({st["active"]}, barre {st["onIdx"]}, défilement {st["scroll"]})')
        R.check(st['id'] == 'records' and st['tone'] == 'orange' and st['share'] == 'Partager ce record', f'{t} petite semaine : le record en deuxième ({st["id"]}, {st["tone"]}, {st["share"]})')
        rec = page.evaluate("""() => { const p = document.querySelector('.recap-page.is-active');
          return { from: p.querySelector('.rp-from')?.textContent, box: p.querySelector('.rp-box')?.textContent, label: p.getAttribute('aria-label') }; }""")
        R.check(rec['from'] and rec['box'] and 'depuis ton record du' in rec['box'] and '→' in rec['label'], f'{t} écran record : avant → après et gain réels ({rec["from"]}, {rec["box"]})')
        # Toucher à gauche : retour
        page.mouse.click(box['x'] + box['width'] * .1, box['y'] + box['height'] * .5)
        page.wait_for_timeout(800)
        R.check(recap_state(page)['active'] == 0, f'{t} récap semaine : toucher à gauche → retour')
        page.click('[data-action="recap-next"]')
        page.wait_for_timeout(800)
        st = recap_state(page)
        shot(page, LOT, f'recap-semaine-2-{t}')
        path, name = share_current(page, t, 'écran 2', f'story-semaine-{st["active"]}-{t}')
        R.check(name.startswith('mdlf-training-recap-w2026-10-12-'), f'{t} récap semaine : nom du fichier {name}')
        page.wait_for_timeout(300)
        R.check(page.locator('.view.recap').count() == 1, f'{t} récap semaine : toujours sur le récap après le partage')

        # Dernier écran : le résumé, partagé lui aussi
        page.evaluate("() => { const tr = document.querySelector('#recapTrack'); tr.scrollTo({ left: tr.scrollWidth, behavior: 'instant' }); }")
        page.wait_for_timeout(500)
        st = recap_state(page)
        R.check(st['active'] == st['n'] - 1 and st['nextOff'] and st['id'] == 'summary' and st['share'] == 'Partager ma semaine', f'{t} récap semaine : balayage jusqu\'au résumé ({st["active"]}/{st["n"] - 1}, {st["id"]}, {st["share"]})')
        page.wait_for_function("(() => { const c = document.querySelector('.recap-page--summary canvas'); return c && c.toDataURL('image/png').length > 60000; })()", timeout=8000)
        lbl = page.evaluate("document.querySelector('.recap-page.is-active').getAttribute('aria-label')")
        R.check(lbl.startswith('Ta semaine, 12 – 18 octobre en bref : ') and 'Séances 2' in lbl and 'Durée' in lbl, f'{t} résumé : la story elle-même, décrite pour VoiceOver ({lbl[:90]})')
        shot(page, LOT, f'recap-semaine-resume-{t}')
        share_current(page, t, 'résumé', f'story-semaine-resume-{t}')

        # Retour à l'accueil : la carte reste tant que c'est le moment (seule la croix la masque)
        page.evaluate("switchTab('train')")
        page.wait_for_timeout(300)
        R.check(page.locator('.recap-card').count() == 1, f'{t} carte ouverte : toujours sur l\'accueil')
        R.check(ls(page, 'ppl_recap_seen') is None, f'{t} carte ouverte : rien de mémorisé ({ls(page, "ppl_recap_seen")})')
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
        sub = page.evaluate("document.querySelector('.recap-page.is-active .rp-sub')?.textContent")
        R.check(sub == 'Septembre 2026', f'{t} récap mois : période ({sub})')
        shot(page, LOT, f'recap-mois-{t}')
        # Chaque écran du mois se comprend seul : pas d'écran palier, moment avec sa plage, exercice et records expliqués
        mo = page.evaluate("[...document.querySelectorAll('.recap-page')].map(p => ({ id: p.dataset.id, l: p.getAttribute('aria-label') }))")
        ids = [x['id'] for x in mo]
        lab = {x['id']: x['l'] for x in mo}
        R.check('milestone' not in ids and ids[-1] == 'summary', f'{t} récap mois : pas d\'écran palier, résumé en dernier {ids}')
        R.check(lab['summary'].startswith('Ton mois, Septembre 2026 en bref : '), f'{t} récap mois : « en bref » ({lab["summary"][:60]})')
        R.check(not any(k in x['l'] for x in mo for k in ('n° 1', '1RM', 'en chiffres')), f'{t} récap mois : ni « n° 1 », ni « 1RM », ni « en chiffres »')
        if 'exercise' in lab:
            R.check('ton exercice le plus fait' in lab['exercise'] and ' séances sur ' in lab['exercise'], f'{t} récap mois : exercice le plus fait expliqué ({lab["exercise"][:110]})')
        if 'profile' in lab:
            R.check(not any(w in lab['profile'] for w in ('le soir', 'le matin', 'le midi')) or 'Entre ' in lab['profile'],
                    f'{t} récap mois : moment de la journée avec sa plage ({lab["profile"][:140]})')
        if 'records' in lab and 'RECORDS' in page.evaluate("document.querySelector('.recap-page[data-id=records] .rp-kicker').textContent"):
            R.check(any(k in lab['records'] for k in ('Ta plus forte', 'Ton record le plus')) and ('Tes autres records' in lab['records'] or 'Ton autre record' in lab['records']),
                    f'{t} récap mois : pourquoi ce record, et les autres listés ({lab["records"][:140]})')
        if 'streak' in lab:
            R.check('séances ou plus' in lab['streak'] and 'Séances par semaine' in lab['streak'], f'{t} récap mois : régularité à son rythme ({lab["streak"][:120]})')
        # Tous les écrans du mois en capture (planche avant / après)
        for i in range(len(ids)):
            page.evaluate(f"() => {{ const tr = document.querySelector('#recapTrack'); tr.scrollTo({{ left: {i} * tr.clientWidth, behavior: 'instant' }}); }}")
            page.wait_for_timeout(900)
            shot(page, LOT, f'recap-mois-{i + 1:02d}-{ids[i]}-{t}')
            if ids[i] == 'profile':
                # Profil : couleurs et légende par paliers de Progrès, à l'écran et dans l'image partagée
                leg = page.evaluate("[...document.querySelectorAll('.recap-page.is-active .rp-scale span')].map(s => s.textContent.trim())")
                R.check(leg[:1] == ['Entretien 1–4'] and leg[-1:] == ['Gros volume 20+'], f'{t} profil : légende des paliers de Progrès {leg}')
                share_current(page, t, 'profil', f'story-mois-profil-{t}')
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
        R.check(any('mois le plus actif' in l for l in labels), f'{t} bilan : mois le plus actif (écran régularité)')
        R.check(any('ton année en un corps' in l for l in labels), f'{t} bilan : « ton année en un corps »')
        R.check(labels[-1].startswith('Ton année, 2026 en bref : ') and 'Séances 78' in labels[-1], f'{t} bilan : résumé ({labels[-1][:90]})')
        R.check(any('record' in l for l in labels), f'{t} bilan : des records sur l\'année')
        shot(page, LOT, f'bilan-annee-{t}')
        page.evaluate("() => { const tr = document.querySelector('#recapTrack'); tr.scrollTo({ left: tr.scrollWidth, behavior: 'instant' }); }")
        page.wait_for_timeout(500)
        st = recap_state(page)
        R.check(st['id'] == 'summary' and st['share'] == 'Partager mon année', f'{t} bilan : résumé ({st["id"]}, {st["share"]})')
        R.check(all(k in labels[-1] for k in ('Exercice le plus fait :', 'Mois le plus actif :')), f'{t} bilan : lignes du résumé')
        shot(page, LOT, f'bilan-annee-resume-{t}')
        share_current(page, t, 'bilan résumé', f'story-annee-resume-{t}')
        R.check(not page.errors, f'{t} année : aucune erreur JS {page.errors}')
    finally:
        cm.__exit__(None, None, None)


def t_moments(bench):
    """Quand la carte apparaît : tout le dimanche, lundi jusqu'à midi, mercredi non ; Masquer ; réglage ; sans données."""
    eng, dev, theme = 'webkit', 'iPhone 13', 'dark'
    for when, expect, label in (((2026, 10, 18, 20), True, 'dimanche 20 h'), ((2026, 10, 18, 10), True, 'dimanche 10 h'),
                                ((2026, 10, 19, 14), False, 'lundi 14 h'),
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
        anim = page.evaluate("getComputedStyle(document.querySelector('.recap-page.is-active .rp-value')).animationName")
        R.check(anim == 'none', f'prefers-reduced-motion : pas d\'animation ({anim})')
        num = page.evaluate("document.querySelector('.recap-page.is-active .rp-num').textContent")
        R.check(num == '2', f'prefers-reduced-motion : chiffre final affiché d\'emblée ({num})')
    finally:
        cm.__exit__(None, None, None)


run_main(R, [t_semaine, t_annee], once=[t_moments])
