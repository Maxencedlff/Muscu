// ═══════════════════════════════════════════════════════════
//  Récaps de la semaine, du mois et de l'année (js/data/recap.js)
// ═══════════════════════════════════════════════════════════
//
// Semaine ISO du lundi (bords au changement d'heure, heure de Paris), périodes vides, records,
// exercice et muscle n° 1, jour et moment favoris, série de semaines, comparaison, année, écrans.

export default function ({ test, run, reset, assert, app, sameJSON }) {
  function inParis(fn) {
    const before = process.env.TZ;
    process.env.TZ = 'Europe/Paris';
    try { return fn(); }
    finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
  }
  const at = (...a) => new Date(...a).getTime();
  const s = (weight, reps) => ({ weight, reps });
  const NOW = at(2026, 9, 19, 10);   // lundi 19 octobre 2026, 10 h

  // Semaine du 12 au 18 octobre 2026, précédée d'une séance Push le lundi 5 (ligne de base des records)
  function weekHistory() {
    return [
      { id: 'h0', programme: 'ppl', category: 'push', date: at(2026, 9, 5, 18, 30), duration: 50 * 60_000,
        exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s('60', '8'), s('60', '8')] }] },
      { id: 'h1', programme: 'ppl', category: 'push', date: at(2026, 9, 13, 18, 30), duration: 55 * 60_000,
        exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s('62.5', '6'), s('60', '8'), s('60', '8')] },   // record charge
                    { exId: 'el', name: 'Élévations latérales', sets: [s('8', '12')] }] },
      { id: 'h2', programme: 'ppl', category: 'legs', date: at(2026, 9, 15, 19, 0), duration: 65 * 60_000, bodyKg: 80,
        exercises: [{ exId: 'sq', name: 'Squat barre', sets: [s('80', '5'), s('80', '5'), s('80', '5')] },
                    { exId: 'di', name: 'Dips', sets: [s('', '10')] }] },                                               // poids du corps
      { id: 'h3', programme: 'ppl', category: 'push', date: at(2026, 9, 17, 10, 30), duration: 50 * 60_000,
        exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s('62.5', '7')] },                             // record reps (moins marquant)
                    { exId: 'el', name: 'Élévations latérales', sets: [s('8', '12')] }] },
    ];
  }
  const week = () => app.recapPeriod('week', at(2026, 9, 14), NOW);

  test('recapPeriod : semaine du lundi 0 h au lundi 0 h, même au passage à l\'heure d\'hiver', () => inParis(() => {
    const p = app.recapPeriod('week', at(2026, 9, 25, 23, 30), NOW);   // dimanche 25 octobre 23 h 30, après le changement d'heure
    assert.equal(p.start, at(2026, 9, 19, 0, 0));
    assert.equal(p.end, at(2026, 9, 26, 0, 0), 'lundi 26 à 0 h (169 h plus tard, pas 168)');
    assert.equal(p.key, 'w2026-10-19');
    assert.equal(p.label, '19 – 25 octobre');
    assert.equal(p.short, '19 – 25 oct.');
    assert.equal(p.title, 'Ta semaine');
    assert.equal(app.recapPeriod('week', at(2026, 9, 26, 0, 30), NOW).key, 'w2026-10-26', 'lundi 0 h 30 : semaine suivante');
    const cross = app.recapPeriod('week', at(2026, 9, 1), NOW);
    assert.equal(cross.label, '28 septembre – 4 octobre', 'semaine sur deux mois');
    assert.equal(app.recapPeriod('week', at(2025, 11, 31), NOW).label, '29 décembre – 4 janvier', 'semaine qui finit dans l\'année en cours');
    assert.equal(app.recapPeriod('week', at(2025, 11, 17), NOW).label, '15 – 21 décembre 2025', 'autre année : année précisée');
  }));

  test('recapPeriod : mois et année du calendrier, clés et relecture des clés', () => inParis(() => {
    const m = app.recapPeriod('month', at(2026, 9, 31, 23), NOW);
    assert.equal(m.start, at(2026, 9, 1)); assert.equal(m.end, at(2026, 10, 1));
    assert.equal(m.key, 'm2026-10'); assert.equal(m.label, 'Octobre 2026'); assert.equal(m.title, 'Ton mois');
    const y = app.recapPeriod('year', at(2026, 5, 1), NOW);
    assert.equal(y.start, at(2026, 0, 1)); assert.equal(y.end, at(2027, 0, 1));
    assert.equal(y.key, 'y2026'); assert.equal(y.label, '2026'); assert.equal(y.title, 'Ton année');
    for (const key of ['w2026-10-19', 'm2026-10', 'y2026']) assert.equal(app.recapPeriodFromKey(key, NOW).key, key, key);
    for (const key of ['w2026-10-20', 'm2026-13', 'x2026', '', null, 'w2026-10-19:evil']) assert.equal(app.recapPeriodFromKey(key, NOW), null, `clé refusée : ${key}`);
    assert.equal(app.recapPrevPeriod(week(), NOW).key, 'w2026-10-05');
    assert.equal(app.recapPrevPeriod(m, NOW).key, 'm2026-09');
    assert.equal(app.recapPrevPeriod(app.recapPeriod('month', at(2026, 0, 15), NOW), NOW).key, 'm2025-12', 'janvier → décembre d\'avant');
    assert.equal(app.recapPrevPeriod(y, NOW).key, 'y2025');
  }));

  test('recapStats : période sans séance → null, aucun écran', () => inParis(() => {
    reset();
    assert.equal(app.recapStats(week(), [], NOW), null);
    assert.equal(app.recapStats(app.recapPeriod('week', at(2026, 8, 1), NOW), weekHistory(), NOW), null, 'séances hors période');
    sameJSON(app.recapPages(null), []);
    assert.equal(app.recapCardInfo({ history: [], now: NOW }), null);
  }));

  test('recapStats : séances, durée, volume (poids du corps compris), séries, records, n° 1, favoris, série, écarts', () => inParis(() => {
    reset();
    const hist = weekHistory();
    run('data.bodyWeightKg = 80');
    const st = app.recapStats(week(), hist, NOW);
    assert.equal(st.sessions, 3);
    assert.equal(st.duration, 170 * 60_000);
    assert.equal(st.sets, 10);
    const expected = hist.slice(1).reduce((a, h) => a + app.sessionVolume(h.exercises, app.entryBodyKg(h)), 0);
    assert.equal(st.volume, expected, 'règle de volume de l\'app');
    assert.ok(st.volume > 62.5 * 6 + 60 * 16 + 8 * 24 + 80 * 15 + 62.5 * 7 + 700, 'les dips au poids du corps (80 kg × 0,95 × 10) comptent');
    // Records : un seul exercice, le plus marquant (charge > reps), comparé aux séances d'avant
    assert.equal(st.records.length, 1);
    assert.equal(st.records[0].name, 'Développé couché haltères');
    assert.equal(st.records[0].label, 'Record charge');
    assert.equal(st.records[0].value, '62,5 kg × 6');
    assert.equal(st.bestRecord.label, 'Record charge');
    sameJSON(st.topExercise, { key: 'dc', name: 'Développé couché haltères', sessions: 2, sets: 4 });
    assert.equal(st.topMuscle.id, 'chest'); assert.equal(st.topMuscle.label, 'Pectoraux'); assert.ok(st.topMuscle.sets >= 4);
    assert.equal(st.favDay, null, 'trois jours différents : pas de jour favori');
    // Séances enregistrées vers 18 h après 50 à 60 min : commencées l'après-midi (date = fin de séance)
    sameJSON(st.favSlot, { slot: 'apres-midi', label: 'l\'après-midi', from: 14, to: 18, count: 2, of: 3, all: 3 });
    sameJSON(st.streak, { current: 2, longest: 1 });
    sameJSON(st.prev, { sessions: 1, duration: 50 * 60_000, volume: 960, sets: 2 });
    assert.equal(st.deltas.sessions, 2);
    assert.equal(st.deltas.duration, 120 * 60_000);
    assert.equal(st.deltas.sets, 8);
  }));

  test('recapStats : séries d\'échauffement hors volume, séries, records et n° 1 ; obliques reconnus comme muscle', () => inParis(() => {
    reset();
    const w = (weight, reps) => ({ weight, reps, warmup: true });
    const hist = weekHistory();
    // Échauffements ajoutés au développé couché : 100 kg × 3 battrait le record s'il comptait
    hist[1].exercises[0].sets.unshift(w('100', '3'), w('40', '8'));
    const st = app.recapStats(week(), hist, NOW);
    const plain = app.recapStats(week(), weekHistory(), NOW);
    assert.equal(st.sets, plain.sets, 'séries de travail seulement');
    assert.equal(st.volume, plain.volume, 'volume sans échauffement');
    assert.equal(st.records[0].value, '62,5 kg × 6', 'un échauffement ne bat aucun record');
    sameJSON(st.topExercise, plain.topExercise);
    // Semaine d'obliques : bûcheron poulie et Pallof press dans trois séances
    const ob = [13, 15, 17].map((d, i) => ({ id: 'o' + i, programme: 'ppl', category: 'push', date: at(2026, 9, d, 18), duration: 30 * 60_000,
      exercises: [{ exId: 'bp', name: 'Bûcheron poulie', sets: [s('20', '12'), s('20', '12'), s('20', '12')] },
                  { exId: 'pp', name: 'Pallof press', sets: [s('15', '10'), s('15', '10')] }] }));
    const so = app.recapStats(week(), ob, NOW);
    assert.equal(so.topMuscle.id, 'obliques');
    assert.equal(so.topMuscle.label, app.muscleLabel('obliques'));
  }));

  test('recapStats : première période (rien avant) → pas de comparaison ; séances sans durée → pas d\'heure favorite', () => inParis(() => {
    reset();
    const hist = weekHistory().slice(1).map(h => ({ ...h, duration: 0 }));
    const st = app.recapStats(week(), hist, NOW);
    assert.equal(st.prev, null); assert.equal(st.deltas, null);
    assert.equal(st.duration, 0);
    assert.equal(st.favSlot, null, 'séances passées saisies sans heure');
    assert.equal(st.records.length, 1, 'le record du samedi se compare au mardi de la même semaine, jamais à rien');
    assert.equal(st.records[0].label, 'Record reps');
    const pages = app.recapPages(st);
    sameJSON(pages.map(p => p.id), ['sessions', 'profile', 'volume', 'records', 'exercise', 'summary'], 'ni série de semaines, ni palier');
    assert.equal(pages[0].note, '', 'pas d\'écart inventé');
    assert.ok(!pages.at(-1).tiles.some(([l]) => l === 'Durée'));
    assert.ok(!pages.find(p => p.id === 'volume').tiles.some(([l]) => l === 'Durée'), 'pas de durée sans chronomètre');
    assert.equal(st.profile.lines.some(([l]) => /soir|matin/i.test(l)), false, 'pas de moment favori sans heure');
  }));

  test('recapStreak : semaines consécutives, en cours et la plus longue', () => inParis(() => {
    const hist = [at(2026, 8, 7), at(2026, 8, 14), at(2026, 8, 21), at(2026, 9, 5), at(2026, 9, 12), at(2026, 9, 14)]
      .map((date, i) => ({ id: 'h' + i, date, exercises: [] }));   // semaines 7, 14, 21 sept, (28 sept manquée), 5, 12 oct
    sameJSON(app.recapStreak(hist, week()), { current: 2, longest: 1 });
    sameJSON(app.recapStreak(hist, app.recapPeriod('month', at(2026, 8, 10), NOW)), { current: 0, longest: 3 }, 'septembre : 3 semaines d\'affilée, la dernière semaine du mois sans séance');
    sameJSON(app.recapStreak(hist, app.recapPeriod('year', at(2026, 5, 10), NOW)), { current: 0, longest: 3 });
    sameJSON(app.recapStreak([], week()), { current: 0, longest: 0 });
  }));

  test('recapFavDay / recapFavSlot : favori seulement s\'il revient deux fois et seul en tête', () => inParis(() => {
    const e = (date, duration = 60_000) => ({ date, duration, exercises: [] });
    assert.equal(app.recapFavDay([e(at(2026, 9, 13, 12)), e(at(2026, 9, 15, 12))]), null, 'deux jours différents');
    assert.equal(app.recapFavDay([e(at(2026, 9, 13, 12)), e(at(2026, 9, 20, 12)), e(at(2026, 9, 15, 12)), e(at(2026, 9, 22, 12))]), null, 'égalité mardi / jeudi');
    sameJSON(app.recapFavDay([e(at(2026, 9, 13, 12)), e(at(2026, 9, 20, 12)), e(at(2026, 9, 15, 12))]), { index: 1, label: 'mardi', count: 2 });
    sameJSON(app.recapFavSlot([e(at(2026, 9, 13, 7)), e(at(2026, 9, 14, 8)), e(at(2026, 9, 15, 19))]), { slot: 'matin', label: 'le matin', from: 5, to: 12, count: 2, of: 3, all: 3 });
    // L'heure qui compte est le début (date − durée) : fini à 18 h 15 après 1 h 05, commencé l'après-midi
    sameJSON(app.recapFavSlot([e(at(2026, 9, 13, 18, 15), 65 * 60_000), e(at(2026, 9, 14, 18, 15), 65 * 60_000)]).slot, 'apres-midi');
    // Une séance sans heure : le compte le dit (« sur 2 chronométrées »), pour ne pas contredire « 2 séances sur 3 » du jour
    const mixed = [e(at(2026, 9, 13, 19)), e(at(2026, 9, 14, 19)), e(at(2026, 9, 15, 19), 0)];
    sameJSON(app.recapSlotLine(app.recapFavSlot(mixed)), ['Plutôt le soir', 'Entre 18 h et 23 h · 2 séances sur 2 chronométrées']);
    assert.equal(app.recapSlotRange({ from: 18, to: 23 }), 'Entre 18 h et 23 h');
    assert.equal(app.recapFavSlot([e(at(2026, 9, 13, 7), 0), e(at(2026, 9, 14, 8), 0)]), null, 'sans durée, pas d\'heure connue');
    assert.equal(app.recapSlotOf(at(2026, 9, 13, 2)), 'nuit');
    assert.equal(app.recapSlotOf(at(2026, 9, 13, 12, 30)), 'midi');
    assert.equal(app.recapSlotOf(at(2026, 9, 13, 16)), 'apres-midi');
  }));

  test('recapDeltaText : écarts formatés, « comme … » quand rien ne change', () => {
    reset();
    assert.equal(app.recapDeltaText('week', 'sessions', 1), '+1 séance par rapport à la semaine d\'avant');
    assert.equal(app.recapDeltaText('month', 'sessions', -2), '−2 séances par rapport au mois d\'avant');
    assert.equal(app.recapDeltaText('year', 'sessions', 0), 'comme l\'année d\'avant');
    assert.equal(app.recapDeltaText('week', 'duration', 42 * 60_000), '+42 min par rapport à la semaine d\'avant');
    assert.equal(app.recapDeltaText('week', 'duration', -30_000), 'comme la semaine d\'avant', 'moins d\'une minute : rien');
    assert.equal(app.recapDeltaText('week', 'volume', 1240), '+1,2 t par rapport à la semaine d\'avant');
    assert.equal(app.recapDeltaText('week', 'volume', -0.4), 'comme la semaine d\'avant');
    assert.equal(app.recapDeltaText('week', 'sets', 12), '+12 séries par rapport à la semaine d\'avant');
  });

  test('recapPages : couleurs, ordre, résumé en dernier ; comparaison seulement en hausse ; VoiceOver ; fichier', () => inParis(() => {
    reset();
    run('data.bodyWeightKg = 80');
    const st = app.recapStats(week(), weekHistory(), NOW);
    const pages = app.recapPages(st);
    sameJSON(pages.map(p => p.id), ['sessions', 'profile', 'volume', 'records', 'exercise', 'summary'], 'aucun écran « premières fois » ; pas de régularité sans 3 semaines actives avant');
    assert.ok(!pages.some(p => /premi[èe]re|nouvel exercice/i.test(JSON.stringify(p))), 'jamais de « première fois » ni de « nouvel exercice »');
    assert.ok(pages.every(p => ['accent', 'night'].includes(p.tone) && p.share), 'chaque écran a sa couleur et son bouton');
    const by = Object.fromEntries(pages.map(p => [p.id, p]));
    assert.equal(by.sessions.tone, 'accent'); assert.equal(by.records.tone, 'night'); assert.equal(by.profile.tone, 'night');
    assert.equal(by.sessions.kicker, 'TA SEMAINE');
    assert.equal(by.sessions.value, '3'); assert.equal(by.sessions.caption, 'séances');
    assert.equal(by.sessions.note, '+2 séances par rapport à la semaine d\'avant');
    assert.equal(by.sessions.sub, '12 – 18 octobre');
    sameJSON(by.sessions.chips, ['2 h 50', '1 record']);
    assert.match(by.volume.value, /^\d[\d ]*(,\d)? (kg|t)$/, 'chiffre et unité insécables');
    assert.equal(by.volume.caption, 'soulevées en 3 séances');
    assert.match(by.volume.note, /^\+\d+ % par rapport à la semaine d'avant$/);
    sameJSON(by.volume.tiles.map(([l]) => l), ['Séries', 'Durée']);
    assert.equal(by.records.title, 'Développé couché haltères');
    assert.equal(by.records.from, '60'); assert.equal(by.records.value, '62,5'); assert.equal(by.records.unit, 'kg');
    assert.equal(by.records.caption, '× 6 répétitions');
    assert.equal(by.records.box, '+2,5 kg (+4 %) depuis ton record du 5 octobre');
    assert.match(by.records.kicker, /^NOUVEAU RECORD · MARDI 13 OCTOBRE$/);
    assert.equal(by.records.lead, '', 'un seul record : pas de « plus forte »');
    assert.equal(by.records.share, 'Partager ce record');
    assert.equal(by.exercise.kicker, 'TON EXERCICE LE PLUS FAIT');
    assert.equal(by.exercise.title, 'Développé couché haltères'); assert.equal(by.exercise.caption, 'dans 2 séances sur 3 · 4 séries');
    assert.equal(by.exercise.box, '', 'semaine : pas de progression du 1RM');
    assert.equal(by.summary.tone, 'accent'); assert.equal(by.summary.kicker, '12 – 18 OCTOBRE');
    assert.equal(by.summary.title, 'Ma semaine en bref', 'un titre clair, pas une formule');
    sameJSON(by.summary.tiles.map(([l]) => l), ['Volume soulevé', 'Séances', 'Durée', 'Record']);
    assert.equal(by.summary.share, 'Partager ma semaine');
    assert.equal(app.recapPageAlt(by.sessions, st), 'Ta semaine, 12 – 18 octobre : 3 séances. +2 séances par rapport à la semaine d\'avant.');
    assert.match(app.recapPageAlt(by.records, st), /nouveau record · mardi 13 octobre : Développé couché haltères\. 60 → 62,5 kg\. × 6 répétitions\. \+2,5 kg \(\+4 %\) depuis ton record du 5 octobre\./);
    assert.ok(!app.recapPageAlt(by.records, st).includes(' '), 'VoiceOver : espaces simples');
    assert.match(app.recapPageAlt(by.summary, st), /^Ta semaine, 12 – 18 octobre en bref : /);
    assert.equal(app.recapFileName(st.period, by.volume), 'mdlf-training-recap-w2026-10-12-volume.png');
    // Baisse : jamais affichée
    const down = app.recapStats(week(), weekHistory().filter(h => h.id !== 'h1' && h.id !== 'h3'), NOW);
    const dp = app.recapPages(down);
    assert.equal(dp[0].note, '', 'pas de « −0 séance »');
    assert.ok(!dp.some(p => /−|-\d/.test(p.note || '')), 'aucune baisse affichée');
    sameJSON(dp.map(p => p.id).slice(0, 2), ['sessions', 'profile'], 'petite semaine sans record : le profil d\'abord');
  }));

  test('recapProfile : profil fait de faits (groupe « d\'abord », moment, lève-tôt, tout le corps), sinon rien', () => inParis(() => {
    reset();
    const p = week();
    const leg = (d, h, dur = 60 * 60_000) => ({ id: 'l' + d + h, programme: 'ppl', category: 'legs', date: at(2026, 9, d, h), duration: dur,
      exercises: [{ exId: 'sq', name: 'Squat barre', sets: [s('80', '5'), s('80', '5'), s('80', '5')] }] });
    const soir = app.recapFavSlot([leg(13, 19), leg(15, 19)]);
    let pr = app.recapProfile([leg(13, 19), leg(15, 19)], p, [leg(13, 19), leg(15, 19)], soir, null);
    assert.equal(pr.title, 'Jambes d\'abord', 'le titre dit ce qui a été travaillé, sans moment à décoder');
    assert.equal(pr.lines[0][0], 'Jambes'); assert.match(pr.lines[0][1], /^\d+ % de tes séries$/);
    sameJSON(pr.lines[1], ['Plutôt le soir', 'Entre 18 h et 23 h · 2 séances sur 2'], 'moment toujours avec sa plage et son compte');
    assert.ok(['quads', 'glutes'].includes(pr.muscles[0].id)); assert.ok(pr.levels[pr.muscles[0].id] === 1, 'muscle le plus travaillé à pleine intensité');
    const early = [leg(13, 6), leg(15, 7)];
    pr = app.recapProfile(early, p, early, app.recapFavSlot(early), null);
    assert.equal(pr.title, 'Jambes d\'abord');
    sameJSON(pr.lines[1], ['Lève-tôt', 'Toujours commencé avant 8 h · 2 séances sur 2']);
    pr = app.recapProfile(early, p, early, null, { index: 1, label: 'mardi', count: 2 });
    sameJSON(pr.lines.at(-1), ['Le mardi le plus souvent', '2 séances sur 2'], 'jour favori : une phrase avec son compte');
    // Sans heure ni groupe dominant : « Tout le corps » si 4 groupes à 12 % ou plus
    const full = [{ id: 'f', programme: 'ppl', category: 'full', date: at(2026, 9, 14, 12), duration: 0, exercises: [
      { exId: 'sq', name: 'Squat barre', sets: [s('80', '5'), s('80', '5')] }, { exId: 'dc', name: 'Développé couché haltères', sets: [s('30', '8'), s('30', '8'), s('30', '8')] },
      { exId: 'tr', name: 'Tractions', sets: [s('', '8'), s('', '8')] },
      { exId: 'ab', name: 'Crunch', sets: [s('', '15'), s('', '15'), s('', '15')] }] }];
    pr = app.recapProfile(full, p, full, null, null);
    assert.equal(pr.title, 'Tout le corps');
    assert.equal(pr.lines[0][0], 'Bien réparti', 'pas « Tout le corps » deux fois');
    assert.match(pr.lines[0][1], /^[A-ZÉ][a-zé]+(, [a-zé]+)* et [a-zé]+ : chacun plus de 12\u00a0% de tes séries$/, 'les groupes nommés, pas « 4 groupes »');
    assert.equal(app.recapProfile([], p, [], null, null), null, 'rien à dire : pas de profil');
  }));

  test('recapProfile : paliers du personnage sur la moyenne par semaine (changement d\'heure, année commencée en cours, séries arrondies)', () => inParis(() => {
    reset();
    const sq = (d, mo, n) => ({ id: 'q' + mo + d, programme: 'ppl', category: 'legs', date: at(2026, mo, d, 19), duration: 3600_000,
      exercises: [{ exId: 'sq', name: 'Squat barre', sets: Array.from({ length: n }, () => s('80', '5')) }] });
    const lvl = perWeek => app.muscleLevel(perWeek) / 4;   // MUSCLE_LEVEL_MAX (const, hors de app)
    // Semaine du 19 au 26 octobre (169 h, passage à l'heure d'hiver) : 10 séries restent « Objectif atteint »
    const dst = app.recapPeriod('week', at(2026, 9, 21, 12), at(2026, 9, 27, 12));
    const wk = [sq(20, 9, 5), sq(22, 9, 5)];
    let pr = app.recapProfile(wk, dst, wk, null, null, at(2026, 9, 27, 12));
    assert.equal(pr.tiers.quads, lvl(10), 'semaine de 169 h : comptée comme une semaine');
    assert.equal(pr.perWeekAvg, false);
    // Année 2026 commencée le 5 octobre : 20 séries par semaine pendant 4 semaines → moyenne sur 4 semaines, pas 52
    const yr = app.recapPeriod('year', at(2026, 9, 10, 12), at(2026, 11, 5, 12));
    const oct = [sq(5, 9, 20), sq(12, 9, 20), sq(19, 9, 20), sq(26, 9, 20)];
    pr = app.recapProfile(oct, yr, oct, null, null, at(2026, 10, 1, 12));
    assert.equal(pr.tiers.quads, lvl(20), 'semaines couvertes seulement (du 5 octobre au 1er novembre)');
    assert.equal(pr.perWeekAvg, true);
  }));

  test('recapMilestones / recapExerciseProgress / recapHeadline', () => inParis(() => {
    reset();
    const one = (i, d) => ({ id: 'x' + i, programme: 'ppl', category: 'push', date: d, duration: 0, exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s(String(40 + i), '8')] }] });
    const hist = Array.from({ length: 10 }, (_, i) => one(i, at(2026, 8, 1 + i * 4, 18)));   // 10 séances, la 10e le 6 octobre
    const wk = app.recapPeriod('week', at(2026, 9, 6), NOW);
    sameJSON(app.recapMilestones(hist, wk), [{ n: 10, date: at(2026, 9, 7, 18) }], '10e séance, le 7 octobre');
    sameJSON(app.recapMilestones(hist.slice(0, 3), app.recapPeriod('week', at(2026, 8, 1), NOW)), [], 'aucun palier franchi');
    // Semaine et mois : plus d'écran palier, une mention à l'ouverture et une ligne du résumé
    const wp = app.recapPages(app.recapStats(wk, hist, NOW));
    assert.ok(!wp.some(p => p.id === 'milestone'), 'semaine : pas d\'écran palier');
    assert.equal(wp[0].mention, 'Cette semaine : ta 10e séance depuis tes débuts, le mercredi 7 octobre', '« depuis tes débuts » : pas « 10e séance du mois »');
    assert.ok(!wp.at(-1).lines.some(([l]) => /palier/i.test(l)), 'semaine : le palier n\'encombre pas le résumé (dit à l\'ouverture)');
    const mst = app.recapStats(app.recapPeriod('month', at(2026, 9, 6), NOW), hist, NOW), mp = app.recapPages(mst);
    assert.ok(!mp.some(p => p.id === 'milestone'), 'mois : pas d\'écran palier');
    assert.equal(mp[0].mention, 'Ce mois-ci : ta 10e séance depuis tes débuts, le 7 octobre');
    assert.match(app.recapPageAlt(mp[0], mst), /Ce mois-ci : ta 10e séance depuis tes débuts, le 7 octobre\./, 'lu par VoiceOver');
    // Année : l'écran palier reste
    const yp = app.recapPages(app.recapStats(app.recapPeriod('year', at(2026, 9, 6), at(2027, 0, 5)), hist, at(2027, 0, 5)));
    const ms = yp.find(p => p.id === 'milestone');
    assert.ok(yp.at(-1).lines.some(([l, v]) => l === 'Palier de séances' && v === '10e séance, le 7 octobre'), 'année : palier dans le résumé');
    assert.equal(ms.value, '10e'); assert.equal(ms.caption, 'séance, le 7 octobre'); assert.equal(ms.kicker, 'TON PALIER');
    assert.equal(yp[0].mention, '', 'année : le palier a son écran');
    const sessions = hist.filter(h => h.date >= at(2026, 8, 1) && h.date < at(2026, 9, 1));
    const pr = app.recapExerciseProgress(sessions, { key: 'dc' });
    assert.equal(pr.from, app.calc1RM(40, 8)); assert.equal(pr.to, app.calc1RM(47, 8));
    assert.equal(app.recapExerciseProgress([...sessions].reverse(), { key: 'dc' }), null, 'en baisse : rien');
    const st = app.recapStats(week(), weekHistory(), NOW);
    assert.equal(app.recapHeadline(st), '3 séances, 1 record battu');
    assert.equal(app.recapHeadline({ ...st, records: [] }), '3 séances, 2 semaines d\'affilée');
  }));

  test('recapRecords : record de charge avec son point de départ d\'avant la période et sa courbe', () => inParis(() => {
    reset();
    const pu = (id, d, w) => ({ id, programme: 'ppl', category: 'push', date: d, duration: 0, exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s(String(w), '8')] }] });
    const hist = [pu('a', at(2026, 8, 21, 18), 50), pu('b', at(2026, 8, 28, 18), 52.5), pu('c', at(2026, 9, 5, 18), 52.5), pu('d', at(2026, 9, 13, 18), 55), pu('e', at(2026, 9, 16, 18), 57.5)];
    const st = app.recapStats(week(), hist, NOW);
    const r = st.bestRecord;
    assert.equal(r.w, 57.5);
    assert.equal(r.before.value, 52.5, 'départ : le record d\'avant la semaine, pas celui du mardi');
    assert.equal(r.before.date, at(2026, 8, 28, 18), 'date où ce record a été fait');
    sameJSON(r.curve.map(x => x.w), [50, 52.5, 52.5, 55, 57.5]);
    const t = app.recapRecordTexts(r);
    assert.equal(t.from, '52,5'); assert.equal(t.to, '57,5');
    assert.equal(t.gain, '+5 kg depuis ton record du 28 septembre');
    // Record de reps
    const reps = [pu('a', at(2026, 9, 5, 18), 50), { ...pu('b', at(2026, 9, 14, 18), 50), exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s('50', '10')] }] }];
    const rr = app.recapStats(week(), reps, NOW).bestRecord;
    assert.equal(rr.kind, 'reps');
    const tr = app.recapRecordTexts(rr);
    assert.equal(tr.from, '8'); assert.equal(tr.to, '10'); assert.equal(tr.unit, 'reps'); assert.equal(tr.sub, 'à 50 kg');
    assert.equal(tr.gain, '+2 répétitions depuis ton record du 5 octobre');
    assert.equal(rr.curve, null, 'record de reps : pas de courbe de charge');
  }));

  test('recapRecords : records notés (aide, allure, temps), égaler n\'est pas battre, jamais le 1RM estimé', () => inParis(() => {
    reset();
    const L = (id, d, exs) => ({ id, programme: 'ppl', category: 'legs', date: d, duration: 0, exercises: exs });
    const G = sets => ({ name: 'Gainage (planche)', measure: 'time', sets });
    const C = sets => ({ name: 'Course à pied', measure: 'cardio', sets });
    const A = sets => ({ name: 'Tractions assistées (machine)', sets });
    const Q = sets => ({ exId: 'sq', name: 'Squat barre', sets });
    const hist = () => [
      L('a', at(2026, 9, 5, 18), [G([s('', '60')]), C([{ weight: '', reps: '30', dist: '6' }]), A([s('30', '8')]), Q([s('100', '5')])]),
      // Squat : 100 × 5 égalé, 90 × 10 meilleur en 1RM estimé seulement : aucun record
      L('b', at(2026, 9, 13, 18), [G([s('', '75')]), C([{ weight: '', reps: '31', dist: '6.4' }]), A([s('25', '8')]), Q([s('100', '5'), s('90', '10')])]),
    ];
    const st = app.recapStats(week(), hist(), NOW);
    sameJSON(st.records.map(r => [r.name, r.kind]), [['Tractions assistées (machine)', 'aide'], ['Course à pied', 'allure'], ['Gainage (planche)', 'temps']]);
    const by = Object.fromEntries(st.records.map(r => [r.kind, r]));
    assert.equal(by.allure.label, 'Record 5 km');
    assert.equal(by.allure.value, '5 km à 4:51 /km');
    sameJSON(app.recapRecordTexts(by.allure), { from: '5:00', to: '4:51', unit: '', sub: 'au km, sur 5 km', gain: '−9 secondes au km depuis ton record du 5 octobre', since: ' depuis ton record du 5 octobre' });
    sameJSON(app.recapRecordTexts(by.temps), { from: '1 min', to: '1 min 15', unit: '', sub: 'tenu', gain: '+15 s depuis ton record du 5 octobre', since: ' depuis ton record du 5 octobre' });
    sameJSON(app.recapRecordTexts(by.aide), { from: '30', to: '25', unit: 'kg', sub: 'd\'aide × 8 répétitions', gain: `−5\u00a0kg d'aide depuis ton record du 5 octobre`, since: ' depuis ton record du 5 octobre' });
    assert.equal(by.aide.curve, null, 'aide : pas de courbe de charge');
    // Les records notés dans la séance font foi : aucun noté, aucun record ; un record noté est repris tel quel
    const none = hist(); none[1].records = [];
    assert.equal(app.recapStats(week(), none, NOW).records.length, 0);
    const one = hist(); one[1].records = [{ ex: 'Squat barre', kind: 'charge', before: 95, after: 100 }];
    const sq = app.recapStats(week(), one, NOW).records;
    sameJSON(sq.map(r => [r.kind, r.value, r.before.value]), [['charge', '100 kg × 5', 95]]);
  }));

  test('recapStats année : mois le plus actif, record le plus marquant, écran du mois, « ton année en chiffres »', () => inParis(() => {
    reset();
    const hist = [...weekHistory(),
      { id: 'm1', programme: 'ppl', category: 'push', date: at(2026, 2, 3, 18), duration: 50 * 60_000, exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s('50', '8')] }] },
      { id: 'm2', programme: 'ppl', category: 'push', date: at(2026, 2, 10, 18), duration: 50 * 60_000, exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s('52.5', '8')] }] },   // record charge
      { id: 'm3', programme: 'ppl', category: 'push', date: at(2026, 2, 17, 18), duration: 50 * 60_000, exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s('55', '8')] }] },     // record charge, plus lourd
      { id: 'm4', programme: 'ppl', category: 'push', date: at(2026, 2, 24, 18), duration: 50 * 60_000, exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s('55', '8')] }] },
      { id: 'm5', programme: 'ppl', category: 'push', date: at(2026, 2, 31, 18), duration: 50 * 60_000, exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s('55', '8')] }] },
      { id: 'old', programme: 'ppl', category: 'push', date: at(2025, 11, 20, 18), duration: 50 * 60_000, exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s('40', '8')] }] },
    ];
    const now = at(2026, 11, 5);
    const st = app.recapStats(app.recapPeriod('year', at(2026, 5, 1), now), hist, now);
    assert.equal(st.sessions, 9);
    assert.equal(st.months[2], 5); assert.equal(st.months[9], 4); assert.equal(st.months.reduce((a, b) => a + b, 0), 9);
    sameJSON(st.topMonth, { m: 2, label: 'Mars', count: 5 });
    assert.equal(st.bestRecord.value, '62,5 kg × 6', 'le plus lourd des records de charge de l\'année');
    assert.equal(st.records.length, 1, 'un record par exercice');
    sameJSON(st.prev, { sessions: 1, duration: 50 * 60_000, volume: 320, sets: 1 }, 'année 2025');
    assert.equal(st.streak.longest, 5, 'cinq mardis de mars d\'affilée');
    const pages = app.recapPages(st);
    const by = Object.fromEntries(pages.map(p => [p.id, p]));
    assert.equal(by.sessions.kicker, 'TON ANNÉE');
    assert.equal(by.profile.kicker, 'TON ANNÉE EN UN CORPS');
    assert.equal(by.streak.value, String(st.activeWeeks)); assert.equal(by.streak.caption, 'semaines actives');
    assert.equal(by.streak.note, 'Plus longue série : 5 semaines d\'affilée');
    assert.equal(by.streak.bars.top, 2); assert.equal(by.streak.bars.values.length, 12);
    assert.equal(by.streak.box, 'Mars, ton mois le plus actif : 5 séances');
    assert.match(by.exercise.box, /^Force estimée : 63,3 → 77,1\u00a0kg$/, 'force estimée, en mots simples');
    assert.match(by.exercise.foot, /soulever une seule fois/, 'force estimée expliquée');
    assert.equal(by.summary.kicker, '2026'); assert.equal(by.summary.title, 'Mon année en bref');
    sameJSON(by.summary.lines, [['Exercice le plus fait', 'Développé couché haltères'], ['Plus forte progression', 'Développé couché haltères · +22,5 kg (+56 %)'],
      ['Mois le plus actif', 'Mars · 5 séances'], ['Moment préféré', 'L\'après-midi, entre 14 h et 18 h']]);
    assert.ok(!JSON.stringify(pages).includes('n° 1'), 'plus de « n° 1 » nulle part');
  }));

  test('recapCardWeek / recapCardInfo : tout le dimanche (semaine en cours), lundi jusqu\'à midi (semaine passée), sinon rien', () => inParis(() => {
    reset();
    const hist = weekHistory();
    const MON = at(2026, 9, 19, 9);   // lundi 9 h, calculé à l'heure de Paris (NOW, pris hors de inParis, peut tomber après midi en UTC)
    assert.equal(app.recapCardWeek(at(2026, 9, 17, 23, 59)), null, 'samedi 23 h 59');
    assert.equal(app.recapCardWeek(at(2026, 9, 18, 0, 0)).key, 'w2026-10-12', 'dimanche 0 h : la semaine qui se termine');
    assert.equal(app.recapCardWeek(at(2026, 9, 18, 17, 59)).key, 'w2026-10-12', 'dimanche après-midi');
    assert.equal(app.recapCardWeek(at(2026, 9, 19, 9)).key, 'w2026-10-12', 'lundi matin : la semaine passée');
    assert.equal(app.recapCardWeek(at(2026, 9, 19, 11, 59)).key, 'w2026-10-12', 'lundi 11 h 59');
    assert.equal(app.recapCardWeek(at(2026, 9, 19, 12, 0)), null, 'lundi midi : plus de carte');
    for (const d of [20, 21, 22, 23, 24]) assert.equal(app.recapCardWeek(at(2026, 9, d, 20)), null, `jour ${d}`);
    const info = app.recapCardInfo({ history: hist, now: MON });
    assert.equal(info.period.key, 'w2026-10-12');
    sameJSON(info.totals, { sessions: 3, duration: 170 * 60_000, volume: app.recapTotals(hist.slice(1)).volume, sets: 10 });
    assert.equal(app.recapCardInfo({ history: hist, now: MON, seenKey: 'w2026-10-12' }), null, 'masquée par la croix');
    assert.equal(app.recapCardInfo({ history: hist, now: MON, off: true }), null, 'réglage coupé');
    assert.equal(app.recapCardInfo({ history: hist, now: at(2026, 9, 26, 9) }), null, 'semaine du 19 sans séance');
    assert.equal(app.recapCardInfo({ history: hist, now: at(2026, 9, 21, 9) }), null, 'mercredi');
  }));

  test('recapList : semaines et mois terminés avec séances, bilan de l\'année à partir du 1er décembre et années passées', () => inParis(() => {
    reset();
    const hist = [...weekHistory(),
      { id: 'old', programme: 'ppl', category: 'push', date: at(2025, 11, 20, 18), duration: 50 * 60_000, exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s('40', '8')] }] },
      { id: 'cur', programme: 'ppl', category: 'push', date: at(2026, 9, 19, 8), duration: 50 * 60_000, exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s('40', '8')] }] },
    ];
    let l = app.recapList({ history: hist, now: NOW });
    sameJSON(l.weeks.map(x => x.period.key), ['w2026-10-12', 'w2026-10-05', 'w2025-12-15'], 'semaine en cours (lundi 19) absente, semaines sans séance absentes');
    assert.equal(l.weeks[0].totals.sessions, 3);
    sameJSON(l.months.map(x => x.period.key), ['m2025-12'], 'octobre 2026 pas terminé');
    sameJSON(l.years.map(x => x.period.key), ['y2025'], 'bilan 2026 pas avant décembre');
    l = app.recapList({ history: hist, now: at(2026, 9, 18, 20) });
    assert.equal(l.weeks[0].period.key, 'w2026-10-12', 'dimanche soir : la semaine qui se termine est listée');
    assert.ok(!l.weeks.some(x => x.period.key === 'w2026-10-19'), 'rien dans le futur');
    l = app.recapList({ history: hist, now: at(2026, 11, 1, 9) });
    sameJSON(l.years.map(x => x.period.key), ['y2026', 'y2025'], '1er décembre : bilan de l\'année en cours');
    sameJSON(l.months.map(x => x.period.key), ['m2026-10', 'm2025-12']);
    sameJSON(app.recapList({ history: [], now: NOW }), { weeks: [], months: [], years: [] });
  }));

  test('recapRecords : le record mis en avant est celui qui a le plus progressé (en %), pas le plus lourd ; les autres listés avec leur gain', () => inParis(() => {
    reset();
    const ses = (id, d, exs) => ({ id, programme: 'ppl', category: 'legs', date: at(2026, 9, d, 18), duration: 0, exercises: exs });
    const ex = (exId, name, w, r = '8') => ({ exId, name, sets: [s(String(w), r)] });
    const base = [['sq', 'Squat barre', 100, 105], ['pr', 'Presse à cuisses', 130, 135], ['cu', 'Curl biceps haltères', 10, 11],
      ['lc', 'Leg curl machine', 40, 42.5], ['ex', 'Extension quadriceps', 50, 52.5], ['mo', 'Mollets debout', 60, 62.5]];
    const hist = [ses('a', 1, base.map(([id, n, w]) => ex(id, n, w))), ses('b', 15, base.map(([id, n, , w]) => ex(id, n, w)))];
    const month = app.recapPeriod('month', at(2026, 9, 15), NOW);
    const st = app.recapStats(month, hist, NOW);
    assert.equal(st.records.length, 6);
    // +1 kg au curl (+10 %) passe devant +5 kg au squat (+5 %) et à la presse (+4 %)
    assert.equal(st.bestRecord.name, 'Curl biceps haltères', 'la plus forte hausse relative, pas le plus lourd');
    assert.ok(Math.abs(st.bestRecord.rel - 0.1) < 1e-9);
    const pg = app.recapPages(st).find(p => p.id === 'records');
    assert.equal(pg.kicker, '6 RECORDS CE MOIS-CI');
    assert.equal(pg.lead, 'Ta plus forte progression', 'dit pourquoi celui-là (la période est dans le surtitre)');
    assert.equal(pg.box, '+1\u00a0kg (+10\u00a0%) depuis ton record du 1 octobre');
    assert.equal(pg.listTitle, 'Tes autres records');
    sameJSON(pg.list.map(x => [x.name, x.gain]), [['Leg curl machine', '+2,5\u00a0kg (+6\u00a0%)'], ['Squat barre', '+5\u00a0kg (+5\u00a0%)'], ['Extension quadriceps', '+2,5\u00a0kg (+5\u00a0%)']]);
    assert.equal(pg.list[1].value, '105\u00a0kg\u00a0×\u00a08');
    assert.equal(pg.more, 'et 2 autres records');
    assert.equal(pg.curve, null, 'plusieurs records : la liste plutôt que la courbe');
    // Sans point de départ (premier record sur la ligne), pas de pourcentage
    assert.equal(app.recapRecordRel({ kind: 'charge', rec: { after: 50 }, before: null }), null);
    assert.ok(Math.abs(app.recapRecordRel({ kind: 'aide', rec: { after: 25 }, before: { value: 30 } }) - 1 / 6) < 1e-9, 'moins d\'aide = hausse');
  }));

  test('recapRegularity : objectif = rythme habituel (médiane des semaines actives des 8 d\'avant, 2 au moins), semaines du mois au jeudi, nombre de séances par semaine', () => inParis(() => {
    reset();
    const one = (y, m, d, i) => ({ id: `r${y}${m}${d}${i}`, programme: 'ppl', category: 'push', date: at(y, m, d, 18 + i), duration: 3_600_000,
      exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s('40', '8')] }] });
    // n séances le lundi de la semaine w (lundi en date)
    const week = (y, m, d, n) => Array.from({ length: n }, (_, i) => one(y, m, d + i, 0));
    const before = [  // 8 semaines avant le 28 septembre : 3, 4, 3, vacances, vacances, 3, 2, 4 → médiane des actives 3
      ...week(2026, 7, 3, 3), ...week(2026, 7, 10, 4), ...week(2026, 7, 17, 3), ...week(2026, 8, 7, 3), ...week(2026, 8, 14, 2), ...week(2026, 8, 21, 4)];
    // Octobre 2026 : semaines du 28 sept. (jeudi 1er oct.), 5, 12, 19, 26 oct. (jeudi 29) → 5 semaines
    const oct = [...week(2026, 8, 28, 3), ...week(2026, 9, 5, 1), ...week(2026, 9, 12, 4), ...week(2026, 9, 26, 3)];
    const month = app.recapPeriod('month', at(2026, 9, 10), NOW);
    const reg = app.recapRegularity([...before, ...oct], month);
    assert.equal(reg.target, 3, 'les semaines de vacances n\'abaissent pas l\'objectif');
    sameJSON(reg.weeks.map(w => [new Date(w.start).getDate(), w.n, w.hit]), [[28, 3, true], [5, 1, false], [12, 4, true], [19, 0, false], [26, 3, true]]);
    assert.equal(reg.hit, 3); assert.equal(reg.total, 5);
    const st = app.recapStats(month, [...before, ...oct], NOW);
    const pg = app.recapPages(st).find(p => p.id === 'streak');
    assert.equal(pg.value, '3'); assert.equal(pg.unit, 'sur 5'); assert.equal(pg.caption, 'semaines avec 3 séances ou plus');
    assert.equal(pg.note, 'Ton rythme habituel les 2 mois d\'avant : 3 séances par semaine');
    sameJSON(pg.strip.map(w => w.n), [3, 1, 4, 0, 3], 'le nombre de séances de chaque semaine, pas juste coché ou vide');
    assert.ok(!/au moins une séance/.test(JSON.stringify(app.recapPages(st))), 'plus de « au moins une séance par semaine »');
    assert.equal(app.recapPages(st)[0].note, '3 semaines sur 5 à 3 séances ou plus, ton rythme habituel');
    // Une séance par semaine d'habitude : l'objectif reste 2, et l'écran dit que c'est un minimum (pas « ton rythme habituel : 2 »)
    const low = [1, 2, 3, 4].map(k => one(2026, 8, 28 - 7 * k, 0));
    const lr = app.recapRegularity([...low, ...oct], month);
    assert.equal(lr.target, 2); assert.equal(lr.usual, 1);
    const lpg = app.recapPages(app.recapStats(month, [...low, ...oct], NOW)).find(p => p.id === 'streak');
    assert.equal(lpg.note, 'Objectif : 2 séances par semaine (ton rythme habituel les 2 mois d\'avant : 1)');
    assert.ok(!/rythme habituel/.test(app.recapPages(app.recapStats(month, [...low, ...oct], NOW))[0].note), 'ouverture : pas « ton rythme habituel » quand il est de 1');
    // Médiane non entière (2, 3, 2, 3 → 2,5) : objectif 2, jamais « ton rythme habituel : 2 »
    const half = [...week(2026, 7, 31, 2), ...week(2026, 8, 7, 3), ...week(2026, 8, 14, 2), ...week(2026, 8, 21, 3)];
    const hr = app.recapRegularity([...half, ...oct], month);
    assert.equal(hr.target, 2); assert.equal(hr.usual, 2.5);
    assert.equal(app.recapPages(app.recapStats(month, [...half, ...oct], NOW)).find(p => p.id === 'streak').note, 'Objectif : 2 séances par semaine (ton rythme habituel les 2 mois d\'avant : 2,5)');
    // Semaine : la phrase d'ouverture suit la même règle
    const wk = app.recapPeriod('week', at(2026, 9, 12), NOW);
    const wn = app.recapPages(app.recapStats(wk, [...half, ...oct], NOW))[0].note;
    assert.ok(!/rythme habituel|objectif/.test(wn), `semaine : ni « rythme habituel » faux ni « objectif » jamais fixé (${wn})`);
    // Objectif tenu moins d'une semaine sur deux : pas d'écran ni de note (rien de bon à dire)
    const rare = [...before, ...week(2026, 8, 28, 3), ...week(2026, 9, 5, 1), ...week(2026, 9, 12, 2), ...week(2026, 9, 26, 1)];
    assert.equal(app.recapRegularity(rare, month).hit, 1);
    const rp = app.recapPages(app.recapStats(month, rare, NOW));
    assert.ok(!rp.some(p => p.id === 'streak'), '1 semaine sur 5 : écran masqué');
    assert.ok(!/semaines sur/.test(rp[0].note), 'ni note à l\'ouverture');
    // Moins de 3 semaines actives avant : pas d'objectif, pas d'écran
    assert.equal(app.recapRegularity(oct, month), null);
    assert.ok(!app.recapPages(app.recapStats(month, oct, NOW)).some(p => p.id === 'streak'));
    // Aucune semaine à l'objectif : pas d'écran (jamais de baisse)
    const weak = [...before, ...week(2026, 9, 5, 1), ...week(2026, 9, 12, 2)];
    assert.ok(!app.recapPages(app.recapStats(month, weak, NOW)).some(p => p.id === 'streak'));
    // Septembre 2026 : le 1er est un mardi → semaine du 31 août comprise ; celle du 28 sept. va à octobre
    const sept = app.recapRegularity(before, app.recapPeriod('month', at(2026, 8, 10), NOW));
    sameJSON(sept.weeks.map(w => new Date(w.start).getDate()), [31, 7, 14, 21]);
    // Semaine : les 8 dernières
    assert.equal(app.recapRegularity([...before, ...oct], app.recapPeriod('week', at(2026, 9, 27), NOW)).total, 8);
  }));

  test('recapBestWhy / recapExerciseProgress : « plus forte progression » toujours vraie, force estimée seulement en charge', () => inParis(() => {
    reset();
    const ses = (id, d, exs) => ({ id, programme: 'ppl', category: 'pull', date: at(2026, 9, d, 18), duration: 0, exercises: exs });
    // Squat +4 % (charge) et curl 8 → 12 reps à charge égale (+50 %) : le squat passe devant (type charge),
    // mais il n'a pas la plus forte progression → « Ta plus forte hausse de charge », jamais « progression »
    const hist = [ses('a', 1, [{ exId: 'sq', name: 'Squat barre', sets: [s('100', '5')] }, { exId: 'cu', name: 'Curl biceps haltères', sets: [s('12', '8')] }]),
      ses('b', 15, [{ exId: 'sq', name: 'Squat barre', sets: [s('104', '5')] }, { exId: 'cu', name: 'Curl biceps haltères', sets: [s('12', '12')] }])];
    const st = app.recapStats(app.recapPeriod('month', at(2026, 9, 15), NOW), hist, NOW);
    assert.equal(st.bestRecord.name, 'Squat barre');
    assert.ok(st.records.some(r => r.kind === 'reps' && r.rel > st.bestRecord.rel), 'le curl a bien progressé plus en %');
    assert.equal(app.recapBestWhy(st.records), 'Ta plus forte hausse de charge');
    const pages = app.recapPages(st);
    assert.equal(pages.find(p => p.id === 'records').lead, 'Ta plus forte hausse de charge');
    assert.ok(pages.at(-1).lines.some(([l]) => l === 'Plus forte hausse de charge'), 'le résumé dit la même chose');
    assert.ok(!JSON.stringify(pages).includes('forte progression'), 'jamais « plus forte progression » ici');
    // Plus d'aide du tout : +100 %
    assert.equal(app.recapRecordRel({ kind: 'aide', rec: { after: 0 }, before: { value: 20 } }), 1);
    // Force estimée : jamais sur une machine assistée (plus d'aide = moins fort)
    const as = (id, d, w) => ses(id, d, [{ exId: 'ta', name: 'Tractions assistées machine', sets: [s(String(w), '8')] }]);
    const assisted = [as('x', 2, 20), as('y', 9, 30), as('z', 16, 40)];
    assert.equal(app.recapExerciseProgress(assisted, app.recapTopExercise(assisted)), null);
  }));

  test('sanitizeData : recapCardOff gardé seulement à true', () => {
    reset();
    assert.equal(app.sanitizeData({ ...run('data'), recapCardOff: true }).recapCardOff, true);
    assert.equal(app.sanitizeData({ ...run('data'), recapCardOff: 'oui' }).recapCardOff, undefined);
    assert.equal(app.sanitizeData({ ...run('data'), recapCardOff: false }).recapCardOff, undefined);
  });
}
