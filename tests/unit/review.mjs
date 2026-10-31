// Relecture de la séance d'un autre (js/data/session-review.js) : volume sans poids du corps (jamais celui
// de la personne qui regarde), écarts, référence par exercice, records avec l'ancienne valeur, mots de douleur
export default function ({ test, run, reset, assert, sameJSON }) {
  const DAY = 86400000;
  // Séance reçue au format { id, doneAt, s } (cleanCoachSessionRow / cleanFeedRow)
  const row = (id, day, exercises, extra = {}) => ({ id, doneAt: day * DAY, s: { date: day * DAY, duration: 3000000, programme: 'ppl', category: 'legs', label: 'Legs', exercises, ...extra } });
  const ex = (name, sets) => ({ name, sets: sets.map(([weight, reps]) => ({ weight: String(weight), reps: String(reps) })) });
  const R = rows => run(`(${JSON.stringify(rows)})`);

  test('relecture : volume sans le poids du corps de celui qui regarde (lest compté, aide jamais)', () => {
    reset();
    run('data.bodyWeightKg = 90');   // poids du COACH : ne doit jamais entrer dans le volume de l'élève
    const xs = R([ex('Squat barre', [[100, 5], [100, 5]]), ex('Tractions pronation', [['', 10], [10, 5]]), ex('Tractions assistées (machine)', [[20, 8]]), ex('Gainage', [['', 60]])]);
    run(`globalThis.__xs = ${JSON.stringify(xs)}`);
    assert.equal(run('reviewVolume(__xs)'), 1000 + 50, 'squat 1000 + lest 10 × 5 ; aide et gainage 0');
    assert.ok(run('sessionVolume(__xs, entryBodyKg({}))') > 1050, 'contrôle : entryBodyKg retombe bien sur le poids de l\'appareil');
    assert.equal(run('reviewExVolume(__xs[1])'), 50);
    assert.equal(run('reviewVolume([])'), 0);
  });

  test('relecture : écart de volume en % entier, « = » de −3 à +3 %, baisse jamais rouge (dir down)', () => {
    sameJSON(run('volumeDelta(2900, 2735)'), { dir: 'up', pct: 6 });
    sameJSON(run('volumeDelta(1030, 1000)'), { dir: 'same', pct: 0 });
    sameJSON(run('volumeDelta(970, 1000)'), { dir: 'same', pct: 0 });
    sameJSON(run('volumeDelta(950, 1000)'), { dir: 'down', pct: -5 });
    assert.equal(run('volumeDelta(1000, 0)'), null, 'sans référence chiffrée : rien');
    assert.equal(run('fmtPct(-5)'), '−5 %');
    assert.equal(run('fmtPct(6)'), '+6 %');
    assert.equal(run('durationDelta(3600, 3300)'), null, 'moins de 20 % : rien');
    assert.equal(run('durationDelta(3600, 2700)'), 33);
    assert.equal(run('durationDelta(null, 2700)'), null);
  });

  test('relecture : séance de référence du même type, exercice comparé à sa dernière fois (toute séance)', () => {
    reset();
    const rows = [
      row('a', 1, [ex('Squat haltère', [[20, 12], [20, 12], [20, 12], [20, 10]])]),
      row('b', 3, [ex('Développé couché', [[60, 8]]), ex('Squat haltère', [[22.5, 10]])], { category: 'push', label: 'Push' }),
      row('c', 5, [ex('Squat haltère', [[22.5, 12], [22.5, 12]]), ex('Fentes bulgares', [['', 12], ['', 12], ['', 12]])]),
      row('z', 7, [ex('Squat haltère', [[30, 12]])]),   // plus récente : jamais une référence de c
    ];
    run(`globalThis.__rows = ${JSON.stringify(rows)}`);
    assert.equal(run('prevSameSession(__rows[2], __rows).id'), 'a', 'même programme et même séance, pas la Push');
    const p = run('prevExercise(__rows[2].s.exercises[0], __rows[2], __rows)');
    assert.equal(p.doneAt, 3 * DAY, 'squat : la Push du jour 3, plus récente que la Legs');
    assert.equal(run('prevExercise(__rows[2].s.exercises[1], __rows[2], __rows)'), null, 'jamais fait avant : pas de flèche');
    assert.equal(run('prevSameSession(__rows[0], __rows)'), null);
    const rv = run('sessionReview(__rows[2], __rows)');
    assert.equal(rv.prev.id, 'a');
    sameJSON(rv.exercises[0].trend, { dir: 'up', text: '+14 reps' }, 'même charge que la Push (22,5 × 10) : 24 reps contre 10 à cette charge');
    assert.equal(rv.exercises[1].reps, 36);
    assert.equal(rv.exercises[1].volume, 0, 'sans charge notée : rien dans le volume');
  });

  test('relecture : flèche (charge, reps à charge égale, poids du corps, aide, égalité)', () => {
    reset();
    const T = (a, b) => run(`exerciseTrend(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
    sameJSON(T(ex('Squat barre', [[102.5, 5]]), ex('Squat barre', [[100, 8]])), { dir: 'up', text: '+2,5 kg' });
    sameJSON(T(ex('Squat barre', [[95, 5]]), ex('Squat barre', [[100, 5]])), { dir: 'down', text: '−5 kg' });
    sameJSON(T(ex('Squat barre', [[100, 5], [100, 3]]), ex('Squat barre', [[100, 5], [100, 5]])), { dir: 'down', text: '−2 reps' });
    sameJSON(T(ex('Squat barre', [[100, 5]]), ex('Squat barre', [[100, 5]])), { dir: 'same', text: '=' });
    sameJSON(T(ex('Pompes', [['', 12], ['', 12], ['', 12]]), ex('Pompes', [['', 10], ['', 10], ['', 10]])), { dir: 'up', text: '+6 reps' });
    sameJSON(T(ex('Tractions assistées (machine)', [[15, 8]]), ex('Tractions assistées (machine)', [[20, 8]])), { dir: 'up', text: 'aide −5 kg' }, 'moins d\'aide : progrès');
    assert.equal(T(ex('Gainage', [['', 60]]), ex('Gainage', [['', 45]])), null, 'durée : pas de flèche');
    assert.equal(T(ex('Squat barre', [[100, 5]]), null), null);
  });

  test('relecture : records nommés avec l\'ancienne valeur, 3 au plus, jamais le 1RM estimé', () => {
    reset();
    const rows = [
      row('a', 1, [ex('Squat haltère', [[20, 12]]), ex('Soulevé de terre roumain', [[16, 12]]), ex('Mollets debout haltères', [[18, 15]]), ex('Leg curl', [[30, 10]]), ex('Presse à cuisses', [[100, 10]])]),
      row('b', 2, [ex('Squat haltère', [[22.5, 12]]), ex('Soulevé de terre roumain', [[16, 14]]), ex('Mollets debout haltères', [[17, 25]]), ex('Leg curl', [[32.5, 8]]), ex('Presse à cuisses', [[110, 10]])]),
    ];
    run(`globalThis.__rows = ${JSON.stringify(rows)}`);
    const recs = run('reviewRecords(__rows[1], __rows)');
    assert.equal(recs.length, 3, 'au plus 3');
    sameJSON(recs.map(r => [r.ex.name, r.label]), [['Squat haltère', 'Record charge'], ['Leg curl', 'Record charge'], ['Presse à cuisses', 'Record charge']], 'charge d\'abord');
    sameJSON([recs[0].before.w, recs[0].before.r], [20, 12], 'ancienne valeur');
    const all = run('reviewRecords(__rows[1], __rows, 10)');
    assert.ok(all.some(r => r.ex.name === 'Soulevé de terre roumain' && r.label === 'Record reps'), 'reps à charge égale');
    assert.ok(!all.some(r => r.ex.name === 'Mollets debout haltères'), 'moins lourd, plus de reps : pas un record (1RM estimé écarté)');
    sameJSON(run('reviewRecords(__rows[0], __rows)'), [], 'première séance : rien à battre');
  });

  test('relecture : mots de douleur (mise en avant, sans faux positif courant)', () => {
    for (const t of ['Mal au genou gauche', 'Petite gêne à l\'épaule', 'douleur lombaire', 'Genou douloureux', 'Le dos est coincé', 'tendinite qui revient', 'crampe au mollet'])
      assert.equal(run(`painInNotes(${JSON.stringify(t)})`), true, t);
    for (const t of ['Pas mal du tout, bonne séance', 'Travail du dos, bonne connexion', 'Courbatures normales', 'Séance normale', '', 'animal', 'Bloqué la respiration au squat'])
      assert.equal(run(`painInNotes(${JSON.stringify(t)})`), false, t);
  });

  test('relecture : jamais le temps aux 500 m du rameur (durée exacte non transmise), allures au km gardées', () => {
    assert.equal(run(`reviewSetKind({ name: 'Rameur', measure: 'cardio' })`), null);
    assert.equal(run(`reviewSetKind({ name: 'Course à pied', measure: 'cardio' })`), 'pace');
    assert.equal(run(`reviewSetKind({ name: 'Vélo', measure: 'cardio' })`), 'speed');
    assert.equal(run(`reviewSetKind({ name: 'Développé couché' })`), 'charge');
    const line = run(`setsText([{ weight: '', reps: '8', dist: '2' }], 'cardio', reviewSetKind({ name: 'Rameur', measure: 'cardio' }))`);
    assert.equal(line, '2 km · 8 min');
  });
}
