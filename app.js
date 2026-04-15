'use strict';

// ═══════════════════════════════════════════════════════════
//  Utilities
// ═══════════════════════════════════════════════════════════

function uid() { return Math.random().toString(36).slice(2, 10); }
function $(sel, ctx = document) { return ctx.querySelector(sel); }
function pad(n) { return String(n).padStart(2, '0'); }

function fmt72(ms) {
  if (ms <= 0) return 'Prête !';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}

function fmtRest(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${pad(m)}:${pad(s)}`;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function showToast(msg) {
  const existing = $('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ═══════════════════════════════════════════════════════════
//  Data
// ═══════════════════════════════════════════════════════════

const KEY = 'ppl_v1';

function makeExercise(name, sets) {
  return { id: uid(), name, sets, lastWeight: '', lastReps: '', pr: null };
}

function makeDefaultData() {
  return {
    exercises: {
      push: [
        makeExercise('Développé couché haltères', 4),
        makeExercise('Développé incliné haltères', 3),
        makeExercise('Écarté haltères plat', 3),
        makeExercise('Développé militaire haltères', 4),
        makeExercise('Élévations latérales', 4),
        makeExercise('Extension triceps poulie', 3),
      ],
      pull: [
        makeExercise('Rowing haltère unilatéral', 4),
        makeExercise('Tirage vertical prise large', 4),
        makeExercise('Tirage horizontal câble', 3),
        makeExercise('Curl biceps haltères', 3),
        makeExercise('Curl marteau', 3),
      ],
      legs: [
        makeExercise('Squat barre', 4),
        makeExercise('Presse à cuisses', 4),
        makeExercise('Fentes marchées haltères', 3),
        makeExercise('Leg curl machine', 3),
        makeExercise('Extension quadriceps', 3),
        makeExercise('Mollets debout', 4),
      ],
    },
    timers: { push: null, pull: null, legs: null },
    defaultRest: 90,
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return makeDefaultData();
    const d = JSON.parse(raw);
    ['push', 'pull', 'legs'].forEach(c => { if (!d.exercises[c]) d.exercises[c] = []; });
    if (!d.defaultRest) d.defaultRest = 90;
    return d;
  } catch { return makeDefaultData(); }
}

function save() { localStorage.setItem(KEY, JSON.stringify(data)); }

// ═══════════════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════════════

let data          = loadData();
let view          = 'dashboard';  // 'dashboard' | 'session' | 'editor' | 'history' | 'stats'
let editorCat     = 'push';
let activeSession = null;
let ticker        = null;         // 72h dashboard ticker
let restInterval  = null;
let restTimeLeft  = 0;
let restActive    = false;
let modalOpen     = false;
let editExIdx     = null;
let statsCat      = 'push';
let audioCtx      = null;
let wakeLock      = null;

// ═══════════════════════════════════════════════════════════
//  Audio
// ═══════════════════════════════════════════════════════════

function beep(freq, dur = .15, vol = .35) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + dur);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch {}
}

function timerDone() {
  beep(880, .12); setTimeout(() => beep(1100, .12), 160); setTimeout(() => beep(1320, .35), 320);
  if (navigator.vibrate) navigator.vibrate([150, 80, 150, 80, 300]);
}

function validationSound() { beep(660, .1); }
function finishSound()     { beep(880, .1); setTimeout(() => beep(1320, .25), 160); }

// ═══════════════════════════════════════════════════════════
//  Render dispatcher
// ═══════════════════════════════════════════════════════════

function render() {
  const app = $('#app');

  // preserve scroll position on session re-renders
  const prev = $('.session-content');
  const scrollTop = prev ? prev.scrollTop : 0;

  if      (view === 'dashboard') app.innerHTML = renderDashboard();
  else if (view === 'session')   app.innerHTML = renderSession();
  else if (view === 'editor')    app.innerHTML = renderEditor();
  else if (view === 'history')   app.innerHTML = renderHistory();
  else if (view === 'stats')     app.innerHTML = renderStats();

  if (view === 'stats') setTimeout(drawCharts, 0);

  if (view === 'session') {
    const sc = $('.session-content');
    if (sc) sc.scrollTop = scrollTop;
  }
}

// ═══════════════════════════════════════════════════════════
//  Dashboard
// ═══════════════════════════════════════════════════════════

const CAT_LABEL = { push: 'Push', pull: 'Pull', legs: 'Legs' };
const CAT_ICON  = { push: '💪',   pull: '🔄',   legs: '🦵'  };
const CAT_DESC  = {
  push: 'Pectoraux · Épaules · Triceps',
  pull: 'Dos · Biceps · Trapèzes',
  legs: 'Quadriceps · Ischio · Mollets',
};

function renderDashboard() {
  const cards = ['push', 'pull', 'legs'].map(cat => {
    const last      = data.timers[cat];
    const deadline  = last ? last + 72 * 3600_000 : 0;
    const remaining = deadline - Date.now();
    const ready     = !last || remaining <= 0;
    const exCount   = data.exercises[cat].length;
    const totalSets = data.exercises[cat].reduce((a, e) => a + e.sets, 0);

    return `
      <div class="card card--${cat} ${ready ? 'ready' : ''}">
        <div class="card__header">
          <span class="card__icon">${CAT_ICON[cat]}</span>
          <div>
            <div class="card__title">${CAT_LABEL[cat]}</div>
            <div class="card__desc">${CAT_DESC[cat]}</div>
          </div>
        </div>
        <div class="card__timer ${ready ? 'timer--ready' : 'timer--recovering'}" id="timer-${cat}">
          ${ready ? 'Prête !' : fmt72(remaining)}
        </div>
        <div class="card__meta">${exCount} exercices · ${totalSets} séries planifiées</div>
        <button class="btn btn--primary btn--full" data-action="start-session" data-cat="${cat}"
                ${ready ? '' : 'disabled'}>
          ${ready ? 'Démarrer la séance' : 'En récupération'}
        </button>
      </div>`;
  }).join('');

  return `
    <div class="view dashboard">
      <header class="header">
        <span class="header__title">PPL Training</span>
        <div style="display:flex;gap:4px">
          <button class="icon-btn" data-action="go-stats" title="Progression">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </button>
          <button class="icon-btn" data-action="go-history" title="Historique">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </button>
          <button class="icon-btn" data-action="go-editor" title="Gérer les exercices">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>
      </header>
      <div class="cards">${cards}</div>
      <div class="dashboard__footer">
        <button class="link-btn" data-action="export">Exporter mes données</button>
        <button class="link-btn" data-action="import">Importer</button>
      </div>
    </div>`;
}

function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    if (view !== 'dashboard') return;
    ['push', 'pull', 'legs'].forEach(cat => {
      const el   = $(`#timer-${cat}`);
      const btn  = $(`.card--${cat} .btn`);
      const card = $(`.card--${cat}`);
      if (!el) return;
      const last = data.timers[cat];
      if (!last) return;
      const rem = (last + 72 * 3600_000) - Date.now();
      if (rem <= 0) {
        el.textContent = 'Prête !';
        el.className = 'card__timer timer--ready';
        if (btn)  { btn.disabled = false; btn.textContent = 'Démarrer la séance'; }
        if (card) card.classList.add('ready');
      } else {
        el.textContent = fmt72(rem);
      }
    });
  }, 1000);
}

