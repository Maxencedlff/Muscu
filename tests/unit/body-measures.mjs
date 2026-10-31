// ═══════════════════════════════════════════════════════════
//  Mensurations et photos de progression (js/data/body-measures.js, js/data/progress-photos.js)
// ═══════════════════════════════════════════════════════════
//
// Ce qui compte ici : la donnée reste sur l'appareil (jamais dans le profil synchronisé, jamais dans une
// séance envoyée), les unités (cm stockés, pouces affichés en lbs), une valeur par jour et par mesure,
// les écarts, et le calcul de réduction des photos.

import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const DAY = 86_400_000;
  const T0 = 1_760_000_000_000;   // 9 octobre 2026, vers 9 h

  test('mensurations : bodyMeasures est classée « appareil » et ne part jamais sur le compte', () => {
    reset();
    assert.ok(run(`SYNC_LOCAL_ONLY.includes('bodyMeasures')`), 'dans SYNC_LOCAL_ONLY');
    assert.ok(!run(`SYNC_PROFILE_KEYS.includes('bodyMeasures')`), 'pas dans SYNC_PROFILE_KEYS');
    const r = run(`(() => {
      const d = freshData(); d.bodyMeasures = { waist: [{ date: ${T0}, cm: 82 }] }; d.unit = 'kg';
      const profile = profilePayload(d);
      const session = sessionPayload({ id: 'a', date: ${T0}, category: 'push', exercises: [], bodyMeasures: d.bodyMeasures });
      return { inProfile: 'bodyMeasures' in profile, txt: JSON.stringify(profile) + JSON.stringify(sessionPayload({ id: 'b', date: 1, category: 'push', exercises: [] })),
               sessionKeys: Object.keys(session) };
    })()`);
    assert.equal(r.inProfile, false, 'jamais dans le profil envoyé au serveur');
    assert.ok(!r.txt.includes('waist') && !r.txt.includes('"cm"') && !r.txt.includes('bodyMeasures'), 'aucune mensuration dans ce qui part');
    // Une séance ne porte jamais ce champ : s'il y était glissé, il partirait tel quel → on vérifie que l'app ne l'y met pas
    assert.ok(!run(`JSON.stringify(makeDefaultData())`).includes('bodyMeasures'), 'pas de clé par défaut (freshData vide = suppression)');
  });

  test('mensurations : cleanBodyMeasures borne, trie, garde une valeur par jour et ignore les clés inconnues', () => {
    reset();
    const r = run(`cleanBodyMeasures({
      waist: [{ date: ${T0}, cm: 82.04 }, { date: ${T0 + 3600_000}, cm: 81.5 }, { date: ${T0 - DAY}, cm: 83 }, { date: ${T0 - 2 * DAY}, cm: 5 }, { date: ${T0 - 3 * DAY}, cm: 300 }, { date: 0, cm: 80 }, null, { cm: 80 }],
      chest: 'non', pied: [{ date: ${T0}, cm: 25 }], neck: [],
    })`);
    sameJSON(Object.keys(r), ['waist'], 'clés : seule waist a des valeurs lisibles (chest illisible, pied inconnu, neck vide)');
    sameJSON(r.waist, [{ date: T0 + 3600_000, cm: 81.5 }, { date: T0 - DAY, cm: 83 }], 'une par jour (la dernière du jour), du plus récent au plus ancien, bornes 10–250');
    assert.equal(run(`cleanBodyMeasures(null).constructor === Object && Object.keys(cleanBodyMeasures([1])).length`), 0, 'null et tableau : objet vide');
    sameJSON(run(`cleanBodyMeasures(cleanBodyMeasures({ waist: [{ date: ${T0}, cm: 82 }] }))`), { waist: [{ date: T0, cm: 82 }] }, 'idempotent');
  });

  test('mensurations : logBodyMeasure remplace la mesure du même jour, removeBodyMeasure vide la clé puis la donnée', () => {
    reset();
    run(`logBodyMeasure('chest', 95, ${T0}); logBodyMeasure('chest', 95.6, ${T0 + 60_000}); logBodyMeasure('chest', 94, ${T0 - 7 * DAY}); logBodyMeasure('inconnue', 50, ${T0});`);
    sameJSON(run('data.bodyMeasures'), { chest: [{ date: T0 + 60_000, cm: 95.6 }, { date: T0 - 7 * DAY, cm: 94 }] });
    run(`removeBodyMeasure('chest', ${T0 + 60_000})`);
    sameJSON(run('data.bodyMeasures'), { chest: [{ date: T0 - 7 * DAY, cm: 94 }] });
    run(`removeBodyMeasure('chest', ${T0 - 7 * DAY})`);
    assert.equal(run(`'bodyMeasures' in data`), false, 'plus de clé quand tout est supprimé');
  });

  test('mensurations : série chronologique, dernière valeur et écarts', () => {
    reset();
    run(`data.bodyMeasures = cleanBodyMeasures({ armL: [{ date: ${T0}, cm: 36.5 }, { date: ${T0 - 30 * DAY}, cm: 35 }, { date: ${T0 - 60 * DAY}, cm: 34.8 }] })`);
    const s = run(`bodyMeasureSeries('armL')`);
    sameJSON(s.map(p => p.cm), [34.8, 35, 36.5], 'du plus ancien au plus récent (courbe)');
    sameJSON(run(`bodyMeasureDelta(bodyMeasureSeries('armL'))`), { last: { date: T0, cm: 36.5 }, dPrev: 1.5, dFirst: 1.7, count: 3 });
    sameJSON(run(`bodyMeasureDelta(bodyMeasureSeries('armL').slice(0, 1))`), { last: { date: T0 - 60 * DAY, cm: 34.8 }, dPrev: null, dFirst: null, count: 1 }, 'une seule mesure : pas d\'écart');
    assert.equal(run(`bodyMeasureDelta([])`), null);
    sameJSON(run(`bodyMeasureSummary()`), { count: 1, latest: T0 });
    sameJSON(run(`bodyMeasureSummary({})`), { count: 0, latest: null });
  });

  test('mensurations : unités, cm stockés et pouces affichés avec les lbs', () => {
    reset();
    assert.equal(run(`lenUnitLbl()`), 'cm');
    assert.equal(run(`fmtLen(92.5)`), '92,5');
    assert.equal(run(`fmtLen(1234.56)`), '1 234,6', 'séparateur de milliers français');
    assert.equal(run(`fmtLen(92.5, { plain: true })`), '92,5');
    assert.equal(run(`storeLen('92,5')`), 92.5, 'virgule acceptée');
    assert.equal(run(`storeLen('92.56')`), 92.6, 'arrondi au dixième');
    assert.equal(run(`storeLen('')`), null);
    assert.equal(run(`storeLen('9')`), null, 'sous 10 cm : refusé');
    assert.equal(run(`storeLen('251')`), null, 'au-delà de 250 cm : refusé');
    assert.equal(run(`fmtLenDelta(1.5)`), '+1,5 cm');
    assert.equal(run(`fmtLenDelta(-0.5)`), '−0,5 cm', 'vrai signe moins');
    assert.equal(run(`fmtLenDelta(0)`), '');
    assert.equal(run(`fmtLenDelta(null)`), '');
    reset({ unit: 'lbs' });
    assert.equal(run(`lenUnitLbl()`), 'in');
    assert.equal(run(`toUnitLen(92.5)`), 36.4, '92,5 cm = 36,4 in');
    assert.equal(run(`fmtLen(92.5)`), '36,4');
    assert.equal(run(`storeLen('36,4')`), 92.5, 'saisie en pouces → cm au dixième');
    assert.equal(run(`storeLen('3')`), null, '3 in = 7,6 cm : sous la borne');
    assert.equal(run(`storeLen('98.5')`), null, '98,5 in = 250,2 cm : au-delà');
    assert.equal(run(`fmtLenDelta(2.54)`), '+1 in');
    assert.equal(run(`fmtLenDelta(0.1)`), '', '1 mm : rien en pouces au dixième');
  });

  test('mensurations : sanitizeData nettoie la donnée au chargement et à l\'import, l\'export la garde, freshData l\'efface', () => {
    reset();
    const r = run(`(() => {
      const d = freshData();
      d.bodyMeasures = { waist: [{ date: ${T0}, cm: 82 }, { date: ${T0 - DAY}, cm: 2 }], bidon: [{ date: ${T0}, cm: 50 }] };
      const clean = sanitizeData(d);
      const empty = sanitizeData({ ...freshData(), bodyMeasures: { waist: [] } });
      const broken = sanitizeData({ ...freshData(), bodyMeasures: 'texte' });
      return { clean: clean.bodyMeasures, hasEmpty: 'bodyMeasures' in empty, hasBroken: 'bodyMeasures' in broken,
               exported: 'bodyMeasures' in { ...clean, _theme: 'auto' }, fresh: 'bodyMeasures' in freshData() };
    })()`);
    sameJSON(r.clean, { waist: [{ date: T0, cm: 82 }] });
    assert.equal(r.hasEmpty, false, 'mesure vide : clé retirée');
    assert.equal(r.hasBroken, false, 'valeur illisible : clé retirée');
    assert.equal(r.exported, true, 'l\'export ({ ...data }) contient les mensurations');
    assert.equal(r.fresh, false, '« Supprimer toutes les données » (freshData) les efface');
  });

  test('mensurations : date d\'un champ date → horodatage (aujourd\'hui = maintenant, passé = midi, futur refusé)', () => {
    reset();
    const now = Date.now();
    const today = run(`dateInputToTs(localISO())`);
    assert.ok(today >= now && today <= Date.now() + 1000, 'aujourd\'hui : maintenant (ordre des saisies du jour)');
    const past = run(`dateInputToTs('2026-03-15')`);
    const d = new Date(past);
    assert.equal(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}`, '2026-3-15-12');
    assert.equal(run(`dateInputToTs('2099-01-01')`), null, 'futur');
    assert.equal(run(`dateInputToTs('')`), null);
    assert.equal(run(`dateInputToTs('15/03/2026')`), null);
  });

  test('photos : taille après réduction (côté le plus long à 1200 px, jamais agrandie)', () => {
    sameJSON(run(`photoFitSize(3024, 4032)`), { w: 900, h: 1200 }, 'photo d\'iPhone en portrait');
    sameJSON(run(`photoFitSize(4032, 3024)`), { w: 1200, h: 900 }, 'paysage : la largeur est bornée');
    sameJSON(run(`photoFitSize(600, 800)`), { w: 600, h: 800 }, 'petite image gardée telle quelle');
    sameJSON(run(`photoFitSize(0, 0)`), { w: 1, h: 1 }, 'dimensions nulles : 1 px, pas de canvas vide');
    sameJSON(run(`photoFitSize(2400, 2400, 600)`), { w: 600, h: 600 });
    assert.equal(run('PHOTO_QUALITY'), 0.8);
    assert.equal(run('PHOTO_MAX_PX'), 1200);
  });

  test('photos : poids affiché, groupes par jour (face, profil, dos), poids total', () => {
    assert.equal(run(`fmtBytes(0)`), '0 o');
    assert.equal(run(`fmtBytes(870 * 1024)`), '870 ko');
    assert.equal(run(`fmtBytes(1.25 * 1024 * 1024)`), '1,3 Mo');
    const r = run(`(() => {
      const list = [{ id: 'a', date: ${T0}, pose: 'back', bytes: 100 }, { id: 'b', date: ${T0 + 60_000}, pose: 'face', bytes: 200 },
                    { id: 'c', date: ${T0 - 10 * DAY}, pose: 'side', bytes: 300 }, { id: 'd', date: ${T0 + 120_000}, pose: 'bidon', bytes: 50 }];
      const g = photoDayGroups(list);
      return { days: g.map(x => x.photos.map(p => p.id)), total: photosTotalBytes(list), label: [photoPoseLabel('side'), photoPoseLabel('x')] };
    })()`);
    sameJSON(r.days, [['b', 'a', 'd'], ['c']], 'jour le plus récent d\'abord ; dans le jour : face, (profil), dos, puis pose inconnue');
    assert.equal(r.total, 650);
    sameJSON(r.label, ['Profil', 'Photo']);
    sameJSON(run(`photoDayGroups([])`), []);
  });

  test('photos : sans IndexedDB (tests, vieux navigateur), photosWipe ne plante pas et répond false', async () => {
    assert.equal(run(`photosSupported()`), false, 'le bac à sable des tests n\'a pas IndexedDB');
    assert.equal(await run(`photosWipe()`), false);
    let failed = false;
    try { await run(`photosAll()`); } catch { failed = true; }
    assert.ok(failed, 'lecture impossible signalée par un rejet (l\'écran affiche une liste vide)');
  });

  test('photos : permises dans l\'app iOS seulement avec la build qui a les autorisations', () => {
    // Navigateur : permises
    assert.equal(run('photosAllowedHere()'), true);
    // App iOS : PHOTOS_NATIVE_READY passe à true avec la build unique, dont l'Info.plist a les deux clés
    // (sans NSCameraUsageDescription, iOS tue l'app au toucher « Prendre une photo »)
    sameJSON(run(`(() => {
      const was = Native.isNative; Native.isNative = true;
      try { return [photosAllowedHere(), PHOTOS_NATIVE_READY]; } finally { Native.isNative = was; }
    })()`), [true, true]);
    const plist = fs.readFileSync(path.join(ROOT, 'ios/App/App/Info.plist'), 'utf8');
    for (const k of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription']) {
      assert.match(plist, new RegExp(`<key>${k}</key>\\s*<string>[^<]{20,}</string>`), `${k} dans Info.plist`);
    }
  });
}
