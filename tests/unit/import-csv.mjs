// ═══════════════════════════════════════════════════════════
//  Import depuis Hevy et Strong (js/data/import-csv.js) : CSV, dates, formats, correspondance des
//  noms, conversion, unités, dédoublonnage, fusion, synchro
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, app, sameJSON, ROOT }) {
  const HEVY   = fs.readFileSync(path.join(ROOT, 'tests/donnees/hevy_exemple.csv'), 'utf8');
  const STRONG = fs.readFileSync(path.join(ROOT, 'tests/donnees/strong_exemple.csv'), 'utf8');
  const call = (expr, vars = {}) => run(`(() => { ${Object.entries(vars).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join(' ')} return ${expr}; })()`);
  const local = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

  // ── CSV ──
  test('parseCsv : guillemets, guillemets doublés, retours à la ligne dans un champ, BOM, CRLF, point-virgule', () => {
    const r = call('parseCsv(t)', { t: '﻿a,b,c\r\n1,"x, y","ligne 1\nligne 2"\r\n2,"dit ""oui""",\r\n\r\n' });
    sameJSON(r.header, ['a', 'b', 'c']);
    sameJSON(r.rows, [['1', 'x, y', 'ligne 1\nligne 2'], ['2', 'dit "oui"', '']]);
    assert.equal(r.delimiter, ',');
    const s = call('parseCsv(t)', { t: '"Workout #";"Date";"Weight (kg)"\n"1";"2026-03-02 07:05:00";"61,5"\n' });
    assert.equal(s.delimiter, ';');
    sameJSON(s.rows, [['1', '2026-03-02 07:05:00', '61,5']]);
    const big = call('parseCsv(t, 3)', { t: 'a\n1\n2\n3\n4\n5\n' });
    assert.equal(big.rows.length, 3, 'nombre de lignes borné');
  });

  test('detectCsvFormat : Hevy, Strong (iPhone, ancien, 6.2), inconnu', () => {
    assert.equal(call('detectCsvFormat(h)', { h: ['title', 'start_time', 'end_time', 'description', 'exercise_title', 'superset_id', 'exercise_notes', 'set_index', 'set_type', 'weight_lbs', 'reps', 'distance_miles', 'duration_seconds', 'rpe'] }), 'hevy');
    assert.equal(call('detectCsvFormat(h)', { h: ['Date', 'Workout Name', 'Duration', 'Exercise Name', 'Set Order', 'Weight', 'Reps', 'Distance', 'Seconds', 'Notes', 'Workout Notes', 'RPE'] }), 'strong');
    assert.equal(call('detectCsvFormat(h)', { h: ['Date', 'Workout Name', 'Exercise Name', 'Set Order', 'Weight', 'Reps', 'Distance', 'Seconds', 'Notes', 'Workout Notes', 'RPE', 'Workout Duration'] }), 'strong');
    assert.equal(call('detectCsvFormat(h)', { h: ['Workout #', 'Date', 'Workout Name', 'Duration (sec)', 'Exercise Name', 'Set Order', 'Weight (kg)', 'Reps', 'RPE', 'Distance (meters)', 'Seconds', 'Notes', 'Workout Notes'] }), 'strong');
    assert.equal(call('detectCsvFormat(h)', { h: ['date', 'weight_kg', 'fat_percent'] }), null, 'mesures Hevy : pas des séances');
    assert.equal(call('detectCsvFormat(h)', { h: [] }), null);
  });

  // ── Dates et durées ──
  test('parseHevyDate : « 6 Sep 2026, 18:00 », jour à deux chiffres, mois en français, mois en chiffres, ISO ; illisible → null', () => {
    assert.equal(app.parseHevyDate('6 Sep 2026, 18:00'), local(2026, 9, 6, 18, 0));
    assert.equal(app.parseHevyDate('01 Jan 2025, 07:30'), local(2025, 1, 1, 7, 30));
    assert.equal(app.parseHevyDate('28 Mar 2025, 17:29'), local(2025, 3, 28, 17, 29));
    assert.equal(app.parseHevyDate('6 sept. 2026, 18:00'), local(2026, 9, 6, 18, 0), 'app en français');
    assert.equal(app.parseHevyDate('6 févr. 2026, 08:05'), local(2026, 2, 6, 8, 5));
    assert.equal(app.parseHevyDate('6 Sept. 2026, 18:00'), local(2026, 9, 6, 18, 0), 'app en allemand');
    assert.equal(app.parseHevyDate('6 9月 2026, 18:00'), local(2026, 9, 6, 18, 0), 'app en japonais');
    assert.equal(app.parseHevyDate('Sep 6, 2026, 18:00'), local(2026, 9, 6, 18, 0));
    assert.equal(app.parseHevyDate('2026-09-06 18:00:00'), local(2026, 9, 6, 18, 0));
    assert.equal(app.parseHevyDate('2026-09-06T16:00:00Z'), Date.UTC(2026, 8, 6, 16), 'fuseau donné : instant exact');
    assert.equal(app.parseHevyDate('6 Xyz 2026, 18:00'), null);
    assert.equal(app.parseHevyDate('32 Jan 2026, 18:00'), null);
    assert.equal(app.parseHevyDate(''), null);
    assert.equal(app.parseHevyDate(null), null);
  });

  test('parseLocalDateTime / parseStrongDuration : formats de Strong', () => {
    assert.equal(app.parseLocalDateTime('2026-03-02 07:05:00'), local(2026, 3, 2, 7, 5));
    assert.equal(app.parseLocalDateTime('2026-03-02'), local(2026, 3, 2));
    assert.equal(app.parseLocalDateTime('02/03/2026'), null);
    const t0 = Date.now();
    assert.equal(app.parseStrongDuration('1h' + ' '.repeat(50000) + 'x'), null, 'cellule énorme refusée');
    assert.equal(app.parseHevyDate('6' + ' '.repeat(50000) + 'x'), null);
    assert.ok(Date.now() - t0 < 200, 'sans retour arrière coûteux');
    assert.equal(app.parseStrongDuration('1h 5m'), 65 * 60000);
    assert.equal(app.parseStrongDuration('45m'), 45 * 60000);
    assert.equal(app.parseStrongDuration('2h'), 120 * 60000);
    assert.equal(app.parseStrongDuration('1:05'), 65 * 60000, 'h:mm');
    assert.equal(app.parseStrongDuration('1:05:30'), 65 * 60000 + 30000);
    assert.equal(app.parseStrongDuration('3900'), 3900 * 1000, 'secondes (Workout Duration, Duration (sec))');
    assert.equal(app.parseStrongDuration(''), null);
    assert.equal(app.parseStrongDuration('abc'), null);
    assert.equal(app.parseStrongDuration('999999999'), null, 'au-delà de 24 h : ignorée');
  });

  // ── Correspondance des noms ──
  test('matchImportedExercise : « Mouvement (Matériel) » retrouvé dans la bibliothèque, matériel spécifique respecté', () => {
    const m = n => app.matchImportedExercise(n);
    assert.equal(m('Bench Press (Barbell)'), 'Développé couché barre', 'Bench Press (Barbell)');
    assert.equal(m('Bench Press (Dumbbell)'), 'Développé couché haltères', 'Bench Press (Dumbbell)');
    assert.equal(m('Incline Bench Press (Dumbbell)'), 'Développé incliné haltères', 'Incline Bench Press (Dumbbell)');
    assert.equal(m('Squat (Barbell)'), 'Squat barre', 'Squat (Barbell)');
    assert.equal(m('Deadlift (Barbell)'), 'Soulevé de terre', 'Deadlift (Barbell)');
    assert.equal(m('Lat Pulldown (Cable)'), 'Tirage vertical prise large', 'Lat Pulldown (Cable)');
    assert.equal(m('Leg Press (Machine)'), 'Presse à cuisses', 'Leg Press (Machine)');
    assert.equal(m('Triceps Pushdown (Cable - Straight Bar)'), 'Extension triceps poulie', 'Triceps Pushdown (Cable - Straight Bar)');
    assert.equal(m('Lateral Raise (Dumbbell)'), 'Élévations latérales', 'Lateral Raise (Dumbbell)');
    assert.equal(m('Pull Up'), 'Tractions pronation', 'Pull Up');
    assert.equal(m('Plank'), 'Gainage (planche)', 'Plank');
    assert.equal(m('Running'), 'Course à pied', 'Running');
    assert.equal(m('Bench Press (Smith Machine)'), null, 'matériel spécifique sans fiche : pas confondu avec la barre');
    assert.equal(m('Svend Press (Plate)'), null);
    // Obliques (lot 2) : vocabulaire anglais de Hevy et Strong vers les nouvelles fiches
    assert.equal(m('Cable Woodchopper'), 'Bûcheron poulie', 'Cable Woodchopper');
    assert.equal(m('Woodchopper'), 'Bûcheron poulie', 'Woodchopper');
    assert.equal(m('Wood Chop (Cable)'), 'Bûcheron poulie', 'Wood Chop (Cable)');
    assert.equal(m('Cable Twist (Up to down)'), 'Bûcheron poulie', 'Cable Twist (Up to down)');
    assert.equal(m('Pallof Press (Cable)'), 'Pallof press', 'Pallof Press (Cable)');
    assert.equal(m('Pallof Press'), 'Pallof press', 'Pallof Press');
    assert.equal(m('Side Bend (Dumbbell)'), 'Flexion latérale haltère', 'Side Bend (Dumbbell)');
    assert.equal(m('Oblique Crunch'), 'Crunch oblique', 'Oblique Crunch');
    assert.equal(m('Bicycle Crunch'), 'Crunch vélo', 'Bicycle Crunch');
    assert.equal(m('Russian Twist'), 'Rotations russes', 'Russian Twist');
    assert.equal(m(''), null);
    assert.equal(m('   (  )'), null);
  });

  test('matchImportedExercise : au moins 85 % des noms courants de Hevy et Strong reconnus', () => {
    // Noms tels que Hevy et Strong les écrivent (bibliothèques intégrées des deux apps)
    const common = ['Bench Press (Barbell)', 'Bench Press (Dumbbell)', 'Incline Bench Press (Barbell)', 'Incline Bench Press (Dumbbell)',
      'Chest Press (Machine)', 'Chest Fly (Dumbbell)', 'Cable Fly Crossovers', 'Push Up', 'Dip', 'Deadlift (Barbell)', 'Romanian Deadlift (Barbell)',
      'Sumo Deadlift (Barbell)', 'Pull Up', 'Chin Up', 'Lat Pulldown (Cable)', 'Seated Cable Row - Bar Grip', 'Seated Row (Cable)', 'Bent Over Row (Barbell)',
      'Dumbbell Row', 'T Bar Row', 'Face Pull', 'Shrug (Dumbbell)', 'Back Extension', 'Overhead Press (Barbell)', 'Shoulder Press (Dumbbell)',
      'Seated Shoulder Press (Machine)', 'Arnold Press (Dumbbell)', 'Lateral Raise (Dumbbell)', 'Lateral Raise (Cable)', 'Front Raise (Dumbbell)',
      'Rear Delt Reverse Fly (Dumbbell)', 'Upright Row (Barbell)', 'Bicep Curl (Barbell)', 'Bicep Curl (Dumbbell)', 'Hammer Curl (Dumbbell)',
      'Preacher Curl (Barbell)', 'Bicep Curl (Cable)', 'Concentration Curl', 'Triceps Pushdown', 'Triceps Rope Pushdown', 'Skullcrusher (Barbell)',
      'Triceps Extension (Cable)', 'Overhead Triceps Extension (Cable)', 'Bench Dip', 'Squat (Barbell)', 'Front Squat', 'Goblet Squat', 'Hack Squat',
      'Leg Press (Machine)', 'Lunge (Dumbbell)', 'Bulgarian Split Squat', 'Leg Extension (Machine)', 'Seated Leg Curl (Machine)', 'Lying Leg Curl (Machine)',
      'Hip Thrust (Barbell)', 'Hip Abduction (Machine)', 'Hip Adduction (Machine)', 'Standing Calf Raise (Machine)', 'Seated Calf Raise (Machine)',
      'Calf Press (Machine)', 'Crunch', 'Cable Crunch', 'Plank', 'Hanging Leg Raise', 'Hanging Knee Raise', 'Ab Wheel', 'Russian Twist', 'Running', 'Cycling',
      'Rowing Machine', 'Treadmill', 'Elliptical Machine', 'Stair Machine', 'Jump Rope', 'Walking', 'Kettlebell Swing', 'Farmers Walk', 'Good Morning (Barbell)',
      'Squat (Smith Machine)', 'Pec Deck (Machine)', 'Reverse Fly (Machine)', 'Straight Arm Lat Pulldown (Cable)', 'Glute Kickback (Machine)', 'Wrist Curl'];
    const missed = common.filter(n => !app.matchImportedExercise(n));
    const rate = (common.length - missed.length) / common.length;
    assert.ok(rate >= 0.85, `reconnus : ${Math.round(rate * 100)} % ; manqués : ${missed.join(' | ')}`);
  });

  // ── Lecture des fichiers d'essai ──
  test('readImportCsv Hevy : séances, exercices, séries, échauffements, notes, superset, cardio, durée', () => {
    const r = call('readImportCsv(t)', { t: HEVY });
    assert.equal(r.ok, true);
    assert.equal(r.format, 'hevy');
    assert.equal(r.weightUnit, 'kg');
    assert.equal(r.sessions.length, 7);
    assert.equal(r.sessions[0].title, 'Push Day');
    assert.equal(r.sessions[0].date, local(2026, 1, 14, 18, 2));
    assert.equal(r.sessions[0].duration, 69 * 60000, 'durée = fin − début');
    assert.ok(r.sessions[0].notes.startsWith('Première séance de l\'année, "en forme"'), 'guillemets doublés lus');
    assert.ok(r.sessions[0].notes.includes('Bench Press (Barbell) : Pause 1 s en bas'), 'note d\'exercice jointe aux notes');
    assert.ok(r.sessions[2].notes.includes('Genou droit un peu sensible\nÉchauffement plus long'), 'retour à la ligne dans une note');
    const bench = r.sessions[0].exercises[0];
    assert.equal(bench.raw, 'Bench Press (Barbell)');
    assert.equal(bench.sets.length, 4);
    assert.equal(bench.sets[0].warmup, true);
    assert.equal(bench.sets[1].rpe, 8);
    assert.equal(bench.sets[2].rpe, 8.5);
    assert.equal(r.sessions[0].exercises[2].ss, '1', 'superset lu');
    assert.equal(r.sessions[0].exercises[3].ss, '1');
    const plank = r.sessions[2].exercises.find(e => e.raw === 'Plank');
    sameJSON(plank.sets.map(s => [s.kind, s.seconds]), [['time', 60], ['time', 45]]);
    const run_ = r.sessions.find(s => s.title === 'Cardio').exercises[0];
    sameJSON(run_.sets.map(s => [s.kind, s.km, s.seconds]), [['cardio', 5.2, 1860], ['cardio', 1, 300]]);
    assert.equal(r.warmups, 6);
    assert.equal(r.skippedRows, 0);
    const names = Object.fromEntries(r.names.map(n => [n.raw, n.match]));
    assert.equal(names['Bench Press (Barbell)'], 'Développé couché barre');
    assert.equal(names['Svend Press (Plate)'], null);
    assert.equal(r.names[0].count >= r.names.at(-1).count, true, 'les plus fréquents d\'abord');
  });

  test('readImportCsv Strong : séances par date et nom, durée « 1h 5m », W = échauffement, distance en mètres, unité inconnue', () => {
    const r = call('readImportCsv(t)', { t: STRONG });
    assert.equal(r.ok, true);
    assert.equal(r.format, 'strong');
    assert.equal(r.weightUnit, null, 'colonne « Weight » sans unité');
    assert.equal(r.sessions.length, 6);
    assert.equal(r.sessions[0].title, 'Upper A');
    assert.equal(r.sessions[0].date, local(2026, 3, 2, 7, 5));
    assert.equal(r.sessions[0].duration, 65 * 60000);
    assert.ok(r.sessions[0].notes.startsWith('Bonne séance, un peu fatigué'));
    assert.ok(r.sessions[0].notes.includes('Bent Over Row (Barbell) : Dos bien droit'));
    assert.equal(r.sessions[0].exercises[0].sets[0].warmup, true);
    assert.equal(r.sessions[0].exercises[0].sets[1].warmup, false);
    const cardio = r.sessions.find(s => s.title === 'Cardio').exercises[0];
    sameJSON(cardio.sets.map(s => [s.kind, s.km, s.seconds]), [['cardio', 5, 1800]], '5000 → 5 km');
    const plank = r.sessions[1].exercises.find(e => e.raw === 'Plank');
    assert.equal(plank.sets[0].kind, 'time');
    assert.equal(plank.sets[0].weight, null, 'charge 0 = pas de charge');
    const chin = r.sessions[2].exercises.find(e => e.raw === 'Chin Up');
    assert.equal(chin.sets[0].weight, null);
    assert.equal(chin.sets[0].reps, 8);
  });

  test('readImportCsv Strong 6.2 : point-virgule, Workout #, Weight (kg), Duration (sec), lignes Rest Timer ignorées', () => {
    const t = ['"Workout #";"Date";"Workout Name";"Duration (sec)";"Exercise Name";"Set Order";"Weight (kg)";"Reps";"RPE";"Distance (meters)";"Seconds";"Notes";"Workout Notes"',
      '"1";"2026-03-02 07:05:00";"Upper A";"3900";"Bench Press (Barbell)";"1";"61.23492";"5";"";"";"";"";""',
      '"1";"2026-03-02 07:05:00";"Upper A";"3900";"Bench Press (Barbell)";"Rest Timer";"";"";"";"";"120.0";"";""',
      '"1";"2026-03-02 07:05:00";"Upper A";"3900";"Bench Press (Barbell)";"2";"61.23492";"5";"8";"";"";"";""',
      '"2";"2026-03-04 07:05:00";"Lower";"3000";"Squat (Barbell)";"W";"40";"8";"";"";"";"";""',
      '"2";"2026-03-04 07:05:00";"Lower";"3000";"Squat (Barbell)";"1";"100";"5";"";"";"";"";""', ''].join('\r\n');
    const r = call('readImportCsv(t)', { t });
    assert.equal(r.ok, true);
    assert.equal(r.weightUnit, 'kg');
    assert.equal(r.sessions.length, 2);
    assert.equal(r.sessions[0].duration, 3900000);
    assert.equal(r.sessions[0].exercises[0].sets.length, 2, 'Rest Timer n\'est pas une série');
    assert.equal(r.skippedRows, 1);
    assert.equal(r.sessions[0].exercises[0].sets[1].rpe, 8);
  });

  test('readImportCsv : refus propres (format inconnu, vide, trop gros, pas une chaîne)', () => {
    sameJSON(call('readImportCsv(t)', { t: 'a,b\n1,2\n' }), { ok: false, reason: 'format' });
    sameJSON(call('readImportCsv(t)', { t: 'title,start_time,exercise_title\n' }), { ok: false, reason: 'empty' });
    sameJSON(call('readImportCsv(t)', { t: 'title,start_time,exercise_title,reps\nX,pas une date,Squat,5\n' }), { ok: false, reason: 'empty' });
    sameJSON(run('readImportCsv(42)'), { ok: false, reason: 'format' });
    assert.equal(run('readImportCsv("x".repeat(IMPORT_MAX_BYTES + 1)).reason'), 'size');
    assert.equal(run('readImportCsv("title,start_time,exercise_title,reps\\n" + "<b>X</b>,6 Sep 2026\\, 18:00,Squat,5\\n").ok'), false, 'date illisible : aucune séance');
  });

  // ── Conversion et fusion ──
  test('applyImport Hevy : programme « Hevy » créé, séances, exId, mesures, charges en kg, échauffements écartés, RPE, notes', () => {
    reset();
    const r = call('applyImport(readImportCsv(t), {})', { t: HEVY });
    sameJSON(r, { added: 7, duplicates: 0, recognized: r.recognized, created: r.created, programme: 'u_hevy' });
    const names = call('readImportCsv(t).names', { t: HEVY });
    assert.equal(r.recognized + r.created, names.length);
    assert.equal(r.created, 1, `non reconnus : ${names.filter(n => !n.match).map(n => n.raw).join(' | ')}`);
    const d = run('data');
    assert.equal(d.history.length, 7);
    assert.equal(d.userProgrammes.u_hevy.name, 'Hevy');
    sameJSON(Object.values(d.userProgrammes.u_hevy.sessions).map(s => s.label), ['Push Day', 'Pull Day', 'Leg Day', 'Cardio']);
    assert.ok(d.myProgrammes.includes('u_hevy'), 'dans Mes programmes');
    assert.equal(d.activeProgramme, 'ppl', 'programme actif inchangé');
    const push = d.history.filter(h => d.userProgrammes.u_hevy.sessions[h.category].label === 'Push Day');
    assert.equal(push.length, 2);
    const first = push.at(-1);   // la plus ancienne
    assert.equal(first.date, local(2026, 1, 14, 18, 2));
    assert.equal(first.duration, 69 * 60000);
    assert.ok(first.notes.includes('Bench Press (Barbell) : Pause 1 s en bas'));
    const bench = first.exercises[0];
    assert.equal(bench.name, 'Développé couché barre');
    sameJSON(bench.sets.map(s => [s.weight, s.reps, s.rir, s.warmup]), [['80', '8', 2, undefined], ['80', '7', 2, undefined], ['80', '6', 0, undefined]], 'échauffement écarté, RPE 8 / 8,5 / 10 → RIR 2 / 2 / 0');
    assert.ok(bench.sets.every(s => !('rpe' in s)), 'pas de champ rpe séparé');
    assert.equal(bench.measure, undefined, 'répétitions : mesure non écrite');
    const progEx = d.programmes.u_hevy.exercises[first.category];
    assert.ok(progEx.some(e => e.name === 'Développé couché barre' && e.id === bench.exId), 'identifiant partagé avec le programme');
    assert.equal(progEx.find(e => e.name === 'Développé couché barre').sets, 3, 'séries de la dernière séance de ce nom');
    const lat = first.exercises.find(e => e.name === 'Élévations latérales');
    assert.equal(lat.ss, first.exercises.find(e => e.name === 'Extension triceps poulie').ss, 'superset gardé');
    assert.equal(lat.sets.length, 3, 'série dégressive gardée comme une série');
    const legs = d.history.find(h => d.userProgrammes.u_hevy.sessions[h.category].label === 'Leg Day' && h.date === local(2026, 1, 18, 10, 0));
    const plank = legs.exercises.find(e => e.name === 'Gainage (planche)');
    assert.equal(plank.measure, 'time', 'mesure écrite hors répétitions, comme storedMeasure');
    assert.equal(app.measureOf(plank), 'time');
    sameJSON(plank.sets.map(s => [s.weight, s.reps]), [['', '60'], ['', '45']]);
    const cardio = d.history.find(h => d.userProgrammes.u_hevy.sessions[h.category].label === 'Cardio').exercises[0];
    assert.equal(cardio.name, 'Course à pied');
    sameJSON(cardio.sets, [{ weight: '', reps: '31', dist: '5.2' }, { weight: '', reps: '5', dist: '1' }], 'cardio : minutes et km');
    const wood = d.history.find(h => h.exercises.some(e => e.name === 'Svend Press (Plate)'));
    assert.ok(wood, 'exercice non reconnu créé sous son nom');
    assert.ok(wood.exercises.find(e => e.name === 'Svend Press (Plate)').exId, 'avec un identifiant');
    // La donnée passe le nettoyage de l'app telle quelle
    const before = JSON.stringify(d.history);
    run('sanitizeData(data)');
    assert.equal(JSON.stringify(run('data.history')), before, 'sanitizeData ne change rien');
    assert.equal(run('data.history.every(h => /^[A-Za-z0-9_-]{1,64}$/.test(h.id) && /^[A-Za-z0-9_-]{1,40}$/.test(h.category))'), true);
  });

  test('applyImport : échauffements gardés sur demande, liens posés à la main', () => {
    reset();
    const r = call('applyImport(readImportCsv(t), { keepWarmups: true, links: { "Svend Press (Plate)": "Rotations russes", "Running": "Tapis de course", "Pull Up": "pas un exercice" } })', { t: HEVY });
    const d = run('data');
    const bench = d.history.at(-1).exercises[0];
    assert.equal(bench.sets.length, 4, 'échauffement gardé');
    assert.equal(bench.sets[0].weight, '40');
    assert.equal(bench.sets[0].warmup, true, 'échauffement gardé marqué warmup (exclu du volume et des records)');
    assert.equal(bench.sets[1].warmup, undefined);
    assert.ok(d.history.some(h => h.exercises.some(e => e.name === 'Rotations russes')), 'lien appliqué');
    assert.ok(!d.history.some(h => h.exercises.some(e => e.name === 'Svend Press (Plate)')));
    assert.ok(d.history.some(h => h.exercises.some(e => e.name === 'Tapis de course')), 'un nom reconnu peut être relié ailleurs');
    assert.ok(d.history.some(h => h.exercises.some(e => e.name === 'Tractions pronation')), 'lien vers un nom inconnu ignoré : correspondance automatique gardée');
    assert.equal(r.created, 0);
  });

  test('applyImport Strong : unité choisie quand le fichier ne la donne pas (lb → kg), durée, cardio en mètres', () => {
    reset();
    let r = call('applyImport(readImportCsv(t), { unit: "lbs" })', { t: STRONG });
    assert.equal(r.added, 6);
    assert.equal(r.programme, 'u_strong');
    let d = run('data');
    const upperA = d.history.at(-1);
    assert.equal(upperA.duration, 65 * 60000);
    assert.equal(upperA.exercises[0].name, 'Développé couché barre');
    assert.equal(upperA.exercises[0].sets[0].weight, '36.287', '80 lb → kg (3 décimales, comme storeW)');
    assert.equal(app.fmtW(upperA.exercises[0].sets[0].weight), '36,29');
    reset();
    r = call('applyImport(readImportCsv(t), { unit: "kg" })', { t: STRONG });
    d = run('data');
    assert.equal(d.history.at(-1).exercises[0].sets[0].weight, '80');
    const run_ = d.history.find(h => h.exercises[0].name === 'Tapis de course').exercises[0];
    sameJSON(run_.sets, [{ weight: '', reps: '30', dist: '5' }]);
    const chin = d.history.find(h => h.exercises.some(e => e.name === 'Tractions supination')).exercises.find(e => e.name === 'Tractions supination');
    sameJSON(chin.sets.map(s => s.weight), ['', ''], 'poids du corps : charge vide');
    reset({ unit: 'lbs' });
    r = call('applyImport(readImportCsv(t), { unit: "kg" })', { t: STRONG });
    assert.equal(run('data.history.at(-1).exercises[0].sets[0].weight'), '80', 'unité du fichier choisie, pas celle de l\'app');
  });

  test('applyImport : fichier Hevy en livres et miles converti', () => {
    reset();
    const t = ['"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"',
      '"Push","6 Sep 2026, 18:00","6 Sep 2026, 19:05","","Bench Press (Barbell)",,"",0,"warmup",95,10,,,',
      '"Push","6 Sep 2026, 18:00","6 Sep 2026, 19:05","","Bench Press (Barbell)",,"",1,"normal",175,5,,,8',
      '"Push","6 Sep 2026, 18:00","6 Sep 2026, 19:05","","Running",,"",0,"normal",,,3.1,1500,', ''].join('\n');
    const plan = call('readImportCsv(t)', { t });
    assert.equal(plan.weightUnit, 'lbs');
    call('applyImport(readImportCsv(t), { unit: "kg" })', { t });   // l'unité du fichier l'emporte
    const h = run('data.history[0]');
    assert.equal(h.exercises[0].sets[0].weight, '79.379', '175 lb → 79,379 kg');
    assert.equal(h.exercises[1].sets[0].dist, '4.989', '3,1 miles → km');
    assert.equal(h.exercises[1].sets[0].reps, '25');
  });

  test('applyImport : dédoublonnage (même fichier deux fois, séance déjà dans l\'historique), fusion sans perte', () => {
    reset();
    // Une séance de l'app existante avec un exercice de même nom : son identifiant est repris
    run(`data.history = [{ id: 'mine', programme: 'ppl', category: 'push', date: ${local(2025, 12, 1, 18, 0)}, exercises: [{ exId: 'n:squat barre', name: 'Squat barre', sets: [{ weight: '90', reps: '5' }] }] }];`);
    const pplBench = run('data.programmes.ppl.exercises.push.find(e => /couché barre/.test(e.name))?.id');
    let r = call('applyImport(readImportCsv(t), {})', { t: HEVY });
    assert.equal(r.added, 7);
    assert.equal(run('data.history.length'), 8);
    assert.equal(run('data.history.find(h => h.id === "mine").exercises[0].sets[0].weight'), '90', 'séance existante intacte');
    const squat = run('data.history.find(h => h.exercises.some(e => e.name === "Squat barre")  && h.id !== "mine").exercises.find(e => e.name === "Squat barre")');
    assert.equal(squat.exId, run('data.programmes.ppl.exercises.legs.find(e => e.name === "Squat barre").id'), 'identifiant du programme PPL (comme resolveFreeExId) : même courbe de progrès');
    if (pplBench) assert.equal(run('data.history.find(h => h.id !== "mine" && h.exercises[0].name === "Développé couché barre").exercises[0].exId'), pplBench, 'identifiant du programme PPL repris');
    r = call('applyImport(readImportCsv(t), {})', { t: HEVY });
    sameJSON([r.added, r.duplicates], [0, 7], 'deuxième import : tout est déjà là');
    assert.equal(run('data.history.length'), 8);
    assert.equal(run('Object.keys(data.userProgrammes.u_hevy.sessions).length'), 4, 'pas de séance de programme en double');
    // Même fichier avec un échauffement en plus : même empreinte (date + exercices) → doublon
    r = call('applyImport(readImportCsv(t), { keepWarmups: true })', { t: HEVY });
    assert.equal(r.added, 0);
    // Réimport après un lien posé à la main : toujours un doublon
    reset();
    call('applyImport(readImportCsv(t), { links: { "Svend Press (Plate)": "Rotations russes" } })', { t: HEVY });
    r = call('applyImport(readImportCsv(t), {})', { t: HEVY });
    sameJSON([r.added, r.duplicates], [0, 7], 'lien posé au premier import : réimport sans doublon');
    // Un fichier qui répète une séance : comptée une fois
    const twice = HEVY + HEVY.split('\n').slice(1, 5).join('\n') + '\n';
    reset();
    r = call('applyImport(readImportCsv(t), {})', { t: twice });
    assert.equal(r.added, 7);
  });

  test('applyImport : programme Hevy supprimé (archivé) puis réimport : il revient, séances existantes gardées', () => {
    reset();
    call('applyImport(readImportCsv(t), {})', { t: HEVY });
    run('data.userProgrammes.u_hevy.archived = true; data.userProgrammes.u_hevy.sessions[Object.keys(data.userProgrammes.u_hevy.sessions)[0]].label = "Mon push";');
    const extra = HEVY.split('\n')[0] + '\n' + '"Push Day","10 Mar 2026, 18:00","10 Mar 2026, 19:00","","Bench Press (Barbell)",,"",0,"normal",90,5,,,\n';
    const r = call('applyImport(readImportCsv(t), {})', { t: extra });
    assert.equal(r.added, 1);
    assert.equal(run('data.userProgrammes.u_hevy.archived'), false);
    assert.equal(run('Object.values(data.userProgrammes.u_hevy.sessions).map(s => s.label)[0]'), 'Mon push', 'séance renommée : gardée');
  });

  test('applyImport : CSV hostile (HTML, charges et reps aberrants, nom trop long) borné et jamais interprété', () => {
    reset();
    const long = 'A'.repeat(300);
    const t = ['title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe',
      `"<script>alert(1)</script>","6 Sep 2026, 18:00","6 Sep 2026, 19:00","<img src=x onerror=alert(1)>","${long}",,"<b>",0,"normal",1e308,5,,,`,
      `"<script>alert(1)</script>","6 Sep 2026, 18:00","6 Sep 2026, 19:00","","Squat (Barbell)",,"",0,"normal",100,99999,,,99`,
      `"<script>alert(1)</script>","6 Sep 2026, 18:00","6 Sep 2026, 19:00","","Squat (Barbell)",,"",1,"normal",-5,5,,,`,
      `"<script>alert(1)</script>","6 Sep 2026, 18:00","6 Sep 2026, 19:00","","Squat (Barbell)",,"",2,"normal",100,5,,,`, ''].join('\n');
    const r = call('applyImport(readImportCsv(t), {})', { t });
    assert.equal(r.added, 1);
    const h = run('data.history[0]');
    assert.equal(h.exercises[0].name.length, 80, 'nom borné');
    sameJSON(h.exercises[0].sets, [{ weight: '', reps: '5' }], 'charge 1e308 : vidée, série gardée');
    const squat = h.exercises.find(e => e.name === 'Squat barre');
    sameJSON(squat.sets.map(s => [s.weight, s.reps, s.rir]), [['100', '4000', undefined], ['', '5', undefined], ['100', '5', undefined]], 'reps bornées à 4000, charge négative vide, RPE hors 1-10 ignoré');
    assert.equal(run('data.userProgrammes.u_hevy.sessions[data.history[0].category].label'), '<script>alert(1)</script>'.slice(0, 40), 'texte gardé tel quel, échappé à l\'affichage');
    assert.ok(h.notes.startsWith('<img'), 'notes gardées en texte');
  });

  test('applyImport : les séances importées partent sur le compte comme les autres (planSessionPush)', () => {
    reset();
    call('applyImport(readImportCsv(t), {})', { t: HEVY });
    const plan = run('planSessionPush(data.history, { pushed: {} })');
    assert.equal(plan.upserts.length, 7);
    sameJSON([...new Set(plan.upserts.map(u => u.data.label))].sort(), ['Cardio', 'Leg Day', 'Pull Day', 'Push Day'], 'nom de séance calculé pour les abonnés');
    assert.ok(plan.upserts.every(u => u.data.bodyKg === undefined));
    // Le profil (programme Hevy) part aussi : clés déjà synchronisées, aucune nouvelle clé de donnée
    const prof = run('profilePayload(data)');
    assert.ok(prof.userProgrammes.u_hevy && prof.programmes.u_hevy && prof.myProgrammes.includes('u_hevy'));
  });
}
