// Synchronisation du compte (js/data/sync.js) : fusion des séances et du profil, sans réseau
export default function ({ test, run, assert, sameJSON }) {
  const h = (id, reps, extra = {}) => ({ id, date: 1e12, category: 'push', exercises: [{ name: 'DC', sets: [{ weight: '60', reps }] }], ...extra });
  // Contexte isolé pour chaque test : historique, meta et lignes passés en JSON
  const call = (expr, vars) => run(`(() => { ${Object.entries(vars).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join(' ')} return ${expr}; })()`);

  test('synchro : empreinte stable quel que soit l\'ordre des clés, sans le poids du corps', () => {
    assert.equal(run(`syncHash({ a: 1, b: [2, { c: 3, d: 4 }] })`), run(`syncHash({ b: [2, { d: 4, c: 3 }], a: 1 })`));
    sameJSON(run(`sessionPayload({ id: 'x', bodyKg: 71.6, notes: 'n' })`), { id: 'x', notes: 'n' });
    const p = run(`profilePayload({ history: [1], trash: [], bodyWeightKg: 70, healthOn: true, soundOn: false, unit: 'kg', programmes: {} })`);
    sameJSON(p, { unit: 'kg', programmes: {} });
  });

  test('synchro : première liaison, tout part ; ensuite seules les séances modifiées ou supprimées', () => {
    const meta = { userId: 'u', cursor: null, pushed: {}, profileHash: null, profileAt: null };
    let plan = call(`planSessionPush(hist, meta)`, { hist: [h('a', '10'), h('b', '8', { bodyKg: 70 })], meta });
    sameJSON(plan.upserts.map(u => u.id), ['a', 'b']);
    assert.equal(plan.upserts[1].data.bodyKg, undefined, 'poids du corps jamais envoyé');
    const pushed = Object.fromEntries(plan.upserts.map(u => [u.id, u.hash]));
    plan = call(`planSessionPush(hist, meta)`, { hist: [h('a', '12'), h('b', '8', { bodyKg: 72 })], meta: { ...meta, pushed } });
    sameJSON(plan.upserts.map(u => u.id), ['a'], 'b n\'a changé que de poids du corps : rien à envoyer');
    plan = call(`planSessionPush(hist, meta)`, { hist: [h('b', '8')], meta: { ...meta, pushed } });
    sameJSON(plan.deletes, ['a'], 'séance supprimée ici : tombstone');
  });

  test('synchro : séance distante appliquée sans écraser une modification locale', () => {
    const r = call(`(() => {
      const meta = { pushed: { a: syncHash(sessionPayload(local[0])), b: syncHash(sessionPayload(local[1])) } };
      local[1].exercises[0].sets[0].reps = '9';           // b modifiée ici depuis la synchro
      const res = applyRemoteSessions(local, rows, meta);
      return { ids: res.history.map(x => x.id), a: res.history.find(x => x.id === 'a'), b: res.history.find(x => x.id === 'b'), changed: res.changed };
    })()`, {
      local: [h('a', '10', { bodyKg: 70 }), h('b', '8')],
      rows: [{ id: 'a', data: h('a', '11') }, { id: 'b', data: h('b', '12') }, { id: 'c', data: h('c', '5') }],
    });
    sameJSON(r.ids, ['a', 'b', 'c']);
    assert.equal(r.a.exercises[0].sets[0].reps, '11', 'a inchangée ici : version distante');
    assert.equal(r.a.bodyKg, 70, 'poids du corps local gardé');
    assert.equal(r.b.exercises[0].sets[0].reps, '9', 'b modifiée ici : version locale gardée');
    assert.equal(r.changed, true);
  });

  test('synchro : suppressions distantes et locales, sans résurrection', () => {
    const r = call(`(() => {
      const meta = { pushed: { a: syncHash(sessionPayload(local[0])), gone: syncHash(sessionPayload(goneEntry)) } };
      const res = applyRemoteSessions(local, rows, meta);
      return { ids: res.history.map(x => x.id), meta };
    })()`, {
      local: [h('a', '10')],
      goneEntry: h('gone', '7'),
      rows: [{ id: 'a', deleted_at: '2026-10-25T10:00:00Z' }, { id: 'gone', data: h('gone', '7') }],
    });
    sameJSON(r.ids, [], 'a supprimée ailleurs ; gone supprimée ici reste supprimée');
    assert.equal(r.meta.pushed.a, 'deleted');
  });

  test('synchro : profil, appareil vierge reçoit le compte, sinon fusion sans perte', () => {
    // Nouvel iPhone : aucune séance, le profil du compte remplace les programmes par défaut
    const blank = call(`(() => { const d = { history: [], unit: 'kg', programmes: { ppl: 'défaut' } };
      const meta = { profileHash: null, profileAt: null };
      applyRemoteProfile(d, { doc: { unit: 'lbs', programmes: { ppl: 'perso' } }, updated_at: 't1' }, meta); return { d, meta }; })()`, {});
    assert.equal(blank.d.unit, 'lbs');
    assert.equal(blank.d.programmes.ppl, 'perso');
    assert.equal(blank.meta.profileAt, 't1');
    // Première liaison d'un téléphone qui a des séances : union des programmes, le local gagne
    const merged = call(`(() => { const d = { history: [{ id: 'x' }], unit: 'kg', userProgrammes: { u_1: 'ici' } };
      applyRemoteProfile(d, { doc: { unit: 'lbs', userProgrammes: { u_2: 'ailleurs' } }, updated_at: 't1' }, { profileHash: null }); return d; })()`, {});
    assert.equal(merged.unit, 'kg');
    sameJSON(merged.userProgrammes, { u_2: 'ailleurs', u_1: 'ici' });
    // Profil déjà vu (même updated_at) : ignoré
    const same = call(`applyRemoteProfile({ history: [], unit: 'kg' }, { doc: { unit: 'lbs' }, updated_at: 't1' }, { profileAt: 't1' })`, {});
    assert.equal(same, false);
    // Réglage sur l'appareil jamais repris du compte
    const dev = call(`(() => { const d = { history: [], soundOn: false }; applyRemoteProfile(d, { doc: { soundOn: true, unit: 'kg' }, updated_at: 't2' }, {}); return d.soundOn; })()`, {});
    assert.equal(dev, false);
  });
}
