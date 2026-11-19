// ═══════════════════════════════════════════════════════════
//  Reps fixes (« 4 × 12 », demande des coachs partenaires, vague 4) : lecture (fixedReps), progression
//  (exerciseGoal, goalRepsAfterBump, puce de la séance), affichage (« 4 × 12 », VoiceOver), stockage,
//  envoi du coach et compatibilité des programmes et des applis d'avant repFixed
// ═══════════════════════════════════════════════════════════

export default function ({ test, run, reset, assert, sameJSON }) {
  const DAY = 86400000, NB = ' ';
  const set = (weight, reps) => ({ weight, reps, done: true });
  function seedRow(sets, extra = {}) {
    run(`data.activeProgramme = 'ppl';
      data.programmes.ppl.exercises.pull = [{ id: 'row', name: 'Rowing', sets: 4, ...${JSON.stringify(extra)} }];
      data.history = [{ id: 'h1', programme: 'ppl', category: 'pull', date: Date.now() - ${DAY}, duration: 3000000,
        exercises: [{ exId: 'row', name: 'Rowing', sets: ${JSON.stringify(sets)} }] }];`);
    return 'data.programmes.ppl.exercises.pull[0]';
  }

  test('reps fixes : lecture du réglage, ancien format compris', () => {
    const f = ex => run(`fixedReps(${JSON.stringify(ex)})`);
    assert.equal(f({ repFixed: true, repMax: 12 }), 12, '12 fixes : enfin distinct du 12 par défaut');
    assert.equal(f({ repFixed: true, repMax: 5 }), 5);
    assert.equal(f({ repFixed: true }), 12, 'nombre absent : 12');
    assert.equal(f({ repMax: 12 }), null, '12 par défaut sans repFixed : fourchette, comme avant');
    assert.equal(f({}), null);
    assert.equal(f({ repMax: 5 }), 5, 'ancien format (haut seul hors 12) : reps fixes, comme avant');
    assert.equal(f({ repMin: 8, repMax: 12 }), null, 'fourchette');
    assert.equal(f({ repMin: 8, repMax: 12, repFixed: true }), null, 'un bas l\'emporte (jamais les deux)');
    assert.equal(f(null), null);
  });

  test('reps fixes : objectif et progression (4 × 12)', () => {
    reset();
    const fx = { repFixed: true, repMax: 12 };
    // Pas encore 12 partout : meilleure série + 1 rep, jamais au-delà de 12
    let ex = seedRow([set('30', '11'), set('30', '10'), set('30', '10'), set('30', '9')], fx);
    sameJSON(run(`exerciseGoal('pull', ${ex})`), { text: '30 kg × 12', gain: '1 rep', before: '30 kg × 11', goal: { w: 30, r: 12 } });
    ex = seedRow([set('30', '13'), set('30', '11'), set('30', '10'), set('30', '10')], fx);
    sameJSON(run(`exerciseGoal('pull', ${ex}).goal`), { w: 30, r: 12 }, 'série au-dessus de 12 : on vise 12 sur toutes, pas 14');
    // Toutes les séries à 12 : charge + 2,5 kg, toujours 12 reps (pas le bas d'une fourchette)
    ex = seedRow([set('30', '12'), set('30', '12'), set('30', '12'), set('30', '12')], fx);
    sameJSON(run(`exerciseGoal('pull', ${ex})`), { text: '32,5 kg × 12', gain: '2,5 kg', before: '30 kg × 12', goal: { w: 32.5, r: 12 } });
    assert.equal(run(`goalRepsAfterBump(${JSON.stringify(fx)})`), 12);
    // Même historique en fourchette par défaut (12 sans repFixed) : retour à 8, comme avant
    ex = seedRow([set('30', '12'), set('30', '12'), set('30', '12'), set('30', '12')], { repMax: 12 });
    sameJSON(run(`exerciseGoal('pull', ${ex}).goal`), { w: 32.5, r: 8 }, 'fourchette inchangée');
    // En livres : + 5 lb
    reset({ unit: 'lbs' });
    ex = seedRow([set('30', '12'), set('30', '12')], { ...fx, sets: 2 });
    assert.equal(run(`exerciseGoal('pull', ${ex}).gain`), '5 lb');
    // Jamais fait : « 4 × 12 » prévu (accueil, « Au programme »)
    reset();
    ex = seedRow([], fx);
    run('data.history = []');
    assert.equal(run(`exerciseGoal('pull', ${ex}).text`), `4${NB}×${NB}12`);
  });

  test('reps fixes : affichage « 4 × 12 », insécable, et sa forme parlée', () => {
    const fx = { name: 'Rowing', sets: 4, repFixed: true, repMax: 12 };
    assert.equal(run(`setsRepsText(${JSON.stringify(fx)})`), `4${NB}×${NB}12`);
    assert.equal(run(`setsRepsSpoken(${JSON.stringify(fx)})`), '4 séries de 12 reps');
    assert.equal(run(`setsRepsSpoken(${JSON.stringify({ ...fx, sets: 1, repMax: 1 })})`), '1 série de 1 rep');
    const html = run(`setsRepsHtml(${JSON.stringify(fx)})`);
    assert.equal(html, `<span aria-hidden="true">4${NB}×${NB}12</span><span class="visually-hidden">4 séries de 12 reps</span>`);
    assert.equal(run(`setsRepsText(${JSON.stringify({ name: 'Rowing', sets: 4, repMax: 12 })})`), '4 séries', 'fourchette : « 4 séries »');
    assert.equal(run(`setsRepsHtml(${JSON.stringify({ name: 'Rowing', sets: 4, repMax: 12 })})`), '4 séries');
    assert.equal(run(`setsRepsText(${JSON.stringify({ ...fx, name: 'Gainage', measure: 'time' })})`), '4 séries', 'hors répétitions : pas de reps');
    // Partage du programme par message
    reset();
    run(`Object.assign(data.programmes.ppl.exercises.push[0], { sets: 4, repFixed: true, repMax: 12 }); delete data.programmes.ppl.exercises.push[0].repMin;`);
    assert.match(run(`programmeShareText(programmeSharePayload('ppl'))`), new RegExp(`• Développé couché haltères : 4${NB}×${NB}12`));
  });

  test('reps fixes : séance (reps reprises, puce, toast, ligne de l\'exercice)', () => {
    reset();
    run(`globalThis.__o = { render, persistSession, haptic, showToast, sp: globalThis.sessProg };
      render = () => {}; persistSession = () => {}; haptic = () => {};
      showToast = msg => { globalThis.lastToast = msg; };
      globalThis.sessProg = () => data.programmes[activeSession.programme];`);
    try {
      const ex = seedRow(['13', '12', '12', '12'].map(r => set('30', r)), { repFixed: true, repMax: 12 });
      run(`activeSession = { category: 'pull', programme: 'ppl', startedAt: 1,
        exercises: [{ exId: 'row', name: 'Rowing', measure: 'reps', sets: buildSets('ppl', 'pull', ${ex}, 4, ${ex}) }] }`);
      sameJSON(run('activeSession.exercises[0].sets.map(s => s.reps)'), ['12', '12', '12', '12'], 'reps d\'avant ramenées à 12');
      assert.equal(run('repRangeText(activeSession.exercises[0])'), `4${NB}×${NB}12`);
      assert.match(run('repRangeHtml(activeSession.exercises[0])'), /visually-hidden">4 séries de 12 reps/);
      assert.equal(run('bumpReady(activeSession.exercises[0])'), true);
      run(`actionHandlers.get('bump-weight')(null, { dataset: { ei: '0' } })`);
      sameJSON(run('activeSession.exercises[0].sets.map(s => s.weight + "×" + s.reps)'), Array(4).fill('32.5×12'));
      assert.equal(run('lastToast'), 'Charge augmentée de 2,5 kg, toujours 12 reps');
      // Une série sous 12 la dernière fois : pas de puce
      const ex2 = seedRow(['12', '12', '11', '12'].map(r => set('30', r)), { repFixed: true, repMax: 12 });
      run(`activeSession.exercises[0].bumped = false; activeSession.exercises[0].sets = buildSets('ppl', 'pull', ${ex2}, 4, ${ex2})`);
      assert.equal(run('bumpReady(activeSession.exercises[0])'), false);
    } finally {
      run(`render = __o.render; persistSession = __o.persistSession; haptic = __o.haptic; showToast = __o.showToast;
        globalThis.sessProg = __o.sp; activeSession = null;`);
    }
  });

  test('reps fixes : stockage et envoi du coach, programmes et applis d\'avant', () => {
    const clean = ex => run(`(() => { const d = { programmes: { ppl: { exercises: { push: [${JSON.stringify(ex)}] } } } }; sanitizeData(d); return d.programmes.ppl.exercises.push[0]; })()`);
    assert.equal(clean({ id: 'a', name: 'DC', sets: 4, repMax: 12, repFixed: true }).repFixed, true);
    assert.equal(clean({ id: 'a', name: 'DC', sets: 4, repMax: 12, repFixed: 'oui' }).repFixed, undefined, 'true ou rien');
    assert.equal(clean({ id: 'a', name: 'DC', sets: 4, repMin: 8, repMax: 12, repFixed: true }).repFixed, undefined, 'jamais avec un bas');
    sameJSON(clean({ id: 'a', name: 'DC', sets: 4, repMax: 12 }), { id: 'a', name: 'DC', sets: 4, repMax: 12 }, 'programme existant intact');
    // Envoi : repFixed passe, l'aller-retour est sans perte ; jamais avec un bas
    reset();
    run(`data.userProgrammes.u_f = { name: 'Force', archived: false, sessions: { sA: { label: 'Haut', icon: '', desc: '', color: '#FF9500' } } };
      data.programmes.u_f = { timers: {}, cooldowns: {}, exercises: { sA: [
        { id: 'e1', name: 'Développé couché', sets: 4, repMax: 12, repFixed: true },
        { id: 'e2', name: 'Rowing', sets: 3, repMin: 8, repMax: 12 }] } };
      data.myProgrammes.push('u_f');`);
    const p = run(`programmeToSent(data, 'u_f')`);
    sameJSON(p.sessions[0].exercises[0], { name: 'Développé couché', sets: 4, repMax: 12, repFixed: true });
    sameJSON(run(`cleanSentProgramme(programmeToSent(data, 'u_f'))`), p, 'aller-retour sans perte');
    const bad = run(`cleanSentProgramme({ name: 'X', sessions: [{ key: 'a', label: 'A', exercises: [{ name: 'DC', sets: 3, repMin: 8, repMax: 12, repFixed: true }, { name: 'R', sets: 3, repFixed: 1 }] }] })`);
    assert.equal(bad.sessions[0].exercises[0].repFixed, undefined);
    assert.equal(bad.sessions[0].exercises[1].repFixed, undefined);
    // Empreinte d'un programme sans repFixed : inchangée (pas de « modifié par l'élève » après la mise à jour)
    const oldHash = run(`syncHash(cleanSentProgramme({ name: 'F', sessions: [{ key: 'a', label: 'A', color: '#FF9500', exercises: [{ name: 'DC', sets: 3, repMax: 5 }] }] }))`);
    assert.equal(run(`syncHash(cleanSentProgramme(JSON.parse(JSON.stringify({ name: 'F', sessions: [{ key: 'a', label: 'A', color: '#FF9500', exercises: [{ name: 'DC', sets: 3, repMax: 5 }] }] }))))`), oldHash);
    // Import chez l'élève : repFixed posé, puis retiré si le coach repasse en fourchette
    const item = data => ({ id: 'p1', sentAt: 1, data });
    const sent = fixed => ({ name: 'Force', sessions: [{ key: 'sA', label: 'Haut', color: '#FF9500', exercises: [fixed
      ? { name: 'Développé couché', sets: 4, repMax: 12, repFixed: true } : { name: 'Développé couché', sets: 4, repMin: 8, repMax: 12 }] }] });
    const id = run(`importCoachProgramme(data, ${JSON.stringify(item(sent(true)))}, { user_id: 'c1', username: 'coach' })`);
    const exOf = () => run(`data.programmes[${JSON.stringify(id)}].exercises.sA[0]`);
    assert.equal(exOf().repFixed, true);
    assert.equal(run(`fixedReps(data.programmes[${JSON.stringify(id)}].exercises.sA[0])`), 12);
    run(`importCoachProgramme(data, ${JSON.stringify({ ...item(sent(false)), sentAt: 2 })}, { user_id: 'c1', username: 'coach' })`);
    assert.equal(exOf().repFixed, undefined);
    assert.equal(exOf().repMin, 8);
    // Appli d'avant repFixed (son nettoyage ne garde pas le champ) : elle lit le seul haut, 12, et monte
    // la charge quand toutes les séries l'atteignent ; seul l'objectif après la hausse diffère (8 au lieu de 12)
    const legacy = { name: 'Rowing', sets: 4, repMax: 12 };
    seedRow(['12', '12', '12', '12'].map(r => set('30', r)), legacy);
    assert.equal(run(`exerciseGoal('pull', data.programmes.ppl.exercises.pull[0]).goal.w`), 32.5);
  });
}
