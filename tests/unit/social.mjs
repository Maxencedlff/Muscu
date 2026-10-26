// Amis (js/data/social.js) : logique pure sans réseau (nettoyage de ce que renvoie le serveur,
// recherche, relation, erreurs traduites)
export default function ({ test, run, assert, sameJSON }) {
  test('amis : séance d\'un autre réduite à la liste blanche, champs bornés', () => {
    const s = run(`cleanPublicSession({ date: 1e12, duration: 3e6, programme: 'ppl', category: 'push', label: 'Push', notes: 'privé', bodyKg: 80, hidden: true, extra: 1,
      exercises: [{ name: 'DC', measure: 'reps', muscles: ['x'], sets: [{ weight: 80, reps: '8', rpe: 9 }, null] }, { name: '' }, 'x'] })`);
    sameJSON(Object.keys(s).sort(), ['category', 'date', 'duration', 'exercises', 'label', 'programme']);
    sameJSON(s.exercises, [{ name: 'DC', measure: 'reps', sets: [{ weight: '80', reps: '8' }] }]);
    assert.equal(run(`cleanPublicSession({}).label`), 'Séance', 'nom absent : « Séance »');
    // Ligne du fil inutilisable (sans propriétaire, sans date) : écartée
    assert.equal(run(`cleanFeedRow({ id: 'a', s: {} })`), null);
    const row = run(`cleanFeedRow({ owner: 'u', username: '<b>x</b>', avatar: '💩', id: 'a', done_at: 5, s: { date: 5 }, bravos: 3, my_bravo: true })`);
    assert.equal(row.username, null, 'pseudo hors de la forme du serveur : ignoré (initiale)');
    assert.equal(row.avatar, null, 'avatar hors liste blanche : initiale');
    assert.equal(row.bravos, 3);
  });

  test('amis : état social_state nettoyé, badge et relation', () => {
    const st = run(`cleanSocialState({ enabled: true, pending_in: [{ user_id: 'a', username: 'lea' }, { username: 'sans_id' }], following: [{ user_id: 'b', username: 'tom' }], followers: [{ user_id: 'a', username: 'lea' }], badge: 1 })`);
    assert.equal(st.pending_in.length, 1);
    assert.equal(st.badge, 1);
    sameJSON(st.blocked, []);
    const rel = run(`(() => { const st = ${JSON.stringify(st)};
      return [socialRelation('a', st), socialRelation('b', st), socialRelation('c', st)].map(r => [r.status, r.followsYou, r.pendingIn]); })()`);
    sameJSON(rel, [['none', true, true], ['following', false, false], ['none', false, false]]);
  });

  test('amis : recherche normalisée comme le serveur, 2 caractères au moins', () => {
    assert.equal(run(`normalizeSocialQuery(' @Hélène ')`), 'helene');
    assert.equal(run(`normalizeSocialQuery('@a')`), '');
    assert.equal(run(`normalizeSocialQuery('max.dlf!')`), 'max.dlf');
  });

  test('amis : erreurs du serveur traduites en français', () => {
    const kinds = run(`[{ code: 'P0001', message: 'social_not_enabled' }, { message: 'username_required' }, { message: 'age_required' },
      { message: 'rate_limited' }, { message: 'not_found' }, { message: 'TypeError: Failed to fetch' }, { message: 'boom' }].map(socialErrorKind)`);
    sameJSON(kinds, ['social_not_enabled', 'username_required', 'age_required', 'rate_limited', 'not_found', 'offline', 'server']);
    for (const k of kinds) assert.match(run(`socialErrorText(${JSON.stringify(k)})`), /^[A-ZÉ].+\.$/, k);
  });

  test('amis : résumé des exercices d\'une carte', () => {
    const line = names => run(`feedExercisesLine({ exercises: ${JSON.stringify(names.map(name => ({ name })))} })`);
    assert.equal(line(['A']), 'A');
    assert.equal(line(['A', 'B']), 'A et B');
    assert.equal(line(['A', 'B', 'C', 'D']), 'A, B, C et D');
    assert.equal(line(['A', 'B', 'C', 'D', 'E']), 'A, B, C et 2 autres');
  });

  test('amis : « Masquer à mes abonnés » gardé par le nettoyage seulement s\'il vaut true', () => {
    const r = run(`[true, false, 'oui'].map(v => { const h = { id: 'a', date: 1, category: 'push', exercises: [], hidden: v }; cleanHistoryEntry(h); return 'hidden' in h ? h.hidden : null; })`);
    sameJSON(r, [true, null, null]);
  });
}
