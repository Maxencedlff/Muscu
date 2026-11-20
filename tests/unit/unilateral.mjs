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
    assert.equal(s.side2.byTech, true);
    assert.equal(s.side2.sub.length, 1, 'drop du bras droit');
    // Charge et reps du second côté : celles du premier, tant qu'on n'y touche pas
    assert.equal(run(`side2WeightKg({ weight: '14', reps: '9', side2: { auto: true, weight: '', reps: '' } })`), '14');
    assert.equal(run(`side2RepsGoal({ weight: '14', reps: '9', side2: { auto: true, weight: '', reps: '' } })`), '9');
    assert.equal(run(`side2WeightKg({ weight: '14', side2: { weight: '12' } })`), '12', 'touché : sa propre charge');
    assert.equal(run(`side2RepsGoal({ weight: '14', reps: '9', side2: { reps: '7' } })`), '7');
    // Drop du second côté : la charge et les reps du drop du premier côté
    const sub = run(`(() => { const s = { weight: '14', reps: '10', tech: 'drop', sub: [{ weight: '10', reps: '6', done: true }], side2: { weight: '14', reps: '10', sub: [{ auto: true, weight: '', reps: '' }] } };
      return [side2SubWeightKg(s, 0), side2SubRepsGoal(s, 0)]; })()`);
    sameJSON(sub, ['10', '6']);
    // « + drop » : un de plus de chaque côté
    assert.equal(run(`(() => { const s = { weight: '14', tech: 'drop', sub: [{}], side2: { sub: [{}] } }; addSubSet(s); return s.side2.sub.length; })()`), 2);
    // Technique retirée : le second côté posé par elle (pas fait) part avec elle
    assert.equal(run(`(() => { const s = { weight: '14', tech: 'drop', sub: [{}], side2: { byTech: true, sub: [{}] } }; applyTech(s, null); return 'side2' in s; })()`), false);
    assert.equal(run(`(() => { const s = { weight: '14', tech: 'drop', sub: [{}], side2: { sub: [{}] } }; applyTech(s, null); return [!!s.side2, 'sub' in s.side2]; })()`).join(), 'true,false', 'noté par bras la dernière fois : reste, sans drop');
    // Exercice à deux bras : rien ne change
    assert.equal(run(`(() => { const ex = { name: 'Curl biceps haltères', sets: [{ weight: '14', reps: '10' }] }; applyTech(ex.sets[0], 'drop'); techSides(ex, ex.sets[0]); return 'side2' in ex.sets[0]; })()`), false);
  });

  test('unilatéral : la dernière fois par bras, la série repart par bras avec « Avant » de chaque côté', () => {
    reset();
    const s = run(`plannedSet({ weight: '14', reps: '10' }, { weight: '14', reps: '10', tech: 'drop', sub: [{ weight: '10', reps: '6' }], side2: { weight: '14', reps: '9', sub: [{ weight: '10', reps: '5' }] } })`);
    sameJSON(s.side2.prev, { weight: '14', reps: '9' });
    assert.equal(s.side2.auto, true);
    // Technique reposée par le programme : le drop du second côté reprend son « Avant »
    const sub = run(`(() => { const s = plannedSet({ weight: '14', reps: '10' }, { weight: '14', reps: '10', tech: 'drop', sub: [{ weight: '10', reps: '6' }], side2: { weight: '14', reps: '9', sub: [{ weight: '10', reps: '5' }] } });
      applyTech(s, 'drop'); return s.side2.sub[0]; })()`);
    sameJSON(sub.prev, { weight: '10', reps: '5' });
    // Série ordinaire la dernière fois : rien de nouveau
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
      ['Drop set série 1, bras gauche : 10 kg × 6', 'Série 1, bras droit : 14 kg × 9 · drop set 10 kg × 5']);
  });
}
