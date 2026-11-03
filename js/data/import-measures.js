// ═══════════════════════════════════════════════════════════
//  Import des mesures depuis Hevy (fichier CSV « Export Measurements ») : logique pure, sans écran
//
//  - Format (docs/IMPORT_CSV.md, « Mesures Hevy ») : une ligne par jour de mesure, en-tête en anglais,
//    unité dans le nom de chaque colonne selon le réglage de l'app Hevy :
//      "date","weight_kg","fat_percent","neck_cm","shoulder_cm","chest_cm","left_bicep_cm",…
//      "23 Oct 2023, 00:00",64.5,12.3,,,,…
//    weight_kg | weight_lbs, <partie>_cm | <partie>_in. Une cellule vide = pas de mesure ce jour-là.
//  - Destination : pesées dans data.bodyWeightLog (js/data/store.js), mensurations dans
//    data.bodyMeasures (js/data/body-measures.js), toujours en kg et en cm. Rien sur le serveur
//    (SYNC_LOCAL_ONLY) : même règle que les valeurs saisies dans l'app.
//  - Sans doublon : une valeur par jour et par mesure ; un jour déjà noté dans l'app garde sa valeur
//    (la saisie de la personne prime), réimporter le même fichier n'ajoute rien.
//  - Ce que l'app ne suit pas (masse grasse, masse maigre, avant-bras, abdomen) est ignoré et nommé dans
//    l'aperçu. Mollet : l'app n'en a qu'un, celui de gauche (à défaut celui de droite).
//  - Le fichier est une donnée non fiable : valeurs bornées comme à la saisie, dates futures écartées.
//  Chargé après import-csv.js (parseCsv, csvKey, parseHevyDate, cellNum…), store.js et body-measures.js.
// ═══════════════════════════════════════════════════════════
'use strict';

const IN_TO_CM = 2.54;   // CM_PER_IN (body-measures.js), recopié comme IMPORT_LBS_PER_KG
// Mensurations de l'app → noms de colonne Hevy (sans l'unité), la première présente et remplie l'emporte
const HEVY_MEASURE_COLS = [
  ['neck', ['neck']],
  ['shoulders', ['shoulder', 'shoulders']],
  ['chest', ['chest']],
  ['armL', ['left_bicep', 'left_biceps']],
  ['armR', ['right_bicep', 'right_biceps']],
  ['waist', ['waist']],
  ['hips', ['hips', 'hip']],
  ['thighL', ['left_thigh']],
  ['thighR', ['right_thigh']],
  ['calf', ['left_calf', 'calf', 'right_calf']],
];
// Colonnes connues que l'app ne suit pas : nommées dans l'aperçu quand le fichier en contient
const HEVY_MEASURE_IGNORED = [
  ['fat_percent', 'masse grasse'], ['lean_mass', 'masse maigre'],
  ['left_forearm', 'avant-bras'], ['right_forearm', 'avant-bras'], ['abdomen', 'abdomen'],
];

// Colonne d'une mesure : { i, toCm } (unité lue dans le nom), null si absente
function measureColumn(keys, names) {
  for (const n of names) {
    for (const [suffix, toCm] of [['_cm', 1], ['_in', IN_TO_CM], ['_inch', IN_TO_CM], ['_inches', IN_TO_CM], ['', 1]]) {   // sans unité : cm, l'unité par défaut de Hevy
      const i = keys.indexOf(n + suffix);
      if (i >= 0) return { i, toCm };
    }
  }
  return null;
}
const measureColumns = (keys, names) => names.map(n => measureColumn(keys, [n])).filter(Boolean);

// En-tête d'un export de mesures Hevy : colonne date, au moins le poids ou une mensuration, et pas
// une colonne de séance (le fichier des séances a aussi weight_kg)
function isHevyMeasuresHeader(header) {
  const keys = (header || []).map(csvKey);
  if (!keys.includes('date') || keys.includes('exercise_title') || keys.includes('exercise name')) return false;
  return keys.some(k => /^weight_(kg|lbs?)$/.test(k)) || HEVY_MEASURE_COLS.some(([, names]) => measureColumn(keys, names));
}

