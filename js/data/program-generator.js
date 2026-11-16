// ═══════════════════════════════════════════════════════════
//  Générateur de programme sur mesure : règles fixes, sans IA, sans écran ni écriture
//
//  Réponses (âge, taille, poids, sexe, objectif, niveau, jours, minutes, matériel, zones prioritaires,
//  limites) → un programme MDLF normal (séances, exercices du catalogue, séries, fourchette de reps, repos),
//  déterministe : mêmes réponses, même programme. Les écrans sont dans js/features/program-generator-ui.js.
//
//  Règles retenues et leurs sources :
//  - Volume : séries par muscle et par semaine, une série comptée entière pour les muscles principaux et pour
//    moitié pour les secondaires (SECONDARY_WEIGHT, comme Progrès). 12 pour un intermédiaire et 16 pour un
//    avancé, dans la fourchette 12 à 20 (Baz-Valle et al. 2022, J Hum Kinet ; Schoenfeld, Ogborn et Krieger
//    2017, J Sports Sci : 10 séries et plus font mieux que moins de 10) ; 8 pour qui débute et 6 pour une
//    reprise (choix prudent : un débutant progresse déjà avec peu de séries, ACSM 2009).
//  - Fréquence : chaque muscle deux fois par semaine au moins quand les jours le permettent (Schoenfeld,
//    Ogborn et Krieger 2016, Sports Med). Split selon les jours : 2-3 corps entier, 4 haut / bas, 5 haut /
//    bas + pousser / tirer / jambes, 6 pousser / tirer / jambes deux fois.
//  - Reps et repos selon l'objectif : force = charges lourdes, 3 à 6 reps et 3 min sur les deux premiers
//    polyarticulaires (Schoenfeld et al. 2017, JSCR : la force suit la charge ; l'hypertrophie se fait sur une
//    large plage de charges) ; repos longs sur les polyarticulaires (Schoenfeld et al. 2016, JSCR : 3 min > 1 min).
//  - Débutant, reprise, 60 ans et plus : moins de volume, machines et poulies d'abord, fourchettes plus hautes
//    (ACSM 2009 ; Fragala et al. 2019, position de la NSCA pour les seniors).
//  - Poids et taille : seulement pour les exercices au poids du corps qui soulèvent tout le corps (tractions,
//    dips) ou presque (pompes, Ebben et al. 2011, JSCR : environ 64 % du poids). IMC de 30 ou plus (seuil de
//    l'OMS) ou débutant : variante assistée ou inclinée d'abord. Aucun autre effet : ni la taille, ni le sexe ne
//    changent le volume (Roberts et al. 2020, JSCR : gains relatifs semblables chez les femmes et les hommes).
//  - Durée : échauffement, puis pour chaque série environ 40 s d'effort et le repos, une minute pour changer
//    d'exercice. Une séance prévue ne dépasse jamais le temps donné.
// ═══════════════════════════════════════════════════════════
'use strict';

// ── Réponses possibles ───────────────────────────────────────
const GEN_GOALS = {
  muscle: { label: 'Prendre du muscle', sub: 'Prise de masse, volume' },
  force:  { label: 'Gagner en force', sub: 'Charges lourdes, peu de reps' },
  forme:  { label: 'Remise en forme, santé', sub: 'Tout le corps, sans excès' },
  seche:  { label: 'Perdre du gras', sub: 'En gardant tes muscles' },
};
const GEN_LEVELS = {
  debutant:      { label: 'Je débute', sub: 'Moins de six mois de musculation' },
  reprise:       { label: 'Je reprends en douceur', sub: 'Après une longue pause' },
  intermediaire: { label: 'Intermédiaire', sub: 'Six mois à trois ans, avec régularité' },
  avance:        { label: 'Avancé', sub: 'Plus de trois ans, avec régularité' },
};
const GEN_DAYS = [2, 3, 4, 5, 6];
const GEN_MINUTES = [30, 45, 60, 75, 90];
// Matériel : 'salle' = salle complète (tout, barres à dips comprises). Le poids du corps est toujours compté.
const GEN_EQUIP = [
  { id: 'barre',          label: 'Barre et rack' },
  { id: 'halteres',       label: 'Haltères réglables' },
  { id: 'halteres_fixes', label: 'Haltères fixes' },
  { id: 'banc',           label: 'Banc' },
  { id: 'machines',       label: 'Machines guidées' },
  { id: 'poulie',         label: 'Poulie' },
  { id: 'elastiques',     label: 'Élastiques' },
  { id: 'traction',       label: 'Barre de traction' },
  { id: 'kettlebell',     label: 'Kettlebell' },
];
const GEN_EQUIP_IDS = GEN_EQUIP.map(e => e.id);
// Zones prioritaires : muscles dont le volume visé monte, et exercices ajoutés
const GEN_ZONES = {
  pectoraux: { label: 'Pectoraux', muscles: ['chest'], slots: ['fly'] },
  dos:       { label: 'Dos', muscles: ['lats'], slots: ['h_pull'] },
  epaules:   { label: 'Épaules', muscles: ['side_delts', 'rear_delts'], slots: ['lateral', 'rear'] },
  bras:      { label: 'Bras', muscles: ['biceps', 'triceps'], slots: ['biceps', 'triceps'] },
  fessiers:  { label: 'Fessiers', muscles: ['glutes'], slots: ['glute'] },
  jambes:    { label: 'Cuisses', muscles: ['quads', 'hamstrings'], slots: ['knee_ext', 'hams'] },
  mollets:   { label: 'Mollets', muscles: ['calves'], slots: ['calf'] },
  abdos:     { label: 'Abdominaux', muscles: ['abs'], slots: ['abs'] },
};
// Douleurs ou limites : exercices exclus (avoid des mouvements), jamais un avis médical
const GEN_LIMITS = {
  epaule: { label: 'Épaule', sub: 'Pas de développé au-dessus de la tête ni de dips', why: 'pas de développé au-dessus de la tête ni de dips' },
  genou:  { label: 'Genou', sub: 'Pas de fentes, de sauts ni d\'extension des jambes', why: 'pas de fentes, de sauts ni d\'extension des jambes' },
  dos:    { label: 'Bas du dos', sub: 'Pas de soulevé de terre ni de charge sur le dos', why: 'pas de soulevé de terre ni de barre sur le dos' },
};

