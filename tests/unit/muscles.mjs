// ═══════════════════════════════════════════════════════════
//  Tests unitaires des muscles : catalogue, reconnaissance, séries par muscle, silhouette
//  Chargés par run.mjs (même contexte vm, mêmes outils)
// ═══════════════════════════════════════════════════════════

export default function muscleTests({ test, app, run, reset, sameJSON, assert }) {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 9, 15, 12);
  const ids = () => run('MUSCLES.map(m => m.id)');
  const pick = name => { const m = app.musclesOf(name); return { p: [...m.primary], s: [...m.secondary], src: m.source }; };

  test('muscles : catalogue sans doublon, identifiants connus partout', () => {
    const known = new Set(ids());
    assert.equal(known.size, 17);
    const names = run('EXERCISE_CATALOGUE.map(e => normName(e.name))');
    assert.equal(new Set(names).size, names.length, 'nom en double dans la bibliothèque');
    run('EXERCISE_CATALOGUE').forEach(e => {
      assert.ok(e.primary.length, `${e.name} : aucun muscle principal`);
      [...e.primary, ...e.secondary].forEach(id => assert.ok(known.has(id), `${e.name} : muscle inconnu ${id}`));
      assert.ok(!e.secondary.some(id => e.primary.includes(id)), `${e.name} : muscle principal et secondaire`);
    });
    run('MUSCLE_RULES').forEach(([re, p, s]) => [...p, ...s].forEach(id => assert.ok(known.has(id), `${re} : ${id}`)));
  });

  test('muscles : matériel renseigné pour toute la bibliothèque, filtres reconnus par sanitizeData', () => {
    const equip = run('EQUIPMENT.map(e => e.id)');
    sameJSON(['all', ...equip].sort(), run('EQUIP_IDS').slice().sort());
    run('EXERCISE_CATALOGUE').forEach(e => assert.ok(equip.includes(e.equip), `${e.name} : matériel ${e.equip}`));
    // De quoi composer une séance complète sans salle
    const count = id => run('EXERCISE_CATALOGUE').filter(e => e.equip === id).length;
    assert.ok(count('aucun') >= 15 && count('halteres') >= 20 && count('barre') >= 5);
    assert.equal(app.equipmentOf('pompes diamant'), 'aucun');
    assert.equal(app.equipmentOf('Mon exercice inventé'), null);
  });

  test('muscles : progressions (plus facile / plus dur) toutes dans la bibliothèque', () => {
    run('PROGRESSIONS').flat().forEach(n => assert.equal(app.musclesOf(n).source, 'catalogue', n));
    sameJSON(run(`progressionOf('Pompes')`), { easier: 'Pompes sur les genoux', harder: 'Pompes déclinées' });
    sameJSON(run(`progressionOf('Pull-ups')`), { easier: 'Tractions avec élastique', harder: 'Tractions archer' }, 'par alias');
    sameJSON(run(`progressionOf('Muscle-up')`), { easier: 'Tractions archer', harder: null });
    sameJSON(run(`progressionOf('Curl marteau')`), { easier: null, harder: null });
  });

  test('muscles : tous les exercices des programmes intégrés sont dans la bibliothèque', () => {
    const names = run(`Object.values(PROGRAMMES).flatMap(p => Object.values(p.defaults).flatMap(l => l.map(([n]) => n)))`);
    assert.ok(names.length > 20);
    names.forEach(n => assert.equal(app.musclesOf(n).source, 'catalogue', n));
  });

  test('muscles : la bibliothèque et les règles concordent sur le muscle principal', () => {
    // Garde-fou : une règle trop large (ex. « press ») ne doit pas contredire la bibliothèque
    run('EXERCISE_CATALOGUE').forEach(e => {
      const rule = run('MUSCLE_RULES').find(([re]) => re.test(app.ruleKey(e.name)));
      assert.ok(rule, `${e.name} : aucune règle ne le reconnaît`);
      assert.ok(rule[1].some(id => e.primary.includes(id)), `${e.name} : règle ${rule[0]} → ${rule[1]}`);
    });
  });

  test('muscles : noms et abréviations d\'habitués de salle', () => {
    const cases = {
      'Close grip bench': 'triceps', 'Military press': 'front_delts', 'Push press': 'front_delts',
      'Z press': 'front_delts', 'Landmine press': 'front_delts', 'JM press': 'triceps', 'Tate press': 'triceps',
      'Pallof press': 'abs', 'Hammer strength chest press': 'chest', 'Rowing machine hammer': 'lats',
      'Pec deck inversé': 'rear_delts', 'Butterfly inversé': 'rear_delts', 'Glute ham raise': 'hamstrings',
      'Développé incliné smith': 'front_delts', 'DC': 'chest', 'DC incliné smith': 'front_delts', 'DM assis': 'front_delts',
      'SDT sumo': 'glutes', 'Dév couché haltères': 'chest', 'Hack': 'quads', 'Bulgare': 'quads',
      'Face-pull corde': 'rear_delts', 'Pull-down unilatéral': 'lats', 'Cable crossover': 'chest',
      'Leg ext': 'quads', 'Rack pull': 'glutes', 'Hex bar deadlift': 'glutes', 'GHR': 'hamstrings',
      'Reverse hyper': 'glutes', 'Ab wheel à genoux': 'abs', 'Pompes pieds surélevés': 'chest', 'Relevés de jambes suspendu': 'abs', 'Kettlebell swing': 'glutes', 'Y raise': 'side_delts',
    };
    for (const [name, main] of Object.entries(cases)) assert.ok(app.musclesOf(name).primary.includes(main), `${name} → ${app.musclesOf(name).primary}`);
    // Écartés : pas de triceps en secondaire
    assert.ok(!app.musclesOf('Écarté poulie haute').secondary.includes('triceps'));
  });

  test('muscles : un nom ou un alias ne mène qu\'à une fiche (clé normalisée, abréviations développées, clé souple)', () => {
    const owner = new Map(), clash = [];
    run('EXERCISE_CATALOGUE').forEach(e => [e.name, ...e.aliases].forEach(n => new Set([app.normName(n), app.ruleKey(n), '~' + app.looseKey(n)]).forEach(k => {
      if (owner.has(k) && owner.get(k) !== e.name) clash.push(`${k} : ${owner.get(k)} / ${e.name}`);
      else owner.set(k, e.name);
    })));
    assert.equal(clash.length, 0, clash.join(', '));
  });

  // Programme d'un testeur tapé à la main : chaque nom retrouve sa fiche, avec ses muscles vérifiés
  const TESTER_NAMES = {
    'Curl biceps haltères': 'Curl biceps haltères', 'Barre au front': 'Barre au front', 'Curl marteau': 'Curl marteau',
    'Extension triceps poulie': 'Extension triceps poulie', 'Curl pupitre': 'Curl pupitre',
    'Extension triceps poulie bas': 'Extension triceps poulie', 'Dead lift': 'Soulevé de terre', 'Rowing barre': 'Rowing barre',
    'Tirage horizontal poulie': 'Tirage horizontal câble', 'Rowing haltère unilatéral': 'Rowing haltère unilatéral',
    'Pull over': 'Pull-over poulie', 'Développe couché': 'Développé couché barre', 'Développé incliné haltères': 'Développé incliné haltères',
    'Chest press': 'Développé couché machine', 'Dips': 'Dips', 'Pec fly': 'Pec deck', 'Hip thrusts': 'Hip thrust',
    'Hack squats': 'Hack squat', 'Rdl': 'Soulevé de terre roumain', 'Legs extension': 'Extension quadriceps',
    'Leg curl machine': 'Leg curl machine', 'Développé militaire smith': 'Développé militaire smith',
    'Élévations latérales': 'Élévations latérales', 'L-fly': 'Rotation externe haltère',
    'Oiseau poulie vis à vis': 'Oiseau poulie vis-à-vis', 'Développé militaire haltères': 'Développé militaire haltères',
    'Élévation latérale machine': 'Élévations latérales machine',
  };
  test('muscles : les 27 noms tapés par un testeur sont reconnus, avec les bons muscles', () => {
    reset();
    assert.equal(Object.keys(TESTER_NAMES).length, 27);
    for (const [typed, name] of Object.entries(TESTER_NAMES)) {
      const e = run(`catalogueEntry(${JSON.stringify(typed)})`);
      assert.ok(e, `${typed} : non reconnu`);
      assert.equal(e.name, name, typed);
      const m = app.exerciseMuscles({ name: typed });
      sameJSON([m.source, [...m.primary], [...m.secondary]], ['catalogue', [...e.primary], [...e.secondary]], typed);
      assert.ok(run(`exerciseHowTo(${JSON.stringify(typed)})`), `${typed} : « Comment faire »`);
    }
    // Muscles attendus des cas qui changent de fiche
    const main = n => [...app.musclesOf(n).primary].join(' ');
    assert.equal(main('Dead lift'), 'glutes hamstrings lower_back');
    assert.equal(main('dead-lift'), 'glutes hamstrings lower_back');
    assert.equal(main('Extension triceps poulie bas'), 'triceps');
    assert.equal(main('Pec fly'), 'chest');
    assert.equal(main('Pull over'), 'lats');
    assert.equal(main('Legs extension'), 'quads');
    assert.equal(main('Élévation latérale machine'), 'side_delts');
    // Nouvelles fiches : épaules postérieures (rotation externe comme sa version élastique)
    sameJSON([main('L-fly'), main('lfly'), main('l fly')], ['rear_delts', 'rear_delts', 'rear_delts']);
    sameJSON([...app.musclesOf('Rotation externe haltère').secondary], [...app.musclesOf('Rotation externe élastique').secondary]);
    assert.equal(app.equipmentOf('L-fly'), 'halteres');
    sameJSON([main('Oiseau poulie vis à vis'), [...app.musclesOf('Reverse cable fly').secondary].join(' ')], ['rear_delts', 'traps']);
    assert.equal(app.equipmentOf('Oiseau poulie'), 'salle');
    // « Développe couché » et « Développé couché » : même clé (accents ôtés), la fiche barre
    assert.equal(app.normName('Développe couché'), app.normName('Développé couché'));
    assert.equal(run(`catalogueEntry('Développé couché').name`), 'Développé couché barre');
    assert.equal(run(`catalogueEntry('Développé couché haltères').name`), 'Développé couché haltères', 'variantes intactes');
  });

  // Noms tapés couramment (anglais de salle, pluriels, tirets et espaces, argot) : chacun retrouve sa fiche
  const TYPED_NAMES = {
    // Anglais de salle
    'Incline dumbbell press': 'Développé incliné haltères', 'Incline bench press': 'Développé incliné barre',
    'Lat pulldown': 'Tirage vertical prise large', 'Seated cable row': 'Tirage horizontal câble', 'Bent over row': 'Rowing barre',
    'One arm dumbbell row': 'Rowing haltère unilatéral', 'T bar row': 'Rowing barre T', 'Arnold press': 'Développé Arnold',
    'Cable lateral raise': 'Élévations latérales poulie', 'Rear delt fly': 'Oiseau (élévations arrière)', 'Triceps pushdown': 'Extension triceps poulie',
    'Close grip bench press': 'Développé couché prise serrée', 'Preacher curl': 'Curl pupitre', 'Leg curl': 'Leg curl machine',
    'Stiff leg deadlift': 'Soulevé de terre roumain', 'Dumbbell RDL': 'Soulevé de terre roumain haltères', 'Floor press': 'Développé au sol haltères',
    'Kettlebell swing': 'Swing kettlebell', 'Side plank': 'Gainage latéral', 'Cable crossover': 'Écarté poulie vis-à-vis',
    'Smith squat': 'Squat smith', 'Machine shoulder press': 'Développé épaules machine', 'Band pull-apart': 'Pull-apart élastique',
    // Tirets, espaces, mot collé
    'pull up': 'Tractions pronation', 'Pullup': 'Tractions pronation', 'Chinup': 'Tractions supination', 'Pushup': 'Pompes',
    'Facepull': 'Face pull', 'Skullcrusher': 'Barre au front', 'Muscle up': 'Muscle-up', 'Lsit': 'L-sit', 'Turkish get up': 'Turkish get-up',
    'Pull-over haltère': 'Pull-over haltère', 'Lat pull-down': 'Tirage vertical prise large',
    // Pluriels, singuliers, haltère / haltères
    'Squats barre': 'Squat barre', 'Front squats': 'Squat avant', 'Fente': 'Fentes', 'Pompe': 'Pompes', 'Tractions': 'Tractions pronation',
    'Deadlifts': 'Soulevé de terre', 'Hammer curls': 'Curl marteau', 'Lateral raises': 'Élévations latérales', 'Élévation latérale': 'Élévations latérales',
    'Curl haltère': 'Curl biceps haltères', 'Dc haltère': 'Développé couché haltères', 'Shrugs': 'Haussements d\'épaules haltères',
    'Face pulls': 'Face pull', 'Leg extensions': 'Extension quadriceps', 'Tricep pushdown': 'Extension triceps poulie', 'Crunches': 'Crunch',
    'Farmer\'s walk': 'Marche du fermier', 'Fente bulgare': 'Fentes bulgares', 'Dead bugs': 'Dead bug', 'Burpee': 'Burpees',
    // Argot et abréviations de salle français
    'DM': 'Développé militaire barre', 'Développé militaire': 'Développé militaire barre', 'DM haltères': 'Développé militaire haltères',
    'DM smith': 'Développé militaire smith', 'SDT': 'Soulevé de terre', 'SDT roumain': 'Soulevé de terre roumain', 'Tirage poitrine': 'Tirage vertical prise large',
    'Rowing assis': 'Tirage horizontal câble', 'Tirage horizontal': 'Tirage horizontal câble', 'Presse': 'Presse à cuisses', 'Oiseau': 'Oiseau (élévations arrière)',
    'Curl barre': 'Curl biceps barre', 'Larry Scott': 'Curl pupitre', 'Écarté câble': 'Écarté poulie vis-à-vis', 'Squat multipower': 'Squat smith',
    'DI multipower': 'Développé incliné smith', 'Gainage planche': 'Gainage (planche)', 'Roue abdo': 'Roue abdominale', 'La chaise': 'Chaise contre le mur',
  };
  test('muscles : les noms tapés couramment (anglais, pluriels, argot) retrouvent leur fiche', () => {
    assert.ok(Object.keys(TYPED_NAMES).length >= 40);
    for (const [typed, name] of Object.entries(TYPED_NAMES)) assert.equal(run(`catalogueEntry(${JSON.stringify(typed)})?.name`), name, typed);
    // Noms génériques laissés sans fiche : ils désignent plusieurs exercices de la bibliothèque (« cable
    // kickback » : fessier ou triceps à la poulie)
    for (const typed of ['curl', 'squat', 'élévations', 'tirage', 'kickback', 'cable kickback', 'cable kickbacks', 'shoulder press', 'rotation externe', 'rowing haltères', 'gainage'])
      assert.equal(run(`catalogueEntry(${JSON.stringify(typed)})`), null, typed);
    assert.equal(run(`catalogueEntry('glute kickback')?.name`), 'Kickback fessier poulie');
    // « Développé incliné » et « DI » sans précision : version barre (choix de Maxence, 26/10 : en salle, c'est la barre)
    for (const typed of ['développé incliné', 'DI', 'di'])
      assert.equal(run(`catalogueEntry(${JSON.stringify(typed)})?.name`), 'Développé incliné barre', typed);
    assert.equal(run(`catalogueEntry('Développé incliné haltères').name`), 'Développé incliné haltères');
    assert.equal(run(`catalogueEntry('DI haltères')?.name`), 'Développé incliné haltères');
    // La clé souple ne confond pas deux fiches proches
    assert.equal(run(`catalogueEntry('Pompes pike').name`), 'Pompes pike (épaules)');
    assert.equal(run(`catalogueEntry('Squat gobelet kettlebell').name`), 'Squat gobelet kettlebell');
    // La feuille d'ajout trouve ces noms : recherche complète, puis recherche approchée
    const found = q => run(`exerciseLibrary().filter(n => exerciseMatches(n, ${JSON.stringify(q)}))`);
    for (const [q, name] of [['lat pulldown', 'Tirage vertical prise large'], ['pullups', 'Tractions pronation'], ['skullcrusher', 'Barre au front'],
      ['écarté câble', 'Écarté poulie vis-à-vis'], ['multipower', 'Squat smith']])
      assert.ok(found(q).includes(name), `${q} → ${name}`);
    assert.equal(run(`closestExercises(exerciseLibrary(), 'arnold press lourd', 5)[0]`), 'Développé Arnold');
  });

  test('muscles : alias, recherche par mots et noms proches', () => {
    assert.equal(app.musclesOf('Pull-ups').source, 'catalogue');
    assert.equal(app.equipmentOf('Russian twist'), 'aucun');
    assert.ok(app.exerciseMatches('Développé incliné haltères', 'incliné dév'));
    assert.ok(app.exerciseMatches('Développé couché barre', 'dc'));
    assert.ok(app.exerciseMatches('Curl marteau', 'biceps'));
    assert.ok(app.exerciseMatches('Hip thrust', 'poussée hanche'));
    assert.ok(!app.exerciseMatches('Curl marteau', 'squat'));
    // Fautes, mots du quotidien, synonymes de salle ; par début de mot (pas de faux positifs)
    const found = q => run(`exerciseLibrary().filter(n => exerciseMatches(n, ${JSON.stringify(q)}))`);
    for (const [q, name] of [['hip trust', 'Hip thrust'], ['his trust', 'Hip thrust'], ['hip thurst', 'Hip thrust'],
      ['hipthrust', 'Hip thrust'], ['squatt', 'Squat barre'], ['dévelopé couché', 'Développé couché barre'],
      ['tirage poitrine', 'Tirage vertical prise large'], ['squat bulgare', 'Fentes bulgares'], ['fesses', 'Pont fessier'],
      ['ventre', 'Crunch'], ['bras', 'Curl marteau'], ['skull crusher', 'Barre au front'], ['dc incliné', 'Développé incliné barre'],
      ['peck deck', 'Pec deck']])
      assert.ok(found(q).includes(name), `${q} → ${name}`);
    for (const [q, name] of [['vélo', 'Développé couché barre'], ['dos', 'Crunch']])
      assert.ok(!found(q).includes(name), `${q} ne doit pas trouver ${name}`);
    assert.ok(run(`exerciseMatchScore('Hip thrust', 'hip trust')`) < run(`exerciseMatchScore('Hip thrust', 'hip')`), 'faute classée après');
    const sim = run(`similarExercises('Pompes genoux').map(e => e.name)`);
    assert.ok(sim.length && sim.every(n => /Pompes/.test(n)), sim.join(', '));
    assert.equal(run(`similarExercises('zzz').length`), 0);
  });

  test('muscles : recherche approchée, mot en plus ou faute, sans casser la recherche complète', () => {
    reset();
    const lib = () => run('exerciseLibrary()');
    const strict = q => lib().filter(n => app.exerciseMatchScore(n, q) > 0);
    const near = q => [...app.closestExercises(lib(), q, 5)];
    // Variante absente de la bibliothèque : aucun résultat complet, les Tractions en plus proches
    for (const q of ['tracion lesté', 'traction lest', 'tractions lestées']) {
      assert.equal(strict(q).length, 0, q);
      const got = near(q);
      assert.ok(got.length && got.every(n => /^Tractions/.test(n)), `${q} → ${got.join(', ')}`);
      assert.equal(got[0], 'Tractions pronation', 'le mouvement de référence avant ses variantes');
    }
    // Abréviation de « développé » sans voyelles
    assert.ok(strict('dvlp incliné').includes('Développé incliné haltères'));
    assert.ok(strict('dvp couché').includes('Développé couché barre'));
    // Une faute sur un seul mot ne remonte pas d'exercice éloigné face à un mot bien trouvé
    assert.ok(near('rotation landmine').every(n => /^Rotation/.test(n)), near('rotation landmine').join(', '));
    // Le premier mot (le mouvement) pèse plus que les suivants
    assert.ok(app.exercisePartialScore('Tractions pronation', 'tractions lestées') > app.exercisePartialScore('Fentes arrière', 'tractions arrière'));
    // Rien de proche : rien proposé ; mots trop courts seuls : rien
    assert.equal(near('zzz qqq').length, 0);
    assert.equal(app.exercisePartialScore('Développé couché barre', 'de'), 0);
    // Pas de régression : recherches complètes, abréviations et « Tu voulais dire » (score 1)
    assert.ok(strict('DC').length >= 3 && strict('DC').every(n => /^Développé couché/.test(n)));
    assert.equal(app.exerciseMatchScore('Squat barre', 'Squat'), 3);
    assert.ok(strict('sdt').some(n => /^Soulevé de terre/.test(n)));
    assert.equal(app.exerciseMatchScore('Tractions pronation', 'tracion'), 1);
    assert.equal(app.exerciseMatchScore('Hip thrust', 'hip trust'), 2, 'nom exact par alias ou mot');
    assert.equal(app.exerciseMatchScore('Hip thrust machine', 'hip trust'), 1);
  });

  test('muscles : remplacer, les exercices aux mêmes muscles principaux d\'abord', () => {
    reset();
    const lib = run('exerciseLibrary()').filter(n => n !== 'Développé couché barre');
    const { same, rest } = app.sameMusclesFirst({ name: 'Développé couché barre' }, lib);
    assert.equal(same.length + rest.length, lib.length, 'aucun exercice perdu');
    assert.ok(same.every(n => app.musclesOf(n).primary.includes('chest')), same.join(', '));
    assert.ok(!rest.some(n => app.musclesOf(n).primary.includes('chest')));
    // Le nom le plus proche passe devant ; ni squat ni presse parmi les mêmes muscles
    assert.ok(same.indexOf('Développé couché haltères') < 3, same.slice(0, 5).join(', '));
    assert.ok(!same.includes('Squat barre') && !same.includes('Presse à cuisses'));
    // Exercice créé par la personne : ses muscles choisis servent à la comparaison
    run(`setDeclaredMuscles('Mon développé maison', { primary: ['triceps'] })`);
    assert.ok(app.sameMusclesFirst({ name: 'Mon développé maison' }, lib).same.every(n => app.musclesOf(n).primary.includes('triceps')));
    // Exercice aux muscles inconnus : ordre d'origine
    sameJSON(app.sameMusclesFirst({ name: 'Zzz' }, lib), { same: [], rest: lib });
  });

  test('muscles : reconnaissance des noms saisis librement', () => {
    const cases = {
      'Curl haltères incliné prise supination': 'biceps',
      'Leg curl unilatéral': 'hamstrings',
      'Nordic curl assisté': 'hamstrings',
      'Curl marteau corde': 'brachialis',
      'Squat bulgare haltères': 'quads',
      'Fentes arrière lestées': 'quads',
      'Bench press haltères': 'chest',
      'Pompes prise large': 'chest',
      'Lat pulldown': 'lats',
      'Tractions lestées': 'lats',
      'Rowing poulie basse': 'lats',
      'Deadlift sumo': 'glutes',
      'Soulevé de terre jambes tendues': 'hamstrings',
      'Développé militaire assis': 'front_delts',
      'Développé couché prise serrée barre': 'triceps',
      'Extension triceps nuque haltère': 'triceps',
      'Barre au front EZ': 'triceps',
      'Tirage menton barre EZ': 'side_delts',
      'Élévations latérales assis': 'side_delts',
      'Oiseau à la poulie': 'rear_delts',
      'Face pull corde': 'rear_delts',
      'Shrugs barre': 'traps',
      'Hip thrust barre': 'glutes',
      'Mollets à la presse': 'calves',
      'Crunch à genoux': 'abs',
      'Gainage latéral sur le coude': 'abs',
      'Extension lombaires au banc': 'lower_back',
      'Adducteurs poulie': 'adductors',
      'Dips lestés': 'chest',
      'Chest press machine': 'chest',
    };
    for (const [name, main] of Object.entries(cases)) {
      const m = pick(name);
      assert.ok(['rules', 'catalogue'].includes(m.src), name);  // certains sont devenus des alias de la bibliothèque
      assert.equal(m.p[0], main, `${name} → ${m.p.join(', ')}`);
    }
    sameJSON(pick('Curl marteau corde').p, ['brachialis', 'biceps', 'forearms'], 'comme Curl marteau : brachio-radial (avant-bras) principal');
  });

  test('muscles : accents, casse et espaces ignorés ; nom inconnu ou vide → aucun muscle', () => {
    assert.equal(pick('  DÉVELOPPÉ   couché HALTERES ').src, 'catalogue');
    sameJSON(pick('Exercice mystère'), { p: [], s: [], src: 'none' });
    sameJSON(pick(''), { p: [], s: [], src: 'none' });
    sameJSON(pick(null), { p: [], s: [], src: 'none' });
    assert.equal(app.musclesOf('Squat barre'), app.musclesOf('squat  BARRE'), 'résultat mis en cache, même objet');
    assert.ok(Object.isFrozen(app.musclesOf('Squat barre')));
  });

  test('muscles : choix de l\'utilisateur (champ muscles) par exercice ou par exId', () => {
    reset();
    sameJSON(app.chosenMuscles({ muscles: ['biceps', 'nope', 'biceps', 'forearms'] }), ['biceps', 'forearms']);
    assert.equal(app.chosenMuscles({ muscles: ['nope'] }), null, 'aucun muscle connu → reconnaissance automatique');
    assert.equal(app.chosenMuscles({ muscles: 'biceps' }), null, 'valeur illisible ignorée');
    assert.equal(app.chosenMuscles({}), null);
    // Exercice créé par la personne, renommé : l'historique sous l'ancien nom suit le choix par exId
    run(`Object.assign(data.programmes.ppl.exercises.push[0], { name: 'Mon développé maison', muscles: ['triceps'] });`);
    const id = run('data.programmes.ppl.exercises.push[0].id');
    const viaId = app.exerciseMuscles({ exId: id, name: 'Ancien nom maison' });
    sameJSON({ p: viaId.primary, s: viaId.secondary, src: viaId.source }, { p: ['triceps'], s: [], src: 'user' });
    assert.equal(app.exerciseMuscles({ exId: 'autre', name: 'Ancien nom maison' }).source, 'none');
    // Séance de l'historique sous un nom de la bibliothèque : le catalogue fait foi, même par exId
    assert.equal(app.exerciseMuscles({ exId: id, name: 'Développé couché haltères' }).primary[0], 'chest');
  });

  test('muscles vérifiés : par défaut ceux du catalogue, le choix de l\'utilisateur prime partout', () => {
    reset();
    assert.equal(app.musclesVerified('Développé couché barre'), true);
    assert.equal(app.musclesVerified('bench press'), true, 'alias de la bibliothèque');
    assert.equal(app.musclesVerified('dc'), true, 'abréviation développée');
    assert.equal(app.musclesVerified('Curl marteau corde'), false, 'reconnu par les règles : exercice de la personne');
    assert.equal(app.musclesVerified(''), false);
    // Nouvel utilisateur : muscles vérifiés
    const m0 = app.exerciseMuscles({ name: 'Développé couché barre' });
    sameJSON({ p: m0.primary, s: m0.secondary, src: m0.source }, { p: ['chest'], s: ['front_delts', 'triceps'], src: 'catalogue' });
    // Choix par le nom (Progrès, séance, bilan) : pris partout, séries par muscle comprises
    run(`setDeclaredMuscles('Développé couché barre', { primary: ['triceps'], secondary: ['chest'] })`);
    const m = app.exerciseMuscles({ name: 'Développé couché barre' });
    sameJSON({ p: m.primary, s: m.secondary, src: m.source }, { p: ['triceps'], s: ['chest'], src: 'user' });
    const counts = app.muscleSetCounts([hist(0, [{ name: 'Développé couché barre', sets: sets(2) }])], -Infinity, Infinity).counts;
    assert.equal(counts.triceps, 2);
    assert.equal(counts.chest, 1);
    assert.equal(counts.front_delts, 0);
    // Choisir exactement les muscles vérifiés (ou aucun) efface le choix : retour aux muscles par défaut
    run(`setDeclaredMuscles('Développé couché barre', { primary: ['chest'], secondary: ['triceps', 'front_delts'] })`);
    assert.equal(run('data.exerciseMuscles === undefined && data.exerciseMusclesSecondary === undefined'), true);
    assert.equal(app.isVerifiedChoice('Développé couché barre', ['chest'], ['front_delts']), false, 'secondaires différents');
    assert.equal(app.isVerifiedChoice('Grimpe au mur', [], []), false, 'hors bibliothèque');
    // Choix d'un exercice du programme (Programme › Exercice) : par exId et, sans identifiant, par le nom
    run(`Object.assign(data.programmes.ppl.exercises.push[0], { muscles: ['calves'], musclesSecondary: ['abs'] })`);
    const ex = run('data.programmes.ppl.exercises.push[0]');
    sameJSON(app.exerciseMuscles({ exId: ex.id, name: ex.name }).primary, ['calves']);
    sameJSON(app.exerciseMuscles({ name: ex.name }).secondary, ['abs'], 'fiche de la bibliothèque, « Comment faire »');
    assert.ok(app.chosenMusclesIndex().has(ex.id));
  });

  test('muscles vérifiés : rétablir efface le choix (nom, programme), annulable, synchronisé sans clé nouvelle', () => {
    reset();
    run(`data.exerciseMuscles = { 'curl marteau': ['triceps'] }; data.exerciseMusclesSecondary = { 'curl marteau': ['abs'] };
         data.programmes.ppl.exercises.pull.push(makeExercise('Curl marteau', 3));
         Object.assign(data.programmes.ppl.exercises.pull.at(-1), { muscles: ['triceps'], musclesSecondary: ['abs'] });`);
    const id = run('data.programmes.ppl.exercises.pull.at(-1).id');
    assert.equal(app.exerciseMuscles({ name: 'Curl marteau' }).source, 'user');
    const undo = app.resetChosenMuscles({ name: 'Curl marteau', exId: id });
    sameJSON(app.exerciseMuscles({ name: 'Curl marteau' }).primary, ['brachialis', 'biceps', 'forearms']);
    assert.equal(app.exerciseMuscles({ exId: id, name: 'Curl marteau' }).source, 'catalogue');
    assert.equal(run('data.exerciseMuscles === undefined'), true);
    assert.equal(run(`'muscles' in data.programmes.ppl.exercises.pull.at(-1)`), false);
    assert.equal(app.profilePayload(run('data')).exerciseMuscles, undefined, 'le profil envoyé n\'a plus le choix');
    undo();
    sameJSON(run(`data.exerciseMuscles['curl marteau']`), ['triceps']);
    sameJSON(run(`data.exerciseMusclesSecondary['curl marteau']`), ['abs']);
    sameJSON(run('data.programmes.ppl.exercises.pull.at(-1).muscles'), ['triceps']);
    assert.equal(app.exerciseMuscles({ name: 'Curl marteau' }).source, 'user');
    // Clés de synchro inchangées : les choix voyagent déjà avec le profil, fusionnés par union
    ['exerciseMuscles', 'exerciseMusclesSecondary', 'programmes'].forEach(k => assert.ok(run('SYNC_PROFILE_KEYS').includes(k), k));
    ['exerciseMuscles', 'exerciseMusclesSecondary'].forEach(k => assert.ok(run('SYNC_UNION_KEYS').includes(k), k));
  });

  test('muscles vérifiés : anciens choix respectés (avant le verrouillage, nouvel alias), gardés par le nettoyage', () => {
    reset();
    // Maxence : choix fait avant le verrouillage, dans data.exerciseMuscles
    run(`data.exerciseMuscles = { 'curl biceps halteres': ['biceps'] };`);
    const curl = app.exerciseMuscles({ name: 'Curl biceps haltères' });
    sameJSON({ p: curl.primary, s: curl.secondary, src: curl.source }, { p: ['biceps'], s: [], src: 'user' });
    // Cyril : programme tapé à la main, choix dans le champ muscles ; « Dead lift » et « L-fly » sont
    // maintenant reconnus par la bibliothèque, le choix reste le sien
    run(`data.programmes.ppl.exercises.pull.push(makeExercise('Dead lift', 3), makeExercise('L-fly', 3));
         Object.assign(data.programmes.ppl.exercises.pull.at(-2), { muscles: ['lats', 'lower_back'] });
         Object.assign(data.programmes.ppl.exercises.pull.at(-1), { muscles: ['rear_delts'] });`);
    const [dl, lf] = run('data.programmes.ppl.exercises.pull.slice(-2)');
    assert.equal(app.musclesVerified('Dead lift'), true);
    assert.equal(app.musclesVerified('L-fly'), true);
    sameJSON(app.exerciseMuscles(dl).primary, ['lats', 'lower_back']);
    sameJSON(app.exerciseMuscles({ exId: dl.id, name: 'Dead lift' }).primary, ['lats', 'lower_back'], 'historique');
    sameJSON(app.exerciseMuscles({ name: 'Dead lift' }).primary, ['lats', 'lower_back'], 'fiche ouverte par « Comment faire »');
    sameJSON(app.exerciseMuscles(lf).primary, ['rear_delts']);
    const counts = app.muscleSetCounts([hist(0, [{ exId: dl.id, name: 'Dead lift', sets: sets(2) }])], -Infinity, Infinity).counts;
    assert.equal(counts.lats, 2);
    assert.equal(counts.glutes, 0, 'muscles vérifiés remplacés par son choix');
    // Un autre nom de la bibliothèque garde ses muscles vérifiés
    assert.equal(app.exerciseMuscles({ name: 'Soulevé de terre' }).source, 'catalogue');
    // Nettoyage, migrations et profil synchronisé gardent les valeurs
    const d = app.sanitizeData(app.normalizeData(JSON.parse(JSON.stringify(run('data')))));
    sameJSON(d.exerciseMuscles['curl biceps halteres'], ['biceps']);
    sameJSON(d.programmes.ppl.exercises.pull.at(-2).muscles, ['lats', 'lower_back']);
  });

  test('muscles vérifiés : la fiche d\'un programme du catalogue suit le choix', () => {
    reset();
    assert.equal(run(`programmeMuscleLevels('ppl').abs`), undefined, 'PPL : pas d\'abdominaux par défaut');
    run(`setDeclaredMuscles('Développé couché haltères', { primary: ['chest'], secondary: ['abs'] })`);
    assert.equal(run(`programmeMuscleLevels('ppl').abs`), 0.4);
  });

  test('muscles : le champ muscles survit au nettoyage, aux migrations et à l\'import', () => {
    reset();
    run(`data.programmes.ppl.exercises.push[0].muscles = ['chest', 'triceps']; save();`);
    const d = app.sanitizeData(app.normalizeData(JSON.parse(ctx().localStorage.getItem('ppl_v2'))));
    sameJSON(d.programmes.ppl.exercises.push[0].muscles, ['chest', 'triceps']);
    const text = ctx().localStorage.getItem('ppl_v2');
    reset();
    assert.equal(app.importText(text).ok, true);
    sameJSON(run('data.programmes.ppl.exercises.push[0].muscles'), ['chest', 'triceps']);
  });

  function hist(daysAgo, exercises) {
    return { id: 'h' + daysAgo + Math.random().toString(36).slice(2, 6), programme: 'ppl', category: 'push',
      date: NOW - daysAgo * DAY, exercises };
  }
  const sets = (n, reps = '10') => Array.from({ length: n }, () => ({ weight: '20', reps }));

  test('séries par muscle : principal 1, secondaire ½, séries sans reps et hors période ignorées', () => {
    reset();
    const h = [
      hist(1, [{ name: 'Développé couché haltères', sets: [...sets(4), { weight: '20', reps: '' }, { weight: '20', reps: '0' }] }]),
      hist(3, [{ name: 'Curl marteau', sets: sets(3) }, { name: 'Inconnu', sets: sets(5) }]),
      hist(9, [{ name: 'Squat barre', sets: sets(4) }]),
    ];
    const { counts, sessions } = app.muscleSetCounts(h, NOW - 7 * DAY, NOW + 1);
    assert.equal(sessions, 2);
    assert.equal(counts.chest, 4);
    assert.equal(counts.front_delts, 2);
    assert.equal(counts.triceps, 2);
    assert.equal(counts.biceps, 3);
    assert.equal(counts.brachialis, 3, 'curl marteau : le brachial en principal');
    assert.equal(counts.forearms, 3, 'curl marteau : le brachio-radial (avant-bras) en principal');
    assert.equal(counts.quads, 0, 'séance d\'il y a 9 jours hors de la semaine');
    sameJSON(Object.keys(counts), ids(), 'tous les muscles, dans l\'ordre');
  });

  test('séries par muscle : paliers 0 / 1–3 / 4–9 / 10+ par semaine', () => {
    sameJSON([0, -1, NaN, 0.5, 3.9, 4, 9.9, 10, 25].map(v => app.muscleLevel(v)), [0, 0, 0, 1, 1, 2, 2, 3, 3]);
  });

  test('muscleLoad : semaine et 4 semaines, intensités, peu travaillés sans les petits groupes', () => {
    reset();
    const h = [
      hist(1, [{ name: 'Développé couché haltères', sets: sets(12) }, { name: 'Squat barre', sets: sets(5) }]),
      hist(20, [{ name: 'Développé couché haltères', sets: sets(8) }]),
    ];
    const w = app.muscleLoad('week', NOW, h);
    assert.equal(w.sessions, 1);
    assert.equal(w.levels.chest, 3);
    assert.equal(w.intensity.chest, 1);
    assert.equal(w.levels.quads, 2);
    assert.equal(w.levels.calves, 0);
    assert.equal(w.intensity.calves, 0);
    assert.ok(w.low.includes('calves') && w.low.includes('hamstrings'));
    assert.ok(!w.low.includes('chest') && !w.low.includes('quads'));
    assert.ok(!w.low.includes('forearms') && !w.low.includes('adductors'), 'petits groupes jamais signalés');
    const m = app.muscleLoad('month', NOW, h);
    assert.equal(m.sessions, 2);
    assert.equal(m.sets.chest, 20);
    assert.equal(m.perWeek.chest, 5);
    assert.equal(m.levels.chest, 2);
    assert.equal(app.muscleLoad('autre', NOW, h).span, 'week', 'période inconnue → semaine');
    assert.equal(app.muscleLoad('week', NOW, []).sessions, 0);
  });

  test('muscleLoad : « Cette semaine » repart de zéro le lundi, « 4 semaines » garde les 28 jours', () => {
    reset();
    const monday9h = new Date(2026, 9, 26, 9).getTime();              // lundi 26/10/2026, 9 h
    const sunday = new Date(2026, 9, 25, 22, 42).getTime();          // la veille au soir
    const h = [{ id: 's', programme: 'ppl', category: 'push', date: sunday,
      exercises: [{ name: 'Développé couché haltères', sets: sets(12) }] }];
    const w = app.muscleLoad('week', monday9h, h);
    assert.equal(w.sessions, 0, 'séance de dimanche : semaine précédente');
    assert.equal(w.levels.chest, 0);
    assert.equal(app.muscleLoad('week', new Date(2026, 9, 25, 23).getTime(), h).sessions, 1, 'dimanche 23 h : même semaine que la séance');
    assert.equal(app.muscleLoad('month', monday9h, h).sessions, 1, '4 semaines : toujours comptée');
    assert.equal(app.weekStart(monday9h), new Date(2026, 9, 26).getTime());
  });

  test('séance seule (image partagée) : intensités rapportées au plus travaillé, muscles principaux', () => {
    reset();
    const h = hist(0, [{ name: 'Développé couché haltères', sets: sets(4) }, { name: 'Curl marteau', sets: sets(2) },
                       { name: 'Inconnu', sets: sets(5) }]);
    sameJSON(app.sessionMuscleLevels(h), { chest: 1, front_delts: 0.5, biceps: 0.5, brachialis: 0.5, triceps: 0.5, forearms: 0.5 });
    sameJSON(app.sessionTopMuscles(h), ['chest', 'front_delts', 'biceps'], 'à égalité : ordre de MUSCLES');
    sameJSON(app.sessionTopMuscles(h, 1), ['chest']);
    sameJSON(app.sessionMuscleLevels(hist(0, [{ name: 'Inconnu', sets: sets(3) }])), {}, 'aucun muscle reconnu');
    sameJSON(app.sessionMuscleLevels(hist(0, [])), {});
    sameJSON(app.sessionTopMuscles(hist(0, [])), []);
  });

  test('silhouette : une zone par muscle, couleurs par intensité, accessibilité', () => {
    const svg = app.bodyMapSvg({ chest: 1, biceps: 0.5, inconnu: 1, triceps: 7, abs: -2 }, { view: 'both' });
    const zones = [...svg.matchAll(/data-muscle="([a-z_]+)"/g)].map(m => m[1]);
    sameJSON([...new Set(zones)].sort(), ids().slice().sort(), 'chaque muscle dessiné au moins une fois');
    assert.ok(/data-muscle="chest" d="[^"]+" fill="var\(--body-heat\)" fill-opacity="1"/.test(svg));
    assert.ok(/data-muscle="triceps" [^>]*fill-opacity="1"/.test(svg), 'intensité bornée à 1');
    assert.ok(/data-muscle="abs" d="[^"]+" fill="var\(--body-zone\)"\/>/.test(svg), 'intensité négative → neutre');
    assert.ok(!svg.includes('inconnu'));
    assert.ok(svg.includes('aria-hidden="true"') && !svg.includes('role="img"'), 'décoratif sans label');
    const lab = app.bodyMapSvg({}, { label: 'Pecs <b>"fort"</b>', view: 'front' });
    assert.ok(lab.includes('role="img"') && lab.includes('aria-label="Pecs &lt;b&gt;&quot;fort&quot;&lt;/b&gt;"'));
    assert.ok(!lab.includes('body-map__back'), 'face seule');
    assert.ok(app.bodyMapSvg({}, { view: 'back' }).includes('data-muscle="glutes"'));
    assert.ok(!app.bodyMapSvg({}, { view: 'front' }).includes('data-muscle="glutes"'), 'fessiers seulement de dos');
  });

  test('silhouette femme : mêmes muscles que l\'homme, vue par vue, et dessin différent', () => {
    const zones = (body, view) => [...app.bodyMapSvg({}, { body, view }).matchAll(/data-muscle="([a-z_]+)"/g)].map(m => m[1]).sort();
    for (const view of ['front', 'back']) sameJSON(zones('female', view), zones('male', view), `vue ${view}`);
    const f = app.bodyMapSvg({ chest: 1 }, { body: 'female' }), m = app.bodyMapSvg({ chest: 1 }, { body: 'male' });
    assert.ok(f.includes('data-body="female"') && m.includes('data-body="male"'));
    assert.notEqual(f.replace('female', 'male'), m, 'tracés propres à la silhouette femme');
    assert.ok(/data-muscle="chest" d="[^"]+" fill="var\(--body-heat\)" fill-opacity="1"/.test(f), 'coloration identique');
    assert.ok(app.bodyMapSvg({}, { body: 'autre' }).includes('data-body="male"'), 'valeur inconnue : homme');
  });

  test('silhouette : suit le réglage (homme si absent), bornée par sanitizeData', () => {
    reset();
    assert.equal(app.bodySilhouette(), 'male', 'données existantes : homme');
    assert.ok(app.bodyMapSvg({}).includes('data-body="male"'));
    run(`data.silhouette = 'female'`);
    assert.equal(app.bodySilhouette(), 'female');
    assert.ok(app.bodyMapSvg({}).includes('data-body="female"'), 'par défaut, la carte suit le réglage');
    assert.ok(app.bodyMapSvg({}, { body: 'male' }).includes('data-body="male"'), 'option explicite prioritaire');
    assert.equal(app.sanitizeData({ ...run('data'), silhouette: 'female' }).silhouette, 'female');
    assert.equal(app.sanitizeData({ ...run('data'), silhouette: 'male' }).silhouette, 'male');
    assert.equal(app.sanitizeData({ ...run('data'), silhouette: '<b>' }).silhouette, undefined, 'valeur inconnue retirée');
    assert.equal(app.sanitizeData({ ...run('data'), silhouette: 1 }).silhouette, undefined);
    reset();
  });

  test('silhouette autonome : xmlns, dimensions, couleurs résolues, légendes', () => {
    const svg = app.bodyMapSvg({ quads: 1 }, { standalone: true, width: 300, captions: true,
      colors: { skin: '#111111', zone: '#222222', heat: '#FF0000', text: '#999999' } });
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(/ width="300" height="\d+"/.test(svg));
    assert.ok(!svg.includes('var(--'), 'aucune variable CSS dans un SVG autonome');
    assert.ok(svg.includes('fill="#FF0000" fill-opacity="1"') && svg.includes('>Face</text>') && svg.includes('>Dos</text>'));
    sameJSON([0, 1 / 3, 2 / 3, 1, 2].map(v => app.bodyHeatOpacity(v)), [0, 0.4, 0.7, 1, 1]);
  });

  test('musclesLine : principaux, faisceaux de l\'épaule regroupés, deux au plus', () => {
    assert.equal(app.musclesLine(app.musclesOf('Développé militaire haltères')), 'Épaules');
    assert.equal(app.musclesLine(app.musclesOf('Développé incliné haltères')), 'Pectoraux · Épaules');
    assert.equal(app.musclesLine(app.musclesOf('Soulevé de terre')), 'Fessiers · Ischio-jambiers');
    assert.equal(app.musclesLine(app.musclesOf('Inconnu')), '');
  });

  test('bibliothèque : catalogue proposé dans la recherche, sans doublon', () => {
    reset();
    const lib = app.exerciseLibrary();
    assert.ok(lib.includes('Soulevé de terre') && lib.includes('Hip thrust'));
    assert.equal(new Set(lib.map(app.normName)).size, lib.length);
  });

  // Mouvement de référence de chaque règle : un nom libre proche (« Soulevé de terre lourd ») reçoit les
  // muscles de la règle, qui doivent être ceux, vérifiés, de la bibliothèque pour ce mouvement. Les
  // règles larges (squat, tirage, cardio…) couvrent des variantes différentes : leurs muscles doivent au
  // moins tous appartenir au mouvement de référence (rien d'inventé).
  const SAME_AS_RULE = ['Leg curl machine', 'Développé couché prise serrée', 'Curl poignets', 'Curl inversé', 'Curl marteau',
    'Curl biceps barre', 'Soulevé de terre roumain', 'Soulevé de terre', 'Swing kettlebell', 'Hip thrust', 'Adducteurs machine',
    'Mollets debout', 'Extension quadriceps', 'Extension triceps poulie', 'Dips', 'Oiseau (élévations arrière)', 'Pull-over poulie',
    'Élévations latérales', 'Élévations frontales', 'Rowing menton', 'Haussements d\'épaules haltères', 'Crunch',
    'Développé militaire barre', 'Écarté haltères plat', 'Développé incliné barre', 'Développé couché barre', 'Tirage horizontal câble',
    'Extension lombaires', 'Burpees', 'Escaliers'];
  const SUBSET_OF_CATALOGUE = ['Squat barre', 'Tractions pronation', 'Face pull', 'Course à pied', 'Développé au sol haltères'];

  test('muscles : règles des noms libres alignées sur la bibliothèque (mouvement de référence)', () => {
    const rule = name => run(`(() => { const r = MUSCLE_RULES.find(([re]) => re.test(ruleKey(${JSON.stringify(name)})));
      return r ? { p: [...r[1]].sort(), s: [...r[2]].sort() } : null; })()`);
    const cat = name => { const e = run(`catalogueEntry(${JSON.stringify(name)})`); return { p: [...e.primary].sort(), s: [...e.secondary].sort() }; };
    for (const name of SAME_AS_RULE) {
      const r = rule(name), c = cat(name);
      assert.ok(r, `${name} : aucune règle`);
      sameJSON(r, c, `${name} : règle ${JSON.stringify(r)}, bibliothèque ${JSON.stringify(c)}`);
    }
    for (const name of SUBSET_OF_CATALOGUE) {
      const r = rule(name), c = cat(name), all = new Set([...c.p, ...c.s]);
      [...r.p, ...r.s].forEach(m => assert.ok(all.has(m), `${name} : ${m} dans la règle, pas dans la bibliothèque`));
      r.p.forEach(m => assert.ok(c.p.includes(m), `${name} : ${m} principal pour la règle seulement`));
    }
    // Chaque règle a son mouvement de référence dans l'une des deux listes
    const covered = new Set([...SAME_AS_RULE, ...SUBSET_OF_CATALOGUE].map(n => run(`String(MUSCLE_RULES.find(([re]) => re.test(ruleKey(${JSON.stringify(n)})))[0])`)));
    assert.equal(covered.size, run('MUSCLE_RULES.length'), 'règle sans mouvement de référence');
  });

  test('silhouette : choix Femme / Homme (js/ui/body-map.js), réglage actuel coché', () => {
    reset();
    const html = run('silhouetteSegmentedHtml()');
    assert.match(html, /data-val="male"[^>]*>Homme/);
    assert.match(html, /aria-pressed="true" data-action="set-silhouette" data-val="male"/, 'homme par défaut');
    run(`data.silhouette = 'female'`);
    assert.match(run('silhouetteSegmentedHtml()'), /aria-pressed="true" data-action="set-silhouette" data-val="female"/);
  });

  test('séance : menu ⋯ avec « Muscles ciblés » pour tout exercice, bibliothèque comprise', () => {
    reset();
    const values = name => run(`exerciseMenuActions([{ name: 'A', sets: [] }, { name: ${JSON.stringify(name)}, sets: [] }, { name: 'B', sets: [] }], 1).map(a => a.value).join()`);
    assert.ok(values('Développé couché barre').split(',').includes('muscles'), 'muscles vérifiés modifiables');
    assert.ok(values('bench press').split(',').includes('muscles'), 'alias de la bibliothèque');
    assert.ok(values('Développé couché barre').split(',').includes('howto'), 'et « Comment faire »');
    assert.ok(values('Grimpe au mur').split(',').includes('muscles'), 'exercice de la personne : choix proposé');
    assert.ok(values('Curl marteau corde').split(',').includes('muscles'), 'reconnu par les règles : choix proposé');
  });

  // Contexte vm (localStorage) : lu à l'appel, après reset()
  function ctx() { return run('globalThis'); }
}
