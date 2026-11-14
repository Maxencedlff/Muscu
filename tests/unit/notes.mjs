// Notes d'exercice, de série et de séance (js/data/notes.js) : nettoyage, stockage, dernière note par exercice
// (fiche de la bibliothèque, alias), note de la dernière fois, synchro, coach et abonnés
export default function ({ test, run, reset, assert, sameJSON }) {
  const H = list => JSON.stringify(list);
  const entry = (id, date, exercises, extra = {}) => ({ id, programme: 'ppl', category: 'legs', date, notes: '', exercises, ...extra });

  test('notes : une ligne bornée à 140 caractères, null si vide ou pas un texte', () => {
    reset();
    assert.equal(run(`cleanNote('  siège   cran 4 ')`), 'siège cran 4');
    assert.equal(run(`cleanNote('prise\\nserrée\\tlente')`), 'prise serrée lente', 'retours à la ligne et tabulations réduits');
    assert.equal(run(`cleanNote('a\\u2028b')`), 'a b');
    assert.equal(run(`cleanNote('x'.repeat(300))`).length, 140);
    assert.equal(run(`cleanNote(' '.repeat(5) + 'é'.repeat(200))`).length, 140);
    for (const v of ['""', '"   "', 'null', 'undefined', '42', '{}', '["a"]']) assert.equal(run(`cleanNote(${v})`), null, v);
  });

  test('notes : nettoyées dans l\'historique (exercice, série), séance gardée, champs inconnus d\'avant intacts', () => {
    reset();
    const h = run(`(() => { const h = ${JSON.stringify(entry('a', 1, [
      { name: 'Squat barre', note: '  siège cran 4  ', sets: [{ weight: '60', reps: '10', note: 'genou ok' }, { weight: '60', reps: '9', note: '' }] },
      { name: 'Presse à cuisses', note: { pas: 'un texte' }, sets: [{ weight: '120', reps: '10', note: 'y'.repeat(400) }] },
    ], { notes: 'Bonne séance' }))}; cleanHistoryEntry(h); return h; })()`);
    assert.equal(h.exercises[0].note, 'siège cran 4');
    assert.equal(h.exercises[0].sets[0].note, 'genou ok');
    assert.ok(!('note' in h.exercises[0].sets[1]), 'note vide retirée');
    assert.ok(!('note' in h.exercises[1]), 'note illisible retirée');
    assert.equal(h.exercises[1].sets[0].note.length, 140);
    assert.equal(h.notes, 'Bonne séance');
    const bad = run(`(() => { const h = ${JSON.stringify(entry('b', 1, [], { notes: 12 }))}; cleanHistoryEntry(h); return h; })()`);
    assert.ok(!('notes' in bad), 'note de séance qui n\'est pas un texte retirée');
    // Idempotent
    const again = run(`(() => { const h = ${JSON.stringify(entry('c', 1, [{ name: 'Dips', note: 'lesté', sets: [{ weight: '', reps: '8', note: 'ok' }] }]))}; cleanHistoryEntry(h); const a = JSON.stringify(h); cleanHistoryEntry(h); return a === JSON.stringify(h); })()`);
    assert.equal(again, true);
  });

  test('notes : dernière note d\'un exercice, la plus récente, toutes séances et programmes confondus', () => {
    reset();
    const hist = H([
      entry('old', 100, [{ name: 'Squat barre', note: 'siège cran 3', sets: [{ weight: '60', reps: '10' }] }]),
      entry('mid', 200, [{ name: 'Squat barre', sets: [{ weight: '60', reps: '10' }] }], { programme: 'u_abc', category: 'jour1' }),
      entry('new', 300, [{ name: 'Presse à cuisses', note: 'pieds hauts', sets: [] }, { name: 'squat BARRE', note: 'siège cran 4', sets: [] }]),
    ]);
    const last = run(`lastExerciseNote('Squat barre', ${hist})`);
    assert.equal(last.text, 'siège cran 4', 'casse et séance ignorées : la plus récente');
    assert.equal(last.hid, 'new');
    assert.equal(last.xi, 1);
    sameJSON(run(`exerciseNotes('Squat barre', ${hist}).map(n => n.text)`), ['siège cran 4', 'siège cran 3']);
    assert.equal(run(`exerciseNotes('Squat barre', ${hist}, 1).length`), 1);
    assert.equal(run(`lastExerciseNote('Soulevé de terre', ${hist})`), null, 'jamais noté : rien');
    // Une séance sans note n'efface pas la dernière note d'avant
    assert.equal(run(`lastExerciseNote('Squat barre', ${H([entry('n', 9, [{ name: 'Squat barre', sets: [] }]), entry('o', 1, [{ name: 'Squat barre', note: 'cran 2', sets: [] }])])})?.text`), 'cran 2');
  });

  test('notes : un alias et un ancien nom de la bibliothèque partagent les notes de la fiche', () => {
    reset();
    const hist = H([entry('a', 1, [{ name: 'Pec fly', note: 'siège cran 5', sets: [] }])]);
    assert.equal(run(`lastExerciseNote('Pec deck', ${hist})?.text`), 'siège cran 5', 'alias « Pec fly » → fiche « Pec deck »');
    assert.equal(run(`lastExerciseNote('butterfly', ${hist})?.text`), 'siège cran 5', 'autre alias de la même fiche');
    assert.equal(run(`lastExerciseNote('Pec deck inversé', ${hist})`), null, 'fiche voisine : notes à part');
    assert.equal(run(`noteKey('Extension triceps poulie')`), run(`noteKey('Extension triceps poulie haute')`), 'fiche renommée');
    assert.equal(run(`noteKey('Mon exo maison')`), 'mon exo maison', 'hors bibliothèque : le nom');
  });

  test('notes : index gardé tant que l\'historique ne change pas, relu après save()', () => {
    reset();
    run(`data.history = ${H([entry('a', 1, [{ name: 'Dips', note: 'lesté 10', sets: [{ weight: '', reps: '8' }] }])])};`);
    assert.equal(run(`lastExerciseNote('Dips')?.text`), 'lesté 10');
    assert.equal(run(`clearHistoryExerciseNote('a', 0)`), true);
    run('save()');
    assert.equal(run(`lastExerciseNote('Dips')`), null, 'effacée : plus de dernière note');
    assert.equal(run(`clearHistoryExerciseNote('a', 0)`), false, 'déjà effacée');
    assert.equal(run(`clearHistoryExerciseNote('inconnue', 0)`), false);
  });

  test('notes : note de séance de la dernière fois, même programme et même séance seulement', () => {
    reset();
    const hist = H([
      entry('l2', 300, [], { notes: '' }),
      entry('l1', 200, [], { notes: 'Finir par les mollets' }),
      entry('p1', 400, [], { category: 'push', notes: 'Épaule' }),
      entry('u1', 500, [], { programme: 'u_abc', notes: 'Autre programme' }),
    ]);
    assert.equal(run(`lastSessionNote('ppl', 'legs', ${hist})`), null, 'la dernière fois sans note : rien (une note plus ancienne ne remonte pas)');
    assert.equal(run(`lastSessionNote('ppl', 'legs', ${H([entry('l1', 200, [], { notes: '  Finir par les mollets ' })])})?.text`), 'Finir par les mollets');
    assert.equal(run(`lastSessionNote('ppl', 'push', ${hist})?.text`), 'Épaule');
    assert.equal(run(`lastSessionNote('u_abc', 'legs', ${hist})?.hid`), 'u1');
    assert.equal(run(`lastSessionNote('ppl', 'pull', ${hist})`), null);
    // Entrée venue de ppl_v1 (sans programme) : programme ppl
    assert.equal(run(`lastSessionNote('ppl', 'legs', ${H([{ id: 'v1', category: 'legs', date: 1, notes: 'v1', exercises: [] }])})?.text`), 'v1');
  });

  test('notes : notes de série nommées comme en séance (échauffements à part)', () => {
    reset();
    const ex = { name: 'Squat barre', sets: [{ weight: '20', reps: '8', warmup: true, note: 'barre seule' }, { weight: '60', reps: '10' }, { weight: '60', reps: '9', note: 'genou' }] };
    sameJSON(run(`setNotesOf(${JSON.stringify(ex)})`), [{ si: 0, text: 'barre seule', label: 'Échauffement 1' }, { si: 2, text: 'genou', label: 'Série 2' }]);
  });

  test('notes : enregistrées avec la séance terminée, synchronisées, jamais montrées aux abonnés', () => {
    reset();
    run(`activeSession = { category: 'legs', programme: 'ppl', startedAt: Date.now() - 60000, exercises: [
      { exId: 'g1', name: 'Squat barre', note: 'siège cran 4', sets: [{ weight: '60', reps: '10', done: true, note: 'genou ok' }, { weight: '60', reps: '9', done: false, note: 'pas faite' }] },
      { exId: 'g2', name: 'Presse à cuisses', note: 'sans série faite', sets: [{ weight: '120', reps: '10', done: false }] }] };`);
    const e = run(`sessionHistoryEntry('ppl', 'legs')`);
    assert.equal(e.exercises.length, 1, 'exercice sans série faite écarté (sa note avec)');
    assert.equal(e.exercises[0].note, 'siège cran 4');
    sameJSON(e.exercises[0].sets.map(s => s.note ?? null), ['genou ok']);
    run('activeSession = null;');
    // Synchro : la séance part entière ; un abonné ne reçoit jamais les notes, le coach les lit si le serveur les transmet
    const payload = run(`sessionPayload(${JSON.stringify({ ...entry('s', 1, [{ name: 'Squat barre', note: 'siège cran 4', sets: [{ weight: '60', reps: '10', note: 'genou' }] }]), notes: 'ok' })})`);
    assert.equal(payload.exercises[0].note, 'siège cran 4');
    assert.equal(payload.exercises[0].sets[0].note, 'genou');
    const pub = run(`cleanPublicSession(${JSON.stringify(payload)})`);
    assert.ok(!('note' in pub.exercises[0]) && !('note' in pub.exercises[0].sets[0]) && !('notes' in pub), 'abonné : aucune note');
    const co = run(`cleanCoachSession(${JSON.stringify({ ...payload, exercises: [{ name: '', sets: [] }, ...payload.exercises] })})`);
    assert.equal(co.notes, 'ok');
    assert.equal(co.exercises[0].note, 'siège cran 4', 'coach : note d\'exercice (alignée malgré un exercice écarté)');
    assert.equal(co.exercises[0].sets[0].note, 'genou');
    const coLong = run(`cleanCoachSession({ exercises: [{ name: 'Dips', note: 'z'.repeat(999), sets: [{ reps: '8', note: 5 }] }] })`);
    assert.equal(coLong.exercises[0].note.length, 140);
    assert.ok(!('note' in coLong.exercises[0].sets[0]));
  });
}