// ── Mouvements : catalogue existant, matériel détaillé ───────
// [nom (EXERCISE_CATALOGUE), motif, matériel requis (tous), options]. Ordre = préférence d'un pratiquant entraîné
// qui vise le muscle (poids libres d'abord) ; les règles de genRank le corrigent selon le profil.
// Options : c = polyarticulaire, g = guidé (machine ou poulie), avoid = limites qui l'excluent, bw = poids du corps
// qui soulève tout le corps ('pull', 'dip') ou presque ('push'), easy = variante plus facile, hard = réservé aux
// intermédiaires et avancés.
const GEN_MOVES = [
  // Squat (quadriceps, fessiers)
  ['Squat barre',                    'squat', ['barre'], { c: 1, avoid: ['genou', 'dos'] }],
  ['Presse à cuisses',               'squat', ['machines'], { c: 1, g: 1 }],
  ['Hack squat',                     'squat', ['machines'], { c: 1, g: 1, avoid: ['genou'] }],
  ['Squat smith',                    'squat', ['machines'], { c: 1, g: 1, avoid: ['dos'] }],
  ['Belt squat',                     'squat', ['machines'], { c: 1, g: 1 }],
  ['Squat gobelet',                  'squat', ['halteres'], { c: 1 }],
  ['Squat gobelet kettlebell',       'squat', ['kettlebell'], { c: 1 }],
  ['Squat élastique',                'squat', ['elastiques'], { c: 1 }],
  ['Squat poids du corps',           'squat', [], { c: 1 }],
  ['Squat sur chaise',               'squat', [], { c: 1, easy: 1 }],
  // Fentes (unilatéral)
  ['Fentes bulgares',                'lunge', ['halteres'], { c: 1, avoid: ['genou'] }],
  ['Fentes marchées haltères',       'lunge', ['halteres'], { c: 1, avoid: ['genou'] }],
  ['Montées sur banc haltères',      'lunge', ['halteres', 'banc'], { c: 1, avoid: ['genou'] }],
  ['Fentes',                         'lunge', [], { c: 1, avoid: ['genou'] }],
  // Charnière de hanche (ischios, fessiers)
  ['Soulevé de terre roumain',       'hinge', ['barre'], { c: 1, avoid: ['dos'] }],
  ['Soulevé de terre roumain haltères', 'hinge', ['halteres'], { c: 1, avoid: ['dos'] }],
  ['Soulevé de terre kettlebell',    'hinge', ['kettlebell'], { c: 1, avoid: ['dos'] }],
  ['Good morning élastique',         'hinge', ['elastiques'], { c: 1, avoid: ['dos'] }],
  // Fessiers
  ['Hip thrust',                     'glute', ['barre', 'banc'], { c: 1 }],
  ['Hip thrust machine',             'glute', ['machines'], { c: 1, g: 1 }],
  ['Hip thrust haltère',             'glute', ['halteres', 'banc'], { c: 1 }],
  ['Kickback fessier poulie',        'glute', ['poulie'], { g: 1 }],
  ['Pont fessier',                   'glute', [], {}],
  ['Marche latérale élastique',      'glute', ['elastiques'], {}],
  // Ischios (isolation)
  ['Leg curl machine',               'hams', ['machines'], { g: 1 }],
  ['Curl nordique',                  'hams', [], { hard: 1 }],
  ['Pont fessier unilatéral',        'hams', [], {}],
  // Quadriceps (isolation), mollets
  ['Extension quadriceps',           'knee_ext', ['machines'], { g: 1, avoid: ['genou'] }],
  ['Mollets debout',                 'calf', [], {}],
  ['Mollets assis',                  'calf', ['machines'], { g: 1 }],
  ['Mollets à la presse',            'calf', ['machines'], { g: 1 }],
  ['Mollets sur une marche',         'calf', [], {}],
  // Poussée horizontale (pectoraux)
  ['Développé couché barre',         'h_push', ['barre', 'banc'], { c: 1, avoid: ['epaule'] }],
  ['Développé couché haltères',      'h_push', ['halteres', 'banc'], { c: 1 }],
  ['Développé couché machine',       'h_push', ['machines'], { c: 1, g: 1 }],
  ['Développé au sol haltères',      'h_push', ['halteres'], { c: 1 }],
  ['Pompes',                         'h_push', [], { c: 1, bw: 'push' }],
  ['Pompes avec élastique',          'h_push', ['elastiques'], { c: 1, bw: 'push', hard: 1 }],
  ['Pompes inclinées',               'h_push', [], { c: 1, easy: 1 }],
  ['Pompes sur les genoux',          'h_push', [], { c: 1, easy: 1 }],
  // Poussée inclinée (haut des pectoraux)
  ['Développé incliné haltères',     'incline', ['halteres', 'banc'], { c: 1 }],
  ['Développé incliné barre',        'incline', ['barre', 'banc'], { c: 1, avoid: ['epaule'] }],
  ['Développé incliné smith',        'incline', ['machines'], { c: 1, g: 1 }],
  ['Pompes déclinées',               'incline', [], { c: 1, bw: 'push', hard: 1, avoid: ['epaule'] }],
  // Écartés (pectoraux, isolation)
  ['Écarté poulie vis-à-vis',        'fly', ['poulie'], { g: 1 }],
  ['Pec deck',                       'fly', ['machines'], { g: 1 }],
  ['Écarté haltères plat',           'fly', ['halteres', 'banc'], { avoid: ['epaule'] }],
  // Poussée verticale (épaules)
  ['Développé militaire haltères',   'v_push', ['halteres'], { c: 1, avoid: ['epaule'] }],
  ['Développé militaire barre',      'v_push', ['barre'], { c: 1, avoid: ['epaule'] }],
  ['Développé épaules machine',      'v_push', ['machines'], { c: 1, g: 1, avoid: ['epaule'] }],
  ['Développé épaule kettlebell',    'v_push', ['kettlebell'], { c: 1, avoid: ['epaule'] }],
  ['Développé épaules élastique',    'v_push', ['elastiques'], { c: 1, avoid: ['epaule'] }],
  ['Pompes pike (épaules)',          'v_push', [], { c: 1, hard: 1, avoid: ['epaule'] }],
  // Épaules latérales et postérieures
  ['Élévations latérales',           'lateral', ['halteres'], {}],
  ['Élévations latérales poulie',    'lateral', ['poulie'], { g: 1 }],
  ['Élévations latérales machine',   'lateral', ['machines'], { g: 1 }],
  ['Face pull',                      'rear', ['poulie'], { g: 1 }],
  ['Pec deck inversé',               'rear', ['machines'], { g: 1 }],
  ['Oiseau (élévations arrière)',    'rear', ['halteres'], {}],
  ['Pull-apart élastique',           'rear', ['elastiques'], {}],
  ['Face pull élastique',            'rear', ['elastiques'], {}],
  // Tirage vertical (grand dorsal)
  ['Tractions pronation',            'v_pull', ['traction'], { c: 1, bw: 'pull' }],
  ['Tirage vertical prise large',    'v_pull', ['poulie'], { c: 1, g: 1 }],
  ['Tractions assistées (machine)',  'v_pull', ['machines'], { c: 1, g: 1, easy: 1 }],
  ['Tractions supination',           'v_pull', ['traction'], { c: 1, bw: 'pull' }],
  ['Tirage vertical prise serrée',   'v_pull', ['poulie'], { c: 1, g: 1 }],
  ['Tractions avec élastique',       'v_pull', ['traction', 'elastiques'], { c: 1, easy: 1 }],
  ['Tractions négatives',            'v_pull', ['traction'], { c: 1, easy: 1 }],
  // Tirage horizontal (dos)
  ['Rowing barre',                   'h_pull', ['barre'], { c: 1, avoid: ['dos'] }],
  ['Rowing haltère unilatéral',      'h_pull', ['halteres'], { c: 1 }],
  ['Tirage horizontal câble',        'h_pull', ['poulie'], { c: 1, g: 1 }],
  ['Rowing machine',                 'h_pull', ['machines'], { c: 1, g: 1 }],
  ['Rowing haltères buste penché',   'h_pull', ['halteres'], { c: 1, avoid: ['dos'] }],
  ['Rowing kettlebell',              'h_pull', ['kettlebell'], { c: 1 }],
  ['Rowing élastique',               'h_pull', ['elastiques'], { c: 1 }],
  ['Tractions australiennes',        'h_pull', ['barre'], { c: 1 }],
  ['Rowing sous une table',          'h_pull', [], { c: 1 }],
  // Bras
  ['Curl biceps haltères',           'biceps', ['halteres'], {}],
  ['Curl biceps barre',              'biceps', ['barre'], {}],
  ['Curl poulie',                    'biceps', ['poulie'], { g: 1 }],
  ['Curl marteau',                   'biceps', ['halteres'], {}],
  ['Curl incliné',                   'biceps', ['halteres', 'banc'], {}],
  ['Curl pupitre',                   'biceps', ['machines'], { g: 1 }],
  ['Curl élastique',                 'biceps', ['elastiques'], {}],
  ['Extension triceps poulie haute', 'triceps', ['poulie'], { g: 1 }],
  ['Dips',                           'triceps', ['parallele'], { c: 1, bw: 'dip', avoid: ['epaule'] }],
  ['Extension triceps couché haltères', 'triceps', ['halteres', 'banc'], {}],
  ['Barre au front',                 'triceps', ['barre', 'banc'], {}],
  ['Extension nuque',                'triceps', ['halteres'], { avoid: ['epaule'] }],
  ['Dips assistés (machine)',        'triceps', ['machines'], { c: 1, g: 1, easy: 1, avoid: ['epaule'] }],
  ['Kickback triceps',               'triceps', ['halteres'], {}],
  ['Extension triceps élastique',    'triceps', ['elastiques'], {}],
  ['Pompes diamant',                 'triceps', [], { hard: 1 }],
  ['Dips sur chaise',                'triceps', [], { avoid: ['epaule'] }],
  // Abdominaux (répétitions : jamais un maintien chronométré)
  ['Crunch poulie',                  'abs', ['poulie'], { g: 1 }],
  ['Relevés de genoux suspendu',     'abs', ['traction'], {}],
  ['Crunch machine',                 'abs', ['machines'], { g: 1 }],
  ['Dead bug',                       'abs', [], {}],
  ['Crunch',                         'abs', [], {}],
].map(([name, pattern, needs, o], i) => Object.freeze({
  name, pattern, needs, i, compound: !!o.c, guided: !!o.g, avoid: o.avoid || [], bw: o.bw || null, easy: !!o.easy, hard: !!o.hard,
}));

