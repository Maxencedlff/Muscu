// ═══════════════════════════════════════════════════════════
//  Coffre à photos (js/data/photo-vault.js) : code, chiffrement, essais, verrouillage
// ═══════════════════════════════════════════════════════════
//
// Codes de test fictifs (jamais un vrai code). Les calculs de clé utilisent le vrai nombre de tours
// (600 000) quand c'est le comportement testé, sinon 1 000 pour garder la suite rapide.
// IndexedDB n'existe pas sous Node : photoMetaGet / photoMetaPut sont remplacés par une table en mémoire.

const FAKE_CODE = '480213';
const FAKE_OTHER = '975318';
const FAST = { iter: 1000 };

export default function ({ test, run, assert, app }) {
  test('coffre : forme du code et codes trop simples refusés', () => {
    assert.equal(app.vaultCodeShape(FAKE_CODE), true);
    for (const bad of ['12345', '1234567', '12a456', '', null, 123456]) assert.equal(app.vaultCodeShape(bad), false, `forme refusée : ${bad}`);
    for (const weak of ['000000', '111111', '123456', '654321', '123123', '121212', '345678']) assert.equal(app.vaultCodeTooSimple(weak), true, `trop simple : ${weak}`);
    for (const ok of [FAKE_CODE, FAKE_OTHER, '102938']) assert.equal(app.vaultCodeTooSimple(ok), false, `accepté : ${ok}`);
  });

  test('coffre : délais croissants après 4 erreurs, plafond à 1 h, horloge reculée', () => {
    assert.deepEqual([1, 2, 3, 4].map(n => app.vaultDelayFor(n)), [0, 0, 0, 0], '4 erreurs libres');
    assert.deepEqual([5, 6, 7, 8, 9, 12].map(n => app.vaultDelayFor(n)), [30_000, 60_000, 300_000, 900_000, 3_600_000, 3_600_000]);
    const T = 1_760_000_000_000;
    let t = null;
    for (let i = 0; i < 5; i++) t = app.vaultAfterFail(t, T);
    assert.equal(t.n, 5);
    assert.equal(app.vaultWaitMs(t, T), 30_000, '5e erreur : 30 s');
    assert.equal(app.vaultWaitMs(t, T + 10_000), 20_000);
    assert.equal(app.vaultWaitMs(t, T + 31_000), 0, 'attente finie');
    assert.equal(app.vaultWaitMs(t, T - 3_600_000), 30_000, 'heure reculée : l\'attente repart en entier, pas à zéro');
    assert.equal(app.vaultFreeLeft({ n: 3 }), 1);
    assert.equal(app.vaultFreeLeft({ n: 7 }), 0);
    assert.equal(app.vaultWaitMs(null, T), 0);
  });

  test('coffre : 600 000 tours PBKDF2 par défaut, code jamais stocké, bon code ouvre, faux code non', async () => {
    const { meta, dek } = await run(`vaultCreate('${FAKE_CODE}')`);
    assert.equal(meta.iter, 600_000);
    const json = JSON.stringify(meta);
    assert.ok(!json.includes(FAKE_CODE), 'le code n\'apparaît pas dans les réglages');
    assert.equal(app.b64ToBytes(meta.salt).length, 16, 'sel de 128 bits');
    assert.equal(app.b64ToBytes(meta.wrapIv).length, 12, 'IV de 96 bits');
    assert.equal(app.b64ToBytes(meta.wrapped).length, 32 + 16, 'clé de 256 bits emballée + étiquette GCM');
    assert.equal(dek.algorithm.name, 'AES-GCM');
    app.__meta = meta;
    assert.ok(await run(`vaultOpen(__meta, '${FAKE_CODE}')`), 'bon code');
    assert.equal(await run(`vaultOpen(__meta, '${FAKE_OTHER}')`), null, 'faux code');
    assert.equal(await run(`vaultOpen(__meta, 'abc')`), null, 'code mal formé');
    assert.equal(await run(`vaultOpen({ ...__meta, wrapped: __meta.wrapped.slice(0, -4) + 'AAAA' }, '${FAKE_CODE}')`), null, 'réglages abîmés');
  });

  test('coffre : deux coffres du même code ont des sels et des clés différents', async () => {
    const a = await run(`vaultCreate('${FAKE_CODE}', { iter: 1000 })`);
    const b = await run(`vaultCreate('${FAKE_CODE}', { iter: 1000 })`);
    assert.notEqual(a.meta.salt, b.meta.salt);
    assert.notEqual(await app.vaultDekB64(a.dek), await app.vaultDekB64(b.dek));
  });

  test('coffre : photo chiffrée puis rendue à l\'identique, liée à son identifiant et à sa date', async () => {
    const { dek } = await app.vaultCreate(FAKE_CODE, FAST);
    app.__dek = dek;
    const jpeg = new Uint8Array(5000).map((_, i) => (i * 7) & 255);
    app.__rec = { id: 'phA', date: 1_760_000_000_000, pose: 'side', bytes: jpeg.length, w: 900, h: 1200, type: 'image/jpeg', buf: jpeg.buffer };
    const row = await run('photoSeal(__dek, __rec)');
    assert.deepEqual(Object.keys(row).sort(), ['date', 'enc', 'id', 'iv'], 'en clair : identifiant, date, IV seulement');
    const enc = new Uint8Array(row.enc);
    assert.ok(!Buffer.from(enc).includes(Buffer.from('side')) && !Buffer.from(enc).includes(Buffer.from(jpeg.subarray(0, 64))), 'pose et octets chiffrés');
    app.__row = row;
    const back = await run('photoUnseal(__dek, __row)');
    assert.equal(back.pose, 'side');
    assert.equal(back.w, 900);
    assert.deepEqual(new Uint8Array(await back.blob.arrayBuffer()), jpeg);
    assert.equal(await run(`photoUnseal(__dek, { ...__row, id: 'phB' })`), null, 'ligne recopiée sous un autre identifiant');
    assert.equal(await run(`photoUnseal(__dek, { ...__row, date: __row.date + 1 })`), null, 'date modifiée');
    const other = await app.vaultCreate(FAKE_CODE, FAST);
    app.__dek2 = other.dek;
    assert.equal(await run('photoUnseal(__dek2, __row)'), null, 'clé d\'un autre coffre');
    const row2 = await run('photoSeal(__dek, __rec)');
    assert.notEqual(row2.iv, row.iv, 'IV neuf à chaque chiffrement');
  });

  test('coffre : changer de code garde la clé (photos lisibles), l\'ancien code ne marche plus', async () => {
    const { meta, dek } = await app.vaultCreate(FAKE_CODE, FAST);
    app.__meta = meta; app.__dek = dek;
    const meta2 = await run(`vaultRewrap(__meta, __dek, '${FAKE_OTHER}', { iter: 1000 })`);
    app.__meta2 = meta2;
    assert.equal(meta2.check, meta.check, 'même témoin : même clé');
    assert.notEqual(meta2.salt, meta.salt, 'nouveau sel');
    assert.equal(await run(`vaultOpen(__meta2, '${FAKE_CODE}')`), null, 'ancien code refusé');
    const k = await run(`vaultOpen(__meta2, '${FAKE_OTHER}')`);
    assert.equal(await app.vaultDekB64(k), await app.vaultDekB64(dek), 'nouveau code : même clé du coffre');
  });

  test('coffre : clé rendue par Face ID vérifiée par le témoin', async () => {
    const { meta, dek } = await app.vaultCreate(FAKE_CODE, FAST);
    const other = await app.vaultCreate(FAKE_CODE, FAST);
    assert.equal(await app.vaultCheckKey(meta, dek), true);
    assert.equal(await app.vaultCheckKey(meta, other.dek), false, 'clé d\'un autre coffre refusée');
  });

  // Table en mémoire à la place d'IndexedDB pour les opérations du coffre
  function fakeStore() {
    run(`(() => {
      const t = new Map();
      globalThis.__store = t;
      photoMetaGet = async k => t.get(k) || null;
      photoMetaPut = async r => { t.set(r.k, JSON.parse(JSON.stringify(r))); };
      legacyPhotosAll = async () => [];
      legacyPhotosDrop = async () => true;
    })()`);
  }

  test('coffre : erreur comptée avant le calcul, remise à zéro après un succès, attente respectée', async () => {
    fakeStore();
    const { meta } = await app.vaultCreate(FAKE_CODE, FAST);
    app.__meta = meta;
    await run(`photoMetaPut(__meta)`);
    const T = 1_760_000_000_000;
    // Pendant le calcul, l'erreur est déjà enregistrée
    run(`(() => { const put = photoMetaPut; globalThis.__seen = []; photoMetaPut = async r => { if (r.k === 'tries') __seen.push(r.n); return put(r); }; })()`);
    let r = await run(`vaultTryCode('${FAKE_OTHER}', ${T})`);
    assert.equal(r.ok, false);
    assert.deepEqual([...run('__seen')], [1], 'erreur écrite avant le résultat');
    for (let i = 0; i < 3; i++) r = await run(`vaultTryCode('${FAKE_OTHER}', ${T + i + 1})`);
    assert.equal(r.left, 0);
    assert.equal(r.wait, 0, '4 erreurs : pas encore d\'attente');
    r = await run(`vaultTryCode('${FAKE_OTHER}', ${T + 10})`);
    assert.equal(r.wait, 30_000, '5e erreur : 30 s');
    r = await run(`vaultTryCode('${FAKE_CODE}', ${T + 20})`);
    assert.equal(r.ok, false, 'bon code refusé pendant l\'attente');
    assert.ok(r.wait > 0);
    r = await run(`vaultTryCode('${FAKE_CODE}', ${T + 40_000})`);
    assert.equal(r.ok, true, 'bon code après l\'attente');
    assert.equal(run(`__store.get('tries').n`), 0, 'compteur remis à zéro');
  });

  test('coffre : verrouillage manuel et après une minute d\'inactivité, clé effacée', async () => {
    const { dek } = await app.vaultCreate(FAKE_CODE, FAST);
    app.__dek = dek;
    const reasons = [];
    app.__onLock = r => reasons.push(r);
    run('onVaultLock(r => __onLock(r))');
    run('vaultSetOpen(__dek)');
    assert.equal(run('vaultIsOpen()'), true);
    assert.equal(run('vaultLock("manual")'), true);
    assert.equal(run('vaultIsOpen()'), false);
    assert.equal(run('vaultLock("manual")'), false, 'déjà fermé : rien');
    await assert.rejects(run('vaultPhotos()'), /coffre fermé/, 'aucune lecture coffre fermé');
    // Inactivité : minuteur réel raccourci le temps du test
    const saved = run('VAULT_IDLE_MS');
    assert.equal(saved, 60_000, 'une minute');
    run(`globalThis.__st = setTimeout; globalThis.setTimeout = (fn, ms) => __st(fn, ms === VAULT_IDLE_MS ? 20 : ms);`);
    run('vaultSetOpen(__dek)');
    await new Promise(res => setTimeout(res, 60));
    assert.equal(run('vaultIsOpen()'), false, 'refermé après l\'inactivité');
    assert.deepEqual(reasons, ['manual', 'idle']);
    run('globalThis.setTimeout = __st');
  });
  test('coffre : verrouillé pendant le calcul du code, il reste fermé', async () => {
    fakeStore();
    const { meta } = await app.vaultCreate(FAKE_CODE, FAST);
    app.__meta = meta;
    await run('photoMetaPut(__meta)');
    run('vaultLock("manual")');
    const pending = run(`vaultUnlockWithCode('${FAKE_CODE}')`);
    run('vaultLock("background")');   // l'app part en arrière-plan avant la fin du calcul
    const r = await pending;
    assert.equal(r.ok, false);
    assert.equal(r.stale, true);
    assert.equal(run('vaultIsOpen()'), false, 'aucune clé en mémoire');
    const r2 = await run(`vaultUnlockWithCode('${FAKE_CODE}')`);
    assert.equal(r2.ok, true, 'essai suivant : ouvert');
    run('vaultLock("manual")');
  });
}
