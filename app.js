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
//  Programme definitions
// ═══════════════════════════════════════════════════════════

const PROGRAMMES = {
  ppl: {
    name: 'PPL', desc: 'Push · Pull · Legs', icon: '🔄',
    sessions: {
      push: { label: 'Push', icon: '💪', desc: 'Pectoraux · Épaules · Triceps', color: '#ef4444' },
      pull: { label: 'Pull', icon: '🦾', desc: 'Dos · Biceps · Trapèzes',       color: '#3b82f6' },
      legs: { label: 'Legs', icon: '🦵', desc: 'Quadriceps · Ischio · Mollets', color: '#22c55e' },
    },
    defaults: {
      push: [['Développé couché haltères',4],['Développé incliné haltères',3],['Écarté haltères plat',3],['Développé militaire haltères',4],['Élévations latérales',4],['Extension triceps poulie',3]],
      pull: [['Rowing haltère unilatéral',4],['Tirage vertical prise large',4],['Tirage horizontal câble',3],['Curl biceps haltères',3],['Curl marteau',3]],
      legs: [['Squat barre',4],['Presse à cuisses',4],['Fentes marchées haltères',3],['Leg curl machine',3],['Extension quadriceps',3],['Mollets debout',4]],
    },
  },
  upper_lower: {
    name: 'Upper / Lower', desc: 'Haut · Bas du corps', icon: '⬆️',
    sessions: {
      upper: { label: 'Upper', icon: '💪', desc: 'Pecs · Dos · Épaules · Bras',              color: '#f59e0b' },
      lower: { label: 'Lower', icon: '🦵', desc: 'Quadriceps · Ischio · Mollets · Fessiers', color: '#8b5cf6' },
    },
    defaults: {
      upper: [['Développé couché haltères',4],['Tirage vertical prise large',4],['Rowing haltère unilatéral',3],['Développé militaire haltères',3],['Curl biceps haltères',3],['Extension triceps poulie',3]],
      lower: [['Squat barre',4],['Presse à cuisses',4],['Fentes marchées haltères',3],['Leg curl machine',3],['Extension quadriceps',3],['Mollets debout',4]],
    },
  },
  fullbody: {
    name: 'Full Body', desc: 'Corps entier · 3×/semaine', icon: '🏋️',
    sessions: {
      fullbody: { label: 'Full Body', icon: '🏋️', desc: 'Corps entier', color: '#06b6d4' },
    },
    defaults: {
      fullbody: [['Squat barre',3],['Développé couché haltères',3],['Rowing haltère unilatéral',3],['Développé militaire haltères',3],['Curl biceps haltères',3],['Extension triceps poulie',3],['Mollets debout',3]],
    },
  },
  bro: {
    name: 'Bro Split', desc: 'Chest · Back · Shoulders · Arms · Legs', icon: '💪',
    sessions: {
      chest:     { label: 'Chest',     icon: '💪', desc: 'Pectoraux',           color: '#ef4444' },
      back:      { label: 'Back',      icon: '🦾', desc: 'Dos · Trapèzes',       color: '#3b82f6' },
      shoulders: { label: 'Shoulders', icon: '🏔️', desc: 'Épaules',             color: '#f59e0b' },
      arms:      { label: 'Arms',      icon: '🦾', desc: 'Biceps · Triceps',    color: '#a855f7' },
      legs:      { label: 'Legs',      icon: '🦵', desc: 'Quadriceps · Ischio', color: '#22c55e' },
    },
    defaults: {
      chest:     [['Développé couché haltères',4],['Développé incliné haltères',4],['Écarté haltères plat',3],['Dips',3]],
      back:      [['Pull-ups',4],['Tirage vertical prise large',4],['Rowing barre',4],['Rowing haltère unilatéral',3]],
      shoulders: [['Développé militaire haltères',4],['Élévations latérales',4],['Élévations frontales',3],['Oiseau (élévations arrière)',3]],
      arms:      [['Curl biceps haltères',4],['Curl marteau',3],['Extension triceps poulie',4],['Extension triceps unilatéral',3]],
      legs:      [['Squat barre',4],['Presse à cuisses',4],['Fentes marchées haltères',3],['Leg curl machine',3],['Extension quadriceps',3],['Mollets debout',4]],
    },
  },
  arnold: {
    name: 'Arnold Split', desc: 'Pecs+Dos · Épaules+Bras · Jambes', icon: '🏆',
    sessions: {
      chest_back:     { label: 'Chest & Back',     icon: '💪', desc: 'Pectoraux · Dos',              color: '#ef4444' },
      shoulders_arms: { label: 'Shoulders & Arms', icon: '🤙', desc: 'Épaules · Biceps · Triceps',   color: '#f97316' },
      legs:           { label: 'Legs',             icon: '🦵', desc: 'Quadriceps · Ischio · Mollets', color: '#22c55e' },
    },
    defaults: {
      chest_back:     [['Développé couché haltères',4],['Écarté haltères plat',3],['Tirage vertical prise large',4],['Rowing haltère unilatéral',4],['Pull-ups',3]],
      shoulders_arms: [['Développé militaire haltères',4],['Élévations latérales',4],['Curl biceps haltères',3],['Curl marteau',3],['Extension triceps poulie',3]],
      legs:           [['Squat barre',4],['Presse à cuisses',4],['Fentes marchées haltères',3],['Leg curl machine',3],['Mollets debout',4]],
    },
  },
  custom: {
    name: 'Perso', desc: 'Séances personnalisées', icon: '✏️',
    sessions: {}, defaults: {},
  },
};

// ═══════════════════════════════════════════════════════════
//  Data helpers
// ═══════════════════════════════════════════════════════════

function makeExercise(name, sets) {
  return { id: uid(), name, sets, lastWeight: '', lastReps: '', pr: null, est1RM: null, target: null, rest: null };
}

function calc1RM(weight, reps) {
  const w = parseFloat(weight) || 0;
  const r = parseInt(reps) || 0;
  if (w <= 0 || r <= 0 || r > 12) return null;
  return Math.round(w * (1 + r / 30) * 10) / 10;
}


function sessionVolume(exercises) {
  return exercises.reduce((total, ex) =>
    total + ex.sets.reduce((a, s) =>
      a + (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0), 0), 0);
}

function makeProgData(progId) {
  const pm = PROGRAMMES[progId];
  if (!pm || progId === 'custom') return { exercises: {}, timers: {}, cooldowns: {} };
  const exercises = {}, timers = {}, cooldowns = {};
  Object.keys(pm.sessions).forEach(cat => {
    timers[cat]    = null;
    cooldowns[cat] = 72;
    exercises[cat] = (pm.defaults[cat] || []).map(([name, sets]) => makeExercise(name, sets));
  });
  return { exercises, timers, cooldowns };
}

const KEY = 'ppl_v2';

function makeDefaultData() {
  return {
    activeProgramme: 'ppl',
    programmes: { ppl: makeProgData('ppl') },
    customSessions: {},
    defaultRest: 90,
    unit: 'kg',
    soundOn: true,
    vibrateOn: true,
    history: [],
  };
}

function loadData() {
  // New key
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (!d.activeProgramme) d.activeProgramme = 'ppl';
      if (!d.programmes)      d.programmes = {};
      if (!d.programmes.ppl)  d.programmes.ppl = makeProgData('ppl');
      if (!d.customSessions)  d.customSessions = {};
      if (!d.defaultRest)     d.defaultRest = 90;
      if (!d.unit)            d.unit = 'kg';
      if (d.soundOn   == null) d.soundOn   = true;
      if (d.vibrateOn == null) d.vibrateOn = true;
      if (!d.history)         d.history = [];
      // Ensure per-programme cooldowns exist (migration)
      Object.values(d.programmes || {}).forEach(p => { if (!p.cooldowns) p.cooldowns = {}; });
      return d;
    }
  } catch {}

  // Migrate from ppl_v1
  try {
    const raw = localStorage.getItem('ppl_v1');
    if (raw) {
      const old = JSON.parse(raw);
      if (old.exercises) {
        const d = makeDefaultData();
        d.programmes.ppl.exercises = old.exercises;
        d.programmes.ppl.timers   = old.timers || { push: null, pull: null, legs: null };
        d.defaultRest = old.defaultRest || 90;
        d.history     = (old.history || []).map(h => ({ ...h, programme: 'ppl' }));
        return d;
      }
    }
  } catch {}

  return makeDefaultData();
}

function save() { localStorage.setItem(KEY, JSON.stringify(data)); }

// ═══════════════════════════════════════════════════════════
//  Accessors
// ═══════════════════════════════════════════════════════════

function prog() {
  if (!data.programmes[data.activeProgramme]) {
    data.programmes[data.activeProgramme] = { exercises: {}, timers: {}, cooldowns: {} };
  }
  const p = data.programmes[data.activeProgramme];
  if (!p.cooldowns) p.cooldowns = {};
  return p;
}

function getCooldown(cat) {
  return prog().cooldowns[cat] ?? 72;
}

function progMeta(id) {
  return PROGRAMMES[id || data.activeProgramme] || PROGRAMMES.ppl;
}

function sessionKeys(progId) {
  progId = progId || data.activeProgramme;
  if (progId === 'custom') return Object.keys(data.customSessions || {});
  return Object.keys(PROGRAMMES[progId]?.sessions || {});
}