// Motif de remplacement quand aucun mouvement ne convient (matériel, limite) : la séance garde son équilibre
const GEN_FALLBACK = {
  squat: ['lunge', 'glute'], lunge: ['squat', 'glute'], hinge: ['glute', 'hams'], v_push: ['lateral'],
  incline: ['h_push'], fly: ['h_push', 'incline'], v_pull: ['h_pull'], h_pull: ['v_pull'], hams: ['hinge', 'glute'], knee_ext: [],
};

// ── Splits et séances ────────────────────────────────────────
// Motifs de chaque séance, polyarticulaires d'abord. Les derniers tombent si le temps manque.
const GEN_SESSION_TYPES = {
  fb_a:  { label: 'Corps entier A', region: 'full',  slots: ['squat', 'h_push', 'v_pull', 'hinge', 'lateral', 'biceps', 'triceps', 'calf', 'abs'] },
  fb_b:  { label: 'Corps entier B', region: 'full',  slots: ['hinge', 'v_push', 'h_pull', 'lunge', 'fly', 'rear', 'triceps', 'biceps', 'abs'] },
  fb_c:  { label: 'Corps entier C', region: 'full',  slots: ['squat', 'incline', 'h_pull', 'hams', 'lateral', 'biceps', 'triceps', 'calf'] },
  haut_a: { label: 'Haut du corps A', region: 'upper', slots: ['h_push', 'v_pull', 'incline', 'h_pull', 'lateral', 'triceps', 'biceps', 'abs'] },
  haut_b: { label: 'Haut du corps B', region: 'upper', slots: ['v_push', 'h_pull', 'h_push', 'v_pull', 'lateral', 'rear', 'biceps', 'triceps'] },
  bas_a:  { label: 'Bas du corps A', region: 'lower', slots: ['squat', 'hinge', 'lunge', 'knee_ext', 'hams', 'calf', 'abs'] },
  bas_b:  { label: 'Bas du corps B', region: 'lower', slots: ['hinge', 'squat', 'glute', 'hams', 'knee_ext', 'calf', 'abs'] },
  push_a: { label: 'Pousser A', region: 'push', slots: ['h_push', 'v_push', 'incline', 'lateral', 'fly', 'triceps', 'triceps'] },
  push_b: { label: 'Pousser B', region: 'push', slots: ['incline', 'h_push', 'v_push', 'fly', 'lateral', 'triceps', 'triceps'] },
  pull_a: { label: 'Tirer A', region: 'pull', slots: ['v_pull', 'h_pull', 'h_pull', 'rear', 'biceps', 'biceps', 'abs'] },
  pull_b: { label: 'Tirer B', region: 'pull', slots: ['h_pull', 'v_pull', 'rear', 'h_pull', 'biceps', 'biceps', 'abs'] },
  legs_a: { label: 'Jambes A', region: 'lower', slots: ['squat', 'hinge', 'lunge', 'knee_ext', 'hams', 'calf', 'abs'] },
  legs_b: { label: 'Jambes B', region: 'lower', slots: ['hinge', 'squat', 'glute', 'hams', 'knee_ext', 'calf', 'abs'] },
};
// Régions qui reçoivent les exercices d'une zone prioritaire (motif → régions)
const GEN_SLOT_REGIONS = {
  fly: ['full', 'upper', 'push'], h_pull: ['full', 'upper', 'pull'], lateral: ['full', 'upper', 'push'], rear: ['full', 'upper', 'pull'],
  biceps: ['full', 'upper', 'pull'], triceps: ['full', 'upper', 'push'], glute: ['full', 'lower'], knee_ext: ['full', 'lower'],
  hams: ['full', 'lower'], calf: ['full', 'lower'], abs: ['full', 'upper', 'lower', 'pull'],
};
const GEN_SPLITS = {
  2: { id: 'full', sessions: ['fb_a', 'fb_b'] },
  3: { id: 'full', sessions: ['fb_a', 'fb_b', 'fb_c'] },
  4: { id: 'upper_lower', sessions: ['haut_a', 'bas_a', 'haut_b', 'bas_b'] },
  5: { id: 'ul_ppl', sessions: ['haut_a', 'bas_a', 'push_a', 'pull_a', 'legs_b'] },
  6: { id: 'ppl', sessions: ['push_a', 'pull_a', 'legs_a', 'push_b', 'pull_b', 'legs_b'] },
};
const GEN_COLORS = ['var(--teal)', 'var(--indigo)', 'var(--purple)', 'var(--yellow)', 'var(--brown)', 'var(--green)'];

