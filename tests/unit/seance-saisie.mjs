// Saisie en séance (regard neuf du 16/11) : charge et reps recopiées dans les séries suivantes vides, séance allégée
// au niveau « Je débute » (Reps en réserve et ligne Record), « kg par haltère ». Logique : js/features/session.js,
// js/data/rir.js, js/data/accessors.js, js/data/plates.js
export default function ({ test, run, reset, assert, sameJSON }) {
  const cells = () => run(`activeSession.exercises[0].sets.map(s => (s.weight ?? '') + '×' + (s.reps ?? ''))`);
  const setW = (si, w) => run(`{ const ex = activeSession.exercises[0]; ex.sets[${si}].weight = '${w}'; fillFollowingSets(ex, ${si}, 'weight'); }`);
  const setR = (si, r) => run(`{ const ex = activeSession.exercises[0]; ex.sets[${si}].reps = '${r}'; fillFollowingSets(ex, ${si}, 'reps'); }`);
  const session = sets => run(`activeSession = { exercises: [{ name: 'Soulevé de terre', sets: ${JSON.stringify(sets)} }] }`);
  const empty = { weight: '', reps: '', plannedWeight: '', prev: null, done: false };

  test('saisie : la charge tapée remplit les séries de travail suivantes vides et suit la frappe', () => {
    reset();
    session([{ ...empty }, { ...empty }, { ...empty }]);
    setW(0, '1'); setW(0, '10'); setW(0, '100');
    sameJSON(cells(), ['100×', '100×', '100×'], '« 1 », « 10 », « 100 » : les cases recopiées suivent');
    setR(0, '5');
    sameJSON(cells(), ['100×5', '100×5', '100×5'], 'reps vides : recopiées aussi');
    // Tapée à la main sur la série 2 : n'est plus une copie, la série 3 suit la 2
    setW(1, '90');
    setW(0, '110');
    sameJSON(cells(), ['110×5', '90×5', '90×5'], 'une case tapée à la main n\'est jamais écrasée');
    setW(0, '');
    sameJSON(cells(), ['×5', '90×5', '90×5'], 'source effacée : seules ses copies suivent (aucune ici)');
    run(`activeSession = null`);
  });

  test('saisie : jamais une valeur déjà là, ni l\'échauffement, ni une série faite, ni un back-off, ni une charge prescrite', () => {
    reset();
    session([{ ...empty, warmup: true }, { ...empty }, { ...empty, weight: '80', reps: '8' }, { ...empty, done: true }, { ...empty }]);
    setW(0, '40');
    sameJSON(cells(), ['40×', '×', '80×8', '×', '×'], 'échauffement : ne transmet rien');
    setW(1, '100');
    sameJSON(cells(), ['40×', '100×', '80×8', '×', '100×'], 'valeur déjà là et série faite gardées, la suivante vide remplie');
    session([{ ...empty }, { ...empty, warmup: true }, { ...empty }]);
    setW(0, '60');
    sameJSON(cells(), ['60×', '×', '60×'], 'un échauffement plus bas n\'est jamais rempli');
    session([{ ...empty, tech: 'top' }, { ...empty, tech: 'backoff' }, { ...empty, tech: 'backoff' }]);
    setW(0, '100');
    sameJSON(cells(), ['100×', '×', '×'], 'back-off : sa charge allégée vient du top set, pas d\'une copie');
    session([{ ...empty, pk: '60' }, { ...empty }]);
    setW(0, '62.5');
    sameJSON(cells(), ['62.5×', '×'], 'prescription du coach différente : rien');
    session([{ ...empty, done: true, weight: '70' }, { ...empty }]);
    assert.equal(run(`fillFollowingSets(activeSession.exercises[0], 0, 'weight').length`), 0, 'série validée : pas de source (rouverte, elle a sa feuille)');
    run(`activeSession = { exercises: [{ name: 'Rameur', measure: 'cardio', sets: [{ ...${JSON.stringify(empty)}, weight: '5' }, ${JSON.stringify(empty)}] }] }`);
    assert.equal(run(`fillFollowingSets(activeSession.exercises[0], 0, 'weight').length`), 0, 'cardio : rien');
    run(`activeSession = null`);
  });

  test('saisie : capture 37 du regard neuf, charge posée par « Disques » puis ✓ : séries 2 et 3 à la même charge', () => {
    reset();
    run(`for (const k of ['routeTo', 'requestWakeLock', 'otaSessionChanged']) globalThis[k] ||= () => {};
      globalThis.__sv = { render, persistSession, haptic, showToast, refreshPlatesSheet };
      render = () => {}; persistSession = () => {}; haptic = () => {}; showToast = () => {}; refreshPlatesSheet = () => {};`);
    try {
      session([{ ...empty }, { ...empty }, { ...empty }]);
      run(`pl = { ei: 0, si: 0, target: 100 }; actionHandlers.get('pl-apply')()`);
      sameJSON(cells(), ['100×', '100×', '100×'], 'disques appliqués : comme une charge tapée');
    } finally {
      run(`render = __sv.render; persistSession = __sv.persistSession; haptic = __sv.haptic; showToast = __sv.showToast;
        refreshPlatesSheet = __sv.refreshPlatesSheet; pl = null; activeSession = null;`);
    }
  });

  test('débutant : Reps en réserve et ligne Record cachés en automatique, réglages explicites gardés', () => {
    reset();
    run(`data = sanitizeData(freshData()); data.level = 'debutant';
      data.history = [{ id: 's1', programme: 'ppl', category: 'push', date: Date.now(), exercises: [{ name: 'Squat', sets: [{ weight: '60', reps: '8', rir: 2 }] }] }];`);
    assert.equal(run('rirShown()'), false, 'débutant : coupé même avec un historique noté');
    assert.equal(run('headRecordShown()'), false, 'débutant : ligne Record cachée');
    run(`data.level = 'confirme'; data.history = data.history.slice();`);
    assert.equal(run('rirShown()'), true, 'confirmé : l\'automatique d\'avant');
    assert.equal(run('headRecordShown()'), true);
    run(`data.level = 'debutant'; data.rirOn = true; data.recordOn = true;`);
    assert.equal(run('rirShown()'), true, 'rallumé dans Réglages');
    assert.equal(run('headRecordShown()'), true);
    run(`data.level = null; data.recordOn = false;`);
    assert.equal(run('headRecordShown()'), false, 'coupé à la main');
    assert.equal(run(`'recordOn' in normalizeData({ history: [], recordOn: 'x' })`), false, 'valeur inconnue : automatique');
    assert.equal(run(`normalizeData({ history: [], recordOn: false }).recordOn`), false);
    assert.ok(run(`SYNC_LOCAL_ONLY.includes('recordOn')`), 'préférence d\'affichage de l\'appareil');
    // Carte de séance : plus de « Record 100 × 5 » sous le nom
    run(`data.level = 'debutant'; delete data.recordOn; data.programmes.ppl.exercises.push[0].pr = { weight: '100', reps: '5' };
      activeSession = { programme: 'ppl', category: 'push', exercises: [{ exId: data.programmes.ppl.exercises.push[0].id, name: data.programmes.ppl.exercises.push[0].name, sets: [{ weight: '', reps: '', done: false }] }] };`);
    assert.doesNotMatch(run(`exSubHtml(activeSession.exercises[0], 0, false)`), /Record/);
    run(`data.recordOn = true;`);
    assert.match(run(`exSubHtml(activeSession.exercises[0], 0, false)`), /Record 100 × 5/);
    run(`activeSession = null`);
  });

  test('haltères : « kg par haltère » en en-tête et pour VoiceOver, pas sur une barre ni une poulie', () => {
    reset();
    const db = n => run(`isDumbbellExercise({ name: ${JSON.stringify(n)} })`);
    for (const n of ['Développé couché haltères', 'Curl marteau', 'Élévations latérales', 'Rowing haltère unilatéral', 'dumbbell press']) assert.equal(db(n), true, n);
    for (const n of ['Squat barre', 'Développé couché barre', 'Extension triceps poulie', 'Tractions pronation']) assert.equal(db(n), false, n);
    assert.match(run(`loadHeader({ name: 'Développé couché haltères' })`), /kg<small>par haltère<\/small>/);
    assert.equal(run(`loadHeader({ name: 'Squat barre' })`), 'kg');
    assert.equal(run(`loadSpoken({ name: 'Développé couché haltères' })`), 'Charge par haltère');
    assert.equal(run(`loadSpoken({ name: 'Squat barre' })`), 'Charge');
    assert.equal(run(`loadHeader({ name: 'Développé couché haltères' }, false)`), 'kg', 'superset mêlé : kg seul');
  });
}
