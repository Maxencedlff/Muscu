// ═══════════════════════════════════════════════════════════
//  Bibliothèque d'exercices : muscles, matériel, alias, progressions
//  Données pures, lues par js/data/muscles.js (reconnaissance) et la feuille d'ajout
// ═══════════════════════════════════════════════════════════
'use strict';

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
  { id: 'elastique', label: 'Élastiques' },
  { id: 'kettlebell', label: 'Kettlebell' },
  { id: 'salle',    label: 'Salle' },
];
const EXERCISE_CATALOGUE = [
  // Pectoraux
  ['Développé couché barre',           'chest',                  'front_delts triceps', 'salle', 'bench press|dc|bp'],
  ['Développé couché haltères',        'chest',                  'front_delts triceps', 'halteres', 'dumbbell bench press'],
  ['Développé incliné barre',          'chest front_delts',      'triceps', 'salle'],
  ['Développé incliné haltères',       'chest front_delts',      'triceps', 'halteres', 'incline dumbbell press'],
  ['Développé décliné',                'chest',                  'triceps', 'salle'],
  ['Développé couché machine',         'chest',                  'front_delts triceps', 'salle', 'chest press'],
  ['Écarté haltères plat',             'chest',                  'front_delts', 'halteres'],
  ['Écarté poulie vis-à-vis',          'chest',                  'front_delts', 'salle', 'cable fly|crossover|écarté poulie'],
  ['Pec deck',                         'chest',                  'front_delts', 'salle', 'écarté machine|butterfly|peck deck'],
  ['Pompes',                           'chest',                  'front_delts triceps abs', 'aucun', 'push-up|push up'],
  ['Dips',                             'chest triceps',          'front_delts', 'barre', 'barres parallèles'],
  // Dos
  ['Soulevé de terre',                 'glutes hamstrings lower_back', 'quads traps forearms', 'salle', 'deadlift|sdt'],
  ['Tractions pronation',              'lats',                   'biceps rear_delts forearms', 'barre', 'pull-ups|pull up|traction'],
  ['Tractions prise serrée',           'lats biceps',            'forearms', 'barre'],
  ['Tirage vertical prise large',      'lats',                   'biceps rear_delts', 'salle', 'tirage poitrine|lat pulldown|poulie haute|pulldown'],
  ['Tirage vertical prise serrée',     'lats',                   'biceps', 'salle'],
  ['Tirage horizontal câble',          'lats traps',             'rear_delts biceps', 'salle', 'seated row|rowing assis|tirage assis|poulie basse'],
  ['Rowing barre',                     'lats traps',             'rear_delts biceps lower_back', 'salle', 'barbell row|rowing buste penché barre'],
  ['Rowing haltère unilatéral',        'lats',                   'traps rear_delts biceps', 'halteres', 'dumbbell row|rowing un bras'],
  ['Rowing barre T',                     'lats traps',             'rear_delts biceps', 'salle', 'rowing t-bar|t bar'],
  ['Pull-over poulie',                 'lats',                   'chest triceps', 'salle'],
  ['Haussements d\'épaules haltères',                  'traps',                  'forearms', 'halteres', 'shrugs haltères|shrug'],
  ['Extension lombaires',              'lower_back',             'glutes hamstrings', 'salle', 'hyperextension|banc lombaire'],
  ['Face pull',                        'rear_delts',             'traps side_delts', 'salle', 'tirage visage|tirage corde'],
  // Épaules
  ['Développé militaire barre',        'front_delts side_delts', 'triceps traps', 'salle', 'ohp|overhead press|military press'],
  ['Développé militaire haltères',     'front_delts side_delts', 'triceps traps', 'halteres', 'shoulder press haltères|dumbbell shoulder press'],
  ['Développé Arnold',                 'front_delts side_delts', 'triceps', 'halteres'],
  ['Élévations latérales',             'side_delts',             'traps', 'halteres', 'lateral raise'],
  ['Élévations latérales poulie',      'side_delts',             'traps', 'salle'],
  ['Élévations frontales',             'front_delts',            'side_delts', 'halteres'],
  ['Oiseau (élévations arrière)',      'rear_delts',             'traps', 'halteres', 'reverse fly|élévations arrière'],
  ['Rowing menton',                    'side_delts traps',       'biceps', 'salle', 'upright row|tirage menton'],
  // Bras
  ['Curl biceps barre',                'biceps',                 'forearms', 'salle', 'curl ez|barbell curl'],
  ['Curl biceps haltères',             'biceps',                 'forearms', 'halteres', 'dumbbell curl'],
  ['Curl marteau',                     'biceps forearms',        '', 'halteres', 'hammer curl'],
  ['Curl pupitre',                     'biceps',                 'forearms', 'salle', 'preacher curl|larry scott'],
  ['Curl incliné',                     'biceps',                 'forearms', 'halteres'],
  ['Curl poulie',                      'biceps',                 'forearms', 'salle'],
  ['Curl concentration',               'biceps',                 '', 'halteres'],
  ['Extension triceps poulie',         'triceps',                '', 'salle', 'pushdown|triceps poulie|corde triceps'],
  ['Extension triceps unilatéral',     'triceps',                '', 'halteres'],
  ['Extension nuque',                  'triceps',                '', 'halteres'],
  ['Barre au front',                   'triceps',                '', 'salle', 'skull crusher|extension triceps couché barre'],
  ['Développé couché prise serrée',    'triceps chest',          'front_delts', 'salle', 'close grip bench'],
  ['Kickback triceps',                 'triceps',                '', 'halteres', 'extension triceps buste penché'],
  ['Curl poignets',                    'forearms',               '', 'halteres'],
  ['Marche du fermier',                'forearms traps',         'abs', 'halteres', 'farmer walk'],
  // Abdominaux
  ['Crunch',                           'abs',                    '', 'aucun'],
  ['Crunch poulie',                    'abs',                    '', 'salle'],
  ['Gainage (planche)',                'abs',                    'lower_back', 'aucun', 'planche|plank'],
  ['Relevés de jambes',                'abs',                    '', 'aucun', 'leg raise'],
  ['Roue abdominale',                  'abs',                    'lats', 'salle', 'ab wheel'],
  ['Rotations russes',                    'abs',                    '', 'aucun', 'russian twist'],
  // Jambes
  ['Squat barre',                      'quads glutes',           'adductors lower_back', 'salle', 'back squat'],
  ['Squat avant',                      'quads',                  'glutes abs', 'salle', 'front squat'],
  ['Squat gobelet',                     'quads glutes',           'adductors', 'halteres', 'goblet squat'],
  ['Hack squat',                       'quads',                  'glutes', 'salle', 'squat machine'],
  ['Presse à cuisses',                 'quads glutes',           'adductors', 'salle', 'leg press'],
  ['Fentes marchées haltères',         'quads glutes',           'hamstrings adductors', 'halteres', 'walking lunges'],
  ['Fentes bulgares',                  'quads glutes',           'hamstrings adductors', 'halteres', 'squat bulgare|bulgarian split squat|split squat'],
  ['Extension quadriceps',             'quads',                  '', 'salle', 'leg extension'],
  ['Leg curl machine',                 'hamstrings',             'calves', 'salle', 'curl ischios machine|curl jambes|leg curl assis|leg curl allongé'],
  ['Soulevé de terre roumain',         'hamstrings glutes',      'lower_back', 'salle', 'rdl|romanian deadlift|jambes tendues|sdt jambes tendues'],
  ['Hip thrust',                       'glutes',                 'hamstrings', 'salle', 'poussée de hanches|hip trust|his trust|hipthrust'],
  ['Abducteurs machine',               'glutes',                 '', 'salle', 'abduction|hip abduction'],
  ['Adducteurs machine',               'adductors',              '', 'salle', 'adduction'],
  ['Mollets debout',                   'calves',                 '', 'aucun', 'calf raise'],
  ['Mollets assis',                    'calves',                 '', 'salle', 'seated calf raise'],
  // Haltères et banc (à la maison)
  ['Développé au sol haltères',        'chest triceps',          'front_delts', 'halteres'],
  ['Écarté incliné haltères',          'chest',                  'front_delts', 'halteres'],
  ['Pull-over haltère',                'lats',                   'chest triceps', 'halteres'],
  ['Rowing haltères buste penché',     'lats traps',             'rear_delts biceps', 'halteres'],
  ['Extension triceps couché haltères','triceps',                '',            'halteres'],
  ['Soulevé de terre roumain haltères','hamstrings glutes',      'lower_back',  'halteres', 'rdl haltères|jambes tendues haltères'],
  ['Hip thrust haltère',               'glutes',                 'hamstrings',  'halteres', 'poussée de hanches haltère'],
  ['Montées sur banc haltères',                 'quads glutes',           'hamstrings',  'halteres', 'step-up haltères|step up'],
  // Barre de traction et barres à dips
  ['Tractions supination',             'lats biceps',            'forearms',    'barre', 'chin-up|chin up'],
  ['Tractions australiennes',          'lats traps',             'rear_delts biceps', 'barre', 'rowing inversé|inverted row|australian pull-up'],
  ['Relevés de genoux suspendu',       'abs',                    'forearms',    'barre', 'knee raise|hanging knee raise'],
  // Sans matériel (poids du corps)
  ['Pompes inclinées',                 'chest',                  'front_delts triceps', 'aucun', 'pompes mains surélevées'],
  ['Pompes déclinées',                 'chest front_delts',      'triceps abs', 'aucun'],
  ['Pompes diamant',                   'triceps chest',          'front_delts', 'aucun', 'pompes serrées|diamond push-up'],
  ['Pompes pike (épaules)',            'front_delts',            'side_delts triceps', 'aucun'],
  ['Dips sur chaise',                  'triceps',                'chest front_delts', 'aucun'],
  ['Squat poids du corps',             'quads glutes',           'adductors',   'aucun', 'air squat'],
  ['Squat sauté',                      'quads glutes',           'calves',      'aucun'],
  ['Fentes',                           'quads glutes',           'hamstrings adductors', 'aucun', 'lunges|fentes avant|fentes arrière'],
  ['Chaise contre le mur',             'quads',                  'glutes',      'aucun', 'wall sit'],
  ['Pont fessier',                     'glutes',                 'hamstrings',  'aucun', 'glute bridge'],
  ['Pont fessier unilatéral',          'glutes',                 'hamstrings',  'aucun'],
  ['Curl nordique',                    'hamstrings',             'glutes calves', 'aucun', 'nordic curl'],
  ['Mollets sur une marche',           'calves',                 '',            'aucun'],
  ['Superman',                         'lower_back',             'glutes hamstrings', 'aucun'],
  ['Gainage latéral',                  'abs',                    'glutes',      'aucun'],
  ['Grimpeur',                'abs',                    'quads front_delts', 'aucun', 'mountain climbers|mountain climber'],
  ['Burpees',                          'quads chest',            'front_delts triceps abs', 'aucun'],
  // Sans matériel : versions faciles et difficiles
  ['Pompes contre le mur',             'chest',                  'front_delts triceps', 'aucun'],
  ['Pompes sur les genoux',            'chest',                  'front_delts triceps', 'aucun', 'pompes genoux'],
  ['Pompes archer',                    'chest',                  'front_delts triceps', 'aucun'],
  ['Pompes en équilibre (épaules)',    'front_delts side_delts', 'triceps traps', 'aucun', 'handstand push-up|hspu|pompes poirier'],
  ['Squat sur chaise',                 'quads glutes',           'adductors',   'aucun', 'assis debout'],
  ['Fentes sautées',                   'quads glutes',           'calves',      'aucun', 'jump lunges'],
  ['Pistol squat assisté',             'quads glutes',           'adductors',   'aucun'],
  ['Pistol squat',                     'quads glutes',           'adductors abs', 'aucun', 'squat une jambe'],
  ['Shrimp squat',                     'quads glutes',           'hamstrings',  'aucun'],
  ['Rowing sous une table',            'lats traps',             'rear_delts biceps', 'aucun'],
  ['Dead bug',                         'abs',                    '',            'aucun'],
  ['Bird dog',                         'abs lower_back',         'glutes',      'aucun', 'chien d\'arrêt'],
  ['Gainage creux',                    'abs',                    '',            'aucun', 'hollow body|hollow hold'],
  ['L-sit',                            'abs',                    'quads triceps', 'aucun', 'l sit'],
  ['Clamshell',                        'glutes',                 '',            'aucun', 'coquillage'],
  // Barre de traction et barres à dips : progression vers la traction et le muscle-up
  ['Suspension passive',               'forearms lats',          '',            'barre', 'dead hang'],
  ['Tractions négatives',              'lats biceps',            'forearms',    'barre', 'traction excentrique'],
  ['Tractions avec élastique',         'lats',                   'biceps rear_delts', 'barre', 'traction assistée'],
  ['Tractions archer',                 'lats',                   'biceps rear_delts', 'barre'],
  ['Muscle-up',                        'lats chest',             'triceps biceps', 'barre'],
  ['Front lever',                      'lats abs',               'rear_delts',  'barre'],
  ['Dips négatifs',                    'chest triceps',          'front_delts', 'barre'],
  ['Toes to bar',                      'abs',                    'forearms lats', 'barre', 'pieds à la barre'],
  // Élastiques
  ['Rowing élastique',                 'lats traps',             'rear_delts biceps', 'elastique', 'tirage élastique'],
  ['Pull-apart élastique',             'rear_delts',             'traps',       'elastique', 'écartement élastique|band pull apart'],
  ['Face pull élastique',              'rear_delts',             'traps side_delts', 'elastique'],
  ['Curl élastique',                   'biceps',                 'forearms',    'elastique'],
  ['Extension triceps élastique',      'triceps',                '',            'elastique'],
  ['Développé épaules élastique',      'front_delts side_delts', 'triceps',     'elastique'],
  ['Pompes avec élastique',            'chest',                  'front_delts triceps', 'elastique'],
  ['Squat élastique',                  'quads glutes',           'adductors',   'elastique'],
  ['Good morning élastique',           'hamstrings glutes',      'lower_back',  'elastique'],
  ['Marche latérale élastique',        'glutes',                 'adductors',   'elastique', 'monster walk'],
  ['Rotation externe élastique',       'rear_delts',             '',            'elastique', 'rotation externe épaule|coiffe des rotateurs'],
  // Kettlebell
  ['Swing kettlebell',                 'glutes hamstrings',      'lower_back traps', 'kettlebell', 'kettlebell swing'],
  ['Soulevé de terre kettlebell',      'glutes hamstrings',      'lower_back quads', 'kettlebell'],
  ['Squat gobelet kettlebell',         'quads glutes',           'adductors',   'kettlebell'],
  ['Rowing kettlebell',                'lats traps',             'rear_delts biceps', 'kettlebell'],
  ['Épaulé kettlebell (clean)',        'glutes hamstrings',      'traps lower_back', 'kettlebell', 'kettlebell clean'],
  ['Arraché kettlebell',               'glutes hamstrings',      'traps side_delts', 'kettlebell', 'kettlebell snatch'],
  ['Turkish get-up',                   'abs',                    'front_delts glutes', 'kettlebell', 'relevé turc'],
  ['Halo kettlebell',                  'front_delts side_delts', 'traps abs',   'kettlebell'],
  ['Thruster kettlebell',              'quads front_delts',      'glutes triceps', 'kettlebell'],
  ['Développé épaule kettlebell',      'front_delts side_delts', 'triceps',     'kettlebell'],
  // Salle : variantes courantes (smith, machines, poulies)
  ['Good morning',                     'hamstrings glutes',      'lower_back',  'salle'],
  ['Soulevé de terre sumo',            'glutes quads',           'hamstrings adductors lower_back', 'salle', 'sdt sumo|sumo deadlift'],
  ['Rack pull',                        'glutes lower_back',      'hamstrings traps', 'salle'],
  ['Kickback fessier poulie',          'glutes',                 'hamstrings',  'salle', 'kickback poulie fessier'],
  ['Hip thrust machine',               'glutes',                 'hamstrings',  'salle'],
  ['Squat smith',                      'quads glutes',           'adductors',   'salle', 'squat guidé'],
  ['Pendulum squat',                   'quads',                  'glutes',      'salle'],
  ['Développé incliné smith',          'chest front_delts',      'triceps',     'salle', 'di smith'],
  ['Développé militaire smith',        'front_delts side_delts', 'triceps',     'salle'],
  ['Développé épaules machine',        'front_delts side_delts', 'triceps',     'salle', 'shoulder press machine'],
  ['Élévations latérales machine',     'side_delts',             'traps',       'salle'],
  ['Pec deck inversé',                 'rear_delts',             'traps',       'salle', 'reverse pec deck|butterfly inversé'],
  ['Écarté poulie basse',              'chest',                  'front_delts', 'salle', 'low cable fly'],
  ['Rowing machine',                   'lats traps',             'rear_delts biceps', 'salle', 'rowing assis machine|chest supported row'],
  ['Tirage bras tendus poulie',        'lats',                   'triceps',     'salle', 'straight arm pulldown|pull-down bras tendus'],
  ['Extension triceps corde nuque',    'triceps',                '',            'salle', 'overhead triceps extension|extension au-dessus de la tête'],
  ['JM press',                         'triceps',                'chest',       'salle'],
  ['Curl araignée',                    'biceps',                 '',            'salle', 'spider curl'],
  ['Mollets à la presse',              'calves',                 '',            'salle'],
  ['Crunch machine',                   'abs',                    '',            'salle'],
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

// ── Progressions : du plus facile au plus dur ───────────────
// Proposées dans « Remplacer l'exercice » (« Plus facile » / « Plus dur ») : qui n'arrive pas encore à
// une traction trouve d'un toucher l'étape d'avant. Tous les noms sont dans la bibliothèque (testé).
const PROGRESSIONS = [
  ['Pompes contre le mur', 'Pompes inclinées', 'Pompes sur les genoux', 'Pompes', 'Pompes déclinées', 'Pompes archer'],
  ['Suspension passive', 'Tractions australiennes', 'Tractions négatives', 'Tractions avec élastique', 'Tractions pronation', 'Tractions archer', 'Muscle-up'],
  ['Dips sur chaise', 'Dips négatifs', 'Dips'],
  ['Squat sur chaise', 'Squat poids du corps', 'Pistol squat assisté', 'Pistol squat'],
  ['Pont fessier', 'Pont fessier unilatéral'],
  ['Dead bug', 'Gainage (planche)', 'Gainage creux', 'L-sit'],
  ['Relevés de jambes', 'Relevés de genoux suspendu', 'Toes to bar'],
  ['Pompes pike (épaules)', 'Pompes en équilibre (épaules)'],
];
// { easier, harder } : noms voisins dans sa progression (null aux extrémités ou hors progression)
function progressionOf(name) {
  const own = catalogueEntry(name)?.name || name;
  for (const chain of PROGRESSIONS) {
    const i = chain.indexOf(own);
    if (i >= 0) return { easier: chain[i - 1] || null, harder: chain[i + 1] || null };
  }
  return { easier: null, harder: null };
}