function sessionMeta(cat, progId) {
  progId = progId || data.activeProgramme;
  if (progId === 'custom') return data.customSessions[cat] || { label: cat, icon: '🏋️', desc: '', color: '#666666' };
  return PROGRAMMES[progId]?.sessions[cat] || { label: cat, icon: '🏋️', desc: '', color: '#666666' };
}

function firstSession() {
  return sessionKeys()[0] || '';
}

// ISO week key "YYYY-Www" for a timestamp
function isoWeek(ts) {
  const d = new Date(ts);
  const day = d.getDay() || 7; // Mon=1 … Sun=7
  d.setDate(d.getDate() + 4 - day); // nearest Thursday
  const year = d.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const week = Math.ceil(((d - startOfYear) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function computeStreak() {
  const history = data.history || [];
  if (!history.length) return 0;
  const weekCounts = {};
  history.forEach(h => { const k = isoWeek(h.date); weekCounts[k] = (weekCounts[k] || 0) + 1; });
  const activeWeeks = new Set(Object.keys(weekCounts).filter(k => weekCounts[k] >= 2));
  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 104; i++) {
    const ts = now.getTime() - i * 7 * 86400000;
    const key = isoWeek(ts);
    if (activeWeeks.has(key)) {
      streak++;
    } else if (i === 0) {
      // current week not yet active — don't break streak, just skip
    } else {
      break;
    }
  }
  return streak;
}

// Volume = Σ (weight × reps) for a list of sets [{weight, reps}]
function setsVolume(sets) {
  return (sets || []).reduce((a, s) => a + (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0), 0);
}

const KG_TO_LBS = 2.20462;
function unitLbl() { return data.unit === 'lbs' ? 'lbs' : 'kg'; }

// kg stored → display string (no unit suffix)
function dispW(kg) {
  if (kg === '' || kg == null) return '';
  const v = parseFloat(kg);
  if (isNaN(v)) return '';
  if (data.unit === 'lbs') return String(Math.round(v * KG_TO_LBS * 10) / 10);
  return String(kg);
}

// display input → kg stored string
function storeW(val) {
  if (val === '' || val == null) return '';
  const v = parseFloat(val);
  if (isNaN(v)) return '';
  if (data.unit === 'lbs') return String(Math.round(v / KG_TO_LBS * 10) / 10);
  return String(val);
}

function fmtVolume(kg) {
  if (kg === 0) return `0 ${unitLbl()}`;
  if (data.unit === 'lbs') {
    const lbs = kg * KG_TO_LBS;
    return lbs >= 1000 ? (lbs / 1000).toFixed(1) + ' k lbs' : Math.round(lbs) + ' lbs';
  }
  return kg >= 1000 ? (kg / 1000).toFixed(1).replace('.', ',') + ' t' : Math.round(kg) + ' kg';
}

function historyColor(h) {
  const progId = h.programme || 'ppl';
  return sessionMeta(h.category, progId).color || '#666';
}

// ═══════════════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════════════

// ── Theme ────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
  localStorage.setItem('ppl_theme', theme);
}
applyTheme(localStorage.getItem('ppl_theme') || 'dark');

let data          = loadData();
let view          = 'dashboard';
let editorCat     = firstSession();
let activeSession = null;
let ticker        = null;
let restInterval  = null;
let restTimeLeft  = 0;
let restEndTime   = 0;
let restActive    = false;
let restMinimized = false;
let modalOpen     = false;
let restEditEi    = null;
let editExIdx     = null;
let statsCat      = firstSession();
let statsMode     = 'volume';   // 'volume' | 'charge' | '1rm'
let statsView     = 'progress'; // 'progress' | 'overview'
let statsYear     = new Date().getFullYear();
let statsMonth    = null;       // null = vue annuelle
let addCat        = firstSession();
let addDate       = new Date().toISOString().slice(0, 10);
let addSets       = {};
let editSessionId = null;
let sessionNotes  = '';
let addNotes      = '';
let addExModal    = false;
let addExName     = '';
let addExSets     = 3;
let audioCtx      = null;
let wakeLock      = null;
let csModal       = false;  // custom session modal
let csEditId      = null;   // id being edited, null = new
let csColor       = '#3b82f6';

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
  if (data.soundOn !== false) { beep(880, .12); setTimeout(() => beep(1100, .12), 160); setTimeout(() => beep(1320, .35), 320); }
  if (data.vibrateOn !== false && navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
  const flash = document.createElement('div');
  flash.className = 'timer-flash';
  document.body.appendChild(flash);
  flash.addEventListener('animationend', () => flash.remove());
}

function validationSound() { if (data.soundOn !== false) beep(660, .1); }
function finishSound()     { if (data.soundOn !== false) { beep(880, .1); setTimeout(() => beep(1320, .25), 160); } }

// ═══════════════════════════════════════════════════════════
//  Render dispatcher
// ═══════════════════════════════════════════════════════════

function render() {
  const app = $('#app');
  const prev = $('.session-content');
  const scrollTop = prev ? prev.scrollTop : 0;

  if      (view === 'dashboard')   app.innerHTML = renderDashboard();
  else if (view === 'programmes')  app.innerHTML = renderProgrammes();
  else if (view === 'session')     app.innerHTML = renderSession();
  else if (view === 'editor')      app.innerHTML = renderEditor();
  else if (view === 'history')     app.innerHTML = renderHistory();
  else if (view === 'stats')       app.innerHTML = renderStats();
  else if (view === 'settings')    app.innerHTML = renderSettings();
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

function renderDashboard() {
  const keys = sessionKeys();
  const pm   = progMeta();

  // Compute session order: rank sessions by last completion timestamp (most recent = rank 1)
  const doneKeys = keys.filter(k => prog().timers[k]).sort((a, b) => prog().timers[b] - prog().timers[a]);
  const orderLabels = ['Dernière', '2e', '3e', '4e', '5e', '6e'];

  const cards = keys.map(cat => {
    const meta      = sessionMeta(cat);
    const last      = prog().timers[cat];
    const deadline  = last ? last + getCooldown(cat) * 3600_000 : 0;
    const remaining = deadline - Date.now();
    const ready     = !last || remaining <= 0;
    const exCount   = (prog().exercises[cat] || []).length;
    const totalSets = (prog().exercises[cat] || []).reduce((a, e) => a + e.sets, 0);

    const orderIdx   = doneKeys.indexOf(cat);
    const orderBadge = orderIdx >= 0
      ? `<span class="order-badge ${orderIdx === 0 ? 'order-badge--last' : 'order-badge--prev'}">${orderLabels[orderIdx] || `${orderIdx + 1}e`}</span>`
      : '';

    return `
      <div class="card ${ready ? 'ready' : ''}" data-cat="${cat}" style="--cat-color:${meta.color}">
        <div class="card__header">
          <span class="card__icon">${meta.icon}</span>
          <div>
            <div class="card__title">${meta.label}${orderBadge}</div>
            <div class="card__desc">${meta.desc}</div>
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
        ${!ready ? `<button class="btn btn--ghost btn--full btn--skip" data-action="skip-cooldown" data-cat="${cat}">Passer le délai</button>` : ''}
        <div class="card__cooldown">
          <span class="card__cooldown-label">Délai récup.</span>
          <button class="card__cooldown-btn" data-action="cooldown-edit" data-cat="${cat}">${getCooldown(cat)}h ✎</button>
        </div>
      </div>`;
  }).join('');

  const emptyCustom = data.activeProgramme === 'custom' && keys.length === 0
    ? `<div class="empty-state">
         <div class="empty-state__icon">✏️</div>
         <div>Programme vide</div>
         <div class="empty-state__sub">Appuie sur le programme en haut pour ajouter des séances</div>
       </div>`
    : '';

  return `
    <div class="view dashboard">
      <header class="header">
        <button class="prog-pill" data-action="go-programmes">
          <span class="prog-pill__icon">${pm.icon}</span>
          <span class="prog-pill__name">${pm.name}</span>
          <span class="prog-pill__chevron">›</span>
        </button>
        ${computeStreak() > 0 ? `<div class="streak-badge" title="Semaines consécutives actives">🔥 ${computeStreak()} sem.</div>` : ''}
        <div style="display:flex;gap:4px">
          <button class="icon-btn" data-action="go-settings" title="Réglages">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>
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
      <div class="cards">${cards || emptyCustom}<div class="dashboard__brand">MDLF Training</div></div>
    </div>`;
}

function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    if (view !== 'dashboard') return;
    sessionKeys().forEach(cat => {
      const el   = $(`#timer-${cat}`);
      const card = $(`[data-cat="${cat}"]`);
      const btn  = card ? $('[data-action="start-session"]', card) : null;
      if (!el) return;
      const last = prog().timers[cat];
      if (!last) return;
      const rem = (last + getCooldown(cat) * 3600_000) - Date.now();
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
//  Programme selector
// ═══════════════════════════════════════════════════════════

function renderProgrammes() {
  const cards = Object.entries(PROGRAMMES).map(([id, pm]) => {
    const isActive = data.activeProgramme === id;
    const keys     = sessionKeys(id);
    const names    = id === 'custom'
      ? Object.values(data.customSessions || {}).map(s => s.label).join(' · ')
      : Object.values(pm.sessions).map(s => s.label).join(' · ');

    return `
      <div class="prog-card ${isActive ? 'prog-card--active' : ''}" data-action="select-prog" data-id="${id}">
        <span class="prog-card__icon">${pm.icon}</span>
        <div class="prog-card__body">
          <div class="prog-card__name">${pm.name} ${isActive ? '<span class="prog-badge">Actif</span>' : ''}</div>
          <div class="prog-card__desc">${pm.desc}</div>
          ${names ? `<div class="prog-card__sessions">${names}</div>` : ''}
        </div>
        <span class="prog-card__arrow">›</span>
      </div>`;
  }).join('');

  const customManager = data.activeProgramme === 'custom' ? renderCustomManager() : '';

  return `
    <div class="view programmes">
      <header class="header">
        <button class="icon-btn" data-action="back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <span class="header__title">Programme</span>
        <div style="width:40px"></div>
      </header>
      <div class="prog-list">
        ${cards}
        ${customManager}
      </div>
    </div>
    ${renderCsModal()}`;
}

function renderCustomManager() {
  const sessions = Object.entries(data.customSessions || {});
  return `
    <div class="custom-manager">
      <div class="custom-manager__title">Séances du programme Perso</div>
      ${sessions.length === 0
        ? `<div class="custom-manager__empty">Aucune séance — crée-en une ci-dessous</div>`
        : sessions.map(([id, s]) => `
          <div class="custom-session-row">
            <span class="custom-session-icon" style="color:${s.color}">${s.icon}</span>
            <div class="custom-session-info">
              <div class="custom-session-name">${s.label}</div>
              ${s.desc ? `<div class="custom-session-desc">${s.desc}</div>` : ''}
            </div>
            <button class="icon-btn" data-action="edit-custom-session" data-id="${id}" title="Modifier">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </button>
          </div>`).join('')}
      <button class="btn btn--secondary btn--full" data-action="add-custom-session" style="margin-top:10px">
        + Ajouter une séance
      </button>
    </div>`;
}

function renderCsModal() {
  if (!csModal) return '';
  const isEdit   = csEditId !== null;
  const existing = isEdit ? (data.customSessions[csEditId] || {}) : {};
  const colors   = ['#ef4444','#f97316','#f59e0b','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#a855f7','#ec4899','#64748b'];
  const selColor = csColor;

  return `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__title">${isEdit ? 'Modifier la séance' : 'Nouvelle séance'}</div>
        <label class="form-label">Nom</label>
        <input type="text" id="csName" class="form-input" value="${existing.label || ''}"
               placeholder="Ex : Séance A, Chest, Full Body…" autocomplete="off">
        <label class="form-label">Icône</label>
        <input type="text" id="csIcon" class="form-input" value="${existing.icon || '🏋️'}"
               placeholder="🏋️" style="font-size:22px;text-align:center">
        <label class="form-label">Description (optionnel)</label>
        <input type="text" id="csDesc" class="form-input" value="${existing.desc || ''}"
               placeholder="Ex : Pectoraux · Dos">
        <label class="form-label">Couleur</label>
        <div class="color-picker">
          ${colors.map(c => `
            <button class="color-swatch ${c === selColor ? 'color-swatch--active' : ''}"
                    data-action="pick-cs-color" data-color="${c}" style="background:${c}"></button>`).join('')}
        </div>
        <div class="modal__actions" style="flex-wrap:wrap;gap:8px">
          ${isEdit ? `<button class="btn btn--danger" data-action="delete-custom-session" style="flex:1 1 100%">Supprimer cette séance</button>` : ''}
          <button class="btn btn--secondary" data-action="close-cs-modal" style="flex:1">Annuler</button>
          <button class="btn btn--primary"   data-action="save-cs-modal"  style="flex:1">OK</button>
        </div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
//  Session
// ═══════════════════════════════════════════════════════════

function startSession(cat) {
  sessionNotes = '';
  const exList = prog().exercises[cat] || [];
  activeSession = {
    category:  cat,
    programme: data.activeProgramme,
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
  const { category: cat } = activeSession;
  const meta = sessionMeta(cat);

  const totalSets = activeSession.exercises.reduce((a, ex) => a + ex.sets.length, 0);
  const doneSets  = activeSession.exercises.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0);
  const pct       = totalSets ? Math.round(doneSets / totalSets * 100) : 0;

  const prevSession = (data.history || []).find(h => h.category === cat && h.programme === activeSession.programme);

  // Volume global : session actuelle vs précédente
  const curVolTotal  = activeSession.exercises.reduce((a, ex) => a + setsVolume(ex.sets.filter(s => s.done)), 0);
  const prevVolTotal = prevSession ? prevSession.exercises.reduce((a, ex) => a + setsVolume(ex.sets), 0) : 0;
  const volDelta     = curVolTotal - prevVolTotal;
  const volDeltaStr  = prevVolTotal > 0
    ? (volDelta >= 0 ? `+${fmtVolume(volDelta)}` : `-${fmtVolume(Math.abs(volDelta))}`)
    : '';
  const volDeltaColor = volDelta >= 0 ? '#22c55e' : '#ef4444';

  const exHtml = activeSession.exercises.map((ex, ei) => {
    const exData  = prog().exercises[cat]?.find(e => e.id === ex.exId);
    const prText  = exData?.pr ? `PR : ${dispW(exData.pr.weight)} ${unitLbl()} × ${exData.pr.reps}` : '';
    const allDone = ex.sets.every(s => s.done);

    const prevEx      = prevSession?.exercises.find(e => e.name === ex.name);
    const prevSets    = prevEx?.sets || [];

    // Volume par exercice
    const exCurVol  = setsVolume(ex.sets.filter(s => s.done));
    const exPrevVol = setsVolume(prevSets);
    const exDelta   = exCurVol - exPrevVol;
    const exVolHtml = exCurVol > 0
      ? `<span class="ex-vol">${fmtVolume(exCurVol)}${exPrevVol > 0 ? ` <span style="color:${exDelta >= 0 ? '#22c55e' : '#ef4444'}">(${exDelta >= 0 ? '+' : ''}${fmtVolume(exDelta)})</span>` : ''}</span>`
      : '';

    const setsHtml = ex.sets.map((s, si) => {
      if (s.done) {
        const isNewPR    = exData?.pr && s.weight == exData.pr.weight && s.reps == exData.pr.reps;
        const weightLabel = s.weight ? `${dispW(s.weight)} ${unitLbl()} × ` : '';
        return `
          <div class="set-row set-row--done">
            <span class="set-num">Série ${si + 1}</span>
            <span class="set-val">${weightLabel}${s.reps} reps</span>
            ${isNewPR ? '<span class="pr-badge">PR !</span>' : ''}
            <button class="rest-btn" data-action="start-rest" data-ei="${ei}">⏱ Repos</button>
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
                   value="${dispW(s.weight)}" data-action="set-weight" data-ei="${ei}" data-si="${si}">
            <span class="input-unit">${unitLbl()}</span>
          </div>
          <div class="input-group">
            <input type="number" inputmode="numeric" class="set-input set-input--required" placeholder="0"
                   value="${s.reps}" data-action="set-reps" data-ei="${ei}" data-si="${si}">
            <span class="input-unit">reps</span>
          </div>
          <button class="btn btn--success btn--sm" data-action="validate-set" data-ei="${ei}" data-si="${si}">✓</button>
        </div>`;
    }).join('');

    const prevHtml = prevSets.length ? `
      <div class="prev-session">
        <div class="prev-session__label">Séance du ${fmtDate(prevSession.date)}</div>
        <div class="prev-session__sets">
          ${prevSets.map((s, i) => `<span class="prev-set">S${i+1} : ${dispW(s.weight)} ${unitLbl()} × ${s.reps}</span>`).join('')}
        </div>
      </div>` : '';

    const restSecs = exData?.rest ?? data.defaultRest;
    const restLabel = restSecs >= 60 ? `${restSecs / 60}min` : `${restSecs}s`;

    return `
      <div class="exercise-block ${allDone ? 'exercise-block--done' : ''}">
        <div class="exercise-header">
          <span class="exercise-name">${ex.name}</span>
          <button class="rest-badge" data-action="set-ex-rest" data-ei="${ei}" title="Modifier le repos">⏱ ${restLabel}</button>
          <span class="exercise-progress">${ex.sets.filter(s => s.done).length}/${ex.sets.length}</span>
        </div>
        ${exVolHtml ? `<div class="ex-vol-line">${exVolHtml}</div>` : ''}
        ${prText ? `<div class="exercise-hint"><span class="pr">${prText}</span></div>` : ''}
        ${prevHtml}
        ${setsHtml}
      </div>`;
  }).join('');

  return `
    <div class="view session" style="--cat-color:${meta.color}">
      <header class="header header--session">
        <button class="icon-btn" data-action="back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <div class="header__center">
          <div class="header__title">${meta.icon} ${meta.label}</div>
          <div class="header__sub">${doneSets} / ${totalSets} séries${curVolTotal > 0 ? ` · ${fmtVolume(curVolTotal)}${volDeltaStr ? ` <span style="color:${volDeltaColor};font-size:11px">${volDeltaStr}</span>` : ''}` : ''}</div>
        </div>
        <button class="btn--finish" data-action="finish-session">Terminer</button>
      </header>
      <div class="progress-bar">
        <div class="progress-bar__fill" style="width:${pct}%;background:${meta.color}"></div>
      </div>
      <div class="session-content">
        ${exHtml}
        <button class="session-add-ex-btn" data-action="add-session-ex">
          + Ajouter un exercice
        </button>
        <div class="session-notes-block">
          <div class="session-notes-label">Notes de séance</div>
          <textarea class="session-notes-input" data-action="session-notes"
                    placeholder="Comment s'est passée la séance ? (optionnel)">${sessionNotes}</textarea>
        </div>
      </div>
    </div>
    ${renderRestOverlay()}
    ${renderRestEditModal()}
    ${addExModal ? renderAddExModal() : ''}`;
}

function validateSet(ei, si) {
  const ex  = activeSession.exercises[ei];
  const s   = ex.sets[si];
  if (!s.reps) { showToast('Entre le nombre de reps !'); return; }

  s.done = true;
  validationSound();

  const nextSet = ex.sets[si + 1];
  if (nextSet && !nextSet.done) {
    nextSet.weight = s.weight;
    nextSet.reps   = s.reps;
  }

  const cat    = activeSession.category;
  const exData = prog().exercises[cat]?.find(e => e.id === ex.exId);
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
    if (new1RM && (!exData.est1RM || new1RM > exData.est1RM)) exData.est1RM = new1RM;
    save();
  }

  const allDone = activeSession.exercises.every(e => e.sets.every(s => s.done));
  if (!allDone) {
    const restSecs = exData?.rest ?? data.defaultRest;
    openRest(restSecs);
  } else {
    render();
  }

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
  }, 500);
}

function renderRestEditModal() {
  if (restEditEi === null) return '';
  const ex     = activeSession?.exercises[restEditEi];
  const cat    = activeSession?.category;
  const exData = prog().exercises[cat]?.find(e => e.id === ex?.exId);
  const cur    = exData?.rest ?? data.defaultRest;
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

function renderAddExModal() {
  return `
    <div class="modal-overlay" data-action="close-add-ex-modal">
      <div class="modal" style="max-width:320px;" onclick="event.stopPropagation()">
        <div class="modal__title">Ajouter un exercice</div>
        <label class="form-label">Nom de l'exercice</label>
        <input type="text" id="addExNameInput" class="form-input"
               value="${addExName}" placeholder="Ex : Curl concentré" autocomplete="off">
        <label class="form-label" style="margin-top:14px">Nombre de séries</label>
        <div style="display:flex;align-items:center;gap:12px;margin-top:6px">
          <button class="sets-adj" data-action="add-ex-dec-sets">−</button>
          <span style="font-size:20px;font-weight:700;min-width:28px;text-align:center">${addExSets}</span>
          <button class="sets-adj" data-action="add-ex-inc-sets">+</button>
        </div>
        <div class="modal__actions" style="margin-top:20px">
          <button class="btn btn--secondary" data-action="close-add-ex-modal">Annuler</button>
          <button class="btn btn--primary"   data-action="save-add-ex-modal">Ajouter</button>
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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && restActive) {
    const remaining = Math.ceil((restEndTime - Date.now()) / 1000);
    if (remaining <= 0) {
      clearInterval(restInterval);
      restTimeLeft = 0;
      restActive   = false;
      timerDone();
      setTimeout(() => render(), 350);
    } else {
      restTimeLeft = remaining;
      startRestCountdown();
    }
  }
});

// ═══════════════════════════════════════════════════════════
//  Editor
// ═══════════════════════════════════════════════════════════

function renderEditor() {
  const keys = sessionKeys();

  const tabs = keys.map(c => {
    const meta    = sessionMeta(c);
    const isActive = editorCat === c;
    return `
      <button class="tab ${isActive ? 'tab--active' : ''}"
              data-action="editor-tab" data-cat="${c}"
              style="${isActive ? `--tab-color:${meta.color};border-bottom-color:${meta.color};color:${meta.color}` : ''}">
        ${meta.icon} ${meta.label}
      </button>`;
  }).join('');

  const rows = (prog().exercises[editorCat] || []).map((ex, i) => {
    const last = ex.lastWeight ? `${dispW(ex.lastWeight)} ${unitLbl()} × ${ex.lastReps}` : 'Pas encore effectué';
    const pr   = ex.pr ? ` · PR: ${dispW(ex.pr.weight)} ${unitLbl()} × ${ex.pr.reps}` : '';
    const max  = (prog().exercises[editorCat] || []).length - 1;

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
      ${keys.length ? `<div class="tabs">${tabs}</div>` : ''}
      ${keys.length === 0
        ? `<div class="empty-state" style="padding:40px">
             <div class="empty-state__icon">✏️</div>
             <div>Programme vide</div>
             <div class="empty-state__sub">Crée des séances dans "Programme"</div>
           </div>`
        : `<div class="editor-list">${rows}</div>
           <div class="editor-footer">
             <button class="btn btn--primary btn--full" data-action="add-ex">+ Ajouter un exercice</button>
           </div>`}
    </div>
    ${renderModal()}`;
}

function renderModal() {
  if (!modalOpen) return '';
  const isEdit = editExIdx !== null;
  const ex     = isEdit ? (prog().exercises[editorCat] || [])[editExIdx] : null;

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
        <label class="form-label">Objectif poids (${unitLbl()}) — optionnel</label>
        <input type="number" inputmode="decimal" id="modalTarget" class="form-input"
               value="${ex?.target ? dispW(ex.target) : ''}" placeholder="Ex : ${data.unit === 'lbs' ? '88' : '40'}">
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
  (prog().exercises[cat] || []).forEach(ex => {
    addSets[ex.id] = Array.from({ length: ex.sets }, () => ({
      weight: ex.lastWeight || '',
      reps:   ex.lastReps   || '',
    }));
  });
}

function renderAddSession() {
  const exercises = prog().exercises[addCat] || [];
  const today     = new Date().toISOString().slice(0, 10);
  const keys      = sessionKeys();

  const catBtns = keys.map(c => {
    const meta    = sessionMeta(c);
    const isActive = addCat === c;
    return `
      <button class="cat-sel-btn ${isActive ? 'cat-sel-btn--active' : ''}"
              data-action="add-cat" data-cat="${c}"
              style="${isActive ? `border-color:${meta.color};color:${meta.color};background:${meta.color}18` : ''}">
        ${meta.icon} ${meta.label}
      </button>`;
  }).join('');

  const exHtml = exercises.map(ex => {
    const sets = addSets[ex.id] || [];
    const setsHtml = sets.map((s, si) => `
      <div class="set-row set-row--active">
        <span class="set-num">S${si + 1}</span>
        <div class="input-group">
          <input type="number" inputmode="decimal" class="set-input" placeholder="—"
                 value="${dispW(s.weight)}" data-action="add-weight" data-exid="${ex.id}" data-si="${si}">
          <span class="input-unit">${unitLbl()}</span>
        </div>
        <div class="input-group">
          <input type="number" inputmode="numeric" class="set-input set-input--required" placeholder="0"
                 value="${s.reps}" data-action="add-reps" data-exid="${ex.id}" data-si="${si}">
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

// ═══════════════════════════════════════════════════════════
//  Settings
// ═══════════════════════════════════════════════════════════

function renderSettings() {
  const isLight = document.body.classList.contains('light');
  const tog = (on) => `<div class="setting-toggle ${on ? 'setting-toggle--on' : ''}"><div class="setting-toggle__thumb"></div></div>`;

  return `
    <div class="view settings-view">
      <header class="header">
        <button class="icon-btn" data-action="back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <span class="header__title">Réglages</span>
        <div style="width:40px"></div>
      </header>
      <div class="settings-list">

        <div class="settings-section-title">Apparence</div>
        <div class="settings-group">
          <button class="setting-row" data-action="toggle-theme">
            <span class="setting-label">Thème</span>
            <span class="setting-value">${isLight ? 'Clair ☀️' : 'Sombre 🌙'}</span>
          </button>
        </div>

        <div class="settings-section-title">Séance</div>
        <div class="settings-group">
          <div class="setting-row setting-row--segmented">
            <span class="setting-label">Unité de poids</span>
            <div class="segmented">
              <button class="segmented__btn ${data.unit === 'kg' ? 'segmented__btn--active' : ''}" data-action="setting-unit" data-val="kg">kg</button>
              <button class="segmented__btn ${data.unit === 'lbs' ? 'segmented__btn--active' : ''}" data-action="setting-unit" data-val="lbs">lbs</button>
            </div>
          </div>
          <button class="setting-row" data-action="setting-rest">
            <span class="setting-label">Repos entre séries</span>
            <span class="setting-value">${data.defaultRest}s</span>
          </button>
          <button class="setting-row" data-action="setting-sound">
            <span class="setting-label">Sons</span>
            ${tog(data.soundOn !== false)}
          </button>
          <button class="setting-row" data-action="setting-vibrate">
            <span class="setting-label">Vibrations</span>
            ${tog(data.vibrateOn !== false)}
          </button>
        </div>

        <div class="settings-section-title">Données</div>
        <div class="settings-group">
          <button class="setting-row" data-action="export">
            <span class="setting-label">Exporter les données</span>
            <span class="setting-value">›</span>
          </button>
          <button class="setting-row" data-action="import">
            <span class="setting-label">Importer les données</span>
            <span class="setting-value">›</span>
          </button>
          <button class="setting-row" data-action="force-update">
            <span class="setting-label">Mettre à jour l'app</span>
            <span class="setting-value">↻</span>
          </button>
        </div>

      </div>
    </div>`;
}

function renderStatsOverview(viewTabs) {
  const keys    = sessionKeys();
  const history = (data.history || []).filter(h =>
    (h.programme === data.activeProgramme) || (!h.programme && data.activeProgramme === 'ppl')
  );

  // ── Totaux all-time par catégorie ─────────────────────
  const totalsByCat = {};
  keys.forEach(k => { totalsByCat[k] = 0; });
  history.forEach(h => { if (totalsByCat[h.category] !== undefined) totalsByCat[h.category]++; });

  // ── Années disponibles ────────────────────────────────
  const years = [...new Set(history.map(h => new Date(h.date).getFullYear()))].sort((a,b) => b - a);
  if (!years.includes(statsYear) && years.length) statsYear = years[0];

  // ── Sessions pour la période sélectionnée ─────────────
  const inPeriod = history.filter(h => {
    const d = new Date(h.date);
    if (d.getFullYear() !== statsYear) return false;
    if (statsMonth !== null && d.getMonth() !== statsMonth) return false;
    return true;
  });

  const periodByCat = {};
  keys.forEach(k => { periodByCat[k] = 0; });
  inPeriod.forEach(h => { if (periodByCat[h.category] !== undefined) periodByCat[h.category]++; });
  const periodTotal = inPeriod.length;

  // ── Mois de l'année sélectionnée ──────────────────────
  const monthNames = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  const monthsWithData = [...new Set(
    history.filter(h => new Date(h.date).getFullYear() === statsYear)
           .map(h => new Date(h.date).getMonth())
  )].sort((a,b) => a - b);

  const yearNav = `
    <div class="overview-year-nav">
      <button class="cooldown-btn" data-action="overview-year-prev">‹</button>
      <span class="overview-year">${statsYear}</span>
      <button class="cooldown-btn" data-action="overview-year-next" ${statsYear >= new Date().getFullYear() ? 'disabled' : ''}>›</button>
    </div>`;

  const monthPills = `
    <div class="overview-months">
      <button class="month-pill ${statsMonth === null ? 'month-pill--active' : ''}" data-action="overview-month" data-month="-1">Année</button>
      ${monthsWithData.map(m => `
        <button class="month-pill ${statsMonth === m ? 'month-pill--active' : ''}" data-action="overview-month" data-month="${m}">${monthNames[m]}</button>
      `).join('')}
    </div>`;

  const catCards = keys.map(k => {
    const meta  = sessionMeta(k);
    const total = totalsByCat[k];
    const prd   = periodByCat[k];
    return `
      <div class="overview-cat-card" style="--cat-color:${meta.color}">
        <div class="overview-cat-icon">${meta.icon}</div>
        <div class="overview-cat-label">${meta.label}</div>
        <div class="overview-cat-count">${prd}</div>
        <div class="overview-cat-sub">séances</div>
        <div class="overview-cat-total">${total} au total</div>
      </div>`;
  }).join('');

  // ── Détail par mois (vue annuelle) ───────────────────
  let monthGrid = '';
  if (statsMonth === null) {
    const rows = monthNames.map((name, mi) => {
      const count = history.filter(h => {
        const d = new Date(h.date);
        return d.getFullYear() === statsYear && d.getMonth() === mi;
      }).length;
      if (count === 0) return '';
      const byCat = keys.map(k => {
        const c = history.filter(h => {
          const d = new Date(h.date);
          return d.getFullYear() === statsYear && d.getMonth() === mi && h.category === k;
        }).length;
        const meta = sessionMeta(k);
        return c > 0 ? `<span style="color:${meta.color}">${meta.icon} ×${c}</span>` : '';
      }).filter(Boolean).join(' ');
      return `
        <div class="month-row">
          <span class="month-row__name">${name}</span>
          <span class="month-row__cats">${byCat}</span>
          <span class="month-row__total">${count}</span>
        </div>`;
    }).join('');
    monthGrid = rows ? `<div class="month-grid">${rows}</div>` : '';
  }

  return `
    <div class="view stats">
      <header class="header">
        <button class="icon-btn" data-action="back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <span class="header__title">Statistiques</span>
        <div style="width:40px"></div>
      </header>
      ${viewTabs}
      <div class="stats-list">
        ${yearNav}
        ${monthPills}
        <div class="overview-period-label">${statsMonth !== null ? monthNames[statsMonth] + ' ' + statsYear : 'Année ' + statsYear} — <strong>${periodTotal} séance${periodTotal !== 1 ? 's' : ''}</strong></div>
        <div class="overview-cats">${catCards}</div>
        ${monthGrid}
        ${!history.length ? `<div class="empty-state"><div class="empty-state__icon">📊</div><div>Pas encore de données</div></div>` : ''}
      </div>
    </div>`;
}

function renderStats() {
  const keys = sessionKeys();

  const viewTabs = `
    <div class="stats-view-tabs">
      <button class="stats-view-tab ${statsView === 'progress' ? 'stats-view-tab--active' : ''}" data-action="stats-view" data-view="progress">Progression</button>
      <button class="stats-view-tab ${statsView === 'overview' ? 'stats-view-tab--active' : ''}" data-action="stats-view" data-view="overview">Vue d'ensemble</button>
    </div>`;

  if (statsView === 'overview') return renderStatsOverview(viewTabs);

  const tabs = keys.map(c => {
    const meta    = sessionMeta(c);
    const isActive = statsCat === c;
    return `
      <button class="tab ${isActive ? 'tab--active' : ''}"
              data-action="stats-tab" data-cat="${c}"
              style="${isActive ? `--tab-color:${meta.color};border-bottom-color:${meta.color};color:${meta.color}` : ''}">
        ${meta.icon} ${meta.label}
      </button>`;
  }).join('');

  const meta      = sessionMeta(statsCat);
  const color     = meta.color;
  const exercises = prog().exercises[statsCat] || [];
  const history   = (data.history || []).filter(h =>
    (h.programme === data.activeProgramme) || (!h.programme && data.activeProgramme === 'ppl')
  );

  // ── Mode helpers ──────────────────────────────────────
  function pointMetric(p) {
    if (statsMode === 'charge') return p.hasWeight ? p.maxLoad : p.totalReps;
    if (statsMode === '1rm')    return p.best1RM   || (p.hasWeight ? p.maxLoad : p.totalReps);
    // volume (default)
    return p.volume;
  }
  function metricUnit(isBodyweight) {
    if (statsMode === 'volume') return isBodyweight ? ' reps' : ` ${unitLbl()}`;
    return ` ${unitLbl()}`;
  }
  function cvtW(kg) { return data.unit === 'lbs' ? Math.round(kg * KG_TO_LBS * 10) / 10 : kg; }
  function fmtMetric(v, isBodyweight) {
    const vd = isBodyweight ? v : cvtW(v); // ne pas convertir les reps
    if (statsMode === 'volume' && !isBodyweight) {
      if (data.unit === 'lbs') return vd >= 1000 ? (vd / 1000).toFixed(1) + ' k lbs' : Math.round(vd) + ' lbs';
      return v >= 1000 ? (v / 1000).toFixed(1).replace('.', ',') + ' t' : Math.round(v) + ' kg';
    }
    if (statsMode === '1rm') return v > 0 ? `~${Math.round(vd)} ${unitLbl()}` : '—';
    return Math.round(vd) + (isBodyweight ? ' reps' : ` ${unitLbl()}`);
  }
  function modeLabel() {
    if (statsMode === 'charge') return 'Charge max';
    if (statsMode === '1rm')    return '1RM estimé';
    return 'Volume';
  }

  const cards = exercises.map(ex => {
    const points = history
      .filter(s => s.category === statsCat)
      .map(s => {
        const found = s.exercises.find(e => e.name === ex.name);
        if (!found || !found.sets.length) return null;
        const sets     = found.sets;
        const wts      = sets.map(s => parseFloat(s.weight) || 0);
        const rps      = sets.map(s => parseInt(s.reps)     || 0).filter(r => r > 0);
        if (!rps.length) return null;
        const hasWeight  = wts.some(w => w > 0);
        const posWts     = wts.filter(w => w > 0);
        const avgW       = hasWeight ? Math.round((posWts.reduce((a,b)=>a+b,0)/posWts.length)*10)/10 : 0;
        const avgR       = Math.round(rps.reduce((a,b)=>a+b,0)/rps.length);
        const totalReps  = sets.reduce((a,s2)=>a+(parseInt(s2.reps)||0), 0);
        const volume     = hasWeight
          ? sets.reduce((a,s2)=>(a+(parseFloat(s2.weight)||0)*(parseInt(s2.reps)||0)), 0)
          : totalReps;
        const maxLoad    = hasWeight ? Math.max(...posWts) : 0;
        const best1RM    = hasWeight
          ? Math.max(0, ...sets.map(s2 => calc1RM(s2.weight, s2.reps)).filter(v => v !== null))
          : 0;
        return { date: s.date, sets, avgW, avgR, totalReps, volume, maxLoad, best1RM, hasWeight };
      })
      .filter(Boolean)
      .reverse();

    if (points.length === 0) return `
      <div class="stats-card">
        <div class="stats-card__name">${ex.name}</div>
        <div class="stats-card__empty">Pas encore effectué</div>
      </div>`;

    const isBodyweight  = points.every(p => !p.hasWeight);
    const last          = points[points.length - 1];
    const vals          = points.map(pointMetric);
    const lastVal       = vals[vals.length - 1];
    const firstVal      = vals[0];
    const progPct       = firstVal > 0 ? Math.round(((lastVal - firstVal) / firstVal) * 100) : 0;
    const progLabel     = progPct > 0 ? `+${progPct}%` : progPct < 0 ? `${progPct}%` : '—';
    const progColor     = progPct > 0 ? '#22c55e' : progPct < 0 ? '#ef4444' : 'var(--muted)';

    // Best-ever for PR display
    const prW = isBodyweight
      ? Math.max(...points.map(p => p.avgR))
      : Math.max(...points.map(p => p.maxLoad));

    const lastSets = last.sets
      .filter(s => s.reps)
      .map((s, i) => {
        const w = s.weight ? `${dispW(s.weight)} ${unitLbl()} × ` : '';
        return `<span class="last-set">S${i+1} : ${w}${s.reps} reps</span>`;
      }).join('');

    const displayVals = (!isBodyweight && statsMode !== 'volume')
      ? vals.map(v => cvtW(v))
      : (statsMode === 'volume' && !isBodyweight && data.unit === 'lbs')
        ? vals.map(v => Math.round(v * KG_TO_LBS))
        : vals;
    const encoded = encodeURIComponent(JSON.stringify({
      vals: displayVals,
      dates: points.map(p => p.date),
      unit: metricUnit(isBodyweight),
      isVolumeMode: statsMode === 'volume' && !isBodyweight,
    }));

    const exData    = prog().exercises[statsCat]?.find(e => e.name === ex.name);
    const targetW   = exData?.target;
    const e1RM      = exData?.est1RM;
    const targetBar = (targetW && !isBodyweight) ? (() => {
      const pct    = Math.min(100, Math.round((last.maxLoad / targetW) * 100));
      const c2     = pct >= 100 ? '#22c55e' : progColor;
      return `<div class="target-block">
        <div class="target-label">Objectif : ${cvtW(targetW)} ${unitLbl()} <span style="color:${c2}">${pct >= 100 ? '✓ Atteint !' : pct + '%'}</span></div>
        <div class="target-bar"><div class="target-bar__fill" style="width:${pct}%;background:${c2}"></div></div>
      </div>`;
    })() : '';

    // Secondary line under main metric
    let secondaryLine = '';
    if (statsMode === 'volume') {
      secondaryLine = isBodyweight
        ? `<span>${last.sets.filter(s=>s.reps).length} séries · ${last.avgR} reps/série</span>`
        : `<span>${last.sets.filter(s=>s.reps).length} séries · ${cvtW(last.avgW)} ${unitLbl()} moy · ${last.avgR} reps/série</span>`;
    } else if (statsMode === 'charge') {
      secondaryLine = `<span>${last.sets.filter(s=>s.reps).length} séries · ${last.avgR} reps/série</span>`;
    } else {
      secondaryLine = last.avgW ? `<span>${cvtW(last.avgW)} ${unitLbl()} × ${last.avgR} reps (meilleures séries)</span>` : '';
    }

    return `
      <div class="stats-card">
        <div class="stats-card__header">
          <span class="stats-card__name">${ex.name}</span>
          <div class="stats-card__current-block">
            <span class="stats-card__current">${fmtMetric(lastVal, isBodyweight)}</span>
            <span class="stats-card__mode-label">${modeLabel()}</span>
          </div>
        </div>
        ${secondaryLine ? `<div class="stats-secondary">${secondaryLine}</div>` : ''}
        ${lastSets ? `<div class="last-sets">${lastSets}</div>` : ''}
        <canvas class="stats-canvas" data-points="${encoded}" data-color="${color}"></canvas>
        ${targetBar}
        <div class="stats-card__footer">
          <span>PR : <strong>${isBodyweight ? prW + ' reps' : cvtW(prW) + ' ' + unitLbl()}</strong></span>
          ${e1RM && !isBodyweight ? `<span>1RM ~<strong>${cvtW(e1RM)} ${unitLbl()}</strong></span>` : ''}
          <span style="color:${progColor};font-weight:700">${progLabel}</span>
          <span>${points.length} séance${points.length > 1 ? 's' : ''}</span>
        </div>
      </div>`;
  }).join('');

  const hasData = exercises.some(ex =>
    history.some(s => s.category === statsCat && s.exercises?.find(e => e.name === ex.name))
  );

  const modeDescs = {
    volume: 'Total soulevé par séance (séries × reps × kg)',
    charge: 'Poids le plus lourd soulevé dans la séance',
    '1rm':  'Force max estimée depuis la meilleure série',
  };
  const modeBar = `
    <div class="stats-mode-bar">
      <div class="stats-mode-btns">
        ${['volume','charge','1rm'].map(m => `
          <button class="stats-mode-btn ${statsMode===m?'stats-mode-btn--active':''}"
                  data-action="stats-mode" data-mode="${m}">
            ${m==='volume'?'Volume':m==='charge'?'Charge max':'1RM ~'}
          </button>`).join('')}
      </div>
      <div class="stats-mode-desc">${modeDescs[statsMode]}</div>
    </div>`;

  return `
    <div class="view stats">
      <header class="header">
        <button class="icon-btn" data-action="back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <span class="header__title">Statistiques</span>
        <div style="width:40px"></div>
      </header>
      ${viewTabs}
      ${keys.length ? `<div class="tabs">${tabs}</div>` : ''}
      ${modeBar}
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
    const { vals, dates, unit, isVolumeMode } = JSON.parse(decodeURIComponent(canvas.dataset.points));
    const color = canvas.dataset.color;
    if (!vals || !vals.length) return;

    const W   = canvas.parentElement.clientWidth - 32;
    const H   = 120;
    const dpr = window.devicePixelRatio || 1;

    canvas.width        = W * dpr;
    canvas.height       = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const n       = vals.length;
    const dataMin = Math.min(...vals) * 0.88;
    const dataMax = Math.max(...vals) * 1.10;
    const range   = (dataMax - dataMin) || 1;

    const pT = 14, pB = 26, pL = 6, pR = 6;
    const cW = W - pL - pR;
    const cH = H - pT - pB;

    const xp = i => pL + (n === 1 ? cW / 2 : (i / (n - 1)) * cW);
    const yp = v => pT + cH - ((v - dataMin) / range) * cH;

    // Gradient fill under line
    const grad = ctx.createLinearGradient(0, pT, 0, pT + cH);
    grad.addColorStop(0, color + '40');
    grad.addColorStop(1, color + '00');

    ctx.beginPath();
    ctx.moveTo(xp(0), pT + cH);
    ctx.lineTo(xp(0), yp(vals[0]));
    for (let i = 1; i < n; i++) {
      const mx = (xp(i-1) + xp(i)) / 2;
      ctx.bezierCurveTo(mx, yp(vals[i-1]), mx, yp(vals[i]), xp(i), yp(vals[i]));
    }
    ctx.lineTo(xp(n-1), pT + cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Main line
    ctx.beginPath();
    ctx.moveTo(xp(0), yp(vals[0]));
    for (let i = 1; i < n; i++) {
      const mx = (xp(i-1) + xp(i)) / 2;
      ctx.bezierCurveTo(mx, yp(vals[i-1]), mx, yp(vals[i]), xp(i), yp(vals[i]));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // Dots
    vals.forEach((v, i) => {
      const isLast = i === n - 1;
      const isPeak = v === Math.max(...vals) && i > 0;
      ctx.beginPath();
      ctx.arc(xp(i), yp(v), isLast ? 5 : isPeak ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle   = (isLast || isPeak) ? color : '#181818';
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.8;
      ctx.fill();
      ctx.stroke();
    });

    // Value label on last point
    const li    = n - 1;
    const lv    = vals[li];
    const trend = n > 1 && vals[li] >= vals[li - 1] ? '▲' : n > 1 ? '▼' : '';
    const trendColor = n > 1 ? (vals[li] >= vals[li-1] ? '#22c55e' : '#ef4444') : color;

    let labelTxt;
    if (isVolumeMode) {
      labelTxt = lv >= 1000
        ? (lv / 1000).toFixed(1).replace('.', ',') + 't'
        : Math.round(lv) + unit;
    } else {
      labelTxt = Math.round(lv * 10) / 10 + unit;
    }

    ctx.font      = 'bold 11px -apple-system, sans-serif';
    ctx.textAlign = xp(li) > W - 50 ? 'right' : 'left';
    const lx      = xp(li) + (xp(li) > W - 50 ? -8 : 8);
    const ly      = yp(lv) - 7;

    ctx.fillStyle = trendColor;
    ctx.fillText(trend, xp(li) + (xp(li) > W - 50 ? -8 - ctx.measureText(labelTxt).width - 4 : 8 + ctx.measureText(labelTxt).width + 4), ly);
    ctx.fillStyle = color;
    ctx.fillText(labelTxt, lx, ly);

    // Date labels on X axis
    ctx.fillStyle = '#555';
    ctx.font      = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';

    const shown   = new Set([0, n - 1]);
    if (n > 2) {
      const step = Math.ceil((n - 1) / 4);
      for (let i = step; i < n - 1; i += step) shown.add(i);
    }
    shown.forEach(i => {
      const label = new Date(dates[i]).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '');
      ctx.fillText(label, Math.max(20, Math.min(W - 20, xp(i))), H - 5);
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
            const itemColor = historyColor(s);
            const catMeta   = sessionMeta(s.category, s.programme || 'ppl');
            return `
              <div class="history-item" style="border-left-color:${itemColor}">
                <div class="history-item__header">
                  <span class="history-item__cat">
                    ${catMeta.icon} ${catMeta.label}
                  </span>
                  <div style="display:flex;align-items:center;gap:8px">
                    <span class="history-item__date">${fmtDateTime(s.date)}</span>
                    <button class="history-edit-btn" data-action="edit-session"   data-id="${s.id}" title="Modifier">✏️</button>
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
                      <span class="history-ex__sets">${ex.sets.map(set => `${set.weight}×${set.reps}`).join(' / ')}</span>
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
      }
      if (view === 'programmes') {
        view = 'dashboard'; render(); startTicker();
      } else {
        view = 'dashboard'; render(); startTicker();
      }
      break;
    }
    case 'go-editor': {
      editorCat = sessionKeys().includes(editorCat) ? editorCat : firstSession();
      view = 'editor'; render(); break;
    }
    case 'go-history': {
      view = 'history'; render(); break;
    }
    case 'go-stats': {
      statsCat = sessionKeys().includes(statsCat) ? statsCat : firstSession();
      view = 'stats'; render(); break;
    }
    case 'go-programmes': {
      view = 'programmes'; render(); break;
    }
    case 'stats-tab': {
      statsCat = el.dataset.cat; render(); break;
    }
    case 'stats-mode': {
      statsMode = el.dataset.mode; render(); break;
    }
    case 'stats-view': {
      statsView = el.dataset.view; render(); break;
    }
    case 'overview-year-prev': {
      statsYear--; statsMonth = null; render(); break;
    }
    case 'overview-year-next': {
      if (statsYear < new Date().getFullYear()) { statsYear++; statsMonth = null; render(); }
      break;
    }
    case 'overview-month': {
      const m = parseInt(el.dataset.month);
      statsMonth = m === -1 ? null : m;
      render(); break;
    }
    case 'go-add-session': {
      addCat        = firstSession();
      addDate       = new Date().toISOString().slice(0, 10);
      editSessionId = null;
      addNotes      = '';
      initAddSets(addCat);
      view = 'add-session'; render(); break;
    }
    case 'edit-session': {
      const session = (data.history || []).find(h => h.id === el.dataset.id);
      if (!session) break;
      // Only edit if it's the same programme
      if (session.programme && session.programme !== data.activeProgramme) {
        showToast('Changezie de programme pour modifier cette séance');
        break;
      }
      editSessionId = session.id;
      addCat  = session.category;
      addDate = new Date(session.date).toISOString().slice(0, 10);
      initAddSets(addCat);
      session.exercises.forEach(ex => {
        const exData = (prog().exercises[addCat] || []).find(e => e.name === ex.name);
        if (exData) addSets[exData.id] = ex.sets.map(s => ({ weight: s.weight, reps: s.reps }));
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
    case 'go-settings': {
      view = 'settings'; render(); break;
    }
    case 'toggle-theme': {
      const next = document.body.classList.contains('light') ? 'dark' : 'light';
      applyTheme(next); render(); break;
    }
    case 'setting-unit': {
      data.unit = el.dataset.val; save(); render(); break;
    }
    case 'setting-sound': {
      data.soundOn = !data.soundOn; save(); render(); break;
    }
    case 'setting-vibrate': {
      data.vibrateOn = !data.vibrateOn; save(); render(); break;
    }
    case 'setting-rest': {
      const v = parseInt(window.prompt('Temps de repos par défaut (secondes) :', String(data.defaultRest)));
      if (!isNaN(v) && v > 0) { data.defaultRest = v; save(); render(); }
      break;
    }
    case 'force-update': {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(regs => {
          Promise.all(regs.map(r => r.unregister())).then(() => window.location.reload(true));
        });
      } else {
        window.location.reload(true);
      }
      break;
    }
    case 'cooldown-edit': {
      const cat = el.dataset.cat;
      if (!cat) break;
      const meta = sessionMeta(cat);
      const cur  = getCooldown(cat);
      const input = window.prompt(`Délai de récupération — ${meta.label} (heures) :\nActuellement : ${cur}h\n\nEntrer un nombre entre 1 et 168 :`, String(cur));
      if (input === null) break;
      const val = parseInt(input, 10);
      if (isNaN(val) || val < 1 || val > 168) { alert('Valeur invalide (1–168h).'); break; }
      prog().cooldowns[cat] = val;
      save(); render();
      break;
    }
    case 'skip-cooldown': {
      const cat = el.dataset.cat;
      if (!cat || !prog().timers[cat]) break;
      const meta = sessionMeta(cat);
      if (!confirm(`Passer le délai de récupération pour "${meta.label}" ?\n\nLa séance sera immédiatement disponible.`)) break;
      prog().timers[cat] = null;
      save(); render();
      break;
    }
    case 'add-cat': {
      addCat = el.dataset.cat;
      initAddSets(addCat);
      render(); break;
    }
    case 'add-date': { addDate = el.value; break; }
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
      const dateEl = $('#addDate');
      if (dateEl) addDate = dateEl.value;
      const notesEl2 = $('.session-notes-input');
      if (notesEl2) addNotes = notesEl2.value;

      const sessionExercises = (prog().exercises[addCat] || [])
        .map(ex => {
          const sets = (addSets[ex.id] || []).filter(s => s.reps);
          if (!sets.length) return null;
          return { name: ex.name, sets };
        })
        .filter(Boolean);

      if (!sessionExercises.length) { showToast('Entre au moins un exercice avec poids et reps !'); return; }

      const [y, m, d] = addDate.split('-').map(Number);
      const timestamp = new Date(y, m - 1, d, 12, 0, 0).getTime();

      if (!data.history) data.history = [];
      if (editSessionId) {
        const idx = data.history.findIndex(h => h.id === editSessionId);
        if (idx !== -1) data.history[idx] = { id: editSessionId, programme: data.activeProgramme, category: addCat, date: timestamp, exercises: sessionExercises };
      } else {
        data.history.push({ id: uid(), programme: data.activeProgramme, category: addCat, date: timestamp, notes: addNotes.trim(), exercises: sessionExercises });
        addNotes = '';
      }
      data.history.sort((a, b) => b.date - a.date);
      editSessionId = null;

      const latestForCat = data.history
        .filter(h => h.category === addCat && (h.programme === data.activeProgramme || (!h.programme && data.activeProgramme === 'ppl')))
        .reduce((best, h) => h.date > (best?.date || 0) ? h : best, null);
      if (latestForCat) prog().timers[addCat] = latestForCat.date;

      save();
      showToast('Séance ajoutée !');
      view = 'history'; render(); startTicker(); break;
    }

    // ── Programme selector ─────────────────────────────────
    case 'select-prog': {
      const id = el.dataset.id;
      if (id === data.activeProgramme) {
        // already active — just go back to dashboard (unless custom, stay to manage)
        if (id !== 'custom') { view = 'dashboard'; render(); startTicker(); }
        break;
      }
      data.activeProgramme = id;
      // Initialise programme data if first time
      if (!data.programmes[id]) {
        data.programmes[id] = makeProgData(id);
        if (id === 'custom') {
          Object.keys(data.customSessions || {}).forEach(cat => {
            data.programmes.custom.timers[cat]    = null;
            data.programmes.custom.exercises[cat] = [];
          });
        }
      }
      // Reset per-view cats
      editorCat = firstSession();
      statsCat  = firstSession();
      addCat    = firstSession();
      syncTimersFromHistory();
      save();
      showToast(`Programme : ${progMeta().name}`);
      if (id === 'custom') {
        render(); // stay in programmes view
      } else {
        view = 'dashboard'; render(); startTicker();
      }
      break;
    }

    // ── Custom session modal ────────────────────────────────
    case 'add-custom-session': {
      csModal   = true;
      csEditId  = null;
      csColor   = '#3b82f6';
      render(); break;
    }
    case 'edit-custom-session': {
      const id = el.dataset.id;
      csModal  = true;
      csEditId = id;
      csColor  = (data.customSessions[id] || {}).color || '#3b82f6';
      render();
      setTimeout(() => { $('#csName')?.focus(); }, 50);
      break;
    }
    case 'close-cs-modal': {
      csModal = false; csEditId = null; render(); break;
    }
    case 'pick-cs-color': {
      csColor = el.dataset.color;
      // Update swatches without full re-render
      document.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('color-swatch--active', s.dataset.color === csColor);
      });
      break;
    }
    case 'save-cs-modal': {
      const name = $('#csName')?.value.trim();
      const icon = $('#csIcon')?.value.trim() || '🏋️';
      const desc = $('#csDesc')?.value.trim() || '';
      if (!name) { showToast('Entre un nom !'); return; }

      const id = csEditId || uid();
      if (!data.customSessions) data.customSessions = {};
      data.customSessions[id] = { label: name, icon, desc, color: csColor };

      // Ensure exercise/timer/cooldown slot exists
      if (!data.programmes.custom) data.programmes.custom = { exercises: {}, timers: {}, cooldowns: {} };
      if (!data.programmes.custom.exercises[id])  data.programmes.custom.exercises[id]  = [];
      if (!data.programmes.custom.timers[id])     data.programmes.custom.timers[id]     = null;
      if (data.programmes.custom.cooldowns[id] == null) data.programmes.custom.cooldowns[id] = 72;

      csModal = false; csEditId = null;
      // Update nav state
      if (!editorCat || !sessionKeys().includes(editorCat)) editorCat = firstSession();
      if (!statsCat  || !sessionKeys().includes(statsCat))  statsCat  = firstSession();
      if (!addCat    || !sessionKeys().includes(addCat))    addCat    = firstSession();

      save();
      showToast(csEditId ? 'Séance modifiée !' : 'Séance créée !');
      render(); break;
    }
    case 'delete-custom-session': {
      if (!confirm('Supprimer cette séance et tous ses exercices ?')) return;
      const id = csEditId;
      if (id && data.customSessions) {
        delete data.customSessions[id];
        if (data.programmes.custom) {
          delete data.programmes.custom.exercises[id];
          delete data.programmes.custom.timers[id];
        }
        data.history = (data.history || []).filter(h => !(h.category === id && h.programme === 'custom'));
      }
      csModal = false; csEditId = null;
      editorCat = firstSession();
      statsCat  = firstSession();
      addCat    = firstSession();
      save(); render(); break;
    }

    // ── Dashboard ──────────────────────────────────────────
    case 'start-session': {
      if (data.soundOn !== false) beep(440, .08);
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
        const exData = prog().exercises[cat]?.find(e => e.id === activeSession.exercises[eiRest]?.exId);
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
      restEditEi = null; render(); break;
    }
    case 'save-rest-edit': {
      const secs = parseInt($('#restEditInput')?.value);
      if (secs >= 10 && secs <= 600) {
        const ex     = activeSession.exercises[restEditEi];
        const cat    = activeSession.category;
        const exData = prog().exercises[cat]?.find(e => e.id === ex?.exId);
        if (exData) { exData.rest = secs; save(); showToast(`Repos ${secs}s enregistré`); }
      }
      restEditEi = null; render(); break;
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
      const timerEl = $('.rest-timer');
      if (timerEl) timerEl.textContent = fmtRest(secs);
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
    case 'add-session-ex': {
      addExModal = true; addExName = ''; addExSets = 3; render();
      setTimeout(() => document.getElementById('addExNameInput')?.focus(), 80);
      break;
    }
    case 'close-add-ex-modal': {
      addExModal = false; render(); break;
    }
    case 'add-ex-dec-sets': {
      const inp = document.getElementById('addExNameInput');
      if (inp) addExName = inp.value;
      addExSets = Math.max(1, addExSets - 1); render();
      setTimeout(() => document.getElementById('addExNameInput')?.focus(), 80);
      break;
    }
    case 'add-ex-inc-sets': {
      const inp = document.getElementById('addExNameInput');
      if (inp) addExName = inp.value;
      addExSets = Math.min(10, addExSets + 1); render();
      setTimeout(() => document.getElementById('addExNameInput')?.focus(), 80);
      break;
    }
    case 'save-add-ex-modal': {
      const inp = document.getElementById('addExNameInput');
      const name = (inp?.value || addExName).trim();
      if (!name) { showToast('Entre un nom pour l\'exercice'); break; }
      activeSession.exercises.push({
        exId: null,
        name,
        sets: Array.from({ length: addExSets }, () => ({ weight: '', reps: '', done: false })),
      });
      addExModal = false; addExName = ''; render();
      // Scroll to the new exercise
      setTimeout(() => {
        const blocks = document.querySelectorAll('.exercise-block');
        blocks[blocks.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      break;
    }
    case 'finish-session': {
      if (!confirm('Terminer et valider la séance ?')) return;
      prog().timers[activeSession.category] = Date.now();
      if (!data.history) data.history = [];
      const notesEl = $('.session-notes-input');
      if (notesEl) sessionNotes = notesEl.value;
      data.history.unshift({
        id:         uid(),
        programme:  activeSession.programme,
        category:   activeSession.category,
        date:       Date.now(),
        notes:      sessionNotes.trim(),
        exercises:  activeSession.exercises.map(ex => ({
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
      const i = parseInt(el.dataset.i), arr = prog().exercises[editorCat];
      if (i > 0) { [arr[i-1], arr[i]] = [arr[i], arr[i-1]]; save(); render(); }
      break;
    }
    case 'move-down': {
      const i = parseInt(el.dataset.i), arr = prog().exercises[editorCat];
      if (i < arr.length - 1) { [arr[i], arr[i+1]] = [arr[i+1], arr[i]]; save(); render(); }
      break;
    }
    case 'inc-sets': {
      const i = parseInt(el.dataset.i), ex = prog().exercises[editorCat][i];
      ex.sets = Math.min(10, ex.sets + 1); save(); render(); break;
    }
    case 'dec-sets': {
      const i = parseInt(el.dataset.i), ex = prog().exercises[editorCat][i];
      ex.sets = Math.max(1, ex.sets - 1); save(); render(); break;
    }
    case 'edit-ex': {
      editExIdx = parseInt(el.dataset.i); modalOpen = true; render();
      setTimeout(() => { const inp = $('#modalName'); if (inp) { inp.focus(); inp.select(); } }, 50);
      break;
    }
    case 'del-ex': {
      const i    = parseInt(el.dataset.i);
      const name = prog().exercises[editorCat][i].name;
      if (!confirm(`Supprimer "${name}" ?`)) return;
      prog().exercises[editorCat].splice(i, 1); save(); render(); break;
    }
    case 'add-ex': {
      editExIdx = null; modalOpen = true; render();
      setTimeout(() => $('#modalName')?.focus(), 50);
      break;
    }
    case 'save-ex': {
      const name   = $('#modalName')?.value.trim();
      const sets   = parseInt($('#modalSets')?.value) || 3;
      if (!name) { showToast('Entre un nom !'); return; }
      const target = $('#modalTarget')?.value ? (parseFloat(storeW($('#modalTarget').value)) || null) : null;
      const rest   = parseInt($('#modalRest')?.value)    || null;
      if (!prog().exercises[editorCat]) prog().exercises[editorCat] = [];
      if (editExIdx !== null) {
        prog().exercises[editorCat][editExIdx].name   = name;
        prog().exercises[editorCat][editExIdx].sets   = sets;
        prog().exercises[editorCat][editExIdx].target = target;
        prog().exercises[editorCat][editExIdx].rest   = rest;
      } else {
        const ex = makeExercise(name, sets);
        ex.target = target;
        ex.rest   = rest;
        prog().exercises[editorCat].push(ex);
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
      a.download = `muscu-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      break;
    }
    case 'import': {
      const inp = document.createElement('input');
      inp.type  = 'file'; inp.accept = '.json';
      inp.onchange = ev => {
        const file = ev.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = re => {
          try {
            const d = JSON.parse(re.target.result);
            // Accept both old format and new format
            if (d.exercises && !d.programmes) {
              // old format
              const nd = makeDefaultData();
              nd.programmes.ppl.exercises = d.exercises;
              nd.programmes.ppl.timers   = d.timers || {};
              nd.defaultRest = d.defaultRest || 90;
              nd.history     = (d.history || []).map(h => ({ ...h, programme: 'ppl' }));
              data = nd;
            } else if (d.programmes && d.activeProgramme) {
              data = d;
              if (!data.customSessions) data.customSessions = {};
            } else {
              showToast('Fichier invalide');
              return;
            }
            save(); render(); showToast('Import réussi !');
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

  if (activeSession) {
    const ei = parseInt(e.target.dataset.ei);
    const si = parseInt(e.target.dataset.si);
    if (!isNaN(ei) && !isNaN(si)) {
      if (action === 'set-weight') activeSession.exercises[ei].sets[si].weight = storeW(e.target.value);
      if (action === 'set-reps')   activeSession.exercises[ei].sets[si].reps   = e.target.value;
    }
  }

  if (view === 'add-session') {
    const exid = e.target.dataset.exid;
    const si   = parseInt(e.target.dataset.si);
    if (exid && !isNaN(si) && addSets[exid]) {
      if (action === 'add-weight') addSets[exid][si].weight = storeW(e.target.value);
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

function syncTimersFromHistory() {
  const history = data.history || [];
  sessionKeys().forEach(cat => {
    const latest = history
      .filter(h => h.category === cat && (h.programme === data.activeProgramme || (!h.programme && data.activeProgramme === 'ppl')))
      .reduce((best, h) => h.date > (best?.date || 0) ? h : best, null);
    if (latest && latest.date > (prog().timers[cat] || 0)) {
      prog().timers[cat] = latest.date;
    }
  });
  save();
}

document.addEventListener('DOMContentLoaded', () => {
  syncTimersFromHistory();
  render();
  startTicker();
});
