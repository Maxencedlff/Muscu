// « Comment faire » (js/data/exercise-howto.js) : une consigne par exercice de la bibliothèque, au bon format
export default function ({ test, run, reset, assert }) {
  test('comment faire : chaque exercice de la bibliothèque a ses consignes', () => {
    reset();
    const missing = run('catalogueNames()').filter(n => !run(`exerciseHowTo(${JSON.stringify(n)})`));
    assert.equal(missing.length, 0, `sans consignes dans exercise-howto.js : ${missing.join(', ')}`);
    run('Object.keys(EXERCISE_HOWTO)').forEach(n =>
      assert.equal(run(`catalogueEntry(${JSON.stringify(n)})?.name`), n, `${n} : absent de la bibliothèque`));
    const progNames = run(`[...new Set(Object.values(PROGRAMMES).flatMap(p => Object.values(p.defaults).flatMap(l => l.map(([n]) => n))))]`);
    progNames.forEach(n => assert.ok(run(`exerciseHowTo(${JSON.stringify(n)})`), `${n} : pas de consignes`));
    assert.ok(run(`exerciseHowTo('Pull-ups')`), 'par alias');
    assert.equal(run(`exerciseHowTo('Mon exercice inventé')`), null);
  });

  test('comment faire : format des consignes (3 à 5 phrases courtes, erreur fréquente)', () => {
    reset();
    const isLine = s => typeof s === 'string' && s === s.trim() && s.length >= 8 && s.length <= 100
      && /^[A-ZÀ-Ý0-9]/.test(s) && !/[.!;:,]$/.test(s) && !/\s{2}/.test(s);
    run('Object.entries(EXERCISE_HOWTO)').forEach(([n, h]) => {
      assert.ok(Array.isArray(h) && h.length === 2 && Array.isArray(h[0]), `${n} : [consignes, erreur]`);
      const [cues, mistake] = h;
      assert.ok(cues.length >= 3 && cues.length <= 5, `${n} : ${cues.length} consignes`);
      [...cues, mistake].forEach(s => assert.ok(isLine(s), `${n} : « ${s} »`));
      assert.equal(new Set(cues).size, cues.length, `${n} : consigne en double`);
    });
    run('Object.keys(EXERCISE_MOVES)').forEach(n => assert.equal(run(`catalogueEntry(${JSON.stringify(n)})?.name`), n));
    assert.equal(run(`exerciseMove('Pompes')`), null, 'mannequin en bâtons retiré');
  });
}
