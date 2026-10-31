// Records notés dans la séance (js/data/records.js : sessionRecords, renoteRecords, cleanNotedRecords, textes) :
// égaler n'est jamais un record, la première fois ne compte pas, jamais le 1RM estimé ni le niveau d'une machine
export default function ({ test, run, reset, assert, sameJSON }) {
  const DAY = 86400000;
  let n = 0;
  // Séance de l'historique : exercices [[nom, [[poids, reps, extra?]…], extra?]…]
  const h = (day, exercises, extra = {}) => ({ id: 'h' + (++n), programme: 'ppl', category: 'legs', date: day * DAY, ...extra,
    exercises: exercises.map(([name, sets, ex = {}]) => ({ name, ...ex, sets: sets.map(([weight, reps, more = {}]) => ({ weight: String(weight), reps: String(reps), ...more })) })) });
  const recs = (hist) => run(`sessionRecords(__h[__h.length - 1], __h)`, run(`globalThis.__h = ${JSON.stringify(hist)}`));

  test('records notés : charge, reps à charge égale ; égalité, première fois, échauffement et 1RM jamais', () => {
    reset();
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]])]), [], 'première fois : rien');
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]]), h(2, [['Squat barre', [[100, 5]]]])]), [], 'égaler : rien');
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]]), h(2, [['Squat barre', [[102.5, 2], [100, 6]]]])]),
      [{ ex: 'Squat barre', kind: 'charge', before: 100, after: 102.5 }], 'charge d\'abord');
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]]), h(2, [['Squat barre', [[100, 7], [100, 6]]]])]),
      [{ ex: 'Squat barre', kind: 'reps', before: 5, after: 7, w: 100 }]);
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]]), h(2, [['Squat barre', [[90, 10]]]])]), [], '1RM estimé meilleur : jamais noté');
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]]), h(2, [['Squat barre', [[120, 5, { warmup: true }], [100, 5]]]])]), [], 'échauffement plus lourd : rien');
    sameJSON(recs([h(1, [['Squat barre', [[100, 5]]]], { category: 'push' }), h(2, [['Squat barre', [[110, 5]]]])]), [], 'autre séance type : pas de référence');
  });

  test('records notés : lest, aide (moins d\'aide à reps ≥), maintien (plus long à lest ≥, lest à durée ≥)', () => {
    reset();
    sameJSON(recs([h(1, [['Dips', [[10, 8]]]]), h(2, [['Dips', [[15, 5]]]])]), [{ ex: 'Dips', kind: 'lest', before: 10, after: 15 }]);
    const A = 'Tractions assistées (machine)';
    sameJSON(recs([h(1, [[A, [[30, 8]]]]), h(2, [[A, [[25, 8]]]])]), [{ ex: A, kind: 'aide', before: 30, after: 25 }]);
    sameJSON(recs([h(1, [[A, [[30, 8]]]]), h(2, [[A, [[25, 6]]]])]), [], 'moins d\'aide mais moins de reps : rien');
    sameJSON(recs([h(1, [[A, [[30, 8]]]]), h(2, [[A, [[40, 12]]]])]), [], 'plus d\'aide : rien');
    sameJSON(recs([h(1, [[A, [[30, 8]]]]), h(2, [[A, [[30, 10]]]])]), [{ ex: A, kind: 'reps', before: 8, after: 10, w: 30 }]);
    const G = 'Gainage (planche)';
    sameJSON(recs([h(1, [[G, [['', 60]]]]), h(2, [[G, [['', 75]]]])]), [{ ex: G, kind: 'temps', before: 60, after: 75, w: 0 }]);
    sameJSON(recs([h(1, [[G, [['', 60]]]]), h(2, [[G, [[10, 60]]]])]), [{ ex: G, kind: 'lest', before: 0, after: 10 }], 'lest à durée égale');
    sameJSON(recs([h(1, [[G, [['', 60]]]]), h(2, [[G, [[10, 40]]]])]), [], 'lest mais moins longtemps : rien');
    sameJSON(recs([h(1, [[G, [[10, 60]]]]), h(2, [[G, [['', 90]]]])]), [], 'plus long mais sans le lest : rien');
    sameJSON(recs([h(1, [[G, [['', 60]]]]), h(2, [[G, [['', 60]]]])]), [], 'égaler : rien');
  });

  test('records notés : cardio (durée, distance, allure sur distance fixe), jamais le niveau d\'une machine', () => {
    reset();
    const C = 'Course à pied', c = { measure: 'cardio' };
    const r = recs([h(1, [[C, [['', 30, { dist: '6' }]], c]]), h(2, [[C, [['', 31, { dist: '6.4' }]], c]])]);
    sameJSON(r.map(x => x.kind).sort(), ['allure', 'distance', 'duree']);
    const al = r.find(x => x.kind === 'allure');
    sameJSON([al.d, al.before, al.after], [5, 300, Math.round(31 / 6.4 * 60)], 'allure au km sur 5 km');
    // 4 km rapides : rien à 5 km (distance plus courte), mais 1 km battu
    const r2 = recs([h(1, [[C, [['', 30, { dist: '6' }]], c]]), h(2, [[C, [['', 16, { dist: '4' }]], c]])]);
    sameJSON(r2.map(x => [x.kind, x.d]), [['allure', 1]]);
    sameJSON(recs([h(1, [[C, [['', 30, { dist: '6' }]], c]]), h(2, [[C, [['', 30, { dist: '6' }]], c]])]), [], 'même course : rien');
    // Vélo : distance et durée, pas d'allure ; elliptique et escaliers : durée seulement (niveau jamais)
    sameJSON(recs([h(1, [['Vélo', [['', 30, { dist: '10' }]], c]]), h(2, [['Vélo', [['', 25, { dist: '12' }]], c]])]).map(x => x.kind), ['distance']);
    sameJSON(recs([h(1, [['Elliptique', [['', 30, { dist: '4', machine: { level: 8 } }]], c]]), h(2, [['Elliptique', [['', 35, { dist: '5', machine: { level: 12 } }]], c]])]).map(x => x.kind), ['duree']);
    sameJSON(recs([h(1, [['Escaliers', [['', 20, { machine: { level: 8 } }]], c]]), h(2, [['Escaliers', [['', 20, { machine: { level: 14 } }]], c]])]), [], 'niveau plus haut : jamais un record');
    // Rameur : allure aux 500 m sur 2 000 m
    const rw = recs([h(1, [['Rameur', [['', 9, { dist: '2' }]], c]]), h(2, [['Rameur', [['', 8, { dist: '2' }]], c]])]);
    sameJSON(rw.map(x => [x.kind, x.d, x.before, x.after]), [['allure', 2, 135, 120]]);
  });

  test('records notés : renoteRecords après suppression, cleanNotedRecords, textes', () => {
    reset();
    const a = h(1, [['Squat barre', [[100, 5]]]]), b = h(2, [['Squat barre', [[110, 5]]]]);
    run(`globalThis.__h = ${JSON.stringify([b, a])}; __h[0].records = sessionRecords(__h[0], __h)`);
    assert.equal(run('__h[0].records.length'), 1);
    assert.equal(run('renoteRecords(__h[1], __h.slice(0, 1))'), 1, 'la séance d\'avant supprimée : première fois');
    sameJSON(run('__h[0].records'), []);
    sameJSON(run(`cleanNotedRecords([{ ex: 'Squat', kind: 'charge', before: 95, after: 100, x: 1 }, { ex: 'Squat', kind: '1rm', before: 1, after: 2 },
      { ex: 'C', kind: 'allure', before: 300, after: 290 }, { ex: 'C', kind: 'allure', before: 300, after: 290, d: 5 }, { ex: '', kind: 'reps', before: 1, after: 2 }, 'x', { ex: 'S', kind: 'reps', before: '1', after: 2 }])`),
      [{ ex: 'Squat', kind: 'charge', before: 95, after: 100 }, { ex: 'C', kind: 'allure', before: 300, after: 290, d: 5 }]);
    assert.equal(run('cleanNotedRecords(undefined)'), null);
    // Séance d'un ami : le serveur ne donne pas la valeur d'avant (private.session_records), l'élément reste
    sameJSON(run(`cleanNotedRecords([{ ex: 'Squat', kind: 'charge', after: 100 }, { ex: 'Squat', kind: 'charge', before: null, after: 100 }])`),
      [{ ex: 'Squat', kind: 'charge', after: 100 }], 'before absent accepté, before invalide écarté');
    assert.ok(!run(`notedRecordCell({ ex: 'Squat', kind: 'charge', after: 100 })`).includes('avant'), 'sans before : pas de « avant »');
    assert.equal(run(`notedFeedTxt({ ex: 'Squat', kind: 'charge', before: 95, after: 100 })`), 'Squat 100 kg');
    assert.equal(run(`notedFeedTxt({ ex: 'Course à pied', kind: 'allure', before: 300, after: 290, d: 5 })`), 'Course à pied 5 km à 4:50 /km');
    assert.equal(run(`notedValueTxt({ ex: 'Rameur', kind: 'allure', before: 135, after: 120, d: 2 })`), '2:00 /500 m');
    assert.equal(run(`notedLabel({ kind: 'allure', d: 0.5 })`), 'Record 500 m');
    assert.equal(run(`notedValueTxt({ ex: 'Dips', kind: 'reps', before: 8, after: 10, w: 10 }, 'before')`), '8 reps · +10 kg');
    assert.equal(run(`notedValueTxt({ ex: 'Gainage (planche)', kind: 'lest', before: 0, after: 10 }, 'before')`), 'sans lest');
    assert.equal(run(`notedValueTxt({ ex: 'Gainage (planche)', kind: 'temps', before: 60, after: 75, w: 0 })`), '1 min 15');
    assert.equal(run(`topNotedRecord([{ ex: 'C', kind: 'duree', before: 1, after: 2 }, { ex: 'S', kind: 'charge', before: 1, after: 2 }]).ex`), 'S');
    // Séance reçue : échauffement, RIR et records gardés, valeurs invalides écartées
    const s = run(`cleanPublicSession({ records: [{ ex: 'Squat', kind: 'charge', before: 95, after: 100 }], exercises: [{ name: 'Squat', sets: [{ weight: '40', reps: '8', warmup: true }, { weight: '100', reps: '5', rir: 2 }, { weight: '100', reps: '5', warmup: 'true', rir: 9 }] }] })`);
    sameJSON(s.exercises[0].sets, [{ weight: '40', reps: '8', warmup: true }, { weight: '100', reps: '5', rir: 2 }, { weight: '100', reps: '5' }]);
    assert.equal(s.records.length, 1);
    assert.equal(run(`'records' in cleanPublicSession({ exercises: [] })`), false, 'séance d\'avant : pas de records notés');
  });

  test('records notés : entryRecords revalide ceux d\'une sauvegarde importée (records: [null])', () => {
    reset();
    const a = h(1, [['Squat barre', [[100, 5]]]], { records: [null, 'x', { ex: 'Squat barre', kind: 'charge', before: 95, after: 100 }] });
    sameJSON(run(`entryRecords(${JSON.stringify(a)}, [])`), [{ ex: 'Squat barre', kind: 'charge', before: 95, after: 100 }]);
    sameJSON(run(`entryRecords(${JSON.stringify({ ...a, records: [null] })}, [])`), []);
    // Le bilan de la séance (summary.js : summaryNotedRecords…) et l'historique lisent entryRecords : plus de plantage
    assert.doesNotThrow(() => run(`entryRecords(${JSON.stringify({ ...a, records: [null] })}, []).map(r => notedRecordCell(r))`));
  });

  test('records notés : renoteRecordsFrom, une passe par séance type depuis la plus ancienne', () => {
    reset();
    const a = h(1, [['Squat barre', [[100, 5]]]]), b = h(3, [['Squat barre', [[110, 5]]]]), c = h(5, [['Squat barre', [[105, 5]]]]);
    const p = h(2, [['Squat barre', [[120, 5]]]]), q = h(4, [['Squat barre', [[130, 5]]]]);
    run(`globalThis.__h = ${JSON.stringify([c, b, a])}; __h.forEach(x => { x.records = sessionRecords(x, __h); })`);
    assert.equal(run('__h[1].records.length'), 1, 'b bat a');
    run(`__h.push(${JSON.stringify(p)}, ${JSON.stringify(q)})`);
    assert.equal(run('renoteRecordsFrom([__h[4], __h[3], null], __h)'), 1, 'b ne bat plus p ; c ne battait déjà rien');
    sameJSON(run('__h[1].records'), []);
  });

  test('records notés : renoteRecords incrémental = sessionRecords (identifiants, noms, même date, cardio)', () => {
    reset();
    const out = run(`(() => {
      const exs = ['Squat barre', 'Dips', 'Tractions assistées (machine)', 'Gainage (planche)', 'Course à pied', 'Rameur', 'Vélo'];
      let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const H = Array.from({ length: 120 }, (_, i) => ({ id: 'z' + i, programme: 'ppl', category: rnd() < .8 ? 'legs' : 'push',
        date: 1.7e12 + Math.floor(i / 2) * 86400000, records: [],
        exercises: exs.filter(() => rnd() < .7).map(n => ({ name: rnd() < .2 ? n.toUpperCase() : n, ...(rnd() < .3 ? { exId: rnd() < .5 ? 'A' : 'B' } : {}),
          ...(/Course|Rameur|Vélo/.test(n) ? { measure: 'cardio' } : /Gainage/.test(n) ? { measure: 'time' } : {}),
          sets: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({ weight: rnd() < .2 ? '' : String(Math.round(rnd() * 12) * 5),
            reps: String(Math.round(rnd() * 30)), dist: String(Math.round(rnd() * 120) / 10), ...(rnd() < .1 ? { warmup: true } : {}) })) })) }));
      renoteRecordsFrom(H, H);
      return { same: H.every(h => JSON.stringify(h.records) === JSON.stringify(sessionRecords(h, H))), some: H.filter(h => h.records.length).length };
    })()`);
    assert.equal(out.same, true);
    assert.ok(out.some > 10, 'des records sont bien trouvés');
  });

  test('badges en direct : liveSetBadge suit les records notés (toutes mesures), 1RM estimé pour soi seulement', () => {
    reset();
    const T = { measure: 'time' }, C = { measure: 'cardio' }, A = 'Tractions assistées (machine)';
    const H = [h(1, [['Squat barre', [[100, 5]]], ['Dips', [[10, 8]]], ['Gainage (planche)', [['', 60]], T],
      ['Course à pied', [['', 30, { dist: '6' }]], C], [A, [[30, 8]]]])];
    // Séance en cours : même programme et même séance, tout l'historique est « d'avant »
    run(`globalThis.__H = ${JSON.stringify(H)}; globalThis.__P = sessionPriorOf({ programme: 'ppl', category: 'legs', date: 10 * 86400000 }, __H)`);
    // Exercice d'une seule série validée
    const badge = (name, set, ex = {}) => {
      const e = JSON.stringify({ name, ...ex, sets: [{ ...set, done: true }] });
      return run(`(() => { const e = ${e}; return liveSetBadge(e, e.sets[0], __P(e)); })()`);
    };
    assert.equal(badge('Squat barre', { weight: '102.5', reps: '1' }), 'Record charge');
    assert.equal(badge('Squat barre', { weight: '100', reps: '6' }), 'Record reps');
    assert.equal(badge('Squat barre', { weight: '100', reps: '5' }), '', 'égaler n\'est pas battre');
    assert.equal(badge('Squat barre', { weight: '90', reps: '10' }), 'Record 1RM est.', '1RM estimé : badge pour soi');
    assert.equal(badge('Squat barre', { weight: '120', reps: '5', warmup: true }), '', 'échauffement : rien');
    assert.equal(badge('Dips', { weight: '15', reps: '5' }), 'Record lest');
    assert.equal(badge('Gainage (planche)', { weight: '', reps: '75' }, T), 'Record temps');
    assert.equal(badge('Gainage (planche)', { weight: '', reps: '60' }, T), '', 'même maintien : rien');
    assert.equal(badge('Course à pied', { weight: '', reps: '31', dist: '6.4' }, C), 'Record 5 km', 'allure d\'abord (puis distance, durée)');
    assert.equal(badge('Course à pied', { weight: '', reps: '40', dist: '6' }, C), 'Record durée');
    assert.equal(badge(A, { weight: '25', reps: '8' }), 'Record aide');
    assert.equal(badge(A, { weight: '25', reps: '6' }), '', 'moins d\'aide mais moins de reps : rien');
    assert.equal(badge(A, { weight: '10', reps: '12' }), 'Record aide', 'jamais « 1RM » sur une machine d\'assistance');
    assert.equal(badge('Fentes', { weight: '', reps: '12' }), '', 'première fois : rien');
    // Autre séance type : aucune référence
    run(`globalThis.__P = sessionPriorOf({ programme: 'ppl', category: 'push', date: 10 * 86400000 }, __H)`);
    assert.equal(badge('Squat barre', { weight: '200', reps: '5' }), '');
    // Chaque badge (hors 1RM) est exactement le record que l'enregistrement notera
    const cur = h(10, [['Squat barre', [[100, 6]]], ['Gainage (planche)', [['', 75]], T], ['Course à pied', [['', 31, { dist: '6.4' }]], C]]);
    const noted = run(`sessionRecords(${JSON.stringify(cur)}, __H)`).map(r => run(`notedLabel(${JSON.stringify(r)})`));
    run(`globalThis.__P = sessionPriorOf({ programme: 'ppl', category: 'legs', date: 10 * 86400000 }, __H)`);
    const live = cur.exercises.map(ex => run(`(() => { const e = ${JSON.stringify({ ...ex, sets: ex.sets.map(x => ({ ...x, done: true })) })};
      return liveSetBadge(e, e.sets[0], __P(e)); })()`));
    sameJSON(live, ['Record reps', 'Record temps', 'Record 5 km']);
    assert.ok(live.every(l => noted.includes(l)), `badges ${live} notés ${noted}`);
  });

  test('badges en direct sur plusieurs séries : calculés par exercice, chaque record sur la série qui le fait', () => {
    reset();
    const T = { measure: 'time' }, C = { measure: 'cardio' };
    const H = [h(1, [['Squat barre', [[100, 5]]], ['Gainage (planche)', [['', 60]], T], ['Course à pied', [['', 30, { dist: '6' }]], C]])];
    run(`globalThis.__H = ${JSON.stringify(H)}; globalThis.__P = sessionPriorOf({ programme: 'ppl', category: 'legs', date: 10 * 86400000 }, __H)`);
    // Badges des séries d'un exercice (validées sauf { done: false }) et labels des records que l'enregistrement
    // notera pour ces mêmes séries validées
    const both = (name, sets, ex = {}) => {
      const e = { name, ...ex, sets: sets.map(([weight, reps, more = {}]) => ({ weight: String(weight), reps: String(reps), done: true, ...more })) };
      const live = run(`(() => { const e = ${JSON.stringify(e)}; return e.sets.map(s => liveSetBadge(e, s, __P(e))); })()`);
      const saved = { ...h(10, []), exercises: [{ ...e, sets: e.sets.filter(s => s.done) }] };
      const noted = run(`sessionRecords(${JSON.stringify(saved)}, __H)`).map(r => run(`notedLabel(${JSON.stringify(r)})`));
      // Chaque badge (hors 1RM) est un record noté, sur une seule série ; une série qui en fait deux (cardio)
      // montre le plus marquant
      const shown = live.filter(l => l && l !== 'Record 1RM est.');
      assert.equal(new Set(shown).size, shown.length, `un seul badge par record (${live})`);
      assert.ok(shown.every(l => noted.includes(l)), `badges ${live} notés ${noted}`);
      return live;
    };
    // Charge puis reps à la charge d'avant : un seul record (charge), la série qui égale la 1re n'a rien
    sameJSON(both('Squat barre', [[102.5, 2], [100, 6], [102.5, 2]]), ['Record charge', '', '']);
    // À charge record égale, le plus de reps porte le badge (la série que montrent le récap et l'image)
    sameJSON(both('Squat barre', [[102.5, 2], [102.5, 3]]), ['', 'Record charge']);
    // Reps : la 2e série égale la 1re dans la séance, seule la 1re a le badge ; la 3e la dépasse et le prend
    sameJSON(both('Squat barre', [[100, 6], [100, 6]]), ['Record reps', '']);
    sameJSON(both('Squat barre', [[100, 6], [100, 6], [100, 7]]), ['', '', 'Record reps']);
    // Série pas encore validée : ne compte pas
    sameJSON(both('Squat barre', [[100, 6], [102.5, 3, { done: false }]]), ['Record reps', '']);
    // 1RM estimé (pour soi) : seulement sans autre record, sur la meilleure série, jamais sur une égale plus tard
    sameJSON(both('Squat barre', [[90, 10], [90, 10]]), ['Record 1RM est.', '']);
    sameJSON(both('Squat barre', [[90, 10], [102.5, 1]]), ['', 'Record charge']);
    // Maintien : le plus long des deux
    sameJSON(both('Gainage (planche)', [['', 70], ['', 75]], T), ['', 'Record temps']);
    // Cardio sur 2 séries : la distance (6,4 km) et l'allure viennent de la 1re, la durée (40 min) de la 2e
    sameJSON(both('Course à pied', [['', 31, { dist: '6.4' }], ['', 40, { dist: '6.1' }]], C), ['Record 5 km', 'Record durée']);
    sameJSON(both('Course à pied', [['', 29, { dist: '6' }], ['', 33, { dist: '6.5' }]], C), ['Record 5 km', 'Record distance']);
  });

  test('records : notedRecordSet (la série qui fait le record) et e1rmRecordSet (bilan, pour soi)', () => {
    reset();
    const sq = { name: 'Squat barre', sets: [{ weight: '102.5', reps: '2' }, { weight: '102.5', reps: '3' }, { weight: '100', reps: '6' }, { weight: '110', reps: '1', warmup: true }] };
    const set = r => run(`notedRecordSet(${JSON.stringify(sq)}, ${JSON.stringify(r)})`);
    assert.equal(set({ ex: 'Squat barre', kind: 'charge', after: 102.5 }).reps, '3', 'à charge égale : le plus de reps');
    assert.equal(set({ ex: 'Squat barre', kind: 'reps', after: 6, w: 100 }).weight, '100');
    assert.equal(set({ ex: 'Squat barre', kind: 'charge', after: 110 }), null, 'jamais une série d\'échauffement');
    const run5 = { name: 'Course à pied', measure: 'cardio', sets: [{ weight: '', reps: '31', dist: '6.4' }] };
    assert.equal(run(`notedRecordSet(${JSON.stringify(run5)}, { kind: 'allure', d: 5, after: ${Math.round(31 / 6.4 * 60)} })`).dist, '6.4');
    assert.equal(run(`notedRecordSet(${JSON.stringify(run5)}, { kind: 'distance', after: 6.4 })`).reps, '31');
    assert.equal(run(`notedRecordSet(${JSON.stringify(run5)}, { kind: 'allure', d: 10, after: 290 })`), null, 'distance fixe pas atteinte');
    const H = [h(1, [['Squat barre', [[100, 5]]]])];
    const e1 = run(`e1rmRecordSet({ name: 'Squat barre', sets: [{ weight: '80', reps: '12' }, { weight: '90', reps: '10' }, { weight: '100', reps: '5' }] },
      sessionPriorOf({ programme: 'ppl', category: 'legs', date: 5 * 86400000 }, ${JSON.stringify(H)})({ name: 'Squat barre' }))`);
    assert.equal(e1.weight, '90', 'meilleur 1RM estimé au-dessus de celui d\'avant');
    assert.equal(run(`e1rmRecordSet({ name: 'Squat barre', sets: [{ weight: '100', reps: '5' }] }, sessionPriorOf({ programme: 'ppl', category: 'legs', date: 5 * 86400000 }, ${JSON.stringify(H)})({ name: 'Squat barre' }))`), null, 'égaler : rien');
  });
}
