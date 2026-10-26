// ═══════════════════════════════════════════════════════════
//  Premier lancement : trois questions puis le programme conseillé, en plein écran
//
//  Où ? → Combien de fois par semaine ? → Ton niveau ? → résultat (programme en clair, pourquoi,
//  séances et muscles, silhouette Femme / Homme). Un toucher sur une réponse passe à la suivante ;
//  « Retour » en haut à gauche, « Plus tard » en haut à droite (rien n'est imposé, comme avant).
//  Plein écran plutôt qu'une carte de l'accueil : sans explication, l'accueil montrait « Push » à qui
//  ne sait pas ce qu'est un PPL ; les questions passent avant, une par écran, comme Bienvenue.
//  Calque bâti comme celui des écrans du compte (css/account.css, .auth) : app inerte dessous (MODAL_SEL).
//  La règle de choix est dans js/data/onboarding.js (testée sans navigateur).
// ═══════════════════════════════════════════════════════════
'use strict';

const onb = { root: null, steps: [], place: null, perWeek: null, level: null };
const ONB_QUESTIONS = ['place', 'freq', 'level'];

// Nouvel utilisateur seulement : rien de répondu, aucune séance (même règle que l'ancienne carte),
// pas de séance en cours restaurée
function onboardingNeeded() {
  return !data.onboarded && !(data.history || []).length && !activeSession;
}

// Appelé au démarrage (init.js), après Bienvenue s'il était ouvert. Le drapeau data.onboarded n'est
// posé que sur un vrai choix : l'app fermée en cours de route rouvre sur la première question.
function maybeShowOnboarding() {
  if (!onboardingNeeded() || onb.root) return;
  Object.assign(onb, { steps: [], place: null, perWeek: null, level: null });
  const root = document.createElement('div');
  root.className = 'onb';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'onbTitle');
  onb.root = root;
  document.body.appendChild(root);
  onbGo('place');
}

function closeOnboarding() {
  const root = onb.root;
  if (!root) return;
  onb.root = null;
  if (root.contains(document.activeElement)) document.activeElement.blur();
  root.classList.add('onb--out');
  setTimeout(() => root.remove(), reduceMotion.matches ? 0 : 240);
}

function onbGo(step) { onb.steps.push(step); paintOnboarding(); }
function onbBack() {
  if (onb.steps.length < 2) return;
  onb.steps.pop();
  paintOnboarding({ back: true });
}

function paintOnboarding({ back = false } = {}) {
  const step = onb.steps[onb.steps.length - 1];
  const q = ONB_QUESTIONS.indexOf(step);
  const left = onb.steps.length > 1
    ? `<button class="auth__nav navbar__back" data-action="onb-back" aria-label="Retour">${icon('chevron.left', 22)}<span class="navbar__back-label">Retour</span></button>`
    : '';
  // Avancement des questions (trois traits), rien sur le résultat
  const progress = q >= 0
    ? `<div class="onb__progress" role="progressbar" aria-label="Question ${q + 1} sur 3" aria-valuemin="1" aria-valuemax="3" aria-valuenow="${q + 1}">
        ${ONB_QUESTIONS.map((s, i) => `<span class="onb__dot${i <= q ? ' onb__dot--on' : ''}"></span>`).join('')}</div>`
    : '';
  const right = q >= 0 ? '<button class="auth__nav" data-action="onb-later">Plus tard</button>' : '';
  onb.root.innerHTML = `
    <div class="auth__bar onb__bar"><span class="onb__side">${left}</span>${progress}<span class="onb__side onb__side--end">${right}</span></div>
    <div class="auth__page onb__page onb__page--${step}${back ? ' onb__page--back' : ''} view--grouped">${ONB_STEPS[step]()}</div>`;
  onb.root.scrollTop = 0;
  fitBackLabel(onb.root);
  onb.root.querySelector('#onbTitle')?.focus({ preventScroll: true });
}

// Réponse : rangée de groupe iOS, coche sur la réponse déjà donnée (après « Retour »)
function onbOption(action, value, label, sub, on) {
  return `
    <button class="cell cell--nav onb__opt" data-action="${action}" data-val="${value}" aria-pressed="${on}">
      <span class="cell__body">
        <span class="cell__title onb__opt-title">${label}</span>
        ${sub ? `<span class="cell__sub onb__opt-sub">${sub}</span>` : ''}
      </span>
      ${on ? `<span class="cell__check">${icon('checkmark', 20)}</span>` : icon('chevron.right', 16)}
    </button>`;
}

