"""Réglages › Apparence › Design : couleur de l'app (« Orange » par défaut, « Bleu »), vignettes, coche, application
immédiate partout, persistance ; et contraste des aplats d'accent (jamais de texte noir sur l'orange).

Captures : $PPL_SCRATCH/shots/lotdesign/.
Lancer : PPL_URL=http://127.0.0.1:8799/ python3 tests/test_design.py (ou run_all.py design).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'design'
R = Results(LOT)

# Aplats d'accent visibles (bouton plein, puces, coches) : couleur du fond, du texte, contraste WCAG
FILLS = """() => {
  const rgb = c => (c.match(/[\\d.]+/g) || []).slice(0, 4).map(Number);
  const L = c => { const m = rgb(c).slice(0, 3).map(v => v / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2]; };
  const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const probe = document.createElement('i'); probe.style.color = 'var(--tint-fill)'; document.body.appendChild(probe);
  const fill = getComputedStyle(probe).color; probe.remove();
  return [...document.querySelectorAll('#app *, .sheet *')].filter(e => e.offsetParent && getComputedStyle(e).backgroundColor === fill && e.textContent.trim())
    .map(e => ({ text: e.textContent.trim().slice(0, 24), color: getComputedStyle(e).color, ratio: Math.round(cr(getComputedStyle(e).color, fill) * 100) / 100 }));
}"""


def tag(dev, theme):
    return f'{dev}-{theme}'.replace(' ', '_')


def css_var(page, name):
    return page.evaluate("n => { const p = document.createElement('i'); p.style.color = `var(${n})`; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; }", name)


def open_design(page):
    page.click('[data-action="go-settings"]')
    page.wait_for_selector('.settings-view')
    settle(page)
    page.click('[data-action="go-design"]')
    page.wait_for_selector('.settings-design')
    settle(page)


def pressed(page):
    return page.evaluate("[...document.querySelectorAll('.design-opt')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.val)")


def t_design(bench, eng, dev, theme):
    t = tag(dev, theme)
    light = theme == 'light'
    with bench.page(eng, dev, theme) as page:
        page.route('https://{ota.mdlf.app,mdlf-ota.vercel.app}/**', lambda route: route.abort())
        seed(page, theme, ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
        settle(page)
        # Défaut : « Orange », bouton brique à texte blanc
        R.check(not page.evaluate("document.body.classList.contains('design-bleu')"), f'{t} défaut : pas de design bleu')
        R.check(css_var(page, '--tint-fill') == 'rgb(184, 70, 15)', f'{t} défaut : bouton orange brique ({css_var(page, "--tint-fill")})')
        fills = page.evaluate(FILLS)
        R.check(fills and all(f['color'] == 'rgb(255, 255, 255)' and f['ratio'] >= 4.5 for f in fills), f'{t} accueil : aplats à texte blanc, 4,5:1 {fills}')

        open_design(page)
        cell = page.locator('.settings-view [data-action="go-design"]')
        R.check(page.locator('.settings-design .navbar').count() == 1, f'{t} écran Design ouvert')
        page.click('[data-action="back"]')
        settle(page)
        R.check('Orange' in cell.inner_text(), f'{t} Réglages › Apparence : « Design · Orange » ({cell.inner_text()!r})')
        page.click('[data-action="go-design"]')
        page.wait_for_selector('.settings-design')
        settle(page)

        opts = page.locator('.design-opt')
        R.check(opts.count() == 2 and [opts.nth(i).get_attribute('data-val') for i in range(2)] == ['orange', 'bleu'], f'{t} deux choix, Orange puis Bleu')
        R.check(page.locator('.design-opts').get_attribute('aria-labelledby') == 'designColorTitle', f'{t} groupe nommé pour VoiceOver')
        # Vignettes chargées (machine de CI lente : settle n'attend pas les images)
        try:
            page.wait_for_function("[...document.querySelectorAll('.design-opt img')].every(i => i.complete && i.naturalWidth > 0)", timeout=10_000)
        except Exception:
            pass   # constaté juste en dessous
        imgs = page.evaluate("""() => [...document.querySelectorAll('.design-opt img')].map(i => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, alt: i.alt }))""")
        want = 'light' if light else 'dark'
        R.check(all(i['ok'] for i in imgs) and [i['src'] for i in imgs] == [f'img/design/orange-{want}.webp', f'img/design/bleu-{want}.webp'],
                f'{t} vignettes de l\'accueil dans le thème affiché {imgs}')
        R.check(all(i['alt'] == '' for i in imgs), f'{t} vignettes décoratives (le bouton porte le nom)')
        R.check(pressed(page) == ['orange'] and page.locator('.design-opt[aria-pressed="true"] .design-opt__check').count() == 1, f'{t} Orange coché')
        sizes = page.evaluate("[...document.querySelectorAll('.design-opt')].map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height, r.right]; })")
        R.check(all(w >= 44 and h >= 44 and r <= page.viewport_size['width'] for w, h, r in sizes), f'{t} cibles de 44 pt, dans l\'écran {sizes}')
        R.check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{t} pas de défilement horizontal')
        shot(page, LOT, f'design-orange-{t}')

        # iOS : rien ne bouge au pointerdown (sinon le tap est avalé)
        bleu = page.locator('.design-opt[data-val="bleu"]')
        before = page.evaluate("document.querySelector('.design-opts').outerHTML")
        bleu.dispatch_event('pointerdown')
        R.check(page.evaluate("document.querySelector('.design-opts').outerHTML") == before, f'{t} rien ne change au pointerdown')
        bleu.dispatch_event('pointerup')

        # Bleu : appliqué tout de suite, partout, daté et enregistré
        bleu.click()
        settle(page)
        R.check(pressed(page) == ['bleu'], f'{t} Bleu coché ({pressed(page)})')
        R.check(page.evaluate("document.activeElement?.dataset?.val") == 'bleu', f'{t} focus gardé sur le choix')
        R.check(page.evaluate("document.body.classList.contains('design-bleu')"), f'{t} body.design-bleu')
        want_fill = 'rgb(0, 102, 204)' if light else 'rgb(10, 108, 219)'
        R.check(css_var(page, '--tint-fill') == want_fill, f'{t} bouton bleu ({css_var(page, "--tint-fill")})')
        d = page.evaluate("JSON.parse(localStorage.getItem('ppl_v2')).design")
        R.check(d and d.get('accent') == 'bleu' and d.get('at', 0) > 0, f'{t} enregistré, daté ({d})')
        R.check(page.evaluate("getComputedStyle(document.querySelector('.design-opt[data-val=\"bleu\"] .design-opt__check')).backgroundColor") == want_fill,
                f'{t} la coche prend déjà le bleu')
        shot(page, LOT, f'design-bleu-{t}')
        page.click('[data-action="back"]')
        settle(page)
        R.check('Bleu' in page.locator('[data-action="go-design"]').inner_text(), f'{t} Réglages : « Design · Bleu »')
        R.check(page.evaluate("getComputedStyle(document.querySelector('.tabbar__btn--active')).color") == css_var(page, '--tint'), f'{t} onglet actif dans l\'accent bleu')

        # Accueil après relance : toujours bleu
        page.reload()
        page.wait_for_selector('#app > *')
        settle(page)
        for _ in range(2):   # relance sur Réglages : retour à la racine de l'onglet Entraînement
            if page.locator('.hero__btn').count():
                break
            page.click('.tabbar [data-action="go-home"]')
            settle(page)
        R.check(page.evaluate("document.body.classList.contains('design-bleu')"), f'{t} relance : toujours bleu')
        btn = page.locator('.hero__btn').first
        R.check(btn.count() == 1 and page.evaluate("getComputedStyle(document.querySelector('.hero__btn')).backgroundColor") == want_fill, f'{t} accueil : Démarrer en bleu')
        fills = page.evaluate(FILLS)
        R.check(fills and all(f['color'] == 'rgb(255, 255, 255)' and f['ratio'] >= 4.5 for f in fills), f'{t} accueil bleu : texte blanc, 4,5:1 {fills}')
        shot(page, LOT, f'accueil-bleu-{t}')

        # Retour à Orange
        open_design(page)
        page.locator('.design-opt[data-val="orange"]').click()
        settle(page)
        R.check(not page.evaluate("document.body.classList.contains('design-bleu')") and pressed(page) == ['orange'], f'{t} retour à Orange')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_recu(bench):
    """Choix reçu d'un autre appareil (synchro) : appliqué au redessin suivant, sans relance."""
    with bench.page('webkit', 'iPhone 13', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json(), extra={'ppl_welcome_seen': '1'})
        settle(page)
        page.evaluate("data.design = { accent: 'bleu', at: Date.now() }; render()")
        settle(page)
        R.check(page.evaluate("document.body.classList.contains('design-bleu')"), 'choix reçu : appliqué au redessin')
        page.evaluate("delete data.design; render()")
        settle(page)
        R.check(not page.evaluate("document.body.classList.contains('design-bleu')"), 'choix retiré : Orange')
        R.check(not page.errors, f'reçu : aucune erreur JS {page.errors}')


run_main(R, [t_design], once=[t_recu])
