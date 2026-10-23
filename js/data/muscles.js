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
// [nom, muscles principaux, muscles secondaires, matériel (EQUIPMENT), alias facultatifs séparés par « | »] ; tous les exercices de PROGRAMMES y figurent
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
  ['Développé couché barre',           'chest',                  'front_delts triceps', 'salle', 'bench press|dc'],
  ['Développé couché haltères',        'chest',                  'front_delts triceps', 'halteres'],
  ['Développé incliné barre',          'chest front_delts',      'triceps', 'salle'],
  ['Développé incliné haltères',       'chest front_delts',      'triceps', 'halteres'],
  ['Développé décliné',                'chest',                  'triceps', 'salle'],
  ['Développé couché machine',         'chest',                  'front_delts triceps', 'salle'],
  ['Écarté haltères plat',             'chest',                  'front_delts', 'halteres'],
  ['Écarté poulie vis-à-vis',          'chest',                  'front_delts', 'salle'],
  ['Pec deck',                         'chest',                  'front_delts', 'salle', 'écarté machine|butterfly'],
  ['Pompes',                           'chest',                  'front_delts triceps abs', 'aucun', 'push-up|push up'],
  ['Dips',                             'chest triceps',          'front_delts', 'barre'],
  // Dos
  ['Soulevé de terre',                 'glutes hamstrings lower_back', 'quads traps forearms', 'salle', 'deadlift|sdt'],
  ['Tractions pronation',              'lats',                   'biceps rear_delts forearms', 'barre', 'pull-ups|pull up|traction'],
  ['Tractions prise serrée',           'lats biceps',            'forearms', 'barre'],
  ['Tirage vertical prise large',      'lats',                   'biceps rear_delts', 'salle'],
  ['Tirage vertical prise serrée',     'lats',                   'biceps', 'salle'],
  ['Tirage horizontal câble',          'lats traps',             'rear_delts biceps', 'salle'],
  ['Rowing barre',                     'lats traps',             'rear_delts biceps lower_back', 'salle'],
  ['Rowing haltère unilatéral',        'lats',                   'traps rear_delts biceps', 'halteres'],
  ['Rowing barre T',                     'lats traps',             'rear_delts biceps', 'salle', 'rowing t-bar|t bar'],
  ['Pull-over poulie',                 'lats',                   'chest triceps', 'salle'],
  ['Haussements d\'épaules haltères',                  'traps',                  'forearms', 'halteres', 'shrugs haltères|shrug'],
  ['Extension lombaires',              'lower_back',             'glutes hamstrings', 'salle'],
  ['Face pull',                        'rear_delts',             'traps side_delts', 'salle', 'tirage visage|tirage corde'],
  // Épaules
  ['Développé militaire barre',        'front_delts side_delts', 'triceps traps', 'salle', 'ohp|overhead press|military press'],
  ['Développé militaire haltères',     'front_delts side_delts', 'triceps traps', 'halteres'],
  ['Développé Arnold',                 'front_delts side_delts', 'triceps', 'halteres'],
  ['Élévations latérales',             'side_delts',             'traps', 'halteres', 'lateral raise'],
  ['Élévations latérales poulie',      'side_delts',             'traps', 'salle'],
  ['Élévations frontales',             'front_delts',            'side_delts', 'halteres'],
  ['Oiseau (élévations arrière)',      'rear_delts',             'traps', 'halteres', 'reverse fly|élévations arrière'],
  ['Rowing menton',                    'side_delts traps',       'biceps', 'salle', 'upright row|tirage menton'],
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
  ['Kickback triceps',                 'triceps',                '', 'halteres', 'extension triceps buste penché'],
  ['Curl poignets',                    'forearms',               '', 'halteres'],
  ['Marche du fermier',                'forearms traps',         'abs', 'halteres'],
  // Abdominaux
  ['Crunch',                           'abs',                    '', 'aucun'],
  ['Crunch poulie',                    'abs',                    '', 'salle'],
  ['Gainage (planche)',                'abs',                    'lower_back', 'aucun', 'planche|plank'],
  ['Relevés de jambes',                'abs',                    '', 'aucun'],
  ['Roue abdominale',                  'abs',                    'lats', 'salle', 'ab wheel'],
  ['Rotations russes',                    'abs',                    '', 'aucun', 'russian twist'],
  // Jambes
  ['Squat barre',                      'quads glutes',           'adductors lower_back', 'salle'],
  ['Squat avant',                      'quads',                  'glutes abs', 'salle', 'front squat'],
  ['Squat gobelet',                     'quads glutes',           'adductors', 'halteres', 'goblet squat'],
  ['Hack squat',                       'quads',                  'glutes', 'salle', 'squat machine'],
  ['Presse à cuisses',                 'quads glutes',           'adductors', 'salle', 'leg press'],
  ['Fentes marchées haltères',         'quads glutes',           'hamstrings adductors', 'halteres'],
  ['Fentes bulgares',                  'quads glutes',           'hamstrings adductors', 'halteres'],
  ['Extension quadriceps',             'quads',                  '', 'salle', 'leg extension'],
  ['Leg curl machine',                 'hamstrings',             'calves', 'salle', 'curl ischios machine|curl jambes'],
  ['Soulevé de terre roumain',         'hamstrings glutes',      'lower_back', 'salle', 'rdl|romanian deadlift'],
  ['Hip thrust',                       'glutes',                 'hamstrings', 'salle', 'poussée de hanches'],
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
  ['Hip thrust haltère',               'glutes',                 'hamstrings',  'halteres', 'poussée de hanches haltère'],
  ['Montées sur banc haltères',                 'quads glutes',           'hamstrings',  'halteres', 'step-up haltères|step up'],
  // Barre de traction et barres à dips
  ['Tractions supination',             'lats biceps',            'forearms',    'barre', 'chin-up|chin up'],
  ['Tractions australiennes',          'lats traps',             'rear_delts biceps', 'barre', 'rowing inversé|inverted row'],
  ['Relevés de genoux suspendu',       'abs',                    'forearms',    'barre'],
  // Sans matériel (poids du corps)
  ['Pompes inclinées',                 'chest',                  'front_delts triceps', 'aucun'],
  ['Pompes déclinées',                 'chest front_delts',      'triceps abs', 'aucun'],
  ['Pompes diamant',                   'triceps chest',          'front_delts', 'aucun'],
  ['Pompes pike (épaules)',            'front_delts',            'side_delts triceps', 'aucun'],
  ['Dips sur chaise',                  'triceps',                'chest front_delts', 'aucun'],
  ['Squat poids du corps',             'quads glutes',           'adductors',   'aucun', 'air squat'],
  ['Squat sauté',                      'quads glutes',           'calves',      'aucun'],
  ['Fentes',                           'quads glutes',           'hamstrings adductors', 'aucun'],
  ['Chaise contre le mur',             'quads',                  'glutes',      'aucun', 'wall sit'],
  ['Pont fessier',                     'glutes',                 'hamstrings',  'aucun', 'glute bridge'],
  ['Pont fessier unilatéral',          'glutes',                 'hamstrings',  'aucun'],
  ['Curl nordique',                    'hamstrings',             'glutes calves', 'aucun', 'nordic curl'],
  ['Mollets sur une marche',           'calves',                 '',            'aucun'],
  ['Superman',                         'lower_back',             'glutes hamstrings', 'aucun'],
  ['Gainage latéral',                  'abs',                    'glutes',      'aucun'],
  ['Grimpeur',                'abs',                    'quads front_delts', 'aucun', 'mountain climbers|mountain climber'],
  ['Burpees',                          'quads chest',            'front_delts triceps abs', 'aucun'],
].map(([name, primary, secondary, equip, aliases = '']) => Object.freeze({
  name, primary: primary.split(' ').filter(Boolean), secondary: secondary.split(' ').filter(Boolean), equip,
  aliases: Object.freeze(aliases.split('|').map(a => a.trim()).filter(Boolean)),
}));
// Par nom normalisé et par alias : un ancien nom (« Pull-ups ») ou le nom anglais retrouve sa fiche
const CATALOGUE_BY_NAME = new Map(EXERCISE_CATALOGUE.flatMap(e =>
  [e.name, ...e.aliases].map(n => [normName(n), e])));

