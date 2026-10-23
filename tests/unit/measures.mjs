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
}
