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
    sameJSON(p[0], { weight: '', reps: '', done: false, auto: true, prev: { weight: '46', reps: '5' } });
    assert.equal(p[1].prev, null, '2e drop jamais fait : pas de dernière fois');
    // Charge proposée : celle de la dernière fois si plus légère que la série, sinon 80 % (jamais un drop plus lourd)
    const drop = (w, prevW) => run(`subAutoKg({ weight: '${w}', tech: 'drop', sub: [{ auto: true, prev: { weight: '${prevW}', reps: '5' } }] }, 0)`);
    assert.equal(drop('60', '46'), '46', 'dernière fois 46 sous 60 : repris');
    assert.equal(drop('50', '50'), '40', 'dernière fois 50 = série 50 : 80 %');
    assert.equal(drop('40', '46'), '32', 'série descendue à 40 : 46 serait plus lourd, 80 %');
    assert.equal(run(`subAutoKg({ weight: '80', tech: 'rp', sub: [{ auto: true, prev: { weight: '60', reps: '3' } }] }, 0)`), '80', 'rest-pause : toujours la charge de la série');
    assert.equal(run(`(() => { const s = { tech: 'drop', sub: [] }; for (let i = 0; i < 9; i++) addSubSet(s); return s.sub.length; })()`), 6, '6 au plus');
  });

  test('intensif : sous-série en cours seulement après sa série (une sautée ne retient ni la carte ni l\'écran)', () => {
    const xs = [{ name: 'Squat barre', sets: [
      { weight: '60', reps: '10', done: true, tech: 'drop', sub: [{ done: true }, { done: false }] },
      { weight: '60', reps: '10', done: true },
      { weight: '60', reps: '10', done: false }] }];
    sameJSON(run(`techCurrentSub(${S(xs)}, { ei: 0, si: 0 })`), { ei: 0, si: 0, k: 1, side: 1 });
    assert.equal(run(`techCurrentSub(${S(xs)}, { ei: 0, si: 1 })`), null, 'autre série validée depuis : drop sauté');
    assert.equal(run(`techCurrentSub(${S(xs)}, null)`), null);
    assert.equal(run(`techPending(${S(xs)}, { ei: 0, si: 0 }, 0)`), true);
    assert.equal(run(`techPending(${S(xs)}, { ei: 0, si: 1 }, 0)`), false);
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
    // Panel du 07/11 : « top set puis back-off » était du jargon sur l'écran Envoyer et chez l'élève
    assert.equal(run(`intensLabel('topback')`), '1re série lourde, puis allégées');
    assert.equal(run(`INTENS_PLANS.topback.short`), '1re lourde, puis allégées');
    assert.ok(Object.values(run('INTENS_PLANS')).every(p => !/top set|back-off/i.test(p.label + p.short)), 'aucun terme anglais hors du guide');
    // Menu ⋯ : une seule entrée (« Dernière série en drop set » faisait doublon) ; rien en cardio
    sameJSON(run(`techMenuActions(${S(ex(2))}).map(a => a.value)`), ['tech-pick']);
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
    sameJSON(run(`techLines(${S(sets)})`), ['Lourde série 1 · Allégée séries 2, 3', 'Drop set série 4 : 46 kg × 5 · 36 kg × 4']);
    sameJSON(run(`techLines([{ weight: '', reps: '10', tech: 'rp', sub: [{ weight: '', reps: '4' }] }], 'lest')`), ['Rest-pause série 1 : 4 reps']);
    sameJSON(run(`techLines([{ weight: '20', reps: '8', warmup: true }, { weight: '60', reps: '8', tech: 'cluster', sub: [{ weight: '60', reps: '2' }] }])`), ['Cluster série 1 : 60 kg × 2'], 'numérotation sans l\'échauffement');
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
    // Prise (migration 20261106100000) : valeurs connues de js/data/grips.js seulement, absente s'il n'en reste aucune
    sameJSON(run(`cleanPublicSession({ exercises: [{ name: 'Tirage vertical', grip: { hand: 'neutre', width: 'geante', tool: 'triangle', x: 1 }, sets: [] }] }).exercises[0].grip`), { hand: 'neutre', tool: 'triangle' });
    assert.equal('grip' in run(`cleanPublicSession({ exercises: [{ name: 'Curl', grip: { hand: 'PRONATION', handle: 'corde' }, sets: [] }] }).exercises[0]`), false);
  });

  // ── Sur quelle série (retour d'un coach du 24/11 : « le cluster, j'aimerais le choisir en première série ») ──
  test('intensif : séries choisies, compatibilité (clé d\'avant intacte, champ lié à sa technique)', () => {
    reset();
    // Forme la plus simple : la seule dernière → clé d'avant ; toutes → « X-all » ; sinon « X-last » + intensOn
    sameJSON(run(`intensFieldsFor('cluster', 'last', 4)`), { intens: 'cluster-last' });
    sameJSON(run(`intensFieldsFor('cluster', [4], 4)`), { intens: 'cluster-last' }, 'série 4 sur 4 = dernière');
    sameJSON(run(`intensFieldsFor('cluster', [1], 1)`), { intens: 'cluster-last' }, 'une seule série');
    sameJSON(run(`intensFieldsFor('drop', 'all', 3)`), { intens: 'drop-all' });
    sameJSON(run(`intensFieldsFor('rp', [3, 1, 2, 2], 3)`), { intens: 'rp-all' }, 'les trois cochées = toutes');
    sameJSON(run(`intensFieldsFor('cluster', [1], 4)`), { intens: 'cluster-last', intensOn: { plan: 'cluster-last', sets: [1] } });
    sameJSON(run(`intensFieldsFor('drop', [3, 1, 9], 4)`), { intens: 'drop-last', intensOn: { plan: 'drop-last', sets: [1, 3] } }, 'triées, bornées');
    sameJSON(run(`intensFieldsFor('topback', [2], 4)`), { intens: 'topback' });
    sameJSON(run(`intensFieldsFor('top', [2], 4)`), {});
    sameJSON(run(`intensFieldsFor(null, 'last', 4)`), {});
    // intensOn ne vaut que pour sa clé : une version précédente qui change de technique le rend caduc
    assert.equal(run(`cleanIntensOn({ plan: 'cluster-last', sets: [1] }, 'drop-last')`), null);
    assert.equal(run(`cleanIntensOn({ plan: 'drop-all', sets: [1] }, 'drop-all')`), null, 'jamais avec « toutes »');
    assert.equal(run(`cleanIntensOn({ plan: 'topback', sets: [1] }, 'topback')`), null);
    assert.equal(run(`cleanIntensOn({ plan: 'drop-last', sets: ['1', 0, 11, 2.5] }, 'drop-last')`), null, 'numéros invalides');
    assert.equal(run(`cleanIntensOn([1], 'drop-last')`), null);
    sameJSON(run(`cleanIntensOn({ plan: 'drop-last', sets: [4, 2] }, 'drop-last', 3)`), { plan: 'drop-last', sets: [2] }, 'bornées aux séries');
    // Nettoyage au chargement (sanitizeData) : clé d'avant intacte, champ gardé, retiré s'il ne vaut plus rien
    const v = run(`(() => { const d = makeDefaultData(), xs = d.programmes.ppl.exercises.push;
      xs[0].sets = 4; xs[0].intens = 'cluster-last'; xs[0].intensOn = { plan: 'cluster-last', sets: [1, 5] };
      xs[1].intens = 'drop-last';
      xs[2].intens = 'drop-all'; xs[2].intensOn = { plan: 'cluster-last', sets: [1] };
      xs[3].intensOn = { plan: 'drop-last', sets: [1] };
      sanitizeData(d); return xs.slice(0, 4).map(x => [x.intens ?? null, x.intensOn ?? null]); })()`);
    sameJSON(v, [['cluster-last', { plan: 'cluster-last', sets: [1] }], ['drop-last', null], ['drop-all', null], [null, null]]);
    // Ce que lit l'écran
    const ex = (intens, intensOn, sets = 4) => ({ name: 'Squat barre', sets, intens, ...(intensOn ? { intensOn } : {}) });
    sameJSON(run(`[intensWhereOf(${S(ex('cluster-last'))}), intensWhereOf(${S(ex('cluster-all'))}), intensWhereOf(${S(ex('topback'))}), intensWhereOf(${S(ex('cluster-last', { plan: 'cluster-last', sets: [1, 3] }))})]`),
      ['last', 'all', null, [1, 3]]);
    sameJSON(run(`['last', 'all', [1], [2], [1, 3], [1, 2, 4]].map(intensWhereText)`), ['Dernière', 'Toutes', 'Première', 'Série 2', 'Séries 1 et 3', 'Séries 1, 2 et 4']);
    sameJSON(run(`[${S(ex('cluster-last', { plan: 'cluster-last', sets: [1] }))}, ${S(ex('drop-last', { plan: 'drop-last', sets: [2] }))}, ${S(ex('rp-last', { plan: 'rp-last', sets: [1, 3] }))}, ${S(ex('drop-last'))}, ${S(ex('topback'))}].map(e => [intensText(e), intensText(e, { short: true })])`), [
      ['Première série en cluster', '1re en cluster'], ['Série 2 en drop set', 'série 2 en drop set'], ['Séries 1 et 3 en rest-pause', 'séries 1 et 3 en rest-pause'],
      ['Dernière série en drop set', 'dernière en drop set'], ['1re série lourde, puis allégées', '1re lourde, puis allégées']]);
    assert.equal(run(`intensTechOf(${S(ex('cluster-all'))})`), 'cluster');
    assert.equal(run(`intensTechOf(${S(ex('topback'))})`), 'topback');
  });

  test('intensif : séries choisies posées au démarrage (1re en cluster, 2e en drop, toutes, série absente)', () => {
    reset();
    const ex = n => ({ name: 'Développé couché barre', sets: Array.from({ length: n }, () => ({ weight: '80', reps: '8', done: false, prev: null })) });
    const tech = (plan, on, e = ex(4)) => run(`(() => { const e = ${S(e)}; applyIntensPlan(e, ${S(plan)}, ${S(on)}); return e.sets.map(s => s.tech || null); })()`);
    sameJSON(tech('cluster-last', { plan: 'cluster-last', sets: [1] }), ['cluster', null, null, null], 'cluster en 1re série');
    sameJSON(tech('drop-last', { plan: 'drop-last', sets: [2] }), [null, 'drop', null, null], 'drop set en 2e série');
    sameJSON(tech('rp-last', { plan: 'rp-last', sets: [1, 3] }), ['rp', null, 'rp', null]);
    sameJSON(tech('drop-all', null), ['drop', 'drop', 'drop', 'drop']);
    sameJSON(tech('drop-last', null), [null, null, null, 'drop'], 'sans intensOn : la dernière, comme avant');
    sameJSON(tech('drop-last', { plan: 'cluster-last', sets: [1] }), [null, null, null, 'drop'], 'intensOn d\'une autre technique : ignoré');
    sameJSON(tech('drop-last', { plan: 'drop-last', sets: [6] }), [null, null, null, null], 'série 6 absente de la séance : rien');
    const warm = ex(3); warm.sets.unshift({ weight: '40', reps: '8', warmup: true, done: false });
    sameJSON(tech('cluster-last', { plan: 'cluster-last', sets: [1] }, warm), [null, 'cluster', null, null], '1re série de travail, pas l\'échauffement');
    sameJSON(run(`intensPlanTechs('cluster-last', { plan: 'cluster-last', sets: [1] }, 3)`), ['cluster', null, null]);
    sameJSON(run(`intensPlanTechs('topback', null, 3)`), ['top', 'backoff', 'backoff']);
    sameJSON(run(`intensPlanTechs('xx', null, 2)`), [null, null]);
  });

  test('intensif : technique sur la 1re série, volume, records, 1RM, repos, CSV inchangés dans leurs règles', () => {
    reset();
    // Drop set sur la 1re série : ses drops comptent au volume, jamais aux records ni au nombre de séries
    const sets = [
      { weight: '60', reps: '10', tech: 'drop', sub: [{ weight: '46', reps: '8' }] },
      { weight: '60', reps: '9' },
      { weight: '60', reps: '8' },
    ];
    assert.equal(run(`setsVolume(${S(sets)})`), 600 + 368 + 540 + 480);
    assert.equal(run(`workSets(${S(sets)}).length`), 3);
    const prior = [{ id: 'a', date: 1, programme: 'ppl', category: 'legs', exercises: [{ exId: 'x', name: 'Squat barre', sets: [{ weight: '46', reps: '3' }, { weight: '60', reps: '10' }] }] }];
    const entry = { id: 'b', date: 2, programme: 'ppl', category: 'legs', exercises: [{ exId: 'x', name: 'Squat barre', sets }] };
    sameJSON(run(`sessionRecords(${S(entry)}, ${S(prior)})`), [], 'drop 46 × 8 de la 1re série : pas un record de reps ni de 1RM');
    // Cluster en 1re série : 20 s avant le bloc, puis le repos habituel avant la série 2
    assert.equal(run(`techPauseAfter({ done: true, tech: 'cluster', sub: [{ done: false }] })`), 20);
    assert.equal(run(`techPauseAfter({ done: true, tech: 'cluster', sub: [{ done: true }] })`), null);
    // Historique et CSV : la série nommée par son numéro
    sameJSON(run(`techLines(${S(sets)})`), ['Drop set série 1 : 46 kg × 8']);
    const csv = run(`(() => { data.history = [${S({ ...entry, date: Date.UTC(2026, 10, 24, 10) })}]; return historyCsv(); })()`).split('\r\n');
    assert.ok(csv.some(l => l.includes(';Squat barre;1;60;10;')) && csv.some(l => l.includes(';Squat barre;1.1;46;8;;Drop set')) && csv.some(l => l.includes(';Squat barre;2;60;9;')), 'CSV : 1, 1.1 (drop), 2');
  });

  test('intensif : exercice à un bras, drop set sur la 2e série posé par le programme (chaque bras, volume)', () => {
    reset();
    const e = { name: 'Curl concentration', sets: [1, 2, 3].map(() => ({ weight: '14', reps: '10', done: false, prev: null })) };
    const r = run(`(() => { const e = ${S(e)}; applyIntensPlan(e, 'drop-last', { plan: 'drop-last', sets: [2] }); return e; })()`);
    sameJSON(r.sets.map(s => s.tech || null), [null, 'drop', null]);
    assert.ok(r.sets.every(s => s.side2), 'tout l\'exercice noté par bras');
    assert.equal(r.sets[1].side2.sub?.length, 1, 'le drop existe au bras droit');
    // Tout fait : bras gauche 14 × 10 puis 10 × 6, bras droit 14 × 10 puis 10 × 5 sur la série 2
    const done = [
      { weight: '14', reps: '10', side2: { weight: '14', reps: '10' } },
      { weight: '14', reps: '10', tech: 'drop', sub: [{ weight: '10', reps: '6' }], side2: { weight: '14', reps: '10', sub: [{ weight: '10', reps: '5' }] } },
      { weight: '14', reps: '9', side2: { weight: '14', reps: '9' } },
    ];
    assert.equal(run(`setsVolume(${S(done)})`), 14 * 10 * 4 + 14 * 9 * 2 + 60 + 50);
    sameJSON(run(`techLines(${S(done)}, 'charge', { name: 'Curl concentration' })`), ['Drop set série 2, bras gauche : 10 kg × 6']);
  });

  test('intensif : coach, séries choisies envoyées, nettoyées, importées ; renvoi sans elles : retirées', () => {
    reset();
    const sent = { name: 'Prog coach', sessions: [{ key: 'a', label: 'A', color: '#FF0000', exercises: [
      { name: 'Squat barre', sets: 4, intens: 'cluster-last', intensOn: { plan: 'cluster-last', sets: [1] } },
      { name: 'Presse', sets: 3, intens: 'drop-all', intensOn: { plan: 'drop-last', sets: [2] } }] }] };
    const clean = run(`cleanSentProgramme(${S(sent)})`);
    sameJSON(clean.sessions[0].exercises[0].intensOn, { plan: 'cluster-last', sets: [1] });
    assert.equal('intensOn' in clean.sessions[0].exercises[1], false, 'autre technique : retiré');
    const id = run(`(() => { const d = makeDefaultData(); d.userProgrammes = {}; d.programmes = { ppl: d.programmes.ppl };
      const id = importCoachProgramme(d, { id: 'p_abc124', data: ${S(sent)}, sentAt: 10 }, { user_id: 'c1', username: 'coach' });
      globalThis.__d2 = d; return id; })()`);
    sameJSON(run(`__d2.programmes['${id}'].exercises.a[0].intensOn`), { plan: 'cluster-last', sets: [1] });
    // Le programme du coach, depuis ses propres données : programmeToSent garde le champ
    const out = run(`(() => { const d = makeDefaultData(); const x = d.programmes.ppl.exercises.legs[0]; x.sets = 4; x.intens = 'cluster-last'; x.intensOn = { plan: 'cluster-last', sets: [1] };
      return cleanSentProgramme(programmeToSent(d, 'ppl')).sessions.find(s => s.key === 'legs').exercises[0]; })()`);
    sameJSON([out.intens, out.intensOn], ['cluster-last', { plan: 'cluster-last', sets: [1] }]);
    // Version précédente du coach (pas de intensOn) : la clé seule, chez l'élève la dernière série
    const again = JSON.parse(S(sent)); delete again.sessions[0].exercises[0].intensOn;
    run(`importCoachProgramme(__d2, { id: 'p_abc124', data: ${S(again)}, sentAt: 20 }, { user_id: 'c1', username: 'coach' })`);
    assert.equal(run(`'intensOn' in __d2.programmes['${id}'].exercises.a[0]`), false);
    assert.equal(run(`__d2.programmes['${id}'].exercises.a[0].intens`), 'cluster-last');
  });

  test('intensif : synchro, le champ voyage avec le programme et survit à un profil d\'une version précédente', () => {
    reset();
    // Profil du compte écrit par cet appareil, puis relu sur un autre appareil : intensOn intact
    const doc = run(`(() => { const d = makeDefaultData(); const x = d.programmes.ppl.exercises.push[0]; x.sets = 4; x.intens = 'cluster-last'; x.intensOn = { plan: 'cluster-last', sets: [1] }; return profilePayload(d); })()`);
    const got = run(`(() => { const d = makeDefaultData(); applyRemoteProfile(d, { doc: ${S(doc)}, updated_at: 'z' }, emptySyncMeta('u')); sanitizeData(d); return d.programmes.ppl.exercises.push[0]; })()`);
    sameJSON([got.intens, got.intensOn], ['cluster-last', { plan: 'cluster-last', sets: [1] }]);
    // Une version précédente garde les champs qu'elle ne connaît pas (sanitizeData ne retire que les siens) et ne
    // change que intens : si elle choisit une autre technique, le champ ne vaut plus rien ici
    const old = JSON.parse(S(doc)); old.programmes.ppl.exercises.push[0].intens = 'drop-all';
    const got2 = run(`(() => { const d = makeDefaultData(); applyRemoteProfile(d, { doc: ${S(old)}, updated_at: 'z' }, emptySyncMeta('u')); sanitizeData(d); return d.programmes.ppl.exercises.push[0]; })()`);
    sameJSON([got2.intens, got2.intensOn ?? null], ['drop-all', null]);
  });
}
