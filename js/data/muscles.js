// ═══════════════════════════════════════════════════════════
//  Muscles : catalogue, bibliothèque d'exercices, reconnaissance par le nom
// ═══════════════════════════════════════════════════════════
'use strict';

// Groupes musculaires affichés par l'app, dans l'ordre des listes (du haut vers le bas du corps).
// short : nom regroupé pour les lignes de liste (les trois faisceaux de l'épaule y deviennent « Épaules »).
// minor : petit groupe travaillé surtout en secondaire, jamais signalé comme « peu travaillé ».
const MUSCLES = [
  { id: 'chest',       label: 'Pectoraux' },
  { id: 'front_delts', label: 'Épaules antérieures', short: 'Épaules' },
  { id: 'side_delts',  label: 'Épaules latérales', short: 'Épaules' },
  { id: 'rear_delts',  label: 'Épaules postérieures', short: 'Épaules' },
  { id: 'traps',       label: 'Trapèzes' },
  { id: 'lats',        label: 'Grand dorsal' },
  { id: 'lower_back',  label: 'Lombaires', minor: true },
  { id: 'biceps',      label: 'Biceps' },
  { id: 'triceps',     label: 'Triceps' },
  { id: 'forearms',    label: 'Avant-bras', minor: true },
  { id: 'abs',         label: 'Abdominaux' },
  { id: 'glutes',      label: 'Fessiers' },
  { id: 'quads',       label: 'Quadriceps' },
  { id: 'hamstrings',  label: 'Ischio-jambiers' },
  { id: 'adductors',   label: 'Adducteurs', minor: true },
  { id: 'calves',      label: 'Mollets' },
];
const MUSCLE_BY_ID = new Map(MUSCLES.map(m => [m.id, m]));

function isMuscleId(id) { return MUSCLE_BY_ID.has(id); }
function muscleLabel(id) { return MUSCLE_BY_ID.get(id)?.label ?? ''; }

