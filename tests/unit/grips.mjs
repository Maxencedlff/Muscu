// Prise d'un exercice (js/data/grips.js) et ordre de la séance (js/data/session-order.js) :
// mouvements concernés, nettoyage, texte, programme du coach, Faire maintenant / Faire plus tard
export default function ({ test, run, reset, sameJSON, assert }) {
  const opts = name => run(`gripOptionsFor({ name: ${JSON.stringify(name)} })`);

  test('prise : proposée seulement là où elle compte, sans redire ce que le nom fixe', () => {
    reset();
    // Demande du coach : tirage vertical prise serrée → sens des mains et poignée, pas la largeur
    sameJSON(opts('Tirage vertical prise serrée'), { family: 'pulldown', hand: ['pronation', 'supination', 'neutre'], tool: ['barre', 'triangle', 'poignees'] });
    sameJSON(opts('lat pulldown'), { family: 'pulldown', hand: ['pronation', 'supination', 'neutre'], width: ['serree', 'moyenne', 'large'], tool: ['barre', 'triangle', 'poignees'] });
    assert.equal(opts('Tractions pronation').hand, undefined, 'sens des mains dans le nom');
    assert.ok(opts('Tractions avec élastique').width, 'tractions avec élastique : toujours à la barre');
    assert.equal(opts('Tirage horizontal câble').family, 'cable-row');
    assert.equal(opts('Rowing haltère unilatéral').width, undefined, 'un seul bras : pas de largeur');
    assert.equal(opts('Développé couché barre').hand, undefined, 'barre : pronation forcée');
    sameJSON(opts('Développé couché haltères').hand, ['pronation', 'neutre']);
    sameJSON(opts('Curl biceps barre').tool, ['barre', 'ez']);
    assert.equal(opts('Curl biceps haltères').tool, undefined);
    assert.equal(opts('Curl poulie').width, undefined, 'curl à la poulie : la poignée, pas la largeur');
    sameJSON(opts('Soulevé de terre').hand, ['pronation', 'mixte', 'crochet']);
    // Aucun réglage : le nom dit tout, ou le mouvement n'a pas de prise à choisir
    ['Curl marteau', 'Curl inversé', 'Leg curl', 'Curl nordique', 'Squat', 'Face pull', 'Rowing menton', 'Tirage bras tendus poulie',
      'Extension triceps corde nuque', 'Développé Arnold', 'Soulevé de terre kettlebell', 'Gainage', 'Rameur']
      .forEach(n => assert.equal(opts(n), null, n));
    assert.equal(run('gripOptionsFor({ name: "Tractions", measure: "time" })'), null, 'maintien : pas de prise');
  });

  test('prise : nettoyage, texte et comparaison', () => {
    reset();
    sameJSON(run('cleanGrip({ hand: "neutre", width: "serree", tool: "triangle", x: 1 })'), { hand: 'neutre', width: 'serree', tool: 'triangle' });
    assert.equal(run('cleanGrip({ hand: "<b>", width: 3 })'), null);
    assert.equal(run('cleanGrip("neutre")'), null);
    assert.equal(run('cleanGrip(["neutre"])'), null);
    // Avec un nom : seulement ce qui est proposé pour lui (la largeur d'un « prise serrée » tombe)
    sameJSON(run('cleanGrip({ hand: "neutre", width: "large" }, { name: "Tirage vertical prise serrée" })'), { hand: 'neutre' });
    assert.equal(run('gripText({ hand: "neutre", width: "serree", tool: "triangle" })'), 'Prise serrée neutre · Triangle');
    assert.equal(run('gripText({ hand: "supination" })'), 'Prise en supination');
    assert.equal(run('gripText({ width: "large", hand: "pronation" })'), 'Prise large en pronation');
    assert.equal(run('gripText({ tool: "poignees" })'), 'Deux poignées');
    assert.equal(run('gripText(null)'), '');
    assert.equal(run('gripText({ width: "large" }, { name: "Squat" })'), '', 'exercice sans prise : rien d\'affiché');
    assert.ok(run('sameGrip({ hand: "neutre" }, { hand: "neutre", x: 2 })'));
    assert.ok(!run('sameGrip({ hand: "neutre" }, { hand: "neutre", width: "large" })'));
    assert.ok(run('sameGrip(null, {})'));
    // Pas de photo tant que les coachs n'en ont pas fourni : aucune image vide
    assert.equal(run('gripPhoto({ name: "Tirage vertical" }, { hand: "neutre" })'), null);
  });

  test('prise : gardée par sanitizeData (programme et historique), valeurs inconnues retirées', () => {
    reset();
    run(`data.programmes.ppl.exercises.pull[0].grip = { hand: 'neutre', tool: 'pince' };
      data.programmes.ppl.exercises.pull[1].grip = { hand: 'ailleurs' };
      data.history = [{ id: 'h1', programme: 'ppl', category: 'pull', date: 5, exercises: [
        { exId: 'a', name: 'Tirage vertical', grip: { width: 'large', hand: 'pronation' }, sets: [{ weight: '50', reps: '10' }] },
        { exId: 'b', name: 'Rowing barre', grip: 'large', sets: [{ weight: '60', reps: '8' }] }] }];
      save(); data = loadData();`);
    sameJSON(run('data.programmes.ppl.exercises.pull[0].grip'), { hand: 'neutre' });
    assert.equal(run('"grip" in data.programmes.ppl.exercises.pull[1]'), false);
    sameJSON(run('data.history[0].exercises[0].grip'), { hand: 'pronation', width: 'large' });
    assert.equal(run('"grip" in data.history[0].exercises[1]'), false);
  });

  test('prise : envoyée par le coach, reçue par l\'élève, mise à jour et retirée', () => {
    reset();
    run(`data.userProgrammes.u_dos = { name: 'Dos', sessions: { a: { label: 'Dos', icon: '', desc: '', color: '#FF9500' } }, order: ['a'], archived: false };
      data.programmes.u_dos = { exercises: { a: [makeExercise('Tirage vertical prise serrée', 4), makeExercise('Squat', 3)] }, timers: {}, cooldowns: {} };
      data.programmes.u_dos.exercises.a[0].grip = { hand: 'neutre', tool: 'poignees' };
      data.programmes.u_dos.exercises.a[1].grip = { width: 'large' };`);
    const sent = run('cleanSentProgramme(programmeToSent(data, "u_dos"))');
    sameJSON(sent.sessions[0].exercises[0].grip, { hand: 'neutre', tool: 'poignees' });
    assert.equal(sent.sessions[0].exercises[1].grip, undefined, 'squat : pas de prise envoyée');
    // Envoi forgé : valeur inconnue écartée à la réception
    const forged = run(`cleanSentProgramme({ name: 'X', sessions: [{ key: 'a', label: 'A', exercises: [{ name: 'Rowing barre', sets: 3, grip: { hand: '"><img>', width: 'serree' } }] }] })`);
    sameJSON(forged.sessions[0].exercises[0].grip, { width: 'serree' });
    reset();
    const item = { id: 'u_dos', data: sent, sentAt: 1000, seen: false };
    run(`importCoachProgramme(data, ${JSON.stringify(item)}, { user_id: 'c1', username: 'max' })`);
    const xs = run('data.programmes.u_cc1_u_dos.exercises.a');
    sameJSON(xs[0].grip, { hand: 'neutre', tool: 'poignees' });
    sameJSON(run(`(({ status, modified }) => ({ status, modified }))(coachProgrammeStatus(data, ${JSON.stringify(item)}, 'c1'))`), { status: 'current', modified: false }, 'empreinte stable');
    // Nouvel envoi sans prise : le coach l'a retirée, l'exercice garde son identifiant
    const v2 = JSON.parse(JSON.stringify(item)); v2.sentAt = 2000; delete v2.data.sessions[0].exercises[0].grip;
    run(`importCoachProgramme(data, ${JSON.stringify(v2)}, { user_id: 'c1', username: 'max' })`);
    const ys = run('data.programmes.u_cc1_u_dos.exercises.a');
    assert.equal(ys[0].id, xs[0].id);
    assert.equal(ys[0].grip, undefined, 'prise retirée par le coach');
  });

  // Liste de séance : [nom, séries, ss, séries faites]
  const list = specs => JSON.stringify(specs.map(([name, n, ss, done = 0]) => ({
    name, ...(ss ? { ss } : {}), sets: Array.from({ length: n }, (_, i) => ({ done: i < done })),
  })));
  const names = code => { const r = run(`(() => { const r = ${code}; return r ? r.map(e => e.name) : null; })()`); return r ? [...r] : null; };

  test('ordre : Faire maintenant passe le bloc avant celui en cours, superset entier', () => {
    reset();
    run(`globalThis.xs = ${list([['A', 3, null, 3], ['B', 3], ['C', 3, 'g'], ['D', 3, 'g'], ['E', 3]])}`);
    sameJSON(names('orderDoNow(xs, 4, 1)'), ['A', 'E', 'B', 'C', 'D']);
    sameJSON(names('orderDoNow(xs, 3, 1)'), ['A', 'C', 'D', 'B', 'E'], 'D appelé : tout le superset vient');
    assert.equal(run('orderDoNow(xs, 1, 1)'), null, 'déjà en cours');
    assert.equal(run('orderDoNow(xs, 0, 1)'), null, 'exercice fini');
    // lastEi posé : dernier membre d'un superset (le tour repart du premier qui a une série à faire)
    assert.equal(run('orderFocusEi(orderDoNow(xs, 3, 1), 1)'), 2);
    assert.equal(run('orderFocusEi(xs, 4)'), 4);
  });

  test('ordre : Faire plus tard met le bloc en dernier, seulement s\'il reste autre chose', () => {
    reset();
    run(`globalThis.xs = ${list([['A', 3, 'g', 1], ['B', 3, 'g'], ['C', 3], ['D', 2, null, 2]])}`);
    sameJSON(names('orderDoLater(xs, 1)'), ['C', 'D', 'A', 'B'], 'superset entier, séries faites gardées');
    run(`globalThis.ys = ${list([['A', 3], ['B', 2, null, 2]])}`);
    assert.equal(run('orderDoLater(ys, 0)'), null, 'plus rien d\'autre à faire');
    // Choix de la carte
    assert.equal(run('orderChoiceFor(xs, 0, 0)'), 'later');
    assert.equal(run('orderChoiceFor(xs, 1, 0)'), 'later', 'membre du superset en cours');
    assert.equal(run('orderChoiceFor(xs, 2, 0)'), 'now');
    assert.equal(run('orderChoiceFor(xs, 3, 0)'), null, 'exercice fini');
    assert.equal(run('orderChoiceFor(ys, 0, 0)'), null, 'dernier exercice à faire');
    assert.equal(run('orderChoiceFor(xs, 2, undefined)'), null, 'séance finie');
  });

  test('ordre et prise : dans le menu ⋯ de la séance', () => {
    reset();
    const values = (xs, ei, cur) => run(`exerciseMenuActions(${xs}, ${ei}, ${cur}).map(a => a.value).join()`).split(',');
    const xs = list([['Tirage vertical prise serrée', 3], ['Squat', 3], ['Curl marteau', 3]]);
    assert.ok(values(xs, 0, 0).includes('later') && !values(xs, 0, 0).includes('now'));
    assert.ok(values(xs, 1, 0).includes('now'));
    assert.ok(values(xs, 0, 0).includes('grip'), 'tirage : Prise');
    assert.ok(!values(xs, 1, 0).includes('grip') && !values(xs, 2, 0).includes('grip'), 'squat, curl marteau : pas de Prise');
    assert.equal(values(xs, 0, 0)[0], 'later', 'en tête du menu');
  });
}