function catalogueNames() { return EXERCISE_CATALOGUE.map(e => e.name); }
// Matériel d'un exercice de la bibliothèque (id d'EQUIPMENT), null pour un nom saisi librement
function equipmentOf(name) { return CATALOGUE_BY_NAME.get(normName(name))?.equip ?? null; }
// Fiche de la bibliothèque d'un nom (nom exact, alias ou abréviation développée), null sinon
function catalogueEntry(name) { return CATALOGUE_BY_NAME.get(normName(name)) || CATALOGUE_BY_NAME.get(ruleKey(name)) || null; }

// ── Clé de reconnaissance : abréviations de salle développées ─
// Le nom normalisé (normName) reste la clé de stockage ; celle-ci ne sert qu'à reconnaître et chercher,
// pour que « DC incliné smith », « SDT sumo » ou « Face-pull » soient compris comme leurs noms complets.
const ABBREVIATIONS = [
  [/\bdc\b/g, 'developpe couche'], [/\bdi\b/g, 'developpe incline'], [/\bdm\b/g, 'developpe militaire'],
  [/\bdev\b/g, 'developpe'], [/\bsdt\b/g, 'souleve de terre'], [/\bext\b/g, 'extension'],
  [/\bkb\b/g, 'kettlebell'], [/\bghr\b/g, 'glute ham raise'],
];
function ruleKey(name) {
  let k = normName(name).replace(/[-_/.]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, full] of ABBREVIATIONS) k = k.replace(re, full);
  return k;
}

