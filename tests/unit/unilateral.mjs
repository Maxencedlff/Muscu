// ═══════════════════════════════════════════════════════════
//  Séries notées par bras (js/data/unilateral.js) : exercices reconnus, volume, records du meilleur côté,
//  pré-remplissage, enchaînement et repos, nettoyage, compatibilité (docs/UNILATERAL.md)
// ═══════════════════════════════════════════════════════════

export default function ({ test, run, reset, assert, sameJSON }) {
  const S = v => JSON.stringify(v);

  test('unilatéral : exercices reconnus (bibliothèque, alias, nom saisi), jamais les exercices à deux bras', () => {
    reset();
    const limb = name => run(`unilateralLimb({ name: ${S(name)} })`);
    assert.equal(limb('Curl concentration'), 'bras');
    assert.equal(limb('Rowing bûcheron un bras'), 'bras', 'alias de « Rowing haltère unilatéral »');
    assert.equal(limb('Extension triceps unilatéral'), 'bras');
    assert.equal(limb('Élévation latérale à un bras'), 'bras', 'nom saisi « à un bras »');
    assert.equal(limb('Leg extension unilatérale'), 'jambe');
    assert.equal(limb('Fentes bulgares'), 'jambe');
    assert.equal(limb('Curl biceps haltères'), null);
    assert.equal(limb('Kickback triceps'), null, 'se fait aussi à deux bras : pas d\'office');
    assert.equal(limb('Élévations latérales'), null);
    assert.equal(run(`unilateralLimb({ name: 'Gainage latéral' })`), null, 'maintien : le chrono gère déjà les deux côtés');
    assert.equal(run(`sideName({ name: 'Curl concentration' }, 1)`), 'Bras gauche');
    assert.equal(run(`sideName({ name: 'Fentes bulgares' }, 2)`), 'Jambe droite');
    // Menu ⋯ : seulement sur un exercice unilatéral
    sameJSON(run(`sideMenuActions({ name: 'Curl biceps haltères', sets: [{ weight: '10', reps: '10' }] })`), []);
    assert.equal(run(`sideMenuActions({ name: 'Curl concentration', sets: [{ weight: '10', reps: '10' }] })[0].label`), 'Noter chaque bras à part');
    assert.equal(run(`sideMenuActions({ name: 'Curl concentration', sets: [{ weight: '10', reps: '10', side2: {} }] })[0].label`), 'Noter les deux bras ensemble');
  });

  test('unilatéral : volume et total de reps additionnent les deux côtés, une seule série comptée', () => {
    reset();
    const sets = [
      { weight: '14', reps: '10', side2: { weight: '14', reps: '9' } },
      { weight: '14', reps: '8', tech: 'drop', sub: [{ weight: '10', reps: '6' }], side2: { weight: '14', reps: '8', sub: [{ weight: '10', reps: '5' }] } },
    ];
    assert.equal(run(`setsVolume(${S(sets)})`), 14 * 10 + 14 * 9 + 14 * 8 + 10 * 6 + 14 * 8 + 10 * 5);
    assert.equal(run(`workSets(${S(sets)}).length`), 2, 'une série par bras compte pour une');
    assert.equal(run(`volumeSets(${S(sets)}).reduce((a, s) => a + (+s.reps), 0)`), 10 + 9 + 8 + 6 + 8 + 5);
    // Séance en cours : un second côté pas encore validé n'est pas compté
    assert.equal(run(`setsVolume([{ weight: '14', reps: '10', side2: { weight: '14', reps: '10', done: false } }])`), 140);
    // Second côté sans technique : ses sous-séries orphelines ne comptent pas
    assert.equal(run(`setsVolume([{ weight: '14', reps: '10', side2: { weight: '14', reps: '10', sub: [{ weight: '9', reps: '9' }] } }])`), 280);
  });

  test('unilatéral : records et 1RM estimé sur le meilleur côté, jamais la somme', () => {
    reset();
    const s = { weight: '14', reps: '8', side2: { weight: '14', reps: '10' } };
    const r = run(`recordSet(${S(s)})`);
    assert.equal(r.reps, '10', 'le bras droit fait mieux : c\'est lui qui compte');
    assert.equal(r.side, 2);
    assert.equal(run(`recordSet({ weight: '14', reps: '10', side2: { weight: '14', reps: '8' } }).side`), undefined, 'le premier côté reste la série');
    assert.equal(run(`recordSet({ weight: '14', reps: '10', side2: { weight: '16', reps: '10', done: false } }).weight`), '14', 'côté pas validé : ignoré');
    const prior = [{ id: 'a', date: 1, programme: 'ppl', category: 'pull', exercises: [{ exId: 'c', name: 'Curl concentration', sets: [{ weight: '14', reps: '9' }] }] }];
    const entry = { id: 'b', date: 2, programme: 'ppl', category: 'pull', exercises: [{ exId: 'c', name: 'Curl concentration', sets: [s] }] };
    const recs = run(`sessionRecords(${S(entry)}, ${S(prior)})`);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].kind, 'reps');
    assert.equal(recs[0].after, 10, 'record battu par le bras droit (10), pas par 8 + 10');
    // Badge en direct : sur la série d'origine, même si le meilleur côté est le second
    const live = run(`(() => { const ex = { exId: 'c', name: 'Curl concentration', sets: [{ weight: '14', reps: '8', done: true, side2: { weight: '14', reps: '10', done: true } }] };
      const b = liveExerciseBadges(ex, sessionPriorOf({ programme: 'ppl', category: 'pull', date: 2 }, ${S(prior)})(ex)); return [b.size, b.get(ex.sets[0]) || ''] })()`);
    sameJSON(live, [1, 'Record reps']);
    // Programme : record et 1RM du meilleur côté (recomputePRFromHistory)
    const pr = run(`(() => { data.programmes.ppl.exercises.pull.unshift({ id: 'c', name: 'Curl concentration', sets: 3 });
      data.history = [${S(entry)}]; recomputePRFromHistory(data); return data.programmes.ppl.exercises.pull[0].pr; })()`);
    sameJSON(pr, { weight: '14', reps: '10' });
  });

  test('unilatéral : second côté pré-rempli avec le premier, drop set de chaque côté', () => {
    reset();
    // Drop set sur un exercice unilatéral : le second côté arrive avec son drop
    const s = run(`(() => { const ex = { name: 'Curl concentration', measure: 'reps', sets: [{ weight: '14', reps: '10', done: false, prev: null }] };
      const s = ex.sets[0]; applyTech(s, 'drop'); techSides(ex, s); return s; })()`);
    assert.equal(s.side2.sub.length, 1, 'drop du bras droit');
    // Tout l'exercice passe par bras, séries validées comprises (bras droit noté à l'identique, validé)
    const all = run(`(() => { const ex = { name: 'Curl concentration', measure: 'reps', sets: [
        { weight: '14', reps: '10', done: true, prev: null }, { weight: '14', reps: '9', done: false, prev: null }, { weight: '14', reps: '9', done: false, prev: null }] };
      applyTech(ex.sets[2], 'drop'); techSides(ex, ex.sets[2]); return ex.sets.map(s => s.side2); })()`);
    assert.equal(all.length, 3);
    assert.ok(all.every(Boolean), 'les trois séries par bras');
    sameJSON([all[0].done, all[0].weight, all[0].reps, 'auto' in all[0]], [true, '14', '10', false], 'série déjà validée : bras droit à l\'identique, validé');
    assert.equal(all[1].done, false);
    // Charge et reps du second côté : celles du premier, tant qu'on n'y touche pas
    assert.equal(run(`side2WeightKg({ weight: '14', reps: '9', side2: { auto: true, weight: '', reps: '' } })`), '14');
    assert.equal(run(`side2RepsGoal({ weight: '14', reps: '9', side2: { auto: true, weight: '', reps: '' } })`), '9');
    assert.equal(run(`side2WeightKg({ weight: '14', side2: { weight: '12' } })`), '12', 'touché : sa propre charge');
    // Premier côté pas encore fait : le second montre sa dernière fois ; fait : ce que le premier vient de faire
    sameJSON(run(`(() => { const s = { weight: '14', reps: '8', done: false, side2: { auto: true, weight: '', reps: '', prev: { weight: '12', reps: '10' } } };
      const a = [side2WeightKg(s), side2RepsGoal(s)]; s.done = true; return [...a, side2WeightKg(s), side2RepsGoal(s)]; })()`), ['12', '10', '14', '8']);
    assert.equal(run(`side2RepsGoal({ weight: '14', reps: '9', side2: { reps: '7' } })`), '7');
    // Drop du second côté : la charge et les reps du drop du premier côté
    const sub = run(`(() => { const s = { weight: '14', reps: '10', tech: 'drop', sub: [{ weight: '10', reps: '6', done: true }], side2: { weight: '14', reps: '10', sub: [{ auto: true, weight: '', reps: '' }] } };
      return [side2SubWeightKg(s, 0), side2SubRepsGoal(s, 0)]; })()`);
    sameJSON(sub, ['10', '6']);
    // « + drop » : un de plus de chaque côté
    assert.equal(run(`(() => { const s = { weight: '14', tech: 'drop', sub: [{}], side2: { sub: [{}] } }; addSubSet(s); return s.side2.sub.length; })()`), 2);
    // Technique retirée : l'exercice reste noté par bras, sans drop
    assert.equal(run(`(() => { const s = { weight: '14', tech: 'drop', sub: [{}], side2: { sub: [{}] } }; applyTech(s, null); return [!!s.side2, 'sub' in s.side2]; })()`).join(), 'true,false');
    // Exercice à deux bras : rien ne change
    assert.equal(run(`(() => { const ex = { name: 'Curl biceps haltères', sets: [{ weight: '14', reps: '10' }] }; applyTech(ex.sets[0], 'drop'); techSides(ex, ex.sets[0]); return 'side2' in ex.sets[0]; })()`), false);
  });

  test('unilatéral : la dernière fois par bras, la série repart par bras avec « Avant » de chaque côté', () => {
    reset();
    const prev = { weight: '14', reps: '10', tech: 'drop', sub: [{ weight: '10', reps: '6' }], side2: { weight: '14', reps: '9', sub: [{ weight: '10', reps: '5' }] } };
    const s = run(`(() => { const s = plannedSet({ weight: '14', reps: '10' }, ${S(prev)}); addSide2(s); return s; })()`);
    sameJSON(s.side2.prev, { weight: '14', reps: '9' });
    assert.equal(s.side2.auto, true);
    // Technique reposée par le programme : le drop du second côté reprend son « Avant »
    const sub = run(`(() => { const s = plannedSet({ weight: '14', reps: '10' }, ${S(prev)}); addSide2(s); applyTech(s, 'drop'); return s.side2.sub[0]; })()`);
    sameJSON(sub.prev, { weight: '10', reps: '5' });
    // Série notée sur une ligne la dernière fois : elle valait pour les deux bras, « Avant » du bras droit = elle
    sameJSON(run(`(() => { const s = plannedSet({ weight: '14', reps: '10' }, { weight: '14', reps: '9' }); addSide2(s); return s.side2.prev; })()`), { weight: '14', reps: '9' });
    // Série ordinaire la dernière fois : plannedSet ne change rien (le passage par bras se décide pour tout l'exercice)
    assert.equal(run(`'side2' in plannedSet({ weight: '14', reps: '10' }, { weight: '14', reps: '10' })`), false);
  });

  test('unilatéral : enchaînement G, G allégé, D, D allégé ; repos seulement après le dernier bloc du second côté', () => {
    reset();
    const mk = (tech, flags) => {
      const [s, a, b, c] = flags;
      return S({ weight: '14', reps: '10', done: s, tech, sub: [{ done: a }], side2: { done: b, sub: [{ done: c }] } });
    };
    sameJSON(run(`setNextStep(${mk('drop', [true, false, false, false])})`)?.k, 0, 'après la série : le drop du premier côté');
    const n2 = run(`setNextStep(${mk('drop', [true, true, false, false])})`);
    sameJSON([n2.side, n2.k], [2, -1], 'puis le second côté');
    const n3 = run(`setNextStep(${mk('drop', [true, true, true, false])})`);
    sameJSON([n3.side, n3.k], [2, 0], 'puis son drop');
    assert.equal(run(`setNextStep(${mk('drop', [true, true, true, true])})`), null, 'tout fait : repos habituel');
    // Pauses : jamais avant l'autre côté ; la courte pause de la technique avant une mini-série
    assert.equal(run(`techPauseAfter(${mk('drop', [true, true, false, false])})`), 0, 'drop fait : bras droit sans repos');
    assert.equal(run(`techPauseAfter(${mk('rp', [true, true, true, false])})`), 15, 'rest-pause : 15 s avant la mini-série du bras droit');
    assert.equal(run(`techPauseAfter(${mk('drop', [true, true, true, true])})`), null);
    // Sans technique : la série, puis l'autre côté sans repos, puis le repos
    assert.equal(run(`techPauseAfter({ weight: '14', reps: '10', side2: { done: false } })`), 0);
    assert.equal(run(`techPauseAfter({ weight: '14', reps: '10', side2: { done: true } })`), null);
    // Drop du premier côté sauté, second côté fait : son drop est l'étape suivante (le sauté reste à remplir)
    const sk = run(`setNextStep(${mk('drop', [true, false, true, false])})`);
    sameJSON([sk.side, sk.k], [2, 0]);
    // techCurrentSub : la carte reste dépliée tant que le second côté attend
    sameJSON(run(`techCurrentSub([{ sets: [${mk(null, [true, false, false, false]).replace('"tech":null,', '')}] }], { ei: 0, si: 0 })`), { ei: 0, si: 0, k: -1, side: 2 });
  });

  test('unilatéral : enregistrement, nettoyage, anciennes séances intactes, synchro et export gardent le second côté', () => {
    reset();
    // Enregistrement : second côté et sous-séries validés seulement
    sameJSON(run(`sideFields({ weight: '14', reps: '10', tech: 'drop', sub: [{ weight: '10', reps: '6', done: true }], side2: { weight: '14', reps: '9', done: true, auto: true, prev: null, byTech: true, sub: [{ weight: '10', reps: '5', done: true }, { weight: '8', reps: '4', done: false }] } }, { doneOnly: true })`),
      { side2: { weight: '14', reps: '9', sub: [{ weight: '10', reps: '5' }] } });
    sameJSON(run(`sideFields({ weight: '14', reps: '10', side2: { weight: '14', reps: '9', done: false } }, { doneOnly: true })`), {}, 'second côté pas fait : rien');
    sameJSON(run(`sideFields({ weight: '14', reps: '10', warmup: true, side2: { weight: '14', reps: '9' } })`), {}, 'jamais sur un échauffement');
    // Nettoyage : bornes, valeurs illisibles retirées, une série sans side2 intacte
    const entry = { id: 'h1', date: 5, programme: 'ppl', category: 'pull', exercises: [{ name: 'Curl concentration', sets: [
      { weight: '14', reps: '10' },
      { weight: '14', reps: '10', side2: { weight: '1e9', reps: '9' } },
      { weight: '14', reps: '10', side2: 'x' },
      { weight: '14', reps: '10', side2: { weight: '14', reps: '9', extra: 1, sub: [{ weight: '10', reps: '5' }] } },
    ] }] };
    const out = run(`(() => { const h = ${S(entry)}; cleanHistoryEntry(h); return h.exercises[0].sets; })()`);
    sameJSON(out[0], { weight: '14', reps: '10' }, 'ancienne série : rien n\'est ajouté');
    assert.equal('side2' in out[1], false, 'charge aberrante : second côté retiré');
    assert.equal('side2' in out[2], false);
    sameJSON(out[3].side2, { weight: '14', reps: '9' }, 'champ inconnu et sous-séries sans technique retirés');
    // Ancienne séance entière : identique après nettoyage (son empreinte de synchro ne change pas)
    const old = { id: 'h0', date: 4, programme: 'ppl', category: 'pull', exercises: [{ name: 'Curl concentration', sets: [{ weight: '14', reps: '10' }, { weight: '14', reps: '8', tech: 'drop', sub: [{ weight: '10', reps: '6' }] }] }] };
    sameJSON(run(`(() => { const h = ${S(old)}; cleanHistoryEntry(h); return h; })()`), old);
    // Synchro : la séance part entière ; export JSON (sanitizeData) et CSV
    const kept = { id: 'h2', date: 6, programme: 'ppl', category: 'pull', exercises: [{ name: 'Curl concentration', sets: [{ weight: '14', reps: '10', tech: 'drop', sub: [{ weight: '10', reps: '6' }], side2: { weight: '14', reps: '9', sub: [{ weight: '10', reps: '5' }] } }] }] };
    sameJSON(run(`sessionPayload(${S(kept)}).exercises[0].sets[0].side2`), kept.exercises[0].sets[0].side2);
    sameJSON(run(`(() => { const d = sanitizeData(normalizeData({ ...makeDefaultData(), history: [${S(kept)}] })); return d.history[0].exercises[0].sets[0].side2; })()`), kept.exercises[0].sets[0].side2);
    const csv = run(`(() => { data.history = [${S(kept)}]; return historyCsv(); })()`).split('\r\n');
    assert.ok(csv.some(l => l.includes(';Curl concentration;1 bras droit;14;9;')), 'CSV : ligne du bras droit');
    assert.ok(csv.some(l => l.includes(';Curl concentration;1.1 bras droit;10;5;;Drop set')), 'CSV : drop du bras droit');
    // Historique : « Drop set S1, bras gauche : … » puis la ligne du bras droit
    const ex = kept.exercises[0];
    sameJSON(run(`[...techLines(${S(ex.sets)}, 'charge', ${S(ex)}), ...sideLines(${S(ex)}, ${S(ex.sets)})]`),
      ['Drop set série 1, bras gauche : 10 kg × 6', 'Bras droit : 14 kg × 9', 'Drop set série 1, bras droit : 10 kg × 5']);
    assert.equal(run(`sidePrefix(${S(ex)}, ${S(ex.sets)})`), 'Bras gauche : ');
    // Premier bras droit, gardé avec la séance : les noms suivent
    assert.equal(run(`sideLines(${S({ ...ex, sideFirst: 'droit' })}, ${S(ex.sets)})[0]`), 'Bras gauche : 14 kg × 9');
  });

  test('unilatéral : comparaisons (une ligne vaut pour les deux bras), compteur, résumé replié, premier bras', () => {
    reset();
    const ex = { name: 'Curl concentration' };
    // Refaire 14 × 10 à l'identique : +0, par bras ou en une ligne
    const once = [{ weight: '14', reps: '10' }], two = [{ weight: '14', reps: '10', side2: { weight: '14', reps: '10' } }];
    assert.equal(run(`comparableVolume(${S(ex)}, ${S(two)}, null, ${S(once)}) - comparableVolume(${S(ex)}, ${S(once)}, null, ${S(two)})`), 0, '+0, pas +140');
    // Deux séances sur une ligne : écart réel (audit du 21/11 : 3 × 14 × 9 puis 3 × 14 × 10 donnait +84 au lieu de +42)
    const l9 = [0, 1, 2].map(() => ({ weight: '14', reps: '9' })), l10 = [0, 1, 2].map(() => ({ weight: '14', reps: '10' }));
    assert.equal(run(`comparableVolume(${S(ex)}, ${S(l10)}, null, ${S(l9)}) - comparableVolume(${S(ex)}, ${S(l9)}, null, ${S(l10)})`), 42, 'deux séances sur une ligne : écart réel');
    assert.equal(run(`comparableVolume({ name: 'Curl biceps haltères' }, ${S(once)}, null, ${S(two)})`), 140, 'deux bras : tel quel');
    // Drop d'une ligne face à une séance par bras : compté pour les deux bras aussi
    assert.equal(run(`comparableVolume(${S(ex)}, [{ weight: '14', reps: '10', tech: 'drop', sub: [{ weight: '10', reps: '6' }] }], null, ${S(two)})`), 2 * (140 + 60));
    // Bilan : deux séances sur une ligne, écart réel
    const sm = run(`(() => { data.history = [
      { id: 'e', date: 2, programme: 'ppl', category: 'pull', exercises: [{ exId: 'c', name: 'Curl concentration', sets: ${S(l10)} }] },
      { id: 'p', date: 1, programme: 'ppl', category: 'pull', exercises: [{ exId: 'c', name: 'Curl concentration', sets: ${S(l9)} }] }];
      const r = buildSummary(data.history[0]); data.history = []; return r.delta; })()`);
    assert.equal(Math.round(sm), 42, "bilan : +42");
    // Progression : le côté le plus faible ; record : le meilleur
    assert.equal(run(`weakSet({ weight: '14', reps: '12', side2: { weight: '14', reps: '10' } }).reps`), '10');
    assert.equal(run(`recordSet({ weight: '14', reps: '12', side2: { weight: '14', reps: '10' } }).reps`), '12');
    // Compteur : la série ne compte qu'une fois le bras droit et son drop faits
    assert.equal(run(`setComplete({ done: true, side2: { done: false } })`), false);
    assert.equal(run(`setComplete({ done: true, tech: 'drop', sub: [{ done: true }], side2: { done: true, sub: [{ done: false }] } })`), false);
    assert.equal(run(`setComplete({ done: true, tech: 'drop', sub: [{ done: true }], side2: { done: true, sub: [{ done: true }] } })`), true);
    assert.equal(run(`setComplete({ done: true })`), true);
    // Résumé replié : le drop et les deux bras se voient
    run(`activeSession = { programme: 'ppl', category: 'pull', exercises: [] }`);
    const ex2 = `{ name: 'Curl concentration', sets: [{ weight: '14', reps: '10', done: true, side2: { weight: '14', reps: '10' } }, { weight: '14', reps: '9', done: true, tech: 'drop', sub: [{ weight: '10', reps: '6' }], side2: { weight: '14', reps: '9' } }] }`;
    assert.equal(run(`doneSummary(${ex2})`).replace(/\u00a0/g, ' '), '2 × 10/9 · 14 kg · 2 bras', '« 2 bras » sur la 1re ligne');
    sameJSON(run(`doneExtraLines(${ex2})`).map(l => l.replace(/\u00a0/g, ' ')), ['Drop : gauche 10 kg × 6 · droit —'], 'drop noté au bras gauche seulement');
    // Drops qui diffèrent : chaque bras ; pareils : une fois
    const dd = (a, b) => `{ name: 'Curl concentration', sets: [{ weight: '14', reps: '10', tech: 'drop', sub: [{ weight: '10', reps: '${a}' }], side2: { weight: '14', reps: '10', sub: [{ weight: '10', reps: '${b}' }] } }] }`;
    sameJSON(run(`doneExtraLines(${dd(6, 5)})`).map(l => l.replace(/\u00a0/g, ' ')), ['Drop : gauche 10 kg × 6 · droit 10 kg × 5']);
    sameJSON(run(`doneExtraLines(${dd(6, 6)})`).map(l => l.replace(/\u00a0/g, ' ')), ['Drop 10 kg × 6']);
    sameJSON(run(`doneExtraLines({ name: 'Curl biceps haltères', sets: [{ weight: '14', reps: '10' }] })`), []);
    // Bras différents : chaque bras sur sa ligne
    sameJSON(run(`doneExtraLines({ name: 'Curl concentration', sets: [{ weight: '14', reps: '10', side2: { weight: '14', reps: '8' } }] })`).map(l => l.replace(/\u00a0/g, ' ')),
      ['Bras gauche : 14 kg × 10', 'Bras droit : 14 kg × 8']);
    run(`activeSession = null`);
    // Premier bras : réglage par exercice, nettoyé
    assert.equal(run(`sideName({ name: 'Curl concentration', sideFirst: 'droit' }, 1)`), 'Bras droit');
    assert.equal(run(`sideName({ name: 'Fentes bulgares', sideFirst: 'droit' }, 2)`), 'Jambe gauche');
    assert.equal(run(`(() => { setSideFirstPref('Curl concentration', 'droit'); return sideFirstPref('curl CONCENTRATION'); })()`), 'droit');
    // Retour au bras gauche : écrit 'gauche' (jamais la clé retirée, sinon l'autre appareil renverrait « droit »)
    assert.equal(run(`(() => { setSideFirstPref('Curl concentration', 'gauche'); return JSON.stringify(data.sideFirst); })()`), '{"curl concentration":"gauche"}');
    // Synchro entre deux appareils : B (droit) reçoit le profil de A revenu au gauche, et le garde
    const sy = run(`(() => {
      const b = data; setSideFirstPref('Curl concentration', 'droit', b);
      const meta = emptySyncMeta('u'); meta.profileHash = syncHash(profilePayload(b)); meta.profileCore = profileCoreHash(profilePayload(b));
      const a = JSON.parse(JSON.stringify(b)); setSideFirstPref('Curl concentration', 'gauche', a);
      applyRemoteProfile(b, { doc: profilePayload(a), updated_at: '2026-11-21T10:00:00Z' }, meta);
      return sideFirstPref('Curl concentration', b); })()`);
    assert.equal(sy, 'gauche', 'synchro : le retour au bras gauche arrive sur l\'autre appareil');
    sameJSON(run(`cleanSideFirst({ a: 'droit', b: 'gauche', c: 1 })`), { a: 'droit', b: 'gauche' });
    // Premier bras changé : « Avant » et valeurs pré-remplies (non touchées) suivent leur bras
    sameJSON(run(`(() => { const s = { weight: '14', reps: '10', done: false, prev: { weight: '14', reps: '10' }, side2: { done: false, auto: true, prev: { weight: '14', reps: '8' } } };
      swapSidePrev(s); return [s.prev.reps, s.side2.prev.reps, s.reps]; })()`), ['8', '10', '8']);
    assert.equal(run(`swapSidePrev({ weight: '14', reps: '10', done: true, prev: {}, side2: { prev: {} } })`), false, 'série faite : rien ne bouge');
    assert.equal(run(`sideMenuActions({ name: 'Curl concentration', sets: [{ weight: '1', reps: '1', done: true, side2: {} }] }).length`), 1, 'premier bras : seulement avant la première série');
    assert.equal(run(`cleanSideFirst('x')`), undefined);
    assert.equal(run(`sideMenuActions({ name: 'Curl concentration', sets: [{ weight: '1', reps: '1', side2: {} }] })[1].label`), 'Commencer par le bras droit');
    assert.equal(run(`sideFieldName({ name: 'Curl concentration' }, 1, 'w')`), 'Charge du bras gauche, en kilos');
    assert.equal(run(`sideFieldName({ name: 'Fentes bulgares' }, 2, 'r')`), 'Répétitions de la jambe droite');
  });
}
