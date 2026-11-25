// ═══════════════════════════════════════════════════════════
//  « Relier un ordinateur » (js/data/photo-link.js, docs/PHOTOS_WEB.md) : QR code, dérivation, code de vérification,
//  enveloppe de la clé du coach, et les attaques du modèle de menace : QR volé, serveur qui remplace une clé (homme du
//  milieu sur le canal de la RPC), enveloppe rejouée vers un autre appareil ou un autre coach, clé du coach glissée par
//  le serveur, clés extractibles. Puis le QR code lui-même (coach-web/js/desk/qr.js) : structure de la norme.
//  Toutes les clés sont tirées au hasard par le test (jamais une vraie clé).
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export default function ({ test, app, assert, ROOT }) {
  const subtle = globalThis.crypto.subtle;
  const COACH = '00000000-0000-0000-0000-0000000000c1', OTHER = '00000000-0000-0000-0000-0000000000c2';
  const PAIR = '6f1c2e3a-0b4d-4e5f-8a9b-0c1d2e3f4a5b', PAIR2 = '7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d';
  const KEY_ID = 'ab'.repeat(16);
  const rnd = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
  const b64 = u => Buffer.from(u).toString('base64');
  const pubOf = async k => b64(new Uint8Array(await subtle.exportKey('raw', k.publicKey)));
  const gen = () => subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);

  // Coach : clé de photos enveloppée par un secret de trousseau (comme l'app), et sa forme PKCS#8 (coachKeyPkcs8)
  async function coachKey() {
    const secret = await app.vaultImportKey(app.bytesToB64(app.vaultRandom(32)));
    const { rec } = await app.coachKeyMake(secret, COACH, KEY_ID);
    return { secret, rec };
  }
  // Un appairage complet, chaque côté avec ses propres données ; o permet de jouer l'attaquant
  async function pairing(o = {}) {
    const { secret: kc, rec } = await coachKey();
    const D = await gen(), devicePub = await pubOf(D), s = rnd(16);
    const qr = app.plinkQrText({ pair: PAIR, coach: COACH, pub: devicePub, secret: s });
    const q = app.plinkQrParse(qr);
    const E = await gen(), epk = await pubOf(E);
    const phone = await app.plinkDerive(E.privateKey, q.pub, { pair: q.pair, coach: q.coach, devicePub: q.pub, epk, secret: q.secret }, 'encrypt');
    const pkcs8 = await app.coachKeyPkcs8(kc, COACH, rec);
    const sealed = await app.plinkWrap(phone.wrapKey, pkcs8, { device: PAIR, coach: COACH, keyId: KEY_ID, coachPub: rec.public_key });
    pkcs8.fill(0);
    // Ce que le navigateur reçoit du serveur (epkSeen : celle que le serveur relaie)
    const epkSeen = o.epk || epk;
    const browser = await app.plinkDerive(D.privateKey, epkSeen, { pair: PAIR, coach: COACH, devicePub, epk: epkSeen, secret: s }, 'unwrapKey');
    return { rec, kc, D, devicePub, s, qr, q, E, epk, phone, browser, sealed };
  }

  test('photos sur ordinateur : QR code, aller-retour et refus', async () => {
    const D = await gen(), pub = await pubOf(D), s = rnd(16);
    const t = app.plinkQrText({ pair: PAIR, coach: COACH, pub, secret: s });
    assert.match(t, /^MDLF1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{87}\.[A-Za-z0-9_-]{22}$/);
    assert.ok(t.length < 170, `QR court (${t.length})`);
    const q = app.plinkQrParse(t);
    assert.equal(q.pair, PAIR); assert.equal(q.coach, COACH); assert.equal(q.pub, pub);
    assert.equal(b64(q.secret), b64(s));
    assert.equal(app.plinkQrParse(` ${t}\n`).pair, PAIR, 'espaces autour tolérés');
    const parts = t.split('.');
    for (const bad of [t.replace('MDLF1', 'MDLF2'), parts.slice(0, 4).join('.'), `${t}.x`, t.slice(0, -1), parts.map((p, i) => (i === 3 ? `A${p.slice(1)}` : p)).join('.'),
      parts.map((p, i) => (i === 4 ? `${p.slice(0, -1)}+` : p)).join('.'), 'https://exemple.test', '', null, 'x'.repeat(300), '4006381333931'])
      assert.equal(app.plinkQrParse(bad), null, `refusé : ${String(bad).slice(0, 30)}`);
    // Bits de bourrage changés (même octets décodés, autre texte) : refusé, une seule écriture valable
    const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = parts[4], alt = last.slice(0, -1) + ABC[ABC.indexOf(last.at(-1)) ^ 1];   // dernier caractère : 2 bits utiles, 4 de bourrage
    assert.equal(app.plinkQrParse([...parts.slice(0, 4), alt].join('.')), null);
    assert.equal(app.plinkQrText({ pair: 'pas-un-uuid', coach: COACH, pub, secret: s }), null);
    assert.equal(app.plinkQrText({ pair: PAIR, coach: COACH, pub, secret: rnd(8) }), null);
  });

  test('photos sur ordinateur : preuve du QR (verifier) sans révéler le secret', async () => {
    const s = rnd(16), v = await app.plinkVerifier(s);
    assert.match(v, /^[A-Za-z0-9+/]{43}=$/);
    assert.equal(await app.plinkVerifier(s), v, 'déterministe');
    assert.notEqual(await app.plinkVerifier(rnd(16)), v);
    assert.ok(!v.includes(b64(s).replace(/=+$/, '')), 'le secret ne se lit pas dans la preuve');
  });

  test('photos sur ordinateur : protocole complet, même code des deux côtés, photo déchiffrée dans le navigateur', async () => {
    const x = await pairing();
    assert.match(x.phone.sas, /^\d{3} \d{3}$/);
    assert.equal(x.browser.sas, x.phone.sas, 'même code de vérification');
    const priv = await app.plinkUnwrap(x.browser.wrapKey, x.sealed, { device: PAIR, coach: COACH, keyId: KEY_ID, coachPub: x.rec.public_key });
    assert.ok(priv, 'enveloppe rouverte');
    // Clés jamais extractibles : ni la clé d'enveloppe gardée dans IndexedDB, ni la clé du coach, ni D
    assert.equal(x.browser.wrapKey.extractable, false);
    assert.equal(priv.extractable, false);
    assert.equal(x.D.privateKey.extractable, false);
    for (const k of [x.browser.wrapKey, priv, x.D.privateKey])
      await assert.rejects(subtle.exportKey(k.type === 'secret' ? 'raw' : 'pkcs8', k), 'exportation refusée');
    // Une photo chiffrée par un élève pour la clé du coach s'ouvre avec la clé rouverte dans le navigateur
    const meta = { id: '0d9c3f0e-6a52-4bfb-9a51-6b1f6d9e2a10', student: OTHER, coach: COACH, keyId: KEY_ID, takenOn: '2026-11-16', pose: 'side' };
    const plain = new Uint8Array([0xFF, 0xD8, 1, 2, 3, 0xFF, 0xD9]);
    const sealed = await app.coachPhotoSeal(x.rec.public_key, plain, meta);
    const open = await app.coachPhotoOpen({ priv, pub: x.rec.public_key }, sealed, sealed.ct, meta);
    assert.equal(b64(open), b64(plain));
    // L'enveloppe ne contient pas la clé en clair, et le PKCS#8 du téléphone a été effacé
    const pk = await app.coachKeyPkcs8(x.kc, COACH, x.rec);
    assert.ok(!Buffer.from(x.sealed.wrapped, 'base64').includes(Buffer.from(pk.subarray(-32))));
  });

  test('photos sur ordinateur : la clé du coach ne sort du trousseau que si elle est bien la sienne', async () => {
    const { secret, rec } = await coachKey();
    assert.ok(await app.coachKeyPkcs8(secret, COACH, rec));
    const other = await app.vaultImportKey(app.bytesToB64(app.vaultRandom(32)));
    assert.equal(await app.coachKeyPkcs8(other, COACH, rec), null, 'autre secret');
    assert.equal(await app.coachKeyPkcs8(secret, OTHER, rec), null, 'autre coach (données liées)');
    const { rec: rec2 } = await coachKey();
    assert.equal(await app.coachKeyPkcs8(secret, COACH, { ...rec, public_key: rec2.public_key }), null, 'clé publique du serveur qui n\'est pas la sienne');
  });

  test('photos sur ordinateur : attaque, le serveur remplace la clé du téléphone (homme du milieu)', async () => {
    const M = await gen(), evil = await pubOf(M);
    const x = await pairing({ epk: evil });
    assert.notEqual(x.browser.sas, x.phone.sas, 'le coach voit deux codes différents');
    assert.equal(await app.plinkUnwrap(x.browser.wrapKey, x.sealed, { device: PAIR, coach: COACH, keyId: KEY_ID, coachPub: x.rec.public_key }), null,
      'l\'enveloppe du téléphone ne s\'ouvre pas avec la clé dérivée de celle du serveur');
    // Le serveur, qui connaît D.pub et la clé du téléphone mais pas s ni les clés privées, ne peut pas ouvrir l'enveloppe :
    // même avec sa propre paire face à D.pub, et même en connaissant s (QR volé), il n'a pas D.priv ni E.priv
    const mine = await app.plinkDerive(M.privateKey, x.epk, { pair: PAIR, coach: COACH, devicePub: x.devicePub, epk: x.epk, secret: x.s }, 'unwrapKey');
    assert.equal(await app.plinkUnwrap(mine.wrapKey, x.sealed, { device: PAIR, coach: COACH, keyId: KEY_ID, coachPub: x.rec.public_key }), null);
    const mine2 = await app.plinkDerive(M.privateKey, x.devicePub, { pair: PAIR, coach: COACH, devicePub: x.devicePub, epk: x.epk, secret: x.s }, 'unwrapKey');
    assert.equal(await app.plinkUnwrap(mine2.wrapKey, x.sealed, { device: PAIR, coach: COACH, keyId: KEY_ID, coachPub: x.rec.public_key }), null);
  });

  test('photos sur ordinateur : attaque, QR volé ou QR d\'un autre affiché au coach', async () => {
    const x = await pairing();
    // QR volé (photo de l'écran) : le voleur a D.pub et s, pas D.priv. Avec sa propre paire, rien ne s'ouvre.
    const T = await gen();
    const thief = await app.plinkDerive(T.privateKey, x.epk, { pair: PAIR, coach: COACH, devicePub: x.devicePub, epk: x.epk, secret: x.q.secret }, 'unwrapKey');
    assert.notEqual(thief.sas, x.phone.sas);
    assert.equal(await app.plinkUnwrap(thief.wrapKey, x.sealed, { device: PAIR, coach: COACH, keyId: KEY_ID, coachPub: x.rec.public_key }), null);
    // Sans le secret du QR (serveur seul), avec la bonne clé privée même : rien ne s'ouvre non plus
    const noS = await app.plinkDerive(x.D.privateKey, x.epk, { pair: PAIR, coach: COACH, devicePub: x.devicePub, epk: x.epk, secret: rnd(16) }, 'unwrapKey');
    assert.equal(await app.plinkUnwrap(noS.wrapKey, x.sealed, { device: PAIR, coach: COACH, keyId: KEY_ID, coachPub: x.rec.public_key }), null);
    // QR d'un attaquant (sa clé D') montré au coach : le code calculé par le téléphone dépend de D', jamais égal à celui
    // de l'ordinateur du coach (qui n'affiche rien, ou un autre appairage)
    const A = await gen(), apub = await pubOf(A);
    const E = await gen(), epk = await pubOf(E);
    const ph = await app.plinkDerive(E.privateKey, apub, { pair: PAIR, coach: COACH, devicePub: apub, epk, secret: x.s }, 'encrypt');
    const legit = await app.plinkDerive(x.D.privateKey, epk, { pair: PAIR, coach: COACH, devicePub: x.devicePub, epk, secret: x.s }, 'unwrapKey');
    assert.notEqual(ph.sas, legit.sas);
  });

  test('photos sur ordinateur : attaque, enveloppe rejouée ou clé glissée par le serveur', async () => {
    const x = await pairing();
    const ctx = { device: PAIR, coach: COACH, keyId: KEY_ID, coachPub: x.rec.public_key };
    const { rec: other } = await coachKey();
    for (const [what, c] of [['autre appareil', { ...ctx, device: PAIR2 }], ['autre coach', { ...ctx, coach: OTHER }], ['autre identifiant de clé', { ...ctx, keyId: 'cd'.repeat(16) }],
      ['autre clé publique (servie par le serveur)', { ...ctx, coachPub: other.public_key }]])
      assert.equal(await app.plinkUnwrap(x.browser.wrapKey, x.sealed, c), null, what);
    // Enveloppe modifiée, IV modifié, enveloppe d'un autre appairage
    const flip = s => { const b = Buffer.from(s, 'base64'); b[5] ^= 1; return b.toString('base64'); };
    assert.equal(await app.plinkUnwrap(x.browser.wrapKey, { ...x.sealed, wrapped: flip(x.sealed.wrapped) }, ctx), null);
    assert.equal(await app.plinkUnwrap(x.browser.wrapKey, { ...x.sealed, iv: flip(x.sealed.iv) }, ctx), null);
    const y = await pairing();
    assert.equal(await app.plinkUnwrap(x.browser.wrapKey, y.sealed, ctx), null, 'enveloppe d\'un autre ordinateur');
    // Deux appairages : deux codes de vérification indépendants
    assert.notEqual(y.phone.sas === x.phone.sas && y.browser.sas === x.browser.sas && y.epk === x.epk, true);
  });

  test('photos sur ordinateur : attaque, appairage terminé par un tiers avec SA clé (QR et session volés) : refusé', async () => {
    const x = await pairing();
    const priv = await app.plinkUnwrap(x.browser.wrapKey, x.sealed, { device: PAIR, coach: COACH, keyId: KEY_ID, coachPub: x.rec.public_key });
    assert.equal(await app.plinkKeyMatches(priv, x.rec.public_key), true, 'la vraie clé du coach');
    // Le tiers connaît s, D.pub, et a fait l'offre : il enveloppe une clé à lui avec les bonnes données liées
    const evil = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const pk = new Uint8Array(await subtle.exportKey('pkcs8', evil.privateKey));
    const sealed = await app.plinkWrap(x.phone.wrapKey, pk, { device: PAIR, coach: COACH, keyId: KEY_ID, coachPub: x.rec.public_key });
    const bad = await app.plinkUnwrap(x.browser.wrapKey, sealed, { device: PAIR, coach: COACH, keyId: KEY_ID, coachPub: x.rec.public_key });
    assert.ok(bad, 'elle s\'ouvre (mêmes données liées)…');
    assert.equal(await app.plinkKeyMatches(bad, x.rec.public_key), false, '… mais ne correspond pas à la clé publique du coach : refusée');
    assert.equal(await app.plinkKeyMatches(priv, 'pas une clé'), false);
  });

  test('photos sur ordinateur : réponses du serveur nettoyées, nom de l\'appareil', () => {
    const pub = 'B' + 'A'.repeat(85) + 'A=';
    assert.equal(app.cleanPlinkPeek({ device_pub: pub, label: 'Chrome\u0007 sur\nWindows', state: 'waiting', expires_at: '2026-11-27T10:00:00Z' }).label, 'Chrome sur Windows');
    assert.equal(app.cleanPlinkPeek({ device_pub: 'x', state: 'waiting' }), null);
    assert.equal(app.cleanPlinkPeek({ device_pub: pub, state: 'perdu' }), null);
    assert.equal(app.cleanPlinkStatus({ state: 'waiting', epk: null }).state, 'waiting');
    assert.equal(app.cleanPlinkStatus({ state: 'offered', epk: 'mauvaise' }), null, 'offre sans clé valable');
    assert.equal(app.cleanPlinkStatus({ state: 'done', epk: pub }), null, 'fini sans appareil');
    assert.equal(app.cleanPlinkStatus({ state: 'done', epk: pub, device: PAIR }).device, PAIR);
    assert.equal(app.cleanPlinkDevice({ id: PAIR, key_id: KEY_ID, wrapped: 'A'.repeat(80), iv: 'A'.repeat(16) }).id, PAIR);
    assert.equal(app.cleanPlinkDevice({ id: PAIR, key_id: KEY_ID, wrapped: '<script>', iv: 'A'.repeat(16) }), null);
    assert.equal(app.cleanPlinkDevices([{ id: PAIR, label: 'x'.repeat(90), created_at: '2026-11-01T00:00:00Z' }, { id: 'nope' }]).length, 1);
    assert.equal(Array.from(app.cleanPlinkDevices([{ id: PAIR, label: 'é'.repeat(90) }])[0].label).length, 60);
    assert.equal(app.plinkLabelClean('   '), 'Ordinateur');
    const ua = {
      'Chrome sur Windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      'Edge sur Windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0',
      'Safari sur Mac': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      'Firefox sur Linux': 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
      'Chrome sur Android': 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    };
    for (const [want, s] of Object.entries(ua)) assert.equal(app.plinkLabel(s), want);
  });

  test('photos sur ordinateur : chaque erreur levée par la migration est reconnue par l\'app et le site', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261127040000_photos_web_appairage.sql'), 'utf8');
    const kinds = [...new Set([...sql.matchAll(/raise exception '([a-z_]+)'/g)].map(m => m[1]))];
    assert.ok(kinds.includes('already_used') && kinds.includes('no_key') && kinds.length >= 7, kinds.join(', '));
    for (const k of kinds) assert.equal(app.coachErrorKind({ message: k, code: 'P0001' }), k, `${k} reconnu`);
    // Chaque cas a son texte, sur l'iPhone et (pour ceux qu'il peut voir) sur le site
    for (const k of ['already_used', 'not_found', 'too_many', 'rate_limited', 'disabled', 'key_changed']) assert.ok(app.plinkErrorText(k === 'already_used' ? 'used' : k === 'not_found' ? 'expired' : k), k);
  });

  // ── QR code (coach-web/js/desk/qr.js) ──
  const qctx = vm.createContext({ TextEncoder, esc: s => String(s) });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'coach-web/js/desk/qr.js'), 'utf8'), qctx);
  const q = code => vm.runInContext(code, qctx);
  const bch = (bits, n, poly, deg) => { let r = bits >>> deg; for (let i = 0; i < deg; i++) r = (r << 1) ^ ((r >>> (deg - 1)) * poly); return ((bits >>> deg) << deg) | (r & ((1 << deg) - 1)); };

  test('photos sur ordinateur : QR code conforme (taille, repères, format, version)', () => {
    for (const [len, version] of [[5, 1], [60, 4], [120, 7], [162, 9], [200, 10]]) {
      const m = q(`deskQrMatrix(${JSON.stringify('x'.repeat(len))})`);
      const n = m.length;
      assert.equal(n, version * 4 + 17, `${len} caractères : version ${version}`);
      // Trois repères 7×7 : bord sombre, anneau clair, cœur 3×3 sombre ; séparateur clair
      for (const [x0, y0] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
        for (let d = 0; d < 7; d++) { assert.ok(m[y0][x0 + d] && m[y0 + 6][x0 + d] && m[y0 + d][x0] && m[y0 + d][x0 + 6], 'bord du repère'); }
        for (let d = 1; d < 6; d++) assert.ok(!m[y0 + 1][x0 + d] && !m[y0 + 5][x0 + d], 'anneau clair');
        for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) assert.ok(m[y0 + y][x0 + x], 'cœur sombre');
      }
      for (let i = 8; i < n - 8; i++) { assert.equal(m[6][i], i % 2 === 0, 'ligne de cadence'); assert.equal(m[i][6], i % 2 === 0, 'colonne de cadence'); }
      assert.ok(m[n - 8][8], 'module toujours sombre');
      // Format : les deux copies identiques, BCH valable, correction M
      let a = 0, b = 0;
      const A = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
      A.forEach(([x, y], i) => { if (m[y][x]) a |= 1 << i; });
      for (let i = 0; i < 8; i++) if (m[8][n - 1 - i]) b |= 1 << i;
      for (let i = 8; i < 15; i++) if (m[n - 15 + i][8]) b |= 1 << i;
      assert.equal(a, b, 'deux copies du format');
      const f = a ^ 0x5412;
      assert.equal(bch(f, 15, 0x537, 10), f, 'BCH du format');
      assert.equal(f >>> 13, 0b00, 'correction M');
      if (version >= 7) {
        let v = 0;
        for (let i = 0; i < 18; i++) if (m[Math.floor(i / 3)][n - 11 + (i % 3)]) v |= 1 << i;
        assert.equal(v >>> 12, version, 'version écrite');
        assert.equal(bch(v, 18, 0x1F25, 12), v, 'BCH de la version');
      }
    }
    assert.equal(q(`deskQrMatrix(${JSON.stringify('x'.repeat(300))})`), null, 'trop long : refusé');
    const svg = q(`deskQrSvg('MDLF1.test', 'QR code')`);
    assert.match(svg, /^<svg class="qr" viewBox="0 0 29 29" role="img" aria-label="QR code"/);
    assert.match(svg, /class="qr-bg"/);
    assert.doesNotMatch(svg, /style=/, 'aucun style en ligne (CSP)');
  });
}
