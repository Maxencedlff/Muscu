// Notifications push : règles de la fonction serveur push-send (supabase/functions/push-send/push-policy.js)
// et cohérence avec la migration (types, format du jeton). Clé de signature générée pour le test (jamais une
// vraie clé APNs), jetons d'appareil faux et évidents.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, assert, sameJSON, ROOT }) {
  const load = () => import(path.join(ROOT, 'supabase/functions/push-send/push-policy.js'));
  const FAKE_TOKEN = 'ab'.repeat(32);
  const row = (o = {}) => ({ id: 1, kind: 'reaction', ref: 's-1', token: FAKE_TOKEN, env: 'production', actor_name: 'max.dlf', wanted: true, ...o });

  test('push : textes par type, pseudo seul, jamais le contenu saisi', async () => {
    const { pushMessage } = await load();
    sameJSON(pushMessage(row()), { title: 'Bravo !', body: 'max.dlf t’a dit bravo pour ta séance', kind: 'reaction', ref: 's-1' });
    assert.equal(pushMessage(row({ kind: 'follow_request', ref: '' })).body, 'max.dlf veut suivre tes séances');
    assert.equal(pushMessage(row({ kind: 'coach_note' })).body, 'max.dlf a commenté ta séance');
    assert.equal(pushMessage(row({ kind: 'coach_programme', ref: 'prog1' })).body, 'max.dlf t’a envoyé un programme');
    sameJSON(pushMessage(row({ kind: 'comment', ref: 's-2' })), { title: 'Nouveau commentaire', body: 'max.dlf a commenté ta séance', kind: 'comment', ref: 's-2' });
    const uid = '00000000-0000-0000-0000-0000000000aa';
    sameJSON(pushMessage(row({ kind: 'chat_message', ref: uid })), { title: 'Nouveau message', body: 'max.dlf t’a envoyé un message', kind: 'chat_message', ref: uid });
    // La ligne de push_claim n'a jamais de texte saisi ; même si elle en avait, il ne partirait pas
    const sneaky = pushMessage(row({ kind: 'chat_message', ref: uid, body: 'texte privé', text: 'texte privé' }));
    assert.ok(!JSON.stringify(sneaky).includes('privé'), 'texte saisi dans la notification');
    assert.equal(pushMessage(row({ actor_name: null })).body, 'Quelqu’un t’a dit bravo pour ta séance');
    assert.equal(pushMessage(row({ actor_name: 'a\nb\u0007' })).body.startsWith('ab '), true, 'caractères de contrôle retirés');
    assert.equal([...pushMessage(row({ actor_name: 'x'.repeat(200) })).body].length < 80, true, 'pseudo borné');
  });

  test('push : rien sans accord, sans appareil ni type connu', async () => {
    const { pushMessage } = await load();
    sameJSON(pushMessage(row({ wanted: false })), { skip: 'unwanted' });
    sameJSON(pushMessage(row({ token: null })), { skip: 'no_device' });
    sameJSON(pushMessage(row({ token: 'ZZ'.repeat(32) })), { skip: 'no_device' });
    sameJSON(pushMessage(row({ kind: 'pub' })), { skip: 'unknown_kind' });
  });

  test('push : requête APNs (hôte, en-têtes, charge utile, expiration 24 h)', async () => {
    const { pushMessage, apnsRequest } = await load();
    const r = row();
    const req = apnsRequest(r, pushMessage(r), { topic: 'com.mdlf.training', providerToken: 'faux.jeton.fournisseur', nowS: 1_800_000_000 });
    assert.equal(req.url, `https://api.push.apple.com/3/device/${FAKE_TOKEN}`);
    sameJSON(req.init.headers, { authorization: 'bearer faux.jeton.fournisseur', 'apns-push-type': 'alert', 'apns-topic': 'com.mdlf.training',
      'apns-priority': '10', 'apns-expiration': '1800086400', 'content-type': 'application/json' });
    sameJSON(JSON.parse(req.init.body), { aps: { alert: { title: 'Bravo !', body: 'max.dlf t’a dit bravo pour ta séance' }, sound: 'default', 'thread-id': 'reaction' },
      mdlf: { kind: 'reaction', ref: 's-1' } });
    assert.ok(Buffer.byteLength(req.init.body) < 4096, 'sous la limite de 4 Ko');
    const sb = row({ env: 'sandbox' });
    assert.match(apnsRequest(sb, pushMessage(sb), { topic: 't', providerToken: 'x', nowS: 0 }).url, /^https:\/\/api\.sandbox\.push\.apple\.com\/3\/device\//);
  });

  test('push : réponses d\'APNs → envoyé, jeton mort, nouvel essai, abandon', async () => {
    const { apnsOutcome, settledIds } = await load();
    assert.equal(apnsOutcome(200), 'sent');
    assert.equal(apnsOutcome(410, 'Unregistered'), 'dead_token');
    assert.equal(apnsOutcome(400, 'BadDeviceToken'), 'dead_token');
    assert.equal(apnsOutcome(400, 'DeviceTokenNotForTopic'), 'dead_token');
    assert.equal(apnsOutcome(403, 'ExpiredProviderToken'), 'retry');
    assert.equal(apnsOutcome(429, 'TooManyRequests'), 'retry');
    assert.equal(apnsOutcome(503), 'retry');
    assert.equal(apnsOutcome(0), 'retry', 'réseau');
    assert.equal(apnsOutcome(400, 'PayloadTooLarge'), 'drop');
    // Notification 1 sur deux appareils : soldée seulement si aucun n'est à réessayer
    sameJSON(settledIds([{ id: 1, outcome: 'sent' }, { id: 1, outcome: 'retry' }, { id: 2, outcome: 'dead_token' }, { id: 3, outcome: 'skip' }]), [2, 3]);
  });

  test('push : jeton du fournisseur ES256 vérifiable avec la clé publique', async () => {
    const { providerToken, pemToDer } = await load();
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    assert.ok(pemToDer(pem).length > 100);
    const jwt = await providerToken({ keyP8: pem, keyId: 'FAKEKEY123', teamId: 'FAKETEAM12', nowS: 1_800_000_000.7 });
    const [h, c, s] = jwt.split('.');
    sameJSON(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'FAKEKEY123' });
    sameJSON(JSON.parse(Buffer.from(c, 'base64url')), { iss: 'FAKETEAM12', iat: 1_800_000_000 });
    const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    assert.equal(ok, true, 'signature r || s de 64 octets (JWS)');
    await assert.rejects(providerToken({ keyP8: pem, keyId: '', teamId: 'T', nowS: 0 }));
    await assert.rejects(providerToken({ keyP8: '', keyId: 'K', teamId: 'T', nowS: 0 }));
  });

  // Faux magasin partagé (la ligne private.push_apns_auth) et fausse signature : jetons « jwt-1 », « jwt-2 »…
  const authFakes = ({ stored = null, nowS = 1_800_000_000 } = {}) => {
    const f = { stored, nowS, signs: 0, loads: 0, swaps: [] };
    f.deps = {
      keyId: 'FAKEKEY123',
      now: () => f.nowS,
      sign: async (iat) => { f.signs++; await new Promise(r => setTimeout(r, 5)); return `jwt-${f.signs}@${iat}`; },
      load: async () => { f.loads++; return f.stored; },
      // Comparer-et-échanger : remplacé seulement si la ligne est encore celle attendue
      swap: async (expected, next) => { f.swaps.push(expected); if ((f.stored?.token ?? null) === expected) f.stored = next; return f.stored; },
    };
    return f;
  };

  test('push : jeton du fournisseur signé une seule fois pour 10 envois simultanés, puis gardé 40 min', async () => {
    const { providerTokenCache } = await load();
    const f = authFakes();
    const cache = providerTokenCache(f.deps);
    const tokens = await Promise.all(Array.from({ length: 10 }, () => cache.get()));
    assert.equal(f.signs, 1, 'une seule signature');
    assert.equal(new Set(tokens).size, 1);
    sameJSON(f.stored, { token: 'jwt-1@1800000000', iat: 1_800_000_000, key_id: 'FAKEKEY123' });
    f.nowS += 39 * 60;
    assert.equal(await cache.get(), 'jwt-1@1800000000', 'encore valable');
    assert.equal(f.signs, 1);
    f.nowS += 2 * 60;
    assert.equal(await cache.get(), `jwt-2@${1_800_000_000 + 41 * 60}`, 'renouvelé après 40 min');
  });

  test('push : jeton du fournisseur repris d\'une instance à l\'autre, une seule instance le renouvelle', async () => {
    const { providerTokenCache } = await load();
    const f = authFakes({ stored: { token: 'jwt-autre@1800000000', iat: 1_800_000_000 - 600, key_id: 'FAKEKEY123' } });
    assert.equal(await providerTokenCache(f.deps).get(), 'jwt-autre@1800000000', 'nouvelle instance : pas de signature');
    assert.equal(f.signs, 0);
    // Ligne périmée, deux instances en même temps : la seconde prend celui de la première
    f.stored = { token: 'vieux', iat: f.nowS - 3600, key_id: 'FAKEKEY123' };
    const [a, b] = await Promise.all([providerTokenCache(f.deps).get(), providerTokenCache(f.deps).get()]);
    assert.equal(a, b, 'même jeton pour les deux instances');
    assert.equal(f.stored.token, a);
    // Autre clé (APNS_KEY_ID changé) : jeton refait
    f.stored = { token: 'autre-cle', iat: f.nowS, key_id: 'OLDKEY0000' };
    assert.notEqual(await providerTokenCache(f.deps).get(), 'autre-cle');
    // Magasin injoignable : signé et gardé en mémoire, l'envoi continue
    const g = authFakes();
    g.deps.load = async () => { throw new Error('réseau'); };
    g.deps.swap = async () => { throw new Error('réseau'); };
    const c = providerTokenCache(g.deps);
    assert.equal(await c.get(), 'jwt-1@1800000000');
    assert.equal(await c.get(), 'jwt-1@1800000000');
    assert.equal(g.signs, 1);
  });

  test('push : 403 sur le jeton du fournisseur → refait une seule fois, et seulement pour ces raisons', async () => {
    const { providerTokenCache } = await load();
    const f = authFakes();
    const cache = providerTokenCache(f.deps);
    const t1 = await cache.get();
    cache.refused(t1, 'Forbidden');
    cache.refused(t1, 'BadEnvironmentKeyIdInToken');
    assert.equal(await cache.get(), t1, 'autre raison : jeton gardé');
    for (let i = 0; i < 10; i++) cache.refused(t1, 'ExpiredProviderToken');   // 10 envois refusés en même temps
    const after = await Promise.all(Array.from({ length: 10 }, () => cache.get()));
    assert.equal(f.signs, 2, 'une seule nouvelle signature');
    assert.equal(new Set(after).size, 1);
    assert.notEqual(after[0], t1);
    cache.refused(t1, 'InvalidProviderToken');   // réponse tardive pour l'ancien jeton : ignorée
    assert.equal(await cache.get(), after[0]);
    assert.equal(f.signs, 2);
    // Le jeton refusé ne revient pas du magasin (une autre instance l'y aurait laissé)
    const g = authFakes({ stored: { token: 'refuse', iat: 1_800_000_000, key_id: 'FAKEKEY123' } });
    const c = providerTokenCache(g.deps);
    assert.equal(await c.get(), 'refuse');
    c.refused('refuse', 'InvalidProviderToken');
    assert.notEqual(await c.get(), 'refuse');
    assert.deepEqual(g.swaps, ['refuse'], 'échange conditionné au jeton refusé');
  });

  test('push : secret de la planification comparé exactement', async () => {
    const { sameSecret } = await load();
    assert.equal(sameSecret('faux-secret-de-test', 'faux-secret-de-test'), true);
    assert.equal(sameSecret('faux-secret-de-tesT', 'faux-secret-de-test'), false);
    assert.equal(sameSecret('', ''), false, 'secret vide : jamais d\'accord');
    assert.equal(sameSecret(null, 'x'), false);
  });

  test('push : mêmes types et même format de jeton que la migration', async () => {
    const { PUSH_KINDS, validDeviceToken } = await load();
    const dir = path.join(ROOT, 'supabase/migrations');
    const all = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    const sql = fs.readFileSync(path.join(dir, '20261031900000_notifications_push.sql'), 'utf8');
    // Dernière contrainte posée sur push_outbox.kind (la plus récente migration qui l'a changée)
    const checks = [...all.matchAll(/check \(kind in \(([^)]+)\)\)/g)];
    const kinds = checks.at(-1)[1].match(/'([a-z_]+)'/g).map(k => k.slice(1, -1));
    assert.ok(kinds.includes('comment') && kinds.includes('chat_message'));
    sameJSON(Object.keys(PUSH_KINDS).sort(), kinds.sort());
    assert.ok(sql.includes("'^[0-9a-f]{64,200}$'"));
    assert.equal(validDeviceToken(FAKE_TOKEN), true);
    assert.equal(validDeviceToken('ab'), false);
    assert.equal(validDeviceToken(FAKE_TOKEN.toUpperCase()), false);
  });
  // ── App : réglages, autorisation d'iOS, jeton (js/data/push.js) ──
  // Faux pont natif et faux serveur : chaque appel est noté dans __calls
  const withFakes = async ({ permission = 'prompt', answer = 'granted', token = FAKE_TOKEN, prefs = { reactions: false, follows: false, coach: false } } = {}, fn) => {
    run(`__calls = []; __saved = { isNative: Native.isNative, push: Native.push, avail: accountAvailable, user: account.user, sb };
      Native.isNative = true; accountAvailable = () => true; account.user = { id: 'u-test' };
      globalThis.__prefs = ${JSON.stringify(prefs)};
      Native.push = { permission: async () => { __calls.push('permission'); return ${JSON.stringify(permission)}; },
        requestPermission: async () => { __calls.push('request'); return ${JSON.stringify(answer)}; },
        register: async () => { __calls.push('register'); return ${JSON.stringify(token)} ? { token: ${JSON.stringify(token)}, environment: 'production' } : null; } };
      globalThis.__session = 'u-test';
      sb = { auth: { getSession: async () => ({ data: { session: __session ? { user: { id: __session } } : null }, error: null }) },
        rpc: async (fn, args) => { __calls.push(fn + ':' + JSON.stringify(args || {}));
        if (fn === 'push_set_prefs') { for (const k in args) if (args[k] !== null) __prefs[k] = args[k]; return { data: __prefs, error: null }; }
        if (fn === 'push_prefs') return { data: __prefs, error: null };
        return { data: null, error: null }; } };
      localStorage.removeItem('mdlf_push'); push.prefs = null; push.busy = null; push.userId = null; push.permission = null;`);
    try { await fn(); } finally {
      run(`Native.isNative = __saved.isNative; Native.push = __saved.push; accountAvailable = __saved.avail; account.user = __saved.user; sb = __saved.sb;
        localStorage.removeItem('mdlf_push'); push.prefs = null; push.busy = null;`);
    }
  };

  test('push app : réglages nettoyés, tout éteint par défaut', () => {
    sameJSON(run(`cleanPushPrefs({ reactions: true, follows: 'oui', coach: 1, pub: true })`), { reactions: true, follows: false, coach: false });
    sameJSON(run(`cleanPushPrefs(null)`), { reactions: false, follows: false, coach: false });
    // Serveur à jour : les 5 types ; serveur d'avant (3 clés) : les nouveaux ne sont pas montrés
    sameJSON(run(`cleanPushPrefs({ reactions: false, follows: false, coach: false, comments: true, messages: false })`),
      { reactions: false, comments: true, follows: false, coach: false, messages: false });
    sameJSON(run(`pushShownTypes(cleanPushPrefs({ reactions: true, follows: false, coach: false })).map(t => t.id)`), ['reactions', 'follows', 'coach']);
    sameJSON(run(`pushShownTypes(cleanPushPrefs({ reactions: true, follows: false, coach: false, comments: false, messages: false })).map(t => t.id)`),
      ['reactions', 'comments', 'follows', 'coach', 'messages']);
    assert.equal(run(`pushAnyOn(cleanPushPrefs({ reactions: false, follows: false, coach: false, comments: false, messages: true }))`), true);
    assert.equal(run(`pushAnyOn(cleanPushPrefs({}))`), false);
    assert.equal(run(`pushPossible()`), false, 'navigateur : jamais');
  });

  test('push app : allumer demande à iOS au toucher, inscrit le jeton, puis le réglage', async () => {
    await withFakes({}, async () => {
      sameJSON(await run(`pushSetPref('reactions', true)`), { ok: true });
      sameJSON(run('__calls'), ['permission', 'request', 'register',
        `push_register:${JSON.stringify({ token: FAKE_TOKEN, env: 'production' })}`,
        'push_set_prefs:{"reactions":true,"follows":null,"coach":null}']);
      sameJSON(run(`JSON.parse(localStorage.getItem('mdlf_push'))`), { userId: 'u-test', token: FAKE_TOKEN });
      // Tout éteint : le jeton quitte le compte
      run('__calls = []');
      sameJSON(await run(`pushSetPref('reactions', false)`), { ok: true });
      sameJSON(run('__calls'), ['push_set_prefs:{"reactions":false,"follows":null,"coach":null}', `push_unregister:${JSON.stringify({ token: FAKE_TOKEN })}`]);
      assert.equal(run(`localStorage.getItem('mdlf_push')`), null);
    });
  });

  test('push app : serveur à jour, les 5 types envoyés (null = inchangé)', async () => {
    await withFakes({ permission: 'granted', prefs: { reactions: false, follows: false, coach: false, comments: false, messages: false } }, async () => {
      await run('pushLoad()');
      run('__calls = []');
      sameJSON(await run(`pushSetPref('messages', true)`), { ok: true });
      assert.ok(run('__calls').includes('push_set_prefs:{"reactions":null,"comments":null,"follows":null,"coach":null,"messages":true}'), run('__calls').join(' | '));
      assert.equal(run('push.prefs.messages'), true);
    });
    // Serveur d'avant : un type nouveau ne s'allume pas (aucun appel)
    await withFakes({ permission: 'granted' }, async () => {
      await run('pushLoad()');
      run('__calls = []');
      sameJSON(await run(`pushSetPref('comments', true)`), { ok: false, reason: 'busy' });
      assert.ok(!run('__calls').some(c => c.startsWith('push_set_prefs')));
    });
  });

  test('push app : refus d\'iOS, jeton impossible, build sans module : rien d\'écrit sur le serveur', async () => {
    await withFakes({ answer: 'denied' }, async () => {
      sameJSON(await run(`pushSetPref('follows', true)`), { ok: false, reason: 'denied' });
      assert.ok(!run('__calls').some(c => c.startsWith('push_')), 'aucun appel au serveur');
    });
    await withFakes({ permission: 'granted', token: '' }, async () => {
      sameJSON(await run(`pushSetPref('coach', true)`), { ok: false, reason: 'register' });
      assert.ok(!run('__calls').some(c => c.startsWith('push_set_prefs')));
      assert.ok(!run('__calls').includes('request'), 'déjà autorisé : pas de fenêtre');
    });
    await withFakes({ permission: 'unavailable' }, async () => {
      sameJSON(await run(`pushSetPref('coach', true)`), { ok: false, reason: 'unavailable' });
    });
    await withFakes({}, async () => {
      sameJSON(await run(`pushSetPref('pub', true)`), { ok: false, reason: 'busy' }, 'type inconnu');
    });
  });

  // Build avec le module MdlfPush avant la mise en service du serveur (migration 20261031900000 pas
  // appliquée : PostgREST répond PGRST202 « fonction introuvable ») : rien ne casse, rien n'est gardé
  test('push app : serveur sans les fonctions push → échec propre, aucun jeton gardé', async () => {
    await withFakes({ permission: 'granted' }, async () => {
      run(`sb.rpc = async fn => { __calls.push(fn); return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + fn } }; }`);
      assert.equal(await run('pushLoad()'), false, 'réglages illisibles');
      assert.ok(run('push.error'), 'erreur notée pour l\'écran');
      assert.equal(run('push.prefs'), null, 'aucun réglage inventé');
      sameJSON(await run(`pushSetPref('reactions', true)`), { ok: false, reason: 'register' });
      assert.equal(run(`localStorage.getItem('mdlf_push')`), null, 'jeton refusé par le serveur : pas gardé');
      await run('pushForgetDevice()');   // déconnexion : rien à retirer, aucune exception
      assert.equal(run('push.busy'), null);
    });
  });

  test('push app : déconnexion → jeton retiré avant la fin de session', async () => {
    await withFakes({ permission: 'granted' }, async () => {
      await run(`pushSetPref('reactions', true)`);
      run('__calls = []');
      await run('pushForgetDevice()');
      sameJSON(run('__calls'), [`push_unregister:${JSON.stringify({ token: FAKE_TOKEN })}`]);
      run('__calls = []');
      await run('pushForgetDevice()');
      sameJSON(run('__calls'), [], 'rien d\'inscrit : aucun appel');
    });
  });

  test('push app : déconnexion hors ligne, refusée ou trop lente → jeton gardé, retiré à la connexion de B', async () => {
    // Sans ce marqueur, B se connecte, push_release ne part pas et les notifications de A arrivent chez B
    const failures = {
      'hors ligne': `async () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } })`,
      'erreur du serveur': `async () => ({ data: null, error: { code: '57014', message: 'canceling statement' } })`,
      'exception': `async () => { throw new TypeError('Failed to fetch'); }`,
      'délai dépassé': `() => new Promise(() => {})`,
    };
    for (const [label, unregister] of Object.entries(failures)) {
      await withFakes({ permission: 'granted' }, async () => {
        await run(`pushSetPref('reactions', true)`);
        run(`globalThis.__rpc0 = sb.rpc; sb.rpc = (fn, a) => fn === 'push_unregister' ? (__calls.push(fn), (${unregister})()) : __rpc0(fn, a);
          __pushTimeoutMs = PUSH_FORGET_TIMEOUT_MS; PUSH_FORGET_TIMEOUT_MS = 20; __calls = []`);
        try { await run('pushForgetDevice()'); } finally { run('PUSH_FORGET_TIMEOUT_MS = __pushTimeoutMs'); }
        assert.ok(run('__calls').includes('push_unregister'), label);
        sameJSON(run(`JSON.parse(localStorage.getItem('mdlf_push'))`), { userId: 'u-test', token: FAKE_TOKEN }, `${label} : marqueur gardé`);
        // B se connecte sur cet iPhone, sans rien allumer : le jeton de A part d'abord
        run(`sb.rpc = __rpc0; __prefs = { reactions: false, follows: false, coach: false }; __calls = []; account.user = { id: 'u-b' }; __session = 'u-b'`);
        await run('pushOnAccount()');
        assert.equal(run('__calls')[0], `push_release:${JSON.stringify({ token: FAKE_TOKEN })}`, label);
        assert.equal(run(`localStorage.getItem('mdlf_push')`), null, `${label} : retiré, marqueur vidé`);
      });
    }
  });

  test('push app : « Supprimer les données » déconnecté → jeton gardé pour la connexion suivante, aucun appel sans session', async () => {
    await withFakes({}, async () => {
      run(`localStorage.setItem('mdlf_push', JSON.stringify({ userId: 'u-a', token: '${FAKE_TOKEN}' })); account.user = null; __session = null`);
      await run('pushForgetDevice()');
      sameJSON(run('__calls'), [], 'push_unregister ne fait rien sans session');
      sameJSON(run(`JSON.parse(localStorage.getItem('mdlf_push'))`), { userId: 'u-a', token: FAKE_TOKEN });
    });
  });

  test('push app : inscription faite pendant le retrait → la nouvelle reste', async () => {
    const OTHER = 'cd'.repeat(32);
    await withFakes({ permission: 'granted' }, async () => {
      await run(`pushSetPref('reactions', true)`);
      run(`globalThis.__rpc0 = sb.rpc; sb.rpc = async (fn, a) => { if (fn === 'push_unregister') localStorage.setItem('mdlf_push', JSON.stringify({ userId: 'u-test', token: '${OTHER}' })); return __rpc0(fn, a); }`);
      await run('pushForgetDevice()');
      assert.equal(run(`JSON.parse(localStorage.getItem('mdlf_push')).token`), OTHER);
    });
  });

  test('push app : session de A finie hors de l\'app, B se connecte → jeton de A retiré avant tout le reste', async () => {
    // B n'allume rien : sans ce retrait, les notifications de A continueraient d'arriver ici
    await withFakes({ permission: 'granted' }, async () => {
      run(`localStorage.setItem('mdlf_push', JSON.stringify({ userId: 'u-a', token: '${FAKE_TOKEN}' })); account.user = { id: 'u-b' }; __session = 'u-b'`);
      await run('pushOnAccount()');
      const calls = run('__calls');
      assert.equal(calls[0], `push_release:${JSON.stringify({ token: FAKE_TOKEN })}`, `retrait d'abord ${calls}`);
      assert.ok(!calls.some(c => c.startsWith('push_register')), 'rien d\'allumé pour B : pas d\'inscription');
      assert.equal(run(`localStorage.getItem('mdlf_push')`), null);
    });
    // B a un type allumé : retrait, puis inscription pour B (jamais l'inverse : B garderait le jeton)
    await withFakes({ permission: 'granted', prefs: { reactions: true, follows: false, coach: false } }, async () => {
      run(`localStorage.setItem('mdlf_push', JSON.stringify({ userId: 'u-a', token: '${FAKE_TOKEN}' })); account.user = { id: 'u-b' }; __session = 'u-b'`);
      await run('pushOnAccount()');
      const calls = run('__calls').filter(c => c.startsWith('push_re'));
      assert.equal(calls.length, 2, `${calls}`);
      assert.ok(calls[0].startsWith('push_release') && calls[1].startsWith('push_register'), `ordre ${calls}`);
      sameJSON(run(`JSON.parse(localStorage.getItem('mdlf_push'))`), { userId: 'u-b', token: FAKE_TOKEN });
    });
    // A se reconnecte : son jeton est gardé (rien à retirer)
    await withFakes({ permission: 'granted' }, async () => {
      run(`localStorage.setItem('mdlf_push', JSON.stringify({ userId: 'u-test', token: '${FAKE_TOKEN}' }))`);
      await run('pushOnAccount()');
      assert.ok(!run('__calls').some(c => c.startsWith('push_release')));
      assert.notEqual(run(`localStorage.getItem('mdlf_push')`), null);
    });
    // Hors ligne : gardé pour un nouvel essai au prochain lancement
    await withFakes({ permission: 'granted' }, async () => {
      run(`localStorage.setItem('mdlf_push', JSON.stringify({ userId: 'u-a', token: '${FAKE_TOKEN}' }));
        const rpc = sb.rpc; sb.rpc = async (fn, a) => fn === 'push_release' ? { data: null, error: { message: 'TypeError: Failed to fetch' } } : rpc(fn, a);`);
      assert.equal(await run('pushReleaseOther("u-test")'), false);
      assert.equal(run(`JSON.parse(localStorage.getItem('mdlf_push')).userId`), 'u-a');
    });
  });

  test('push app : fusion annulée sous la session de B, jeton laissé par A → push_release (push_unregister ne retire que les miens)', async () => {
    await withFakes({}, async () => {
      run(`localStorage.setItem('mdlf_push', JSON.stringify({ userId: 'u-a', token: '${FAKE_TOKEN}' })); __session = 'u-b'`);
      await run('pushForgetDevice()');
      sameJSON(run('__calls'), [`push_release:${JSON.stringify({ token: FAKE_TOKEN })}`]);
    });
  });

  test('push app : réglages allumés sur le compte, iPhone sans accord (réinstallation) → à réactiver (écran : tests/test_notifications.py)', async () => {
    await withFakes({ permission: 'prompt', prefs: { reactions: true, follows: false, coach: true } }, async () => {
      await run('pushOnAccount()');
      assert.ok(!run('__calls').some(c => c === 'request' || c === 'register'), 'aucune fenêtre d\'iOS sans toucher');
      assert.equal(run('pushNeedsReactivate()'), true);
      run('__calls = []');
      sameJSON(await run('pushReactivate()'), { ok: true });
      sameJSON(run('__calls'), ['permission', 'request', 'register', `push_register:${JSON.stringify({ token: FAKE_TOKEN, env: 'production' })}`]);
      assert.equal(run('pushNeedsReactivate()'), false);
      sameJSON(run('push.prefs'), { reactions: true, follows: false, coach: true }, 'réglages du compte gardés');
    });
    // Tout éteint : rien à réactiver
    await withFakes({ permission: 'prompt' }, async () => {
      await run('pushLoad()');
      assert.equal(run('pushNeedsReactivate()'), false);
    });
    // Refus d'iOS à la réactivation : rien sur le serveur
    await withFakes({ permission: 'prompt', answer: 'denied', prefs: { reactions: true, follows: false, coach: false } }, async () => {
      await run('pushLoad()');
      sameJSON(await run('pushReactivate()'), { ok: false, reason: 'denied' });
      assert.ok(!run('__calls').some(c => c.startsWith('push_register')));
    });
  });

  test('push app : écran ouvert au toucher', () => {
    const t = (p, h = []) => run(`pushTarget(${JSON.stringify(p)}, ${JSON.stringify(h)})`);
    sameJSON(t({ kind: 'reaction', ref: 's1' }, [{ id: 's1' }]), { tab: 'history', screen: 'history-detail', params: ['s1'] });
    sameJSON(t({ kind: 'coach_note', ref: 'absente' }, [{ id: 's1' }]), { tab: 'history', screen: null, params: [] }, 'séance pas sur cet appareil');
    sameJSON(t({ kind: 'follow_request', ref: '' }), { tab: 'friends', screen: null, params: [] });
    sameJSON(t({ kind: 'coach_programme', ref: 'p1' }), { tab: 'friends', screen: 'coach-mine', params: [] });
    sameJSON(t({ kind: 'comment', ref: 's1' }, [{ id: 's1' }]), { tab: 'history', screen: 'history-detail', params: ['s1'] });
    sameJSON(t({ kind: 'comment', ref: '' }, [{ id: 's1' }]), { tab: 'history', screen: null, params: [] }, 'commentaire disparu');
    const me = '00000000-0000-0000-0000-0000000000a1', student = '00000000-0000-0000-0000-0000000000b2';
    const tm = (p) => run(`pushTarget(${JSON.stringify(p)}, [], ${JSON.stringify(me)})`);
    sameJSON(tm({ kind: 'chat_message', ref: me }), { tab: 'friends', screen: 'coach-chat', params: [run('CHAT_COACH')] }, 'élève : avec mon coach');
    sameJSON(tm({ kind: 'chat_message', ref: student }), { tab: 'friends', screen: 'coach-chat', params: [student] }, 'coach : avec cet élève');
    sameJSON(tm({ kind: 'chat_message', ref: '../x' }), { tab: 'friends', screen: null, params: [] }, 'ref inattendu : onglet Amis');
    sameJSON(tm({ kind: 'chat_message', ref: '' }), { tab: 'friends', screen: null, params: [] });
    assert.equal(t({ kind: 'inconnu' }), null);
    assert.equal(t(null), null);
  });
}
