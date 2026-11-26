// ═══════════════════════════════════════════════════════════
//  Mise en page tablette (docs/IPAD.md) : qui prend la classe `tablet` (js/ui/tablet.js), feuille css/tablet.css
//  chargée en dernier et entièrement derrière html.tablet (un iPhone n'en prend aucune règle), titres de groupe
//  gardés avec leur groupe dans les deux colonnes.
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 15; SM-X810) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

export default function ({ test, assert, ROOT }) {
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(read('js/ui/tablet.js'), ctx, { filename: 'js/ui/tablet.js' });   // sans document : rien n'est posé
  const tablet = o => vm.runInContext(`tabletDevice(${JSON.stringify(o)})`, ctx);

  test('tablette : iPad (y compris en mode ordinateur, tactile) et tablette Android oui ; iPhone, Android téléphone, ordinateur non', () => {
    assert.equal(tablet({ ua: IPAD, touchPoints: 5 }), true, 'iPad, vue web « mobile »');
    assert.equal(tablet({ ua: MAC, touchPoints: 5 }), true, 'iPadOS en mode ordinateur');
    assert.equal(tablet({ ua: MAC, touchPoints: 0 }), false, 'Mac sans écran tactile');
    assert.equal(tablet({ ua: ANDROID_TAB, touchPoints: 10 }), true, 'tablette Android');
    assert.equal(tablet({ ua: ANDROID_PHONE, touchPoints: 10 }), false, 'téléphone Android');
    assert.equal(tablet({ ua: IPHONE, touchPoints: 5 }), false, 'iPhone (Duo compris : même user agent)');
    assert.equal(tablet({ ua: `${IPHONE} iPad`, touchPoints: 5 }), false, 'un iPhone ne devient jamais tablette');
    assert.equal(tablet({}), false, 'rien de connu');
  });

  test('tablette : css/tablet.css chargée après toutes les autres feuilles, dans le cache hors ligne, chaque règle derrière html.tablet', () => {
    const html = read('index.html');
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map(m => m[1]);
    assert.equal(sheets.at(-1), 'css/tablet.css', 'dernière feuille : elle l\'emporte sur la colonne de 640 de navigation.css');
    assert.ok(html.indexOf('js/ui/tablet.js') > html.indexOf('js/ui/theme.js') && html.indexOf('js/ui/tablet.js') < html.indexOf('js/ui/router.js'),
      'js/ui/tablet.js chargé avant le routeur (classe posée avant le premier dessin)');
    const sw = read('sw.js');
    assert.ok(sw.includes("'/css/tablet.css'") && sw.includes("'/js/ui/tablet.js'"), 'dans ASSETS de sw.js');
    const css = read('css/tablet.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/([^{}@]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(s => s && !/^(from|to|\d)/.test(s));
    assert.ok(selectors.length > 10, 'règles lues');
    // Sélecteurs de premier niveau (virgules hors parenthèses, :is() imbriqués compris)
    const split = sel => { const out = ['']; let depth = 0; for (const ch of sel) { depth += ch === '(' ? 1 : ch === ')' ? -1 : 0; if (ch === ',' && !depth) out.push(''); else out[out.length - 1] += ch; } return out; };
    for (const sel of selectors) for (const part of split(sel)) {
      assert.match(part.trim(), /^html\.tablet\b/, `règle hors de html.tablet : « ${part.trim()} »`);
    }
  });

  test('tablette : un titre de groupe et son groupe (avec sa note) dans un même bloc, seulement sur une tablette', () => {
    // DOM minimal : assez pour tabletAfterRender (children, matches, before, append)
    class El {
      constructor(tag, cls = '') { this.tag = tag; this.className = cls; this.children = []; this.parentElement = null; }
      get nextElementSibling() { const p = this.parentElement; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
      matches(sel) { return sel.split(',').some(s => { s = s.trim(); return s.startsWith('.') ? this.className.split(' ').includes(s.slice(1)) : s === this.tag; }); }
      remove() { const p = this.parentElement; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; } }
      before(n) { n.remove(); const p = this.parentElement; p.children.splice(p.children.indexOf(this), 0, n); n.parentElement = p; }
      append(...ns) { for (const n of ns) { n.remove(); this.children.push(n); n.parentElement = this; } }
    }
    const build = () => {
      const scr = new El('div', 'scr');
      scr.append(new El('div', 'group'), new El('div', 'group-title'), new El('div', 'group'), new El('p', 'group-foot'),
        new El('h2', 'group-title'), new El('div', 'group'), new El('div', 'group-title'));
      return scr;
    };
    const run = (isTablet, scr) => {
      const c = vm.createContext({ document: { documentElement: { classList: { contains: k => k === 'tablet' && isTablet, toggle() {} } },
        createElement: tag => new El(tag) } });
      vm.runInContext(read('js/ui/tablet.js'), c);
      c.root = { querySelectorAll: () => [scr] };
      vm.runInContext('tabletAfterRender(root)', c);
      return scr.children.map(e => e.className === 'tablet-keep' ? `[${e.children.map(x => x.className).join(' + ')}]` : e.className);
    };
    assert.deepEqual(run(true, build()), ['group', '[group-title + group + group-foot]', '[group-title + group]', 'group-title'],
      'titres regroupés avec leur groupe et sa note ; un titre sans rien après reste seul');
    assert.deepEqual(run(false, build()), ['group', 'group-title', 'group', 'group-foot', 'group-title', 'group', 'group-title'],
      'iPhone : HTML inchangé');
  });
}
