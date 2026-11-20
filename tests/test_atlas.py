"""Atlas détaillé du personnage : fiche exercice de la Bibliothèque (sous-muscles, nom au toucher, vue agrandie).

Vérifie : développé incliné barre = pectoral claviculaire en rouge plein, sterno-costal et deltoïde antérieur en rouge
atténué, triceps en soutien ; poids des images au premier affichage de la fiche (1× seulement, rien du 3×) ; toucher
d'un sous-muscle (nom de salle, nom officiel, rôle) ; double toucher (vue agrandie zoomée, 3× de la seule vue affichée,
contours) ; pincement (Chromium : touchers multiples par CDP) ; une seule vue 3× à la fois en passant de la face au
dos ; ailleurs (Progrès › Exercice) la carte des 18 muscles, inchangée ; hors ligne après un premier zoom (service
worker, une fois). Texte agrandi : rien de coupé. Captures : $PPL_SCRATCH/shots/lotatlas/ ; poids mesurés :
$PPL_SCRATCH/atlas-poids.json.
Lancer : PPL_DEV="iPhone 13" PPL_THEME=dark python3 test_atlas.py (ou sans variable : 5 appareils × 2 thèmes).
"""
import json
import re
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 'atlas'
R = Results(LOT)
NOW = local_ms(2026, 11, 19, 18, 0, tz=PARIS)
EX = 'Développé incliné barre'
# Budget des images chargées par l'ouverture de la fiche du développé incliné : avant l'atlas (main du 19/11), 34 410
# octets (image du muscle en tête, 4 calques des 18 muscles) ; avec l'atlas, l'image en tête et 8 sous-muscles 1×
# (≈ 32 Ko, les deux bases sont chargées d'avance au repos comme les calques des 18 muscles, bodyPreload) : il ne
# doit pas grimper au-dessus d'avant. Le 3× d'une seule vue pèserait ≈ 0,45 Mo de plus.
FICHE_IMG_BUDGET = 34_410
HI_RE = r'@3x|/p3/|hit\.png'


def tag(device, theme):
    return f'{device}-{theme}'.replace(' ', '_').replace('+', 'plus')


def open_app(page, theme):
    page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
    seed(page, theme, json.dumps(ppl_v2_today(now_ms=NOW), ensure_ascii=False))
    settle(page)
    # Calques des 18 muscles chargés d'avance au repos (bodyPreload) : hors de la mesure de la fiche
    page.wait_for_function("() => bodyPreloaded.length > 0 && bodyPreloaded.every(i => i.complete)", timeout=15000)


def layout_ok(page):
    """[] si rien ne déborde ; sinon ce qui déborde (défilement horizontal, texte coupé par « … »)."""
    return page.evaluate("""() => { const bad = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`page ${document.documentElement.scrollWidth} > ${innerWidth}`);
        for (const e of document.querySelectorAll('.cell__title, .cell__sub, .mpill, .btip p, .azoom__hint'))
            if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === 'ellipsis') bad.push(`${e.className} « ${e.textContent.trim().slice(0, 30)} »`);
        return bad; }""")


def part_point(page, root, part, view='front'):
    """Point d'un sous-muscle à l'écran, tiré de la carte de toucher (hit.png) : centre de ses points sur la moitié
    gauche de la vue (un bras, un côté du torse), ramené à la boîte affichée de la vue."""
    return page.evaluate("""async ([root, part, view]) => {
        const map = document.querySelector(root), fig = map.querySelector(`.body-map__${view}`);
        const kind = (map.closest('[data-body]') || map.querySelector('[data-body]') || map).dataset.body || bodySilhouette();
        const hit = await atlasHitMap(kind, view), k = BODY_PARTS.parts.findIndex(p => p.id === part) + 1;
        let sx = 0, sy = 0, n = 0;
        for (let j = 0; j < hit.h; j++) for (let i = 0; i < hit.w / 2; i++) if (hit.map[j * hit.w + i] === k) { sx += i; sy += j; n++; }
        if (!n) return null;
        // Point de la forme le plus proche du centre (une forme en croissant a son centre dehors)
        const cx = sx / n, cy = sy / n; let best = null, bd = Infinity;
        for (let j = 0; j < hit.h; j++) for (let i = 0; i < hit.w / 2; i++) if (hit.map[j * hit.w + i] === k) {
            const d = (i - cx) ** 2 + (j - cy) ** 2; if (d < bd) { bd = d; best = [i, j]; } }
        const r = fig.getBoundingClientRect();
        return [r.left + (best[0] + 0.5) / hit.w * r.width, r.top + (best[1] + 0.5) / hit.h * r.height]; }""", [root, part, view])


