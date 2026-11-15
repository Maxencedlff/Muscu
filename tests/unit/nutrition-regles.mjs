// Nutrition : règles fines repérées par le test de mutation (Stryker, js/data/nutrition.js). Chaque test vérifie une
// borne, une branche ou un champ que les tests de nutrition.mjs laissaient passer : journal du jour (sanitizer),
// Mes aliments, accords, plans, macros, mangé contre prévu, repas retirés, jours vides, quantités à l'unité.

export default function ({ test, run, reset: reset0, assert, sameJSON }) {
  // Mode « pré-rempli » par défaut, comme nutrition.mjs ; les tests du mode vide le choisissent
  const reset = (...a) => { reset0(...a); run('data.dietEmptyDays = false'); };
  const clone = v => JSON.parse(JSON.stringify(v));
  const PER = { k: 155, p: 3, c: 33, f: 1 };
  const it = (id, g = 100, per = PER, extra = {}) => ({ id, name: 'Riz ' + id, g, per, ...extra });
  const NOW = new Date(2026, 10, 5, 12).getTime();   // jeudi 5 novembre 2026, midi
  const log = v => clone(run(`cleanDietLog(${JSON.stringify(v)}, ${NOW})`));
  const E = (x = {}) => ({ plan: 'd_a', done: ['m1'], ...x });

  // ── Journal du jour (cleanDietLog) ──

  test('journal : fenêtre de 120 jours avant et 2 jours après, plan et jour valides', () => {
    const oldest = run(`localISO(${NOW} - 120 * 86400000)`), before = run(`localISO(${NOW} - 121 * 86400000)`);
    const out = log({ [oldest]: E(), [before]: E(), '2026-11-07': E(), '2026-11-08': E(), '2026-11-5': E(),
      '2026-11-01': E({ plan: 'x' }), '2026-11-02': { done: ['m1'] }, '2026-11-03': 'e', '2026-11-04': [] });
    sameJSON(Object.keys(out).sort(), [oldest, '2026-11-07'].sort());
  });

  test('journal : forme exacte d\'une entrée complète, champs vides jamais écrits', () => {
    const swap = it('zz', 80);
    const out = log({ '2026-11-05': { plan: 'd_a', done: ['m1', 'm1', 5, 'a b', '__proto__', 'm2'], swaps: { it1: swap, 'bad id': swap, it2: { name: 'X' } },
      extras: { m1: [it('e1'), it('e1'), { g: 1 }], 'bad id': [it('e2')], m2: 'x', m3: [] }, removed: ['it1', 'it1', 7], meals: ['m1', 'm1', 3, 'm2'],
      off: ['m2', 'm2', null], copied: ['m1', 'a b'], blank: true } });
    sameJSON(out['2026-11-05'], { plan: 'd_a', done: ['m1', 'm2'], swaps: { it1: { ...run(`cleanDietItem(${JSON.stringify(swap)})`), id: 'it1' } },
      extras: { m1: [run(`cleanDietItem(${JSON.stringify(it('e1'))})`)] }, removed: ['it1'], meals: ['m1', 'm2'], off: ['m2'], copied: ['m1'], blank: true });
    // Entrée minimale : seulement plan, done, swaps
    sameJSON(log({ '2026-11-05': { plan: 'd_a', done: ['m1'], meals: 'x', blank: 'oui' } })['2026-11-05'], { plan: 'd_a', done: ['m1'], swaps: {} });
  });

  test('journal : une entrée sans rien de noté part, un seul champ suffit à la garder (jour vide compris)', () => {
    assert.equal(log({ '2026-11-05': { plan: 'd_a', done: [], swaps: {}, meals: ['m1'] } })['2026-11-05'], undefined);
    for (const x of [{ swaps: { it1: it('s') } }, { extras: { m1: [it('e')] } }, { removed: ['it1'] }, { off: ['m1'] }, { copied: ['m1'] }, { blank: true }]) {
      const out = log({ '2026-11-05': { plan: 'd_a', ...x } })['2026-11-05'];
      assert.ok(out && out.plan === 'd_a', `gardée : ${Object.keys(x)[0]}`);
      sameJSON(out.done, [], 'done toujours présent');
    }
  });

  test('journal : tailles bornées (8 repas, 25 aliments par repas, 200 retraits)', () => {
    const ids = n => Array.from({ length: n }, (_, i) => 'm' + i);
    const out = log({ '2026-11-05': { plan: 'd_a', done: ids(12), off: ids(12), copied: ids(12), meals: ids(12), removed: ids(250),
      extras: Object.fromEntries(ids(12).map(m => [m, Array.from({ length: 30 }, (_, j) => it(`${m}x${j}`))])),
      swaps: Object.fromEntries(ids(250).map(id => [id, it('s')])) } })['2026-11-05'];
    sameJSON([out.done.length, out.off.length, out.copied.length, out.meals.length, out.removed.length], [8, 8, 8, 8, 200]);
    assert.equal(Object.keys(out.extras).length, 8);
    assert.ok(Object.values(out.extras).every(l => l.length === 25));
    assert.equal(Object.keys(out.swaps).length, 200);
    assert.equal(out.swaps.m7.id, 'm7', 'le remplaçant prend l\'identifiant de l\'aliment remplacé');
    // Entrée vide, illisible
    sameJSON(log(null), {});
    sameJSON(log([]), {});
  });

  // ── Valeurs pour 100 g, famille, aliment, unité (cleanDietPer, dietFamOf, cleanDietItem, cleanDietPortion) ──

  test('valeurs pour 100 g : bornes incluses (900 kcal, 101 g de macros), arrondis, champ manquant', () => {
    sameJSON(clone(run(`cleanDietPer({ k: 900, p: 100, c: 0, f: 0 })`)), { k: 900, p: 100, c: 0, f: 0 });
    sameJSON(clone(run(`cleanDietPer({ k: 155.6, p: 40.04, c: 40.06, f: 20.9 })`)), { k: 156, p: 40, c: 40.1, f: 20.9 }, '101 g pile : accepté');
    assert.equal(run(`cleanDietPer({ k: 1, p: 40, c: 40, f: 21.1 })`), null, '101,1 g : refusé');
    assert.equal(run(`cleanDietPer({ k: 1, p: 0, c: 0 })`), null, 'lipides manquants');
    assert.equal(run(`cleanDietPer({ k: 1, p: 101, c: 0, f: 0 })`), null);
    assert.equal(run(`cleanDietPer([1, 2, 3, 4])`), null);
    assert.equal(run(`cleanDietPer(null)`), null);
  });

  test('famille d\'un aliment perso : seuils de 50 % (protéines, glucides) et 60 % (lipides) inclus', () => {
    const fam = per => run(`dietFamOf(${JSON.stringify(per)})`);
    assert.equal(fam({ p: 25, c: 25, f: 0 }), 'v', 'protéines : 50 % pile');
    assert.equal(fam({ p: 24, c: 26, f: 0 }), 'f', 'protéines sous 50 %, glucides au-dessus');
    assert.equal(fam({ p: 0, c: 30, f: 20 }), 'g', 'lipides : 60 % pile');
    assert.equal(fam({ p: 0, c: 45, f: 20 }), 'f', 'lipides 50 %, glucides 50 % pile');
    assert.equal(fam({ p: 20, c: 30, f: 15 }), 'p', 'rien ne domine : plat composé');
    assert.equal(fam({ p: 0, c: 0, f: 0 }), 'a', 'sans énergie');
  });

  test('aliment du plan : code Ciqual borné, origine, énergie calculée, famille, identifiant gardé', () => {
    const c = x => clone(run(`cleanDietItem(${JSON.stringify({ name: 'Riz', g: 100, per: PER, ...x })})`));
    assert.equal(c({ food: 9999999 }).food, 9999999);
    for (const food of [1e7, 0, -3, '9104']) assert.equal(c({ food }).food, null, `code ${food} écarté`);
    assert.equal(c({ food: 9104 }).src, 'ciqual-2025', 'code Ciqual : valeurs de Ciqual');
    assert.equal(c({ food: 9104, src: 'perso' }).src, 'perso', 'origine valide gardée');
    assert.equal(c({ src: 'off' }).src, 'off');
    assert.equal(c({ ecalc: true }).ecalc, true);
    assert.ok(!('ecalc' in c({ ecalc: 'oui' })) && !('por' in c({})), 'champs facultatifs absents');
    assert.equal(c({ id: 'it_1' }).id, 'it_1');
    assert.equal(c({ fam: 'zz' }).fam, 'f', 'famille inconnue : tirée des macros');
    assert.equal(c({ g: 1 }).g, 1, '1 g : accepté');
    assert.equal(c({ g: 2000 }).g, 2000, '2 kg pile : accepté');
    assert.equal(c({ g: 0.4 }), null);
    assert.equal(c({ name: '   ' }), null, 'sans nom');
    assert.equal(run(`cleanDietItem('Riz')`), null);
  });

  test('quantité à l\'unité : gardée seulement si elle redonne les grammes à 1 g près, demi-unités', () => {
    const por = (n, g, u = { u: 'œuf', pl: 'œufs', g: 50 }) => clone(run(`cleanDietItem(${JSON.stringify({ name: 'Œuf', g, per: PER, por: { ...u, n } })})`)).por;
    sameJSON(por(2, 100), { n: 2, u: 'œuf', pl: 'œufs', g: 50 });
    assert.ok(por(2, 101) && por(2, 99), 'à 1 g près');
    assert.equal(por(2, 102), undefined, '2 g d\'écart : en grammes');
    assert.equal(por(1.3, 75).n, 1.5, 'arrondi à la demi-unité');
    assert.equal(por(0.4, 25).n, 0.5, 'une demi-unité au moins');
    assert.equal(por(0.2, 10), undefined, 'moins d\'une demi-unité');
    assert.equal(por(50, 50, { u: 'amande', g: 1 }).n, 50, '50 unités au plus');
    assert.equal(por(51, 51, { u: 'amande', g: 1 }), undefined);
    assert.equal(por('2', 100), undefined, 'nombre en texte refusé');
    assert.equal(por(2, 100, { u: '', g: 50 }), undefined, 'unité illisible');
    sameJSON(por(2, 100, { u: 'pot', g: 50 }), { n: 2, u: 'pot', pl: 'pot', g: 50 }, 'pluriel par défaut : le singulier');
  });

  test('nom d\'aliment : coupé au dernier mot, sinon net à 80 si le dernier mot est trop long', () => {
    const a = 'A'.repeat(30) + ' ' + 'B'.repeat(60);
    assert.equal(run(`dietCutName('${a}')`), a.slice(0, 80), 'mot entier trop court (moins de la moitié) : coupé net');
    const words = Array.from({ length: 25 }, (_, i) => 'mot' + i).join(' ');
    const cut = run(`dietCutName('${words}')`);
    assert.ok(cut.length <= 80 && words.startsWith(cut) && words[cut.length] === ' ', `coupé à un mot entier : ${cut}`);
    assert.equal(run(`dietCutName('${'A'.repeat(10)} ${'B'.repeat(68)};${'C'.repeat(20)}')`), `${'A'.repeat(10)} ${'B'.repeat(68)}`, 'coupé net : séparateur de fin retiré');
    assert.equal(run(`dietCutName(null)`), '');
    assert.equal(run(`dietCutName('  Pâtes   cuites ')`), 'Pâtes cuites');
  });

  // ── Mes aliments ──

  test('Mes aliments : code-barres, sel, unité du paquet, origine Open Food Facts, doublons de nom', () => {
    const f = x => clone(run(`cleanDietFoods([${JSON.stringify({ name: 'Skyr', per: PER, ...x })}])`))[0];
    assert.equal(f({ code: '12345678' }).code, '12345678', 'EAN-8');
    assert.equal(f({ code: '1234567890123' }).code, '1234567890123', 'EAN-13');
    for (const code of ['123456789', '1234567a', 12345678]) assert.ok(!('code' in f({ code })), `code ${code} écarté`);
    assert.equal(f({ code: '12345678', src: 'off' }).src, 'off');
    assert.ok(!('src' in f({ src: 'off' })), 'Open Food Facts seulement avec un code-barres');
    assert.ok(!('src' in f({ code: '12345678', src: 'perso' })));
    assert.equal(f({ salt: 1.234 }).salt, 1.23, 'sel arrondi au centième');
    assert.equal(f({ salt: 0 }).salt, 0);
    assert.equal(f({ salt: 100 }).salt, 100);
    for (const salt of [101, -1, '1']) assert.ok(!('salt' in f({ salt })), `sel ${salt} écarté`);
    assert.equal(f({ ecalc: true }).ecalc, true);
    assert.ok(!('ecalc' in f({ ecalc: 1 })));
    sameJSON(f({ portion: { u: 'pot', g: 125 } }).portion, { u: 'pot', pl: 'pot', g: 125 });
    assert.ok(!('portion' in f({ portion: { u: 'pot', g: 0 } })));
    assert.equal(f({ fam: 'l' }).fam, 'l');
    assert.equal(f({ fam: 'zz' }).fam, 'f');
    assert.equal(f({ id: 'sk_1' }).id, 'sk_1');
    assert.match(f({ id: 'a b' }).id, /^[a-z0-9]{1,10}$/);
    // Même nom à la casse et aux accents près : le premier gardé
    sameJSON(clone(run(`cleanDietFoods([{ name: 'Pâte', per: ${JSON.stringify(PER)} }, { name: 'PATE', per: ${JSON.stringify(PER)} }, { name: 'Pain', per: ${JSON.stringify(PER)} }])`)).map(x => x.name), ['Pâte', 'Pain']);
    sameJSON(clone(run(`cleanDietFoods('x')`)), []);
  });

  test('Mes aliments : 200 au plus à la lecture, plein seulement pour un aliment vraiment nouveau', () => {
    const many = n => Array.from({ length: n }, (_, i) => ({ id: 'f' + i, name: 'Aliment ' + i, per: PER, ...(i === 0 ? { code: '12345678' } : {}) }));
    assert.equal(run(`cleanDietFoods(${JSON.stringify(many(205))})`).length, 200);
    assert.equal(run(`cleanDietFoods(${JSON.stringify(['x', ...many(204)])})`).length, 199, 'plafond compté avant le tri');
    const full = JSON.stringify(many(200));
    assert.equal(run(`dietFoodsFull(${JSON.stringify(many(199))}, { name: 'Neuf' })`), false, '199 : place libre');
    assert.equal(run(`dietFoodsFull(${full}, { name: 'Neuf' })`), true, '200 : plein');
    assert.equal(run(`dietFoodsFull(${full}, { name: 'aliment 5' })`), false, 'même nom : mis à jour sur place');
    assert.equal(run(`dietFoodsFull(${full}, { name: 'Neuf', code: '12345678' })`), false, 'même code-barres : mis à jour');
    assert.equal(run(`dietFoodsFull(${full}, { name: 'Neuf', code: '87654321' })`), true);
    assert.equal(run(`dietFoodsFull(null, { name: 'Neuf' })`), false);
  });

  test('Mes aliments : retirer (dernier : clé retirée), Annuler à sa place, identifiants retirés bornés', () => {
    reset();
    run(`data.dietFoods = [{ id: 'a1', name: 'A', per: ${JSON.stringify(PER)}, fam: 'f' }, { id: 'b1', name: 'B', per: ${JSON.stringify(PER)}, fam: 'f' }]`);
    assert.equal(run(`dietRemoveFood(data, 'zz')`), null);
    const r = clone(run(`dietRemoveFood(data, 'a1')`));
    sameJSON([r.food.id, r.index], ['a1', 0]);
    sameJSON(clone(run('data.dietFoodsGone')), ['a1']);
    run(`dietRemoveFood(data, 'b1')`);
    assert.ok(run(`!('dietFoods' in data)`), 'plus rien : clé retirée');
    sameJSON(clone(run('data.dietFoodsGone')), ['a1', 'b1']);
    assert.equal(run(`dietRestoreFood(data, ${JSON.stringify(r)})`), true);
    sameJSON(clone(run('data.dietFoods.map(x => x.id)')), ['a1']);
    sameJSON(clone(run('data.dietFoodsGone')), ['b1'], 'remis : plus dans les retirés');
    run(`dietRestoreFood(data, { food: { id: 'b1', name: 'B', per: ${JSON.stringify(PER)} }, index: 9 })`);
    sameJSON(clone(run('data.dietFoods.map(x => x.id)')), ['a1', 'b1'], 'place au-delà de la fin : en dernier');
    assert.ok(run(`!('dietFoodsGone' in data)`), 'plus aucun retiré : clé retirée');
    // Remis à sa place d'origine, et un aliment du même nom ajouté entre-temps est remplacé
    run(`data.dietFoods.push({ id: 'c1', name: 'C', per: ${JSON.stringify(PER)} }, { id: 'a2', name: 'a', per: ${JSON.stringify(PER)} }); dietRemoveFood(data, 'b1')`);
    run(`dietRestoreFood(data, { food: { id: 'b1', name: 'B', per: ${JSON.stringify(PER)} }, index: 1 })`);
    sameJSON(clone(run('data.dietFoods.map(x => x.id)')), ['a1', 'b1', 'c1', 'a2'].filter(x => x !== 'a2'), 'doublon de nom (a / A) retiré à la lecture');
    // Plein entre-temps : pas remis
    run(`data.dietFoods = ${JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: 'f' + i, name: 'F' + i, per: PER })))}`);
    assert.equal(run(`dietRestoreFood(data, { food: { id: 'zz', name: 'Neuf', per: ${JSON.stringify(PER)} }, index: 0 })`), false);
    // Identifiants retirés : uniques, valides, 300 derniers
    const gone = clone(run(`cleanDietFoodsGone(${JSON.stringify(['x', 'x', 'a b', 5, ...Array.from({ length: 310 }, (_, i) => 'g' + i)])})`));
    assert.equal(gone.length, 300);
    sameJSON([gone[0], gone[299]], ['g10', 'g309'], 'les plus récents gardés');
    sameJSON(clone(run(`cleanDietFoodsGone({})`)), []);
  });

  // ── sanitizeDiet : clés retirées, accords, réglages ──

  test('sanitizeDiet : clés vides retirées, plan suivi seulement s\'il existe et vit, rien d\'ajouté', () => {
    const s = d => clone(run(`sanitizeDiet(${JSON.stringify(d)}, ${NOW})`));
    sameJSON(s({}), {}, 'aucune clé ajoutée');
    sameJSON(s({ dietPlans: {}, dietFoods: [], dietFoodsGone: ['a b'], dietLog: { x: 1 } }), {});
    sameJSON(s({ dietPlans: { 'bad!': { name: 'X', meals: [] } } }), {});
    assert.equal(s({ dietPlans: { d_a: { name: 'A', meals: [] } }, dietActive: 'd_a' }).dietActive, 'd_a');
    assert.ok(!('dietActive' in s({ dietPlans: { d_a: { name: 'A', meals: [] } }, dietActive: 'd_b' })), 'plan inconnu');
    assert.ok(!('dietActive' in s({ dietActive: 'd_a' })), 'aucun plan');
    sameJSON(s({ dietFoodsGone: ['g1', 'g1'] }).dietFoodsGone, ['g1']);
    sameJSON(Object.keys(s({ dietLog: { '2026-11-05': E() } }).dietLog), ['2026-11-05'], 'journal lu avec la date donnée');
  });

  test('sanitizeDiet : accords lisibles seulement (booléen, date ISO de 40 caractères au plus), réglages vrais seulement', () => {
    const s = d => clone(run(`sanitizeDiet(${JSON.stringify(d)}, ${NOW})`));
    const at = '2026-11-01T10:00:00Z';
    sameJSON(s({ dietConsent: { on: true, at, x: 1 } }).dietConsent, { on: true, at });
    sameJSON(s({ dietConsent: { on: false, at } }).dietConsent, { on: false, at });
    const long = 'Sun Nov 01 2026 10:00:00 GMT+0100 (heure normale d’Europe centrale)';   // lisible mais trop long
    for (const c of [{ on: 1, at }, { on: true, at: 'nope' }, { on: true, at: 5 }, { on: true, at: long }, 'oui', null]) {
      assert.ok(!('dietConsent' in s({ dietConsent: c })), `accord illisible : ${JSON.stringify(c)}`);
      assert.ok(!('dietCoachConsent' in s({ dietCoachConsent: c })), `accord du coach illisible : ${JSON.stringify(c)}`);
    }
    sameJSON(s({ dietConsent: { on: true, at: 'Sun Nov 01 2026 10:00:00 GMT+0100 (CETx)' } }).dietConsent.on, true, '40 caractères : accepté');
    sameJSON(s({ dietCoachConsent: { on: true, at, local: true, x: 1 } }).dietCoachConsent, { on: true, at, local: true });
    sameJSON(s({ dietCoachConsent: { on: false, at, local: 'oui' } }).dietCoachConsent, { on: false, at });
    for (const k of ['dietConsentAsked', 'dietHideNumbers', 'dietStreakOff']) {
      assert.equal(s({ [k]: true })[k], true);
      for (const v of [false, 'true', 1]) assert.ok(!(k in s({ [k]: v })), `${k} = ${v} retiré`);
    }
    assert.equal(s({ dietEmptyDays: false }).dietEmptyDays, false, '« pré-remplis » choisi : gardé');
    assert.equal(s({ dietEmptyDays: true }).dietEmptyDays, true);
    assert.ok(!('dietEmptyDays' in s({ dietEmptyDays: 'oui' })));
    assert.equal(run(`dietConsentOn({ dietConsent: { on: true } })`), true);
    assert.equal(run(`dietConsentOn({ dietConsent: { on: 'true' } })`), false);
    assert.equal(run(`dietConsentOn({})`), false);
  });

  // ── Plans : nettoyage ──

  test('plan : noms par défaut, consigne de repas, objectifs bornés et arrondis, date, archivé', () => {
    const p = x => clone(run(`cleanDietPlan(${JSON.stringify({ meals: [], ...x })})`));
    assert.equal(p({ name: '  ' }).name, 'Plan de nutrition');
    const m = p({ meals: [{ name: ' ', note: '  Sans sel  ', items: 'x' }, { id: 'm1', name: 'Midi', note: 'n'.repeat(400), items: [] }, 'x'] }).meals;
    sameJSON([m.length, m[0].name, m[0].note, m[0].items.length, m[1].note.length], [2, 'Repas', 'Sans sel', 0, 300]);
    assert.ok(!('note' in p({ meals: [{ id: 'm1', name: 'M', note: '   ', items: [] }] }).meals[0]), 'consigne vide : absente');
    sameJSON(p({ targets: { kcal: 10000, p: 600, c: 1500, f: 600 } }).targets, { kcal: 10000, p: 600, c: 1500, f: 600 }, 'bornes incluses');
    assert.ok(!('targets' in p({ targets: { kcal: 10001, p: 601, c: 1501, f: 601 } })), 'au-delà : retirés, plus d\'objectifs');
    sameJSON(p({ targets: { kcal: 2000.6, p: 0.5, c: 1, f: '70' } }).targets, { kcal: 2001, c: 1, f: 70 }, 'arrondis, sous 1 retiré');
    assert.ok(!('targets' in p({ targets: [2000] })));
    assert.equal(p({ updatedAt: 5 }).updatedAt, 5);
    for (const updatedAt of [0, -1, '5', Infinity]) assert.ok(!('updatedAt' in p({ updatedAt })), `date ${updatedAt} écartée`);
    assert.equal(p({ archived: true }).archived, true);
    assert.ok(!('archived' in p({ archived: 'true' })));
    assert.ok(!('consigne' in p({ consigne: '   ' })));
    sameJSON(p({ meals: 'x' }).meals, []);
    assert.equal(run(`cleanDietPlan([])`), null);
  });

  test('plan : identifiants de repas et d\'aliments en double renommés, le premier gardé', () => {
    const p = clone(run(`cleanDietPlan(${JSON.stringify({ name: 'P', meals: [{ id: 'm1', name: 'A', items: [it('i1'), it('i1')] }, { id: 'm1', name: 'B', items: [] }] })})`));
    assert.equal(p.meals[0].id, 'm1');
    assert.notEqual(p.meals[1].id, 'm1');
    assert.equal(p.meals[0].items[0].id, 'i1');
    assert.notEqual(p.meals[0].items[1].id, 'i1');
  });

  test('plan reçu d\'un coach : identifiant du coach borné, pseudo valide, date d\'envoi positive', () => {
    const fc = x => clone(run(`cleanDietPlan(${JSON.stringify({ name: 'P', meals: [], fromCoach: { coachId: 'c1', name: 'max_1', sentAt: 5, ...x } })})`)).fromCoach;
    sameJSON(fc({}), { coachId: 'c1', name: 'max_1', sentAt: 5 });
    assert.equal(fc({ coachId: 'c'.repeat(64) }).coachId.length, 64);
    for (const coachId of ['c'.repeat(65), '', 5]) assert.equal(fc({ coachId }), undefined, `coach ${coachId} écarté`);
    for (const name of ['Max', 'ab', 'a'.repeat(21), 'max!', 5]) assert.equal(fc({ name }).name, null, `pseudo ${name} écarté`);
    assert.equal(fc({ name: 'abc' }).name, 'abc');
    assert.equal(fc({ name: 'a'.repeat(20) }).name, 'a'.repeat(20));
    assert.equal(fc({ sentAt: 0 }).sentAt, 0);
    for (const sentAt of [-1, '5', NaN]) assert.equal(fc({ sentAt }).sentAt, 0, `envoi ${sentAt} : 0`);
    assert.equal(clone(run(`cleanDietPlan({ name: 'P', meals: [], fromCoach: 'c1' })`)).fromCoach, undefined);
  });

  test('plans : 100 vivants au plus à la lecture, archivés classés du plus récent (date absente = la plus ancienne)', () => {
    const alive = Object.fromEntries(Array.from({ length: 105 }, (_, i) => [`d_p${i}`, { name: 'P', meals: [] }]));
    const out = clone(run(`cleanDietPlans(${JSON.stringify(alive)})`));
    assert.equal(Object.keys(out).length, 100);
    const arch = Object.fromEntries(Array.from({ length: 52 }, (_, i) => [`d_a${i}`, { name: 'A', meals: [], archived: true, ...(i < 2 ? {} : { updatedAt: i }) }]));
    const ka = Object.keys(clone(run(`cleanDietPlans(${JSON.stringify(arch)})`)));
    assert.ok(ka.length === 50 && !ka.includes('d_a0') && !ka.includes('d_a1'), 'sans date : partis d\'abord');
    sameJSON(clone(run(`cleanDietPlans([])`)), {});
    sameJSON(Object.keys(clone(run(`cleanDietPlans({ d_x: 'plan', d_y: { name: 'Y', meals: [] } })`))), ['d_y']);
  });

  // ── Macros, mangé contre prévu ──

  // Plan simple : m1 = 100 g à 155 kcal, m2 = 200 g à 100 kcal (p 10, c 10, f 2 pour 100 g), m3 vide (collation libre)
  const P2 = { k: 100, p: 10, c: 10, f: 2 };
  const D = '2026-11-05', H = '2026-11-04';
  const setup = (x = {}) => {
    reset();
    const plan = { name: 'P', meals: [{ id: 'm1', name: 'Matin', items: [it('i1')] }, { id: 'm2', name: 'Midi', items: [it('i2', 200, P2)] }, { id: 'm3', name: 'Collation', items: [] }], ...x };
    run(`data.dietPlans = { d_a: ${JSON.stringify(plan)} }; data.dietActive = 'd_a'`);
  };
  const pr = (day = D) => clone(run(`dietDayProgress(data, 'd_a', '${day}')`));
  const entry = (day = D) => clone(run(`data.dietLog?.['${day}'] ?? null`));

  test('macros : aliment sans valeurs ni quantité = 0, repas avec remplacements et retraits, plan avec remplacements', () => {
    sameJSON(clone(run(`dietItemMacros({})`)), { kcal: 0, p: 0, c: 0, f: 0 });
    sameJSON(clone(run(`dietItemMacros(null)`)), { kcal: 0, p: 0, c: 0, f: 0 });
    sameJSON(clone(run(`dietItemMacros({ g: 50, per: { k: 100 } })`)), { kcal: 50, p: 0, c: 0, f: 0 });
    sameJSON(clone(run(`dietItemMacros(${JSON.stringify(it('x', 200, P2))})`)), { kcal: 200, p: 20, c: 20, f: 4 });
    const meal = { id: 'm', items: [it('a', 100, P2), it('b', 200, P2)] };
    sameJSON(clone(run(`dietMealMacros(${JSON.stringify(meal)})`)), { kcal: 300, p: 30, c: 30, f: 6 });
    sameJSON(clone(run(`dietMealMacros(${JSON.stringify(meal)}, null, ['b'])`)), { kcal: 100, p: 10, c: 10, f: 2 }, 'retiré : compté pour rien');
    sameJSON(clone(run(`dietMealMacros(${JSON.stringify(meal)}, { a: ${JSON.stringify(it('a', 50, P2))} })`)), { kcal: 250, p: 25, c: 25, f: 5 }, 'remplacé');
    sameJSON(clone(run(`dietMealMacros(null)`)), { kcal: 0, p: 0, c: 0, f: 0 });
    sameJSON(clone(run(`dietPlanMacros({ meals: [${JSON.stringify(meal)}, ${JSON.stringify(meal)}] }, { b: ${JSON.stringify(it('b', 0.5, P2))} })`)).kcal, 201, 'remplacement compté dans chaque repas');
    sameJSON(clone(run(`dietPlanMacros(null)`)), { kcal: 0, p: 0, c: 0, f: 0 });
    const g = clone(run(`dietGoal({ meals: [${JSON.stringify(meal)}], targets: { kcal: 2000, f: 70 } })`));
    sameJSON(g, { goal: { kcal: 2000, p: 30, c: 30, f: 70 }, own: { kcal: true, p: false, c: false, f: true } });
    sameJSON(clone(run(`dietGoal(null)`)).goal, { kcal: 0, p: 0, c: 0, f: 0 });
  });

  test('quantité affichée et lue : en grammes, ou unités · grammes ; même aliment = changement de quantité', () => {
    assert.equal(run(`dietQtyText({ g: 100 })`), '100 g');
    assert.equal(run(`dietQtySpoken({ g: 100 })`), '100 grammes');
    const por = { n: 2, u: 'œuf', pl: 'œufs', g: 50 };
    assert.equal(run(`dietQtyText({ g: 100, por: ${JSON.stringify(por)} })`), `${run(`portionText(2, ${JSON.stringify(por)})`)} · 100 g`);
    assert.equal(run(`dietQtySpoken({ g: 100, por: ${JSON.stringify(por)} })`), `${run(`portionSpoken(2, ${JSON.stringify(por)})`)}, 100 grammes`);
    assert.equal(run(`dietIsQtyChange({ name: 'Riz' }, { name: 'Riz', food: null })`), true, 'code absent ou null : le même');
    assert.equal(run(`dietIsQtyChange({ name: 'Riz', food: 1 }, { name: 'Riz', food: 1 })`), true);
    assert.equal(run(`dietIsQtyChange({ name: 'Riz', food: 1 }, { name: 'Riz', food: 2 })`), false);
    assert.equal(run(`dietIsQtyChange({ name: 'Riz' }, { name: 'Pâtes' })`), false);
    assert.equal(run(`dietIsQtyChange({ name: 'Riz' }, null)`), false);
    assert.equal(run(`dietEffectiveItem({ id: 'a', name: 'Riz' }, null).name`), 'Riz');
  });

  test('écart à l\'objectif : 10 % pile = rien, au-delà dit ; protéines seules ; plan sans aliment', () => {
    const plan = (g, targets) => JSON.stringify({ meals: [{ id: 'm', items: [it('a', g, P2)] }], targets });
    assert.equal(run(`dietTargetGap(${plan(1100, { kcal: 1000 })})`), '', '+10 % pile');
    assert.equal(run(`dietTargetGap(${plan(900, { kcal: 1000 })})`), '', '-10 % pile');
    assert.equal(run(`dietTargetGap(${plan(1110, { kcal: 1000 })})`), `Les repas prévus font ${run('fmtNum(110)')} kcal de plus que l'objectif du jour.`);
    assert.equal(run(`dietTargetGap(${plan(1000, { p: 150 })})`), `Les repas prévus font 50 g de protéines de moins que l'objectif du jour.`);
    assert.equal(run(`dietTargetGap({ meals: [], targets: { kcal: 1000 } })`), '');
    assert.equal(run(`dietTargetGap(null)`), '');
    assert.equal(run(`dietLowKcal(null)`), false);
    assert.equal(run(`dietLowKcal(${plan(1199, {})})`), true, 'total complet sous 1 200');
    assert.equal(run(`dietLowKcal(${plan(1200, {})})`), false, '1 200 pile : rien');
    assert.equal(run(`dietLowKcal(${plan(1199, { kcal: 1500 })})`), false, 'objectif fixé : il prime');
    assert.equal(run(`dietLowKcal({ meals: [{ id: 'm', items: [${JSON.stringify(it('a', 1, { k: 0, p: 0, c: 0, f: 0 }))}] }] })`), false, '0 kcal : pas un régime');
  });

  test('bilan du jour : prévu (remplaçant compté, quantité changée non), mangé, repère, plan inconnu', () => {
    setup();
    assert.equal(run(`dietDayProgress(data, 'zz', '${D}')`), null);
    let p = pr();
    sameJSON([p.planned.kcal, p.goal.kcal, p.own.kcal, p.nMeals, p.nDone, p.complete, p.next.meal.id], [355, 355, false, 2, 0, false, 'm1']);
    // Remplaçant (autre aliment) : le prévu suit ; quantité changée : le prévu reste
    run(`dietSetSwap(data, 'd_a', 'i1', ${JSON.stringify({ name: 'Pâtes', g: 100, per: { k: 300, p: 10, c: 60, f: 2 } })}, '${D}')`);
    run(`dietSetPlanQty(data, 'd_a', 'i2', { g: 100 }, '${D}')`);
    p = pr();
    sameJSON([p.planned.kcal, p.goal.kcal, p.meals[0].base.kcal, p.meals[1].base.kcal], [500, 500, 300, 100]);
    run(`dietToggleMeal(data, 'd_a', 'm2', '${D}')`);
    p = pr();
    sameJSON([p.eaten.kcal, p.nDone, p.next.meal.id, p.meals[1].done, p.meals[0].done], [100, 1, 'm1', true, false]);
    run(`dietToggleMeal(data, 'd_a', 'm1', '${D}')`);
    p = pr();
    sameJSON([p.eaten.kcal, p.complete, p.next], [400, true, null]);
    // Objectif fixé : il reste le repère
    run(`data.dietPlans.d_a.targets = { kcal: 2000 }`);
    sameJSON([pr().goal.kcal, pr().own.kcal, pr().goal.p], [2000, true, 10 + 20]);
    sameJSON(pr().swaps.i1.name, 'Pâtes');
  });

  test('bilan du jour : un ajout à un repas pas coché ne compte pas (jour pré-rempli), collation libre tout de suite', () => {
    setup();
    run(`dietAddExtra(data, 'd_a', 'm1', ${JSON.stringify(it('x', 100, P2))}, '${D}')`);
    let p = pr();
    sameJSON([p.eaten.kcal, p.meals[0].added.kcal, p.meals[0].macros.kcal, p.planned.kcal], [0, 100, 255, 355], 'pas coché : pas mangé, jamais dans le prévu');
    run(`dietAddExtra(data, 'd_a', 'm3', ${JSON.stringify(it('y', 50, P2))}, '${D}')`);
    p = pr();
    sameJSON([p.eaten.kcal, p.nMeals, p.meals[2].done], [50, 2, false], 'collation libre : comptée tout de suite, jamais à cocher');
    run(`dietToggleMeal(data, 'd_a', 'm1', '${D}')`);
    assert.equal(pr().eaten.kcal, 50 + 255, 'coché : aliment prévu et ajout');
  });

  // ── Journée : écriture, retraits, quantités ──

  test('journée : jour écrit avec l\'instantané des repas, ajouts vides et éléments inconnus du plan oubliés', () => {
    setup();
    run(`dietWriteDay(data, '${D}', { plan: 'd_a', done: ['m1', 'zz'], swaps: { i1: ${JSON.stringify(it('i1', 50))}, zz: ${JSON.stringify(it('zz'))} },
      extras: { m1: [], m3: [${JSON.stringify(it('e1'))}], zz: [${JSON.stringify(it('e2'))}] }, removed: ['i2', 'zz'], off: ['zz'], copied: ['zz'] })`);
    const e = entry();
    sameJSON(Object.keys(e).sort(), ['done', 'extras', 'meals', 'plan', 'removed', 'swaps']);
    sameJSON([e.done, Object.keys(e.swaps), Object.keys(e.extras), e.removed, e.meals], [['m1'], ['i1'], ['m3'], ['i2'], ['m1']], 'm2 retiré (son seul aliment) : plus à faire');
    run(`dietWriteDay(data, '${D}', { plan: 'd_a', done: [], swaps: {}, blank: true })`);
    sameJSON(entry(), { plan: 'd_a', done: [], swaps: {}, meals: ['m1', 'm2'], blank: true }, 'jour vide gardé seul');
    run(`dietWriteDay(data, '${D}', { plan: 'd_a', done: [], swaps: {}, off: ['m1'], copied: ['m2'] })`);
    sameJSON([entry().off, entry().copied, entry().meals], [['m1'], ['m2'], ['m2']]);
    run(`dietWriteDay(data, '${D}', { plan: 'd_a', done: [], swaps: {} })`);
    assert.equal(run('data.dietLog'), undefined, 'plus rien : journal retiré');
    run(`data.dietLog = { '${H}': ${JSON.stringify(E())} }; dietWriteDay(data, '${D}', { plan: 'd_a', done: [], swaps: {} })`);
    sameJSON(Object.keys(clone(run('data.dietLog'))), [H], 'les autres jours restent');
  });

  test('journée : remplacement illisible = remis au plan ; quantité du plan : inconnu, retour au prévu, unité', () => {
    setup();
    assert.equal(run(`dietSetSwap(data, 'd_a', 'i1', ${JSON.stringify(it('s', 80))}, '${D}')`), true);
    assert.equal(entry().swaps.i1.id, 'i1', 'gardé sous l\'identifiant de l\'aliment remplacé');
    assert.equal(run(`dietSetSwap(data, 'd_a', 'i1', { name: 'X' }, '${D}')`), false);
    assert.equal(run('data.dietLog'), undefined, 'illisible : l\'aliment prévu revient');
    assert.equal(run(`dietSetPlanQty(data, 'd_a', 'zz', { g: 50 }, '${D}')`), false);
    assert.equal(run(`dietSetPlanQty(data, 'd_a', 'i1', null, '${D}')`), false);
    assert.equal(run(`dietSetPlanQty(data, 'zz', 'i1', { g: 50 }, '${D}')`), false);
    assert.equal(run(`dietSetPlanQty(data, 'd_a', 'i1', { g: 0 }, '${D}')`), false, 'quantité illisible');
    assert.equal(run(`dietSetPlanQty(data, 'd_a', 'i1', { g: 50 }, '${D}')`), true);
    sameJSON([entry().swaps.i1.g, entry().swaps.i1.name], [50, 'Riz i1']);
    const por = { n: 2, u: 'part', g: 50 };
    assert.equal(run(`dietSetPlanQty(data, 'd_a', 'i1', { g: 100, por: ${JSON.stringify(por)} }, '${D}')`), true, 'quantité prévue mais à l\'unité : gardée');
    sameJSON(entry().swaps.i1.por, { n: 2, u: 'part', pl: 'part', g: 50 });
    assert.equal(run(`dietSetPlanQty(data, 'd_a', 'i1', { g: 100.4 }, '${D}')`), true);
    assert.equal(run('data.dietLog'), undefined, 'quantité prévue en grammes : le plan revient');
    // Plan à l'unité : revenir au même nombre d'unités remet le plan
    run(`data.dietPlans.d_a.meals[0].items[0].por = { n: 2, u: 'part', pl: 'part', g: 50 }`);
    run(`dietSetPlanQty(data, 'd_a', 'i1', { g: 150, por: { n: 3, u: 'part', g: 50 } }, '${D}')`);
    assert.equal(entry().swaps.i1.g, 150);
    run(`dietSetPlanQty(data, 'd_a', 'i1', { g: 100, por: { n: 2, u: 'part', g: 50 } }, '${D}')`);
    assert.equal(run('data.dietLog'), undefined);
    // Remplaçant choisi : sa quantité change, il reste le remplaçant (même à la quantité du plan)
    run(`dietSetSwap(data, 'd_a', 'i1', { name: 'Pâtes', g: 80, per: ${JSON.stringify(PER)} }, '${D}'); dietSetPlanQty(data, 'd_a', 'i1', { g: 100 }, '${D}')`);
    sameJSON([entry().swaps.i1.name, entry().swaps.i1.g], ['Pâtes', 100]);
  });

  test('journée : retirer un aliment pour aujourd\'hui puis le remettre, sans doublon', () => {
    setup();
    assert.equal(run(`dietSetRemoved(data, 'd_a', 'i1', true, '${D}')`), true);
    run(`dietSetRemoved(data, 'd_a', 'i1', true, '${D}')`);
    sameJSON(entry().removed, ['i1']);
    assert.equal(pr().nMeals, 1, 'seul aliment du repas retiré : plus à cocher');
    assert.equal(run(`dietSetRemoved(data, 'd_a', 'i1', false, '${D}')`), false);
    assert.equal(run('data.dietLog'), undefined);
  });

  test('journée : ajouts bornés à 25, repas inconnu, quantité à l\'unité, quantité illisible sans effet', () => {
    setup();
    assert.equal(run(`dietAddExtra(data, 'd_a', 'zz', ${JSON.stringify(it('x'))}, '${D}')`), null, 'repas inconnu');
    assert.equal(run(`dietAddExtra(data, 'd_a', 'm1', { name: 'X' }, '${D}')`), null, 'illisible');
    for (let i = 0; i < 25; i++) assert.ok(run(`dietAddExtra(data, 'd_a', 'm1', ${JSON.stringify(it('x'))}, '${D}')`));
    assert.equal(run(`dietAddExtra(data, 'd_a', 'm1', ${JSON.stringify(it('x'))}, '${D}')`), null, 'repas plein');
    const id = entry().extras.m1[0].id;
    assert.notEqual(id, 'x', 'identifiant neuf');
    assert.equal(run(`dietSetExtra(data, 'd_a', 'm1', 'zz', 50, '${D}')`), false);
    assert.equal(run(`dietSetExtra(data, 'd_a', 'm1', '${id}', 0, '${D}')`), false, 'quantité illisible');
    assert.equal(entry().extras.m1[0].g, 100, 'rien changé');
    assert.equal(run(`dietSetExtra(data, 'd_a', 'm1', '${id}', { g: 100, por: { n: 2, u: 'part', g: 50 } }, '${D}')`), true);
    sameJSON(entry().extras.m1[0].por, { n: 2, u: 'part', pl: 'part', g: 50 });
    assert.equal(run(`dietSetExtra(data, 'd_a', 'm1', '${id}', 60, '${D}')`), true);
    sameJSON([entry().extras.m1[0].g, 'por' in entry().extras.m1[0], entry().extras.m1[0].id], [60, false, id], 'grammes seuls : unité retirée, même identifiant');
    assert.equal(run(`dietSetExtra(data, 'd_a', 'm1', '${id}', null, '${D}')`), true);
    assert.equal(entry().extras.m1.length, 24);
    assert.ok(!entry().extras.m1.some(x => x.id === id));
  });

  // ── Repas retirés, Annuler ──

  test('repas retiré : seulement celui-là, deux fois sans doublon ; remis ; Annuler sans retrait = rien', () => {
    setup();
    run(`dietToggleMeal(data, 'd_a', 'm1', '${D}')`);
    const gone = clone(run(`dietSetMealOff(data, 'd_a', 'm2', '${D}')`));
    sameJSON(gone, { extras: [], done: false });
    run(`dietSetMealOff(data, 'd_a', 'm2', '${D}')`);
    sameJSON([entry().off, entry().done], [['m2'], ['m1']], 'la coche d\'un autre repas reste');
    assert.equal(run(`dietSetMealOn(data, 'd_a', 'zz', '${D}')`), false);
    assert.equal(run(`dietSetMealOn(data, 'zz', 'm2', '${D}')`), false);
    assert.equal(run(`dietSetMealOn(data, 'd_a', 'm2', '${D}')`), true);
    assert.ok(!('off' in entry()));
    assert.equal(run(`dietUndoMealOff(data, 'd_a', 'm2', null, '${D}')`), false, 'sans rien à remettre');
    assert.equal(run(`dietUndoMealOff(data, 'd_a', 'zz', { extras: [], done: true }, '${D}')`), false);
    assert.equal(run(`dietSetMealOff(data, 'zz', 'm1', '${D}')`), null);
  });

  test('Annuler un retrait : ajouts remis sans doublon, 25 au plus, après ceux faits entre-temps ; coche remise une fois', () => {
    setup();
    for (let i = 0; i < 3; i++) run(`dietAddExtra(data, 'd_a', 'm1', ${JSON.stringify(it('a' + i, 10 + i))}, '${D}')`);
    run(`dietToggleMeal(data, 'd_a', 'm1', '${D}')`);
    const gone = clone(run(`dietSetMealOff(data, 'd_a', 'm1', '${D}')`));
    sameJSON([gone.extras.length, gone.done], [3, true]);
    assert.ok(!entry() || !entry().extras?.m1, 'ajouts partis avec le repas');
    for (let i = 0; i < 23; i++) run(`dietAddExtra(data, 'd_a', 'm1', ${JSON.stringify(it('b' + i, 50))}, '${D}')`);
    const now = entry().extras.m1;
    gone.extras.push(now[0]);   // déjà présent : jamais en double
    assert.equal(run(`dietUndoMealOff(data, 'd_a', 'm1', ${JSON.stringify(gone)}, '${D}')`), true);
    const e = entry();
    assert.equal(e.extras.m1.length, 25, '25 au plus');
    sameJSON(e.extras.m1.slice(0, 2).map(x => x.g), [10, 11], 'ajouts remis d\'abord');
    assert.equal(new Set(e.extras.m1.map(x => x.id)).size, 25, 'aucun doublon');
    sameJSON(e.done, ['m1']);
    // Recoché entre-temps : la coche n'est pas doublée
    const g2 = clone(run(`dietSetMealOff(data, 'd_a', 'm2', '${D}')`));
    run(`dietSetMealOn(data, 'd_a', 'm2', '${D}'); dietToggleMeal(data, 'd_a', 'm2', '${D}')`);
    run(`dietUndoMealOff(data, 'd_a', 'm2', ${JSON.stringify({ ...g2, done: true })}, '${D}')`);
    sameJSON(entry().done.filter(x => x === 'm2'), ['m2']);
  });

  // ── Jour vide, Copier le plan, réglage ──

  test('jour vide : rien à cocher, repas copiables ; copier un repas le remet s\'il était retiré ; repas inconnu', () => {
    setup(); run('data.dietEmptyDays = true');
    let p = pr();
    sameJSON([p.blank, p.nMeals, p.nDone, p.complete, p.next, p.meals.map(x => x.copyable)], [true, 2, 0, false, null, [true, true, false]]);
    run(`dietSetMealOff(data, 'd_a', 'm2', '${D}')`);
    p = pr();
    sameJSON([p.nMeals, p.meals[1].copyable, p.meals[1].off], [1, false, true], 'retiré : plus à faire ni copiable');
    assert.equal(run(`dietCopyMealPlan(data, 'd_a', 'zz', '${D}')`), false);
    assert.equal(run(`dietCopyMealPlan(data, 'zz', 'm2', '${D}')`), false);
    assert.equal(run(`dietCopyMealPlan(data, 'd_a', 'm2', '${D}')`), true);
    run(`dietCopyMealPlan(data, 'd_a', 'm2', '${D}')`);
    sameJSON([entry().copied, 'off' in entry()], [['m2'], false], 'copié une fois, plus retiré');
    p = pr();
    sameJSON([p.meals[1].live.length, p.meals[1].copyable, p.next.meal.id, p.eaten.kcal], [1, false, 'm2', 0], 'copié : à cocher, pas encore mangé');
    // Repas non copié : fait dès qu'un aliment y est noté ; copié : fait à la coche
    run(`dietAddExtra(data, 'd_a', 'm1', ${JSON.stringify(it('x', 100, P2))}, '${D}')`);
    sameJSON([pr().nDone, pr().eaten.kcal], [1, 100]);
    run(`dietAddExtra(data, 'd_a', 'm2', ${JSON.stringify(it('y', 50, P2))}, '${D}')`);
    sameJSON([pr().nDone, pr().eaten.kcal], [1, 150], 'copié pas coché : son ajout compte, le repas pas fait');
    run(`dietToggleMeal(data, 'd_a', 'm2', '${D}')`);
    sameJSON([pr().nDone, pr().complete, pr().eaten.kcal], [2, true, 150 + 200]);
    assert.ok(run(`dietDayComplete(data, '${D}', 'd_a')`));
  });

  test('réglage des repas du jour : sans jour noté seul le choix change ; même mode : rien ; vers vides, les cochés copiés', () => {
    setup();
    run(`dietSetEmptyDays(data, 1, '${D}')`);
    sameJSON([run('data.dietEmptyDays'), run('data.dietLog')], [true, undefined], 'booléen, jour pas noté intact');
    run(`data.dietEmptyDays = false; dietToggleMeal(data, 'd_a', 'm1', '${D}')`);
    const before = JSON.stringify(entry());
    run(`dietSetEmptyDays(data, false, '${D}')`);
    assert.equal(JSON.stringify(entry()), before, 'même mode : rien');
    run(`dietSetEmptyDays(data, true, '${D}')`);
    sameJSON([entry().blank, entry().copied, entry().done], [true, ['m1'], ['m1']], 'coché : copié, toujours compté');
    assert.equal(pr().eaten.kcal, 155);
    run(`dietSetEmptyDays(data, true, '${D}')`);
    sameJSON(entry().copied, ['m1']);
    // Vers pré-remplis : un repas noté (ajout) mais pas copié est retiré ; un repas vide du plan jamais
    run(`dietAddExtra(data, 'd_a', 'm2', ${JSON.stringify(it('y', 50, P2))}, '${D}'); dietAddExtra(data, 'd_a', 'm3', ${JSON.stringify(it('z', 50, P2))}, '${D}')`);
    run(`dietSetEmptyDays(data, 0, '${D}')`);
    const e = entry();
    sameJSON([run('data.dietEmptyDays'), 'blank' in e, 'copied' in e, e.off], [false, false, false, ['m2']]);
    assert.equal(pr().eaten.kcal, 155 + 50 + 50, 'pas de double compte');
    // Jour noté avec un plan disparu : seul le choix change
    run(`data.dietLog['${D}'].plan = 'd_zz'; dietSetEmptyDays(data, true, '${D}')`);
    assert.ok(!('blank' in entry()));
  });

  test('jour lu : noté avec un autre plan = neuf ; aujourd\'hui sans rien de noté suit le réglage, un jour futur aussi', () => {
    setup(); run('data.dietEmptyDays = true');
    run(`data.dietLog = { '${D}': { plan: 'd_b', done: ['m1'], swaps: {} } }`);
    sameJSON(clone(run(`dietDay(data, 'd_a', '${D}')`)), { plan: 'd_a', done: [], swaps: {}, extras: {}, removed: [], off: [], copied: [], blank: true });
    const T = run('dietDayKey()'), F = run('dietDayKey(Date.now() + 86400000)');
    for (const day of [T, F]) {
      run(`data.dietLog = { '${day}': { plan: 'd_a', done: [], swaps: {} } }`);
      assert.equal(run(`dietDay(data, 'd_a', '${day}').blank`), true, `${day} : lu vide`);
      run(`data.dietLog['${day}'].extras = { m1: [${JSON.stringify(it('x'))}] }`);
      assert.equal(run(`dietDay(data, 'd_a', '${day}').blank`), undefined, 'un ajout noté : pré-rempli gardé');
    }
    const d = clone(run(`dietDay(data, 'd_a', '${D}')`));
    sameJSON([d.extras, d.removed, d.off, d.copied], [{}, [], [], []], 'champs absents lus vides');
    assert.equal(run(`dietDayUntouched({})`), true);
    for (const x of [{ done: ['a'] }, { swaps: { a: 1 } }, { extras: { a: [] } }, { removed: ['a'] }, { off: ['a'] }, { copied: ['a'] }]) assert.equal(run(`dietDayUntouched(${JSON.stringify(x)})`), false);
    assert.equal(run(`dietEmptyDaysFor({ dietPlans: {} }, 'd_a')`), true, 'plan inconnu : vide');
  });

  // ── Mangé à un repas, Reprendre le repas d'hier ──

  test('mangé à un repas : coché (remplaçant compris, retiré exclu), ajouts seuls si rien de prévu, sinon rien', () => {
    setup();
    const eaten = (meal, day = H, plan = 'd_a') => clone(run(`dietMealEaten(data, '${plan}', '${meal}', '${day}')`)).map(x => x.name);
    sameJSON(eaten('m1'), [], 'jour pas noté');
    run(`dietAddExtra(data, 'd_a', 'm1', ${JSON.stringify(it('x'))}, '${H}')`);
    sameJSON(eaten('m1'), [], 'pré-rempli pas coché : rien de mangé');
    run(`dietToggleMeal(data, 'd_a', 'm1', '${H}')`);
    sameJSON(eaten('m1'), ['Riz i1', 'Riz x']);
    run(`dietSetSwap(data, 'd_a', 'i1', { name: 'Pâtes', g: 80, per: ${JSON.stringify(PER)} }, '${H}')`);
    sameJSON(eaten('m1'), ['Pâtes', 'Riz x'], 'remplaçant');
    run(`dietSetRemoved(data, 'd_a', 'i1', true, '${H}')`);
    sameJSON(eaten('m1'), ['Riz x'], 'aliment prévu retiré : les ajouts seuls');
    sameJSON(eaten('zz'), []);
    sameJSON(eaten('m1', H, 'd_b'), []);
    run(`data.dietPlans.d_b = data.dietPlans.d_a`);
    sameJSON(eaten('m1', H, 'd_b'), [], 'jour noté avec un autre plan');
    // Repas retiré puis autre chose noté : mangé
    run(`dietSetMealOff(data, 'd_a', 'm2', '${H}'); dietAddExtra(data, 'd_a', 'm2', ${JSON.stringify(it('y'))}, '${H}')`);
    sameJSON(eaten('m2'), ['Riz y']);
  });

  test('reprendre un repas : la veille d\'abord, 7 jours au plus, ajouts limités à la place qui reste', () => {
    setup();
    const ago = i => run(`localISO(new Date('${D}T12:00:00').getTime() - ${i} * 86400000)`);
    run(`dietAddExtra(data, 'd_a', 'm3', ${JSON.stringify(it('old', 30))}, '${ago(7)}')`);
    sameJSON(clone(run(`dietMealReuseSource(data, 'd_a', 'm3', '${D}')`)).day, ago(7), '7e jour : encore repris');
    run(`dietAddExtra(data, 'd_a', 'm3', ${JSON.stringify(it('mid', 40))}, '${ago(3)}'); dietAddExtra(data, 'd_a', 'm3', ${JSON.stringify(it('yday', 50))}, '${ago(1)}')`);
    sameJSON(clone(run(`dietMealReuseSource(data, 'd_a', 'm3', '${D}')`)).items.map(x => x.g), [50], 'la veille d\'abord');
    run(`data.dietLog = { '${ago(8)}': data.dietLog['${ago(7)}'] }`);
    assert.equal(run(`dietMealReuseSource(data, 'd_a', 'm3', '${D}')`), null, '8 jours : trop vieux');
    // Place restante : 24 ajouts déjà là, 2 à reprendre → 1 ajouté ; plein → rien
    setup();
    run(`dietAddExtra(data, 'd_a', 'm3', ${JSON.stringify(it('a', 10))}, '${H}'); dietAddExtra(data, 'd_a', 'm3', ${JSON.stringify(it('b', 20))}, '${H}')`);
    for (let i = 0; i < 24; i++) run(`dietAddExtra(data, 'd_a', 'm3', ${JSON.stringify(it('c' + i, 5))}, '${D}')`);
    const r = clone(run(`dietReuseMeal(data, 'd_a', 'm3', '${D}')`));
    sameJSON([r.day, r.ids.length, entry().extras.m3.length, entry().extras.m3[24].g], [H, 1, 25, 10]);
    assert.equal(run(`dietReuseMeal(data, 'd_a', 'm3', '${D}')`), null, 'repas plein');
    assert.equal(run(`dietUndoReuseMeal(data, 'd_a', 'm3', ['zz'], '${D}')`), false);
    assert.equal(run(`dietUndoReuseMeal(data, 'd_a', 'm3', ${JSON.stringify(r.ids)}, '${D}')`), true);
    assert.equal(entry().extras.m3.length, 24);
  });

  // ── Journée complète, série, frise ──

  test('journée complète : jour absent, autre plan, journal ancien sans instantané (repas retirés exclus), instantané vide', () => {
    setup();
    assert.equal(run(`dietDayComplete(data, '${D}')`), false);
    run(`data.dietLog = { '${D}': { plan: 'd_a', done: ['m1', 'm2'], swaps: {} } }`);
    assert.equal(run(`dietDayComplete(data, '${D}')`), true, 'ancien journal : le plan actuel');
    assert.equal(run(`dietDayComplete(data, '${D}', 'd_a')`), true);
    assert.equal(run(`dietDayComplete(data, '${D}', 'd_b')`), false, 'coché avec un autre plan');
    run(`data.dietLog['${D}'].done = ['m1']`);
    assert.equal(run(`dietDayComplete(data, '${D}')`), false);
    run(`data.dietLog['${D}'].off = ['m2']`);
    assert.equal(run(`dietDayComplete(data, '${D}')`), true, 'repas retiré exclu');
    run(`data.dietLog['${D}'].meals = []`);
    assert.equal(run(`dietDayComplete(data, '${D}')`), false, 'rien à faire : jamais complet');
    run(`data.dietLog['${D}'].plan = 'd_zz'; delete data.dietLog['${D}'].meals`);
    assert.equal(run(`dietDayComplete(data, '${D}')`), false, 'plan disparu');
  });

  test('série : 120 jours au plus, aujourd\'hui avec le plan suivi ; frise : jours en partie (coche ou ajout)', () => {
    setup();
    const NOW2 = new Date(2026, 10, 5, 21).getTime();
    const key = i => run(`dietDayKey(new Date(2026, 10, 5 - ${i}, 12).getTime())`);
    const full = { plan: 'd_a', done: ['m1', 'm2'], swaps: {}, meals: ['m1', 'm2'] };
    run(`data.dietLog = ${JSON.stringify(Object.fromEntries(Array.from({ length: 130 }, (_, i) => [key(i + 1), full])))}`);
    assert.equal(run(`dietStreak(data, ${NOW2})`), 120, 'plafond de 120 jours');
    run(`data.dietLog['${key(0)}'] = ${JSON.stringify(full)}`);
    assert.equal(run(`dietStreak(data, ${NOW2})`), 121, 'aujourd\'hui compté en plus des 120 jours gardés');
    run(`data.dietLog['${key(0)}'].plan = 'd_b'`);
    assert.equal(run(`dietStreak(data, ${NOW2})`), 120, 'aujourd\'hui avec un autre plan : la série court jusqu\'à hier');
    run(`delete data.dietActive`);
    assert.equal(run(`dietStreak(data, ${NOW2})`), 121, 'sans plan suivi : aujourd\'hui compté quel que soit son plan');
    run(`data.dietLog = { '${key(1)}': ${JSON.stringify(full)}, '${key(0)}': { plan: 'd_b', done: ['m1', 'm2'], swaps: {}, meals: ['m1', 'm2'] } }`);
    assert.equal(run(`dietStreak(data, ${NOW2})`), 2, 'sans plan suivi : aujourd\'hui compté quel que soit son plan');
    run(`data.dietActive = 'd_a'`);
    run(`data.dietLog = { '${key(2)}': { plan: 'd_a', done: [], swaps: {}, extras: { m3: [${JSON.stringify(it('x'))}] } }, '${key(1)}': { plan: 'd_a', done: ['m1'], swaps: {} },
      '${key(3)}': { plan: 'd_a', done: [], swaps: {}, blank: true }, '${key(0)}': { plan: 'd_b', done: ['m1'], swaps: {} } }`);
    const w = clone(run(`dietWeek(data, ${NOW2})`));
    sameJSON(w.map(x => x.some), [false, false, false, false, true, true, false], 'ajout ou coche : en partie ; aujourd\'hui d\'un autre plan : rien');
    assert.equal(w[0].day, key(6));
    assert.equal(w[6].ts, new Date(2026, 10, 5, 12).getTime(), 'midi du jour');
    run(`delete data.dietActive`);
    assert.equal(clone(run(`dietWeek(data, ${NOW2})`))[6].some, true, 'sans plan suivi : tout plan compte');
  });

  test('jour affiché : jour choisi gardé le jour même et s\'il est dans la frise ; choix périmé après 5 min ou le lendemain', () => {
    const now = new Date(2026, 10, 5, 12).getTime(), T = '2026-11-05', week = ['2026-11-03', '2026-11-04', T];
    const pick = { day: '2026-11-04', today: T, at: now };
    assert.equal(run(`dietPickedDay(${JSON.stringify(pick)}, '2026-11-04', ${JSON.stringify(week)}, ${now})`), '2026-11-04');
    assert.equal(run(`dietPickedDay(${JSON.stringify(pick)}, '2026-11-03', ${JSON.stringify(week)}, ${now})`), T, 'autre jour demandé');
    assert.equal(run(`dietPickedDay(${JSON.stringify({ ...pick, today: '2026-11-04' })}, '2026-11-04', ${JSON.stringify(week)}, ${now})`), T, 'choisi hier');
    assert.equal(run(`dietPickedDay(${JSON.stringify(pick)}, '2026-11-04', ['${T}'], ${now})`), T, 'hors de la frise');
    assert.equal(run(`dietPickedDay(null, '2026-11-04', ${JSON.stringify(week)}, ${now})`), T);
    assert.equal(run(`dietPickStale(null, ${now})`), false);
    assert.equal(run(`dietPickStale(${JSON.stringify(pick)}, ${now + 5 * 60000})`), false, '5 min pile : encore valable');
    assert.equal(run(`dietPickStale(${JSON.stringify(pick)}, ${now + 5 * 60000 + 1})`), true);
    assert.equal(run(`dietPickStale(${JSON.stringify({ ...pick, today: '2026-11-04' })}, ${now})`), true, 'lendemain');
  });

  test('carte de l\'accueil : rien sans bilan, repas aux ajouts seuls listés, plafond choisi', () => {
    sameJSON(clone(run(`dietHomeMeals(null)`)), { shown: [], more: 0 });
    const meals = [{ meal: { items: [] }, extras: [{}] }, { meal: { items: [] }, extras: [] }, { meal: { items: [{}] } }];
    assert.equal(run('dietHomeMeals')({ meals }).shown.length, 2, 'ajouts seuls : listé ; rien : pas listé');
    const mk = n => ({ meals: Array.from({ length: n }, (_, i) => ({ meal: { id: 'm' + i, items: [{}] } })) });
    const five = mk(5);
    five.next = five.meals[4];
    const r = run('dietHomeMeals')(five, 5);
    sameJSON([r.shown.length, r.more], [5, 0], '5 au plus : tous');
    const r2 = run('dietHomeMeals')(five);
    sameJSON([r2.shown.map(x => x.meal.id), r2.more], [['m2', 'm3', 'm4'], 2]);
    const r3 = run('dietHomeMeals')({ ...five, next: five.meals[1] });
    sameJSON(r3.shown.map(x => x.meal.id), ['m0', 'm1', 'm2'], 'le repas d\'avant, le prochain, le suivant');
  });

  // ── Plans : liste, création, copie, suppression ──

  test('plans listés : suivi d\'abord, puis les miens, puis ceux du coach, par nom ; archivés exclus', () => {
    reset();
    run(`data.dietPlans = { d_1: { name: 'Zèbre', meals: [] }, d_2: { name: 'été', meals: [] }, d_3: { name: 'Avant', meals: [], fromCoach: { coachId: 'c' } },
      d_4: { name: 'Base', meals: [], archived: true }, d_5: { name: 'Coach B', meals: [] }, d_6: { name: 'Aa', meals: [], fromCoach: { coachId: 'c' } } }; data.dietActive = 'd_6'`);
    sameJSON(clone(run('dietPlanIds(data)')), ['d_6', 'd_5', 'd_2', 'd_1', 'd_3']);
    run('delete data.dietActive');
    sameJSON(clone(run('dietPlanIds(data)')), ['d_5', 'd_2', 'd_1', 'd_6', 'd_3']);
    sameJSON(clone(run('dietPlanIds({})')), []);
    assert.equal(run('dietActivePlan(data)'), null);
    run(`data.dietActive = 'd_4'`);
    assert.equal(run('dietActivePlan(data)'), null, 'archivé : pas suivi');
    run(`data.dietActive = 'd_1'`);
    assert.equal(run('dietActivePlan(data).name'), 'Zèbre');
  });

  test('plans : limite de création exacte (20, coach 100), plan neuf, suivi d\'office seulement sans plan suivi', () => {
    reset();
    const plans = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`d_p${i}`, { name: 'P' + i, meals: [] }]));
    run(`data.dietPlans = ${JSON.stringify({ ...plans(19), d_x: { name: 'X', meals: [], archived: true } })}`);
    assert.equal(run('dietCanCreate(data)'), true, '19 vivants (l\'archivé ne compte pas)');
    run(`data.dietPlans = ${JSON.stringify(plans(20))}`);
    assert.equal(run('dietCanCreate(data)'), false);
    run(`data.dietPlans = ${JSON.stringify(plans(99))}`);
    assert.equal(run('dietCanCreate(data, true)'), true);
    run(`data.dietPlans = ${JSON.stringify(plans(100))}`);
    assert.equal(run('dietCanCreate(data, true)'), false);
    reset();
    const id = run(`dietNewPlan(data, '   ')`);
    assert.match(id, /^d_/);
    const p = clone(run(`data.dietPlans['${id}']`));
    sameJSON([p.name, p.meals.map(m => m.name), p.meals.every(m => m.items.length === 0), typeof p.updatedAt], ['Mon plan', ['Petit-déjeuner', 'Déjeuner', 'Collation', 'Dîner'], true, 'number']);
    assert.equal(new Set(p.meals.map(m => m.id)).size, 4);
    assert.equal(run('data.dietActive'), id);
    const id2 = run(`dietNewPlan(data, '${'N'.repeat(50)}')`);
    sameJSON([run(`data.dietPlans['${id2}'].name.length`), run('data.dietActive')], [40, id], 'nom borné ; le plan suivi reste');
    assert.equal(run(`data.dietPlans['${run('dietNewPlan(data)')}'].name`), 'Mon plan');
  });

  test('plans : copier (archivé ou inconnu refusé, nom borné, jamais suivi), copier un repas (8 au plus), supprimer = archiver', () => {
    reset();
    run(`data.dietPlans = { d_a: ${JSON.stringify({ name: 'N'.repeat(40), targets: { kcal: 2000 }, meals: [{ id: 'm1', name: 'M'.repeat(40), items: [it('i1')] }, { id: 'm2', name: 'B', items: [] }] })},
      d_z: { name: 'Z', meals: [], archived: true } }; data.dietActive = 'd_a'`);
    assert.equal(run(`dietDuplicatePlan(data, 'd_z')`), null);
    assert.equal(run(`dietDuplicatePlan(data, 'zz')`), null);
    const nid = run(`dietDuplicatePlan(data, 'd_a')`);
    const c = clone(run(`data.dietPlans['${nid}']`));
    sameJSON([nid.startsWith('d_'), c.name.length, c.targets, run('data.dietActive'), typeof c.updatedAt], [true, 40, { kcal: 2000 }, 'd_a', 'number']);
    const plan = clone(run('data.dietPlans.d_a'));
    const mid = run('dietCopyMeal')(run('data.dietPlans.d_a'), 'm1');
    const after = clone(run('data.dietPlans.d_a.meals'));
    sameJSON(after.map(m => m.id), ['m1', mid, 'm2'], 'juste après lui');
    sameJSON([after[1].name.length, after[1].items.length, after[1].items[0].name], [40, 1, 'Riz i1']);
    assert.equal(run(`dietCopyMeal(data.dietPlans.d_a, 'zz')`), null);
    assert.equal(run(`dietCopyMeal(null, 'm1')`), null);
    run(`data.dietPlans.d_a.meals = ${JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ id: 'k' + i, name: 'K', items: [] })))}`);
    assert.ok(run(`dietCopyMeal(data.dietPlans.d_a, 'k0')`), '7 repas : copie possible');
    assert.equal(run(`dietCopyMeal(data.dietPlans.d_a, 'k0')`), null, '8 repas : plein');
    assert.ok(plan);
    run(`dietArchivePlan(data, 'zz'); dietArchivePlan(data, '${nid}')`);
    sameJSON([run('data.dietActive'), run(`data.dietPlans['${nid}'].archived`), run(`data.dietPlans['${nid}'].meals.length`), run(`'targets' in data.dietPlans['${nid}']`)], ['d_a', true, 0, false], 'autre plan suivi : il le reste');
    run(`dietArchivePlan(data, 'd_a')`);
    assert.ok(run(`!('dietActive' in data)`));
    const t = run('data.dietPlans.d_z.updatedAt');
    run('dietTouch(data.dietPlans.d_z)');
    assert.ok(run('data.dietPlans.d_z.updatedAt') > (t || 0));
  });

  // ── Plan envoyé par un coach ──

  test('envoi au coach : identifiants d\'envoi et local, statut du plan reçu (neuf, mise à jour, à jour)', () => {
    assert.equal(run(`dietSentId('d_abc')`), 'diet_abc');
    assert.equal(run(`dietSentId('dabc')`), 'diet_abc');
    assert.equal(run(`dietSentId('d_a.b c')`), 'diet_abc');
    assert.equal(run(`dietSentId('d_' + 'x'.repeat(40))`), 'diet_' + 'x'.repeat(30));
    assert.equal(run(`isDietSentId('diet_x')`), true);
    assert.equal(run(`isDietSentId('prog_x')`), false);
    assert.equal(run(`isDietSentId(5)`), false);
    assert.equal(run(`dietLocalId('diet_abc', 'ab-cd!efghij')`), 'dc_abcdefgh_abc');
    assert.equal(run(`dietLocalId('diet_abc', null)`), 'dc_x_abc');
    reset();
    const st = (sentAt, coach = 'c1') => clone(run(`dietReceivedStatus(data, { id: 'diet_p', sentAt: ${sentAt} }, '${coach}')`));
    sameJSON(st(5), { status: 'new', id: 'dc_c1_p' });
    run(`data.dietPlans = { dc_c1_p: { name: 'P', meals: [], fromCoach: { coachId: 'c1', sentAt: 5 } } }`);
    sameJSON([st(5).status, st(6).status, st(4).status], ['current', 'update', 'current']);
    sameJSON(st(6, 'c2').status, 'new', 'autre coach : jamais écrasé');
    run(`delete data.dietPlans.dc_c1_p.fromCoach`);
    assert.equal(st(1).status, 'update', 'sans date d\'envoi : toute date est plus récente');
    run(`data.dietPlans.dc_c1_p.archived = true`);
    assert.equal(st(1).status, 'new', 'archivé : repris comme neuf');
  });

  test('envoi au coach : forme envoyée, plan reçu nettoyé, aliments écartés comptés (25 par repas, 8 repas au plus)', () => {
    const plan = { name: 'P', consigne: 'Bois', targets: { kcal: 2000 }, fromCoach: { coachId: 'c' }, archived: true, updatedAt: 5,
      meals: [{ id: 'm1', name: 'M', note: 'Sans sel', items: [it('i1', 100, PER, { food: 9104, ecalc: true, por: { n: 2, u: 'part', g: 50 } })] }, { id: 'm2', name: 'B', items: [it('i2')] }] };
    const sent = clone(run(`dietToSent(${JSON.stringify(plan)})`));
    sameJSON(sent, { kind: 'diet', v: 1, diet: { name: 'P', meals: [
      { id: 'm1', name: 'M', note: 'Sans sel', items: [{ id: 'i1', name: 'Riz i1', food: 9104, fam: 'f', g: 100, per: PER, src: 'ciqual-2025', ecalc: true, por: { n: 2, u: 'part', pl: 'part', g: 50 } }] },
      { id: 'm2', name: 'B', items: [{ id: 'i2', name: 'Riz i2', food: null, fam: 'f', g: 100, per: PER, src: 'perso' }] }], targets: { kcal: 2000 }, consigne: 'Bois' } });
    assert.equal(run(`dietToSent('x')`), null);
    const back = clone(run(`cleanSentDiet(${JSON.stringify(sent)})`));
    sameJSON([back.name, back.meals.length, 'archived' in back, 'dropped' in back, back.targets.kcal], ['P', 2, false, false, 2000]);
    for (const raw of [null, { kind: 'prog', v: 1, diet: {} }, { kind: 'diet', v: '1', diet: {} }, { kind: 'diet', v: 1, diet: [] }, { kind: 'diet', v: 1, diet: { name: 'X', meals: [] } }]) {
      assert.equal(run(`cleanSentDiet(${JSON.stringify(raw)})`), null, JSON.stringify(raw));
    }
    // 30 aliments lisibles : 25 gardés, rien d'« écarté » (le plafond n'est pas une erreur) ; 10 repas : 8 comptés
    const many = { kind: 'diet', v: 1, diet: { name: 'X', meals: Array.from({ length: 10 }, (_, i) => ({ id: 'm' + i, name: 'M', items: Array.from({ length: 30 }, (_, j) => it(`i${i}_${j}`)) })) } };
    assert.ok(!('dropped' in clone(run(`cleanSentDiet(${JSON.stringify(many)})`))));
    many.diet.meals[0].items[0] = { name: 'Sans valeurs' };
    many.diet.meals[1] = null;
    many.diet.meals[9].items[0] = { name: 'Hors plafond' };
    assert.equal(clone(run(`cleanSentDiet(${JSON.stringify(many)})`)).dropped, 1);
    assert.equal(run(`dietSentTooNew({ kind: 'diet', v: 1 })`), false);
    assert.equal(run(`dietSentTooNew({ kind: 'diet', v: 2.5 })`), false);
    assert.equal(run(`dietSentTooNew({ kind: 'prog', v: 2 })`), false);
    assert.equal(run(`dietSentTooNew(null)`), false);
  });

  test('plan du coach pris : suivi, coach et date gardés, identifiant d\'envoi exigé, plan sans repas refusé', () => {
    reset();
    const data = { name: 'P', meals: [{ id: 'm1', name: 'M', items: [it('i1')] }], archived: true, dropped: 3, fromCoach: { coachId: 'pirate' } };
    assert.equal(run(`importCoachDiet(data, { id: 'prog_x', data: ${JSON.stringify(data)}, sentAt: 5 }, { user_id: 'c1' })`), null);
    assert.equal(run(`importCoachDiet(data, { id: 'diet_x', data: { name: 'P', meals: [] }, sentAt: 5 }, { user_id: 'c1' })`), null);
    assert.equal(run(`importCoachDiet(data, { id: 'diet_x' }, { user_id: 'c1' })`), null);
    const id = run(`importCoachDiet(data, { id: 'diet_x', data: ${JSON.stringify(data)}, sentAt: 5 }, { user_id: 'c1', username: 'max' })`);
    assert.equal(id, 'dc_c1_x');
    const p = clone(run(`data.dietPlans['${id}']`));
    sameJSON([p.fromCoach, 'archived' in p, 'dropped' in p, typeof p.updatedAt, run('data.dietActive')], [{ coachId: 'c1', name: 'max', sentAt: 5 }, false, false, 'number', id]);
    const id2 = run(`importCoachDiet(data, { id: 'diet_y', data: ${JSON.stringify(data)} }, null)`);
    sameJSON([id2, clone(run(`data.dietPlans['${id2}'].fromCoach`))], ['dc_x_y', { coachId: '', name: null, sentAt: 0 }]);
  });

  // ── Cas limites restants (survivants de la première passe) ──

  test('identifiants : plan et jour ancrés au début et à la fin ; familles toutes reconnues', () => {
    sameJSON(Object.keys(clone(run(`cleanDietPlans({ xd_a: { name: 'A', meals: [] }, 'd_a!': { name: 'B', meals: [] }, d_ok: { name: 'C', meals: [] } })`))), ['d_ok']);
    sameJSON(Object.keys(log({ 'x2026-11-05': E(), '2026-11-05x': E(), '2026-11-05': E() })), ['2026-11-05']);
    for (const fam of ['v', 'f', 'l', 'g', 'r', 'e', 's', 'b', 'p', 'a']) {
      assert.equal(run(`cleanDietItem({ name: 'X', g: 10, fam: '${fam}', per: { k: 0, p: 0, c: 0, f: 50 } }).fam`), fam, `famille ${fam}`);
    }
    assert.equal(run(`cleanDietItem({ name: 'X', g: 10, fam: '', per: { k: 0, p: 0, c: 0, f: 50 } }).fam`), 'g');
  });

  test('noms : 80 caractères pile gardés, mot qui finit pile à 80, moitié pile, double séparateur de fin, nom de plan coupé puis nettoyé', () => {
    const w80 = Array.from({ length: 16 }, () => 'abcd').join(' ').padEnd(80, 'x');   // 79 + x : 80 caractères, plusieurs mots
    assert.equal(w80.length, 80);
    assert.equal(run(`dietCutName('${w80}')`), w80, '80 pile : intact');
    const exact = 'abcdefghi '.repeat(8).slice(0, 79) + 'Z';   // le 80e caractère finit un mot, suivi d'un espace
    assert.equal(run(`dietCutName('${exact} suite')`), exact);
    const half = 'A'.repeat(40) + ' ' + 'B'.repeat(50);
    assert.equal(run(`dietCutName('${half}')`), 'A'.repeat(40), 'moitié pile : coupé au mot');
    assert.equal(run(`dietCutName('${'A'.repeat(10)} ${'B'.repeat(67)},;${'C'.repeat(20)}')`), `${'A'.repeat(10)} ${'B'.repeat(67)}`, 'séparateurs de fin retirés');
    assert.equal(run(`cleanDietPlan({ name: '${'a'.repeat(39)} b', meals: [] }).name`), 'a'.repeat(39), 'coupé à 40 puis espace de fin retiré');
    assert.equal(run(`cleanDietPlan({ name: 'Sèche\\t\\n  été', meals: [] }).name`), 'Sèche été');
  });

  test('Mes aliments : valeurs illisibles écartées malgré un nom, code-barres ancré, entrées vides tolérées', () => {
    sameJSON(clone(run(`cleanDietFoods([{ name: 'Skyr', per: { k: 1 } }])`)), []);
    for (const code of ['a12345678', '12345678x', 'a1234567890123', '12345678901234']) {
      assert.ok(!('code' in clone(run(`cleanDietFoods([{ name: 'S', code: '${code}', per: ${JSON.stringify(PER)} }])`))[0]), `code ${code} écarté`);
    }
    const list = [...Array.from({ length: 199 }, (_, i) => ({ id: 'f' + i, name: 'F' + i, per: PER })), null];
    assert.equal(run(`dietFoodsFull(${JSON.stringify(list)}, { name: 'Neuf' })`), true, 'entrée vide dans la liste : pas d\'erreur');
    assert.equal(run(`dietFoodsFull(${JSON.stringify(list)}, null)`), false, 'aucun aliment : rien ne part');
    reset();
    run(`data.dietFoods = [null, { id: 'a1', name: 'A', per: ${JSON.stringify(PER)} }]`);
    assert.equal(clone(run(`dietRemoveFood(data, 'a1')`)).index, 1);
    // Annuler : un aliment du même identifiant (renommé) ou du même nom est remplacé par celui qu'on remet
    run(`data.dietFoods = [{ id: 'b1', name: 'B renommé', per: ${JSON.stringify(PER)} }, { id: 'z', name: 'b', per: ${JSON.stringify(PER)} }, { id: 'k', name: 'K', per: ${JSON.stringify(PER)} }]`);
    run(`dietRestoreFood(data, { food: { id: 'b1', name: 'B', per: ${JSON.stringify(PER)} }, index: 0 })`);
    sameJSON(clone(run('data.dietFoods.map(x => x.name)')), ['B', 'K']);
  });

  test('journal : off, copied, removed illisibles absents ; ajouts nuls ou vides ignorés à l\'écriture', () => {
    sameJSON(log({ '2026-11-05': { plan: 'd_a', done: ['m1'], off: 'x', copied: 5, removed: {}, extras: [] } })['2026-11-05'], { plan: 'd_a', done: ['m1'], swaps: {} });
    reset();
    run(`dietWriteDay(data, '${D}', { plan: 'd_x', done: ['m1'], swaps: {}, extras: { m1: null }, blank: true })`);
    sameJSON(entry(), { plan: 'd_x', done: [], swaps: {}, meals: [], blank: true }, 'plan inconnu : rien du plan gardé');
    setup();
    run(`dietWriteDay(data, '${D}', { plan: 'd_a', done: ['m1'], swaps: {}, extras: { m1: null, m2: [${JSON.stringify(it('e'))}] } })`);
    sameJSON(Object.keys(entry().extras), ['m2']);
  });

  test('cas limites : repas sans état du jour, jour vide sans ajouts, réglage sans plan, deux remplacements gardés', () => {
    const meal = { id: 'm1', items: [it('a'), it('b')] };
    assert.equal(run(`dietMealLive(${JSON.stringify(meal)}, null)`).length, 2);
    assert.equal(run(`dietMealLive(null, {})`).length, 0);
    assert.equal(run(`dietMealLive(${JSON.stringify(meal)}, { removed: ['a'] })`).length, 1);
    assert.equal(run(`dietMealSatisfied({ blank: true, done: ['m1'] }, 'm1')`), false, 'jour vide, rien noté : pas fait même coché');
    assert.equal(run(`dietMealSatisfied({ blank: true, copied: ['m1'], done: ['m1'] }, 'm1')`), true);
    assert.equal(run(`dietEmptyDaysFor({}, 'd_a')`), true);
    setup();
    run(`dietSetSwap(data, 'd_a', 'i1', ${JSON.stringify(it('s1', 50))}, '${D}'); dietSetSwap(data, 'd_a', 'i2', ${JSON.stringify(it('s2', 60))}, '${D}')`);
    sameJSON(Object.keys(entry().swaps).sort(), ['i1', 'i2']);
    assert.equal(run(`dietLowKcal({})`), false);
    // Écart à l'objectif dès qu'un repas a des aliments (pas besoin qu'ils en aient tous), repas sans liste toléré
    const plan = { meals: [{ id: 'a', items: [it('x', 500, P2)] }, { id: 'b', items: [] }, { id: 'c' }], targets: { kcal: 1000 } };
    assert.equal(run(`dietTargetGap(${JSON.stringify(plan)})`), `Les repas prévus font 500 kcal de moins que l'objectif du jour.`);
    assert.equal(run(`dietTargetGap({ meals: [{ id: 'c' }], targets: { kcal: 1000 } })`), '');
    sameJSON(clone(run(`dietHomeMeals({})`)), { shown: [], more: 0 });
  });

  test('envoi au coach : préfixe « d » retiré seulement au début ; sans objectifs ni consigne, clés absentes', () => {
    assert.equal(run(`dietSentId('ad_b')`), 'diet_ad_b');
    assert.equal(run(`dietSentId('d_d_b')`), 'diet_d_b');
    const sent = clone(run(`dietToSent({ name: 'P', meals: [{ id: 'm1', name: 'M', items: [] }] })`));
    sameJSON(Object.keys(sent.diet), ['name', 'meals']);
    sameJSON(Object.keys(sent.diet.meals[0]), ['id', 'name', 'items']);
  });
}
