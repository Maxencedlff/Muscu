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
    assert.equal(known.size, 16);
    const names = run('EXERCISE_CATALOGUE.map(e => normName(e.name))');
    assert.equal(new Set(names).size, names.length, 'nom en double dans la bibliothèque');
    run('EXERCISE_CATALOGUE').forEach(e => {
      assert.ok(e.primary.length, `${e.name} : aucun muscle principal`);
      [...e.primary, ...e.secondary].forEach(id => assert.ok(known.has(id), `${e.name} : muscle inconnu ${id}`));
      assert.ok(!e.secondary.some(id => e.primary.includes(id)), `${e.name} : muscle principal et secondaire`);
    });
    run('MUSCLE_RULES').forEach(([re, p, s]) => [...p, ...s].forEach(id => assert.ok(known.has(id), `${re} : ${id}`)));
  });

  test('muscles : tous les exercices des programmes intégrés sont dans la bibliothèque', () => {
    const names = run(`Object.values(PROGRAMMES).flatMap(p => Object.values(p.defaults).flatMap(l => l.map(([n]) => n)))`);
    assert.ok(names.length > 20);
    names.forEach(n => assert.equal(app.musclesOf(n).source, 'catalogue', n));
  });

  test('muscles : la bibliothèque et les règles concordent sur le muscle principal', () => {
    // Garde-fou : une règle trop large (ex. « press ») ne doit pas contredire la bibliothèque
    run('EXERCISE_CATALOGUE').forEach(e => {
      const rule = run('MUSCLE_RULES').find(([re]) => re.test(app.normName(e.name)));
      assert.ok(rule, `${e.name} : aucune règle ne le reconnaît`);
      assert.ok(rule[1].some(id => e.primary.includes(id)), `${e.name} : règle ${rule[0]} → ${rule[1]}`);
    });
  });

  test('muscles : reconnaissance des noms saisis librement', () => {
    const cases = {
      'Curl haltères incliné prise supination': 'biceps',
      'Leg curl assis': 'hamstrings',
      'Curl nordique': 'hamstrings',
      'Curl marteau corde': 'biceps',
      'Squat bulgare': 'quads',
      'Fentes arrière': 'quads',
      'Bench press': 'chest',
      'Pompes diamant': 'chest',
      'Lat pulldown': 'lats',
      'Tractions lestées': 'lats',
      'Rowing poulie basse': 'lats',
      'Deadlift': 'glutes',
      'Soulevé de terre jambes tendues': 'hamstrings',
      'Développé militaire assis': 'front_delts',
      'Développé couché prise serrée barre': 'triceps',
      'Extension triceps nuque haltère': 'triceps',
      'Barre au front EZ': 'triceps',
      'Tirage menton': 'side_delts',
      'Élévations latérales assis': 'side_delts',
      'Oiseau à la poulie': 'rear_delts',
      'Face pull corde': 'rear_delts',
      'Shrugs barre': 'traps',
      'Hip thrust barre': 'glutes',
      'Mollets à la presse': 'calves',
      'Crunch à genoux': 'abs',
      'Gainage latéral': 'abs',
      'Extension lombaires au banc': 'lower_back',
      'Adducteurs poulie': 'adductors',
      'Dips lestés': 'chest',
      'Chest press machine': 'chest',
    };
    for (const [name, main] of Object.entries(cases)) {
      const m = pick(name);
      assert.equal(m.src, 'rules', name);
      assert.equal(m.p[0], main, `${name} → ${m.p.join(', ')}`);
    }
    sameJSON(pick('Curl marteau corde').p, ['biceps', 'forearms']);
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
    run(`data.programmes.ppl.exercises.push[0].muscles = ['triceps'];`);
    const id = run('data.programmes.ppl.exercises.push[0].id');
    const viaId = app.exerciseMuscles({ exId: id, name: 'Développé couché haltères' });
    sameJSON({ p: viaId.primary, s: viaId.secondary, src: viaId.source }, { p: ['triceps'], s: [], src: 'user' });
    assert.equal(app.exerciseMuscles({ exId: 'autre', name: 'Développé couché haltères' }).primary[0], 'chest');
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
    assert.equal(counts.forearms, 3);
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
    sameJSON(app.sessionMuscleLevels(h), { chest: 1, front_delts: 0.5, biceps: 0.5, triceps: 0.5, forearms: 0.5 });
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

  // Contexte vm (localStorage) : lu à l'appel, après reset()
  function ctx() { return run('globalThis'); }
}
