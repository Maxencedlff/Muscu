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

// ── Clé de reconnaissance : abréviations de salle développées ─
// Le nom normalisé (normName) reste la clé de stockage ; celle-ci ne sert qu'à reconnaître et chercher,
// pour que « DC incliné smith », « SDT sumo » ou « Face-pull » soient compris comme leurs noms complets.
const ABBREVIATIONS = [
  [/\bdc (incline|decline)/g, 'developpe $1'], [/\bdc\b/g, 'developpe couche'], [/\bdi\b/g, 'developpe incline'], [/\bdm\b/g, 'developpe militaire'],
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

// ── Recherche de la feuille d'ajout ─────────────────────────
// Chaque mot tapé doit commencer un mot du nom, d'un alias ou d'un muscle (« fesses », « dos », « bras »…),
// dans n'importe quel ordre, avec une faute tolérée (« hip trust », « squatt », « dévelopé ») sur les mots
// de 4 lettres et plus. Par début de mot, pour que « vélo » ne trouve pas « déVELOppé ».
const MUSCLE_WORDS = {
  chest: 'pectoraux pecs poitrine', front_delts: 'epaules', side_delts: 'epaules', rear_delts: 'epaules arriere',
  traps: 'trapezes', lats: 'dos dorsaux', lower_back: 'lombaires dos', biceps: 'biceps bras', triceps: 'triceps bras',
  forearms: 'avant bras', abs: 'abdos abdominaux ventre', glutes: 'fessiers fesses', quads: 'quadriceps cuisses jambes',
  hamstrings: 'ischios jambiers jambes', adductors: 'adducteurs', calves: 'mollets',
};
const plainWord = w => w.replace(/s$/, '');
// Distance d'édition avec transposition (Damerau, version restreinte), arrêtée au-delà de max
function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
function searchWords(name) {
  const entry = catalogueEntry(name);
  const texts = [name, ...(entry ? entry.aliases : [])].map(ruleKey);
  const muscles = exerciseMuscles({ name }).primary.map(id => MUSCLE_WORDS[id] || '').join(' ');
  // Mots séparés, plus chaque nom en un seul mot (« hipthrust »)
  return [...new Set([...texts.join(' ').split(' '), ...texts.map(t => t.replace(/ /g, '')), ...muscles.split(' ')]
    .filter(Boolean).map(plainWord))];
}
// Score d'un exercice pour une recherche : 0 absent, 1 trouvé avec une faute, 2 trouvé, 3 le nom commence par la recherche
function exerciseMatchScore(name, query) {
  const q = ruleKey(query).split(' ').filter(Boolean).map(plainWord);
  if (!q.length) return 2;
  const words = searchWords(name);
  let fuzzy = false;
  for (const w of q) {
    if (words.some(h => h.startsWith(w))) continue;
    const tol = w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0;
    if (tol && words.some(h => editDistance(w, h.slice(0, w.length + 1), tol) <= tol || editDistance(w, h, tol) <= tol)) { fuzzy = true; continue; }
    return 0;
  }
  if (fuzzy) return 1;
  return ruleKey(name).startsWith(ruleKey(query)) ? 3 : 2;
}
function exerciseMatches(name, query) { return exerciseMatchScore(name, query) > 0; }

// ── Reconnaissance d'un nom saisi librement ──────────────────
// Testées dans l'ordre sur le nom normalisé (minuscules, sans accents) : la première qui
// correspond l'emporte, donc les règles précises passent avant les génériques
// (« leg curl » avant « curl », « développé militaire » avant « développé »).
const MUSCLE_RULES = [
  [/leg curl|curl (jambes?|ischio|allonge|couche|assis)|ischio|nordi(c|que)|hamstring|glute ham/,  'hamstrings', 'calves'],
  [/developpe.*serree|close grip|jm press|tate press/,                                    'triceps chest', 'front_delts'],
  [/poignet|wrist|fermier|farmer|\bgrip\b|suspension|dead hang/,                                               'forearms', ''],
  [/marteau|hammer curl|curl hammer/,                                                     'biceps forearms', ''],
  [/curl|biceps/,                                                                         'biceps', 'forearms'],
  [/roumain|rdl|jambes tendues|stiff|good morning/,                                       'hamstrings glutes', 'lower_back'],
  [/souleve de terre|deadlift|rack pull|hex bar|trap bar/,                                'glutes hamstrings lower_back', 'quads traps forearms'],
  [/swing|arrache|snatch|epaule jete|\bclean\b/,                               'glutes hamstrings', 'lower_back traps'],
  [/hip thrust|pont fessier|glute|fessier|kickback (jambe|fess|cable)|abduct|reverse hyper|clamshell|coquillage|marche laterale|monster walk/, 'glutes', 'hamstrings'],
  [/adduct/,                                                                              'adductors', ''],
  [/mollet|calf|calves|soleaire|cheville/,                                                'calves', ''],
  [/extension (quadri|des jambes|jambes?)|leg extension|quadri/,                          'quads', ''],
  [/squat|presse|leg press|fente|lunge|step ?up|chaise (contre le|au) mur|wall sit|\bhack\b|bulgare|montee|thruster|pistol|pendulum/, 'quads glutes', 'adductors'],
  [/triceps|barre au front|skull|extension nuque|kickback|pushdown|french press/,         'triceps', ''],
  [/\bdips?\b/,                                                                           'chest triceps', 'front_delts'],
  [/oiseau|arriere|reverse (fly|pec)|(pec deck|butterfly|fly|ecarte) invers|face pull|rear delt|pull ?apart|rotation (externe|interne)/, 'rear_delts', 'traps'],
  [/pull ?over/,                                                                          'lats', 'chest triceps'],
  [/elevations? .*lateral|lateral raise|^laterales?\b|y raise/,                           'side_delts', 'traps'],
  [/frontal|front raise/,                                                                 'front_delts', 'side_delts'],
  [/menton|upright/,                                                                      'side_delts traps', 'biceps'],
  [/shrug|haussement|trapeze/,                                                            'traps', 'forearms'],
  [/crunch|abdo|gainage|planche|plank|\breleve|leg raise|roue|ab wheel|russian|rotations? russes?|oblique|sit ?up|mountain|grimpeur|hollow|pallof|get ?up|turc|dead bug|bird dog|\bl sit|toes to bar/, 'abs', ''],
  [/militaire|military|epaule|arnold|overhead|shoulder press|\bohp\b|push press|\bz press|viking|landmine|developpe nuque|halo/, 'front_delts side_delts', 'triceps traps'],
  [/ecarte|pec deck|\bpecs?\b|butterfly|\bfly\b|vis a vis|crossover|croise/,               'chest', 'front_delts'],
  [/(developpe|press|bench).*incline|incline.*(press|bench)/,                             'chest front_delts', 'triceps'],
  [/developpe (couche|decline)|bench|chest press|pompe|push ?up/,                         'chest', 'front_delts triceps'],
  [/traction|pull ?up|chin ?up|muscle ?up|front lever|tirage (vertical|poitrine|nuque)|lat pull|pull ?down/,     'lats', 'biceps rear_delts'],
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
