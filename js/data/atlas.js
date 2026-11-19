// ═══════════════════════════════════════════════════════════
//  Atlas détaillé : sous-muscles d'un exercice (fiche de la bibliothèque)
// ═══════════════════════════════════════════════════════════
'use strict';

// Données générées : BODY_PARTS (js/data/body-parts.js, noms et boîtes des calques) et EXERCISE_PARTS
// (js/data/exercise-parts.js, sous-muscles par exercice). Affichage : bodyAtlasHtml (js/ui/body-map.js),
// zoom et noms au toucher : js/ui/body-zoom.js.
// Intensités : 2 = rouge plein (comme un muscle principal aujourd'hui), 1 = rouge atténué (secondaire).

const ATLAS_PARTS = new Map(BODY_PARTS.parts.map((p, rank) => [p.id, { ...p, rank }]));

function atlasPart(id) { return ATLAS_PARTS.get(id) || null; }

// Sous-muscles visibles d'un muscle de l'app (les profonds ne se montrent que nommés par un exercice)
function atlasPartsOf(muscle) {
  return BODY_PARTS.parts.filter(p => p.parent === muscle && !p.deep).map(p => p.id);
}

// Parents (muscles de l'app) d'une liste de sous-muscles ; null (muscles seulement nommés au toucher) ignoré
function atlasParents(ids) {
  return [...new Set(ids.map(id => atlasPart(id)?.parent).filter(Boolean))];
}

const atlasSameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

// Sous-muscles colorés pour un exercice : { levels: { id: 2|1 }, source }.
//   'atlas'    détail de la correspondance (EXERCISE_PARTS), seulement si ses muscles parents sont exactement
//              ceux affichés (muscles vérifiés de la bibliothèque, jamais modifiés par la personne) : la carte
//              ne contredit jamais les pastilles
//   'muscles'  repli : chaque muscle entier, tous ses sous-muscles (2 pour un principal, 1 pour un secondaire)
// name : nom de l'exercice ; m : { primary, secondary, source } (exerciseMuscles)
function exercisePartLevels(name, m) {
  const primary = m?.primary || [], secondary = m?.secondary || [];
  const e = m?.source === 'catalogue' ? EXERCISE_PARTS[catalogueEntry(name)?.name] : null;
  if (e && atlasSameSet(atlasParents(Object.keys(e.p)), primary)
      && atlasParents(Object.keys(e.s)).every(id => primary.includes(id) || secondary.includes(id))
      && secondary.every(id => atlasParents(Object.keys(e.s)).includes(id))) {
    return { levels: { ...e.s, ...e.p }, source: 'atlas' };
  }
  const levels = {};
  secondary.forEach(id => atlasPartsOf(id).forEach(p => { levels[p] = 1; }));
  primary.forEach(id => atlasPartsOf(id).forEach(p => { levels[p] = 2; }));
  return { levels, source: 'muscles' };
}

// Rôle dit dans la bulle d'un sous-muscle touché, d'après sa couleur à l'écran (comme la légende de la fiche :
// « Principaux en rouge plein, secondaires en rouge atténué »)
function atlasRole(level) {
  return level >= 2 ? 'Muscle principal' : level === 1 ? 'Muscle secondaire' : 'Non ciblé par cet exercice';
}
