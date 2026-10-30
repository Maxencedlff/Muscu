// Outils de la séance (lot 2) : disques (js/data/plates.js), échauffement (js/data/warmup.js), RIR (js/data/rir.js),
// et leurs exclusions dans le volume, les records, les muscles, les progrès et l'historique
export default function ({ test, run, reset, assert, sameJSON }) {
  const perSide = (t, bar, plates) => run(`platesPerSide(${t}, ${bar}, ${JSON.stringify(plates)})`);

  // ── Disques ──

  test('disques : exercices à barre reconnus, pas les haltères, poulies, machines, tractions ni le poids du corps', () => {
    reset();
    const bar = n => run(`isBarbellExercise({ name: ${JSON.stringify(n)} })`);
    for (const n of ['Squat barre', 'Développé couché barre', 'Soulevé de terre', 'Rowing barre', 'Développé militaire barre',
      'Curl biceps barre', 'Hip thrust', 'Squat avant', 'Soulevé de terre roumain', 'Barre au front', 'Développé décliné',
      'bench press', 'SDT', 'Front squat', 'Good morning']) assert.equal(bar(n), true, n);
    for (const n of ['Développé couché haltères', 'Squat gobelet', 'Soulevé de terre roumain haltères', 'Tractions pronation', 'Dips',
      'Squat poids du corps', 'Squat smith', 'Développé couché machine', 'Extension triceps poulie', 'Presse à cuisses',
      'Tapis de course', 'Gainage (planche)', 'Squat élastique', 'Soulevé de terre kettlebell', 'Curl pupitre']) assert.equal(bar(n), false, n);
    assert.equal(run(`isBarbellExercise({ name: 'Squat barre', measure: 'time' })`), false, 'mis en durée : pas de disques');
    assert.equal(run(`isBarbellExercise({ name: 'Rowing barre penché unilatéral' })`), false, 'nom libre avec « unilatéral » : écarté');
    assert.equal(run(`isBarbellExercise({ name: 'Zercher squat' })`), true, 'nom libre à barre');
  });

  test('disques : répartition par côté, exacte, au plus proche, sous la barre', () => {
    reset();
    const std = [25, 20, 15, 10, 5, 2.5, 1.25];
    sameJSON(perSide(100, 20, std), { perSide: [25, 15], total: 100, exact: true, belowBar: false }, 'deux disques, le plus lourd d\'abord');
    sameJSON(perSide(62.5, 20, std), { perSide: [20, 1.25], total: 62.5, exact: true, belowBar: false });
    sameJSON(perSide(97.5, 20, std).perSide, [25, 10, 2.5, 1.25]);
    sameJSON(perSide(20, 20, std), { perSide: [], total: 20, exact: true, belowBar: false }, 'barre à vide');
    sameJSON(perSide(15, 20, std), { perSide: [], total: 20, exact: false, belowBar: true }, 'sous la barre');
    const r = perSide(61, 20, std);   // 20,5 par côté : 20 + rien de 0,5
    sameJSON(r, { perSide: [20], total: 60, exact: false, belowBar: false }, 'au plus proche en dessous');
    sameJSON(perSide(80, 20, [15]).perSide, [15, 15], 'jeu réduit : deux 15 (le glouton se tromperait avec 20 absent)');
    sameJSON(perSide(70, 20, [20, 15]), { perSide: [20], total: 60, exact: false, belowBar: false }, '25 par côté impossible avec 20 et 15 : 20 seul');
    sameJSON(perSide(90, 20, [20, 15]).perSide, [20, 15], '35 par côté = 20 + 15');
    sameJSON(perSide(1000, 20, std).perSide.length > 0, true, 'charge maximale sans blocage');
    sameJSON(perSide(100, 45, [45, 35, 25, 10, 5, 2.5]).perSide, [25, 2.5], 'livres : 27,5 par côté');
    sameJSON(perSide(60, 20, []), { perSide: [], total: 20, exact: false, belowBar: false }, 'aucun disque');
  });

  test('disques : réglage nettoyé (barres connues, disques bornés au quart, 12 sortes), jeu standard par défaut', () => {
    reset();
    assert.equal(run(`cleanPlates(null)`), null);
    assert.equal(run(`cleanPlates({ kg: [], bar: { kg: 17 } })`), null, 'rien de valable');
    sameJSON(run(`cleanPlates({ kg: [2.5, 20, 20, 0.1, 999, '5', 1.3], bar: { kg: 15, lb: 40 } })`), { kg: [20, 5, 2.5, 1.25], bar: { kg: 15 } });
    assert.equal(run(`cleanPlates({ kg: Array.from({ length: 30 }, (_, i) => i + 1) }).kg.length`), 12);
    sameJSON(run(`plateSetup()`), { unit: 'kg', bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] });
    run(`data.plates = { bar: { kg: 15 }, kg: [10, 5] }; sanitizeData(data);`);
    sameJSON(run(`plateSetup()`), { unit: 'kg', bar: 15, plates: [10, 5] });
    run(`data.plates = { bar: { kg: 99 } }; sanitizeData(data);`);
    assert.equal(run(`data.plates`), undefined, 'réglage invalide retiré');
    reset({ unit: 'lbs' });
    sameJSON(run(`plateSetup()`), { unit: 'lb', bar: 45, plates: [45, 35, 25, 10, 5, 2.5] });
    assert.ok(run(`SYNC_LOCAL_ONLY.includes('plates') && SYNC_LOCAL_ONLY.includes('rirOn')`), 'réglages propres à l\'appareil');
  });

  test('disques : arrondi au matériel (barre + paires du plus petit disque, jamais sous la barre ; racks de 2,5)', () => {
    reset();
    const kg = { unit: 'kg', bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };
    assert.equal(run(`roundLoad(33.3, ${JSON.stringify({ ...kg, barbell: true })})`), 32.5);
    assert.equal(run(`roundLoad(12, ${JSON.stringify({ ...kg, barbell: true })})`), 20, 'jamais sous la barre');
    assert.equal(run(`roundLoad(33.3, ${JSON.stringify({ ...kg, barbell: true, plates: [20, 10, 5] })})`), 30, 'plus petit disque 5 : pas de 10');
    assert.equal(run(`roundLoad(33.3, ${JSON.stringify({ ...kg, barbell: false })})`), 32.5, 'haltères : pas de 2,5');
    assert.equal(run(`roundLoad(0.4, ${JSON.stringify({ ...kg, barbell: false })})`), 2.5, 'jamais 0');
    assert.equal(run(`roundLoad(52, { unit: 'lb', bar: 45, plates: [45, 35, 25, 10, 5, 2.5], barbell: false })`), 50, 'livres : pas de 5');
    assert.equal(run(`platesText([20, 2.5])`), '20 + 2,5');
    assert.equal(run(`platesText([])`), '—');
  });

  // ── Échauffement ──

  test('échauffement : 40 % × 8, 60 % × 5, 80 % × 3 arrondis au matériel, paliers confondus ou égaux au travail retirés', () => {
    reset();
    const kg = { unit: 'kg', bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], barbell: true };
    const plan = (w, setup = kg) => run(`warmupSets(${w}, v => roundLoad(v, ${JSON.stringify(setup)}))`);
    sameJSON(plan(100), [{ pct: 0.4, load: 40, reps: 8 }, { pct: 0.6, load: 60, reps: 5 }, { pct: 0.8, load: 80, reps: 3 }]);
    sameJSON(plan(30), [{ pct: 0.4, load: 20, reps: 8 }, { pct: 0.8, load: 25, reps: 3 }], '40 et 60 % tombent sur la barre : une seule série, celle qui a le plus de reps');
    sameJSON(plan(20), [], 'charge de travail = barre : rien');
    sameJSON(plan(0), [], 'sans charge : rien');
    sameJSON(plan(14, { ...kg, barbell: false }), [{ pct: 0.4, load: 5, reps: 8 }, { pct: 0.6, load: 7.5, reps: 5 }, { pct: 0.8, load: 10, reps: 3 }], 'haltères de 14 kg');
    sameJSON(run(`warmupSets(10)`), [{ pct: 0.4, load: 4, reps: 8 }, { pct: 0.6, load: 6, reps: 5 }, { pct: 0.8, load: 8, reps: 3 }], 'sans arrondi');
    sameJSON(run('WARMUP_STEPS'), [[0.4, 8], [0.6, 5], [0.8, 3]], 'règle affichée dans la feuille et la doc');
  });

  test('échauffement : charge de base, numérotation des séries, exercices admis', () => {
    reset();
    const ex = { name: 'Squat barre', sets: [{ weight: '', reps: '8', prev: { weight: '60', reps: '8' }, done: false }, { weight: '62.5', reps: '8', done: false }] };
    assert.equal(run(`warmupBaseKg(${JSON.stringify(ex)})`), '60', 'la dernière fois quand la série est vide');
    ex.sets[0].weight = '65';
    assert.equal(run(`warmupBaseKg(${JSON.stringify(ex)})`), '65', 'la charge inscrite d\'abord');
    assert.equal(run(`canWarmup(${JSON.stringify(ex)})`), true);
    assert.equal(run(`canWarmup(${JSON.stringify({ ...ex, sets: [{ weight: '60', reps: '8', done: true }] })})`), false, 'série déjà faite');
    assert.equal(run(`canWarmup(${JSON.stringify({ ...ex, sets: [{ weight: '20', reps: '8', warmup: true }, ...ex.sets] })})`), false, 'déjà un échauffement');
    assert.equal(run(`canWarmup(${JSON.stringify({ ...ex, ss: 'g1' })})`), false, 'en superset : jamais (les tours se décaleraient)');
    assert.equal(run(`canWarmup({ name: 'Tractions pronation', sets: [{ weight: '10', reps: '8' }] })`), false, 'lest : pas d\'échauffement calculé');
    assert.equal(run(`canWarmup({ name: 'Gainage (planche)', sets: [{ weight: '', reps: '45' }] })`), false, 'durée');
    assert.equal(run(`canWarmup({ name: 'Développé couché haltères', sets: [{ weight: '', reps: '10', prev: null }] })`), false, 'sans charge connue');
    const sets = [{ warmup: true }, { warmup: true }, {}, {}, {}];
    sameJSON(sets.map((_, i) => run(`setDisplayNo(${JSON.stringify(sets)}, ${i})`)), [0, 0, 1, 2, 3], 'les séries de travail restent 1, 2, 3');
    sameJSON(run(`workSets(${JSON.stringify(sets)}).length`), 3);
  });

  test('échauffement exclu : volume, records, 1RM, dernière série, muscles, progrès, meilleure série, texte des séries', () => {
    reset();
    const sets = [{ weight: '40', reps: '8', warmup: true }, { weight: '60', reps: '5', warmup: true }, { weight: '80', reps: '8' }, { weight: '80', reps: '7' }];
    const ex = { exId: 'g1squatb', name: 'Squat barre', sets };
    assert.equal(run(`setsVolume(${JSON.stringify(sets)})`), 80 * 15, 'volume des séries de travail seules');
    assert.equal(run(`exVolume(${JSON.stringify(ex)})`), 80 * 15);
    assert.equal(run(`exVolume({ name: 'Tractions pronation', sets: [{ weight: '', reps: '5', warmup: true }, { weight: '', reps: '10' }] }, undefined, 80)`), 760, 'au poids du corps : 80 × 0,95 × 10');
    sameJSON(run(`bestSet(${JSON.stringify([{ weight: '100', reps: '1', warmup: true }, { weight: '80', reps: '8' }])})`).weight, '80', 'meilleure série : jamais l\'échauffement, même plus lourd');
    assert.equal(run(`exerciseRecord(${JSON.stringify({ ...ex, sets: [{ weight: '70', reps: '8', warmup: true }, { weight: '60', reps: '8' }] })}, { prW: 60, prR: 8, e1rm: 76 })`), null, 'un échauffement plus lourd que le record ne compte pas');
    assert.equal(run(`setsText(${JSON.stringify(sets)})`), '80 kg × 8 · 7');
    assert.equal(run(`warmupText(${JSON.stringify(sets)})`), 'Échauffement 40 kg × 8 · 60 kg × 5');
    assert.equal(run(`warmupText([{ weight: '80', reps: '8' }])`), '');
    // Historique : records, 1RM et dernière série recalculés sans l'échauffement ; ligne de base des records aussi
    run(`data.history = [{ id: 'h1', programme: 'ppl', category: 'legs', date: Date.now() - 86400000, exercises: [
      { exId: ${JSON.stringify(run('data.programmes.ppl.exercises.legs[0].id'))}, name: ${JSON.stringify(run('data.programmes.ppl.exercises.legs[0].name'))},
        sets: [{ weight: '200', reps: '1', warmup: true }, { weight: '80', reps: '8' }, { weight: '80', reps: '7' }] }] }];
      recomputePRFromHistory();`);
    sameJSON(run('data.programmes.ppl.exercises.legs[0].pr'), { weight: '80', reps: '8' });
    assert.equal(run('data.programmes.ppl.exercises.legs[0].est1RM'), run(`calc1RM('80', '8')`));
    assert.equal(run('data.programmes.ppl.exercises.legs[0].lastWeight'), '80');
    const base = run(`historyBaseline({ id: 'h2', programme: 'ppl', category: 'legs', date: Date.now(), exercises: [{ exId: data.programmes.ppl.exercises.legs[0].id, name: data.programmes.ppl.exercises.legs[0].name, sets: [] }] }, data.history)`);
    assert.equal(Object.values(base)[0].prW, 80, 'ligne de base sans l\'échauffement à 200');
    // Séries par muscle : 2 séries, pas 4
    const counts = run(`muscleSetCounts([{ date: Date.now(), exercises: [${JSON.stringify(ex)}] }]).counts`);
    assert.equal(counts.quads, 2);
    // Progrès : point sans l'échauffement
    const p = run(`exPoint({ date: 1, id: 'h' }, ${JSON.stringify(ex)})`);
    assert.equal(p.maxLoad, 80); assert.equal(p.volume, 1200); assert.equal(p.totalReps, 15);
    assert.equal(run(`exPoint({ date: 1, id: 'h' }, ${JSON.stringify({ ...ex, sets: sets.slice(0, 2) })})`), null, 'que de l\'échauffement : aucun point');
    // Bilan : séries de travail comptées, meilleure série hors échauffement
    run(`data.history = []`);
    const sum = run(`buildSummary({ id: 'e', programme: 'ppl', category: 'legs', date: Date.now(), duration: 1, exercises: [${JSON.stringify(ex)}] }, {})`);
    assert.equal(sum.sets, 2); assert.equal(sum.volume, 1200); assert.equal(sum.rows[0].weight, '80');
  });

  test('bilan : volume d\'avant comparé sur autant de séries de travail, échauffements retirés des deux côtés', () => {
    reset();
    const w = (weight, reps) => ({ weight, reps, warmup: true }), s = (weight, reps) => ({ weight, reps });
    const sq = { exId: 'sq', name: 'Squat barre' };
    // La dernière fois : 2 échauffements puis 3 séries à 80 × 5 (1200 kg) ; aujourd'hui : 3 échauffements puis 3 séries à 80 × 5
    run(`data.history = [{ id: 'p', programme: 'ppl', category: 'legs', date: Date.now() - 86400000, exercises: [${JSON.stringify({ ...sq, sets: [w('40', '8'), w('60', '5'), s('80', '5'), s('80', '5'), s('80', '5')] })}] }]`);
    const today = { id: 'e', programme: 'ppl', category: 'legs', date: Date.now(), duration: 1,
      exercises: [{ ...sq, sets: [w('30', '8'), w('50', '5'), w('70', '3'), s('80', '5'), s('80', '5'), s('80', '5')] }] };
    const sum = run(`buildSummary(${JSON.stringify(today)}, {})`);
    assert.equal(sum.volume, 1200);
    assert.equal(sum.delta, 0, 'même travail : aucun progrès inventé');
    // Aujourd'hui sans échauffement, la dernière fois avec : toujours 3 séries contre 3
    const plain = { ...today, exercises: [{ ...sq, sets: [s('80', '5'), s('80', '5'), s('80', '5')] }] };
    assert.equal(run(`buildSummary(${JSON.stringify(plain)}, {})`).delta, 0);
  });

  test('échauffement et RIR : nettoyés au chargement, gardés à l\'enregistrement, ignorés par les versions d\'avant', () => {
    reset();
    const h = { id: 'h', programme: 'ppl', category: 'push', date: 1, exercises: [{ name: 'DC', sets: [
      { weight: '20', reps: '8', warmup: true, rir: 2 }, { weight: '40', reps: '8', warmup: 'oui', rir: 7 }, { weight: '40', reps: '8', rir: '1' }, { weight: '40', reps: '8', rir: 4.5 }] }] };
    run(`cleanHistoryEntry(${JSON.stringify(h)}) && (globalThis.__h = ${JSON.stringify(h)}, cleanHistoryEntry(__h))`);
    sameJSON(run('__h.exercises[0].sets.map(s => [s.warmup ?? null, s.rir ?? null])'), [[true, 2], [null, null], [null, 1], [null, null]]);
    run(`globalThis.sessionNotes ??= ''`);
    run(`activeSession = { category: 'push', programme: 'ppl', startedAt: Date.now() - 60000, exercises: [
      { exId: 'a', name: 'Développé couché barre', sets: [{ weight: '20', reps: '8', done: true, warmup: true }, { weight: '60', reps: '8', done: true, rir: 2 }, { weight: '60', reps: '8', done: true }, { weight: '60', reps: '8', done: false, rir: 1 }] }] };`);
    const e = run(`sessionHistoryEntry('ppl', 'push')`);
    sameJSON(e.exercises[0].sets, [{ weight: '20', reps: '8', warmup: true }, { weight: '60', reps: '8', rir: 2 }, { weight: '60', reps: '8' }]);
    run('activeSession = null');
    // Format d'avant : une série sans ces champs reste une série de travail sans RIR
    assert.equal(run(`isWarmupSet({ weight: '60', reps: '8' })`), false);
    assert.equal(run(`cleanRir(undefined)`), null);
  });

  // ── RIR ──

  test('RIR : équivalence RPE (0 = 10, 1 = 9, 2 = 8, 3 = 7, 4+ = ≤ 6), textes, effort moyen, réglage', () => {
    reset();
    sameJSON([0, 1, 2, 3, 4].map(r => run(`rirToRpe(${r})`)), ['10', '9', '8', '7', '≤ 6']);
    sameJSON([0, 1, 2, 3, 4].map(r => run(`rirTxt(${r})`)), ['0', '1', '2', '3', '4+']);
    assert.equal(run(`rirToRpe(5)`), '', 'hors échelle');
    assert.equal(run(`rirToRpe(null)`), '');
    assert.equal(run(`cleanRir('2')`), 2); assert.equal(run(`cleanRir(2.5)`), null); assert.equal(run(`cleanRir(-1)`), null); assert.equal(run(`cleanRir('')`), null);
    assert.equal(run(`meanRpe([{ rir: 2 }, { rir: 0 }, {}, { rir: 1, warmup: true }])`), 9, '(8 + 10) / 2, l\'échauffement et les séries non notées ignorés');
    assert.equal(run(`meanRpe([{ rir: 4 }])`), 6, '4 et plus compté 6');
    assert.equal(run(`meanRpe([{}, {}])`), null);
    assert.equal(run(`rirLine([{ rir: 2 }, {}, { rir: 4 }, { rir: 0, warmup: true }])`), 'RIR 2 · — · 4+');
    assert.equal(run(`rirLine([{}, {}])`), '');
    assert.equal(run(`rirShown()`), true, 'montré par défaut');
    run(`data.rirOn = false;`);
    assert.equal(run(`rirShown()`), false);
    run(`data = normalizeData({ history: [] }); `);
    assert.equal(run(`data.rirOn`), true, 'donnée d\'avant : montré');
    assert.equal(run(`normalizeData({ history: [], rirOn: false }).rirOn`), false, 'refus gardé');
    // Progrès : point avec l'effort moyen
    const p = run(`exPoint({ date: 1, id: 'h' }, { name: 'DC', sets: [{ weight: '60', reps: '8', rir: 2 }, { weight: '60', reps: '8', rir: 3 }] })`);
    assert.equal(p.rpe, 7.5);
    assert.equal(run(`exPoint({ date: 1, id: 'h' }, { name: 'DC', sets: [{ weight: '60', reps: '8' }] }).rpe`), null);
  });
}
