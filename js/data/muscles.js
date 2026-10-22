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
// [nom, muscles principaux, muscles secondaires] ; tous les exercices de PROGRAMMES y figurent
// (vérifié par les tests unitaires). Elle complète aussi la recherche de la feuille d'ajout.
const EXERCISE_CATALOGUE = [
  // Pectoraux
  ['Développé couché barre',           'chest',                  'front_delts triceps'],
  ['Développé couché haltères',        'chest',                  'front_delts triceps'],
  ['Développé incliné barre',          'chest front_delts',      'triceps'],
  ['Développé incliné haltères',       'chest front_delts',      'triceps'],
  ['Développé décliné',                'chest',                  'triceps'],
  ['Développé couché machine',         'chest',                  'front_delts triceps'],
  ['Écarté haltères plat',             'chest',                  'front_delts'],
  ['Écarté poulie vis-à-vis',          'chest',                  'front_delts'],
  ['Pec deck',                         'chest',                  'front_delts'],
  ['Pompes',                           'chest',                  'front_delts triceps abs'],
  ['Dips',                             'chest triceps',          'front_delts'],
  // Dos
  ['Soulevé de terre',                 'glutes hamstrings lower_back', 'quads traps forearms'],
  ['Pull-ups',                         'lats',                   'biceps rear_delts forearms'],
  ['Tractions prise serrée',           'lats biceps',            'forearms'],
  ['Tirage vertical prise large',      'lats',                   'biceps rear_delts'],
  ['Tirage vertical prise serrée',     'lats',                   'biceps'],
  ['Tirage horizontal câble',          'lats traps',             'rear_delts biceps'],
  ['Rowing barre',                     'lats traps',             'rear_delts biceps lower_back'],
  ['Rowing haltère unilatéral',        'lats',                   'traps rear_delts biceps'],
  ['Rowing T-bar',                     'lats traps',             'rear_delts biceps'],
  ['Pull-over poulie',                 'lats',                   'chest triceps'],
  ['Shrugs haltères',                  'traps',                  'forearms'],
  ['Extension lombaires',              'lower_back',             'glutes hamstrings'],
  ['Face pull',                        'rear_delts',             'traps side_delts'],
  // Épaules
  ['Développé militaire barre',        'front_delts side_delts', 'triceps traps'],
  ['Développé militaire haltères',     'front_delts side_delts', 'triceps traps'],
  ['Développé Arnold',                 'front_delts side_delts', 'triceps'],
  ['Élévations latérales',             'side_delts',             'traps'],
  ['Élévations latérales poulie',      'side_delts',             'traps'],
  ['Élévations frontales',             'front_delts',            'side_delts'],
  ['Oiseau (élévations arrière)',      'rear_delts',             'traps'],
  ['Rowing menton',                    'side_delts traps',       'biceps'],
  // Bras
  ['Curl biceps barre',                'biceps',                 'forearms'],
  ['Curl biceps haltères',             'biceps',                 'forearms'],
  ['Curl marteau',                     'biceps forearms',        ''],
  ['Curl pupitre',                     'biceps',                 'forearms'],
  ['Curl incliné',                     'biceps',                 'forearms'],
  ['Curl poulie',                      'biceps',                 'forearms'],
  ['Curl concentration',               'biceps',                 ''],
  ['Extension triceps poulie',         'triceps',                ''],
  ['Extension triceps unilatéral',     'triceps',                ''],
  ['Extension nuque',                  'triceps',                ''],
  ['Barre au front',                   'triceps',                ''],
  ['Développé couché prise serrée',    'triceps chest',          'front_delts'],
  ['Kickback triceps',                 'triceps',                ''],
  ['Curl poignets',                    'forearms',               ''],
  ['Marche du fermier',                'forearms traps',         'abs'],
  // Abdominaux
  ['Crunch',                           'abs',                    ''],
  ['Crunch poulie',                    'abs',                    ''],
  ['Gainage (planche)',                'abs',                    'lower_back'],
  ['Relevés de jambes',                'abs',                    ''],
  ['Roue abdominale',                  'abs',                    'lats'],
  ['Russian twist',                    'abs',                    ''],
  // Jambes
  ['Squat barre',                      'quads glutes',           'adductors lower_back'],
  ['Front squat',                      'quads',                  'glutes abs'],
  ['Goblet squat',                     'quads glutes',           'adductors'],
  ['Hack squat',                       'quads',                  'glutes'],
  ['Presse à cuisses',                 'quads glutes',           'adductors'],
  ['Fentes marchées haltères',         'quads glutes',           'hamstrings adductors'],
  ['Fentes bulgares',                  'quads glutes',           'hamstrings adductors'],
  ['Extension quadriceps',             'quads',                  ''],
  ['Leg curl machine',                 'hamstrings',             'calves'],
  ['Soulevé de terre roumain',         'hamstrings glutes',      'lower_back'],
  ['Hip thrust',                       'glutes',                 'hamstrings'],
  ['Abducteurs machine',               'glutes',                 ''],
  ['Adducteurs machine',               'adductors',              ''],
  ['Mollets debout',                   'calves',                 ''],
  ['Mollets assis',                    'calves',                 ''],
].map(([name, primary, secondary]) => Object.freeze({
  name, primary: primary.split(' ').filter(Boolean), secondary: secondary.split(' ').filter(Boolean),
}));
const CATALOGUE_BY_NAME = new Map(EXERCISE_CATALOGUE.map(e => [normName(e.name), e]));

function catalogueNames() { return EXERCISE_CATALOGUE.map(e => e.name); }

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
  [/squat|presse|leg press|fente|lunge|step.?up|chaise/,                                  'quads glutes', 'adductors'],
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
