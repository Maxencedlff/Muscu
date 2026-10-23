// Récupération par muscle (dashboard.js : catStatus) et muscles déclarés (muscles.js)
export default function ({ test, run, reset, assert }) {
  const H = 3600_000;
  const entry = (id, hoursAgo, programme, category, names) =>
    `{ id: '${id}', date: Date.now() - ${hoursAgo} * ${H}, programme: '${programme}', category: '${category}',
       exercises: [${names.map(n => `{ name: ${JSON.stringify(n)}, sets: [{ weight: '20', reps: '10' }] }`).join(',')}] }`;

  test('muscles déclarés : par nom, nettoyés, prioritaires sur la reconnaissance', () => {
    reset();
    assert.equal(run(`exerciseMuscles({ name: 'Grimpe au mur' }).primary.length`), 0);
    run(`setDeclaredMuscles('Grimpe  au mur', ['lats', 'forearms', 'inconnu'])`);
    assert.equal(run(`JSON.stringify(exerciseMuscles({ name: 'grimpe au mur' }).primary)`), '["lats","forearms"]');
    assert.equal(run(`exerciseMuscles({ name: 'grimpe au mur' }).source`), 'user');
    run(`data.exerciseMuscles['x'] = 'cassé'; data.exerciseMuscles['y'] = ['chest', 'BAD!']; sanitizeData(data);`);
    assert.equal(run(`JSON.stringify(data.exerciseMuscles)`), JSON.stringify({ 'grimpe au mur': ['lats', 'forearms'], y: ['chest'] }));
    run(`setDeclaredMuscles('Grimpe au mur', null); setDeclaredMuscles('y', null)`);
    assert.equal(run(`data.exerciseMuscles === undefined`), true, 'vidé : champ retiré');
  });

  test('muscles déclarés : un choix du programme pour le même nom suit la déclaration', () => {
    reset();
    run(`const ex = data.programmes.ppl.exercises.push[0]; ex.muscles = ['chest']; setDeclaredMuscles(ex.name, ['triceps']);`);
    assert.equal(run(`JSON.stringify(data.programmes.ppl.exercises.push[0].muscles)`), '["triceps"]');
  });

  test('exercices sans muscles : listés par fréquence, disparaissent une fois déclarés', () => {
    reset();
    run(`data.history = [${entry('a', 5, 'ppl', 'push', ['Bidule', 'Truc'])}, ${entry('b', 50, 'ppl', 'push', ['Bidule'])}]`);
    assert.equal(run(`unknownMuscleExercises().map(x => x.name + x.count).join()`), 'Bidule2,Truc1');
    run(`setDeclaredMuscles('Bidule', ['abs'])`);
    assert.equal(run(`unknownMuscleExercises().map(x => x.name).join()`), 'Truc');
  });

  test('récupération : un muscle travaillé dans un autre programme bloque la séance', () => {
    reset();
    run(`data.history = [${entry('h', 20, 'u_bras', 's1', ['Curl biceps haltères'])}]`);
    const st = run(`catStatus('pull')`);
    assert.equal(st.ready, false, 'Pull attend : biceps travaillés il y a 20 h ailleurs');
    assert.equal(run(`catStatus('pull').by.muscle`), 'biceps');
    assert.match(run(`recoveryReason(catStatus('pull').by)`), /^Biceps : (hier|aujourd'hui), /);
    assert.equal(run(`catStatus('legs').ready`), true, 'Legs ne partage aucun muscle principal');
  });

  test('récupération : muscle secondaire seul (biceps d\'un rowing) ne bloque pas une séance biceps', () => {
    reset();
    run(`data.programmes.ppl.exercises.pull = [makeExercise('Curl biceps haltères', 3)];
         data.history = [${entry('r', 5, 'free', 'free', ['Rowing barre'])}]`);
    assert.equal(run(`exerciseMuscles({ name: 'Rowing barre' }).primary.includes('biceps')`), false);
    assert.equal(run(`catStatus('pull').ready`), true);
  });

  test('récupération : délai passé à la main, séance sans muscles connus, séance libre', () => {
    reset();
    run(`data.history = [${entry('f', 10, 'free', 'free', ['Développé couché'])}]`);
    assert.equal(run(`catStatus('push').ready`), false, 'séance libre comptée');
    assert.match(run(`recoveryReason(catStatus('push').by)`), /séance libre$/);
    run(`(prog().skipped ||= {}).push = Date.now()`);
    assert.equal(run(`catStatus('push').ready`), true, 'délai passé');
    reset();
    run(`data.programmes.ppl.exercises.legs = [makeExercise('Truc inconnu', 3)]; data.programmes.ppl.timers.legs = Date.now() - 10 * ${H};`);
    assert.equal(run(`catStatus('legs').ready`), false, 'repli : délai de la séance elle-même');
    assert.equal(run(`catStatus('legs').by`), null);
  });

  test('texte sur une couleur de séance : noir sur les couleurs claires, blanc sinon', () => {
    for (const c of ['var(--orange)', 'var(--yellow)', 'var(--teal)', 'var(--green)', 'var(--purple)', '#FFD60A'])
      assert.equal(run(`textOnColor(${JSON.stringify(c)})`), '#000', c);
    for (const c of ['var(--indigo)', '#1C1C1E', 'var(--label2)', 'n\'importe quoi'])
      assert.equal(run(`textOnColor(${JSON.stringify(c)})`), 'var(--white)', c);
  });
}
