"""Lot 2 : système de design (tokens, contrôles iOS, icônes, formats français)."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import *  # noqa

LOT = 2
R = Results(LOT)
APP_DIR = os.environ.get('PPL_APP_DIR', '/mnt/c/Users/maxde/ppl-training')  # Fusion : dépôt principal

SPRITE = ['chevron.left', 'chevron.right', 'chevron.down', 'pencil', 'trash', 'timer', 'plus', 'minus', 'xmark',
          'checkmark', 'arrow.clockwise', 'line.3.horizontal', 'flame', 'chart', 'ellipsis', 'gear', 'dumbbell',
          'clock.history', 'list.bullet']

# Mesure du contraste WCAG de chaque texte visible (fond = superposition des fonds des ancêtres)
AUDIT_JS = r"""() => {
  const parse = s => {
    if (!s || s === 'transparent') return [0, 0, 0, 0];
    let m = s.match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = s.match(/color\(srgb ([^)]+)\)/);
    if (m) { const p = m[1].split(/[ \/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    return null;
  };
  const over = (f, b) => { const a = f[3]; return [f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a), 1]; };
  const lum = c => { const ch = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    return .2126 * ch(c[0]) + .7152 * ch(c[1]) + .0722 * ch(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const bodyBg = parse(getComputedStyle(document.body).backgroundColor);
  const bgOf = el => {
    const layers = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let base = [bodyBg[0], bodyBg[1], bodyBg[2], 1];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const inactive = el => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.matches('[aria-hidden="true"], [disabled], canvas, .cat-badge, .toast, .timer-flash')) return true;
      const cs = getComputedStyle(e);
      if (parseFloat(cs.opacity) < 1 || cs.visibility === 'hidden' || cs.display === 'none') return true;
    }
    return false;
  };
  const fails = [], decimals = [], emojis = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const txt = n.nodeValue.trim();
    if (!txt) continue;
    const el = n.parentElement;
    if (seen.has(el) || el.closest('input, textarea, select, option')) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || inactive(el)) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const col = over(fg, bg);
    const size = parseFloat(cs.fontSize), w = parseInt(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && w >= 700);
    const cr = ratio(col, bg);
    if (cr < (large ? 3 : 4.5)) fails.push(`${(el.className && el.className.baseVal === undefined ? el.className : el.tagName)} « ${txt.slice(0, 30)} » ${cr.toFixed(2)}`);
    if (/\d\.\d/.test(txt)) decimals.push(`${el.className} « ${txt.slice(0, 40)} »`);
  }
  document.querySelectorAll('#app button').forEach(b => {
    // Les emojis choisis pour les séances Perso restent permis dans leur pastille
    const clone = b.cloneNode(true);
    clone.querySelectorAll('.cat-badge--emoji, .custom-session-icon').forEach(x => x.remove());
    // Fusion : les noms saisis pour les séances Perso (« Bras 💥 ») sont des données de l'utilisateur
    let txt = clone.textContent;
    Object.values((typeof data !== 'undefined' && data && data.customSessions) || {}).forEach(c => { txt = txt.split(c.label).join(''); });
    if (/\p{Extended_Pictographic}/u.test(txt)) emojis.push(`${b.className} « ${b.textContent.trim().slice(0, 30)} »`);
  });
  return { fails, decimals, emojis };
}"""


def go(page, v, extra=''):
    page.evaluate(f"""() => {{ {extra}; if (typeof navigate === 'function') navigate('{v}'); else {{ view = '{v}'; render(); }} }}""")
    page.wait_for_timeout(200)


def audit(page, t, screen):
    a = page.evaluate(AUDIT_JS)
    R.check(not a['fails'], f'{t} {screen} : contraste < 4,5:1 {a["fails"][:6]}')
    R.check(not a['decimals'], f'{t} {screen} : point décimal visible {a["decimals"][:4]}')
    R.check(not a['emojis'], f'{t} {screen} : emoji dans un bouton {a["emojis"][:4]}')
    shot(page, LOT, f'{screen}-{t}')


def t_screens(bench, eng, dev, theme):
    with bench.page(eng, dev, theme) as page:
        seed(page, theme, ppl_v2_today_json())
        t = f'{dev}-{theme}'
        page.wait_for_timeout(300)
        audit(page, t, 'accueil')
        # Thème : theme-color calé sur --bg
        tc = page.evaluate("document.querySelector('meta[name=theme-color]').content")
        R.check(tc.upper() == ('#000000' if theme == 'dark' else '#F2F2F7'), f'{t} theme-color = --bg ({tc})')
        bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
        R.check(bg == ('rgb(0, 0, 0)' if theme == 'dark' else 'rgb(242, 242, 247)'), f'{t} fond --bg ({bg})')

        go(page, 'settings')
        audit(page, t, 'reglages')
        rows = page.evaluate("""() => [...document.querySelectorAll('.setting-row')].map(r => {
            // Fusion : Réglages réorganisés en cellules par le lot 5 (.cell__title)
            const lab = r.querySelector('.setting-label, .cell__title') || r; const lh = parseFloat(getComputedStyle(lab).lineHeight) || 22;
            return { h: r.getBoundingClientRect().height, lines: Math.round(lab.getBoundingClientRect().height / lh),
                     over: r.scrollWidth > r.clientWidth + 1, txt: lab.textContent.trim() }; })""")
        R.check(rows and all(r['h'] >= 44 for r in rows), f'{t} réglages : rangées >= 44 px {[(r["txt"], r["h"]) for r in rows if r["h"] < 44]}')
        R.check(all(r['lines'] <= 1 and not r['over'] for r in rows), f'{t} réglages : aucune ligne coupée {[r["txt"] for r in rows if r["lines"] > 1 or r["over"]]}')
        seg = page.evaluate("""() => [...document.querySelectorAll('.segmented__btn')].map(b => [b.getAttribute('aria-pressed'), b.classList.contains('segmented__btn--active')])""")
        R.check(seg and all((a == 'true') == act for a, act in seg), f'{t} segmenté : aria-pressed cohérent {seg}')
        sw = page.evaluate("""() => [...document.querySelectorAll('[role=switch]')].map(b => { const r = b.querySelector('.switch').getBoundingClientRect(); return [b.getAttribute('aria-checked'), r.width, r.height]; })""")
        R.check(len(sw) == 2 and all(w == 51 and h == 31 and a in ('true', 'false') for a, w, h in sw), f'{t} interrupteurs 51×31 role=switch {sw}')
        rest = page.locator('[data-action="setting-rest"] .setting-value, [data-action="setting-rest"] .cell__value').inner_text().strip()
        R.check(rest == '1:30', f'{t} repos affiché « 1:30 » ({rest})')
        # Basculer le thème depuis les réglages
        other = 'light' if theme == 'dark' else 'dark'
        page.click(f'[data-action="set-theme"][data-val="{other}"]')
        page.wait_for_timeout(150)
        tc2 = page.evaluate("document.querySelector('meta[name=theme-color]').content")
        R.check(tc2.upper() == ('#000000' if other == 'dark' else '#F2F2F7'), f'{t} theme-color suit le thème ({tc2})')
        page.click(f'[data-action="set-theme"][data-val="{theme}"]')
        page.wait_for_timeout(150)

        go(page, 'history')
        audit(page, t, 'historique')
        go(page, 'stats', "statsView = 'progress'")
        page.wait_for_timeout(200)
        audit(page, t, 'progres')
        go(page, 'stats-overview')  # Fusion : Vue d'ensemble = écran empilé (lot 5)
        audit(page, t, 'ensemble')
        yb = page.evaluate("""() => [...document.querySelectorAll('[data-action=ov-month]')].map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; })""")
        R.check(len(yb) == 2 and all(w >= 44 and h >= 44 for w, h in yb), f'{t} boutons de mois 44×44 {yb}')
        go(page, 'programmes')
        audit(page, t, 'programmes')
        go(page, 'editor')
        audit(page, t, 'editeur')
        go(page, 'addSession')
        audit(page, t, 'ajout-seance')
        # Séance : une série validée, repos en mini-barre
        go(page, 'dashboard')
        page.click('[data-action="start-session"][data-cat="push"]')
        page.wait_for_selector('.view.session')
        page.locator('[data-action="validate-set"]').first.click()
        page.wait_for_timeout(200)
        if page.locator('.rest-minimize-btn').count():
            page.click('.rest-minimize-btn'); page.wait_for_timeout(150)
        audit(page, t, 'seance')
        mini = page.locator('.rest-mini__timer')
        if mini.count():
            R.check(re.fullmatch(r'\d:\d\d', mini.inner_text().strip()) is not None, f'{t} repos au format m:ss ({mini.inner_text()})')
        R.check(not page.errors, f'{t} aucune erreur JS {page.errors}')


def t_custom_colors(bench, eng, dev, theme):
    """Un ancien ppl_v2 avec une séance Perso en hex garde sa couleur ; pastilles des séances intégrées."""
    if theme != 'dark' or dev not in ('iPhone 13', 'Pixel 7'):
        return
    with bench.page(eng, dev, theme) as page:
        d = ppl_v2_today()
        d['activeProgramme'] = 'custom'
        seed(page, theme, json.dumps(d, ensure_ascii=False))
        t = f'{dev}-{theme}'
        c = page.evaluate("""() => { const card = document.querySelector('[style*="--cat-color"]');
            return card ? getComputedStyle(card).getPropertyValue('--cat-color').trim() : null; }""")
        R.check(c and c.lower() == '#ec4899', f'{t} séance Perso : couleur d\'origine conservée ({c})')
        R.check(page.locator('.cat-badge--emoji', has_text='💥').count() >= 1, f'{t} séance Perso : emoji dans sa pastille')
        shot(page, LOT, f'accueil-perso-{t}')
        page.evaluate("data.activeProgramme = 'ppl'; render()")
        page.wait_for_timeout(150)
        badges = page.evaluate("""() => [...document.querySelectorAll('.view.dashboard .cat-badge')  /* Fusion : accueil du lot 3 */].map(b => {
            const r = b.getBoundingClientRect(); return [b.textContent, r.width, r.height, getComputedStyle(b).backgroundColor]; })""")
        R.check([b[0] for b in badges] == ['P', 'P', 'L'] and all(b[1] == 28 and b[2] == 28 for b in badges), f'{t} pastilles 28 px avec initiale {badges}')
        cols = [b[3] for b in badges]
        R.check(cols == ['rgb(255, 159, 10)', 'rgb(94, 92, 230)', 'rgb(64, 200, 224)'], f'{t} Push orange, Pull indigo, Legs teal {cols}')
        R.check(not page.errors, f'{t} perso : aucune erreur JS {page.errors}')


def once_static(bench):
    css = open(os.path.join(APP_DIR, 'style.css'), encoding='utf-8').read()
    # Couleurs en dur seulement dans les blocs de tokens (:root et body.light du début du fichier)
    body = css[css.index('/* Matériaux translucides'):]
    hexes = re.findall(r'#[0-9a-fA-F]{3,8}\b', body)
    rgb = re.findall(r'rgba?\([^)]*\)', body)
    R.check(not hexes and not rgb, f'style.css : couleurs en dur hors tokens {hexes[:5]} {rgb[:5]}')
    sizes = re.findall(r'font-size:\s*(\d+)px', css.replace('html { height: 100%; font-size: 17px; }', ''))
    R.check(not sizes, f'style.css : tailles de police en px {sizes[:5]}')
    js = open(os.path.join(APP_DIR, 'app.js'), encoding='utf-8').read()
    prog = js[js.index('const PROGRAMMES'):js.index('custom: {', js.index('const PROGRAMMES'))]
    R.check(not re.search(r"color: '#", prog), 'PROGRAMMES : couleurs en tokens')
    styl = [m for m in re.findall(r'style="[^"]*#[0-9a-fA-F]{3,6}[^"]*"', js)]
    R.check(not styl, f'app.js : couleur hex injectée en style= {styl[:3]}')
    html = open(os.path.join(APP_DIR, 'index.html'), encoding='utf-8').read()
    missing = [n for n in SPRITE if f'id="i-{n}"' not in html]
    R.check(not missing, f'sprite : icônes manquantes {missing}')
    R.check('<title>MDLF Training</title>' in html and 'content="MDLF Training"' in html, 'nom « MDLF Training » dans index.html')
    man = json.load(open(os.path.join(APP_DIR, 'manifest.json'), encoding='utf-8'))
    R.check(man['name'] == 'MDLF Training', f'manifest : {man["name"]}')
    # Formats français
    with bench.page('chromium', 'Pixel 7', 'dark') as page:
        seed(page, 'dark', ppl_v2_today_json())
        f = page.evaluate("""() => ({ n: fmtNum(32.5), n2: fmtNum('1234.5'), r: fmtRest(90), r2: fmtRest(45), r3: fmtRest(600),
            d1: fmtDuration(42 * 60000), d2: fmtDuration(69 * 60000), c: fmtClock(125000),
            t: fmtDate(Date.now()), y: fmtDate(Date.now() - 86400000), o: fmtDate(new Date(2024, 2, 7).getTime()),
            v: fmtVolume(12345), ic: icon('trash') })""")
        R.check(f['n'] == '32,5', f'fmtNum 32,5 ({f["n"]})')
        R.check(f['n2'].replace('\u202f', ' ').replace('\xa0', ' ') == '1 234,5', f'fmtNum milliers ({f["n2"]!r})')
        R.check((f['r'], f['r2'], f['r3']) == ('1:30', '0:45', '10:00'), f'fmtRest {f["r"]} {f["r2"]} {f["r3"]}')
        R.check(f['d1'].replace('\xa0', ' ') == '42 min' and f['d2'].replace('\xa0', ' ') == '1 h 09', f'fmtDuration {f["d1"]!r} {f["d2"]!r}')
        R.check(f['c'] == '2:05', f'fmtClock m:ss sans zéro devant ({f["c"]})')
        R.check(f['t'] == "Aujourd'hui" and f['y'] == 'Hier' and '2024' in f['o'], f'fmtDate {f["t"]} / {f["y"]} / {f["o"]}')
        R.check(f['v'] == '12,3 t', f'fmtVolume ({f["v"]})')
        R.check('aria-hidden="true"' in f['ic'] and '#i-trash' in f['ic'], f'icon() ({f["ic"]})')
        R.check(page.evaluate("document.querySelector('#i-trash') !== null"), 'sprite chargé dans la page')


run_main(R, [t_screens, t_custom_colors], once=[once_static])
