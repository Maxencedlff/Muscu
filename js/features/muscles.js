// ═══════════════════════════════════════════════════════════
//  Muscles : pastilles des exercices, choix des muscles, carte et écran de Progrès
// ═══════════════════════════════════════════════════════════
'use strict';

let muscleSpan = 'week';   // période de Progrès : 'week' | 'month' (MUSCLE_SPANS)

// Intensités d'un exercice pour la mini-silhouette : principaux pleins, secondaires atténués
const SECONDARY_INTENSITY = 0.4;
function exerciseIntensity(m) {
  const lv = {};
  m.secondary.forEach(id => { lv[id] = SECONDARY_INTENSITY; });
  m.primary.forEach(id => { lv[id] = 1; });
  return lv;
}

// ── Pastilles ───────────────────────────────────────────────

// « Pectoraux » (principal, teinté) puis « Triceps » (secondaire, gris)
function musclePillsHtml(m) {
  const pill = (id, main) => `<li class="mpill ${main ? 'mpill--main' : ''}">${muscleLabel(id)}</li>`;
  return `<ul class="mpills" aria-label="Muscles ciblés">${m.primary.map(id => pill(id, true)).join('')}${m.secondary.map(id => pill(id, false)).join('')}</ul>`;
}

// Ligne discrète sous le nom d'un exercice dans une liste : « Pectoraux · Triceps »
function exMusclesSubHtml(ex, cls = 'cell__sub') {
  const line = musclesLine(exerciseMuscles(ex));
  return line ? `<span class="${cls} ex-muscles">${line}</span>` : '';
}

// Mini-silhouette et pastilles d'un exercice (Programme › Exercice, Progrès › Exercice)
function exMusclesPanelHtml(m) {
  if (!m.primary.length) {
    return `<div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">Muscles non reconnus</span>
      <span class="cell__sub">Choisis les muscles travaillés pour les voir dans Progrès.</span></span></div>`;
  }
  return `
    <div class="cell mpanel">
      ${bodyMapSvg(exerciseIntensity(m), { className: 'mpanel__map' })}
      <div class="cell__body">${musclePillsHtml(m)}</div>
    </div>`;
}

// ── Programme › Exercice : muscles reconnus ou choisis ──────

// Le brouillon garde le choix de l'utilisateur (null : reconnaissance par le nom)
function draftMuscles(ex) { return chosenMuscles(ex); }
function draftSecondary(ex) { return chosenMuscles(ex) ? chosenSecondary(ex) : []; }
function applyDraftMuscles(ex, draft) {
  const list = chosenMuscles(draft);
  if (list) ex.muscles = list; else delete ex.muscles;
  const sec = list ? chosenSecondary(draft, list) : [];
  if (sec.length) ex.musclesSecondary = sec; else delete ex.musclesSecondary;
}

