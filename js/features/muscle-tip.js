// ═══════════════════════════════════════════════════════════
//  Bulle d'un muscle touché sur le personnage (Progrès › Muscles, fiche exercice)
// ═══════════════════════════════════════════════════════════
'use strict';

// Détection et bulle : js/ui/body-tip.js. Ici, ce que dit la bulle selon la carte touchée :
//   Progrès › Muscles  nom, séries de la période affichée (mêmes chiffres que « Séries par muscle »),
//                      en « 4 semaines » la moyenne par semaine (celle que suit la couleur), palier en
//                      mots (ceux de la légende), repère selon le niveau, et lien vers « Séries par muscle »
//   fiche exercice     nom, principal ou secondaire pour cet exercice

// Bulle de la carte de Progrès
function muscleTipLoadHtml(id) {
  const load = muscleLoad(muscleSpan), lvl = load.levels[id] || 0, n = roundSets(load.sets[id] || 0);
  const count = load.span === 'month'
    ? `${setsTxt(n)} en ${MUSCLE_SPANS.month.weeks} semaines, soit ${load.weekly[id]} par semaine en moyenne`
    : `${setsTxt(n)} depuis lundi`;
  return `<p class="btip__title" id="btipTitle">${esc(muscleLabel(id))}</p>
    <p class="btip__sub">${count}</p>
    <p class="btip__level">${muscleLevelDot(lvl)}<span>${MUSCLE_LEVEL_WORDS[lvl]}</span></p>
    <p class="btip__sub">Repère : ${muscleTarget()}</p>
    <button class="btip__link" data-action="go-stats-muscles" data-muscle="${id}">Séries par muscle${icon('chevron.right', 14)}</button>`;
}

// Bulle de la fiche exercice : rôle lu dans la carte elle-même (calque coloré, teinte des secondaires)
function muscleTipExerciseHtml(id, mapEl) {
  const layer = mapEl.querySelector(`.body-map__m[data-muscle="${id}"]`);
  const role = !layer ? 'Non ciblé par cet exercice' : layer.classList.contains('body-map__m--sec') ? 'Muscle secondaire' : 'Muscle principal';
  return `<p class="btip__title" id="btipTitle">${esc(muscleLabel(id))}</p><p class="btip__sub">${role}</p>`;
}

// Fiche exercice de la bibliothèque : atlas détaillé (sous-muscles, js/data/atlas.js), nom au toucher, vue agrandie
// (js/ui/body-zoom.js) et bouton Agrandir ; ailleurs (Programme, Progrès) la carte des 18 muscles, inchangée.
// Pastilles : ce que montre le dessin (atlasPills) : rouge plein d'abord, puis atténué, mêmes noms que la bulle.
// Sans aucun sous-muscle visible (cas qui ne doit pas arriver : tests/unit/atlas.mjs), la carte des 18 muscles.
const ATLAS_TAP_HINT = 'Touche un muscle pour son nom.';
function exAtlasPanelHtml(m, name) {
  const levels = exercisePartLevels(name, m).levels, kind = bodyKind(bodySilhouette());
  const shown = Object.keys(levels).some(id => levels[id] > 0 && ['front', 'back'].some(v => BODY_PARTS.boxes[kind]?.[v]?.[id]));
  if (!shown) {
    return `<div class="cell mpanel">${bodyMapHtml(exerciseIntensity(m), { className: 'mpanel__map', secondary: m.secondary, tap: true })}
      <div class="cell__body">${musclePillsHtml(m)}</div></div>`;
  }
  const pill = ({ label, level }) => `<li class="mpill ${level >= 2 ? 'mpill--main' : 'mpill--sec'}">${esc(label)}<span class="visually-hidden">, ${level >= 2 ? 'principal' : 'secondaire'}</span></li>`;
  return `
    <div class="cell mpanel mpanel--atlas">
      ${bodyAtlasHtml(levels, { className: 'mpanel__map', title: name, tap: true })}
      <button class="mpanel__zoom" data-action="atlas-open" aria-label="Agrandir le personnage">${icon('arrow.up.left.and.arrow.down.right', 22)}</button>
      <div class="cell__body"><ul class="mpills" aria-label="Muscles ciblés">${atlasPills(levels).map(pill).join('')}</ul></div>
    </div>`;
}

// Places préférées (js/ui/body-tip.js, bodyTipSpots) : Progrès, la marge extérieure de la vue touchée
// puis sous le corps (sur la légende) ; fiche exercice, sous le personnage (au-dessus des pastilles)
// puis la marge extérieure. Dans tous les cas, jamais sur un muscle coloré s'il reste une autre place.
registerActions({
  'body-tap': (e, el) => {
    // Atlas détaillé de la fiche exercice : sous-muscle (nom de salle, latin, rôle), zoom au double toucher
    if (el.classList.contains('body-map--atlas')) return atlasTap(e, el);
    const progress = el.classList.contains('mcard__map');
    return bodyTipTap(e, el, (id, mapEl) => (progress ? muscleTipLoadHtml(id) : muscleTipExerciseHtml(id, mapEl)),
      progress ? ['outer', 'under'] : ['under', 'outer']);
  },
  // Bouton « Agrandir » de la fiche exercice : vue agrandie de l'atlas, sans zoom (VoiceOver, gestes inconnus)
  'atlas-open': (e, el) => {
    const map = el.closest('.mpanel')?.querySelector('.body-map--atlas');
    if (map) openAtlasViewer(map, null);
  },
});
