// Machines de cardio (js/data/machine-track.js) : réglage noté au chrono, bilan, nettoyage, allure du
// rameur aux 500 m, et nom de fiche affiché sous un alias (« Pec fly » = Pec deck)
export default function ({ test, run, reset, assert, sameJSON }) {
  test('machines : quelles machines ont le chrono, et pas les autres cardio', () => {
    reset();
    const m = n => run(`machineOf({ name: ${JSON.stringify(n)} })?.name ?? null`);
    assert.equal(m('Escaliers'), 'Escaliers');
    assert.equal(m('StairMaster'), 'Escaliers', 'par alias');
    assert.equal(m('stepper'), 'Escaliers');
    assert.equal(m('Treadmill'), 'Tapis de course');
    assert.equal(m('Vélo d\'appartement'), 'Vélo d\'appartement');
    assert.equal(m('Vélo elliptique'), 'Vélo elliptique');
    assert.equal(m('Rameur'), 'Rameur');
    assert.equal(m('Course à pied'), null, 'dehors : pas de machine');
    assert.equal(m('Vélo'), null);
    assert.equal(m('Développé couché barre'), null);
    assert.equal(run(`machineOf({ name: 'Escaliers', measure: 'reps' })`), null, 'mis en répétitions par la personne');
    assert.equal(run(`measureOf({ name: 'Escaliers' })`), 'cardio');
    assert.equal(run(`measureOf({ name: 'StepMill 20 min' })`), 'cardio', 'nom libre');
    // Toutes les machines existent dans la bibliothèque, en cardio
    run('Object.keys(MACHINES)').forEach(n => assert.equal(run(`catalogueEntry(${JSON.stringify(n)})?.equip`), 'cardio', n));
  });

  test('machines : bornes et pas des −/+, saisie directe ramenée dans la plage', () => {
    reset();
    const slot = n => `MACHINES[${JSON.stringify(n)}].slots[0]`;
    assert.equal(run(`stepMachineValue(null, 'level', 1, ${slot('Escaliers')})`), 1, 'premier toucher : niveau 1');
    assert.equal(run(`stepMachineValue(8, 'level', 1, ${slot('Escaliers')})`), 9);
    assert.equal(run(`stepMachineValue(30, 'level', 1, ${slot('Escaliers')})`), 30, 'plafond des escaliers : 30');
    assert.equal(run(`stepMachineValue(0, 'level', -1, ${slot('Escaliers')})`), 0);
    assert.equal(run(`stepMachineValue(80, 'spm', 1)`), 85, 'marches/min de 5 en 5');
    assert.equal(run(`stepMachineValue(82, 'spm', 1)`), 85, 'saisie hors pas : retour sur la grille');
    assert.equal(run(`stepMachineValue(82, 'spm', -1)`), 80);
    assert.equal(run(`stepMachineValue(10, 'kmh', 1)`), 10.1);
    assert.equal(run(`stepMachineValue(0.2, 'kmh', 1)`), 0.3, 'pas de 0,1 sans erreur d\'arrondi');
    assert.equal(run(`stepMachineValue(null, 'pct', 1)`), 0, 'inclinaison : départ à 0 %, pas au bas de la plage');
    assert.equal(run(`stepMachineValue(0, 'pct', -1)`), -0.5, 'inclinaison négative');
    assert.equal(run(`stepMachineValue(-5, 'pct', -1)`), -5);
    assert.equal(run(`clampMachineValue('12,5', 'kmh')`), 12.5, 'virgule');
    assert.equal(run(`clampMachineValue('99', 'level', ${slot('Escaliers')})`), 30);
    assert.equal(run(`clampMachineValue('99', 'level', ${slot('Vélo d\'appartement')})`), 99, 'vélo de biking gradué en %');
    assert.equal(run(`clampMachineValue('abc', 'level')`), null);
    assert.equal(run(`clampMachineValue('', 'level')`), null);
  });

  test('machines : changements datés, −/+ coup sur coup fusionnés', () => {
    reset();
    const log = run(`(() => { const l = [[0, 8, 'level']];
      machineLogSet(l, 60, 9, 'level'); machineLogSet(l, 61, 10, 'level'); machineLogSet(l, 62, 11, 'level');
      machineLogSet(l, 300, 11, 'level');            // même valeur : rien
      machineLogSet(l, 600, 12, 'level'); machineLogSet(l, 602, 11, 'level');   // aller-retour : annulé
      return l; })()`);
    sameJSON(log, [[0, 8, 'level'], [60, 11, 'level']]);
    const many = run(`(() => { const l = []; for (let i = 0; i < 400; i++) machineLogSet(l, i * 10, i % 2 ? 5 : 6, 'level'); return l; })()`);
    assert.equal(many.length, run('MACHINE_MAX_STEPS'), 'liste bornée');
    sameJSON(many[0], [0, 6, 'level'], 'la première valeur reste');
  });

  test('machines : bilan, moyenne pondérée par le temps et temps à chaque valeur', () => {
    reset();
    // 10 min au niveau 8, 20 min au niveau 11 : moyenne (8×600 + 11×1200) / 1800 = 10
    const sum = run(`machineSummary([[0, 8, 'level'], [600, 11, 'level']], 1800)`);
    assert.equal(sum.units.length, 1);
    assert.equal(sum.units[0].avg, 10);
    sameJSON(sum.units[0].values, [{ v: 11, sec: 1200 }, { v: 8, sec: 600 }], 'valeurs de la plus haute à la plus basse');
    assert.equal(sum.untracked, 0);
    // Même valeur reprise plus tard : temps additionnés
    const back = run(`machineSummary([[0, 8, 'level'], [60, 10, 'level'], [120, 8, 'level']], 180)`);
    sameJSON(back.units[0].values, [{ v: 10, sec: 60 }, { v: 8, sec: 120 }]);
    // Première valeur notée après le départ : le début ne compte dans aucune moyenne
    const late = run(`machineSummary([[120, 9, 'level']], 600)`);
    assert.equal(late.untracked, 120);
    assert.equal(late.units[0].avg, 9);
    // Changement d'unité : jamais converti, deux moyennes ; passage sans valeur non compté
    const two = run(`machineSummary([[0, 10, 'level'], [600, null, 'spm'], [660, 80, 'spm']], 1200)`);
    sameJSON(two.units.map(g => [g.u, g.sec, g.avg]), [['level', 600, 10], ['spm', 540, 80]]);
    assert.equal(two.untracked, 60);
    assert.equal(run(`machineSummary([], 600).units.length`), 0);
  });

  test('machines : texte de la série (historique, séance, Progrès)', () => {
    reset();
    const t = m => run(`machineTxt(${JSON.stringify(m)})`);
    assert.equal(t({ end: 1800, lvl: [[0, 8, 'level'], [600, 11, 'level']], floors: 42 }), 'niveau moy. 10 · 42 étages');
    assert.equal(t({ end: 1200, lvl: [[0, 9, 'level']] }), 'niveau 9', 'une seule valeur : pas de moyenne');
    assert.equal(t({ end: 1800, speed: [[0, 10, 'kmh'], [900, 12, 'kmh']], incl: [[0, 1, 'pct']] }), '11 km/h moy. · 1 %');
    assert.equal(t({ end: 600, lvl: [[0, 10, 'level'], [300, 80, 'spm']] }), 'niveau 10 · 80 marches/min', 'unités séparées');
    assert.equal(t({ end: 480, damper: 5 }), 'résistance 5');
    assert.equal(t(null), '');
    assert.equal(run(`measureSetTxt({ weight: '', reps: '30', machine: { end: 1800, lvl: [[0, 8, 'level']] } }, 'cardio', null)`), '30 min · niveau 8');
  });

  test('machines : départ du chrono repris de la dernière fois, unité comprise', () => {
    reset();
    const st = (name, prev) => run(`machineStart(machineOf({ name: ${JSON.stringify(name)} }), ${JSON.stringify(prev)})`);
    sameJSON(st('Escaliers', null), { lvl: { u: 'level', v: null } }, 'sans dernière fois : rien de supposé');
    sameJSON(st('Escaliers', { end: 900, lvl: [[0, 7, 'level'], [300, 9, 'level']] }), { lvl: { u: 'level', v: 7 } });
    sameJSON(st('Escaliers', { end: 900, lvl: [[0, 70, 'spm'], [300, 85, 'spm']] }), { lvl: { u: 'spm', v: 70 } }, 'marches/min retenues');
    sameJSON(st('Tapis de course', { end: 900, speed: [[0, 6, 'mph']], incl: [[0, 2, 'pct']] }),
      { speed: { u: 'mph', v: 6 }, incl: { u: 'pct', v: 2 } });
    sameJSON(st('Escaliers', { end: 900, lvl: [[0, 99, 'level']] }), { lvl: { u: 'level', v: 30 } }, 'valeur hors plage ramenée');
  });

  test('machines : nettoyage de la séance (store.js), champ inconnu des versions précédentes gardé', () => {
    reset();
    const clean = m => run(`cleanMachine(${JSON.stringify(m)})`);
    sameJSON(clean({ end: 1800, lvl: [[0, 8, 'level'], [600, 11, 'level']], floors: 42 }), { end: 1800, lvl: [[0, 8, 'level'], [600, 11, 'level']], floors: 42 });
    assert.equal(clean({ end: 0 }), null, 'sans durée');
    assert.equal(clean('x'), null);
    sameJSON(clean({ end: 600, lvl: [[0, 8, 'level'], [900, 9, 'level'], [100, 200, 'level'], [50, 1, 'xx'], 'bad'], damper: 99, floors: 2.5, evil: 'x' }),
      { end: 600, lvl: [[0, 8, 'level']] }, 'au-delà de la fin, hors bornes, unité inconnue, extras invalides, clé inconnue : retirés');
    sameJSON(clean({ end: 600, lvl: [[0, 8, 'level'], [30, 7, 'level'], [20, 9, 'level']] }), { end: 600, lvl: [[0, 8, 'level'], [30, 7, 'level']] }, 'temps qui recule');
    sameJSON(clean({ end: 600, lvl: [[0, null, 'level']] }), { end: 600 }, 'aucune valeur notée');
    // Dans une séance de l'historique : gardée, ou retirée si illisible
    const h = run(`(() => { const h = { id: 'a', date: 1, category: 'push', exercises: [{ name: 'Escaliers', measure: 'cardio', sets: [
      { weight: '', reps: '30', machine: { end: 1800, lvl: [[0, 8, 'level']] } }, { weight: '', reps: '10', machine: 'x' }] }] };
      cleanHistoryEntry(h); return h.exercises[0].sets; })()`);
    sameJSON(h[0].machine, { end: 1800, lvl: [[0, 8, 'level']] });
    assert.equal(h[1].machine, undefined);
  });

  test('rameur : temps aux 500 m, calculé depuis la durée exacte du chrono', () => {
    reset();
    // 2 000 m en 7:32 : 1:53 /500 m ; les minutes arrondies (8) donneraient 2:00
    const s = { weight: '', reps: '8', dist: '2', machine: { end: 452 } };
    assert.equal(run(`setMinutes(${JSON.stringify(s)})`), 452 / 60);
    assert.equal(run(`paceTxt(${JSON.stringify(s)}, 'split')`), '1:53 /500 m');
    assert.equal(run(`setMinutes({ reps: '10', machine: { end: 452 } })`), 10, 'durée modifiée à la main : celle saisie');
    assert.equal(run(`paceTxt({ reps: '8', dist: '2' }, 'split')`), '2:00 /500 m', 'saisie à la main');
    assert.equal(run(`spokenPace(cardioPace(2, 452 / 60, 'split'), 'split')`), '1 minute 53 aux 500 mètres');
    assert.equal(run(`cardioPace(20, 8, 'split')`), null, '12 s aux 500 m : faute de frappe');
    assert.equal(run(`measureSetTxt(${JSON.stringify({ ...s, machine: { end: 452, damper: 5 } })}, 'cardio', 'split')`), '2 km · 8 min · 1:53 /500 m · résistance 5');
  });

  test('alias : nom de la fiche affiché sous un nom qui en est un alias (« = Pec deck »)', () => {
    reset();
    const a = n => run(`catalogueAliasOf(${JSON.stringify(n)})`);
    assert.equal(a('Pec fly'), 'Pec deck');
    assert.equal(a('pec fly'), 'Pec deck');
    assert.equal(a('Dead lift'), 'Soulevé de terre');
    assert.equal(a('Pec deck'), null, 'nom de la fiche');
    assert.equal(a('pec  DECK'), null, 'même nom, casse et espaces');
    assert.equal(a('Soulevé de terre'), null);
    assert.equal(a('Mon exercice'), null, 'hors bibliothèque');
    assert.equal(a(''), null);
    const html = run(`aliasNoteHtml('Pec fly')`);
    assert.ok(html.includes('Pec deck') && html.includes('Même exercice que'), html);
    assert.equal(run(`aliasNoteHtml('Pec deck')`), '');
    assert.ok(!run(`aliasNoteHtml('<b>')`).includes('<b>'), 'hors bibliothèque : rien');
  });
}
