// Partage avec le coach (js/data/coach-share.js) : ce qui part (pesées saisies seulement), quand (case cochée
// sur le serveur, pesées changées), nettoyage de ce que renvoie le serveur, et volume relu par le coach
// avec le poids de l'élève (js/data/session-review.js)
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const DAY = 86400000;
  // Faux serveur : RPC enregistrées dans __calls ; __answers[fn] donne la réponse (fonction ou valeur)
  const setup = () => run(`(() => {
    globalThis.__calls = [];
    globalThis.__answers = {};
    account.user = { id: 'u1' };
    coachShareReset('u1');
    coach.userId = 'u1';
    coach.state = cleanCoachState({ is_coach: false, coach: { user_id: 'c1', username: 'max', since: '2026-10-01' } });
    sb = { rpc: async (fn, args) => {
      __calls.push([fn, args === undefined ? null : JSON.parse(JSON.stringify(args))]);
      const a = __answers[fn];
      const v = typeof a === 'function' ? a(args) : a;
      return v && v.error ? { data: null, error: v.error } : { data: v ?? null, error: null };
    } };
  })()`);
  const teardown = () => run('sb = null; account.user = null; coach.state = null; coachShareReset(null); delete globalThis.__calls; delete globalThis.__answers;');
  // Seulement les appels du partage : un autre module peut lire le serveur au même moment (my_access du
  // payant, déclenché par un minuteur), ce n'est pas l'objet de ces tests
  const shareLog = () => run('__calls').filter(c => c[0].startsWith('student_'));
  const calls = () => shareLog().map(c => c[0]);

  test('partage coach : données prévues dans le modèle, seul le poids affiché ; mêmes données que le serveur', () => {
    sameJSON(run('COACH_SHARE_KINDS.map(k => k.kind)'), ['weight', 'sleep', 'steps', 'resting_hr', 'measures']);
    sameJSON(run('coachShareKindsShown().map(k => k.kind)'), ['weight'], 'sommeil, pas, FC : pas avant la build HealthKit ; mensurations : pas sans l\'accord du serveur');
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261031300000_partage_coach.sql'), 'utf8');
    assert.match(sql, /\$\$ select kind = 'weight' \$\$/, 'partage du poids : seul le poids ouvert');
    // Mensurations (20261105010000) : même liste que COACH_SHARE_KINDS, poids et mensurations ouverts
    const sqlM = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261105010000_partage_mensurations.sql'), 'utf8');
    assert.match(sqlM, /kind in \('weight', 'sleep', 'steps', 'resting_hr', 'measures'\)/, 'liste du serveur = COACH_SHARE_KINDS');
    assert.match(sqlM, /\$\$ select kind in \('weight', 'measures'\) \$\$/, 'ouvertes côté serveur = ouvertes dans l\'app');
    sameJSON(run('COACH_SHARE_KINDS.filter(k => k.open).map(k => k.kind)'), ['weight', 'measures']);
    // Serveur à jour : il annonce ce qu'il accepte (kinds) ; inconnu de l'app : ignoré
    run(`coachShare.state = cleanShareState({ coach: true, kinds: ['weight', 'measures', 'photos'], shares: {} })`);
    sameJSON(run('coachShareKindsShown().map(k => k.kind)'), ['weight', 'measures']);
    run('coachShare.state = null');
  });

  test('partage coach : seules les pesées saisies dans l\'app partent, nettoyées et bornées', () => {
    reset();
    run('data.bodyWeightKg = 80');
    sameJSON(run('sharedWeightsPayload()'), [], 'poids de secours seul (sans pesée) : rien');
    const t3 = Date.UTC(2026, 9, 20, 9, 37), t1 = Date.UTC(2026, 9, 18, 21, 5);
    const day0 = t => new Date(t).setHours(0, 0, 0, 0);
    run(`data.bodyWeightLog = [{ date: ${t3}, kg: 79.456, note: 'x' }, { date: ${t3 - DAY}, kg: 10 }, { date: 'x', kg: 80 }, { date: ${t1}, kg: 81 }]`);
    sameJSON(run('sharedWeightsPayload()'), [{ date: day0(t3), kg: 79.46 }, { date: day0(t1), kg: 81 }], 'heure de la pesée jamais envoyée');
    run(`data.bodyWeightLog = Array.from({ length: 450 }, (_, i) => ({ date: ${DAY} * (i + 1), kg: 80 }))`);
    assert.equal(run('sharedWeightsPayload().length'), 400);
    assert.ok(run('sharedWeightsPayload().every(p => new Date(p.date).getHours() === 0 && new Date(p.date).getMinutes() === 0)'));
    // Rien d'autre de data : mensurations, historique, Santé
    run(`data.bodyMeasures = { waist: [{ date: ${DAY}, cm: 80 }] }; data.healthOn = true;`);
    assert.ok(run('sharedWeightsPayload().every(p => Object.keys(p).join() === "date,kg")'));
  });

  test('partage coach : état du serveur nettoyé (données connues seulement)', () => {
    const st = run(`cleanShareState({ coach: true, shares: { weight: { granted_at: '2026-10-30T10:00:00Z', n: 3, last_at: 1780000000000 }, photos: { n: 1 }, sleep: 'x' } })`);
    assert.equal(st.coach, true);
    sameJSON(Object.keys(st.shares), ['weight']);
    sameJSON(st.shares.weight, { grantedAt: Date.parse('2026-10-30T10:00:00Z'), n: 3, lastAt: 1780000000000 });
    sameJSON(run('cleanShareState(null)'), { coach: false, shares: {}, kinds: ['weight'] }, 'serveur d\'avant les mensurations : le poids seul');
    sameJSON(run(`cleanShareState({ shares: [1] })`).shares, {});
  });

  test('partage coach : rien n\'est envoyé tant que la case n\'est pas cochée sur le serveur', async () => {
    reset();
    try {
      setup();
      run(`data.bodyWeightLog = [{ date: ${5 * DAY}, kg: 80 }]`);
      run(`__answers.student_shares = { coach: true, shares: {} }`);
      assert.equal(await run('coachShareRefresh()'), true);
      sameJSON(calls(), ['student_shares'], 'décoché par défaut : aucune pesée envoyée');
      assert.equal(run('coachShareSummary()'), 'Rien');
      sameJSON(await run('coachShareUpload({ force: true })'), { ok: true, skipped: true });
      run('coachShareWeightsChanged()');
      sameJSON(calls(), ['student_shares']);
      // Donnée pas encore ouverte : refusée sans appel
      assert.equal((await run(`coachShareSet('sleep', true)`)).kind, 'invalid_kind');
      sameJSON(calls(), ['student_shares']);
      // Sans coach : l'état est oublié, rien n'est lu
      run('coach.state = cleanCoachState({ coach: null })');
      assert.equal(await run('coachShareRefresh()'), false);
      assert.equal(run('coachShareSummary()'), null);
      sameJSON(calls(), ['student_shares']);
    } finally { teardown(); }
  });

  test('partage coach : cocher envoie les pesées, puis seulement quand elles changent ; décocher oublie', async () => {
    reset();
    try {
      setup();
      run(`data.bodyWeightLog = [{ date: ${5 * DAY}, kg: 80 }]`);
      const on = { coach: true, shares: { weight: { granted_at: '2026-10-30T10:00:00Z', n: 0, last_at: null } } };
      run(`__answers.student_set_share = a => a.enabled ? ${JSON.stringify(on)} : { coach: true, shares: {} }`);
      run(`__answers.student_share_weights = a => a.weights.length`);
      sameJSON((await run(`coachShareSet('weight', true)`)).ok, true);
      sameJSON(shareLog(), [['student_set_share', { kind: 'weight', enabled: true }], ['student_share_weights', { weights: run('sharedWeightsPayload()') }]]);
      assert.equal(run('coachShareSummary()'), 'Poids du corps');
      assert.equal(run('coachShare.state.shares.weight.n'), 1);
      // Relecture sans changement : rien de renvoyé
      run(`__answers.student_shares = ${JSON.stringify(on)}`);
      await run('coachShareRefresh()');
      sameJSON(calls().slice(2), ['student_shares']);
      // Nouvelle pesée : renvoyée (liste entière, miroir)
      run(`logBodyWeight(81, ${6 * DAY})`);
      run('coachShareWeightsChanged()');
      await run('Promise.resolve()'); await new Promise(r => setTimeout(r, 0));
      assert.equal(calls().at(-1), 'student_share_weights');
      assert.equal(shareLog().at(-1)[1].weights.length, 2);
      // Décocher : appel au serveur (qui efface tout), empreinte locale oubliée
      await run(`coachShareSet('weight', false)`);
      sameJSON(shareLog().at(-1), ['student_set_share', { kind: 'weight', enabled: false }]);
      assert.equal(run('localStorage.getItem(COACH_SHARE_KEY)'), null);
      assert.equal(run('coachShareOn("weight")'), false);
      run('coachShareWeightsChanged()');
      assert.equal(calls().at(-1), 'student_set_share', 'décoché : plus rien ne part');
    } finally { teardown(); }
  });

  test('partage coach : un second appareil sans pesées n\'écrase pas celles du premier à la connexion', async () => {
    reset();
    try {
      setup();   // appareil neuf : aucune pesée, jamais rien envoyé
      run(`__answers.student_shares = { coach: true, shares: { weight: { granted_at: '2026-10-30T10:00:00Z', n: 100 } } }`);
      run(`__answers.student_share_weights = a => a.weights.length`);
      await run('coachShareRefresh()');
      sameJSON(calls(), ['student_shares'], 'relecture : rien envoyé (pas de liste vide)');
      // Pesée saisie ici : geste explicite, la liste de l'appareil part ; ensuite les relectures suivent
      run(`logBodyWeight(70, ${7 * DAY}); coachShareWeightsChanged()`);
      await new Promise(r => setTimeout(r, 0));
      assert.equal(calls().at(-1), 'student_share_weights');
    } finally { teardown(); }
  });

  test('partage coach : coupé ailleurs (not_shared) ou hors ligne', async () => {
    reset();
    try {
      setup();
      run(`data.bodyWeightLog = [{ date: ${5 * DAY}, kg: 80 }]`);
      run(`__answers.student_shares = { coach: true, shares: { weight: { granted_at: '2026-10-30T10:00:00Z', n: 0 } } }`);
      run(`__answers.student_share_weights = { error: { message: 'not_shared' } }`);
      run(`localStorage.setItem(COACH_SHARE_KEY, JSON.stringify({ userId: 'u1', coachId: 'c1', hash: 'ancien' }))`);   // cet appareil a déjà envoyé
      await run('coachShareRefresh()');
      assert.equal(run('coachShareOn("weight")'), false, 'décoché sur un autre appareil : l\'état suit');
      run(`__answers.student_set_share = { coach: true, shares: { weight: { granted_at: '2026-10-30T10:00:00Z', n: 0 } } }`);
      run(`__answers.student_share_weights = { error: { message: 'TypeError: Failed to fetch' } }`);
      const r = await run(`coachShareSet('weight', true)`);
      sameJSON([r.ok, r.uploadFailed], [true, 'offline'], 'coché, envoi à refaire');
      assert.ok(!String(run('localStorage.getItem(COACH_SHARE_KEY)')).includes(run('syncHash(sharedWeightsPayload())')), 'rien de marqué « envoyé »');
    } finally { teardown(); }
  });

  test('partage coach : premier cochage hors ligne, envoyé à la relecture suivante en ligne', async () => {
    reset();
    try {
      setup();   // appareil qui n'a jamais rien envoyé
      run(`data.bodyWeightLog = [{ date: ${5 * DAY}, kg: 80 }]`);
      const on = { coach: true, shares: { weight: { granted_at: '2026-10-30T10:00:00Z', n: 0 } } };
      run(`__answers.student_set_share = ${JSON.stringify(on)}; __answers.student_shares = ${JSON.stringify(on)}`);
      run(`__answers.student_share_weights = { error: { message: 'TypeError: Failed to fetch' } }`);
      const r = await run(`coachShareSet('weight', true)`);
      sameJSON([r.ok, r.uploadFailed], [true, 'offline']);
      // De retour en ligne : la relecture renvoie les pesées
      run(`__answers.student_share_weights = a => a.weights.length; __calls.length = 0`);
      await run('coachShareRefresh()');
      sameJSON(calls(), ['student_shares', 'student_share_weights']);
      assert.equal(JSON.parse(run('localStorage.getItem(COACH_SHARE_KEY)')).hash, run('syncHash(sharedWeightsPayload())'), 'marqué envoyé');
      run('__calls.length = 0');
      await run('coachShareRefresh()');
      sameJSON(calls(), ['student_shares'], 'ensuite : rien de renvoyé sans changement');
    } finally { teardown(); }
  });

  test('mensurations : seules les mesures connues partent, au début du jour, rien d\'autre', () => {
    reset();
    const t = Date.UTC(2026, 10, 3, 18, 42);
    run(`data.bodyMeasures = { waist: [{ date: ${t}, cm: 81.46 }], biceps: [{ date: ${t}, cm: 40 }], armL: [{ date: ${t}, cm: 5 }] }`);
    run(`data.bodyWeightLog = [{ date: ${t}, kg: 80 }]`);
    const m = run('sharedMeasuresPayload()');
    sameJSON(Object.keys(m), ['waist'], 'clé inconnue et valeur hors bornes retirées');
    sameJSON(m.waist, [{ date: new Date(t).setHours(0, 0, 0, 0), cm: 81.5 }]);
    sameJSON(run('sharedMeasuresPayload({})'), {});
    const c = run(`cleanCoachMeasures({ shared: true, since: '2026-11-05T10:00:00Z', measures: { waist: [{ date: 1, cm: 80 }, { date: 3, cm: '79.5' }, { date: 2, cm: 400 }], photos: [{ date: 1, cm: 50 }] } })`);
    sameJSON(c.measures, { waist: [{ date: 3, cm: 79.5 }, { date: 1, cm: 80 }] });
    sameJSON(run(`cleanCoachMeasures({ shared: false, measures: { waist: [{ date: 1, cm: 80 }] } })`), { shared: false, since: null, measures: {} });
  });

  test('mensurations : case montrée et cochable seulement si le serveur l\'accepte, puis envoi comme le poids', async () => {
    reset();
    try {
      setup();
      run(`data.bodyMeasures = { waist: [{ date: ${5 * DAY}, cm: 80 }] }`);
      // Serveur d'avant les mensurations : pas de kinds, le poids seul ; cocher les mensurations est refusé sans appel
      run(`__answers.student_shares = { coach: true, shares: {} }`);
      await run('coachShareRefresh()');
      sameJSON(run('coachShareKindsShown().map(k => k.kind)'), ['weight']);
      assert.equal((await run(`coachShareSet('measures', true)`)).kind, 'invalid_kind');
      sameJSON(calls(), ['student_shares']);
      // Serveur à jour
      const on = { coach: true, kinds: ['weight', 'measures'], shares: { measures: { granted_at: '2026-11-05T10:00:00Z', n: 0, last_at: null } } };
      run(`__answers.student_shares = { coach: true, kinds: ['weight', 'measures'], shares: {} }`);
      await run('coachShareRefresh()');
      run(`__answers.student_set_share = a => a.enabled ? ${JSON.stringify(on)} : { coach: true, kinds: ['weight', 'measures'], shares: {} }`);
      run(`__answers.student_share_measures = a => Object.values(a.measures).reduce((n, l) => n + l.length, 0)`);
      assert.equal((await run(`coachShareSet('measures', true)`)).ok, true);
      sameJSON(shareLog().slice(-2), [['student_set_share', { kind: 'measures', enabled: true }], ['student_share_measures', { measures: run('sharedMeasuresPayload()') }]]);
      assert.equal(run('coachShareSummary()'), 'Mensurations');
      assert.equal(run('coachShare.state.shares.measures.n'), 1);
      assert.ok(!calls().includes('student_share_weights'), 'poids pas coché : aucune pesée envoyée');
      // Nouvelle mesure saisie ici : la liste repart ; décocher : empreinte oubliée, plus rien ne part
      run(`logBodyMeasure('waist', 79, ${6 * DAY}); coachShareMeasuresChanged()`);
      await new Promise(r => setTimeout(r, 0));
      assert.equal(calls().at(-1), 'student_share_measures');
      await run(`coachShareSet('measures', false)`);
      assert.equal(run('localStorage.getItem(COACH_SHARE_M_KEY)'), null);
      run('coachShareMeasuresChanged()');
      assert.equal(calls().at(-1), 'student_set_share');
    } finally { teardown(); }
  });

  test('partage coach : pesées reçues par le coach nettoyées, rien sans partage', () => {
    const w = run(`cleanCoachWeights({ shared: true, since: '2026-10-30T10:00:00Z', weights: [{ date: ${1 * DAY}, kg: 81 }, { date: ${3 * DAY}, kg: '79.5' }, { date: 'x', kg: 80 }, { date: ${2 * DAY}, kg: 500 }] })`);
    sameJSON(w.weights, [{ date: 3 * DAY, kg: 79.5 }, { date: 1 * DAY, kg: 81 }]);
    assert.equal(w.since, Date.parse('2026-10-30T10:00:00Z'));
    sameJSON(run(`cleanCoachWeights({ shared: false, weights: [{ date: 1, kg: 80 }] })`), { shared: false, since: null, weights: [] });
    sameJSON(run('cleanCoachWeights(null)'), { shared: false, since: null, weights: [] });
  });

  test('relecture coach : poids de l\'élève compté quand il le partage, écart sous une même règle', () => {
    reset();
    run('data.bodyWeightKg = 95');   // poids du coach : jamais utilisé
    const ex = (name, sets) => ({ name, sets: sets.map(([weight, reps]) => ({ weight: String(weight), reps: String(reps) })) });
    const exs = [ex('Squat barre', [[100, 5]]), ex('Tractions pronation', [['', 10]])];
    const row = (id, day, extra = {}) => ({ id, doneAt: day * DAY, s: { date: day * DAY, programme: 'ppl', category: 'pull', label: 'Pull', exercises: exs, ...extra } });
    const R = rows => run(`(${JSON.stringify(rows)})`);
    run(`globalThis.__r = ${JSON.stringify([row('b', 5, { bodyKg: 80 }), row('a', 3, { bodyKg: 82 }), row('z', 1)])}`);
    const rv = run('sessionReview(__r[0], __r)');
    assert.equal(rv.bodyKg, 80);
    const share = run(`bodyShare({ name: 'Tractions pronation' })`);
    assert.ok(share > 0.5);
    assert.equal(rv.volume, 500 + 80 * share * 10, 'tractions : part soulevée de 80 kg × 10');
    assert.equal(rv.exercises[1].volume, 80 * share * 10);
    // a : 500 + 820 ; b : 1300 → −1 % : « = »
    sameJSON(rv.volDelta, { dir: 'same', pct: 0 });
    // Référence sans poids : les deux comparées sans poids du corps (500 contre 500)
    const rv2 = run('sessionReview(__r[1], [__r[1], __r[2]])');
    assert.equal(rv2.volume, 500 + 82 * share * 10);
    sameJSON(rv2.volDelta, { dir: 'same', pct: 0 }, 'pas de +164 % artificiel');
    // Sans poids partagé : comportement d'avant (lest seul)
    const rv3 = run('sessionReview(__r[2], [__r[2]])');
    assert.equal(rv3.bodyKg, null);
    assert.equal(rv3.volume, 500);
    R([]);
  });
}
