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
    bad_ = page.evaluate("""() => { const bad = [];
        // Débordement de ce que l'atlas affiche (panneau, vue agrandie, bulle) ; le reste de la fiche a ses propres tests
        for (const e of document.querySelectorAll('.mpanel--atlas, .mpanel--atlas *, .sheet-root--atlas .sheet, .sheet-root--atlas .sheet *:not(.azoom__stage):not(.azoom__stage *), .btip')) {
            const r = e.getBoundingClientRect();
            if (r.width && (r.right > innerWidth + 1 || r.left < -1)) bad.push(`${e.tagName}.${String(e.className).slice(0, 30)} ${Math.round(r.left)}..${Math.round(r.right)} > ${innerWidth}`);
        }
        if (document.documentElement.scrollWidth > innerWidth + 1) window.__atlasWide = `page ${document.documentElement.scrollWidth} > ${innerWidth} : ` + [...document.querySelectorAll('#app *')]
            .filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map(e => `${e.tagName}.${String(e.className).slice(0, 30)}`).join(', ');
        for (const e of document.querySelectorAll('.cell__title, .cell__sub, .mpill, .mline2, .atlas-info p, .azoom__hint'))
            if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === 'ellipsis') bad.push(`${e.className} « ${e.textContent.trim().slice(0, 30)} »`);
        return bad; }""")
    wide = page.evaluate('window.__atlasWide || ""')
    if wide:
        print(f'  (hors atlas) {wide}', flush=True)
    return bad_


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
        const r = (fig.querySelector('.body-map__body') || fig).getBoundingClientRect();   // corps entier (carte cadrée)
        return [r.left + (best[0] + 0.5) / hit.w * r.width, r.top + (best[1] + 0.5) / hit.h * r.height]; }""", [root, part, view])


def tap(page, xy, double=False, touch=False):
    """Toucher (ou deux) en xy. Carte de la fiche : clic (Playwright WebKit ne tire pas de click après un
    touchscreen.tap ; l'app réagit au click, comme sur iPhone). Vue agrandie : touch=True, événements de toucher."""
    if double and not touch:
        # Double clic d'un seul envoi : deux clics à la suite, comme les deux touchers d'un doigt. Deux mouse.click
        # séparés attendent chacun que la page ait traité le précédent : sur une CI lente (iPhone 17, bulle à préparer
        # après le 1er), le 2e partait 400 à 480 ms après le 1er et l'app y voyait deux touchers simples
        page.mouse.dblclick(*xy)
        page.wait_for_timeout(90)
        return
    for _ in range(2 if double else 1):
        if touch:
            page.touchscreen.tap(*xy)
        else:
            page.mouse.click(*xy)
        page.wait_for_timeout(90)


DIAG_JS = """() => { const t = document.querySelector('.atlas-info')?.getBoundingClientRect();
    const bad = [...document.images].filter(i => i.src && (!i.complete || !i.naturalWidth)).map(i => i.src.split('/img/')[1] || i.src);
    return JSON.stringify({ info: t ? [t.left | 0, t.top | 0, t.right | 0, t.bottom | 0] : null, lastTap: typeof atlasLastTap !== 'undefined' && atlasLastTap
      ? Math.round(performance.now() - atlasLastTap.t) : null, viewer: !!document.querySelector('.azoom'), scrollY: Math.round(scrollY), badImgs: bad.slice(0, 8), nBad: bad.length, taps: window.__taps || null }); }"""


def wait_or_say(page, sel, where, state='visible'):
    """wait_for_selector qui dit laquelle des attentes a échoué, avec l'état de la page (bulle, dernier toucher, images
    non chargées, requêtes en échec), et une capture (échec intermittent en CI)."""
    try:
        page.wait_for_selector(sel, state=state, timeout=15000)
    except Exception as e:
        try:
            diag = page.evaluate(DIAG_JS)
            shot(page, LOT, f'echec-{where.split()[0]}-{where.split()[1] if len(where.split()) > 1 else ""}')
        except Exception as e2:
            diag = f'? ({e2})'
        failed = getattr(page, '_failed_requests', [])[:6]
        raise RuntimeError(f'{where} : {sel} ({state}) jamais vu ; état {diag} ; requêtes en échec {failed} ; console {getattr(page, "_console_errors", [])[:4]}') from e


def info_ok(page, scope, avoid):
    """Carte d'info du muscle touché (panel affichage-e t8) : dans scope (la page sous le dessin, ou la bande de la vue
    agrandie), elle ne recouvre rien : ni le dessin, ni les éléments avoid ; { ok, hit, card }."""
    return page.evaluate("""([scope, avoid]) => { const el = document.querySelector(scope + ' .atlas-info'), c = el?.getBoundingClientRect();
        if (!c) return { ok: false, why: 'carte absente' };
        const hit = avoid.filter(s => [...document.querySelectorAll(s)].some(a => { const r = a.getBoundingClientRect();
            return r.width && c.left < r.right - 1 && c.right > r.left + 1 && c.top < r.bottom - 1 && c.bottom > r.top + 1; }));
        return { ok: !hit.length, hit, card: [c.left | 0, c.top | 0, c.right | 0, c.bottom | 0] }; }""", [scope, avoid])


def tip_text(page):
    tip = page.locator('.atlas-info')
    return ' '.join(tip.first.inner_text().split()) if tip.count() else ''


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
        lines = page.evaluate("""[...document.querySelectorAll('.group:has(.mpanel--atlas) .mline2')].map(b => [b.querySelector('.cell__sub').textContent, [...b.querySelectorAll('.mline2__names .mline2__name')].map(n => n.textContent), b.dataset.level | 0])""")
        R.check(lines == [['Muscle ciblé', ['Haut des pectoraux'], 2], ['Muscles qui aident', ['Milieu des pectoraux', 'Épaules antérieures', 'Triceps'], 1]],
                f'{t} deux lignes : ciblés en rouge plein, ceux qui aident ensuite, du plus sollicité {lines}')
        R.check('Touche un muscle pour le voir seul.' in page.inner_text('.view.library-ex'), f'{t} aide courte sous la carte')
        lab = page.get_attribute('.mline2[data-level="1"]', 'aria-label')
        R.check(lab == "Muscles qui aident, 3 : Milieu des pectoraux, Épaules antérieures, Triceps. Touche pour ne voir qu'eux", f'{t} VoiceOver : nombre et action « {lab} »')
        R.check(page.evaluate("document.querySelector('.mpanel__map').classList.contains('body-map--crop')"), f'{t} haut du corps seulement : carte cadrée, plus grande')
        # Toucher « Muscles qui aident » : seuls ses muscles restent, en rouge plein ; puis un nom : ce seul muscle
        vis = "() => [...document.querySelectorAll('.mpanel__map .body-map__p')].filter(l => getComputedStyle(l).opacity !== '0').map(l => l.dataset.part).sort()"
        page.locator('.mline2[data-level="1"]').evaluate("e => e.scrollIntoView({ block: 'center' })")
        page.click('.mline2[data-level="1"] .cell__sub')
        page.wait_for_timeout(500)
        on = page.evaluate(vis)
        R.check('chest_clavicular' not in on and {'chest_sternal', 'delt_anterior', 'triceps_long'} <= set(on)
                and page.get_attribute('.mline2[data-level="1"]', 'aria-pressed') == 'true', f'{t} ligne « qui aident » : seuls ses muscles {on}')
        keep = page.evaluate("[...document.querySelectorAll('.mpanel__map .body-map__p.is-on')].map(l => [l.classList.contains('body-map__m--sec'), getComputedStyle(l).opacity])")
        want = 1.0   # qui aident : opaques, la teinte de la pastille (panels t5 et t6)
        R.check(keep and all(sec and abs(float(op) - want) < 0.01 for sec, op in keep), f'{t} ligne touchée : ses muscles gardent leur couleur (qui aide, {want:.0%}) {keep[:3]}')
        page.wait_for_timeout(100)
        R.check('muscles qui aident sont affichés' in page.evaluate("document.getElementById('atlasLive')?.textContent || ''"), f'{t} changement annoncé à VoiceOver')
        shot(page, LOT, f'fiche-aident-{t}')
        page.click('.mline2[data-level="1"] .mline2__name[data-label="Triceps"]')
        page.wait_for_timeout(500)
        on = page.evaluate(vis)
        R.check(on and all(p.startswith('triceps') for p in on), f'{t} nom « Triceps » : ce seul muscle {on}')
        page.click('.mline2[data-level="1"] .mline2__name[data-label="Triceps"]')
        page.wait_for_timeout(500)
        # Tout revient : les aidants discrets (ciblé petit, sans remplissage, panel atlas-bas t4) comptent par leur contour rose
        back = page.evaluate("() => ({ n: [...document.querySelectorAll('.mpanel__map .body-map__p')].filter(l => getComputedStyle(l).opacity !== '0' || (l.classList.contains('body-map__m--faint') && document.querySelector(`.mpanel__map .body-map__ol--help[data-ol=\"${l.dataset.part}\"]`))).length, iso: !!document.querySelector('.mpanel__map[data-iso]') })")
        R.check(back['n'] >= 6 and not back['iso'] and page.get_attribute('.mline2[data-level="1"]', 'aria-pressed') == 'false', f'{t} toucher de nouveau : tous les muscles reviennent {back}')
        page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        settle(page)
        sub = page.inner_text('.exhead__sub').replace('\xa0', ' ')
        R.check(sub.startswith('Haut des pectoraux') and 'Épaules' not in sub, f'{t} sous le titre : les rangs du personnage « {sub} »')
        off = page.evaluate(ZOOM_CORNER_JS, '.mpanel__map')
        R.check(off and off['corner'] and not off['on'], f'{t} bouton Agrandir dans le coin du dessin, sur aucun muscle coloré {off}')
        z = page.locator('.mpanel__zoom').bounding_box()
        R.check(z and z['width'] >= 44 and z['height'] >= 44, f'{t} bouton Agrandir 44 × 44 {z}')
        fill = page.evaluate("getComputedStyle(document.querySelector('.mpanel__zoom')).backgroundColor")
        R.check(fill not in ('rgba(0, 0, 0, 0)', 'transparent'), f'{t} bouton Agrandir sur un fond rond, comme − et + ({fill})')
        page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        settle(page)
        lo = layout_ok(page)
        R.check(not lo, f'{t} fiche : mise en page {lo}')
        shot(page, LOT, f'fiche-{t}')
        # ── Toucher : nom de salle, nom officiel, rôle
        tap(page, part_point(page, '.mpanel__map', 'chest_clavicular'))
        page.wait_for_selector('.atlas-info', timeout=5000)
        settle(page)
        txt = tip_text(page)
        R.check('Haut des pectoraux' in txt and 'Pectoralis major, pars clavicularis' in txt and 'Muscle ciblé' in txt,
                f'{t} toucher : nom de salle (celui de la pastille), latin, rôle « {txt} »')
        ok = info_ok(page, '.mpanel--atlas', ['.mpanel__map .body-map__row', '.mpanel__zoom', '.mline2'])
        R.check(ok['ok'] and page.evaluate("document.querySelector('.atlas-info').getBoundingClientRect().top >= document.querySelector('.mpanel__map').getBoundingClientRect().bottom - 1"),
                f'{t} toucher : carte d\'info sous le dessin, elle ne recouvre rien {ok}')
        R.check(page.locator('.mpanel__map .body-map__mark[data-ol="chest_clavicular"]').count() == 1 and page.locator('.body-map__mark').count() == 1,
                f'{t} toucher : sous-muscle cerné, seul')
        shot(page, LOT, f'fiche-nom-{t}')
        tap(page, part_point(page, '.mpanel__map', 'triceps_lateral', 'back'))
        page.wait_for_timeout(400)
        txt = tip_text(page)
        R.check('Triceps, chef latéral' in txt and 'Muscle qui aide' in txt, f'{t} toucher du triceps : qui aide « {txt} »')
        page.wait_for_timeout(400)
        # ── Double toucher : vue agrandie, entière (face et dos, panel t8) ; double toucher dans la vue : zoom, 3× de la face
        hi_urls = []
        page.on('request', lambda q: re.search(HI_RE, q.url) and hi_urls.append(q.url.split('/img/', 1)[1]))
        tap(page, part_point(page, '.mpanel__map', 'chest_clavicular'), double=True)
        page.wait_for_selector('.azoom', timeout=5000)
        settle(page)
        # Fiche (panel t9) : la vue s'ouvre centrée sur le muscle ciblé, à ×2 ; « Vue entière » montre le reste
        page.wait_for_function("() => atlasViewerState()?.hi === 'front' && atlasViewerState().lines === 'front'", timeout=10000)
        settle(page)
        st = page.evaluate('atlasViewerState()')
        cen = page.evaluate("""() => { const v = document.querySelector('.azoom').getBoundingClientRect(), l = document.querySelector('.azoom .body-map__front [data-part="chest_clavicular"]').getBoundingClientRect();
            return [Math.round(l.left + l.width / 2 - (v.left + v.width / 2)), Math.round(l.top + l.height / 2 - (v.top + v.height / 2))]; }""")
        # Paysage : à ×2, les deux vues tiennent encore en largeur (rien à centrer en largeur, le 3× va quand même à la face)
        wide = page.evaluate("document.querySelector('.azoom__stage').getBoundingClientRect().width <= document.querySelector('.azoom').getBoundingClientRect().width + 1")
        R.check(abs(st['scale'] - 2) < 0.05 and (wide or abs(cen[0]) < 60) and abs(cen[1]) < 60, f'{t} double toucher : vue agrandie centrée sur le ciblé, ×2 {st} {cen}')
        R.check(hi_urls and all('/front/' in u for u in hi_urls) and not any('/back/' in u for u in hi_urls), f'{t} 3× de la face seulement {hi_urls}')
        R.check(page.evaluate("document.querySelector('.azoom .body-map__front .body-map__base').src.endsWith('base@3x.webp')"), f'{t} base 3× affichée')
        R.check(page.locator('.azoom .body-map__front [data-part="chest_clavicular"]').count() == 1
                and 'p3/' in page.evaluate("document.querySelector('.azoom .body-map__front [data-part=\"chest_clavicular\"]').style.backgroundImage"),
                f'{t} sous-muscles 3× recadrés')
        R.check(not page.locator('.azoom .body-map__front .azoom__lines').evaluate('e => e.hidden'), f'{t} contours des sous-muscles au-delà de ×2')
        shot(page, LOT, f'zoom-{t}')
        st0 = page.evaluate("(() => { const r = document.querySelector('.azoom__stage').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); })()")
        tap(page, part_point(page, '.azoom', 'chest_clavicular'), touch=True)
        page.wait_for_selector('.sheet-root--atlas .atlas-info', timeout=5000)
        settle(page)
        st1 = page.evaluate("(() => { const r = document.querySelector('.azoom__stage').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); })()")
        R.check(all(abs(a - b) <= 1 for a, b in zip(st0, st1)), f'{t} vue agrandie : la carte ouverte, le dessin garde sa taille et sa place (panel t13) {st0} → {st1}')
        txt = tip_text(page)
        R.check('Haut des pectoraux' in txt and 'Pectoralis major' in txt, f'{t} vue agrandie : nom au toucher « {txt} »')
        ok = info_ok(page, '.sheet-root--atlas', ['.azoom', '.azoom__band', '.sheet-root--atlas .sheet__bar'])
        R.check(ok['ok'], f'{t} vue agrandie : carte d\'info dans la bande du bas, elle ne recouvre rien {ok}')
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
        R.check(wide or (st['hi'] == 'back' and not front_hi), f'{t} une seule vue 3× : dos en 3×, face revenue au 1× {st} {front_hi}')
        shot(page, LOT, f'zoom-dos-{t}')
        # Double toucher : retour à ×1
        tap(page, [box['x'] + box['width'] / 2, box['y'] + box['height'] * 0.6], double=True, touch=True)
        page.wait_for_timeout(500)
        settle(page)
        R.check(page.evaluate('atlasViewerState().scale') == 1, f'{t} double toucher : retour au personnage entier')
        # Boutons + et − (VoiceOver, contacteur) : 44 pt, zoom et retour
        bx = page.locator('.azoom__btn').evaluate_all("bs => bs.map(b => { const r = b.getBoundingClientRect(); return [b.getAttribute('aria-label'), r.width >= 44 && r.height >= 44, b.getAttribute('aria-disabled') === 'true' && !b.disabled]; })")
        R.check(bx == [['Dézoomer', True, True], ['Zoomer', True, False]], f'{t} boutons − et + de 44 pt (− inactif à ×1) {bx}')
        page.click('.azoom__btn[data-z="1"]')
        page.wait_for_timeout(500)
        settle(page)
        R.check(abs(page.evaluate('atlasViewerState().scale') - 1.6) < 0.05, f'{t} bouton + : ×1,6')
        page.click('.azoom__btn[data-z="-1"]')
        page.wait_for_timeout(500)
        settle(page)
        R.check(page.evaluate('atlasViewerState().scale') == 1, f'{t} bouton − : ×1')
        page.click('.sheet-root--atlas .sheet__btn--confirm')
        page.wait_for_selector('.azoom', state='detached', timeout=3000)
        R.check(page.evaluate('atlasViewerState()') is None and page.locator('.atlas-info').count() == 0, f'{t} OK : vue agrandie fermée, carte fermée')
        # Bouton Agrandir : centrée sur le ciblé, ×2 ; « Vue entière » : le personnage entier au 1×
        page.click('.mpanel__zoom')
        page.wait_for_selector('.azoom')
        settle(page)
        R.check(abs(page.evaluate('atlasViewerState().scale') - 2) < 0.05, f'{t} bouton Agrandir : sur le ciblé, ×2')
        page.click('.azoom__whole')
        page.wait_for_timeout(500)
        settle(page)
        st = page.evaluate('atlasViewerState()')
        R.check(st['scale'] == 1, f'{t} « Vue entière » : personnage entier au 1× {st}')
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
        page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        settle(page)
        lo = layout_ok(page)
        R.check(not lo, f'{t} fiche texte agrandi : mise en page {lo}')
        shot(page, LOT, f'fiche-xl-{t}')
        # Texte très grand : le corps entier, au moins 300 points de haut (panel t7 : il rétrécissait avec le texte)
        hgt = page.evaluate("Math.round(document.querySelector('.mpanel__map .body-map__row').getBoundingClientRect().height)")
        R.check(hgt >= 230 and page.get_attribute('.mpanel__map', 'data-crop') == '0,840', f'{t} fiche texte agrandi : personnage entier de {hgt} points (230 au moins)')
        # Le groupe « Muscles » sous la barre : le nom du ciblé se lit en entier, au-dessus de la barre d'onglets (panels t8, t10)
        page.evaluate("""() => { const g = document.querySelector('.mpanel--atlas').closest('.group'), nav = document.querySelector('.view.library-ex .navbar__bar');
            scrollBy(0, g.getBoundingClientRect().top - (nav ? nav.getBoundingClientRect().bottom : 0) - 4); }""")
        settle(page)
        seen = page.evaluate("""() => { const n = document.querySelector('.mline2[data-level="2"] .mline2__names'), tab = document.querySelector('.tabbar').getBoundingClientRect().top;
            return [Math.round(n.getBoundingClientRect().bottom), Math.round(tab)]; }""")
        R.check(seen[0] < seen[1], f'{t} fiche texte agrandi : nom du muscle ciblé au-dessus de la barre d\'onglets {seen}')
        shot(page, LOT, f'fiche-xl-lignes-{t}')
        # Isoler en texte très grand : le nom et « Tout afficher » sur le dessin même
        page.locator('.mline2[data-level="2"]').first.click()
        settle(page)
        chip = page.locator('.atlas-box__iso')
        geo = page.evaluate("""() => { const c = document.querySelector('.atlas-box__iso')?.getBoundingClientRect(), n = document.querySelector('.atlas-box__iso-name'),
            b = document.querySelector('.mpanel__box').getBoundingClientRect(), ls = [...document.querySelectorAll('.mline2')].map(e => e.getBoundingClientRect());
            const nr = n.getBoundingClientRect(), br = document.querySelector('.atlas-box__iso-all').getBoundingClientRect();
            return c && { lines: Math.round(nr.height / parseFloat(getComputedStyle(n).lineHeight || 20)), under: c.top >= b.bottom - 1, clear: ls.every(l => c.bottom <= l.top + 1 || c.top >= l.bottom - 1),
                          same: br.top < nr.bottom && br.bottom > nr.top }; }""")
        # Panel t12 : « Tout afficher » sur la ligne de « Seulement : … » (dessous, il passait sous la barre d'onglets)
        R.check(chip.count() == 1 and chip.is_visible() and 'Tout afficher' in chip.inner_text() and geo and geo['under'] and geo['clear'] and geo['lines'] <= 2 and geo['same'],
                f'{t} texte agrandi : muscle isolé nommé sous le dessin, avec « Tout afficher », sans couvrir les lignes {geo}')
        page.click('.atlas-box__iso-all')
        settle(page)
        R.check(page.locator('.atlas-box__iso').count() == 0 and not page.evaluate("document.querySelector('.mpanel__map').dataset.iso"), f'{t} texte agrandi : « Tout afficher » sur le dessin rend tous les muscles')
        zx = page.evaluate("""() => { const b = document.querySelector('.mpanel__zoom'), r = b.getBoundingClientRect(), m = document.querySelector('.mpanel__map').getBoundingClientRect();
            return { txt: b.querySelector('.mpanel__zoom-txt')?.offsetWidth > 0, h: Math.round(r.height), under: r.top >= m.bottom - 1, fs: parseFloat(getComputedStyle(b).fontSize) }; }""")
        R.check(zx['txt'] and zx['h'] >= 44 and zx['under'] and zx['fs'] > 17, f'{t} texte agrandi : « Agrandir » écrit sous le dessin, à la taille du texte {zx}')
        page.click('.mpanel__zoom')
        page.wait_for_selector('.azoom')
        settle(page)
        R.check(page.locator('.azoom__short').is_visible() and page.inner_text('.azoom__short') == 'Touche un muscle pour son nom', f'{t} vue agrandie texte agrandi : aide courte visible')
        leg = page.locator('.azoom__band > .azoom__legend')
        R.check(leg.is_visible() and 'Ciblé' in leg.inner_text() and 'Qui aide' in leg.inner_text(), f'{t} vue agrandie texte agrandi : « Ciblé, Qui aide » toujours visible')
        lo = layout_ok(page)
        R.check(not lo, f'{t} vue agrandie texte agrandi : mise en page {lo}')
        shot(page, LOT, f'vue-entiere-xl-{t}')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


ZOOM_CORNER_JS = """async sel => {
    // Bouton Agrandir : dans un coin du dessin (à 12 points au plus d'un coin), et sur aucun muscle coloré (carte de toucher)
    // Coin de la boîte du dessin : en bas, elle réserve la place du bouton sous les pieds (panel atlas-bas t4)
    const m = document.querySelector(sel), z = m.parentElement.querySelector('.mpanel__zoom').getBoundingClientRect(), r = m.getBoundingClientRect();
    const near = (a, b) => Math.abs(a - b) <= 12, box = m.parentElement.getBoundingClientRect();
    const corner = near(z.right, box.right) && (near(z.top, box.top) || near(z.bottom, box.bottom));
    const lv = JSON.parse(m.dataset.atlas || '{}'), kind = bodySilhouette();
    let on = '';
    for (const fig of m.querySelectorAll('.body-map__fig')) {
      const v = fig.classList.contains('body-map__back') ? 'back' : 'front', b = fig.querySelector('.body-map__body').getBoundingClientRect(), hit = await atlasHitMap(kind, v);
      for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
        const x = z.left + 6 + (z.width - 12) * i / 6, y = z.top + 6 + (z.height - 12) * j / 6;
        const u = (x - b.left) / b.width, w = (y - b.top) / b.height;
        if (u < 0 || u >= 1 || w < 0 || w >= 1 || y < r.top || y > r.bottom) continue;
        const n = hit.map[Math.floor(w * hit.h) * hit.w + Math.floor(u * hit.w)], p = n && BODY_PARTS.parts[n - 1];
        if (p && lv[p.id] > 0) on = p.id;
      }
    }
    return { corner, on }; }"""


PINCH_JS = """([sel, phase, d, cx, cy]) => {
    // Deux doigts simulés (événements touch, comme iOS) sur l'élément sel, écartés de d points autour de (cx, cy)
    // WebKit de Playwright n'a pas de constructeur Touch : un Event de même type, avec les listes que lit l'app
    const el = document.querySelector(sel), mk = (id, x) => ({ identifier: id, target: el, clientX: x, clientY: cy });
    const ts = [mk(1, cx - d / 2), mk(2, cx + d / 2)];
    const type = { start: 'touchstart', move: 'touchmove', end: 'touchend' }[phase];
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, {}); Object.defineProperties(ev, { touches: { value: phase === 'end' ? [] : ts }, changedTouches: { value: ts } });
    el.dispatchEvent(ev); return ev.defaultPrevented; }"""

POINTERS_JS = """([phase, pts]) => {
    // Pointeurs « touch » simulés dans la vue agrandie : pts = [[id, x, y], …]
    const v = document.querySelector('.azoom');
    for (const [id, x, y] of pts) v.dispatchEvent(new PointerEvent('pointer' + phase, { bubbles: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isPrimary: id === 1 }));
}"""


def t_pincement(bench, eng, dev, theme):
    """Vrai zoom à deux doigts : pincement commencé sur la carte de la fiche, continué dans la vue agrandie avec les
    mêmes doigts ; zoom qui suit les doigts, élastique au-delà de ×6, glisser avec inertie, double toucher ×2,5."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        page.evaluate(f"navigate(makeRoute('library-ex', {json.dumps(EX)}))")
        page.wait_for_selector('.mpanel--atlas')
        page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        settle(page)
        b = page.locator('.mpanel__map').bounding_box()
        cx, cy = b['x'] + b['width'] * 0.3, b['y'] + b['height'] * 0.4
        sel = '.mpanel__map .body-map__front'
        # Un doigt qui défile n'ouvre rien et n'empêche pas le défilement
        one = page.evaluate("""([sel, x, y]) => { const el = document.querySelector(sel), t = { identifier: 9, target: el, clientX: x, clientY: y };
            const ev = (type, touches) => { const e = new Event(type, { bubbles: true, cancelable: true });
                Object.defineProperties(e, { touches: { value: touches }, changedTouches: { value: [t] } }); el.dispatchEvent(e); return e.defaultPrevented; };
            ev('touchstart', [t]); const m = ev('touchmove', [t]); ev('touchend', []); return m; }""", [sel, cx, cy])
        R.check(not one, f'{t} un doigt : le défilement de la page n\'est pas empêché')
        R.check(page.evaluate('atlasViewerState()') is None, f'{t} un doigt sur la carte : rien ne s\'ouvre, la page défile')
        page.evaluate(PINCH_JS, [sel, 'start', 40, cx, cy])
        R.check(page.evaluate('atlasViewerState()') is not None, f'{t} deux doigts sur la carte : vue agrandie ouverte')
        scales = []
        for d in (50, 70, 90, 120, 160):
            prevented = page.evaluate(PINCH_JS, [sel, 'move', d, cx, cy])
            page.wait_for_timeout(40)
            scales.append(page.evaluate('atlasViewerState().scale'))
        R.check(prevented, f'{t} pincement : la page ne défile pas pendant le geste')
        R.check(all(b2 > a2 for a2, b2 in zip(scales, scales[1:])) and abs(scales[-1] - 4) < 0.3,
                f'{t} le zoom suit les doigts, sans repartir de zéro (×1 → ×4 pour un écart ×4) {scales}')
        page.evaluate(PINCH_JS, [sel, 'end', 160, cx, cy])
        page.wait_for_timeout(500)
        settle(page)
        R.check(abs(page.evaluate('atlasViewerState().scale') - scales[-1]) < 0.3, f'{t} doigts levés : le zoom reste où il est')
        try:
            page.wait_for_function("() => atlasViewerState()?.hi", timeout=10000)
        except Exception:
            pass
        R.check(page.evaluate('atlasViewerState().hi') in ('front', 'back'), f'{t} 3× chargé pendant le zoom')
        shot(page, LOT, f'pincement-{t}')
        # Dans la vue : pincement au-delà de ×6 (élastique), puis retour à ×6
        v = page.locator('.azoom').bounding_box()
        mx, my = v['x'] + v['width'] / 2, v['y'] + v['height'] / 2
        page.evaluate(POINTERS_JS, ['down', [[1, mx - 30, my], [2, mx + 30, my]]])
        for d in (60, 120, 240, 480):
            page.evaluate(POINTERS_JS, ['move', [[1, mx - d / 2, my], [2, mx + d / 2, my]]])
            page.wait_for_timeout(30)
        over = page.evaluate('atlasViewerState().scale')
        page.evaluate(POINTERS_JS, ['up', [[1, mx - 240, my], [2, mx + 240, my]]])
        page.wait_for_timeout(600)
        settle(page)
        R.check(over > 6 and over < 8 and abs(page.evaluate('atlasViewerState().scale') - 6) < 0.01,
                f'{t} au-delà de ×6 : élastique ({over:.2f}), puis retour à ×6')
        # Glisser d'un doigt avec inertie : le dessin continue un peu après le lâcher (gestes à 60 images/s, dans la page)
        a1, a2 = page.evaluate("""([mx, my]) => new Promise(res => { const vw = document.querySelector('.azoom'), st = document.querySelector('.azoom__stage');
            const P = (t, x) => vw.dispatchEvent(new PointerEvent('pointer' + t, { bubbles: true, pointerId: 3, pointerType: 'touch', clientX: x, clientY: my }));
            P('down', mx); let k = 0;
            const step = () => { k++; P('move', mx - 12 * k); if (k < 6) setTimeout(step, 16); else { P('up', mx - 72); const a = st.style.transform;
                setTimeout(() => res([a, st.style.transform]), 250); } };
            setTimeout(step, 16); })""", [mx, my])
        tr = lambda: a2
        R.check(tr() != a1, f'{t} glisser : inertie après le lâcher')
        settle(page)
        page.click('.sheet-root--atlas .sheet__btn--confirm')
        page.wait_for_selector('.azoom', state='detached', timeout=3000)
        R.check(not page.errors, f'{t} pincement : aucune erreur JS {page.errors}')


def t_autres_fiches(bench, eng, dev, theme):
    """Bas du corps (Abducteurs machine, sans vidéo ni secondaire : avant, aucun personnage) et dos (tractions)."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        for name, crop, first, view, part in [('Abducteurs machine', '304,604', [['Moyen fessier', 2], ['Grand fessier', 1]], 'back', 'glute_med'),
                                              ('Tractions pronation', '0,450', [['Grand dorsal', 2], ['Grand rond', 2]], 'back', 'lats')]:
            page.evaluate(f"navigate(makeRoute('library-ex', {json.dumps(name)}))")
            page.wait_for_selector('.view.library-ex .mpanel--atlas')
            page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
            settle(page)
            slug = name.split()[0].lower()
            R.check(page.get_attribute('.mpanel__map', 'data-crop') == crop, f'{t} {name} : cadrage {page.get_attribute(".mpanel__map", "data-crop")}')
            if slug == 'abducteurs':
                # Aucun muscle de face : le dos seul, en grand (panel affichage-e t3)
                one = page.evaluate("""() => { const m = document.querySelector('.mpanel__map'); return [m.querySelectorAll('.body-map__front').length, m.querySelectorAll('.body-map__back').length, Math.round(m.getBoundingClientRect().height)]; }""")
                R.check(one[0] == 0 and one[1] == 1 and one[2] >= 180, f'{t} {name} : le dos seul, en grand (face, dos, hauteur ; avant : 124 points) {one}')
                # Panel t12 : le muscle qui aide nommé sous le sous-titre, sans défiler
                R.check(page.inner_text('.exhead__help').strip() == 'Aide : Grand fessier', f'{t} {name} : « Aide : Grand fessier » sous le sous-titre')
            off = page.evaluate(ZOOM_CORNER_JS, '.mpanel__map')
            R.check(off and off['corner'] and not off['on'], f'{t} {name} : Agrandir dans un coin libre du dessin {off}')
            lines = page.evaluate("""[...document.querySelectorAll('.group:has(.mpanel--atlas) .mline2')].map(b => [b.querySelector('.cell__sub').textContent, [...b.querySelectorAll('.mline2__names .mline2__name')].map(n => n.textContent), b.dataset.level | 0])""")
            flat = [[n, lv] for _, names, lv in lines for n in names]
            R.check(flat[:2] == first, f'{t} {name} : lignes {lines}')
            tap(page, part_point(page, '.mpanel__map', part, view))
            page.wait_for_selector('.atlas-info', timeout=5000)
            settle(page)
            R.check(tip_text(page).startswith(first[0][0]), f'{t} {name} : bulle « {tip_text(page)} »')
            ok = info_ok(page, '.mpanel--atlas', ['.mpanel__map .body-map__row', '.mpanel__zoom', '.mline2'])
            R.check(ok['ok'] and page.locator(f'.mpanel__map .body-map__mark[data-ol="{part}"]').count() == 1, f'{t} {name} : carte d\'info sous le dessin, muscle cerné {ok}')
            lo = layout_ok(page)
            R.check(not lo, f'{t} {name} : mise en page {lo}')
            shot(page, LOT, f'fiche-{slug}-{t}')
            page.evaluate('closeBodyTip()')
            caps = page.evaluate("[...document.querySelectorAll('.mpanel__map .body-map__caps > span')].map(e => e.textContent)")
            R.check(caps == [], f'{t} {name} : tête dans le cadre ou une seule vue, pas d\'étiquettes Face / Dos {caps}')
        # Mollets, cadrés sur les jambes (panel atlas-bas t4) : « Face » et « Dos » sous les vues, Agrandir sous les pieds
        page.evaluate("navigate(makeRoute('library-ex', 'Mollets debout'))")
        page.wait_for_selector('.view.library-ex .mpanel--atlas')
        page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        settle(page)
        g = page.evaluate("""() => { const m = document.querySelector('.mpanel__map'), row = m.querySelector('.body-map__row').getBoundingClientRect(),
            z = document.querySelector('.mpanel__zoom').getBoundingClientRect(), caps = [...m.querySelectorAll('.body-map__caps > span')];
            return { caps: caps.map(e => e.textContent), under: caps.every(e => e.getBoundingClientRect().top >= row.bottom - 1),
                     zoomBelow: z.top >= row.bottom - 1, capsFree: caps.every(e => { const rg = document.createRange(); rg.selectNodeContents(e); const c = rg.getBoundingClientRect(); return c.right <= z.left || c.bottom <= z.top; }) }; }""")
        R.check(g['caps'] == ['Face', 'Dos'] and g['under'], f'{t} Mollets debout : « Face » et « Dos » sous les vues recadrées {g}')
        R.check(g['zoomBelow'] and g['capsFree'], f'{t} Mollets debout : Agrandir sous le dessin, sur aucune étiquette {g}')
        off = page.evaluate(ZOOM_CORNER_JS, '.mpanel__map')
        R.check(off and off['corner'] and not off['on'], f'{t} Mollets debout : Agrandir dans le coin, sur aucun muscle {off}')
        shot(page, LOT, f'fiche-mollets-{t}')
        # Texte très grand (panel t9) : sur TOUTES les fiches, le nom du muscle ciblé se lit sans défiler, le personnage sous la
        # barre ; une seule face utile (abducteurs) : elle seule, en grand
        page.evaluate("""() => { const h = document.documentElement; h.style.fontSize = '33px'; h.classList.add('type-xl'); }""")
        for name in ('Développé incliné barre', 'Abducteurs machine', 'Tractions pronation', 'Squat barre'):
            page.evaluate(f"navigate(makeRoute('library-ex', {json.dumps(name)}))")
            page.wait_for_selector('.view.library-ex .mpanel--atlas')
            settle(page)
            # Le groupe « Muscles » sous la barre, comme en y arrivant : le nom du ciblé, AU-DESSUS du dessin (panel t10), se lit
            # en entier, son bas au-dessus du haut de la barre d'onglets
            page.evaluate("""() => { const g = document.querySelector('.mpanel--atlas').closest('.group'), t = g.previousElementSibling, nav = document.querySelector('.view.library-ex .navbar__bar');
                scrollBy(0, (t?.classList.contains('group-title') ? t : g).getBoundingClientRect().top - (nav ? nav.getBoundingClientRect().bottom : 0) - 4); }""")
            settle(page)
            geo = page.evaluate("""() => { const n = document.querySelector('.mline2[data-level="2"] .mline2__names').getBoundingClientRect(), tab = document.querySelector('.tabbar').getBoundingClientRect().top,
                nav = document.querySelector('.view.library-ex .navbar__bar').getBoundingClientRect().bottom, m = document.querySelector('.mpanel__map');
                return { top: Math.round(n.top), bottom: Math.round(n.bottom), nav: Math.round(nav), tab: Math.round(tab), above: n.bottom <= m.getBoundingClientRect().top,
                  h: Math.round(m.querySelector('.body-map__row').getBoundingClientRect().height), views: [...m.querySelectorAll('.body-map__fig')].map(f => f.classList.contains('body-map__back') ? 'dos' : 'face') }; }""")
            want = ['dos'] if name == 'Abducteurs machine' else ['face', 'dos']
            # Panel t13 : « Qui aident : … » en une ligne courte sous le ciblé, visible sans défiler
            sh = page.evaluate("""() => { const e = document.querySelector('.mline2__short'); if (!e) return null; const r = e.getBoundingClientRect();
                const m = document.querySelector('.mpanel__map .body-map__row').getBoundingClientRect();
                return { text: e.textContent, bottom: Math.round(r.bottom), tab: Math.round(document.querySelector('.tabbar').getBoundingClientRect().top), mapTop: Math.round(m.top), fs: parseFloat(getComputedStyle(e).fontSize) }; }""")
            # le dessin commence à l'écran : sur iPhone SE en AX33, le corps entier ne tient pas avec les deux lignes
            R.check(sh and sh['text'].startswith('Qui aident : ') and sh['bottom'] < sh['tab'] and sh['mapTop'] < sh['tab'] and sh['fs'] <= 17,
                    f'{t} {name}, texte très grand : « Qui aident » visible sans défiler, le haut du dessin aussi {sh}')
            R.check(geo['bottom'] < geo['tab'] and geo['top'] >= geo['nav'] - 1 and geo['above'] and geo['h'] >= 230 and geo['views'] == want,
                    f'{t} {name}, texte très grand : nom du ciblé au-dessus du dessin et de la barre d\'onglets, personnage de 230 points au moins {geo}')
            # Agrandir centré sous le dessin, même plus large qu'une seule vue (panel atlas-bas t4 : décalé à droite, abducteurs)
            dx = page.evaluate("""() => { const z = document.querySelector('.mpanel__zoom').getBoundingClientRect(), m = document.querySelector('.mpanel__map').getBoundingClientRect();
                return Math.round((z.left + z.right) / 2 - (m.left + m.right) / 2); }""")
            R.check(abs(dx) <= 2, f'{t} {name}, texte très grand : Agrandir centré sous le dessin (écart {dx} pt)')
            shot(page, LOT, f'fiche-xl-{name.split()[0].lower()}-{t}')
        R.check(not page.errors, f'{t} autres fiches : aucune erreur JS {page.errors}')


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
        R.check(page.locator('.mcard .body-map--atlas[data-tiers="1"]').count() == 1, f'{t} Progrès › Muscles : personnage détaillé, par paliers')
        R.check(not page.errors, f'{t} ailleurs : aucune erreur JS {page.errors}')


