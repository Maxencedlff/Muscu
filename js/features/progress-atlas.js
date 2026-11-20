// ═══════════════════════════════════════════════════════════
//  Progrès › Muscles : personnage détaillé, travail de la période par sous-muscle
// ═══════════════════════════════════════════════════════════
'use strict';

// Même lecture que la carte des 18 muscles : plus le rouge est plein, plus le sous-muscle a travaillé ; même échelle de
// paliers (séries par semaine : MUSCLE_LEVEL_FROM, légende muscleLegendHtml) et mêmes périodes (muscleSpan). Un
// sous-muscle non travaillé reste gris : c'est lui qu'il faut regarder pour équilibrer. Volume : séances de la période ×
// correspondance exercice → sous-muscles (partLoad, js/data/atlas.js : principal 1 série, secondaire ½). Bas du corps :
// carte simple (le palier du muscle entier) jusqu'au détail des jambes. Zoom et nom au toucher : js/ui/body-zoom.js.

function progressAtlasHtml(span = muscleSpan) {
  const { levels } = partLoad(span);
  const on = Object.fromEntries(Object.entries(levels).filter(([, l]) => l > 0));
  return bodyAtlasHtml(on, { className: 'mcard__map', title: 'Muscles travaillés', tap: true, tiers: true, tip: 'load', crop: false, captions: true });
}

// Bulle d'un sous-muscle touché : nom de salle, séries de la période (comme la carte des 18 muscles), palier en mots,
// et les 3 exercices qui l'ont le plus travaillé. Bas du corps (carte simple) : le muscle entier.
function atlasLoadTipHtml(part) {
  const pl = partLoad(muscleSpan), simple = ATLAS_SIMPLE_MUSCLES.has(part.parent);
  const ids = simple ? BODY_PARTS.parts.filter(p => p.parent === part.parent).map(p => p.id) : [part.id];
  const title = simple ? muscleLabel(part.parent) : atlasPartTitle(part.id);
  const sets = simple ? pl.load.sets[part.parent] || 0 : pl.sets[part.id] || 0;
  const lvl = pl.levels[part.id] || 0, weekly = pl.weekly[part.id] || 0;
  const count = muscleSpan === 'month'
    ? `${setsTxt(sets)} en ${MUSCLE_SPANS.month.weeks} semaines, soit ${weekly} par semaine en moyenne`
    : `${setsTxt(sets)} depuis lundi`;
  // Exercices : le plus de séries d'abord ; pour un muscle entier, le meilleur de ses sous-muscles
  const byEx = {};
  ids.forEach(id => Object.entries(pl.byEx[id] || {}).forEach(([ex, n]) => { byEx[ex] = Math.max(byEx[ex] || 0, n); }));
  const top = partTopExercises({ all: byEx }, 'all');
  return `<p class="btip__title" id="btipTitle">${esc(title)}</p>
    <p class="btip__sub">${count}</p>
    <p class="btip__level">${muscleLevelDot(lvl)}<span>${MUSCLE_LEVEL_WORDS[lvl]}</span></p>
    ${top.length ? `<p class="btip__sub btip__top">Le plus : ${top.map(([ex, n]) => `${esc(ex)} (${setsTxt(n)})`).join(', ')}</p>` : ''}`;
}
