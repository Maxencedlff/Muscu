// ═══════════════════════════════════════════════════════════
//  Muscles : pastilles des exercices, choix des muscles, carte et écran de Progrès
// ═══════════════════════════════════════════════════════════
'use strict';

let muscleSpan = 'month';  // période de Progrès (MUSCLE_SPANS) : « Cette semaine » serait grise chaque lundi
let muscleFocus = null;    // muscle mis en avant dans « Séries par muscle » (ouvert depuis la bulle)

// Intensités d'un exercice pour la silhouette de la fiche : exerciseIntensity (js/features/progress-muscles.js,
// partagée avec les cartes de l'historique)

// ── Pastilles ───────────────────────────────────────────────

// « Pectoraux » (principal, teinté) puis « Triceps » (secondaire, gris)
function musclePillsHtml(m) {
  const pill = (id, main) => `<li class="mpill ${main ? 'mpill--main' : 'mpill--sec'}">${muscleLabel(id)}</li>`;
  return `<ul class="mpills" aria-label="Muscles ciblés">${m.primary.map(id => pill(id, true)).join('')}${m.secondary.map(id => pill(id, false)).join('')}</ul>`;
}

// Ligne discrète sous le nom d'un exercice dans une liste : « Pectoraux · Triceps »
function exMusclesSubHtml(ex, cls = 'cell__sub') {
  const line = musclesLine(exerciseMuscles(ex));
  return line ? `<span class="${cls} ex-muscles">${line}</span>` : '';
}

// Silhouette et pastilles d'un exercice (Programme › Exercice, Progrès › Exercice)
// Muscle profond seul (vacuum) : le personnage sans aucun rouge, le muscle nommé en gris, et pourquoi rien n'est coloré
const DEEP_MUSCLE_NOTE = 'Muscle profond, invisible en surface. Rien n\'est coloré sur le personnage.';
function deepMusclesNames(m) { return (m.deep || []).map(id => deepMuscleLabel(id, true)).filter(Boolean).join(', '); }
function exMusclesPanelHtml(m, { atlas = '' } = {}) {   // atlas : nom de l'exercice, fiche (exAtlasPanelHtml)
  if (!m.primary.length && m.deep?.length) {
    return `
    <div class="cell mpanel mpanel--deep">
      ${bodyMapHtml({}, { className: 'mpanel__map' })}
      <div class="cell__body"><ul class="mpills" aria-label="Muscles ciblés">${m.deep.map(id => `<li class="mpill mpill--sec">${esc(deepMuscleLabel(id, true))}</li>`).join('')}</ul>
        <span class="cell__sub">${DEEP_MUSCLE_NOTE}</span></div>
    </div>`;
  }
  if (!m.primary.length) {
    return `<div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">Muscles non reconnus</span>
      <span class="cell__sub">Choisis les muscles travaillés pour les voir dans Progrès.</span></span></div>`;
  }
  return atlas ? exAtlasPanelHtml(m, atlas) : `
    <div class="cell mpanel">
      ${bodyMapHtml(exerciseIntensity(m), { className: 'mpanel__map', secondary: m.secondary, tap: true })}
      <div class="cell__body">${musclePillsHtml(m)}</div>
    </div>`;
}

// ── Muscles vérifiés de la bibliothèque : modifier, rétablir ─

// Exercice de la bibliothèque : muscles vérifiés par défaut, modifiables après confirmation, rétablis d'un toucher
const VERIFIED_MUSCLES_FOOT = 'Muscles vérifiés de la bibliothèque. Principaux en rouge plein, secondaires en rouge atténué.';
const MODIFIED_MUSCLES_FOOT = 'Muscles modifiés par toi. Ils remplacent ceux de la bibliothèque dans Progrès et la récupération.';
const RESET_MUSCLES_LABEL = 'Rétablir les muscles par défaut';

