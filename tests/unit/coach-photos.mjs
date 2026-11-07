// ═══════════════════════════════════════════════════════════
//  Photos de bilan (js/data/coach-photos.js) : métadonnées d'un JPEG, chiffrement de bout en bout, clé du coach,
//  nettoyage de ce que renvoie le serveur. Secrets et clés tirés au hasard par le test (jamais une vraie clé) ;
//  JPEG construits octet par octet (aucune vraie photo). Le contrôle sur un vrai JPEG avec GPS, redessiné par
//  le navigateur, est dans tests/test_photos_bilan.py.
// ═══════════════════════════════════════════════════════════

export default function ({ test, run, assert, app, sameJSON }) {
  const plain = o => JSON.parse(JSON.stringify(o));
  // Segment JPEG : marqueur, longueur, charge
  const seg = (m, bytes) => [0xFF, m, ((bytes.length + 2) >> 8) & 0xFF, (bytes.length + 2) & 0xFF, ...bytes];
  const ascii = s => [...s].map(c => c.charCodeAt(0));
  const JFIF = seg(0xE0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const DQT = seg(0xDB, [0, ...new Array(64).fill(1)]);
  const SOF = seg(0xC0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
  const SOS = seg(0xDA, [1, 1, 0, 0, 63, 0]);
  // Données de l'image avec un octet FF « bourré » (FF00) et un marqueur de reprise (FFD0)
  const SCAN = [0x12, 0xFF, 0x00, 0x34, 0xFF, 0xD0, 0x56];
  const jpeg = (...head) => new Uint8Array([0xFF, 0xD8, ...head.flat(), ...SOS, ...SCAN, 0xFF, 0xD9]);
  const EXIF_GPS = seg(0xE1, [...ascii('Exif'), 0, 0, ...ascii('MM'), 0, 42, 0, 0, 0, 8, ...ascii('GPS 48.85N 2.35E')]);

  test('photos de bilan : JPEG sans métadonnées accepté, EXIF, XMP, IPTC, commentaire refusés', () => {
    assert.equal(app.jpegMetaFree(jpeg(JFIF, DQT, SOF)), true, 'JPEG propre');
    assert.equal(app.jpegMetaFree(jpeg(JFIF, seg(0xE2, [...ascii('ICC_PROFILE'), 0, 1, 1]), DQT, SOF)), true, 'profil de couleur permis');
    assert.equal(app.jpegMetaFree(jpeg(JFIF, EXIF_GPS, DQT, SOF)), false, 'EXIF (localisation)');
    assert.equal(app.jpegMetaFree(jpeg(EXIF_GPS, JFIF, DQT, SOF)), false, 'EXIF en tête');
    assert.equal(app.jpegMetaFree(jpeg(JFIF, seg(0xE1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>')), DQT, SOF)), false, 'XMP');
    assert.equal(app.jpegMetaFree(jpeg(JFIF, seg(0xED, ascii('Photoshop 3.0\0')), DQT, SOF)), false, 'IPTC');
    assert.equal(app.jpegMetaFree(jpeg(JFIF, seg(0xFE, ascii('iPhone 15')), DQT, SOF)), false, 'commentaire');
    assert.equal(app.jpegMetaFree(jpeg(JFIF, seg(0xE2, ascii('MPF\0')), DQT, SOF)), false, 'APP2 autre que le profil (MPF)');
    // Octets après la fin de l'image (une seconde image, ses métadonnées) : refusé
    assert.equal(app.jpegMetaFree(new Uint8Array([...jpeg(JFIF, DQT, SOF), ...EXIF_GPS])), false, 'données après la fin');
    // Métadonnées entre deux passes d'une image progressive : vues aussi
    const prog = new Uint8Array([0xFF, 0xD8, ...JFIF, ...DQT, ...SOF, ...SOS, 1, 2, ...EXIF_GPS, ...SOS, 3, 4, 0xFF, 0xD9]);
    assert.equal(app.jpegMetaFree(prog), false, 'EXIF entre deux passes');
    assert.equal(app.jpegMetaFree(new Uint8Array([0x89, 0x50, 0x4E, 0x47])), false, 'PNG');
    assert.equal(app.jpegMetaFree(new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])), false, 'sans image');
    assert.equal(app.jpegMetaFree(jpeg(JFIF, DQT, SOF).subarray(0, 30)), false, 'tronqué');
    assert.equal(app.jpegMetaFree(new Uint8Array(0)), false, 'vide');
  });

  // Clé du coach et photo chiffrée de bout en bout
  const secret = () => app.vaultImportKey(app.bytesToB64(app.vaultRandom(32)));
  const COACH = '00000000-0000-0000-0000-0000000000c1', STUDENT = '00000000-0000-0000-0000-0000000000e1';
  const KEY_ID = 'ab'.repeat(16);
  const meta = (o = {}) => ({ id: '0d9c3f0e-6a52-4bfb-9a51-6b1f6d9e2a10', student: STUDENT, coach: COACH, keyId: KEY_ID, takenOn: '2026-11-05', pose: 'face', ...o });
  const photo = () => jpeg(JFIF, DQT, SOF);

  test('photos de bilan : clé du coach chiffrée par son trousseau, rouverte et vérifiée', async () => {
    const s = await secret();
    const { rec, priv } = await app.coachKeyMake(s, COACH, KEY_ID);
    assert.match(rec.public_key, /^B[A-P][A-Za-z0-9+/]{84}[AEIMQUYcgkosw048]=$/, 'clé publique : 65 octets, point non compressé (forme du serveur)');
    assert.match(rec.wrap_iv, /^[A-Za-z0-9+/]{16}$/);
    assert.ok(rec.wrapped_key.length >= 40 && rec.wrapped_key.length <= 400, `clé enveloppée de ${rec.wrapped_key.length} caractères`);
    assert.equal(priv.extractable, false, 'clé privée non extractible');
    assert.ok(!JSON.stringify(rec).includes('"d"'), 'rien de la clé privée en clair');
    const again = await app.coachKeyOpen(s, COACH, rec);
    assert.ok(again && again.extractable === false, 'rouverte avec le secret');
    assert.equal(await app.coachKeyOpen(await secret(), COACH, rec), null, 'autre secret (autre trousseau)');
    assert.equal(await app.coachKeyOpen(s, '00000000-0000-0000-0000-0000000000c2', rec), null, 'clé recopiée pour un autre coach');
    // Le serveur remplace la clé publique : la clé privée ne correspond plus, l'app du coach le voit
    const other = await app.coachKeyMake(s, COACH, KEY_ID);
    assert.equal(await app.coachKeyOpen(s, COACH, { ...rec, public_key: other.rec.public_key }), null, 'clé publique substituée');
    const code = await app.coachKeyCode(rec.public_key);
    assert.match(code, /^[0-9A-F]{4}( [0-9A-F]{4}){3}$/, `code de la clé « ${code} »`);
    assert.equal(await app.coachKeyCode(rec.public_key), code, 'même code des deux côtés');
    assert.notEqual(await app.coachKeyCode(other.rec.public_key), code);
  });

  test('photos de bilan : photo chiffrée pour le coach, une clé par photo, données liées', async () => {
    const s = await secret();
    const { rec, priv } = await app.coachKeyMake(s, COACH, KEY_ID);
    const session = { priv, pub: rec.public_key, keyId: KEY_ID };
    const bytes = photo();
    const a = await app.coachPhotoSeal(rec.public_key, bytes, meta());
    const b = await app.coachPhotoSeal(rec.public_key, bytes, meta());
    assert.notEqual(a.epk, b.epk, 'clé éphémère neuve à chaque photo');
    assert.notEqual(a.iv, b.iv);
    assert.equal(a.ct.length, bytes.length + 16, 'chiffré + étiquette');
    assert.ok(!Buffer.from(a.ct).includes(Buffer.from('JFIF')), 'rien du JPEG en clair');
    const out = await app.coachPhotoOpen(session, { epk: a.epk, iv: a.iv }, a.ct, meta());
    assert.deepEqual([...out], [...bytes], 'déchiffrée par le coach');
    // Ce que le serveur garde à côté du chiffré : toute modification se voit
    for (const [k, v] of [['pose', 'back'], ['takenOn', '2026-11-04'], ['student', '00000000-0000-0000-0000-0000000000e2'], ['id', '1d9c3f0e-6a52-4bfb-9a51-6b1f6d9e2a10'], ['keyId', 'cd'.repeat(16)]]) {
      assert.equal(await app.coachPhotoOpen(session, { epk: a.epk, iv: a.iv }, a.ct, meta({ [k]: v })), null, `${k} modifié`);
    }
    const flipped = a.ct.slice(); flipped[5] ^= 1;
    assert.equal(await app.coachPhotoOpen(session, { epk: a.epk, iv: a.iv }, flipped, meta()), null, 'chiffré modifié');
    assert.equal(await app.coachPhotoOpen(session, { epk: b.epk, iv: a.iv }, a.ct, meta()), null, 'clé éphémère d\'une autre photo');
    // Un autre coach (ou le serveur, sans la clé privée) ne lit rien
    const intruder = await app.coachKeyMake(s, COACH, KEY_ID);
    assert.equal(await app.coachPhotoOpen({ priv: intruder.priv, pub: rec.public_key }, { epk: a.epk, iv: a.iv }, a.ct, meta()), null, 'autre clé privée');
  });

  test('photos de bilan : réponses du serveur nettoyées (chemin, formes, poses)', () => {
    const pk = 'BA' + 'A'.repeat(84) + 'A=';
    const row = (o = {}) => ({ id: '0d9c3f0e-6a52-4bfb-9a51-6b1f6d9e2a10', path: `${STUDENT}/0d9c3f0e-6a52-4bfb-9a51-6b1f6d9e2a10`, taken_on: '2026-11-05', pose: 'face',
      epk: pk, iv: 'A'.repeat(16), key_id: KEY_ID, bytes: 1200, sent_at: '2026-11-05T10:00:00Z', ...o });
    const ok = plain(app.cleanCoachPhotos({ photos: [row()] }, STUDENT));
    assert.equal(ok.length, 1);
    assert.equal(ok[0].takenOn, '2026-11-05');
    assert.equal(plain(app.cleanCoachPhotos({ photos: [row({ path: `00000000-0000-0000-0000-0000000000e2/${row().id}` })] }, STUDENT)).length, 0, 'chemin d\'un autre élève');
    assert.equal(plain(app.cleanCoachPhotos({ photos: [row({ path: `${STUDENT}/../x` })] }, STUDENT)).length, 0, 'chemin détourné');
    assert.equal(plain(app.cleanCoachPhotos({ photos: [row({ pose: '<img>' })] }, STUDENT)).length, 0, 'pose inconnue');
    assert.equal(plain(app.cleanCoachPhotos({ photos: [row({ epk: 'AAAA' })] }, STUDENT)).length, 0, 'clé éphémère mal formée');
    assert.equal(plain(app.cleanCoachPhotos({ photos: [row({ taken_on: '05/11/2026' })] }, STUDENT)).length, 0, 'jour mal formé');
    assert.equal(plain(app.cleanCoachPhotos(null, STUDENT)).length, 0);
    const st = plain(app.cleanStudentPhotos({ coach: true, ready: true, key: { key_id: KEY_ID, public_key: pk }, photos: [{ id: row().id, taken_on: '2026-11-05', pose: 'side', bytes: 900, sent_at: '2026-11-05T10:00:00Z' }, { id: 'x' }] }));
    assert.equal(st.ready, true);
    assert.equal(st.photos.length, 1, 'ligne mal formée écartée');
    assert.equal(plain(app.cleanStudentPhotos({ coach: true, ready: true, key: { key_id: 'x', public_key: pk } })).ready, false, 'prêt sans clé valable : non');
    assert.equal(plain(app.cleanStudentPhotos({ coach: true, ready: true, key: null })).ready, false);
    // Par jour, du plus récent ; dans un jour : face, profil, dos
    const days = plain(app.cphDays([{ takenOn: '2026-11-01', pose: 'back' }, { takenOn: '2026-11-05', pose: 'back' }, { takenOn: '2026-11-05', pose: 'face' }]));
    assert.deepEqual(days.map(d => d.day), ['2026-11-05', '2026-11-01']);
    assert.deepEqual(days[0].photos.map(p => p.pose), ['face', 'back']);
  });

  test('photos de bilan : clé du coach retenue au premier envoi, changement repéré', () => {
    const pk = v => 'B' + v + 'A'.repeat(84) + 'A=';
    run(`account.user = { id: 'u-eleve' }; cph.userId = 'u-eleve'; coach.state = { coach: { user_id: 'u-coach' }, students: [], is_coach: false };`);
    run(`cph.state = { ready: true, adult: true, key: { key_id: '${'a'.repeat(32)}', public_key: '${pk('A')}' }, photos: [] }`);
    assert.equal(app.cphKeyChanged(), false, 'rien retenu : pas d\'alerte');
    app.cphPinKey(pk('A'));
    assert.equal(app.cphKeyChanged(), false, 'même clé');
    run(`cph.state.key.public_key = '${pk('B')}'`);
    assert.equal(app.cphKeyChanged(), true, 'clé changée');
    run(`coach.state.coach = { user_id: 'u-autre' }`);
    assert.equal(app.cphKeyChanged(), false, 'autre coach : rien retenu pour lui');
    run(`account.user = null; coach.state = null; cph.state = null; localStorage.clear();`);
  });

  test('photos de bilan : jamais plus de 3 photos ni deux jours dans un envoi, coffre fermé : rien', async () => {
    const p = (d, id) => ({ id, date: d, pose: 'face', blob: null });
    const day = new Date(2026, 10, 5, 9).getTime(), other = new Date(2026, 10, 6, 9).getTime();
    assert.equal(plain(await app.cphSend([p(day, 'a'), p(day, 'b'), p(day, 'c'), p(day, 'd')])).kind, 'invalid_photo', '4 photos');
    assert.equal(plain(await app.cphSend([p(day, 'a'), p(other, 'b')])).kind, 'invalid_photo', 'deux jours');
    assert.equal(plain(await app.cphSend([])).kind, 'invalid_photo', 'aucune');
    run('vaultLock("test")');
    assert.equal(plain(await app.cphSend([p(day, 'a')])).kind, 'locked', 'coffre fermé');
  });

  // ── Relecture sécurité : tranche d'âge, clé retenue, clé du coach substituée, trousseau ──

  const keyB64 = () => app.bytesToB64(app.vaultRandom(32));   // secret de test tiré au hasard (jamais une vraie clé)
  const band = { adult: { lowerBound: 18 }, teen: { lowerBound: 15, upperBound: 17 }, young: { lowerBound: 13, upperBound: 15 },
    limited: { lowerBound: 15, upperBound: 17, communicationLimits: true } };

  test('photos de bilan : tranche d\'âge d\'Apple autre que majeur → rien proposé, envoi et déclaration refusés', async () => {
    const r = await run(`(async () => {
      const st = ageRange.stored, user = account.user, sbSaved = sb, calls = [];
      try {
        account.user = { id: 'u-eleve' }; cph.userId = 'u-eleve';
        coach.state = { coach: { user_id: 'u-coach' }, students: [], is_coach: false };
        cph.state = { ready: true, adult: false, key: null, photos: [{ id: 'x' }] }; cph.missing = false;
        sb = { rpc: async fn => { calls.push(fn); return { data: null, error: null }; } };
        const out = {};
        for (const [name, b] of Object.entries(${JSON.stringify(band)})) {
          ageRange.stored = { status: 'sharing', communicationLimits: false, ...b, at: Date.now() };
          out[name] = { shown: cphStudentShown(), listed: cphStudentListed(), send: (await cphSend([{ id: 'p', date: Date.now(), pose: 'face' }])).kind,
            declare: (await cphDeclareAdult()).kind || 'ok' };
        }
        ageRange.stored = null;
        out.none = { shown: cphStudentShown() };
        ageRange.stored = { status: 'declined', at: Date.now() };
        out.declined = { shown: cphStudentShown() };
        return { out, calls };
      } finally { ageRange.stored = st; account.user = user; sb = sbSaved; coach.state = null; cph.state = null; }
    })()`);
    for (const b of ['teen', 'young', 'limited']) {
      sameJSON(r.out[b], { shown: false, listed: true, send: 'not_adult', declare: 'not_adult' }, `${b} : rien proposé, envoi et déclaration refusés`);
    }
    assert.equal(r.out.adult.shown, true, 'majeur selon Apple : proposé');
    assert.notEqual(r.out.adult.send, 'not_adult', 'majeur : l\'envoi passe la règle d\'âge (il s\'arrête plus loin : coffre fermé)');
    assert.equal(r.out.none.shown, true, 'tranche inconnue : déclaration');
    assert.equal(r.out.declined.shown, true, 'refus de partager : déclaration');
    assert.deepEqual([...r.calls].filter(c => c === 'student_photo_adult'), ['student_photo_adult'], 'déclaration envoyée au serveur pour le majeur seulement');
  });

  test('photos de bilan : clé retenue dès la première photo partie (envoi partiel), celle qui a servi, par compte', async () => {
    const s = await secret();
    const a = (await app.coachKeyMake(s, COACH, KEY_ID)).rec.public_key, b = (await app.coachKeyMake(s, COACH, KEY_ID)).rec.public_key;
    const r = await run(`(async () => {
      const saved = { coachPhotoJpeg, cphUpload, cphStorageRemove }, user = account.user, sbSaved = sb, calls = [];
      try {
        localStorage.clear();
        account.user = { id: '${STUDENT}' }; cph.userId = '${STUDENT}'; cph.busy = false; cph.loading = false; cph.missing = false;
        coach.state = { coach: { user_id: '${COACH}' }, students: [], is_coach: false };
        vaultSetOpen({});
        coachPhotoJpeg = async () => ({ bytes: new Uint8Array([1, 2, 3]) });
        cphUpload = async () => ({ ok: true });
        cphStorageRemove = async () => true;
        let prepared = 0;
        const live = [];
        sb = { rpc: async (fn, args) => {
          calls.push(fn);
          if (fn === 'student_photo_state') return { data: { coach: true, ready: true, adult: true, key: { key_id: '${KEY_ID}', public_key: '${a}' }, photos: live }, error: null };
          if (fn === 'student_photo_prepare') { prepared++; return prepared === 1 ? { data: null, error: null } : { data: null, error: { message: 'too_many' } }; }
          // Pendant l'envoi, une relecture concurrente apporte une autre clé : ce n'est pas elle qui a servi
          if (fn === 'student_photo_commit') { live.push({ id: args.photo, taken_on: '2026-11-05', pose: 'face', bytes: 3 });
            cph.state = { ...cph.state, key: { key_id: '${KEY_ID}', public_key: '${b}' } }; return { data: null, error: null }; }
          return { data: null, error: null };
        } };
        const day = new Date(2026, 10, 5, 9).getTime();
        const res = await cphSend([{ id: 'v1', date: day, pose: 'face' }, { id: 'v2', date: day, pose: 'back' }]);
        const pinAfter = cphPinOf();
        const raw = JSON.parse(localStorage.getItem(CPH_PIN_KEY));
        const sent = JSON.parse(localStorage.getItem(CPH_SENT_KEY));
        clearCrossUserCaches();
        const kept = cphPinOf();
        cph.userId = 'u-autre';
        const other = cphPinOf();
        return { res: { ok: res.ok, sent: res.sent, kind: res.kind }, pinAfter, raw: Object.keys(raw), sent: Object.values(sent.map), kept, other,
          cross: CROSS_USER_CACHE_KEYS.includes(CPH_PIN_KEY) || CROSS_USER_CACHE_KEYS.includes(CPH_MYKEY_KEY) };
      } finally {
        Object.assign(globalThis, saved); vaultLock('test'); account.user = user; sb = sbSaved; coach.state = null; cph.state = null; cph.busy = false; localStorage.clear();
      }
    })()`);
    sameJSON(r.res, { ok: false, sent: 1, kind: 'too_many' }, 'une photo partie, la seconde refusée');
    assert.equal(r.pinAfter, a, 'clé retenue : celle qui a chiffré la photo partie (pas celle relue entre-temps)');
    sameJSON(r.raw, [STUDENT], 'rangée sous l\'identifiant du compte');
    sameJSON(r.sent, ['v1'], 'mention « Envoyée » gardée pour la photo partie');
    assert.equal(r.kept, a, 'pas effacée avec les caches du compte (déconnexion)');
    assert.equal(r.other, null, 'jamais lue pour un autre compte');
    assert.equal(r.cross, false, 'hors de CROSS_USER_CACHE_KEYS');
  });

  // Coach : faux trousseau (secrets de test), faux serveur. cphCoachAvailable forcé (pas de module natif ici).
  const coachScenario = body => run(`(async () => {
    const saved = { cphCoachAvailable }, vault = { ...Native.vault }, user = account.user, sbSaved = sb;
    const kc = {}, forgot = [], rpc = [];
    try {
      localStorage.clear(); cphReset('${COACH}');
      account.user = { id: '${COACH}' }; coach.state = { coach: null, students: [], is_coach: true };
      cphCoachAvailable = () => true;
      Native.vault.unlock = async (reason, id) => (kc[id] ? { key: kc[id] } : { missing: true });
      Native.vault.create = async (reason, id) => { kc[id] ||= __newSecret(); return { key: kc[id] }; };
      Native.vault.forget = async id => { forgot.push(id); delete kc[id]; };
      Native.vault.shield = () => {};
      let served = null;
      sb = { rpc: async (fn, args) => { rpc.push([fn, args]);
        if (fn === 'coach_photo_key') return { data: served, error: null };
        if (fn === 'coach_photo_key_set') { const { replace, ...k } = args; served = k; return { data: k, error: null }; }
        return { data: null, error: null }; } };
      const env = { kc, forgot, rpc, serve: k => { served = k; } };
      ${body}
    } finally {
      Object.assign(globalThis, saved); Object.assign(Native.vault, vault); account.user = user; sb = sbSaved; coach.state = null; cphReset(null); localStorage.clear();
    }
  })()`);
  app.__newSecret = keyB64;

  test('photos de bilan : coach, secret absent ≠ clé du serveur qui n\'est plus la mienne ; republier ma clé', async () => {
    const secretB64 = keyB64(), s = await app.vaultImportKey(secretB64);
    const mine = (await app.coachKeyMake(s, COACH, KEY_ID)).rec;
    const intruder = (await app.coachKeyMake(await secret(), COACH, KEY_ID)).rec;
    const mineCode = await app.coachKeyCode(mine.public_key);
    const r = await coachScenario(`
      kc['${KEY_ID}'] = '${secretB64}';
      const out = {};
      // Clé publique substituée, même identifiant : ma clé privée s'ouvre mais ne correspond pas
      cphCoach.key = { ...${JSON.stringify(mine)}, public_key: '${intruder.public_key}' };
      out.pub = { ...(await cphCoachUnlock()), own: cphCoach.own?.public_key === '${mine.public_key}', code: cphCoach.myCode, open: cphIsOpen() };
      // Clé enveloppée d'un autre (le serveur a tout remplacé) : secret présent, rien ne s'ouvre
      cphReset('${COACH}'); account.user = { id: '${COACH}' };
      cphCoach.key = { ...${JSON.stringify(intruder)}, key_id: '${KEY_ID}' };
      out.wrap = await cphCoachUnlock();
      // Secret absent de cet iPhone, rien de retenu ici : « clé absente »
      cphReset('${COACH}'); account.user = { id: '${COACH}' };
      cphCoach.key = { ...${JSON.stringify(intruder)}, key_id: '${'cd'.repeat(16)}' };
      out.missing = await cphCoachUnlock();
      // Bonne clé : ouverte, retenue sur l'iPhone, code de la clé qui déchiffre
      cphCoach.key = ${JSON.stringify(mine)};
      out.good = { ...(await cphCoachUnlock()), code: cphCoach.session?.code, pinned: readCphMyKey()?.public_key === '${mine.public_key}' };
      cphLock('test');
      // Serveur qui sert ensuite une autre clé (autre identifiant, secret inconnu ici) : alerte dès la relecture,
      // et c'est une clé qui n'est plus la mienne (pas « absente »)
      env.serve({ ...${JSON.stringify(intruder)}, key_id: '${'cd'.repeat(16)}' });
      await cphCoachRefresh();
      out.alert = cphCoach.mismatch;
      out.after = { ...(await cphCoachUnlock()), code: cphCoach.myCode };
      // Republier ma clé : Face ID, ma clé (vérifiée) remplace celle du serveur
      out.repub = await cphCoachRepublish();
      const set = env.rpc.filter(c => c[0] === 'coach_photo_key_set').map(c => c[1]);
      out.set = set.map(a => ({ key_id: a.key_id, mine: a.public_key === '${mine.public_key}', replace: a.replace }));
      out.state = { open: cphIsOpen(), code: cphCoach.session?.code, mismatch: cphCoach.mismatch };
      return out;`);
    sameJSON({ ok: r.pub.ok, mismatch: r.pub.mismatch, own: r.pub.own, code: r.pub.code, open: r.pub.open },
      { ok: false, mismatch: true, own: true, code: mineCode, open: false }, 'clé publique substituée : « n\'est plus la tienne », ma clé et son code');
    assert.equal(r.wrap.mismatch, true, 'clé enveloppée qui ne s\'ouvre pas avec mon secret : pas « absente »');
    assert.ok(r.missing.missing && !r.missing.mismatch, 'secret absent, rien de retenu ici : clé absente');
    sameJSON(r.good, { ok: true, code: mineCode, pinned: true }, 'bonne clé : ouverte, retenue, code de la clé qui déchiffre');
    assert.equal(r.alert, true, 'serveur qui sert une autre clé que celle retenue : alerte à la relecture');
    sameJSON({ mismatch: r.after.mismatch, code: r.after.code }, { mismatch: true, code: mineCode }, 'secret inconnu mais ma clé retenue ici : « n\'est plus la tienne »');
    assert.equal(r.repub.ok, true, 'republiée');
    sameJSON(r.set, [{ key_id: KEY_ID, mine: true, replace: true }], 'ma clé (même identifiant, ma clé publique), à la place de l\'autre');
    sameJSON(r.state, { open: true, code: mineCode, mismatch: false }, 'ouverte avec ma clé, alerte levée');
  });

  test('photos de bilan : coach, session refermée si la clé publique change (même identifiant)', async () => {
    const secretB64 = keyB64(), s = await app.vaultImportKey(secretB64);
    const mine = (await app.coachKeyMake(s, COACH, KEY_ID)).rec;
    const other = (await app.coachKeyMake(s, COACH, KEY_ID)).rec;
    const r = await coachScenario(`
      kc['${KEY_ID}'] = '${secretB64}';
      env.serve(${JSON.stringify(mine)});
      await cphCoachRefresh();
      const opened = (await cphCoachUnlock()).ok && cphIsOpen();
      env.serve({ ...${JSON.stringify(mine)}, public_key: '${other.public_key}' });
      await cphCoachRefresh();
      return { opened, open: cphIsOpen(), mismatch: cphCoach.mismatch };`);
    sameJSON(r, { opened: true, open: false, mismatch: true }, 'même key_id, autre clé publique : refermée, alerte');
  });

  test('photos de bilan : coach, nouvelle clé : l\'ancien secret n\'est effacé du trousseau que s\'il a servi ici', async () => {
    const r = await coachScenario(`
      const vaultId = '${'ef'.repeat(16)}';
      kc[vaultId] = 'secret-de-test-du-coffre';
      // Le serveur donne comme « ancienne clé » l'identifiant d'un autre secret (celui d'un coffre) : jamais effacé
      cphCoach.key = { key_id: vaultId, public_key: '${'BA' + 'A'.repeat(84) + 'A='}', wrapped_key: null, wrap_iv: null };
      const first = await cphCoachSetup({ replace: true });
      const firstId = cphCoach.key?.key_id;
      const forgotFirst = [...env.forgot];
      // Clé créée ici puis remplacée : son secret part
      cphLock('test');
      const second = await cphCoachSetup({ replace: true });
      return { first: first.ok, second: second.ok, forgotFirst, forgot: env.forgot, firstId, vaultKept: !!kc[vaultId] };`);
    assert.equal(r.first && r.second, true);
    sameJSON(r.forgotFirst, [], 'identifiant venu du serveur, jamais ouvert ici : pas effacé');
    assert.equal(r.vaultKept, true, 'le secret du coffre reste');
    sameJSON(r.forgot, [r.firstId], 'clé créée sur cet appareil puis remplacée : son secret effacé');
  });
  // ── Interrupteur du serveur (app_config.coach_photos_on, docs/PHOTOS_BILAN.md « Désactiver sans nouvelle build ») ──

  test('photos de bilan : interrupteur du serveur éteint → élève sans envoi (il retire encore), coach sans rien', async () => {
    assert.equal(plain(app.cleanStudentPhotos({ coach: true, ready: true })).enabled, true, 'champ absent : allumé (le serveur refuse de toute façon)');
    assert.equal(plain(app.cleanStudentPhotos({ coach: true, enabled: false })).enabled, false, 'false explicite : éteint');
    assert.equal(app.coachErrorKind({ message: 'disabled' }), 'disabled');
    const r = await run(`(async () => {
      const user = account.user, sbSaved = sb, calls = [];
      try {
        account.user = { id: 'u-eleve' }; cph.userId = 'u-eleve'; cph.busy = false; cph.loading = false; cph.missing = false;
        coach.state = { coach: { user_id: 'u-coach' }, students: [], is_coach: false };
        vaultSetOpen({});
        const photo = { id: '0d9c3f0e-6a52-4bfb-9a51-6b1f6d9e2a10', taken_on: '2026-11-05', pose: 'face', bytes: 900 };
        sb = { rpc: async fn => { calls.push(fn);
          if (fn === 'student_photo_state') return { data: { coach: true, enabled: false, ready: true, adult: true, key: null, photos: [photo] }, error: null };
          return { data: null, error: null }; } };
        await cphRefresh();
        const student = { shown: cphStudentShown(), listed: cphStudentListed(), photos: cph.state.photos.length,
          send: (await cphSend([{ id: 'p', date: new Date(2026, 10, 5, 9).getTime(), pose: 'face' }])).kind,
          removed: (await cphRemove(photo.id)).ok };
        vaultLock('test');
        // Coach : le serveur répond disabled → rien ne s'affiche, comme un serveur sans la fonction
        cphReset('u-coach'); account.user = { id: 'u-coach' }; coach.state = { coach: null, students: [], is_coach: true };
        const saved = cphCoachAvailable; cphCoachAvailable = () => true;
        sb = { rpc: async fn => { calls.push(fn); return { data: null, error: { message: 'disabled', code: 'P0001' } }; } };
        await cphCoachRefresh();
        const coachSide = { shown: cphCoachShown(), missing: cphCoach.missing };
        cphCoachAvailable = saved;
        return { student, coachSide, calls };
      } finally { account.user = user; sb = sbSaved; coach.state = null; cph.state = null; cph.busy = false; cphReset(null); localStorage.clear(); }
    })()`);
    sameJSON(r.student, { shown: false, listed: true, photos: 1, send: 'disabled', removed: true }, 'élève : pas d\'envoi proposé ni tenté, ses photos visibles et retirables');
    assert.ok(!r.calls.includes('student_photo_prepare'), 'aucune préparation envoyée au serveur');
    assert.ok(r.calls.includes('student_photo_remove'), 'retrait permis');
    sameJSON(r.coachSide, { shown: false, missing: true }, 'coach : rien d\'affiché');
  });
}
