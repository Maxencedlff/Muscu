// Ordre des séances (dashboard.js : nextSessionCat, rotationFrom, otherSessions) et tronc qui ne bloque plus une
// séance entière (sessionBlockingMuscles). Cas réel du 19/11 : « Split séquentiel » Pecs, Dos, Jambes, Épaules, Bras.
export default function ({ test, run, reset, assert }) {
  const H = 3600_000;
  const PID = 'u_split';
  const SESSIONS = {
    pecs:    ['Développé couché', 'Vacuum'],
    dos:     ['Tractions pronation', 'Rowing barre', 'Dead bug'],
    jambes:  ['Squat barre', 'Gainage (planche)'],
    epaules: ['Développé militaire barre', 'Planche latérale'],
    bras:    ['Curl biceps haltères', 'Dead bug'],
  };
  const KEYS = Object.keys(SESSIONS);
  // Programme créé, séances dans cet ordre ; rotation : réglage du programme (absent = dans l'ordre)
  const split = (rotation) => {
    reset();
    run(`data.userProgrammes.${PID} = { name: 'Split séquentiel', archived: false, order: ${JSON.stringify(KEYS)},
           sessions: Object.fromEntries(${JSON.stringify(KEYS)}.map(k => [k, { label: k, icon: '', desc: '', color: '#FF9500' }])) };
         ${rotation ? `data.userProgrammes.${PID}.rotation = '${rotation}';` : ''}
         data.programmes.${PID} = { exercises: {}, timers: {}, cooldowns: {} };
         Object.entries(${JSON.stringify(SESSIONS)}).forEach(([k, names]) => {
           data.programmes.${PID}.exercises[k] = names.map(n => makeExercise(n, 3));
           data.programmes.${PID}.timers[k] = null; data.programmes.${PID}.cooldowns[k] = 72;
         });
         data.activeProgramme = '${PID}'; data.history = [];`);
  };
  // Séance faite il y a hoursAgo heures : historique (muscles) et chrono du programme
  const done = (cat, hoursAgo) => run(`(() => {
    const date = Date.now() - ${hoursAgo} * ${H};
    data.history.unshift({ id: '${cat}' + data.history.length, date, programme: '${PID}', category: '${cat}',
      exercises: prog().exercises['${cat}'].map(e => ({ name: e.name, sets: [{ weight: '20', reps: '10' }] })) });
    data.history.sort((a, b) => b.date - a.date);
    prog().timers['${cat}'] = Math.max(prog().timers['${cat}'] || 0, date);
  })()`);
  const next = () => run(`nextSessionCat(sessionKeys())`);
  const others = () => JSON.parse(run(`JSON.stringify(otherSessions(sessionKeys(), nextSessionCat(sessionKeys())))`));

  test('tronc : Pecs puis Jambes finie par une planche, la séance proposée est Dos (cas réel du 19/11)', () => {
    split('recovery');
    done('pecs', 36);    // mar. 17/11, 22 h
    done('jambes', 15);  // mer. 18/11, 19 h
    assert.equal(run(`catStatus('dos').ready`), true, 'le Dead bug de Dos n\'attend pas les abdos de la planche');
    assert.equal(run(`catStatus('epaules').ready && catStatus('bras').ready`), true);
    assert.equal(next(), 'dos', 'pas Pecs, faite il y a 36 h');
  });

  test('tronc : programme intégré, la planche de Legs ne bloque pas une séance du haut', () => {
    reset();
    run(`prog().exercises.pull.push(makeExercise('Dead bug', 3));
         data.history = [{ id: 'l', date: Date.now() - 10 * ${H}, programme: 'ppl', category: 'legs',
           exercises: [{ name: 'Gainage (planche)', sets: [{ weight: '', reps: '60' }] }] }];`);
    assert.equal(run(`catStatus('pull').ready`), true);
    assert.equal(run(`catStatus('pull').by`), null);
  });

  test('tronc : une séance d\'abdos seule attend toujours ses abdos', () => {
    split('recovery');
    run(`prog().exercises.bras = [makeExercise('Crunch', 3), makeExercise('Gainage (planche)', 3)]`);
    done('jambes', 10);
    assert.equal(run(`catStatus('bras').ready`), false);
    assert.equal(run(`catStatus('bras').by.muscle`), 'abs');
  });

  test('ordre : jamais rien fait, la première séance, puis les autres dans l\'ordre', () => {
    split();
    assert.equal(run(`inOrder()`), true, 'programme créé : dans l\'ordre par défaut');
    assert.equal(next(), 'pecs');
    assert.deepEqual(others(), ['dos', 'jambes', 'epaules', 'bras']);
  });

  test('ordre : dernière faite au milieu, la suivante est proposée, « Ensuite » en boucle', () => {
    split();
    done('pecs', 50);
    done('dos', 26);
    assert.equal(next(), 'jambes');
    assert.deepEqual(others(), ['epaules', 'bras', 'pecs', 'dos']);
    assert.equal(run(`passedOverNote(sessionKeys(), 'jambes')`), '', 'rien n\'est sauté');
  });

  test('ordre : dernière faite en fin de liste, retour au début', () => {
    split();
    KEYS.forEach((k, i) => done(k, 24 * (KEYS.length - i)));
    assert.equal(next(), 'pecs');
    assert.deepEqual(others(), ['dos', 'jambes', 'epaules', 'bras']);
  });

  test('ordre : séance proposée pas reposée, gardée avec son attente, aucune séance sautée', () => {
    split();
    run(`prog().exercises.epaules.push(makeExercise('Squat barre', 3))`);   // les quadriceps de Jambes la retiennent
    done('pecs', 60);
    done('jambes', 10);
    assert.equal(next(), 'epaules', 'la suivante de Jambes, même pas prête');
    assert.equal(run(`catStatus('epaules').ready`), false);
    assert.equal(run(`catStatus('epaules').by.muscle`), 'quads', 'raison donnée sur la carte (recoveryReason)');
  });

  test('ordre : autre séance faite aujourd\'hui (touchée dans Ensuite), la rotation repart après elle', () => {
    split();
    done('pecs', 48);
    assert.equal(next(), 'dos');
    done('epaules', 1);   // Dos était proposée, Épaules faite à la place
    assert.equal(next(), 'bras');
    assert.deepEqual(others(), ['pecs', 'dos', 'jambes', 'epaules']);
  });

  test('ordre : séance en cours hors de l\'ordre, « Ensuite » suit celle-là', () => {
    split();
    done('pecs', 48);
    assert.deepEqual(JSON.parse(run(`JSON.stringify(otherSessions(sessionKeys(), 'jambes'))`)), ['epaules', 'bras', 'pecs', 'dos']);
  });

  test('ordre : l\'ordre changé suit tout de suite (moveSession)', () => {
    split();
    done('pecs', 30);
    assert.equal(next(), 'dos');
    run(`moveSession('${PID}', 3, 1)`);   // Épaules juste après Pecs
    assert.deepEqual(JSON.parse(run(`JSON.stringify(sessionKeys())`)), ['pecs', 'epaules', 'dos', 'jambes', 'bras']);
    assert.equal(next(), 'epaules');
  });

  test('ordre : réglage « selon la récupération » et programmes intégrés inchangés', () => {
    split();
    done('pecs', 100);
    done('jambes', 30);
    assert.equal(next(), 'epaules', 'dans l\'ordre : après Jambes');
    split('recovery');
    done('pecs', 100);
    done('jambes', 30);
    assert.equal(run(`inOrder()`), false);
    assert.equal(next(), 'dos', 'selon la récupération : Dos, jamais faite');
    reset();
    assert.equal(run(`inOrder('ppl')`), false, 'PPL : selon la récupération');
    run(`data.programmes.ppl.timers.push = Date.now() - 100 * ${H}; data.programmes.ppl.timers.pull = Date.now() - 200 * ${H};`);
    assert.equal(next(), 'legs', 'PPL : jamais faite d\'abord, pas « après Push »');
    assert.equal(run(`otherSessions(sessionKeys(), 'legs').join()`), 'pull,push', 'autres séances par récupération');
  });

  test('ordre : réglage gardé par sanitizeData et par une mise à jour du coach', () => {
    split('recovery');
    run(`sanitizeData(data)`);
    assert.equal(run(`data.userProgrammes.${PID}.rotation`), 'recovery');
  });
}
