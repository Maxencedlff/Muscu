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
        for (const e of document.querySelectorAll('.cell__title, .cell__sub, .mpill, .mline2, .btip p, .azoom__hint'))
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
    for _ in range(2 if double else 1):
        if touch:
            page.touchscreen.tap(*xy)
        else:
            page.mouse.click(*xy)
        page.wait_for_timeout(90)


def tip_place_ok(page, zone, avoid, detail=False):
    """Bulle dans la hauteur de zone, sans toucher les éléments avoid (pastilles, en-tête de la feuille, OK, boutons)."""
    r = page.evaluate("""([zone, avoid]) => { const t = document.querySelector('.btip')?.getBoundingClientRect(), z = document.querySelector(zone)?.getBoundingClientRect();
        if (!t || !z) return { ok: false, why: 'absente' };
        const hit = avoid.filter(s => { const a = document.querySelector(s)?.getBoundingClientRect();
            return a && a.width && t.left < a.right && t.right > a.left && t.top < a.bottom && t.bottom > a.top; });
        return { ok: t.top >= z.top - 1 && t.bottom <= z.bottom + 1 && !hit.length, tip: [t.top | 0, t.bottom | 0], zone: [z.top | 0, z.bottom | 0], hit }; }""", [zone, avoid])
    return r if detail else r['ok']


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
        red = page.evaluate("[getComputedStyle(document.querySelector('.mpanel__map .body-map__p.is-on')).backgroundColor, getComputedStyle(document.querySelector('.mline2__dot--main')).backgroundColor]")
        R.check(red[0] == red[1], f'{t} ligne touchée : ses muscles en rouge plein {red}')
        page.wait_for_timeout(100)
        R.check('muscles qui aident sont affichés' in page.evaluate("document.getElementById('sr-polite')?.textContent || ''"), f'{t} changement annoncé à VoiceOver')
        shot(page, LOT, f'fiche-aident-{t}')
        page.click('.mline2[data-level="1"] .mline2__name[data-label="Triceps"]')
        page.wait_for_timeout(500)
        on = page.evaluate(vis)
        R.check(on and all(p.startswith('triceps') for p in on), f'{t} nom « Triceps » : ce seul muscle {on}')
        page.click('.mline2[data-level="1"] .mline2__name[data-label="Triceps"]')
        page.wait_for_timeout(500)
        R.check(len(page.evaluate(vis)) >= 6 and page.get_attribute('.mline2[data-level="1"]', 'aria-pressed') == 'false', f'{t} toucher de nouveau : tous les muscles reviennent')
        page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        settle(page)
        sub = page.inner_text('.exhead__sub').replace('\xa0', ' ')
        R.check(sub.startswith('Haut des pectoraux') and 'Épaules' not in sub, f'{t} sous le titre : les rangs du personnage « {sub} »')
        off = page.evaluate("""() => { const z = document.querySelector('.mpanel__zoom').getBoundingClientRect(), m = document.querySelector('.mpanel__map .body-map__row').getBoundingClientRect();
            return z.top >= m.bottom || z.bottom <= m.top || z.left >= m.right || z.right <= m.left; }""")
        R.check(off, f'{t} bouton Agrandir hors du dessin')
        z = page.locator('.mpanel__zoom').bounding_box()
        R.check(z and z['width'] >= 44 and z['height'] >= 44, f'{t} bouton Agrandir 44 × 44 {z}')
        page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        settle(page)
        lo = layout_ok(page)
        R.check(not lo, f'{t} fiche : mise en page {lo}')
        shot(page, LOT, f'fiche-{t}')
        # ── Toucher : nom de salle, nom officiel, rôle
        tap(page, part_point(page, '.mpanel__map', 'chest_clavicular'))
        page.wait_for_selector('.btip', timeout=5000)
        settle(page)
        txt = tip_text(page)
        R.check('Haut des pectoraux' in txt and 'Pectoralis major, pars clavicularis' in txt and 'Muscle ciblé' in txt,
                f'{t} toucher : nom de salle (celui de la pastille), latin, rôle « {txt} »')
        R.check(tip_place_ok(page, '.mpanel__map .body-map__row', ['.mpanel__foot', '.mline2']), f'{t} toucher : bulle dans le dessin, ni sur les pastilles ni sur Agrandir {tip_place_ok(page, ".mpanel__map .body-map__row", [".mpanel__foot", ".mline2"], True)}')
        R.check(page.locator('.mpanel__map .body-map__hl[data-part="chest_clavicular"]').count() == 1, f'{t} toucher : sous-muscle mis en valeur')
        shot(page, LOT, f'fiche-nom-{t}')
        tap(page, part_point(page, '.mpanel__map', 'triceps_lateral', 'back'))
        page.wait_for_timeout(400)
        txt = tip_text(page)
        R.check('Triceps, chef latéral' in txt and 'Muscle qui aide' in txt, f'{t} toucher du triceps : qui aide « {txt} »')
        page.wait_for_timeout(400)
        # ── Double toucher : vue agrandie, zoomée, 3× de la face seulement
        hi_urls = []
        page.on('request', lambda q: re.search(HI_RE, q.url) and hi_urls.append(q.url.split('/img/', 1)[1]))
        tap(page, part_point(page, '.mpanel__map', 'chest_clavicular'), double=True)
        page.wait_for_selector('.azoom', timeout=5000)
        page.wait_for_function("() => atlasViewerState()?.hi === 'front' && atlasViewerState().lines === 'front'", timeout=10000)
        settle(page)
        st = page.evaluate('atlasViewerState()')
        R.check(abs(st['scale'] - 2.5) < 0.05, f'{t} double toucher : zoom ×2,5 {st}')
        R.check(hi_urls and all('/front/' in u for u in hi_urls) and not any('/back/' in u for u in hi_urls), f'{t} 3× de la face seulement {hi_urls}')
        R.check(page.evaluate("document.querySelector('.azoom .body-map__front .body-map__base').src.endsWith('base@3x.webp')"), f'{t} base 3× affichée')
        R.check(page.locator('.azoom .body-map__front [data-part="chest_clavicular"]').count() == 1
                and 'p3/' in page.evaluate("document.querySelector('.azoom .body-map__front [data-part=\"chest_clavicular\"]').style.backgroundImage"),
                f'{t} sous-muscles 3× recadrés')
        R.check(not page.locator('.azoom .body-map__front .azoom__lines').evaluate('e => e.hidden'), f'{t} contours des sous-muscles au-delà de ×2')
        shot(page, LOT, f'zoom-{t}')
        tap(page, part_point(page, '.azoom', 'chest_clavicular'), touch=True)
        page.wait_for_selector('.sheet-root--atlas .btip', timeout=5000)
        settle(page)
        txt = tip_text(page)
        R.check('Haut des pectoraux' in txt and 'Pectoralis major' in txt, f'{t} vue agrandie : nom au toucher « {txt} »')
        R.check(tip_place_ok(page, '.azoom', ['.sheet-root--atlas .sheet__bar', '.azoom__ctl']),
                f'{t} vue agrandie : bulle dans la feuille modale, sous l\'en-tête et OK {tip_place_ok(page, ".azoom", [".sheet-root--atlas .sheet__bar", ".azoom__ctl"], True)}')
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
        # Boutons + et − (VoiceOver, contacteur) : 44 pt, zoom et retour
        bx = page.locator('.azoom__btn').evaluate_all("bs => bs.map(b => { const r = b.getBoundingClientRect(); return [b.getAttribute('aria-label'), r.width >= 44 && r.height >= 44, b.disabled]; })")
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
        page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
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
        for name, crop, first, view, part in [('Abducteurs machine', '302,602', [['Moyen fessier', 2], ['Grand fessier', 1]], 'back', 'glute_med'),
                                              ('Tractions pronation', '0,450', [['Grand dorsal', 2], ['Grand rond', 2]], 'back', 'lats')]:
            page.evaluate(f"navigate(makeRoute('library-ex', {json.dumps(name)}))")
            page.wait_for_selector('.view.library-ex .mpanel--atlas')
            page.locator('.mpanel__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
            settle(page)
            slug = name.split()[0].lower()
            R.check(page.get_attribute('.mpanel__map', 'data-crop') == crop, f'{t} {name} : cadrage {page.get_attribute(".mpanel__map", "data-crop")}')
            lines = page.evaluate("""[...document.querySelectorAll('.group:has(.mpanel--atlas) .mline2')].map(b => [b.querySelector('.cell__sub').textContent, [...b.querySelectorAll('.mline2__names .mline2__name')].map(n => n.textContent), b.dataset.level | 0])""")
            flat = [[n, lv] for _, names, lv in lines for n in names]
            R.check(flat[:2] == first, f'{t} {name} : lignes {lines}')
            tap(page, part_point(page, '.mpanel__map', part, view))
            page.wait_for_selector('.btip', timeout=5000)
            settle(page)
            R.check(tip_text(page).startswith(first[0][0]), f'{t} {name} : bulle « {tip_text(page)} »')
            # Pointe vers le doigt, bulle contre lui (au plus 3 écarts de 14 points) : jamais partie dans un coin de l'autre vue
            side = page.evaluate("""([x, y]) => { const t = document.querySelector('.btip'), r = t.getBoundingClientRect();
                const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
                return [!t.classList.contains('btip--free'), Math.round(Math.hypot(dx, dy)) <= 42]; }""", part_point(page, '.mpanel__map', part, view))
            R.check(all(side), f'{t} {name} : bulle avec pointe, contre le muscle touché {side}')
            R.check(tip_place_ok(page, '.mpanel__map .body-map__row', ['.mpanel__foot', '.mline2']), f'{t} {name} : place de la bulle {tip_place_ok(page, ".mpanel__map .body-map__row", [".mpanel__foot", ".mline2"], True)}')
            lo = layout_ok(page)
            R.check(not lo, f'{t} {name} : mise en page {lo}')
            shot(page, LOT, f'fiche-{slug}-{t}')
            page.evaluate('closeBodyTip()')
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
        page.click('.tabbar [data-action="go-stats"]')
        page.wait_for_selector('.view.stats .mcard__map.body-map--atlas')
        page.locator('.mcard__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        settle(page)
        lv = page.evaluate("JSON.parse(document.querySelector('.mcard__map').dataset.atlas)")
        expect = page.evaluate("Object.fromEntries(Object.entries(partLoad(muscleSpan).levels).filter(([, l]) => l > 0))")
        R.check(lv == expect and len(lv) > 10, f'{t} paliers par sous-muscle = calcul de la période ({len(lv)} sous-muscles)')
        tiers = page.evaluate("[...new Set([...document.querySelectorAll('.mcard__map .body-map__p')].map(l => [...l.classList].find(c => /--t\\d/.test(c))))]")
        R.check(tiers and all(tiers), f'{t} chaque sous-muscle travaillé dans la teinte de son palier {tiers}')
        # Un sous-muscle travaillé : nom, séries de la période, palier, exercices qui l'ont le plus travaillé
        part = page.evaluate("Object.entries(partLoad(muscleSpan).sets).filter(([id]) => !ATLAS_SIMPLE_MUSCLES.has(atlasPart(id).parent) && !atlasPart(id).deep).sort((a, b) => b[1] - a[1])[0][0]")
        view = page.evaluate(f"BODY_PARTS.boxes[bodySilhouette()].front[{json.dumps(part)}] ? 'front' : 'back'")
        tap(page, part_point(page, '.mcard__map', part, view))
        page.wait_for_selector('.btip', timeout=5000)
        settle(page)
        txt = tip_text(page)
        title = page.evaluate(f"atlasPartTitle({json.dumps(part)})")
        R.check(txt.startswith(title) and 'série' in txt and 'Le plus :' in txt, f'{t} bulle : {part} « {txt} »')
        n_top = page.evaluate("document.querySelector('.btip__top')?.textContent.replace('Le plus : ', '').split(', ').length || 0")
        R.check(1 <= n_top <= 3, f'{t} bulle : 3 exercices au plus ({n_top})')
        lo = layout_ok(page)
        R.check(not lo, f'{t} Progrès : mise en page {lo}')
        shot(page, LOT, f'progres-nom-{t}')
        # Zoom : double toucher, 3× de la vue, bulle de volume dans la vue agrandie
        page.evaluate('closeBodyTip()')
        tap(page, part_point(page, '.mcard__map', part, view), double=True)
        page.wait_for_selector('.azoom', timeout=5000)
        page.wait_for_function("() => atlasViewerState()?.hi", timeout=10000)
        settle(page)
        R.check(page.evaluate("[...document.querySelectorAll('.azoom .body-map__p')].every(l => /--t\\d/.test(l.className))"), f'{t} vue agrandie : paliers gardés')
        tap(page, part_point(page, '.azoom', part, view), touch=True)
        page.wait_for_selector('.sheet-root--atlas .btip', timeout=5000)
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
        R.check(not page.errors, f'{t} Progrès : aucune erreur JS {page.errors}')


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
        page.wait_for_selector('.btip', timeout=5000)
        R.check('Haut des pectoraux' in tip_text(page), 'hors ligne : nom au toucher (carte de toucher en cache)')
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
    run_main(R, [t_fiche, t_pincement, t_autres_fiches, t_ailleurs, t_progres], once=[t_catalogue, t_hors_ligne])
