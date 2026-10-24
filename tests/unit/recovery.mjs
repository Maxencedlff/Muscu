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

  // Push, Pull, Legs faits il y a 8, 6 et legsH heures ; un Squat ajouté à Push
  const pplWithSquatInPush = legsH => {
    reset();
    const names = cat => JSON.parse(run(`JSON.stringify(prog().exercises['${cat}'].map(e => e.name))`));
    run(`data.history = [${entry('l', legsH, 'ppl', 'legs', names('legs'))},
                         ${entry('u', 6 * 24, 'ppl', 'pull', names('pull'))},
                         ${entry('p', 8 * 24, 'ppl', 'push', names('push'))}];
         data.history.forEach(h => { prog().timers[h.category] = h.date; });
         prog().exercises.push.push(makeExercise('Squat barre', 3));`);
  };

  test('prochaine séance : séance prête écartée par ses muscles, raison donnée', () => {
    pplWithSquatInPush(4 * 24);
    assert.equal(run(`catStatus('push').ready`), true, 'Push prête : quadriceps travaillés il y a 4 jours');
    assert.equal(run(`nextSessionCat(sessionKeys())`), 'pull', 'Pull : muscles reposés depuis plus longtemps');
    assert.equal(run(`passedOverNote(sessionKeys(), 'pull')`), 'Push passe après (quadriceps : il y a 4 jours, Legs)');
    assert.equal(run(`passedOverNote(sessionKeys(), 'push')`), '', 'séance attendue proposée : rien à dire');
  });

  test('prochaine séance : séance attendue en récupération, délai restant donné', () => {
    pplWithSquatInPush(30);
    assert.equal(run(`catStatus('push').ready`), false);
    assert.equal(run(`nextSessionCat(sessionKeys())`), 'pull');
    assert.equal(run(`passedOverNote(sessionKeys(), 'pull')`), 'Push attend : quadriceps en récupération (encore 1 j 18 h)');
  });

  test('prochaine séance : rien de prêt, la séance faite il y a le plus longtemps passe devant', () => {
    reset();
    // Maison : Haut du corps (gainage) bloque Bas du corps par les abdominaux, jusqu'à la même heure
    run(`data.activeProgramme = 'maison'; data.programmes.maison = makeProgData('maison');
         data.history = [${entry('h', 1, 'maison', 'haut', ['Pompes', 'Gainage (planche)'])}];
         prog().timers.haut = data.history[0].date;`);
    assert.equal(run(`catStatus('bas').by.muscle`), 'abs');
    assert.equal(run(`catStatus('bas').readyAt === catStatus('haut').readyAt`), true);
    assert.equal(run(`nextSessionCat(sessionKeys())`), 'bas', 'pas la séance qu\'on vient de finir');
    assert.equal(run(`passedOverNote(sessionKeys(), 'bas')`), '');
  });

  test('prochaine séance : tout est prêt, à égalité de muscles la séance faite il y a le plus longtemps', () => {
    reset();
    // Maison : Bas il y a 5 jours, Haut (gainage) il y a 3 jours ; délai de 72 h, les deux sont prêtes
    run(`data.activeProgramme = 'maison'; data.programmes.maison = makeProgData('maison');
         const names = c => prog().exercises[c].map(e => e.name);
         data.history = [${entry('h', 3 * 24, 'maison', 'haut', ['Pompes', 'Gainage (planche)'])}];
         data.history.push(Object.assign(JSON.parse(JSON.stringify(data.history[0])), { id: 'b', category: 'bas', date: Date.now() - 5 * 24 * ${H},
           exercises: names('bas').map(n => ({ name: n, sets: [{ weight: '', reps: '10', done: true }] })) }));
         data.history.forEach(h => { prog().timers[h.category] = h.date; });`);
    assert.equal(run(`catStatus('haut').ready && catStatus('bas').ready`), true);
    assert.equal(run(`nextSessionCat(sessionKeys())`), 'bas', 'pas Haut, faite il y a 3 jours');
  });

  test('texte sur une couleur de séance : noir sur les couleurs claires, blanc sinon', () => {
    for (const c of ['var(--orange)', 'var(--yellow)', 'var(--teal)', 'var(--green)', 'var(--purple)', '#FFD60A'])
      assert.equal(run(`textOnColor(${JSON.stringify(c)})`), '#000', c);
    for (const c of ['var(--indigo)', '#1C1C1E', 'var(--label2)', 'n\'importe quoi'])
      assert.equal(run(`textOnColor(${JSON.stringify(c)})`), 'var(--white)', c);
  });

  test('muscles déclarés : principaux et secondaires (demi-série), ancien format lisible', () => {
    reset();
    run(`setDeclaredMuscles('Truc maison', { primary: ['chest', 'triceps'], secondary: ['triceps', 'front_delts'] })`);
    const m = run(`exerciseMuscles({ name: 'Truc maison' })`);
    assert.deepEqual([...m.primary], ['chest', 'triceps']);
    assert.deepEqual([...m.secondary], ['front_delts'], 'un principal n\'est jamais aussi secondaire');
    run(`setDeclaredMuscles('Truc maison', ['abs'])`);
    assert.deepEqual([...run(`exerciseMuscles({ name: 'Truc maison' })`).secondary], [], 'liste seule : secondaires effacés');
    run(`setDeclaredMuscles('Truc maison', null)`);
    assert.equal(run(`data.exerciseMusclesSecondary`), undefined);
  });
}
