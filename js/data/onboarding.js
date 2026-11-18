// ═══════════════════════════════════════════════════════════
//  Premier lancement : logique pure des trois questions (sans écran)
//
//  Où ? Combien de fois par semaine ? Quel niveau ? → un programme intégré (PROGRAMMES), la phrase qui
//  explique ce choix et les séances en clair. Les écrans sont dans js/features/onboarding.js.
// ═══════════════════════════════════════════════════════════
'use strict';

// Lieu : filtre de matériel de la feuille d'ajout d'exercice (data.exEquip, ids d'EQUIPMENT)
const ONB_PLACES = {
  salle:    { label: 'En salle',                    sub: 'Machines, barres et haltères',  equip: 'all' },
  halteres: { label: 'Chez moi, avec des haltères', sub: 'Haltères, et un banc si possible', equip: 'halteres' },
  rien:     { label: 'Chez moi, sans matériel',     sub: 'Poids du corps',                equip: 'aucun' },
};
// Séances par semaine : la réponse devient aussi l'objectif de la carte « Cette semaine » de l'accueil (data.weeklyGoal)
const ONB_FREQS = [
  { n: 2, label: '2 fois' },
  { n: 3, label: '3 fois' },
  { n: 4, label: '4 fois' },
  { n: 5, label: '5 fois ou plus' },
];
const ONB_LEVELS = {
  debutant: { label: 'Je débute',            sub: 'Moins de six mois de musculation' },
  confirme: { label: 'Je m\'entraîne déjà',  sub: 'Six mois ou plus, avec régularité' },
  // Ouvre le Sur mesure (niveau « reprise », limites à cocher) ; le programme conseillé reste celui d'un débutant
  reprise:  { label: 'Je reprends ou j\'ai une douleur', sub: 'Programme adapté à tes limites' },
};
// Réponses qui comptent comme un débutant pour le choix du programme et data.level
const ONB_GENTLE = ['debutant', 'reprise'];

// Programme conseillé, parmi les programmes intégrés seulement.
// - Sans matériel : Maison, le seul programme au poids du corps.
// - Haltères : Maison haltères, quel que soit le reste. Le filtre de matériel ne touche que la feuille
//   d'ajout d'exercice : Full Body ou Upper / Lower garderaient squat barre, presse et poulies.
// - En salle, la fréquence décide, le niveau départage :
//     qui débute ou reprend : Full Body quelle que soit la fréquence (regard neuf du 16/11 : Upper / Lower et PPL
//              commencent par le squat barre et durent 55 à 70 min). Full Body : machines et haltères d'abord,
//              une seule séance à retenir, environ 45 min ;
//     sinon, 2 fois : Full Body, seul moyen de travailler chaque muscle deux fois en deux séances ;
//            3 fois : PPL (plus de volume par muscle, une fois par semaine chacun) ;
//            4 fois : Upper / Lower, chaque muscle deux fois par semaine ;
//            5 fois ou plus : PPL (le cycle de trois repasse dans la semaine, chaque muscle presque deux fois).
//   Bro Split et Arnold Split ne sont jamais proposés d'office : un muscle une fois par semaine,
//   avec beaucoup de séances. Ils restent dans « Voir les autres programmes ».
// Réponse inconnue ou absente : la valeur la plus courante (salle, 3 fois, déjà entraîné).
function recommendProgramme({ place, perWeek, level } = {}) {
  if (place === 'rien') return 'maison';
  if (place === 'halteres') return 'maison_halteres';
  const n = Math.max(2, Math.min(5, parseInt(perWeek, 10) || 3));
  if (ONB_GENTLE.includes(level) || n === 2) return 'fullbody';
  return n === 4 ? 'upper_lower' : 'ppl';
}

// Pourquoi ce programme, en une ou deux phrases (écran de résultat, catalogue « Tous les programmes »).
// orMore : 5 se lit « 5 séances ou plus » (réponse « 5 fois ou plus »), pas dans le catalogue
function recommendReason(id, { perWeek, level, orMore = true } = {}) {
  const n = Math.max(2, Math.min(5, parseInt(perWeek, 10) || 3));
  const times = n >= 5 && orMore ? '5 séances ou plus' : `${n} séances`;
  const beginner = ONB_GENTLE.includes(level);
  switch (id) {
    case 'fullbody':
      return `${times} par semaine, tout le corps à chaque fois.${beginner ? ' Pour débuter : machines et haltères, environ 45 min.' : ' Chaque muscle travaille souvent, sans longues séances.'}`;
    case 'upper_lower':
      return `${times} par semaine : le haut du corps, puis le bas, en alternance. Chaque muscle travaille deux fois par semaine.`;
    case 'ppl':
      return n >= 5
        ? `${times} par semaine : pousser, tirer, puis jambes. Chaque muscle travaille presque deux fois par semaine.`
        : `${times} par semaine : pousser, tirer, puis jambes. Plus de volume par muscle, avec le temps de récupérer.`;
    case 'maison':
      return `${times} par semaine, sans matériel : le haut du corps, puis le bas, en alternance.`;
    case 'maison_halteres':
      return `${times} par semaine avec des haltères : pousser, tirer, puis jambes, en alternance.`;
    // Jamais conseillés par les questions, décrits dans le catalogue (js/data/my-programmes.js)
    case 'bro':
      return `${times} par semaine : un groupe de muscles par séance. Chaque muscle travaille une fois par semaine, avec beaucoup de volume.`;
    case 'arnold':
      return `${times} par semaine : pectoraux et dos, épaules et bras, puis jambes. Avec 5 séances ou plus, chaque muscle travaille presque deux fois.`;
    default:
      return '';
  }
}

// Séances d'un programme intégré pour l'écran de résultat : { cat, label, plain, muscles, color }
// plain : traduction du nom quand il est en anglais, sinon '' ; muscles en minuscules, séparés par « · »
function programmePreview(id) {
  const p = PROGRAMMES[id];
  if (!p) return [];
  return Object.entries(p.sessions).map(([cat, s]) => ({
    cat, label: s.label, color: s.color,
    plain: SESSION_PLAIN[cat] && SESSION_PLAIN[cat] !== s.label ? SESSION_PLAIN[cat] : '',   // « Jambes » du Bro Split : déjà en clair
    muscles: s.desc.split(' · ').map(m => m.toLowerCase()).join(' · '),
  }));
}
