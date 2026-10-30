// ═══════════════════════════════════════════════════════════
//  Import depuis une autre app (Hevy, Strong) : fichiers CSV d'export
//  Logique pure, sans écran : lecture du CSV, reconnaissance du format, conversion en séances de
//  l'app, correspondance des noms avec la bibliothèque, dédoublonnage. Formats et sources dans
//  docs/IMPORT_CSV.md. Le fichier est une donnée non fiable : tout est borné et vérifié, rien n'est
//  interprété ; l'écran (js/features/import-ui.js) échappe chaque texte avant de l'afficher.
// ═══════════════════════════════════════════════════════════
'use strict';

const IMPORT_MAX_BYTES    = 25 * 1024 * 1024;   // au-delà, le fichier n'est pas lu (un export Hevy de 5 ans pèse ~2 Mo)
const IMPORT_MAX_ROWS     = 200000;             // lignes lues au plus (une par série)
const IMPORT_MAX_SESSIONS = 20000;
const IMPORT_MAX_TEXT     = 2000;               // notes d'une séance (notes de séance et d'exercices réunies)
const IMPORT_MAX_NAME     = 80;                 // nom d'exercice : même borne que les muscles déclarés (sanitizeData)
const IMPORT_MAX_LABEL    = 40;                 // nom d'une séance du programme créé
const IMPORT_MAX_DURATION = 24 * 3600000;       // durée d'une séance : au plus 24 h
const IMPORT_LBS_PER_KG   = 2.20462;            // KG_TO_LBS (accessors.js), recopié : ce fichier reste autonome dans les tests
const IMPORT_KM_PER_MILE  = 1.609344;

// ── CSV ──────────────────────────────────────────────────────
// RFC 4180 : champs entre guillemets (doublés pour un guillemet littéral), retours à la ligne dans
// un champ cité (notes), CRLF ou LF, marque d'ordre des octets UTF-8 ignorée. Séparateur deviné sur
// la ligne d'en-tête : virgule (Hevy, Strong iPhone) ou point-virgule (Strong 6.2, Excel français).
// Renvoie { header: [texte…], rows: [[texte…]…], delimiter } ; les lignes vides sont ignorées.
function parseCsv(text, maxRows = IMPORT_MAX_ROWS) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const firstLine = s.slice(0, s.indexOf('\n') < 0 ? s.length : s.indexOf('\n'));
  const delimiter = countOutsideQuotes(firstLine, ';') > countOutsideQuotes(firstLine, ',') ? ';' : ',';
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  while (i < s.length && rows.length <= maxRows) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === delimiter) { endField(); i++; continue; }
    if (c === '\n') { endRow(); i++; continue; }
    if (c === '\r') { i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) endRow();
  const header = (rows.shift() || []).map(h => h.trim());
  return { header, rows: rows.slice(0, maxRows), delimiter };
}
function countOutsideQuotes(line, ch) {
  let n = 0, q = false;
  for (const c of line) { if (c === '"') q = !q; else if (c === ch && !q) n++; }
  return n;
}

// En-tête comparable : minuscules, sans guillemets ni espaces en trop (« Weight (kg) » → « weight (kg) »)
const csvKey = h => String(h ?? '').toLowerCase().replace(/[​﻿]/g, '').replace(/\s+/g, ' ').trim();

// Format du fichier d'après ses colonnes : 'hevy', 'strong' ou null
function detectCsvFormat(header) {
  const keys = new Set((header || []).map(csvKey));
  if (keys.has('exercise_title') && keys.has('start_time')) return 'hevy';
  if (keys.has('exercise name') && keys.has('set order') && keys.has('date')) return 'strong';
  return null;
}

