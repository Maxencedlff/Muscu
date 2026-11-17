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

  test('yeux neufs 2 (règle du 17/11) : cases pré-remplies avec la dernière fois, sans hausse d\'office', () => withSession(() => {
    reset();
    const ex = 'activeSession.exercises[0]';
    // Chaque série reprend sa dernière fois, charge et reps : aucune rep ajoutée (Maxence : « 24 × 12 » devenait « 24 × 13 »)
    seedRow('Rowing barre', [set('32', '9'), set('32', '9'), set('32', '8'), set('30', '10')]);
    run(`startSession('pull')`);
    sameJSON(run(`${ex}.sets.map(s => s.weight + '×' + s.reps)`), ['32×9', '32×9', '32×8', '30×10'], 'cases = « Avant »');
    sameJSON(run(`${ex}.sets.map(s => s.prev.weight + '×' + s.prev.reps)`), ['32×9', '32×9', '32×8', '30×10'], '« Avant » : la dernière fois');
    seedRow('Rowing haltère', [set('24', '12'), set('24', '10'), set('24', '9')], { sets: 3, repMin: 8, repMax: 10 });
    run(`startSession('pull')`);
    sameJSON(run(`${ex}.sets.map(s => s.weight + '×' + s.reps)`), ['24×12', '24×10', '24×9'], 'cas de la capture : 24 × 12 reste 24 × 12');
    // Toutes les séries en haut de fourchette : la charge n'est pas montée d'office, la puce ↑ le propose
    seedRow('Rowing barre', [set('30', '12'), set('30', '12'), set('30', '12')], { sets: 3, repMin: 8, repMax: 12 });
    run(`startSession('pull')`);
    sameJSON(run(`${ex}.sets.map(s => s.weight + '×' + s.reps)`), ['30×12', '30×12', '30×12'], 'pas de hausse de charge dans les cases');
    assert.equal(run(`${ex}.bumped`), undefined);
    assert.equal(run(`bumpReady(${ex})`), true, 'la puce ↑ reste pour monter soi-même');
    // Touchée : + 2,5 kg au bas de la fourchette, échauffement gardé à ses paliers
    run(`${ex}.sets.unshift({ weight: '15', reps: '8', warmup: true, done: false }); bumpExerciseLoad(${ex})`);
    sameJSON(run(`${ex}.sets.map(s => s.weight + '×' + s.reps)`), ['15×8', '32.5×8', '32.5×8', '32.5×8'], 'puce touchée');
    // Jamais fait : rien à pré-remplir (aide « Première fois »)
    seedRow('Rowing barre', null);
    run(`startSession('pull')`);
    sameJSON(run(`${ex}.sets.map(s => s.weight)`), ['', '', '', '']);
    assert.match(run(`exFirstTimeHtml(${ex})`), /Première fois/);
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
