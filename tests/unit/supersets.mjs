// Supersets (js/data/supersets.js) : blocs, tours, repos, regroupement et déplacements
export default function ({ test, run, reset, sameJSON, assert }) {
  // Liste d'exercices A, B, C… avec n séries (done : séries faites) et ss facultatif
  const list = specs => JSON.stringify(specs.map(([name, n, ss, done = 0]) => ({
    name, ...(ss ? { ss } : {}), sets: Array.from({ length: n }, (_, i) => ({ done: i < done })),
  })));
  const names = code => JSON.parse(run(`JSON.stringify((${code}).map(e => e.name + (e.ss ? '*' + e.ss : '')))`));

  test('supersets : blocs, lettres et sortes de groupe', () => {
    reset();
    const xs = list([['A', 3], ['B', 3, 'g'], ['C', 3, 'g'], ['D', 3], ['E', 3, 'h'], ['F', 3, 'h'], ['G', 3, 'h']]);
    sameJSON(run(`ssBlocks(${xs})`), [[0], [1, 2], [3], [4, 5, 6]]);
    sameJSON(run(`ssTags(${xs})`), { 1: 'A1', 2: 'A2', 4: 'B1', 5: 'B2', 6: 'B3' });
    assert.equal(run(`ssGroupOf(${xs}, 0)`), null);
    sameJSON(run(`ssGroupOf(${xs}, 5)`), [4, 5, 6]);
    assert.deepEqual([2, 3, 4, 5].map(n => run(`ssKind(${n})`)), ['Superset', 'Tri-set', 'Circuit', 'Circuit']);
    // Même identifiant mais pas côte à côte : deux exercices seuls
    sameJSON(run(`ssBlocks(${list([['A', 3, 'g'], ['B', 3], ['C', 3, 'g']])})`), [[0], [1], [2]]);
  });

  test('supersets : tours affichés, enchaînement par l\'ordre du groupe', () => {
    reset();
    // A : 3 séries, B : 2 séries (le 3e tour n'a que A)
    run(`globalThis.xs = ${list([['A', 3, 'g'], ['B', 2, 'g']])}`);
    sameJSON(run('ssRounds(xs, [0, 1])'), [[{ ei: 0, si: 0 }, { ei: 1, si: 0 }], [{ ei: 0, si: 1 }, { ei: 1, si: 1 }], [{ ei: 0, si: 2 }]]);
    sameJSON(run('ssNextSet(xs, [0, 1])'), { ei: 0, si: 0 });
    run('xs[0].sets[0].done = true');
    sameJSON(run('ssChainAfter(xs, [0, 1], 0)'), { ei: 1, si: 0 }, 'A1 fait : on enchaîne sur B, sans repos');
    sameJSON(run('ssNextSet(xs, [0, 1], 0)'), { ei: 1, si: 0 });
    run('xs[1].sets[0].done = true');
    assert.equal(run('ssChainAfter(xs, [0, 1], 1)'), null, 'dernier du groupe : repos');
    sameJSON(run('ssNextSet(xs, [0, 1], 1)'), { ei: 0, si: 1 }, 'nouveau tour');
    run('xs[0].sets[1].done = true; xs[1].sets[1].done = true; xs[0].sets[2].done = true');
    assert.equal(run('ssChainAfter(xs, [0, 1], 0)'), null, 'B fini : A seul, repos à chaque série');
    assert.equal(run('ssNextSet(xs, [0, 1], 0)'), null);
  });

  test('supersets : exercice sauté ou remplacé, le groupe ne se décale pas', () => {
    reset();
    // B pris : A refait trois fois. Seule la 1re validation enchaîne (la séance ne peut pas savoir) ;
    // ensuite, A deux fois de suite = fait seul, repos (validateSet, sameAgain)
    run(`globalThis.xs = ${list([['A', 3, 'g', 1], ['B', 3, 'g']])}`);
    sameJSON(run('ssChainAfter(xs, [0, 1], 0)'), { ei: 1, si: 0 });
    // Plus tard, B rattrape seul : dernier du groupe, repos à chaque série
    run('xs[0].sets.forEach(s => s.done = true)');
    assert.equal(run('ssChainAfter(xs, [0, 1], 1)'), null);
    sameJSON(run('ssNextSet(xs, [0, 1])'), { ei: 1, si: 0 });
    // Remplaçant N arrivé à 0 série alors que B en a fait 2 : N puis B, repos, N puis B…
    run(`globalThis.xs = ${list([['N', 2, 'g'], ['B', 4, 'g', 2]])}`);
    sameJSON(run('ssNextSet(xs, [0, 1])'), { ei: 0, si: 0 }, 'le moins avancé d\'abord');
    run('xs[0].sets[0].done = true');
    sameJSON(run('ssChainAfter(xs, [0, 1], 0)'), { ei: 1, si: 2 }, 'N enchaîne sur B');
    // B fait avant A : B est le dernier du groupe, repos ; puis A enchaîne sur B
    run(`globalThis.xs = ${list([['A', 3, 'g'], ['B', 3, 'g', 1]])}`);
    assert.equal(run('ssChainAfter(xs, [0, 1], 1)'), null);
    sameJSON(run('ssNextSet(xs, [0, 1], 1)'), { ei: 0, si: 0 });
  });

  test('supersets : regrouper après un glisser (ssGather)', () => {
    reset();
    sameJSON(names(`ssGather(${list([['A', 3, 'g'], ['X', 3], ['B', 3, 'g'], ['D', 3]])})`), ['A*g', 'B*g', 'X', 'D'], 'X déposé au milieu passe après');
  });

  test('supersets : créer, modifier et défaire un groupe', () => {
    reset();
    const xs = list([['A', 3], ['B', 3], ['C', 3], ['D', 3]]);
    // A avec C : C vient se placer juste après A
    const ac = run(`JSON.stringify(ssRegroup(${xs}, 0, [2]))`);
    assert.deepEqual(JSON.parse(ac).map(e => e.name), ['A', 'C', 'B', 'D']);
    const id = JSON.parse(ac)[0].ss;
    assert.match(id, /^[a-z0-9]{1,12}$/);
    assert.equal(JSON.parse(ac)[1].ss, id);
    assert.equal(JSON.parse(ac)[2].ss, undefined);
    // D choisi depuis le bas : le groupe se forme à la place du premier membre
    assert.deepEqual(JSON.parse(run(`JSON.stringify(ssRegroup(${xs}, 3, [1]))`)).map(e => e.name), ['A', 'B', 'D', 'C']);
    // Retirer le membre du milieu d'un tri-set : il passe après le groupe, qui reste entier
    const tri = list([['A', 3, 'g'], ['B', 3, 'g'], ['C', 3, 'g'], ['D', 3]]);
    sameJSON(names(`ssLeave(${tri}, 1)`), ['A*g', 'C*g', 'B', 'D']);
    sameJSON(names(`ssLeave(${tri}, 0)`), ['B*g', 'C*g', 'A', 'D']);
    // Retirer d'un superset de deux : plus de groupe du tout
    sameJSON(names(`ssLeave(${list([['A', 3, 'g'], ['B', 3, 'g']])}, 0)`), ['B', 'A']);
    // Tout décocher : plus de groupe autour de l'exercice
    sameJSON(names(`ssRegroup(${tri}, 0, [])`), ['A', 'B', 'C', 'D']);
    // Décocher un membre en gardant les autres
    sameJSON(names(`ssRegroup(${tri}, 0, [2])`), ['A*g', 'C*g', 'B', 'D']);
    // Un exercice pris à un autre groupe le quitte ; ce groupe réduit à un seul disparaît
    const two = list([['A', 3, 'g'], ['B', 3, 'g'], ['C', 3, 'h'], ['D', 3, 'h']]);
    sameJSON(names(`ssRegroup(${two}, 0, [1, 2])`), ['A*g', 'B*g', 'C*g', 'D']);
    // Au plus SS_MAX exercices
    const six = list([['A', 1], ['B', 1], ['C', 1], ['D', 1], ['E', 1], ['F', 1]]);
    assert.equal(JSON.parse(run(`JSON.stringify(ssRegroup(${six}, 0, [1, 2, 3, 4, 5]))`)).filter(e => e.ss).length, run('SS_MAX'));
  });

  test('supersets : monter et descendre sans couper un groupe', () => {
    reset();
    const xs = list([['A', 3], ['B', 3, 'g'], ['C', 3, 'g'], ['D', 3]]);
    sameJSON(names(`ssMove(${xs}, 0, 1)`), ['B*g', 'C*g', 'A', 'D'], 'A passe sous le superset entier');
    sameJSON(names(`ssMove(${xs}, 3, -1)`), ['A', 'D', 'B*g', 'C*g'], 'D passe au-dessus');
    sameJSON(names(`ssMove(${xs}, 2, -1)`), ['A', 'C*g', 'B*g', 'D'], 'dans le groupe : échange');
    assert.equal(run(`ssMove(${xs}, 1, -1)`), null, 'le premier du groupe ne sort pas par le haut');
    assert.equal(run(`ssMove(${xs}, 2, 1)`), null);
    assert.equal(run(`ssCanMove(${xs}, 0, -1)`), false);
  });

  test('supersets : nettoyage des données et séance enregistrée', () => {
    reset();
    run(`data.programmes.ppl.exercises.push = [
      { id: 'a', name: 'A', sets: 3, ss: 'g' }, { id: 'b', name: 'B', sets: 3, ss: 'g' },
      { id: 'c', name: 'C', sets: 3, ss: 'seul' }, { id: 'd', name: 'D', sets: 3, ss: 'PAS VALIDE' }];
      sanitizeData(data);`);
    sameJSON(run('data.programmes.ppl.exercises.push.map(e => e.ss ?? null)'), ['g', 'g', null, null]);
    // Séance : le superset suit dans l'historique ; un exercice sans série faite est écarté,
    // et le groupe réduit à un seul exercice n'en est plus un
    run(`globalThis.sessionNotes ??= ''`);   // déclarée par js/features/session.js, hors de ces tests
    run(`activeSession = { category: 'push', programme: 'ppl', startedAt: Date.now() - 60000, exercises: [
      { exId: 'a', name: 'A', ss: 'g', sets: [{ weight: '10', reps: '8', done: true }] },
      { exId: 'b', name: 'B', ss: 'g', sets: [{ weight: '10', reps: '8', done: true }] },
      { exId: 'c', name: 'C', ss: 'h', sets: [{ weight: '10', reps: '8', done: true }] },
      { exId: 'd', name: 'D', ss: 'h', sets: [{ weight: '10', reps: '8', done: false }] }] };`);
    sameJSON(run(`sessionHistoryEntry('ppl', 'push').exercises.map(e => e.ss ?? null)`), ['g', 'g', null]);
    run('activeSession = null');
  });

  test('supersets : séance d\'un abonné, identifiant gardé et vérifié', () => {
    reset();
    const s = run(`cleanPublicSession({ label: 'Bras', exercises: [
      { name: 'Curl', ss: 'k3', sets: [] }, { name: 'Triceps', ss: 'k3', sets: [] }, { name: 'X', ss: '<b>', sets: [] }] })`);
    sameJSON(s.exercises.map(e => e.ss ?? null), ['k3', 'k3', null]);
  });
}
