// Quantités à l'unité (js/data/food-portions.js) : portions de la table reliées aux aliments Ciqual, conversions,
// pluriels, unité du paquet (Open Food Facts), unité gardée avec l'aliment du plan (it.por, toujours en plus de it.g).
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8')).foods;
  const ciqual = name => { const r = foods.find(f => f[1] === name); assert.ok(r, `Ciqual : ${name}`); return { name: r[1], per: { k: r[3], p: r[4], c: r[5], f: r[6] } }; };
  const units = food => run(`foodPortions(${JSON.stringify(food)})`);
  const first = name => units(ciqual(name))[0];

  test('portions : aliments Ciqual reliés par leur nom (œuf, yaourt, viennoiseries, pain, fruits, viandes, huile)', () => {
    const cases = [
      ['Oeuf cru', 'œuf', 50], ['Oeuf dur', 'œuf', 50], ['Oeuf, blanc (blanc d\'oeuf), cru', 'blanc d’œuf', 30], ['Oeuf, jaune (jaune d\'oeuf), cru', 'jaune d’œuf', 18],
      ['Yaourt ou lait fermenté, nature', 'pot', 125], ['Fromage blanc, nature, 0% MG', 'pot', 100],
      ['Croissant pur beurre, artisanal', 'croissant', 60], ['Pain au chocolat, artisanal', 'pain au chocolat', 70], ['Pain aux raisins (viennoiserie), artisanal', 'pain aux raisins', 100],
      ['Pain blanc (par ex. : baguette, boule…)', 'baguette', 250], ['Pain de mie blanc, préemballé', 'tranche', 25],
      ['Sandwich baguette, jambon beurre, fait maison', 'sandwich', 280], ['Wrap poulet crudités', 'wrap', 180],
      ['Banane, chair sans peau, crue', 'banane', 120], ['Pomme, chair et peau, crue', 'pomme', 150], ['Kiwi, chair sans peau, avec pépins, cru', 'kiwi', 75],
      ['Jambon cuit, choix', 'tranche', 40], ['Boeuf, steak haché 5% MG cru', 'steak de 100 g', 100], ['Poulet, filet sans peau cru', 'filet', 150],
      ['Chocolat noir 70 % de cacao environ, de dégustation, tablette', 'carré', 5], ['Huile d\'olive vierge extra', 'cuillère à soupe', 10],
    ];
    for (const [name, u, g] of cases) {
      const p = first(name);
      assert.ok(p && p.u === u && p.g === g, `${name} → ${u} de ${g} g (${JSON.stringify(p)})`);
      assert.equal(p.about, true, `${name} : poids moyen, « environ »`);
    }
    assert.equal(units(ciqual('Pain blanc (par ex. : baguette, boule…)'))[0].half, true, 'baguette : ½ permis');
    assert.equal(units(ciqual('Pain blanc (par ex. : baguette, boule…)'))[1].u, 'tranche', 'deuxième unité : la tranche');
    assert.equal(units(ciqual('Huile d\'olive vierge extra'))[1].u, 'cuillère à café');
  });

  test('portions : pas de faux amis (bœuf, œufs de lompe, yaourt à boire, pomme de terre, jus d\'orange)', () => {
    for (const name of ['Boeuf, entrecôte crue', 'Oeufs de lompe ou oeufs de lump, semi-conserve', 'Oeuf de caille, cru', 'Lait fermenté ou yaourt à boire, aromatisé, sucré',
      'Pomme de terre, sans peau, crue', 'Jus d\'orange, pur jus', 'Marsala aux oeufs', 'Chocolat chaud, boisson instantanée, sucrée, prête à boire (reconstituée avec du lait demi-écrémé)']) {
      assert.equal(units(ciqual(name)).length, 0, `${name} : aucune unité`);
    }
    assert.equal(units({ name: 'Whey protéine vanille' })[0].u, 'dose', 'aliment perso : whey');
    assert.equal(units({ name: 'Œufs frais plein air' })[0].u, 'œuf', 'produit : « Œufs frais »');
  });

  test('portions : texte, pluriel, demi, VoiceOver, conversions', () => {
    const egg = { u: 'œuf', pl: 'œufs', g: 50 }, bag = { u: 'baguette', pl: 'baguettes', g: 250, half: true };
    assert.equal(run(`portionText(1, ${JSON.stringify(egg)})`), '1 œuf');
    assert.equal(run(`portionText(2, ${JSON.stringify(egg)})`), '2 œufs');
    assert.equal(run(`portionText(0.5, ${JSON.stringify(bag)})`), '½ baguette');
    assert.equal(run(`portionText(1.5, ${JSON.stringify(bag)})`), '1 ½ baguette', 'singulier sous 2');
    assert.equal(run(`portionSpoken(2, ${JSON.stringify(egg)})`), '2 œufs');
    assert.equal(run(`portionSpoken(0.5, ${JSON.stringify(bag)})`), 'une demie baguette');
    assert.equal(run(`portionSpoken(1.5, ${JSON.stringify(bag)})`), '1 baguette et demie');
    assert.equal(run(`portionGrams(2, ${JSON.stringify(egg)})`), 100);
    assert.equal(run(`portionGrams(0.5, ${JSON.stringify(bag)})`), 125);
    assert.equal(run(`portionClampN(1.4, ${JSON.stringify(egg)})`), 1, 'œuf : entier');
    assert.equal(run(`portionClampN(1.4, ${JSON.stringify(bag)})`), 1.5, 'baguette : au demi');
    assert.equal(run(`portionClampN(0, ${JSON.stringify(egg)})`), 1, 'au moins une unité');
    assert.equal(run(`portionClampN(99, ${JSON.stringify(egg)})`), 50);
  });

  test('aliment du plan : unité gardée à côté des grammes, jamais à leur place ; ancienne forme lue telle quelle', () => {
    reset();
    const per = { k: 140, p: 12.7, c: 0.3, f: 9.8 };
    const it = run(`cleanDietItem(${JSON.stringify({ name: 'Oeuf cru', food: 22000, fam: 'v', g: 100, per, por: { n: 2, u: 'œuf', pl: 'œufs', g: 50 } })})`);
    sameJSON(it.por, { n: 2, u: 'œuf', pl: 'œufs', g: 50 });
    assert.equal(it.g, 100);
    assert.equal(run(`dietQtyText(${JSON.stringify(it)})`), '2 œufs · 100 g');
    assert.equal(run(`dietQtySpoken(${JSON.stringify(it)})`), '2 œufs, 100 grammes');
    assert.equal(Math.round(run(`dietItemMacros(${JSON.stringify(it)})`).kcal), 140, 'les kcal suivent les grammes');
    // Unité qui ne redonne pas les grammes (ancien client qui a changé it.g sans connaître it.por) : retirée
    const stale = run(`cleanDietItem(${JSON.stringify({ name: 'Oeuf cru', fam: 'v', g: 150, per, por: { n: 2, u: 'œuf', pl: 'œufs', g: 50 } })})`);
    assert.equal(stale.g, 150);
    assert.ok(!('por' in stale), 'unité périmée retirée, les grammes font foi');
    assert.ok(!('por' in run(`cleanDietItem(${JSON.stringify({ name: 'Riz', fam: 'f', g: 150, per })})`)), 'ancienne forme : sans unité');
    for (const bad of [{ n: 0, u: 'œuf', g: 50 }, { n: 2, u: '', g: 50 }, { n: 2, u: '<b>', g: 50 }, { n: 2, u: 'œuf', g: 0 }, { n: 200, u: 'œuf', g: 0.5 }, 'x']) {
      assert.ok(!('por' in run(`cleanDietItem(${JSON.stringify({ name: 'Oeuf', fam: 'v', g: 100, per, por: bad })})`)), `unité illisible : ${JSON.stringify(bad)}`);
    }
    // Plan envoyé au coach : l'unité part avec l'aliment (un ancien élève l'ignore et garde les grammes)
    const sent = run(`dietToSent({ name: 'P', meals: [{ id: 'm1', name: 'Repas', items: [${JSON.stringify(it)}] }] })`);
    sameJSON(sent.diet.meals[0].items[0].por, it.por);
    // Ajout du jour : quantité changée à l'unité, puis en grammes (l'unité part)
    run(`data.dietPlans = { d_p1: { name: 'P', meals: [{ id: 'm1', name: 'Repas', items: [] }] } }; data.dietActive = 'd_p1';`);
    const added = run(`dietAddExtra(data, 'd_p1', 'm1', ${JSON.stringify(it)}, '2026-11-10')`);
    assert.ok(run(`dietSetExtra(data, 'd_p1', 'm1', ${JSON.stringify(added.id)}, { g: 150, por: { n: 3, u: 'œuf', pl: 'œufs', g: 50 } }, '2026-11-10')`));
    sameJSON(run(`data.dietLog['2026-11-10'].extras.m1[0].por`), { n: 3, u: 'œuf', pl: 'œufs', g: 50 });
    assert.ok(run(`dietSetExtra(data, 'd_p1', 'm1', ${JSON.stringify(added.id)}, 120, '2026-11-10')`));
    assert.ok(!('por' in run(`data.dietLog['2026-11-10'].extras.m1[0]`)), 'en grammes : sans unité');
  });

  test('Open Food Facts : unité du paquet (« 1 pot (125 g) », « 4 x 125 g », « 6 œufs »), gardée dans Mes aliments', () => {
    const nut = { 'energy-kcal_100g': 60, proteins_100g: 4, carbohydrates_100g: 5, fat_100g: 3 };
    const parse = product => run(`offParse(${JSON.stringify({ status: 1, product: { brands: 'Laiterie', nutriments: nut, ...product } })}, '3017620422003')`).food;
    sameJSON(parse({ product_name: 'Yaourt nature', quantity: '4 x 125 g' }).portion, { u: 'pot', pl: 'pots', g: 125 });
    sameJSON(parse({ product_name: 'Dessert lacté', quantity: '4 x 125 g' }).portion, { u: 'unité', pl: 'unités', g: 125 }, 'nom inconnu : « unité »');
    sameJSON(parse({ product_name: 'Dessert lacté', serving_size: '1 pot (125 g)' }).portion, { u: 'pot', pl: 'pots', g: 125 });
    sameJSON(parse({ product_name: 'Biscuits', serving_size: '2 biscuits (25g)' }).portion, { u: 'biscuit', pl: 'biscuits', g: 12.5 }, 'au singulier, poids d\'un biscuit');
    sameJSON(parse({ product_name: 'Œufs frais plein air', quantity: '6 œufs' }).portion, { u: 'œuf', pl: 'œufs', g: 50 });
    sameJSON(parse({ product_name: 'Barre', serving_quantity: 40, serving_size: '40 g' }).portion, { u: 'portion', pl: 'portions', g: 40 });
    assert.ok(!('portion' in parse({ product_name: 'Pâte à tartiner', quantity: '400 g', serving_quantity: 100 })), 'sans unité : grammes seuls');
    assert.match(run('OFF_FIELDS'), /serving_size,serving_quantity/, 'champs demandés à Open Food Facts');
    reset();
    const kept = run(`dietSaveScanned(data, ${JSON.stringify(parse({ product_name: 'Yaourt nature', quantity: '4 x 125 g' }))})`);
    sameJSON(kept.portion, { u: 'pot', pl: 'pots', g: 125 });
    sameJSON(run(`dietOwnPick(data.dietFoods[0]).portion`), { u: 'pot', pl: 'pots', g: 125 });
    sameJSON(run(`foodPortions(dietOwnPick(data.dietFoods[0]))[0]`), { u: 'pot', pl: 'pots', g: 125 }, 'unité du paquet en premier, exacte');
    assert.ok(!('portion' in run(`cleanDietFoods([{ name: 'X', per: { k: 1, p: 0, c: 0, f: 0 }, portion: { u: 'pot', g: -1 } }])[0]`)), 'portion illisible retirée');
  });
}
