// ═══════════════════════════════════════════════════════════
//  Photos de bilan (js/data/coach-photos.js) : métadonnées d'un JPEG, chiffrement de bout en bout, clé du coach,
//  nettoyage de ce que renvoie le serveur. Secrets et clés tirés au hasard par le test (jamais une vraie clé) ;
//  JPEG construits octet par octet (aucune vraie photo). Le contrôle sur un vrai JPEG avec GPS, redessiné par
//  le navigateur, est dans tests/test_photos_bilan.py.
// ═══════════════════════════════════════════════════════════

export default function ({ test, run, assert, app }) {
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
    app.cphPinKey();
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
}
