// Séance libre (FREE) : libellés, rattachement des exercices, aucun effet sur les programmes
export default function ({ test, app, run, reset, assert }) {
  test('séance libre : libellés neutres, pas de « Programme PPL »', () => {
    reset();
    assert.equal(run('progMeta(FREE).name'), 'Séance libre');
    assert.equal(run('sessionMeta(FREE, FREE).label'), 'Séance libre');
    assert.equal(run('rawLabel(FREE, FREE)'), 'Séance libre');
    assert.equal(run('sessionKeys(FREE).length'), 0);
    assert.equal(run('"free" in PROGRAMMES'), false, 'FREE ne doit jamais devenir un vrai programme');
  });

  test('séance libre : un exercice connu reprend son identifiant (programme actif d\'abord)', () => {
    reset();
    const benchId = run(`(data.programmes.ppl.exercises.push.find(e => /couch/i.test(e.name)) || data.programmes.ppl.exercises.push[0]).id`);
    const benchName = run(`data.programmes.ppl.exercises.push.find(e => e.id === ${JSON.stringify(benchId)}).name`);
    assert.equal(run(`resolveExId(FREE, FREE, ${JSON.stringify(benchName.toUpperCase())})`), benchId);
    run(`data.history = [{ id: 'h', date: 1, programme: 'fullbody', category: 'a', exercises: [{ exId: 'zz9', name: 'Tirage poulie', sets: [] }] }]`);
    assert.equal(run(`resolveExId(FREE, FREE, 'tirage  poulie')`), 'zz9', 'retrouvé dans l\'historique');
    assert.equal(run(`resolveExId(FREE, FREE, 'Escalade')`), 'n:' + run(`normName('Escalade')`));
  });

  test('séance libre : supprimée puis restaurée sans créer de programme ni de délai', () => {
    reset();
    run(`data.history = [{ id: 'l', date: Date.now(), programme: FREE, category: FREE, exercises: [{ exId: 'n:x', name: 'X', sets: [{ weight: '', reps: '10' }] }] }];`);
    run('moveToTrash("l"); releaseTimer(data.trash[0].entry); restoreFromTrash("l"); recomputePRFromHistory(); sanitizeData(data);');
    assert.equal(run('data.history.length'), 1);
    assert.equal(run('FREE in data.programmes'), false);
  });
}
