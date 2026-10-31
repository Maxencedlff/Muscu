// Strava côté app (js/data/strava.js) : séance envoyable, type d'activité, description (jamais les notes ni
// le poids), corps envoyé à strava-export (accepté par la validation du serveur), état nettoyé.
import path from 'node:path';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const NOW = Date.now();
  const MIN = 60_000;
  const session = (over = {}) => ({
    id: 'abc12345', programme: 'ppl', category: 'push', date: NOW - 3600_000, duration: 52 * MIN,
    notes: 'genou sensible, note privée', bodyKg: 81.5,
    exercises: [
      { exId: 'p1', name: 'Développé couché', sets: [{ weight: '40', reps: '8', warmup: true }, { weight: '80', reps: '8', rir: 2 }, { weight: '80', reps: '7' }] },
      { exId: 'p2', name: 'Dips', sets: [{ weight: '', reps: '12' }, { weight: '', reps: '' }] },
      { exId: 'p3', name: 'Élévations latérales', sets: [{ weight: '8', reps: '' }] },
    ],
    ...over,
  });
  const cardio = (name, sets) => ({ name, measure: 'cardio', sets });
  const call = (fn, h, extra = '') => run(`${fn}(${JSON.stringify(h)}${extra})`);

  test('strava : séance envoyable (terminée dans l\'app, une série faite, pas Santé, moins de 400 jours)', () => {
    reset();
    assert.equal(call('stravaExportable', session()), true);
    assert.equal(call('stravaExportable', session({ duration: undefined })), false, 'séance passée sans durée');
    assert.equal(call('stravaExportable', session({ duration: 30_000 })), false, 'moins d\'une minute');
    assert.equal(call('stravaExportable', session({ id: 'hk:ABC-123' })), false, 'sortie lue dans Santé');
    assert.equal(call('stravaExportable', session({ id: 'a b' })), false);
    assert.equal(call('stravaExportable', session({ date: NOW - 401 * 86400_000 })), false);
    assert.equal(call('stravaExportable', session({ exercises: [{ name: 'Squat', sets: [{ weight: '100', reps: '' }] }] })), false, 'aucune série faite');
    assert.equal(call('stravaExportable', session({ exercises: [{ name: 'Squat', sets: [{ weight: '60', reps: '5', warmup: true }] }] })), false, 'échauffement seul');
    assert.equal(run('stravaExportable(null)'), false);
  });

  test('strava : type d\'activité (musculation, cardio d\'un seul type, mélange, machines)', () => {
    reset();
    sameJSON(call('stravaSport', session()), { sport_type: 'WeightTraining' });
    sameJSON(call('stravaSport', session({ exercises: [session().exercises[0], cardio('Tapis de course', [{ weight: '', reps: '15', dist: '2' }])] })), { sport_type: 'WeightTraining' }, 'musculation et cardio');
    sameJSON(call('stravaSport', session({ exercises: [cardio('Course à pied', [{ weight: '', reps: '30', dist: '5.2' }, { weight: '', reps: '20', dist: '3,1' }])] })),
      { sport_type: 'Run', distance: 5200 + 3000 }, 'dist en virgule ignorée par parseFloat : 3');
    sameJSON(call('stravaSport', session({ exercises: [cardio('Tapis de course', [{ weight: '', reps: '30', dist: '6' }])] })), { sport_type: 'Run', distance: 6000, trainer: true });
    sameJSON(call('stravaSport', session({ exercises: [cardio('Trail', [{ weight: '', reps: '60', dist: '9.5' }])] })), { sport_type: 'TrailRun', distance: 9500 });
    sameJSON(call('stravaSport', session({ exercises: [cardio('Vélo d\'appartement', [{ weight: '', reps: '40' }])] })), { sport_type: 'Ride', trainer: true });
    sameJSON(call('stravaSport', session({ exercises: [cardio('Rameur', [{ weight: '', reps: '20', dist: '5' }])] })), { sport_type: 'Rowing', distance: 5000, trainer: true });
    sameJSON(call('stravaSport', session({ exercises: [cardio('Vélo elliptique', [{ weight: '', reps: '20', dist: '4' }])] })), { sport_type: 'Elliptical', trainer: true }, 'pas de distance d\'elliptique');
    sameJSON(call('stravaSport', session({ exercises: [cardio('Escaliers', [{ weight: '', reps: '15' }])] })), { sport_type: 'StairStepper', trainer: true });
    sameJSON(call('stravaSport', session({ exercises: [cardio('Marche rapide', [{ weight: '', reps: '45', dist: '4' }])] })), { sport_type: 'Walk', distance: 4000 });
    sameJSON(call('stravaSport', session({ exercises: [cardio('Corde à sauter', [{ weight: '', reps: '10' }])] })), { sport_type: 'Workout' });
    sameJSON(call('stravaSport', session({ exercises: [cardio('Course à pied', [{ weight: '', reps: '20', dist: '4' }]), cardio('Vélo', [{ weight: '', reps: '30', dist: '12' }])] })), { sport_type: 'Workout' }, 'course puis vélo');
    // Cardio inconnu de la bibliothèque : famille de l'allure
    sameJSON(call('stravaSport', session({ exercises: [cardio('Footing du dimanche', [{ weight: '', reps: '30', dist: '5' }])] })), { sport_type: 'Run', distance: 5000 });
    // Exercice cardio sans série faite : ne compte pas
    sameJSON(call('stravaSport', session({ exercises: [cardio('Course à pied', [{ weight: '', reps: '30', dist: '5' }]), cardio('Vélo', [{ weight: '', reps: '' }])] })), { sport_type: 'Run', distance: 5000 });
  });

  test('strava : description (séries faites, unité de la personne, jamais les notes ni le poids ni le RIR)', () => {
    reset();
    const d = call('stravaDescription', session());
    const lines = d.split('\n');
    assert.equal(lines[0], '52 min · 3 séries · 1,2 t', 'volume sans le poids du corps (Dips : rien)');
    assert.equal(lines[2], 'Développé couché : 80 kg × 8 · 7');
    assert.equal(lines[3], 'Dips : 12 reps');
    assert.equal(lines.length, 6, 'exercice sans série faite absent');
    assert.equal(lines.at(-1), 'Enregistré avec MDLF Training');
    for (const secret of ['genou', '81', 'RIR', 'RPE', '40 kg']) assert.ok(!d.includes(secret), `${secret} dans la description`);
    run('data.unit = "lbs"');
    assert.match(call('stravaDescription', session()), /Développé couché : 176,4 lbs × 8 · 7/);
    reset();
    // Très longue séance : coupée avant la limite du serveur
    const many = Array.from({ length: 80 }, (_, i) => ({ name: 'Exercice au nom assez long numéro ' + i, sets: Array.from({ length: 6 }, () => ({ weight: '22.5', reps: '12' })) }));
    const long = call('stravaDescription', session({ exercises: many }));
    assert.ok([...long].length <= 1900, `${[...long].length} caractères`);
    assert.ok(long.includes('\n…\n'));
  });

  test('strava : corps envoyé à strava-export, accepté tel quel par le serveur', async () => {
    reset();
    const { validateExport } = await import(path.join(ROOT, 'supabase/functions/_shared/strava-policy.js'));
    const h = session({ date: new Date(2026, 9, 31, 18, 52, 30).getTime() });
    const body = run(`stravaActivity(${JSON.stringify(h)}, ${h.date})`);
    assert.equal(body.session_id, 'abc12345');
    assert.equal(body.name, 'Push');
    assert.equal(body.sport_type, 'WeightTraining');
    assert.equal(body.start_date_local, '2026-10-31T18:00:30', 'début = fin − durée, heure locale sans fuseau');
    assert.equal(body.elapsed_time, 52 * 60);
    assert.ok(!JSON.stringify(body).includes('note privée'));
    assert.equal(validateExport(JSON.parse(JSON.stringify(body)), h.date).ok, true);
    const ride = run(`stravaActivity(${JSON.stringify(session({ exercises: [cardio('Vélo', [{ weight: '', reps: '75', dist: '32.4' }])] }))})`);
    const v = validateExport(JSON.parse(JSON.stringify(ride)));
    assert.equal(v.ok, true);
    sameJSON([v.fields.sport_type, v.fields.distance, v.fields.trainer], ['Ride', '32400', undefined]);
    // Séance oubliée (chrono resté ouvert) : durée ramenée à 24 h, comme le serveur l'accepte
    assert.equal(run(`stravaActivity(${JSON.stringify(session({ duration: 30 * 3600_000 }))}).elapsed_time`), 86400);
    assert.equal(run(`stravaActivity(${JSON.stringify(session({ duration: 0 }))})`), null);
  });

  test('strava : état du serveur nettoyé (activités en texte, rien sans liaison)', () => {
    reset();
    const st = run(`cleanStravaStatus({ connected: true, athlete_name: ' Léa ', can_write: true, exports: [
      { session_id: 'abc12345', activity_id: '12345678901234567' }, { session_id: 'a b', activity_id: '1' },
      { session_id: 'x1', activity_id: 'javascript:alert(1)' }, { session_id: 'x2', activity_id: 0 }, null], token: 'faux-jeton' })`);
    sameJSON(st, { connected: true, name: 'Léa', canWrite: true, exports: { abc12345: '12345678901234567' } });
    sameJSON(run('cleanStravaStatus({ connected: false, athlete_name: "x", can_write: true, exports: [{ session_id: "a", activity_id: "1" }] })'),
      { connected: false, name: null, canWrite: false, exports: {} });
    sameJSON(run('cleanStravaStatus(null)'), { connected: false, name: null, canWrite: false, exports: {} });
    assert.equal(run('stravaActivityUrl("12345678901234567")'), 'https://www.strava.com/activities/12345678901234567');
    assert.equal(run('stravaActivityUrl("../settings")'), null);
    assert.equal(run('stravaActivityUrl(null)'), null);
  });

  test('strava : erreurs des fonctions traduites, cache effacé à la déconnexion du compte', () => {
    reset();
    assert.equal(run('stravaErrorKind(new TypeError("Failed to fetch"), 0, null)'), 'offline');
    assert.equal(run('stravaErrorKind({}, 409, { error: "not_connected" })'), 'not_connected');
    assert.equal(run('stravaErrorKind({}, 503, { error: "strava_busy" })'), 'strava_busy');
    assert.equal(run('stravaErrorKind({}, 429, {})'), 'rate_limited');
    assert.equal(run('stravaErrorKind({}, 500, { error: "<b>" })'), 'server');
    assert.ok(run('Object.keys(STRAVA_ERROR_TEXT).every(k => STRAVA_ERROR_TEXT[k] && !STRAVA_ERROR_TEXT[k].includes("undefined"))'));
    assert.ok(run('CROSS_USER_CACHE_KEYS.includes(STRAVA_CACHE_KEY)'), 'mdlf_strava vidé avec les autres caches du compte');
    // Cache d'un autre compte : jamais relu
    run(`localStorage.setItem(STRAVA_CACHE_KEY, JSON.stringify({ userId: 'u1', connected: true, name: 'Léa', canWrite: true, exports: { s1: '9' } }))`);
    sameJSON(run('stravaCacheRead("u1")'), { connected: true, name: 'Léa', canWrite: true, exports: { s1: '9' } });
    assert.equal(run('stravaCacheRead("u2")'), null);
  });
}
