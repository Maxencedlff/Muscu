// ═══════════════════════════════════════════════════════════
//  « Comment faire » : mouvement de chaque exercice (positions clés) et consignes
//  Dessiné et animé par js/ui/exercise-anim.js ; noms identiques à la bibliothèque
// ═══════════════════════════════════════════════════════════
'use strict';

// Repère du dessin : 200 × 200, y vers le bas, sol à y = 172, personnage de profil tourné vers la droite.
// Une position clé fixe le bassin (hip), l'angle du buste (torso, en degrés : -90 = vertical), la cible
// des mains (hand) et des chevilles (ankle) ; coudes et genoux sont calculés (cinématique inverse à
// 2 segments), avec le sens de pliage de chaque articulation (bend : 1 ou -1).
// Le mouvement parcourt les positions dans l'ordre puis revient ; equip : null, 'dumbbell', 'barbell'.
const EXERCISE_MOVES = {
  'Squat poids du corps': {
    equip: null,
    poses: [
      { hip: [101, 93], torso: -90, hand: [102, 146], ankle: [104, 166] },
      { hip: [72, 134], torso: -50, hand: [146, 98], ankle: [104, 166] },
    ],
    bend: { knee: -1, elbow: 1 },
    cues: ['Pieds largeur d\'épaules, pointes légèrement ouvertes', 'Descends en poussant les hanches en arrière, dos droit',
      'Genoux dans l\'axe des pieds, talons au sol', 'Remonte en poussant dans le sol'],
    mistake: 'Genoux qui rentrent vers l\'intérieur, ou talons qui décollent',
  },
  'Pompes': {
    equip: null,
    poses: [
      { hip: [110, 135], torso: -20, hand: [158, 171], ankle: [40, 160] },
      { hip: [114, 152], torso: -6, hand: [158, 171], ankle: [40, 160] },
    ],
    bend: { knee: -1, elbow: 1 },
    cues: ['Mains un peu plus larges que les épaules', 'Corps gainé en ligne droite, de la tête aux talons',
      'Descends la poitrine près du sol, coudes à 45° du corps', 'Pousse jusqu\'à tendre les bras'],
    mistake: 'Bassin qui s\'affaisse ou fesses trop hautes',
  },
  'Curl biceps haltères': {
    equip: 'dumbbell',
    poses: [
      { hip: [101, 95], torso: -90, hand: [103, 98], ankle: [102, 168] },
      { hip: [101, 95], torso: -90, hand: [127, 74], ankle: [102, 168] },
      { hip: [101, 95], torso: -90, hand: [116, 50], ankle: [102, 168] },
    ],
    bend: { knee: -1, elbow: 1 },
    cues: ['Debout, coudes collés au corps', 'Monte l\'haltère en pliant seulement le coude',
      'Serre le biceps en haut, une seconde', 'Redescends lentement jusqu\'à bras tendu'],
    mistake: 'Balancer le buste ou avancer les coudes pour monter',
  },
};

function exerciseMove(name) {
  const own = catalogueEntry(name)?.name || name;
  return EXERCISE_MOVES[own] || null;
}
