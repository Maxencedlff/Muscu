// Objectifs du jour (docs/NUTRITION_V1.md, « Objectifs du jour ») : proposition estimée et protéines en g/kg.
// Valeurs de référence calculées à la main (Mifflin-St Jeor 1990) dans les commentaires.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const est = o => run(`dietEstimate(${JSON.stringify(o)})`);

  test('objectifs : métabolisme de base de Mifflin-St Jeor (homme + 5, femme − 161)', () => {
    // Homme 74,5 kg, 180 cm, 25 ans : 745 + 1 125 − 125 + 5 = 1 750
    assert.equal(run(`dietBmr({ sex: 'male', kg: 74.5, cm: 180, age: 25 })`), 1750);
    // Femme 60 kg, 165 cm, 30 ans : 600 + 1 031,25 − 150 − 161 = 1 320,25
    assert.equal(run(`dietBmr({ sex: 'female', kg: 60, cm: 165, age: 30 })`), 1320.25);
  });

  test('objectifs : proposition, profil 1 (homme 74,5 kg, prise de masse, 3 à 5 séances)', () => {
    // Dépense 1 750 × 1,55 = 2 712,5 ; + 10 % = 2 983,75 → 2 980 kcal
    // P 1,8 × 74,5 = 134,1 → 134 ; L max(0,9 × 74,5 = 67,05 ; 20 % de 2 980 / 9 = 66,2) → 67
    // G (2 980 − 4 × 134 − 9 × 67) / 4 = 1 841 / 4 = 460,25 → 460
    const r = est({ sex: 'male', kg: 74.5, cm: 180, age: 25, activity: 'mid', goal: 'gain' });
    sameJSON({ kcal: r.kcal, p: r.p, c: r.c, f: r.f, bmr: r.bmr, tdee: r.tdee }, { kcal: 2980, p: 134, c: 460, f: 67, bmr: 1750, tdee: 2710 });
    const sp = run('fmtNum(1000).charAt(1)');
    assert.equal(r.why, `2${sp}980 kcal = besoins estimés (2${sp}710 kcal) + 10 %`);
    assert.equal(r.whyMacros, 'Protéines 1,8 g/kg · lipides 0,9 g/kg · glucides : le reste');
  });

  test('objectifs : proposition, profil 2 (femme 60 kg, sèche, 1 à 3 séances)', () => {
    // Dépense 1 320,25 × 1,375 = 1 815,34 ; − 15 % = 1 543,04 → 1 540 kcal (au-dessus du métabolisme et de 1 200)
    // P 2,2 × 60 = 132 ; L max(54 ; 1 540 × 0,2 / 9 = 34,2) = 54 ; G (1 540 − 528 − 486) / 4 = 131,5 → 132 (arrondi JS)
    const r = est({ sex: 'female', kg: 60, cm: 165, age: 30, activity: 'light', goal: 'cut' });
    sameJSON({ kcal: r.kcal, p: r.p, c: r.c, f: r.f }, { kcal: 1540, p: 132, c: 132, f: 54 });
    assert.match(r.why, /− 15 %/);
  });

  test('objectifs : proposition, profil 3 (homme 90 kg, maintien, peu de sport) : lipides au plancher de 20 %', () => {
    // 900 + 1 156,25 − 250 + 5 = 1 811,25 ; × 1,2 = 2 173,5 → 2 170 kcal ; P 162 ; L max(81 ; 48,2) = 81
    // G (2 170 − 648 − 729) / 4 = 198,25 → 198
    const r = est({ sex: 'male', kg: 90, cm: 185, age: 50, activity: 'low', goal: 'keep' });
    sameJSON({ kcal: r.kcal, p: r.p, c: r.c, f: r.f }, { kcal: 2170, p: 162, c: 198, f: 81 });
    assert.doesNotMatch(r.why, /[+−] \d+ %/, 'maintien : ni plus ni moins');
    // Lipides : 20 % de l'énergie quand 0,9 g/kg en donne moins (petit poids, grosse dépense)
    const lean = est({ sex: 'male', kg: 50, cm: 200, age: 18, activity: 'high', goal: 'gain' });
    assert.equal(lean.f, Math.round(lean.kcal * 0.2 / 9));
    assert.ok(lean.f > 50 * 0.9);
  });

  test('objectifs : jamais sous le métabolisme de base ni sous 1 200 kcal', () => {
    // Femme 40 kg, 150 cm, 80 ans : 400 + 937,5 − 400 − 161 = 776,5 ; × 1,2 × 0,85 = 792 → plancher 1 200
    const r = est({ sex: 'female', kg: 40, cm: 150, age: 80, activity: 'low', goal: 'cut' });
    assert.equal(r.kcal, 1200);
    assert.ok(r.c >= 0, 'glucides jamais négatifs');
  });

  test('objectifs : entrées manquantes, hors bornes ou invalides : aucune proposition', () => {
    const ok = { sex: 'male', kg: 74.5, cm: 180, age: 25, activity: 'mid', goal: 'gain' };
    assert.ok(est(ok));
    for (const [k, v] of [['age', 17], ['age', 81], ['age', '25'], ['cm', 129], ['cm', 221], ['kg', 34], ['kg', 251], ['kg', NaN],
      ['sex', 'x'], ['sex', null], ['activity', 'toString'], ['activity', 'max'], ['goal', '__proto__'], ['goal', undefined]]) {
      const o = { ...ok, [k]: v };
      assert.equal(run(`dietEstimate(${JSON.stringify(o).replace('null', Number.isNaN(v) ? 'NaN' : 'null')})`), null, `${k} = ${String(v)}`);
    }
    assert.equal(run('dietEstimate()'), null);
    assert.equal(run('dietBmr(null)'), null);
    // Bornes incluses
    assert.ok(est({ ...ok, age: 18 }) && est({ ...ok, age: 80 }) && est({ ...ok, cm: 130 }) && est({ ...ok, kg: 250 }));
  });

  test('objectifs : protéines en g/kg ↔ grammes, bornées, sans poids rien', () => {
    assert.equal(run(`dietProteinGrams('1,9', 74.5)`), 142, '1,9 × 74,5 = 141,55 → 142');
    assert.equal(run(`dietProteinGrams(2, 72)`), 144, 'son réglage : 72 kg × 2 g/kg');
    assert.equal(run(`dietProteinPerKg(144, 74.5)`), 1.9, '144 / 74,5 = 1,93 → 1,9');
    assert.equal(run(`dietProteinGrams('0,4', 74.5)`), null, 'sous 0,5 g/kg');
    assert.equal(run(`dietProteinGrams('4,1', 74.5)`), null, 'au-dessus de 4 g/kg');
    assert.equal(run(`dietProteinGrams('1e1', 74.5)`), null, 'écriture refusée');
    assert.equal(run(`dietProteinGrams('2', null)`), null, 'sans poids');
    assert.equal(run(`dietProteinPerKg(0, 74.5)`), null);
    assert.equal(run(`dietProteinPerKg(144, 10)`), null, 'poids hors bornes');
  });

  test('objectifs : réglage g/kg gardé sur l\'appareil, nettoyé, et chargé dans l\'app', () => {
    reset();
    assert.ok(run(`SYNC_LOCAL_ONLY.includes('dietProteinPerKg')`));
    run(`data.dietProteinPerKg = 'oui'; sanitizeDiet(data)`);
    assert.equal(run('data.dietProteinPerKg'), undefined, 'valeur autre que true retirée');
    run(`data.dietProteinPerKg = true; sanitizeDiet(data)`);
    assert.equal(run('data.dietProteinPerKg'), true);
    const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const f of ['index.html', 'sw.js']) assert.ok(read(f).includes('js/data/diet-estimate.js'), f);
    assert.ok(read('index.html').indexOf('js/data/diet-estimate.js') > read('index.html').indexOf('js/data/nutrition.js'), 'après nutrition.js (DIET_LOW_KCAL)');
  });

  test('objectifs : textes justes, plus de « l\'app ne calcule pas tes besoins »', () => {
    const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const f of ['js/features/diet-editor.js', 'privacy.html']) assert.doesNotMatch(read(f), /ne calcule pas tes besoins/, f);
    assert.match(read('js/features/diet-editor.js'), /Estimation, pas un avis médical/);
  });

  test("repas types : ce qui est noté dans la journée ne s'ajoute jamais au plan (retour du 16/11)", () => {
    reset();
    run(`data.dietPlans = { d_p: { name: 'Protéines', targets: { p: 144 }, meals: [{ id: 'm1', name: 'Déjeuner', items: [] }] } }; data.dietActive = 'd_p'`);
    const before = run('JSON.stringify(data.dietPlans.d_p.meals)');
    const it = { id: 'x', name: 'Allumettes fumées', food: null, fam: 'v', g: 200, per: { k: 200, p: 18, c: 1, f: 14 }, src: 'off' };
    assert.ok(run(`dietAddExtra(data, 'd_p', 'm1', ${JSON.stringify(it)})`), 'ajout du jour fait');
    assert.equal(run('JSON.stringify(data.dietPlans.d_p.meals)'), before, 'repas du plan inchangés');
    assert.equal(run(`dietDay(data, 'd_p', dietDayKey()).extras.m1.length`), 1, 'gardé dans le journal du jour seulement');
    // Le lendemain : rien de prévu, rien de repris en silence
    assert.equal(run(`dietDay(data, 'd_p', dietDayKey(Date.now() + 86400000)).extras.m1`), undefined);
  });

  test('repas types : la phrase d\'écart nomme les repas du plan (« Tes repas types » pour un plan perso)', () => {
    const plan = { name: 'P', targets: { p: 144 }, meals: [{ id: 'm1', name: 'R', items: [{ id: 'i', name: 'A', food: null, fam: 'v', g: 100, per: { k: 400, p: 101, c: 0, f: 0 } }] }] };
    assert.equal(run(`dietTargetGap(${JSON.stringify(plan)}, 'Tes repas types')`), 'Tes repas types font 43 g de protéines de moins que l\'objectif du jour.');
    assert.match(run(`dietTargetGap(${JSON.stringify(plan)})`), /^Les repas prévus font 43 g/);
    assert.equal(run(`dietTargetGap(${JSON.stringify({ ...plan, meals: [{ id: 'm1', name: 'R', items: [] }] })}, 'Tes repas types')`), '', 'sans repas types : aucune phrase');
  });
}
