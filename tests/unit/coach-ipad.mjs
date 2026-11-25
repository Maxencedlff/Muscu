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

  test('coach iPad : proposé dans l\'app iOS sur iPad dès 768 points, jamais sur iPhone, Android ni dans le navigateur', () => {
    const ios = { native: true, platform: 'ios' };
    assert.equal(eligible({ ...ios, ua: IPAD, width: 1024 }), true, 'iPad 13 pouces en portrait');
    assert.equal(eligible({ ...ios, ua: IPAD, width: 1366 }), true, 'iPad en paysage');
    assert.equal(eligible({ ...ios, ua: IPAD, width: 820 }), true, 'iPad Air en portrait');
    assert.equal(eligible({ ...ios, ua: IPAD, width: 678 }), false, 'Split View à moitié sur un iPad 11 pouces');
    assert.equal(eligible({ ...ios, ua: IPAD, width: 320 }), false, 'Slide Over');
    assert.equal(eligible({ ...ios, ua: MAC, touchPoints: 5, width: 1024 }), true, 'vue web d\'iPadOS en mode ordinateur');
    assert.equal(eligible({ ...ios, ua: MAC, touchPoints: 0, width: 800 }), false, 'Mac sans toucher, fenêtre étroite');
    assert.equal(eligible({ ...ios, ua: IPHONE, width: 932 }), false, 'iPhone Pro Max couché : rien ne change sur iPhone');
    assert.equal(eligible({ native: true, platform: 'android', ua: ANDROID, width: 1280 }), false, 'tablette Android : pas avant ses propres tests (audit M2)');
    assert.equal(run('COACH_DESK_MIN_OPEN'), 678, 'mode ouvert refermé sous 678 points (audit M3)');
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

  test('coach iPad : CSP de la page embarquée, scripts du paquet seulement, images blob:, aucun cadre', () => {
    const p = policyOf(embedHtml(site));
    const s = policyOf(site);
    assert.deepEqual(p['script-src'], ["'self'", 'capacitor://localhost'], 'ni Apple JS ni aucun hôte : rien ne vient du site distant');
    for (const k of Object.keys(s)) if (s[k].includes("'self'")) assert.ok(p[k].includes('capacitor://localhost'), `${k} : origine du paquet nommée (cadre isolé sous capacitor://)`);
    assert.ok(s['script-src'].includes('https://appleid.cdn-apple.com'), 'le site garde Apple JS');
    assert.deepEqual(p['img-src'], [...s['img-src'].flatMap(v => (v === "'self'" ? [v, 'capacitor://localhost'] : [v])), 'blob:']);
    assert.deepEqual(p['frame-src'], ["'none'"]);
    const withApp = v => v.flatMap(x => (x === "'self'" ? [x, 'capacitor://localhost'] : [x]));
    assert.deepEqual(p['connect-src'], withApp(s['connect-src']), 'mêmes connexions que le site (Supabase seulement)');
    for (const k of Object.keys(s)) if (!['script-src', 'img-src'].includes(k)) assert.deepEqual(p[k], withApp(s[k]), k);
    assert.throws(() => embedPolicy("default-src 'none'; img-src 'self'; frame-src 'self'"), /script-src/);
    assert.throws(() => embedPolicy("script-src 'self'; img-src 'self'; frame-src *"), /frame-src/);
  });

  test('coach iPad : page embarquée, seul bridge-start s\'exécute ; scripts du site rangés inertes, dans le même ordre, puis bridge-end', () => {
    const out = embedHtml(site);
    const srcs = h => [...h.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
    const tpl = out.match(/<template id="mdlf-embed-scripts">([\s\S]*?)<\/template>/);
    assert.ok(tpl, 'template des scripts');
    assert.deepEqual(srcs(out.replace(tpl[0], '')), ['js/embed/bridge-start.js'], 'un seul script actif au chargement');
    assert.deepEqual(srcs(tpl[1]), [...srcs(site), 'js/embed/bridge-end.js']);
    assert.ok(out.indexOf('Content-Security-Policy') < out.indexOf('<script'), 'CSP avant le premier script');
    assert.throws(() => embedHtml(site.replace('<script src="js/desk/main.js"></script>', '')), /main\.js/);
  });

  // ── Liaison (coach-embed/) avec les vrais scripts de la page, dans un cadre isolé ──
  // Contexte du cadre : window.parent est une autre fenêtre (l'app), joignable seulement par postMessage. Le cadre isolé
  // n'a pas de stockage (localStorage lève une erreur, comme dans un iframe sandbox sans allow-same-origin).
  const files = [...read('coach-web/index.html').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => path.normalize(path.join('coach-web', m[1])))
    .filter(f => !f.endsWith('main.js'));
  function frame({ answer = 'session', session = FAKE } = {}) {
    const calls = [], toApp = [], listeners = [], authListeners = [];
    const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); }, key() { return null; }, length: 0 };
    let current = null;
    const auth = {
      setSession: async t => { calls.push(['setSession', t.refresh_token]); if (t.refresh_token === 'refuse') return { data: { session: null }, error: { message: 'refusé' } }; current = { ...t }; return { data: { session: { ...t, user: { id: 'u1' } } }, error: null }; },
      getSession: async () => { calls.push(['getSession']); return { data: { session: current } }; },
      stopAutoRefresh: async () => { calls.push(['stopAutoRefresh']); },
      signOut: async () => { calls.push(['signOut']); return { error: null }; },
      onAuthStateChange: fn => { authListeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    };
    const appWin = { postMessage: (m, to) => toApp.push({ ...m, to }) };
    const els = [];
    const body = { appendChild: el => { els.push(el.src); }, textContent: '' };
    const sandbox = { console, setTimeout, clearTimeout, Intl, atob, btoa, TextEncoder, TextDecoder, crypto: globalThis.crypto,
      navigator: {}, innerWidth: 1024, innerHeight: 1366,
      addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
      location: { origin: 'null', ancestorOrigins: ['capacitor://localhost'] },
      getComputedStyle: () => ({ visibility: 'visible' }),
      document: { querySelector: () => null, querySelectorAll: () => [], getElementById: id => (id === 'mdlf-embed-scripts' ? { content: { querySelectorAll: () => [...files, 'coach-embed/bridge-end.js'].map(f => ({ getAttribute: () => f })) } } : null),
        addEventListener() {}, createElement: () => ({}), body, documentElement: { classList: { add() {} } } },
      supabase: { createClient: (url, key, o) => { calls.push(['createClient', o.auth.persistSession, o.auth.storage === undefined]); return { auth, rpc: async () => ({ data: null, error: null }) }; } } };
    Object.defineProperty(sandbox, 'localStorage', { get() { return blocked; } });
    sandbox.window = sandbox;
    sandbox.parent = appWin;
    const ctx = vm.createContext(sandbox);
    const load = f => vm.runInContext(read(f), ctx, { filename: f });
    load('coach-embed/bridge-start.js');
    const fire = (data, source = appWin) => listeners.forEach(fn => fn({ data, source, origin: 'capacitor://localhost' }));
    // Les scripts chargés par bridge-start (appendChild) sont exécutés ici dans l'ordre, comme le ferait le navigateur
    const start = () => { if (answer === 'session') fire({ type: 'mdlf-coach-session', session }); for (const f of els.splice(0)) load(f); };
    return { ctx, calls, toApp, els, fire, start, run: c => vm.runInContext(c, ctx), emit: (ev, s) => authListeners.forEach(fn => fn(ev, s)) };
  }
  const flush = () => new Promise(r => setTimeout(r, 0));

  test('coach iPad : rien ne se charge avant la session ; messages lus seulement s\'ils viennent de l\'app (event.source)', async () => {
    const f = frame();
    assert.deepEqual(JSON.parse(JSON.stringify(f.toApp)), [{ type: 'mdlf-coach-ready', to: 'capacitor://localhost' }], 'prêt, adressé à l\'origine de l\'app');
    assert.equal(f.els.length, 0, 'aucun script de coach-web avant la session');
    f.fire({ type: 'mdlf-coach-session', session: FAKE }, { postMessage() {} });
    assert.equal(f.els.length, 0, 'session venue d\'une autre fenêtre : ignorée');
    assert.equal(f.run('typeof window.MDLF_COACH_HOST'), 'undefined');
    f.fire({ type: 'mdlf-coach-session', session: { access_token: 'a' } });
    assert.equal(f.toApp.at(-1).type, 'mdlf-coach-exit', 'session incomplète : retour à l\'app');
    assert.equal(f.toApp.at(-1).reason, 'session');
  });

  test('coach iPad : session de l\'app reçue par message, sans écran de connexion, sans stockage (cadre isolé)', async () => {
    const f = frame();
    f.start();
    assert.equal(f.els.length, 0);
    assert.equal(f.run('deskHosted()'), true);
    assert.deepEqual(JSON.parse(f.run('JSON.stringify(window.MDLF_COACH_HOST.session)')), FAKE, 'les deux jetons seulement');
    assert.equal(f.run('typeof window.MDLF_COACH_HOST.photos'), 'undefined', 'pas de photos avant la vague 5 (audit m3)');
    const r = await f.run('deskResume()');
    assert.equal(r.ok, true);
    assert.deepEqual(f.calls.find(c => c[0] === 'createClient'), ['createClient', false, true], 'session en mémoire seulement');
    assert.deepEqual(f.calls.find(c => c[0] === 'setSession'), ['setSession', FAKE.refresh_token]);
    assert.equal(f.run('deskIdleFor()'), 0, 'pas de fermeture après 30 min : l\'app décide');
  });

  test('coach iPad : un seul rafraîchisseur (l\'app), jetons dans les deux sens, retenus seulement si acceptés, jamais de déconnexion', async () => {
    const f = frame();
    f.start();
    await f.run('deskResume()');
    await flush(); await flush();
    assert.ok(f.calls.some(c => c[0] === 'stopAutoRefresh'), 'rafraîchissement automatique arrêté dans le cadre');
    const toApp = () => JSON.parse(JSON.stringify(f.toApp.filter(m => m.type === 'mdlf-coach-tokens').map(m => m.tokens)));
    const neuf = { access_token: 'faux.jeton-acces.2', refresh_token: 'faux-rafraichissement-2' };   // gitleaks:allow (factice)
    f.emit('TOKEN_REFRESHED', { ...neuf, user: { id: 'u1' } });
    f.emit('TOKEN_REFRESHED', { ...neuf, user: { id: 'u1' } });
    assert.deepEqual(toApp(), [neuf], 'jetons du cadre rendus à l\'app, une fois');
    f.emit('SIGNED_IN', { ...FAKE });
    assert.equal(toApp().length, 1, 'connexion (setSession) : rien à rendre');
    // Jetons de l'app : refusés par supabase-js → pas retenus (audit m2), le même renvoi est réessayé
    const refuse = { access_token: 'faux.jeton-acces.3', refresh_token: 'refuse' };   // gitleaks:allow (factice)
    f.fire({ type: 'mdlf-coach-tokens', tokens: refuse }); await flush();
    f.fire({ type: 'mdlf-coach-tokens', tokens: refuse }); await flush();
    assert.equal(f.calls.filter(c => c[0] === 'setSession' && c[1] === 'refuse').length, 2, 'jeton refusé : réessayé');
    const app4 = { access_token: 'faux.jeton-acces.4', refresh_token: 'faux-rafraichissement-4' };   // gitleaks:allow (factice)
    f.fire({ type: 'mdlf-coach-tokens', tokens: app4 }); await flush();
    f.fire({ type: 'mdlf-coach-tokens', tokens: app4 }); await flush();
    assert.equal(f.calls.filter(c => c[0] === 'setSession' && c[1] === app4.refresh_token).length, 1, 'jeton accepté : retenu');
    f.fire({ type: 'mdlf-coach-tokens', tokens: { ...app4, refresh_token: 'x' } }, { postMessage() {} }); await flush();
    assert.ok(!f.calls.some(c => c[1] === 'x'), 'jetons d\'une autre fenêtre ignorés');
    // « Se déconnecter » : retour à l'app, la session de l'app n'est pas fermée
    await f.run('deskSignOut()'); await flush();
    assert.equal(f.calls.filter(c => c[0] === 'signOut').length, 0);
    assert.equal(f.toApp.at(-1).type, 'mdlf-coach-exit');
    assert.equal(f.toApp.at(-1).reason, null, 'retour simple');
  });

  test('coach iPad : session refusée dans le cadre → retour à l\'app avec « Connexion perdue » (audit m1)', async () => {
    const f = frame({ session: { access_token: 'faux.jeton-acces.9', refresh_token: 'refuse' } });   // gitleaks:allow (factice)
    f.start();
    const r = await f.run('deskResume()');
    assert.equal(r.ok, false);
    await f.run('MDLF_COACH_HOST.exit()'); await flush();
    assert.equal(f.toApp.at(-1).type, 'mdlf-coach-exit');
    assert.equal(f.toApp.at(-1).reason, 'session');
  });

  test('coach iPad : hôte en postMessage, cadre isolé sans allow-same-origin, messages vérifiés par la source', () => {
    const ui = read('js/features/coach-desk-ui.js');
    assert.match(ui, /sandbox="allow-scripts allow-forms"/);
    assert.ok(!/allow-same-origin|allow-top-navigation|allow-popups/.test(ui.replace(/\/\/.*$/gm, '')), 'aucun autre droit au cadre');
    assert.match(ui, /e\.source !== coachDesk\.frame\.contentWindow/, 'source vérifiée');
    assert.ok(!/contentDocument|contentWindow\.(?!postMessage)|MDLF_COACH_PARENT|coachDeskPhotos/.test(ui.replace(/\/\/.*$/gm, '').replace(/e\.source !== coachDesk\.frame\.contentWindow/, '')), 'aucun accès direct au cadre, aucune photo');
    assert.match(ui, /Agrandis la fenêtre pour le mode grand écran/);
    assert.match(ui, /Connexion perdue, réessaie/);
    const start = read('coach-embed/bridge-start.js');
    assert.match(start, /e\.source !== parent/);
    assert.ok(!/parent\.(?!postMessage)[A-Za-z]/.test(start.replace(/\/\/.*$/gm, '')), 'le cadre ne lit rien de la fenêtre de l\'app');
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

  test('coach iPad : canal natif de Capacitor réservé à la fenêtre principale (audit M1)', () => {
    const swift = read('ios/App/App/MainViewController.swift');
    assert.match(swift, /guard message\.frameInfo\.isMainFrame else \{ return \}/);
    assert.match(swift, /removeScriptMessageHandler\(forName: "bridge"\)/);
    assert.match(swift, /add\(MainFrameOnlyMessageHandler\(inner: handler\), name: "bridge"\)/);
    assert.match(swift, /override open func capacitorDidLoad\(\) \{\s*mainFrameOnlyBridge\(\)/, 'avant tout module');
  });

  test('coach iPad : faux serveurs du test d\'interface lus seulement par une build Debug lancée avec -mdlfE2E 1', () => {
    const swift = read('ios/App/App/MainViewController.swift');
    const outside = swift.replace(/#if DEBUG[\s\S]*?#endif/g, '');
    assert.ok(!/mdlfE2E|e2eFixtures|public\/e2e|"e2e"/.test(outside), 'argument et fichiers du test hors de #if DEBUG');
    assert.match(swift, /#if DEBUG\s*e2eFixtures\(\)\s*#endif/);
    assert.match(swift, /UserDefaults\.standard\.string\(forKey: "mdlfE2E"\) == "1"/);
    assert.ok(!/e2e/.test(read('scripts/build-web.mjs')), 'la construction de l\'app n\'écrit jamais les faux serveurs');
    const ios = read('.github/workflows/ios.yml');
    assert.match(ios, /Faux serveurs du test d'interface \(contrôle seulement\)\n\s*if: \$\{\{ !inputs\.testflight \}\}/);
    assert.match(ios, /Aucun faux serveur dans l'archive\n\s*if: \$\{\{ inputs\.testflight \}\}/);
    const ui = ios.slice(ios.indexOf("- name: Test d'interface iPad (XCUITest)"));
    assert.ok(!/continue-on-error/.test(ui.slice(0, ui.indexOf('- uses:'))), 'test d\'interface bloquant');
    const t = read('ios/App/UITests/CoachIpadUITests.swift');
    for (const k of ['parentCapacitor=bloqué', 'session=1', 'cadre=null', 'landscapeLeft', 'press(.home)', "Revenir à l'appli", 'connecté=0', 'cspApp=0', 'XCTAttachment'])
      assert.ok(t.includes(k), `parcours XCUITest : ${k}`);
  });

  test('coach iPad : l\'app permet un cadre de ses propres fichiers seulement', () => {
    const p = policyOf(read('index.html'));
    assert.deepEqual(p['frame-src'], ["'self'"]);
    const ui = read('js/features/coach-desk-ui.js');
    assert.match(ui, /const COACH_DESK_SRC = 'coach\/index\.html';/, 'page du paquet, jamais le site distant');
    assert.ok(!/https?:\/\/[^'"\s]*coach/.test(ui.replace(/\/\/.*$/gm, '')), 'aucune adresse du site dans le code');
  });
}
