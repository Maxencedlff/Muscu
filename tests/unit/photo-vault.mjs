// ═══════════════════════════════════════════════════════════
//  Coffre à photos (js/data/photo-vault.js) : clé du trousseau, chiffrement, verrouillage
// ═══════════════════════════════════════════════════════════
//
// Le trousseau iCloud n'existe pas ici : Native.vault est remplacé par un faux module, une clé de test tirée
// au hasard par identifiant de coffre (jamais une vraie clé). IndexedDB n'existe pas sous Node non plus :
// photoMetaGet / photoMetaPut / photoPutRow / photoRowsAll sont remplacés par des tables en mémoire.

export default function ({ test, run, assert, app }) {
  const randomKeyB64 = () => app.bytesToB64(app.vaultRandom(32));
  const plain = o => JSON.parse(JSON.stringify(o));   // objet né dans le contexte de l'app → comparable ici

  // Faux module natif : réponses programmables ({ key } ou un refus), appels notés
  function fakeVault({ create, unlock } = {}) {
    app.__fakeCreate = create || (async () => ({ key: app.__fakeKey }));
    app.__fakeUnlock = unlock || (async () => (app.__fakeKey ? { key: app.__fakeKey } : { missing: true }));
    app.__fakeKey = randomKeyB64();
    app.__calls = [];
    app.__ids = [];
    run(`(() => {
      Native.vault.available = true;
      Native.vault.create = async (reason, id) => { __calls.push('create'); __ids.push(id); return __fakeCreate(reason, id); };
      Native.vault.unlock = async (reason, id) => { __calls.push('unlock'); __ids.push(id); return __fakeUnlock(reason, id); };
      Native.vault.forget = async id => { __calls.push('forget:' + id); __fakeKey = null; };
      Native.vault.shield = () => {};
    })()`);
  }
  // Tables en mémoire à la place d'IndexedDB
  function fakeStore({ legacy = [] } = {}) {
    app.__legacy = legacy;
    run(`(() => {
      const meta = new Map(), rows = new Map();
      globalThis.__meta = meta; globalThis.__rows = rows;
      photoMetaGet = async k => meta.get(k) || null;
      photoMetaPut = async r => { meta.set(r.k, JSON.parse(JSON.stringify(r))); };
      photoPutRow = async r => { rows.set(r.id, r); };
      photoRowsAll = async () => [...rows.values()];
      photoRowsCount = async () => rows.size;
      photosWipe = async ({ legacy = true } = {}) => { meta.clear(); rows.clear(); if (legacy) __legacy = []; return true; };
      legacyPhotosAll = async () => __legacy;
      legacyPhotosDrop = async () => { __legacy = []; return true; };
    })()`);
  }

  test('coffre : plus de code propre à l\'app, ni PBKDF2 ni délais', () => {
    const src = run('[vaultSetup, vaultUnlock, vaultReset, vaultImportKey].map(String).join("\\n")');
    assert.ok(!/PBKDF2|iterations|VAULT_CODE_LEN|tries/.test(src), 'aucune trace du code à 6 chiffres');
    for (const gone of ['vaultTryCode', 'vaultCodeTooSimple', 'vaultRewrap', 'vaultDelayFor']) {
      assert.equal(run(`typeof ${gone}`), 'undefined', `${gone} retiré`);
    }
  });

  test('coffre : clé de 32 octets importée non extractible, autre taille refusée', async () => {
    app.__k = randomKeyB64();
    const dek = await run('vaultImportKey(__k)');
    assert.equal(dek.algorithm.name, 'AES-GCM');
    assert.equal(dek.extractable, false, 'clé jamais ré-exportable depuis le JS');
    assert.equal(await run(`vaultImportKey(${JSON.stringify(app.bytesToB64(new Uint8Array(16)))})`), null, '16 octets refusés');
    assert.equal(await run('vaultImportKey("pas du base64 !")'), null, 'texte illisible refusé');
    assert.equal(await run('vaultImportKey(null)'), null);
  });

  test('coffre : réglages sans aucune clé, témoin qui reconnaît la bonne clé seulement', async () => {
    app.__k1 = randomKeyB64(); app.__k2 = randomKeyB64();
    const dek = await run('vaultImportKey(__k1)');
    app.__dek = dek;
    const meta = await run('vaultCreateMeta(__dek, "0123456789abcdef0123456789abcdef", 1760000000000)');
    assert.deepEqual(Object.keys(meta).sort(), ['check', 'checkIv', 'created', 'id', 'k', 'v']);
    assert.equal(meta.id, '0123456789abcdef0123456789abcdef');
    assert.ok(!JSON.stringify(meta).includes(app.__k1), 'la clé n\'est pas dans les réglages');
    app.__meta = meta;
    assert.equal(await run('vaultCheckKey(__meta, __dek)'), true);
    assert.equal(await run('vaultImportKey(__k2).then(k => vaultCheckKey(__meta, k))'), false, 'clé d\'un autre coffre refusée');
  });

  test('coffre : photo chiffrée puis rendue à l\'identique, liée à son identifiant et à sa date', async () => {
    app.__k = randomKeyB64();
    app.__dek = await run('vaultImportKey(__k)');
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
    app.__k2 = randomKeyB64();
    assert.equal(await run('vaultImportKey(__k2).then(k => photoUnseal(k, __row))'), null, 'clé d\'un autre coffre');
    const row2 = await run('photoSeal(__dek, __rec)');
    assert.notEqual(row2.iv, row.iv, 'IV neuf à chaque chiffrement');
  });

  test('coffre : création par le trousseau, photos en clair rangées puis ancienne base supprimée', async () => {
    const jpeg = new Uint8Array(300).fill(0xAB);
    fakeStore({ legacy: [{ id: 'phold1', date: 1_750_000_000_000, pose: 'face', bytes: 300, w: 30, h: 40, type: 'image/jpeg', buf: jpeg.buffer }] });
    fakeVault();
    run('vaultLock("manual")');
    const r = await run('vaultSetup()');
    assert.deepEqual({ ok: r.ok, migrated: r.migrated }, { ok: true, migrated: 1 });
    assert.deepEqual(app.__calls, ['create']);
    assert.equal(run('vaultIsOpen()'), true);
    const meta = run('__meta.get("vault")');
    assert.match(meta.id, /^[0-9a-f]{32}$/, 'identifiant de clé de 128 bits');
    assert.equal(app.__ids[0], meta.id, 'clé demandée sous l\'identifiant du coffre');
    assert.ok(!meta.pending && meta.check, 'réglages complets');
    assert.equal(run('__legacy.length'), 0, 'ancienne base supprimée après la migration');
    const { photos } = await run('vaultPhotos()');
    assert.equal(photos.length, 1);
    assert.equal(photos[0].id, 'phold1');
    await assert.rejects(run('vaultSetup()'), /déjà créé/, 'jamais un second coffre par-dessus le premier');
    run('vaultLock("manual")');
  });

  test('coffre : création refusée par iOS, seul l\'identifiant est écrit, photos en clair gardées, même clé au nouvel essai', async () => {
    const jpeg = new Uint8Array(10).fill(1);
    fakeStore({ legacy: [{ id: 'phold1', date: 1, pose: 'face', bytes: 10, w: 1, h: 1, type: 'image/jpeg', buf: jpeg.buffer }] });
    let firstId = null;
    for (const refusal of [{ canceled: true }, { nopasscode: true }, { failed: true }, null]) {
      fakeVault({ create: async () => refusal });
      const r = await run('vaultSetup()');
      assert.equal(r.ok, false);
      if (refusal) assert.equal(r[Object.keys(refusal)[0]], true, `raison gardée : ${JSON.stringify(refusal)}`);
      else assert.equal(r.failed, true);
      const m = await run('vaultMeta()');
      assert.ok(m.pending && !m.check, 'seulement l\'identifiant, sans témoin');
      app.__m = m;
      assert.equal(run('vaultReady(__m)'), false, 'coffre pas créé');
      firstId ||= m.id;
      assert.equal(app.__ids[0], firstId, 'chaque essai demande la même clé : jamais une 2e clé orpheline');
      assert.equal(run('__legacy.length'), 1, 'photos en clair gardées');
      assert.equal(run('vaultIsOpen()'), false);
    }
    fakeVault();
    assert.equal((await run('vaultSetup()')).ok, true, 'essai réussi');
    assert.equal(app.__ids[0], firstId, 'avec l\'identifiant écrit au premier essai');
    run('vaultLock("manual")');
  });

  test('coffre : ouverture par le trousseau, clé absente ou d\'un autre coffre = « illisible »', async () => {
    fakeStore();
    fakeVault();
    await run('vaultSetup()');
    run('vaultLock("manual")');
    let r = await run('vaultUnlock()');
    assert.equal(r.ok, true, 'même clé : ouvert');
    run('vaultLock("manual")');
    app.__fakeUnlock = async () => ({ canceled: true });
    r = await run('vaultUnlock()');
    assert.deepEqual(plain(r), { ok: false, canceled: true }, 'Face ID annulé : fermé, sans message d\'erreur');
    app.__fakeUnlock = async () => ({ missing: true });
    r = await run('vaultUnlock()');
    assert.deepEqual(plain(r), { ok: false, missing: true }, 'clé absente du trousseau (nouvel iPhone)');
    app.__other = randomKeyB64();
    app.__fakeUnlock = async () => ({ key: app.__other });
    r = await run('vaultUnlock()');
    assert.deepEqual(plain(r), { ok: false, missing: true }, 'clé d\'un autre coffre : illisible aussi');
    assert.equal(run('vaultIsOpen()'), false);
  });

  test('coffre : vidé quand il est illisible, sans toucher à la clé ni aux photos en clair ; tout supprimer retire la clé', async () => {
    const jpeg = new Uint8Array(10).fill(2);
    fakeStore();
    fakeVault();
    await run('vaultSetup()');
    const id = run('__meta.get("vault").id');
    app.__legacy = [{ id: 'phold9', date: 2, pose: 'back', bytes: 10, w: 1, h: 1, type: 'image/jpeg', buf: jpeg.buffer }];
    run('vaultLock("manual")');
    assert.equal(await run('vaultReset({ keep: true })'), true);
    assert.equal(await run('vaultMeta()'), null);
    assert.equal(run('__rows.size'), 0);
    assert.equal(run('__legacy.length'), 1, 'photo en clair gardée pour le prochain coffre');
    assert.ok(!app.__calls.some(c => c.startsWith('forget')), 'clé laissée : elle peut encore servir à un autre iPhone');
    await run('vaultSetup()');
    const id2 = run('__meta.get("vault").id');
    assert.notEqual(id2, id, 'nouveau coffre, nouvelle clé : aucun conflit avec l\'ancienne dans le trousseau iCloud');
    await run('vaultReset()');
    assert.ok(app.__calls.includes(`forget:${id2}`), '« Supprimer toutes les données » : clé de ce coffre retirée');
    assert.equal(run('__legacy.length'), 0, '« Supprimer toutes les données » : tout part');
  });

  test('coffre : verrouillage manuel et après une minute d\'inactivité, clé effacée', async () => {
    app.__k = randomKeyB64();
    app.__dek = await run('vaultImportKey(__k)');
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
    assert.equal(run('VAULT_IDLE_MS'), 60_000, 'une minute');
    run(`globalThis.__st = setTimeout; globalThis.setTimeout = (fn, ms) => __st(fn, ms === VAULT_IDLE_MS ? 20 : ms);`);
    run('vaultSetOpen(__dek)');
    await new Promise(res => setTimeout(res, 60));
    assert.equal(run('vaultIsOpen()'), false, 'refermé après l\'inactivité');
    assert.deepEqual(reasons.slice(-2), ['manual', 'idle']);
    run('globalThis.setTimeout = __st');
  });

  test('coffre : verrouillé pendant la feuille de Face ID, il reste fermé', async () => {
    fakeStore();
    fakeVault();
    await run('vaultSetup()');
    run('vaultLock("manual")');
    let release;
    app.__fakeUnlock = () => new Promise(res => { release = () => res({ key: app.__fakeKey }); });
    const pending = run('vaultUnlock()');
    await new Promise(res => setImmediate(res));
    run('vaultLock("background")');   // l'app part en arrière-plan pendant la feuille d'iOS
    release();
    const r = await pending;
    assert.deepEqual(plain(r), { ok: false, stale: true });
    assert.equal(run('vaultIsOpen()'), false, 'aucune clé en mémoire');
    app.__fakeUnlock = async () => ({ key: app.__fakeKey });
    assert.equal((await run('vaultUnlock()')).ok, true, 'essai suivant : ouvert');
    run('vaultLock("manual")');
  });

  test('coffre : indisponible sans le module natif', () => {
    run('Native.vault.available = false');
    assert.equal(run('vaultAvailable()'), false);
    run('Native.vault.available = true');
    assert.equal(run('vaultAvailable()'), true);
  });
}