// ── Dates et durées ──────────────────────────────────────────
// Mois tels que Hevy les écrit selon la langue de l'app (anglais, français, espagnol, italien,
// allemand, portugais, néerlandais), abréviés ou en entier, avec ou sans point
const IMPORT_MONTHS = {
  jan: 1, january: 1, janv: 1, janvier: 1, ene: 1, enero: 1, gen: 1, gennaio: 1, januar: 1, janeiro: 1, januari: 1,
  feb: 2, february: 2, fev: 2, fevr: 2, fevrier: 2, febrero: 2, febbraio: 2, februar: 2, fevereiro: 2, februari: 2,
  mar: 3, march: 3, mars: 3, marzo: 3, marz: 3, maerz: 3, marco: 3, maart: 3, mrt: 3,
  apr: 4, april: 4, avr: 4, avril: 4, abr: 4, abril: 4, aprile: 4,
  may: 5, mai: 5, mayo: 5, mag: 5, maggio: 5, maio: 5, mei: 5,
  jun: 6, june: 6, juin: 6, junio: 6, giu: 6, giugno: 6, juni: 6, junho: 6,
  jul: 7, july: 7, juil: 7, juillet: 7, julio: 7, lug: 7, luglio: 7, juli: 7, julho: 7,
  aug: 8, august: 8, aout: 8, ago: 8, agosto: 8, augustus: 8,
  sep: 9, sept: 9, september: 9, septembre: 9, septiembre: 9, set: 9, settembre: 9, setembro: 9,
  oct: 10, october: 10, octobre: 10, octubre: 10, ott: 10, ottobre: 10, okt: 10, oktober: 10, out: 10, outubro: 10,
  nov: 11, november: 11, novembre: 11, noviembre: 11, novembro: 11,
  dec: 12, december: 12, decembre: 12, dic: 12, diciembre: 12, dicembre: 12, dez: 12, dezember: 12, dezembro: 12,
};
const monthToken = t => IMPORT_MONTHS[normName(t).replace(/\./g, '')] || null;
const localMs = (y, mo, d, h = 0, mi = 0, s = 0) => {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const t = new Date(y, mo - 1, d, h, mi, s).getTime();
  return Number.isFinite(t) ? t : null;
};
// Horodatage Hevy : « 6 Sep 2026, 18:00 » (jour, mois dans la langue de l'app, année, heure locale) ;
// « 6 9月 2026, 18:00 » (mois en chiffres) accepté. null si illisible.
function parseHevyDate(str) {
  const s = String(str ?? '').trim();
  let m = s.match(/^(\d{1,2})\.?\s+([^\s\d,]+)\.?\s+(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/u);
  if (m) { const mo = monthToken(m[2]); return mo ? localMs(+m[3], mo, +m[1], +m[4], +m[5], +(m[6] || 0)) : null; }
  m = s.match(/^(\d{1,2})\s+(\d{1,2})月\s+(\d{4}),?\s*(\d{1,2}):(\d{2})$/u);
  if (m) return localMs(+m[3], +m[2], +m[1], +m[4], +m[5]);
  m = s.match(/^([^\s\d,]+)\.?\s+(\d{1,2}),?\s+(\d{4}),?\s*(\d{1,2}):(\d{2})$/u);   // « Sep 6, 2026, 18:00 »
  if (m) { const mo = monthToken(m[1]); return mo ? localMs(+m[3], mo, +m[2], +m[4], +m[5]) : null; }
  return parseLocalDateTime(s);
}
// « 2026-09-06 18:00:00 », « 2026-09-06T18:00 », « 2026-09-06 » (Strong) : heure locale. Avec un fuseau
// (« Z », « +02:00ous »), l'instant est exact. Jamais Date.parse sur une forme sans fuseau : Safari et
// Chrome ne lisent pas « 2026-09-06 18:00:00 » de la même façon.
function parseLocalDateTime(str) {
  const s = String(str ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (!m) return null;
  if (m[7]) { const t = Date.parse(s.replace(' ', 'T')); return Number.isFinite(t) ? t : null; }
  return localMs(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}
// Durée d'une séance Strong, en ms : « 1h 5m », « 45m », « 1h », « 1:05:00 », « 1:05 » (h:mm), ou un nombre
// de secondes (colonnes « Duration (sec) » et « Workout Duration »). null si illisible ou hors bornes.
function parseStrongDuration(str) {
  const s = String(str ?? '').trim().toLowerCase();
  if (!s) return null;
  let ms = null, m;
  if (/^\d+(\.\d+)?$/.test(s)) ms = parseFloat(s) * 1000;
  else if ((m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/))) ms = m[3] ? ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 : ((+m[1]) * 3600 + (+m[2]) * 60) * 1000;
  else if ((m = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?$/)) && (m[1] || m[2] || m[3])) {
    ms = ((+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0))) * 1000;
  }
  return ms !== null && ms > 0 && ms <= IMPORT_MAX_DURATION ? Math.round(ms) : null;
}

// ── Lecture d'un fichier ─────────────────────────────────────
// Nombre lu dans une cellule (virgule décimale acceptée), null si vide ou illisible
const cell = (row, i) => (i == null || i < 0 ? '' : String(row[i] ?? '').trim());
const cellNum = (row, i) => { const s = cell(row, i).replace(',', '.'); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };

// Lit un export et le résume, sans toucher aux données de l'app. Renvoie :
//   { ok: false, reason: 'format' | 'empty' | 'size' }
//   { ok: true, format, weightUnit ('kg' | 'lbs' | null si le fichier ne le dit pas), sessions, names,
//     skippedRows, warmups }
// sessions : [{ key, title, date, duration, notes, exercises: [{ raw, sets: [{ kind, weight (nombre dans
// l'unité du fichier, ou null), reps, seconds, km, rpe, warmup }], ss }] }], de la plus ancienne à la plus
// récente, les séances sans date lisible ou sans aucune série écartées (comptées dans skippedRows).
// names : [{ raw, count (séances), match (nom de la bibliothèque ou null) }], les plus fréquents d'abord.
function readImportCsv(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'format' };
  if (text.length > IMPORT_MAX_BYTES) return { ok: false, reason: 'size' };
  const { header, rows } = parseCsv(text);
  const format = detectCsvFormat(header);
  if (!format) return { ok: false, reason: 'format' };
  const read = format === 'hevy' ? readHevyRows(header, rows) : readStrongRows(header, rows);
  const sessions = [...read.sessions.values()]
    .map(s => ({ ...s, exercises: s.exercises.filter(e => e.sets.length) }))
    .filter(s => s.exercises.length)
    .sort((a, b) => a.date - b.date)
    .slice(0, IMPORT_MAX_SESSIONS);
  if (!sessions.length) return { ok: false, reason: 'empty' };
  const counts = new Map();
  sessions.forEach(s => new Set(s.exercises.map(e => e.raw)).forEach(raw => counts.set(raw, (counts.get(raw) || 0) + 1)));
  const names = [...counts.entries()].map(([raw, count]) => ({ raw, count, match: matchImportedExercise(raw) }))
    .sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw, 'fr'));
  const warmups = sessions.reduce((n, s) => n + s.exercises.reduce((m, e) => m + e.sets.filter(st => st.warmup).length, 0), 0);
  return { ok: true, format, weightUnit: read.weightUnit, sessions, names, skippedRows: read.skippedRows, warmups };
}

// Nom d'exercice tel qu'il sera gardé : espaces réduits, borné
const cleanName = raw => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, IMPORT_MAX_NAME).trim();
const cleanText = raw => String(raw ?? '').replace(/\r/g, '').trim().slice(0, IMPORT_MAX_TEXT).trim();

