// ═══════════════════════════════════════════════════════════
//  Import des mesures Hevy (js/data/import-measures.js) : format, unités, jours, doublons, bornes
//  Fichier d'essai : tests/donnees/hevy_mesures_exemple.csv (inventé, au format de l'export Hevy)
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const CSV = fs.readFileSync(path.join(ROOT, 'tests/donnees/hevy_mesures_exemple.csv'), 'utf8');
  const call = (expr, vars = {}) => run(`(() => { ${Object.entries(vars).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join(' ')} return ${expr}; })()`);
  const noon = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
  const HEAD = '"date","weight_kg","fat_percent","neck_cm","shoulder_cm","chest_cm"';

  test('mesures Hevy : en-tête reconnu, fichier des séances et Strong écartés', () => {
    assert.equal(call('isHevyMeasuresHeader(h)', { h: ['date', 'weight_kg', 'fat_percent', 'neck_cm'] }), true);
    assert.equal(call('isHevyMeasuresHeader(h)', { h: ['date', 'weight_lbs', 'chest_in'] }), true);
    assert.equal(call('isHevyMeasuresHeader(h)', { h: ['date', 'waist_cm'] }), true, 'mensuration seule');
    assert.equal(call('isHevyMeasuresHeader(h)', { h: ['title', 'start_time', 'exercise_title', 'weight_kg', 'reps'] }), false, 'séances Hevy');
    assert.equal(call('isHevyMeasuresHeader(h)', { h: ['Date', 'Workout Name', 'Exercise Name', 'Set Order', 'Weight', 'Reps'] }), false, 'Strong');
    assert.equal(call('isHevyMeasuresHeader(h)', { h: ['date', 'fat_percent'] }), false, 'rien que l\'app suive');
    assert.equal(call('readMeasuresCsv(t)', { t: 'a,b\n1,2\n' }).reason, 'format');
    assert.equal(call('readMeasuresCsv(t)', { t: `${HEAD}\n"5 Jan 2026, 00:00",,12,,,\n` }).reason, 'empty', 'masse grasse seule');
  });

  test('mesures Hevy : fichier d\'essai lu (jours, pesées, mensurations, colonnes ignorées)', () => {
    reset();
    const r = call('readMeasuresCsv(t)', { t: CSV });
    assert.equal(r.ok, true);
    assert.equal(r.format, 'hevy_measures');
    sameJSON(r.days.map(x => x.date), [noon(2026, 1, 5), noon(2026, 1, 19), noon(2026, 2, 2), noon(2026, 3, 1)], 'midi du jour, du plus ancien au plus récent');
    assert.equal(r.skippedRows, 2, 'ligne vide et date illisible');
    sameJSON(r.days.map(x => x.kg), [74.2, 73.6, 73.9, 73.1]);
    sameJSON(r.days[0].cm, { neck: 38, shoulders: 118, chest: 101, armL: 35.5, armR: 36, waist: 84, hips: 96, thighL: 58, thighR: 58.5, calf: 37 });
    sameJSON(r.days[1].cm, { waist: 83.5 });
    assert.equal(r.days[2].cm.calf, 37.5, 'mollet gauche vide : celui de droite');
    sameJSON([...r.ignored].sort(), ['abdomen', 'avant-bras', 'masse grasse']);
  });

  test('mesures Hevy : livres et pouces convertis, bornes de la saisie, date future écartée', () => {
    reset();
    const t = '"date","weight_lbs","chest_in","waist_in","neck_cm"\n'
      + '"6 Sep 2026, 08:30",176.4,40,33,500\n'
      + '"7 Sep 2026, 00:00",20,1,,\n'
      + `"1 Jan 2099, 00:00",180,40,,\n`;
    const r = call('readMeasuresCsv(t)', { t });
    assert.equal(r.days.length, 1);
    assert.equal(r.days[0].kg, 80, '176,4 lb → 80 kg');
    sameJSON(r.days[0].cm, { chest: 101.6, waist: 83.8 });
    assert.equal(r.outOfRange, 3, 'cou 500 cm, 20 lb, 1 pouce');
    assert.equal(r.skippedRows, 2, 'ligne sans valeur valable, date future');
  });

  test('mesures Hevy : deux lignes du même jour, la plus tardive l\'emporte', () => {
    reset();
    const t = `${HEAD}\n"6 Sep 2026, 19:00",80.5,,,,100\n"6 Sep 2026, 07:00",80,,38,,99\n`;
    const r = call('readMeasuresCsv(t)', { t });
    assert.equal(r.days.length, 1);
    assert.equal(r.days[0].kg, 80.5);
    sameJSON(r.days[0].cm, { chest: 100, neck: 38 }, 'le cou du matin reste, la poitrine du soir l\'emporte');
  });

  test('mesures Hevy : import dans les pesées et les mensurations, sans doublon par jour', () => {
    reset();
    // Déjà noté dans l'app le 19 janvier : poids et taille gardés
    run(`data.bodyWeightLog = [{ date: ${noon(2026, 1, 19) + 3600000}, kg: 75 }];
         data.bodyMeasures = { waist: [{ date: ${noon(2026, 1, 19)}, cm: 90 }] };`);
    const plan = call('readMeasuresCsv(t)', { t: CSV });
    const r = run(`applyMeasuresImport(${JSON.stringify(plan)})`);
    sameJSON(r, { weights: 3, measures: 30, kept: 2, dropped: 0 });
    sameJSON(run('data.bodyWeightLog.map(p => p.kg)'), [73.1, 73.9, 75, 74.2], 'du plus récent au plus ancien, 19/01 gardé');
    assert.equal(run('data.bodyWeightKg'), 73.1, 'pesée la plus récente du fichier = poids du corps');
    sameJSON(run('data.bodyMeasures.waist.map(p => p.cm)'), [82, 83, 90, 84]);
    assert.equal(run('data.bodyMeasures.calf.length'), 3);
    // Réimport : rien de plus
    const again = run(`applyMeasuresImport(${JSON.stringify(plan)})`);
    sameJSON(again, { weights: 0, measures: 0, kept: 35, dropped: 0 });
    assert.equal(run('data.bodyWeightLog.length'), 4);
    // Donnée relue au lancement : intacte
    run('sanitizeData(data)');
    assert.equal(run('data.bodyMeasures.chest.length'), 3);
  });

  test('mesures Hevy : pesée de l\'app plus récente, poids du corps inchangé', () => {
    reset();
    run(`data.bodyWeightKg = 70; data.bodyWeightLog = [{ date: ${noon(2026, 6, 1)}, kg: 70 }];`);
    const plan = call('readMeasuresCsv(t)', { t: CSV });
    run(`applyMeasuresImport(${JSON.stringify(plan)})`);
    assert.equal(run('data.bodyWeightKg'), 70);
    assert.equal(run('data.bodyWeightLog[0].kg'), 70);
  });
}
