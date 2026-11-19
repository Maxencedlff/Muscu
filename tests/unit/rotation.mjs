// File des séances (dashboard.js : nextSessionCat, sessionQueue, otherSessions) et tronc qui ne bloque plus une
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
  // Programme créé, séances dans cet ordre
  const split = () => {
    reset();
    run(`data.userProgrammes.${PID} = { name: 'Split séquentiel', archived: false, order: ${JSON.stringify(KEYS)},
           sessions: Object.fromEntries(${JSON.stringify(KEYS)}.map(k => [k, { label: k, icon: '', desc: '', color: '#FF9500' }])) };
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
    split();
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
    split();
    run(`prog().exercises.bras = [makeExercise('Crunch', 3), makeExercise('Gainage (planche)', 3)]`);
    done('jambes', 10);
    assert.equal(run(`catStatus('bras').ready`), false);
    assert.equal(run(`catStatus('bras').by.muscle`), 'abs');
  });

  // File (règle de Maxence, 19/11) : faire une séance la renvoie en fin de file, la proposée est la tête de file
  const queue = () => [next(), ...others()];

  test('file : jamais rien fait, l\'ordre du programme', () => {
    split();
    assert.equal(next(), 'pecs');
    assert.deepEqual(others(), ['dos', 'jambes', 'epaules', 'bras']);
  });

  test('file : cas de Maxence, Pecs puis Jambes, proposée Dos', () => {
    split();
    done('pecs', 36);
    done('jambes', 15);
    assert.deepEqual(queue(), ['dos', 'epaules', 'bras', 'pecs', 'jambes']);
  });

  test('file : dernière faite au milieu, les jamais faites d\'abord puis la plus ancienne', () => {
    split();
    done('pecs', 50);
    done('dos', 26);
    assert.deepEqual(queue(), ['jambes', 'epaules', 'bras', 'pecs', 'dos']);
    assert.equal(run(`passedOverNote(sessionKeys(), 'jambes')`), '', 'rien n\'est sauté');
  });

  test('file : tout fait dans l\'ordre, la dernière de la liste faite, retour au début', () => {
    split();
    KEYS.forEach((k, i) => done(k, 24 * (KEYS.length - i)));
    assert.deepEqual(queue(), KEYS);
  });

  test('file : séance proposée pas reposée, gardée en tête, Démarrer possible, avertissement', () => {
    split();
    run(`prog().exercises.epaules.push(makeExercise('Squat barre', 3))`);   // les quadriceps de Jambes la retiennent
    KEYS.forEach((k, i) => done(k, 24 * (10 - i)));   // tout fait, Bras il y a 6 jours
    done('pecs', 30); done('dos', 20); done('jambes', 10);
    assert.equal(next(), 'epaules', 'tête de file, même pas reposée');
    assert.equal(run(`catStatus('epaules').ready`), false);
    assert.match(run(`recoveryWarning(catStatus('epaules'))`), /^Attention : il reste .+ de récupération \(quadriceps\)$/);
  });

  test('file : autre séance faite aujourd\'hui (touchée dans Ensuite), elle passe en fin de file', () => {
    split();
    done('pecs', 48);
    assert.equal(next(), 'dos');
    done('epaules', 1);   // Dos était proposée, Épaules faite à la place
    assert.deepEqual(queue(), ['dos', 'jambes', 'bras', 'pecs', 'epaules']);
  });

  test('file : séance en cours, « Ensuite » montre la file sans elle', () => {
    split();
    done('pecs', 48);
    assert.deepEqual(JSON.parse(run(`JSON.stringify(otherSessions(sessionKeys(), 'jambes'))`)), ['dos', 'epaules', 'bras', 'pecs']);
  });

  test('file : l\'ordre changé reprend tout de suite, depuis le début du programme (moveSession)', () => {
    split();
    done('pecs', 30);
    assert.equal(next(), 'dos');
    run(`moveSession('${PID}', 3, 1)`);   // Épaules juste après Pecs
    assert.deepEqual(JSON.parse(run(`JSON.stringify(sessionKeys())`)), ['pecs', 'epaules', 'dos', 'jambes', 'bras'], 'affichage : l\'ordre choisi');
    assert.deepEqual(queue(), ['pecs', 'epaules', 'dos', 'jambes', 'bras'], 'la file reprend l\'ordre choisi (orderAt)');
  });

  test('file : tout fait, puis réordonné, l\'accueil suit le nouvel ordre (orderAt, audit du 19/11)', () => {
    split();
    // Historique fait dans un autre ordre (choix par récupération, avant la branche) : dos, pecs, bras, jambes, epaules
    ['dos', 'pecs', 'bras', 'jambes', 'epaules'].forEach((k, i) => done(k, (10 - i) * 24));
    assert.deepEqual(queue(), ['dos', 'pecs', 'bras', 'jambes', 'epaules'], 'avant : la file suit l\'historique');
    run(`moveSession('${PID}', 4, 0)`);   // Bras en tête
    assert.deepEqual(JSON.parse(run(`JSON.stringify(sessionKeys())`)), ['bras', 'pecs', 'dos', 'jambes', 'epaules']);
    assert.ok(run(`data.userProgrammes.${PID}.orderAt`) > 0, 'orderAt posé');
    assert.deepEqual(queue(), ['bras', 'pecs', 'dos', 'jambes', 'epaules'], 'après : le nouvel ordre');
    run(`sanitizeData(data)`);
    assert.ok(run(`data.userProgrammes.${PID}.orderAt`) > 0, 'orderAt gardé par sanitizeData');
  });

  test('file : réordonné, puis une séance faite, elle part à la fin', () => {
    split();
    KEYS.forEach((k, i) => done(k, (10 - i) * 24));
    run(`moveSession('${PID}', 4, 0)`);   // Bras, Pecs, Dos, Jambes, Épaules
    run(`prog().timers.bras = Date.now() + 1000;`);   // Bras fait juste après le changement d'ordre
    assert.deepEqual(queue(), ['pecs', 'dos', 'jambes', 'epaules', 'bras']);
    run(`prog().timers.pecs = Date.now() + 2000;`);
    assert.deepEqual(queue(), ['dos', 'jambes', 'epaules', 'bras', 'pecs']);
  });

  test('file : programmes intégrés inchangés (selon la récupération)', () => {
    reset();
    run(`data.programmes.ppl.timers.push = Date.now() - 100 * ${H}; data.programmes.ppl.timers.pull = Date.now() - 200 * ${H};`);
    assert.equal(next(), 'legs', 'PPL : jamais faite d\'abord');
    assert.equal(run(`otherSessions(sessionKeys(), 'legs').join()`), 'pull,push', 'autres séances par récupération');
  });
}
