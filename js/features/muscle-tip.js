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
// Moyenne par semaine affichée : tronquée au dixième, pour ne jamais annoncer le palier suivant
function perWeekTxt(v) { return fmtNum(Math.floor(v * 10) / 10); }

function muscleTipLoadHtml(id) {
  const load = muscleLoad(muscleSpan), lvl = load.levels[id] || 0, n = roundSets(load.sets[id] || 0);
  const count = load.span === 'month'
    ? `${setsTxt(n)} en ${MUSCLE_SPANS.month.weeks} semaines, soit ${perWeekTxt(load.perWeek[id])} par semaine`
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

registerActions({
  'body-tap': (e, el) => bodyTipTap(e, el, (id, mapEl) =>
    mapEl.classList.contains('mcard__map') ? muscleTipLoadHtml(id) : muscleTipExerciseHtml(id, mapEl)),
});
