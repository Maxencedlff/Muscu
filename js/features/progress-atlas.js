// ═══════════════════════════════════════════════════════════
//  Progrès › Muscles : personnage détaillé, travail de la période par sous-muscle
// ═══════════════════════════════════════════════════════════
'use strict';

// Même lecture que la carte des 18 muscles : plus le rouge est soutenu, plus le sous-muscle a travaillé ; même échelle de
// paliers (séries par semaine : MUSCLE_LEVEL_FROM, légende muscleLegendHtml) et mêmes périodes (muscleSpan). Un
// sous-muscle non travaillé reste gris : c'est lui qu'il faut regarder pour équilibrer. Volume : séances de la période ×
// correspondance exercice → sous-muscles (partLoad, js/data/atlas.js : principal 1 série, secondaire ½). Bas du corps :
// carte simple (le palier du muscle entier) jusqu'au détail des jambes. Zoom et nom au toucher : js/ui/body-zoom.js.

// toWork : la liste « À travailler » ; ses muscles à 0 série sont cernés sur le dessin (sinon couleur du corps, invisibles)
function progressAtlasHtml(span = muscleSpan, toWork = []) {
  const { levels } = partLoad(span);
  const on = Object.fromEntries(Object.entries(levels).filter(([, l]) => l > 0));
  const outline = toWork.filter(it => !it.sets).flatMap(it => it.ids);
  return atlasBoxHtml(bodyAtlasHtml(on, { className: 'mcard__map', title: 'Muscles travaillés', tap: true, tiers: true, tip: 'load', crop: false, captions: true, outline }), 'mcard__box');
}

// Cellule « À travailler » : 3 noms au plus, puis « + N autres » qui déplie la liste entière (« Moins » la replie, panel
// t6). Chaque nom est une pastille à
// toucher (atlasToWorkShow), précédée de la couleur de son état : gris, aucune série sur la période ; rose pâle, sous
// l'objectif (panel affichage-e t5 : voir d'un coup d'œil lequel n'est pas du tout travaillé ; ils viennent en premier)
const ATLAS_TO_WORK_SHOWN = 3;
function atlasToWorkNameHtml(it) {
  const state = it.sets > 0 ? 1 : 0;
  return `<button class="mlow__name" data-action="atlas-to-work" data-muscle="${it.key}" aria-pressed="false" aria-label="${esc(it.label)}, ${MUSCLE_LEVEL_WORDS[state].toLowerCase()} : voir sur le personnage">${muscleLevelDot(state)}${esc(it.label)}</button>`;
}
function atlasToWorkHtml(items) {
  if (!items.length) return '<span class="cell__title cell__title--reg">Tous les muscles à l\'objectif</span>';
  // Texte très grand : 2 noms (panel t8)
  const shown = items.slice(0, document.documentElement.classList.contains('type-xl') ? 2 : ATLAS_TO_WORK_SHOWN), more = items.length - shown.length;
  return `<span class="cell__title cell__title--reg">À travailler</span>
    <span class="cell__sub mlow">${shown.map(atlasToWorkNameHtml).join('')}${more ? `<button class="mlow__more" data-action="atlas-to-work-all" aria-expanded="false" aria-label="Voir les ${more} autres muscles à travailler">+ ${more} autre${more > 1 ? 's' : ''}</button>` : ''}</span>
    <template class="mlow__all">${items.map(atlasToWorkNameHtml).join('')}<button class="mlow__more" data-action="atlas-to-work-all" aria-expanded="true">Moins</button></template>
    <template class="mlow__few">${shown.map(atlasToWorkNameHtml).join('')}${more ? `<button class="mlow__more" data-action="atlas-to-work-all" aria-expanded="false" aria-label="Voir les ${more} autres muscles à travailler">+ ${more} autre${more > 1 ? 's' : ''}</button>` : ''}</template>`;
}

// Texte très grand : « À travailler : … » sous le choix de période, le résumé sans défiler (la liste touchable reste plus
// bas, sous la légende) ; masqué pour VoiceOver, qui lit la liste
function atlasToWorkLineHtml(items) {
  if (!items.length) return '';
  // 2 noms au plus : ceux à 0 série s'il y en a (panel t9 : « + 10 » se lisait « +10 séries »)
  const zero = items.filter(it => !it.sets), named = (zero.length ? zero : items).slice(0, 2), more = items.length - named.length;
  return `<p class="mcard__todo" aria-hidden="true">À travailler : ${esc(named.map(it => it.label).join(', '))}${more > 0 ? ` et ${more} autre${more > 1 ? 's' : ''}` : ''}</p>`;
}

