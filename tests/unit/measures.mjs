// Mesures des exercices (js/data/measures.js) : répétitions, durée, cardio
export default function ({ test, run, reset, assert }) {
  test('mesures : bibliothèque, noms libres et choix enregistré', () => {
    reset();
    const m = n => run(`measureOf({ name: ${JSON.stringify(n)} })`);
    assert.equal(m('Gainage (planche)'), 'time');
    assert.equal(m('Planche sur les coudes'), 'time');
    assert.equal(m('Chaise contre le mur'), 'time');
    assert.equal(m('Tapis de course'), 'cardio');
    assert.equal(m('Footing 5 km'), 'cardio');
    assert.equal(m('Rowing machine'), 'reps', 'machine de musculation, pas le rameur');
    assert.equal(m('Développé couché barre'), 'reps', '« velo » dans « developpe » ne compte pas');
    assert.equal(m('Curl marteau'), 'reps');
    assert.equal(run(`measureOf({ name: 'Curl marteau', measure: 'time' })`), 'time');
    assert.equal(run(`measureOf({ name: 'Gainage (planche)', measure: 'reps' })`), 'reps', 'choix explicite prioritaire');
  });

  test('mesures : textes des séries', () => {
    reset();
    const t = (s, m) => run(`measureSetTxt(${JSON.stringify(s)}, '${m}')`);
    assert.equal(t({ weight: '', reps: '45' }, 'time'), '45 s');
    assert.equal(t({ weight: '', reps: '90' }, 'time'), '1 min 30');
    assert.equal(t({ weight: '10', reps: '30' }, 'time'), '30 s · +10 kg');
    assert.equal(t({ weight: '', reps: '30', dist: '5.2' }, 'cardio'), '5,2 km · 30 min');
    assert.equal(t({ weight: '', reps: '20' }, 'cardio'), '20 min');
    assert.equal(t({ weight: '32.5', reps: '8' }, 'reps'), '32,5 kg × 8');
  });

  test('mesures : volume en kg seulement en répétitions, données gardées au nettoyage', () => {
    reset();
    const ex = [
      { name: 'Développé couché barre', sets: [{ weight: '50', reps: '10' }] },
      { name: 'Gainage (planche)', measure: 'time', sets: [{ weight: '10', reps: '60' }] },
      { name: 'Course à pied', measure: 'cardio', sets: [{ weight: '', reps: '30', dist: '5' }] },
    ];
    assert.equal(run(`sessionVolume(${JSON.stringify(ex)})`), 500);
    const h = run(`(() => { const h = { id: 'm1', date: Date.now(), category: 'push', exercises: ${JSON.stringify(ex)} };
      h.exercises[1].sets.push({ weight: '', reps: '1800' }); h.exercises[0].measure = 'bidon';
      cleanHistoryEntry(h); return h; })()`);
    assert.equal(h.exercises[1].sets.length, 2, 'un maintien de 30 min (1800 s) est gardé');
    assert.equal(h.exercises[2].sets[0].dist, '5');
    assert.equal(h.exercises[2].measure, 'cardio');
    assert.equal(h.exercises[0].measure, undefined, 'mesure inconnue retirée');
  });

  test('poids du corps : part soulevée, lest, aide, volume et meilleure série', () => {
    reset();
    const share = n => run(`bodyShare({ name: ${JSON.stringify(n)} })`);
    assert.equal(share('Tractions pronation'), 0.95);
    assert.equal(share('Pull-ups'), 0.95, 'par alias');
    assert.equal(share('Tractions lestées'), 0.95, 'nom libre');
    assert.equal(share('Pompes sur les genoux'), 0.5);
    assert.equal(share('Dips sur chaise'), 0, 'pas de valeur établie : rien inventé');
    assert.equal(share('Tirage vertical prise large'), 0);
    assert.equal(share('Gainage (planche)'), 0, 'durée');
    assert.equal(run(`loadKind({ name: 'Dips' })`), 'lest');
    assert.equal(run(`loadKind({ name: 'Tractions assistées (machine)' })`), 'aide');
    assert.equal(run(`loadKind({ name: 'Curl marteau' })`), 'charge');
    // 8 tractions à 80 kg : 76 kg effectifs ; +10 kg de lest : 86 ; machine qui aide de 20 kg : 56
    assert.equal(run(`exVolume({ name: 'Tractions pronation', sets: [{ weight: '', reps: '8' }] }, undefined, 80)`), 608);
    assert.equal(run(`exVolume({ name: 'Tractions pronation', sets: [{ weight: '10', reps: '8' }] }, undefined, 80)`), 688);
    assert.equal(run(`exVolume({ name: 'Tractions assistées (machine)', sets: [{ weight: '20', reps: '8' }] }, undefined, 80)`), 448);
    assert.equal(run(`exVolume({ name: 'Tractions pronation', sets: [{ weight: '10', reps: '8' }] }, undefined, null)`), 80, 'poids inconnu : le lest seul');
    assert.equal(run(`exVolume({ name: 'Curl marteau', sets: [{ weight: '15', reps: '10' }] }, undefined, 80)`), 150, 'charge : inchangé');
    // Aide : la meilleure série est celle qui a le moins d'aide
    assert.equal(run(`bestSet([{ weight: '30', reps: '8' }, { weight: '20', reps: '6' }], { name: 'Tractions assistées (machine)' }).weight`), '20');
    assert.equal(run(`setTxt({ w: 10, r: 8, weight: '10', reps: '8' }, { name: 'Dips' })`), '8 reps · +10 kg');
    assert.equal(run(`setTxt({ w: 20, r: 8, weight: '20', reps: '8' }, { name: 'Tractions assistées (machine)' })`), '8 reps · aide 20 kg');
    assert.equal(run(`recordLabel({ weight: '15', reps: '5' }, { prW: 10, prR: 5, e1rm: 0 }, { name: 'Dips' })`), 'Record lest');
  });

  test('relecture : noms ambigus, choix « Répétitions » enregistré, objectif +1 rep', () => {
    reset();
    const m = n => run(`measureOf({ name: ${JSON.stringify(n)} })`);
    for (const n of ['Crunch vélo', 'Crunch bicyclette', 'Relevés de jambes en suspension', 'Rowing rameur', 'Tirage rameur'])
      assert.equal(m(n), 'reps', n);
    const mu = n => [...run(`musclesOf(${JSON.stringify(n)}).primary`)];
    assert.ok(mu('Crunch vélo').includes('abs'));
    assert.ok(mu('Relevés de jambes en suspension').includes('abs'));
    assert.ok(mu('Rowing rameur').includes('lats'));
    assert.ok(mu('Suspension passive').includes('forearms'));
    // Un choix qui contredit le nom est enregistré ; sinon rien (répétitions par défaut)
    assert.equal(run(`storedMeasure({ name: 'Tapis de course', measure: 'reps' })`), 'reps');
    assert.equal(run(`storedMeasure({ name: 'Curl marteau' })`), null);
    assert.equal(run(`storedMeasure({ name: 'Gainage (planche)' })`), 'time');
    const h = run(`(() => { const h = { id: 'r1', date: Date.now(), category: 'push', exercises: [{ name: 'Tapis de course', measure: 'reps', sets: [{ weight: '', reps: '12' }] }] }; cleanHistoryEntry(h); return h; })()`);
    assert.equal(h.exercises[0].measure, 'reps', 'choix « Répétitions » gardé au nettoyage');
  });

  test('comment faire : consignes de tous les exercices des programmes, rattachées à la bibliothèque', () => {
    reset();
    run('Object.keys(EXERCISE_HOWTO)').forEach(n => {
      assert.equal(run(`catalogueEntry(${JSON.stringify(n)})?.name`), n, `${n} : absent de la bibliothèque`);
      const h = run(`exerciseHowTo(${JSON.stringify(n)})`);
      assert.ok(h.cues.length >= 3 && h.mistake, n);
    });
    const progNames = run(`[...new Set(Object.values(PROGRAMMES).flatMap(p => Object.values(p.defaults).flatMap(l => l.map(([n]) => n))))]`);
    progNames.forEach(n => assert.ok(run(`exerciseHowTo(${JSON.stringify(n)})`), `${n} : pas de consignes`));
    assert.ok(run(`exerciseHowTo('Pull-ups')`), 'par alias');
    run('Object.keys(EXERCISE_MOVES)').forEach(n => assert.equal(run(`catalogueEntry(${JSON.stringify(n)})?.name`), n));
    assert.equal(run(`exerciseMove('Pompes')`), null, 'mannequin en bâtons retiré');
  });


  test('chrono d\'effort : préparation, décompte, fin à l\'heure exacte, chrono libre', () => {
    const t0 = 1_000_000;
    const c = (now, target = 30) => run(`effortClock({ ei: 0, si: 0, start: ${t0}, target: ${target} }, ${now})`);
    assert.equal(c(t0 - 4200).phase, 'prep');
    assert.equal(c(t0 - 4200).prepLeft, 5);
    assert.equal(c(t0 + 10_400).left, 20);
    assert.equal(c(t0 + 29_999).phase, 'effort');
    const end = c(t0 + 45_000);
    assert.equal(end.phase, 'done', 'fini pendant l\'absence de l\'app');
    assert.equal(end.endAt, t0 + 30_000, 'le repos part de la vraie fin de l\'effort');
    const free = run(`effortClock({ ei: 0, si: 0, start: ${t0}, target: null }, ${t0 + 125_000})`);
    assert.equal(free.phase, 'effort'); assert.equal(free.elapsed, 125); assert.equal(free.left, null);
  });

  test('chrono d\'effort à deux côtés : côté 1, changement de côté, côté 2, fin', () => {
    const t0 = 2_000_000, e = `{ ei: 0, si: 0, start: ${t0}, target: 30, sides: 2 }`;
    const c = now => run(`effortClock(${e}, ${now})`);
    assert.equal(c(t0 + 10_000).side, 1);
    assert.equal(c(t0 + 31_000).phase, 'switch');
    assert.equal(c(t0 + 31_000).switchLeft, 4);
    const s2 = c(t0 + 45_000);
    assert.equal(s2.phase, 'effort'); assert.equal(s2.side, 2); assert.equal(s2.left, 20);
    const end = c(t0 + 70_000);
    assert.equal(end.phase, 'done'); assert.equal(end.endAt, t0 + 65_000, '2 × 30 s + 5 s pour changer');
    assert.equal(run(`bothSides({ name: 'Gainage latéral' })`), true);
    assert.equal(run(`bothSides({ name: 'Gainage (planche)' })`), false);
    assert.equal(run(`bothSides({ name: 'Élévations latérales' })`), false, 'en répétitions : pas de chrono');
  });

  test('tempo : lecture de la notation, sens de départ, horloge des phases', () => {
    const p = v => run(`parseTempo(${JSON.stringify(v)})`);
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
}
