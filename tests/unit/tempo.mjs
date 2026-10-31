// ═══════════════════════════════════════════════════════════
//  Tempo des répétitions (js/data/tempo.js, tempoClock de js/data/effort-clock.js)
// ═══════════════════════════════════════════════════════════
//
// Notation lue et réécrite, préréglages, sens de départ selon l'exercice, phrase d'aide et horloge des
// phases du guidage au son. Les cas limites viennent des mutants survivants de Stryker
// (`mutation <dépôt> js/data/tempo.js`, 52 % le 31/10/2026) : phases à 10 s, formes compactes, séparateurs
// en trop, 2 ou 5 phases, minuscules, phrase complète en poussant et en tirant.

export default function ({ test, run, assert, app, sameJSON }) {
  const p = v => run(`parseTempo(${JSON.stringify(v)})`);
  const same = (v, want, msg) => sameJSON(p(v), want, msg ?? JSON.stringify(v));

  test('tempo : lecture de la notation, sens de départ, horloge des phases', () => {
    assert.deepEqual([...p('3-1-1')], [3, 1, 1, 0]);
    assert.deepEqual([...p('31X0')], [3, 1, 'X', 0]);
    assert.deepEqual([...p('3 1 1 2')], [3, 1, 1, 2]);
    assert.equal(p('abc'), null); assert.equal(p('99-0-0-0'), null); assert.equal(p('0-0-0'), null);
    assert.equal(run(`formatTempo(parseTempo('3/1/x'))`), '3-1-X-0');
    assert.equal(run(`concentricFirst('Tractions pronation')`), true);
    assert.equal(run(`concentricFirst('Développé couché haltères')`), false);
    // 3-1-1 en poussant : descente 3 s, pause 1 s, montée 1 s ; 5 s par rep, 2 reps
    const t0 = 5_000_000, e = `{ start: ${t0}, tempo: [3, 1, 1, 0], reps: 2, conFirst: false }`;
    const c = now => run(`tempoClock(${e}, ${now})`);
    assert.equal(c(t0 - 2000).phase, 'prep');
    assert.equal(c(t0 + 500).phase, 'ecc'); assert.equal(c(t0 + 500).phaseLeft, 3);
    assert.equal(c(t0 + 3500).phase, 'bottom');
    assert.equal(c(t0 + 4200).phase, 'con');
    assert.equal(c(t0 + 5100).rep, 2);
    assert.equal(c(t0 + 10_000).phase, 'done'); assert.equal(c(t0 + 10_000).endAt, t0 + 10_000);
    // En tirant : la montée d'abord
    assert.equal(run(`tempoClock({ start: ${t0}, tempo: [3, 1, 1, 0], reps: 2, conFirst: true }, ${t0 + 500})`).phase, 'con');
    assert.equal(run(`concentricFirst('Développé militaire')`), true);
    assert.equal(run(`tempoPrepOf({ tempoPrep: 20 })`), 20);
    assert.equal(run(`tempoPrepOf({ tempoPrep: 7 })`), 10);
    assert.equal(run(`tempoPrepOf({})`), 10);
    assert.equal(run(`concentricFirst('DM haltères')`), true);
    // Reprise à la rep 3 sur 8 : préparation, puis rep 3, fin après 6 reps guidées
    const r = now => run(`tempoClock({ start: ${t0}, tempo: [3, 1, 1, 0], reps: 8, conFirst: false, firstRep: 3 }, ${now})`);
    assert.equal(r(t0 - 1000).phase, 'prep'); assert.equal(r(t0 - 1000).rep, 3);
    assert.equal(r(t0 + 500).rep, 3); assert.equal(r(t0 + 5100).rep, 4);
    assert.equal(r(t0 + 30_000).phase, 'done'); assert.equal(r(t0 + 30_000).endAt, t0 + 30_000);
  });

  test('parseTempo : bornes de 0 à 10 s, 3 ou 4 phases, formes compactes et séparateurs', () => {
    // Bornes : 10 s accepté (deux chiffres), 11 refusé
    same('10-0-1-0', [10, 0, 1, 0], '10 s de descente : accepté');
    same('3-1-10', [3, 1, 10, 0], '10 s en dernière phase');
    assert.equal(p('11-0-1-0'), null, '11 s : refusé');
    assert.equal(p('3-1-1-11'), null, 'pause de 11 s : refusée');
    assert.equal(p('100-0-1'), null, 'trois chiffres dans une phase : refusé');
    // Nombre de phases
    assert.equal(p('3-1'), null, 'deux phases : refusé');
    assert.equal(p('3-1-1-0-2'), null, 'cinq phases : refusé');
    same('3-1-1-2', [3, 1, 1, 2], 'quatre phases gardées telles quelles');
    // Formes compactes de 3 ou 4 caractères, pas plus
    same('311', [3, 1, 1, 0]);
    same('2010', [2, 0, 1, 0]);
    assert.equal(p('31100'), null, 'cinq caractères collés : refusé');
    assert.equal(p('31'), null, 'deux caractères collés : refusé');
    // Minuscules, espaces autour, séparateurs mêlés ou en trop
    same('3-1-x-0', [3, 1, 'X', 0], 'x minuscule');
    same('  3110 ', [3, 1, 1, 0], 'forme compacte entourée d\'espaces');
    same('3.1,1', [3, 1, 1, 0], 'point et virgule');
    same('3 - 1 - 1', [3, 1, 1, 0], 'séparateurs entourés d\'espaces');
    same('3-1-1-', [3, 1, 1, 0], 'séparateur final');
    // Phases illisibles
    assert.equal(p('3-1-1e1'), null, '« 1e1 » n\'est pas 10');
    assert.equal(p('3-1-a'), null);
  });

  test('parseTempo : vide, nul et tout à zéro refusés ; X seul accepté', () => {
    for (const v of ['', '   ', null, undefined, '0-0-0-0', '0000', '000']) assert.equal(p(v), null, JSON.stringify(v));
    same('0-0-X', [0, 0, 'X', 0], 'X compte comme une phase');
    same('0-0-0-1', [0, 0, 0, 1], 'une seule pause : accepté');
  });

  test('formatTempo et shortTempo : écriture usuelle sans pause en haut', () => {
    assert.equal(run('formatTempo(null)'), '', 'rien à écrire');
    assert.equal(run(`formatTempo([2, 0, 'X', 0])`), '2-0-X-0');
    assert.equal(run(`shortTempo('3-1-1-0')`), '3-1-1');
    assert.equal(run(`shortTempo('3110')`), '3-1-1');
    assert.equal(run(`shortTempo('3-1-1-2')`), '3-1-1-2', 'pause en haut : les 4 phases');
    assert.equal(run(`shortTempo('abc')`), '', 'illisible : rien');
    assert.equal(run(`shortTempo(undefined)`), '');
  });

  test('préréglages : libellés et notations lisibles', () => {
    sameJSON(run('TEMPO_PRESETS'), [
      { tempo: '2-0-1-0', label: 'Contrôlé' },
      { tempo: '3-1-1-0', label: 'Lent' },
      { tempo: '4-0-1-0', label: 'Très lent' },
      { tempo: '2-0-X-0', label: 'Explosif' },
    ]);
    for (const { tempo } of run('TEMPO_PRESETS')) assert.equal(run(`formatTempo(parseTempo(${JSON.stringify(tempo)}))`), tempo, tempo);
  });

  test('préparation de la série guidée : 5, 10, 20 ou 30 s, 10 par défaut', () => {
    for (const v of [5, 10, 20, 30]) assert.equal(run(`tempoPrepOf({ tempoPrep: ${v} })`), v);
    assert.equal(run(`tempoPrepOf({ tempoPrep: '20' })`), 20, 'valeur lue en texte');
    for (const v of ['null', 'undefined', '{ tempoPrep: 0 }', '{ tempoPrep: 15 }', '{ tempoPrep: "x" }']) {
      assert.equal(run(`tempoPrepOf(${v})`), 10, v);
    }
  });

  test('applyTempo : tempo, guidage et préparation posés ou retirés ensemble', () => {
    const o = { tempo: '2-0-1-0', tempoGuide: true, tempoPrep: 20 };
    app.applyTempo(o, '3-1-1-0', true);
    sameJSON(o, { tempo: '3-1-1-0', tempoGuide: true, tempoPrep: 20 }, 'préparation de l\'objet gardée');
    app.applyTempo(o, '3-1-1-0', true, { tempoPrep: 5 });
    assert.equal(o.tempoPrep, 5, 'préparation du brouillon');
    app.applyTempo(o, '3-1-1-0', true, { tempoPrep: 7 });
    assert.equal(o.tempoPrep, 10, 'préparation hors des choix : par défaut');
    app.applyTempo(o, '3-1-1-0', false);
    sameJSON(o, { tempo: '3-1-1-0' }, 'rappel seul : ni guidage ni préparation');
    app.applyTempo(o, '', false);
    sameJSON(o, {}, 'tempo retiré');
    const g = {};
    app.applyTempo(g, '', true);
    sameJSON(g, {}, 'guidé sans tempo : rien de posé');
  });

  test('concentricFirst : la descente d\'abord pour pousser, la montée d\'abord pour tirer', () => {
    const eccentricFirst = ['Développé couché', 'Leg press', 'Bench press', 'Pompes', 'Push up', 'Pushup', 'Dips', 'Dip lesté',
      'Squat barre', 'Fentes marchées', 'Lunges', 'Squat bulgare', 'Soulevé de terre roumain', 'RDL', 'Soulevé jambes tendues',
      'Good morning', 'Écarté haltères', 'Pec deck', 'Butterfly', 'Vis-à-vis poulie', 'Crossover', 'Pull over', 'Pullover',
      'Barre au front', 'Skull crusher', 'Extension nuque', 'Extension triceps couché', 'Pistol squat'];
    const concentricFirst = ['Tractions', 'Rowing barre', 'Curl biceps', 'Soulevé de terre', 'Extension triceps poulie', 'Leg curl',
      'Développé militaire', 'Développé épaules', 'Overhead press', 'Shoulder press', 'Arnold press', 'DM haltères', 'Élévations latérales',
      'Dipsomane', 'Indips', '', null];
    for (const n of eccentricFirst) assert.equal(run(`concentricFirst(${JSON.stringify(n)})`), false, `${n} : descente d'abord`);
    for (const n of concentricFirst) assert.equal(run(`concentricFirst(${JSON.stringify(n)})`), true, `${n} : montée d'abord`);
  });

  test('tempoSentence : phrase d\'aide complète, en poussant et en tirant', () => {
    const s = (t, name) => run(`tempoSentence(${JSON.stringify(t)}, ${JSON.stringify(name)})`);
    assert.equal(run('tempoSentence(null)'), '');
    assert.equal(s([3, 1, 1, 0], 'Développé couché'), '3 s pour descendre, 1 s en bas, 1 s pour remonter');
    assert.equal(s([4, 0, 1, 2], 'Squat barre'), '4 s pour descendre, 1 s pour remonter, 2 s en haut');
    assert.equal(s([3, 2, 1, 0], 'Rowing barre'), '3 s pour revenir, 2 s bras ou jambes tendus, 1 s pour tirer');
    assert.equal(s([2, 0, 'X', 1], 'Tractions'), '2 s pour revenir, le plus vite possible pour tirer, 1 s contracté');
    assert.equal(s(['X', 0, 2, 0], 'Pompes'), 'Le plus vite possible pour descendre, 2 s pour remonter', 'majuscule en tête');
    assert.equal(run('tempoSentence([3, 1, 1, 0])'), '3 s pour revenir, 1 s bras ou jambes tendus, 1 s pour tirer', 'sans nom : montée d\'abord');
  });

  test('tempoClock : X guidé comme 1 s, phases à 0 s sautées, comptes à rebours arrondis au-dessus', () => {
    const t0 = 5_000_000;
    // 2-0-X-0 en poussant : descente 2 s, montée 1 s (X), pas de pause ; 3 s par rep, 3 reps
    const c = now => run(`tempoClock({ start: ${t0}, tempo: [2, 0, 'X', 0], reps: 3, conFirst: false }, ${now})`);
    sameJSON(c(t0 - 2500), { phase: 'prep', rep: 1, prepLeft: 3, phaseLeft: 0, endAt: null }, 'préparation : 2,5 s → 3');
    sameJSON(c(t0), { phase: 'ecc', rep: 1, prepLeft: 0, phaseLeft: 2, endAt: t0 + 9000 });
    assert.equal(c(t0 + 999).phaseLeft, 2, 'descente : 1,001 s restante → 2');
    assert.equal(c(t0 + 1000).phaseLeft, 1);
    sameJSON(c(t0 + 2500), { phase: 'con', rep: 1, prepLeft: 0, phaseLeft: 1, endAt: t0 + 9000 }, 'aucune pause en bas');
    sameJSON(c(t0 + 3000), { phase: 'ecc', rep: 2, prepLeft: 0, phaseLeft: 2, endAt: t0 + 9000 }, 'aucune pause en haut');
    assert.equal(c(t0 + 8999).rep, 3);
    sameJSON(c(t0 + 9000), { phase: 'done', rep: 3, prepLeft: 0, phaseLeft: 0, endAt: t0 + 9000 });
    // En tirant, avec les deux pauses : montée 2, haut 2, descente 3, bas 1 (8 s par rep)
    const pull = now => run(`tempoClock({ start: ${t0}, tempo: [3, 1, 2, 2], reps: 1, conFirst: true }, ${now})`).phase;
    assert.deepEqual([0, 2500, 4500, 7500].map(ms => pull(t0 + ms)), ['con', 'top', 'ecc', 'bottom']);
    assert.equal(pull(t0 + 8000), 'done');
    // Sans nombre de reps : jamais fini, les reps continuent
    const free = run(`tempoClock({ start: ${t0}, tempo: [2, 0, 1, 0], conFirst: false }, ${t0 + 30_000})`);
    sameJSON(free, { phase: 'ecc', rep: 11, prepLeft: 0, phaseLeft: 2, endAt: null });
  });
}