// Toucher un nom d'« À travailler » : sur le personnage de Progrès, seuls ses sous-muscles gris ou pâles restent mis en
// valeur, cernés (les autres calques s'effacent, comme les lignes de la fiche), la carte d'info sous le dessin donne leurs
// séries une à une, le nom reste surligné et « Tout afficher » rend le dessin entier (panels t5, t8). L'isolement dure jusqu'à
// « Tout afficher », un second toucher sur le même nom ou un autre nom ; la carte se ferme par sa croix
function atlasToWorkShow(btn) {
  const card = btn.closest('.mcard'), map = card?.querySelector('.mcard__map');
  const it = map && atlasToWork(partLoad(muscleSpan)).find(x => x.key === btn.dataset.muscle);
  if (!it) return;
  const again = map.dataset.iso === 'load' && map.dataset.isoMuscle === it.key;
  closeBodyTip();
  atlasToWorkReset(card);
  if (again) return;
  const kind = bodyKind(map.dataset.body), pl = partLoad(muscleSpan);
  // Une ligne par sous-muscle : son état (pastille), son nom (l'état en mots s'il porte le nom du muscle), ses séries
  // Bas du corps (carte simple, ATLAS_SIMPLE_MUSCLES) : une seule ligne, le muscle entier (audit m5)
  const one = ATLAS_SIMPLE_MUSCLES.has(it.key), row = (lv, name, weekly) => `<p class="btip__level">${muscleLevelDot(lv)}<span>${esc(name)} : ${weekly ? weeklyTxt(weekly) : 'aucune série'}</span></p>`;
  const rows = one ? row(pl.load.levels[it.key] || 0, MUSCLE_LEVEL_WORDS[pl.load.levels[it.key] || 0], pl.load.weekly[it.key])
    : it.ids.map(id => { const lv = pl.levels[id] || 0; return row(lv, atlasPartTitle(id) === it.label ? MUSCLE_LEVEL_WORDS[lv] : atlasPartTitle(id), pl.weekly[id]); }).join('');
  const html = `<p class="btip__title">${esc(it.label)}</p>${rows}
    <button class="btip__link" data-action="go-stats-muscles" data-muscle="${it.key}">Séries par muscle${icon('chevron.right', 14)}</button>`;
  // Marques : le contour des sous-muscles (gris compris : sans calque, ils se verraient mal), qui restent jusqu'à « Tout afficher »
  for (const fig of map.querySelectorAll('.body-map__fig')) {
    const view = fig.classList.contains('body-map__back') ? 'back' : 'front';
    fig.querySelector('.body-map__body').insertAdjacentHTML('beforeend', bodyOutlineHtml(kind, view, it.ids, 1, 'body-map__isomark'));
  }
  map.querySelectorAll('.body-map__p').forEach(l => l.classList.toggle('is-on', it.ids.includes(l.dataset.part)));
  map.dataset.iso = 'load'; map.dataset.isoMuscle = it.key;
  atlasIsoChip(map, it.label);
  const named = card.querySelector(`.mlow__name[data-muscle="${it.key}"]`) || btn;
  named.setAttribute('aria-pressed', 'true');
  named.insertAdjacentHTML('afterend', '<button class="mlow__reset" data-action="atlas-to-work-reset">Tout afficher</button>');
  atlasInfoShow(map, html, null, named);
  const r0 = map.getBoundingClientRect();
  if (r0.top < 0 || r0.bottom > innerHeight) map.scrollIntoView({ block: 'center', behavior: 'instant' });
}

// « Tout afficher » : le dessin entier, plus de nom surligné
function atlasToWorkReset(card) {
  const map = card?.querySelector('.mcard__map');
  if (!map) return;
  map.querySelectorAll('.body-map__isomark').forEach(m => m.remove());
  map.querySelectorAll('.body-map__p.is-on').forEach(l => l.classList.remove('is-on'));
  delete map.dataset.iso; delete map.dataset.isoMuscle;
  card.querySelectorAll('.mlow__name[aria-pressed="true"]').forEach(b => b.setAttribute('aria-pressed', 'false'));
  card.querySelectorAll('.mlow__reset').forEach(b => b.remove());
  atlasIsoChip(map, null);
}

// Texte très grand : le muscle isolé et « Tout afficher » sur la carte du dessin, juste sous le personnage (panel t6 : la
// liste, plus bas, n'est plus à l'écran quand on regarde le personnage) ; label null : retiré
function atlasIsoChip(map, label) {
  const box = map?.closest('.atlas-box');
  box?.parentElement?.querySelector(':scope > .atlas-box__iso')?.remove();
  if (!box || label == null) return;
  box.insertAdjacentHTML('afterend', `<div class="atlas-box__iso"><span class="atlas-box__iso-name">Seulement : ${esc(label)}</span><button class="atlas-box__iso-all" data-action="atlas-iso-all">Tout afficher</button></div>`);
}

// Dessin et son bouton Agrandir, dans un coin du dessin (panel affichage-e t3 : un grand vide le séparait du
// personnage) : en haut à droite, où ne passent ni la tête ni les bras ; carte cadrée sur les jambes : en bas à droite
// (les mains sont en haut). Le bouton dit qu'on peut zoomer (panel t1) ; fiche et Progrès
function atlasBoxHtml(mapHtml, className, corner = 'top') {
  return `<div class="atlas-box atlas-box--${corner} ${className}">${mapHtml}<button class="mpanel__zoom" data-action="atlas-open" aria-label="Agrandir le personnage">${icon('arrow.up.left.and.arrow.down.right', 22)}</button></div>`;
}

// Légende des 3 états (carte de Progrès, Séries par muscle, vue agrandie) : mêmes mots partout ; ranges : avec les bornes
// en séries par semaine
function muscleLegendItemsHtml(ranges = true) {
  return MUSCLE_LEVEL_WORDS.map((w, lvl) => `<span class="mlegend__item">${muscleLevelDot(lvl)}${w}${ranges && lvl ? ` <span class="mlegend__n num">${muscleLevelRange(lvl)}</span>` : ''}</span>`).join('');
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
