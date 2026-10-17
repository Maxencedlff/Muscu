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
function applyDraftMuscles(ex, draft) {
  const list = chosenMuscles(draft);
  if (list) ex.muscles = list; else delete ex.muscles;
}

function exEditMusclesHtml(d) {
  const m = exerciseMuscles({ name: d.name, muscles: d.muscles });
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
function refreshExEditMuscles() {
  const box = $('#exMuscles');
  if (box && exDraft) box.innerHTML = exEditMusclesHtml(exDraft);
}

// Nom saisi : les muscles reconnus suivent la frappe
document.addEventListener('input', e => {
  if (e.target.id === 'exName') refreshExEditMuscles();
});

// Feuille de choix : liste à cocher (role="checkbox" + aria-checked, WAI-ARIA), coche à droite comme
// les listes de choix iOS (Apple HIG, « Lists and tables ») ; « Automatique » revient au nom
async function pickExMuscles() {
  if (!exDraft) return;
  const m = exerciseMuscles({ name: exDraft.name, muscles: exDraft.muscles });
  const on = new Set(m.primary);
  const rows = MUSCLES.map(({ id, label }) => `
    <button class="mpick__row" role="checkbox" aria-checked="${on.has(id)}" data-action="toggle-muscle" data-muscle="${id}">
      <span>${label}</span>${icon('checkmark', 18)}
    </button>`).join('');
  const res = await sheet({ title: 'Muscles ciblés', body: `
    <div class="mpick" role="group" aria-label="Muscles ciblés">${rows}</div>
    <button class="mpick__auto" data-action="muscles-auto">Revenir à la reconnaissance automatique</button>
    <p class="mpick__foot">Les muscles choisis comptent comme principaux dans Progrès.</p>`,
    onConfirm: panel => {
      if (panel.dataset.auto === '1') return { auto: true };
      return { list: [...panel.querySelectorAll('.mpick__row[aria-checked="true"]')].map(b => b.dataset.muscle) };
    } });
  if (!res || !exDraft) return;
  exDraft.muscles = res.auto || !res.list.length ? null : res.list;
  refreshExEditMuscles();
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

// Écran enregistré auprès du routeur (même table que les écrans de js/ui/router.js)
SCREENS.set('stats-muscles', { render: () => renderStatsMuscles() });

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'muscle-span': (e, el) => {
    if (!MUSCLE_SPANS[el.dataset.span] || el.dataset.span === muscleSpan) return;
    muscleSpan = el.dataset.span; render();
  },
  'go-stats-muscles': () => { navigate('stats-muscles'); },
  'pick-ex-muscles': () => pickExMuscles(),
  'toggle-muscle': (e, el) => {
    el.setAttribute('aria-checked', String(el.getAttribute('aria-checked') !== 'true'));
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
