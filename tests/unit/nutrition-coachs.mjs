// Retours des coachs du 18/11 (docs/NUTRITION_V1.md, « Retours des coachs du 18/11 ») : recherche sans scan et alias,
// équivalences sur le macro principal (pomme de terre → riz, vraies valeurs Ciqual), jours du plan (entraînement / repos,
// semaine), copies, envoi (format v1 gardé, taille), eau en fourchette et en verres, sel.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const j = v => JSON.stringify(v);
  const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
  const loadDb = () => run(`setFoodDb(${j(foods)})`);
  const item = (code, g) => run(`foodToItem(foodDb.byCode.get(${code}), ${g})`);
  const POMME_DE_TERRE = 4003, RIZ = 9104, FARINE_RIZ = 9520;
  const D = '2026-11-18';   // un mercredi
  const NOW = new Date(2026, 10, 18, 12).getTime();

  test('coachs 18/11 : sel de Ciqual (colonne « Sel chlorure de sodium »), traces à 0, inconnu absent', () => {
    loadDb();
    assert.equal(foods.cols[10], 'sel');
    assert.equal(run(`foodDb.byCode.get(15202).per.s`), 1.07, 'beurre de cacahuète : 1,07 g pour 100 g');
    assert.equal(run(`foodDb.byCode.get(${FARINE_RIZ}).per.s`), 0, '« < 0,13 » compté 0');
    const unknown = foods.foods.find(r => r[10] === null);
    assert.ok(unknown && run(`foodDb.byCode.get(${unknown[0]}).per.s`) === undefined, 'sel inconnu : pas de valeur inventée');
    // Une app d'avant lit les 10 premières colonnes : la 11e ne change rien pour elle
    assert.ok(foods.foods.every(r => r.length === 11));
  });

  test('coachs 18/11 : alias recherchables (« Crème de riz » = Farine de riz), source dite, rien d\'inventé', () => {
    loadDb();
    const hit = run(`searchFoods('crème de riz')[0].food`);
    assert.equal(hit.name, 'Crème de riz');
    assert.equal(hit.of, 'Farine de riz');
    assert.equal(hit.code, FARINE_RIZ);
    sameJSON(hit.per, run(`foodDb.byCode.get(${FARINE_RIZ}).per`), 'mêmes valeurs que l\'aliment Ciqual');
    const it = run(`foodToItem(searchFoods('creme de riz')[0].food, 60)`);
    sameJSON({ name: it.name, food: it.food, src: it.src, of: it.of }, { name: 'Crème de riz', food: FARINE_RIZ, src: 'ciqual-2025', of: 'Farine de riz' });
    assert.match(run(`searchFoods('blanc de poulet')[0].food.of`), /^Poulet, filet/);
    // Chaque alias renvoie à un aliment Ciqual qui existe ; whey et skyr absents de Ciqual : pas d'alias
    for (const [name, code] of foods.alias) assert.ok(foods.foods.some(r => r[0] === code), `${name} → ${code}`);
    assert.ok(!foods.alias.some(([n]) => /whey|skyr/i.test(n)));
    // Les alias ne se proposent pas comme équivalents (l'aliment Ciqual y est déjà)
    assert.ok(!run(`swapCandidates(${j(item(RIZ, 150))})`).some(c => c.food.alias));
    // Déjà trouvables sans alias : flocons d'avoine, beurre de cacahuète, riz basmati cuit
    for (const [q, re] of [['flocons avoine', /^Flocons d'avoine/], ['beurre cacahuete', /^Beurre de cacahuète/], ['riz basmati cuit', /^Riz basmati, cuit/]]) {
      assert.match(run(`searchFoods(${j(q)})[0].food.name`), re, q);
    }
  });

  test('coachs 18/11 : 350 g de pomme de terre cuite → riz blanc cuit, mêmes glucides (vraies valeurs Ciqual)', () => {
    loadDb();
    const pdt = item(POMME_DE_TERRE, 350);
    assert.equal(run(`swapRuleText(${j(pdt)})`), 'Même quantité de glucides');
    const c = run(`swapCandidates(${j(pdt)})`).find(x => x.food.code === RIZ);
    assert.ok(c, 'riz blanc cuit proposé');
    // 350 g × 16,8 g de glucides / 33,2 g = 177 g, arrondi aux 5 g : 175 g ; 271 kcal contre 284 (−13 kcal à l'écran, écart des kcal affichées)
    assert.equal(c.g, 175);
    assert.ok(Math.abs(c.macros.c - 350 * 0.168) < 1.2, `glucides ${c.macros.c}`);
    assert.equal(Math.round(c.macros.kcal) - Math.round(350 * 0.81), -13);
    assert.equal(run(`swapDeltaText(${Math.round(c.macros.kcal) - Math.round(350 * 0.81)}, 'kcal')`), '−13 kcal');
    // Viande : protéines ; matière grasse : lipides
    assert.equal(run(`swapRuleText(${j(item(36018, 150))})`), 'Même quantité de protéines');
    assert.equal(run(`swapRuleText(${j(item(17270, 10))})`), 'Même quantité de lipides');
    // Riz blanc, aliment de base, devant le riz semi-complet pour un féculent
    const list = run(`swapCandidates(${j(item(9113, 150))})`).map(x => x.food.code);
    assert.ok(list.indexOf(RIZ) >= 0 && list.indexOf(RIZ) < 4, list.join(','));
  });

  // Plan d'un coach : deux repas, 2 300 kcal le jour d'entraînement
  const coachPlan = () => ({ name: 'Sèche S1', targets: { kcal: 2300, p: 180 }, meals: [
    { id: 'm1', name: 'Déjeuner', items: [{ id: 'i1', name: 'Riz', food: RIZ, fam: 'f', g: 250, per: { k: 155, p: 3.3, c: 33.2, f: 0.7 } }] },
    { id: 'm2', name: 'Dîner', items: [{ id: 'i2', name: 'Poulet', food: 36018, fam: 'v', g: 200, per: { k: 120, p: 26, c: 0, f: 1.5 } }] }] });

  test('jours : entraînement / repos, copie du jour 1 (mêmes identifiants), séance du jour, choix à la main', () => {
    reset();
    run(`data.dietPlans = { d_a: ${j(coachPlan())} }; data.dietActive = 'd_a'; data.dietEmptyDays = false; data.history = []`);
    run(`dietSetDayMode(data.dietPlans.d_a, 'session')`);
    const p = run('clone(data.dietPlans.d_a)');
    assert.equal(p.days.mode, 'session');
    assert.equal(p.days.more[0].meals[0].id, 'm1', 'repas copiés avec leurs identifiants');
    // Jour de repos : moins de riz, 2 000 kcal
    run(`data.dietPlans.d_a.days.more[0].meals[0].items[0].g = 150; data.dietPlans.d_a.days.more[0].targets = { kcal: 2000, p: 180 }`);
    sameJSON(run(`clone(dietDayIndex(data, 'd_a', '${D}'))`), { i: 1, kind: 'r', auto: true }, 'sans séance : repos');
    assert.equal(run(`dietDayProgress(data, 'd_a', '${D}').goal.kcal`), 2000);
    run(`data.history = [{ id: 's', date: ${NOW}, exercises: [] }]`);
    sameJSON(run(`clone(dietDayIndex(data, 'd_a', '${D}'))`), { i: 0, kind: 't', auto: true }, 'séance faite ce jour-là : entraînement');
    assert.equal(run(`dietDayProgress(data, 'd_a', '${D}').goal.kcal`), 2300);
    // Repas coché un jour d'entraînement, puis l'élève passe en repos à la main : la coche reste (même identifiant)
    run(`dietToggleMeal(data, 'd_a', 'm1', '${D}'); dietSetDayKind(data, 'd_a', '${D}', 'r')`);
    assert.equal(run(`data.dietLog['${D}'].kind`), 'r');
    assert.equal(run(`dietDayProgress(data, 'd_a', '${D}').goal.kcal`), 2000);
    assert.ok(run(`data.dietLog['${D}'].done.includes('m1')`), 'coche gardée');
    assert.equal(Math.round(run(`dietDayProgress(data, 'd_a', '${D}').eaten.kcal`)), Math.round(155 * 1.5), 'mangé : la quantité du jour de repos');
    run(`dietSetDayKind(data, 'd_a', '${D}', null)`);
    assert.equal(run(`data.dietLog['${D}'].kind`), undefined, 'retour à la séance du jour');
    // Journal relu (sanitize) : kind gardé, valeur inconnue retirée
    run(`data.dietLog['${D}'].kind = 'r'; sanitizeDiet(data, ${NOW})`);
    assert.equal(run(`data.dietLog['${D}'].kind`), 'r');
    run(`data.dietLog['${D}'].kind = 'x'; sanitizeDiet(data, ${NOW})`);
    assert.equal(run(`data.dietLog['${D}'].kind`), undefined);
  });

  test('jours : semaine (lundi à dimanche), jour du calendrier, copier un repas et un jour, Annuler', () => {
    reset();
    run(`data.dietPlans = { d_a: ${j(coachPlan())} }; data.dietActive = 'd_a'; data.dietEmptyDays = false`);
    run(`dietSetDayMode(data.dietPlans.d_a, 'week')`);
    assert.equal(run('data.dietPlans.d_a.days.more.length'), 6);
    assert.equal(run(`dietDayIndex(data, 'd_a', '${D}').i`), 2, 'mercredi');
    assert.equal(run(`dietDayName(data.dietPlans.d_a, 6)`), 'Dimanche');
    // Repas du lundi changé, copié vers mardi et jeudi
    run(`data.dietPlans.d_a.meals[0].items[0].g = 300`);
    const before = run(`dietCopyMealToDays(data.dietPlans.d_a, 0, 'm1', [1, 3])`);
    assert.ok(before);
    assert.equal(run('data.dietPlans.d_a.days.more[0].meals[0].items[0].g'), 300, 'mardi');
    assert.equal(run('data.dietPlans.d_a.days.more[1].meals[0].items[0].g'), 250, 'mercredi inchangé');
    assert.equal(run('data.dietPlans.d_a.days.more[2].meals[0].items[0].g'), 300, 'jeudi');
    run(`dietRestoreDays(data.dietPlans.d_a, ${j(before)})`);
    assert.equal(run('data.dietPlans.d_a.days.more[0].meals[0].items[0].g'), 250, 'Annuler');
    // Jour entier vers les 6 autres
    run(`data.dietPlans.d_a.days.more[1].targets = { kcal: 1900 }`);
    run(`dietCopyDayToDays(data.dietPlans.d_a, 2, [0, 1, 3, 4, 5, 6])`);
    assert.equal(run('data.dietPlans.d_a.targets.kcal'), 1900, 'lundi = mercredi');
    assert.equal(run('data.dietPlans.d_a.days.more[5].targets.kcal'), 1900, 'dimanche = mercredi');
    // Retour à un seul jour : le lundi reste
    run(`dietSetDayMode(data.dietPlans.d_a, 'one')`);
    assert.equal(run('data.dietPlans.d_a.days'), undefined);
    // Formes illisibles écartées : mode inconnu, jours manquants
    sameJSON(run(`cleanDietDays({ mode: 'x', more: [] })`), null);
    sameJSON(run(`cleanDietDays({ mode: 'week', more: [{ meals: [] }] })`), null);
    assert.equal(run(`cleanDietDays({ mode: 'week', kinds: ['r'], more: Array(6).fill({ meals: [] }) }).kinds.join('')`), 'rtttttt');
  });

  test('envoi : format v1 gardé, jours en plus ; une app d\'avant lit le jour 1 ; 7 jours × 6 repas × 8 aliments sous 200 Ko', () => {
    reset();
    const p = coachPlan();
    run(`data.dietPlans = { d_a: ${j(p)} }; dietSetDayMode(data.dietPlans.d_a, 'session')`);
    const sent = run(`clone(dietToSent(data.dietPlans.d_a))`);
    assert.equal(sent.v, 1);
    assert.equal(sent.diet.meals.length, 2, 'jour 1 au premier niveau');
    assert.equal(sent.diet.days.mode, 'session');
    // Lecture par l'app d'aujourd'hui
    const back = run(`clone(cleanSentDiet(${j(sent)}))`);
    assert.equal(back.days.more.length, 1);
    // Lecture par une app d'avant : son nettoyage ne connaît pas days (simulé : la clé est ignorée), le jour 1 s'affiche
    const old = run(`(() => { const x = cleanSentDiet(${j(sent)}); delete x.days; return clone(x); })()`);
    assert.equal(old.meals[0].items[0].g, 250);
    // Plan v1 (sans jours) : comme avant
    assert.equal(run(`cleanSentDiet(${j({ kind: 'diet', v: 1, diet: p })}).days`), undefined);
    // Taille : 7 jours × 6 repas × 8 aliments au nom long
    const big = { name: 'Semaine', meals: [], targets: { kcal: 2300, water: 4, waterMin: 3, saltMin: 3, saltMax: 5 } };
    const meals = () => Array.from({ length: 6 }, (_, m) => ({ id: `m${m}`, name: `Repas ${m}`, note: 'Consigne du repas assez longue pour peser'.repeat(2),
      items: Array.from({ length: 8 }, (_, k) => ({ id: `i${m}_${k}`, name: 'Pâtes sèches, standard, cuites, sans sel ajouté, une portion', food: 9811, fam: 'f', g: 125,
        per: { k: 167, p: 6.7, c: 31.4, f: 1.1, s: 0.01 }, src: 'ciqual-2025', por: { n: 1, u: 'portion', pl: 'portions', g: 125 } })) }));
    big.meals = meals();
    big.days = { mode: 'week', kinds: ['t', 'r', 't', 'r', 't', 'r', 'r'], more: Array.from({ length: 6 }, () => ({ meals: meals(), targets: { kcal: 2000 } })) };
    run(`data.dietPlans.d_b = ${j(big)}`);
    const bytes = run(`sentProgrammeBytes(dietToSent(cleanDietPlan(data.dietPlans.d_b)))`);
    assert.ok(bytes < 200 * 1024, `${bytes} octets`);
    assert.equal(run(`dietToSent(cleanDietPlan(data.dietPlans.d_b)).diet.days.more.length`), 6);
  });

  test('eau : fourchette du plan (3 à 5 L), atteinte dès le bas, verres de 1 L si elle est large, sinon 25 cl', () => {
    reset();
    sameJSON(run(`cleanDietTargets({ water: 5, waterMin: 3 })`), { water: 5, waterMin: 3 });
    sameJSON(run(`cleanDietTargets({ water: 3, waterMin: 4 })`), { water: 3 }, 'bas au-dessus du haut : ignoré');
    sameJSON(run(`cleanDietTargets({ waterMin: 3 })`), null, 'bas seul : rien');
    const plan = { name: 'P', meals: [], targets: { water: 5, waterMin: 3 }, fromCoach: { coachId: 'c', name: 'max', sentAt: 1 } };
    const g = run(`waterGoalFor(data, { plan: ${j(plan)} })`);
    sameJSON({ l: g.l, min: g.min }, { l: 5, min: 3 });
    assert.equal(run(`waterGoalText(${j(g)})`), '3 à 5 L');
    sameJSON(run(`waterGlassPlan(${j(g)})`), { ml: 1000, n: 5 }, '« 5 verres, un verre = 1 L »');
    sameJSON(run(`waterGlassPlan({ l: 2.5, min: 2 })`), { ml: 250, n: 10 }, 'fourchette serrée : verres de 25 cl');
    sameJSON(run(`waterGlassPlan({ l: 6 })`), { ml: 500, n: 12 }, 'jamais plus de 16 verres');
  });

  test('sel : objectif en fourchette, sel des aliments + sel ajouté (pincée 0,4 g, cuillère 6 g), repère de l\'OMS', () => {
    reset();
    sameJSON(run(`cleanDietTargets({ saltMin: 3, saltMax: 5 })`), { saltMax: 5, saltMin: 3 });
    sameJSON(run(`cleanDietTargets({ saltMin: 6, saltMax: 5 })`), { saltMax: 5 }, 'bas au-dessus du haut : ignoré');
    sameJSON(run(`clone(dietSaltGoal({ targets: { saltMin: 3, saltMax: 5 } }))`), { min: 3, max: 5, over: false });
    assert.equal(run(`dietSaltGoal({ targets: { saltMin: 4, saltMax: 7 } }).over`), true, 'au-dessus de 5 g : dit au coach, rien de bloqué');
    sameJSON(run('clone(SALT_ADDS.map(x => x.g))'), [0.4, 6]);
    run(`data.dietPlans = { d_a: { name: 'P', targets: { saltMin: 3, saltMax: 5 }, meals: [{ id: 'm1', name: 'Déjeuner', items: [
      { id: 'i1', name: 'Pain', food: 7001, fam: 'f', g: 100, per: { k: 287, p: 9.1, c: 58.3, f: 1.4, s: 1.2 } },
      { id: 'i2', name: 'Perso', fam: 'f', g: 50, per: { k: 100, p: 1, c: 20, f: 1 } }] }] } }; data.dietActive = 'd_a'; data.dietEmptyDays = false`);
    run(`dietToggleMeal(data, 'd_a', 'm1', '${D}')`);
    assert.ok(run(`saltAdd(data, 0.4, '${D}', ${NOW})`));
    const s = run(`clone(dietDaySalt(data, dietDayProgress(data, 'd_a', '${D}')))`);
    assert.equal(Math.round(s.g * 10) / 10, 1.6, '1,2 g du pain + 0,4 g ajouté');
    assert.equal(s.unknown, 1, 'un aliment sans valeur de sel, dit');
    const id = run(`data.saltLog['${D}'][0].id`);
    assert.ok(run(`saltRemove(data, '${D}', '${id}')`));
    assert.equal(run('data.saltLog'), undefined);
    assert.equal(run(`saltAdd(data, 50, '${D}')`), null, 'plus de 20 g d\'un coup : refusé');
    // Sur l'appareil seulement, hors copie iCloud
    const sync = fs.readFileSync(path.join(ROOT, 'js/data/sync.js'), 'utf8'), native = fs.readFileSync(path.join(ROOT, 'js/platform/native.js'), 'utf8');
    assert.match(sync.match(/const SYNC_LOCAL_ONLY = \[[^\]]*\]/)[0], /'saltLog'/);
    assert.match(native.match(/const CLOUD_PRIVATE_KEYS = \[[^\]]*\]/)[0], /'saltLog'/);
  });

  test('saisie rapide : derniers aliments gardés (8 au plus, sans doublon), quantité reprise', () => {
    reset();
    for (let i = 0; i < 10; i++) run(`dietNoteRecent(data, cleanDietItem({ name: 'Aliment ${i}', g: ${100 + i}, per: { k: 100, p: 1, c: 20, f: 1 } }))`);
    run(`dietNoteRecent(data, cleanDietItem({ name: 'Aliment 5', g: 42, per: { k: 100, p: 1, c: 20, f: 1 } }))`);
    const r = run('clone(data.dietRecentFoods)');
    assert.equal(r.length, 8);
    sameJSON([r[0].name, r[0].g], ['Aliment 5', 42], 'le dernier choisi en tête, sa quantité');
    assert.equal(r.filter(x => x.name === 'Aliment 5').length, 1);
  });

  test('textes 18/11 : sobres (ni tiret long, ni point d\'exclamation, ni « Découvre »)', () => {
    for (const f of ['js/features/diet-week.js'].filter(x => fs.existsSync(path.join(ROOT, x)))) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const strings = src.match(/(['`])(?:\\.|(?!\1).)*\1/g) || [];
      for (const s of strings) {
        assert.ok(!/—/.test(s), `${f} : tiret long dans ${s.slice(0, 60)}`);
        assert.ok(!/[A-Za-zé]\s?!/.test(s.replace(/!==?|!\w/g, '')), `${f} : point d'exclamation dans ${s.slice(0, 60)}`);
        assert.ok(!/Découvre|Booste|N'hésite/.test(s), `${f} : ${s.slice(0, 60)}`);
      }
    }
  });
}
