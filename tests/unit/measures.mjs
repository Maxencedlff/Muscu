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
}
