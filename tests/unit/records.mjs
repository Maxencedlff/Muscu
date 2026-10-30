// Records notés dans la séance (js/data/records.js : sessionRecords, renoteRecords, cleanNotedRecords, textes) :
// égaler n'est jamais un record, la première fois ne compte pas, jamais le 1RM estimé ni le niveau d'une machine
export default function ({ test, run, reset, assert, sameJSON }) {
  const DAY = 86400000;
  let n = 0;
  // Séance de l'historique : exercices [[nom, [[poids, reps, extra?]…], extra?]…]
  const h = (day, exercises, extra = {}) => ({ id: 'h' + (++n), programme: 'ppl', category: 'legs', date: day * DAY, ...extra,
    exercises: exercises.map(([name, sets, ex = {}]) => ({ name, ...ex, sets: sets.map(([weight, reps, more = {}]) => ({ weight: String(weight), reps: String(reps), ...more })) })) });
  const recs = (hist) => run(`sessionRecords(__h[__h.length - 1], __h)`, run(`globalThis.__h = ${JSON.stringify(hist)}`));

  test('records notés : charge, reps à charge égale ; égalité, première fois, échauffement et 1RM jamais', () => {
    reset();
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]])]), [], 'première fois : rien');
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]]), h(2, [['Squat barre', [[100, 5]]]])]), [], 'égaler : rien');
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]]), h(2, [['Squat barre', [[102.5, 2], [100, 6]]]])]),
      [{ ex: 'Squat barre', kind: 'charge', before: 100, after: 102.5 }], 'charge d\'abord');
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]]), h(2, [['Squat barre', [[100, 7], [100, 6]]]])]),
      [{ ex: 'Squat barre', kind: 'reps', before: 5, after: 7, w: 100 }]);
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]]), h(2, [['Squat barre', [[90, 10]]]])]), [], '1RM estimé meilleur : jamais noté');
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]]), h(2, [['Squat barre', [[120, 5, { warmup: true }], [100, 5]]]])]), [], 'échauffement plus lourd : rien');
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]], { category: 'push' }), h(2, [['Squat barre', [[110, 5]]]])]), [], 'autre séance type : pas de référence');
  });

  test('records notés : lest, aide (moins d\'aide à reps ≥), maintien (plus long à lest ≥, lest à durée ≥)', () => {
    reset();
    sameJSON(recs([h(1, [['Dips', [[10, 8]]]]), h(2, [['Dips', [[15, 5]]]])]), [{ ex: 'Dips', kind: 'lest', before: 10, after: 15 }]);
    const A = 'Tractions assistées (machine)';
    sameJSON(recs([h(1, [[A, [[30, 8]]]]), h(2, [[A, [[25, 8]]]])]), [{ ex: A, kind: 'aide', before: 30, after: 25 }]);
    sameJSON(recs([h(1, [[A, [[30, 8]]]]), h(2, [[A, [[25, 6]]]])]), [], 'moins d\'aide mais moins de reps : rien');
    sameJSON(recs([h(1, [[A, [[30, 8]]]]), h(2, [[A, [[40, 12]]]])]), [], 'plus d\'aide : rien');
    sameJSON(recs([h(1, [[A, [[30, 8]]]]), h(2, [[A, [[30, 10]]]])]), [{ ex: A, kind: 'reps', before: 8, after: 10, w: 30 }]);
    const G = 'Gainage (planche)';
    sameJSON(recs([h(1, [[G, [['', 60]]]]), h(2, [[G, [['', 75]]]])]), [{ ex: G, kind: 'temps', before: 60, after: 75, w: 0 }]);
    sameJSON(recs([h(1, [[G, [['', 60]]]]), h(2, [[G, [[10, 60]]]])]), [{ ex: G, kind: 'lest', before: 0, after: 10 }], 'lest à durée égale');
    sameJSON(recs([h(1, [[G, [['', 60]]]]), h(2, [[G, [[10, 40]]]])]), [], 'lest mais moins longtemps : rien');
    sameJSON(recs([h(1, [[G, [[10, 60]]]]), h(2, [[G, [['', 90]]]])]), [], 'plus long mais sans le lest : rien');
    sameJSON(recs([h(1, [[G, [['', 60]]]]), h(2, [[G, [['', 60]]]])]), [], 'égaler : rien');
  });

  test('records notés : cardio (durée, distance, allure sur distance fixe), jamais le niveau d\'une machine', () => {
    reset();
    const C = 'Course à pied', c = { measure: 'cardio' };
    const r = recs([h(1, [[C, [['', 30, { dist: '6' }]], c]]), h(2, [[C, [['', 31, { dist: '6.4' }]], c]])]);
    sameJSON(r.map(x => x.kind).sort(), ['allure', 'distance', 'duree']);
    const al = r.find(x => x.kind === 'allure');
    sameJSON([al.d, al.before, al.after], [5, 300, Math.round(31 / 6.4 * 60)], 'allure au km sur 5 km');
    // 4 km rapides : rien à 5 km (distance plus courte), mais 1 km battu
    const r2 = recs([h(1, [[C, [['', 30, { dist: '6' }]], c]]), h(2, [[C, [['', 16, { dist: '4' }]], c]])]);
    sameJSON(r2.map(x => [x.kind, x.d]), [['allure', 1]]);
    sameJSON(recs([h(1, [[C, [['', 30, { dist: '6' }]], c]]), h(2, [[C, [['', 30, { dist: '6' }]], c]])]), [], 'même course : rien');
    // Vélo : distance et durée, pas d'allure ; elliptique et escaliers : durée seulement (niveau jamais)
    sameJSON(recs([h(1, [['Vélo', [['', 30, { dist: '10' }]], c]]), h(2, [['Vélo', [['', 25, { dist: '12' }]], c]])]).map(x => x.kind), ['distance']);
    sameJSON(recs([h(1, [['Elliptique', [['', 30, { dist: '4', machine: { level: 8 } }]], c]]), h(2, [['Elliptique', [['', 35, { dist: '5', machine: { level: 12 } }]], c]])]).map(x => x.kind), ['duree']);
    sameJSON(recs([h(1, [['Escaliers', [['', 20, { machine: { level: 8 } }]], c]]), h(2, [['Escaliers', [['', 20, { machine: { level: 14 } }]], c]])]), [], 'niveau plus haut : jamais un record');
    // Rameur : allure aux 500 m sur 2 000 m
    const rw = recs([h(1, [['Rameur', [['', 9, { dist: '2' }]], c]]), h(2, [['Rameur', [['', 8, { dist: '2' }]], c]])]);
    sameJSON(rw.map(x => [x.kind, x.d, x.before, x.after]), [['allure', 2, 135, 120]]);
  });

  test('records notés : renoteRecords après suppression, cleanNotedRecords, textes', () => {
    reset();
    const a = h(1, [['Squat barre', [[100, 5]]]]), b = h(2, [['Squat barre', [[110, 5]]]]);
    run(`globalThis.__h = ${JSON.stringify([b, a])}; __h[0].records = sessionRecords(__h[0], __h)`);
    assert.equal(run('__h[0].records.length'), 1);
    assert.equal(run('renoteRecords(__h[1], __h.slice(0, 1))'), 1, 'la séance d\'avant supprimée : première fois');
    sameJSON(run('__h[0].records'), []);
    sameJSON(run(`cleanNotedRecords([{ ex: 'Squat', kind: 'charge', before: 95, after: 100, x: 1 }, { ex: 'Squat', kind: '1rm', before: 1, after: 2 },
      { ex: 'C', kind: 'allure', before: 300, after: 290 }, { ex: 'C', kind: 'allure', before: 300, after: 290, d: 5 }, { ex: '', kind: 'reps', before: 1, after: 2 }, 'x', { ex: 'S', kind: 'reps', before: '1', after: 2 }])`),
      [{ ex: 'Squat', kind: 'charge', before: 95, after: 100 }, { ex: 'C', kind: 'allure', before: 300, after: 290, d: 5 }]);
    assert.equal(run('cleanNotedRecords(undefined)'), null);
    assert.equal(run(`notedFeedTxt({ ex: 'Squat', kind: 'charge', before: 95, after: 100 })`), 'Squat 100 kg');
    assert.equal(run(`notedFeedTxt({ ex: 'Course à pied', kind: 'allure', before: 300, after: 290, d: 5 })`), 'Course à pied 5 km à 4:50 /km');
    assert.equal(run(`notedValueTxt({ ex: 'Rameur', kind: 'allure', before: 135, after: 120, d: 2 })`), '2:00 /500 m');
    assert.equal(run(`notedLabel({ kind: 'allure', d: 0.5 })`), 'Record 500 m');
    assert.equal(run(`notedValueTxt({ ex: 'Dips', kind: 'reps', before: 8, after: 10, w: 10 }, 'before')`), '8 reps · +10 kg');
    assert.equal(run(`notedValueTxt({ ex: 'Gainage (planche)', kind: 'lest', before: 0, after: 10 }, 'before')`), 'sans lest');
    assert.equal(run(`notedValueTxt({ ex: 'Gainage (planche)', kind: 'temps', before: 60, after: 75, w: 0 })`), '1 min 15');
    assert.equal(run(`topNotedRecord([{ ex: 'C', kind: 'duree', before: 1, after: 2 }, { ex: 'S', kind: 'charge', before: 1, after: 2 }]).ex`), 'S');
    // Séance reçue : échauffement, RIR et records gardés, valeurs invalides écartées
    const s = run(`cleanPublicSession({ records: [{ ex: 'Squat', kind: 'charge', before: 95, after: 100 }], exercises: [{ name: 'Squat', sets: [{ weight: '40', reps: '8', warmup: true }, { weight: '100', reps: '5', rir: 2 }, { weight: '100', reps: '5', warmup: 'true', rir: 9 }] }] })`);
    sameJSON(s.exercises[0].sets, [{ weight: '40', reps: '8', warmup: true }, { weight: '100', reps: '5', rir: 2 }, { weight: '100', reps: '5' }]);
    assert.equal(s.records.length, 1);
    assert.equal(run(`'records' in cleanPublicSession({ exercises: [] })`), false, 'séance d\'avant : pas de records notés');
  });
}
