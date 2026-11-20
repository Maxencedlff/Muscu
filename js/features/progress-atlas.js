// ═══════════════════════════════════════════════════════════
//  Progrès › Muscles : personnage détaillé, travail de la période par sous-muscle
// ═══════════════════════════════════════════════════════════
'use strict';

// Même lecture que la carte des 18 muscles : plus le rouge est soutenu, plus le sous-muscle a travaillé ; même échelle de
// paliers (séries par semaine : MUSCLE_LEVEL_FROM, légende muscleLegendHtml) et mêmes périodes (muscleSpan). Un
// sous-muscle non travaillé reste gris : c'est lui qu'il faut regarder pour équilibrer. Volume : séances de la période ×
// correspondance exercice → sous-muscles (partLoad, js/data/atlas.js : principal 1 série, secondaire ½). Bas du corps :
// carte simple (le palier du muscle entier) jusqu'au détail des jambes. Zoom et nom au toucher : js/ui/body-zoom.js.

// lowMuscles : les muscles de la ligne « Peu travaillés » (ids des 18 muscles) ; leurs sous-muscles sont hachurés
function progressAtlasHtml(span = muscleSpan, lowMuscles = []) {
  const { levels } = partLoad(span);
  const on = Object.fromEntries(Object.entries(levels).filter(([, l]) => l > 0));
  const low = BODY_PARTS.parts.filter(p => lowMuscles.includes(p.parent)).map(p => p.id);
  return atlasBoxHtml(bodyAtlasHtml(on, { className: 'mcard__map', title: 'Muscles travaillés', tap: true, tiers: true, tip: 'load', crop: false, captions: true, low }), 'mcard__box');
}

// Dessin et son bouton Agrandir, dans un coin du dessin (panel affichage-e t3 : un grand vide le séparait du
// personnage) : en haut à droite, où ne passent ni la tête ni les bras ; carte cadrée sur les jambes : en bas à droite
// (les mains sont en haut). Le bouton dit qu'on peut zoomer (panel t1) ; fiche et Progrès
function atlasBoxHtml(mapHtml, className, corner = 'top') {
  return `<div class="atlas-box atlas-box--${corner} ${className}">${mapHtml}<button class="mpanel__zoom" data-action="atlas-open" aria-label="Agrandir le personnage">${icon('arrow.up.left.and.arrow.down.right', 22)}</button></div>`;
}

// Légende des paliers (carte de Progrès et vue agrandie) : mêmes noms partout, chaque palier avec ses bornes en séries
// par semaine ; hatch : les hachures des muscles « Peu travaillés »
function muscleLegendItemsHtml(hatch = false) {
  return `${MUSCLE_LEVEL_WORDS.map((w, lvl) => `<span class="mlegend__item">${muscleLevelDot(lvl)}${w}${lvl ? ` <span class="mlegend__n num">${muscleLevelRange(lvl)}</span>` : ''}</span>`).join('')}
    ${hatch ? '<span class="mlegend__item"><i class="mlegend__dot mlegend__dot--low"></i>Peu travaillés</span>' : ''}`;
}

// Bulle d'un sous-muscle touché : nom de salle, séries de la période (comme la carte des 18 muscles), palier en mots,
// les 3 exercices qui l'ont le plus travaillé, le repère et le lien vers « Séries par muscle » (le muscle de l'app, mis
// en avant). Bas du corps (carte simple) : le muscle entier.
function atlasLoadTipHtml(part) {
  const pl = partLoad(muscleSpan), simple = ATLAS_SIMPLE_MUSCLES.has(part.parent);
  const ids = simple ? BODY_PARTS.parts.filter(p => p.parent === part.parent).map(p => p.id) : [part.id];
  const title = simple ? muscleLabel(part.parent) : atlasPartTitle(part.id);
  const sets = simple ? pl.load.sets[part.parent] || 0 : pl.sets[part.id] || 0;
  const lvl = pl.levels[part.id] || 0, weekly = pl.weekly[part.id] || 0;
  const count = !roundSets(sets) ? `Aucune série ${muscleSpan === 'month' ? `en ${MUSCLE_SPANS.month.weeks} semaines` : 'depuis lundi'}`
    : muscleSpan === 'month' ? `${setsTxt(sets)} en ${MUSCLE_SPANS.month.weeks} semaines, soit ${weekly} par semaine en moyenne`
    : `${setsTxt(sets)} depuis lundi`;
  // Exercices : le plus de séries d'abord ; pour un muscle entier, le meilleur de ses sous-muscles
  const byEx = {};
  ids.forEach(id => Object.entries(pl.byEx[id] || {}).forEach(([ex, n]) => { byEx[ex] = Math.max(byEx[ex] || 0, n); }));
  const top = partTopExercises({ all: byEx }, 'all');
  return `<p class="btip__title" id="btipTitle">${esc(title)}</p>
    <p class="btip__sub">${count}</p>
    <p class="btip__level">${muscleLevelDot(lvl)}<span>${MUSCLE_LEVEL_WORDS[lvl]}</span></p>
    ${top.length ? `<p class="btip__sub btip__top">Le plus : ${top.map(([ex]) => esc(ex)).join(', ')}</p>` : ''}
    <p class="btip__sub btip__target">Repère : ${muscleTarget()}</p>
    ${part.parent ? `<button class="btip__link" data-action="go-stats-muscles" data-muscle="${part.parent}">Séries par muscle${icon('chevron.right', 14)}</button>` : ''}`;
}
