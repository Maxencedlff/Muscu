// ═══════════════════════════════════════════════════════════
//  Bibliothèque d'exercices : muscles, matériel, alias, progressions
//  Données pures, lues par js/data/muscles.js (reconnaissance) et la feuille d'ajout
// ═══════════════════════════════════════════════════════════
'use strict';

// ── Bibliothèque : exercices connus et leurs muscles ─────────
// [nom, muscles principaux, muscles secondaires, matériel (EQUIPMENT), alias facultatifs séparés par « | »] ; tous les exercices de PROGRAMMES y figurent
// (vérifié par les tests unitaires). Elle complète aussi la recherche de la feuille d'ajout.
// Muscles vérifiés un par un (audit du 25/10/2026) : principal = moteur du mouvement (« Target » d'ExRx.net,
// muscle le plus activé en EMG), secondaire = synergiste notable (compté pour une demi-série). Ce sont les
// muscles par défaut : la personne peut les modifier dans l'app (après confirmation) et les rétablir
// (musclesVerified, muscles.js) ; une correction pour tous se fait ici, source à l'appui.
// Exemples de sources : développé militaire, deltoïde antérieur principal (ExRx ; Coratella 2022, Front.
// Physiol.) ; pull-over haltère, pectoral autant que grand dorsal (Marchetti et Uchida 2011, J. Appl.
// Biomech.) ; bird dog, lombaires et grand fessier bien au-dessus des abdominaux (Ekstrom 2007, JOSPT) ;
// marche latérale élastique, moyen fessier, aucun travail des adducteurs (EMG, PubMed 22845002) ; rotation
// externe haltère (L-fly), sous-épineux et petit rond rangés avec l'épaule postérieure, faute de groupe pour
// la coiffe (ExRx, « Dumbbell Lying External Rotation »), comme la rotation externe élastique ; oiseau poulie
// vis-à-vis, deltoïde postérieur, trapèze moyen en synergiste (ExRx, « Cable Rear Delt Fly »).
// Matériel nécessaire, pour filtrer la bibliothèque quand on s'entraîne sans salle (feuille d'ajout).
// Chaque exercice a une seule catégorie : celle du matériel le plus lourd qu'il demande.
// Ordre = ordre des filtres ; les identifiants sont repris tels quels par sanitizeData (store.js).
const EQUIPMENT = [
  { id: 'aucun',    label: 'Sans matériel' },
  { id: 'halteres', label: 'Haltères et banc' },
  { id: 'barre',    label: 'Tractions et dips' },
  { id: 'elastique', label: 'Élastiques' },
  { id: 'kettlebell', label: 'Kettlebell' },
  { id: 'cardio',   label: 'Cardio' },
  { id: 'salle',    label: 'Salle' },
];
const EXERCISE_CATALOGUE = [
  // Pectoraux
  ['Développé couché barre',           'chest',                  'front_delts triceps', 'salle', 'bench press|dc|bp|développé couché|bench|barbell bench press|flat bench press'],
  ['Développé couché haltères',        'chest',                  'front_delts triceps', 'halteres', 'dumbbell bench press|db bench press|dumbbell bench'],
  ['Développé incliné barre',          'chest front_delts',      'triceps', 'salle', 'incline bench press|incline barbell press|incline bench|développé incliné'],
  ['Développé incliné haltères',       'chest front_delts',      'triceps', 'halteres', 'incline dumbbell press|incline dumbbell bench press|incline db press'],
  ['Développé décliné',                'chest',                  'front_delts triceps', 'salle', 'decline bench press|decline press'],
  ['Développé couché machine',         'chest',                  'front_delts triceps', 'salle', 'chest press|chest press machine|machine chest press'],
  ['Écarté haltères plat',             'chest',                  'front_delts', 'halteres', 'écarté haltères|écarté couché|dumbbell fly|dumbbell flyes|dumbbell flies'],
  ['Écarté poulie vis-à-vis',          'chest',                  'front_delts', 'salle', 'cable fly|crossover|écarté poulie|cable crossover|cable flyes|cable flies|écarté câble|écarté câbles'],
  ['Pec deck',                         'chest',                  'front_delts', 'salle', 'écarté machine|butterfly|peck deck|pec fly|pec dec|pec deck machine|machine fly|pec flyes'],
  ['Pompes',                           'chest',                  'front_delts triceps abs', 'aucun', 'push-up|push up'],
  ['Dips',                             'chest triceps',          'front_delts', 'barre', 'barres parallèles|chest dips|parallel bar dips|dips barres parallèles'],
  // Dos
  ['Soulevé de terre',                 'glutes hamstrings lower_back', 'quads adductors traps forearms', 'salle', 'deadlift|sdt|dead lift|dead-lift|conventional deadlift|barbell deadlift|soulevé de terre barre'],
  ['Tractions pronation',              'lats',                   'biceps brachialis rear_delts traps forearms', 'barre', 'pull-ups|pull up|traction|tractions prise large|wide grip pull up'],
  ['Tractions prise serrée',           'lats biceps',            'brachialis forearms', 'barre', 'close grip pull up'],
  ['Tirage vertical prise large',      'lats',                   'biceps brachialis rear_delts traps', 'salle', 'tirage poitrine|lat pulldown|poulie haute|pulldown|tirage nuque|tirage poulie haute|wide grip lat pulldown'],
  ['Tirage vertical prise serrée',     'lats',                   'biceps', 'salle', 'close grip lat pulldown|close grip pulldown|tirage vertical serré'],
  ['Tirage horizontal câble',          'lats traps',             'rear_delts biceps', 'salle', 'seated row|rowing assis|tirage assis|poulie basse|tirage horizontal poulie|tirage horizontal|seated cable row|cable row|rowing poulie basse|tirage poulie basse'],
  ['Rowing barre',                     'lats traps',             'rear_delts biceps lower_back', 'salle', 'barbell row|rowing buste penché barre|bent over row|bent over barbell row|rowing barre buste penché|rowing barre penché|pendlay row'],
  ['Rowing haltère unilatéral',        'lats',                   'traps rear_delts biceps', 'halteres', 'dumbbell row|rowing un bras|one arm dumbbell row|single arm dumbbell row|rowing unilatéral|rowing 1 bras'],
  ['Rowing barre T',                     'lats traps',             'rear_delts biceps', 'salle', 'rowing t-bar|t bar|t bar row'],
  ['Pull-over poulie',                 'lats',                   'chest triceps', 'salle', 'pull over|cable pullover'],
  ['Haussements d\'épaules haltères',                  'traps',                  'forearms', 'halteres', 'shrugs haltères|shrug|haussements d\'épaules|dumbbell shrug'],
  ['Extension lombaires',              'lower_back',             'glutes hamstrings', 'salle', 'hyperextension|banc lombaire|back extension'],
  ['Face pull',                        'rear_delts',             'traps side_delts', 'salle', 'tirage visage|tirage corde'],
  // Épaules
  ['Développé militaire barre',        'front_delts',            'side_delts triceps traps', 'salle', 'ohp|overhead press|military press|développé militaire|barbell overhead press|standing press|strict press'],
  ['Développé militaire haltères',     'front_delts',            'side_delts triceps traps', 'halteres', 'shoulder press haltères|dumbbell shoulder press|développé épaules haltères|seated dumbbell press'],
  ['Développé Arnold',                 'front_delts',            'side_delts triceps', 'halteres', 'arnold press|arnold|développé arnold haltères'],
  ['Élévations latérales',             'side_delts',             'traps', 'halteres', 'lateral raise|élévations latérales haltères|dumbbell lateral raise|side raise|side lateral raise'],
  ['Élévations latérales poulie',      'side_delts',             'traps', 'salle', 'cable lateral raise|élévations latérales câble'],
  ['Élévations frontales',             'front_delts',            'side_delts', 'halteres', 'front raise|élévations frontales haltères'],
  ['Oiseau (élévations arrière)',      'rear_delts',             'traps', 'halteres', 'reverse fly|élévations arrière|oiseau|oiseau haltères|rear delt fly|dumbbell reverse fly|bent over reverse fly|reverse flyes'],
  ['Oiseau poulie vis-à-vis',          'rear_delts',             'traps', 'salle', 'oiseau poulie vis a vis|oiseau poulie|reverse cable fly|cable rear delt fly'],
  ['Rotation externe haltère',         'rear_delts',             '', 'halteres', 'l-fly|l fly|lfly|dumbbell external rotation|rotation externe haltères'],
  ['Rowing menton',                    'side_delts traps',       'front_delts biceps brachialis', 'salle', 'upright row|tirage menton'],
  // Bras
  ['Curl biceps barre',                'biceps',                 'brachialis forearms', 'salle', 'curl ez|barbell curl|curl barre|curl barre ez|ez bar curl|ez curl'],
  ['Curl biceps haltères',             'biceps',                 'brachialis forearms', 'halteres', 'dumbbell curl|curl haltères'],
  ['Curl marteau',                     'brachialis biceps forearms', '',              'halteres', 'hammer curl|curl marteau haltères|curl prise neutre'],
  ['Curl pupitre',                     'biceps',                 'brachialis forearms', 'salle', 'preacher curl|larry scott|curl larry scott|pupitre'],
  ['Curl incliné',                     'biceps',                 'brachialis forearms', 'halteres', 'incline curl|incline dumbbell curl|curl incliné haltères'],
  ['Curl poulie',                      'biceps',                 'brachialis forearms', 'salle', 'cable curl|curl câble|curl poulie basse'],
  ['Curl inversé',                     'brachialis forearms',    'biceps',      'halteres', 'reverse curl|curl pronation|curl inversé barre|reverse barbell curl'],
  ['Curl concentration',               'biceps',                 'brachialis', 'halteres', 'concentration curl|curl concentré'],
  ['Extension triceps poulie',         'triceps',                '', 'salle', 'pushdown|triceps poulie|corde triceps|extension triceps poulie bas|triceps pushdown|rope pushdown|extension triceps corde|extension triceps poulie haute'],
  ['Extension triceps unilatéral',     'triceps',                '', 'halteres', 'extension triceps unilatérale|extension triceps un bras'],
  ['Extension nuque',                  'triceps',                '', 'halteres', 'extension nuque haltère|overhead dumbbell triceps extension|overhead dumbbell extension'],
  ['Barre au front',                   'triceps',                '', 'salle', 'skull crusher|extension triceps couché barre|barre front'],
  ['Développé couché prise serrée',    'triceps chest',          'front_delts', 'salle', 'close grip bench|close grip bench press|dc serré|développé serré|développé couché serré'],
  ['Kickback triceps',                 'triceps',                '', 'halteres', 'extension triceps buste penché|triceps kickback|kickback haltère'],
  ['Curl poignets',                    'forearms',               '', 'halteres', 'wrist curl'],
  ['Marche du fermier',                'forearms traps',         'abs', 'halteres', 'farmer walk|farmer carry|farmer\'s carry'],
  // Abdominaux
  ['Crunch',                           'abs',                    '', 'aucun', 'crunches|crunch au sol'],
  ['Crunch poulie',                    'abs',                    '', 'salle', 'cable crunch|crunch câble'],
  ['Gainage (planche)',                'abs',                    'lower_back', 'aucun', 'planche|plank|planche gainage'],
  ['Relevés de jambes',                'abs',                    '', 'aucun', 'leg raise|relevés de jambes au sol|lying leg raise'],
  ['Roue abdominale',                  'abs',                    'lats', 'salle', 'ab wheel|ab roller|roue abdo|roulette abdo|ab wheel rollout'],
  ['Rotations russes',                    'abs',                    '', 'aucun', 'russian twist'],
  // Jambes
  ['Squat barre',                      'quads glutes',           'adductors lower_back', 'salle', 'back squat|barbell squat|squat arrière'],
  ['Squat avant',                      'quads',                  'glutes abs', 'salle', 'front squat|squat avant barre'],
  ['Squat gobelet',                     'quads glutes',           'adductors', 'halteres', 'goblet squat|squat goblet|squat gobelet haltère'],
  ['Hack squat',                       'quads',                  'glutes', 'salle', 'squat machine|hack squats'],
  ['Presse à cuisses',                 'quads glutes',           'adductors', 'salle', 'leg press|presse|presse cuisses|presse jambes|presse à jambes|presse 45'],
  ['Fentes marchées haltères',         'quads glutes',           'hamstrings adductors', 'halteres', 'walking lunges|fentes marchées'],
  ['Fentes bulgares',                  'quads glutes',           'hamstrings adductors', 'halteres', 'squat bulgare|bulgarian split squat|split squat|bulgarian squat|bulgare'],
  ['Extension quadriceps',             'quads',                  '', 'salle', 'leg extension|legs extension|extension jambes|extension des jambes|quad extension'],
  ['Leg curl machine',                 'hamstrings',             'calves', 'salle', 'curl ischios machine|curl jambes|leg curl assis|leg curl allongé|leg curl|hamstring curl|curl ischios|curl ischio jambiers'],
  ['Soulevé de terre roumain',         'hamstrings glutes',      'lower_back', 'salle', 'rdl|romanian deadlift|jambes tendues|sdt jambes tendues|stiff leg deadlift|sldl'],
  ['Hip thrust',                       'glutes',                 'hamstrings', 'salle', 'poussée de hanches|hip trust|his trust|hipthrust|hip thrusts|barbell hip thrust'],
  ['Abducteurs machine',               'glutes',                 '', 'salle', 'abduction|hip abduction|abducteurs|abduction machine|machine abducteurs'],
  ['Adducteurs machine',               'adductors',              '', 'salle', 'adduction|adducteurs|adduction machine|machine adducteurs|hip adduction'],
  ['Mollets debout',                   'calves',                 '', 'aucun', 'calf raise|standing calf raise'],
  ['Mollets assis',                    'calves',                 '', 'salle', 'seated calf raise'],
  // Haltères et banc (à la maison)
  ['Développé au sol haltères',        'chest triceps',          'front_delts', 'halteres', 'floor press|dumbbell floor press|développé au sol'],
  ['Écarté incliné haltères',          'chest',                  'front_delts', 'halteres', 'incline dumbbell fly|incline fly|écarté incliné'],
  ['Pull-over haltère',                'chest lats',             'triceps', 'halteres', 'dumbbell pullover'],
  ['Rowing haltères buste penché',     'lats traps',             'rear_delts biceps', 'halteres', 'bent over dumbbell row|rowing deux haltères'],
  ['Extension triceps couché haltères','triceps',                '',            'halteres', 'dumbbell skull crusher|barre au front haltères|lying dumbbell triceps extension'],
  ['Soulevé de terre roumain haltères','hamstrings glutes',      'lower_back',  'halteres', 'rdl haltères|jambes tendues haltères|dumbbell rdl|dumbbell romanian deadlift'],
  ['Hip thrust haltère',               'glutes',                 'hamstrings',  'halteres', 'poussée de hanches haltère|dumbbell hip thrust'],
  ['Montées sur banc haltères',                 'quads glutes',           'hamstrings',  'halteres', 'step-up haltères|step up|montées sur banc|dumbbell step up'],
  // Barre de traction et barres à dips
  ['Tractions supination',             'lats biceps',            'brachialis forearms',    'barre', 'chin-up|chin up'],
  ['Tractions australiennes',          'lats traps',             'rear_delts biceps', 'barre', 'rowing inversé|inverted row|australian pull-up'],
  ['Relevés de genoux suspendu',       'abs',                    'forearms',    'barre', 'knee raise|hanging knee raise|relevés de genoux|relevés de genoux à la barre'],
  // Sans matériel (poids du corps)
  ['Pompes inclinées',                 'chest',                  'front_delts triceps', 'aucun', 'pompes mains surélevées|incline push up'],
  ['Pompes déclinées',                 'chest front_delts',      'triceps abs', 'aucun', 'decline push up|pompes pieds surélevés'],
  ['Pompes diamant',                   'triceps chest',          'front_delts', 'aucun', 'pompes serrées|diamond push-up'],
  ['Pompes pike (épaules)',            'front_delts',            'side_delts triceps traps', 'aucun', 'pike push up|pompes pike'],
  ['Dips sur chaise',                  'triceps',                'chest front_delts', 'aucun', 'bench dips|chair dips|dips banc|dips sur banc'],
  ['Squat poids du corps',             'quads glutes',           'adductors',   'aucun', 'air squat|bodyweight squat'],
  ['Squat sauté',                      'quads glutes',           'calves',      'aucun', 'jump squat'],
  ['Fentes',                           'quads glutes',           'hamstrings adductors', 'aucun', 'lunges|fentes avant|fentes arrière'],
  ['Chaise contre le mur',             'quads',                  'glutes',      'aucun', 'wall sit|la chaise|chaise murale|wall squat'],
  ['Pont fessier',                     'glutes',                 'hamstrings',  'aucun', 'glute bridge|hip bridge'],
  ['Pont fessier unilatéral',          'glutes',                 'hamstrings',  'aucun', 'single leg glute bridge|pont fessier une jambe'],
  ['Curl nordique',                    'hamstrings',             'glutes calves', 'aucun', 'nordic curl|nordic hamstring curl|nordic'],
  ['Mollets sur une marche',           'calves',                 '',            'aucun'],
  ['Superman',                         'lower_back',             'glutes hamstrings', 'aucun'],
  ['Gainage latéral',                  'abs',                    'glutes',      'aucun', 'side plank|planche latérale'],
  ['Grimpeur',                'abs',                    'quads front_delts', 'aucun', 'mountain climbers|mountain climber'],
  ['Burpees',                          'quads chest',            'front_delts triceps abs', 'aucun'],
  // Sans matériel : versions faciles et difficiles
  ['Pompes contre le mur',             'chest',                  'front_delts triceps', 'aucun', 'wall push up'],
  ['Pompes sur les genoux',            'chest',                  'front_delts triceps', 'aucun', 'pompes genoux|knee push up'],
  ['Pompes archer',                    'chest',                  'front_delts triceps', 'aucun', 'archer push up'],
  ['Pompes en équilibre (épaules)',    'front_delts',            'side_delts triceps traps', 'aucun', 'handstand push-up|hspu|pompes poirier'],
  ['Squat sur chaise',                 'quads glutes',           'adductors',   'aucun', 'assis debout'],
  ['Fentes sautées',                   'quads glutes',           'calves',      'aucun', 'jump lunges'],
  ['Pistol squat assisté',             'quads glutes',           'adductors',   'aucun'],
  ['Pistol squat',                     'quads glutes',           'adductors abs', 'aucun', 'squat une jambe|pistol'],
  ['Shrimp squat',                     'quads glutes',           'hamstrings',  'aucun'],
  ['Rowing sous une table',            'lats traps',             'rear_delts biceps', 'aucun'],
  ['Dead bug',                         'abs',                    '',            'aucun'],
  ['Bird dog',                         'lower_back glutes',      'abs', 'aucun', 'chien d\'arrêt'],
  ['Gainage creux',                    'abs',                    '',            'aucun', 'hollow body|hollow hold'],
  ['L-sit',                            'abs',                    'quads triceps', 'aucun', 'l sit'],
  ['Clamshell',                        'glutes',                 '',            'aucun', 'coquillage'],
  // Barre de traction et barres à dips : progression vers la traction et le muscle-up
  ['Suspension passive',               'forearms',               'lats', 'barre', 'dead hang'],
  ['Tractions négatives',              'lats biceps',            'forearms',    'barre', 'traction excentrique|negative pull up'],
  ['Tractions avec élastique',         'lats',                   'biceps rear_delts', 'barre', 'traction assistée|band assisted pull up|traction élastique'],
  ['Tractions archer',                 'lats',                   'biceps rear_delts', 'barre', 'archer pull up'],
  ['Muscle-up',                        'lats chest',             'triceps biceps', 'barre'],
  ['Front lever',                      'lats abs',               'rear_delts',  'barre'],
  ['Dips négatifs',                    'chest triceps',          'front_delts', 'barre'],
  ['Toes to bar',                      'abs',                    'forearms lats', 'barre', 'pieds à la barre|t2b|ttb'],
  // Élastiques
  ['Rowing élastique',                 'lats traps',             'rear_delts biceps', 'elastique', 'tirage élastique|band row'],
  ['Pull-apart élastique',             'rear_delts',             'traps',       'elastique', 'écartement élastique|band pull apart|pull apart'],
  ['Face pull élastique',              'rear_delts',             'traps side_delts', 'elastique', 'band face pull'],
  ['Curl élastique',                   'biceps',                 'brachialis forearms',    'elastique', 'band curl'],
  ['Extension triceps élastique',      'triceps',                '',            'elastique', 'band pushdown|band triceps extension'],
  ['Développé épaules élastique',      'front_delts',            'side_delts triceps', 'elastique', 'band shoulder press'],
  ['Pompes avec élastique',            'chest',                  'front_delts triceps', 'elastique'],
  ['Squat élastique',                  'quads glutes',           'adductors',   'elastique', 'band squat'],
  ['Good morning élastique',           'hamstrings glutes',      'lower_back',  'elastique', 'band good morning'],
  ['Marche latérale élastique',        'glutes',                 '',              'elastique', 'monster walk|lateral band walk|band walk'],
  ['Rotation externe élastique',       'rear_delts',             '',            'elastique', 'rotation externe épaule|coiffe des rotateurs|band external rotation'],
  // Kettlebell
  ['Swing kettlebell',                 'glutes hamstrings',      'lower_back traps', 'kettlebell', 'kettlebell swing|swing|russian swing'],
  ['Soulevé de terre kettlebell',      'glutes hamstrings',      'lower_back quads', 'kettlebell', 'kettlebell deadlift'],
  ['Squat gobelet kettlebell',         'quads glutes',           'adductors',   'kettlebell', 'kettlebell goblet squat'],
  ['Rowing kettlebell',                'lats traps',             'rear_delts biceps', 'kettlebell', 'kettlebell row'],
  ['Épaulé kettlebell (clean)',        'glutes hamstrings',      'traps lower_back', 'kettlebell', 'kettlebell clean|épaulé kettlebell'],
  ['Arraché kettlebell',               'glutes hamstrings',      'traps side_delts', 'kettlebell', 'kettlebell snatch'],
  ['Turkish get-up',                   'abs',                    'front_delts glutes', 'kettlebell', 'relevé turc|tgu'],
  ['Halo kettlebell',                  'front_delts side_delts', 'traps abs',   'kettlebell', 'kettlebell halo'],
  ['Thruster kettlebell',              'quads front_delts',      'glutes triceps', 'kettlebell', 'kettlebell thruster'],
  ['Développé épaule kettlebell',      'front_delts',            'side_delts triceps', 'kettlebell', 'kettlebell press|kettlebell overhead press'],
  // Cardio : durée et distance (js/data/measures.js) ; course et vélo : allure en min/km ou km/h (paceKind),
  // et nom des entraînements lus dans Santé (js/data/health-workouts.js)
  ['Course à pied',                    'quads calves',           'hamstrings glutes', 'cardio', 'running|footing|jogging|courir|course extérieure'],
  ['Tapis de course',                  'quads calves',           'hamstrings glutes', 'cardio', 'tapis|treadmill'],
  ['Trail',                            'quads calves',           'hamstrings glutes', 'cardio', 'course en nature|trail running'],
  ['Fractionné (course)',              'quads calves',           'hamstrings glutes', 'cardio', 'fractionné|interval running'],
  ['Vélo',                             'quads',                  'calves glutes', 'cardio', 'vélo de route|cyclisme|vtt|bike|cycling'],
  ['Vélo d\'appartement',              'quads',                  'calves glutes', 'cardio', 'vélo stationnaire|home trainer|spinning|indoor cycling'],
  ['Rameur',                           'lats quads',             'biceps hamstrings glutes', 'cardio', 'ergomètre|rowing ergo|rower'],
  ['Vélo elliptique',                  'quads glutes',           'hamstrings',  'cardio', 'elliptique|elliptical|cross trainer'],
  // Escaliers (stair climber à marches qui défilent, ou stepper à pédales) : la montée sollicite surtout
  // quadriceps et grand fessier, les mollets poussent en fin d'appui, ischios en synergistes (EMG de la montée
  // d'escalier et du stair stepping : Brown et al. 1994, J. Orthop. Sports Phys. Ther. ; ExRx, « Stair climb »)
  ['Escaliers',                        'quads glutes',           'calves hamstrings', 'cardio', 'stepper|stair climber|stairmaster|stepmill|escalier|stair master|step mill|climbmill|powermill'],
  ['Corde à sauter',                   'calves quads',           '',            'cardio', 'jump rope|skipping rope'],
  ['Marche rapide',                    'quads calves',           'glutes',      'cardio', 'marche'],
  ['Jumping jacks',                    'calves quads',           'side_delts',  'aucun', 'jumping jack'],
  // Salle : variantes courantes (smith, machines, poulies)
  ['Good morning',                     'hamstrings glutes',      'lower_back',  'salle'],
  ['Soulevé de terre sumo',            'glutes quads',           'hamstrings adductors lower_back traps forearms', 'salle', 'sdt sumo|sumo deadlift'],
  ['Rack pull',                        'glutes lower_back',      'hamstrings traps forearms', 'salle'],
  ['Kickback fessier poulie',          'glutes',                 'hamstrings',  'salle', 'kickback poulie fessier|glute kickback|kickback fessier'],
  ['Hip thrust machine',               'glutes',                 'hamstrings',  'salle'],
  ['Squat smith',                      'quads glutes',           'adductors',   'salle', 'squat guidé|smith squat|squat multipower'],
  ['Pendulum squat',                   'quads',                  'glutes',      'salle', 'pendulum'],
  ['Développé incliné smith',          'chest front_delts',      'triceps',     'salle', 'di smith|incline smith press|développé incliné multipower'],
  ['Développé militaire smith',        'front_delts',            'side_delts triceps', 'salle', 'smith shoulder press|développé militaire multipower'],
  ['Développé épaules machine',        'front_delts',            'side_delts triceps', 'salle', 'shoulder press machine|machine shoulder press'],
  ['Élévations latérales machine',     'side_delts',             'traps',       'salle', 'élévation latérale machine|machine lateral raise|lateral raise machine'],
  ['Pec deck inversé',                 'rear_delts',             'traps',       'salle', 'reverse pec deck|butterfly inversé|rear delt machine|reverse fly machine|oiseau machine'],
  ['Écarté poulie basse',              'chest',                  'front_delts', 'salle', 'low cable fly|écarté poulie bas|low to high cable fly'],
  ['Rowing machine',                   'lats traps',             'rear_delts biceps', 'salle', 'rowing assis machine|chest supported row|machine row|seated machine row'],
  ['Tirage bras tendus poulie',        'lats',                   'triceps',     'salle', 'straight arm pulldown|pull-down bras tendus|tirage bras tendus'],
  ['Extension triceps corde nuque',    'triceps',                '',            'salle', 'overhead triceps extension|extension au-dessus de la tête|overhead cable extension|extension nuque poulie'],
  ['JM press',                         'triceps',                'chest',       'salle'],
  ['Curl araignée',                    'biceps',                 'brachialis',            'salle', 'spider curl'],
  ['Tractions assistées (machine)',    'lats',                   'biceps rear_delts', 'salle', 'assisted pull-up|machine à tractions'],
  ['Dips assistés (machine)',          'chest triceps',          'front_delts', 'salle', 'assisted dips|dips assistés'],
  ['Mollets à la presse',              'calves',                 '',            'salle', 'leg press calf raise|mollets presse'],
  ['Crunch machine',                   'abs',                    '',            'salle', 'machine crunch|ab crunch machine'],
].map(([name, primary, secondary, equip, aliases = '']) => Object.freeze({
  name, primary: primary.split(' ').filter(Boolean), secondary: secondary.split(' ').filter(Boolean), equip,
  aliases: Object.freeze(aliases.split('|').map(a => a.trim()).filter(Boolean)),
}));
// Par nom normalisé et par alias : un ancien nom (« Pull-ups ») ou le nom anglais retrouve sa fiche ;
// puis par clé souple (looseKey, muscles.js) pour les pluriels, tirets et espaces tapés autrement
const CATALOGUE_BY_NAME = new Map(EXERCISE_CATALOGUE.flatMap(e =>
  [e.name, ...e.aliases].map(n => [normName(n), e])));