def t_progres(bench, eng, dev, theme):
    """Progrès › Muscles : travail de la période par sous-muscle (paliers), nom, séries et 3 exercices au toucher, zoom."""
    t = tag(dev, theme)
    with bench.frozen_page(NOW, eng, dev, theme) as page:
        open_app(page, theme)
        page._failed_requests, page._console_errors = [], []
        page.on('requestfailed', lambda q: page._failed_requests.append(f"{q.url.split('/')[-1]} {q.failure}"))
        page.on('console', lambda m: m.type in ('error', 'warning') and page._console_errors.append(m.text[:120]))
        page.click('.tabbar [data-action="go-stats"]')
        page.wait_for_selector('.view.stats .mcard__map.body-map--atlas')
        page.locator('.mcard__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        settle(page)
        # Barre du haut : le grand titre sorti de l'écran, le petit titre « Progrès » s'y affiche (panel t7 : vide en clair)
        nav = page.evaluate("""() => { const v = document.querySelector('.view.stats'), h1 = v.querySelector('.navbar__large'), bar = v.querySelector('.navbar');
            return { gone: h1.getBoundingClientRect().bottom < bar.getBoundingClientRect().bottom, collapsed: bar.classList.contains('navbar--collapsed'),
              title: getComputedStyle(bar.querySelector('.navbar__title')).visibility }; }""")
        R.check(not nav['gone'] or (nav['collapsed'] and nav['title'] == 'visible'), f'{t} barre : petit titre « Progrès » après défilement {nav}')
        lv = page.evaluate("JSON.parse(document.querySelector('.mcard__map').dataset.atlas)")
        expect = page.evaluate("Object.fromEntries(Object.entries(partLoad(muscleSpan).levels).filter(([, l]) => l > 0))")
        R.check(lv == expect and len(lv) > 10, f'{t} paliers par sous-muscle = calcul de la période ({len(lv)} sous-muscles)')
        tiers = page.evaluate("[...new Set([...document.querySelectorAll('.mcard__map .body-map__p')].map(l => [...l.classList].find(c => /--t\\d/.test(c))))]")
        R.check(tiers and all(tiers), f'{t} chaque sous-muscle travaillé dans la teinte de son palier {tiers}')
        # Un sous-muscle travaillé : nom, séries de la période, palier, exercices qui l'ont le plus travaillé
        part = page.evaluate("Object.entries(partLoad(muscleSpan).sets).filter(([id]) => !atlasPart(id).deep).sort((a, b) => b[1] - a[1])[0][0]")
        view = page.evaluate(f"BODY_PARTS.boxes[bodySilhouette()].front[{json.dumps(part)}] ? 'front' : 'back'")
        tap(page, part_point(page, '.mcard__map', part, view))
        wait_or_say(page, '.atlas-info', 'attente 1')
        settle(page)
        txt = tip_text(page)
        title = page.evaluate(f"atlasPartTitle({json.dumps(part)})")
        R.check(txt.startswith(title) and 'série' in txt and 'Le plus :' in txt, f'{t} bulle : {part} « {txt} »')
        ok = info_ok(page, '.mcard', ['.mcard__map .body-map__row', '.mcard .mlegend', '.mcard .segmented', '.mcard .mlow'])
        R.check(ok['ok'], f'{t} carte d\'info : sous le dessin, elle ne recouvre rien {ok}')
        n_top = page.evaluate("document.querySelector('.btip__top')?.textContent.replace('Le plus : ', '').split(', ').length || 0")
        R.check(1 <= n_top <= 3, f'{t} bulle : 3 exercices au plus ({n_top})')
        lo = layout_ok(page)
        R.check(not lo, f'{t} Progrès : mise en page {lo}')
        shot(page, LOT, f'progres-nom-{t}')
        # Zoom : double toucher, 3× de la vue, bulle de volume dans la vue agrandie
        page.evaluate('closeBodyTip()')
        # Journal des touchers reçus par la carte (diagnostic d'un échec intermittent du double toucher en CI)
        page.evaluate("""() => { window.__taps = []; const orig = atlasTap; let n = 0; const ids = new WeakMap();
            window.atlasTap = function (e, el) { if (!ids.has(el)) ids.set(el, ++n);
              window.__taps.push({ el: ids.get(el), ts: Math.round(e.timeStamp), now: Math.round(performance.now()), last: atlasLastTap && { t: Math.round(atlasLastTap.t), el: ids.get(atlasLastTap.el) || 'autre', x: Math.round(atlasLastTap.x) }, x: Math.round(e.clientX) });
              return orig.call(this, e, el); }; }""")
        tap(page, part_point(page, '.mcard__map', part, view), double=True)
        wait_or_say(page, '.azoom', 'attente 2 (double toucher)')
        settle(page)
        R.check(page.evaluate('atlasViewerState().scale') == 1, f'{t} vue agrandie : ouverte sur le personnage entier')
        tap(page, part_point(page, '.azoom', part, view), double=True, touch=True)
        page.wait_for_function("() => atlasViewerState()?.hi", timeout=10000)
        settle(page)
        R.check(page.evaluate("[...document.querySelectorAll('.azoom .body-map__p')].every(l => /--t\\d/.test(l.className))"), f'{t} vue agrandie : paliers gardés')
        # Légende de la vue agrandie : les noms de la page (panel affichage-e t3 : 4 carrés sans nom)
        leg = ' '.join(page.inner_text('.azoom__legend').split())
        R.check(all(w in leg for w in ('Pas travaillé', 'Sous l\'objectif', 'Objectif atteint')), f'{t} vue agrandie : légende nommée « {leg} »')
        # Retour à ×1 (boutons −) : le muscle est à l'écran sur tous les téléphones, puis toucher
        for _ in range(3):
            if page.evaluate('atlasViewerState().scale') > 1:
                page.click('.azoom__btn[data-z="-1"]')
                page.wait_for_timeout(400)
        settle(page)
        tap(page, part_point(page, '.azoom', part, view), touch=True)
        wait_or_say(page, '.sheet-root--atlas .atlas-info', 'attente 3')
        R.check('série' in tip_text(page), f'{t} vue agrandie : séries au toucher « {tip_text(page)} »')
        shot(page, LOT, f'progres-zoom-{t}')
        page.click('.sheet-root--atlas .sheet__btn--confirm')
        page.wait_for_selector('.azoom', state='detached', timeout=3000)
        # Période : « Cette semaine » recalcule les paliers
        seg = page.locator('.mcard [data-action="muscle-span"]')
        if seg.count() > 1:
            seg.nth(0).click()
            settle(page)
            lv2 = page.evaluate("JSON.parse(document.querySelector('.mcard__map').dataset.atlas)")
            R.check(lv2 == page.evaluate("Object.fromEntries(Object.entries(partLoad(muscleSpan).levels).filter(([, l]) => l > 0))"), f'{t} période changée : paliers recalculés')
        # « À travailler » (panel affichage-e t4) : exactement les muscles gris ou rouge pâle du dessin, du moins au plus travaillé
        if seg.count() > 1:
            seg.nth(1).click()   # 4 semaines (cette semaine, le lundi : aucune séance, pas de liste)
            settle(page)
        items = page.evaluate("atlasToWork(partLoad(muscleSpan)).map(it => it.label)")
        names = [n.strip() for n in page.locator('.mcard .mlow .mlow__name').all_inner_texts()]
        # Pastille d'état devant chaque nom : grise à 0 série (en premier), rose pâle sous l'objectif
        dots = page.evaluate("[...document.querySelectorAll('.mcard .mlow .mlow__name')].map(b => [b.querySelector('.mlegend__dot--t1') ? 1 : 0, atlasToWork(partLoad(muscleSpan)).find(x => x.key === b.dataset.muscle).sets > 0 ? 1 : 0])")
        R.check(dots and all(a == b for a, b in dots) and [d for d, _ in dots] == sorted(d for d, _ in dots), f'{t} À travailler : pastille grise (0 série, en premier) ou pâle {dots}')
        R.check(page.locator('.mcard .cell__title', has_text='À travailler').count() == 1 and names == items[:3]
                and (len(items) <= 3 or page.locator('.mcard .mlow__more').inner_text() == f'+ {len(items) - 3} autre{"s" if len(items) > 4 else ""}'),
                f'{t} À travailler : muscles de salle {names} sur {len(items)}')
        if names:
            # Toucher un nom : ses sous-muscles gris ou pâles mis en valeur, les autres calques effacés, détail dans la bulle
            first = page.evaluate("atlasToWork(partLoad(muscleSpan))[0]")
            page.locator('.mcard .mlow__name').first.click()
            wait_or_say(page, '.atlas-info', 'attente 4')
            settle(page)
            iso = page.evaluate("""() => { const m = document.querySelector('.mcard__map');
                return { iso: m.dataset.iso, marks: [...m.querySelectorAll('.body-map__isomark')].map(e => e.dataset.ol).sort(),
                  on: [...m.querySelectorAll('.body-map__p')].filter(l => getComputedStyle(l).opacity !== '0').map(l => l.dataset.part).sort() }; }""")
            want = sorted(first['ids'])
            R.check(iso['iso'] == 'load' and sorted(set(iso['marks'])) == want and all(p in want for p in iso['on']),
                    f'{t} À travailler : « {first["label"]} » isolé sur le personnage {iso}')
            tip = tip_text(page)
            if first['sets']:
                R.check(tip.startswith(first['label']) and all(page.evaluate(f"atlasPartTitle({json.dumps(i)})") in tip for i in first['ids'][:3]),
                        f'{t} À travailler : la carte détaille les sous-muscles « {tip[:160]} »')
            else:   # tout le groupe à 0 (panel atlas-bas t4) : une seule ligne, pas « aucune série » par sous-muscle
                R.check(tip.count('aucune série') == 1 and f"{first['label']} : aucune série" in tip and page.locator('.atlas-info .btip__level').count() == 1,
                        f'{t} À travailler : « {first["label"]} : aucune série » en une ligne « {tip[:160]} »')
            R.check(page.get_attribute('.mcard .mlow__name', 'aria-pressed') == 'true' and page.locator('.mcard .mlow__reset').count() == 1,
                    f'{t} À travailler : nom isolé surligné, « Tout afficher » à côté')
            ok = info_ok(page, '.mcard', ['.mcard__map .body-map__row', '.mcard .mlegend', '.mcard .mlow'])
            R.check(ok['ok'], f'{t} À travailler : carte d\'info sous le dessin, elle ne recouvre rien {ok}')
            shot(page, LOT, f'progres-a-travailler-{t}')
            # « Tout afficher »
            page.evaluate("document.querySelector('.mcard .mlow__reset').click()")
            settle(page)
            R.check(page.get_attribute('.mcard .mlow__name', 'aria-pressed') == 'false' and page.locator('.mcard .mlow__reset').count() == 0, f'{t} À travailler : « Tout afficher » rend la liste')
            R.check(page.evaluate("!document.querySelector('.mcard__map').dataset.iso && !document.querySelector('.body-map__isomark') && !document.querySelector('.atlas-info')"),
                    f'{t} À travailler : « Tout afficher », dessin entier')
        if len(items) > 3:
            page.click('.mcard .mlow__more')
            settle(page)
            R.check([n.strip() for n in page.locator('.mcard .mlow .mlow__name').all_inner_texts()] == items and page.locator('.mcard .mlow__more').inner_text() == 'Moins',
                    f'{t} À travailler : « + N autres » déplie la liste entière')
            page.click('.mcard .mlow__more')
            settle(page)
            R.check(page.locator('.mcard .mlow .mlow__name').count() == 3, f'{t} À travailler : « Moins » la replie')
        # Mollets à 0 série (panel atlas-bas t4) : la carte dit « Mollets : aucune série » une fois, pas pour chaque sous-muscle
        calf = page.evaluate("""() => { const ids = ['gastro_medial', 'gastro_lateral', 'soleus'], saved = JSON.stringify(data.history);
            const hit = e => { const x = exercisePartRoles(e.name, exerciseMuscles(e)); return [...x.p, ...x.s].some(id => ids.includes(id)); };
            data.history.forEach(h => { h.exercises = (h.exercises || []).filter(e => !hit(e)); }); render();
            const b = document.createElement('button'); b.className = 'mlow__name'; b.dataset.muscle = 'calves'; document.querySelector('.mcard .mlow').append(b);
            atlasToWorkShow(b); b.remove();
            const rows = [...document.querySelectorAll('.atlas-info .btip__level')].map(e => e.textContent.trim());
            closeBodyTip(); atlasToWorkReset(document.querySelector('.mcard')); data.history = JSON.parse(saved); render(); return rows; }""")
        R.check(calf == ['Mollets : aucune série'], f'{t} mollets à 0 série : une seule ligne {calf}')
        settle(page)
        # Muscles à 0 série de la liste : cernés sur le dessin (rien sur la fiche), « Pas travaillé » en rond cerné dans la légende
        zero = sorted(i for it in page.evaluate("atlasToWork(partLoad(muscleSpan)).filter(it => !it.sets)") for i in it['ids'])
        ol = sorted(set(page.evaluate("[...document.querySelectorAll('.mcard__map .body-map__ol')].map(e => e.dataset.ol)")))
        R.check(ol == zero and page.locator('.mcard .mlegend .mlegend__dot--t0').count() >= 1, f'{t} contour des muscles à 0 série {ol} = {zero}')
        # Texte très grand (AX33) sur la vue agrandie : légende repliée, titre sur une ligne, personnage sur 60 % au moins
        page.evaluate("""() => { const h = document.documentElement; h.style.fontSize = '33px'; h.classList.add('type-xl'); render(); }""")
        settle(page)
        # Panel t13 : le dessin juste sous le choix de période, la légende juste sous Face / Dos, une seule liste
        # « À travailler » (3 pastilles, plus de phrase en double)
        xl = page.evaluate("""() => { const seg = document.querySelector('.mcard .segmented').getBoundingClientRect(), box = document.querySelector('.mcard .atlas-box').getBoundingClientRect(),
            leg = document.querySelector('.mcard .mlegend').getBoundingClientRect();
            return { map: Math.round(box.top - seg.bottom), legend: Math.round(leg.top - box.bottom), todo: document.querySelectorAll('.mcard__todo').length,
                     names: document.querySelectorAll('.mcard .mlow > .mlow__name').length }; }""")
        R.check(xl['map'] <= 24 and 0 <= xl['legend'] <= 60 and xl['todo'] == 0 and xl['names'] == min(3, len(items)),
                f'{t} texte très grand : dessin sous la période, légende sous Face / Dos, une liste de 3 noms {xl}')
        page.locator('.mcard__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        page.click('.mcard .mpanel__zoom')
        page.wait_for_selector('.azoom')
        settle(page)
        geo = page.evaluate("""() => { const s = document.querySelector('.sheet-root--atlas .sheet').getBoundingClientRect(), a = document.querySelector('.azoom').getBoundingClientRect(),
            ti = document.querySelector('.sheet-root--atlas .sheet__title'), lh = parseFloat(getComputedStyle(ti).lineHeight) || 1.25 * parseFloat(getComputedStyle(ti).fontSize);
            const line = document.querySelector('.azoom__band > .azoom__legend');
            return { part: Math.round(a.height / s.height * 100), titleLines: Math.round(ti.getBoundingClientRect().height / lh), folded: !!document.querySelector('.azoom__key:not([open])'),
              line: line ? line.textContent.replace(/\\s+/g, ' ').trim() : '' }; }""")
        # Panel t12 : la légende suit le texte agrandi (plafonnée à 21 px), sur deux lignes sur iPhone SE : 55 % au moins
        # (60 % avec la légende en petit, panel t3 : 350 points seulement auparavant)
        R.check(geo['part'] >= 55 and geo['titleLines'] <= 2 and geo['folded'] and all(w in geo['line'] for w in ('Pas travaillé', 'Sous l\'objectif', 'Objectif atteint')),
                f'{t} vue agrandie AX33 : personnage sur 55 % au moins, les 3 états toujours visibles, bornes repliées {geo}')
        page.click('.azoom__sum')
        settle(page)
        R.check('10+' in page.inner_text('.azoom__key') and page.inner_text('.azoom__sum').strip() == 'Masquer la légende', f'{t} vue agrandie AX33 : « Légende » déplie les bornes, puis dit « Masquer la légende »')
        lo = layout_ok(page)
        R.check(not lo, f'{t} vue agrandie AX33 : mise en page {lo}')
        shot(page, LOT, f'progres-zoom-xl-{t}')
        page.click('.sheet-root--atlas .sheet__btn--confirm')
        page.wait_for_selector('.azoom', state='detached', timeout=3000)
        R.check(not page.errors, f'{t} Progrès : aucune erreur JS {page.errors}')


def t_poitrine(bench):
    """Personnage femme, face (panel de l'affiche) : le sein n'est pas un muscle. Calques des pectoraux vides au centre de
    chaque sein, en 1× et en 3× ; carte de toucher : aucun pectoral ; contours effacés. Puis « Développé couché » en
    femme, clair et sombre : le sein reste au gris du corps à l'écran, le pectoral se colore autour."""
    import io
    import sys as _sys
    from PIL import Image
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _sys.path.insert(0, os.path.join(root, 'tools'))
    from importlib import import_module
    gen = import_module('gen-body2')
    d = os.path.join(root, 'img', 'body2', 'female', 'front')
    parts = json.load(open(os.path.join(root, 'tools', 'body2-manifest.json'), encoding='utf-8'))
    ids = [p['id'] for p in parts['parts']]
    boxes = parts['bodies']['female']['front']['parts']
    for cx, cy, _, _ in gen.BREASTS[('female', 'front')]:
        for pid in ('chest_sternal', 'chest_abdominal'):
            b = boxes[pid]
            for res, k in (('p3', 1), ('p', 3)):
                im = Image.open(os.path.join(d, res, f'{pid}.webp')).convert('RGBA')
                x, y = (cx - b[0]) // k if res == 'p3' else cx // 3 - b[0] // 3, (cy - b[1]) // k if res == 'p3' else cy // 3 - b[1] // 3
                inside = 0 <= x < im.width and 0 <= y < im.height
                R.check(not inside or im.getpixel((x, y))[3] == 0, f'femme : {pid} ({res}) vide au centre du sein ({cx}, {cy})')
        hit = Image.open(os.path.join(d, 'hit.png'))
        n = hit.getpixel((cx * hit.width // parts['w3'], cy * hit.height // parts['h3']))
        R.check(n == 0 or ids[n - 1] not in gen.BREAST_PARTS, f'femme : toucher le sein ne nomme aucun pectoral ({n and ids[n - 1]})')
        R.check(Image.open(os.path.join(d, 'lines@3x.webp')).convert('RGBA').getpixel((cx, cy))[3] == 0, 'femme : pas de contour de muscle sur le sein')
    for theme in ('light', 'dark'):
        with bench.frozen_page(NOW, 'webkit', 'iPhone 13', theme) as page:
            open_app(page, theme)
            page.evaluate("() => { data.silhouette = 'female'; }")
            page.evaluate("navigate(makeRoute('library-ex', 'Développé couché barre'))")
            page.wait_for_selector('.view.library-ex .mpanel--atlas')
            page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
            settle(page)
            kind = page.get_attribute('.mpanel__map', 'data-body')
            if kind == 'female':
                pt = page.evaluate("""br => { const b = document.querySelector('.mpanel__map .body-map__front .body-map__body').getBoundingClientRect();
                    return br.map(([cx, cy]) => [b.left + cx / BODY_PARTS.w3 * b.width, b.top + cy / BODY_PARTS.h3 * b.height]); }""",
                                   [[cx, cy] for cx, cy, _, _ in gen.BREASTS[('female', 'front')]])
                img = Image.open(io.BytesIO(page.screenshot())).convert('RGB')
                k = img.width / page.viewport_size['width']
                for x, y in pt:
                    r, g, b = img.getpixel((int(x * k), int(y * k)))
                    R.check(max(r, g, b) - min(r, g, b) < 24, f'femme {theme} : sein au gris du corps à l\'écran ({r}, {g}, {b})')
            R.check(kind == 'female', f'{theme} : personnage femme affiché ({kind})')
            shot(page, LOT, f'poitrine-femme-{theme}')


def t_catalogue(bench):
    """Toute fiche de la bibliothèque a un personnage avec du rouge (atlas, ou carte des 18 muscles en repli), sauf le
    muscle profond seul (vacuum : personnage sans rouge, en tête)."""
    with bench.page('chromium', 'Pixel 7', 'dark') as page:
        open_app(page, 'dark')
        bad = page.evaluate("""() => EXERCISE_CATALOGUE.map(e => {
            const html = libExHeroHtml(e.name) + libExAboutHtml(e, e.name);
            const ok = /class="body-map__m[ "]/.test(html) || (!e.primary.length && /exhero--deep/.test(html));
            return ok ? null : e.name; }).filter(Boolean)""")
        # Image de tête : un muscle entier en rouge plein seulement si le personnage n'en atténue aucun sous-muscle
        hero_bad = page.evaluate("""() => EXERCISE_CATALOGUE.map(e => {
            const m = (libExHeroHtml(e.name).match(/img\\/muscles\\/([a-z_]+)\\.webp/) || [])[1];
            if (!m) return null;
            const lv = exercisePartLevels(e.name, exerciseMuscles({ name: e.name })).levels;
            return atlasPartsOf(m).some(p => lv[p] === 1) ? `${e.name} : ${m}` : null; }).filter(Boolean)""")
        R.check(not hero_bad, f'catalogue : image de tête en contradiction avec le personnage {hero_bad}')
        abd = page.evaluate("libExHeroHtml('Abducteurs machine')")
        R.check('img/muscles/' not in abd and 'body-map--atlas' in abd, 'Abducteurs machine : personnage détaillé en tête, pas l\'image des fessiers en rouge plein')
        n = page.evaluate('EXERCISE_CATALOGUE.length')
        R.check(n >= 190 and not bad, f'catalogue : {n} fiches, sans personnage : {bad}')
        R.check(not page.errors, f'catalogue : aucune erreur JS {page.errors}')


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
        # Hors ligne, jamais zoomé : zoom puis vue de dos, le personnage reste affiché (1× gardé, rien d'échangé)
        page.evaluate(f"navigate(makeRoute('library-ex', {json.dumps(EX)}))")
        page.wait_for_selector('.mpanel--atlas')
        page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        settle(page)
        page.context.set_offline(True)
        tap(page, part_point(page, '.mpanel__map', 'chest_clavicular'), double=True)
        page.wait_for_selector('.azoom', timeout=5000)
        settle(page)
        page.wait_for_timeout(2500)
        shown = """() => [...document.querySelectorAll('.azoom .body-map__base')].map(i => [i.complete && i.naturalWidth > 0, i.getAttribute('src').endsWith('base.webp')])
            .concat([[document.querySelectorAll('.azoom .body-map__p').length > 0, true]])"""
        st = page.evaluate('atlasViewerState()')
        R.check(st['hi'] == '' and all(a and b for a, b in page.evaluate(shown)), f'hors ligne sans 3× : zoom, personnage au 1× toujours affiché {st} {page.evaluate(shown)}')
        box = page.locator('.azoom').bounding_box()
        for _ in range(2):
            page.mouse.move(box['x'] + box['width'] * 0.9, box['y'] + box['height'] / 2)
            page.mouse.down()
            for k in range(1, 13):
                page.mouse.move(box['x'] + box['width'] * (0.9 - 0.85 * k / 12), box['y'] + box['height'] / 2)
            page.mouse.up()
        page.wait_for_timeout(2500)
        R.check(all(a and b for a, b in page.evaluate(shown)) and page.evaluate('atlasViewerState().hi') == '', f'hors ligne sans 3× : vue de dos, personnage toujours affiché {page.evaluate(shown)}')
        shot(page, LOT, 'hors-ligne-sans-3x')
        page.click('.sheet-root--atlas .sheet__btn--confirm')
        page.wait_for_selector('.azoom', state='detached', timeout=3000)
        page.context.set_offline(False)
        page.evaluate(f"navigate(makeRoute('library-ex', {json.dumps(EX)}))")
        page.wait_for_selector('.mpanel--atlas')
        page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        settle(page)
        tap(page, part_point(page, '.mpanel__map', 'chest_clavicular'), double=True)
        page.wait_for_selector('.azoom', timeout=5000)
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
        page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        settle(page)
        tap(page, part_point(page, '.mpanel__map', 'chest_clavicular'))
        page.wait_for_selector('.atlas-info', timeout=5000)
        R.check('Haut des pectoraux' in tip_text(page), 'hors ligne : nom au toucher (carte de toucher en cache)')
        page.wait_for_timeout(400)
        tap(page, part_point(page, '.mpanel__map', 'chest_clavicular'), double=True)
        try:
            page.wait_for_selector('.azoom', timeout=5000)
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
    run_main(R, [t_fiche, t_pincement, t_autres_fiches, t_ailleurs, t_progres], once=[t_catalogue, t_hors_ligne, t_poitrine])