// ── Bibliothèque : exercices connus et leurs muscles ─────────
// [nom, muscles principaux, muscles secondaires, matériel (EQUIPMENT)] ; tous les exercices de PROGRAMMES y figurent
// (vérifié par les tests unitaires). Elle complète aussi la recherche de la feuille d'ajout.
// Matériel nécessaire, pour filtrer la bibliothèque quand on s'entraîne sans salle (feuille d'ajout).
// Chaque exercice a une seule catégorie : celle du matériel le plus lourd qu'il demande.
// Ordre = ordre des filtres ; les identifiants sont repris tels quels par sanitizeData (store.js).
const EQUIPMENT = [
  { id: 'aucun',    label: 'Sans matériel' },
  { id: 'halteres', label: 'Haltères et banc' },
  { id: 'barre',    label: 'Tractions et dips' },
  { id: 'salle',    label: 'Salle' },
];
const EXERCISE_CATALOGUE = [
  // Pectoraux
  ['Développé couché barre',           'chest',                  'front_delts triceps', 'salle'],
  ['Développé couché haltères',        'chest',                  'front_delts triceps', 'halteres'],
  ['Développé incliné barre',          'chest front_delts',      'triceps', 'salle'],
  ['Développé incliné haltères',       'chest front_delts',      'triceps', 'halteres'],
  ['Développé décliné',                'chest',                  'triceps', 'salle'],
  ['Développé couché machine',         'chest',                  'front_delts triceps', 'salle'],
  ['Écarté haltères plat',             'chest',                  'front_delts', 'halteres'],
  ['Écarté poulie vis-à-vis',          'chest',                  'front_delts', 'salle'],
  ['Pec deck',                         'chest',                  'front_delts', 'salle'],
  ['Pompes',                           'chest',                  'front_delts triceps abs', 'aucun'],
  ['Dips',                             'chest triceps',          'front_delts', 'barre'],
  // Dos
  ['Soulevé de terre',                 'glutes hamstrings lower_back', 'quads traps forearms', 'salle'],
  ['Pull-ups',                         'lats',                   'biceps rear_delts forearms', 'barre'],
  ['Tractions prise serrée',           'lats biceps',            'forearms', 'barre'],
  ['Tirage vertical prise large',      'lats',                   'biceps rear_delts', 'salle'],
  ['Tirage vertical prise serrée',     'lats',                   'biceps', 'salle'],
  ['Tirage horizontal câble',          'lats traps',             'rear_delts biceps', 'salle'],
  ['Rowing barre',                     'lats traps',             'rear_delts biceps lower_back', 'salle'],
  ['Rowing haltère unilatéral',        'lats',                   'traps rear_delts biceps', 'halteres'],
  ['Rowing T-bar',                     'lats traps',             'rear_delts biceps', 'salle'],
  ['Pull-over poulie',                 'lats',                   'chest triceps', 'salle'],
  ['Shrugs haltères',                  'traps',                  'forearms', 'halteres'],
  ['Extension lombaires',              'lower_back',             'glutes hamstrings', 'salle'],
  ['Face pull',                        'rear_delts',             'traps side_delts', 'salle'],
  // Épaules
  ['Développé militaire barre',        'front_delts side_delts', 'triceps traps', 'salle'],
  ['Développé militaire haltères',     'front_delts side_delts', 'triceps traps', 'halteres'],
  ['Développé Arnold',                 'front_delts side_delts', 'triceps', 'halteres'],
  ['Élévations latérales',             'side_delts',             'traps', 'halteres'],
  ['Élévations latérales poulie',      'side_delts',             'traps', 'salle'],
  ['Élévations frontales',             'front_delts',            'side_delts', 'halteres'],
  ['Oiseau (élévations arrière)',      'rear_delts',             'traps', 'halteres'],
  ['Rowing menton',                    'side_delts traps',       'biceps', 'salle'],
  // Bras
  ['Curl biceps barre',                'biceps',                 'forearms', 'salle'],
  ['Curl biceps haltères',             'biceps',                 'forearms', 'halteres'],
  ['Curl marteau',                     'biceps forearms',        '', 'halteres'],
  ['Curl pupitre',                     'biceps',                 'forearms', 'salle'],
  ['Curl incliné',                     'biceps',                 'forearms', 'halteres'],
  ['Curl poulie',                      'biceps',                 'forearms', 'salle'],
  ['Curl concentration',               'biceps',                 '', 'halteres'],
  ['Extension triceps poulie',         'triceps',                '', 'salle'],
  ['Extension triceps unilatéral',     'triceps',                '', 'halteres'],
  ['Extension nuque',                  'triceps',                '', 'halteres'],
  ['Barre au front',                   'triceps',                '', 'salle'],
  ['Développé couché prise serrée',    'triceps chest',          'front_delts', 'salle'],
  ['Kickback triceps',                 'triceps',                '', 'halteres'],
  ['Curl poignets',                    'forearms',               '', 'halteres'],
  ['Marche du fermier',                'forearms traps',         'abs', 'halteres'],
  // Abdominaux
  ['Crunch',                           'abs',                    '', 'aucun'],
  ['Crunch poulie',                    'abs',                    '', 'salle'],
  ['Gainage (planche)',                'abs',                    'lower_back', 'aucun'],
  ['Relevés de jambes',                'abs',                    '', 'aucun'],
  ['Roue abdominale',                  'abs',                    'lats', 'salle'],
  ['Russian twist',                    'abs',                    '', 'aucun'],
  // Jambes
  ['Squat barre',                      'quads glutes',           'adductors lower_back', 'salle'],
  ['Front squat',                      'quads',                  'glutes abs', 'salle'],
  ['Goblet squat',                     'quads glutes',           'adductors', 'halteres'],
  ['Hack squat',                       'quads',                  'glutes', 'salle'],
  ['Presse à cuisses',                 'quads glutes',           'adductors', 'salle'],
  ['Fentes marchées haltères',         'quads glutes',           'hamstrings adductors', 'halteres'],
  ['Fentes bulgares',                  'quads glutes',           'hamstrings adductors', 'halteres'],
  ['Extension quadriceps',             'quads',                  '', 'salle'],
  ['Leg curl machine',                 'hamstrings',             'calves', 'salle'],
  ['Soulevé de terre roumain',         'hamstrings glutes',      'lower_back', 'salle'],
  ['Hip thrust',                       'glutes',                 'hamstrings', 'salle'],
  ['Abducteurs machine',               'glutes',                 '', 'salle'],
  ['Adducteurs machine',               'adductors',              '', 'salle'],
  ['Mollets debout',                   'calves',                 '', 'aucun'],
  ['Mollets assis',                    'calves',                 '', 'salle'],
  // Haltères et banc (à la maison)
  ['Développé au sol haltères',        'chest triceps',          'front_delts', 'halteres'],
  ['Écarté incliné haltères',          'chest',                  'front_delts', 'halteres'],
  ['Pull-over haltère',                'lats',                   'chest triceps', 'halteres'],
  ['Rowing haltères buste penché',     'lats traps',             'rear_delts biceps', 'halteres'],
  ['Extension triceps couché haltères','triceps',                '',            'halteres'],
  ['Soulevé de terre roumain haltères','hamstrings glutes',      'lower_back',  'halteres'],
  ['Hip thrust haltère',               'glutes',                 'hamstrings',  'halteres'],
  ['Step-up haltères',                 'quads glutes',           'hamstrings',  'halteres'],
  // Barre de traction et barres à dips
  ['Tractions supination',             'lats biceps',            'forearms',    'barre'],
  ['Tractions australiennes',          'lats traps',             'rear_delts biceps', 'barre'],
  ['Relevés de genoux suspendu',       'abs',                    'forearms',    'barre'],
  // Sans matériel (poids du corps)
  ['Pompes inclinées',                 'chest',                  'front_delts triceps', 'aucun'],
  ['Pompes déclinées',                 'chest front_delts',      'triceps abs', 'aucun'],
  ['Pompes diamant',                   'triceps chest',          'front_delts', 'aucun'],
  ['Pompes pike (épaules)',            'front_delts',            'side_delts triceps', 'aucun'],
  ['Dips sur chaise',                  'triceps',                'chest front_delts', 'aucun'],
  ['Squat poids du corps',             'quads glutes',           'adductors',   'aucun'],
  ['Squat sauté',                      'quads glutes',           'calves',      'aucun'],
  ['Fentes',                           'quads glutes',           'hamstrings adductors', 'aucun'],
  ['Chaise contre le mur',             'quads',                  'glutes',      'aucun'],
  ['Pont fessier',                     'glutes',                 'hamstrings',  'aucun'],
  ['Pont fessier unilatéral',          'glutes',                 'hamstrings',  'aucun'],
  ['Curl nordique',                    'hamstrings',             'glutes calves', 'aucun'],
  ['Mollets sur une marche',           'calves',                 '',            'aucun'],
  ['Superman',                         'lower_back',             'glutes hamstrings', 'aucun'],
  ['Gainage latéral',                  'abs',                    'glutes',      'aucun'],
  ['Mountain climbers',                'abs',                    'quads front_delts', 'aucun'],
  ['Burpees',                          'quads chest',            'front_delts triceps abs', 'aucun'],
].map(([name, primary, secondary, equip]) => Object.freeze({
  name, primary: primary.split(' ').filter(Boolean), secondary: secondary.split(' ').filter(Boolean), equip,
}));
const CATALOGUE_BY_NAME = new Map(EXERCISE_CATALOGUE.map(e => [normName(e.name), e]));