// Demandée une fois, quand le choix s'écarte des muscles vérifiés (déjà modifiés : pas de nouvelle question)
function confirmModifyVerified() {
  return dialog({ title: 'Modifier les muscles vérifiés ?',
    message: 'Les muscles de la bibliothèque ont été vérifiés pour cet exercice. Tu pourras rétablir ceux par défaut à tout moment.',
    actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Modifier', value: true, style: 'preferred' }] }).then(v => v === true);
}

// Rangées « Modifier / Choisir les muscles » et « Rétablir » sous la silhouette, pied d'état.
// pick, reset : attributs des deux boutons (action et données)
function musclesControlsHtml(m, name, { pick, reset }) {
  const verified = musclesVerified(name), modified = verified && m.source === 'user';
  const value = verified ? (modified ? 'Modifiés' : 'Vérifiés') : m.source === 'user' ? 'Personnalisés' : 'Automatique';
  return {
    rows: `
      <button class="cell cell--nav" ${pick}>
        <span class="cell__body"><span class="cell__title">${verified ? 'Modifier les muscles' : 'Choisir les muscles'}</span></span>
        <span class="cell__trail"><span class="cell__value">${value}</span>${icon('chevron.right', 16)}</span>
      </button>
      ${modified ? `<button class="cell cell--action" ${reset}><span class="cell__title">${RESET_MUSCLES_LABEL}</span></button>` : ''}`,
    foot: verified ? (modified ? MODIFIED_MUSCLES_FOOT : VERIFIED_MUSCLES_FOOT) : '',
  };
}

// Muscles d'un exercice hors programme (Progrès, fiche) : { name, exId? } ; textOnly : « Muscles : Fessiers » sans secondaire ; atlas : fiche
function exMusclesGroupHtml(ex, title = 'Muscles ciblés', { textOnly = false, atlas = false } = {}) {
  const m = exerciseMuscles(ex);
  const c = musclesControlsHtml(m, ex.name, { pick: `data-action="declare-muscles" data-name="${esc(ex.name)}"`,
    reset: `data-action="reset-muscles" data-name="${esc(ex.name)}" data-ex="${esc(ex.exId || '')}"` });
  const deepLine = textOnly && !m.primary.length && m.deep?.length && `<div class="cell mline"><span class="cell__body"><span class="cell__title cell__title--reg">${esc(deepMusclesNames(m))}</span><span class="cell__sub">${DEEP_MUSCLE_NOTE}</span></span></div>`;
  const line = deepLine || textOnly && !atlas && m.primary.length && !m.secondary.length && `<div class="cell mline"><span class="cell__body"><span class="cell__title cell__title--reg">${esc([...new Set(m.primary.map(muscleLabel))].join(', '))}</span></span></div>`;
  return `<div class="group-title">${title}</div>
    <div class="group">${line || exMusclesPanelHtml(m, { atlas: atlas ? ex.name : '' })}${c.rows}</div>
    ${c.foot || atlas ? `<div class="group-foot">${[atlas && !line && m.primary.length ? atlasFoot(c.foot) : c.foot, atlas && !line && m.primary.length ? ATLAS_TAP_HINT : ''].filter(Boolean).join(' ')}</div>` : ''}`;
}

// ── Programme › Exercice : muscles reconnus ou choisis ──────

// Le brouillon garde le choix de l'utilisateur (null : reconnaissance par le nom). musclesReset : choix
// effacé dans le brouillon (Rétablir, Automatique), appliqué à l'enregistrement
function draftMuscles(ex) { return chosenMuscles(ex); }
function draftSecondary(ex) { return chosenMuscles(ex) ? chosenSecondary(ex) : []; }
function draftExMuscles(d) {
  return d.musclesReset ? musclesOf(d.name) : exerciseMuscles({ name: d.name, muscles: d.muscles, musclesSecondary: d.musclesSecondary });
}
function applyDraftMuscles(ex, draft) {
  if (draft.musclesReset) resetChosenMuscles(ex);
  const list = chosenMuscles(draft);
  if (list) ex.muscles = list; else delete ex.muscles;
  const sec = list ? chosenSecondary(draft, list) : [];
  if (sec.length) ex.musclesSecondary = sec; else delete ex.musclesSecondary;
}

function exEditMusclesHtml(d) {
  const m = draftExMuscles(d);
  const c = musclesControlsHtml(m, d.name, { pick: 'data-action="pick-ex-muscles"', reset: 'data-action="reset-ex-muscles"' });
  const foot = c.foot || (m.source === 'user' ? 'Muscles choisis par toi.'
    : m.source === 'none' && d.name.trim() ? 'Nom non reconnu. Choisis les muscles travaillés.'
    : 'Reconnus d\'après le nom de l\'exercice.');
  return `
    <div class="group-title">Muscles ciblés</div>
    <div class="group">
      ${exMusclesPanelHtml(m)}${c.rows}
    </div>
    <div class="group-foot">${foot}</div>`;
}
function renderExEditMuscles(d) { return `<div id="exMuscles">${exEditMusclesHtml(d)}</div>`; }
// Appelée par programme-editor.js à chaque frappe dans le nom, après la mise à jour du brouillon
function refreshExEditMuscles() {
  const box = $('#exMuscles');
  if (box && exDraft) box.innerHTML = exEditMusclesHtml(exDraft);
}

// Feuille de choix : case à trois états (WAI-ARIA, aria-checked true / mixed / false). Un toucher :
// principal (coche) ; deux : secondaire (compte pour une demi-série) ; trois : retiré. Les muscles devinés
// arrivent déjà cochés ; « Ressemble à » reprend en un toucher ceux d'un exercice proche de la bibliothèque.
// Renvoie { list, secondary }, { auto: true } (« Automatique ») ou null (annulé)
const MPICK_STATE = { primary: 'true', secondary: 'mixed', none: 'false' };
function mpickRowsHtml(primary, secondary) {
  return MUSCLES.map(({ id, label }) => {
    const st = primary.includes(id) ? 'primary' : secondary.includes(id) ? 'secondary' : 'none';
    return `
    <button class="mpick__row" role="checkbox" aria-checked="${MPICK_STATE[st]}" data-action="toggle-muscle" data-muscle="${id}">
      <span>${label}</span><span class="mpick__state">Secondaire</span>${icon('checkmark', 18)}
    </button>`;
  }).join('');
}
// autoLabel : libellé du bouton de retour (Automatique pour un exercice de la personne, Rétablir pour la bibliothèque)
async function pickMusclesSheet({ title = 'Muscles ciblés', current = [], currentSecondary = [], intro = '', cancel, auto = true, autoLabel = 'Revenir à la reconnaissance automatique', like = [] } = {}) {
  const likeHtml = like.length ? `
    <div class="mpick__like" role="group" aria-label="Ressemble à">
      <span class="mpick__like-title">Ressemble à</span>
      ${like.map(e => `<button class="ax__chip" data-action="muscles-like" data-name="${esc(e.name)}">${esc(e.name)}</button>`).join('')}
    </div>` : '';
  return sheet({ title, ...(cancel ? { cancel } : {}), body: `
    ${intro ? `<p class="mpick__intro">${intro}</p>` : ''}
    ${likeHtml}
    <div class="mpick" role="group" aria-label="${esc(title)}">${mpickRowsHtml(current, currentSecondary)}</div>
    ${auto ? `<button class="mpick__auto" data-action="muscles-auto">${autoLabel}</button>` : ''}
    <p class="mpick__foot">Un toucher : muscle principal. Deux : secondaire, compté pour une demi-série. Trois : retiré.</p>`,
    onConfirm: panel => {
      if (panel.dataset.auto === '1') return { auto: true };
      const pick = v => [...panel.querySelectorAll(`.mpick__row[aria-checked="${v}"]`)].map(b => b.dataset.muscle);
      return { list: pick('true'), secondary: pick('mixed') };
    } });
}

// Bibliothèque : sans choix enregistré, pas de bouton de retour ; un choix égal aux muscles vérifiés (ou vide)
// revient à ceux par défaut
async function pickExMuscles() {
  if (!exDraft) return;
  const m = draftExMuscles(exDraft), verified = musclesVerified(exDraft.name);
  const res = await pickMusclesSheet({ current: m.primary, currentSecondary: m.secondary, like: musclesKnown(m) ? [] : similarExercises(exDraft.name),
    auto: !verified || m.source === 'user', ...(verified ? { autoLabel: RESET_MUSCLES_LABEL } : {}) });
  if (!res || !exDraft) return;
  const none = res.auto || !res.list.length || isVerifiedChoice(exDraft.name, res.list, res.secondary);
  if (!none && verified && m.source !== 'user' && !(await confirmModifyVerified())) return;
  if (!exDraft) return;
  exDraft.muscles = none ? null : res.list;
  exDraft.musclesSecondary = none ? null : res.secondary;
  exDraft.musclesReset = none;
  refreshExEditMuscles();
}

// Muscles d'un exercice quelconque (séance, séance libre, historique), gardés par nom pour toute l'app.
// ask : proposé juste après l'ajout d'un exercice inconnu (« Plus tard » pour passer).
// check : muscles devinés d'après le nom d'un exercice inventé, cochés d'avance ; OK les enregistre comme
// choisis, « Plus tard » garde la devinette. Renvoie true si changé.
// Exercice de la bibliothèque : confirmation avant de s'écarter des muscles vérifiés (confirmModifyVerified).
async function declareMusclesFor(name, { ask = false, check = false } = {}) {
  const m = exerciseMuscles({ name }), verified = musclesVerified(name);
  const like = musclesKnown(m) && !check ? [] : similarExercises(name);
  // Guillemets à espaces insécables : « » jamais seuls en début de ligne
  const quoted = `«\u00a0${esc(name)}\u00a0»`;
  const intro = check ? `Devinés d'après le nom ${quoted}. Corrige-les si besoin, ils comptent dans Progrès et la récupération.`
    : ask ? `L'app ne reconnaît pas ${quoted}. Choisis ses muscles pour Progrès et la récupération.` : esc(name);
  const res = await pickMusclesSheet({
    title: check ? 'Vérifier les muscles' : ask ? 'Quels muscles ?' : 'Muscles ciblés', intro,
    current: m.primary, currentSecondary: m.secondary, like, cancel: ask || check ? 'Plus tard' : undefined, auto: !ask && !check && m.source === 'user',
    ...(verified ? { autoLabel: RESET_MUSCLES_LABEL } : {}) });
  if (!res) return false;
  const changesVerified = verified && m.source !== 'user' && !res.auto && res.list.length && !isVerifiedChoice(name, res.list, res.secondary);
  if (changesVerified && !(await confirmModifyVerified())) return false;
  setDeclaredMuscles(name, res.auto ? null : { primary: res.list, secondary: res.secondary });
  save();
  return true;
}

// Après l'ajout d'un exercice : si ses muscles sont inconnus, on les demande (une fois la feuille fermée)
function askMusclesIfUnknown(name, after = () => render()) {
  if (musclesKnown(exerciseMuscles({ name }))) return;
  setTimeout(async () => { if (await declareMusclesFor(name, { ask: true })) after(); }, 350);
}
// Après la création d'un exercice aux muscles devinés : vérification proposée (une fois la feuille fermée)
function askMusclesToCheck(name, after = () => render()) {
  setTimeout(async () => { if (await declareMusclesFor(name, { check: true })) after(); }, 350);
}

// ── Progrès : carte « Muscles » ─────────────────────────────


function spanSegmentedHtml() {
  return `<div class="segmented seg-full" role="group" aria-label="Période">
    ${Object.entries(MUSCLE_SPANS).map(([k, s]) => `<button class="segmented__btn ${muscleSpan === k ? 'segmented__btn--active' : ''}" aria-pressed="${muscleSpan === k}" data-action="muscle-span" data-span="${k}">${s.label}</button>`).join('')}
  </div>`;
}

// Pastille de couleur d'un palier (légende, bulle) : la couleur du palier sur la carte (bodyTier, js/ui/body-map.js)
function muscleLevelDot(lvl) {
  const tier = bodyTier(lvl / MUSCLE_LEVEL_MAX);
  return `<i class="mlegend__dot mlegend__dot--${tier ? tier.tone : 't0'}"></i>`;
}
function levelWord(lvl) { return MUSCLE_LEVEL_WORDS[lvl].toLowerCase(); }

// Légende : l'unité en tête (panel t5), chaque palier en mots avec ses bornes ; en « 4 semaines », la moyenne par semaine.
// load : avec la charge de la période, une ligne dit où en sont TES muscles (muscleLegendYou)
function muscleLegendHtml(span = muscleSpan, load = null, { unit = true } = {}) {
  const you = load ? muscleLegendYou(load) : '';
  return `<div class="mlegend" aria-hidden="true">
    ${unit ? `<span class="mlegend__unit">${span === 'month' ? 'Séries en moyenne par semaine' : 'Séries par semaine'}</span>` : ''}
    ${muscleLegendItemsHtml()}
    ${you ? `<span class="mlegend__you num">${esc(you)}</span>` : ''}
  </div>`;
}

// Tes muscles à l'objectif (« Toi : 4 muscles à l'objectif ») ; '' sans séance ni muscle à l'objectif
function muscleLegendYou(load) {
  if (!load.sessions) return '';
  const n = lvl => MUSCLES.filter(m => load.levels[m.id] === lvl).length;
  const top = n(MUSCLE_LEVEL_MAX);
  return top ? `Toi : ${plural(top, 'muscle', 'muscles')} à l'objectif` : '';
}

function setsTxt(n) { return plural(roundSets(n), 'série', 'séries'); }
// « 12 séries par semaine » : l'unité de toute la partie Muscles de Progrès (carte des groupes, Séries par muscle,
// détail d'un groupe, liste VoiceOver), en moyenne sur 4 semaines ou cette semaine
function weeklyTxt(n, span = muscleSpan) { return `${plural(n, 'série', 'séries')} par semaine${span === 'month' ? ' en moyenne' : ''}`; }

// Liste lue par VoiceOver à la place du dessin (Apple HIG, « Accessibility » : l'information portée
// par la couleur existe aussi en texte)
function muscleSrListHtml(load) {
  const you = muscleLegendYou(load);   // la légende visible est aria-hidden : VoiceOver lit la synthèse ici
  return `${you ? `<p class="visually-hidden">${esc(you)}</p>` : ''}<ul class="visually-hidden">${MUSCLES.map(({ id, label }) =>
    `<li>${label} : ${weeklyTxt(load.weekly[id], load.span)}, ${levelWord(load.levels[id])}</li>`).join('')}</ul>`;
}

function periodTxt(span = muscleSpan) { return span === 'month' ? 'ces 4 dernières semaines' : 'cette semaine'; }

function renderMuscleCard() {
  const load = muscleLoad(muscleSpan);
  const toWork = load.sessions ? atlasToWork(partLoad(muscleSpan)) : [];
  const lowCell = !load.sessions
    ? `<div class="cell"><span class="cell__body"><span class="cell__sub">Aucune séance ${periodTxt()}.</span></span></div>`
    : `<div class="cell"><span class="cell__body">
        ${atlasToWorkHtml(toWork)}
      </span></div>`;
  return `
    <div class="group-title">Muscles</div>
    <div class="group mcard">
      <div class="mcard__top">
        ${spanSegmentedHtml()}
        ${atlasToWorkLineHtml(toWork)}
        ${progressAtlasHtml(muscleSpan, toWork)}
        ${muscleLegendHtml(muscleSpan, load)}
        ${muscleSrListHtml(load)}
      </div>
      ${lowCell}
      ${unknownMusclesCell()}
      <button class="cell cell--nav" data-action="go-stats-muscles">
        <span class="cell__body"><span class="cell__title">Séries par muscle</span></span>
        ${icon('chevron.right', 16)}
      </button>
    </div>`;
}

// ── Progrès › Séries par muscle ─────────────────────────────

// Écran ouvert en haut (panel Progrès t1 : il s'ouvrait défilé, sélecteur et titre sous la barre) ; le muscle venu
// de la bulle est mis en avant sur place, sans défilement
function renderStatsMuscles() {
  const load = muscleLoad(muscleSpan);
  const ids = MUSCLES.map(m => m.id).sort((a, b) => load.weekly[b] - load.weekly[a] || load.sets[b] - load.sets[a]);
  return `
    <div class="view stats-muscles view--grouped">
      ${navBar({ title: 'Séries par muscle' })}
      <div class="scr">
        <div class="mdetail__seg">${spanSegmentedHtml()}</div>
        <div class="mdetail__legend">${muscleLegendHtml(load.span, null, { unit: false })}</div>
        <div class="group-title">${weeklyTitle(load.span)}</div>
        <div class="group">${muscleWeekRowsHtml(load, ids)}</div>
        <div class="group-foot">La couleur suit les paliers de la légende. Une série compte 1 pour les muscles principaux et ½ pour les secondaires. Repère : 10 séries par semaine et par muscle. Jusqu'à 20, les gains continuent, plus lentement.</div>
      </div>
    </div>`;
}

// ── Progrès › Exercices sans muscles ────────────────────────

// Rangée de la carte Muscles : n'existe que s'il reste des exercices inconnus
function unknownMusclesCell() {
  const n = unknownMuscleExercises().length;
  if (!n) return '';
  return `<button class="cell cell--nav" data-action="go-muscles-unknown">
      <span class="cell__body"><span class="cell__title">${plural(n, 'exercice sans muscles', 'exercices sans muscles')}</span>
        <span class="cell__sub">Absents de la carte et de la récupération</span></span>
      ${icon('chevron.right', 16)}
    </button>`;
}

function renderMusclesUnknown() {
  const list = unknownMuscleExercises();
  const rows = list.map(x => `
      <button class="cell cell--nav" data-action="declare-muscles" data-name="${esc(x.name)}">
        <span class="cell__body"><span class="cell__title">${esc(x.name)}</span>
          <span class="cell__sub">${plural(x.count, 'séance', 'séances')}</span></span>
        <span class="cell__value">Choisir</span>${icon('chevron.right', 16)}
      </button>`).join('');
  return `
    <div class="view muscles-unknown view--grouped">
      ${navBar({ title: 'Sans muscles' })}
      <div class="scr">${list.length ? `
        <div class="group">${rows}</div>
        <div class="group-foot">L'app ne reconnaît pas ces exercices d'après leur nom. Choisis leurs muscles pour les compter dans la carte et la récupération.</div>`
        : '<div class="empty-note">Tous tes exercices ont leurs muscles.</div>'}
      </div>
    </div>`;
}

// Écrans enregistrés auprès du routeur (même table que les écrans de js/ui/router.js)
SCREENS.set('stats-muscles', { render: () => renderStatsMuscles() });
SCREENS.set('muscles-unknown', { render: () => renderMusclesUnknown() });

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'muscle-span': (e, el) => {
    if (!MUSCLE_SPANS[el.dataset.span] || el.dataset.span === muscleSpan) return;
    muscleSpan = el.dataset.span; render();
  },
  // Ouvert en haut ; depuis la bulle d'un muscle (js/features/muscle-tip.js) seulement, sa ligne est mise en avant et
  // amenée à l'écran (on a demandé CE muscle)
  'go-stats-muscles': (e, el) => {
    muscleFocus = el.closest('.btip, .atlas-info') && isMuscleId(el.dataset.muscle) ? el.dataset.muscle : null;
    navigate('stats-muscles');
    if (muscleFocus) requestAnimationFrame(() => $(`.stats-muscles .mrow[data-muscle="${muscleFocus}"]`)?.scrollIntoView({ block: 'center' }));
  },
  'go-muscles-unknown': () => { navigate('muscles-unknown'); },
  'pick-ex-muscles': () => pickExMuscles(),
  // Programme › Exercice : brouillon seulement, enregistré par OK (Annuler le défait)
  'reset-ex-muscles': () => {
    if (!exDraft) return;
    Object.assign(exDraft, { muscles: null, musclesSecondary: null, musclesReset: true });
    refreshExEditMuscles();
    haptic();
  },
  // Progrès › Exercice, fiche : sans confirmation (rien d'irréversible), toast pour annuler
  'reset-muscles': (e, el) => {
    const undo = resetChosenMuscles({ name: el.dataset.name, exId: el.dataset.ex || null });
    save(); render();
    showToast('Muscles par défaut rétablis', { action: 'Annuler', duration: 5000, onAction: () => { undo(); save(); render(); } });
  },
  // Progrès : exercice sans muscles, ou muscles d'un exercice hors programme
  'declare-muscles': async (e, el) => { if (await declareMusclesFor(el.dataset.name)) render(); },
  'toggle-muscle': (e, el) => {
    const next = { false: 'true', true: 'mixed', mixed: 'false' };
    el.setAttribute('aria-checked', next[el.getAttribute('aria-checked')] || 'true');
    haptic();
  },
  // « Ressemble à » : reprend les muscles (principaux et secondaires) de l'exercice touché
  'muscles-like': (e, el) => {
    const m = exerciseMuscles({ name: el.dataset.name });
    el.closest('.sheet')?.querySelectorAll('.mpick__row').forEach(b => {
      const id = b.dataset.muscle;
      b.setAttribute('aria-checked', m.primary.includes(id) ? 'true' : m.secondary.includes(id) ? 'mixed' : 'false');
    });
    haptic();
  },
  'muscles-auto': (e, el) => {
    // Valide la feuille avec « Automatique » (lu par onConfirm)
    const panel = el.closest('.sheet');
    if (!panel) return;
    panel.dataset.auto = '1';
    panel.querySelector('.sheet__btn--confirm')?.click();
  },
});