// Série lue : { kind: 'reps' | 'time' | 'cardio', weight, reps, seconds, km, rpe, warmup }, ou null si vide.
// Répétitions dès qu'il y en a ; sinon distance + durée = cardio ; sinon durée seule = maintien (secondes).
function makeImportSet({ weight, reps, seconds, km, rpe, warmup }) {
  const r = Number.isFinite(reps) && reps > 0 ? Math.round(reps) : 0;
  const sec = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  const d = Number.isFinite(km) && km > 0 ? Math.round(km * 1000) / 1000 : 0;
  const w = Number.isFinite(weight) && weight > 0 ? weight : null;
  let kind;
  if (r) kind = 'reps';
  else if (d) kind = 'cardio';
  else if (sec) kind = 'time';
  else if (w) kind = 'reps';   // charge sans répétitions (série notée à moitié) : gardée, 0 rep
  else return null;
  const e = Number.isFinite(rpe) && rpe >= 1 && rpe <= 10 ? Math.round(rpe * 2) / 2 : null;
  return { kind, weight: w, reps: r, seconds: sec, km: d, rpe: e, warmup: !!warmup };
}

// Colonnes d'un en-tête : indice de la première variante présente, -1 sinon
function columnIndex(header, ...variants) {
  const keys = header.map(csvKey);
  for (const v of variants) { const i = keys.indexOf(v); if (i >= 0) return i; }
  return -1;
}

// Hevy (workout_data.csv) : une ligne par série ; une séance = même titre et même heure de début.
// Colonnes : title, start_time, end_time, description, exercise_title, superset_id, exercise_notes,
// set_index, set_type (normal, warmup, dropset, failure), weight_kg | weight_lbs, reps,
// distance_km | distance_miles, duration_seconds, rpe.
function readHevyRows(header, rows) {
  const c = {
    title: columnIndex(header, 'title'), start: columnIndex(header, 'start_time'), end: columnIndex(header, 'end_time'),
    desc: columnIndex(header, 'description'), ex: columnIndex(header, 'exercise_title'), ss: columnIndex(header, 'superset_id'),
    exNotes: columnIndex(header, 'exercise_notes'), type: columnIndex(header, 'set_type'),
    kg: columnIndex(header, 'weight_kg'), lbs: columnIndex(header, 'weight_lbs', 'weight_lb'), reps: columnIndex(header, 'reps'),
    km: columnIndex(header, 'distance_km'), miles: columnIndex(header, 'distance_miles'), sec: columnIndex(header, 'duration_seconds'),
    rpe: columnIndex(header, 'rpe'),
  };
  const weightUnit = c.kg >= 0 ? 'kg' : c.lbs >= 0 ? 'lbs' : null;
  const sessions = new Map();
  let skippedRows = 0;
  for (const row of rows) {
    const raw = cleanName(cell(row, c.ex));
    const date = parseHevyDate(cell(row, c.start));
    if (!raw || date === null) { skippedRows++; continue; }
    const key = `${cell(row, c.start)}|${cell(row, c.title)}`;
    let s = sessions.get(key);
    if (!s) {
      const end = parseHevyDate(cell(row, c.end));
      const duration = end !== null && end > date && end - date <= IMPORT_MAX_DURATION ? end - date : null;
      s = { key, title: cleanName(cell(row, c.title)) || 'Séance', date, duration, notes: cleanText(cell(row, c.desc)), exNotes: new Map(), exercises: [] };
      sessions.set(key, s);
    }
    let ex = s.exercises.find(e => e.raw === raw);
    if (!ex) {
      const ss = cell(row, c.ss);
      ex = { raw, sets: [], ss: /^\d{1,6}$/.test(ss) ? ss : null };
      s.exercises.push(ex);
    }
    const note = cleanText(cell(row, c.exNotes));
    if (note && !s.exNotes.has(raw)) s.exNotes.set(raw, note);
    const miles = cellNum(row, c.miles);
    const st = makeImportSet({
      weight: weightUnit === 'kg' ? cellNum(row, c.kg) : cellNum(row, c.lbs), reps: cellNum(row, c.reps), seconds: cellNum(row, c.sec),
      km: c.km >= 0 ? cellNum(row, c.km) : miles === null ? null : miles * IMPORT_KM_PER_MILE,
      rpe: cellNum(row, c.rpe), warmup: /^warm/i.test(cell(row, c.type)),
    });
    if (st) ex.sets.push(st); else skippedRows++;
  }
  return { weightUnit, sessions: finishNotes(sessions), skippedRows };
}

