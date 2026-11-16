// Vacuum abdominal (16/11/2026, docs/VACUUM.md) : noté en maintiens (secondes), chrono guidé, records en secondes,
// transverse seul (jamais compté en séries d'abdominaux ni coloré sur les tablettes), anciennes séances lisibles
export default function ({ test, run, reset, assert, sameJSON }) {
  const DAY = 86400000;
  let n = 0;
  const h = (day, sets, ex = {}) => ({ id: 'v' + (++n), programme: 'ppl', category: 'legs', date: day * DAY,
    exercises: [{ name: 'Vacuum', ...ex, sets: sets.map(reps => ({ weight: '', reps: String(reps) })) }] });

  test('vacuum : noté en maintiens (secondes), 10 s par défaut, « 5 maintiens », repos court', () => {
    reset();
    assert.equal(run(`measureOf({ name: 'Vacuum' })`), 'time');
    assert.equal(run(`measureOf({ name: 'Stomach vacuum' })`), 'time', 'alias');
    assert.equal(run(`storedMeasure({ name: 'Vacuum' })`), 'time', 'mesure écrite dans la séance');
    assert.equal(run(`defaultGoal('time', 12, 'Vacuum')`), 10);
    assert.equal(run(`defaultGoal('time', 12, 'Gainage (planche)')`), 30, 'autres maintiens : inchangés');
    assert.equal(run(`setsRepsText({ name: 'Vacuum', sets: 5 })`), '5 maintiens');
    assert.equal(run(`setsRepsText({ name: 'Vacuum', sets: 1 })`), '1 maintien');
    assert.equal(run(`setsRepsText({ name: 'Gainage (planche)', sets: 3 })`), '3 séries');
    assert.equal(run(`measureSetTxt({ weight: '', reps: '15' }, 'time')`), '15 s');
    assert.equal(run(`exRest({ name: 'Vacuum', sets: [] })`), 15, 'repos par défaut du maintien guidé');
    assert.equal(run(`setSpokenName({ name: 'Vacuum', sets: [{ reps: '10' }, { reps: '10' }] }, 1)`), 'Maintien 2');
    assert.equal(run(`setRefName({ name: 'Vacuum', sets: [{ reps: '10' }] }, 0)`), 'le maintien 1');
    assert.equal(run(`setSpokenName({ name: 'Crunch', sets: [{ reps: '10' }] }, 0)`), 'Série 1');
  });

  test('vacuum : chrono guidé (expire, rentre le ventre, respire petit, relâche)', () => {
    reset();
    const g = 'holdGuide({ name: "Vacuum" })';
    assert.ok(run(g));
    assert.equal(run(`holdGuide({ name: 'Gainage (planche)' })`), null, 'gainage : chrono habituel');
    const cue = (start, now) => run(`holdCue(${g}, effortClock({ start: ${start}, target: 10, sides: 1 }, ${now}))`);
    assert.equal(cue(5000, 0), 'Expire tout ton air', 'préparation, 5 s');
    assert.equal(cue(5000, 3500), 'Rentre le bas du ventre', 'fin de la préparation');
    assert.equal(cue(0, 2000), 'Respire petit, dos immobile', 'pendant le maintien');
    assert.equal(cue(0, 8000), 'Encore un peu', '3 dernières secondes');
    assert.equal(cue(0, 10000), 'Relâche', 'fin');
    assert.equal(run(`holdCue(null, effortClock({ start: 0, target: 10, sides: 1 }, 2000))`), null);
  });

  test('vacuum : records en secondes (maintien le plus long), jamais un poids', () => {
    reset();
    run(`globalThis.__h = ${JSON.stringify([h(2, [15, 18], { measure: 'time' }), h(1, [12, 12], { measure: 'time' })])}`);
    sameJSON(run('sessionRecords(__h[0], __h)'), [{ ex: 'Vacuum', kind: 'temps', before: 12, after: 18, w: 0 }]);
    assert.equal(run(`notedLabel({ kind: 'temps' })`), 'Record temps');
    // Séance d'avant en répétitions : jamais la référence d'un maintien (une autre mesure)
    run(`globalThis.__h = ${JSON.stringify([h(2, [15], { measure: 'time' }), h(1, [30])])}; cleanHistoryEntry(__h[1])`);
    sameJSON(run('sessionRecords(__h[0], __h)'), [], 'première fois en secondes : rien');
  });

  test('vacuum : transverse seul, aucune série comptée en abdominaux, aucun muscle en rouge', () => {
    reset();
    const m = run(`(() => { const m = musclesOf('Vacuum'); return { p: [...m.primary], s: [...m.secondary], d: [...m.deep] }; })()`);
    sameJSON(m, { p: [], s: [], d: ['transverse'] });
    assert.equal(run(`deepMuscleLabel('transverse', true)`), 'Transverse (profond)');
    assert.ok(run(`musclesKnown(musclesOf('Vacuum'))`), 'jamais « muscles à choisir »');
    sameJSON(run(`[...musclesOf('Vacuum à genoux').deep]`), ['transverse'], 'nom libre');
    assert.equal(run(`musclesOf('Vacuum à genoux').primary.length`), 0);
    // Séances de vacuum, en secondes et en répétitions (avant le 16/11) : 0 série pour les abdominaux
    const hist = [h(2, [10, 10, 10], { measure: 'time' }), h(1, [12, 12])];
    const c = run(`muscleSetCounts(${JSON.stringify(hist)}).counts`);
    assert.equal(c.abs, 0); assert.equal(c.obliques, 0);
    assert.equal(Object.values(c).reduce((a, v) => a + v, 0), 0, 'aucun muscle');
    sameJSON(run(`sessionMuscleLevels(${JSON.stringify(hist[0])})`), {}, 'image partagée : rien en rouge');
    assert.equal(run(`exThumbHtml({ name: 'Vacuum', sets: [] }, 0)`), '', 'pas de vignette rouge en séance');
    sameJSON(run(`unknownMuscleExercises(${JSON.stringify(hist)})`), []);
    // Bibliothèque : rangé et filtré avec les abdominaux (groupe entier), jamais sous « Grand droit »
    assert.ok(run(`muscleFilterMatch(musclesOf('Vacuum'), { group: 'abdominaux', muscle: null })`));
    assert.ok(!run(`muscleFilterMatch(musclesOf('Vacuum'), { group: 'abdominaux', muscle: 'abs' })`));
    assert.ok(run(`exerciseMatchScore('Vacuum', 'transverse') > 0`), 'recherche « transverse »');
    // Volume en kg : rien
    assert.equal(run(`exVolume({ name: 'Vacuum', measure: 'time', sets: [{ weight: '', reps: '20' }] })`), 0);
  });

  test('vacuum : anciennes séances en séries × reps lisibles, programmes passés aux maintiens', () => {
    reset();
    // Séance d'avant (aucune mesure enregistrée) : gardée en répétitions, à chaque nettoyage
    const old = run(`(() => { const x = ${JSON.stringify(h(1, [12, 12, 12]))}; cleanHistoryEntry(x); cleanHistoryEntry(x); return x; })()`);
    assert.equal(old.exercises[0].measure, 'reps');
    assert.equal(old.exercises[0].sets.length, 3, 'rien ne disparaît');
    assert.equal(run(`setsText(${JSON.stringify(old.exercises[0].sets)}, measureOf(${JSON.stringify(old.exercises[0])}))`), '12 · 12 · 12 reps');
    // Séance d'aujourd'hui : en secondes, pas touchée
    const now = run(`(() => { const x = ${JSON.stringify(h(2, [15], { measure: 'time' }))}; cleanHistoryEntry(x); return x.exercises[0].measure; })()`);
    assert.equal(now, 'time');
    // Programme qui contient du vacuum (même très ancien) : valide, et en maintiens
    for (const schema of [3, 5, 6]) {
      const d = run(`normalizeData(${JSON.stringify({ schema, activeProgramme: 'ppl', history: [],
        programmes: { ppl: { exercises: { legs: [{ id: 'v', name: 'Vacuum', sets: 3 }] }, timers: {}, cooldowns: {} } } })})`);
      const ex = d.programmes.ppl.exercises.legs[0];
      assert.equal(ex.measure, undefined, `schéma ${schema} : pas figé`);
      assert.equal(run(`measureOf(${JSON.stringify(ex)})`), 'time');
    }
    // Séance suivante : « 12 reps » d'avant n'est ni l'« Avant » ni l'objectif d'un maintien
    run(`data.programmes.ppl.exercises.legs = [{ id: 'v', name: 'Vacuum', sets: 2, lastReps: '12', lastWeight: '' }];
      data.history = [${JSON.stringify({ ...h(1, [12, 12]), exercises: [{ ...h(1, [12, 12]).exercises[0], exId: 'v' }] })}]; cleanHistoryEntry(data.history[0])`);
    const sets = run(`buildSets('ppl', 'legs', data.programmes.ppl.exercises.legs[0], 2, data.programmes.ppl.exercises.legs[0])`);
    sameJSON(sets.map(s => [s.reps, s.prev]), [['', null], ['', null]]);
    // Progrès : la courbe du vacuum ne lit que les séances en secondes ; l'ancienne reste dans l'historique
    run(`data.history.unshift(${JSON.stringify({ ...h(3, [20, 15]), exercises: [{ ...h(3, [20, 15], { measure: 'time' }).exercises[0], exId: 'v' }] })})`);
    const it = run(`(() => { const it = exerciseIndex().get('v'); return { m: it.measure, n: it.points.length, total: it.points[0].totalReps }; })()`);
    sameJSON(it, { m: 'time', n: 1, total: 35 });
  });
}
