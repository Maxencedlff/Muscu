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
  const role = !layer ? 'Non ciblé par cet exercice' : layer.classList.contains('body-map__m--sec') ? 'Muscle qui aide' : 'Muscle ciblé';
  return `<p class="btip__title" id="btipTitle">${esc(muscleLabel(id))}</p><p class="btip__sub">${role}</p>`;
}

// Fiche exercice de la bibliothèque : atlas détaillé (sous-muscles, js/data/atlas.js), nom au toucher, vue agrandie
// (js/ui/body-zoom.js) ; ailleurs (Programme, Progrès › Exercice) la carte des 18 muscles, inchangée.
// Variante E (vote de 16 juges, 20/11) : sous le personnage, deux lignes de liste, « Muscles ciblés » (rouge plein) et
// « Muscles qui aident » (rose), du plus au moins sollicité, « + N autres » au-delà de 4 noms. Toucher une ligne ne
// laisse sur le personnage que ses muscles, en rouge plein ; toucher un nom, ce seul muscle ; toucher de nouveau, tout
// revient. VoiceOver : une ligne = un élément, avec le nombre et l'action ; le changement est annoncé.
// Sans aucun sous-muscle visible (cas qui ne doit pas arriver : tests/unit/atlas.mjs), la carte des 18 muscles.
const ATLAS_TAP_HINT = 'Touche un muscle pour le voir seul.';
// Pied du groupe Muscles de la fiche : les couleurs se lisent déjà dans les lignes, seule l'aide reste
function atlasFoot(foot) { return foot === VERIFIED_MUSCLES_FOOT ? 'Muscles vérifiés de la bibliothèque.' : foot; }

function atlasLineHtml(items, level) {
  if (!items.length) return '';
  const n = items.length, title = level >= 2 ? (n > 1 ? 'Muscles ciblés' : 'Muscle ciblé') : (n > 1 ? 'Muscles qui aident' : 'Muscle qui aide');
  // Texte très grand : un nom, puis « + N autres » (panel affichage-e t5 : sur iPhone SE en AX33, les deux lignes doivent
  // tenir sous le personnage sans défiler) ; la liste entière reste au toucher de « + N autres » et pour VoiceOver
  const { shown, more } = atlasLineItems(items, document.documentElement.classList.contains('type-xl') ? 2 : ATLAS_LINE_MAX);
  const name = x => `<span class="mline2__name" data-ids="${esc(x.ids.join(' '))}" data-label="${esc(x.label)}">${esc(x.label)}</span>`;
  const label = `${title}, ${n} : ${items.map(x => x.label).join(', ')}. Touche pour ne voir ${n > 1 ? 'qu\'eux' : 'que lui'}`;
  return `<button class="cell mline2" data-action="atlas-isolate" data-level="${level}" data-ids="${esc(items.flatMap(x => x.ids).join(' '))}" data-title="${esc(title)}" aria-pressed="false" aria-label="${esc(label)}">
      <span class="mline2__dot mline2__dot--${level >= 2 ? 'main' : 'help'}" aria-hidden="true"></span>
      <span class="cell__body"><span class="cell__sub">${title}</span><span class="cell__title mline2__names">${shown.map(name).join(', ')}${more ? ` <span class="mline2__more" data-more="1">+ ${more} autre${more > 1 ? 's' : ''}</span>` : ''}</span></span>
      <template class="mline2__all">${items.map(name).join(', ')}</template>
    </button>`;
}

function exAtlasPanelHtml(m, name) {
  const levels = exercisePartLevels(name, m).levels, kind = bodyKind(bodySilhouette());
  const shown = Object.keys(levels).some(id => levels[id] > 0 && ['front', 'back'].some(v => BODY_PARTS.boxes[kind]?.[v]?.[id]));
  if (!shown) {
    return `<div class="cell mpanel">${bodyMapHtml(exerciseIntensity(m), { className: 'mpanel__map', secondary: m.secondary, tap: true })}
      <div class="cell__body">${musclePillsHtml(m)}</div></div>`;
  }
  const items = atlasRanked(name, m, levels);
  // Texte très grand : le corps entier, au moins 300 points de haut (panel affichage-e t7 : cadré sur le haut du corps, le
  // personnage rétrécissait à mesure que le texte grossissait)
  // Texte très grand : la ligne « Muscle ciblé » AU-DESSUS du dessin, juste sous le titre « Muscles » (panel t10 : sous le
  // personnage, « Moyen fessier » passait sous la barre d'onglets sur iPhone SE) ; « Muscles qui aident » reste dessous
  const xl = document.documentElement.classList.contains('type-xl');
  const main = atlasLineHtml(items.filter(x => x.level >= 2), 2), help = atlasLineHtml(items.filter(x => x.level < 2), 1);
  return `${xl ? main : ''}
    <div class="cell mpanel mpanel--atlas">
      ${atlasBoxHtml(bodyAtlasHtml(levels, { className: 'mpanel__map', title: name, tap: true, crop: !xl, one: true }), 'mpanel__box', !xl && bodyAtlasCrop(kind, levels)[0] > 0 ? 'bottom' : 'top')}
    </div>
    ${xl ? '' : main}${help}`;
}

