// ═══════════════════════════════════════════════════════════
//  Séances et exercices de l'historique : programme, clés, volume (tempo : tempo.mjs)
// ═══════════════════════════════════════════════════════════

export default function ({ test, run, reset, assert, app, sameJSON }) {
  const DAY = 86400000;

  // ── Programme d'une séance ──

  test('entryProg : programme de la séance, « ppl » pour une séance d\'avant les programmes', () => {
    assert.equal(app.entryProg({ programme: 'u_abc' }), 'u_abc');
    assert.equal(app.entryProg({ programme: 'free' }), 'free');
    assert.equal(app.entryProg({}), 'ppl');
    assert.equal(app.entryProg({ programme: null }), 'ppl');
    assert.equal(app.entryProg({ programme: '' }), 'ppl');
  });

  test('buildSummary : ancienne séance sans programme, la séance précédente est retrouvée', () => {
    reset();
    const ex = w => ({ exId: 'bench', name: 'Développé couché', sets: [{ weight: w, reps: '8' }] });
    const now = Date.now();
    run(`data.history = ${JSON.stringify([
      { id: 'new', category: 'push', date: now - DAY, exercises: [ex('62.5')] },
      { id: 'old', category: 'push', date: now - 4 * DAY, exercises: [ex('60')] },
    ])}`);
    const s = run('buildSummary(data.history[0], {})');
    assert.equal(s.delta, 20, 'volume comparé à la séance précédente : (62,5 − 60) × 8');
    assert.equal(s.rows[0].trend, 'up');
  });

  // ── Clés d'exercice : figées, l'historique et les records en dépendent ──

  test('exKey, recordKey, nameKey : clés produites inchangées', () => {
    reset();
    assert.equal(app.nameKey('  Développé   Couché '), 'n:developpe couche');
    assert.equal(app.nameKey('Élévations latérales'), 'n:elevations laterales');
    // exKey : identifiant de l'historique (exId), sinon du programme (id), sinon le nom
    assert.equal(app.exKey({ exId: 'abc', id: 'zzz', name: 'X' }), 'abc');
    assert.equal(app.exKey({ id: 'p1', name: 'Développé couché' }), 'p1');
    assert.equal(app.exKey({ name: 'Rowing  Barre' }), 'n:rowing barre');
    assert.equal(app.exKey({ exId: 'n:rowing', name: 'Rowing' }), 'n:rowing');
    // recordKey : exId seulement (lignes de base des records), jamais l'id du programme
    assert.equal(app.recordKey({ exId: 'abc', id: 'zzz', name: 'X' }), 'abc');
    assert.equal(app.recordKey({ id: 'p1', name: 'Développé couché' }), 'n:developpe couche');
    assert.equal(app.recordKey({ name: 'Dips' }), 'n:dips');
    // Identifiant d'un exercice inconnu, dans un programme et en séance libre
    assert.equal(app.resolveExId('ppl', 'push', 'Curl  Marteau'), 'n:curl marteau');
    assert.equal(app.resolveExId('free', 'free', 'Curl Pupitre'), 'n:curl pupitre');
  });

  test('migration schéma 3 : exId d\'un exercice inconnu = clé de nom', () => {
    reset();
    const d = run(`(() => {
      const d = makeDefaultData(); d.schema = 2;
      d.history = [{ id: 'h', programme: 'ppl', category: 'push', date: 1, exercises: [{ name: "Pompes Diamant", sets: [{ weight: "", reps: "10" }] }] }];
      localStorage.setItem(KEY, JSON.stringify(d));
      return loadData();
    })()`);
    assert.equal(d.history[0].exercises[0].exId, 'n:pompes diamant');
  });

  test('exerciseIndex : regroupement par exId, id, puis nom', () => {
    reset();
    run(`data.history = ${JSON.stringify([
      { id: 'a', programme: 'ppl', category: 'push', date: 2, exercises: [{ exId: 'e1', name: 'Développé', sets: [{ weight: '50', reps: '8' }] }, { name: 'Curl Marteau', sets: [{ weight: '10', reps: '10' }] }] },
      { id: 'b', category: 'push', date: 1, exercises: [{ exId: 'e1', name: 'Développé couché', sets: [{ weight: '45', reps: '8' }] }] },
    ])}`);
    const keys = run('[...exerciseIndex().keys()].sort()');
    sameJSON(keys, ['e1', 'n:curl marteau']);
    assert.equal(run('exerciseIndex().get("e1").prog'), 'ppl', 'séance sans programme : ppl');
  });

  // ── Progrès : volume et 1RM au poids du corps ──

  test('exPoint au poids du corps : volume de exVolume, 1RM jusqu\'à 12 reps comme calc1RM', () => {
    reset();
    run('data.bodyWeightKg = 80;');
    const e = { exId: 't', name: 'Tractions', sets: [{ weight: '10', reps: '12' }, { weight: '10', reps: '11' }] };
    const h = { id: 'h', date: 1, bodyKg: 80, exercises: [e] };
    const p = app.exPoint(h, e);
    assert.equal(p.hasWeight, true);
    assert.equal(p.volume, app.exVolume(e, e.sets, 80), 'même volume que le reste de l\'app');
    const load = app.effectiveLoad(e.sets[0], e, 80);
    assert.equal(p.best1RM, app.calc1RM(load, 12), '12 reps : 1RM estimé, comme calc1RM');
    assert.equal(app.calc1RM(load, 13), null, 'au-delà de 12 reps : pas de 1RM');
  });
}
