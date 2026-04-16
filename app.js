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
  return { id: uid(), name, sets, lastWeight: '', lastReps: '', pr: null, est1RM: null, target: null, rest: null };
}

function calc1RM(weight, reps) {
  const w = parseFloat(weight) || 0;
  const r = parseInt(reps) || 0;
  if (w <= 0 || r <= 0 || r > 12) return null;
  return Math.round(w * (1 + r / 30) * 10) / 10;
}

function fmtVolume(v) {
  if (!v) return '0 kg';
  return Math.round(v).toLocaleString('fr-FR') + ' kg';
}

function sessionVolume(exercises) {
  return exercises.reduce((total, ex) =>
    total + ex.sets.reduce((a, s) =>
      a + (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0), 0), 0);
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
let restEndTime   = 0;   // timestamp de fin (Date.now() + durée)
let restActive    = false;
let restMinimized = false;
let modalOpen     = false;
let restEditEi    = null;  // index exercice en cours d'édition du repos
let editExIdx     = null;
let statsCat      = 'push';
let addCat        = 'push';
let addDate       = new Date().toISOString().slice(0, 10);
let addSets       = {}; // { exId: [{weight, reps}] }
let editSessionId = null; // null = nouvelle séance, sinon id de la séance à modifier
let sessionNotes  = '';   // notes de la séance en cours
let addNotes      = '';   // notes du formulaire séance passée
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
  // Son (fonctionne hors silencieux sur Android, bloqué iOS silencieux)
  beep(880, .12); setTimeout(() => beep(1100, .12), 160); setTimeout(() => beep(1320, .35), 320);
  // Vibration (Android uniquement — iOS ne supporte pas navigator.vibrate)
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
  // Flash visuel — fonctionne sur tous les appareils quoi qu'il arrive
  const flash = document.createElement('div');
  flash.className = 'timer-flash';
  document.body.appendChild(flash);
  flash.addEventListener('animationend', () => flash.remove());
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
  else if (view === 'stats')       app.innerHTML = renderStats();
  else if (view === 'add-session') app.innerHTML = renderAddSession();

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
        <button class="link-btn" data-action="export">Exporter</button>
        <button class="link-btn" data-action="import">Importer</button>
        <button class="link-btn" data-action="force-update">↻ Mettre à jour</button>
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
  sessionNotes = '';
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
        const weightLabel = s.weight ? `${s.weight} kg × ` : '';
        return `
          <div class="set-row set-row--done">
            <span class="set-num">Série ${si + 1}</span>
            <span class="set-val">${weightLabel}${s.reps} reps</span>
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
            <input type="number" inputmode="decimal" class="set-input" placeholder="—"
                   value="${s.weight}" data-action="set-weight" data-ei="${ei}" data-si="${si}">
            <span class="input-unit">kg</span>
          </div>
          <div class="input-group">
            <input type="number" inputmode="numeric" class="set-input set-input--required" placeholder="0"
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

    const restSecs = ex_data?.rest ?? data.defaultRest;
    const restLabel = restSecs >= 60 ? `${restSecs / 60}min` : `${restSecs}s`;

    return `
      <div class="exercise-block ${allDone ? 'exercise-block--done' : ''}">
        <div class="exercise-header">
          <span class="exercise-name">${ex.name}</span>
          <button class="rest-badge" data-action="set-ex-rest" data-ei="${ei}" title="Modifier le repos">⏱ ${restLabel}</button>
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
      <div class="session-content">
        ${exHtml}
        <div class="session-notes-block">
          <div class="session-notes-label">Notes de séance</div>
          <textarea class="session-notes-input" data-action="session-notes"
                    placeholder="Comment s'est passée la séance ? (optionnel)">${sessionNotes}</textarea>
        </div>
      </div>
    </div>
    ${renderRestOverlay()}
    ${renderRestEditModal()}`;
}

function validateSet(ei, si) {
  const ex  = activeSession.exercises[ei];
  const s   = ex.sets[si];
  if (!s.reps) { showToast('Entre le nombre de reps !'); return; }

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
    const new1RM = calc1RM(s.weight, s.reps);
    if (new1RM && (!exData.est1RM || new1RM > exData.est1RM)) {
      exData.est1RM = new1RM;
    }
    save();
  }

  // Auto-démarrer le repos (sauf si c'est la toute dernière série de la séance)
  const allDone = activeSession.exercises.every(e => e.sets.every(s => s.done));
  if (!allDone) {
    const restSecs = exData?.rest ?? data.defaultRest;
    openRest(restSecs);
  } else {
    render();
  }

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

  // Mini barre visible quand l'overlay est réduit
  if (restMinimized) {
    const ending = restTimeLeft <= 5;
    return `
      <div class="rest-mini" data-action="expand-rest">
        <span class="rest-mini__icon">⏱</span>
        <span class="rest-mini__timer ${ending ? 'ending' : ''}">${fmtRest(restTimeLeft)}</span>
        <span class="rest-mini__label">Repos en cours — appuyer pour rouvrir</span>
        <button class="rest-mini__skip" data-action="skip-rest">✕</button>
      </div>`;
  }

  const presets = [60, 90, 120, 180];
  const ending  = restTimeLeft <= 5;

  return `
    <div class="rest-overlay">
      <div class="rest-card">
        <div class="rest-card__top">
          <div class="rest-label">Repos</div>
          <button class="rest-minimize-btn" data-action="minimize-rest">—</button>
        </div>
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
  restEndTime = Date.now() + restTimeLeft * 1000;

  restInterval = setInterval(() => {
    restTimeLeft = Math.max(0, Math.ceil((restEndTime - Date.now()) / 1000));

    if (restMinimized) {
      // Mettre à jour la mini barre sans re-render complet
      const mini = $('.rest-mini__timer');
      if (mini) {
        mini.textContent = fmtRest(restTimeLeft);
        mini.className   = `rest-mini__timer ${restTimeLeft <= 5 ? 'ending' : ''}`;
      }
    } else {
      const el = $('.rest-timer');
      if (el) {
        el.textContent = fmtRest(restTimeLeft);
        el.className   = `rest-timer ${restTimeLeft <= 5 ? 'ending' : ''}`;
      }
    }

    if (restTimeLeft <= 0) {
      clearInterval(restInterval);
      restMinimized = false;
      timerDone();
      restActive = false;
      setTimeout(() => render(), 350);
    }
  }, 500); // 500ms pour rester précis même si le tick est légèrement décalé
}

