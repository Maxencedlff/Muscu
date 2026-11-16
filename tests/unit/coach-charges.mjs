// ═══════════════════════════════════════════════════════════
//  Charge prescrite par le coach (16/11/2026) : format envoyé, séance de l'élève pré-remplie, écart vu
//  par le coach ; et les trois défauts du panel sur la séance d'un élève de coach (reps dans la
//  fourchette, back-off allégé, étiquettes de technique). Logique : js/data/coach-presc.js
// ═══════════════════════════════════════════════════════════

export default function ({ test, run, reset, assert, sameJSON }) {
  const DAY = 86400000;
  const S = JSON.stringify;
  const done = (weight, reps) => ({ weight, reps, done: true });
  function withSession(fn) {
    run(`for (const k of ['routeTo', 'requestWakeLock', 'otaSessionChanged']) globalThis[k] ||= () => {};
      globalThis.__ccOrig = { render, persistSession, haptic, sp: globalThis.sessProg };
      render = () => {}; persistSession = () => {}; haptic = () => {};
      globalThis.sessProg = () => data.programmes[activeSession.programme];`);
    try { fn(); } finally {
      run(`render = __ccOrig.render; persistSession = __ccOrig.persistSession; haptic = __ccOrig.haptic;
        globalThis.sessProg = __ccOrig.sp; activeSession = null;`);
    }
  }
  // Programme reçu d'un coach (une séance, un exercice), puis une séance passée faite avec ses séries
  function coachProg(ex, lastSets = null) {
    const item = { id: 'force', sentAt: 1, data: { name: 'Force', sessions: [{ key: 'sB', label: 'Bas', color: '#34C759', exercises: [ex] }] } };
    const id = run(`importCoachProgramme(data, ${S(item)}, { user_id: 'abcdefgh', username: 'max' })`);
    run(`data.activeProgramme = '${id}'; { const ex = data.programmes['${id}'].exercises.sB[0];
      data.history = ${lastSets ? `[{ id: 'h-1', programme: '${id}', category: 'sB', date: Date.now() - ${DAY}, duration: 1800000,
        exercises: [{ exId: ex.id, name: ex.name, sets: ${S(lastSets)} }] }]` : '[]'}; }`);
    return id;
  }
  const ex = 'activeSession.exercises[0]';
  const cells = () => run(`${ex}.sets.map(s => s.weight + '×' + s.reps)`);

  test('Charge prescrite : format envoyé borné, champs facultatifs, rien sans charge', () => {
    reset();
    const clean = e => run(`cleanSentProgramme(${S({ name: 'P', sessions: [{ key: 'a', label: 'A', exercises: [{ name: 'Squat barre', sets: 3, ...e }] }] })}).sessions[0].exercises[0]`);
    sameJSON(clean({ load: 60 }), { name: 'Squat barre', sets: 3, load: 60 });
    sameJSON(clean({ load: '62,5', loads: [100, null, '90', 80] }), { name: 'Squat barre', sets: 3, load: 62.5, loads: [100, null, 90] }, 'une charge par série au plus');
    sameJSON(clean({ load: 600, loads: [-1, 'abc'] }), { name: 'Squat barre', sets: 3 }, 'hors bornes : écartées');
    sameJSON(clean({ loads: [null, null] }), { name: 'Squat barre', sets: 3 }, 'que des vides : rien');
    sameJSON(clean({}), { name: 'Squat barre', sets: 3 }, 'sans charge : comme avant');
    // Champ inconnu d'une version future (pourcentage de 1RM) : écarté sans rien casser
    sameJSON(clean({ load: 60, pct: 80 }), { name: 'Squat barre', sets: 3, load: 60 });
    // Programme local : mêmes bornes au chargement (sanitizeData)
    run(`data.programmes.ppl.exercises.push[0].load = 'x'; data.programmes.ppl.exercises.push[0].loads = [70, 9999]; sanitizeData(data)`);
    assert.equal(run(`data.programmes.ppl.exercises.push[0].load`), undefined);
    sameJSON(run(`data.programmes.ppl.exercises.push[0].loads`), [70]);
  });

  test('Charge prescrite : le coach prescrit pour un élève (programmeToSent), reps fixes ou fourchette', () => {
    reset();
    run(`data.programmes.ppl.exercises.push = [{ id: 'dc', name: 'Développé couché', sets: 3, repMin: 8, repMax: 12 }]`);
    const sent = over => run(`programmeToSent(data, 'ppl', ${S(over)}).sessions.find(s => s.key === 'push').exercises[0]`);
    const o = sent({ presc: { push: { dc: { load: 60, reps: { fixed: true, max: 8 } } } } });
    sameJSON([o.load, o.repMax, o.repFixed, o.repMin], [60, 8, true, undefined], '60 kg × 8');
    const r = sent({ presc: { push: { dc: { load: 90, loads: [100], reps: { fixed: false, min: 3, max: 5 } } } } });
    sameJSON([r.load, r.loads, r.repMin, r.repMax, r.repFixed], [90, [100], 3, 5, undefined], 'top set à 100, le reste à 90, 3 à 5');
    const none = sent({});
    sameJSON([none.load, none.loads, none.repMin, none.repMax], [undefined, undefined, 8, 12], 'rien de prescrit : le programme tel quel');
    // Mon programme n'est jamais touché : la prescription est propre à l'élève
    assert.equal(run(`data.programmes.ppl.exercises.push[0].load`), undefined);
  });

  test('Charge prescrite : l\'élève reçoit 60 kg × 8, cases pré-remplies, « Coach : 60 kg × 8 », « Avant » gardé', () => withSession(() => {
    reset();
    const id = coachProg({ name: 'Squat barre', sets: 3, repMax: 8, repFixed: true, load: 60 }, [done('57.5', '8'), done('57.5', '8'), done('57.5', '7')]);
    run(`startSession('sB')`);
    sameJSON(cells(), ['60×8', '60×8', '60×8']);
    sameJSON(run(`${ex}.sets.map(s => s.prev.weight + '×' + s.prev.reps)`), ['57.5×8', '57.5×8', '57.5×7'], '« Avant » : la dernière fois');
    assert.match(run(`exGoalHtml(${ex})`), /Coach : 60 kg × 8/);
    assert.match(run(`exGoalHtml(${ex})`), /Prescrit par ton coach : 60 kilos, 8 reps/, 'VoiceOver');
    assert.equal(run(`exerciseTarget('sB', data.programmes['${id}'].exercises.sB[0]).text`), '60 kg × 8', 'accueil : la même prescription');
    // L'élève fait 62,5 kg : rien ne l'en empêche, la série garde ce qu'il a fait
    run(`${ex}.sets[0].weight = '62.5'; ${ex}.sets[0].done = true; carryWeightToNextSet(${ex}, 0); ${ex}.sets[1].done = true; ${ex}.sets[2].reps = '7'; ${ex}.sets[2].done = true`);
    const entry = run(`sessionHistoryEntry('${id}', 'sB')`);
    sameJSON(entry.exercises[0].sets.map(s => s.weight), ['62.5', '62.5', '60'], 'charge changée reprise par la série suivante de même prescription (règle d\'avant)');
    sameJSON(entry.exercises[0].presc, { kg: [60, 60, 60], lo: 8, hi: 8 });
    // Le coach voit l'écart, sobrement
    assert.equal(run(`prescGapText(${S(entry.exercises[0])})`), 'Prescrit 60 kg × 8 · série 1 à 62,5 kg ; série 2 à 62,5 kg ; série 3 7 reps');
    // Fait comme prévu
    assert.equal(run(`prescGapText({ sets: [{ weight: '60', reps: '8' }], presc: { kg: [60], lo: 8, hi: 8 } })`), 'Prescrit 60 kg × 8 · fait comme prévu');
  }));

  test('Charge prescrite : fourchette avec top set et back-off, charges série par série', () => withSession(() => {
    reset();
    coachProg({ name: 'Squat barre', sets: 4, repMin: 3, repMax: 5, intens: 'topback', load: 90, loads: [100] },
      [done('100', '4'), done('100', '4'), done('100', '4'), done('100', '4')]);
    run(`startSession('sB')`);
    sameJSON(run(`${ex}.sets.map(s => s.weight + '×' + s.reps + ':' + s.tech)`), ['100×4:top', '90×3:backoff', '90×3:backoff', '90×3:backoff'],
      'même charge que la dernière fois : ses reps dans la fourchette ; autre charge : le bas');
    assert.match(run(`exGoalHtml(${ex})`), /Coach : 100 kg puis 90 kg × 3–5/);
    // Top set modifié : le back-off garde sa charge prescrite
    run(`${ex}.sets[0].weight = '105'; ${ex}.sets[0].done = true; carryWeightToNextSet(${ex}, 0)`);
    assert.equal(run(`${ex}.sets[1].weight`), '90');
  }));

  test('Rétrocompatibilité : programme du coach sans charge, séance comme avant, aucune trace de prescription', () => withSession(() => {
    reset();
    const id = coachProg({ name: 'Squat barre', sets: 3, repMin: 8, repMax: 12 }, [done('60', '10'), done('60', '10'), done('60', '9')]);
    run(`startSession('sB')`);
    assert.doesNotMatch(run(`exGoalHtml(${ex})`), /Coach/);
    assert.match(run(`exGoalHtml(${ex})`), /Objectif 60 kg × 11/);
    run(`${ex}.sets.forEach(s => { s.done = true; })`);
    assert.equal(run(`sessionHistoryEntry('${id}', 'sB')`).exercises[0].presc, undefined);
  }));

  test('Panel 16/11, défaut 1 : programme du coach en 3–5, les reps pré-remplies restent dans la fourchette', () => withSession(() => {
    reset();
    coachProg({ name: 'Squat barre', sets: 4, repMin: 3, repMax: 5 }, [done('72.5', '8'), done('72.5', '8'), done('72.5', '8'), done('72.5', '7')]);
    run(`startSession('sB')`);
    assert.match(run(`exGoalHtml(${ex})`), /Objectif 72,5 kg × 5/);
    sameJSON(cells(), ['72.5×5', '72.5×5', '72.5×5', '72.5×5'], 'collées à l\'objectif affiché, plus 8, 8, 8, 7');
    // Relevées au bas : 2 reps la dernière fois
    coachProg({ name: 'Squat barre', sets: 2, repMin: 3, repMax: 5 }, [done('80', '2'), done('80', '1')]);
    run(`startSession('sB')`);
    sameJSON(cells(), ['80×3', '80×3']);
  }));

  test('Panel 16/11, défaut 2 : back-off à − 10 % du top set (arrondi au matériel), sauf plus léger la dernière fois', () => withSession(() => {
    reset();
    const seed = (name, sets, prevTech) => run(`data.activeProgramme = 'ppl';
      data.programmes.ppl.exercises.push = [{ id: 'dc', name: ${S(name)}, sets: ${sets.length}, intens: 'topback' }];
      data.history = [{ id: 'h', programme: 'ppl', category: 'push', date: Date.now() - ${DAY}, duration: 1800000,
        exercises: [{ exId: 'dc', name: ${S(name)}, sets: ${S(sets.map((s, i) => ({ ...s, ...(prevTech ? { tech: i ? 'backoff' : 'top' } : {}) })))} }] }];`);
    seed('Développé couché', [done('80', '5'), done('80', '5'), done('80', '5')]);
    run(`startSession('push')`);
    sameJSON(run(`${ex}.sets.map(s => s.weight)`), ['80', '72.5', '72.5'], 'barre : 72 kg arrondi à 72,5 (disques de 1,25)');
    seed('Développé couché haltères', [done('30', '8'), done('30', '8')]);
    run(`startSession('push')`);
    sameJSON(run(`${ex}.sets.map(s => s.weight)`), ['30', '27.5'], 'haltères : pas de 2,5 kg');
    seed('Développé couché', [done('80', '5'), done('70', '8')], true);
    run(`startSession('push')`);
    sameJSON(run(`${ex}.sets.map(s => s.weight)`), ['80', '70'], 'back-off déjà plus léger la dernière fois : gardé');
    assert.equal(run(`${ex}.sets[1].plannedWeight`), '70');
  }));

  test('Coach : séance reçue du serveur, presc[] aligné sur les exercices (même un exercice écarté avant)', () => {
    reset();
    const s = run(`cleanCoachSession({ date: 1, label: 'Bas', exercises: [{ name: '' }, { name: 'Squat barre', sets: [{ weight: '62.5', reps: '8' }, { weight: '60', reps: '8' }] }],
      presc: [null, { kg: [60, 60], lo: 8, hi: 8 }] })`);
    sameJSON(s.exercises[0].presc, { kg: [60, 60], lo: 8, hi: 8 });
    const bad = run(`cleanCoachSession({ date: 1, label: 'Bas', exercises: [{ name: 'Squat barre', sets: [{ weight: '60', reps: '8' }] }], presc: [{ kg: [60, 60] }] })`);
    assert.equal(bad.exercises[0].presc, undefined, 'pas aligné sur les séries : ignoré');
    const old = run(`cleanCoachSession({ date: 1, label: 'Bas', exercises: [{ name: 'Squat barre', sets: [{ weight: '60', reps: '8' }] }] })`);
    assert.equal(old.exercises[0].presc, undefined, 'serveur d\'avant la migration : rien');
  });

  test('Coach : dernière fois de l\'élève reprise de ses séances chargées', () => {
    reset();
    const rows = [
      { doneAt: 1, s: { exercises: [{ name: 'Squat barre', sets: [{ weight: '50', reps: '8' }] }] } },
      { doneAt: 5, s: { exercises: [{ name: 'Squat barre', sets: [{ weight: '20', reps: '10', warmup: true }, { weight: '100', reps: '4' }, { weight: '90', reps: '5' }] }] } },
    ];
    sameJSON(run(`studentLastLoads(${S(rows)}, 'squat BARRE')`), { kg: [100, 90], reps: [4, 5], doneAt: 5 }, 'la plus récente, sans l\'échauffement');
    assert.equal(run(`studentLastLoads(${S(rows)}, 'Fentes')`), null);
  });
}