// Lit le fichier sans toucher aux données de l'app. Renvoie :
//   { ok: false, reason: 'format' | 'empty' | 'size' }
//   { ok: true, format: 'hevy_measures', days: [{ date, kg?, cm: { clé: cm } }] (du plus ancien au plus
//     récent, date à midi du jour), ignored: ['masse grasse', …], skippedRows, outOfRange }
function readMeasuresCsv(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'format' };
  if (text.length > IMPORT_MAX_BYTES) return { ok: false, reason: 'size' };
  if (!isHevyMeasuresHeader(parseCsv(text, 1).header)) return { ok: false, reason: 'format' };
  const { header, rows } = parseCsv(text);
  const keys = header.map(csvKey);
  const iDate = keys.indexOf('date');
  const kg = keys.indexOf('weight_kg'), lbs = Math.max(keys.indexOf('weight_lbs'), keys.indexOf('weight_lb'));
  const cols = HEVY_MEASURE_COLS.map(([key, names]) => [key, measureColumns(keys, names)]);
  const ignoredCols = HEVY_MEASURE_IGNORED.map(([name, label]) => [keys.findIndex(k => k === name || k.startsWith(name + '_')), label]).filter(([i]) => i >= 0);
  const ignored = new Set();
  const byDay = new Map();   // jour local → { at (horodatage du fichier), date, kg?, cm }
  let skippedRows = 0, outOfRange = 0;
  for (const row of rows) {
    const at = importDate(parseHevyDate(cell(row, iDate)));
    if (at === null) { skippedRows++; continue; }
    const t = new Date(at);
    const date = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 12).getTime();
    const day = localISO(date);
    const prev = byDay.get(day);
    // Deux lignes du même jour : la plus tardive l'emporte, champ par champ
    const later = !prev || at >= prev.at;
    const e = prev || { at, date, cm: {} };
    if (later) e.at = at;
    let any = false;
    const w = kg >= 0 && cellNum(row, kg) !== null ? cellNum(row, kg) : lbs >= 0 && cellNum(row, lbs) !== null ? cellNum(row, lbs) / IMPORT_LBS_PER_KG : null;
    if (w !== null) {
      const v = Math.round(w * 10) / 10;
      if (v >= 25 && v <= 300) { if (later || e.kg === undefined) e.kg = v; any = true; } else outOfRange++;
    }
    for (const [key, list] of cols) {
      const c = list.find(x => cellNum(row, x.i) !== null);
      if (!c) continue;
      const v = Math.round(cellNum(row, c.i) * c.toCm * 10) / 10;
      if (v >= BODY_CM_MIN && v <= BODY_CM_MAX) { if (later || e.cm[key] === undefined) e.cm[key] = v; any = true; } else outOfRange++;
    }
    for (const [i, label] of ignoredCols) if (cellNum(row, i) !== null) ignored.add(label);
    if (any) byDay.set(day, e); else if (!prev) skippedRows++;
  }
  const days = [...byDay.values()].sort((a, b) => a.date - b.date)
    .map(({ date, kg: k, cm }) => (k === undefined ? { date, cm } : { date, kg: k, cm }));
  if (!days.length) return { ok: false, reason: 'empty' };
  return { ok: true, format: 'hevy_measures', days, ignored: [...ignored], skippedRows, outOfRange };
}

// Ajoute les mesures lues à d (data par défaut ; une copie pour l'aperçu). Un import ne fait JAMAIS
// disparaître une valeur déjà là : un jour déjà noté garde sa valeur, et chaque mesure ne reçoit que la
// place libre sous sa limite (BODY_LOG_MAX, BODY_MEASURE_MAX), en gardant les valeurs les plus récentes du
// fichier. Renvoie { weights, measures (valeurs ajoutées), kept (valeurs déjà notées ce jour-là),
// dropped (valeurs du fichier non importées faute de place) }.
function applyMeasuresImport(plan, d = data) {
  const out = { weights: 0, measures: 0, kept: 0, dropped: 0 };
  // Valeurs à ajouter dans un journal qui en a déjà `have` : les plus récentes d'abord, dans la place libre
  const fit = (list, have, max) => {
    const sorted = [...list].sort((a, b) => b.date - a.date);
    const room = Math.max(0, max - have);
    out.dropped += Math.max(0, sorted.length - room);
    return sorted.slice(0, room);
  };
  // Pesées
  const log = cleanBodyWeightLog(d.bodyWeightLog);
  const known = new Set(log.map(p => dayKey(p.date)));
  const fresh = plan.days.filter(x => x.kg !== undefined).filter(x => { if (known.has(dayKey(x.date))) { out.kept++; return false; } return true; });
  const added = fit(fresh, log.length, BODY_LOG_MAX);
  if (added.length) {
    const next = cleanBodyWeightLog([...log, ...added.map(x => ({ date: x.date, kg: x.kg }))]);
    const mine = new Set(added.map(x => x.date));
    out.weights = next.filter(p => mine.has(p.date)).length;
    d.bodyWeightLog = next;
    // Poids du corps (volume au poids du corps, calories) : pris dans le fichier s'il est vide, ou si la
    // personne notait déjà ses pesées et que celle du fichier est plus récente que sa dernière. Sans
    // historique, une vieille pesée Hevy ne remplace pas le poids saisi dans les réglages.
    const newest = next[0];
    const empty = !Number.isFinite(d.bodyWeightKg);
    if (mine.has(newest.date) && (empty || (log.length && newest.date > log[0].date))) d.bodyWeightKg = newest.kg;
  }
  // Mensurations
  const cur = cleanBodyMeasures(d.bodyMeasures);
  for (const key of BODY_MEASURE_KEYS) {
    const have = cur[key] || [];
    const seen = new Set(have.map(p => bodyDayKey(p.date)));
    const fresh = plan.days.filter(x => x.cm[key] !== undefined).filter(x => { if (seen.has(bodyDayKey(x.date))) { out.kept++; return false; } return true; });
    const add = fit(fresh, have.length, BODY_MEASURE_MAX);
    if (!add.length) continue;
    const next = cleanBodyMeasures({ [key]: [...have, ...add.map(x => ({ date: x.date, cm: x.cm[key] }))] })[key] || [];
    const mine = new Set(add.map(x => x.date));
    out.measures += next.filter(p => mine.has(p.date)).length;
    cur[key] = next;
  }
  if (out.measures) d.bodyMeasures = cur;
  return out;
}