function renderRestEditModal() {
  if (restEditEi === null) return '';
  const ex  = activeSession?.exercises[restEditEi];
  const cat = activeSession?.category;
  const exData = data.exercises[cat]?.find(e => e.id === ex?.exId);
  const cur = exData?.rest ?? data.defaultRest;
  return `
    <div class="modal-overlay">
      <div class="modal" style="max-width:320px;">
        <div class="modal__title">Repos — ${ex?.name}</div>
        <label class="form-label">Durée (secondes)</label>
        <input type="number" inputmode="numeric" id="restEditInput" class="form-input"
               value="${cur}" min="10" max="600" placeholder="Ex : 90">
        <div class="modal__actions">
          <button class="btn btn--secondary" data-action="close-rest-edit">Annuler</button>
          <button class="btn btn--primary"   data-action="save-rest-edit">OK</button>
        </div>
      </div>
    </div>`;
}

function clearRest() { clearInterval(restInterval); restInterval = null; }

function openRest(secs) {
  restActive    = true;
  restMinimized = false;
  restTimeLeft  = secs ?? data.defaultRest;
  startRestCountdown();
  render();
}

// Quand l'app revient au premier plan : recalculer depuis le timestamp réel
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && restActive) {
    const remaining = Math.ceil((restEndTime - Date.now()) / 1000);
    if (remaining <= 0) {
      // Le chrono a expiré pendant qu'on était en arrière-plan
      clearInterval(restInterval);
      restTimeLeft = 0;
      restActive   = false;
      timerDone();
      setTimeout(() => render(), 350);
    } else {
      restTimeLeft = remaining;
      // Relancer l'interval (il peut avoir été throttlé)
      startRestCountdown();
    }
  }
});

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
        <label class="form-label">Temps de repos (secondes) — optionnel</label>
        <input type="number" inputmode="numeric" id="modalRest" class="form-input"
               value="${ex?.rest || ''}" placeholder="Défaut : ${data.defaultRest}s">
        <label class="form-label">Objectif poids (kg) — optionnel</label>
        <input type="number" inputmode="decimal" id="modalTarget" class="form-input"
               value="${ex?.target || ''}" placeholder="Ex : 40">
        <div class="modal__actions">
          <button class="btn btn--secondary" data-action="close-modal">Annuler</button>
          <button class="btn btn--primary"   data-action="save-ex">${isEdit ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
//  Ajout séance passée
// ═══════════════════════════════════════════════════════════

function initAddSets(cat) {
  addSets = {};
  (data.exercises[cat] || []).forEach(ex => {
    addSets[ex.id] = Array.from({ length: ex.sets }, () => ({
      weight: ex.lastWeight || '',
      reps:   ex.lastReps   || '',
    }));
  });
}

function renderAddSession() {
  const exercises = data.exercises[addCat] || [];
  const today     = new Date().toISOString().slice(0, 10);

  const catBtns = ['push', 'pull', 'legs'].map(c => `
    <button class="cat-sel-btn ${addCat === c ? `cat-sel-btn--active cat-sel-btn--${c}` : ''}"
            data-action="add-cat" data-cat="${c}">
      ${CAT_ICON[c]} ${CAT_LABEL[c]}
    </button>`).join('');

  const exHtml = exercises.map(ex => {
    const sets = addSets[ex.id] || [];
    const setsHtml = sets.map((s, si) => `
      <div class="set-row set-row--active">
        <span class="set-num">S${si + 1}</span>
        <div class="input-group">
          <input type="number" inputmode="decimal" class="set-input" placeholder="—"
                 value="${s.weight}"
                 data-action="add-weight" data-exid="${ex.id}" data-si="${si}">
          <span class="input-unit">kg</span>
        </div>
        <div class="input-group">
          <input type="number" inputmode="numeric" class="set-input set-input--required" placeholder="0"
                 value="${s.reps}"
                 data-action="add-reps" data-exid="${ex.id}" data-si="${si}">
          <span class="input-unit">reps</span>
        </div>
      </div>`).join('');

    return `
      <div class="exercise-block">
        <div class="exercise-header">
          <span class="exercise-name">${ex.name}</span>
          <div style="display:flex;gap:6px">
            <button class="sets-adj" data-action="add-set-row" data-exid="${ex.id}">+</button>
            <button class="sets-adj" data-action="rem-set-row" data-exid="${ex.id}"
                    ${sets.length <= 1 ? 'disabled' : ''} style="opacity:${sets.length <= 1 ? .3 : 1}">−</button>
          </div>
        </div>
        ${setsHtml}
      </div>`;
  }).join('');

  return `
    <div class="view add-session">
      <header class="header">
        <button class="icon-btn" data-action="back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <span class="header__title">${editSessionId ? 'Modifier la séance' : 'Séance passée'}</span>
        <button class="btn--finish" data-action="save-past-session">Enregistrer</button>
      </header>
      <div class="add-session-meta">
        <div class="cat-selector">${catBtns}</div>
        <div class="date-row">
          <label class="date-label">Date de la séance</label>
          <input type="date" id="addDate" class="date-input"
                 value="${addDate}" max="${today}" data-action="add-date">
        </div>
      </div>
      <div class="add-session-content">
        ${exHtml}
        <div class="session-notes-block">
          <div class="session-notes-label">Notes</div>
          <textarea class="session-notes-input" data-action="add-notes-input"
                    placeholder="Comment s'est passée la séance ? (optionnel)">${addNotes}</textarea>
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
    const points = history
      .filter(s => s.category === statsCat)
      .map(s => {
        const found = s.exercises.find(e => e.name === ex.name);
        if (!found || !found.sets.length) return null;
        const wts = found.sets.map(s => parseFloat(s.weight) || 0);
        const rps = found.sets.map(s => parseInt(s.reps)    || 0).filter(r => r > 0);
        if (!rps.length) return null;
        const hasWeight = wts.some(w => w > 0);
        const avgW = hasWeight
          ? Math.round((wts.filter(w => w > 0).reduce((a, b) => a + b, 0) / wts.filter(w => w > 0).length) * 10) / 10
          : 0;
        const avgR = Math.round(rps.reduce((a, b) => a + b, 0) / rps.length);
        return {
          date: s.date,
          sets: found.sets,
          avgW, avgR,
          minW: hasWeight ? Math.min(...wts.filter(w => w > 0)) : 0,
          maxW: hasWeight ? Math.max(...wts) : 0,
          bodyweight: !hasWeight,
        };
      })
      .filter(Boolean)
      .reverse(); // ordre chronologique

    if (points.length === 0) return `
      <div class="stats-card">
        <div class="stats-card__name">${ex.name}</div>
        <div class="stats-card__empty">Pas encore effectué</div>
      </div>`;

    const last       = points[points.length - 1];
    const isBodyweight = points.every(p => p.bodyweight);
    const prW        = isBodyweight ? Math.max(...points.map(p => p.avgR)) : Math.max(...points.map(p => p.maxW));
    const compareVal = isBodyweight ? (p => p.avgR) : (p => p.avgW);
    const progPct    = compareVal(points[0]) > 0
      ? Math.round(((compareVal(last) - compareVal(points[0])) / compareVal(points[0])) * 100) : 0;
    const progLabel  = progPct > 0 ? `+${progPct}%` : progPct < 0 ? `${progPct}%` : '—';
    const progColor  = progPct > 0 ? '#22c55e' : progPct < 0 ? '#ef4444' : 'var(--muted)';

    // Affichage des séries de la dernière séance
    const lastSets = last.sets
      .filter(s => s.reps)
      .map((s, i) => {
        const w = s.weight ? `${s.weight} kg × ` : '';
        return `<span class="last-set">S${i+1} : ${w}${s.reps} reps</span>`;
      }).join('');

    const encoded = encodeURIComponent(JSON.stringify(
      points.map(p => ({ date: p.date, avgW: p.avgW, avgR: p.avgR, minW: p.minW, maxW: p.maxW, bodyweight: p.bodyweight, sets: p.sets }))
    ));

    return `
      <div class="stats-card">
        <div class="stats-card__header">
          <span class="stats-card__name">${ex.name}</span>
          <div class="stats-card__current-block">
            ${isBodyweight
              ? `<span class="stats-card__current">${last.avgR} reps</span>
                 <span class="stats-card__avgreps">Poids du corps</span>`
              : `<span class="stats-card__current">${last.avgW} kg</span>
                 <span class="stats-card__avgreps">~${last.avgR} reps</span>`}
          </div>
        </div>
        ${lastSets ? `<div class="last-sets">${lastSets}</div>` : ''}
        <canvas class="stats-canvas" data-points="${encoded}" data-color="${color}"></canvas>
        ${(() => {
          const exData = data.exercises[statsCat]?.find(e => e.name === ex.name);
          const vol = Math.round(points.reduce((a, p) => a + p.sets.reduce((b, s) => b + (parseFloat(s.weight)||0)*(parseInt(s.reps)||0), 0), 0) / points.length);
          const targetW = exData?.target;
          const e1RM = exData?.est1RM;
          const targetBar = (targetW && !isBodyweight) ? (() => {
            const pct = Math.min(100, Math.round((last.maxW / targetW) * 100));
            const color2 = pct >= 100 ? '#22c55e' : progColor;
            return `<div class="target-block">
              <div class="target-label">Objectif : ${targetW} kg <span style="color:${color2}">${pct >= 100 ? '✓ Atteint !' : pct + '%'}</span></div>
              <div class="target-bar"><div class="target-bar__fill" style="width:${pct}%;background:${color2}"></div></div>
            </div>`;
          })() : '';
          return `
            ${targetBar}
            <div class="stats-card__footer">
              <span>PR : <strong>${prW}${isBodyweight ? ' reps' : ' kg'}</strong></span>
              ${e1RM && !isBodyweight ? `<span>1RM ~<strong>${e1RM} kg</strong></span>` : ''}
              <span style="color:${progColor};font-weight:700">${progLabel}</span>
              <span>${points.length} séance${points.length > 1 ? 's' : ''}</span>
            </div>
            ${vol > 0 ? `<div class="stats-volume">Volume moy/séance : ${fmtVolume(vol)}</div>` : ''}`;
        })()}
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
    const points = JSON.parse(decodeURIComponent(canvas.dataset.points));
    const color  = canvas.dataset.color;

    const W   = canvas.parentElement.clientWidth - 32;
    const H   = 110;
    const dpr = window.devicePixelRatio || 1;

    canvas.width        = W * dpr;
    canvas.height       = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    if (!points.length) return;

    const isBodyweight = points.every(p => p.bodyweight);
    const avgs = points.map(p => isBodyweight ? p.avgR : p.avgW);
    const mins = points.map(p => isBodyweight ? p.avgR : p.minW);
    const maxs = points.map(p => isBodyweight ? p.avgR : p.maxW);

    const dataMin = Math.min(...mins) * 0.92;
    const dataMax = Math.max(...maxs) * 1.08;
    const range   = (dataMax - dataMin) || 1;

    // Marges : plus de bas pour les dates
    const pT = 12, pB = 24, pL = 6, pR = 6;
    const cW = W - pL - pR;
    const cH = H - pT - pB;

    const xp = i => pL + (points.length === 1 ? cW / 2 : (i / (points.length - 1)) * cW);
    const yp = w => pT + cH - ((w - dataMin) / range) * cH;

    // ── Bande min/max ──────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(xp(0), yp(mins[0]));
    for (let i = 1; i < points.length; i++) {
      const mx = (xp(i-1) + xp(i)) / 2;
      ctx.bezierCurveTo(mx, yp(mins[i-1]), mx, yp(mins[i]), xp(i), yp(mins[i]));
    }
    for (let i = points.length - 1; i >= 0; i--) {
      const mx = i > 0 ? (xp(i-1) + xp(i)) / 2 : xp(i);
      if (i === points.length - 1) ctx.lineTo(xp(i), yp(maxs[i]));
      else ctx.bezierCurveTo(mx + (xp(i+1)-xp(i))/2, yp(maxs[i+1]), mx, yp(maxs[i]), xp(i), yp(maxs[i]));
    }
    ctx.closePath();
    ctx.fillStyle = color + '18';
    ctx.fill();

    // ── Zone dégradée sous la moyenne ─────────────────────
    const grad = ctx.createLinearGradient(0, pT, 0, pT + cH);
    grad.addColorStop(0, color + '35');
    grad.addColorStop(1, color + '00');

    ctx.beginPath();
    ctx.moveTo(xp(0), pT + cH);
    ctx.lineTo(xp(0), yp(avgs[0]));
    for (let i = 1; i < avgs.length; i++) {
      const mx = (xp(i-1) + xp(i)) / 2;
      ctx.bezierCurveTo(mx, yp(avgs[i-1]), mx, yp(avgs[i]), xp(i), yp(avgs[i]));
    }
    ctx.lineTo(xp(avgs.length - 1), pT + cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // ── Ligne moyenne ──────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(xp(0), yp(avgs[0]));
    for (let i = 1; i < avgs.length; i++) {
      const mx = (xp(i-1) + xp(i)) / 2;
      ctx.bezierCurveTo(mx, yp(avgs[i-1]), mx, yp(avgs[i]), xp(i), yp(avgs[i]));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // ── Points ─────────────────────────────────────────────
    avgs.forEach((w, i) => {
      const isLast = i === avgs.length - 1;
      ctx.beginPath();
      ctx.arc(xp(i), yp(w), isLast ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle   = isLast ? color : '#141414';
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
      ctx.fill();
      ctx.stroke();
    });

    // ── Valeur du dernier point ────────────────────────────
    const li = avgs.length - 1;
    ctx.fillStyle = color;
    ctx.font      = 'bold 11px -apple-system, sans-serif';
    ctx.textAlign = xp(li) > W - 40 ? 'right' : 'left';
    const labelX  = xp(li) + (xp(li) > W - 40 ? -8 : 8);
    const unit = isBodyweight ? ' reps' : ' kg';
    ctx.fillText(`${avgs[li]}${unit}`, labelX, yp(avgs[li]) - 6);

    // ── Labels de dates sur l'axe X ───────────────────────
    ctx.fillStyle = '#555';
    ctx.font      = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';

    // Max 5 dates pour éviter les chevauchements
    const n       = points.length;
    const indices = new Set([0, n - 1]);
    if (n > 2) {
      const step = Math.ceil((n - 1) / 4);
      for (let i = step; i < n - 1; i += step) indices.add(i);
    }

    indices.forEach(i => {
      const d     = new Date(points[i].date);
      const label = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '');
      // Eviter que le premier et dernier se chevauchent sur les bords
      const tx = Math.max(20, Math.min(W - 20, xp(i)));
      ctx.fillText(label, tx, H - 5);
    });
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
                  <div style="display:flex;align-items:center;gap:8px">
                    <span class="history-item__date">${fmtDateTime(s.date)}</span>
                    <button class="history-edit-btn" data-action="edit-session" data-id="${s.id}" title="Modifier">✏️</button>
                    <button class="history-edit-btn history-edit-btn--del" data-action="delete-session" data-id="${s.id}" title="Supprimer">🗑️</button>
                  </div>
                </div>
                <div class="history-item__summary">
                  ${s.exercises.length} exercices · ${totalSets} séries
                  ${sessionVolume(s.exercises) > 0 ? ` · <strong>${fmtVolume(sessionVolume(s.exercises))}</strong> volume` : ''}
                </div>
                ${s.notes ? `<div class="history-notes">"${s.notes}"</div>` : ''}
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
        <button class="icon-btn" data-action="go-add-session" title="Ajouter une séance passée">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
        </button>
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
    case 'go-add-session': {
      addCat        = 'push';
      addDate       = new Date().toISOString().slice(0, 10);
      editSessionId = null;
      addNotes      = '';
      initAddSets(addCat);
      view = 'add-session'; render(); break;
    }
    case 'edit-session': {
      const session = (data.history || []).find(h => h.id === el.dataset.id);
      if (!session) break;
      editSessionId = session.id;
      addCat  = session.category;
      addDate = new Date(session.date).toISOString().slice(0, 10);
      // Pré-remplir addSets avec les données de la séance
      initAddSets(addCat);
      session.exercises.forEach(ex => {
        const exData = data.exercises[addCat]?.find(e => e.name === ex.name);
        if (exData) {
          addSets[exData.id] = ex.sets.map(s => ({ weight: s.weight, reps: s.reps }));
        }
      });
      addNotes = session.notes || '';
      view = 'add-session'; render(); break;
    }
    case 'delete-session': {
      if (!confirm('Supprimer cette séance ?')) break;
      data.history = (data.history || []).filter(h => h.id !== el.dataset.id);
      syncTimersFromHistory();
      save(); render(); break;
    }
    case 'force-update': {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(regs => {
          Promise.all(regs.map(r => r.unregister())).then(() => {
            window.location.reload(true);
          });
        });
      } else {
        window.location.reload(true);
      }
      break;
    }
    case 'add-cat': {
      addCat = el.dataset.cat;
      initAddSets(addCat);
      render(); break;
    }
    case 'add-date': {
      addDate = el.value; break;
    }
    case 'add-set-row': {
      const exid = el.dataset.exid;
      if (!addSets[exid]) addSets[exid] = [];
      addSets[exid].push({ weight: '', reps: '' });
      render(); break;
    }
    case 'rem-set-row': {
      const exid = el.dataset.exid;
      if (addSets[exid]?.length > 1) addSets[exid].pop();
      render(); break;
    }
    case 'save-past-session': {
      // Lire la date depuis le champ (au cas où l'input n'a pas déclenché l'event)
      const dateEl  = $('#addDate');
      if (dateEl) addDate = dateEl.value;
      const notesEl2 = $('.session-notes-input');
      if (notesEl2) addNotes = notesEl2.value;

      const sessionExercises = (data.exercises[addCat] || [])
        .map(ex => {
          const sets = (addSets[ex.id] || []).filter(s => s.reps);
          if (!sets.length) return null;
          return { name: ex.name, sets };
        })
        .filter(Boolean);

      if (!sessionExercises.length) {
        showToast('Entre au moins un exercice avec poids et reps !');
        return;
      }

      const [y, m, d] = addDate.split('-').map(Number);
      const timestamp = new Date(y, m - 1, d, 12, 0, 0).getTime();

      if (!data.history) data.history = [];
      if (editSessionId) {
        // Modifier la séance existante
        const idx = data.history.findIndex(h => h.id === editSessionId);
        if (idx !== -1) data.history[idx] = { id: editSessionId, category: addCat, date: timestamp, exercises: sessionExercises };
      } else {
        // Nouvelle séance
        data.history.push({ id: uid(), category: addCat, date: timestamp, notes: addNotes.trim(), exercises: sessionExercises });
      addNotes = '';
      }
      data.history.sort((a, b) => b.date - a.date);
      editSessionId = null;

      // Mettre à jour le timer 72h avec la séance la plus récente pour cette catégorie
      const latestForCat = data.history
        .filter(h => h.category === addCat)
        .reduce((best, h) => h.date > (best?.date || 0) ? h : best, null);
      if (latestForCat) data.timers[addCat] = latestForCat.date;

      save();

      showToast('Séance ajoutée !');
      view = 'history'; render(); startTicker(); break;
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
      const eiRest = el.dataset.ei !== undefined ? parseInt(el.dataset.ei) : null;
      if (eiRest !== null) {
        const cat    = activeSession.category;
        const exData = data.exercises[cat]?.find(e => e.id === activeSession.exercises[eiRest]?.exId);
        openRest(exData?.rest ?? data.defaultRest);
      } else {
        openRest();
      }
      break;
    }
    case 'set-ex-rest': {
      restEditEi = parseInt(el.dataset.ei);
      render();
      setTimeout(() => { $('#restEditInput')?.focus(); $('#restEditInput')?.select(); }, 50);
      break;
    }
    case 'close-rest-edit': {
      restEditEi = null; render();
      break;
    }
    case 'save-rest-edit': {
      const secs = parseInt($('#restEditInput')?.value);
      if (secs >= 10 && secs <= 600) {
        const ex     = activeSession.exercises[restEditEi];
        const cat    = activeSession.category;
        const exData = data.exercises[cat]?.find(e => e.id === ex?.exId);
        if (exData) { exData.rest = secs; save(); showToast(`Repos ${secs}s enregistré`); }
      }
      restEditEi = null; render();
      break;
    }
    case 'skip-rest': {
      clearRest(); restActive = false; restMinimized = false; render(); break;
    }
    case 'minimize-rest': {
      restMinimized = true; render(); break;
    }
    case 'expand-rest': {
      if (e.target.closest('[data-action="skip-rest"]')) break;
      restMinimized = false; render(); break;
    }
    case 'set-rest': {
      const secs = parseInt(el.dataset.secs);
      clearRest(); restTimeLeft = secs; restEndTime = Date.now() + secs * 1000; startRestCountdown();
      // just update the display
      const timerEl = $('.rest-timer');
      if (timerEl) timerEl.textContent = fmtRest(secs);
      // re-render to update active preset highlight
      render(); break;
    }
    case 'set-custom-rest': {
      const val = parseInt($('#customRest')?.value);
      if (val >= 10 && val <= 600) {
        clearRest(); restTimeLeft = val; restEndTime = Date.now() + val * 1000; startRestCountdown(); render();
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
      const notesEl = $('.session-notes-input');
      if (notesEl) sessionNotes = notesEl.value;
      data.history.unshift({
        id: uid(),
        category: activeSession.category,
        date: Date.now(),
        notes: sessionNotes.trim(),
        exercises: activeSession.exercises.map(ex => ({
          name: ex.name,
          sets: ex.sets.filter(s => s.done).map(s => ({ weight: s.weight, reps: s.reps })),
        })),
      });
      sessionNotes = '';
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
      const target = parseFloat($('#modalTarget')?.value) || null;
      const rest   = parseInt($('#modalRest')?.value)    || null;
      if (editExIdx !== null) {
        data.exercises[editorCat][editExIdx].name   = name;
        data.exercises[editorCat][editExIdx].sets   = sets;
        data.exercises[editorCat][editExIdx].target = target;
        data.exercises[editorCat][editExIdx].rest   = rest;
      } else {
        const ex = makeExercise(name, sets);
        ex.target = target;
        ex.rest   = rest;
        data.exercises[editorCat].push(ex);
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

// Live input capture
document.addEventListener('input', e => {
  const action = e.target.dataset.action;

  // Session en cours
  if (activeSession) {
    const ei = parseInt(e.target.dataset.ei);
    const si = parseInt(e.target.dataset.si);
    if (!isNaN(ei) && !isNaN(si)) {
      if (action === 'set-weight') activeSession.exercises[ei].sets[si].weight = e.target.value;
      if (action === 'set-reps')   activeSession.exercises[ei].sets[si].reps   = e.target.value;
    }
  }

  // Formulaire séance passée
  if (view === 'add-session') {
    const exid = e.target.dataset.exid;
    const si   = parseInt(e.target.dataset.si);
    if (exid && !isNaN(si) && addSets[exid]) {
      if (action === 'add-weight') addSets[exid][si].weight = e.target.value;
      if (action === 'add-reps')   addSets[exid][si].reps   = e.target.value;
    }
    if (action === 'add-date')        addDate  = e.target.value;
    if (action === 'add-notes-input') addNotes = e.target.value;
  }
  if (action === 'session-notes') sessionNotes = e.target.value;
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
  // Synchroniser les timers 72h avec la séance la plus récente dans l'historique
  syncTimersFromHistory();
  render();
  startTicker();
});

function syncTimersFromHistory() {
  const history = data.history || [];
  ['push', 'pull', 'legs'].forEach(cat => {
    const latest = history
      .filter(h => h.category === cat)
      .reduce((best, h) => h.date > (best?.date || 0) ? h : best, null);
    if (latest && latest.date > (data.timers[cat] || 0)) {
      data.timers[cat] = latest.date;
    }
  });
  save();
}
