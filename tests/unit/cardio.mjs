// Course et vélo : allure (js/data/measures.js), entraînements lus dans Santé (js/data/health-workouts.js),
// cache de lecture (js/features/apple-services.js) et récupération des jambes (js/features/dashboard.js)
export default function ({ test, run, reset, assert, sameJSON, nativeContext }) {
  const H = 3600_000;
  // Entraînement tel que le renvoie HealthPlugin.swift (workouts)
  const workout = (o = {}) => ({ id: 'A1', activity: 'running', start: 0, end: 27 * 60_000, duration: 27 * 60,
    km: 5.2, source: 'Apple Watch de Max', productType: 'Watch6,1', indoor: false, own: false, ...o });
  // Santé activée et lecture déjà faite (cache frais) : ce que voient l'accueil et l'historique
  const withHealth = list => run(`Native.isNative = true; data.healthOn = true;
    workoutCache = { at: Date.now(), list: ${JSON.stringify(list)}, failed: false }; healthEntriesMemo = { key: null, entries: [] }`);
  const withoutHealth = () => run(`Native.isNative = false; workoutCache = { at: 0, list: [], failed: false }`);

  test('allure : famille de l\'exercice (min/km, km/h, aucune)', () => {
    reset();
    const k = n => run(`paceKind({ name: ${JSON.stringify(n)} })`);
    assert.equal(k('Course à pied'), 'pace');
    assert.equal(k('Tapis de course'), 'pace');
    assert.equal(k('Footing 5 km'), 'pace', 'nom libre');
    assert.equal(k('Trail'), 'pace');
    assert.equal(k('Marche rapide'), 'pace');
    assert.equal(k('Vélo'), 'speed');
    assert.equal(k('Vélo d\'appartement'), 'speed');
    assert.equal(k('Spinning'), 'speed', 'par alias');
    assert.equal(k('Vélo elliptique'), null, 'distance de machine : pas d\'allure');
    assert.equal(k('Rameur'), 'split', 'temps aux 500 m, comme les consoles');
    assert.equal(k('Escaliers'), null, 'marches d\'une machine : pas d\'allure');
    assert.equal(k('Développé couché barre'), null, 'hors cardio');
    assert.equal(run(`paceKind({ name: 'Sortie du dimanche', measure: 'cardio' })`), null, 'cardio inconnu : pas d\'allure inventée');
  });

  test('allure : calcul, format, bornes', () => {
    reset();
    assert.equal(run(`fmtPace(cardioPace('5', '30', 'pace'), 'pace')`), '6:00 /km');
    assert.equal(run(`fmtPace(cardioPace(5.2, 27, 'pace'), 'pace')`), '5:12 /km');
    assert.equal(run(`fmtPace(cardioPace(10, 49.99, 'pace'), 'pace')`), '5:00 /km', '4:59,9 arrondi sans « 4:60 »');
    assert.equal(run(`fmtPace(cardioPace('20', '50', 'speed'), 'speed')`), '24 km/h');
    assert.equal(run(`fmtPace(cardioPace('30.5', '60', 'speed'), 'speed')`), '30,5 km/h');
    assert.equal(run(`cardioPace('', '30', 'pace')`), null, 'sans distance');
    assert.equal(run(`cardioPace('5', '', 'pace')`), null, 'sans durée');
    assert.equal(run(`cardioPace('50', '30', 'pace')`), null, '36 s/km : faute de frappe');
    assert.equal(run(`cardioPace('5', '30', null)`), null);
    assert.equal(run(`spokenPace(cardioPace(5.2, 27, 'pace'), 'pace')`), '5 minutes 12 au kilomètre');
    assert.equal(run(`spokenPace(cardioPace(10, 49.99, 'pace'), 'pace')`), '5 minutes au kilomètre', 'même arrondi que fmtPace');
  });

  test('allure : textes des séries (séance, historique, Progrès)', () => {
    reset();
    const t = (s, kind) => run(`measureSetTxt(${JSON.stringify(s)}, 'cardio', ${JSON.stringify(kind)})`);
    assert.equal(t({ weight: '', reps: '30', dist: '5' }, 'pace'), '5 km · 30 min · 6:00 /km');
    assert.equal(t({ weight: '', reps: '60', dist: '25' }, 'speed'), '25 km · 60 min · 25 km/h');
    assert.equal(t({ weight: '', reps: '20' }, 'pace'), '20 min', 'sans distance : pas d\'allure');
    assert.equal(t({ weight: '', reps: '30', dist: '5' }, 'charge'), '5 km · 30 min', 'appel sans exercice : inchangé');
    assert.equal(run(`setTxt({ w: 0, r: 30, weight: '', reps: '30', dist: '5' }, { name: 'Course à pied' })`), '5 km · 30 min · 6:00 /km');
    assert.equal(run(`setKind({ name: 'Tractions pronation' })`), 'lest', 'hors cardio : loadKind');
  });

  test('Santé : un entraînement devient une ligne d\'historique (jamais enregistrée)', () => {
    reset();
    const e = run(`healthWorkoutEntry(${JSON.stringify(workout())})`);
    assert.equal(e.id, 'hk:A1');
    assert.equal(run(`isHealthEntry(healthWorkoutEntry(${JSON.stringify(workout())}))`), true);
    assert.equal(e.date, 27 * 60_000, 'date de fin, comme une séance chronométrée');
    assert.equal(e.duration, 27 * 60_000);
    sameJSON(e.exercises, [{ name: 'Course à pied', measure: 'cardio', sets: [{ weight: '', reps: '27', dist: '5.2' }] }]);
    assert.equal(run(`healthEntryLine(healthWorkoutEntry(${JSON.stringify(workout())}))`), '5,2 km · 27 min · 5:12 /km · Apple Watch');
    const bike = run(`healthWorkoutEntry(${JSON.stringify(workout({ activity: 'cycling', km: 0, indoor: true, productType: 'iPhone15,2', source: 'Zwift' }))})`);
    assert.equal(bike.exercises[0].name, 'Vélo d\'appartement');
    assert.equal(bike.health.title, 'Vélo d\'appartement');
    assert.equal(bike.exercises[0].sets[0].dist, undefined, 'sans distance');
    assert.equal(run(`healthEntryLine(healthWorkoutEntry(${JSON.stringify(workout({ activity: 'cycling', km: 0, source: 'Zwift', productType: '' }))}))`), '27 min · Zwift');
    // Aucune ligne de Santé n'entre dans la donnée enregistrée (copie iCloud, compte)
    withHealth([workout()]);
    assert.equal(run(`healthEntries().length`), 1);
    assert.equal(run(`data.history.length`), 0);
    assert.equal(run(`JSON.stringify(data).includes('hk:')`), false);
    withoutHealth();
    assert.equal(run(`healthEntries().length`), 0, 'Santé coupée (ou navigateur) : rien');
  });

  test('Santé : entraînements de MDLF, invalides et doublons écartés', () => {
    reset();
    const ids = list => run(`healthHistoryEntries(${JSON.stringify(list)}, data.history).map(e => e.id).join()`);
    assert.equal(ids([workout({ own: true })]), '', 'écrit par MDLF Training');
    assert.equal(ids([workout({ activity: 'traditionalStrengthTraining' })]), '', 'activité inconnue');
    assert.equal(ids([workout({ duration: 20 })]), '', 'moins d\'une minute');
    assert.equal(ids([workout({ end: -1 })]), '', 'dates incohérentes');
    // Même course de l'Apple Watch et de Strava : celle qui a une distance, puis la plus longue
    const watch  = workout({ id: 'W', km: 0, start: 0, end: 30 * 60_000, duration: 30 * 60 });
    const strava = workout({ id: 'S', km: 5.1, start: 60_000, end: 29 * 60_000, duration: 28 * 60, productType: '', source: 'Strava' });
    assert.equal(ids([watch, strava]), 'hk:S');
    assert.equal(ids([workout({ id: 'R' }), workout({ id: 'V', activity: 'cycling' })]).split(',').sort().join(), 'hk:R,hk:V', 'course et vélo au même moment : deux activités');
    assert.equal(ids([workout({ id: 'M' }), workout({ id: 'E', start: 5 * H, end: 5 * H + 20 * 60_000, duration: 20 * 60 })]), 'hk:E,hk:M', 'deux sorties le même jour');
    // Déjà notée à la main dans MDLF le même jour (course) : la ligne de Santé ferait doublon
    const day = new Date(2026, 9, 20, 18).getTime();
    run(`data.history = [{ id: 'm', date: ${day + 2 * H}, programme: 'free', category: 'free',
      exercises: [{ name: 'Course à pied', measure: 'cardio', sets: [{ weight: '', reps: '30', dist: '5' }] }] }]`);
    assert.equal(ids([workout({ id: 'D', start: day - 30 * 60_000, end: day })]), '');
    assert.equal(ids([workout({ id: 'B', activity: 'cycling', start: day - 30 * 60_000, end: day })]), 'hk:B', 'un vélo n\'est pas une course');
  });

  test('Santé : une course récente bloque la séance jambes (raison donnée)', () => {
    reset();
    const now = Date.now();
    assert.equal(run(`catStatus('legs').ready`), true, 'rien de fait');
    withHealth([workout({ start: now - 5 * H - 27 * 60_000, end: now - 5 * H })]);
    assert.equal(run(`catStatus('legs').ready`), false, 'quadriceps travaillés il y a 5 h');
    assert.match(run(`recoveryReason(catStatus('legs').by)`), /^(Quadriceps|Mollets) : (aujourd'hui|hier), Course \(Apple Watch\)$/);
    assert.equal(run(`catStatus('push').ready`), true, 'le haut du corps n\'est pas concerné');
    withoutHealth();
    assert.equal(run(`catStatus('legs').ready`), true, 'Santé coupée : plus rien');
  });

  test('Santé : sortie de moins de 20 min affichée, sans effet sur la récupération', () => {
    reset();
    const now = Date.now();
    // Trajet à vélo de 12 min détecté par l'Apple Watch il y a 2 h
    withHealth([workout({ activity: 'cycling', start: now - 2 * H - 12 * 60_000, end: now - 2 * H, duration: 12 * 60, km: 3 })]);
    assert.equal(run(`healthEntries().length`), 1, 'affichée dans l\'Historique');
    assert.equal(run(`catStatus('legs').ready`), true, 'ne bloque pas la séance jambes');
    withHealth([workout({ id: 'B20', activity: 'cycling', start: now - 2 * H - 20 * 60_000, end: now - 2 * H, duration: 20 * 60, km: 6 })]);
    assert.equal(run(`catStatus('legs').ready`), false, '20 min : comptée');
    withoutHealth();
  });

  test('récupération : un muscle travaillé en cardio est prêt au bout de 24 h, la force garde le délai', () => {
    reset();
    const now = Date.now();
    // Course de Santé il y a 5 h : prête dans 19 h, pas dans 67 h
    withHealth([workout({ start: now - 5 * H - 30 * 60_000, end: now - 5 * H, duration: 30 * 60 })]);
    const st = run(`catStatus('legs')`);
    assert.equal(st.ready, false);
    assert.ok(Math.abs(st.remaining - 19 * H) < 60_000, `reste ${st.remaining / H} h`);
    withHealth([workout({ id: 'R30', start: now - 30 * H - 30 * 60_000, end: now - 30 * H, duration: 30 * 60 })]);
    assert.equal(run(`catStatus('legs').ready`), true, 'il y a 30 h : prête');
    withoutHealth();
    // Cardio saisi dans une séance libre : même règle
    const free = (id, hoursAgo, ex) => `{ id: '${id}', date: Date.now() - ${hoursAgo} * ${H}, programme: 'free', category: 'free', exercises: [${ex}] }`;
    const runEx = `{ name: 'Course à pied', measure: 'cardio', sets: [{ weight: '', reps: '30', dist: '5' }] }`;
    const squat = `{ name: 'Squat barre', sets: [{ weight: '80', reps: '8' }] }`;
    run(`data.history = [${free('c', 30, runEx)}]`);
    assert.equal(run(`catStatus('legs').ready`), true, 'course notée il y a 30 h : prête');
    // Squat il y a 30 h, course il y a 1 h : la force fixe toujours le délai (prête dans 42 h, pas 23 h)
    run(`data.history = [${free('c', 1, runEx)}, ${free('s', 30, squat)}]`);
    const both = run(`catStatus('legs')`);
    assert.ok(Math.abs(both.remaining - 42 * H) < 60_000, `reste ${both.remaining / H} h`);
    assert.equal(both.by.entry.id, 's');
    // Délai de la séance plus court que 24 h : il reste la limite
    run(`data.history = [${free('c', 13, runEx)}]; prog().cooldowns.legs = 12`);
    assert.equal(run(`catStatus('legs').ready`), true, 'délai de 12 h');
    // Délai passé à la main, puis course : elle bloque de nouveau 24 h au plus
    run(`prog().cooldowns.legs = 72; data.history = [${free('s', 30, squat)}]; (prog().skipped ||= {}).legs = Date.now() - 2 * ${H};
         data.history.unshift(${free('c', 1, runEx)})`);
    const after = run(`catStatus('legs')`);
    assert.equal(after.by.entry.id, 'c', 'la course d\'après le délai passé compte');
    assert.ok(Math.abs(after.remaining - 23 * H) < 60_000, `reste ${after.remaining / H} h`);
  });

  test('Santé : sortie notée à la main écartée seulement si elle recouvre la séance ou dure autant', () => {
    reset();
    const ids = list => run(`healthHistoryEntries(${JSON.stringify(list)}, data.history).map(e => e.id).join()`);
    const day = new Date(2026, 9, 20, 18).getTime();
    const ride = (o = {}) => workout({ activity: 'cycling', ...o });
    const bikeEx = `{ name: 'Vélo d\\'appartement', measure: 'cardio', sets: [{ weight: '', reps: '20' }] }`;
    // Séance chronométrée de 18 h à 19 h avec 20 min de vélo d'appartement
    run(`data.history = [{ id: 'g', date: ${day + H}, duration: ${H}, programme: 'ppl', category: 'legs', exercises: [${bikeEx}] }]`);
    assert.equal(ids([ride({ id: 'T', start: day - 50 * 60_000, end: day - 38 * 60_000, duration: 12 * 60 })]), 'hk:T', 'trajet avant la séance : gardé');
    assert.equal(ids([ride({ id: 'S', start: day + 5 * 60_000, end: day + 25 * 60_000, duration: 20 * 60 })]), '', 'enregistré pendant la séance : doublon');
    // Séance saisie après coup (sans durée) : durée comparable à 30 % près
    run(`data.history = [{ id: 'a', date: ${new Date(2026, 9, 20, 12).getTime()}, programme: 'free', category: 'free', exercises: [${bikeEx}] }]`);
    assert.equal(ids([ride({ id: 'C', start: day, end: day + 24 * 60_000, duration: 24 * 60 })]), '', '24 min pour 20 notées');
    assert.equal(ids([ride({ id: 'L', start: day, end: day + 60 * 60_000, duration: 60 * 60 })]), 'hk:L', '60 min pour 20 notées : autre sortie');
  });

  // Module natif simulé : réponses et appels lus dans le contexte de l'app (hkStatus : demande des courses)
  const withFakeHealth = (status = 'unnecessary') => run(`var hkAnswer = ${JSON.stringify([workout()])}, hkCalls = [], hkAuth = [], hkStatus = '${status}';
    var hkReal = { workouts: Native.health.workouts, authorize: Native.health.authorize, requestStatus: Native.health.requestStatus };
    Native.health.workouts = async days => { hkCalls.push(days); return hkAnswer; };
    Native.health.authorize = async (o = {}) => { hkAuth.push(o.workouts !== false); if (o.workouts !== false) hkStatus = 'unnecessary'; return { available: true, workouts: true }; };
    Native.health.requestStatus = async () => hkStatus;
    Native.isNative = true; data.healthOn = true; healthAuthAsked = null; resetWorkoutsAuth();
    workoutCache = emptyWorkoutCache();`);
  const restoreHealth = () => {
    run('Object.assign(Native.health, hkReal); healthAuthAsked = null; resetWorkoutsAuth()');
    withoutHealth();
  };

  test('Santé : lecture en cache, échec gardé sans effacer la dernière liste ni relire à chaque dessin', async () => {
    reset();
    withFakeHealth();
    try {
      assert.equal(await run('loadHealthWorkouts()'), true, 'première lecture : l\'écran se redessine');
      assert.equal(await run('loadHealthWorkouts()'), false, 'cache frais : pas de relecture');
      assert.equal(run('JSON.stringify(hkCalls)'), '[60]');
      run('workoutCache.at = 0; hkAnswer = null');
      assert.equal(await run('loadHealthWorkouts()'), false);
      assert.equal(run('workoutCache.failed'), true);
      assert.equal(run('workoutCache.list.length'), 1, 'dernière lecture gardée');
      assert.equal(await run('loadHealthWorkouts()'), false);
      assert.equal(run('hkCalls.length'), 2, 'après un échec : pas de relecture avant une minute');
      run(`workoutCache.failedAt = Date.now() - 61_000; hkAnswer = ${JSON.stringify([workout(), workout({ id: 'A2' })])}`);
      assert.equal(await run('loadHealthWorkouts()'), true, 'une minute plus tard : relue');
      assert.equal(run('workoutCache.failed'), false);
      // Accueil et historique montés coup sur coup : une seule lecture native
      run('workoutCache.at = 0; hkCalls.length = 0');
      const [a, b] = await run('Promise.all([loadHealthWorkouts(), loadHealthWorkouts()])');
      assert.equal(a, b);
      assert.equal(run('hkCalls.length'), 1, 'lecture en cours partagée');
      assert.equal(run('JSON.stringify(hkAuth)'), '[]', 'la lecture ne demande aucune autorisation');
    } finally { restoreHealth(); }
  });

  test('Santé : courses et vélo jamais demandés au lancement, demandés dans Réglages', async () => {
    reset();
    withFakeHealth('shouldRequest');   // Santé activé avant la build qui lit les courses
    try {
      assert.equal(await run('loadHealthWorkouts()'), false);
      assert.equal(run('hkCalls.length'), 0, 'rien n\'est lu tant qu\'iOS ne les a jamais demandés');
      assert.equal(run('JSON.stringify(hkAuth)'), '[]', 'et rien n\'est demandé à l\'accueil');
      await run('ensureHealthAuth()');
      assert.equal(run('JSON.stringify(hkAuth)'), '[false]', 'poids et écriture seulement : aucune fenêtre pour qui a déjà répondu');
      assert.match(run('renderHealthWorkoutsCell()'), /data-action="health-workouts-auth"/, 'Réglages : ligne pour les autoriser');
      await run(`globalThis.render = () => {}; actionHandlers.get('health-workouts-auth')()`);
      assert.equal(run('JSON.stringify(hkAuth)'), '[false,true]', 'demande complète au toucher');
      assert.equal(run('hkCalls.length'), 1, 'puis lecture');
      assert.equal(run('healthEntries().length'), 1);
      assert.doesNotMatch(run('renderHealthWorkoutsCell()'), /data-action/, 'déjà demandé : simple rappel');
      assert.match(run('renderHealthWorkoutsCell()'), /20 min/);
      // Build antérieure (état inconnu) : la lecture est tentée, rien n'est affiché dans Réglages
      run(`hkStatus = 'unknown'; resetWorkoutsAuth(); workoutCache = emptyWorkoutCache(); hkCalls.length = 0`);
      assert.equal(await run('loadHealthWorkouts()'), true);
      assert.equal(run('renderHealthWorkoutsCell()'), '');
    } finally { restoreHealth(); run('delete globalThis.render'); }
  });

  test('native : lecture des entraînements (liste, échec, ancienne build)', async () => {
    const make = impl => nativeContext({ plugins: { MdlfHealth: { workouts: impl } } }).Native;
    sameJSON(await make(async o => ({ workouts: [{ id: 'x', days: o.days }] })).health.workouts(30), [{ id: 'x', days: 30 }]);
    assert.equal(await make(async () => { throw new Error('Santé pas prête'); }).health.workouts(), null);
    sameJSON(await make(async () => { throw Object.assign(new Error('absent'), { code: 'UNIMPLEMENTED' }); }).health.workouts(), []);
    sameJSON(await nativeContext({ native: false }).Native.health.workouts(), [], 'navigateur');
  });

  test('native : état de la demande d\'autorisation, demande sans les courses', async () => {
    const make = plugin => nativeContext({ plugins: { MdlfHealth: plugin } }).Native;
    assert.equal(await make({ authorizationStatus: async () => ({ available: true, request: 'shouldRequest' }) }).health.requestStatus(), 'shouldRequest');
    assert.equal(await make({ authorizationStatus: async () => { throw Object.assign(new Error('absent'), { code: 'UNIMPLEMENTED' }); } }).health.requestStatus(), 'unknown', 'ancienne build');
    assert.equal(await nativeContext({ native: false }).Native.health.requestStatus(), 'unknown', 'navigateur');
    const asked = [];
    const n = make({ requestAuthorization: async o => { asked.push(o.workouts); return { available: true, workouts: true }; } });
    await n.health.authorize({ workouts: false });
    await n.health.authorize();
    sameJSON(asked, [false, true]);
  });
}
