// Prise d'un exercice (js/data/grips.js) et ordre de la séance (js/data/session-order.js) :
// mouvements concernés, nettoyage, texte, programme du coach, Plus tard / Faire maintenant
export default function ({ test, run, reset, sameJSON, assert }) {
  const opts = name => run(`gripOptionsFor({ name: ${JSON.stringify(name)} })`);

  test('prise : jamais contraire au nom (panel du 07/11, « prise large » + « neutre · deux poignées »)', () => {
    reset();
    sameJSON(opts('Tirage vertical prise large'), { family: 'pulldown', hand: ['pronation', 'supination'] }, 'large : à la barre, ni neutre ni poignées');
    sameJSON(opts('Rowing barre prise large'), { family: 'row', hand: ['pronation', 'supination'] });
    sameJSON(opts('Tirage horizontal prise large'), { family: 'cable-row', hand: ['pronation', 'supination'] }, 'barre seule : pas de choix de poignée');
    sameJSON(opts('Curl poulie supination').tool, ['barre', 'ez', 'poignees'], 'supination : ni triangle ni corde, toujours neutres');
    sameJSON(opts('Tirage vertical prise serrée').tool, ['barre', 'triangle', 'poignees'], 'serrée : tout reste possible');
    // Déjà enregistrée (programme reçu, ancienne version) : la partie contraire n'est plus affichée
    assert.equal(run('gripText({ hand: "neutre", tool: "poignees" }, { name: "Tirage vertical prise large" })'), '');
    assert.equal(run('gripText({ hand: "supination", tool: "poignees" }, { name: "Tirage vertical prise large" })'), 'Prise en supination');
    assert.equal(run('gripText({ hand: "neutre", tool: "poignees" }, { name: "Tirage vertical" })'), 'Prise neutre · Deux poignées', 'nom sans largeur : inchangé');
  });

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

  // Toute la bibliothèque : famille et réglages attendus, nommés un par un ; tout autre exercice n'a pas de prise
  const CATALOGUE_GRIPS = {
    "Développé couché barre": 'press:width',
    "Développé couché haltères": 'press:hand',
    "Développé incliné barre": 'press:width',
    "Développé incliné haltères": 'press:hand',
    "Développé décliné": 'press:width',
    "Développé couché machine": 'press:hand',
    "Soulevé de terre": 'deadlift:hand',
    "Tractions pronation": 'pullup:width',
    "Tractions prise serrée": 'pullup:hand',
    "Tirage vertical prise large": 'pulldown:hand',   // prise large : à la barre, en pronation ou supination
    "Tirage vertical prise serrée": 'pulldown:hand,tool',
    "Tirage horizontal câble": 'cable-row:hand,width,tool',
    "Rowing barre": 'row:hand,width',
    "Rowing haltère unilatéral": 'row:hand',
    "Rowing barre T": 'row:hand,width',
    "Développé militaire barre": 'press:width',
    "Développé militaire haltères": 'press:hand',
    "Curl biceps barre": 'curl:hand,width,tool',
    "Curl biceps haltères": 'curl:hand',
    "Curl pupitre": 'curl:hand',
    "Curl incliné": 'curl:hand',
    "Curl poulie": 'curl:hand,tool',
    "Curl concentration": 'curl:hand',
    "Extension triceps poulie": 'triceps:hand,tool',
    "Soulevé de terre roumain": 'deadlift:hand',
    "Développé au sol haltères": 'press:hand',
    "Rowing haltères buste penché": 'row:hand',
    "Tractions supination": 'pullup:width',
    "Tractions australiennes": 'pullup:hand,width',
    "Rowing sous une table": 'row:hand,width',
    "Tractions négatives": 'pullup:hand,width',
    "Tractions avec élastique": 'pullup:hand,width',
    "Tractions archer": 'pullup:hand,width',
    "Rowing élastique": 'row:hand',
    "Curl élastique": 'curl:hand',
    "Développé épaules élastique": 'press:hand',
    "Rowing kettlebell": 'row:hand',
    "Développé épaule kettlebell": 'press:hand',
    "Soulevé de terre sumo": 'deadlift:hand',
    "Rack pull": 'deadlift:hand',
    "Développé incliné smith": 'press:width',
    "Développé militaire smith": 'press:width',
    "Développé épaules machine": 'press:hand',
    "Rowing machine": 'row:hand,width',
    "Curl araignée": 'curl:hand',
    "Tractions assistées (machine)": 'pullup:hand,width',
    "Développé décliné smith": 'press:width',
  };
  test('prise : toute la bibliothèque, famille et réglages attendus', () => {
    reset();
    const got = run(`Object.fromEntries(EXERCISE_CATALOGUE.map(e => [e.name, (o => o ? o.family + ':' + Object.keys(o).filter(k => k !== 'family').join(',') : null)(gripOptionsFor({ name: e.name }))]))`);
    Object.entries(got).forEach(([name, v]) => assert.equal(v, CATALOGUE_GRIPS[name] ?? null, name));
    Object.keys(CATALOGUE_GRIPS).forEach(name => assert.ok(name in got, `${name} : encore dans la bibliothèque`));
    // Câble : triceps et curl reconnus avant les tirages ; écartés, élévations, kickbacks sans prise
    assert.equal(opts('Extension triceps poulie haute').family, 'triceps');
    assert.equal(opts('Curl poulie basse').family, 'curl');
    assert.equal(opts('Curl biceps poulie haute').family, 'curl');
    ['Écarté poulie basse', 'Écarté poulie haute', 'Crossover poulie haute', 'Élévations latérales poulie basse', 'Kickback poulie basse',
      'Oiseau poulie', 'Rowing menton poulie basse', 'Pull over poulie haute'].forEach(n => assert.equal(opts(n), null, n));
    // « Poulie haute » ou « basse » seuls : les tirages
    assert.equal(opts('Poulie haute').family, 'pulldown');
    assert.equal(opts('Tirage poulie basse').family, 'cable-row');
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
    // lastEi posé : superset pas commencé, le dernier membre (le tour repart du premier)
    assert.equal(run('orderFocusEi(orderDoNow(xs, 3, 1), 1)'), 2);
    assert.equal(run('orderFocusEi(xs, 4)'), 4);
  });

  // Séance simulée sur les vraies fonctions (currentSet de js/features/session.js) ; écran, stockage et natif
  // remplacés le temps du test, puis rendus (restore) pour les tests suivants
  const STUBBED = ['render', 'scrollToCurrent', 'haptic', 'persistSession', 'cancelEffort', 'showToast', 'save'];
  const stub = () => run(`globalThis.__gripOrig ||= { ${STUBBED.map(k => `${k}: typeof ${k} === 'function' ? ${k} : undefined`).join(', ')} };
    if (typeof sessProg !== 'function') globalThis.sessProg = () => data.programmes[activeSession.programme];`);
  // Test qui remplace des fonctions : rendues même s'il échoue
  const stubbedTest = (name, fn) => test(name, () => { try { fn(); } finally { restore(); } });
  const restore = () => run(`if (globalThis.__gripOrig) { ${STUBBED.map(k => `${k} = __gripOrig.${k}`).join('; ')}; } activeSession = null; editingSet = null;`);
  const fakeSession = (specs, lastEi = null) => { stub(); run(`(() => {
    globalThis.nativeCalls = [];
    render = () => {}; scrollToCurrent = () => {}; haptic = () => {}; persistSession = () => {}; cancelEffort = () => { activeSession.effort = null; };
    syncNativeRest = () => { const c = currentSet(); nativeCalls.push(c ? activeSession.exercises[c.ei].name : null); };
    showToast = (msg, o) => { globalThis.lastToast = { msg, o }; };
    activeSession = { category: 'pull', programme: 'ppl', startedAt: 1, exercises: ${list(specs)}, lastEi: ${lastEi} };
    editingSet = null;
  })()`); };
  const curName = () => run('(c => c ? activeSession.exercises[c.ei].name + " S" + (c.si + 1) : null)(currentSet())');

  stubbedTest('ordre : Faire maintenant sur un superset déjà commencé garde le tour', () => {
    reset();
    // A1 S1 faite, A2 pas encore (machine prise), C commencé : A2 S1 doit suivre, pas A1 S2
    fakeSession([['A1', 3, 'g', 1], ['A2', 3, 'g', 0], ['C', 3, null, 1], ['D', 3]], 2);
    assert.equal(curName(), 'C S2');
    run('sessionDoNow(0)');
    sameJSON(run('activeSession.exercises.map(e => e.name)'), ['A1', 'A2', 'C', 'D']);
    assert.equal(curName(), 'A2 S1', 'le membre le moins avancé');
    // Le tour enchaîne ensuite normalement : A2 S1 validée → A1 S2
    run('activeSession.exercises[1].sets[0].done = true; activeSession.lastEi = 1');
    assert.equal(curName(), 'A1 S2');
    // Membres à égalité : le premier
    fakeSession([['C', 3, null, 1], ['A1', 3, 'g', 1], ['A2', 3, 'g', 1]], 0);
    run('sessionDoNow(2)');
    assert.equal(curName(), 'A1 S2');
  });

  stubbedTest('ordre : Plus tard passe au bloc qui suivait, pas au premier de la liste', () => {
    reset();
    // A sauté plus haut (pas commencé), B en cours : Plus tard sur B → C, pas A
    fakeSession([['A', 3], ['B', 3, null, 1], ['C', 3], ['D', 3]], 1);
    assert.equal(curName(), 'B S2');
    run('sessionDoLater(1)');
    sameJSON(run('activeSession.exercises.map(e => e.name)'), ['A', 'C', 'D', 'B']);
    assert.equal(curName(), 'C S1');
    assert.equal(run('lastToast.msg'), 'Mis en dernier');
    // Dernier bloc de la liste : on repart du premier qui reste à faire
    fakeSession([['A', 3, null, 3], ['B', 3], ['C', 3, null, 1]], 2);
    run('sessionDoLater(2)');
    assert.equal(curName(), 'B S1');
    // Superset : le bloc suivant aussi
    fakeSession([['A1', 3, 'g', 1], ['A2', 3, 'g', 1], ['C', 3], ['D', 3]], 1);
    run('sessionDoLater(0)');
    sameJSON(run('activeSession.exercises.map(e => e.name)'), ['C', 'D', 'A1', 'A2']);
    assert.equal(curName(), 'C S1');
    sameJSON(run('orderLaterFocus(' + list([['A', 3, null, 3], ['B', 3]]) + ', 1)'), null, 'rien d\'autre à faire');
  });

  stubbedTest('ordre : chrono, série rouverte, RIR, notification du repos et Annuler suivent', () => {
    reset();
    fakeSession([['A', 3, null, 1], ['B', 3], ['C', 3]], 0);
    run(`activeSession.effort = { kind: 'time', ei: 2, si: 0 }; editingSet = { ei: 0, si: 0 }; activeSession.lastDone = { ei: 0, si: 0 }`);
    run('sessionDoNow(2)');
    sameJSON(run('activeSession.exercises.map(e => e.name)'), ['C', 'A', 'B']);
    assert.equal(run('activeSession.effort.ei'), 0, 'chrono : suit C');
    assert.equal(run('editingSet.ei'), 1, 'série rouverte : suit A');
    sameJSON(run('activeSession.lastDone'), { ei: 1, si: 0 }, 'RIR : suit A');
    sameJSON(run('nativeCalls'), ['C'], 'notification de fin de repos et Live Activity : nouvel exercice suivant');
    // Annuler : ordre, positions et série en cours d'avant
    run('lastToast.o.onAction()');
    sameJSON(run('activeSession.exercises.map(e => e.name)'), ['A', 'B', 'C']);
    assert.equal(run('activeSession.effort.ei'), 2);
    assert.equal(run('editingSet.ei'), 0);
    sameJSON(run('activeSession.lastDone'), { ei: 0, si: 0 });
    assert.equal(curName(), 'A S2');
    sameJSON(run('nativeCalls'), ['C', 'A']);
    // Annuler après un autre changement de liste : sans effet
    run('sessionDoNow(2); globalThis.t1 = lastToast; activeSession.exercises = [...activeSession.exercises]; t1.o.onAction()');
    assert.equal(run('activeSession.exercises[0].name'), 'C');
  });

  stubbedTest('prise en séance : programme perso mis à jour, programme du coach jamais', () => {
    reset();
    stub();
    run(`save = () => {}; persistSession = () => {};
      data.userProgrammes.u_cc1_x = { name: 'Coach', sessions: { a: { label: 'A', icon: '', desc: '', color: '#FF9500' } }, order: ['a'], archived: false, fromCoach: { coachId: 'c1', sentAt: 1, hash: 'h' } };
      data.programmes.u_cc1_x = { exercises: { a: [Object.assign(makeExercise('Tirage vertical', 3), { id: 'e1' })] }, timers: {}, cooldowns: {} };
      activeSession = { category: 'a', programme: 'u_cc1_x', startedAt: 1, exercises: [{ exId: 'e1', name: 'Tirage vertical', measure: 'reps', sets: [] }] };
      setSessionGrip(0, { hand: 'neutre' });`);
    sameJSON(run('activeSession.exercises[0].grip'), { hand: 'neutre' }, 'séance : prise prise en compte');
    assert.equal(run('data.programmes.u_cc1_x.exercises.a[0].grip'), undefined, 'programme du coach : inchangé');
    assert.match(run('gripSheetHtml(0)'), /programme de ton coach ne change pas/);
    run(`activeSession = { category: 'pull', programme: 'ppl', startedAt: 1, exercises: [{ exId: data.programmes.ppl.exercises.pull[1].id, name: data.programmes.ppl.exercises.pull[1].name, measure: 'reps', sets: [] }] };
      setSessionGrip(0, { hand: 'supination' });`);
    sameJSON(run('data.programmes.ppl.exercises.pull[1].grip'), { hand: 'supination' }, 'programme perso : la prochaine fois aussi');
  });

  test('ordre : Plus tard met le bloc en dernier, seulement s\'il reste autre chose', () => {
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