// ── Volume visé ──────────────────────────────────────────────
// Muscles suivis : gros groupes à la cible entière, petits (travaillés aussi en secondaire) à 60 %
const GEN_TRACKED = ['chest', 'lats', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'];
const GEN_SMALL = new Set(['rear_delts', 'calves', 'abs']);
const GEN_BASE_SETS = { debutant: 8, reprise: 6, intermediaire: 12, avance: 16 };
const GEN_GOAL_FACTOR = { muscle: 1, seche: 0.85, force: 0.8, forme: 0.7 };
const GEN_MAX_SETS_EX = { debutant: 3, reprise: 3, intermediaire: 4, avance: 5 };
const GEN_PRIORITY_EXTRA = 4;
const GEN_MAX_WEEKLY = 20;
const GEN_SESSION_MUSCLE_CAP = 8;   // séries directes d'un muscle dans une séance (au-delà, rendement faible)
const GEN_WORK_S = 40;              // effort d'une série (≈ 10 reps)
const GEN_SWITCH_S = 60;            // changer d'exercice, régler la machine
const GEN_LIGHT_DB_KG = 12;         // haltères fixes les plus lourds ≤ 12 kg : fourchettes hautes
const GEN_BMI_HEAVY = 30;

const genSecondaryWeight = () => (typeof SECONDARY_WEIGHT === 'number' ? SECONDARY_WEIGHT : 0.5);

// Réponses nettoyées, bornées ; une réponse absente prend la valeur la plus courante
function genCleanAnswers(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const intIn = (v, lo, hi) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? Math.round(+v) : null);
  const numIn = (v, lo, hi) => (Number.isFinite(+v) && v !== null && v !== '' && +v >= lo && +v <= hi ? Math.round(+v * 10) / 10 : null);
  const equip = Array.isArray(r.equip) ? [...new Set(r.equip.filter(e => GEN_EQUIP_IDS.includes(e)))] : [];
  const loads = Array.isArray(r.dbLoads) ? [...new Set(r.dbLoads.map(v => numIn(v, 0.5, 80)).filter(v => v !== null))].sort((a, b) => a - b).slice(0, 20) : [];
  return {
    age: intIn(r.age, 10, 110), heightCm: intIn(r.heightCm, 100, 250), kg: numIn(r.kg, 25, 300),
    sex: r.sex === 'male' || r.sex === 'female' ? r.sex : null,
    goal: Object.hasOwn(GEN_GOALS, r.goal ?? '') ? r.goal : 'muscle',
    level: Object.hasOwn(GEN_LEVELS, r.level ?? '') ? r.level : 'intermediaire',
    days: GEN_DAYS.includes(+r.days) ? +r.days : 3,
    minutes: GEN_MINUTES.includes(+r.minutes) ? +r.minutes : 60,
    gym: r.gym === true || (r.gym !== false && !equip.length),
    equip, dbLoads: loads,
    zones: Array.isArray(r.zones) ? Object.keys(GEN_ZONES).filter(z => r.zones.includes(z)) : [],
    limits: Array.isArray(r.limits) ? Object.keys(GEN_LIMITS).filter(l => r.limits.includes(l)) : [],
  };
}

