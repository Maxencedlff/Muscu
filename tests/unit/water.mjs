// Eau (docs/EAU.md, js/data/water.js, js/features/water-ui.js) : objectif, ajouts, journal, synchro, plan du coach.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const j = v => JSON.stringify(v);

  test('eau : repère calculé, boissons de l\'EFSA (80 % de 2,5 et 2,0 L) + 0,5 L un jour d\'entraînement', () => {
    sameJSON(run(`waterAutoGoal({ sex: 'male' })`), { l: 2, base: 2, plus: 0 });
    sameJSON(run(`waterAutoGoal({ sex: 'female' })`), { l: 1.6, base: 1.6, plus: 0 });
    sameJSON(run(`waterAutoGoal({ sex: null })`), { l: 1.8, base: 1.8, plus: 0 }, 'sexe non précisé : le milieu');
    sameJSON(run(`waterAutoGoal({ sex: 'male', training: true })`), { l: 2.5, base: 2, plus: 0.5 });
    sameJSON(run(`waterAutoGoal({ sex: 'female', training: true })`), { l: 2.1, base: 1.6, plus: 0.5 });
    assert.equal(run(`waterAutoGoal({ sex: '__proto__' }).l`), 1.8, 'valeur inconnue : comme non précisé');
  });

  test('eau : objectif du plan (coach) d\'abord, puis celui choisi, puis le repère', () => {
    reset();
    const coachPlan = { name: 'P', meals: [], targets: { kcal: 2500, water: 3 }, fromCoach: { coachId: 'c', name: 'max', sentAt: 1 } };
    let g = run(`waterGoalFor(data, { plan: ${j(coachPlan)}, sex: 'male', training: true })`);
    sameJSON({ l: g.l, src: g.src, coach: g.coach }, { l: 3, src: 'plan', coach: 'max' }, 'le plan du coach fait foi, sans bonus');
    assert.match(run(`waterGoalWhy(${j(g)})`), /^Fixé par max dans ton plan de nutrition\.$/);
    run('data.waterGoalL = 3');
    g = run(`waterGoalFor(data, { plan: null, sex: 'male', training: true })`);
    sameJSON({ l: g.l, src: g.src, base: g.base, plus: g.plus }, { l: 3.5, src: 'me', base: 3, plus: 0.5 }, 'option C : 3 L choisis = 3,5 L un jour de séance');
    g = run(`waterGoalFor(data, { plan: null, sex: 'male', training: false })`);
    sameJSON({ l: g.l, plus: g.plus }, { l: 3, plus: 0 }, 'jour sans séance : 3 L');
    assert.equal(run(`waterGoalWhy(${j(g)})`), 'Choisi par toi, plus 0,5 L les jours de séance.');
    run('delete data.waterGoalL');
    g = run(`waterGoalFor(data, { plan: { name: 'x', meals: [], targets: { kcal: 2000 } }, sex: 'female', training: false })`);
    sameJSON({ l: g.l, src: g.src }, { l: 1.6, src: 'auto' }, 'plan sans eau : le repère');
    assert.equal(run(`waterGoalWhy(waterGoalFor(data, { sex: 'male', training: true }), { sex: 'male' })`),
      'Repère de l\'EFSA : 2 L de boissons par jour pour un homme, plus 0,5 L les jours de séance.');
  });

  test('eau : réglage « +0,5 L les jours de séance » allumé par défaut, coupé sur le repère et l\'objectif choisi, jamais sur le coach', () => {
    reset();
    assert.equal(run('waterTrainBonusOn(data)'), true, 'allumé par défaut (clé absente)');
    run('data.waterTrainOff = true');
    let g = run(`waterGoalFor(data, { sex: 'male', training: true })`);
    sameJSON({ l: g.l, plus: g.plus }, { l: 2, plus: 0 }, 'coupé : repère sans bonus');
    run('data.waterGoalL = 3');
    g = run(`waterGoalFor(data, { sex: 'male', training: true })`);
    sameJSON({ l: g.l, plus: g.plus }, { l: 3, plus: 0 }, 'coupé : objectif choisi tel quel');
    assert.equal(run(`waterGoalWhy(${j(g)}, { bonus: false })`), 'Choisi par toi.');
    run('delete data.waterTrainOff');
    g = run(`waterGoalFor(data, { plan: { name: 'P', meals: [], targets: { water: 3 }, fromCoach: { coachId: 'c', name: 'max' } }, sex: 'male', training: true })`);
    sameJSON({ l: g.l, plus: g.plus, src: g.src }, { l: 3, plus: 0, src: 'plan' }, 'objectif du coach : jamais de bonus');
    run('data.waterTrainOff = "oui"; sanitizeData(data)');
    assert.equal(run('data.waterTrainOff'), undefined, 'valeur illisible retirée (bonus allumé)');
    assert.ok(run(`SYNC_LOCAL_ONLY.includes('waterTrainOff')`));
  });

  test('eau : pas de 0,25 L sur la grille, bornes 0,5 à 6 L', () => {
    assert.equal(run('waterStepGoal(2.3, 1)'), 2.5);
    assert.equal(run('waterStepGoal(2.3, -1)'), 2.25);
    assert.equal(run('waterStepGoal(2.5, 1)'), 2.75);
    assert.equal(run('waterStepGoal(2.5, -1)'), 2.25);
    assert.equal(run('waterStepGoal(0.5, -1)'), 0.5);
    assert.equal(run('waterStepGoal(6, 1)'), 6);
  });

  test('eau : ajouter, total du jour, retirer (Annuler), jours séparés à minuit', () => {
    reset();
    const t1 = new Date(2026, 10, 17, 23, 50).getTime(), t2 = new Date(2026, 10, 18, 0, 5).getTime();
    const d1 = run(`localISO(${t1})`), d2 = run(`localISO(${t2})`);
    const a = run(`waterAdd(data, 250, '${d1}', ${t1})`);
    run(`waterAdd(data, 500, '${d1}', ${t1})`);
    run(`waterAdd(data, 1000, '${d2}', ${t2})`);
    assert.equal(run(`waterDayMl(data, '${d1}')`), 750);
    assert.equal(run(`waterDayMl(data, '${d2}')`), 1000, 'après minuit : le jour suivant');
    assert.equal(run(`waterRemove(data, '${d1}', '${a.id}')`), true);
    assert.equal(run(`waterDayMl(data, '${d1}')`), 500);
    assert.equal(run(`waterRemove(data, '${d1}', 'nope')`), false);
    assert.equal(run(`waterAdd(data, 5, '${d1}', ${t1})`), null, 'moins de 1 cl : refusé');
    assert.equal(run(`waterAdd(data, 3500, '${d1}', ${t1})`), null, 'plus de 3 L d\'un coup : refusé');
    for (let i = 0; i < 70; i++) run(`waterAdd(data, 100, '${d2}', ${t2})`);
    assert.equal(run(`waterDay(data, '${d2}').length`), 60, '60 ajouts au plus par jour');
  });

  test('eau : nettoyage (sanitizeData), 120 jours gardés, réglages bornés', () => {
    reset();
    const now = Date.now(), today = run('localISO()'), old = run(`localISO(${now - 200 * 86400000})`);
    run(`data.waterLog = ${j({ [today]: [{ id: 'a1', ml: 250, at: now }, { id: 'a1', ml: 330, at: now }, { ml: 'x' }, null],
      [old]: [{ id: 'z', ml: 250, at: 1 }], 'pas-un-jour': [{ ml: 250 }], '2026-13-01x': 4 })}`);
    run(`data.waterOn = 'oui'; data.waterGoalL = 12; data.waterCups = ${j([{ name: 'Ma gourde', ml: 750 }, { name: 'ma GOURDE', ml: 500 },
      { name: 'Verre', ml: 200 }, { name: '', ml: 300 }, { name: 'Shaker', ml: 20 }])}`);
    run('sanitizeData(data)');
    const log = run('data.waterLog');
    sameJSON(Object.keys(log), [today], 'jour trop ancien et clés invalides retirés');
    assert.equal(log[today].length, 2);
    assert.notEqual(log[today][0].id, log[today][1].id, 'identifiants rendus uniques');
    assert.equal(run('data.waterOn'), undefined);
    assert.equal(run('data.waterGoalL'), undefined, 'objectif hors bornes retiré');
    sameJSON(run('data.waterCups.map(c => [c.name, c.ml])'), [['Ma gourde', 750]], 'doublons, nom d\'office, vide et trop petit écartés');
    run('data.waterGoalL = 2.333; sanitizeData(data)');
    assert.equal(run('data.waterGoalL'), 2.35, 'au pas de 0,05 L');
  });

  test('eau : contenants perso (ajout, nom pris, 4 au plus, retrait)', () => {
    reset();
    sameJSON(run(`waterAddCup(data, 'Ma gourde', 750)`), { ok: true });
    sameJSON(run(`waterAddCup(data, 'ma gourde', 500)`), { ok: false, error: 'taken' });
    sameJSON(run(`waterAddCup(data, 'Bouteille', 500)`), { ok: false, error: 'taken' }, 'nom d\'un contenant d\'office');
    sameJSON(run(`waterAddCup(data, '', 500)`), { ok: false, error: 'name' });
    sameJSON(run(`waterAddCup(data, 'Tasse', 20)`), { ok: false, error: 'ml' });
    for (const n of ['A', 'B', 'C']) run(`waterAddCup(data, '${n}', 300)`);
    sameJSON(run(`waterAddCup(data, 'D', 300)`), { ok: false, error: 'full' });
    sameJSON(run('waterCups(data).map(c => c.name)'), ['Verre', 'Bouteille', '1 L', 'Ma gourde', 'A', 'B', 'C']);
    const id = run('data.waterCups[0].id');
    assert.equal(run(`waterRemoveCup(data, '${id}').cup.name`), 'Ma gourde');
    assert.equal(run('data.waterCups.length'), 3);
  });

  test('eau : quantité tapée (cl par défaut, litres jusqu\'à 5, ml et L écrits)', () => {
    const p = v => run(`waterParseQty(${j(v)})`);
    assert.equal(p('33'), 330);
    assert.equal(p('33 cl'), 330);
    assert.equal(p('330 ml'), 330);
    assert.equal(p('0,5'), 500);
    assert.equal(p('1,5 L'), 1500);
    assert.equal(p('2'), 2000, '2 seul : des litres');
    assert.equal(p('75'), 750);
    for (const bad of ['', 'abc', '0', '0,5 ml', '4000 ml', '1e3', '-25', '3,5 L']) assert.equal(p(bad), null, bad);
  });

  test('eau : textes (litres à la française, cl, VoiceOver)', () => {
    assert.equal(run('waterLitres(1200)'), '1,2');
    assert.equal(run('waterLitres(2250)'), '2,25');
    assert.equal(run('waterLitres(2000)'), '2');
    assert.equal(run('waterQtyText(250)'), '25\u00a0cl');
    assert.equal(run('waterQtyText(1000)'), '1\u00a0L');
    assert.equal(run('waterQtyText(1500)'), '1,5\u00a0L');
    assert.equal(run('waterQtySpoken(330)'), '33 centilitres');
    assert.equal(run('waterQtySpoken(2000)'), '2 litres');
  });

  test('eau : jour d\'entraînement = séance enregistrée ce jour-là, ou séance en cours aujourd\'hui', () => {
    reset();
    const t = new Date(2026, 10, 17, 18, 0).getTime(), day = run(`localISO(${t})`);
    assert.equal(run(`waterTrainingDay(data, '${day}')`), false);
    run(`data.history.push({ id: 'h1', date: ${t}, programme: 'ppl', category: 'push', exercises: [] })`);
    assert.equal(run(`waterTrainingDay(data, '${day}')`), true);
    assert.equal(run(`waterTrainingDay(data, localISO(), { live: true })`), true, 'séance en cours');
    assert.equal(run(`waterTrainingDay(data, '2020-01-01', { live: true })`), false, 'en cours ne vaut que pour aujourd\'hui');
  });

  test('eau : sur l\'appareil seulement (jamais sur le compte ni dans la copie iCloud), dans l\'export', () => {
    reset();
    for (const k of ['waterLog', 'waterOn', 'waterGoalL', 'waterCups', 'waterTrainOff']) {
      assert.ok(run(`SYNC_LOCAL_ONLY.includes('${k}') && !SYNC_PROFILE_KEYS.includes('${k}')`), k);
    }
    run(`data.waterOn = true; waterAdd(data, 250)`);
    assert.equal(run('Object.keys(profilePayload(data)).some(k => k.startsWith("water"))'), false);
    const native = fs.readFileSync(path.join(ROOT, 'js/platform/native.js'), 'utf8');
    assert.match(native.match(/const CLOUD_PRIVATE_KEYS = \[[^\]]*\]/)[0], /'waterLog'/);
  });

  test('eau : objectif du coach dans le plan (targets.water en litres), envoyé et reçu, ignoré des macros', () => {
    sameJSON(run(`cleanDietTargets({ kcal: 2500, water: 2.75 })`), { kcal: 2500, water: 2.75 });
    sameJSON(run(`cleanDietTargets({ water: 2.333 })`), { water: 2.35 });
    assert.equal(run(`cleanDietTargets({ water: 12 })`), null, 'hors bornes : rien');
    assert.equal(run(`cleanDietTargets({ water: '3' })?.water`), 3);
    const plan = { name: 'Sèche', targets: { kcal: 2200, p: 160, water: 3 }, meals: [{ id: 'm1', name: 'Déjeuner',
      items: [{ id: 'i1', name: 'Riz', food: 9104, fam: 'f', g: 150, per: { k: 145, p: 3, c: 31, f: 0.5 } }] }] };
    const sent = run(`dietToSent(${j(plan)})`);
    assert.equal(sent.v, 1, 'format inchangé (champ en plus, ignoré par une app d\'avant)');
    assert.equal(sent.diet.targets.water, 3);
    assert.equal(run(`cleanSentDiet(${j(sent)}).targets.water`), 3, 'reçu par l\'élève');
    sameJSON(run(`Object.keys(dietGoal(${j(plan)}).goal)`), ['kcal', 'p', 'c', 'f'], 'l\'eau n\'entre pas dans les macros');
  });

  test('eau : Santé préparée (échantillon dietaryWater en mL, identifiant stable), jamais appelée', () => {
    sameJSON(run(`waterHealthSample({ id: 'ab12', ml: 250, at: 1763400000000 })`),
      { type: 'dietaryWater', unit: 'mL', value: 250, start: 1763400000000, end: 1763400000000, syncId: 'mdlf:eau:ab12' });
    assert.equal(run(`waterHealthSample({ id: 'ab12', ml: 250 })`), null, 'sans heure : rien');
    const ui = fs.readFileSync(path.join(ROOT, 'js/features/water-ui.js'), 'utf8');
    assert.doesNotMatch(ui, /waterHealthSample|Native\.health/, 'pas branché tant que le module natif ne sait pas l\'écrire');
  });

  test('eau : accueil, ligne sous la carte Nutrition ou petite carte seule ; rien tant que le suivi est éteint', () => {
    reset();
    assert.equal(run('waterHomeRowHtml()'), '');
    assert.equal(run('nutritionHomeCard()'), '', 'sans plan ni eau : rien sur l\'accueil');
    run(`data.waterOn = true; data.strengthSex = 'male'; waterAdd(data, 1200)`);
    const card = run('nutritionHomeCard()');
    assert.match(card, /water-home-card/, 'sans plan : petite carte Eau seule');
    assert.match(card, /data-action="water-add" data-ml="250"/, 'bouton « + Verre »');
    assert.match(card.replace(/\u00a0/g, ' '), /<b>1,2<\/b> \/ 2 L/);
    assert.match(card, /aria-label="Eau : 1,2 litre sur 2\. Ouvrir Nutrition"/);
    // Plan de coach avec objectif d'eau : affiché même suivi éteint, dans la carte Nutrition
    run(`delete data.waterOn; data.dietPlans = { d_c1: { name: 'Plan', targets: { kcal: 2400, water: 3 }, fromCoach: { coachId: 'c', name: 'max', sentAt: 1 },
      meals: [{ id: 'm1', name: 'Déjeuner', items: [{ id: 'i1', name: 'Riz', food: 9104, fam: 'f', g: 150, per: { k: 145, p: 3, c: 31, f: 0.5 } }] }] } };
      data.dietActive = 'd_c1'; sanitizeData(data);`);
    const home = run('nutritionHomeCard()');
    assert.match(home, /class="home-card diet-home[^"]*"[\s\S]*class="water-home"/, 'ligne Eau dans la carte Nutrition');
    assert.doesNotMatch(home, /water-home-card/, 'pas de seconde carte');
    assert.match(home.replace(/\u00a0/g, ' '), /\/ 3 L/);
  });

  test('eau : textes sobres (ni tiret long, ni point d\'exclamation, ni emoji)', () => {
    for (const f of ['js/data/water.js', 'js/features/water-ui.js', 'css/water.css']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const strings = (src.match(/(['`])(?:\\.|(?!\1).)*\1/g) || []).join('\n');
      assert.doesNotMatch(strings, /[—–]/, `${f} : tiret long`);
      assert.doesNotMatch(strings.replace(/!==?|!\w|!\(/g, ''), /!/, `${f} : point d'exclamation`);
      assert.doesNotMatch(strings, /\p{Extended_Pictographic}/u, `${f} : emoji`);
    }
  });
}
