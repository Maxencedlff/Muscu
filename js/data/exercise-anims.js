// ═══════════════════════════════════════════════════════════
//  Animations 3D du personnage maison (dépôt mdlf-perso, Blender + MPFB2 CC0) : 1 répétition en boucle,
//  muette, 720 × 720, muscles principaux en rouge ombré et secondaires en rouge atténué.
//  Repli du « Comment faire » quand aucun coach n'a filmé l'exercice (vidéos réelles :
//  js/data/exercise-videos.js, toujours prioritaires). Fichiers dans l'app : img/anim/<fichier>.mp4|webm|webp,
//  vidéos mises en cache par sw.js au premier visionnage, affiches dès l'installation.
// ═══════════════════════════════════════════════════════════
'use strict';

const EXERCISE_ANIM_DIR = 'img/anim/';
// Nom de la bibliothèque → nom de fichier (sans extension)
const EXERCISE_ANIMS = {
  'Squat barre': 'squat-barre',
  'Développé couché barre': 'developpe-couche-barre',
  // 'Soulevé de terre' retiré le 13/11/2026 : départ en squat et corps qui se traversent, à refaire (mdlf-perso)
  'Tractions pronation': 'tractions-pronation',
  'Curl biceps haltères': 'curl-biceps-halteres',
};

// Animation 3D d'un exercice (nom de la bibliothèque, alias ou nom tapé) ; null s'il n'y en a pas.
// H.264 d'abord (iPhone, Safari, Android), VP9 ensuite (navigateurs sans H.264)
function exerciseAnim(name) {
  const own = catalogueEntry(name)?.name;
  const file = own && Object.hasOwn(EXERCISE_ANIMS, own) ? EXERCISE_ANIMS[own] : null;
  if (!file) return null;
  const base = EXERCISE_ANIM_DIR + file;
  return {
    sources: [{ src: base + '.mp4', type: 'video/mp4; codecs="avc1.64001F"' }, { src: base + '.webm', type: 'video/webm; codecs="vp9"' }],
    poster: base + '.webp', width: 720, height: 720,
  };
}