// Matériel disponible : ensemble d'identifiants (salle complète : tout, barres à dips comprises)
function genEquipSet(a) {
  if (a.gym) return new Set([...GEN_EQUIP_IDS, 'parallele']);
  const s = new Set(a.equip);
  if (s.has('halteres_fixes')) s.add('halteres');
  return s;
}
function genBmi(a) { return a.kg && a.heightCm ? a.kg / ((a.heightCm / 100) ** 2) : null; }
// Profil prudent : machines et poulies d'abord, fourchettes hautes
function genCautious(a) { return a.level === 'debutant' || a.level === 'reprise' || (a.age !== null && a.age >= 60); }
// Poids du corps lourd à soulever : débutant, reprise ou IMC de 30 et plus
function genBodyweightHeavy(a) {
  const bmi = genBmi(a);
  return a.level === 'debutant' || a.level === 'reprise' || (bmi !== null && bmi >= GEN_BMI_HEAVY);
}
function genLightDumbbells(a) {
  return !a.gym && a.equip.includes('halteres_fixes') && !a.equip.includes('halteres')
    && a.dbLoads.length > 0 && Math.max(...a.dbLoads) <= GEN_LIGHT_DB_KG;
}

// Séries visées par muscle et par semaine
function genWeeklyTargets(a) {
  let base = GEN_BASE_SETS[a.level] * GEN_GOAL_FACTOR[a.goal];
  if (a.age !== null && a.age >= 70) base *= 0.7;
  else if (a.age !== null && a.age >= 60) base *= 0.8;
  const prio = new Set(a.zones.flatMap(z => GEN_ZONES[z].muscles));
  const out = {};
  for (const m of GEN_TRACKED) {
    let t = GEN_SMALL.has(m) ? base * 0.6 : base;
    if (prio.has(m)) t = Math.min(GEN_MAX_WEEKLY, Math.max(t, base) + GEN_PRIORITY_EXTRA);
    out[m] = Math.max(4, Math.round(t));
  }
  return out;
}

// Mouvement possible : matériel, limites, niveau (les mouvements « hard » attendent un intermédiaire)
function genAllowed(move, a, equip) {
  if (!move.needs.every(n => equip.has(n))) return false;
  if (move.avoid.some(l => a.limits.includes(l))) return false;
  if (move.hard && (a.level === 'debutant' || a.level === 'reprise')) return false;
  return true;
}
// Rang de préférence (plus petit = choisi d'abord)
function genRank(move, a) {
  let r = move.i;
  if (genCautious(a)) { if (move.guided) r -= 200; if (move.needs.includes('barre')) r += 60; }
  if (a.goal === 'force' && move.compound && move.needs.includes('barre') && !genCautious(a)) r -= 200;
  if (move.bw && genBodyweightHeavy(a)) r += 300;
  if (move.easy) r += genBodyweightHeavy(a) ? -150 : 150;
  // En salle complète, kettlebell et élastiques passent après les barres, haltères et machines
  if (a.gym && (move.needs.includes('kettlebell') || move.needs.includes('elastiques'))) r += 100;
  // Intermédiaire ou avancé : un mouvement chargé avant sa version au poids du corps (squat, pont fessier)
  if (!move.needs.length && !move.bw && !move.hard && (a.level === 'intermediaire' || a.level === 'avance')) r += 80;
  return r;
}
function genCandidates(pattern, a, equip) {
  return GEN_MOVES.filter(m => m.pattern === pattern && genAllowed(m, a, equip))
    .sort((x, y) => genRank(x, a) - genRank(y, a) || x.i - y.i);
}