def tap(page, xy, double=False, touch=False):
    """Toucher (ou deux) en xy. Carte de la fiche : clic (Playwright WebKit ne tire pas de click après un
    touchscreen.tap ; l'app réagit au click, comme sur iPhone). Vue agrandie : touch=True, événements de toucher."""
    for _ in range(2 if double else 1):
        if touch:
            page.touchscreen.tap(*xy)
        else:
            page.mouse.click(*xy)
        page.wait_for_timeout(90)


def tip_text(page):
    tip = page.locator('.btip')
    return ' '.join(tip.inner_text().split()) if tip.count() else ''


def layers(page, root):
    return page.evaluate("""root => Object.fromEntries([...document.querySelectorAll(`${root} .body-map__p`)].map(l =>
        [`${l.closest('.body-map__fig').classList.contains('body-map__back') ? 'b' : 'f'}:${l.dataset.part}`, l.classList.contains('body-map__m--sec') ? 1 : 2]))""", root)


def pinch(page, cx, cy, d0, d1, steps=6):
    """Pincement à deux doigts (Chromium : Input.dispatchTouchEvent), écart d0 → d1 points autour de (cx, cy)."""
    cdp = page.context.new_cdp_session(page)
    pts = lambda d: [{'x': cx - d / 2, 'y': cy, 'id': 1}, {'x': cx + d / 2, 'y': cy, 'id': 2}]
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pts(d0)})
    for k in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': pts(d0 + (d1 - d0) * k / steps)})
        page.wait_for_timeout(30)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    cdp.detach()


