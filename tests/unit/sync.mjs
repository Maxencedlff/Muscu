// Synchronisation du compte (js/data/sync.js) : fusion des séances et du profil, sans réseau
export default function ({ test, run, assert, sameJSON }) {
  const h = (id, reps, extra = {}) => ({ id, date: 1e12, category: 'push', exercises: [{ name: 'DC', sets: [{ weight: '60', reps }] }], ...extra });
  // Contexte isolé pour chaque test : historique, meta et lignes passés en JSON
  const call = (expr, vars) => run(`(() => { ${Object.entries(vars).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join(' ')} return ${expr}; })()`);

  test('synchro : empreinte stable quel que soit l\'ordre des clés, sans le poids du corps', () => {
    assert.equal(run(`syncHash({ a: 1, b: [2, { c: 3, d: 4 }] })`), run(`syncHash({ b: [2, { d: 4, c: 3 }], a: 1 })`));
    sameJSON(run(`sessionPayload({ id: 'x', bodyKg: 71.6, notes: 'n' })`), { id: 'x', notes: 'n' });
    const p = run(`profilePayload({ history: [1], trash: [], bodyWeightKg: 70, healthOn: true, soundOn: false, unit: 'kg', programmes: {} })`);
    sameJSON(p, { programmes: {}, unit: 'kg' });
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
    // Première liaison d'un téléphone qui a des séances : le compte gagne, ce qui n'est qu'ici est ajouté
    const merged = call(`(() => { const d = { history: [{ id: 'x' }], unit: 'kg', userProgrammes: { u_1: 'ici' }, programmes: { ppl: 'défaut' } };
      const meta = { profileHash: null };
      applyRemoteProfile(d, { doc: { unit: 'lbs', userProgrammes: { u_2: 'ailleurs' }, programmes: { ppl: 'perso' } }, updated_at: 't1' }, meta);
      return { d, push: syncHash(profilePayload(d)) !== meta.profileHash }; })()`, {});
    assert.equal(merged.d.unit, 'lbs');
    assert.equal(merged.d.programmes.ppl, 'perso', 'le PPL réglé sur le compte n\'est pas remplacé par le défaut de cet iPhone');
    sameJSON(merged.d.userProgrammes, { u_1: 'ici', u_2: 'ailleurs' });
    assert.equal(merged.push, true, 'le programme créé ici part sur le compte');
    // Modifié des deux côtés depuis la dernière synchro : cet appareil gagne, ce qui n'est que sur le compte s'ajoute
    const both = call(`(() => { const d = { history: [{ id: 'x' }], unit: 'kg', userProgrammes: { u_1: 'ici v2' } };
      const meta = { profileHash: 'ancienne' };
      applyRemoteProfile(d, { doc: { unit: 'lbs', userProgrammes: { u_1: 'ailleurs v2', u_3: 'nouveau' } }, updated_at: 't3' }, meta); return d; })()`, {});
    assert.equal(both.unit, 'kg');
    sameJSON(both.userProgrammes, { u_1: 'ici v2', u_3: 'nouveau' });
    // Profil local inchangé : copie exacte du compte, clé retirée là-bas retirée ici
    const exact = call(`(() => { const d = { history: [{ id: 'x' }], unit: 'kg', weeklyGoal: 4 };
      const meta = { profileHash: syncHash(profilePayload(d)) };
      applyRemoteProfile(d, { doc: { unit: 'lbs' }, updated_at: 't4' }, meta); return d; })()`, {});
    assert.equal(exact.unit, 'lbs');
    assert.equal(exact.weeklyGoal, undefined, 'objectif remis en automatique sur l\'autre appareil');
    // Profil déjà vu (même updated_at) : ignoré
    const same = call(`applyRemoteProfile({ history: [], unit: 'kg' }, { doc: { unit: 'lbs' }, updated_at: 't1' }, { profileAt: 't1' })`, {});
    assert.equal(same, false);
    // Réglage sur l'appareil jamais repris du compte
    const dev = call(`(() => { const d = { history: [], soundOn: false }; applyRemoteProfile(d, { doc: { soundOn: true, unit: 'kg' }, updated_at: 't2' }, {}); return d.soundOn; })()`, {});
    assert.equal(dev, false);
  });

  test('synchro : appareil sans état connu (reconnexion, réinstallation) : le compte fait foi', () => {
    // Compte : X supprimée et Y corrigée à 12 sur un autre iPhone. Cet appareil revient avec X et Y = 8, sans empreintes.
    const r = call(`(() => {
      const meta = { pushed: {} };
      const res = applyRemoteSessions(local, rows, meta);
      const plan = planSessionPush(res.history, meta);
      return { ids: res.history.map(x => x.id), y: res.history.find(x => x.id === 'Y').exercises[0].sets[0].reps,
               removed: res.removed.map(x => x.id), up: plan.upserts.map(u => u.id), del: plan.deletes };
    })()`, {
      local: [h('X', '10'), h('Y', '8'), h('Z', '6')],
      rows: [{ id: 'X', deleted_at: '2026-10-25T10:00:00Z' }, { id: 'Y', data: h('Y', '12') }],
    });
    sameJSON(r.ids, ['Y', 'Z']);
    assert.equal(r.y, '12', 'la correction faite ailleurs n\'est pas écrasée');
    sameJSON(r.removed, ['X'], 'X va dans Supprimés récemment, pas de résurrection');
    sameJSON(r.up, ['Z'], 'seule la séance absente du compte part');
    sameJSON(r.del, []);
  });

  test('synchro : historique retrié après fusion (plus récente d\'abord)', () => {
    const r = call(`applyRemoteSessions(local, rows, { pushed: {} }).history.map(x => x.id)`, {
      local: [h('b', '8', { date: 2e12 }), h('a', '8', { date: 1e12 })],
      rows: [{ id: 'c', data: h('c', '8', { date: 3e12 }) }],
    });
    sameJSON(r, ['c', 'b', 'a']);
  });

  test('synchro : chaque clé des données est classée « compte » ou « appareil » (rien ne part par oubli)', () => {
    const r = run(`(() => { const d = freshData(); d.weeklyGoal = 3; d.exerciseMuscles = {}; d.exerciseMusclesSecondary = {}; d.lastExport = 1; d.silhouette = 'female';
      return Object.keys(d).filter(k => !SYNC_PROFILE_KEYS.includes(k) && !SYNC_LOCAL_ONLY.includes(k)); })()`);
    sameJSON(r, [], 'clé à ajouter à SYNC_PROFILE_KEYS ou SYNC_LOCAL_ONLY (js/data/sync.js)');
    const both = run(`SYNC_PROFILE_KEYS.filter(k => SYNC_LOCAL_ONLY.includes(k))`);
    sameJSON(both, []);
    for (const k of ['bodyWeightKg', 'healthOn', 'history']) assert.ok(run(`SYNC_LOCAL_ONLY.includes(${JSON.stringify(k)})`), k);
    // Silhouette : réglage du profil, le même sur tous les appareils du compte
    sameJSON(run(`profilePayload({ unit: 'kg', silhouette: 'female', soundOn: false })`), { unit: 'kg', silhouette: 'female' });
  });

  test('compte : effacer l\'appareil ou importer n\'envoie aucune suppression au compte', () => {
    const r = run(`(() => {
      localStorage.setItem('mdlf_sync_u1', JSON.stringify({ userId: 'u1', cursor: 't', pushed: { a: 'h', b: 'h' }, profileHash: 'p' }));
      localStorage.setItem('mdlf_sync_owner', 'u1');
      account.user = { id: 'u1' };
      accountResetSyncState();                       // import d'une sauvegarde
      const afterImport = planSessionPush([], loadSyncMeta('u1')).deletes.length;
      const ownerKept = localStorage.getItem('mdlf_sync_owner');
      localStorage.setItem('mdlf_sync_u1', JSON.stringify({ userId: 'u1', cursor: 't', pushed: { a: 'h' }, profileHash: 'p' }));
      accountForgetDevice();                         // « Supprimer toutes les données »
      return { afterImport, ownerKept, user: account.user, meta: localStorage.getItem('mdlf_sync_u1'), owner: localStorage.getItem('mdlf_sync_owner') };
    })()`);
    assert.equal(r.afterImport, 0, 'état oublié : aucune tombstone');
    assert.equal(r.ownerKept, 'u1', 'le dernier compte connu reste (choix si un autre compte se connecte)');
    assert.equal(r.user, null, 'détaché avant l\'écriture');
    assert.equal(r.meta, null);
    assert.equal(r.owner, null);
  });

  test('compte : revenir sur un ancien compte après en avoir utilisé un autre ne supprime rien', () => {
    const r = run(`(() => {
      // A avait synchronisé 3 séances, puis B s'est connecté (dernier compte : B) et l'iPhone n'a plus que ses séances
      localStorage.setItem('mdlf_sync_A', JSON.stringify({ userId: 'A', cursor: 't', pushed: { a1: 'h', a2: 'h', a3: 'h' }, profileHash: 'p' }));
      localStorage.setItem('mdlf_sync_owner', 'B');
      return { deletes: planSessionPush([{ id: 'b1', date: 1, category: 'push', exercises: [] }], loadSyncMeta('A')).deletes.length,
               gen0: syncGeneration, gen1: (clearSyncMetas(), syncGeneration) };
    })()`);
    assert.equal(r.deletes, 0, 'l\'état de A n\'est pas repris : aucune suppression envoyée à A');
    assert.equal(r.gen1, r.gen0 + 1, 'oublier l\'état arrête une synchro en cours (génération)');
  });

  test('compte : déconnexion, « Supprimer toutes les données », reconnexion : aucune suppression envoyée', () => {
    const r = run(`(() => {
      localStorage.setItem('mdlf_sync_A', JSON.stringify({ userId: 'A', cursor: 't', pushed: { a1: 'h', a2: 'h' }, profileHash: 'p' }));
      localStorage.setItem('mdlf_sync_owner', 'A');
      account.user = null;                // déconnecté
      accountForgetDevice();              // appelé sans condition par « Supprimer toutes les données »
      return planSessionPush([], loadSyncMeta('A')).deletes.length;
    })()`);
    assert.equal(r, 0);
  });

  test('compte : appareil rattaché au compte dès la connexion, même si la première synchro échoue', async () => {
    // Serveur injoignable : profil et synchro échouent (hors ligne), la connexion elle-même a réussi
    const r = await run(`(async () => {
      localStorage.clear();
      data.history = [{ id: 'a', date: 2, category: 'push', exercises: [] }];
      const offline = () => { throw new TypeError('Failed to fetch'); };
      sb = { from: offline, auth: { signOut: async () => ({ error: null }) } };
      const asked = [];
      const askMerge = async (n, pending) => { asked.push([n, pending]); return 'add'; };
      const signIn = id => finishSignIn(async () => ({ data: { user: { id, identities: [] } }, error: null }), askMerge);
      localStorage.setItem('mdlf_sync_A', JSON.stringify({ userId: 'A', cursor: 't', pushed: {}, profileHash: 'p' }));
      localStorage.setItem('mdlf_sync_owner', 'A');
      const first = await signIn('B');                     // B : synchro en échec
      const ownerAfterB = localStorage.getItem('mdlf_sync_owner');
      const metaA = localStorage.getItem('mdlf_sync_A');
      await signIn('C');                                   // un autre compte ensuite : le choix est proposé
      const owner = localStorage.getItem('mdlf_sync_owner');
      const again = asked.length;
      await signIn('C');                                   // le même compte : pas de question
      return { first, ownerAfterB, metaA, owner, asked, again, after: asked.length };
    })()`);
    try {
      assert.equal(r.first.ok, false);
      assert.equal(r.first.reason, 'sync', 'connecté, synchro à refaire');
      assert.equal(r.ownerAfterB, 'B', 'rattaché à B malgré l\'échec');
      assert.equal(r.metaA, null, 'état de A oublié');
      sameJSON(r.asked, [[1, 1], [1, 1]], 'fusion proposée à B puis à C (séance jamais sauvegardée sur le compte précédent)');
      assert.equal(r.owner, 'C');
      assert.equal(r.after, r.again, 'même compte : aucune question');
    } finally { run('sb = null; account.user = null; account.error = null; localStorage.clear(); data.history = [];'); }
  });

  test('compte : séances pas encore sur le compte comptées (aucune promesse « elles restent sur ton compte » à tort)', () => {
    const r = run(`(() => {
      data.history = [{ id: 'a', date: 2, category: 'push', exercises: [] }, { id: 'b', date: 1, category: 'push', exercises: [] }];
      localStorage.setItem('mdlf_sync_owner', 'A');
      localStorage.setItem('mdlf_sync_A', JSON.stringify({ userId: 'A', cursor: 't', pushed: { a: syncHash(sessionPayload(data.history[0])) }, profileHash: 'p' }));
      return [accountPendingCount('A'), accountPendingCount('B'), accountPendingCount(null)];
    })()`);
    sameJSON(r, [1, 2, 2], 'b pas encore envoyée ; autre compte ou aucun : tout est à risque');
  });
}