// Reps et repos d'un exercice. main : un des deux premiers polyarticulaires de la séance
function genScheme(move, a, main) {
  const cautious = genCautious(a), young = a.age !== null && a.age < 18;
  let s;
  if (a.goal === 'force' && main && move.compound) s = cautious || young ? { repMin: 5, repMax: 8, rest: 180 } : { repMin: 3, repMax: 6, rest: 180 };
  else if (a.goal === 'forme') s = move.compound ? { repMin: 10, repMax: 15, rest: 90 } : { repMin: 12, repMax: 15, rest: 60 };
  else if (a.level === 'reprise' || (a.age !== null && a.age >= 60)) s = move.compound ? { repMin: 10, repMax: 15, rest: 90 } : { repMin: 12, repMax: 15, rest: 75 };
  else if (a.level === 'debutant') s = move.compound ? { repMin: 8, repMax: 12, rest: 120 } : { repMin: 10, repMax: 15, rest: 75 };
  else s = move.compound ? { repMin: 6, repMax: 10, rest: 150 } : { repMin: 10, repMax: 15, rest: 90 };
  // Charge fixe ou légère (poids du corps hors tractions et dips, élastique, petits haltères) : séries longues,
  // menées près de l'échec (Schoenfeld et al. 2017 : l'hypertrophie se fait aussi avec des charges légères)
  // Curl nordique : très dur au poids du corps, peu de reps, jamais 20
  if (move.hard && move.pattern === 'hams') return { ...s, repMin: 4, repMax: 8 };
  // (en salle, les mollets et le crunch « sans matériel » se font à la machine ou lestés : pas concernés)
  const fixedLoad = (!move.needs.length && !a.gym && !move.bw) || move.needs.includes('elastiques')
    || (move.needs.includes('halteres') && genLightDumbbells(a));
  if (fixedLoad) s = { repMin: Math.max(s.repMin, 12), repMax: Math.max(s.repMax, 20), rest: Math.min(s.rest, move.compound ? 90 : 60) };
  // Pompes sans lest : tout le poids ou presque, comme une charge fixe
  if (move.bw === 'push' && !a.gym) s = { repMin: Math.max(s.repMin, 8), repMax: Math.max(s.repMax, 15), rest: Math.min(s.rest, 90) };
  // Tractions et dips au poids du corps : la charge est le poids du corps, 5 à 12 reps
  if (move.bw === 'pull' || move.bw === 'dip') s = { ...s, repMin: Math.min(s.repMin, 5), repMax: Math.min(Math.max(s.repMax, 8), 12) };
  return s;
}

const genSetSeconds = ex => GEN_WORK_S + ex.rest;
function genWarmupMinutes(minutes) { return minutes <= 30 ? 5 : 8; }
// Durée estimée d'une séance, en secondes
function genSessionSeconds(exercises, minutes) {
  if (!exercises.length) return 0;
  return genWarmupMinutes(minutes) * 60 + exercises.reduce((t, ex) => t + ex.sets * genSetSeconds(ex), 0) + (exercises.length - 1) * GEN_SWITCH_S;
}

function genMusclesOf(name) {
  const e = catalogueEntry(name);
  return { primary: e ? [...e.primary] : [], secondary: e ? [...e.secondary] : [] };
}
// Séries par semaine et par muscle (principal 1, secondaire SECONDARY_WEIGHT)
function genWeeklyVolume(sessions) {
  const v = Object.fromEntries(MUSCLES.map(m => [m.id, 0]));
  const w = genSecondaryWeight();
  for (const s of sessions) for (const ex of s.exercises) {
    const m = genMusclesOf(ex.name);
    m.primary.forEach(k => { v[k] += ex.sets; });
    m.secondary.forEach(k => { v[k] += ex.sets * w; });
  }
  return v;
}

// Motifs d'une séance, avec ceux des zones prioritaires placés juste après les polyarticulaires
function genSessionSlots(type, a) {
  const t = GEN_SESSION_TYPES[type];
  const slots = t.slots.map(p => ({ pattern: p, prio: false }));
  const extra = [];
  for (const z of a.zones) for (const p of GEN_ZONES[z].slots) {
    if (!GEN_SLOT_REGIONS[p]?.includes(t.region)) continue;
    const same = slots.filter(s => s.pattern === p);
    if (same.length) same.forEach(s => { s.prio = true; });
    if (same.length < 2 && !extra.some(s => s.pattern === p)) extra.push({ pattern: p, prio: true });
  }
  // Après le dernier polyarticulaire du début de séance (les deux ou trois premiers motifs)
  const firstIso = slots.findIndex(s => ['lateral', 'fly', 'rear', 'biceps', 'triceps', 'calf', 'abs', 'knee_ext', 'hams', 'glute'].includes(s.pattern));
  const at = firstIso < 0 ? slots.length : firstIso;
  slots.splice(at, 0, ...extra);
  return slots;
}

// Rang dans la séance : grands mouvements polyarticulaires, puis fessiers, puis isolation
const GEN_MAIN_PATTERNS = new Set(['squat', 'lunge', 'hinge', 'h_push', 'incline', 'v_push', 'v_pull', 'h_pull']);
function genOrderGroup(move) { return GEN_MAIN_PATTERNS.has(move.pattern) ? 0 : move.pattern === 'glute' ? 1 : 2; }

// Choix des exercices de toutes les séances : préférence, puis rotation entre les séances (A / B)
function genPickExercises(types, a, equip) {
  const used = {};          // motif → nombre de fois choisi dans la semaine
  return types.map(type => {
    const chosen = [];
    const names = new Set();
    for (const slot of genSessionSlots(type, a)) {
      const tryPattern = p => {
        const list = genCandidates(p, a, equip).filter(m => !names.has(m.name));
        if (!list.length) return null;
        // Alternance A / B entre les deux premiers, seulement s'ils sont du même rang (pas une version au rabais)
        const top = genRank(list[0], a);
        const pool = list.filter(m => genRank(m, a) - top < 50).slice(0, 2);
        const n = used[p] || 0;
        const pick = pool[n % pool.length];
        used[p] = n + 1;
        return pick;
      };
      // Profil prudent : la fente (équilibre sur une jambe) devient un squat guidé ou au poids du corps
      const pattern = slot.pattern === 'lunge' && genCautious(a) ? 'squat' : slot.pattern;
      let move = tryPattern(pattern);
      for (const fb of GEN_FALLBACK[slot.pattern] || []) { if (move) break; move = tryPattern(fb); }
      if (!move) continue;
      names.add(move.name);
      chosen.push({ move, prio: slot.prio });
    }
    // Polyarticulaires d'abord, même quand un remplacement en a placé un plus loin (tri stable)
    chosen.sort((x, y) => genOrderGroup(x.move) - genOrderGroup(y.move));
    return { type, chosen };
  });
}

