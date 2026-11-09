// Extension triceps : poulie haute et poulie basse séparées (09/11/2026). L'ancien « Extension triceps
// poulie » devient un alias de la poulie haute : séances, records, programmes et imports d'avant gardent
// leur nom et leur identifiant, et les nouvelles séances « poulie haute » se cumulent avec eux.
export default function ({ test, run, reset, assert, sameJSON }) {
  const HAUTE = 'Extension triceps poulie haute', BASSE = 'Extension triceps poulie basse', OLD = 'Extension triceps poulie';
  const entry = n => run(`catalogueEntry(${JSON.stringify(n)})?.name ?? null`);

  test('triceps poulies : ancien nom et pushdown → poulie haute, poulie bas/basse → poulie basse', () => {
    for (const n of [OLD, 'extension triceps poulie', 'Triceps pushdown', 'pushdown', 'Rope pushdown', 'Extension triceps corde', 'Extension triceps poulie haute'])
      assert.equal(entry(n), HAUTE, n);
    for (const n of ['Extension triceps poulie bas', 'extension triceps poulie basse', 'Triceps poulie basse'])
      assert.equal(entry(n), BASSE, n);
    assert.equal(entry('Extension triceps corde nuque'), 'Extension triceps corde nuque', 'corde nuque : sa propre fiche');
    assert.equal(run(`catalogueAliasOf(${JSON.stringify(OLD)})`), HAUTE, 'ancien nom affiché « = poulie haute »');
    assert.equal(run(`currentExerciseName(${JSON.stringify(OLD)})`), HAUTE);
    assert.equal(run(`currentExerciseName(${JSON.stringify(BASSE)})`), BASSE);
    assert.ok(run(`sameExerciseName('extension TRICEPS poulie', ${JSON.stringify(HAUTE)})`));
    assert.ok(!run(`sameExerciseName(${JSON.stringify(OLD)}, ${JSON.stringify(BASSE)})`), 'jamais confondu avec la poulie basse');
  });

  test('triceps poulies : trois fiches « Comment faire » distinctes, l\'ancien nom reçoit celle de la poulie haute', () => {
    const how = n => JSON.stringify(run(`exerciseHowTo(${JSON.stringify(n)})`));
    const h = how(HAUTE), b = how(BASSE), nuque = how('Extension triceps corde nuque');
    assert.ok(h !== 'null' && b !== 'null' && nuque !== 'null');
    assert.equal(new Set([h, b, nuque]).size, 3);
    assert.equal(how(OLD), h);
    assert.match(h, /poulie haute/); assert.match(b, /Poulie tout en bas/); assert.match(nuque, /Poulie haute/);
    sameJSON([...run(`musclesOf(${JSON.stringify(BASSE)})`).primary], ['triceps']);
    assert.equal(run(`equipmentOf(${JSON.stringify(BASSE)})`), 'salle');
  });

  test('triceps poulies : les deux dans le choix d\'exercice et le filtre triceps, l\'ancien nom n\'y est plus', () => {
    reset();
    const lib = run('exerciseLibrary()');
    assert.ok(lib.includes(HAUTE) && lib.includes(BASSE));
    assert.ok(!lib.includes(OLD));
    const tri = run(`exerciseLibrary().filter(n => muscleFilterMatch(exerciseMuscles({ name: n }), { group: 'bras', muscle: 'triceps' }))`);
    assert.ok(tri.includes(HAUTE) && tri.includes(BASSE), 'filtre triceps');
    // Programmes fournis : plus aucun ancien nom
    const defaults = run('Object.values(PROGRAMMES).flatMap(p => Object.values(p.defaults || {}).flat().map(([n]) => n))');
    assert.ok(!defaults.includes(OLD) && defaults.includes(HAUTE));
  });

  // Données d'une personne d'avant le 09/11 : programme et séances sous l'ancien nom (identifiant 'old1')
  function oldUser() {
    reset();
    run(`(() => {
      const list = data.programmes.ppl.exercises.push;
      const i = list.findIndex(e => e.name === ${JSON.stringify(HAUTE)});
      list.splice(i, 1, { ...makeExercise(${JSON.stringify(OLD)}, 3), id: 'old1' });
      data.history = [
        { id: 'h2', date: 2000, programme: 'ppl', category: 'push', exercises: [{ exId: 'old1', name: ${JSON.stringify(OLD)}, sets: [{ weight: '30', reps: '10' }] }] },
        { id: 'h1', date: 1000, programme: 'ppl', category: 'push', exercises: [{ exId: 'old1', name: ${JSON.stringify(OLD)}, sets: [{ weight: '25', reps: '12' }] }] },
        { id: 'h0', date: 500, programme: FREE, category: FREE, exercises: [{ exId: 'n:extension triceps poulie', name: ${JSON.stringify(OLD)}, sets: [{ weight: '20', reps: '12' }] }] },
      ];
    })()`);
  }

  test('triceps poulies : historique d\'avant retrouvé par la poulie haute (programme, séance libre, import, « Avant »)', () => {
    oldUser();
    const H = JSON.stringify(HAUTE);
    assert.equal(run(`resolveExId('ppl', 'push', ${H})`), 'old1', 'séance du programme');
    assert.equal(run(`resolveExId(FREE, FREE, ${H})`), 'old1', 'séance libre : même courbe');
    assert.equal(run(`resolveExId('ppl', 'pull', ${H})`), 'n:' + run(`normName(${H})`), 'autre séance jamais faite : clé de nom, comme avant');
    assert.equal(run(`importExId(${H}, importExIndex(data))`), 'old1', 'import Hevy/Strong : même identifiant');
    assert.equal(run(`lastPerf('u_neuf', 'j1', { exId: 'neuf', name: ${H} })?.ex.sets[0].weight`), '30', '« Avant » : la dernière fois sous l\'ancien nom');
    // Feuille d'ajout : proposé une seule fois, sous son nom actuel, et rangé dans les récents
    const lib = run('exerciseLibrary()');
    assert.equal(lib.filter(n => /^extension triceps poulie( haute)?$/i.test(n)).length, 1);
    assert.ok(lib.includes(HAUTE));
    assert.ok(run(`axSections(${JSON.stringify(lib)}, [], data.history).recent`).includes(HAUTE));
    // La poulie basse ne reprend rien
    assert.equal(run(`resolveExId(FREE, FREE, ${JSON.stringify(BASSE)})`), 'n:' + run(`normName(${JSON.stringify(BASSE)})`));
    assert.equal(run(`lastPerf('u_neuf', 'j1', { exId: 'neuf2', name: ${JSON.stringify(BASSE)} })`), null);
  });

  test('triceps poulies : progrès et records cumulent l\'ancien nom et la nouvelle séance sans réécrire les données', () => {
    oldUser();
    // Nouvelle séance faite depuis le programme : même identifiant, nouveau nom
    run(`data.history.unshift({ id: 'h3', date: 3000, programme: 'ppl', category: 'push', exercises: [{ exId: resolveExId('ppl', 'push', ${JSON.stringify(HAUTE)}), name: ${JSON.stringify(HAUTE)}, sets: [{ weight: '35', reps: '8' }] }] })`);
    const it = run(`exerciseIndex().get('old1')`);
    assert.equal(it.points.length, 3, 'une seule courbe : 2 séances d\'avant + la nouvelle');
    assert.equal(run(`recordKey(data.history[0].exercises[0])`), run(`recordKey(data.history[1].exercises[0])`), 'mêmes records');
    // Rien n'a été renommé dans les données
    assert.equal(run(`data.history.filter(h => h.id !== 'h3').every(h => h.exercises[0].name === ${JSON.stringify(OLD)})`), true);
    assert.equal(run(`data.programmes.ppl.exercises.push.find(e => e.id === 'old1').name`), OLD);
    // Le chargement (migrations) ne touche pas non plus aux noms
    run(`localStorage.setItem(KEY, JSON.stringify(data)); data = loadData();`);
    assert.equal(run(`data.programmes.ppl.exercises.push.find(e => e.id === 'old1')?.name`), OLD);
    assert.equal(run(`data.history.find(h => h.id === 'h1').exercises[0].name`), OLD);
  });
}
