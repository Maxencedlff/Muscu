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
    sameJSON(st.favSlot, { slot: 'soir', label: 'le soir', count: 2 });
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
    sameJSON(pages.map(p => p.id), ['sessions', 'profile', 'volume', 'records', 'exercise', 'summary'], 'ni série de semaines, ni premières fois');
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
    assert.equal(app.recapFavDay([e(at(2026, 9, 13)), e(at(2026, 9, 15))]), null, 'deux jours différents');
    assert.equal(app.recapFavDay([e(at(2026, 9, 13)), e(at(2026, 9, 20)), e(at(2026, 9, 15)), e(at(2026, 9, 22))]), null, 'égalité mardi / jeudi');
    sameJSON(app.recapFavDay([e(at(2026, 9, 13)), e(at(2026, 9, 20)), e(at(2026, 9, 15))]), { index: 1, label: 'mardi', count: 2 });
    sameJSON(app.recapFavSlot([e(at(2026, 9, 13, 7)), e(at(2026, 9, 14, 8)), e(at(2026, 9, 15, 19))]), { slot: 'matin', label: 'le matin', count: 2 });
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
    sameJSON(pages.map(p => p.id), ['sessions', 'profile', 'volume', 'records', 'exercise', 'streak', 'firsts', 'summary']);
    assert.ok(pages.every(p => ['lime', 'violet', 'orange', 'pink'].includes(p.tone) && p.share), 'chaque écran a sa couleur et son bouton');
    const by = Object.fromEntries(pages.map(p => [p.id, p]));
    assert.equal(by.sessions.tone, 'lime'); assert.equal(by.records.tone, 'orange'); assert.equal(by.profile.tone, 'violet'); assert.equal(by.streak.tone, 'pink');
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
    assert.equal(by.records.box, '+2,5 kg depuis ton record du 5 octobre');
    assert.match(by.records.kicker, /^NOUVEAU RECORD · MARDI 13$/);
    assert.equal(by.records.share, 'Partager ce record');
    assert.equal(by.exercise.title, 'Développé couché haltères'); assert.equal(by.exercise.caption, '2 séances · 4 séries');
    assert.equal(by.exercise.box, '', 'semaine : pas de progression du 1RM');
    assert.equal(by.streak.value, '2'); assert.equal(by.streak.caption, 'semaines d\'affilée');
    assert.equal(by.streak.strip.length, 8); assert.equal(by.streak.strip.filter(w => w.on).length, 2);
    sameJSON(by.firsts.list.map(x => x.name), ['Élévations latérales', 'Squat barre', 'Dips']);
    assert.equal(by.firsts.value, '3'); assert.equal(by.firsts.caption, 'nouveaux exercices');
    assert.equal(by.summary.tone, 'lime'); assert.equal(by.summary.kicker, 'MA SEMAINE · 12 – 18 OCTOBRE');
    assert.equal(by.summary.title, st.profile.title, 'le profil en titre de la story');
    sameJSON(by.summary.tiles.map(([l]) => l), ['Séries', 'Durée', 'Record', 'Semaines d\'affilée'], 'pas de « Séances » : la légende du chiffre le dit déjà');
    assert.equal(by.summary.share, 'Partager ma semaine');
    assert.equal(app.recapPageAlt(by.sessions, st), 'Ta semaine, 12 – 18 octobre : 3 séances. +2 séances par rapport à la semaine d\'avant.');
    assert.match(app.recapPageAlt(by.records, st), /nouveau record · mardi 13 : Développé couché haltères\. 60 → 62,5 kg\. × 6 répétitions\. \+2,5 kg depuis ton record du 5 octobre\./);
    assert.ok(!app.recapPageAlt(by.records, st).includes(' '), 'VoiceOver : espaces simples');
    assert.match(app.recapPageAlt(by.summary, st), /^Ta semaine, 12 – 18 octobre en chiffres : /);
    assert.equal(app.recapFileName(st.period, by.volume), 'mdlf-training-recap-w2026-10-12-volume.png');
    // Baisse : jamais affichée
    const down = app.recapStats(week(), weekHistory().filter(h => h.id !== 'h1' && h.id !== 'h3'), NOW);
    const dp = app.recapPages(down);
    assert.equal(dp[0].note, '2 semaines d\'affilée', 'pas de « −0 séance », la régularité à la place');
    assert.ok(!dp.some(p => /−|-\d/.test(p.note || '')), 'aucune baisse affichée');
    sameJSON(dp.map(p => p.id).slice(0, 2), ['sessions', 'streak'], 'petite semaine : la régularité d\'abord, le volume après');
  }));

  test('recapProfile : profil fait de faits (groupe « d\'abord », moment, lève-tôt, tout le corps), sinon rien', () => inParis(() => {
    reset();
    const p = week();
    const leg = (d, h, dur = 60 * 60_000) => ({ id: 'l' + d + h, programme: 'ppl', category: 'legs', date: at(2026, 9, d, h), duration: dur,
      exercises: [{ exId: 'sq', name: 'Squat barre', sets: [s('80', '5'), s('80', '5'), s('80', '5')] }] });
    let pr = app.recapProfile([leg(13, 19), leg(15, 19)], p, [leg(13, 19), leg(15, 19)], { slot: 'soir', label: 'le soir', count: 2 }, null);
    assert.equal(pr.title, 'Jambes d\'abord, le soir');
    assert.equal(pr.lines[0][0], 'Jambes'); assert.match(pr.lines[0][1], /^\d+ % de tes séries$/);
    sameJSON(pr.lines[1], ['Le soir', '2 séances sur 2']);
    assert.ok(['quads', 'glutes'].includes(pr.muscles[0].id)); assert.ok(pr.levels[pr.muscles[0].id] === 1, 'muscle le plus travaillé à pleine intensité');
    const early = [leg(13, 6), leg(15, 7)];
    pr = app.recapProfile(early, p, early, { slot: 'matin', label: 'le matin', count: 2 }, null);
    assert.equal(pr.title, 'Jambes d\'abord, lève-tôt');
    sameJSON(pr.lines[1], ['Avant 8 h', '2 séances sur 2']);
    // Sans heure ni groupe dominant : « Tout le corps » si 4 groupes à 12 % ou plus
    const full = [{ id: 'f', programme: 'ppl', category: 'full', date: at(2026, 9, 14, 12), duration: 0, exercises: [
      { exId: 'sq', name: 'Squat barre', sets: [s('80', '5'), s('80', '5')] }, { exId: 'dc', name: 'Développé couché haltères', sets: [s('30', '8'), s('30', '8'), s('30', '8')] },
      { exId: 'tr', name: 'Tractions', sets: [s('', '8'), s('', '8')] },
      { exId: 'ab', name: 'Crunch', sets: [s('', '15'), s('', '15'), s('', '15')] }] }];
    pr = app.recapProfile(full, p, full, null, null);
    assert.equal(pr.title, 'Tout le corps');
    assert.equal(app.recapProfile([], p, [], null, null), null, 'rien à dire : pas de profil');
  }));

  test('recapFirsts / recapWeekStrip / recapExerciseProgress / recapHeadline', () => inParis(() => {
    reset();
    const one = (i, d) => ({ id: 'x' + i, programme: 'ppl', category: 'push', date: d, duration: 0, exercises: [{ exId: 'dc', name: 'Développé couché haltères', sets: [s(String(40 + i), '8')] }] });
    const hist = Array.from({ length: 10 }, (_, i) => one(i, at(2026, 8, 1 + i * 4, 18)));   // 10 séances, la 10e le 6 octobre
    const f = app.recapFirsts(hist, app.recapPeriod('week', at(2026, 9, 6), NOW));
    sameJSON(f.milestones.map(m => m.n), [10]); sameJSON(f.newExercises, []);
    assert.equal(app.recapFirsts(hist.slice(0, 3), app.recapPeriod('week', at(2026, 8, 1), NOW)), null, 'première semaine : rien n\'est « nouveau »');
    const strip = app.recapWeekStrip(hist, app.recapPeriod('week', at(2026, 9, 6), NOW));
    assert.equal(strip.length, 8); assert.ok(strip.at(-1).on);
    assert.equal(app.recapWeekStrip(hist, app.recapPeriod('month', at(2026, 8, 10), NOW)).length, 5, 'septembre 2026 : 5 semaines');
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
    assert.equal(r.before.w, 52.5, 'départ : le record d\'avant la semaine, pas celui du mardi');
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
    assert.match(by.exercise.box, /^1RM estimé : 63,3 → 77,1\u00a0kg$/, 'progression du 1RM sur l\'année');
    assert.equal(by.summary.kicker, 'MON ANNÉE · 2026');
    sameJSON(by.summary.lines, [['Exercice n° 1', 'Développé couché haltères'], ['Record le plus marquant', 'Développé couché haltères · 62,5\u00a0kg\u00a0×\u00a06'], ['Mois le plus actif', 'Mars']]);
  }));

  test('recapCardWeek / recapCardInfo : dimanche à partir de 18 h (semaine en cours), lundi (semaine passée), sinon rien', () => inParis(() => {
    reset();
    const hist = weekHistory();
    assert.equal(app.recapCardWeek(at(2026, 9, 18, 17, 59)), null, 'dimanche 17 h 59');
    assert.equal(app.recapCardWeek(at(2026, 9, 18, 18, 0)).key, 'w2026-10-12', 'dimanche 18 h : la semaine qui se termine');
    assert.equal(app.recapCardWeek(at(2026, 9, 19, 9)).key, 'w2026-10-12', 'lundi : la semaine passée');
    assert.equal(app.recapCardWeek(at(2026, 9, 19, 23, 59)).key, 'w2026-10-12');
    for (const d of [20, 21, 22, 23, 24]) assert.equal(app.recapCardWeek(at(2026, 9, d, 20)), null, `jour ${d}`);
    const info = app.recapCardInfo({ history: hist, now: NOW });
    assert.equal(info.period.key, 'w2026-10-12');
    sameJSON(info.totals, { sessions: 3, duration: 170 * 60_000, volume: app.recapTotals(hist.slice(1)).volume, sets: 10 });
    assert.equal(app.recapCardInfo({ history: hist, now: NOW, seenKey: 'w2026-10-12' }), null, 'déjà vue');
    assert.equal(app.recapCardInfo({ history: hist, now: NOW, off: true }), null, 'réglage coupé');
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

  test('sanitizeData : recapCardOff gardé seulement à true', () => {
    reset();
    assert.equal(app.sanitizeData({ ...run('data'), recapCardOff: true }).recapCardOff, true);
    assert.equal(app.sanitizeData({ ...run('data'), recapCardOff: 'oui' }).recapCardOff, undefined);
    assert.equal(app.sanitizeData({ ...run('data'), recapCardOff: false }).recapCardOff, undefined);
  });
}
