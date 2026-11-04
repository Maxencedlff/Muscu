import fs from 'node:fs';
import path from 'node:path';

// Mesures des exercices (js/data/measures.js) : répétitions, durée, cardio
export default function ({ test, run, reset, assert, ROOT }) {
  const sameJSONLike = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
  test('élastique d\'assistance : aide retirée du poids du corps, pastilles des élastiques', () => {
    reset();
    for (const name of ['Tractions avec élastique', 'Tractions élastique gros', 'Dips avec élastique', 'Band assisted pull up']) {
      assert.equal(run(`loadKind({ name: ${JSON.stringify(name)} })`), 'aide', name);
    }
    for (const name of ['Pompes avec élastique', 'Curl élastique', 'Squat élastique']) {
      assert.notEqual(run(`loadKind({ name: ${JSON.stringify(name)} })`), 'aide', `${name} : l'élastique ajoute de la résistance`);
    }
    // 74 kg, élastique orange (30 kg) : 74 × 0,95 − 30 ≈ 40,3 kg soulevés
    const eff = run(`effectiveLoad({ weight: '30', reps: '7' }, { name: 'Tractions avec élastique' }, 74)`);
    assert.ok(Math.abs(eff - (74 * 0.95 - 30)) < 0.01, String(eff));
    sameJSONLike(run('ASSIST_BANDS.map(b => b.kg)'), [10, 20, 30]);
    // Pastilles : choisie si toutes les séries restantes ont cette aide ; rien pour un exercice ordinaire
    const ex = { name: 'Tractions avec élastique', sets: [{ weight: '30', reps: '7', done: true }, { weight: '20', reps: '7' }, { weight: '20', reps: '' }] };
    const html = run(`bandPickerHtml(${JSON.stringify(ex)}, 0)`);
    assert.match(html, /data-kg="20" aria-pressed="true"/);
    assert.match(html, /data-kg="30" aria-pressed="false"/);
    assert.equal(run(`bandPickerHtml({ name: 'Curl marteau', sets: [{ weight: '14', reps: '' }] }, 0)`), '');
  });

  test('volume des bips : « Fort » par défaut, valeur inconnue remise à « Fort » au chargement', () => {
    reset();
    assert.equal(run('data.soundLevel'), 'fort');
    assert.equal(run("(() => { const d = { soundLevel: 'xx' }; normalizeData(d); return d.soundLevel; })()"), 'fort');
  });

  test('mesures : bibliothèque, noms libres et choix enregistré', () => {
    reset();
    const m = n => run(`measureOf({ name: ${JSON.stringify(n)} })`);
    assert.equal(m('Gainage (planche)'), 'time');
    assert.equal(m('Planche sur les coudes'), 'time');
    assert.equal(m('Chaise contre le mur'), 'time');
    assert.equal(m('Tapis de course'), 'cardio');
    assert.equal(m('Footing 5 km'), 'cardio');
    assert.equal(m('Rowing machine'), 'reps', 'machine de musculation, pas le rameur');
    assert.equal(m('Développé couché barre'), 'reps', '« velo » dans « developpe » ne compte pas');
    assert.equal(m('Curl marteau'), 'reps');
    assert.equal(run(`measureOf({ name: 'Curl marteau', measure: 'time' })`), 'time');
    assert.equal(run(`measureOf({ name: 'Gainage (planche)', measure: 'reps' })`), 'reps', 'choix explicite prioritaire');
  });

  // Mesure des versions précédentes (bibliothèque d'avant le 25/10/2026, measureOf sur le nom seul) :
  // relevée avec l'arbre d'avant ; un exercice enregistré sans mesure doit la garder
  const BEFORE = {
    'Treadmill': 'reps', 'Trail': 'reps', 'fractionné': 'reps', 'VTT': 'reps', 'Home trainer': 'reps', 'home-trainer': 'reps',
    'Intervalles': 'reps', 'VMA': 'reps', 'Biking': 'reps', 'RPM': 'reps', 'Trail du dimanche': 'reps',
    'Course à pied': 'cardio', 'Tapis de course': 'cardio', 'Fractionné (course)': 'cardio', 'Trail running': 'cardio',
    'Vélo': 'cardio', 'Vélo d\'appartement': 'cardio', 'Spinning': 'cardio', 'Crunch vélo': 'reps', 'Gainage (planche)': 'time',
  };

  test('mesures : séances d\'avant la bibliothèque du 25/10 gardent leur mesure (« Trail · 10 reps »)', () => {
    reset();
    for (const [name, before] of Object.entries(BEFORE)) {
      const h = run(`(() => { const h = { id: 'o', date: 1, category: 'free', exercises: [{ name: ${JSON.stringify(name)}, sets: [{ weight: '', reps: '10' }] }] };
        cleanHistoryEntry(h); return h; })()`);
      assert.equal(run(`measureOf(${JSON.stringify(h.exercises[0])})`), before, name);
    }
    const h = run(`(() => { const h = { id: 'o', date: 1, category: 'free', exercises: [{ name: 'Trail', sets: [{ weight: '', reps: '10' }] }] };
      cleanHistoryEntry(h); cleanHistoryEntry(h); return h; })()`);
    assert.equal(h.exercises[0].measure, 'reps', 'mesure écrite, nettoyage idempotent');
    assert.equal(run(`measureSetTxt(${JSON.stringify(h.exercises[0].sets[0])}, measureOf(${JSON.stringify(h.exercises[0])}))`), '10 reps');
    // Ce que l'app enregistre aujourd'hui n'est pas touché : la mesure de tout cardio est écrite
    const now = run(`(() => { const h = { id: 'n', date: 1, category: 'free', exercises: [{ name: 'Trail', measure: storedMeasure({ name: 'Trail' }), sets: [{ weight: '', reps: '40' }] }] };
      cleanHistoryEntry(h); return h.exercises[0].measure; })()`);
    assert.equal(now, 'cardio');
    // Liste figée : chaque nom est bien devenu cardio ou durée par la bibliothèque (sinon il n'a rien à
    // faire là), et sa clé est celle de la bibliothèque (looseKey, abréviations comprises)
    run('[...LEGACY_REPS_NAMES]').forEach(k => {
      assert.ok(run(`catalogueEntry(${JSON.stringify(k)})`), k);
      assert.notEqual(run(`measureOf({ name: ${JSON.stringify(k)} })`), 'reps', k);
      assert.equal(run(`legacyKey(${JSON.stringify(k)})`), run(`looseKey(${JSON.stringify(k)})`), k);
    });
    // Alias trop génériques retirés : un fractionné de squats ou un « RPM » de salle restent des répétitions
    ['intervalles', 'vma', 'biking', 'rpm'].forEach(n => assert.equal(run(`catalogueEntry(${JSON.stringify(n)})`), null, n));
  });

  test('mesures : schéma 4, exercices de programme aux noms devenus cardio gardés en répétitions', () => {
    const prog = () => ({ ppl: { exercises: { legs: [{ id: 'a', name: 'Trail', sets: 3 }, { id: 'b', name: 'VTT', sets: 3, measure: 'cardio' },
      { id: 'c', name: 'Squat barre', sets: 3 }] }, timers: {}, cooldowns: {} } });
    const old = run(`normalizeData(${JSON.stringify({ schema: 3, activeProgramme: 'ppl', programmes: prog(), history: [] })})`);
    assert.equal(old.schema, run('SCHEMA'));
    const legs = old.programmes.ppl.exercises.legs;
    assert.equal(legs[0].measure, 'reps', 'Trail d\'avant : répétitions');
    assert.equal(legs[1].measure, 'cardio', 'choix déjà enregistré : gardé');
    assert.equal(legs[2].measure, undefined, 'autres noms : rien d\'écrit');
    // Donnée au schéma courant : « Trail » ajouté depuis la bibliothèque reste du cardio
    const cur = run(`normalizeData(${JSON.stringify({ schema: 4, activeProgramme: 'ppl', programmes: prog(), history: [] })})`);
    assert.equal(cur.programmes.ppl.exercises.legs[0].measure, undefined);
    assert.equal(run(`measureOf({ name: 'Trail' })`), 'cardio');
  });

  // Mesure de chaque nom pour la version d'avant les alias du 26/10/2026 (tests/unit/mesures-avant.json,
  // figé) : un exercice enregistré sans mesure la garde, dans l'historique comme dans un programme
  const BEFORE_ALIAS = JSON.parse(fs.readFileSync(new URL('./mesures-avant.json', import.meta.url), 'utf8'));
  const beforeAlias = new Map(['reps', 'time', 'cardio'].flatMap(m => BEFORE_ALIAS[m].map(n => [n, m])));
  const keptMeasure = (names, fromSchema) => JSON.parse(run(`JSON.stringify(${JSON.stringify(names)}.map(name => {
    const h = { id: 'o', date: 1, category: 'free', exercises: [{ name, sets: [{ weight: '', reps: '10' }] }] };
    cleanHistoryEntry(h);
    const d = normalizeData({ schema: ${fromSchema}, activeProgramme: 'ppl', history: [],
      programmes: { ppl: { exercises: { legs: [{ id: 'p', name, sets: 3 }] }, timers: {}, cooldowns: {} } } });
    return [name, measureOf(h.exercises[0]), measureOf(d.programmes.ppl.exercises.legs[0])];
  }))`));

  test('mesures : alias du 26/10 (rower, wall squat, la chaise…) : séances et programmes d\'avant gardent leur mesure', () => {
    reset();
    // Historique : les noms du 25/10 sans mesure viennent d'avant le 25/10 (répétitions, test précédent)
    const of25 = new Set(run(`LEGACY_REPS_BY_SCHEMA[4].map(legacyKey)`));
    const inHistory = n => beforeAlias.get(n) === 'cardio' && of25.has(run(`legacyKey(${JSON.stringify(n)})`)) ? 'reps' : beforeAlias.get(n);
    const wrong = keptMeasure([...beforeAlias.keys()], 4).filter(([n, h, p]) => h !== inHistory(n) || p !== beforeAlias.get(n));
    assert.deepEqual(wrong.map(([n, h, p]) => `${n} : ${beforeAlias.get(n)} avant, ${h} (historique), ${p} (programme)`), [],
      'nom dont la mesure change : l\'ajouter à LEGACY_REPS_BY_SCHEMA (js/data/store.js)');
    // Tout nom de la bibliothèque inconnu de la version d'avant (alias à venir) : avant lui, il suivait les
    // mots-clés (measureByRules) ; s'il en change, un exercice enregistré sans mesure doit garder l'ancienne
    const fresh = run(`EXERCISE_CATALOGUE.flatMap(e => [e.name, ...e.aliases])`).filter(n => !beforeAlias.has(n));
    // (mots-clés d'avant les mots de cardio du 29/10, legacyMeasureByRules : « Escaliers » sans mesure était en répétitions)
    const changed = keptMeasure(fresh, run('SCHEMA')).filter(([n, h]) => h !== run(`legacyMeasureByRules(${JSON.stringify(n)})`));
    assert.deepEqual(changed.map(([n, h]) => `${n} : ${h}`), [], 'nouvel alias qui change la mesure d\'un nom : l\'ajouter à LEGACY_REPS_BY_SCHEMA');
    // Ce qui est enregistré aujourd'hui n'est pas touché : « Rower » choisi depuis la bibliothèque est du cardio
    const now = run(`(() => { const ex = { name: 'Rower', sets: [{ weight: '', reps: '20' }] }; ex.measure = storedMeasure(ex);
      const h = { id: 'n', date: 1, category: 'free', exercises: [ex] }; cleanHistoryEntry(h); return measureOf(h.exercises[0]); })()`);
    assert.equal(now, 'cardio');
    // Programme au schéma courant : un exercice sans mesure suit son nom (ajouté depuis la bibliothèque)
    const cur = keptMeasure(['Rower', 'Wall squat', 'Trail'], run('SCHEMA')).map(x => x[2]);
    assert.deepEqual(cur, ['cardio', 'time', 'cardio']);
    // Schéma 4 : « Trail » sans mesure vient de la bibliothèque du 25/10 (cardio) ; « Trails » n'y était
    // reconnu que par son nom exact, il était en répétitions
    assert.deepEqual(keptMeasure(['Trail', 'Trails', 'Rowers'], 4).map(x => x[2]), ['cardio', 'reps', 'reps']);
  });

  test('mesures : schéma 6, mots de cardio du 29/10 (escalier, stair, stepmill…) : exercices d\'avant gardés en répétitions', () => {
    reset();
    const same = (x, y, m) => assert.equal(JSON.stringify(x), JSON.stringify(y), m);   // tableaux d'un autre realm
    const names = ['Montées d\'escaliers lestées', 'Escaliers', 'StepMill', 'Stair climber', 'Stepper', 'Course à pied'];
    const kept = ['reps', 'reps', 'reps', 'reps', undefined, undefined];   // stepper et course : déjà cardio avant
    // Historique (à chaque nettoyage, comme pinLegacyReps) : charge × reps, volume et record gardés
    const h = run(`(() => { const h = { id: 'o', date: 1, category: 'free', exercises: ${JSON.stringify(names.map(name => ({ name, sets: [{ weight: '20', reps: '12' }] })))} };
      cleanHistoryEntry(h); return h; })()`);
    same(h.exercises.map(e => e.measure), kept);
    assert.equal(run(`measureSetTxt(${JSON.stringify(h.exercises[0].sets[0])}, measureOf(${JSON.stringify(h.exercises[0])}))`), '20 kg × 12');
    assert.equal(run(`exVolume(${JSON.stringify(h.exercises[0])})`), 240);
    assert.equal(run(`measureOf(${JSON.stringify(h.exercises[4])})`), 'cardio', 'stepper : cardio avant comme après');
    // Ce que l'app enregistre aujourd'hui n'est pas touché : « Escaliers » de la bibliothèque a sa mesure écrite
    assert.equal(run(`storedMeasure({ name: 'Escaliers' })`), 'cardio');
    // Copies figées de store.js (autonomes : l'historique est nettoyé avant measures.js) et règles vivantes concordent
    assert.equal(run('LEGACY_NOT_CARDIO_RE.source'), run('NOT_CARDIO_RE.source'), 'NOT_CARDIO_RE a changé : figer l\'ancienne et revoir pinLegacyCardioWords');
    for (const w of ['escalier', 'stair', 'stepmill', 'step mill', 'climbmill', 'powermill']) {
      assert.ok(run(`CARDIO_RE.test(${JSON.stringify(w)}) && !LEGACY_CARDIO_RE.test(${JSON.stringify(w)})`), w);
    }
    assert.equal(run(`CARDIO_RE.source.replace(CARDIO_WORDS_ADDED.source + '|', '')`), run('LEGACY_CARDIO_RE.source'), 'CARDIO_RE a changé : figer les nouveaux mots (CARDIO_WORDS_ADDED, schéma suivant)');
    // Chargement : une donnée avec historique se lit dès store.js (avant ruleKey et CARDIO_RE), sans erreur
    run(`localStorage.setItem(KEY, JSON.stringify({ schema: 5, history: [{ id: 'b', date: 1, category: 'free', exercises: [{ name: 'Escaliers', sets: [{ weight: '20', reps: '12' }] }] }] }))`);
    assert.equal(run(`(() => { const src = ${JSON.stringify(fs.readFileSync(path.join(ROOT, 'js/data/store.js'), 'utf8'))};
      const box = { localStorage, console, normName, cleanMachine, uid: () => 'u', showToast: () => {} };
      try { return new Function('with (this) { ' + src + ' } return loadData().history[0].exercises[0].measure;').call(box); } catch (e) { return String(e); } })()`),
      'reps', 'chargement de store.js seul, historique « Escaliers » sans mesure');
    run('localStorage.clear()');
    // Programmes : une seule fois, au passage au schéma 6 ; une donnée déjà au schéma 6 suit la bibliothèque
    const prog = () => ({ ppl: { exercises: { legs: names.map((name, i) => ({ id: 'e' + i, name, sets: 3 })) }, timers: {}, cooldowns: {} } });
    const old = run(`normalizeData(${JSON.stringify({ schema: 5, activeProgramme: 'ppl', programmes: prog(), history: [] })})`);
    assert.equal(old.schema, 6);
    same(old.programmes.ppl.exercises.legs.map(e => e.measure), kept);
    const cur = run(`normalizeData(${JSON.stringify({ schema: 6, activeProgramme: 'ppl', programmes: prog(), history: [] })})`);
    same(cur.programmes.ppl.exercises.legs.map(e => e.measure), names.map(() => undefined));
    assert.equal(run(`measureOf({ name: 'Escaliers' })`), 'cardio');
    // Séance en cours commencée avec la version d'avant (donnée lue au schéma 5) : exercice sans mesure gardé en
    // répétitions, mesure écrite respectée ; donnée déjà au schéma 6 : rien
    const saved = JSON.stringify({ activeSession: { programme: 'ppl', category: 'legs', startedAt: 1, exercises: [
      { exId: 'x', name: 'Montées d\'escaliers lestées', sets: [{ weight: '20', reps: '', prev: null, done: false }] },
      { exId: 'y', name: 'Escaliers', measure: 'cardio', sets: [{ weight: '', reps: '', prev: null, done: false }] }] }, sessionNotes: '', rest: null });
    // js/data/active-session.js chargé dans une fonction : son « let activeSession » ne doit pas devenir global
    // (les tests de mise à jour à chaud posent activeSession sur le contexte)
    const src = fs.readFileSync(path.join(ROOT, 'js/data/active-session.js'), 'utf8');
    const restored = schema => run(`(() => { ${src}
      localStorage.setItem(SESSION_KEY, ${JSON.stringify(saved)}); loadedSchema = ${schema};
      restoreSession(); const m = activeSession.exercises.map(e => e.measure); loadedSchema = SCHEMA;
      localStorage.removeItem(SESSION_KEY); return m; })()`);
    same(restored(5), ['reps', 'cardio']);
    same(restored(6), [undefined, 'cardio']);
    // Séance reçue d'un autre (liste blanche) : sans mesure, elle vient de sa version d'avant
    const pub = run(`cleanPublicSession({ exercises: [{ name: 'Escaliers', sets: [{ weight: '20', reps: '12' }] }, { name: 'Escaliers', measure: 'cardio', sets: [{ weight: '', reps: '15' }] }] })`);
    same(pub.exercises.map(e => e.measure), ['reps', 'cardio']);
  });

  test('mesures : textes des séries', () => {
    reset();
    const t = (s, m) => run(`measureSetTxt(${JSON.stringify(s)}, '${m}')`);
    assert.equal(t({ weight: '', reps: '45' }, 'time'), '45 s');
    assert.equal(t({ weight: '', reps: '90' }, 'time'), '1 min 30');
    assert.equal(t({ weight: '10', reps: '30' }, 'time'), '30 s · +10 kg');
    assert.equal(t({ weight: '', reps: '30', dist: '5.2' }, 'cardio'), '5,2 km · 30 min');
    assert.equal(t({ weight: '', reps: '20' }, 'cardio'), '20 min');
    assert.equal(t({ weight: '32.5', reps: '8' }, 'reps'), '32,5 kg × 8');
  });

  test('mesures : volume en kg seulement en répétitions, données gardées au nettoyage', () => {
    reset();
    const ex = [
      { name: 'Développé couché barre', sets: [{ weight: '50', reps: '10' }] },
      { name: 'Gainage (planche)', measure: 'time', sets: [{ weight: '10', reps: '60' }] },
      { name: 'Course à pied', measure: 'cardio', sets: [{ weight: '', reps: '30', dist: '5' }] },
    ];
    assert.equal(run(`sessionVolume(${JSON.stringify(ex)})`), 500);
    const h = run(`(() => { const h = { id: 'm1', date: Date.now(), category: 'push', exercises: ${JSON.stringify(ex)} };
      h.exercises[1].sets.push({ weight: '', reps: '1800' }); h.exercises[0].measure = 'bidon';
      cleanHistoryEntry(h); return h; })()`);
    assert.equal(h.exercises[1].sets.length, 2, 'un maintien de 30 min (1800 s) est gardé');
    assert.equal(h.exercises[2].sets[0].dist, '5');
    assert.equal(h.exercises[2].measure, 'cardio');
    assert.equal(h.exercises[0].measure, undefined, 'mesure inconnue retirée');
  });

  test('poids du corps : part soulevée, lest, aide, volume et meilleure série', () => {
    reset();
    const share = n => run(`bodyShare({ name: ${JSON.stringify(n)} })`);
    assert.equal(share('Tractions pronation'), 0.95);
    assert.equal(share('Pull-ups'), 0.95, 'par alias');
    assert.equal(share('Tractions lestées'), 0.95, 'nom libre');
    assert.equal(share('Pompes sur les genoux'), 0.5);
    assert.equal(share('Dips sur chaise'), 0, 'pas de valeur établie : rien inventé');
    assert.equal(share('Tirage vertical prise large'), 0);
    assert.equal(share('Gainage (planche)'), 0, 'durée');
    assert.equal(run(`loadKind({ name: 'Dips' })`), 'lest');
    assert.equal(run(`loadKind({ name: 'Tractions assistées (machine)' })`), 'aide');
    assert.equal(run(`loadKind({ name: 'Curl marteau' })`), 'charge');
    // 8 tractions à 80 kg : 76 kg effectifs ; +10 kg de lest : 86 ; machine qui aide de 20 kg : 56
    assert.equal(run(`exVolume({ name: 'Tractions pronation', sets: [{ weight: '', reps: '8' }] }, undefined, 80)`), 608);
    assert.equal(run(`exVolume({ name: 'Tractions pronation', sets: [{ weight: '10', reps: '8' }] }, undefined, 80)`), 688);
    assert.equal(run(`exVolume({ name: 'Tractions assistées (machine)', sets: [{ weight: '20', reps: '8' }] }, undefined, 80)`), 448);
    assert.equal(run(`exVolume({ name: 'Tractions pronation', sets: [{ weight: '10', reps: '8' }] }, undefined, null)`), 80, 'poids inconnu : le lest seul');
    assert.equal(run(`exVolume({ name: 'Curl marteau', sets: [{ weight: '15', reps: '10' }] }, undefined, 80)`), 150, 'charge : inchangé');
    // Aide : la meilleure série est celle qui a le moins d'aide
    assert.equal(run(`bestSet([{ weight: '30', reps: '8' }, { weight: '20', reps: '6' }], { name: 'Tractions assistées (machine)' }).weight`), '20');
    assert.equal(run(`setTxt({ w: 10, r: 8, weight: '10', reps: '8' }, { name: 'Dips' })`), '8 reps · +10 kg');
    assert.equal(run(`setTxt({ w: 20, r: 8, weight: '20', reps: '8' }, { name: 'Tractions assistées (machine)' })`), '8 reps · aide 20 kg');
    assert.equal(run(`recordLabel({ weight: '15', reps: '5' }, { prW: 10, prR: 5, e1rm: 0 }, { name: 'Dips' })`), 'Record lest');
  });

  test('relecture : noms ambigus, choix « Répétitions » enregistré, objectif +1 rep', () => {
    reset();
    const m = n => run(`measureOf({ name: ${JSON.stringify(n)} })`);
    for (const n of ['Crunch vélo', 'Crunch bicyclette', 'Relevés de jambes en suspension', 'Rowing rameur', 'Tirage rameur'])
      assert.equal(m(n), 'reps', n);
    const mu = n => [...run(`musclesOf(${JSON.stringify(n)}).primary`)];
    assert.ok(mu('Crunch vélo').includes('abs'));
    assert.ok(mu('Relevés de jambes en suspension').includes('abs'));
    assert.ok(mu('Rowing rameur').includes('lats'));
    assert.ok(mu('Suspension passive').includes('forearms'));
    // Un choix qui contredit le nom est enregistré ; sinon rien (répétitions par défaut)
    assert.equal(run(`storedMeasure({ name: 'Tapis de course', measure: 'reps' })`), 'reps');
    assert.equal(run(`storedMeasure({ name: 'Curl marteau' })`), null);
    assert.equal(run(`storedMeasure({ name: 'Gainage (planche)' })`), 'time');
    const h = run(`(() => { const h = { id: 'r1', date: Date.now(), category: 'push', exercises: [{ name: 'Tapis de course', measure: 'reps', sets: [{ weight: '', reps: '12' }] }] }; cleanHistoryEntry(h); return h; })()`);
    assert.equal(h.exercises[0].measure, 'reps', 'choix « Répétitions » gardé au nettoyage');
  });

  test('chrono d\'effort : préparation, décompte, fin à l\'heure exacte, chrono libre', () => {
    const t0 = 1_000_000;
    const c = (now, target = 30) => run(`effortClock({ ei: 0, si: 0, start: ${t0}, target: ${target} }, ${now})`);
    assert.equal(c(t0 - 4200).phase, 'prep');
    assert.equal(c(t0 - 4200).prepLeft, 5);
    assert.equal(c(t0 + 10_400).left, 20);
    assert.equal(c(t0 + 29_999).phase, 'effort');
    const end = c(t0 + 45_000);
    assert.equal(end.phase, 'done', 'fini pendant l\'absence de l\'app');
    assert.equal(end.endAt, t0 + 30_000, 'le repos part de la vraie fin de l\'effort');
    const free = run(`effortClock({ ei: 0, si: 0, start: ${t0}, target: null }, ${t0 + 125_000})`);
    assert.equal(free.phase, 'effort'); assert.equal(free.elapsed, 125); assert.equal(free.left, null);
  });

  test('chrono d\'effort à deux côtés : côté 1, changement de côté, côté 2, fin', () => {
    const t0 = 2_000_000, e = `{ ei: 0, si: 0, start: ${t0}, target: 30, sides: 2 }`;
    const c = now => run(`effortClock(${e}, ${now})`);
    assert.equal(c(t0 + 10_000).side, 1);
    assert.equal(c(t0 + 31_000).phase, 'switch');
    assert.equal(c(t0 + 31_000).switchLeft, 4);
    const s2 = c(t0 + 45_000);
    assert.equal(s2.phase, 'effort'); assert.equal(s2.side, 2); assert.equal(s2.left, 20);
    const end = c(t0 + 70_000);
    assert.equal(end.phase, 'done'); assert.equal(end.endAt, t0 + 65_000, '2 × 30 s + 5 s pour changer');
    assert.equal(run(`bothSides({ name: 'Gainage latéral' })`), true);
    assert.equal(run(`bothSides({ name: 'Gainage (planche)' })`), false);
    assert.equal(run(`bothSides({ name: 'Élévations latérales' })`), false, 'en répétitions : pas de chrono');
  });

  test('valeur inhabituelle : faute de frappe signalée, hausses normales et petites charges laissées', () => {
    const u = (set, ref) => run(`unusualSetValue(${JSON.stringify(set)}, ${JSON.stringify({ kind: 'charge', repMax: 12, ...ref })})`);
    assert.match(u({ reps: '180', weight: '25' }, { prevReps: 10, prevW: 25 }), /180 répétitions/);
    assert.equal(u({ reps: '40', weight: '' }, { repMax: 40 }), '', 'crunchs à 40 : haut de fourchette');
    assert.equal(u({ reps: '35', weight: '' }, { doneReps: [35] }), '', 'déjà fait dans la séance');
    assert.match(u({ reps: '10', weight: '275' }, { prevW: 25 }), /d'habitude/);
    assert.equal(u({ reps: '10', weight: '7' }, { prevW: 4 }), '', 'haltères de 4 à 7 kg');
    assert.equal(u({ reps: '10', weight: '120' }, { prevW: 100, doneW: [] }), '', '+20 kg sur 100 : hausse normale');
    assert.equal(u({ reps: '10', weight: '15' }, { kind: 'lest', prevW: 2.5 }), '', 'lest : pas de règle de charge');
    assert.equal(u({ reps: '10', weight: '80' }, {}), '', 'première fois : rien à comparer');
  });

  test('objectif d\'une série jamais faite : haut de fourchette, durée et cardio par défaut', () => {
    reset();
    const g = (m, r) => run(`defaultGoal('${m}', ${JSON.stringify(r)})`);
    assert.equal(g('reps', undefined), 12, 'sans réglage : 12');
    assert.equal(g('reps', 8), 8, 'haut de fourchette du programme');
    assert.equal(g('reps', '15'), 15);
    assert.equal(g('reps', 0), 12, 'valeur hors bornes ignorée');
    assert.equal(g('reps', 250), 12);
    assert.equal(g('time', 8), 30, 'maintien : 30 s, la fourchette de reps ne compte pas');
    assert.equal(g('cardio', undefined), 20);
    for (const m of ['reps', 'time', 'cardio']) {
      assert.ok(run(`num(defaultGoal('${m}'), 1, MEASURES.${m}.max, true)`) !== null, `${m} : objectif accepté par la validation`);
    }
  });
}