// Isole des sous-muscles sur la carte de la fiche (ids, en rouge plein), ou rend tout (ids vide)
function atlasIsolate(group, ids, pressed) {
  const map = group?.querySelector('.mpanel--atlas .body-map--atlas');
  if (!map) return;
  const on = new Set(ids);
  if (on.size) map.dataset.iso = '1'; else delete map.dataset.iso;
  map.querySelectorAll('.body-map__p').forEach(l => l.classList.toggle('is-on', on.has(l.dataset.part)));
  group.querySelectorAll('.mline2').forEach(b => b.setAttribute('aria-pressed', String(b === pressed?.line && !pressed.name)));
  group.querySelectorAll('.mline2__name').forEach(n => n.classList.toggle('mline2__name--on', n === pressed?.name));
  atlasIsoChip(map, on.size ? pressed?.name?.dataset.label || pressed?.line?.dataset.title || '' : null);
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
  // Lignes « Muscles ciblés » / « Muscles qui aident » : la ligne, un nom, ou « + N autres » (liste entière)
  'atlas-isolate': (e, line) => {
    const group = line.closest('.group');
    if (e.target.closest?.('.mline2__more')) {
      line.querySelector('.mline2__names').innerHTML = line.querySelector('.mline2__all').innerHTML;
      return;
    }
    const nameEl = e.target.closest?.('.mline2__name');
    const was = nameEl ? nameEl.classList.contains('mline2__name--on') : line.getAttribute('aria-pressed') === 'true';
    closeBodyTip();
    if (was) {
      atlasIsolate(group, [], null);
      atlasSay('Personnage : tous les muscles sont affichés');
      return;
    }
    const ids = (nameEl || line).dataset.ids.split(' ').filter(Boolean);
    atlasIsolate(group, ids, { line, name: nameEl });
    // iPhone SE : le personnage peut être sorti de l'écran quand on touche la liste ; on y revient doucement
    const map = group?.querySelector('.mpanel--atlas .body-map--atlas'), r = map?.getBoundingClientRect();
    if (r && (r.top < 60 || r.bottom > innerHeight - 90)) map.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    atlasSay(nameEl ? `Personnage : seul ${nameEl.dataset.label} est affiché` : `Personnage : seuls les ${line.dataset.title.toLowerCase()} sont affichés`);
    haptic();
  },
  // Bouton « Agrandir » de la fiche exercice : vue agrandie de l'atlas, sans zoom (VoiceOver, gestes inconnus)
  'atlas-open': (e, el) => {
    const map = el.closest('.mpanel, .mcard, .atlas-box')?.querySelector('.body-map--atlas');
    if (map) openAtlasViewer(map, null);
  },
  // Progrès, « À travailler » : un nom isole ses sous-muscles gris ou pâles sur le personnage (atlasToWorkShow)
  'atlas-to-work': (e, btn) => atlasToWorkShow(btn),
  // Croix de la carte d'info du muscle touché (js/ui/body-zoom.js)
  'atlas-info-close': () => atlasInfoClose(),
  // « Tout afficher » posé sur le dessin (texte très grand) : Progrès comme « Tout afficher » de la liste, fiche comme un second toucher
  'atlas-iso-all': (e, btn) => {
    const card = btn.closest('.mcard');
    closeBodyTip();
    if (card) atlasToWorkReset(card); else atlasIsolate(btn.closest('.group'), [], null);
    atlasSay('Personnage : tous les muscles sont affichés');
  },
  'atlas-to-work-reset': (e, btn) => { const card = btn.closest('.mcard'); closeBodyTip(); atlasToWorkReset(card); card?.querySelector('.mlow__name')?.focus(); },
  // Progrès, « À travailler » : « + N autres » déplie la liste entière, « Moins » la replie, sur place
  'atlas-to-work-all': (e, btn) => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    const cell = btn.closest('.mlow'), all = cell?.parentElement.querySelector(open ? '.mlow__all' : '.mlow__few');
    if (!all) return;
    const iso = btn.closest('.mcard')?.querySelector('.mcard__map')?.dataset.isoMuscle;
    cell.innerHTML = all.innerHTML;
    cell.querySelector('.mlow__more')?.focus();
    const named = iso && cell.querySelector(`.mlow__name[data-muscle="${iso}"]`);
    if (named) { named.setAttribute('aria-pressed', 'true'); named.insertAdjacentHTML('afterend', '<button class="mlow__reset" data-action="atlas-to-work-reset">Tout afficher</button>'); }
    atlasSay(`${cell.querySelectorAll('.mlow__name').length} muscles à travailler`);
  },
});
