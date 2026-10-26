// Mes programmes (data.myProgrammes) : migration des données d'avant, nettoyage (store.js,
// cleanMyProgrammes), synchro du profil, ajout / retrait / déplacement et muscles du catalogue
// (js/data/my-programmes.js).
export default function ({ test, run, reset, assert }) {
  const list = () => [...run('data.myProgrammes')];
  const entry = (programme, i) => ({ id: `h${programme}${i}`, programme, category: 'push', date: Date.now() - (i + 1) * 86400000, duration: 3000000,
    exercises: [{ exId: 'e1', name: 'Pompes', sets: [{ weight: '', reps: '10' }] }] });

  test('mes programmes : migration sans perte (actif, créés, intégrés utilisés, dans cet ordre)', () => {
    reset();
    run(`delete data.myProgrammes;
      data.activeProgramme = 'u_force';
      data.userProgrammes = { u_force: { name: 'Force', sessions: {}, archived: false }, u_vieux: { name: 'Vieux', sessions: {}, archived: true },
                              u_bras: { name: 'Bras', sessions: {}, archived: false } };
      data.programmes.u_force = makeProgData('u_force');
      data.history = ${JSON.stringify([entry('upper_lower', 0), entry('ppl', 1), entry('ppl', 2), entry('fullbody', 3)])};
      data.history.push({ ...data.history[1], id: 'sansprog' }); delete data.history[data.history.length - 1].programme;
      sanitizeData(data);`);
    assert.deepEqual(list(), ['u_force', 'u_bras', 'ppl', 'upper_lower', 'fullbody'], 'programmes intégrés dans l\'ordre du catalogue');
    // Idempotent : la liste migrée n'est plus recalculée
    run("data.myProgrammes = ['ppl', 'u_force', 'u_bras']; sanitizeData(data);");
    assert.deepEqual(list(), ['ppl', 'u_force', 'u_bras']);
  });

  test('mes programmes : nouvel utilisateur, PPL seul', () => {
    reset();
    assert.deepEqual(list(), ['ppl']);
    run('sanitizeData(data)');
    assert.deepEqual(list(), ['ppl']);
  });

  test('mes programmes : nettoyage (inconnus, doublons, archivés, actif et créés toujours dedans, Perso)', () => {
    reset();
    run(`data.userProgrammes = { u_a: { name: 'A', sessions: {}, archived: false }, u_b: { name: 'B', sessions: {}, archived: true } };
      data.activeProgramme = 'fullbody';
      data.myProgrammes = ['bro', 'bro', 'inconnu', 42, 'u_b', 'custom', 'u_zzz', 'ppl'];
      sanitizeData(data);`);
    assert.deepEqual(list(), ['bro', 'ppl', 'fullbody', 'u_a'], 'actif puis programme créé ajoutés en fin, Perso inutilisé retiré');
    run("data.customSessions = { s1: { label: 'Bras', icon: '', desc: '', color: '#FF9500' } }; data.myProgrammes.push('custom'); sanitizeData(data);");
    assert.ok(list().includes('custom'), 'Perso gardé quand il a des séances');
    run("data.myProgrammes = 'cassé'; sanitizeData(data);");
    assert.deepEqual(list().slice(0, 1), ['fullbody'], 'valeur illisible : migration');
  });

  test('mes programmes : ajout, retrait (jamais l\'actif ni un programme créé), déplacement', () => {
    reset();
    run("data.userProgrammes = { u_a: { name: 'A', sessions: {}, archived: false } }; data.myProgrammes = ['ppl', 'u_a'];");
    assert.equal(run("addMyProgramme('bro')"), true);
    assert.equal(run("addMyProgramme('bro')"), false, 'déjà dedans');
    assert.equal(run("addMyProgramme('inconnu')"), false);
    assert.deepEqual(list(), ['ppl', 'u_a', 'bro']);
    assert.equal(run("removeMyProgramme('ppl')"), false, 'actif');
    assert.equal(run("removeMyProgramme('u_a')"), false, 'programme créé : il se supprime');
    assert.equal(run("removeMyProgramme('bro')"), true);
    assert.equal(run("inMyProgrammes('bro')"), false);
    assert.ok(run("!!PROGRAMMES.bro"), 'toujours au catalogue');
    run("addMyProgramme('arnold')");
    assert.equal(run('moveMyProgramme(2, 0)'), true);
    assert.deepEqual(list(), ['arnold', 'ppl', 'u_a']);
    assert.equal(run('moveMyProgramme(0, 9)'), false);
    assert.equal(run('moveMyProgramme(1, 1)'), false);
  });

  test('mes programmes : synchronisés avec le compte, liste du compte nettoyée après la fusion', () => {
    reset();
    assert.ok(run("SYNC_PROFILE_KEYS.includes('myProgrammes')"));
    assert.deepEqual([...run("Object.keys(profilePayload({ myProgrammes: ['ppl'] }))")], ['myProgrammes']);
    // Appareil vierge : copie exacte du compte, puis un programme créé absent de la liste du compte y revient
    const r = run(`(() => { const d = makeDefaultData(); const meta = emptySyncMeta('u1');
      const doc = { activeProgramme: 'bro', myProgrammes: ['fullbody', 'bro'], programmes: {}, userProgrammes: { u_x: { name: 'X', sessions: {}, archived: false } } };
      applyRemoteProfile(d, { doc, updated_at: '2026-10-26T10:00:00Z' }, meta); sanitizeData(d); return d.myProgrammes; })()`);
    assert.deepEqual([...r], ['fullbody', 'bro', 'u_x']);
    // Compte d'une version précédente (sans la liste) : migration à partir de ses données
    const old = run(`(() => { const d = makeDefaultData(); const meta = emptySyncMeta('u1');
      applyRemoteProfile(d, { doc: { activeProgramme: 'arnold', programmes: {} }, updated_at: '2026-10-26T10:00:00Z' }, meta);
      sanitizeData(d); return d.myProgrammes; })()`);
    assert.deepEqual([...old], ['arnold']);
  });

  test('catalogue : chaque programme intégré a sa fréquence, sa phrase et ses muscles', () => {
    reset();
    const ids = [...run('catalogueProgrammeIds()')];
    assert.ok(!ids.includes('custom') && ids.includes('ppl') && ids.length === 7, ids.join());
    for (const id of ids) {
      const adv = run(`PROGRAMME_ADVICE[${JSON.stringify(id)}]`);
      assert.ok(adv && adv.perWeek >= 2 && adv.perWeek <= 5, `${id} : fréquence`);
      assert.ok(run(`recommendReason(${JSON.stringify(id)}, { ...PROGRAMME_ADVICE[${JSON.stringify(id)}], orMore: false })`).startsWith(`${adv.perWeek} séances par semaine`), `${id} : phrase`);
      const levels = run(`programmeMuscleLevels(${JSON.stringify(id)})`);
      assert.ok(Object.keys(levels).length >= 4 && Object.keys(levels).every(m => run(`isMuscleId(${JSON.stringify(m)})`)), `${id} : muscles ${Object.keys(levels)}`);
    }
    const legs = run("programmeMuscleLevels('maison')");
    assert.equal(legs.quads, 1, 'muscle principal en plein');
    const push = run("(() => { const l = {}; PROGRAMMES.ppl.defaults.push.forEach(([n]) => musclesOf(n).primary.forEach(m => { l[m] = 1; })); return l; })()");
    assert.ok(push.chest === 1);
    const ul = run("programmeMuscleLevels('upper_lower')");
    assert.ok(ul.chest === 1 && ul.quads === 1 && ul.lats === 1, 'haut et bas du corps');
  });
}
