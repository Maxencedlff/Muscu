// ═══════════════════════════════════════════════════════════
//  Ergonomie : objectif du jour en séance (exerciseGoal, goalReached), ligne du bilan (summaryLine),
//  carte « Derniers records » de Progrès, phrase de l'échauffement
// ═══════════════════════════════════════════════════════════

export default function ({ test, run, reset, assert, sameJSON }) {
  const DAY = 86400000;

  // Programme avec un seul exercice de tirage et sa dernière séance
  function seedRow(sets, extra = {}) {
    run(`data.activeProgramme = 'ppl';
      data.programmes.ppl.exercises.pull = [{ id: 'row', name: 'Rowing', sets: 3, ...${JSON.stringify(extra)} }];
      data.history = [{ id: 'h1', programme: 'ppl', category: 'pull', date: Date.now() - ${DAY}, duration: 3000000,
        exercises: [{ exId: 'row', name: 'Rowing', sets: ${JSON.stringify(sets)} }] }];`);
    return 'data.programmes.ppl.exercises.pull[0]';
  }
  const set = (weight, reps, extra = {}) => ({ weight, reps, done: true, ...extra });

  test('exerciseGoal : même texte que l\'accueil (exerciseTarget), avec la série à faire', () => {
    reset();
    let ex = seedRow([{ weight: '32.5', reps: '10' }, { weight: '32.5', reps: '9' }]);
    const g = run(`exerciseGoal('pull', ${ex})`);
    const t = run(`exerciseTarget('pull', ${ex})`);
    sameJSON({ text: g.text, gain: g.gain, before: g.before }, t, 'une seule source : l\'accueil lit la même chose');
    assert.equal(g.text, '32,5 kg × 11');
    sameJSON(g.goal, { w: 32.5, r: 11 }, '+1 rep à la meilleure charge');
    // Haut de la fourchette partout : charge augmentée, à partir du bas de la fourchette
    ex = seedRow([{ weight: '30', reps: '12' }, { weight: '30', reps: '12' }], { repMin: 8 });
    sameJSON(run(`exerciseGoal('pull', ${ex}).goal`), { w: 32.5, r: 8 });
    ex = seedRow([{ weight: '30', reps: '12' }, { weight: '30', reps: '12' }]);
    sameJSON(run(`exerciseGoal('pull', ${ex})`), { text: '32,5 kg × 8', gain: '2,5 kg', before: '30 kg × 12', goal: { w: 32.5, r: 8 } },
      'sans bas réglé : 4 sous le haut de la fourchette, et les reps affichées');
    ex = seedRow([{ weight: '30', reps: '4' }, { weight: '30', reps: '4' }], { repMax: 4 });
    assert.equal(run(`exerciseGoal('pull', ${ex}).goal.r`), 1, 'jamais moins d\'une rep');
    assert.equal(run(`goalRepsAfterBump({ repMin: '' , repMax: 10 })`), 6, 'bas vide : 4 sous le haut');
    // Poids du corps : +1 rep, charge nulle
    ex = seedRow([{ weight: '', reps: '15' }]);
    sameJSON(run(`exerciseGoal('pull', ${ex}).goal`), { w: 0, r: 16 });
    // Jamais fait, ou autre programme demandé : rien à battre
    run('data.history = []');
    assert.equal(run(`exerciseGoal('pull', ${ex}).goal`), null, 'jamais fait');
    ex = seedRow([{ weight: '30', reps: '10' }]);
    assert.equal(run(`exerciseGoal('pull', ${ex}).goal`) !== null, true);
    assert.equal(run(`exerciseGoal('pull', { ...${ex}, name: 'Autre', id: 'zz' }, 'ppl').goal`), null, 'exercice jamais fait');
  });

  test('exerciseGoal : durée et cardio sans objectif chiffré (la dernière fois rappelée)', () => {
    reset();
    const ex = seedRow([{ weight: '', reps: '60' }], { measure: 'time', name: 'Gainage' });
    run("data.history[0].exercises[0].name = 'Gainage'; data.history[0].exercises[0].measure = 'time';");
    const g = run(`exerciseGoal('pull', ${ex})`);
    assert.equal(g.goal, null);
    assert.equal(g.gain, '');
  });

  test('goalReached : une série de travail validée atteint la charge et les reps', () => {
    reset();
    const goal = { w: 32.5, r: 11 };
    assert.equal(run(`goalReached(${JSON.stringify(goal)}, ${JSON.stringify([set('32.5', '11')])})`), true, 'égalité : atteint');
    assert.equal(run(`goalReached(${JSON.stringify(goal)}, ${JSON.stringify([set('35', '12')])})`), true, 'mieux : atteint');
    assert.equal(run(`goalReached(${JSON.stringify(goal)}, ${JSON.stringify([set('32.5', '10')])})`), false, 'une rep de moins');
    assert.equal(run(`goalReached(${JSON.stringify(goal)}, ${JSON.stringify([set('30', '15')])})`), false, 'plus de reps, charge plus légère');
    assert.equal(run(`goalReached(${JSON.stringify(goal)}, ${JSON.stringify([{ weight: '32.5', reps: '11', done: false }])})`), false, 'pas validée');
    assert.equal(run(`goalReached(${JSON.stringify(goal)}, ${JSON.stringify([set('32.5', '11', { warmup: true })])})`), false, 'échauffement');
    assert.equal(run(`goalReached({ w: 0, r: 16 }, ${JSON.stringify([set('', '16')])})`), true, 'poids du corps');
    assert.equal(run(`goalReached(null, ${JSON.stringify([set('99', '99')])})`), false, 'sans objectif');
    // Charge en lbs convertie à l'enregistrement : arrondi au centième, pas de faux « raté »
    assert.equal(run(`goalReached({ w: 102.0582, r: 5 }, ${JSON.stringify([set('102.06', '5')])})`), true);
  });

  // ── Bilan ──

  const sm = (records, rows) => ({ records, recordCount: records.length, rows, date: Date.now() });
  const row = (name, gain = null) => ({ name, gain });

  test('summaryLine : records puis la plus forte progression, le nom dans la phrase', () => {
    reset();
    assert.equal(run(`summaryLine(${JSON.stringify(sm([{}], [row('Développé couché', { r: 1 })]))}, 3)`), '1 record battu · +1 rep sur développé couché');
    assert.equal(run(`summaryLine(${JSON.stringify(sm([{}, {}], []))}, 3)`), '2 records battus');
    // Une hausse de charge passe avant des reps en plus, la plus forte d'abord
    const rows = [row('Curl', { r: 3 }), row('Squat barre', { w: 2.5 }), row('Presse', { w: 10 }), row('Dips')];
    assert.equal(run(`summaryLine(${JSON.stringify(sm([], rows))}, 3)`), '+10 kg sur presse');
    assert.equal(run(`summaryLine(${JSON.stringify(sm([], [row('Curl', { r: 2 })]))}, 3)`), '+2 reps sur curl');
    assert.equal(run(`summaryLine(${JSON.stringify(sm([], [row('RDL', { r: 1 })]))}, 3)`), '+1 rep sur RDL', 'sigle gardé');
    assert.equal(run(`summaryLine(${JSON.stringify(sm([], [row('Élévations latérales', { w: 1 })]))}, 3)`), '+1 kg sur élévations latérales');
  });

  test('summaryLine : le 1RM estimé (pour soi) ne compte pas comme record battu, même règle que l\'historique', () => {
    reset();
    const one = { records: [{ name: 'Squat', label: 'Record 1RM est.' }], recordCount: 0, rows: [], date: Date.now() };
    assert.equal(run(`summaryLine(${JSON.stringify(one)}, 2)`), 'Séance faite · 2 cette semaine');
    const e = { id: 'x', programme: 'ppl', category: 'push', date: Date.now(), exercises: [], records: [{ ex: 'Squat', kind: 'charge', before: 100, after: 102.5 }] };
    assert.equal(run(`recordCount(${JSON.stringify(e)}, [])`), 1);
  });

  test('summaryLine : rien de battu, la régularité de la semaine', () => {
    reset();
    assert.equal(run(`summaryLine(${JSON.stringify(sm([], [row('Squat')]))}, 3)`), 'Séance faite · 3 cette semaine');
    assert.equal(run(`summaryLine(${JSON.stringify(sm([], []))}, 1)`), 'Séance faite · la 1re cette semaine');
    // Par défaut : les séances de la semaine de la séance, elle comprise
    run(`data.history = [{ id: 'a', programme: 'ppl', category: 'push', date: Date.now(), exercises: [] }]`);
    assert.equal(run(`summaryLine(${JSON.stringify(sm([], []))})`), 'Séance faite · la 1re cette semaine');
  });

  test('buildSummary : gain de la meilleure série, en lbs dans la ligne', () => {
    reset();
    const ex = (w, r) => ({ exId: 'bench', name: 'Développé couché', sets: [{ weight: w, reps: r }] });
    const now = Date.now();
    run(`data.history = ${JSON.stringify([
      { id: 'new', programme: 'ppl', category: 'push', date: now, exercises: [ex('62.5', '8'), { exId: 'dips', name: 'Dips', sets: [{ weight: '', reps: '12' }] }] },
      { id: 'old', programme: 'ppl', category: 'push', date: now - 4 * DAY, exercises: [ex('60', '8'), { exId: 'dips', name: 'Dips', sets: [{ weight: '', reps: '10' }] }] },
    ])}`);
    const s = run('buildSummary(data.history[0])');
    sameJSON(s.rows.map(r => r.gain), [{ w: 2.5 }, { r: 2 }]);
    assert.ok(run('summaryLine(buildSummary(data.history[0]), 2)').endsWith('+2,5 kg sur développé couché'));
    run("data.unit = 'lbs'");
    assert.ok(run('summaryLine(buildSummary(data.history[0]), 2)').endsWith('+5,5 lbs sur développé couché'));
  });

  // ── Progrès ──

  test('Progrès : carte « Derniers records », les 3 plus récents, absente sans record', () => {
    reset();
    run('data.history = []');
    assert.equal(run('statsRecordsHtml()'), '');
    const rec = (ex, after) => ({ ex, kind: 'charge', before: after - 2.5, after });
    const entries = ['Squat', 'Rowing', 'Développé couché', 'Curl'].map((n, i) => ({
      id: 'h' + i, programme: 'ppl', category: 'push', date: Date.now() - i * DAY, exercises: [], records: [rec(n, 50 + i)] }));
    run(`data.history = ${JSON.stringify(entries)}`);
    const html = run('statsRecordsHtml()');
    assert.ok(html.includes('Derniers records'));
    assert.equal((html.match(/class="cell rec-row"/g) || []).length, 3, 'trois lignes');
    assert.ok(html.includes('Squat') && html.includes('Développé couché') && !html.includes('Curl'), 'les plus récents');
    assert.ok(html.includes('2,5 kg'), 'gain affiché');
    assert.ok(!run(`recordRowsHtml([{ ex: '<img onerror=x>', date: Date.now(), r: { kind: 'charge', after: 50 } }])`).includes('<img'), 'nom échappé');
  });

  // ── Échauffement ──

  test('échauffement : phrase simple, au nombre réel de séries', () => {
    assert.equal(run('warmupNoteText(3)'), '3 séries légères pour préparer tes muscles. Elles ne comptent pas dans tes records.');
    assert.equal(run('warmupNoteText(1)'), '1 série légère pour préparer tes muscles. Elle ne compte pas dans tes records.');
  });

  // ── Feuille « Ajouter un exercice » ──

  test('axSections : récents (5), puis les autres déjà faits, puis mêmes muscles jamais faits, puis le reste', () => {
    reset();
    const h = (id, daysAgo, names) => ({ id, programme: 'ppl', category: 'push', date: Date.now() - daysAgo * DAY,
      exercises: names.map(name => ({ name, sets: [{ weight: '20', reps: '10' }] })) });
    const history = [
      h('b', 1, ['Curl biceps haltères', 'Squat barre']),
      h('a', 5, ['Rowing barre', 'Curl biceps haltères', 'Leg curl machine']),
    ];
    const names = ['Curl biceps haltères', 'Squat barre', 'Rowing barre', 'Leg curl machine', 'Écarté haltères plat',
      'Pompes', 'Développé incliné haltères', 'Crunch'];
    const s = run(`axSections(${JSON.stringify(names)}, ['Développé couché haltères'], ${JSON.stringify(history)})`);
    sameJSON(s.recent, ['Curl biceps haltères', 'Squat barre', 'Rowing barre', 'Leg curl machine'], 'ordre de la dernière fois, sans doublon');
    assert.ok(s.same.includes('Écarté haltères plat') && s.same.includes('Développé incliné haltères') && s.same.includes('Pompes'), `pectoraux : ${s.same}`);
    assert.ok(!s.same.includes('Crunch'), 'abdominaux : pas les mêmes muscles');
    assert.equal(s.rest.join(), 'Crunch', 'le reste');
    // Un exercice absent de names (déjà dans la séance, filtré par le matériel) n'apparaît nulle part
    const s2 = run(`axSections(${JSON.stringify(names.filter(n => n !== 'Squat barre'))}, [], ${JSON.stringify(history)})`);
    assert.ok(!s2.recent.includes('Squat barre'));
    sameJSON(s2.same, [], 'séance vide : pas de section « Mêmes muscles »');
    // 5 récents au plus
    const many = Array.from({ length: 12 }, (_, i) => `Exo ${i}`);
    const s3 = run(`axSections(${JSON.stringify(many)}, [], ${JSON.stringify([h('c', 1, many)])})`);
    assert.equal(s3.recent.length, 5);
    assert.equal(s3.done.length, 7, 'les autres exercices faits suivent, dans l\'ordre');
    assert.equal(s3.rest.length, 0);
    // 7 exercices faits : les 5 plus récents en « Récents », les 2 autres en tête du reste, avant le catalogue
    // (ordre d'exerciseLibrary gardé, jamais trié de A à Z)
    const doneNames = ['Squat barre', 'Presse à cuisses', 'Fentes marchées haltères', 'Leg curl machine', 'Extension quadriceps', 'Mollets debout', 'Curl marteau'];
    const lib = [...doneNames, 'Abducteurs machine', 'Burpees', 'Curl biceps barre', 'Zercher squat'];
    const s4 = run(`axSections(${JSON.stringify(lib)}, ['Crunch'], ${JSON.stringify([h('d', 1, doneNames.slice(0, 6)), h('e', 3, ['Curl marteau'])])})`);
    sameJSON(s4.recent, doneNames.slice(0, 5));
    sameJSON(s4.done, ['Mollets debout', 'Curl marteau'], `déjà faits, juste après les récents : ${s4.done}`);
    sameJSON(s4.rest, ['Abducteurs machine', 'Burpees', 'Curl biceps barre', 'Zercher squat'], 'catalogue dans son ordre');
    // Mêmes muscles : seulement des exercices jamais faits (les faits sont déjà plus haut)
    const s5 = run(`axSections(${JSON.stringify([...doneNames.slice(0, 5), 'Curl concentré', 'Curl biceps barre'])}, ['Curl biceps haltères'],
      ${JSON.stringify([h('g', 1, doneNames.slice(0, 5)), h('i', 9, ['Curl concentré'])])})`);
    sameJSON(s5.done, ['Curl concentré']);
    sameJSON(s5.same, ['Curl biceps barre'], `${s5.same}`);
    // Jamais rien perdu ni doublé
    assert.equal(s.recent.length + s.done.length + s.same.length + s.rest.length, names.length);
  });
}
