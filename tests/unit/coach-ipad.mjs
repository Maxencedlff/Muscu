// ═══════════════════════════════════════════════════════════
//  Mode coach grand écran (iPad, tablettes ; docs/COACH_IPAD.md) : règles de js/data/coach-desk.js, page embarquée
//  (scripts/embed-coach-web.mjs), liaison avec l'app (coach-embed/) chargée avec les VRAIS scripts de coach-web, et
//  réglages natifs de l'iPad (projet Xcode, Info.plist, vue web « mobile »).
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { embedHtml, embedPolicy } from '../../scripts/embed-coach-web.mjs';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}

const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; SM-X810) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
// Faux jetons (jamais un vrai) : forme d'un JWT, rien de signé
const FAKE = { access_token: 'faux.jeton-acces.1', refresh_token: 'faux-rafraichissement-1' };   // jetons factices gitleaks:allow

export default function ({ test, assert, ROOT }) {
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

  // ── Règles (js/data/coach-desk.js) ──
  const storage = new MemoryStorage();
  const app = vm.createContext({ localStorage: storage });
  vm.runInContext(read('js/data/coach-desk.js'), app, { filename: 'js/data/coach-desk.js' });
  const run = c => vm.runInContext(c, app);
  const eligible = o => run(`coachDeskEligible(${JSON.stringify(o)})`);

  test('coach iPad : proposé dans l\'app sur iPad dès 768 points, sur tablette dès 900, jamais sur iPhone ni dans le navigateur', () => {
    const ios = { native: true, platform: 'ios' };
    assert.equal(eligible({ ...ios, ua: IPAD, width: 1024 }), true, 'iPad 13 pouces en portrait');
    assert.equal(eligible({ ...ios, ua: IPAD, width: 1366 }), true, 'iPad en paysage');
    assert.equal(eligible({ ...ios, ua: IPAD, width: 820 }), true, 'iPad Air en portrait');
    assert.equal(eligible({ ...ios, ua: IPAD, width: 678 }), false, 'Split View à moitié sur un iPad 11 pouces');
    assert.equal(eligible({ ...ios, ua: IPAD, width: 320 }), false, 'Slide Over');
    assert.equal(eligible({ ...ios, ua: MAC, touchPoints: 5, width: 1024 }), true, 'vue web d\'iPadOS en mode ordinateur');
    assert.equal(eligible({ ...ios, ua: MAC, touchPoints: 0, width: 800 }), false, 'Mac sans toucher, fenêtre étroite');
    assert.equal(eligible({ ...ios, ua: IPHONE, width: 932 }), false, 'iPhone Pro Max couché : rien ne change sur iPhone');
    assert.equal(eligible({ native: true, platform: 'android', ua: ANDROID, width: 1280 }), true, 'tablette Android');
    assert.equal(eligible({ native: true, platform: 'android', ua: ANDROID, width: 800 }), false, 'tablette Android en portrait étroit');
    assert.equal(eligible({ native: false, platform: 'web', ua: IPAD, width: 1366 }), false, 'PWA : la page n\'est pas embarquée');
  });

  test('coach iPad : choix retenu sur l\'appareil (jamais ouvert, déjà ouvert, masqué), valeur inconnue ignorée', () => {
    storage.clear();
    assert.equal(run('coachDeskPref()'), '');
    run("coachDeskSetPref('used')");
    assert.equal(storage.getItem('mdlf_coach_desk'), 'used');
    run("coachDeskSetPref('hidden')");
    assert.equal(run('coachDeskPref()'), 'hidden');
    run("coachDeskSetPref('toujours')");
    assert.equal(run('coachDeskPref()'), 'hidden', 'valeur refusée');
    storage.setItem('mdlf_coach_desk', '<b>');
    assert.equal(run('coachDeskPref()'), '', 'valeur illisible : comme jamais ouvert');
    run("coachDeskSetPref('')");
    assert.equal(storage.getItem('mdlf_coach_desk'), null);
  });

  test('coach iPad : seuls les deux jetons de la session passent au cadre', () => {
    const t = run(`coachDeskTokens({ ...${JSON.stringify(FAKE)}, user: { id: 'u1', email: 'x@exemple.fr' }, expires_at: 1 })`);
    assert.deepEqual(Object.keys(t).sort(), ['access_token', 'refresh_token']);
    assert.equal(run('coachDeskTokens(null)'), null);
    assert.equal(run("coachDeskTokens({ access_token: 'a', refresh_token: '' })"), null);
    assert.equal(run("coachDeskTokens({ access_token: 1, refresh_token: 'r' })"), null);
  });

  // ── Page embarquée (scripts/embed-coach-web.mjs) ──
  const site = read('coach-web/index.html').replaceAll('src="../js/', 'src="js/')
    .replace('<script src="js/desk/env.js"></script>', '<script src="js/vendor/supabase.js"></script>\n  <script src="js/desk/env.js"></script>');
  const policyOf = h => Object.fromEntries(h.match(/Content-Security-Policy" content="([^"]+)"/)[1].split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0]).map(([k, ...v]) => [k, v]));

  test('coach iPad : CSP de la page embarquée, scripts du paquet seulement, images déchiffrées (blob:), aucun cadre', () => {
    const p = policyOf(embedHtml(site));
    const s = policyOf(site);
    assert.deepEqual(p['script-src'], ["'self'"], 'ni Apple JS ni aucun hôte : rien ne vient du site distant');
    assert.ok(s['script-src'].includes('https://appleid.cdn-apple.com'), 'le site garde Apple JS');
    assert.deepEqual(p['img-src'], [...s['img-src'], 'blob:']);
    assert.deepEqual(p['frame-src'], ["'none'"]);
    assert.deepEqual(p['connect-src'], s['connect-src'], 'mêmes connexions que le site (Supabase seulement)');
    for (const k of Object.keys(s)) if (!['script-src', 'img-src'].includes(k)) assert.deepEqual(p[k], s[k], k);
    assert.throws(() => embedPolicy("default-src 'none'; img-src 'self'; frame-src 'self'"), /script-src/);
    assert.throws(() => embedPolicy("script-src 'self'; img-src 'self'; frame-src *"), /frame-src/);
  });

  test('coach iPad : liaison avec l\'app en premier et en dernier, scripts du site dans le même ordre', () => {
    const out = embedHtml(site);
    const srcs = h => [...h.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
    const a = srcs(out);
    assert.equal(a[0], 'js/embed/bridge-start.js');
    assert.equal(a.at(-1), 'js/embed/bridge-end.js');
    assert.deepEqual(a.slice(1, -1), srcs(site));
    assert.ok(out.indexOf('Content-Security-Policy') < out.indexOf('<script'), 'CSP avant le premier script');
    assert.throws(() => embedHtml(site.replace('<script src="js/desk/main.js"></script>', '')), /main\.js/);
  });

  // ── Liaison (coach-embed/) avec les vrais scripts de la page ──
  // Contexte du cadre : bridge-start, les scripts de coach-web/index.html (main.js excepté : démarrage DOM), bridge-end.
  // window.parent : la fenêtre de l'app (même origine, ou autre origine qui refuse la lecture).
  const files = [...read('coach-web/index.html').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => path.normalize(path.join('coach-web', m[1])))
    .filter(f => !f.endsWith('main.js'));
  function frame({ parentWin, clientLog }) {
    const calls = clientLog;
    const listeners = [];
    const auth = {
      setSession: async t => { calls.push(['setSession', t.refresh_token]); return { data: { session: { ...t, user: { id: 'u1' } } }, error: null }; },
      getSession: async () => { calls.push(['getSession']); return { data: { session: null } }; },
      stopAutoRefresh: async () => { calls.push(['stopAutoRefresh']); },
      signOut: async () => { calls.push(['signOut']); return { error: null }; },
      onAuthStateChange: fn => { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    };
    const sandbox = { console, setTimeout, clearTimeout, Intl, atob, btoa, TextEncoder, TextDecoder, crypto: globalThis.crypto,
      localStorage: new MemoryStorage(), navigator: {}, addEventListener() {},
      location: { origin: 'capacitor://localhost' },
      document: { querySelector: () => null, getElementById: () => null, addEventListener() {}, documentElement: { classList: { add() {} } } },
      supabase: { createClient: (url, key, o) => { calls.push(['createClient', o.auth.persistSession, o.auth.storage === undefined]); return { auth, rpc: async () => ({ data: null, error: null }) }; } } };
    sandbox.window = sandbox;
    sandbox.parent = parentWin || sandbox;
    const ctx = vm.createContext(sandbox);
    const load = f => vm.runInContext(read(f), ctx, { filename: f });
    load('coach-embed/bridge-start.js');
    files.forEach(load);
    load('coach-embed/bridge-end.js');
    return { ctx, run: c => vm.runInContext(c, ctx), emit: (ev, s) => listeners.forEach(fn => fn(ev, s)) };
  }
  const flush = () => new Promise(r => setTimeout(r, 0));
  const parentWith = (host, origin = 'capacitor://localhost') => ({ location: { origin }, MDLF_COACH_PARENT: host });

  test('coach iPad : session de l\'app reprise sans écran de connexion ni copie dans le navigateur', async () => {
    const log = [], exits = [];
    const f = frame({ parentWin: parentWith({ session: () => ({ ...FAKE, user: { id: 'u1' } }), exit: () => exits.push(1), onSession() {}, photos: { open() {} } }), clientLog: log });
    assert.equal(f.run('deskHosted()'), true);
    assert.deepEqual(JSON.parse(f.run('JSON.stringify(window.MDLF_COACH_HOST.session)')), FAKE, 'les deux jetons seulement');
    assert.equal(f.run('typeof window.MDLF_COACH_HOST.photos.open'), 'function', 'point d\'accroche des photos');
    const r = await f.run('deskResume()');
    assert.equal(r.ok, true);
    assert.deepEqual(log.find(c => c[0] === 'createClient'), ['createClient', false, true], 'session gardée en mémoire seulement');
    assert.deepEqual(log.find(c => c[0] === 'setSession'), ['setSession', FAKE.refresh_token]);
    assert.equal(f.run('localStorage.length'), 0, 'rien dans le stockage du navigateur');
    assert.equal(f.run('deskIdleFor()'), 0, 'pas de fermeture après 30 min : l\'app décide');
  });

  test('coach iPad : un seul rafraîchisseur (l\'app), jetons renouvelés dans les deux sens, jamais de déconnexion', async () => {
    const log = [], sent = [], exits = [];
    const f = frame({ parentWin: parentWith({ session: () => FAKE, exit: () => exits.push(1), onSession: t => sent.push(t) }), clientLog: log });
    await flush(); await flush();
    assert.ok(log.some(c => c[0] === 'stopAutoRefresh'), 'rafraîchissement automatique arrêté dans le cadre');
    assert.ok(log.findIndex(c => c[0] === 'stopAutoRefresh') > log.findIndex(c => c[0] === 'getSession'), 'arrêté une fois la session initialisée');
    // Jetons renouvelés dans le cadre (sortie de veille) : rendus à l'app, une fois
    const neuf = { access_token: 'faux.jeton-acces.2', refresh_token: 'faux-rafraichissement-2' };   // gitleaks:allow (factice)
    f.emit('TOKEN_REFRESHED', { ...neuf, user: { id: 'u1' } });
    f.emit('TOKEN_REFRESHED', { ...neuf, user: { id: 'u1' } });
    assert.equal(JSON.stringify(sent), JSON.stringify([neuf]));
    f.emit('SIGNED_IN', { ...FAKE });
    assert.equal(sent.length, 1, 'connexion (setSession) : rien à rendre');
    // Jetons renouvelés par l'app : posés dans le cadre
    const app3 = { access_token: 'faux.jeton-acces.3', refresh_token: 'faux-rafraichissement-3' };   // gitleaks:allow (factice)
    assert.equal((await f.run(`MDLF_COACH_EMBED.setSession(${JSON.stringify(app3)})`)).ok, true);
    assert.deepEqual(log.filter(c => c[0] === 'setSession').at(-1), ['setSession', app3.refresh_token]);
    f.emit('SIGNED_IN', { ...app3 });
    assert.equal(sent.length, 1, 'pas d\'écho vers l\'app');
    // « Se déconnecter » : retour à l'app, la session de l'app n'est pas fermée
    await f.run('deskSignOut()');
    assert.equal(log.filter(c => c[0] === 'signOut').length, 0);
    assert.equal(exits.length, 1);
  });

  test('coach iPad : hors de l\'app (site, autre origine), rien n\'est embarqué', () => {
    const cross = { get location() { throw new Error('SecurityError'); } };
    for (const parentWin of [null, cross, parentWith({ session: () => FAKE, exit() {} }, 'https://exemple.fr'), parentWith(null), parentWith({ session: () => FAKE })]) {
      const f = frame({ parentWin, clientLog: [] });
      assert.equal(f.run('typeof window.MDLF_COACH_HOST'), 'undefined');
      assert.equal(f.run('deskHosted()'), false);
      assert.equal(f.run('typeof window.MDLF_COACH_EMBED'), 'undefined');
    }
  });

  // ── iPad dans la build ──
  test('coach iPad : iPhone et iPad dans le projet Xcode (app et Live Activity), la montre inchangée', () => {
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    const fams = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([\w.]+);[\s\S]*?TARGETED_DEVICE_FAMILY = ("1,2"|\d);/g)].map(m => [m[1], m[2]]);
    const by = id => fams.filter(f => f[0] === id).map(f => f[1]);
    assert.deepEqual(by('com.mdlf.training'), ['"1,2"', '"1,2"']);
    assert.deepEqual(by('com.mdlf.training.RestActivity'), ['"1,2"', '"1,2"']);
    assert.ok(!/TARGETED_DEVICE_FAMILY = 1;/.test(pbx), 'plus aucune cible iPhone seul');
    assert.equal((pbx.match(/TARGETED_DEVICE_FAMILY = 4;/g) || []).length, 2, 'Apple Watch');
  });

  test('coach iPad : iPhone en portrait seul, iPad dans les 4 orientations (Split View), une seule fenêtre', () => {
    const plist = read('ios/App/App/Info.plist');
    const arr = key => {
      const m = plist.match(new RegExp(`<key>${key.replace('~', '\\~')}</key>\\s*<array>([\\s\\S]*?)</array>`));
      return m ? [...m[1].matchAll(/<string>([^<]+)<\/string>/g)].map(x => x[1]) : null;
    };
    assert.deepEqual(arr('UISupportedInterfaceOrientations'), ['UIInterfaceOrientationPortrait']);
    assert.deepEqual(arr('UISupportedInterfaceOrientations~ipad').sort(), ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight',
      'UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown']);
    assert.ok(!/UIRequiresFullScreen/.test(plist), 'Split View et Slide Over permis');
    assert.match(plist, /<key>UIApplicationSupportsMultipleScenes<\/key>\s*<false\/>/, 'une seule fenêtre de l\'app (mêmes données)');
    assert.match(plist, /<key>UILaunchStoryboardName<\/key>/, 'écran de lancement en storyboard (exigé pour le multitâche)');
  });

  test('coach iPad : vue web en contenu « mobile », réglée dans le code natif et pas dans capacitor.config.json', () => {
    const swift = read('ios/App/App/MainViewController.swift');
    assert.match(swift, /override open func webViewConfiguration\(for instanceConfiguration: InstanceConfiguration\)/);
    assert.match(swift, /preferredContentMode = \.mobile/);
    assert.match(swift, /super\.webViewConfiguration\(for: instanceConfiguration\)/, 'réglages de Capacitor gardés');
    const cfg = JSON.parse(read('capacitor.config.json'));
    assert.equal(cfg.ios?.preferredContentMode, undefined, 'capacitor.config.json entre aussi dans l\'empreinte Android');
  });

  test('coach iPad : l\'app permet un cadre de ses propres fichiers seulement', () => {
    const p = policyOf(read('index.html'));
    assert.deepEqual(p['frame-src'], ["'self'"]);
    const ui = read('js/features/coach-desk-ui.js');
    assert.match(ui, /const COACH_DESK_SRC = 'coach\/index\.html';/, 'page du paquet, jamais le site distant');
    assert.ok(!/https?:\/\/[^'"\s]*coach/.test(ui.replace(/\/\/.*$/gm, '')), 'aucune adresse du site dans le code');
  });
}