// Strong : une ligne par série ; une séance = même date et même nom (ou même « Workout # »).
// Colonnes (iPhone) : Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps, Distance, Seconds,
// Notes, Workout Notes, RPE ; anciennes versions : Workout Duration (secondes) ; Strong 6.2 (point-virgule) :
// Workout #, Duration (sec), Weight (kg), Distance (meters). Set Order : numéro, W (échauffement), D (dégressive),
// F (échec) ; les lignes « Rest Timer » et « Note » ne sont pas des séries.
function readStrongRows(header, rows) {
  const c = {
    num: columnIndex(header, 'workout #'), date: columnIndex(header, 'date'), title: columnIndex(header, 'workout name'),
    dur: columnIndex(header, 'duration', 'duration (sec)', 'workout duration'), ex: columnIndex(header, 'exercise name'),
    order: columnIndex(header, 'set order'), kg: columnIndex(header, 'weight (kg)'), lbs: columnIndex(header, 'weight (lbs)', 'weight (lb)'),
    w: columnIndex(header, 'weight'), reps: columnIndex(header, 'reps'), m: columnIndex(header, 'distance (meters)', 'distance (m)'),
    km: columnIndex(header, 'distance (km)'), miles: columnIndex(header, 'distance (miles)'), dist: columnIndex(header, 'distance'),
    sec: columnIndex(header, 'seconds'), notes: columnIndex(header, 'notes'), wNotes: columnIndex(header, 'workout notes'), rpe: columnIndex(header, 'rpe'),
  };
  const weightUnit = c.kg >= 0 ? 'kg' : c.lbs >= 0 ? 'lbs' : null;
  const wCol = c.kg >= 0 ? c.kg : c.lbs >= 0 ? c.lbs : c.w;
  const sessions = new Map();
  let skippedRows = 0;
  for (const row of rows) {
    const raw = cleanName(cell(row, c.ex));
    const date = parseLocalDateTime(cell(row, c.date));
    const order = cell(row, c.order);
    if (!raw || date === null || /rest timer|^note$/i.test(order)) { skippedRows++; continue; }
    const key = c.num >= 0 && cell(row, c.num) ? `#${cell(row, c.num)}` : `${cell(row, c.date)}|${cell(row, c.title)}`;
    let s = sessions.get(key);
    if (!s) {
      s = { key, title: cleanName(cell(row, c.title)) || 'Séance', date, duration: parseStrongDuration(cell(row, c.dur)),
        notes: cleanText(cell(row, c.wNotes)), exNotes: new Map(), exercises: [] };
      sessions.set(key, s);
    }
    let ex = s.exercises.find(e => e.raw === raw);
    if (!ex) { ex = { raw, sets: [], ss: null }; s.exercises.push(ex); }
    const note = cleanText(cell(row, c.notes));
    if (note && !s.exNotes.has(raw)) s.exNotes.set(raw, note);
    let km = null;
    if (c.m >= 0) { const v = cellNum(row, c.m); km = v === null ? null : v / 1000; }
    else if (c.km >= 0) km = cellNum(row, c.km);
    else if (c.miles >= 0) { const v = cellNum(row, c.miles); km = v === null ? null : v * IMPORT_KM_PER_MILE; }
    else if (c.dist >= 0) { const v = cellNum(row, c.dist); km = v === null ? null : v >= 50 ? v / 1000 : v; }   // unité inconnue : au-delà de 50, des mètres
    const st = makeImportSet({ weight: cellNum(row, wCol), reps: cellNum(row, c.reps), seconds: cellNum(row, c.sec), km,
      rpe: cellNum(row, c.rpe), warmup: /^w$/i.test(order) });
    if (st) ex.sets.push(st); else skippedRows++;
  }
  return { weightUnit, sessions: finishNotes(sessions), skippedRows };
}

// Notes d'exercices ajoutées aux notes de la séance (« Nom : note »), le tout borné
function finishNotes(sessions) {
  for (const s of sessions.values()) {
    const lines = [s.notes, ...[...s.exNotes.entries()].map(([raw, n]) => `${raw} : ${n}`)].filter(Boolean);
    s.notes = lines.join('\n').slice(0, IMPORT_MAX_TEXT).trim();
    delete s.exNotes;
  }
  return sessions;
}

