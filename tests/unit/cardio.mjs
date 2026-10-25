// Course et vélo : allure (js/data/measures.js), entraînements lus dans Santé (js/data/health-workouts.js),
// cache de lecture (js/features/apple-services.js) et récupération des jambes (js/features/dashboard.js)
export default function ({ test, run, reset, assert, sameJSON, nativeContext }) {
  const H = 3600_000;
  // Entraînement tel que le renvoie HealthPlugin.swift (workouts)
  const workout = (o = {}) => ({ id: 'A1', activity: 'running', start: 0, end: 27 * 60_000, duration: 27 * 60,
    km: 5.2, source: 'Apple Watch de Max', productType: 'Watch6,1', indoor: false, own: false, ...o });
  // Santé activée et lecture déjà faite (cache frais) : ce que voient l'accueil et l'historique
  const withHealth = list => run(`Native.isNative = true; data.healthOn = true;
    workoutCache = { at: Date.now(), list: ${JSON.stringify(list)}, failed: false }`);
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
    assert.equal(k('Rameur'), null);
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

  test('Santé : lecture en cache, échec gardé sans effacer la dernière liste', async () => {
    reset();
    // Module natif simulé : réponse et appels lus dans le contexte de l'app
    run(`var hkAnswer = ${JSON.stringify([workout()])}, hkCalls = [], hkReal = Native.health.workouts;
         Native.health.workouts = async days => { hkCalls.push(days); return hkAnswer; };
         Native.isNative = true; data.healthOn = true; healthAuthAsked = Promise.resolve();
         workoutCache = { at: 0, list: [], failed: false };`);
    try {
      assert.equal(await run('loadHealthWorkouts()'), true, 'première lecture : l\'écran se redessine');
      assert.equal(await run('loadHealthWorkouts()'), false, 'cache frais : pas de relecture');
      assert.equal(run('JSON.stringify(hkCalls)'), '[60]');
      run('workoutCache.at = 0; hkAnswer = null');
      assert.equal(await run('loadHealthWorkouts()'), false);
      assert.equal(run('workoutCache.failed'), true);
      assert.equal(run('workoutCache.list.length'), 1, 'dernière lecture gardée');
    } finally {
      run('Native.health.workouts = hkReal; healthAuthAsked = null');
      withoutHealth();
    }
  });

  test('native : lecture des entraînements (liste, échec, ancienne build)', async () => {
    const make = impl => nativeContext({ plugins: { MdlfHealth: { workouts: impl } } }).Native;
    sameJSON(await make(async o => ({ workouts: [{ id: 'x', days: o.days }] })).health.workouts(30), [{ id: 'x', days: 30 }]);
    assert.equal(await make(async () => { throw new Error('Santé pas prête'); }).health.workouts(), null);
    sameJSON(await make(async () => { throw Object.assign(new Error('absent'), { code: 'UNIMPLEMENTED' }); }).health.workouts(), []);
    sameJSON(await nativeContext({ native: false }).Native.health.workouts(), [], 'navigateur');
  });
}