const CATALOGUE_BY_LOOSE_KEY = new Map(EXERCISE_CATALOGUE.flatMap(e =>
  [e.name, ...e.aliases].map(n => [looseKey(n), e])));

function catalogueNames() { return EXERCISE_CATALOGUE.map(e => e.name); }
// Nom de la fiche quand le nom tapé en est un alias ou une forme proche (« Pec fly » → « Pec deck »,
// « Hack squats » → « Hack squat ») : affiché discrètement « = Pec deck » sous le nom (aliasNoteHtml).
// null si le nom est celui de la fiche (aux accents, majuscules et espaces près) ou hors bibliothèque.
function catalogueAliasOf(name) {
  const e = catalogueEntry(name || '');
  return e && normName(e.name) !== normName(name) ? e.name : null;
}
// Matériel d'un exercice de la bibliothèque (id d'EQUIPMENT), null pour un nom saisi librement
function equipmentOf(name) { return CATALOGUE_BY_NAME.get(normName(name))?.equip ?? null; }
// Fiche de la bibliothèque d'un nom (nom exact, alias, abréviation développée ou clé souple), null sinon
function catalogueEntry(name) {
  return CATALOGUE_BY_NAME.get(normName(name)) || CATALOGUE_BY_NAME.get(ruleKey(name)) || CATALOGUE_BY_LOOSE_KEY.get(looseKey(name)) || null;
}
// Rang dans la bibliothèque, qui place le mouvement de référence d'une famille avant ses variantes
// (« Tractions pronation » avant « Tractions archer ») ; -1 hors bibliothèque (exercice de la personne)
const CATALOGUE_RANK = new Map(EXERCISE_CATALOGUE.map((e, i) => [e, i]));
function catalogueRank(name) { const e = catalogueEntry(name); return e ? CATALOGUE_RANK.get(e) : -1; }

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