// Programme généré : { split, sessions, weekly, targets, why, notes, answers }
function generateProgramme(raw) {
  const a = genCleanAnswers(raw);
  const equip = genEquipSet(a);
  const split = GEN_SPLITS[a.days];
  const targets = genWeeklyTargets(a);
  const budget = a.minutes * 60;
  const maxSets = GEN_MAX_SETS_EX[a.level] - (a.age !== null && a.age >= 60 && a.level !== 'debutant' && a.level !== 'reprise' ? 1 : 0);

  const picked = genPickExercises(split.sessions, a, equip);
  const sessions = picked.map(({ type, chosen }, si) => {
    let mainCount = 0;
    const exercises = chosen.map(({ move, prio }) => {
      const main = move.compound && mainCount++ < 2;
      // Départ : 2 séries, 3 pour les polyarticulaires d'un intermédiaire ou d'un avancé ; le reste suit les cibles
      const start = move.compound && (a.level === 'intermediaire' || a.level === 'avance') ? Math.min(3, maxSets) : 2;
      return { name: move.name, sets: start, ...genScheme(move, a, main), compound: move.compound, prio, pattern: move.pattern };
    });
    // Nombre d'exercices tenu par le temps : de quoi faire environ 3 séries chacun (2,5 en profil prudent),
    // plutôt que beaucoup d'exercices à 2 séries. On retire d'abord la fin de séance non prioritaire.
    const per = genCautious(a) ? 2.5 : 3;
    const avg = exercises.reduce((t, ex) => t + genSetSeconds(ex), 0) / Math.max(1, exercises.length);
    const maxEx = Math.max(2, Math.floor((budget - genWarmupMinutes(a.minutes) * 60 + GEN_SWITCH_S) / (per * avg + GEN_SWITCH_S)));
    const dropOne = () => {
      let k = -1;
      for (let i = exercises.length - 1; i >= 0; i--) if (!exercises[i].prio && !(exercises[i].compound && i < 2)) { k = i; break; }
      exercises.splice(k < 0 ? exercises.length - 1 : k, 1);
    };
    while (exercises.length > maxEx) dropOne();
    // Trop long : polyarticulaires ramenés à 2 séries d'abord, en partant de la fin ; puis on retire le dernier exercice non prioritaire
    for (let i = exercises.length - 1; i >= 0 && genSessionSeconds(exercises, a.minutes) > budget; i--) exercises[i].sets = Math.min(exercises[i].sets, 2);
    while (exercises.length > 1 && genSessionSeconds(exercises, a.minutes) > budget) dropOne();
    return { key: type, label: GEN_SESSION_TYPES[type].label, color: GEN_COLORS[si % GEN_COLORS.length], exercises };
  });

  // Séries ajoutées une à une là où le muscle principal est le plus loin de sa cible, tant que le temps le permet
  const vol = genWeeklyVolume(sessions);
  const w = genSecondaryWeight();
  const sessMuscle = sessions.map(s => {
    const c = {};
    s.exercises.forEach(ex => genMusclesOf(ex.name).primary.forEach(k => { c[k] = (c[k] || 0) + ex.sets; }));
    return c;
  });
  const cap = a.level === 'avance' ? GEN_SESSION_MUSCLE_CAP + 2 : GEN_SESSION_MUSCLE_CAP;
  for (let guard = 0; guard < 500; guard++) {
    let best = null;
    sessions.forEach((s, si) => {
      const left = budget - genSessionSeconds(s.exercises, a.minutes);
      s.exercises.forEach((ex, ei) => {
        if (ex.sets >= maxSets || left < genSetSeconds(ex)) return;
        const prim = genMusclesOf(ex.name).primary.filter(k => targets[k]);
        if (!prim.length || prim.some(k => (sessMuscle[si][k] || 0) >= cap)) return;
        // Jamais au-delà de 20 séries par semaine (ou de la cible si elle est plus haute) pour un muscle principal
        if (prim.some(k => vol[k] + 1 > Math.max(targets[k], GEN_MAX_WEEKLY))) return;
        const need = Math.max(...prim.map(k => (targets[k] - vol[k]) / targets[k]));
        if (need <= 0) return;
        const cand = { si, ei, need, sets: ex.sets, compound: ex.compound };
        if (!best || need > best.need + 1e-9 || (Math.abs(need - best.need) < 1e-9
          && (cand.sets < best.sets || (cand.sets === best.sets && cand.compound && !best.compound)))) best = cand;
      });
    });
    if (!best) break;
    const ex = sessions[best.si].exercises[best.ei];
    ex.sets++;
    const m = genMusclesOf(ex.name);
    m.primary.forEach(k => { vol[k] += 1; sessMuscle[best.si][k] = (sessMuscle[best.si][k] || 0) + 1; });
    m.secondary.forEach(k => { vol[k] += w; });
  }

  sessions.forEach(s => {
    s.seconds = genSessionSeconds(s.exercises, a.minutes);
    s.minutes = Math.ceil(s.seconds / 60);
    s.desc = genSessionDesc(s.exercises);
  });
  const weekly = genWeeklyVolume(sessions);
  return { answers: a, split: split.id, sessions, weekly, targets, why: genWhy(a, sessions, weekly, targets), notes: genNotes(a) };
}

// « Quadriceps · Fessiers · Ischio-jambiers » : les trois muscles qui reçoivent le plus de séries principales
function genSessionDesc(exercises) {
  const c = new Map();
  exercises.forEach(ex => genMusclesOf(ex.name).primary.forEach(k => {
    const l = MUSCLE_BY_ID.get(k)?.short || muscleLabel(k);
    c.set(l, (c.get(l) || 0) + ex.sets);
  }));
  return [...c.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([l]) => l).join(' · ');
}

