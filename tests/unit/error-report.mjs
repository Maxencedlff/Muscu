// ═══════════════════════════════════════════════════════════
//  Remontée des erreurs (docs/ERREURS_PROD.md) : js/data/error-report.js, js/app/error-capture.js et les règles
//  de la fonction serveur error-report (supabase/functions/error-report/error-policy.js). Contexte vm à part.
//  Le test central : RIEN de personnel ne part, quoi que contiennent l'erreur, sa pile ou le stockage.
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Fausses données personnelles (jamais de vraies) : on vérifie qu'aucune ne sort
const PSEUDO = 'jeanne.testeuse';
const EMAIL = 'jeanne.testeuse@exemple.invalid';
const POIDS = '82,5';
const POIDS_POINT = '82.5';
const SEANCE = 'Développé couché';
const USER_ID = '00000000-0000-4000-8000-00000000e001';
const JETON = 'faux-jeton-de-session-0123456789'; // faux, pour les tests gitleaks:allow

export default function ({ test, assert, sameJSON, ROOT }) {
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

  // App installée (Native.isNative) ou PWA, faux fetch qui enregistre chaque envoi
  function makeApp({ native = true, status = 202, profile = { username: PSEUDO, email: EMAIL, userId: USER_ID } } = {}) {
    const sent = [];
    const listeners = {};
    const store = new Map([['mdlf_profile', JSON.stringify(profile)], ['mdlf-auth', JSON.stringify({ access_token: JETON })],
      ['ppl-data', JSON.stringify({ bodyKg: POIDS_POINT, history: [{ name: SEANCE }] })]]);
    const ctx = vm.createContext({
      console,
      localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
      fetch: (url, init) => { sent.push({ url, init }); return Promise.resolve({ ok: status >= 200 && status < 300, status }); },
    });
    ctx.window = ctx;
    ctx.window.MDLF_BUILD = { version: '2026.11.29-abc1234' };
    ctx.window.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
    vm.runInContext(`const Native = { isNative: ${native}, platform: ${native ? "'ios'" : "'web'"} };
      const ACCOUNT_CONFIG = { url: 'https://projet-de-test.supabase.co', publishableKey: 'sb_publishable_faux' };
      const PROFILE_CACHE_KEY = 'mdlf_profile';`, ctx);
    for (const f of ['js/data/error-report.js', 'js/app/error-capture.js']) vm.runInContext(read(f), ctx, { filename: f });
    const fire = (type, ev) => (listeners[type] || []).forEach(fn => fn(ev));
    return { ctx, sent, fire, fn: name => vm.runInContext(name, ctx) };
  }

  // Erreur piégée : données personnelles partout où une erreur peut en porter
  function poisonedError() {
    const e = new TypeError(`Profil de ${PSEUDO} (${EMAIL}) introuvable : poids ${POIDS} kg, séance "${SEANCE}", id ${USER_ID}, `
      + `jeton ${JETON}, page https://mdlf.app/compte?email=${encodeURIComponent(EMAIL)}`);
    e.stack = `TypeError: ${e.message}\n`
      + `    at renderProfile (capacitor://localhost/js/features/account-ui.js?u=${PSEUDO}:120:7)\n`
      + `    at ${SEANCE.replace(/\s/g, '_')} (capacitor://localhost/js/data/store.js:45:3)\n`
      + `    at https://evil.example/${EMAIL}/x.js:1:1\n`
      + `handler@capacitor://localhost/js/app/init.js#${POIDS_POINT}:9:2`;
    e.user = { email: EMAIL, username: PSEUDO };   // champs ajoutés à l'erreur : jamais lus
    e.bodyKg = 82.5;
    return e;
  }

  const FORBIDDEN = [PSEUDO, 'jeanne', 'testeuse', EMAIL, 'exemple.invalid', '@', POIDS, POIDS_POINT, '82', 'Développé', 'couché',
    'Developpe', USER_ID, 'e001', JETON, 'faux-jeton', 'mdlf.app/compte', 'evil.example', '?u='];

  test('erreurs : rien de personnel ne part (erreur, pile, champs ajoutés et stockage piégés)', async () => {
    const app = makeApp();
    app.fire('error', { target: app.ctx, error: poisonedError(), message: 'x' });
    app.fire('unhandledrejection', { reason: Object.assign(poisonedError(), { name: 'RangeError' }) });
    assert.equal(app.sent.length, 2, 'erreur et promesse rejetée envoyées');
    for (const { url, init } of app.sent) {
      assert.equal(url, 'https://projet-de-test.supabase.co/functions/v1/error-report');
      const wire = JSON.stringify({ url, headers: init.headers, body: init.body });
      for (const bad of FORBIDDEN) assert.ok(!wire.toLowerCase().includes(bad.toLowerCase()), `« ${bad} » est parti : ${init.body}`);
      assert.ok(!('Authorization' in init.headers) && !('authorization' in init.headers), 'aucun jeton de session');
      sameJSON(Object.keys(init.headers).sort(), ['Content-Type', 'apikey']);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.referrerPolicy, 'no-referrer');
      const body = JSON.parse(init.body);
      sameJSON(Object.keys(body), ['v', 'kind', 'name', 'message', 'frames', 'build', 'platform'], 'liste blanche des champs');
      for (const fr of body.frames) sameJSON(Object.keys(fr), ['f', 'file', 'l', 'c'], 'liste blanche d\'une ligne de pile');
      assert.match(body.message, /^[\x20-\x7E]*$/, 'ASCII seulement');
      assert.doesNotMatch(body.message, /[0-9@]/, 'ni chiffre ni @');
    }
    const first = JSON.parse(app.sent[0].init.body);
    assert.equal(first.name, 'TypeError');
    assert.equal(first.build, '2026.11.29-abc1234');
    assert.equal(first.platform, 'ios');
    sameJSON(first.frames.map(f => `${f.f}|${f.file}:${f.l}:${f.c}`),
      ['renderProfile|js/features/account-ui.js:120:7', '?|js/data/store.js:45:3', '?|<ext>:1:1', 'handler|js/app/init.js:9:2'],
      'pile reconstruite : fichiers de l\'app sans paramètre, fonction douteuse effacée, fichier extérieur masqué');
    assert.equal(JSON.parse(app.sent[1].init.body).kind, 'rejection');
  });

  test('erreurs : le message reste lisible pour corriger (type d\'erreur et texte du moteur gardés)', () => {
    const { fn } = makeApp();
    const scrub = fn('errScrubMessage');
    assert.equal(scrub("Cannot read properties of undefined (reading 'sets')"), "Cannot read properties of undefined (reading '<s>')");
    assert.equal(scrub('renderHome is not defined'), 'renderHome is not defined');
    assert.equal(scrub('Load failed'), 'Load failed');
    assert.equal(scrub('x'.repeat(500)).length, 200, 'tronqué');
    assert.equal(scrub(`Bonjour ${PSEUDO}`, [PSEUDO]), 'Bonjour <p>', 'pseudo du compte retiré même sans guillemets');
    assert.equal(scrub('a\u0000b‮c'), 'a b c', 'caractères de contrôle et invisibles retirés');
  });

  test('erreurs : pile WebKit et V8, lignes illisibles ignorées, 12 lignes au plus', () => {
    const { fn } = makeApp();
    const parse = fn('errParseStack');
    sameJSON(parse('global code@capacitor://localhost/js/app/init.js:3:1'), [{ f: '?', file: 'js/app/init.js', l: 3, c: 1 }]);
    sameJSON(parse('    at async loadAll (capacitor://localhost/js/data/sync.js:10:2)'), [{ f: 'loadAll', file: 'js/data/sync.js', l: 10, c: 2 }]);
    sameJSON(parse('    at capacitor://localhost/index.html:58:4'), [{ f: '', file: 'index.html', l: 58, c: 4 }]);
    sameJSON(parse('[native code]\nn'), []);
    sameJSON(parse('capacitor://localhost/js/../secret.js:1:1'), [{ f: '', file: '<ext>', l: 1, c: 1 }]);
    assert.equal(parse(Array(40).fill('f@capacitor://localhost/js/a.js:1:1').join('\n')).length, 12);
  });

  test('erreurs : une seule fois chacune, 5 par lancement au plus, coupé après un refus du serveur', async () => {
    const app = makeApp();
    const err = m => Object.assign(new Error(m), { stack: `f@capacitor://localhost/js/a.js:1:1` });
    app.fire('error', { target: app.ctx, error: err('pareil') });
    app.fire('error', { target: app.ctx, error: err('pareil') });
    assert.equal(app.sent.length, 1, 'doublon ignoré');
    for (const m of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) app.fire('error', { target: app.ctx, error: err(m) });
    assert.equal(app.sent.length, 5, 'plafond par lancement');

    const refused = makeApp({ status: 404 });
    refused.fire('error', { target: refused.ctx, error: err('un') });
    await new Promise(r => setTimeout(r, 0));
    refused.fire('error', { target: refused.ctx, error: err('deux') });
    assert.equal(refused.sent.length, 1, 'fonction absente ou limite : plus rien jusqu\'au prochain lancement');
  });

  test('erreurs : rien n\'est envoyé hors de l\'app installée (PWA, tests), ni pour une image ou un son', () => {
    const web = makeApp({ native: false });
    web.fire('error', { target: web.ctx, error: new Error('x') });
    web.fire('unhandledrejection', { reason: new Error('y') });
    assert.equal(web.sent.length, 0);
    const app = makeApp();
    app.fire('error', { target: { tagName: 'IMG' }, error: null, message: '' });
    assert.equal(app.sent.length, 0, 'erreur de ressource ignorée');
    app.fire('unhandledrejection', { reason: 'texte seul' });
    app.fire('unhandledrejection', { reason: { get message() { throw new Error('piège'); } } });
    assert.equal(app.sent.length, 2, 'rejet sans Error et accesseur piégé : envoyés sans lever');
  });

  test('erreurs : index.html charge la remontée avant tout autre script, le service worker la met en cache', () => {
    const html = read('index.html');
    const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
    sameJSON(srcs.slice(0, 2), ['js/data/error-report.js', 'js/app/error-capture.js']);
    const sw = read('sw.js');
    for (const f of ['/js/data/error-report.js', '/js/app/error-capture.js']) assert.ok(sw.includes(`'${f}'`), `sw.js : ${f}`);
    // Même domaine que les comptes : connect-src n'a rien à ajouter
    assert.match(html.match(/connect-src ([^;]+)/)[1], /https:\/\/yopptmdjtnezmccdvaxf\.supabase\.co/);
    assert.match(read('supabase/config.toml'), /\[functions\.error-report\]\n(?:#.*\n)*verify_jwt = false/);
  });

  // ── Règles du serveur ──
  const policy = () => import(path.join(ROOT, 'supabase/functions/error-report/error-policy.js'));
  const good = { v: 1, kind: 'error', name: 'TypeError', message: "Cannot read properties of undefined (reading '<s>')",
    frames: [{ f: 'render', file: 'js/features/session.js', l: 12, c: 3 }], build: '2026.11.29-abc1234', platform: 'ios' };

  test('erreurs (serveur) : le rapport produit par l\'app est accepté, champs connus seulement', async () => {
    const { validateErrorReport } = await policy();
    const r = validateErrorReport(good);
    assert.equal(r.ok, true);
    sameJSON(Object.keys(r.value), ['kind', 'name', 'message', 'frames', 'build', 'platform']);
    const app = makeApp();
    app.fire('error', { target: app.ctx, error: poisonedError() });
    assert.equal(validateErrorReport(JSON.parse(app.sent[0].init.body)).ok, true, 'rapport piégé, une fois nettoyé : accepté');
  });

  test('erreurs (serveur) : tout ce qui sort de la forme est refusé, pas corrigé', async () => {
    const { validateErrorReport } = await policy();
    const field = b => { const r = validateErrorReport(b); assert.equal(r.ok, false, JSON.stringify(b)); return r.field; };
    assert.equal(field(null), 'body');
    assert.equal(field([good]), 'body');
    assert.equal(field({ ...good, email: EMAIL }), 'email', 'champ en trop');
    assert.equal(field({ ...good, user_id: USER_ID }), 'user_id');
    assert.equal(field({ ...good, v: 2 }), 'v');
    assert.equal(field({ ...good, kind: 'crash' }), 'kind');
    assert.equal(field({ ...good, name: 'Type Error' }), 'name');
    for (const message of [`poids ${POIDS}`, EMAIL, SEANCE, 'x'.repeat(201), 42]) assert.equal(field({ ...good, message }), 'message', String(message));
    for (const frames of [{}, Array(13).fill(good.frames[0]), [{ ...good.frames[0], url: 'x' }], [{ ...good.frames[0], file: 'https://x/y.js' }],
      [{ ...good.frames[0], file: 'js/../a.js' }], [{ ...good.frames[0], l: -1 }], [{ ...good.frames[0], f: PSEUDO + ' x' }]]) {
      assert.equal(field({ ...good, frames }), 'frames', JSON.stringify(frames));
    }
    assert.equal(field({ ...good, build: '' }), 'build');
    assert.equal(field({ ...good, platform: 'mac' }), 'platform');
  });

  test('erreurs (serveur) : limite par appareil en mémoire, fenêtre glissante, mémoire bornée', async () => {
    const { makeLimiter, clientAddress } = await policy();
    const lim = makeLimiter({ max: 3, windowMs: 1000, maxKeys: 2 });
    assert.deepEqual([1, 2, 3, 4].map(() => lim.hit('a', 0)), [true, true, true, false]);
    assert.equal(lim.hit('a', 1000), true, 'nouvelle fenêtre');
    lim.hit('b', 0);
    lim.hit('c', 0);
    assert.equal(lim.size(), 1, 'au-delà de maxKeys, tout est oublié');
    const h = new Map([['x-forwarded-for', '203.0.113.7, 10.0.0.1']]);
    assert.equal(clientAddress({ get: k => h.get(k) ?? null }), '203.0.113.7');
    // L'adresse ne sert qu'à la clé de la limite : jamais insérée
    const src = read('supabase/functions/error-report/index.ts');
    assert.match(src, /insert\(checked\.value\)/);
    assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ''), /console\.[a-z]+\([^)]*\bip\b/, 'adresse jamais journalisée');
  });

  test('erreurs (base) : la migration refuse chiffres, @ et accents, ferme anon et authenticated', () => {
    const sql = read('supabase/migrations/20261129010000_erreurs_prod.sql');
    assert.match(sql, /message !~ '\[0-9@\]'/);
    assert.match(sql, /message ~ '\^\[ -~\]\*\$'/);
    assert.match(sql, /revoke all on table public\.error_reports from public, anon, authenticated, service_role;/);
    assert.match(sql, /enable row level security/);
    assert.doesNotMatch(sql, /\b(ip|user_id|email|username)\b\s+(text|uuid|inet)/i, 'aucune colonne personnelle');
    assert.ok(fs.existsSync(path.join(ROOT, 'supabase/rollback/20261129010000_erreurs_prod_down.sql')), 'retour arrière');
  });

  test('erreurs : la page de confidentialité décrit les diagnostics (FR et EN), sans IP gardée, 90 jours', () => {
    const page = read('privacy.html');
    assert.ok(page.includes('id="diagnostics"') && page.includes('id="diagnostics-en"'));
    assert.ok(page.includes("Ton adresse IP n'est pas enregistrée") && page.includes('Your IP address is not stored'));
    assert.ok(page.includes('90 jours') && page.includes('90 days'));
  });
}