// ═══════════════════════════════════════════════════════════
//  Session
// ═══════════════════════════════════════════════════════════

function startSession(cat) {
  const exList = data.exercises[cat] || [];
  activeSession = {
    category: cat,
    startedAt: Date.now(),
    exercises: exList.map(ex => ({
      exId: ex.id,
      name: ex.name,
      sets: Array.from({ length: ex.sets }, () => ({
        weight: ex.lastWeight || '',
        reps:   ex.lastReps   || '',
        done:   false,
      })),
    })),
  };
  view = 'session';
  render();
  requestWakeLock();
}

function renderSession() {
  const { category: cat, exercises } = activeSession;

  const totalSets = exercises.reduce((a, ex) => a + ex.sets.length, 0);
  const doneSets  = exercises.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0);
  const pct       = totalSets ? Math.round(doneSets / totalSets * 100) : 0;

  // Trouver la séance précédente pour cette catégorie
  const prevSession = (data.history || []).find(h => h.category === cat);

  const exHtml = exercises.map((ex, ei) => {
    const ex_data   = data.exercises[cat]?.find(e => e.id === ex.exId);
    const prText    = ex_data?.pr ? `PR : ${ex_data.pr.weight} kg × ${ex_data.pr.reps}` : '';
    const hint      = prText;
    const allDone   = ex.sets.every(s => s.done);

    // Données séance précédente pour cet exercice
    const prevEx    = prevSession?.exercises.find(e => e.name === ex.name);
    const prevSets  = prevEx?.sets || [];

    const setsHtml = ex.sets.map((s, si) => {
      if (s.done) {
        const isNewPR = ex_data?.pr &&
          s.weight == ex_data.pr.weight && s.reps == ex_data.pr.reps;
        return `
          <div class="set-row set-row--done">
            <span class="set-num">Série ${si + 1}</span>
            <span class="set-val">${s.weight} kg × ${s.reps}</span>
            ${isNewPR ? '<span class="pr-badge">PR !</span>' : ''}
            <button class="rest-btn" data-action="start-rest">⏱ Repos</button>
          </div>`;
      }

      const isActive = ex.sets.slice(0, si).every(s => s.done);
      if (!isActive) {
        return `
          <div class="set-row set-row--pending">
            <span class="set-num">Série ${si + 1}</span>
            <span class="set-pending-dash">·  ·  ·</span>
          </div>`;
      }

      return `
        <div class="set-row set-row--active">
          <span class="set-num">Série ${si + 1}</span>
          <div class="input-group">
            <input type="number" inputmode="decimal" class="set-input" placeholder="0"
                   value="${s.weight}" data-action="set-weight" data-ei="${ei}" data-si="${si}">
            <span class="input-unit">kg</span>
          </div>
          <div class="input-group">
            <input type="number" inputmode="numeric" class="set-input" placeholder="0"
                   value="${s.reps}" data-action="set-reps" data-ei="${ei}" data-si="${si}">
            <span class="input-unit">reps</span>
          </div>
          <button class="btn btn--success btn--sm" data-action="validate-set" data-ei="${ei}" data-si="${si}">
            ✓
          </button>
        </div>`;
    }).join('');

    const prevHtml = prevSets.length ? `
      <div class="prev-session">
        <div class="prev-session__label">Séance du ${fmtDate(prevSession.date)}</div>
        <div class="prev-session__sets">
          ${prevSets.map((s, i) => `<span class="prev-set">S${i+1} : ${s.weight} kg × ${s.reps}</span>`).join('')}
        </div>
      </div>` : '';

    return `
      <div class="exercise-block ${allDone ? 'exercise-block--done' : ''}">
        <div class="exercise-header">
          <span class="exercise-name">${ex.name}</span>
          <span class="exercise-progress">${ex.sets.filter(s => s.done).length}/${ex.sets.length}</span>
        </div>
        ${hint ? `<div class="exercise-hint"><span class="pr">${hint}</span></div>` : ''}
        ${prevHtml}
        ${setsHtml}
      </div>`;
  }).join('');

  return `
    <div class="view session">
      <header class="header header--${cat}">
        <button class="icon-btn" data-action="back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <div class="header__center">
          <div class="header__title">${CAT_ICON[cat]} ${CAT_LABEL[cat]}</div>
          <div class="header__sub">${doneSets} / ${totalSets} séries</div>
        </div>
        <button class="btn--finish" data-action="finish-session">Terminer</button>
      </header>
      <div class="progress-bar">
        <div class="progress-bar__fill progress-bar__fill--${cat}" style="width:${pct}%"></div>
      </div>
      <div class="session-content">${exHtml}</div>
    </div>
    ${renderRestOverlay()}`;
}