function catalogueNames() { return EXERCISE_CATALOGUE.map(e => e.name); }
// Matériel d'un exercice de la bibliothèque (id d'EQUIPMENT), null pour un nom saisi librement
function equipmentOf(name) { return CATALOGUE_BY_NAME.get(normName(name))?.equip ?? null; }

// ── Reconnaissance d'un nom saisi librement ──────────────────
// Testées dans l'ordre sur le nom normalisé (minuscules, sans accents) : la première qui
// correspond l'emporte, donc les règles précises passent avant les génériques
// (« leg curl » avant « curl », « développé militaire » avant « développé »).
const MUSCLE_RULES = [
  [/leg curl|curl (jambes?|ischio|allonge|couche)|ischio|nordi(c|que)|hamstring/,       'hamstrings', 'calves'],
  [/poignet|wrist|fermier|farmer|grip/,                                                   'forearms', ''],
  [/marteau|hammer/,                                                                      'biceps forearms', ''],
  [/curl|biceps/,                                                                         'biceps', 'forearms'],
  [/roumain|rdl|jambes tendues|stiff|good morning/,                                       'hamstrings glutes', 'lower_back'],
  [/souleve de terre|deadlift/,                                                           'glutes hamstrings lower_back', 'quads traps forearms'],
  [/hip thrust|pont fessier|glute|fessier|kickback (jambe|fess|cable)|abduct/,           'glutes', 'hamstrings'],
  [/adduct/,                                                                              'adductors', ''],
  [/mollet|calf|calves|soleaire|cheville/,                                                'calves', ''],
  [/extension (quadri|des jambes|jambes?)|leg extension|quadri/,                          'quads', ''],
  [/squat|presse|leg press|fente|lunge|step.?up|chaise (contre le|au) mur|wall sit/,                                  'quads glutes', 'adductors'],
  [/developpe.*serree|close.?grip/,                                                       'triceps chest', 'front_delts'],
  [/triceps|barre au front|skull|extension nuque|kickback|pushdown|french press/,         'triceps', ''],
  [/\bdips?\b/,                                                                           'chest triceps', 'front_delts'],
  [/oiseau|arriere|reverse (fly|pec)|face pull|rear delt/,                                'rear_delts', 'traps'],
  [/pull.?over/,                                                                          'lats', 'chest triceps'],
  [/elevations? .*lateral|lateral raise|^laterales?\b/,                                   'side_delts', 'traps'],
  [/frontal|front raise/,                                                                 'front_delts', 'side_delts'],
  [/menton|upright/,                                                                      'side_delts traps', 'biceps'],
  [/shrug|haussement|trapeze/,                                                            'traps', 'forearms'],
  [/militaire|epaule|arnold|overhead|shoulder press|\bohp\b|developpe nuque/,             'front_delts side_delts', 'triceps traps'],
  [/developpe (couche|incline|decline)|bench|chest press|pompe|push.?up|ecarte|pec|butterfly|\bfly|vis.a.vis/, 'chest', 'front_delts triceps'],
  [/traction|pull.?up|chin.?up|tirage (vertical|poitrine|nuque)|lat pull|pulldown/,      'lats', 'biceps rear_delts'],
  [/rowing|\brow\b|tirage|t.?bar/,                                                        'lats traps', 'rear_delts biceps'],
  [/lombaire|extension (du )?dos|hyperextension|back extension|superman/,                 'lower_back', 'glutes hamstrings'],
  [/crunch|abdo|gainage|planche|plank|releve|leg raise|roue|russian|oblique|sit.?up|mountain|hollow/, 'abs', ''],
  [/burpee/,                                                                             'quads chest', 'front_delts triceps abs'],
  [/developpe|press/,                                                                     'chest', 'front_delts triceps'],
].map(([re, primary, secondary]) => [re, primary.split(' ').filter(Boolean), secondary.split(' ').filter(Boolean)]);

