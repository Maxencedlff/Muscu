// Import d'un programme : ce que le corpus réel a appris (tests/fixtures/plans/reels/, tools/plan-corpus/lots.json).
// Exemples écrits pour ces tests, pas copiés des documents du corpus : reps avant le nom, blocs répétés d'un WOD,
// accolades, distances, tableaux réels (groupe, case fusionnée, cartes), décor des captures, dictée réelle (phonétique,
// corrections, prescription partagée), PDF (lettres collées, en-têtes de page).
export default function ({ test, run, assert, sameJSON }) {
  const presc = line => JSON.parse(JSON.stringify(run(`planReadLine(${JSON.stringify(line)})`).presc));
  const parse = text => JSON.parse(JSON.stringify(run(`planParse(${JSON.stringify(text)})`)));
  const items = text => parse(text).sessions.flatMap(s => s.items.map(it => ({ name: it.name, raw: it.raw, ...it.presc, ss: it.ss ? 'x' : undefined })));
  const match = raw => run(`planMatchExercise(${JSON.stringify(raw)})`).name;

  test('import réel : reps avant le nom, chaîne de reps, distance, cadence d\'EMOM', () => {
    sameJSON(presc('15 PUSHUPS'), { repMin: 15, repMax: 15 });
    sameJSON(presc('20-AIRSQUATS'), { repMin: 20, repMax: 20 });
    sameJSON(presc('2Ø-AIRSQUATS'), { repMin: 20, repMax: 20 }, 'zéro barré');
    sameJSON(presc('Rowing 15-12-10'), { sets: 3, repMin: 10, repMax: 15, pyramid: '15/12/10' });
    sameJSON(presc('RUN 600M'), { meters: 600 });
    sameJSON(presc('3 x 50 m sprint'), { sets: 3, meters: 50 });
    sameJSON(presc('2 reps every 2 minutes'), { every: 120, repMin: 2, repMax: 2 });
    assert.equal(presc('2 min de repos').repMax, undefined, 'une durée en tête n\'est pas des reps');
    assert.equal(presc('Squat 4 x 8, 3 ans de pratique').sets, 4);
    assert.equal(presc('Fentes 3x10/s').uni, true, '« /s » : par côté');
    assert.equal(presc('Clean 5 @ 60kg/40kg').load, 60, 'charge homme / femme : la première');
    assert.equal(presc('Squat 3x5 @ 100#').load, 45.4, '# : livres');
  });

  test('import réel : blocs répétés (rounds, RFT, EMOM, Tabata, 21-15-9, par poste) et accolade', () => {
    const wod = items('4 rounds\n12 PUSHUPS\n15 Wall balls\nRUN 200M');
    sameJSON(wod.map(x => [x.sets, x.repMax]), [[4, 12], [4, 15], [4, undefined]]);
    assert.equal(wod[1].name, null, 'hors bibliothèque gardé dans le bloc');
    sameJSON(items('21-15-9\nThrusters\nPull-ups').map(x => [x.sets, x.repMin, x.repMax]), [[3, 9, 21], [3, 9, 21]]);
    sameJSON(items('3 Rounds\n1:30 each station\nRameur\nRest\nGainage').map(x => [x.sets, x.seconds]), [[3, 90], [3, 90]]);
    sameJSON(items('Tabata\nSquat poids du corps').map(x => [x.sets, x.seconds, x.rest]), [[8, 20, 10]]);
    sameJSON(items('EMOM 10 min\n5 Pompes').map(x => x.sets), [10]);
    const brace = items('RUN 400M\n12 KB SWING\t>x4\n8 PUSHUPS\nRUN 400M');
    sameJSON(brace.map(x => [x.sets, x.ss]), [[undefined, undefined], [4, 'x'], [4, 'x'], [undefined, undefined]]);
    assert.equal(run('planBlockOf("3 rounds de burpees")'), null, 'un exercice nommé n\'est pas un bloc');
  });

  test('import réel : tableaux (lignes de groupe, colonne superset, case de repos fusionnée, cartes, planning)', () => {
    const head = 'Exercices\tSéries\tReps\tRepos';
    const g = items(`${head}\nBiset bras\nCurl barre\t3\t10\t60 s\nBarre au front\t3\t10\t60 s\nSquat\t4\t8\t2 min`);
    sameJSON(g.map(x => !!x.ss), [true, true, false]);
    const j = items(`${head}\nLeg extension\t3\t12\nEn séries combinées avec\nLeg curl\t3\t12`);
    sameJSON(j.map(x => !!x.ss), [true, true]);
    const col = items('Groupe (superset)\tExercices\tSéries\tReps\tRepos\nBras\tCurl barre\t2\t10\t30 s\n\tBarre au front\t2\t10');
    sameJSON(col.map(x => [!!x.ss, x.rest]), [[true, 30], [true, 30]], 'la case de repos vaut pour le groupe');
    const merged = items(`${head}\nSquat\t4\t8\nPresse à cuisses\t3\t10\t1 min 30\nLeg curl\t3\t12`);
    sameJSON(merged.map(x => x.rest), [90, 90, 90], 'une seule case de repos au milieu : fusionnée');
    const sched = parse('Jours\tGroupes musculaires\tSéries\n1\tPectoraux et biceps\n2\tRepos');
    assert.equal(sched.stats.items, 0, 'planning de la semaine : pas d\'exercice');
    const card = items('JAMBES\tPRESSE À CUISSES\nSÉRIES\tRÉPÉTITIONS\tRÉCUP.\n4\t10 à 12\t1\'30\nDOS\tROWING BARRE\nSÉRIES\tRÉPÉTITIONS\tRÉCUP.\n3\t10\t45\'\'');
    sameJSON(card.map(x => [x.name, x.sets, x.repMin, x.repMax, x.rest]), [['Presse à cuisses', 4, 10, 12, 90], ['Rowing barre', 3, 10, 10, 45]]);
    const log = items('Squat\t100 KG\t5\t5\t5\t5\t5\tBRAVO');
    sameJSON(log.map(x => [x.sets, x.repMax, x.rest]), [[5, 5, undefined]], 'reps série par série, pas un repos');
  });

  test('import réel : captures et PDF (barre d\'état, pied de page, détail sous le nom, lettres collées, en-tête répété)', () => {
    const cap = parse('9:41\nOrange 4G 10:02\nSquat\n4 SETS • 8 REPS\nBench Press\n3 SETS • 10 REPS\n1 of 2');
    sameJSON(cap.sessions.flatMap(s => s.items.map(it => [it.name, it.presc.sets, it.presc.repMax])), [['Squat barre', 4, 8], ['Développé couché barre', 3, 10]]);
    assert.equal(run('planNoiseLine("Page 2/3")'), true);
    assert.equal(run('planNoiseLine("Squat 3x10")'), false);
    const box = (text, x, w) => ({ text, x, y: 10, w, h: 10 });
    assert.equal(run(`planTextFromBoxes(${JSON.stringify([box('sé', 0, 10), box('A', 10, 6), box('nces', 16, 20)])})`), 'séAnces', 'lettres collées d\'un PDF');
    assert.equal(run(`planTextFromBoxes(${JSON.stringify([box('Squat', 0, 25), box('barre', 28, 25)])})`), 'Squat barre');
    const pages = parse('HOME WORKOUT\nSquat 3x10\nPompes 3x12\nHOME WORKOUT\nGainage 3 x 30 s');
    assert.equal(pages.sessions.length, 1, 'en-tête de page répété : une seule séance');
    assert.equal(parse('Séance A\nSquat 3x10\nSéance B\nPompes 3x12\nSéance A\nSquat 3x10').sessions.length, 3, '« Séance A » qui revient reste une séance');
  });

  test('import réel : dictée (phonétique, nombre mal entendu, correction, prescription partagée, en-tête sans le mot)', () => {
    assert.equal(run('planPhon("haltères")'), run('planPhon("alter")'));
    assert.equal(run('planPhon("poule")'), run('planPhon("pull")'));
    assert.equal(run('planPhonKey("quête Lebel")'), run('planPhonKey("kettlebell")'));
    assert.equal(match('quête Lebel swing'), 'Swing kettlebell');
    assert.equal(match('Seal row'), null, 'un son de différence sur un nom court : pas de rapprochement');
    sameJSON(presc('rowing quatre fois nuit'), { sets: 4, repMin: 8, repMax: 8 }, '« nuit » pour huit après « fois »');
    assert.equal(presc('curl trois fois max').amrap, true, '« max » reste max');
    sameJSON(items('squat cinq fois cinq attends non quatre fois six').map(x => [x.name, x.sets, x.repMax]), [['Squat barre', 4, 6]]);
    assert.equal(items('développé arnold euh non développé militaire 3 fois 10')[0].name, 'Développé militaire barre');
    const sh = items('séance bras en superset curl barre et barre au front trois séries de douze chacun');
    sameJSON(sh.map(x => [x.name, x.sets, x.repMax, !!x.ss]), [['Curl biceps barre', 3, 12, true], ['Barre au front', 3, 12, true]]);
    const head = parse('dos épaules tractions quatre fois huit élévations latérales trois fois quinze');
    assert.equal(head.sessions[0].items[0].name, 'Tractions pronation', 'groupes dits en tête : la séance, pas le nom');
    const dots = items('Lundi développé couché. Barre quatre fois huit. Squat cinq fois cinq');
    sameJSON(dots.map(x => [x.name, x.sets]), [['Développé couché barre', 4], ['Squat barre', 5]], 'point de la reconnaissance vocale');
  });
}
