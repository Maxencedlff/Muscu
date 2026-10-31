// Notifications push : règles de la fonction serveur push-send (supabase/functions/push-send/push-policy.js)
// et cohérence avec la migration (types, format du jeton). Clé de signature générée pour le test (jamais une
// vraie clé APNs), jetons d'appareil faux et évidents.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, assert, sameJSON, ROOT }) {
  const load = () => import(path.join(ROOT, 'supabase/functions/push-send/push-policy.js'));
  const FAKE_TOKEN = 'ab'.repeat(32);
  const row = (o = {}) => ({ id: 1, kind: 'reaction', ref: 's-1', token: FAKE_TOKEN, env: 'production', actor_name: 'max.dlf', wanted: true, ...o });

  test('push : textes par type, pseudo seul, jamais le contenu saisi', async () => {
    const { pushMessage } = await load();
    sameJSON(pushMessage(row()), { title: 'Bravo !', body: 'max.dlf t’a dit bravo pour ta séance', kind: 'reaction', ref: 's-1' });
    assert.equal(pushMessage(row({ kind: 'follow_request', ref: '' })).body, 'max.dlf veut suivre tes séances');
    assert.equal(pushMessage(row({ kind: 'coach_note' })).body, 'max.dlf a commenté ta séance');
    assert.equal(pushMessage(row({ kind: 'coach_programme', ref: 'prog1' })).body, 'max.dlf t’a envoyé un programme');
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

  test('push : secret de la planification comparé exactement', async () => {
    const { sameSecret } = await load();
    assert.equal(sameSecret('faux-secret-de-test', 'faux-secret-de-test'), true);
    assert.equal(sameSecret('faux-secret-de-tesT', 'faux-secret-de-test'), false);
    assert.equal(sameSecret('', ''), false, 'secret vide : jamais d\'accord');
    assert.equal(sameSecret(null, 'x'), false);
  });

  test('push : mêmes types et même format de jeton que la migration', async () => {
    const { PUSH_KINDS, validDeviceToken } = await load();
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261031900000_notifications_push.sql'), 'utf8');
    const kinds = sql.match(/kind in \(([^)]+)\)/)[1].match(/'([a-z_]+)'/g).map(k => k.slice(1, -1));
    sameJSON(Object.keys(PUSH_KINDS).sort(), kinds.sort());
    assert.ok(sql.includes("'^[0-9a-f]{64,200}$'"));
    assert.equal(validDeviceToken(FAKE_TOKEN), true);
    assert.equal(validDeviceToken('ab'), false);
    assert.equal(validDeviceToken(FAKE_TOKEN.toUpperCase()), false);
  });
}