function onbQuestion(title, lead, options) {
  return `
      <h1 class="auth__title auth__title--left" id="onbTitle" tabindex="-1">${title}</h1>
      ${lead ? `<p class="auth__lead auth__lead--left">${lead}</p>` : ''}
      <div class="group onb__group">${options}</div>`;
}

const ONB_STEPS = {
  place: () => onbQuestion('Où t\'entraînes\u2011tu&nbsp;?',   // trait d'union insécable : jamais « entraînes- / tu »
    'L\'app choisit un programme et des exercices adaptés. Tu pourras tout changer.',
    Object.entries(ONB_PLACES).map(([k, p]) => onbOption('onb-place', k, p.label, p.sub, onb.place === k)).join('')),

  freq: () => onbQuestion('Combien de séances par semaine&nbsp;?',
    'Sur une semaine normale. C\'est aussi ton objectif sur l\'accueil.',
    ONB_FREQS.map(f => onbOption('onb-freq', f.n, f.label, '', onb.perWeek === f.n)).join('')),

  level: () => onbQuestion('Ton niveau&nbsp;?', '',
    Object.entries(ONB_LEVELS).map(([k, l]) => onbOption('onb-level', k, l.label, l.sub, onb.level === k)).join('')),

  result: () => {
    const id = recommendProgramme(onb);
    const rows = programmePreview(id).map(s => `
        <div class="cell onb__session">
          ${catBadge(s.color)}
          <span class="cell__body">
            <span class="cell__title">${esc(s.label)}${s.plain ? ` <span class="onb__plain">· ${esc(s.plain.toLowerCase())}</span>` : ''}</span>
            <span class="cell__sub">${esc(s.muscles)}</span>
          </span>
        </div>`).join('');
    return `
      <p class="onb__eyebrow">Ton programme</p>
      <h1 class="auth__title auth__title--left" id="onbTitle" tabindex="-1">${esc(PROGRAMMES[id].name)}</h1>
      <p class="auth__lead auth__lead--left onb__reason">${recommendReason(id, onb)}</p>
      <div class="group onb__group">${rows}</div>
      <div class="onb__silhouette">
        <span class="onb__label">Silhouette des muscles</span>${silhouetteSegmentedHtml('onb-silhouette')}
      </div>
      <div class="onb__actions">
        <button class="btn btn--primary auth__primary" data-action="onb-start">Commencer</button>
        <button class="auth__skip" data-action="onb-others">Voir les autres programmes</button>
      </div>`;
  },
};

// Réponses appliquées : programme, filtre de matériel, objectif de la semaine
function applyOnboarding() {
  activateProgramme(recommendProgramme(onb));
  data.exEquip = ONB_PLACES[onb.place]?.equip || 'all';
  if (onb.perWeek) data.weeklyGoal = onb.perWeek;
  data.onboarded = true;
  save();
}

registerActions({
  'onb-place': (e, el) => { onb.place = el.dataset.val in ONB_PLACES ? el.dataset.val : null; haptic(); onbGo('freq'); },
  'onb-freq': (e, el) => { onb.perWeek = ONB_FREQS.find(f => f.n === +el.dataset.val)?.n || null; haptic(); onbGo('level'); },
  'onb-level': (e, el) => { onb.level = el.dataset.val in ONB_LEVELS ? el.dataset.val : null; haptic(); onbGo('result'); },
  'onb-back': () => onbBack(),
  // Comme l'ancien « Plus tard » : aucun choix imposé, la question ne revient plus
  'onb-later': () => { data.onboarded = true; save(); closeOnboarding(); render(); },
  'onb-silhouette': (e, el) => {
    if (!SILHOUETTES.some(([v]) => v === el.dataset.val)) return;
    data.silhouette = el.dataset.val;
    save();
    onb.root?.querySelectorAll('[data-action="onb-silhouette"]').forEach(b => {
      const on = b.dataset.val === data.silhouette;
      b.classList.toggle('segmented__btn--active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    haptic();
  },
  'onb-start': () => { applyOnboarding(); haptic(); closeOnboarding(); render(); },
  // Programme conseillé déjà coché dans la liste : un toucher en choisit un autre
  'onb-others': () => { applyOnboarding(); closeOnboarding(); navigate('prog-picker'); },
});
