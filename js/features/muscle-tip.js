// ═══════════════════════════════════════════════════════════
//  Bulle d'un muscle touché sur le personnage (Progrès › Muscles, fiche exercice)
// ═══════════════════════════════════════════════════════════
'use strict';

// Détection et bulle : js/ui/body-tip.js. Ici, ce que dit la bulle selon la carte touchée :
//   Progrès › Muscles  nom, séries de la période affichée (mêmes chiffres que « Séries par muscle »)
//                      et lien vers cet écran, ligne du muscle mise en avant
//   fiche exercice     nom, principal ou secondaire pour cet exercice

// Bulle de la carte de Progrès
function muscleTipLoadHtml(id) {
  const load = muscleLoad(muscleSpan);
  return `<p class="btip__title" id="btipTitle">${esc(muscleLabel(id))}</p>
    <p class="btip__sub">${setsTxt(load.sets[id] || 0)} ${periodTxt(load.span)}</p>
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