function exEditMusclesHtml(d) {
  const m = exerciseMuscles({ name: d.name, muscles: d.muscles, musclesSecondary: d.musclesSecondary });
  const foot = m.source === 'user' ? 'Muscles choisis par toi.'
    : m.source === 'none' ? (d.name.trim() ? 'Nom non reconnu : choisis les muscles travaillés.' : 'Reconnus d\'après le nom de l\'exercice.')
    : 'Reconnus d\'après le nom de l\'exercice.';
  return `
    <div class="group-title">Muscles ciblés</div>
    <div class="group">
      ${exMusclesPanelHtml(m)}
      <button class="cell cell--nav" data-action="pick-ex-muscles">
        <span class="cell__body"><span class="cell__title">Choisir les muscles</span></span>
        <span class="cell__value">${m.source === 'user' ? 'Personnalisés' : 'Automatique'}</span>
        ${icon('chevron.right', 16)}
      </button>
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
async function pickMusclesSheet({ title = 'Muscles ciblés', current = [], currentSecondary = [], intro = '', cancel, auto = true, like = [] } = {}) {
  const likeHtml = like.length ? `
    <div class="mpick__like" role="group" aria-label="Ressemble à">
      <span class="mpick__like-title">Ressemble à</span>
      ${like.map(e => `<button class="ax__chip" data-action="muscles-like" data-name="${esc(e.name)}">${esc(e.name)}</button>`).join('')}
    </div>` : '';
  return sheet({ title, ...(cancel ? { cancel } : {}), body: `
    ${intro ? `<p class="mpick__intro">${intro}</p>` : ''}
    ${likeHtml}
    <div class="mpick" role="group" aria-label="${esc(title)}">${mpickRowsHtml(current, currentSecondary)}</div>
    ${auto ? '<button class="mpick__auto" data-action="muscles-auto">Revenir à la reconnaissance automatique</button>' : ''}
    <p class="mpick__foot">Un toucher : muscle principal. Deux : secondaire, compté pour une demi-série. Trois : retiré.</p>`,
    onConfirm: panel => {
      if (panel.dataset.auto === '1') return { auto: true };
      const pick = v => [...panel.querySelectorAll(`.mpick__row[aria-checked="${v}"]`)].map(b => b.dataset.muscle);
      return { list: pick('true'), secondary: pick('mixed') };
    } });
}

async function pickExMuscles() {
  if (!exDraft) return;
  const m = exerciseMuscles({ name: exDraft.name, muscles: exDraft.muscles, musclesSecondary: exDraft.musclesSecondary });
  const res = await pickMusclesSheet({ current: m.primary, currentSecondary: m.secondary, like: m.primary.length ? [] : similarExercises(exDraft.name) });
  if (!res || !exDraft) return;
  const none = res.auto || !res.list.length;
  exDraft.muscles = none ? null : res.list;
  exDraft.musclesSecondary = none ? null : res.secondary;
  refreshExEditMuscles();
}

// Muscles d'un exercice quelconque (séance, séance libre, historique), gardés par nom pour toute l'app.
// ask : proposé juste après l'ajout d'un exercice inconnu (« Plus tard » pour passer). Renvoie true si changé.
async function declareMusclesFor(name, { ask = false } = {}) {
  const m = exerciseMuscles({ name });
  const like = m.primary.length ? [] : similarExercises(name);
  const res = await pickMusclesSheet({
    title: ask ? 'Quels muscles ?' : 'Muscles ciblés',
    intro: ask ? `L'app ne reconnaît pas « ${esc(name)} ». Choisis ce qu'il travaille pour la récupération et Progrès.` : esc(name),
    current: m.primary, currentSecondary: m.secondary, like, cancel: ask ? 'Plus tard' : undefined, auto: !ask && m.source === 'user' });
  if (!res) return false;
  setDeclaredMuscles(name, res.auto ? null : { primary: res.list, secondary: res.secondary });
  save();
  return true;
}

// Après l'ajout d'un exercice : si ses muscles sont inconnus, on les demande (une fois la feuille fermée)
function askMusclesIfUnknown(name, after = () => render()) {
  if (exerciseMuscles({ name }).primary.length) return;
  setTimeout(async () => { if (await declareMusclesFor(name, { ask: true })) after(); }, 350);
}

// ── Progrès : carte « Muscles » ─────────────────────────────

const LEVEL_WORDS = ['non travaillé', 'peu travaillé', 'travaillé', 'bien travaillé'];

function spanSegmentedHtml() {
  return `<div class="segmented seg-full" role="group" aria-label="Période">
    ${Object.entries(MUSCLE_SPANS).map(([k, s]) => `<button class="segmented__btn ${muscleSpan === k ? 'segmented__btn--active' : ''}" aria-pressed="${muscleSpan === k}" data-action="muscle-span" data-span="${k}">${s.label}</button>`).join('')}
  </div>`;
}

// Légende : un échantillon par palier, bornes en séries par semaine
function muscleLegendHtml() {
  const from = MUSCLE_LEVEL_FROM;
  const labels = ['0', ...from.map((f, i) => i + 1 < from.length ? `${i ? f : 1}–${from[i + 1] - 1}` : `${f}+`)];
  return `<div class="mlegend" aria-hidden="true">
    ${labels.map((l, lvl) => `<span class="mlegend__item"><i class="mlegend__dot" style="--o:${bodyHeatOpacity(lvl / MUSCLE_LEVEL_MAX)}"></i>${l}</span>`).join('')}
    <span class="mlegend__unit">séries / semaine</span>
  </div>`;
}

function setsTxt(n) { return plural(roundSets(n), 'série', 'séries'); }

// Liste lue par VoiceOver à la place du dessin (Apple HIG, « Accessibility » : l'information portée
// par la couleur existe aussi en texte)
function muscleSrListHtml(load) {
  return `<ul class="visually-hidden">${MUSCLES.map(({ id, label }) =>
    `<li>${label} : ${setsTxt(load.sets[id])}, ${LEVEL_WORDS[load.levels[id]]}</li>`).join('')}</ul>`;
}

function periodTxt(span = muscleSpan) { return span === 'month' ? 'ces 4 dernières semaines' : 'ces 7 derniers jours'; }

function renderMuscleCard() {
  const load = muscleLoad(muscleSpan);
  const low = load.low.slice(0, 5).map(muscleLabel);
  const lowCell = !load.sessions
    ? `<div class="cell"><span class="cell__body"><span class="cell__sub">Aucune séance ${periodTxt()}.</span></span></div>`
    : `<div class="cell"><span class="cell__body">
        <span class="cell__title cell__title--reg">${low.length ? 'Peu travaillés' : 'Tous les grands groupes travaillés'}</span>
        ${low.length ? `<span class="cell__sub mlow">${low.join(' · ')}</span>` : ''}
      </span></div>`;
  return `
    <div class="group-title">Muscles</div>
    <div class="group mcard">
      <div class="mcard__top">
        ${spanSegmentedHtml()}
        ${bodyMapSvg(load.intensity, { className: 'mcard__map', captions: true })}
        ${muscleLegendHtml()}
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

function renderStatsMuscles() {
  const load = muscleLoad(muscleSpan);
  const weeks = MUSCLE_SPANS[load.span].weeks;
  const max = Math.max(MUSCLE_LEVEL_FROM.at(-1) * weeks, ...Object.values(load.sets));
  const rows = MUSCLES.slice().sort((a, b) => load.sets[b.id] - load.sets[a.id]).map(({ id, label }) => {
    const pct = Math.round(load.sets[id] / max * 100);
    return `
      <div class="cell mrow">
        <span class="cell__body">
          <span class="mrow__top"><span class="cell__title">${label}</span><span class="cell__value num">${roundSets(load.sets[id])}</span></span>
          <span class="mrow__bar" aria-hidden="true"><i style="width:${pct}%;--o:${bodyHeatOpacity(load.intensity[id]) || 0}"></i></span>
          <span class="visually-hidden">${setsTxt(load.sets[id])}, ${LEVEL_WORDS[load.levels[id]]}</span>
        </span>
      </div>`;
  }).join('');
  return `
    <div class="view stats-muscles view--grouped">
      ${navBar({ title: 'Séries par muscle' })}
      <div class="scr">
        <div class="mdetail__seg">${spanSegmentedHtml()}</div>
        <div class="group-title">Séries ${periodTxt(load.span)}</div>
        <div class="group">${rows}</div>
        <div class="group-foot">Une série compte entière pour les muscles principaux d'un exercice et pour moitié pour ses muscles secondaires. Repère : une dizaine de séries par semaine et par muscle.</div>
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
        <div class="group-foot">L'app ne reconnaît pas ces exercices d'après leur nom. Une fois leurs muscles choisis, ils comptent dans la carte des muscles et pour la récupération, dans tous tes programmes.</div>`
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
  'go-stats-muscles': () => { navigate('stats-muscles'); },
  'go-muscles-unknown': () => { navigate('muscles-unknown'); },
  'pick-ex-muscles': () => pickExMuscles(),
  // Progrès : exercice sans muscles, ou muscles d'un exercice hors programme
  'declare-muscles': async (e, el) => { if (await declareMusclesFor(el.dataset.name)) render(); },
  'toggle-muscle': (e, el) => {
    const next = { false: 'true', true: 'mixed', mixed: 'false' };
    el.setAttribute('aria-checked', next[el.getAttribute('aria-checked')] || 'true');
    haptic();
  },
  // « Ressemble à » : reprend les muscles (principaux et secondaires) de l'exercice touché
  'muscles-like': (e, el) => {
    const m = musclesOf(el.dataset.name);
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
