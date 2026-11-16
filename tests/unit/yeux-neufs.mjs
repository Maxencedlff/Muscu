// ═══════════════════════════════════════════════════════════
//  Panel « yeux neufs » du 16/11/2026, vague 1 : corrections sans choix produit (séance d'un débutant,
//  objectif et cases, programme du coach, import Strong / Hevy, mots entiers, VoiceOver, « Comment faire »)
// ═══════════════════════════════════════════════════════════

export default function ({ test, run, reset, assert, sameJSON }) {
  const DAY = 86400000;
  const set = (weight, reps) => ({ weight, reps, done: true });
  // Séance simulée sur les vraies fonctions de js/features/session.js ; écran et stockage remplacés le temps du test
  function withSession(fn) {
    // Hors du navigateur : pas de routeur ni de verrou d'écran (startSession les appelle à la fin)
    run(`for (const k of ['routeTo', 'requestWakeLock', 'otaSessionChanged']) globalThis[k] ||= () => {};
      globalThis.__ynOrig = { render, persistSession, haptic, showToast, sp: globalThis.sessProg };
      render = () => {}; persistSession = () => {}; haptic = () => {};
      showToast = (msg, o) => { globalThis.lastToast = { msg, o }; };
      globalThis.sessProg = () => data.programmes[activeSession.programme];`);
    try { fn(); } finally {
      run(`render = __ynOrig.render; persistSession = __ynOrig.persistSession; haptic = __ynOrig.haptic; showToast = __ynOrig.showToast;
        globalThis.sessProg = __ynOrig.sp; activeSession = null;`);
    }
  }
  function seedRow(name, sets, extra = {}) {
    run(`data.activeProgramme = 'ppl';
      data.programmes.ppl.exercises.pull = [{ id: 'row', name: ${JSON.stringify(name)}, sets: 4, ...${JSON.stringify(extra)} }];
      data.history = ${sets ? `[{ id: 'h1', programme: 'ppl', category: 'pull', date: Date.now() - ${DAY}, duration: 3000000,
        exercises: [{ exId: 'row', name: ${JSON.stringify(name)}, sets: ${JSON.stringify(sets)} }] }]` : '[]'};`);
  }

  test('yeux neufs 1 : « Première fois » sous un exercice jamais fait, tant que rien n\'est validé', () => withSession(() => {
    reset();
    seedRow('Rowing barre', null);
    run(`startSession('pull')`);
    const ex = 'activeSession.exercises[0]';
    assert.match(run(`exFirstTimeHtml(${ex})`), /Première fois : prends un poids que tu soulèves 15 fois facilement/);
    // Une série validée : la ligne s'en va
    run(`${ex}.sets[0].weight = '40'; ${ex}.sets[0].reps = '10'; ${ex}.sets[0].done = true`);
    assert.equal(run(`exFirstTimeHtml(${ex})`), '', 'une série validée : plus de ligne');
    // Déjà fait : la colonne « Avant » sert de repère, pas de ligne
    seedRow('Rowing barre', [set('40', '10')]);
    run(`startSession('pull')`);
    assert.equal(run(`exFirstTimeHtml(${ex})`), '', 'déjà fait : pas de ligne');
    // Sans charge à choisir : poids du corps, durée
    for (const name of ['Pompes', 'Tractions pronation', 'Gainage']) {
      seedRow(name, null);
      run(`startSession('pull')`);
      assert.equal(run(`exFirstTimeHtml(${ex})`), '', `${name} : pas de poids à prendre`);
    }
  }));

  test('yeux neufs 2 : cases pré-remplies avec l\'objectif du jour, « Avant » garde la dernière fois', () => withSession(() => {
    reset();
    const ex = 'activeSession.exercises[0]';
    // Meilleure série + 1 rep : la série qui était la meilleure prend l'objectif, les autres gardent leurs reps
    seedRow('Rowing barre', [set('32', '9'), set('32', '9'), set('32', '8'), set('30', '10')]);
    run(`startSession('pull')`);
    assert.equal(run(`exerciseGoal('pull', data.programmes.ppl.exercises.pull[0]).text`), '32 kg × 10');
    sameJSON(run(`${ex}.sets.map(s => s.weight + '×' + s.reps)`), ['32×10', '32×9', '32×8', '30×10'], 'objectif sur la 1re série à 32 kg, le reste comme avant');
    sameJSON(run(`${ex}.sets.map(s => s.prev.reps)`), ['9', '9', '8', '10'], '« Avant » : la dernière fois');
    // Hausse de charge (toutes les séries en haut de fourchette) : posée d'office, au bas de la fourchette, sans puce
    seedRow('Rowing barre', [set('30', '12'), set('30', '12'), set('30', '12')], { sets: 3, repMin: 8, repMax: 12 });
    run(`startSession('pull')`);
    sameJSON(run(`exerciseGoal('pull', data.programmes.ppl.exercises.pull[0]).goal`), { w: 32.5, r: 8 });
    sameJSON(run(`${ex}.sets.map(s => s.weight + '×' + s.reps)`), ['32.5×8', '32.5×8', '32.5×8'], 'comme « Objectif 32,5 kg × 8 »');
    assert.equal(run(`bumpReady(${ex})`), false, 'hausse déjà posée : plus de puce');
    assert.equal(run(`${ex}.sets[1].plannedWeight`), '32.5', 'charge prévue : la série suivante n\'est pas « modifiée »');
    // Échauffement gardé à ses paliers
    run(`${ex}.sets.unshift({ weight: '15', reps: '8', warmup: true, done: false }); ${ex}.bumped = false; bumpExerciseLoad(${ex})`);
    assert.equal(run(`${ex}.sets[0].weight`), '15', 'échauffement inchangé');
    // Jamais fait : rien à pré-remplir
    seedRow('Rowing barre', null);
    run(`startSession('pull')`);
    sameJSON(run(`${ex}.sets.map(s => s.weight)`), ['', '', '', '']);
  }));

  test('yeux neufs 3 : programme du coach, sa prescription reprise et aucune hausse décidée par l\'app', () => withSession(() => {
    reset();
    const item = { id: 'u_force', sentAt: 1, data: { name: 'Force', sessions: [{ key: 'sB', label: 'Bas', color: '#34C759',
      exercises: [{ name: 'Squat barre', sets: 4, repMin: 3, repMax: 5, intens: 'topback' }] }] } };
    const id = run(`importCoachProgramme(data, ${JSON.stringify(item)}, { user_id: 'abcdefgh', username: 'max' })`);
    run(`data.activeProgramme = '${id}'; { const ex = data.programmes['${id}'].exercises.sB[0];
      data.history = [{ id: 'h-sq', programme: '${id}', category: 'sB', date: Date.now() - ${DAY}, duration: 1800000,
        exercises: [{ exId: ex.id, name: ex.name, sets: Array.from({ length: 4 }, () => ({ weight: '72.5', reps: '5', done: true })) }] }]; }`);
    assert.equal(run(`coachLedProgramme('${id}')`), true);
    const goal = run(`exerciseGoal('sB', data.programmes['${id}'].exercises.sB[0], '${id}')`);
    sameJSON(goal.goal, { w: 72.5, r: 5 }, 'haut de la fourchette atteint partout : pas de + 2,5 kg, pas de 6e rep');
    assert.equal(goal.gain, '');
    run(`startSession('sB')`);
    const ex = 'activeSession.exercises[0]';
    sameJSON(run(`${ex}.sets.map(s => s.weight + '×' + s.reps + ':' + s.tech)`), ['72.5×5:top', '65×5:backoff', '65×5:backoff', '65×5:backoff'],
      'top set à la charge de la dernière fois, back-off à − 10 % arrondi à la barre (backoffPrefill)');
    assert.equal(run(`repRangeText(${ex})`), '3–5 reps', 'fourchette du coach affichée');
    assert.equal(run(`bumpReady(${ex})`), false, 'pas de puce ↑ 2,5 kg');
    // Même historique sur un programme à soi : la hausse revient
    run(`delete data.userProgrammes['${id}'].fromCoach`);
    assert.equal(run(`exerciseGoal('sB', data.programmes['${id}'].exercises.sB[0], '${id}').gain`), '2,5 kg');
  }));
}