const NO_MUSCLES = Object.freeze({ primary: [], secondary: [], source: 'none' });
const musclesCache = new Map();

// Muscles d'un exercice d'après son nom : la bibliothèque d'abord, sinon les règles.
// Renvoie { primary, secondary, source: 'catalogue' | 'rules' | 'none' } (objet partagé, figé).
function musclesOf(name) {
  const key = normName(name);
  if (musclesCache.has(key)) return musclesCache.get(key);
  let res = NO_MUSCLES;
  const known = CATALOGUE_BY_NAME.get(key);
  if (known) res = Object.freeze({ primary: known.primary, secondary: known.secondary, source: 'catalogue' });
  else if (key) {
    const rule = MUSCLE_RULES.find(([re]) => re.test(key));
    if (rule) res = Object.freeze({ primary: rule[1], secondary: rule[2], source: 'rules' });
  }
  musclesCache.set(key, res);
  return res;
}

// Choix de l'utilisateur (Programme › Exercice) : champ facultatif `muscles` d'un exercice du
// programme, liste d'identifiants. Champ additif : une version précédente l'ignore ; une valeur
// illisible ou vide revient à la reconnaissance par le nom.
function chosenMuscles(progEx) {
  const list = Array.isArray(progEx?.muscles) ? [...new Set(progEx.muscles.filter(isMuscleId))] : [];
  return list.length ? list : null;
}

