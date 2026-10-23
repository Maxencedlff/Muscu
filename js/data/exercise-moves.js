// ═══════════════════════════════════════════════════════════
//  « Comment faire » : mouvement de chaque exercice (positions clés) ; consignes dans exercise-howto.js
//  Dessiné et animé par js/ui/exercise-anim.js ; noms identiques à la bibliothèque
// ═══════════════════════════════════════════════════════════
'use strict';

// Repère du dessin : 200 × 200, y vers le bas, sol à y = 172, personnage de profil tourné vers la droite.
// Une position clé fixe le bassin (hip), l'angle du buste (torso, en degrés : -90 = vertical), la cible
// des mains (hand) et des chevilles (ankle) ; coudes et genoux sont calculés (cinématique inverse à
// 2 segments), avec le sens de pliage de chaque articulation (bend : 1 ou -1).
// Le mouvement parcourt les positions dans l'ordre puis revient ; equip : null, 'dumbbell', 'barbell'.
// ready : affiché dans l'app. Le premier style (mannequin en bâtons) n'a pas convaincu : les positions
// restent, en attendant un dessin dans le style de la silhouette des muscles.
const EXERCISE_MOVES = {
  'Squat poids du corps': {
    equip: null, ready: false,
    poses: [
      { hip: [101, 93], torso: -90, hand: [102, 146], ankle: [104, 166] },
      { hip: [72, 134], torso: -50, hand: [146, 98], ankle: [104, 166] },
    ],
    bend: { knee: -1, elbow: 1 },
  },
  'Pompes': {
    equip: null, ready: false,
    poses: [
      { hip: [110, 135], torso: -20, hand: [158, 171], ankle: [40, 160] },
      { hip: [114, 152], torso: -6, hand: [158, 171], ankle: [40, 160] },
    ],
    bend: { knee: -1, elbow: 1 },
  },
  'Curl biceps haltères': {
    equip: 'dumbbell', ready: false,
    poses: [
      { hip: [101, 95], torso: -90, hand: [103, 98], ankle: [102, 168] },
      { hip: [101, 95], torso: -90, hand: [127, 74], ankle: [102, 168] },
      { hip: [101, 95], torso: -90, hand: [116, 50], ankle: [102, 168] },
    ],
    bend: { knee: -1, elbow: 1 },
  },
};

// Mouvement affichable d'un exercice, null s'il n'y en a pas (ou pas encore de dessin validé)
function exerciseMove(name) {
  const own = catalogueEntry(name)?.name || name;
  return EXERCISE_MOVES[own]?.ready ? EXERCISE_MOVES[own] : null;
}