// ── Correspondance des noms avec la bibliothèque ─────────────
// Hevy et Strong écrivent en anglais « Mouvement (Matériel) » : « Bench Press (Dumbbell) », « Lat Pulldown
// (Cable) », « Triceps Pushdown (Cable - Straight Bar) », « Seated Cable Row - Bar Grip ». Dans l'ordre :
// 1. le nom tel quel, par la recherche de la bibliothèque (catalogueEntry : nom, alias, clé souple) ;
// 2. les mêmes mots dans un autre ordre (clé de mots triés : « Incline Bench Press (Dumbbell) » = alias
//    « incline dumbbell bench press »), nom et matériel réunis, puis sans les mots de position (seated, lying…)
//    et sans « machine » : « Seated Leg Curl (Machine) » = « Leg curl machine » ;
// 3. le mouvement seul si le matériel ne change pas la fiche : « Lat Pulldown (Cable) » ; avec un matériel
//    précis (Dumbbell, Smith Machine…), seulement si la fiche trouvée est de ce matériel : « Arnold Press
//    (Dumbbell) » oui (fiche haltères), « Bench Press (Smith Machine) » non (ce serait la barre).
// Le vocabulaire anglais propre à ces apps (IMPORT_ALIASES) complète la bibliothèque sans la modifier.
// Renvoie le nom de la fiche (muscles vérifiés) ou null : l'exercice est alors créé sous son nom d'origine,
// ou relié à la main dans l'aperçu.
const IMPORT_ALIASES = [
  ['Écarté haltères plat', 'chest fly dumbbell|dumbbell chest fly|fly dumbbell'],
  ['Écarté poulie vis-à-vis', 'cable fly crossovers|cable fly crossover|cable chest fly|chest fly cable'],
  ['Pec deck', 'pec deck machine|chest fly machine|butterfly machine'],
  ['Pec deck inversé', 'reverse fly machine|rear delt fly machine|reverse pec deck machine'],
  ['Rowing barre T', 't bar row'],
  ['Rowing haltère unilatéral', 'dumbbell row|single arm row dumbbell|one arm row dumbbell'],
  ['Tirage horizontal câble', 'seated cable row|seated row cable|cable row seated|low row cable'],
  ['Rowing machine', 'seated row machine|chest supported row machine|iso lateral row machine|row machine'],
  ['Tirage bras tendus poulie', 'straight arm lat pulldown|straight arm pulldown cable|straight arm lat pulldown cable'],
  ['Face pull', 'face pull cable'],
  ['Haussements d\'épaules haltères', 'shrug dumbbell|dumbbell shrug'],
  ['Extension lombaires', 'back extension|hyperextension|back extension machine'],
  ['Développé militaire barre', 'overhead press barbell|military press barbell|shoulder press barbell|standing military press'],
  ['Développé militaire haltères', 'shoulder press dumbbell|seated shoulder press dumbbell|overhead press dumbbell'],
  ['Développé épaules machine', 'shoulder press machine|seated shoulder press machine|overhead press machine'],
  ['Développé Arnold', 'arnold press dumbbell'],
  ['Élévations latérales', 'lateral raise dumbbell|side lateral raise dumbbell'],
  ['Élévations latérales poulie', 'lateral raise cable'],
  ['Élévations frontales', 'front raise dumbbell|front raise'],
  ['Oiseau (élévations arrière)', 'rear delt reverse fly dumbbell|rear delt reverse fly|reverse fly dumbbell|rear delt raise dumbbell|bent over rear delt fly'],
  ['Oiseau poulie vis-à-vis', 'rear delt reverse fly cable|reverse fly cable|rear delt fly cable'],
  ['Rowing menton', 'upright row barbell|upright row dumbbell|upright row cable|upright row'],
  ['Curl biceps barre', 'bicep curl barbell|biceps curl barbell|barbell bicep curl|ez bar bicep curl|bicep curl ez bar'],
  ['Curl biceps haltères', 'bicep curl dumbbell|biceps curl dumbbell|dumbbell bicep curl|bicep curl|biceps curl|alternating bicep curl dumbbell'],
  ['Curl poulie', 'bicep curl cable|biceps curl cable|cable bicep curl'],
  ['Curl marteau', 'hammer curl dumbbell|hammer curl cable|hammer curl'],
  ['Curl pupitre', 'preacher curl barbell|preacher curl dumbbell|preacher curl machine|preacher curl'],
  ['Curl incliné', 'incline curl dumbbell|incline bicep curl dumbbell'],
  ['Curl concentration', 'concentration curl dumbbell'],
  ['Curl inversé', 'reverse curl barbell|reverse curl dumbbell|reverse grip curl'],
  ['Extension triceps poulie', 'triceps pushdown cable|triceps pushdown|tricep pushdown|triceps rope pushdown|triceps extension cable|triceps pushdown cable straight bar|triceps pushdown cable rope|rope pushdown cable'],
  ['Extension triceps corde nuque', 'overhead triceps extension cable|triceps overhead extension cable'],
  ['Extension nuque', 'overhead triceps extension dumbbell|triceps extension dumbbell|seated triceps press dumbbell'],
  ['Barre au front', 'skullcrusher barbell|skull crusher barbell|skullcrusher|lying triceps extension barbell'],
  ['Extension triceps couché haltères', 'skullcrusher dumbbell|skull crusher dumbbell|lying triceps extension dumbbell'],
  ['Kickback triceps', 'triceps kickback dumbbell|kickback dumbbell|triceps kickback cable'],
  ['Développé couché prise serrée', 'close grip bench press barbell'],
  ['Dips sur chaise', 'bench dip|bench dips|triceps dip bench'],
  ['Dips', 'dip|dips|chest dip|triceps dip|parallel bar dip'],
  ['Dips assistés (machine)', 'assisted dip|dip assisted|assisted dips'],
  ['Tractions assistées (machine)', 'pull up assisted|assisted pull up|chin up assisted|assisted chin up'],
  ['Tractions pronation', 'pull up|pull ups|wide pull up|weighted pull up|pull up weighted'],
  ['Tractions supination', 'chin up|chin ups|weighted chin up|chin up weighted'],
  ['Tractions australiennes', 'inverted row|australian pull up|inverted row bodyweight'],
  ['Relevés de genoux suspendu', 'hanging knee raise|hanging leg raise|knee raise captain chair|leg raise captain chair|captains chair leg raise'],
  ['Relevés de jambes', 'lying leg raise|leg raise|leg raises|flutter kicks'],
  ['Crunch', 'crunch|crunches|sit up|sit ups|bicycle crunch'],
  ['Crunch poulie', 'cable crunch|kneeling cable crunch|crunch cable'],
  ['Crunch machine', 'crunch machine|ab crunch machine|seated crunch machine'],
  ['Gainage (planche)', 'plank|front plank|elbow plank|planks'],
  ['Gainage latéral', 'side plank|side planks'],
  ['Roue abdominale', 'ab wheel|ab wheel rollout|ab roller'],
  ['Rotations russes', 'russian twist|russian twists|russian twist weighted'],
  ['Grimpeur', 'mountain climber|mountain climbers'],
  ['Marche du fermier', 'farmers walk|farmer walk|farmers carry|farmer carry|farmers walk dumbbell'],
  ['Squat barre', 'squat barbell|back squat barbell|high bar squat|low bar squat|barbell back squat|squat'],
  ['Squat avant', 'front squat barbell|front squat'],
  ['Squat smith', 'squat smith machine|smith machine squat'],
  ['Squat gobelet', 'goblet squat dumbbell|goblet squat'],
  ['Squat gobelet kettlebell', 'goblet squat kettlebell'],
  ['Squat poids du corps', 'squat bodyweight|bodyweight squat|air squat'],
  ['Hack squat', 'hack squat machine|hack squat'],
  ['Presse à cuisses', 'leg press machine|leg press|leg press horizontal|45 leg press|single leg press'],
  ['Pendulum squat', 'pendulum squat machine'],
  ['Fentes marchées haltères', 'walking lunge dumbbell|walking lunges dumbbell|lunge dumbbell|lunges dumbbell'],
  ['Fentes', 'lunge|lunges|lunge bodyweight|reverse lunge|walking lunge|forward lunge|lunge barbell'],
  ['Fentes bulgares', 'bulgarian split squat|bulgarian split squat dumbbell|split squat|split squat dumbbell'],
  ['Montées sur banc haltères', 'step up|step up dumbbell|step ups'],
  ['Extension quadriceps', 'leg extension machine|leg extension|single leg extension|seated leg extension'],
  ['Leg curl machine', 'seated leg curl machine|lying leg curl machine|leg curl machine|leg curl|seated leg curl|lying leg curl|standing leg curl|hamstring curl machine'],
  ['Soulevé de terre', 'deadlift barbell|deadlift|conventional deadlift|trap bar deadlift|deadlift trap bar'],
  ['Soulevé de terre roumain', 'romanian deadlift barbell|romanian deadlift|stiff leg deadlift barbell|stiff leg deadlift'],
  ['Soulevé de terre roumain haltères', 'romanian deadlift dumbbell|stiff leg deadlift dumbbell'],
  ['Soulevé de terre sumo', 'sumo deadlift barbell|sumo deadlift'],
  ['Rack pull', 'rack pull barbell|rack pulls'],
  ['Good morning', 'good morning barbell|good mornings'],
  ['Hip thrust', 'hip thrust barbell|hip thrust|glute bridge barbell|barbell hip thrust'],
  ['Hip thrust haltère', 'hip thrust dumbbell'],
  ['Hip thrust machine', 'hip thrust machine'],
  ['Pont fessier', 'glute bridge|glute bridge bodyweight'],
  ['Kickback fessier poulie', 'glute kickback machine|glute kickback cable|cable kickback|glute kickback|kickback machine'],
  ['Abducteurs machine', 'hip abduction machine|hip abduction|seated hip abduction|abductor machine'],
  ['Adducteurs machine', 'hip adduction machine|hip adduction|seated hip adduction|adductor machine'],
  ['Mollets debout', 'standing calf raise machine|standing calf raise|calf raise|calf raise dumbbell|standing calf raise dumbbell|standing calf raise barbell|standing calf raise smith machine'],
  ['Mollets assis', 'seated calf raise machine|seated calf raise'],
  ['Mollets à la presse', 'calf press machine|calf press leg press|calf press|calf press on leg press'],
  ['Pompes', 'push up|push ups|pushup|push up bodyweight'],
  ['Pompes diamant', 'diamond push up|diamond push ups'],
  ['Pompes déclinées', 'decline push up|decline push ups'],
  ['Pompes inclinées', 'incline push up|incline push ups'],
  ['Pompes sur les genoux', 'knee push up|kneeling push up'],
  ['Burpees', 'burpee|burpees'],
  ['Swing kettlebell', 'kettlebell swing|kettlebell swings|swing kettlebell'],
  ['Turkish get-up', 'turkish get up|turkish get up kettlebell'],
  ['Développé couché barre', 'bench press barbell|flat bench press barbell|barbell bench press|bench press'],
  ['Développé couché haltères', 'bench press dumbbell|flat bench press dumbbell|dumbbell bench press|chest press dumbbell'],
  ['Développé incliné barre', 'incline bench press barbell'],
  ['Développé incliné haltères', 'incline bench press dumbbell|incline chest press dumbbell|incline press dumbbell'],
  ['Développé incliné smith', 'incline bench press smith machine'],
  ['Développé décliné', 'decline bench press barbell|decline bench press dumbbell|decline bench press'],
  ['Développé couché machine', 'chest press machine|seated chest press machine|bench press machine|iso lateral chest press machine|chest press'],
  ['Développé au sol haltères', 'floor press dumbbell|floor press barbell|floor press'],
  ['Pull-over haltère', 'pullover dumbbell|dumbbell pullover|pullover'],
  ['Pull-over poulie', 'pullover cable|cable pullover|straight arm pullover cable'],
  ['Tirage vertical prise large', 'lat pulldown cable|lat pulldown machine|lat pulldown|wide grip lat pulldown cable|wide grip lat pulldown|pulldown'],
  ['Tirage vertical prise serrée', 'close grip lat pulldown cable|close grip lat pulldown|lat pulldown underhand|underhand lat pulldown|reverse grip lat pulldown'],
  ['Rowing barre', 'bent over row barbell|barbell row|bent over row|pendlay row barbell|row barbell|bent over row underhand'],
  ['Rowing haltères buste penché', 'bent over row dumbbell|row dumbbell'],
  ['Course à pied', 'running|run|running outdoor|outdoor running|jogging'],
  ['Tapis de course', 'treadmill|running treadmill|treadmill running|walking treadmill|treadmill walking'],
  ['Vélo', 'cycling|bike|outdoor cycling|cycling outdoor|biking|mountain bike'],
  ['Vélo d\'appartement', 'stationary bike|cycling indoor|indoor cycling|spin bike|spinning|assault bike|air bike|exercise bike|bike erg|recumbent bike'],
  ['Rameur', 'rowing machine|rowing|rowing erg|row erg|rower|rowing cardio|concept 2'],
  ['Vélo elliptique', 'elliptical machine|elliptical|elliptical trainer|cross trainer'],
  ['Escaliers', 'stair machine|stairmaster|stair climber|stair stepper|stairs|stepper|stair climbing|step machine'],
  ['Corde à sauter', 'jump rope|skipping|skipping rope|rope jumping'],
  ['Marche rapide', 'walking|walk|brisk walking|incline walk|hiking|hike|power walking'],
  ['Jumping jacks', 'jumping jack|jumping jacks'],
];
// Clé de mots : mots du nom (clé souple, pluriel ôté), triés : l'ordre des mots ne compte plus
const importWordKey = name => ruleKey(name).replace(/[()'’]/g, ' ').split(' ').filter(Boolean).map(w => w.replace(/s$/, '')).sort().join(' ');
const IMPORT_ALIAS_BY_KEY = new Map(IMPORT_ALIASES.flatMap(([name, aliases]) => aliases.split('|').map(a => [importWordKey(a), name])));
// Mots de position et de matériel générique, retirés en dernier recours (« Seated Leg Curl (Machine) » → leg curl machine → Leg curl machine ;
// « Elliptical Machine » → elliptical)
const IMPORT_POSITION_WORDS = /\b(seated|standing|lying|kneeling|incline|flat|alternating)\b/g;
// Matériel qui désigne une fiche précise : le mouvement seul n'est repris que si sa fiche est de ce matériel (EQUIPMENT)
const IMPORT_EQUIP_OF = [[/dumbbell/, 'halteres'], [/kettlebell/, 'kettlebell'], [/\bband\b|resistance band/, 'elastique'], [/bodyweight/, 'aucun'],
  [/smith|plate loaded|hammer strength|trap bar|hex bar|sled|landmine|safety bar|trx|suspension|ring/, '—']];
function importLookup(text) {
  const entry = catalogueEntry(text);
  if (entry) return entry.name;
  const key = importWordKey(text);
  if (!key) return null;
  return IMPORT_ALIAS_BY_KEY.get(key) || importLookupByWords(key);
}
// Même clé de mots qu'un nom ou un alias de la bibliothèque (index construit au premier appel)
let catalogueByWordKey = null;
function importLookupByWords(key) {
  if (!catalogueByWordKey) {
    catalogueByWordKey = new Map();
    EXERCISE_CATALOGUE.forEach(e => [e.name, ...e.aliases].forEach(n => { const k = importWordKey(n); if (!catalogueByWordKey.has(k)) catalogueByWordKey.set(k, e.name); }));
  }
  return catalogueByWordKey.get(key) || null;
}
function matchImportedExercise(raw) {
  let name = cleanName(raw);
  if (!name) return null;
  // Vocabulaire : « bicep curl » = curl, « tricep » = triceps, « DB » = dumbbell, « BB » = barbell
  name = name.replace(/\bbiceps?\s+curl\b/i, 'curl').replace(/\btricep\b/gi, 'triceps').replace(/\bdb\b/gi, 'dumbbell').replace(/\bbb\b/gi, 'barbell');
  const direct = importLookup(name);
  if (direct) return direct;
  // Mouvement et matériel : « Mouvement (Matériel) » ou « Mouvement - Précision »
  const m = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/) || name.match(/^(.*?)\s+-\s+(.*)$/);
  if (!m) return importLookup(name.replace(IMPORT_POSITION_WORDS, ' ').replace(/\bmachine\b/gi, ' '));
  const base = m[1].trim(), equipText = m[2].trim();
  if (!base) return null;
  const equips = equipText.split(/\s*[-,/]\s*|\s+and\s+/i).map(e => e.trim()).filter(Boolean);
  for (const eq of [equipText, ...equips]) {
    const found = importLookup(`${base} ${eq}`) || importLookup(`${base} ${eq}`.replace(IMPORT_POSITION_WORDS, ' '))
      || importLookup(`${base} ${eq}`.replace(IMPORT_POSITION_WORDS, ' ').replace(/\bmachine\b/gi, ' '));
    if (found) return found;
  }
  // Mouvement seul : refusé si le matériel désigne une autre fiche que celle trouvée
  const found = importLookup(base) || importLookup(base.replace(IMPORT_POSITION_WORDS, ' '));
  if (!found) return null;
  const nEquip = normName(equipText);
  const wanted = IMPORT_EQUIP_OF.find(([re]) => re.test(nEquip))?.[1];
  if (!wanted) return found;
  return equipmentOf(found) === wanted ? found : null;
}

// ── Conversion et fusion dans la donnée de l'app ─────────────
// Empreinte d'une séance pour ne pas l'importer deux fois : minute de début et exercices (noms normalisés,
// triés). Les séances de l'app et les séances importées passent par la même fonction.
function importFingerprint(date, names) {
  return `${Math.floor(date / 60000)}|${[...new Set(names.map(normName))].sort().join('|')}`;
}

// Charge du fichier → charge stockée (kg, chaîne) ; '' si absente
function importWeight(w, unit) {
  if (!Number.isFinite(w) || w <= 0) return '';
  const kg = unit === 'lbs' ? Math.round(w / IMPORT_LBS_PER_KG * 1000) / 1000 : Math.round(w * 100) / 100;
  return kg > 0 && kg <= MAX_LOAD_KG ? String(kg) : '';
}

// Mesure d'un exercice importé : celle de la majorité de ses séries (égalité : répétitions, puis durée)
function importMeasure(sets) {
  const n = { reps: 0, time: 0, cardio: 0 };
  sets.forEach(s => { n[s.kind]++; });
  return n.cardio > n.reps && n.cardio > n.time ? 'cardio' : n.time > n.reps && n.time >= n.cardio ? 'time' : 'reps';
}

// Série importée → série de l'historique selon la mesure de l'exercice, null si elle n'y entre pas
function importSetFor(s, measure, unit) {
  if (measure === 'cardio') {
    if (!s.km && !s.seconds) return null;
    const out = { weight: '', reps: String(Math.min(600, Math.max(s.seconds ? 1 : 0, Math.round(s.seconds / 60)))) };
    if (s.km) out.dist = String(Math.min(500, s.km));
    return withRpe(out, s);
  }
  if (measure === 'time') {
    if (!s.seconds) return null;
    return withRpe({ weight: importWeight(s.weight, unit), reps: String(Math.min(3600, s.seconds)) }, s);
  }
  if (s.kind !== 'reps') return null;
  return withRpe({ weight: importWeight(s.weight, unit), reps: String(Math.min(4000, s.reps)) }, s);
}
const withRpe = (out, s) => (s.rpe ? { ...out, rpe: s.rpe } : out);

// Programme créé pour les séances importées : un par app d'origine, ses séances = les noms de séance du fichier
const IMPORT_PROGRAMME = { hevy: { id: 'u_hevy', name: 'Hevy' }, strong: { id: 'u_strong', name: 'Strong' } };
const IMPORT_COLORS = ['#FF9F0A', '#40C8E0', '#30D158', '#BF5AF2', '#FFD60A', '#5E5CE6', '#FF453A'];
const importSessionKey = title => 's' + syncHash(normName(title));

// Applique un import lu par readImportCsv à la donnée d (par défaut celle de l'app), sans enregistrer.
// opts : { links: { nomBrut: nomDeLaBibliothèque } (liens posés à la main), keepWarmups (défaut false),
// unit ('kg' | 'lbs' : unité des charges du fichier quand il ne la donne pas ; sinon celle du fichier) }.
// Renvoie { added, duplicates, recognized, created, programme } ; duplicates = séances déjà présentes
// (même empreinte) ou répétées dans le fichier. Les séances existantes ne sont jamais modifiées.
function applyImport(plan, { links = {}, keepWarmups = false, unit = null } = {}, d = data) {
  const weightUnit = plan.weightUnit || (unit === 'lbs' ? 'lbs' : 'kg');
  const pm = IMPORT_PROGRAMME[plan.format];
  // Nom final de chaque nom brut : lien posé à la main (s'il est dans la bibliothèque), sinon la correspondance
  // automatique, sinon le nom d'origine (exercice créé)
  const finalName = new Map();
  for (const { raw, match } of plan.names) {
    const linked = typeof links[raw] === 'string' ? catalogueEntry(links[raw])?.name : null;
    finalName.set(raw, linked || match || raw);
  }
  const seen = new Set((d.history || []).map(h => importFingerprint(h.date, (h.exercises || []).map(e => e.name))));
  // Séances déjà importées de cette app : même minute et même nombre d'exercices suffit (les noms ont pu
  // changer par un lien posé à la main lors d'un import précédent)
  const sameApp = new Set((d.history || []).filter(h => h.programme === pm.id).map(h => `${Math.floor(h.date / 60000)}|${(h.exercises || []).length}`));
  // Programme d'accueil : créé s'il n'existe pas ; ses séances existantes ne sont pas touchées
  const up = d.userProgrammes[pm.id] || (d.userProgrammes[pm.id] = { name: pm.name, sessions: {}, archived: false });
  if (up.archived) up.archived = false;   // réimport après une suppression du programme : il revient
  const pd = d.programmes[pm.id] || (d.programmes[pm.id] = { exercises: {}, timers: {}, cooldowns: {} });
  const newCats = new Set();
  const entries = [];
  let duplicates = 0;
  for (const s of plan.sessions) {
    const cat = importSessionKey(s.title);
    const exercises = [];
    for (const ex of s.exercises) {
      const name = finalName.get(ex.raw) || ex.raw;
      const sets = ex.sets.filter(st => keepWarmups || !st.warmup);
      if (!sets.length) continue;
      const measure = importMeasure(sets);
      const out = sets.map(st => importSetFor(st, measure, weightUnit)).filter(Boolean);
      if (!out.length) continue;
      const e = { exId: null, name, sets: out };
      // Mesure enregistrée hors répétitions, et en répétitions seulement si le nom dirait autre chose (storedMeasure)
      if (measure !== 'reps' || measureOf({ name }) !== 'reps') e.measure = measure;
      if (ex.ss) e.ss = ('i' + ex.ss).slice(0, 12);
      exercises.push(e);
    }
    if (!exercises.length) continue;
    const fp = importFingerprint(s.date, exercises.map(e => e.name));
    const appKey = `${Math.floor(s.date / 60000)}|${exercises.length}`;
    if (seen.has(fp) || sameApp.has(appKey)) { duplicates++; continue; }
    seen.add(fp); sameApp.add(appKey);
    if (!up.sessions[cat]) {
      up.sessions[cat] = { label: s.title.slice(0, IMPORT_MAX_LABEL), icon: '', desc: '', color: IMPORT_COLORS[Object.keys(up.sessions).length % IMPORT_COLORS.length] };
      newCats.add(cat);
    }
    const entry = { id: uid(), programme: pm.id, category: cat, date: s.date, exercises };
    if (s.duration) entry.duration = s.duration;
    if (s.notes) entry.notes = s.notes;
    entries.push(entry);
  }
  // Exercices des séances créées : ceux de la dernière séance importée à ce nom (la routine telle qu'elle
  // est faite aujourd'hui), avec leur nombre de séries ; identifiant partagé avec l'historique
  for (const cat of newCats) {
    const last = entries.filter(h => h.category === cat).at(-1);
    pd.exercises[cat] = (last?.exercises || []).slice(0, 30).map(e => {
      const pe = makeExercise(e.name, Math.min(10, Math.max(1, e.sets.length)));
      pe.id = importExId(e.name, d);
      if (e.measure && e.measure !== 'reps') pe.measure = e.measure;
      return pe;
    });
    pd.timers[cat] = null; pd.cooldowns[cat] = 72;
  }
  up.order = userSessionOrder(up);
  // Identifiant de chaque exercice : celui de la séance du programme (créée ci-dessus), sinon celui du même
  // nom ailleurs (programmes, historique : même courbe de progrès), sinon une clé de nom
  for (const h of entries) {
    for (const e of h.exercises) {
      const inProg = (pd.exercises[h.category] || []).find(x => normName(x.name) === normName(e.name));
      e.exId = inProg ? inProg.id : importExId(e.name, d);
    }
    ssNormalize(h.exercises);
  }
  const kept = entries.filter(cleanHistoryEntry);
  d.history = [...(d.history || []), ...kept].sort((a, b) => b.date - a.date);
  d.myProgrammes = cleanMyProgrammes(d);
  const recognized = plan.names.filter(n => finalName.get(n.raw) !== n.raw).length;
  return { added: kept.length, duplicates, recognized, created: plan.names.length - recognized, programme: pm.id };
}

// Identifiant d'un exercice importé : celui du même nom dans un programme ou l'historique, sinon un nouveau
function importExId(name, d) {
  const n = normName(name);
  for (const p of Object.values(d.programmes || {})) {
    for (const list of Object.values(p.exercises || {})) {
      const ex = (list || []).find(e => normName(e.name) === n);
      if (ex) return ex.id;
    }
  }
  const past = (d.history || []).flatMap(h => h.exercises || []).find(e => e.exId && normName(e.name) === n);
  return past ? past.exId : uid();
}
