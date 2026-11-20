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

// ── Noms de salle : pastilles et titre de la bulle ──────────
// Pastille d'un sous-muscle : son nom de salle quand le découpage compte à la salle (faisceaux du pectoral et du
// trapèze, coiffe, rhomboïdes…), sinon le nom du muscle de l'app (les trois chefs du triceps font « Triceps »).
// Pectoral : claviculaire = haut, sterno-costal = milieu (la plus grande partie), abdominal = bas.
const ATLAS_PILL = {
  chest_clavicular: 'Haut des pectoraux', chest_sternal: 'Milieu des pectoraux', chest_abdominal: 'Bas des pectoraux',
  pec_minor: 'Petit pectoral', serratus: 'Dentelé antérieur',
  traps_upper: 'Haut des trapèzes', traps_middle: 'Milieu des trapèzes', traps_lower: 'Bas des trapèzes',
  levator_scapulae: 'Élévateur de la scapula', rhomboid_minor: 'Rhomboïdes', rhomboid_major: 'Rhomboïdes',
  teres: 'Grand rond', infraspinatus: 'Coiffe des rotateurs', teres_minor: 'Coiffe des rotateurs',
  glute_max: 'Grand fessier', glute_med: 'Moyen fessier', tfl: 'Tenseur du fascia lata', sartorius: 'Sartorius',
  scm: 'Sterno-cléido-mastoïdien', coracobrachialis: 'Coraco-brachial', tibialis: 'Tibial antérieur', peroneus: 'Long fibulaire',
};
function atlasPillLabel(id) {
  const p = atlasPart(id);
  return ATLAS_PILL[id] || (p?.parent ? muscleLabel(p.parent) : p?.name || id);
}
// Titre de la bulle : le nom de la pastille s'il ne désigne que ce sous-muscle, sinon son nom précis
// (« Triceps, chef latéral » sous la pastille « Triceps ») : la bulle commence toujours par le nom de la pastille
function atlasPartTitle(id) {
  const label = atlasPillLabel(id);
  const shared = BODY_PARTS.parts.some(p => p.id !== id && atlasPillLabel(p.id) === label);
  if (!shared) return label;
  const name = atlasPart(id).name;
  if (name.startsWith(label)) return name;
  // « Mollet, gastrocnémien médial » → « Mollets, gastrocnémien médial » ; « Petit rond (coiffe) » → « Coiffe des rotateurs, petit rond »
  const precise = (name.includes(', ') ? name.slice(name.indexOf(', ') + 2) : name).replace(/\s*\(.*\)$/, '');
  return `${label}, ${precise.charAt(0).toLowerCase()}${precise.slice(1)}`;
}
// Pastilles de la fiche, dans l'ordre : rouge plein d'abord (intensité 2), puis atténué ; un nom une seule fois, à
// l'intensité la plus forte de ses sous-muscles. [{ label, level }]
function atlasPills(levels) {
  const by = new Map();
  for (const p of BODY_PARTS.parts) {
    const lv = levels[p.id];
    if (!(lv > 0)) continue;
    const label = atlasPillLabel(p.id);
    by.set(label, Math.max(by.get(label) || 0, lv));
  }
  return [...by].map(([label, level]) => ({ label, level })).sort((a, b) => b.level - a.level);
}

