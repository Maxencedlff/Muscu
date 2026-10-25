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

  test('muscles verrouillés : le catalogue fait foi pour un exercice de la bibliothèque', () => {
    reset();
    assert.equal(app.musclesLocked('Développé couché barre'), true);
    assert.equal(app.musclesLocked('bench press'), true, 'alias de la bibliothèque');
    assert.equal(app.musclesLocked('dc'), true, 'abréviation développée');
    assert.equal(app.musclesLocked('Curl marteau corde'), false, 'reconnu par les règles : exercice de la personne');
    assert.equal(app.musclesLocked('Grimpe au mur'), false);
    assert.equal(app.musclesLocked(''), false);
    // Aucune nouvelle déclaration pour un nom de la bibliothèque, par son nom ou un alias
    run(`setDeclaredMuscles('Développé couché barre', { primary: ['triceps'], secondary: ['abs'] }); setDeclaredMuscles('bench press', ['calves']);`);
    assert.equal(run('data.exerciseMuscles === undefined && data.exerciseMusclesSecondary === undefined'), true);
    const m = app.exerciseMuscles({ name: 'Développé couché barre' });
    sameJSON({ p: m.primary, s: m.secondary, src: m.source }, { p: ['chest'], s: ['front_delts', 'triceps'], src: 'catalogue' });
  });

  test('muscles verrouillés : anciens choix d\'un exercice de la bibliothèque ignorés à la lecture, gardés tels quels', () => {
    reset();
    // Enregistrés par une version précédente (ou reçus d'un autre appareil par la synchro)
    run(`data.exerciseMuscles = { 'curl marteau': ['triceps'], 'grimpe au mur': ['lats'] };
         data.exerciseMusclesSecondary = { 'curl marteau': ['abs'] };
         Object.assign(data.programmes.ppl.exercises.push[0], { muscles: ['calves'], musclesSecondary: ['abs'] });`);
    const name = run('data.programmes.ppl.exercises.push[0].name');
    assert.equal(app.musclesLocked(name), true, `${name} : exercice intégré du programme`);
    const cat = app.musclesOf(name);
    sameJSON(app.exerciseMuscles(run('data.programmes.ppl.exercises.push[0]')).primary, [...cat.primary]);
    assert.equal(app.chosenMuscles(run('data.programmes.ppl.exercises.push[0]')), null);
    assert.ok(!app.chosenMusclesIndex().has(run('data.programmes.ppl.exercises.push[0].id')), 'absent de l\'index des choix');
    sameJSON(app.exerciseMuscles({ name: 'Curl marteau' }).primary, ['brachialis', 'biceps', 'forearms']);
    assert.equal(app.declaredMuscles('Curl marteau'), null);
    sameJSON(app.declaredSecondary('Curl marteau'), []);
    // Exercice de la personne : son choix compte toujours
    sameJSON(app.exerciseMuscles({ name: 'Grimpe au mur' }).primary, ['lats']);
    // Séries par muscle : l'ancien choix ne fausse pas les compteurs
    const counts = app.muscleSetCounts([hist(0, [{ name: 'Curl marteau', sets: sets(2) }])], -Infinity, Infinity).counts;
    assert.equal(counts.triceps, 0);
    assert.equal(counts.biceps, 2);
    // Rien d'effacé : nettoyage, migrations et profil synchronisé gardent les valeurs (un autre appareil,
    // ou une version précédente, les retrouve ; la synchro les fusionnerait de toute façon par union)
    const d = app.sanitizeData(app.normalizeData(JSON.parse(JSON.stringify(run('data')))));
    sameJSON(d.exerciseMuscles['curl marteau'], ['triceps']);
    sameJSON(d.programmes.ppl.exercises.push[0].muscles, ['calves']);
    sameJSON(app.profilePayload(d).exerciseMuscles, { 'curl marteau': ['triceps'], 'grimpe au mur': ['lats'] });
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
    'Extension lombaires', 'Burpees'];
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

  test('séance : menu ⋯ sans « Muscles ciblés » pour un exercice de la bibliothèque', () => {
    reset();
    const values = name => run(`exerciseMenuActions({ name: ${JSON.stringify(name)}, sets: [] }, 1, 2).map(a => a.value).join()`);
    assert.ok(!values('Développé couché barre').split(',').includes('muscles'), 'muscles fixés : rien à choisir');
    assert.ok(!values('bench press').split(',').includes('muscles'), 'alias de la bibliothèque');
    assert.ok(values('Développé couché barre').split(',').includes('howto'), 'ses muscles restent visibles par « Comment faire »');
    assert.ok(values('Grimpe au mur').split(',').includes('muscles'), 'exercice de la personne : choix proposé');
    assert.ok(values('Curl marteau corde').split(',').includes('muscles'), 'reconnu par les règles : choix proposé');
  });

  // Contexte vm (localStorage) : lu à l'appel, après reset()
  function ctx() { return run('globalThis'); }
}
