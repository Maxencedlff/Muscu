// ═══════════════════════════════════════════════════════════
//  Santé détaillée : découpage d'une séance en entraînements (js/data/health-export.js) et
//  sommeil (js/data/health-sleep.js). Lancés par tests/unit/run.mjs.
// ═══════════════════════════════════════════════════════════
export default function ({ test, run, reset, assert, sameJSON }) {
  const MIN = 60_000;
  const T0 = new Date(2026, 9, 31, 18, 0).getTime();   // séance de 18 h 00 à 19 h 00
  const plan = (h, opts = { kg: 70 }) => run(`healthWorkoutPlan(${JSON.stringify(h)}, ${JSON.stringify(opts)})`);
  const strength = { name: 'Squat', sets: [{ weight: '100', reps: '5' }, { weight: '100', reps: '5' }] };
  const session = (exercises, o = {}) => ({ id: 's1', date: T0 + 60 * MIN, duration: 60 * MIN, exercises, ...o });
  // Série de machine faite au chrono : départ à T0 + startMin, durée sec, réglages facultatifs
  const machineSet = (startMin, sec, extra = {}, dist = '') => ({ weight: '', reps: String(Math.round(sec / 60)), ...(dist ? { dist } : {}),
    machine: { end: sec, at: T0 + startMin * MIN, ...extra } });

  test('santé détaillée : musculation seule, durée exacte, énergie nette', () => {
    reset();
    const p = plan(session([strength]));
    sameJSON(p, [{ activity: 'traditionalStrengthTraining', start: T0, end: T0 + 60 * MIN, pauses: [], kcal: 280, km: 0, indoor: true, part: 0 }]);
    assert.equal(plan(session([strength]), { kg: null })[0].kcal, 0, 'sans poids : aucune énergie inventée');
    sameJSON(plan(session([{ name: 'Squat', sets: [{ weight: '40', reps: '5', warmup: true }] }])), [], 'échauffement seul : rien à écrire');
  });

  test('santé détaillée : tapis au milieu → course à son heure, musculation en pause pendant ce temps', () => {
    reset();
    const tapis = { name: 'Tapis de course', sets: [machineSet(20, 600, { speed: [[0, 10, 'kmh']], incl: [[0, 1, 'pct']] }, '1.6')] };
    const p = plan(session([strength, tapis]));
    assert.equal(p.length, 2);
    sameJSON(p[0], { activity: 'traditionalStrengthTraining', start: T0, end: T0 + 60 * MIN, pauses: [[T0 + 20 * MIN, T0 + 30 * MIN]],
      kcal: 233, km: 0, indoor: true, part: 0 }, 'musculation : 50 min actives × 4 MET × 70 kg');
    // ACSM course : VO2 = 3,5 + 0,2 × 166,7 + 0,9 × 166,7 × 0,01 = 38,33 ml/kg/min → 10,95 MET ; net 9,95 × 70 kg × 10 min
    sameJSON(p[1], { activity: 'running', start: T0 + 20 * MIN, end: T0 + 30 * MIN, kcal: 116, km: 1.6, pauses: [], indoor: true, part: 1 });
  });

  test('santé détaillée : tapis lent → marche ; vitesse tirée de la distance sans réglage noté', () => {
    reset();
    // 0,5 km en 6 min = 5 km/h, aucune vitesse notée : marche (ACSM marche, à plat : 3,5 + 0,1 × 83,3 = 11,83 → 3,38 MET)
    const p = plan(session([strength, { name: 'Tapis de course', sets: [machineSet(50, 360, {}, '0.5')] }]));
    assert.equal(p[1].activity, 'walking');
    assert.equal(p[1].kcal, Math.round((11.8333 / 3.5 - 1) * 70 * 0.1));
    // Ni vitesse ni distance : course par défaut, sans énergie
    const q = plan(session([strength, { name: 'Tapis de course', sets: [machineSet(50, 360)] }]));
    sameJSON([q[1].activity, q[1].kcal, q[1].km], ['running', 0, 0]);
  });

  test('santé détaillée : cardio au début → la musculation commence après (pas de pause au bord)', () => {
    reset();
    const p = plan(session([{ name: 'Vélo d\'appartement', sets: [machineSet(0, 900, {}, '6')] }, strength]));
    sameJSON(p.map(w => [w.activity, (w.start - T0) / MIN, (w.end - T0) / MIN, w.pauses.length]),
      [['cycling', 0, 15, 0], ['traditionalStrengthTraining', 15, 60, 0]]);
    assert.equal(p[0].kcal, Math.round(6 * 70 * 0.25), 'vélo d\'appartement : 7 MET (Compendium 02010)');
    assert.equal(p[0].km, 6);
  });

  test('santé détaillée : deux séries de rameur rapprochées → un seul entraînement, en pause entre les deux', () => {
    reset();
    const rameur = { name: 'Rameur', sets: [machineSet(10, 300, {}, '1'), machineSet(16, 300, {}, '1.1')] };
    const p = plan(session([strength, rameur]));
    const row = p.find(w => w.activity === 'rowing');
    sameJSON([(row.start - T0) / MIN, (row.end - T0) / MIN, row.pauses.map(([a, b]) => [(a - T0) / MIN, (b - T0) / MIN]), row.km],
      [10, 21, [[15, 16]], 2.1]);
    const st = p.find(w => w.activity === 'traditionalStrengthTraining');
    sameJSON(st.pauses.map(([a, b]) => [(a - T0) / MIN, (b - T0) / MIN]), [[10, 21]], 'la musculation ne reprend qu\'après la dernière série');
  });

  test('santé détaillée : chronos qui se chevauchent, bloc trop court, cardio sans heure : laissés dans la musculation', () => {
    reset();
    const p = plan(session([strength,
      { name: 'Vélo elliptique', sets: [machineSet(10, 600)] },
      { name: 'Escaliers', sets: [machineSet(15, 600)] },      // commence pendant l'elliptique
      { name: 'Rameur', sets: [machineSet(40, 30)] },          // 30 s : pas un entraînement
      { name: 'Vélo d\'appartement', sets: [{ weight: '', reps: '10' }] }]));   // saisi à la main
    sameJSON(p.map(w => w.activity), ['traditionalStrengthTraining', 'elliptical']);
    assert.equal(p[1].kcal, Math.round(4 * 70 * (10 / 60)), 'elliptique : 5 MET (Compendium 02048)');
  });

  test('santé détaillée : chrono hors de la séance (ancienne heure) ignoré', () => {
    reset();
    const p = plan(session([strength, { name: 'Rameur', sets: [machineSet(-300, 600)] }]));
    sameJSON(p.map(w => w.activity), ['traditionalStrengthTraining']);
    assert.equal(p[0].kcal, 280);
  });

  test('santé détaillée : séance saisie après coup', () => {
    reset();
    // Cardio seul : séries bout à bout depuis l'heure de la séance
    const cardio = { id: 'p', date: T0, exercises: [{ name: 'Escaliers', sets: [{ weight: '', reps: '20' }] }, { name: 'Rameur', sets: [{ weight: '', reps: '10', dist: '2' }] }] };
    sameJSON(plan(cardio, { kg: 70, typicalMs: 50 * MIN }).map(w => [w.activity, (w.start - T0) / MIN, (w.end - T0) / MIN, w.km]),
      [['stairClimbing', 0, 20, 0], ['rowing', 20, 30, 2]]);
    // Avec de la musculation : un seul entraînement de la durée habituelle
    const mixed = { ...cardio, exercises: [...cardio.exercises, strength] };
    sameJSON(plan(mixed, { kg: 70, typicalMs: 50 * MIN }).map(w => [w.activity, (w.end - w.start) / MIN]), [['traditionalStrengthTraining', 50]]);
  });

  test('santé détaillée : séance toute en cardio au chrono → pas de « Musculation » vide', () => {
    reset();
    const p = plan(session([{ name: 'Tapis de course', sets: [machineSet(0, 3570, { speed: [[0, 9, 'kmh']] })] }]));
    sameJSON(p.map(w => w.activity), ['running']);
  });

  test('machine : heure de départ du chrono gardée si plausible', () => {
    reset();
    assert.equal(run(`cleanMachine({ end: 600, at: ${T0} }).at`), T0);
    assert.equal(run(`'at' in cleanMachine({ end: 600, at: 12 })`), false, 'date de 1970 : oubliée');
    assert.equal(run(`'at' in cleanMachine({ end: 600, at: 'hier' })`), false);
    assert.equal(run(`'at' in cleanMachine({ end: 600 })`), false);
  });

  // ── Sommeil ───────────────────────────────────────────────
  const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
  const sum = (samples, now) => run(`sleepSummary(${JSON.stringify(samples)}, ${now})`);

  test('sommeil : union des sources (Apple Watch et une app), éveils et temps au lit écartés', () => {
    reset();
    const night = [
      { start: at(30, 23), end: at(31, 7), stage: 'inBed' },
      { start: at(30, 23, 15), end: at(31, 2), stage: 'core' },
      { start: at(31, 2), end: at(31, 2, 20), stage: 'awake' },
      { start: at(31, 2, 20), end: at(31, 6, 30), stage: 'deep' },
      { start: at(30, 23, 30), end: at(31, 6, 30), stage: 'asleep' },   // même nuit vue par une autre app
    ];
    const s = sum(night, at(31, 10));
    assert.equal(s.ms, at(31, 6, 30) - at(30, 23, 15), 'de 23 h 15 à 6 h 30, sans compter deux fois');
    assert.equal(s.inBedOnly, false);
    assert.equal(s.avgMs, null, 'moyenne seulement à partir de 3 nuits');
    assert.equal(run(`sleepLine(${JSON.stringify(s)})`), 'Cette nuit : 7 h 15 de sommeil');
  });

  test('sommeil : iPhone seul (temps au lit), nuit d\'hier ignorée, moyenne sur 7 nuits', () => {
    reset();
    const inBed = [{ start: at(30, 23), end: at(31, 7), stage: 'inBed' }];
    const s = sum(inBed, at(31, 9));
    assert.equal(s.inBedOnly, true);
    assert.match(run(`sleepLine(${JSON.stringify(s)})`), /8 h 00 au lit/);
    assert.equal(sum(inBed, at(31, 9) + 86_400_000), null, 'le lendemain : plus rien (pas de vieille nuit)');
    const week = [];
    for (let d = 22; d <= 31; d++) week.push({ start: at(d - 1, 23), end: at(d, d === 31 ? 6 : 7), stage: 'asleep' });
    const w = sum(week, at(31, 12));
    assert.equal(w.ms, 7 * 3_600_000);
    assert.equal(w.nights, 7);
    // Les 7 dernières nuits, celle-ci comprise (durées réelles : la nuit du 25/10 a une heure de plus, changement d'heure)
    const last7 = week.slice(-7).reduce((a, x) => a + (x.end - x.start), 0) / 7;
    assert.equal(w.avgMs, Math.round(last7));
    assert.match(run(`sleepLine(${JSON.stringify(w)})`), /moyenne \d\u00a0h\u00a0\d\d sur 7 nuits$/);
  });

  test('sommeil : nuit du jour du réveil, siestes et données aberrantes écartées', () => {
    reset();
    assert.equal(run(`sleepNightKey(${at(30, 23, 59)})`), '2026-10-31', 'endormi avant minuit : nuit du lendemain');
    assert.equal(run(`sleepNightKey(${at(31, 7)})`), '2026-10-31');
    sameJSON(run(`sleepNights([{ start: ${at(31, 14)}, end: ${at(31, 14, 20)}, stage: 'asleep' }])`), {}, 'sieste de 20 min');
    sameJSON(run(`sleepNights([{ start: ${at(29, 12)}, end: ${at(31, 7)}, stage: 'asleep' }])`), {}, '43 h : montre oubliée');
    sameJSON(run(`sleepNights([null, { start: 'x', end: 2 }, { start: 5, end: 1, stage: 'core' }])`), {});
  });
}
