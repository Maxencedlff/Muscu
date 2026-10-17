"""Partage de séance : bouton du bilan et de l'historique, aperçu, image story 1080 × 1920, partage.

Les images produites sont écrites dans $PPL_SCRATCH/shots/partage/ pour être regardées.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_partage.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import base64
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'partage'
R = Results(LOT)
OUT = os.path.join(SHOTS, 'partage')

# Faux navigator.share : enregistre le fichier reçu (le partage réel ouvrirait la feuille du système)
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


def open_preview(page, t, where, title):
    """Touche « Partager ma séance », attend l'image, vérifie l'aperçu ; renvoie le PNG (data URL)."""
    btn = page.locator('[data-action="share-story"]')
    R.check(btn.count() == 1 and btn.is_visible(), f'{t} {where} : bouton « Partager ma séance » visible')
    R.check('Partager ma séance' in btn.inner_text(), f'{t} {where} : libellé du bouton')
    btn.scroll_into_view_if_needed()
    btn.click()
    page.wait_for_selector('.share-preview__img')
    page.wait_for_function("!document.querySelector('.share-preview__send').disabled", timeout=8000)
    # Fin de l'animation d'arrivée de la feuille (mesures faites sur sa position finale)
    page.wait_for_function("[...document.querySelectorAll('.sheet')].every(s => s.getAnimations().every(a => a.playState !== 'running'))")
    m = page.evaluate("""() => {
      const f = document.querySelector('.share-preview__frame').getBoundingClientRect();
      const b = document.querySelector('.share-preview__send').getBoundingClientRect();
      const c = document.querySelector('.share-preview__img');
      return { fw: f.width, fh: f.height, left: f.left, right: innerWidth - f.right, bb: b.bottom, bh: b.height,
               vh: innerHeight, sw: document.documentElement.scrollWidth, vw: innerWidth,
               label: c.getAttribute('aria-label'), role: c.getAttribute('role') };
    }""")
    R.check(abs(m['fw'] / m['fh'] - 9 / 16) < .02, f'{t} {where} : aperçu au format 9:16 ({m["fw"]:.0f}×{m["fh"]:.0f})')
    R.check(m['left'] >= 0 and m['right'] >= 0 and m['sw'] <= m['vw'], f'{t} {where} : aperçu dans l\'écran, sans défilement horizontal')
    R.check(m['bb'] <= m['vh'] and m['bh'] >= 44, f'{t} {where} : bouton Partager visible et ≥ 44 pt {m["bb"]:.0f}/{m["vh"]}')
    R.check(m['role'] == 'img' and m['label'] and m['label'].startswith(title + ', '), f'{t} {where} : image décrite pour VoiceOver ({m["label"]})')
    return page.evaluate("document.querySelector('.share-preview__img').toDataURL('image/png')")


def check_image(t, where, url, name):
    size, raw = png_size(url)
    R.check(size == (1080, 1920), f'{t} {where} : image PNG 1080 × 1920 ({size})')
    R.check(len(raw) > 40_000, f'{t} {where} : image non vide ({len(raw)} octets)')
    save_png(raw, name)


def finish_push(page):
    """Séance Push : record de charge au développé couché, deux séries validées, puis Terminer."""
    page.click('[data-action="start-session"][data-cat="push"]')
    page.wait_for_selector('.view.session')
    page.wait_for_timeout(150)
    w = page.locator('[data-action="set-weight"][data-ei="0"][data-si="0"]')
    w.fill('45')
    page.evaluate("document.activeElement && document.activeElement.blur()")
    for ei, si in ((0, 0), (0, 1), (1, 0)):
        page.locator(f'[data-action="validate-set"][data-ei="{ei}"][data-si="{si}"]').click()
        page.wait_for_timeout(250)
    page.click('[data-action="finish-session"]')
    page.wait_for_timeout(250)
    tap_dialog(page, 'Enregistrer la séance')
    page.wait_for_selector('.view.summary')


def t_bilan(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        page.evaluate(FAKE_SHARE)
        finish_push(page)
        shot(page, LOT, f'bilan-{t}')
        url = open_preview(page, t, 'bilan', 'Push')
        check_image(t, 'bilan', url, f'story-bilan-{t}')
        stats = page.evaluate('shareState.stats')
        R.check(stats['records'] == 1 and stats['sets'] == 3, f'{t} bilan : mêmes records que le bilan ({stats["records"]}, {stats["sets"]} séries)')
        shot(page, LOT, f'apercu-bilan-{t}')
        # Partage web : le fichier PNG nommé est remis à navigator.share, la feuille se ferme
        page.click('[data-action="share-story-send"]')
        page.wait_for_timeout(500)
        sh = page.evaluate('window.__shared')
        R.check(len(sh) == 1 and sh[0]['type'] == 'image/png' and sh[0]['name'].startswith('mdlf-training-push-')
                and sh[0]['size'] > 40_000, f'{t} bilan : fichier PNG remis au partage {sh}')
        R.check(page.locator('.sheet-root').count() == 0, f'{t} bilan : aperçu fermé après le partage')
        R.check(page.locator('.view.summary').count() == 1, f'{t} bilan : retour au bilan')
        R.check(not page.errors, f'{t} bilan : aucune erreur JS {page.errors}')


def t_historique(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        # Sans partage de fichiers (navigateur de bureau) : téléchargement de l'image
        page.evaluate("() => { navigator.canShare = undefined; }")
        # (identifiants des fixtures : push et pull partagent le préfixe « hpu », legs est unique)
        page.evaluate("() => { const h = data.history.find(x => x.category === 'legs'); navigate(makeRoute('history-detail', h.id)); }")
        page.wait_for_selector('.view.history-detail')
        page.locator('[data-action="share-story"]').scroll_into_view_if_needed()
        shot(page, LOT, f'detail-{t}')
        url = open_preview(page, t, 'historique', 'Legs')
        check_image(t, 'historique', url, f'story-historique-{t}')
        with page.expect_download() as dl:
            page.click('[data-action="share-story-send"]')
        R.check(dl.value.suggested_filename.endswith('.png'), f'{t} historique : image téléchargée ({dl.value.suggested_filename})')
        page.wait_for_timeout(300)
        R.check('Image enregistrée' in page.inner_text('body'), f'{t} historique : toast « Image enregistrée »')
        # « Fermer » referme l'aperçu sans rien partager
        page.locator('[data-action="share-story"]').click()
        page.wait_for_selector('.share-preview__img')
        page.click('.sheet__btn--cancel')
        page.wait_for_timeout(400)
        R.check(page.locator('.sheet-root').count() == 0, f'{t} historique : « Fermer » referme l\'aperçu')

        # Silhouette des muscles de la séance : couleurs résolues, muscle le plus travaillé en plein
        m = page.evaluate("""() => {
          const h = data.history.find(x => x.category === 'push');
          const st = shareStoryStats(h), p = storyPalette(st.color);
          const svg = shareStoryHooks.muscleSvg(h, st, p) || '';
          const unknown = { ...h, exercises: [{ name: 'Exercice inventé', sets: [{ weight: '10', reps: '8' }] }] };
          const top = sessionTopMuscles(h)[0];
          return { svg, top, full: new RegExp(`data-muscle="${top}"[^>]*fill-opacity="1"`).test(svg),
                   none: shareStoryHooks.muscleSvg(unknown, st, p), alt: shareStoryAlt(st) };
        }""")
        R.check(m['svg'].startswith('<svg xmlns=') and 'var(--' not in m['svg'], f'{t} silhouette : SVG autonome, couleurs résolues')
        R.check(m['full'], f'{t} silhouette : muscle le plus travaillé ({m["top"]}) en couleur pleine')
        R.check(m['none'] is None, f'{t} silhouette : aucun muscle reconnu → pas de silhouette')
        R.check('Muscles travaillés : ' in m['alt'] and 'pectoraux' in m['alt'], f'{t} silhouette : muscles décrits pour VoiceOver ({m["alt"]})')
        url = page.evaluate("""async () => {
          const h = data.history.find(x => x.category === 'push');
          const { canvas } = await renderShareStory(h);
          return canvas.toDataURL('image/png');
        }""")
        check_image(t, 'silhouette', url, f'story-silhouette-{t}')
        R.check(not page.errors, f'{t} historique : aucune erreur JS {page.errors}')


def t_lbs_long(bench, eng, dev, theme):
    """Nom de séance et d'exercices très longs, lbs, aucun record : le texte reste dans l'image."""
    t = tag(dev, theme)
    if dev != 'iPhone 13':
        return
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        url = page.evaluate("""async () => {
          data.unit = 'lbs';
          const h = clone(data.history.find(x => x.category === 'legs'));
          h.exercises[0].name = 'Squat barre haute avec pause de deux secondes en bas et tempo contrôlé';
          h.date = Date.now(); h.duration = 95 * 60000;
          const { canvas, stats } = await renderShareStory(h, { baseline: {} });
          return canvas.toDataURL('image/png');
        }""")
        check_image(t, 'lbs', url, f'story-lbs-{t}')


run_main(R, [t_bilan, t_historique, t_lbs_long])
