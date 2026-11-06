// ═══════════════════════════════════════════════════════════
//  Techniques d'intensification (js/data/intensif.js) : modèle, volume, records, nettoyage,
//  prescription, textes, coach, import (docs/INTENSIFICATION.md)
// ═══════════════════════════════════════════════════════════

export default function ({ test, run, reset, assert, sameJSON }) {
  const S = v => JSON.stringify(v);

  test('intensif : volume avec les sous-séries, séries et records sans elles', () => {
    reset();
    const sets = [
      { weight: '60', reps: '12' },
      { weight: '60', reps: '10', tech: 'drop', sub: [{ weight: '46', reps: '5' }, { weight: '36', reps: '4' }] },
      { weight: '20', reps: '8', warmup: true, tech: 'drop', sub: [{ weight: '10', reps: '8' }] },
    ];
    assert.equal(run(`setsVolume(${S(sets)})`), 60 * 12 + 60 * 10 + 46 * 5 + 36 * 4, 'drops comptés, échauffement jamais');
    assert.equal(run(`exVolume({ name: 'Squat barre' }, ${S(sets)})`), 60 * 22 + 46 * 5 + 36 * 4);
    // Sous-série de la séance en cours non validée : hors volume
    assert.equal(run(`setsVolume([{ weight: '60', reps: '10', tech: 'drop', sub: [{ weight: '46', reps: '5', done: false }] }])`), 600);
    assert.equal(run(`workSets(${S(sets)}).length`), 2, 'une série avec ses drops compte pour une');
    // Records : un drop plus lourd en reps à 46 kg ne compte pas (aucune série de 46 kg à part)
    const prior = [{ id: 'a', date: 1, programme: 'ppl', category: 'legs', exercises: [{ exId: 'x', name: 'Squat barre', sets: [{ weight: '46', reps: '3' }, { weight: '60', reps: '12' }] }] }];
    const entry = { id: 'b', date: 2, programme: 'ppl', category: 'legs', exercises: [{ exId: 'x', name: 'Squat barre', sets: [{ weight: '60', reps: '12', tech: 'drop', sub: [{ weight: '46', reps: '8' }] }] }] };
    sameJSON(run(`sessionRecords(${S(entry)}, ${S(prior)})`), [], 'drop de 46 × 8 après 46 × 3 : pas un record');
  });

  test('intensif : applyTech, sous-série auto à 80 % arrondie, même charge en rest-pause, assistance', () => {
    reset();
    const s = run(`(() => { const s = { weight: '70', reps: '10', done: false, prev: null }; applyTech(s, 'drop'); return s; })()`);
    sameJSON(s.sub, [{ weight: '', reps: '', done: false, auto: true, prev: null }]);
    const barbell = run(`(() => { const s = { weight: '70', reps: '10', tech: 'drop', sub: [{ auto: true }, { auto: true }] };
      const o = { round: v => roundLoad(v, { ...plateSetup(), barbell: true }) }; return [subWeightKg(s, 0, o), subWeightKg(s, 1, o)]; })()`);
    sameJSON(barbell, ['55', '45'], 'barre : 56 → 55, puis 44 → 45');
    assert.equal(run(`subAutoKg({ weight: '2.5', tech: 'drop', sub: [{ auto: true }] }, 0, { round: v => roundLoad(v, { unit: 'kg', barbell: false }) })`), '2.5', 'jamais plus lourd ; 2 → 2,5 gardé à 2,5');
    assert.equal(run(`subAutoKg({ weight: '80', tech: 'rp', sub: [{ auto: true }] }, 0)`), '80', 'rest-pause : même charge');
    assert.equal(run(`subAutoKg({ weight: '30', tech: 'drop', sub: [{ auto: true }] }, 0, { assisted: true })`), '30', 'assistance : même aide');
    assert.equal(run(`subAutoKg({ weight: '', tech: 'drop', sub: [{ auto: true }] }, 0)`), '', 'poids du corps : rien');
    // Livres : 80 % de 100 lb = 80 lb, stocké en kg
    reset({ unit: 'lbs' });
    assert.equal(run(`fmtW(subAutoKg({ weight: String(100 / 2.20462), tech: 'drop', sub: [{ auto: true }] }, 0))`), '80');
    reset();
    // Même technique : rien ; étiquette : pas de sub ; retirer ; échauffement : refusé
    assert.equal(run(`applyTech({ tech: 'drop', sub: [] }, 'drop')`), false);
    sameJSON(run(`(() => { const s = { weight: '50', tech: 'drop', sub: [{}] }; applyTech(s, 'top'); return s; })()`), { weight: '50', tech: 'top' });
    sameJSON(run(`(() => { const s = { weight: '50', tech: 'top' }; applyTech(s, null); return s; })()`), { weight: '50' });
    assert.equal(run(`applyTech({ warmup: true }, 'drop')`), false);
    // Dernière fois : même technique sur la même série → charge et objectif repris
    const p = run(`(() => { const s = { weight: '60', prev: { weight: '60', reps: '12', tech: 'drop', sub: [{ weight: '46', reps: '5' }] } }; applyTech(s, 'drop'); addSubSet(s); return s.sub; })()`);
    sameJSON(p[0], { weight: '46', reps: '', done: false, prev: { weight: '46', reps: '5' } });
    assert.equal(p[1].auto, true, '2e drop jamais fait : charge automatique');
    assert.equal(run(`(() => { const s = { tech: 'drop', sub: [] }; for (let i = 0; i < 9; i++) addSubSet(s); return s.sub.length; })()`), 6, '6 au plus');
  });

  test('intensif : pause après la série (drop 0, rest-pause 15, cluster 20, rien sinon)', () => {
    assert.equal(run(`techPauseAfter({ tech: 'drop', sub: [{ done: false }] })`), 0);
    assert.equal(run(`techPauseAfter({ tech: 'rp', sub: [{ done: false }] })`), 15);
    assert.equal(run(`techPauseAfter({ tech: 'cluster', sub: [{ done: false }] })`), 20);
    assert.equal(run(`techPauseAfter({ tech: 'drop', sub: [{ done: true }] })`), null, 'tout fait : repos habituel');
    assert.equal(run(`techPauseAfter({ tech: 'top' })`), null);
    assert.equal(run(`techPauseAfter({ weight: '10' })`), null);
  });

  test('intensif : nettoyage de l\'historique (bornes, techniques inconnues, ancienne série intacte)', () => {
    reset();
    const st = { weight: '60', reps: '10', tech: 'drop', sub: [{ weight: '46', reps: '5', done: true, prev: {} }, { weight: 'x', reps: '3' }, { weight: '1e9', reps: '3' }, { weight: '', reps: '0' }, { weight: 40, reps: 4 }, 'z'] };
    run(`globalThis.__st = ${S(st)}; cleanTechSet(__st)`);
    sameJSON(run('__st'), { weight: '60', reps: '10', tech: 'drop', sub: [{ weight: '46', reps: '5' }, { weight: '40', reps: '4' }] });
    sameJSON(run(`(() => { const s = { weight: '1', reps: '1', tech: 'drop', sub: [] }; cleanTechSet(s); return s; })()`), { weight: '1', reps: '1' }, 'drop sans drop : retiré');
    sameJSON(run(`(() => { const s = { weight: '1', reps: '1', tech: 'top', sub: [{ weight: '1', reps: '1' }] }; cleanTechSet(s); return s; })()`), { weight: '1', reps: '1', tech: 'top' }, 'étiquette : sans sub');
    sameJSON(run(`(() => { const s = { weight: '1', reps: '1', tech: '__proto__' }; cleanTechSet(s); return s; })()`), { weight: '1', reps: '1' }, 'clé inconnue');
    // Série sans technique : aucun champ ajouté (empreinte de synchro inchangée)
    const old = { weight: '60', reps: '10' };
    sameJSON(run(`(() => { const s = ${S(old)}; cleanTechSet(s); return Object.keys(s); })()`), ['weight', 'reps']);
    // Chargement complet : cleanHistoryEntry garde la technique
    const h = { id: 'h1', date: 5, category: 'push', exercises: [{ name: 'Dips', sets: [{ weight: '10', reps: '8', tech: 'rp', sub: [{ weight: '10', reps: '3' }] }, { weight: '10', reps: '8' }] }] };
    sameJSON(run(`(() => { const x = ${S(h)}; cleanHistoryEntry(x); return x.exercises[0].sets; })()`),
      [{ weight: '10', reps: '8', tech: 'rp', sub: [{ weight: '10', reps: '3' }] }, { weight: '10', reps: '8' }]);
    // Séance qui s'enregistre : sous-séries validées seulement
    sameJSON(run(`techFields({ tech: 'drop', sub: [{ weight: '40', reps: '5', done: true }, { weight: '30', reps: '4', done: false }] }, { doneOnly: true })`), { tech: 'drop', sub: [{ weight: '40', reps: '5' }] });
    sameJSON(run(`techFields({ tech: 'drop', sub: [{ weight: '40', reps: '', done: false, auto: true }] }, { doneOnly: true })`), {});
  });

  test('intensif : prescription du programme (dernière, toutes, top set puis back-off), mesures exclues', () => {
    reset();
    const ex = n => ({ name: 'Développé couché barre', sets: Array.from({ length: n }, () => ({ weight: '80', reps: '8', done: false, prev: null })) });
    const tech = (plan, e = ex(3)) => run(`(() => { const e = ${S(e)}; applyIntensPlan(e, ${S(plan)}); return e.sets.map(s => s.tech || null); })()`);
    sameJSON(tech('drop-last'), [null, null, 'drop']);
    sameJSON(tech('rp-all'), ['rp', 'rp', 'rp']);
    sameJSON(tech('topback'), ['top', 'backoff', 'backoff']);
    sameJSON(tech('topback', ex(1)), ['top']);
    sameJSON(tech('n\'importe quoi'), [null, null, null]);
    const warm = ex(3); warm.sets.unshift({ weight: '40', reps: '8', warmup: true, done: false });
    sameJSON(tech('topback', warm), [null, 'top', 'backoff', 'backoff'], 'échauffement ignoré');
    sameJSON(tech('drop-all', { name: 'Gainage planche', measure: 'time', sets: [{ reps: '60' }] }), [null], 'maintien : jamais');
    const done = ex(2); done.sets[1].done = true;
    sameJSON(tech('drop-last', done), [null, null], 'série déjà faite : laissée');
    assert.equal(run(`cleanIntens('drop-last')`), 'drop-last');
    assert.equal(run(`cleanIntens('toString')`), null);
    assert.equal(run(`intensLabel('topback')`), '1re série top set, puis back-off');
    // Menu ⋯ : drop set de la dernière série, sauf si elle en a déjà un ; rien en cardio
    sameJSON(run(`techMenuActions(${S(ex(2))}).map(a => a.value)`), ['tech-drop-last', 'tech-pick']);
    const dl = ex(2); dl.sets[1].tech = 'drop';
    sameJSON(run(`techMenuActions(${S(dl)}).map(a => a.value)`), ['tech-pick']);
    sameJSON(run(`techMenuActions({ name: 'Course', measure: 'cardio', sets: [] })`), []);
    // Programme nettoyé au chargement
    const v = run(`(() => { const d = makeDefaultData(); d.programmes.ppl.exercises.push[0].intens = 'drop-last'; d.programmes.ppl.exercises.push[1].intens = 'xx'; sanitizeData(d); return [d.programmes.ppl.exercises.push[0].intens, 'intens' in d.programmes.ppl.exercises.push[1]]; })()`);
    sameJSON(v, ['drop-last', false]);
  });

  test('intensif : textes de l\'historique et de l\'image partagée', () => {
    reset();
    const sets = [
      { weight: '100', reps: '3', tech: 'top' },
      { weight: '85', reps: '6', tech: 'backoff' },
      { weight: '85', reps: '6', tech: 'backoff' },
      { weight: '60', reps: '12', tech: 'drop', sub: [{ weight: '46', reps: '5' }, { weight: '36', reps: '4' }] },
    ];
    sameJSON(run(`techLines(${S(sets)})`), ['Top set S1 · Back-off S2, S3', 'Drop set S4 : 46 kg × 5 · 36 kg × 4']);
    sameJSON(run(`techLines([{ weight: '', reps: '10', tech: 'rp', sub: [{ weight: '', reps: '4' }] }], 'lest')`), ['Rest-pause S1 : 4 reps']);
    sameJSON(run(`techLines([{ weight: '20', reps: '8', warmup: true }, { weight: '60', reps: '8', tech: 'cluster', sub: [{ weight: '60', reps: '2' }] }])`), ['Cluster S1 : 60 kg × 2'], 'numérotation sans l\'échauffement');
    assert.equal(run(`techShareText(${S(sets)})`), 'drop set 46 kg × 5 · 36 kg × 4');
    assert.equal(run(`techShareText([{ weight: '60', reps: '8' }])`), '');
    // Image partagée : le détail se termine par le drop
    const entry = { id: 'e', date: Date.now(), programme: 'ppl', category: 'push', exercises: [{ exId: 'x', name: 'Développé couché barre', sets: [{ weight: '60', reps: '10' }, { weight: '60', reps: '8', tech: 'drop', sub: [{ weight: '46', reps: '5' }] }] }] };
    const row = run(`shareStoryStats(${S(entry)}, { history: [] }).highlights[0]`);
    assert.equal(row.sets, '60 kg × 10 · 8, drop set 46 kg × 5');
    assert.equal(run(`shareStoryStats(${S(entry)}, { history: [] }).sets`), 2, 'deux séries, pas trois');
  });

  test('intensif : programme du coach (envoi, nettoyage, import), séance d\'un ami', () => {
    reset();
    const sent = { name: 'Prog coach', sessions: [{ key: 'a', label: 'A', color: '#FF0000', exercises: [
      { name: 'Squat barre', sets: 4, intens: 'drop-last' }, { name: 'Curl', sets: 3, intens: 'nimp' }] }] };
    const clean = run(`cleanSentProgramme(${S(sent)})`);
    assert.equal(clean.sessions[0].exercises[0].intens, 'drop-last');
    assert.equal('intens' in clean.sessions[0].exercises[1], false);
    const id = run(`(() => { const d = makeDefaultData(); d.userProgrammes = {}; d.programmes = { ppl: d.programmes.ppl };
      const id = importCoachProgramme(d, { id: 'p_abc123', data: ${S(sent)}, sentAt: 10 }, { user_id: 'c1', username: 'coach' });
      globalThis.__d = d; return id; })()`);
    assert.equal(run(`__d.programmes['${id}'].exercises.a[0].intens`), 'drop-last');
    // Renvoi sans la technique : retirée chez l'élève
    const again = JSON.parse(S(sent)); delete again.sessions[0].exercises[0].intens;
    run(`importCoachProgramme(__d, { id: 'p_abc123', data: ${S(again)}, sentAt: 20 }, { user_id: 'c1', username: 'coach' })`);
    assert.equal(run(`'intens' in __d.programmes['${id}'].exercises.a[0]`), false);
    // Séance d'un ami ou d'un élève : technique gardée si le serveur la transmet, bornée
    const pub = run(`cleanPublicSession({ exercises: [{ name: 'Squat', sets: [{ weight: 60, reps: 10, tech: 'drop', sub: [{ weight: 46, reps: 5 }] }, { weight: 60, reps: 8, tech: 'xx' }] }] })`);
    sameJSON(pub.exercises[0].sets, [{ weight: '60', reps: '10', tech: 'drop', sub: [{ weight: '46', reps: '5' }] }, { weight: '60', reps: '8' }]);
    // Prise (migration 20261106100000) : ignorée sans js/data/grips.js (branche prise-ergo), gardée nettoyée avec
    const withGrip = `cleanPublicSession({ exercises: [{ name: 'Tirage vertical', grip: { hand: 'neutre', x: 1 }, sets: [] }] }).exercises[0]`;
    assert.equal('grip' in run(withGrip), false);
    run(`globalThis.cleanGrip = g => (g && g.hand === 'neutre' ? { hand: 'neutre' } : null)`);
    try { sameJSON(run(withGrip).grip, { hand: 'neutre' }); } finally { run('delete globalThis.cleanGrip'); }
  });
}