function validateSet(ei, si) {
  const ex  = activeSession.exercises[ei];
  const s   = ex.sets[si];
  if (!s.weight || !s.reps) { showToast('Entre le poids et les reps !'); return; }

  s.done = true;
  validationSound();

  // Pré-remplir la série suivante avec les mêmes valeurs
  const nextSet = ex.sets[si + 1];
  if (nextSet && !nextSet.done) {
    nextSet.weight = s.weight;
    nextSet.reps   = s.reps;
  }

  // Persist last weight/reps + update PR
  const cat    = activeSession.category;
  const exData = data.exercises[cat]?.find(e => e.id === ex.exId);
  if (exData) {
    exData.lastWeight = s.weight;
    exData.lastReps   = s.reps;
    const w  = parseFloat(s.weight) || 0;
    const r  = parseInt(s.reps)     || 0;
    const pw = parseFloat(exData.pr?.weight) || 0;
    const pr = parseInt(exData.pr?.reps)     || 0;
    if (w > pw || (w === pw && r > pr)) {
      exData.pr = { weight: s.weight, reps: s.reps };
    }
    save();
  }

  render();

  // Auto-scroll to the validated set
  setTimeout(() => {
    const rows = document.querySelectorAll('.set-row--done');
    if (rows.length) rows[rows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 50);
}

// ═══════════════════════════════════════════════════════════
//  Rest timer overlay
// ═══════════════════════════════════════════════════════════

function renderRestOverlay() {
  if (!restActive) return '';
  const presets = [60, 90, 120, 180];
  const ending  = restTimeLeft <= 5;

  return `
    <div class="rest-overlay">
      <div class="rest-card">
        <div class="rest-label">Repos</div>
        <div class="rest-timer ${ending ? 'ending' : ''}">${fmtRest(restTimeLeft)}</div>
        <div class="rest-presets">
          ${presets.map(p => `
            <button class="preset-btn ${restTimeLeft === p ? 'preset-btn--active' : ''}"
                    data-action="set-rest" data-secs="${p}">
              ${p < 60 ? p + 's' : p / 60 + 'min'}
            </button>`).join('')}
        </div>
        <div class="rest-custom">
          <input type="number" inputmode="numeric" id="customRest" class="rest-custom-input"
                 placeholder="Durée en secondes" min="10" max="600">
          <button class="btn btn--secondary btn--sm" data-action="set-custom-rest">OK</button>
        </div>
        <button class="btn btn--primary btn--full" data-action="skip-rest">Passer le repos</button>
      </div>
    </div>`;
}

function startRestCountdown() {
  clearInterval(restInterval);
  restInterval = setInterval(() => {
    restTimeLeft = Math.max(0, restTimeLeft - 1);

    // Update only the timer display (no full re-render)
    const el = $('.rest-timer');
    if (el) {
      el.textContent = fmtRest(restTimeLeft);
      el.className   = `rest-timer ${restTimeLeft <= 5 ? 'ending' : ''}`;
    }

    if (restTimeLeft <= 0) {
      clearInterval(restInterval);
      timerDone();
      restActive = false;
      setTimeout(() => render(), 350);
    }
  }, 1000);
}

function clearRest() { clearInterval(restInterval); restInterval = null; }

function openRest() {
  restActive   = true;
  restTimeLeft = data.defaultRest;
  startRestCountdown();
  render();
}

// ═══════════════════════════════════════════════════════════
//  Editor
// ═══════════════════════════════════════════════════════════

function renderEditor() {
  const cats = ['push', 'pull', 'legs'];
  const tabs = cats.map(c => `
    <button class="tab ${editorCat === c ? `tab--active tab--${c}` : ''}"
            data-action="editor-tab" data-cat="${c}">
      ${CAT_ICON[c]} ${CAT_LABEL[c]}
    </button>`).join('');

  const rows = (data.exercises[editorCat] || []).map((ex, i) => {
    const last = ex.lastWeight
      ? `${ex.lastWeight} kg × ${ex.lastReps}`
      : 'Pas encore effectué';
    const pr   = ex.pr ? ` · PR: ${ex.pr.weight} kg × ${ex.pr.reps}` : '';
    const max  = data.exercises[editorCat].length - 1;

    return `
      <div class="editor-row">
        <div class="editor-row__reorder">
          <button class="reorder-btn" data-action="move-up"   data-i="${i}" ${i === 0   ? 'disabled' : ''}>▲</button>
          <button class="reorder-btn" data-action="move-down" data-i="${i}" ${i === max ? 'disabled' : ''}>▼</button>
        </div>
        <div class="editor-row__info">
          <div class="editor-row__name">${ex.name}</div>
          <div class="editor-row__meta">${last}${pr}</div>
        </div>
        <div class="editor-row__sets">
          <button class="sets-adj" data-action="dec-sets" data-i="${i}">−</button>
          <span class="sets-count">${ex.sets}</span>
          <button class="sets-adj" data-action="inc-sets" data-i="${i}">+</button>
        </div>
        <button class="icon-btn" data-action="edit-ex" data-i="${i}" title="Renommer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
        </button>
        <button class="icon-btn" data-action="del-ex" data-i="${i}" title="Supprimer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
          </svg>
        </button>
      </div>`;
  }).join('');

  return `
    <div class="view editor">
      <header class="header">
        <button class="icon-btn" data-action="back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <span class="header__title">Exercices</span>
        <div style="width:40px"></div>
      </header>
      <div class="tabs">${tabs}</div>
      <div class="editor-list">${rows}</div>
      <div class="editor-footer">
        <button class="btn btn--primary btn--full" data-action="add-ex">+ Ajouter un exercice</button>
      </div>
    </div>
    ${renderModal()}`;
}

function renderModal() {
  if (!modalOpen) return '';
  const isEdit = editExIdx !== null;
  const ex     = isEdit ? data.exercises[editorCat][editExIdx] : null;

  return `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__title">${isEdit ? 'Modifier' : 'Ajouter'} un exercice</div>
        <label class="form-label">Nom de l'exercice</label>
        <input type="text" id="modalName" class="form-input"
               value="${ex ? ex.name : ''}" placeholder="Ex : Curl biceps haltères" autocomplete="off">
        <label class="form-label">Nombre de séries par défaut</label>
        <input type="number" inputmode="numeric" id="modalSets" class="form-input"
               value="${ex ? ex.sets : 3}" min="1" max="10">
        <div class="modal__actions">
          <button class="btn btn--secondary" data-action="close-modal">Annuler</button>
          <button class="btn btn--primary"   data-action="save-ex">${isEdit ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
//  Stats / Progression
// ═══════════════════════════════════════════════════════════

const CAT_COLOR = { push: '#ef4444', pull: '#3b82f6', legs: '#22c55e' };

function renderStats() {
  const tabs = ['push', 'pull', 'legs'].map(c => `
    <button class="tab ${statsCat === c ? `tab--active tab--${c}` : ''}"
            data-action="stats-tab" data-cat="${c}">
      ${CAT_ICON[c]} ${CAT_LABEL[c]}
    </button>`).join('');

  const exercises = data.exercises[statsCat] || [];
  const history   = data.history || [];
  const color     = CAT_COLOR[statsCat];

  const cards = exercises.map(ex => {
    // Collecter un point par séance : poids max utilisé
    const points = history
      .filter(s => s.category === statsCat)
      .map(s => {
        const found = s.exercises.find(e => e.name === ex.name);
        if (!found || !found.sets.length) return null;
        const maxW = Math.max(...found.sets.map(s => parseFloat(s.weight) || 0));
        return { date: s.date, maxW };
      })
      .filter(Boolean)
      .reverse(); // ordre chronologique

    if (points.length === 0) return `
      <div class="stats-card">
        <div class="stats-card__name">${ex.name}</div>
        <div class="stats-card__empty">Pas encore effectué</div>
      </div>`;

    const allWeights  = points.map(p => p.maxW);
    const prWeight    = Math.max(...allWeights);
    const currentW    = points[points.length - 1].maxW;
    const firstW      = points[0].maxW;
    const progPct     = firstW > 0 ? Math.round(((currentW - firstW) / firstW) * 100) : 0;
    const progLabel   = progPct > 0 ? `+${progPct}%` : progPct < 0 ? `${progPct}%` : '—';
    const progColor   = progPct > 0 ? '#22c55e' : progPct < 0 ? '#ef4444' : 'var(--muted)';

    // Stocker les données dans l'attribut data pour drawCharts
    const encoded = encodeURIComponent(JSON.stringify(allWeights));

    return `
      <div class="stats-card">
        <div class="stats-card__header">
          <span class="stats-card__name">${ex.name}</span>
          <span class="stats-card__current">${currentW} kg</span>
        </div>
        <canvas class="stats-canvas"
                data-weights="${encoded}"
                data-color="${color}"></canvas>
        <div class="stats-card__footer">
          <span>PR : <strong>${prWeight} kg</strong></span>
          <span style="color:${progColor};font-weight:700">${progLabel}</span>
          <span>${points.length} séance${points.length > 1 ? 's' : ''}</span>
        </div>
      </div>`;
  }).join('');

  const hasData = exercises.some(ex =>
    history.some(s => s.category === statsCat && s.exercises.find(e => e.name === ex.name))
  );

  return `
    <div class="view stats">
      <header class="header">
        <button class="icon-btn" data-action="back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <span class="header__title">Progression</span>
        <div style="width:40px"></div>
      </header>
      <div class="tabs">${tabs}</div>
      <div class="stats-list">
        ${hasData ? cards : `
          <div class="empty-state">
            <div class="empty-state__icon">📈</div>
            <div>Pas encore de données</div>
            <div class="empty-state__sub">Termine des séances pour voir ta progression ici</div>
          </div>`}
      </div>
    </div>`;
}

function drawCharts() {
  document.querySelectorAll('.stats-canvas').forEach(canvas => {
    const weights = JSON.parse(decodeURIComponent(canvas.dataset.weights));
    const color   = canvas.dataset.color;

    const W   = canvas.parentElement.clientWidth - 32;
    const H   = 90;
    const dpr = window.devicePixelRatio || 1;

    canvas.width        = W * dpr;
    canvas.height       = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    if (weights.length === 0) return;

    // Un seul point
    if (weights.length === 1) {
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      return;
    }

    const minW   = Math.min(...weights) * 0.95;
    const maxW   = Math.max(...weights) * 1.05;
    const range  = (maxW - minW) || 1;
    const pT = 14, pB = 14, pL = 6, pR = 6;
    const cW = W - pL - pR;
    const cH = H - pT - pB;

    const x = i => pL + (i / (weights.length - 1)) * cW;
    const y = w => pT + cH - ((w - minW) / range) * cH;

    // Zone de remplissage dégradée
    const grad = ctx.createLinearGradient(0, pT, 0, H);
    grad.addColorStop(0, color + '40');
    grad.addColorStop(1, color + '00');

    ctx.beginPath();
    ctx.moveTo(x(0), H);
    ctx.lineTo(x(0), y(weights[0]));
    for (let i = 1; i < weights.length; i++) {
      const mx = (x(i - 1) + x(i)) / 2;
      ctx.bezierCurveTo(mx, y(weights[i - 1]), mx, y(weights[i]), x(i), y(weights[i]));
    }
    ctx.lineTo(x(weights.length - 1), H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Ligne
    ctx.beginPath();
    ctx.moveTo(x(0), y(weights[0]));
    for (let i = 1; i < weights.length; i++) {
      const mx = (x(i - 1) + x(i)) / 2;
      ctx.bezierCurveTo(mx, y(weights[i - 1]), mx, y(weights[i]), x(i), y(weights[i]));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // Points
    weights.forEach((w, i) => {
      const isLast = i === weights.length - 1;
      ctx.beginPath();
      ctx.arc(x(i), y(w), isLast ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle   = isLast ? color : '#0a0a0a';
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
      ctx.fill();
      ctx.stroke();
    });

    // Valeur sur le dernier point
    const lastW = weights[weights.length - 1];
    ctx.fillStyle  = color;
    ctx.font       = `bold ${11 * dpr / dpr}px -apple-system, sans-serif`;
    ctx.textAlign  = 'right';
    ctx.fillText(`${lastW} kg`, x(weights.length - 1) - 2, y(lastW) - 8);
  });
}

// ═══════════════════════════════════════════════════════════
//  History
// ═══════════════════════════════════════════════════════════

function renderHistory() {
  const history = data.history || [];

  const grouped = {};
  history.forEach(s => {
    const key = new Date(s.date).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long' });
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(s);
  });

  const content = Object.keys(grouped).length === 0
    ? `<div class="empty-state">
         <div class="empty-state__icon">📋</div>
         <div>Aucune séance enregistrée</div>
         <div class="empty-state__sub">Termine ta première séance pour la voir ici</div>
       </div>`
    : Object.entries(grouped).map(([month, sessions]) => `
        <div class="history-month">
          <div class="history-month__label">${month}</div>
          ${sessions.map(s => {
            const totalSets = s.exercises.reduce((a, ex) => a + ex.sets.length, 0);
            return `
              <div class="history-item history-item--${s.category}">
                <div class="history-item__header">
                  <span class="history-item__cat">
                    ${CAT_ICON[s.category]} ${CAT_LABEL[s.category]}
                  </span>
                  <span class="history-item__date">${fmtDateTime(s.date)}</span>
                </div>
                <div class="history-item__summary">${s.exercises.length} exercices · ${totalSets} séries</div>
                <div class="history-item__exercises">
                  ${s.exercises.map(ex => `
                    <div class="history-ex">
                      <span class="history-ex__name">${ex.name}</span>
                      <span class="history-ex__sets">
                        ${ex.sets.map(set => `${set.weight}×${set.reps}`).join(' / ')}
                      </span>
                    </div>`).join('')}
                </div>
              </div>`;
          }).join('')}
        </div>`).join('');

  return `
    <div class="view history">
      <header class="header">
        <button class="icon-btn" data-action="back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <span class="header__title">Historique</span>
        <div style="width:40px"></div>
      </header>
      <div class="history-list">${content}</div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
//  Event handling
// ═══════════════════════════════════════════════════════════

document.addEventListener('click', e => {
  const el     = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  switch (action) {

    // ── Navigation ─────────────────────────────────────────
    case 'back': {
      if (view === 'session') {
        if (!confirm('Abandonner la séance en cours ?')) return;
        activeSession = null;
        clearRest(); restActive = false;
        releaseWakeLock();
        view = 'dashboard'; render(); startTicker();
      } else {
        view = 'dashboard'; render(); startTicker();
      }
      break;
    }
    case 'go-editor': {
      view = 'editor'; render(); break;
    }
    case 'go-history': {
      view = 'history'; render(); break;
    }
    case 'go-stats': {
      view = 'stats'; render(); break;
    }
    case 'stats-tab': {
      statsCat = el.dataset.cat; render(); break;
    }

    // ── Dashboard ──────────────────────────────────────────
    case 'start-session': {
      beep(440, .08);
      startSession(el.dataset.cat);
      break;
    }

    // ── Session ─────────────────────────────────────────────
    case 'validate-set': {
      validateSet(parseInt(el.dataset.ei), parseInt(el.dataset.si));
      break;
    }
    case 'start-rest': {
      openRest();
      break;
    }
    case 'skip-rest': {
      clearRest(); restActive = false; render(); break;
    }
    case 'set-rest': {
      const secs = parseInt(el.dataset.secs);
      clearRest(); restTimeLeft = secs; startRestCountdown();
      // just update the display
      const timerEl = $('.rest-timer');
      if (timerEl) timerEl.textContent = fmtRest(secs);
      // re-render to update active preset highlight
      render(); break;
    }
    case 'set-custom-rest': {
      const val = parseInt($('#customRest')?.value);
      if (val >= 10 && val <= 600) {
        clearRest(); restTimeLeft = val; startRestCountdown(); render();
      } else {
        showToast('Entre une durée entre 10 et 600 secondes');
      }
      break;
    }
    case 'finish-session': {
      if (!confirm('Terminer et valider la séance ?')) return;
      data.timers[activeSession.category] = Date.now();
      // Sauvegarder dans l'historique
      if (!data.history) data.history = [];
      data.history.unshift({
        id: uid(),
        category: activeSession.category,
        date: Date.now(),
        exercises: activeSession.exercises.map(ex => ({
          name: ex.name,
          sets: ex.sets.filter(s => s.done).map(s => ({ weight: s.weight, reps: s.reps })),
        })),
      });
      if (data.history.length > 200) data.history = data.history.slice(0, 200);
      save();
      finishSound();
      clearRest(); restActive = false;
      activeSession = null;
      releaseWakeLock();
      view = 'dashboard'; render(); startTicker();
      showToast('Séance enregistrée !');
      break;
    }

    // ── Editor ──────────────────────────────────────────────
    case 'editor-tab': {
      editorCat = el.dataset.cat; render(); break;
    }
    case 'move-up': {
      const i = parseInt(el.dataset.i), arr = data.exercises[editorCat];
      if (i > 0) { [arr[i-1], arr[i]] = [arr[i], arr[i-1]]; save(); render(); }
      break;
    }
    case 'move-down': {
      const i = parseInt(el.dataset.i), arr = data.exercises[editorCat];
      if (i < arr.length - 1) { [arr[i], arr[i+1]] = [arr[i+1], arr[i]]; save(); render(); }
      break;
    }
    case 'inc-sets': {
      const i = parseInt(el.dataset.i), ex = data.exercises[editorCat][i];
      ex.sets = Math.min(10, ex.sets + 1); save(); render(); break;
    }
    case 'dec-sets': {
      const i = parseInt(el.dataset.i), ex = data.exercises[editorCat][i];
      ex.sets = Math.max(1, ex.sets - 1); save(); render(); break;
    }
    case 'edit-ex': {
      editExIdx = parseInt(el.dataset.i); modalOpen = true; render();
      setTimeout(() => { const inp = $('#modalName'); if (inp) { inp.focus(); inp.select(); } }, 50);
      break;
    }
    case 'del-ex': {
      const i = parseInt(el.dataset.i);
      const name = data.exercises[editorCat][i].name;
      if (!confirm(`Supprimer "${name}" ?`)) return;
      data.exercises[editorCat].splice(i, 1); save(); render(); break;
    }
    case 'add-ex': {
      editExIdx = null; modalOpen = true; render();
      setTimeout(() => $('#modalName')?.focus(), 50);
      break;
    }
    case 'save-ex': {
      const name = $('#modalName')?.value.trim();
      const sets = parseInt($('#modalSets')?.value) || 3;
      if (!name) { showToast('Entre un nom !'); return; }
      if (editExIdx !== null) {
        data.exercises[editorCat][editExIdx].name = name;
        data.exercises[editorCat][editExIdx].sets = sets;
      } else {
        data.exercises[editorCat].push(makeExercise(name, sets));
      }
      modalOpen = false; editExIdx = null; save(); render(); break;
    }
    case 'close-modal': {
      modalOpen = false; editExIdx = null; render(); break;
    }

    // ── Data ────────────────────────────────────────────────
    case 'export': {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `ppl-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      break;
    }
    case 'import': {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json';
      inp.onchange = ev => {
        const file = ev.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = re => {
          try {
            const d = JSON.parse(re.target.result);
            if (d.exercises && d.timers) { data = d; save(); render(); showToast('Import réussi !'); }
            else showToast('Fichier invalide');
          } catch { showToast('Erreur import'); }
        };
        reader.readAsText(file);
      };
      inp.click(); break;
    }
  }
});

// Live input capture for active set fields
document.addEventListener('input', e => {
  if (!activeSession) return;
  const action = e.target.dataset.action;
  const ei = parseInt(e.target.dataset.ei);
  const si = parseInt(e.target.dataset.si);
  if (isNaN(ei) || isNaN(si)) return;
  if (action === 'set-weight') activeSession.exercises[ei].sets[si].weight = e.target.value;
  if (action === 'set-reps')   activeSession.exercises[ei].sets[si].reps   = e.target.value;
});

// ═══════════════════════════════════════════════════════════
//  Wake Lock
// ═══════════════════════════════════════════════════════════

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}

async function releaseWakeLock() {
  try { if (wakeLock) { await wakeLock.release(); wakeLock = null; } } catch {}
}

document.addEventListener('visibilitychange', async () => {
  if (wakeLock && document.visibilityState === 'visible' && view === 'session') {
    await requestWakeLock();
  }
});

// ═══════════════════════════════════════════════════════════
//  Init
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  render();
  startTicker();
});