// Exercices du programme dont l'utilisateur a choisi les muscles, par identifiant (exId)
function chosenMusclesIndex(d = data) {
  const map = new Map();
  Object.values(d?.programmes || {}).forEach(p => Object.values(p?.exercises || {}).forEach(list =>
    (Array.isArray(list) ? list : []).forEach(ex => { const m = chosenMuscles(ex); if (m && ex.id) map.set(ex.id, m); })));
  return map;
}

// Muscles d'un exercice du programme, de la séance ou de l'historique ({ id | exId, name, muscles? }).
// index : chosenMusclesIndex() déjà calculé, pour les boucles sur tout l'historique.
function exerciseMuscles(ex, index = null) {
  const own = chosenMuscles(ex);
  if (own) return { primary: own, secondary: [], source: 'user' };
  const id = exIdOf(ex);
  const chosen = id ? (index || chosenMusclesIndex()).get(id) : null;
  if (chosen) return { primary: chosen, secondary: [], source: 'user' };
  const declared = declaredMuscles(ex?.name);
  if (declared) return { primary: declared, secondary: [], source: 'user' };
  return musclesOf(ex?.name);
}

// Muscles déclarés pour un nom d'exercice (data.exerciseMuscles), quel que soit l'endroit où il est fait
// (séance libre, exercice ajouté en séance, historique) ; null si aucun
function declaredMuscles(name, d = data) {
  const list = d?.exerciseMuscles?.[normName(name)];
  return Array.isArray(list) && list.length ? list.filter(isMuscleId) : null;
}

// Déclare (liste) ou efface (null : retour à la reconnaissance par le nom) les muscles d'un nom d'exercice
function setDeclaredMuscles(name, list, d = data) {
  const key = normName(name);
  if (!key) return;
  const clean = [...new Set((list || []).filter(isMuscleId))];
  if (clean.length) (d.exerciseMuscles ||= {})[key] = clean;
  else if (d.exerciseMuscles) { delete d.exerciseMuscles[key]; if (!Object.keys(d.exerciseMuscles).length) delete d.exerciseMuscles; }
  // Un choix fait dans Programme › Exercice (ex.muscles) primerait sur celui-ci : il suit le même choix
  Object.values(d.programmes || {}).forEach(p => Object.values(p?.exercises || {}).forEach(xs => (xs || []).forEach(ex => {
    if (normName(ex.name) !== key || !ex.muscles) return;
    if (clean.length) ex.muscles = clean; else delete ex.muscles;
  })));
}

// Exercices faits sans muscles connus (nom affiché, nombre de séances), les plus fréquents d'abord
function unknownMuscleExercises(history = data.history, index = chosenMusclesIndex()) {
  const seen = new Map();
  (history || []).forEach(h => (h.exercises || []).forEach(e => {
    if (exerciseMuscles(e, index).primary.length) return;
    const k = normName(e.name);
    if (!k) return;
    const cur = seen.get(k) || { name: e.name, count: 0 };
    cur.count++; seen.set(k, cur);
  }));
  return [...seen.values()].sort((a, b) => b.count - a.count);
}

// Libellé court pour une ligne de liste : « Pectoraux · Épaules » (principaux seulement, noms
// regroupés), '' si inconnu
function musclesLine(m, max = 2) {
  const names = [...new Set(m.primary.map(id => MUSCLE_BY_ID.get(id).short || muscleLabel(id)))];
  return names.slice(0, max).join(' · ');
}