def save_weight(t, n, urls):
    path = os.path.join(SCRATCH, 'atlas-poids.json')
    try:
        cur = json.load(open(path, encoding='utf-8'))
    except Exception:
        cur = {}
    cur[t] = {'octets': n, 'fichiers': sorted(urls)}
    os.makedirs(SCRATCH, exist_ok=True)
    json.dump(cur, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


def t_fiche(bench, eng, dev, theme):
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        # ── Premier affichage : poids des images, rien du 3×
        got = {}
        def on_resp(r):
            if '/img/' in r.url and r.ok:
                try:
                    got[r.url.split('/img/', 1)[1]] = len(r.body())
                except Exception:
                    pass
        page.on('response', on_resp)
        page.evaluate(f"navigate(makeRoute('library-ex', {json.dumps(EX)}))")
        page.wait_for_selector('.view.library-ex .mpanel--atlas')
        page.wait_for_function("() => [...document.querySelectorAll('.mpanel__map .body-map__base')].every(i => i.complete && i.naturalWidth)")
        settle(page)
        page.remove_listener('response', on_resp)
        total = sum(got.values())
        save_weight(t, total, got)
        R.check(0 < total <= FICHE_IMG_BUDGET, f'{t} premier affichage : {total} octets d\'images (budget {FICHE_IMG_BUDGET}) {sorted(got)}')
        R.check(not any(re.search(HI_RE, u) for u in got), f'{t} premier affichage : aucune image 3× ni carte de toucher {sorted(got)}')
        R.check(all(u.startswith(('body2/male/', 'muscles/')) for u in got), f'{t} premier affichage : personnage de l\'atlas, vue de l\'exercice {sorted(got)}')
        R.check(not any(u.endswith('base.webp') for u in got), f'{t} premier affichage : bases de l\'atlas déjà chargées au repos {sorted(got)}')
        # ── Sous-muscles du développé incliné
        lv = layers(page, '.mpanel__map')
        R.check(lv.get('f:chest_clavicular') == 2, f'{t} pectoral claviculaire en rouge plein {lv}')
        R.check(lv.get('f:chest_sternal') == 1 and lv.get('f:delt_anterior') == 1, f'{t} sterno-costal et deltoïde antérieur en rouge atténué {lv}')
        R.check(lv.get('b:triceps_lateral') == 1 and lv.get('b:triceps_long') == 1, f'{t} triceps en soutien (dos) {lv}')
        R.check('f:chest_abdominal' not in lv and 'f:delt_lateral' not in lv and 'b:delt_lateral' not in lv, f'{t} ni faisceau abdominal ni deltoïde latéral {lv}')
        R.check(page.locator('.mpanel__zoom[aria-label="Agrandir le personnage"]').count() == 1, f'{t} bouton Agrandir (VoiceOver)')
        z = page.locator('.mpanel__zoom').bounding_box()
        R.check(z and z['width'] >= 44 and z['height'] >= 44, f'{t} bouton Agrandir 44 × 44 {z}')
        page.locator('.mpanel').scroll_into_view_if_needed()
        settle(page)
        lo = layout_ok(page)
        R.check(not lo, f'{t} fiche : mise en page {lo}')
        shot(page, LOT, f'fiche-{t}')
        # ── Toucher : nom de salle, nom officiel, rôle
        tap(page, part_point(page, '.mpanel__map', 'chest_clavicular'))
        page.wait_for_selector('.btip', timeout=5000)
        settle(page)
        txt = tip_text(page)
        R.check('Pectoraux, faisceau claviculaire (haut)' in txt and 'Pectoralis major, pars clavicularis' in txt and 'Muscle principal' in txt,
                f'{t} toucher : nom, latin, rôle « {txt} »')
        R.check(page.locator('.mpanel__map .body-map__hl[data-part="chest_clavicular"]').count() == 1, f'{t} toucher : sous-muscle mis en valeur')
        shot(page, LOT, f'fiche-nom-{t}')
        tap(page, part_point(page, '.mpanel__map', 'triceps_lateral', 'back'))
        page.wait_for_timeout(400)
        txt = tip_text(page)
        R.check('Triceps, chef latéral' in txt and 'Muscle secondaire' in txt, f'{t} toucher du triceps : secondaire « {txt} »')
        page.wait_for_timeout(400)
        # ── Double toucher : vue agrandie, zoomée, 3× de la face seulement
        hi_urls = []
        page.on('request', lambda q: re.search(HI_RE, q.url) and hi_urls.append(q.url.split('/img/', 1)[1]))
        tap(page, part_point(page, '.mpanel__map', 'chest_clavicular'), double=True)
        page.wait_for_selector('.azoom', timeout=5000)
        page.wait_for_function("() => atlasViewerState()?.hi === 'front' && atlasViewerState().lines === 'front'", timeout=10000)
        settle(page)
        st = page.evaluate('atlasViewerState()')
        R.check(abs(st['scale'] - 2.6) < 0.05, f'{t} double toucher : zoom ×2,6 {st}')
        R.check(hi_urls and all('/front/' in u for u in hi_urls) and not any('/back/' in u for u in hi_urls), f'{t} 3× de la face seulement {hi_urls}')
        R.check(page.evaluate("document.querySelector('.azoom .body-map__front .body-map__base').src.endsWith('base@3x.webp')"), f'{t} base 3× affichée')
        R.check(page.locator('.azoom .body-map__front [data-part="chest_clavicular"]').count() == 1
                and 'p3/' in page.evaluate("document.querySelector('.azoom .body-map__front [data-part=\"chest_clavicular\"]').style.backgroundImage"),
                f'{t} sous-muscles 3× recadrés')
        R.check(not page.locator('.azoom .body-map__front .azoom__lines').evaluate('e => e.hidden'), f'{t} contours des sous-muscles au-delà de ×2')
        shot(page, LOT, f'zoom-{t}')
        tap(page, part_point(page, '.azoom', 'chest_clavicular'), touch=True)
        page.wait_for_selector('.btip.btip--top', timeout=5000)
        settle(page)
        txt = tip_text(page)
        R.check('claviculaire' in txt and 'Pectoralis major' in txt, f'{t} vue agrandie : nom au toucher « {txt} »')
        on_top = page.evaluate("""() => { const t = document.querySelector('.btip').getBoundingClientRect();
            const e = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2); return !!e && !!e.closest('.btip'); }""")
        R.check(on_top or page.evaluate("getComputedStyle(document.querySelector('.btip')).pointerEvents") == 'none'
                and int(page.evaluate("getComputedStyle(document.querySelector('.btip')).zIndex")) > 900, f'{t} bulle au-dessus de la feuille')
        lo = layout_ok(page)
        R.check(not lo, f'{t} vue agrandie : mise en page {lo}')
        shot(page, LOT, f'zoom-nom-{t}')
        # Glisser vers la gauche jusqu'au dos : le dos passe au 3×, la face revient au 1× (une seule vue 3×)
        box = page.locator('.azoom').bounding_box()
        page.evaluate("closeBodyTip()")
        y = box['y'] + box['height'] * 0.5
        page.mouse.move(box['x'] + box['width'] * 0.9, y)
        page.mouse.down()
        for k in range(1, 13):
            page.mouse.move(box['x'] + box['width'] * (0.9 - 0.85 * k / 12), y)
        page.mouse.up()
        page.mouse.move(box['x'] + box['width'] * 0.9, y)
        page.mouse.down()
        for k in range(1, 13):
            page.mouse.move(box['x'] + box['width'] * (0.9 - 0.85 * k / 12), y)
        page.mouse.up()
        try:
            page.wait_for_function("() => atlasViewerState()?.hi === 'back'", timeout=10000)
        except Exception:
            pass
        settle(page)
        st = page.evaluate('atlasViewerState()')
        front_hi = page.evaluate("""() => [...document.querySelectorAll('.azoom .body-map__front img, .azoom .body-map__front i')]
            .some(e => /@3x|p3\\//.test((e.getAttribute('src') || '') + (e.style.backgroundImage || '')))""")
        R.check(st['hi'] == 'back' and not front_hi, f'{t} une seule vue 3× : dos en 3×, face revenue au 1× {st} {front_hi}')
        shot(page, LOT, f'zoom-dos-{t}')
        # Double toucher : retour à ×1
        tap(page, [box['x'] + box['width'] / 2, box['y'] + box['height'] * 0.6], double=True, touch=True)
        page.wait_for_timeout(500)
        settle(page)
        R.check(page.evaluate('atlasViewerState().scale') == 1, f'{t} double toucher : retour au personnage entier')
        page.click('.sheet-root--atlas .sheet__btn--confirm')
        page.wait_for_selector('.azoom', state='detached', timeout=3000)
        R.check(page.evaluate('atlasViewerState()') is None and page.locator('.btip').count() == 0, f'{t} OK : vue agrandie fermée, bulle fermée')
        # Bouton Agrandir : vue entière (×1, rien du 3×)
        page.click('.mpanel__zoom')
        page.wait_for_selector('.azoom')
        settle(page)
        st = page.evaluate('atlasViewerState()')
        R.check(st['scale'] == 1 and st['hi'] == '', f'{t} bouton Agrandir : personnage entier au 1× {st}')
        shot(page, LOT, f'vue-entiere-{t}')
        if eng == 'chromium':
            # Pincement dans la vue agrandie : zoom progressif, 3× au-delà de ×1,4
            b = page.locator('.azoom').bounding_box()
            pinch(page, b['x'] + b['width'] * 0.3, b['y'] + b['height'] * 0.3, 60, 200)
            page.wait_for_timeout(300)
            settle(page)
            st = page.evaluate('atlasViewerState()')
            R.check(st['scale'] > 2, f'{t} pincement : zoom {st}')
            page.click('.sheet-root--atlas .sheet__btn--confirm')
            page.wait_for_selector('.azoom', state='detached', timeout=3000)
            # Deux doigts sur la carte de la fiche : la vue agrandie s'ouvre
            m = page.locator('.mpanel__map').bounding_box()
            pinch(page, m['x'] + m['width'] * 0.25, m['y'] + m['height'] * 0.3, 20, 60)
            page.wait_for_selector('.azoom', timeout=3000)
            R.check(page.evaluate('atlasViewerState().scale') >= 1.9, f'{t} deux doigts sur la fiche : vue agrandie zoomée')
            page.click('.sheet-root--atlas .sheet__btn--confirm')
            page.wait_for_selector('.azoom', state='detached', timeout=3000)
        else:
            page.click('.sheet-root--atlas .sheet__btn--confirm')
            page.wait_for_selector('.azoom', state='detached', timeout=3000)
        # ── Texte agrandi (AX33 : 33 px)
        page.evaluate("""() => { const h = document.documentElement; h.style.fontSize = '33px'; h.classList.add('type-xl');
            window.dispatchEvent(new Event('resize')); render(); }""")
        settle(page)
        page.locator('.mpanel').scroll_into_view_if_needed()
        settle(page)
        lo = layout_ok(page)
        R.check(not lo, f'{t} fiche texte agrandi : mise en page {lo}')
        shot(page, LOT, f'fiche-xl-{t}')
        page.click('.mpanel__zoom')
        page.wait_for_selector('.azoom')
        settle(page)
        lo = layout_ok(page)
        R.check(not lo, f'{t} vue agrandie texte agrandi : mise en page {lo}')
        shot(page, LOT, f'vue-entiere-xl-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_ailleurs(bench, eng, dev, theme):
    """Progrès › Exercice et Programme gardent la carte des 18 muscles (img/body), sans atlas."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        ex = page.evaluate("[...exerciseIndex().values()].find(it => it.name === 'Développé couché')?.exId || [...exerciseIndex().values()][0].exId")
        page.evaluate(f"navigate(makeRoute('stats-ex', {json.dumps(ex)}))")
        page.wait_for_selector('.view.stats-ex .mpanel')
        settle(page)
        R.check(page.locator('.view.stats-ex .body-map--atlas').count() == 0 and page.locator('.view.stats-ex .mpanel__map .body-map__m[data-muscle]').count() > 0
                and 'img/body/' in page.evaluate("document.querySelector('.view.stats-ex .mpanel__map .body-map__base').src"),
                f'{t} Progrès › Exercice : carte des 18 muscles inchangée')
        page.click('.tabbar [data-action="go-stats"]')
        page.wait_for_selector('.view.stats')
        settle(page)
        R.check(page.locator('.body-map--atlas').count() == 0, f'{t} Progrès : pas d\'atlas')
        R.check(not page.errors, f'{t} ailleurs : aucune erreur JS {page.errors}')


def t_hors_ligne(bench):
    """Service worker : 1× en cache d'installation, 3× mis en cache au premier zoom, puis servi hors ligne."""
    with bench.page('chromium', 'Pixel 7', 'dark', service_workers='allow') as page:
        page.route('https://mdlf-ota.vercel.app/**', lambda route: route.abort())
        seed(page, 'dark', json.dumps(ppl_v2_today(now_ms=NOW), ensure_ascii=False))
        page.wait_for_function("() => navigator.serviceWorker.ready.then(() => true)", timeout=30000)
        page.reload()
        page.wait_for_function("() => !!navigator.serviceWorker.controller", timeout=30000)
        settle(page)
        cached = page.evaluate("""async () => { const c = await caches.open((await caches.keys()).find(k => k.startsWith('ppl-')));
            return (await c.keys()).map(r => new URL(r.url).pathname).filter(p => p.startsWith('/img/body2/')); }""")
        R.check('/img/body2/male/front/base.webp' in cached and '/img/body2/male/front/p/chest_clavicular.webp' in cached
                and '/img/body2/male/front/hit.png' in cached, f'hors ligne : 1× et carte de toucher en cache d\'installation ({len(cached)})')
        R.check(not any(re.search(HI_RE.replace(r'|hit\.png', ''), p) for p in cached), 'hors ligne : aucun 3× en cache avant le premier zoom')
        page.evaluate(f"navigate(makeRoute('library-ex', {json.dumps(EX)}))")
        page.wait_for_selector('.mpanel--atlas')
        page.locator('.mpanel').scroll_into_view_if_needed()
        settle(page)
        tap(page, part_point(page, '.mpanel__map', 'chest_clavicular'), double=True)
        page.wait_for_function("() => atlasViewerState()?.hi === 'front' && atlasViewerState().lines === 'front'", timeout=15000)
        page.wait_for_timeout(500)
        cached = page.evaluate("""async () => { const c = await caches.open((await caches.keys()).find(k => k.startsWith('ppl-')));
            return (await c.keys()).map(r => new URL(r.url).pathname).filter(p => /@3x|\\/p3\\//.test(p)); }""")
        R.check('/img/body2/male/front/base@3x.webp' in cached and '/img/body2/male/front/p3/chest_clavicular.webp' in cached
                and not any('/back/' in p or '/female/' in p for p in cached), f'hors ligne : 3× de la vue zoomée mis en cache au passage {cached}')
        # Hors ligne : l'app rouverte, la fiche et le zoom marchent sans réseau
        failed = []
        page.on('requestfailed', lambda q: failed.append(q.url))
        page.context.set_offline(True)
        page.reload()
        page.wait_for_selector('#app > *')
        settle(page)
        page.evaluate(f"navigate(makeRoute('library-ex', {json.dumps(EX)}))")
        page.wait_for_selector('.mpanel--atlas')
        page.locator('.mpanel').scroll_into_view_if_needed()
        settle(page)
        tap(page, part_point(page, '.mpanel__map', 'chest_clavicular'))
        page.wait_for_selector('.btip', timeout=5000)
        R.check('claviculaire' in tip_text(page), 'hors ligne : nom au toucher (carte de toucher en cache)')
        page.wait_for_timeout(400)
        tap(page, part_point(page, '.mpanel__map', 'chest_clavicular'), double=True)
        try:
            page.wait_for_function("() => atlasViewerState()?.hi === 'front' && atlasViewerState().lines === 'front'", timeout=10000)
            ok = True
        except Exception:
            ok = False
        img_failed = [u for u in failed if '/img/' in u]
        R.check(ok and not img_failed, f'hors ligne : zoom 3× servi par le cache {img_failed}')
        shot(page, LOT, 'hors-ligne-zoom')
        page.context.set_offline(False)
        R.check(not page.errors, f'hors ligne : aucune erreur JS {page.errors}')


if __name__ == '__main__':
    run_main(R, [t_fiche, t_ailleurs], once=[t_hors_ligne])