// Mots significatifs d'un nom pour comparer deux exercices (pluriel retiré, mots courts ignorés)
const STOP_WORDS = new Set(['avec', 'les', 'des', 'sur', 'aux', 'une', 'par', 'prise', 'machine', 'poulie']);
function nameWords(name) {
  return ruleKey(name).split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w)).map(w => w.replace(/s$/, ''));
}

// Exercices de la bibliothèque au nom proche (mots en commun), pour proposer leurs muscles
// quand un nom saisi n'est pas reconnu : les plus proches d'abord, au plus n
function similarExercises(name, n = 3) {
  const words = new Set(nameWords(name));
  if (!words.size) return [];
  return EXERCISE_CATALOGUE
    .map(e => ({ e, score: [e.name, ...e.aliases].reduce((best, nm) => Math.max(best, nameWords(nm).filter(w => words.has(w)).length), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.e.name.length - b.e.name.length)
    .slice(0, n).map(x => x.e);
}

// Recherche de la feuille d'ajout : chaque mot tapé doit se retrouver (dans n'importe quel ordre) dans
// le nom, un alias ou un muscle principal (« biceps » trouve les curls, « dc » le développé couché)
function exerciseMatches(name, query) {
  const q = ruleKey(query).split(' ').filter(Boolean);
  if (!q.length) return true;
  const entry = catalogueEntry(name);
  const muscles = exerciseMuscles({ name }).primary.map(id => normName(muscleLabel(id))).join(' ');
  const hay = [ruleKey(name), ...(entry ? entry.aliases.map(ruleKey) : []), muscles].join(' ');
  return q.every(w => hay.includes(w.replace(/s$/, '')));
}

// ── Reconnaissance d'un nom saisi librement ──────────────────
// Testées dans l'ordre sur le nom normalisé (minuscules, sans accents) : la première qui
// correspond l'emporte, donc les règles précises passent avant les génériques
// (« leg curl » avant « curl », « développé militaire » avant « développé »).
const MUSCLE_RULES = [
  [/leg curl|curl (jambes?|ischio|allonge|couche|assis)|ischio|nordi(c|que)|hamstring|glute ham/,  'hamstrings', 'calves'],
  [/developpe.*serree|close grip|jm press|tate press/,                                    'triceps chest', 'front_delts'],
  [/poignet|wrist|fermier|farmer|\bgrip\b/,                                               'forearms', ''],
  [/marteau|hammer curl|curl hammer/,                                                     'biceps forearms', ''],
  [/curl|biceps/,                                                                         'biceps', 'forearms'],
  [/roumain|rdl|jambes tendues|stiff|good morning/,                                       'hamstrings glutes', 'lower_back'],
  [/souleve de terre|deadlift|rack pull|hex bar|trap bar/,                                'glutes hamstrings lower_back', 'quads traps forearms'],
  [/swing|kettlebell|arrache|snatch|epaule jete|\bclean\b/,                               'glutes hamstrings', 'lower_back traps'],
  [/hip thrust|pont fessier|glute|fessier|kickback (jambe|fess|cable)|abduct|reverse hyper/, 'glutes', 'hamstrings'],
  [/adduct/,                                                                              'adductors', ''],
  [/mollet|calf|calves|soleaire|cheville/,                                                'calves', ''],
  [/extension (quadri|des jambes|jambes?)|leg extension|quadri/,                          'quads', ''],
  [/squat|presse|leg press|fente|lunge|step ?up|chaise (contre le|au) mur|wall sit|\bhack\b|bulgare|montee/, 'quads glutes', 'adductors'],
  [/triceps|barre au front|skull|extension nuque|kickback|pushdown|french press/,         'triceps', ''],
  [/\bdips?\b/,                                                                           'chest triceps', 'front_delts'],
  [/oiseau|arriere|reverse (fly|pec)|(pec deck|butterfly|fly|ecarte) invers|face pull|rear delt/, 'rear_delts', 'traps'],
  [/pull ?over/,                                                                          'lats', 'chest triceps'],
  [/elevations? .*lateral|lateral raise|^laterales?\b|y raise/,                           'side_delts', 'traps'],
  [/frontal|front raise/,                                                                 'front_delts', 'side_delts'],
  [/menton|upright/,                                                                      'side_delts traps', 'biceps'],
  [/shrug|haussement|trapeze/,                                                            'traps', 'forearms'],
  [/crunch|abdo|gainage|planche|plank|\breleve|leg raise|roue|ab wheel|russian|rotations? russes?|oblique|sit ?up|mountain|grimpeur|hollow|pallof|get ?up|turc/, 'abs', ''],
  [/militaire|military|epaule|arnold|overhead|shoulder press|\bohp\b|push press|\bz press|viking|landmine|developpe nuque/, 'front_delts side_delts', 'triceps traps'],
  [/ecarte|pec deck|\bpecs?\b|butterfly|\bfly\b|vis a vis|crossover|croise/,               'chest', 'front_delts'],
  [/(developpe|press|bench).*incline|incline.*(press|bench)/,                             'chest front_delts', 'triceps'],
  [/developpe (couche|decline)|bench|chest press|pompe|push ?up/,                         'chest', 'front_delts triceps'],
  [/traction|pull ?up|chin ?up|tirage (vertical|poitrine|nuque)|lat pull|pull ?down/,     'lats', 'biceps rear_delts'],
  [/rowing|\brow\b|tirage|t ?bar/,                                                        'lats traps', 'rear_delts biceps'],
  [/lombaire|extension (du )?dos|hyperextension|back extension|superman/,                 'lower_back', 'glutes hamstrings'],
  [/burpee/,                                                                              'quads chest', 'front_delts triceps abs'],
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
  const known = catalogueEntry(name);
  if (known) res = Object.freeze({ primary: known.primary, secondary: known.secondary, source: 'catalogue' });
  else if (key) {
    const rk = ruleKey(name);
    const rule = MUSCLE_RULES.find(([re]) => re.test(rk));
    if (rule) res = Object.freeze({ primary: rule[1], secondary: rule[2], source: 'rules' });
  }
  musclesCache.set(key, res);
  return res;
}

// Choix de l'utilisateur (Programme › Exercice) : champs facultatifs `muscles` (principaux) et
// `musclesSecondary` d'un exercice du programme, listes d'identifiants. Champs additifs : une version
// précédente les ignore ; une valeur illisible ou vide revient à la reconnaissance par le nom.
function cleanMuscleList(v) { return Array.isArray(v) ? [...new Set(v.filter(isMuscleId))] : []; }
function chosenMuscles(progEx) {
  const list = cleanMuscleList(progEx?.muscles);
  return list.length ? list : null;
}
// Secondaires choisis (comptent pour une demi-série), jamais en double avec les principaux
function chosenSecondary(progEx, primary = chosenMuscles(progEx) || []) {
  return cleanMuscleList(progEx?.musclesSecondary).filter(id => !primary.includes(id));
}

// Exercices du programme dont l'utilisateur a choisi les muscles, par identifiant (exId) : { primary, secondary }
function chosenMusclesIndex(d = data) {
  const map = new Map();
  Object.values(d?.programmes || {}).forEach(p => Object.values(p?.exercises || {}).forEach(list =>
    (Array.isArray(list) ? list : []).forEach(ex => {
      const m = chosenMuscles(ex);
      if (m && ex.id) map.set(ex.id, { primary: m, secondary: chosenSecondary(ex, m) });
    })));
  return map;
}

// Muscles d'un exercice du programme, de la séance ou de l'historique ({ id | exId, name, muscles? }).
// index : chosenMusclesIndex() déjà calculé, pour les boucles sur tout l'historique.
function exerciseMuscles(ex, index = null) {
  const own = chosenMuscles(ex);
  if (own) return { primary: own, secondary: chosenSecondary(ex, own), source: 'user' };
  const id = exIdOf(ex);
  const chosen = id ? (index || chosenMusclesIndex()).get(id) : null;
  if (chosen) return { ...chosen, source: 'user' };
  const declared = declaredMuscles(ex?.name);
  if (declared) return { primary: declared, secondary: declaredSecondary(ex?.name).filter(id => !declared.includes(id)), source: 'user' };
  return musclesOf(ex?.name);
}

// Muscles déclarés pour un nom d'exercice (data.exerciseMuscles : principaux ; data.exerciseMusclesSecondary :
// secondaires), quel que soit l'endroit où il est fait (séance libre, ajouté en séance, historique) ; null si aucun
function declaredMuscles(name, d = data) {
  const list = d?.exerciseMuscles?.[normName(name)];
  return Array.isArray(list) && list.length ? list.filter(isMuscleId) : null;
}
function declaredSecondary(name, d = data) { return cleanMuscleList(d?.exerciseMusclesSecondary?.[normName(name)]); }

// Déclare ou efface (null : retour à la reconnaissance par le nom) les muscles d'un nom d'exercice.
// value : liste de principaux, ou { primary, secondary }.
function setDeclaredMuscles(name, value, d = data) {
  const key = normName(name);
  if (!key) return;
  const clean = cleanMuscleList(Array.isArray(value) ? value : value?.primary);
  const sec   = clean.length && !Array.isArray(value) ? cleanMuscleList(value?.secondary).filter(id => !clean.includes(id)) : [];
  const put = (field, list) => {
    if (list.length) (d[field] ||= {})[key] = list;
    else if (d[field]) { delete d[field][key]; if (!Object.keys(d[field]).length) delete d[field]; }
  };
  put('exerciseMuscles', clean);
  put('exerciseMusclesSecondary', sec);
  // Un choix fait dans Programme › Exercice (ex.muscles) primerait sur celui-ci : il suit le même choix
  Object.values(d.programmes || {}).forEach(p => Object.values(p?.exercises || {}).forEach(xs => (xs || []).forEach(ex => {
    if (normName(ex.name) !== key || !ex.muscles) return;
    if (clean.length) ex.muscles = clean; else delete ex.muscles;
    if (sec.length) ex.musclesSecondary = sec; else delete ex.musclesSecondary;
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
