// Supprimés récemment (js/data/trash.js et la purge de sanitizeData dans store.js)
export default function ({ test, app, run, reset, assert }) {
  const DAY = 86400000;
  // Objets du contexte : autre « realm », comparés après passage par JSON
  const val = code => JSON.parse(run(`JSON.stringify(${code})`));
  const seed = () => run(`
    data.history = [
      { id: 'a', date: Date.now() - 2 * ${DAY}, category: 'push', programme: 'ppl', exercises: [{ name: 'Développé couché', sets: [{ weight: '80', reps: '8' }] }] },
      { id: 'b', date: Date.now() - 5 * ${DAY}, category: 'push', programme: 'ppl', exercises: [{ name: 'Développé couché', sets: [{ weight: '75', reps: '8' }] }] },
    ];
    data.programmes.ppl.timers.push = data.history[0].date;`);

  test('corbeille : supprimer retire de l\'historique, restaurer remet à sa place et le délai', () => {
    reset(); seed();
    const recent = run('data.history[0].date');
    const gone = run('moveToTrash("a")');
    assert.equal(gone.id, 'a');
    assert.deepEqual(val('data.history.map(h => h.id)'), ['b']);
    assert.equal(run('data.trash.length'), 1);
    run('releaseTimer(data.trash[0].entry)');
    assert.notEqual(run('data.programmes.ppl.timers.push'), recent, 'le délai recule à la séance précédente');
    assert.equal(run('restoreFromTrash("a").id'), 'a');
    assert.deepEqual(val('data.history.map(h => h.id)'), ['a', 'b'], 'triée par date décroissante');
    assert.equal(run('data.trash.length'), 0);
    assert.equal(run('data.programmes.ppl.timers.push'), recent, 'le délai reprend la séance restaurée');
    assert.equal(run('moveToTrash("inconnue")'), null);
    assert.equal(run('restoreFromTrash("inconnue")'), null);
  });

  test('corbeille : effacer une séance, vider, jours restants', () => {
    reset(); seed();
    run('moveToTrash("a"); moveToTrash("b")');
    assert.equal(run('purgeFromTrash("a")'), true);
    assert.equal(run('purgeFromTrash("a")'), false);
    assert.equal(run('data.trash.length'), 1);
    run('emptyTrash()');
    assert.equal(run('data.trash.length'), 0);
    const now = Date.now();
    assert.equal(app.trashDaysLeft({ deletedAt: now }, now), 30);
    assert.equal(app.trashDaysLeft({ deletedAt: now - 29.5 * DAY }, now), 1);
    assert.equal(app.trashDaysLeft({ deletedAt: now - 40 * DAY }, now), 1, 'jamais 0 ni négatif à l\'affichage');
  });

  test('corbeille : purge à 30 jours, entrées invalides et doublons écartés au chargement', () => {
    reset(); seed();
    run(`data.trash = [
      { entry: { id: 'x', date: Date.now(), category: 'pull', exercises: [] }, deletedAt: Date.now() - 29 * ${DAY} },
      { entry: { id: 'y', date: Date.now(), category: 'pull', exercises: [] }, deletedAt: Date.now() - 31 * ${DAY} },
      { entry: { id: 'a', date: Date.now(), category: 'push', exercises: [] }, deletedAt: Date.now() },
      { entry: 'cassé', deletedAt: Date.now() },
      { entry: { id: 'z', date: Date.now(), category: 'pull', exercises: [] } },
      null,
    ]; sanitizeData(data);`);
    assert.deepEqual(val('data.trash.map(t => t.entry.id)'), ['x']);
    run('data.trash = "pas un tableau"; sanitizeData(data);');
    assert.deepEqual(val('data.trash.length'), 0);
  });

  test('corbeille : gardée par l\'export puis l\'import, absente des stats', () => {
    reset(); seed();
    run('moveToTrash("a")');
    const file = run('JSON.stringify(data)');
    run('data = makeDefaultData(); data.schema = SCHEMA;');
    assert.equal(run(`importText(${JSON.stringify(file)}).ok`), true);
    assert.deepEqual(val('data.trash.map(t => t.entry.id)'), ['a']);
    assert.deepEqual(val('data.history.map(h => h.id)'), ['b'], 'la séance en corbeille ne revient pas dans l\'historique');
  });

  test('programme supprimé : listé puis restauré, sans devenir actif', () => {
    reset();
    run(`data.userProgrammes = { u_a: { name: 'Bras', sessions: {}, archived: true }, u_b: { name: 'Jambes', sessions: {}, archived: false } };`);
    assert.deepEqual(val('archivedProgrammes().map(([id]) => id)'), ['u_a']);
    assert.equal(run('restoreProgramme("u_a")'), true);
    assert.equal(run('restoreProgramme("u_a")'), false, 'déjà restauré');
    assert.equal(run('restoreProgramme("u_inconnu")'), false);
    assert.equal(run('archivedProgrammes().length'), 0);
    assert.equal(run('data.activeProgramme'), 'ppl');
  });
}
