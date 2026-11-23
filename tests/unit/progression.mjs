// ═══════════════════════════════════════════════════════════
//  Double progression quand le cran de charge est gros (Maxence le 23/11 : « ça propose d'augmenter le poids alors
//  que là c'est les reps qui seraient intéressantes ») : repsBeforeBump, loadStepKg, exerciseGoal, goalBumpDue
//  (puce ↑ de la séance). Règle : docs/PROGRESSION.md
// ═══════════════════════════════════════════════════════════

export default function ({ test, run, reset, assert, sameJSON }) {
  const DAY = 86400000;
  const set = (weight, reps) => ({ weight: String(weight), reps: String(reps), done: true });
  // Une séance « shoulders » d'un seul exercice, faite hier avec ces séries
  function seed(name, sets, extra = {}) {
    run(`data.activeProgramme = 'ppl';
      data.programmes.ppl.exercises.pull = [{ id: 'x', name: ${JSON.stringify(name)}, sets: ${sets.length}, repMax: 12, ...${JSON.stringify(extra)} }];
      data.history = [{ id: 'h1', programme: 'ppl', category: 'pull', date: Date.now() - ${DAY}, duration: 3000000,
        exercises: [{ exId: 'x', name: ${JSON.stringify(name)}, sets: ${JSON.stringify(sets)} }] }];`);
    return 'data.programmes.ppl.exercises.pull[0]';
  }
  const goal = ex => run(`exerciseGoal('pull', ${ex})`);
  const due = ex => run(`goalBumpDue(${ex}, ${ex.replace('data.programmes.ppl.exercises.pull[0]', 'data.history[0].exercises[0]')}.sets)`);

  test('progression : élévations latérales 8 kg × 15, cran de 2,5 kg → 8 kg × 16, pas 10,5 kg', () => {
    reset();
    const ex = seed('Élévations latérales', [set(8, 15), set(8, 14), set(8, 13), set(8, 12)]);
    assert.equal(run(`loadStepKg(${ex})`), 2.5, 'haltères : 2,5 kg');
    assert.equal(run(`repsBeforeBump(${ex}, 8)`), 20, '+ 31 % : 20 reps à 8 kg avant 10,5 kg × 8');
    sameJSON(goal(ex), { text: '8 kg × 16', gain: '1 rep', before: '8 kg × 15', goal: { w: 8, r: 16 } });
    assert.equal(due(ex), false, 'puce ↑ de la séance cachée, comme l\'accueil');
    // Les reps ont assez monté : la charge passe, au bas de la fourchette
    const ex2 = seed('Élévations latérales', [set(8, 20), set(8, 18), set(8, 16)]);
    sameJSON(goal(ex2).goal, { w: 10.5, r: 8 });
    assert.equal(due(ex2), true);
  });

  test('progression : développé militaire haltères 18 kg × 12 → 18 kg × 13 (fourchette 8 à 12, puis 14)', () => {
    reset();
    let ex = seed('Développé militaire haltères', [set(18, 12), set(18, 12), set(18, 12), set(18, 12)]);
    sameJSON(goal(ex), { text: '18 kg × 13', gain: '1 rep', before: '18 kg × 12', goal: { w: 18, r: 13 } },
      'toutes les séries au haut : avant, 20,5 kg × 8 (les reps s\'effondraient)');
    assert.equal(due(ex), false);
    ex = seed('Développé militaire haltères', [set(18, 14), set(18, 12), set(18, 11), set(18, 10)]);
    sameJSON(goal(ex).goal, { w: 20.5, r: 8 }, '14 reps à 18 kg : 20,5 kg × 8 se tient (1RM estimé)');
    // Fourchette 10 à 12 : le bas est plus haut, il faut plus de reps avant de monter
    ex = seed('Développé militaire haltères', [set(18, 12), set(18, 12), set(18, 12)], { repMin: 10 });
    assert.equal(run(`repsBeforeBump(${ex}, 18)`), 16);
    sameJSON(goal(ex).goal, { w: 18, r: 13 });
  });

  test('progression : barre de 100 kg, + 2,5 kg → la charge monte comme avant', () => {
    reset();
    const ex = seed('Développé couché barre', [set(100, 12), set(100, 12), set(100, 12)]);
    assert.equal(run(`loadStepKg(${ex})`), 2.5, 'barre : 2 × le plus petit disque (1,25 kg)');
    assert.equal(run(`repsBeforeBump(${ex}, 100)`), null, '+ 2,5 % : la fourchette suffit');
    sameJSON(goal(ex), { text: '102,5 kg × 8', gain: '2,5 kg', before: '100 kg × 12', goal: { w: 102.5, r: 8 } });
    assert.equal(due(ex), true);
    // Pas encore au haut : + 1 rep, jamais au-delà de 12
    const ex2 = seed('Développé couché barre', [set(100, 11), set(100, 10)]);
    sameJSON(goal(ex2).goal, { w: 100, r: 12 });
    // Plus petit disque de 2,5 kg : le cran de la barre est de 5 kg
    run(`data.plates = { kg: [20, 10, 5, 2.5] }`);
    assert.equal(run(`loadStepKg(${ex})`), 5);
    assert.equal(run(`loadStepLabel(${ex})`), '5 kg');
  });

  test('progression : machine à crans de 5 kg (loadStep)', () => {
    reset();
    let ex = seed('Presse à cuisses', [set(40, 12), set(40, 12), set(40, 12)], { loadStep: 5 });
    assert.equal(run(`loadStepKg(${ex})`), 5);
    sameJSON(goal(ex), { text: '40 kg × 13', gain: '1 rep', before: '40 kg × 12', goal: { w: 40, r: 13 } }, '+ 12,5 % : une rep de plus');
    ex = seed('Presse à cuisses', [set(40, 13), set(40, 12), set(40, 12)], { loadStep: 5 });
    sameJSON(goal(ex), { text: '45 kg × 8', gain: '5 kg', before: '40 kg × 13', goal: { w: 45, r: 8 } }, 'cran du gain : 5 kg, pas 2,5');
    ex = seed('Presse à cuisses', [set(80, 12), set(80, 12), set(80, 12)], { loadStep: 5 });
    sameJSON(goal(ex).goal, { w: 85, r: 8 }, 'à 80 kg, + 6 % : la charge monte au haut de la fourchette');
  });

  test('progression : cran énorme, reps fixes, coach, poids du corps : bornes et règles d\'avant', () => {
    reset();
    // 2 → 4,5 kg (+ 125 %) : jamais plus de 2 × le haut (24), la charge finit par passer
    let ex = seed('Élévations latérales', [set(2, 24), set(2, 20)]);
    assert.equal(run(`repsBeforeBump(${ex}, 2)`), 24);
    sameJSON(goal(ex).goal, { w: 4.5, r: 8 });
    // Reps fixes (4 × 12) : le nombre fixé prime, la charge monte à 12 partout (règle des reps fixes)
    ex = seed('Élévations latérales', [set(8, 12), set(8, 12), set(8, 12), set(8, 12)], { repFixed: true });
    assert.equal(run(`repsBeforeBump(${ex}, 8)`), null);
    sameJSON(goal(ex).goal, { w: 10.5, r: 12 });
    // Programme du coach : jamais de rep au-delà du haut de sa fourchette, ni de hausse
    ex = seed('Élévations latérales', [set(8, 15), set(8, 14)]);
    run(`data.userProgrammes = { ppl: { fromCoach: true } }`);
    sameJSON(goal(ex).goal, { w: 8, r: 12 });
    run(`delete data.userProgrammes.ppl`);
    // Livres : 5 lb sur 20 lb (+ 25 %) → des reps d'abord
    reset({ unit: 'lbs' });
    ex = seed('Élévations latérales', [set(9.072, 15), set(9.072, 14)]);
    assert.equal(goal(ex).gain, '1 rep');
    assert.equal(goal(ex).goal.r, 16);
  });
}