const GEN_SPLIT_WHY = {
  full: n => `${n} séances parce que tu as ${n} jours : tout le corps à chaque fois, chaque muscle ${n === 2 ? 'deux' : 'trois'} fois par semaine.`,
  upper_lower: () => '4 séances parce que tu as 4 jours : le haut du corps puis le bas, chaque muscle deux fois par semaine.',
  ul_ppl: () => '5 séances parce que tu as 5 jours : haut, bas, puis pousser, tirer et jambes ; chaque muscle deux fois par semaine.',
  ppl: () => '6 séances parce que tu as 6 jours : pousser, tirer, jambes, deux fois ; chaque muscle deux fois par semaine.',
};
const GEN_LEVEL_WHY = { debutant: 'tu débutes', reprise: 'tu reprends en douceur', intermediaire: 'niveau intermédiaire', avance: 'niveau avancé' };
const GEN_GOAL_WHY = { muscle: 'prise de muscle', force: 'force', forme: 'remise en forme', seche: 'perte de gras' };

// Deux ou trois lignes : pourquoi ces séances, ce volume, ces limites
function genWhy(a, sessions, weekly, targets) {
  const lines = [GEN_SPLIT_WHY[GEN_SPLITS[a.days].id](a.days)];
  const big = ['chest', 'lats', 'quads', 'glutes'];
  const typical = Math.round(big.reduce((t, k) => t + targets[k], 0) / big.length);
  const prioMuscles = [...new Set(a.zones.flatMap(z => GEN_ZONES[z].muscles))];
  let vol = `Environ ${typical} séries par muscle et par semaine (${GEN_LEVEL_WHY[a.level]}, ${GEN_GOAL_WHY[a.goal]}${a.age !== null && a.age >= 60 ? `, ${a.age} ans` : ''})`;
  if (prioMuscles.length) {
    vol += ` ; ${prioMuscles.map(k => `${Math.round(weekly[k])} pour ${genMuscleWord(k)}`).join(', ')}, ${prioMuscles.length > 1 ? 'tes priorités' : 'ta priorité'}`;
  }
  lines.push(vol + '.');
  const longest = Math.max(...sessions.map(s => s.minutes));
  const short = GEN_TRACKED.filter(k => !GEN_SMALL.has(k) && weekly[k] < targets[k] - 2 && weekly[k] > 0);
  let third = `Séances de ${longest} min au plus pour ${a.minutes} min disponibles`;
  if (short.length) third += ` : le temps limite ${short.slice(0, 2).map(genMuscleWord).join(' et ')}`;
  if (a.limits.length) third += `. ${a.limits.map(l => `${GEN_LIMITS[l].label} : ${GEN_LIMITS[l].why}`).join('. ')}`;
  lines.push(third + '.');
  return lines;
}
function genMuscleWord(k) {
  const words = { chest: 'les pectoraux', lats: 'le dos', side_delts: 'les épaules', rear_delts: 'l\'arrière des épaules', biceps: 'les biceps',
    triceps: 'les triceps', quads: 'les quadriceps', hamstrings: 'les ischios', glutes: 'les fessiers', calves: 'les mollets', abs: 'les abdos' };
  return words[k] || muscleLabel(k).toLowerCase();
}
// Remarques sur des choix de profil (affichées sous l'aperçu)
function genNotes(a) {
  const notes = [];
  const bmi = genBmi(a);
  const equip = genEquipSet(a);
  if (genBodyweightHeavy(a) && (equip.has('traction') || equip.has('parallele'))) {
    notes.push(bmi !== null && bmi >= GEN_BMI_HEAVY && a.level !== 'debutant' && a.level !== 'reprise'
      ? 'Tractions et dips : variantes assistées d\'abord, ils soulèvent tout ton poids.'
      : 'Tractions et dips : variantes assistées d\'abord, le temps de gagner en force.');
  }
  if (genLightDumbbells(a)) notes.push(`Haltères de ${fmtNum(Math.max(...a.dbLoads))} kg au plus : séries longues, jusqu'à 20 reps, menées près de l'échec.`);
  if (a.limits.length) notes.push('Ce n\'est pas un avis médical. Si une douleur persiste, parles-en à un professionnel de santé.');
  return notes;
}

// Niveau déduit de l'historique (séances de musculation), null sans historique. Régularité = au moins 1,5 séance
// par semaine sur les 12 dernières semaines ; dernière séance il y a plus de 90 jours après six mois ou plus : reprise.
function genLevelFromHistory(history, now = Date.now()) {
  const dates = (Array.isArray(history) ? history : []).map(h => h?.date).filter(Number.isFinite).sort((x, y) => x - y);
  if (!dates.length) return null;
  const day = 86400e3, span = (dates.at(-1) - dates[0]) / day, since = (now - dates.at(-1)) / day;
  if (since > 90) return span >= 180 ? 'reprise' : 'debutant';
  const recent = dates.filter(d => now - d <= 84 * day).length / 12;
  if (span < 180 || recent < 1.5) return 'debutant';
  return span >= 3 * 365 ? 'avance' : 'intermediaire';
}

// Programme généré → programme perso MDLF (même format que « Créer un programme ») : { up, pd }
function genProgrammeData(result, name) {
  const sessions = {}, exercises = {}, timers = {}, cooldowns = {};
  result.sessions.forEach(s => {
    sessions[s.key] = { label: s.label, icon: '', desc: s.desc, color: s.color };
    exercises[s.key] = s.exercises.map(ex => ({ ...makeExercise(ex.name, ex.sets), rest: ex.rest, repMin: ex.repMin, repMax: ex.repMax }));
    timers[s.key] = null;
    cooldowns[s.key] = 72;
  });
  return { up: { name, sessions, order: result.sessions.map(s => s.key), archived: false }, pd: { exercises, timers, cooldowns } };
}

// Nom libre parmi les programmes de la personne : « Sur mesure », puis « Sur mesure 2 »…
function genProgrammeName(d = data) {
  const taken = new Set(Object.values(d?.userProgrammes || {}).filter(p => !p.archived).map(p => p.name));
  if (!taken.has('Sur mesure')) return 'Sur mesure';
  for (let i = 2; ; i++) if (!taken.has(`Sur mesure ${i}`)) return `Sur mesure ${i}`;
}
