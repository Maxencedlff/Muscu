'use strict';

// ═══════════════════════════════════════════════════════════
//  Utilities
// ═══════════════════════════════════════════════════════════

function uid() { return Math.random().toString(36).slice(2, 10); }
function $(sel, ctx = document) { return ctx.querySelector(sel); }
function pad(n) { return String(n).padStart(2, '0'); }

// Échappe le texte saisi par l'utilisateur avant de l'injecter dans le HTML
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Date du jour au format YYYY-MM-DD en heure locale (toISOString est en UTC)
function localISO(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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

function fmtDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h${pad(m)}`;
  return `${m}min`;
}

function fmtDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Copie profonde (structuredClone absent avant iOS 15.4)
function clone(o) {
  return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));
}

// Nombre saisi borné : accepte la virgule décimale, renvoie null si vide, invalide ou hors bornes
function num(v, min, max, int = false) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) return null;
  return n;
}

// Nom d'exercice comparable : minuscules, sans accents, espaces réduits
function normName(name) {
  return String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Même exercice ? Par identifiant stable si les deux en ont un, sinon par nom normalisé.
// Les exercices du programme portent `id`, ceux de l'historique et de la séance `exId`.
function exIdOf(o) { return o?.exId || o?.id || null; }
function sameEx(a, b) {
  const ia = exIdOf(a), ib = exIdOf(b);
  return (ia && ib) ? ia === ib : normName(a?.name) === normName(b?.name);
}

// toast simple, ou avec action : showToast('Import réussi', { action: 'Annuler', onAction, duration: 6000 })
function showToast(msg, opts = {}) {
  const existing = $('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  const duration = opts.duration || 2200;
  el.style.setProperty('--toast-duration', duration + 'ms');
  const text = document.createElement('span');
  text.textContent = msg;
  el.appendChild(text);
  if (opts.action) {
    el.classList.add('toast--action');
    const b = document.createElement('button');
    b.className = 'toast__action';
    b.textContent = opts.action;
    b.addEventListener('click', ev => { ev.stopPropagation(); el.remove(); opts.onAction?.(); });
    el.appendChild(b);
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ═══════════════════════════════════════════════════════════
//  Dialogues natifs façon iOS (remplacent confirm/prompt/alert)
// ═══════════════════════════════════════════════════════════

// actions : [{ label, value, style: 'default' | 'destructive' | 'cancel' | 'preferred' }]
// type 'sheet' = feuille d'actions en bas, 'alert' = alerte centrée
function dialog({ type = 'alert', title = '', message = '', actions, input = null }) {
  return new Promise(resolve => {
    document.querySelector('.ios-dialog')?.remove();
    const root = document.createElement('div');
    root.className = `ios-dialog ios-dialog--${type}`;
    root.setAttribute('role', type === 'sheet' ? 'dialog' : 'alertdialog');
    root.setAttribute('aria-modal', 'true');

    const main   = actions.filter(a => a.style !== 'cancel');
    const cancel = actions.find(a => a.style === 'cancel');
    const btn = a => `<button class="ios-dialog__btn ios-dialog__btn--${a.style || 'default'}" data-i="${actions.indexOf(a)}">${esc(a.label)}</button>`;
    const head = (title || message) ? `
      <div class="ios-dialog__head">
        ${title   ? `<div class="ios-dialog__title">${esc(title)}</div>` : ''}
        ${message ? `<div class="ios-dialog__msg">${esc(message)}</div>` : ''}
        ${input   ? `<div class="ios-dialog__field">
            <input class="ios-dialog__input" type="number" inputmode="${input.decimal ? 'decimal' : 'numeric'}"
                   value="${esc(input.value)}" placeholder="${esc(input.placeholder || '')}">
            ${input.unit ? `<span class="ios-dialog__unit">${esc(input.unit)}</span>` : ''}
          </div>` : ''}
      </div>` : '';

    root.innerHTML = type === 'sheet'
      ? `<div class="ios-dialog__backdrop"></div>
         <div class="ios-dialog__panel">
           <div class="ios-dialog__group">${head}${main.map(btn).join('')}</div>
           ${cancel ? `<div class="ios-dialog__group">${btn(cancel)}</div>` : ''}
         </div>`
      : `<div class="ios-dialog__backdrop"></div>
         <div class="ios-dialog__panel">
           ${head}
           <div class="ios-dialog__row ${actions.length > 2 ? 'ios-dialog__row--stack' : ''}">${actions.map(btn).join('')}</div>
         </div>`;

    const field = root.querySelector('.ios-dialog__input');
    const close = value => {
      root.classList.add('ios-dialog--out');
      setTimeout(() => root.remove(), 200);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const pick = a => {
      if (!a || a.style === 'cancel') return close(null);
      close(field ? field.value : a.value);
    };
    const onKey = ev => {
      if (ev.key === 'Escape') close(null);
      if (ev.key === 'Enter' && field) { ev.preventDefault(); pick(main[main.length - 1]); }
    };
    root.addEventListener('click', ev => {
      ev.stopPropagation();
      const b = ev.target.closest('.ios-dialog__btn');
      if (b) { haptic(); return pick(actions[+b.dataset.i]); }
      if (ev.target.classList.contains('ios-dialog__backdrop') && type === 'sheet') close(null);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    if (field) setTimeout(() => { field.focus(); field.select(); }, 60);
  });
}

function confirmSheet(title, message, label, destructive = true) {
  return dialog({ type: 'sheet', title, message, actions: [
    { label, value: true, style: destructive ? 'destructive' : 'preferred' },
    { label: 'Annuler', style: 'cancel' },
  ] }).then(v => v === true);
}

async function askNumber({ title, message, value, unit, min, max, decimal = false }) {
  const raw = await dialog({ title, message, input: { value, unit, decimal }, actions: [
    { label: 'Annuler', style: 'cancel' },
    { label: 'OK', style: 'preferred' },
  ] });
  if (raw === null || raw === '') return null;
  const v = decimal ? parseFloat(raw) : parseInt(raw, 10);
  if (isNaN(v) || v < min || v > max) { showToast(`Valeur entre ${min} et ${max}`); return null; }
  return v;
}

// Retour haptique : vibrate() sur Android ; sur iOS 18+, basculer un <input switch> déclenche le Taptic Engine
function haptic() {
  if (data.vibrateOn === false) return;
  if (navigator.vibrate) { navigator.vibrate(8); return; }
  try {
    const label = document.createElement('label');
    const sw    = document.createElement('input');
    sw.type = 'checkbox'; sw.setAttribute('switch', '');
    label.appendChild(sw);
    label.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(label);
    label.click();
    label.remove();
  } catch {}
}

// TEMP-LOT2 début : icônes minimales en attendant le sprite du lot 2
function icon(name, size = 22) {
  const P = {
    'plus': '<path d="M12 5v14M5 12h14"/>',
    'minus': '<path d="M5 12h14"/>',
    'checkmark': '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    'ellipsis': '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    'xmark': '<path d="M6 6l12 12M18 6L6 18"/>',
    'timer': '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M10 2h4"/>',
  };
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
// TEMP-LOT2 fin

// ═══════════════════════════════════════════════════════════
//  Programme definitions
// ═══════════════════════════════════════════════════════════

const PROGRAMMES = {
  ppl: {
    name: 'PPL', desc: 'Push · Pull · Legs', icon: '🏋️',
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
    name: 'Full Body', desc: 'Corps entier · 3×/semaine', icon: '⚡',
    sessions: {
      fullbody: { label: 'Full Body', icon: '⚡', desc: 'Corps entier', color: '#06b6d4' },
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

// Recalcule PR, 1RM estimé et dernière série de chaque exercice à partir de l'historique
function recomputePRFromHistory(d = data) {
  Object.entries(d.programmes).forEach(([progKey, prog]) => {
    Object.entries(prog.exercises || {}).forEach(([cat, exercises]) => {
      if (!Array.isArray(exercises)) return;
      exercises.forEach(ex => { ex.pr = null; ex.est1RM = null; ex.lastWeight = ''; ex.lastReps = ''; });
      const sessions = (d.history || [])
        .filter(h => (h.programme || 'ppl') === progKey && h.category === cat)
        .sort((a, b) => a.date - b.date);
      sessions.forEach(session => {
        (session.exercises || []).forEach(histEx => {
          const exData = exercises.find(e => sameEx(e, histEx));
          if (!exData) return;
          (histEx.sets || []).forEach(s => {
            const w  = parseFloat(s.weight) || 0;
            const r  = parseInt(s.reps)     || 0;
            exData.lastWeight = s.weight;
            exData.lastReps   = s.reps;
            const pw = parseFloat(exData.pr?.weight) || 0;
            const pr = parseInt(exData.pr?.reps)     || 0;
            if (w > pw || (w === pw && r > pr)) exData.pr = { weight: s.weight, reps: s.reps };
            const new1RM = calc1RM(s.weight, s.reps);
            if (new1RM && (!exData.est1RM || new1RM > exData.est1RM)) exData.est1RM = new1RM;
          });
        });
      });
    });
  });
}

// Dernière séance (programme + catégorie) qui contient cet exercice : { h, ex } ou null
function lastPerf(progKey, cat, exLike, d = data) {
  for (const h of d.history || []) {
    if ((h.programme || 'ppl') !== progKey || h.category !== cat) continue;
    const ex = (h.exercises || []).find(e => sameEx(e, exLike));
    if (ex && ex.sets?.length) return { h, ex };
  }
  return null;
}

// Identifiant stable pour un exercice connu par son seul nom (exercice ajouté en cours de route)
function resolveExId(progKey, cat, name, d = data) {
  const byName = { name };
  const inProg = (d.programmes[progKey]?.exercises?.[cat] || []).find(e => normName(e.name) === normName(name));
  if (inProg) return inProg.id;
  for (const h of d.history || []) {
    if ((h.programme || 'ppl') !== progKey || h.category !== cat) continue;
    const ex = (h.exercises || []).find(e => e.exId && sameEx({ name: e.name }, byName));
    if (ex) return ex.exId;
  }
  return 'n:' + normName(name);
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

const BACKUP_KEY = 'ppl_v2_backup';
const SCHEMA     = 3;

// Nettoie une donnée venue du stockage ou d'un import : retire ce qui ferait planter l'app,
// sans toucher aux champs valides (idempotent).
function sanitizeData(d) {
  const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
  if (!PROGRAMMES[d.activeProgramme]) d.activeProgramme = 'ppl';
  if (!isObj(d.programmes)) d.programmes = {};
  Object.keys(d.programmes).forEach(k => {
    const p = d.programmes[k];
    if (!isObj(p)) { delete d.programmes[k]; return; }
    if (!isObj(p.exercises)) p.exercises = {};
    if (!isObj(p.timers))    p.timers    = {};
    if (!isObj(p.cooldowns)) p.cooldowns = {};
    Object.keys(p.exercises).forEach(cat => {
      if (!Array.isArray(p.exercises[cat])) { p.exercises[cat] = []; return; }
      p.exercises[cat] = p.exercises[cat].filter(ex => isObj(ex) && typeof ex.name === 'string' && ex.name.trim());
      p.exercises[cat].forEach(ex => {
        if (!ex.id) ex.id = uid();
        const sets = parseInt(ex.sets);
        ex.sets = sets >= 1 && sets <= 10 ? sets : 3;
      });
    });
    Object.keys(p.timers).forEach(cat => { if (p.timers[cat] != null && !Number.isFinite(p.timers[cat])) p.timers[cat] = null; });
  });
  if (!isObj(d.customSessions)) d.customSessions = {};
  Object.keys(d.customSessions).forEach(k => {
    const cs = d.customSessions[k];
    if (!isObj(cs)) { delete d.customSessions[k]; return; }
    if (typeof cs.label !== 'string' || !cs.label.trim()) cs.label = 'Séance';
    if (typeof cs.icon !== 'string') cs.icon = '🏋️';
    if (typeof cs.desc !== 'string') cs.desc = '';
    if (!/^#[0-9a-f]{6}$/i.test(cs.color || '')) cs.color = '#8E8E93';
  });
  const rest = parseInt(d.defaultRest);
  d.defaultRest = rest >= 10 && rest <= 600 ? rest : 90;
  if (d.unit !== 'kg' && d.unit !== 'lbs') d.unit = 'kg';
  if (!Array.isArray(d.history)) d.history = [];
  d.history = d.history.filter(h => {
    if (!isObj(h)) return false;
    if (typeof h.date === 'string') { const t = Number(h.date) || Date.parse(h.date); if (Number.isFinite(t)) h.date = t; }
    if (!Number.isFinite(h.date) || !Array.isArray(h.exercises) || typeof h.category !== 'string') return false;
    if (!h.id) h.id = uid();
    h.exercises = h.exercises.filter(ex => isObj(ex) && typeof ex.name === 'string');
    h.exercises.forEach(ex => {
      if (!Array.isArray(ex.sets)) ex.sets = [];
      ex.sets = ex.sets.filter(st => isObj(st) && Number.isInteger(parseInt(st.reps)) && parseInt(st.reps) >= 0);
      ex.sets.forEach(st => {
        st.reps = String(parseInt(st.reps));
        if (st.weight == null || st.weight === '' || !Number.isFinite(parseFloat(st.weight))) st.weight = '';
      });
    });
    return true;
  });
  return d;
}

// rawJson : texte stocké avant migration, sauvegardé tel quel dans ppl_v2_backup
function normalizeData(d, rawJson = null) {
  if (!d.activeProgramme) d.activeProgramme = 'ppl';
  if (!d.programmes)      d.programmes = {};
  if (!d.programmes.ppl)  d.programmes.ppl = makeProgData('ppl');
  if (!d.customSessions)  d.customSessions = {};
  if (!d.defaultRest)     d.defaultRest = 90;
  if (!d.unit)            d.unit = 'kg';
  if (d.soundOn   == null) d.soundOn   = true;
  if (d.vibrateOn == null) d.vibrateOn = true;
  if (!Array.isArray(d.history)) d.history = [];
  sanitizeData(d);

  // Schéma 3 : identifiant stable (exId) sur chaque exercice de l'historique
  if ((d.schema || 2) < 3) {
    if (rawJson) { try { localStorage.setItem(BACKUP_KEY, rawJson); } catch {} }
    d.history.forEach(h => {
      const list = d.programmes[h.programme || 'ppl']?.exercises?.[h.category] || [];
      h.exercises.forEach(ex => {
        if (ex.exId) return;
        const found = list.find(e => normName(e.name) === normName(ex.name));
        ex.exId = found ? found.id : 'n:' + normName(ex.name);
      });
    });
    // Les PR ont pu être écrits par une séance non terminée (versions précédentes)
    try { recomputePRFromHistory(d); } catch {}
    delete d._prRecomputed;
    d.schema = SCHEMA;
  }
  d.history.sort((a, b) => b.date - a.date);
  return d;
}

// Lève une exception si la donnée stockée est illisible (écran de secours)
function loadData() {
  const raw = localStorage.getItem(KEY);
  if (raw) return sanitizeData(normalizeData(JSON.parse(raw), raw));

  // Migration depuis ppl_v1
  try {
    const rawV1 = localStorage.getItem('ppl_v1');
    if (rawV1) {
      const old = JSON.parse(rawV1);
      if (old.exercises) {
        const d = makeDefaultData();
        d.programmes.ppl.exercises = old.exercises;
        d.programmes.ppl.timers   = old.timers || { push: null, pull: null, legs: null };
        d.defaultRest = old.defaultRest || 90;
        d.history     = (old.history || []).map(h => ({ ...h, programme: 'ppl' }));
        return normalizeData(d);
      }
    }
  } catch {}

  const d = makeDefaultData();
  d.schema = SCHEMA;
  return d;
}

// Renvoie false si l'écriture échoue (stockage plein) ; quiet = pas de toast
let dataBroken = false;
function save(quiet = false) {
  if (dataBroken) return false;
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
  catch {
    if (!quiet) showToast('Stockage plein : exporte tes données', { duration: 4000 });
    return false;
  }
}

// ── Séance en cours : persistée pour survivre à la fermeture de l'app ──
const SESSION_KEY = 'ppl_active_session';

let persistWarned = false; // un seul avertissement « stockage plein » par séance
function persistSession() {
  try {
    if (!activeSession) { localStorage.removeItem(SESSION_KEY); return; }
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      activeSession, sessionNotes,
      rest: restActive ? { endTime: restEndTime, minimized: restMinimized, total: restTotal } : null,
    }));
  } catch {
    if (activeSession && !persistWarned) {
      persistWarned = true;
      showToast('Stockage plein : la séance n\'est plus sauvegardée', { duration: 4000 });
    }
  }
}

// Records de chaque exercice au démarrage de la séance : les badges s'y comparent
function computeBaseline(sess) {
  const baseline = {};
  const list = data.programmes[sess.programme]?.exercises?.[sess.category] || [];
  sess.exercises.forEach(ex => {
    const exData = ex.exId && list.find(e => e.id === ex.exId);
    if (!exData) return;
    baseline[ex.exId] = {
      prW:  parseFloat(exData.pr?.weight) || 0,
      prR:  parseInt(exData.pr?.reps)     || 0,
      e1rm: exData.est1RM || 0,
    };
  });
  return baseline;
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved?.activeSession?.exercises)) return false;
    activeSession = saved.activeSession;
    sessionNotes  = saved.sessionNotes || '';
    // Séance commencée avec une version précédente : on complète ce qui manque
    if (!activeSession.programme) activeSession.programme = 'ppl';
    if (!activeSession.startedAt) activeSession.startedAt = Date.now();
    activeSession.exercises.forEach(ex => {
      if (!Array.isArray(ex.sets)) ex.sets = [];
      if (ex.sets.some(st => !('prev' in st))) {
        const last = lastPerf(activeSession.programme, activeSession.category, ex);
        ex.sets.forEach((st, i) => {
          if (!('prev' in st)) st.prev = last?.ex.sets[i] ? { weight: last.ex.sets[i].weight, reps: last.ex.sets[i].reps } : null;
        });
      }
    });
    if (!activeSession.baseline) activeSession.baseline = computeBaseline(activeSession);
    const endTime = saved.rest ? Number(saved.rest.endTime) : 0;
    if (endTime > Date.now()) {
      restActive    = true;
      restMinimized = !!saved.rest.minimized;
      restEndTime   = endTime;
      restTimeLeft  = Math.ceil((endTime - Date.now()) / 1000);
      restTotal     = Number(saved.rest.total) || Math.max(restTimeLeft, data.defaultRest);
      resumeRestCountdown();
    }
    return true;
  } catch { activeSession = null; return false; }
}

// Programme auquel appartient la séance en cours (peut différer du programme affiché)
function sessProg() {
  return (activeSession && data.programmes[activeSession.programme]) || prog();
}

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
  if (progId === 'custom') {
    const cs = data.customSessions[cat];
    if (!cs) return { label: esc(cat), icon: '🏋️', desc: '', color: '#666666' };
    return { ...cs, label: esc(cs.label), icon: esc(cs.icon), desc: esc(cs.desc) };
  }
  return PROGRAMMES[progId]?.sessions[cat] || { label: cat, icon: '🏋️', desc: '', color: '#666666' };
}

// Libellé brut (non échappé) pour les textes affichés via textContent
function rawLabel(cat, progId) {
  progId = progId || data.activeProgramme;
  if (progId === 'custom') return data.customSessions[cat]?.label || cat;
  return PROGRAMMES[progId]?.sessions[cat]?.label || cat;
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
  return String(Math.round(v * 100) / 100);
}

// display input → kg stored string
function storeW(val) {
  if (val === '' || val == null) return '';
  const v = parseFloat(String(val).replace(',', '.'));
  if (isNaN(v)) return '';
  if (data.unit === 'lbs') return String(Math.round(v / KG_TO_LBS * 1000) / 1000); // précision pour retomber sur la valeur saisie
  return String(v);
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
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');

function themePref() {
  try { return localStorage.getItem('ppl_theme') || 'auto'; } catch { return 'auto'; }
}

function applyTheme(theme) {
  try { localStorage.setItem('ppl_theme', theme); } catch {}
  const light = theme === 'light' || (theme === 'auto' && !darkMQ.matches);
  document.body.classList.toggle('light', light);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = light ? '#ffffff' : '#0a0a0a';
}
applyTheme(themePref());
darkMQ.addEventListener?.('change', () => { if (themePref() === 'auto') { applyTheme('auto'); if (view === 'stats') render(); } });

// Donnée illisible : l'app démarre sur une donnée vide sans rien écrire, puis affiche l'écran de secours
let loadError = null;
let data;
try { data = loadData(); }
catch (err) { loadError = err; dataBroken = true; data = makeDefaultData(); }
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
let restEditEi    = null;  // exercice dont on règle le repos (feuille)
let editingSet    = null;  // { ei, si } — série validée rouverte en édition sur place
let restSheetOpen = false; // feuille détaillée du repos ouverte
let restTotal     = 0;     // durée totale du repos en cours (anneau de progression)
let lastSummary   = null;  // bilan de la séance qui vient d'être enregistrée
const openDone    = new WeakSet(); // exercices terminés dépliés
let editExIdx     = null;
let statsCat      = firstSession();
let statsMode     = 'volume';   // 'volume' | 'charge' | '1rm'
let statsView     = 'progress'; // 'progress' | 'overview'
let statsYear     = new Date().getFullYear();
let statsMonth    = null;       // null = vue annuelle
let addCat        = firstSession();
let addDate       = localISO();
let addSets       = {};
let addExtras     = [];  // exercices hors programme dans une séance passée : { key, name, exId }
let addProg       = 'ppl'; // programme de la séance passée (celui de la séance modifiée)
let addPrev       = {};  // valeurs de la dernière séance, affichées en placeholder
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
}

function validationSound() { if (data.soundOn !== false) beep(660, .1); }
function finishSound()     { if (data.soundOn !== false) { beep(880, .1); setTimeout(() => beep(1320, .25), 160); } }

// ═══════════════════════════════════════════════════════════
//  Render dispatcher
// ═══════════════════════════════════════════════════════════

let renderedView = null;
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
  else if (view === 'summary')     app.innerHTML = renderSummary(); // ROUTE-LOT3 : bilan de fin (#train/summary)

  if (view === 'stats') setTimeout(drawCharts, 0);

  if (view === 'session') {
    const sc = $('.session-content');
    if (sc) sc.scrollTop = scrollTop;
    afterSessionRender(renderedView !== 'session'); // ROUTE-LOT3 : centre la série courante en entrant dans la séance
  }
  renderedView = view;
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

  let liveBanner = '';
  if (activeSession) {
    const lm    = sessionMeta(activeSession.category, activeSession.programme);
    const total = activeSession.exercises.reduce((a, ex) => a + ex.sets.length, 0);
    const done  = activeSession.exercises.reduce((a, ex) => a + ex.sets.filter(st => st.done).length, 0);
    liveBanner = `
      <button class="live-banner" data-action="resume-session" style="--cat-color:${lm.color}">
        <span class="live-banner__dot"></span>
        <span class="live-banner__body">
          <span class="live-banner__title">${lm.icon} ${lm.label} en cours</span>
          <span class="live-banner__sub">${done}/${total} séries · <span id="banner-elapsed">${fmtDuration(Date.now() - activeSession.startedAt)}</span></span>
        </span>
        <span class="live-banner__cta">Reprendre</span>
      </button>`;
  }

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
        ${computeStreak() > 0 ? `<div class="streak-badge" title="${computeStreak()} semaines consécutives actives" aria-label="${computeStreak()} semaines consécutives actives">🔥 ${computeStreak()}</div>` : ''}
        <div class="header-actions">
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
      <div class="cards">${liveBanner}${cards || emptyCustom}<div class="dashboard__brand">MDLF Training</div></div>
    </div>`;
}

function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    if (activeSession) {
      const el = $('#session-elapsed') || $('#banner-elapsed');
      if (el) el.textContent = fmtDuration(Date.now() - activeSession.startedAt);
      const ck = $('#session-clock'); // lot 4 : chrono de la séance en m:ss
      if (ck) ck.textContent = fmtClock(Date.now() - activeSession.startedAt);
    }
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
      ? Object.values(data.customSessions || {}).map(s => esc(s.label)).join(' · ')
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
            <span class="custom-session-icon" style="color:${esc(s.color)}">${esc(s.icon)}</span>
            <div class="custom-session-info">
              <div class="custom-session-name">${esc(s.label)}</div>
              ${s.desc ? `<div class="custom-session-desc">${esc(s.desc)}</div>` : ''}
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
        <input type="text" id="csName" class="form-input" value="${esc(existing.label)}"
               placeholder="Ex : Séance A, Chest, Full Body…" autocomplete="off">
        <label class="form-label">Icône</label>
        <input type="text" id="csIcon" class="form-input" value="${esc(existing.icon || '🏋️')}"
               placeholder="🏋️" style="font-size:22px;text-align:center">
        <label class="form-label">Description (optionnel)</label>
        <input type="text" id="csDesc" class="form-input" value="${esc(existing.desc)}"
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

// Séries d'un exercice pré-remplies série par série avec la dernière séance (sinon la dernière série faite)
function buildSets(progKey, cat, exLike, n, fallback = {}) {
  const prevEx = lastPerf(progKey, cat, exLike)?.ex;
  return Array.from({ length: n }, (_, i) => {
    const src  = prevEx?.sets[i] ?? prevEx?.sets.at(-1) ?? { weight: fallback.lastWeight || '', reps: fallback.lastReps || '' };
    const prev = prevEx?.sets[i];
    return {
      weight: src.weight ?? '',
      reps:   src.reps   ?? '',
      plannedWeight: src.weight ?? '',
      prev:   prev ? { weight: prev.weight, reps: prev.reps } : null,
      done:   false,
    };
  });
}

function startSession(cat) {
  sessionNotes  = '';
  persistWarned = false;
  editingSet    = null;
  const progKey = data.activeProgramme;
  const exList  = prog().exercises[cat] || [];
  activeSession = {
    category:  cat,
    programme: progKey,
    startedAt: Date.now(),
    exercises: exList.map(ex => ({ exId: ex.id, name: ex.name, sets: buildSets(progKey, cat, ex, ex.sets, ex) })),
  };
  activeSession.baseline = computeBaseline(activeSession);
  view = 'session';
  persistSession();
  render();
  requestWakeLock();
}

function endSession() {
  clearRest(); restActive = false; restMinimized = false;
  closeSessSheets();
  activeSession = null;
  sessionNotes  = '';
  editingSet    = null;
  persistWarned = false;
  persistSession();
  releaseWakeLock();
  maybeShowUpdateBanner();
}

// ── Petites aides de la séance ───────────────────────────────

// Charge affichée en texte (virgule décimale), sans unité
function wTxt(kg) { return dispW(kg).replace('.', ','); }

// Chrono de séance : « 12:34 », « 1:02:09 » au-delà d'une heure
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// Durée de repos : « 1:30 »
function fmtSecs(secs) { return fmtClock(secs * 1000); }

// Exercice du programme correspondant à un exercice de la séance (null s'il a été ajouté en cours de route)
function sessExData(ex) {
  return ex?.exId ? (sessProg().exercises[activeSession.category] || []).find(e => e.id === ex.exId) || null : null;
}

function exRest(ex) {
  return sessExData(ex)?.rest ?? ex?.rest ?? data.defaultRest;
}

// Série courante : la première non faite de l'exercice en cours, sinon la première non faite de la séance
function currentSet() {
  if (!activeSession) return null;
  const xs   = activeSession.exercises;
  const pick = ei => { const si = xs[ei]?.sets.findIndex(s => !s.done) ?? -1; return si >= 0 ? { ei, si } : null; };
  const last = activeSession.lastEi;
  if (Number.isInteger(last) && pick(last)) return pick(last);
  for (let ei = 0; ei < xs.length; ei++) { const c = pick(ei); if (c) return c; }
  return null;
}

// « Développé incliné · S1 · 30 kg × 10 »
function nextSetText() {
  const cur = currentSet();
  if (!cur) return '';
  const ex = activeSession.exercises[cur.ei], s = ex.sets[cur.si];
  const w  = s.weight !== '' && s.weight != null ? `${wTxt(s.weight)} ${unitLbl()} × ` : '';
  return `${ex.name} · S${cur.si + 1}${s.reps !== '' ? ` · ${w}${s.reps}` : ''}`;
}

// Puce « ↑ +2,5 kg » : toutes les séries de la dernière fois ont atteint le haut de la fourchette
function bumpReady(ex) {
  if (ex.bumped || ex.sets.every(s => s.done)) return false;
  const prevs = ex.sets.map(s => s.prev).filter(Boolean);
  if (!prevs.length || prevs.length < Math.min(ex.sets.length, 2)) return false;
  const repMax = sessExData(ex)?.repMax ?? 12;
  return prevs.every(p => (parseInt(p.reps) || 0) >= repMax && (parseFloat(p.weight) || 0) > 0);
}
function bumpLabel() { return data.unit === 'lbs' ? '+5 lb' : '+2,5 kg'; }

// Ligne repliée d'un exercice terminé : « 4 × 8 · 32,5 kg » (reps différentes : « 10/10/9/8 »)
function doneSummary(ex) {
  const reps = ex.sets.map(s => String(s.reps));
  const same = reps.every(r => r === reps[0]);
  const maxW = Math.max(0, ...ex.sets.map(s => parseFloat(s.weight) || 0));
  return `${ex.sets.length} × ${same ? reps[0] : reps.join('/')}${maxW ? ` · ${wTxt(maxW)} ${unitLbl()}` : ''}`;
}

// Icône de médaille (records)
function medalSvg(size = 20) {
  return `<svg class="medal" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7.5 2h3l1.5 4.5L13.5 2h3l-2.6 7.2A6 6 0 1 1 10.1 9.2z" fill="currentColor" opacity=".55"/>
    <circle cx="12" cy="15" r="6" fill="currentColor"/>
    <path d="M12 11.8l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z" fill="var(--cell, #1c1c1e)"/>
  </svg>`;
}

// ── Rendu de la séance ───────────────────────────────────────

function renderSession() {
  const { category: cat } = activeSession;
  const meta = sessionMeta(cat, activeSession.programme);

  const totalSets = activeSession.exercises.reduce((a, ex) => a + ex.sets.length, 0);
  const doneSets  = activeSession.exercises.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0);
  const pct       = totalSets ? Math.round(doneSets / totalSets * 100) : 0;
  const cur       = currentSet();

  const exHtml = activeSession.exercises.map((ex, ei) => renderExerciseCard(ex, ei, cur)).join('');

  return `
    <div class="view session ${restActive ? 'session--resting' : ''}" style="--cat-color:${meta.color}">
      <header class="header header--session">
        <button class="icon-btn" data-action="back" aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <div class="header__center">
          <div class="header__title">${meta.icon} ${meta.label}</div>
          <div class="header__sub session-sub num"><span id="session-count">${doneSets}/${totalSets}</span> · <span id="session-clock">${fmtClock(Date.now() - activeSession.startedAt)}</span></div>
        </div>
        <button class="btn--finish session-finish" data-action="finish-session">Terminer</button>
      </header>
      <div class="progress-bar session-progress" role="progressbar" aria-label="Séries validées" aria-valuemin="0" aria-valuemax="${totalSets}" aria-valuenow="${doneSets}">
        <div class="progress-bar__fill" style="width:${pct}%"></div>
      </div>
      <div class="session-content">
        ${exHtml}
        <button class="session-add-ex-btn" data-action="add-session-ex">${icon('plus', 20)} Ajouter un exercice</button>
      </div>
    </div>
    ${renderRestOverlay()}`;
}

function renderExerciseCard(ex, ei, cur) {
  const baseline = activeSession.baseline || {};
  const exData   = sessExData(ex);
  const doneN    = ex.sets.filter(s => s.done).length;
  const allDone  = ex.sets.length > 0 && doneN === ex.sets.length;
  const records  = ex.sets.filter(s => s.done && recordLabel(s, baseline[ex.exId])).length;

  // Exercice terminé : une ligne de résumé qui se déplie au tap
  if (allDone && !openDone.has(ex)) {
    return `
      <div class="exercise-block ex-card ex-card--collapsed" data-ei="${ei}">
        <button class="ex-summary" data-action="toggle-ex" data-ei="${ei}" aria-expanded="false">
          <span class="ex-summary__text">
            <span class="ex-summary__name">${esc(ex.name)}</span>
            <span class="ex-summary__line num">${doneSummary(ex)}${records ? ` · ${medalSvg(14)}` : ''}</span>
          </span>
          <span class="set-check set-check--done ex-summary__check">${icon('checkmark', 18)}</span>
        </button>
      </div>`;
  }

  // Volume comparé au même nombre de séries que la dernière fois : jamais rouge en cours de séance
  const prevSets  = lastPerf(activeSession.programme, activeSession.category, ex)?.ex.sets || [];
  const doneSets  = ex.sets.filter(s => s.done);
  const exCurVol  = setsVolume(doneSets);
  const exPrevVol = setsVolume(prevSets.slice(0, doneSets.length));
  const exDelta   = exCurVol - exPrevVol;
  const volHtml   = exCurVol > 0 && exPrevVol > 0 && exDelta !== 0
    ? ` · <span class="ex-vol__delta ${exDelta > 0 ? 'ex-vol__delta--up' : ''}">${exDelta > 0 ? '+' : '−'}${fmtVolume(Math.abs(exDelta))}</span>` : '';

  const pr   = exData?.pr;
  const sub  = `${pr ? `<span class="num">Record ${wTxt(pr.weight)} × ${esc(pr.reps)}</span> · ` : ''}<button class="ex-rest-link num" data-action="set-ex-rest" data-ei="${ei}" aria-label="Repos ${fmtSecs(exRest(ex))}, modifier">Repos ${fmtSecs(exRest(ex))}</button>${volHtml}`;
  const chip = bumpReady(ex) ? `<button class="bump-chip" data-action="bump-weight" data-ei="${ei}" aria-label="Augmenter la charge de ${bumpLabel()}">↑ ${bumpLabel()}</button>` : '';

  const rows = ex.sets.map((s, si) => renderSetRow(ex, ei, s, si, cur)).join('');

  return `
    <div class="exercise-block ex-card ${allDone ? 'ex-card--done' : ''}" data-ei="${ei}">
      <div class="ex-card__head">
        ${allDone
          ? `<button class="ex-card__name ex-card__name--btn" data-action="toggle-ex" data-ei="${ei}" aria-expanded="true">${esc(ex.name)}</button>`
          : `<h2 class="ex-card__name">${esc(ex.name)}</h2>`}
        ${chip}
        <span class="ex-card__count num" aria-label="${doneN} séries sur ${ex.sets.length}">${doneN}/${ex.sets.length}</span>
        <button class="ex-card__more" data-action="ex-menu" data-ei="${ei}" aria-label="Options de ${esc(ex.name)}">${icon('ellipsis', 22)}</button>
      </div>
      <div class="ex-card__sub">${sub}</div>
      <div class="sets" role="table" aria-label="Séries de ${esc(ex.name)}">
        <div class="sets__head" role="row">
          <span role="columnheader">Série</span><span role="columnheader">Préc.</span>
          <span role="columnheader">${unitLbl()}</span><span role="columnheader">Reps</span>
          <span role="columnheader" aria-label="Validée">${icon('checkmark', 14)}</span>
        </div>
        ${rows}
      </div>
      <button class="add-set-link" data-action="add-set" data-ei="${ei}">${icon('plus', 16)} Série</button>
    </div>`;
}

function renderSetRow(ex, ei, s, si, cur) {
  const prev    = s.prev ? `${s.prev.weight !== '' && s.prev.weight != null ? wTxt(s.prev.weight) + '&nbsp;× ' : ''}${esc(s.prev.reps)}` : '—';
  const editing = editingSet && editingSet.ei === ei && editingSet.si === si;
  const del     = `<button class="set-del" data-action="delete-set" data-ei="${ei}" data-si="${si}" tabindex="-1" aria-label="Supprimer la série ${si + 1}">Supprimer</button>`;
  const nm      = `${esc(ex.name)}, série ${si + 1}`;

  if (s.done && !editing) {
    const record = recordLabel(s, (activeSession.baseline || {})[ex.exId]);
    return `
      <div class="set-swipe" role="row">
        ${del}
        <div class="set-row2 set-row2--done" data-action="edit-set" data-ei="${ei}" data-si="${si}" role="button" tabindex="0"
             aria-label="${nm} : ${s.weight !== '' ? wTxt(s.weight) + ' ' + unitLbl() + ' × ' : ''}${esc(s.reps)}, validée. Modifier">
          <span class="set-n num">${si + 1}</span>
          <span class="set-prev num">${prev}</span>
          <span class="set-val num">${s.weight !== '' ? wTxt(s.weight) : '—'}</span>
          <span class="set-val num">${esc(s.reps)}</span>
          <span class="set-check-zone"><span class="set-check set-check--done">${icon('checkmark', 18)}</span></span>
          ${record ? `<span class="set-badge"><span class="pr-badge">${record}</span></span>` : ''}
        </div>
      </div>`;
  }

  const isCur = !editing && cur && cur.ei === ei && cur.si === si;
  const prevW = s.prev?.weight !== '' && s.prev?.weight != null ? dispW(s.prev.weight) : '';
  // Série validée rouverte : mêmes champs, enregistrés par le ✓
  const wAttr = editing ? 'id="editSetWeight"' : `data-action="set-weight" data-ei="${ei}" data-si="${si}"`;
  const rAttr = editing ? 'id="editSetReps"'   : `data-action="set-reps" data-ei="${ei}" data-si="${si}"`;
  const check = editing
    ? `<button class="set-check-zone" data-action="save-edit-set" aria-label="Enregistrer ${nm}"><span class="set-check set-check--edit">${icon('checkmark', 18)}</span></button>`
    : `<button class="set-check-zone" data-action="validate-set" data-ei="${ei}" data-si="${si}" aria-label="Valider ${nm}"><span class="set-check"></span></button>`;
  return `
    <div class="set-swipe" role="row">
      ${editing ? '' : del}
      <div class="set-row2 ${isCur ? 'set-row2--current' : ''} ${editing ? 'set-row2--editing' : ''}" ${isCur ? 'aria-current="step"' : ''} data-ei="${ei}" data-si="${si}">
        <span class="set-n num">${si + 1}</span>
        <span class="set-prev num">${prev}</span>
        <input type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" class="set-input num" ${wAttr}
               value="${editing ? dispW(s.weight) : dispW(s.weight)}" placeholder="${prevW || '—'}" aria-label="Charge en ${unitLbl()}, ${nm}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="${editing ? 'done' : 'next'}" autocomplete="off" class="set-input set-input--required num" ${rAttr}
               value="${esc(s.reps)}" placeholder="${esc(s.prev?.reps ?? '0')}" aria-label="Répétitions, ${nm}">
        ${check}
      </div>
    </div>`;
}

// Badge de record d'une série validée, comparée aux records d'avant la séance (jamais en cas d'égalité)
function recordLabel(s, base) {
  if (!base || !base.prR) return '';
  const w = parseFloat(s.weight) || 0;
  const r = parseInt(s.reps)     || 0;
  if (w > base.prW) return 'Record charge';
  if (w === base.prW && r > base.prR) return 'Record reps';
  const e1 = calc1RM(s.weight, s.reps);
  if (e1 && e1 > base.e1rm) return 'Record 1RM est.';
  return '';
}

// Signale un champ invalide (contour rouge, aria-invalid) et affiche le message
function flagInvalid(input, msg) {
  if (input) {
    input.classList.add('set-input--error');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
  showToast(msg);
}

function weightMsg() {
  return `Poids entre 0 et ${data.unit === 'lbs' ? '2205' : '1000'} ${unitLbl()}`;
}

// Charge saisie (unité affichée) valide ? '' (poids du corps) est accepté
function weightOk(raw) {
  if (String(raw ?? '').trim() === '') return true;
  const v = num(raw, 0, data.unit === 'lbs' ? 1000 * KG_TO_LBS + 0.5 : 1000);
  return v !== null;
}

function validateSet(ei, si) {
  const ex  = activeSession.exercises[ei];
  const s   = ex?.sets[si];
  if (!s || s.done) return;
  const rIn = document.querySelector(`[data-action="set-reps"][data-ei="${ei}"][data-si="${si}"]`);
  const wIn = document.querySelector(`[data-action="set-weight"][data-ei="${ei}"][data-si="${si}"]`);
  if (wIn && !weightOk(wIn.value)) { flagInvalid(wIn, weightMsg()); return; }
  if (num(s.reps, 1, 100, true) === null) { flagInvalid(rIn, 'Reps entre 1 et 100'); return; }
  s.reps = String(parseInt(s.reps));

  s.done = true;
  activeSession.lastEi = ei;
  editingSet = null;
  validationSound();
  haptic();

  // La série suivante garde sa valeur prévue, sauf si la charge vient d'être modifiée
  const nextSet = ex.sets[si + 1];
  const undo    = { s, next: null, nextW: null };
  if (nextSet && !nextSet.done && (parseFloat(s.weight) || 0) !== (parseFloat(s.plannedWeight) || 0)) {
    undo.next = nextSet; undo.nextW = nextSet.weight;
    nextSet.weight = s.weight;
  }

  const allDone = activeSession.exercises.every(e => e.sets.every(st => st.done));
  if (!allDone) openRest(exRest(ex), false);
  else { clearRest(); restActive = false; closeSessSheets(); }

  document.activeElement?.blur?.();
  render();
  scrollToCurrent();
  showToast(`Série ${si + 1} validée`, { action: 'Annuler', duration: 4000, onAction: () => undoValidate(undo) });
}

// « Annuler » du toast : la série redevient à faire et le repos s'arrête
function undoValidate(u) {
  if (!activeSession || !u.s.done) return;
  u.s.done = false;
  if (u.next && !u.next.done) u.next.weight = u.nextW;
  clearRest(); restActive = false;
  closeSessSheets();
  persistSession();
  render();
  scrollToCurrent();
}

// Centre la série courante à l'écran (après validation, reprise ou restauration)
function scrollToCurrent(smooth = true) {
  requestAnimationFrame(() => {
    const row = $('.set-row2--current');
    if (!row) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ block: 'center', behavior: smooth && !reduce ? 'smooth' : 'auto' });
  });
}

// Appelé par render() après l'affichage de la séance
function afterSessionRender(entering) {
  if (entering) scrollToCurrent(false);
  const a = document.activeElement;
  if (!(a && a.matches?.('.set-input'))) document.body.classList.remove('kb-open');
}

// ═══════════════════════════════════════════════════════════
//  Repos : barre non bloquante + feuille détaillée
// ═══════════════════════════════════════════════════════════

const RING_SMALL = 2 * Math.PI * 17;
const RING_BIG   = 2 * Math.PI * 100;

function restFraction() {
  return restTotal > 0 ? Math.min(1, Math.max(0, restTimeLeft / restTotal)) : 0;
}

function renderRestOverlay() {
  if (!restActive || !activeSession) return '';
  const nxt = nextSetText();
  const off  = RING_SMALL * (1 - restFraction());
  const meta = sessionMeta(activeSession.category, activeSession.programme);
  return `
    <div class="rest-mini" role="region" aria-label="Repos" style="--cat-color:${meta.color}">
      <button class="rest-mini__main" data-action="expand-rest" aria-label="Repos en cours, ouvrir le détail">
        <svg class="rest-ring rest-ring--small" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="17" class="rest-ring__track"/>
          <circle cx="20" cy="20" r="17" class="rest-ring__bar" stroke-dasharray="${RING_SMALL}" stroke-dashoffset="${off}"/>
        </svg>
        <span class="rest-mini__timer num" role="timer">${fmtSecs(restTimeLeft)}</span>
      </button>
      <button class="rest-mini__btn num" data-action="rest-adjust" data-d="-15" aria-label="Retirer 15 secondes">−15<span class="rest-mini__u">&nbsp;s</span></button>
      <button class="rest-mini__btn num" data-action="rest-adjust" data-d="15" aria-label="Ajouter 15 secondes">+15<span class="rest-mini__u">&nbsp;s</span></button>
      <button class="rest-mini__skip" data-action="skip-rest">Passer</button>
      ${nxt ? `<div class="rest-mini__next">Ensuite : ${esc(nxt)}</div>` : ''}
    </div>`;
}

function restSheetHtml() {
  const presets = [60, 90, 120, 180];
  const nxt = nextSetText();
  return `
    <div class="rs">
      <div class="rs__title">Repos</div>
      <div class="rs__ring">
        <svg class="rest-ring rest-ring--big" viewBox="0 0 220 220" aria-hidden="true">
          <circle cx="110" cy="110" r="100" class="rest-ring__track"/>
          <circle cx="110" cy="110" r="100" class="rest-ring__bar" stroke-dasharray="${RING_BIG}" stroke-dashoffset="${RING_BIG * (1 - restFraction())}"/>
        </svg>
        <div class="rs__center">
          <div class="rs__time num" role="timer">${fmtSecs(restTimeLeft)}</div>
          <div class="rs__resume num">Reprise à ${restResumeAt()}</div>
        </div>
      </div>
      <div class="rs-seg" role="group" aria-label="Durée du repos">
        ${presets.map(p => `<button class="rs-seg__btn num" data-action="set-rest" data-secs="${p}" aria-pressed="${restTotal === p}">${fmtSecs(p)}</button>`).join('')}
      </div>
      <div class="rs__adj">
        <button class="rs__round num" data-action="rest-adjust" data-d="-15" aria-label="Retirer 15 secondes">−15</button>
        <button class="rs__skip" data-action="skip-rest">Passer</button>
        <button class="rs__round num" data-action="rest-adjust" data-d="15" aria-label="Ajouter 15 secondes">+15</button>
      </div>
      ${nxt ? `<div class="rs__next">Ensuite : ${esc(nxt)}</div>` : ''}
    </div>`;
}

function restResumeAt() {
  return new Date(restEndTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function openRestSheet() {
  restSheetOpen = true;
  const root = openSessSheet({ cls: 'sess-sheet--rest', label: 'Repos', html: restSheetHtml(), onClose: () => { restSheetOpen = false; } });
  root.style.setProperty('--cat-color', sessionMeta(activeSession.category, activeSession.programme).color);
}
function closeRestSheet() { document.querySelector('.sess-sheet--rest')?._close?.(); restSheetOpen = false; }

// Met à jour chiffres et anneaux sans relancer render()
function updateRestUI() {
  const t = fmtSecs(restTimeLeft), f = restFraction();
  const mini = $('.rest-mini__timer');
  if (mini) mini.textContent = t;
  const small = $('.rest-mini .rest-ring__bar');
  if (small) small.setAttribute('stroke-dashoffset', RING_SMALL * (1 - f));
  const sheet = $('.sess-sheet--rest');
  if (sheet) {
    const el = sheet.querySelector('.rs__time');
    if (el) el.textContent = t;
    sheet.querySelector('.rest-ring__bar')?.setAttribute('stroke-dashoffset', RING_BIG * (1 - f));
    const ra = sheet.querySelector('.rs__resume');
    if (ra) ra.textContent = `Reprise à ${restResumeAt()}`;
    sheet.querySelectorAll('.rs-seg__btn').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.secs === restTotal)));
  }
}

function startRestCountdown() {
  restEndTime = Date.now() + restTimeLeft * 1000;
  resumeRestCountdown();
}

// Relance l'affichage du chrono sans toucher à l'heure de fin (retour au premier plan, restauration)
function resumeRestCountdown() {
  clearInterval(restInterval);
  restInterval = setInterval(() => {
    restTimeLeft = Math.max(0, Math.ceil((restEndTime - Date.now()) / 1000));
    updateRestUI();
    if (restTimeLeft <= 0) restFinished();
  }, 250);
}

// Fin du repos : la barre pulse, affiche « C'est reparti » 2 s, puis la série suivante est centrée
function restFinished() {
  clearRest();
  restTimeLeft = 0;
  restActive   = false;
  persistSession();
  timerDone();
  closeRestSheet();
  const bar = $('.rest-mini');
  if (bar) {
    bar.classList.add('rest-mini--done');
    bar.setAttribute('aria-live', 'assertive');
    bar.innerHTML = `<div class="rest-mini__go">C'est reparti</div>`;
    setTimeout(() => {
      if (restActive) return; // un nouveau repos a commencé entre-temps
      bar.remove();
      $('.view.session')?.classList.remove('session--resting');
    }, 2000);
  }
  if (view === 'session') {
    $('.set-row2--current')?.classList.add('set-row2--go');
    scrollToCurrent();
  }
}

function clearRest() { clearInterval(restInterval); restInterval = null; }

function removeRestUI() {
  document.querySelectorAll('.rest-mini').forEach(el => el.remove());
  $('.view.session')?.classList.remove('session--resting');
}

function openRest(secs, doRender = true) {
  restActive    = true;
  restMinimized = true;
  restTimeLeft  = secs ?? data.defaultRest;
  restTotal     = restTimeLeft;
  startRestCountdown();
  if (doRender) render();
}

function adjustRest(d) {
  if (!restActive) return;
  restEndTime += d * 1000;
  restTotal    = Math.max(15, restTotal + d);
  restTimeLeft = Math.max(0, Math.ceil((restEndTime - Date.now()) / 1000));
  haptic();
  if (restTimeLeft <= 0) { restFinished(); return; }
  updateRestUI();
  persistSession();
}

// Son : le contexte audio est créé (ou réveillé) au premier geste, iOS refuse de le démarrer depuis un minuteur
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}
document.addEventListener('pointerdown', unlockAudio, { passive: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  try { if (audioCtx?.state === 'suspended') audioCtx.resume(); } catch {}
  if (!restActive) return;
  const remaining = Math.ceil((restEndTime - Date.now()) / 1000);
  if (remaining <= 0) restFinished();
  else { restTimeLeft = remaining; resumeRestCountdown(); updateRestUI(); }
});

// ═══════════════════════════════════════════════════════════
//  Feuilles de la séance
// ═══════════════════════════════════════════════════════════

// Feuille modale simple (fond, poignée, glisser vers le bas pour fermer)
// A-UNIFIER-AVEC-SHEET-LOT3
function openSessSheet({ cls = '', label = '', html, full = false, onClose }) {
  document.querySelector(`.sess-sheet${cls ? '.' + cls : ''}`)?.remove();
  const root = document.createElement('div');
  root.className = `sess-sheet ${full ? 'sess-sheet--full' : ''} ${cls}`;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', label);
  root.innerHTML = `
    <div class="sess-sheet__backdrop"></div>
    <div class="sess-sheet__panel">
      <div class="sess-sheet__grabber" aria-hidden="true"></div>
      <div class="sess-sheet__body">${html}</div>
    </div>`;
  const panel = root.querySelector('.sess-sheet__panel');
  const body  = root.querySelector('.sess-sheet__body');
  let closed = false;
  root._close = () => {
    if (closed) return;
    closed = true;
    root.classList.add('sess-sheet--out');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => root.remove(), 220);
    onClose?.();
  };
  const onKey = ev => { if (ev.key === 'Escape') root._close(); };
  document.addEventListener('keydown', onKey);
  root.querySelector('.sess-sheet__backdrop').addEventListener('click', () => root._close());

  // Glisser vers le bas depuis le haut de la feuille (contenu en haut de son défilement)
  let drag = null;
  panel.addEventListener('pointerdown', ev => {
    if (ev.target.closest('input, textarea') || body.scrollTop > 0) return;
    drag = { y0: ev.clientY, dy: 0 };
  });
  panel.addEventListener('pointermove', ev => {
    if (!drag) return;
    drag.dy = Math.max(0, ev.clientY - drag.y0);
    if (drag.dy > 6) { panel.style.transition = 'none'; panel.style.transform = `translateY(${drag.dy}px)`; }
  });
  const end = () => {
    if (!drag) return;
    const dy = drag.dy; drag = null;
    panel.style.transition = ''; panel.style.transform = '';
    if (dy > 110) root._close();
  };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);

  document.body.appendChild(root);
  return root;
}

function closeSessSheets() {
  document.querySelectorAll('.sess-sheet').forEach(s => s._close?.());
  restSheetOpen = false;
}

// ── Repos d'un exercice : préréglages et ±15 s, sans clavier ──
function exRestSheetHtml(ei) {
  const ex = activeSession.exercises[ei];
  const v  = exRest(ex);
  return `
    <div class="rs rs--ex">
      <div class="rs__title">Repos · ${esc(ex.name)}</div>
      <div class="rs__value num" id="exRestValue">${fmtSecs(v)}</div>
      <div class="rs-seg" role="group" aria-label="Durée du repos">
        ${[60, 90, 120, 180].map(p => `<button class="rs-seg__btn num" data-action="ex-rest-set" data-secs="${p}" aria-pressed="${v === p}">${fmtSecs(p)}</button>`).join('')}
      </div>
      <div class="rs__adj">
        <button class="rs__round num" data-action="ex-rest-adj" data-d="-15" aria-label="Retirer 15 secondes">−15</button>
        <button class="rs__done" data-action="sheet-done">OK</button>
        <button class="rs__round num" data-action="ex-rest-adj" data-d="15" aria-label="Ajouter 15 secondes">+15</button>
      </div>
    </div>`;
}

function setExRest(ei, secs) {
  const ex = activeSession?.exercises[ei];
  if (!ex) return;
  secs = Math.min(600, Math.max(15, secs));
  const exData = sessExData(ex);
  if (exData) { exData.rest = secs; save(); } else ex.rest = secs;
  const val = $('#exRestValue');
  if (val) val.textContent = fmtSecs(secs);
  document.querySelectorAll('.sess-sheet--exrest .rs-seg__btn').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.secs === secs)));
  haptic();
}

// ── Ajouter (ou remplacer) un exercice : recherche dans la bibliothèque ──
let axReplaceEi = null;
let axSets      = 3;

function exerciseLibrary() {
  const seen = new Map();
  const add  = n => { const k = normName(n); if (n && !seen.has(k)) seen.set(k, n); };
  (data.history || []).slice().sort((a, b) => b.date - a.date).forEach(h => (h.exercises || []).forEach(e => add(e.name)));
  const rest = [];
  Object.values(PROGRAMMES).forEach(p => Object.values(p.defaults || {}).forEach(list => list.forEach(([n]) => rest.push(n))));
  Object.values(data.programmes || {}).forEach(p => Object.values(p.exercises || {}).forEach(list => (list || []).forEach(e => rest.push(e.name))));
  rest.sort((a, b) => a.localeCompare(b, 'fr')).forEach(add);
  return [...seen.values()];
}

function axListHtml(q) {
  const inSession = new Set((activeSession?.exercises || []).map(e => normName(e.name)));
  const nq    = normName(q);
  const items = exerciseLibrary().filter(n => !inSession.has(normName(n)) && (!nq || normName(n).includes(nq))).slice(0, 60);
  const exact = items.some(n => normName(n) === nq);
  return items.map(n => `<button class="ax__item" data-action="ax-pick" data-name="${esc(n)}">${esc(n)}</button>`).join('')
    + (q.trim() && !exact ? `<button class="ax__item ax__item--create" data-action="ax-pick" data-name="${esc(q.trim())}">${icon('plus', 18)} Créer « ${esc(q.trim())} »</button>` : '')
    + (!items.length && !q.trim() ? '<div class="ax__empty">Aucun exercice</div>' : '');
}

function openAddExSheet(replaceEi = null) {
  axReplaceEi = replaceEi;
  const rep   = replaceEi !== null ? activeSession.exercises[replaceEi] : null;
  axSets      = rep ? rep.sets.length : 3;
  const html = `
    <div class="ax">
      <div class="ax__bar">
        <button class="ax__cancel" data-action="sheet-done">Annuler</button>
        <div class="ax__title">${rep ? 'Remplacer l\'exercice' : 'Ajouter un exercice'}</div>
        <span class="ax__spacer"></span>
      </div>
      ${rep ? `<div class="ax__replacing">À la place de ${esc(rep.name)}</div>` : ''}
      <input type="search" id="axSearch" class="ax__search" placeholder="Rechercher ou créer" autocomplete="off"
             autocapitalize="sentences" enterkeyhint="done" aria-label="Rechercher un exercice">
      <div class="ax__opts">
        <div class="ax__opt">
          <span>Séries</span>
          <div class="ax-stepper">
            <button data-action="ax-sets" data-d="-1" aria-label="Une série de moins">${icon('minus', 18)}</button>
            <span id="axSets" class="num" aria-live="polite">${axSets}</span>
            <button data-action="ax-sets" data-d="1" aria-label="Une série de plus">${icon('plus', 18)}</button>
          </div>
        </div>
        ${rep ? '' : `
        <label class="ax__opt">
          <span>Ajouter au programme</span>
          <input type="checkbox" id="axToProg" class="ax-switch" role="switch">
        </label>`}
      </div>
      <div class="ax__list" id="axList" role="list">${axListHtml('')}</div>
    </div>`;
  openSessSheet({ cls: 'sess-sheet--addex', label: rep ? 'Remplacer l\'exercice' : 'Ajouter un exercice', html, full: true });
}

function pickExercise(name) {
  name = String(name || '').trim();
  if (!name || !activeSession) return;
  const { programme: sp, category: sc } = activeSession;
  const list    = sessProg().exercises[sc] || (sessProg().exercises[sc] = []);
  let inProg    = list.find(e => normName(e.name) === normName(name));
  const toProg  = $('#axToProg')?.checked;
  if (toProg && !inProg && axReplaceEi === null) {
    inProg = makeExercise(name, axSets);
    list.push(inProg);
    save();
  }
  let exId = inProg ? inProg.id : resolveExId(sp, sc, name);
  if (exId?.startsWith('n:')) exId = null; // résolu à l'enregistrement, comme avant
  const exObj = { exId, name: inProg ? inProg.name : name, sets: buildSets(sp, sc, { exId, name }, axSets, inProg || {}) };
  if (exObj.exId && !activeSession.baseline?.[exObj.exId]) {
    activeSession.baseline = { ...(activeSession.baseline || {}), ...computeBaseline({ ...activeSession, exercises: [exObj] }) };
  }
  let target;
  if (axReplaceEi !== null) {
    activeSession.exercises.splice(axReplaceEi, 1, exObj);
    target = axReplaceEi;
    showToast('Exercice remplacé');
  } else {
    activeSession.exercises.push(exObj);
    target = activeSession.exercises.length - 1;
    showToast(toProg ? 'Ajouté à la séance et au programme' : 'Ajouté à la séance');
  }
  activeSession.lastEi = null;
  closeSessSheets();
  haptic();
  persistSession();
  render();
  setTimeout(() => document.querySelector(`.ex-card[data-ei="${target}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

// ── Menu ⋯ d'un exercice ──
async function exerciseMenu(ei) {
  const ex = activeSession.exercises[ei];
  if (!ex) return;
  const last = activeSession.exercises.length - 1;
  const choice = await dialog({ type: 'sheet', title: ex.name, actions: [
    ...(ei > 0    ? [{ label: 'Monter', value: 'up' }] : []),
    ...(ei < last ? [{ label: 'Descendre', value: 'down' }] : []),
    { label: 'Remplacer l\'exercice', value: 'replace' },
    { label: 'Régler le repos', value: 'rest' },
    { label: 'Relancer le repos', value: 'restart' },
    { label: 'Retirer l\'exercice', value: 'remove', style: 'destructive' },
    { label: 'Annuler', style: 'cancel' },
  ] });
  if (!choice || !activeSession) return;
  const xs = activeSession.exercises;
  if (choice === 'up' || choice === 'down') {
    const to = choice === 'up' ? ei - 1 : ei + 1;
    [xs[ei], xs[to]] = [xs[to], xs[ei]];
    activeSession.lastEi = null;
    render();
  } else if (choice === 'replace') {
    openAddExSheet(ei);
  } else if (choice === 'rest') {
    restEditEi = ei;
    openSessSheet({ cls: 'sess-sheet--exrest', label: 'Repos', html: exRestSheetHtml(ei), onClose: () => { restEditEi = null; } });
  } else if (choice === 'restart') {
    openRest(exRest(ex));
  } else if (choice === 'remove') {
    const done = ex.sets.filter(s => s.done).length;
    if (done && !(await confirmSheet('Retirer l\'exercice ?', `Les ${done} séries validées de cet exercice ne seront pas enregistrées. Le programme ne change pas.`, 'Retirer'))) return;
    xs.splice(ei, 1);
    activeSession.lastEi = null;
    editingSet = null;
    render();
    showToast('Exercice retiré de la séance');
  }
  persistSession();
}

// ═══════════════════════════════════════════════════════════
//  Balayage d'une série vers la gauche : « Supprimer »
// ═══════════════════════════════════════════════════════════

const SWIPE_OPEN = 74, SWIPE_MIN = 80;
let swipe = null, swipeBlockClick = false;

function closeSwipes(except) {
  document.querySelectorAll('.set-swipe--open').forEach(w => {
    if (w === except) return;
    w.classList.remove('set-swipe--open');
    const r = w.querySelector('.set-row2');
    if (r) r.style.transform = '';
  });
}

document.addEventListener('pointerdown', e => {
  const row = e.target.closest?.('.set-swipe .set-row2');
  if (!row || row.classList.contains('set-row2--editing')) { if (!e.target.closest?.('.set-del')) closeSwipes(); return; }
  const wrap = row.parentElement;
  closeSwipes(wrap);
  wrap.classList.add('set-swipe--swiping');
  swipe = { row, wrap, x0: e.clientX, y0: e.clientY, dx: 0, axis: null, base: wrap.classList.contains('set-swipe--open') ? -SWIPE_OPEN : 0 };
});
document.addEventListener('pointermove', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x0, dy = e.clientY - swipe.y0;
  // Axe verrouillé après 10 px : le défilement vertical reste prioritaire
  if (!swipe.axis && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) swipe.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  if (swipe.axis !== 'x') return;
  swipe.dx = dx;
  const t = Math.min(0, Math.max(-140, swipe.base + dx));
  swipe.row.style.transition = 'none';
  swipe.row.style.transform  = `translateX(${t}px)`;
});
function endSwipe() {
  if (!swipe) return;
  const s = swipe; swipe = null;
  setTimeout(() => s.wrap.classList.remove('set-swipe--swiping'), 260);
  if (s.axis !== 'x') return;
  swipeBlockClick = true;
  setTimeout(() => { swipeBlockClick = false; }, 60);
  s.row.style.transition = '';
  const open = s.base + s.dx < -SWIPE_MIN || (s.base && s.dx < 20);
  s.wrap.classList.toggle('set-swipe--open', open);
  s.row.style.transform = open ? `translateX(${-SWIPE_OPEN}px)` : '';
  if (open) haptic();
}
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', () => {
  if (!swipe) return;
  swipe.row.style.transform = '';
  swipe.wrap.classList.remove('set-swipe--swiping');
  swipe = null;
});
// Le relâchement d'un balayage ne doit pas ouvrir la série en édition
document.addEventListener('click', e => {
  if (swipeBlockClick && e.target.closest?.('.set-row2')) { e.stopPropagation(); e.preventDefault(); }
}, true);

// ═══════════════════════════════════════════════════════════
//  Saisie au clavier
// ═══════════════════════════════════════════════════════════

// Toucher un champ sélectionne son contenu : on retape directement la valeur
document.addEventListener('focusin', e => {
  const t = e.target;
  if (!t.matches?.('.set-input')) return;
  document.body.classList.add('kb-open');
  setTimeout(() => { try { if (document.activeElement === t) t.select(); } catch {} }, 0);
});
document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (!document.activeElement?.matches?.('.set-input')) document.body.classList.remove('kb-open');
  }, 50);
});

// Entrée : du poids aux reps, puis validation de la série
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const t = e.target;
  if (!t.matches?.('.set-input') || !t.closest('.set-row2')) return;
  e.preventDefault();
  const row = t.closest('.set-row2');
  const isW = t.dataset.action === 'set-weight' || t.id === 'editSetWeight';
  if (isW) { row.querySelector('[data-action="set-reps"], #editSetReps')?.focus(); return; }
  row.querySelector('.set-check-zone')?.click();
});

// Recherche de la feuille « Ajouter un exercice »
document.addEventListener('input', e => {
  if (e.target.id === 'axSearch') {
    const list = $('#axList');
    if (list) list.innerHTML = axListHtml(e.target.value);
  }
  if (e.target.id === 'summaryNotes') summaryNotesInput(e.target.value);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'axSearch') {
    e.preventDefault();
    const q = e.target.value.trim();
    if (q) pickExercise(q);
  }
});

// ═══════════════════════════════════════════════════════════
//  Bilan de fin de séance
// ═══════════════════════════════════════════════════════════

const RECORD_RANK = { 'Record charge': 3, 'Record reps': 2, 'Record 1RM est.': 1 };

function bestSet(sets) {
  return (sets || []).reduce((b, s) => {
    const w = parseFloat(s.weight) || 0, r = parseInt(s.reps) || 0;
    if (!b || w > b.w || (w === b.w && r > b.r)) return { w, r, s };
    return b;
  }, null);
}

function buildSummary(entry, baseline) {
  const prevH = data.history.find(h => h !== entry && h.category === entry.category && (h.programme || 'ppl') === entry.programme);
  let cur = 0, prev = 0;
  const records = [], rows = [];
  entry.exercises.forEach(ex => {
    const pex = prevH?.exercises.find(e => sameEx(e, ex));
    cur  += setsVolume(ex.sets);
    prev += setsVolume(pex?.sets.slice(0, ex.sets.length) || []);
    let rec = null;
    ex.sets.forEach(s => {
      const l = recordLabel(s, baseline[ex.exId]);
      if (l && (!rec || RECORD_RANK[l] > RECORD_RANK[rec.label] || (RECORD_RANK[l] === RECORD_RANK[rec.label] && (parseFloat(s.weight) || 0) * 100 + (+s.reps) > (parseFloat(rec.s.weight) || 0) * 100 + (+rec.s.reps)))) rec = { label: l, s };
    });
    if (rec) records.push({ name: ex.name, label: rec.label, weight: rec.s.weight, reps: rec.s.reps });
    const b = bestSet(ex.sets), pb = bestSet(pex?.sets);
    const trend = !pb ? null : (b.w > pb.w || (b.w === pb.w && b.r > pb.r)) ? 'up' : (b.w === pb.w && b.r === pb.r) ? 'same' : 'down';
    rows.push({ name: ex.name, weight: b.s.weight, reps: b.s.reps, trend });
  });
  return {
    id: entry.id, programme: entry.programme, category: entry.category, date: entry.date,
    duration: entry.duration, sets: entry.exercises.reduce((a, e) => a + e.sets.length, 0),
    volume: cur, delta: prevH ? cur - prev : null, records, rows,
  };
}

function renderSummary() {
  const sm = lastSummary;
  if (!sm) { view = 'dashboard'; return renderDashboard(); }
  const meta = sessionMeta(sm.category, sm.programme);
  const h    = data.history.find(x => x.id === sm.id);
  const when = new Date(sm.date);
  const date = when.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + when.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const delta = sm.delta === null || Math.round(sm.delta) === 0 ? ''
    : `<span class="sum-tile__delta ${sm.delta > 0 ? 'sum-tile__delta--up' : ''}">${sm.delta > 0 ? '↑ +' : '↓ −'}${fmtVolume(Math.abs(sm.delta))}</span>`;
  const trend = t => t === 'up' ? '<span class="sum-trend sum-trend--up" aria-label="en progrès">↑</span>'
                   : t === 'down' ? '<span class="sum-trend sum-trend--down" aria-label="en baisse">↓</span>'
                   : t === 'same' ? '<span class="sum-trend" aria-label="identique">=</span>' : '<span class="sum-trend" aria-hidden="true"></span>';
  const wr = r => `${r.weight !== '' && r.weight != null ? `${wTxt(r.weight)} ${unitLbl()} × ` : ''}${esc(r.reps)}`;
  return `
    <div class="view summary" style="--cat-color:${meta.color}">
      <div class="summary-content">
        <div class="sum-head">
          <h1 class="sum-title">${esc(meta.label)}</h1>
          <div class="sum-date">${esc(date)}</div>
        </div>
        <div class="sum-tiles">
          <div class="sum-tile"><div class="sum-tile__label">Durée</div><div class="sum-tile__value num">${fmtDuration(sm.duration)}</div></div>
          <div class="sum-tile"><div class="sum-tile__label">Volume</div><div class="sum-tile__value num">${fmtVolume(sm.volume)}</div>${delta}</div>
          <div class="sum-tile"><div class="sum-tile__label">Séries</div><div class="sum-tile__value num">${sm.sets}</div></div>
        </div>
        ${sm.records.length ? `
        <div class="sum-section-title">Nouveaux records</div>
        <div class="sum-list sum-records">
          ${sm.records.map(r => `
            <div class="sum-row sum-record">
              ${medalSvg(24)}
              <div class="sum-row__main"><div class="sum-row__name">${esc(r.name)}</div><div class="sum-row__sub">${r.label}</div></div>
              <div class="sum-row__val num">${wr(r)}</div>
            </div>`).join('')}
        </div>` : ''}
        <div class="sum-section-title">Exercices</div>
        <div class="sum-list">
          ${sm.rows.map(r => `
            <div class="sum-row">
              <div class="sum-row__main"><div class="sum-row__name">${esc(r.name)}</div><div class="sum-row__sub">Meilleure série</div></div>
              <div class="sum-row__val num">${wr(r)}</div>
              ${trend(r.trend)}
            </div>`).join('')}
        </div>
        <div class="sum-section-title">Notes</div>
        <textarea id="summaryNotes" class="sum-notes" rows="3" placeholder="Comment s'est passée la séance ?"
                  aria-label="Notes de séance">${esc(h?.notes || '')}</textarea>
        <button class="sum-done" data-action="summary-done">Terminé</button>
      </div>
    </div>`;
}

// Notes du bilan : enregistrées au fil de la frappe
let summaryNotesTimer = null;
function summaryNotesInput(value) {
  const h = lastSummary && data.history.find(x => x.id === lastSummary.id);
  if (!h) return;
  h.notes = value.trim();
  clearTimeout(summaryNotesTimer);
  summaryNotesTimer = setTimeout(() => save(), 300);
}

function recordSound() {
  if (data.soundOn === false) return;
  [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => beep(f, i === 3 ? .35 : .12), i * 120));
}

// Fenêtre « Ajouter un exercice » de la séance passée
function knownExerciseNames() {
  const names = new Set();
  Object.values(prog().exercises).forEach(list => list.forEach(ex => names.add(ex.name)));
  (data.history || []).forEach(h => (h.exercises || []).forEach(ex => names.add(ex.name)));
  return [...names].sort((a, b) => a.localeCompare(b));
}

function renderAddExModal() {
  return `
    <div class="modal-overlay" data-action="add-ex-overlay">
      <div class="modal" style="max-width:320px;">
        <div class="modal__title">Ajouter un exercice</div>
        <label class="form-label">Nom de l'exercice</label>
        <input type="text" id="addExNameInput" class="form-input" list="knownExList"
               value="${esc(addExName)}" placeholder="Ex : Curl concentré" autocomplete="off">
        <datalist id="knownExList">
          ${knownExerciseNames().map(n => `<option value="${esc(n)}">`).join('')}
        </datalist>
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
    const last = ex.lastWeight ? `${dispW(ex.lastWeight)} ${unitLbl()} × ${esc(ex.lastReps)}` : 'Pas encore effectué';
    const pr   = ex.pr ? ` · PR: ${dispW(ex.pr.weight)} ${unitLbl()} × ${esc(ex.pr.reps)}` : '';
    const max  = (prog().exercises[editorCat] || []).length - 1;

    return `
      <div class="editor-row">
        <div class="editor-row__reorder">
          <button class="reorder-btn" data-action="move-up"   data-i="${i}" ${i === 0   ? 'disabled' : ''}>▲</button>
          <button class="reorder-btn" data-action="move-down" data-i="${i}" ${i === max ? 'disabled' : ''}>▼</button>
        </div>
        <div class="editor-row__info">
          <div class="editor-row__name">${esc(ex.name)}</div>
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
               value="${ex ? esc(ex.name) : ''}" placeholder="Ex : Curl biceps haltères" autocomplete="off">
        <label class="form-label">Nombre de séries par défaut</label>
        <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" id="modalSets" class="form-input"
               value="${ex ? ex.sets : 3}">
        <label class="form-label">Temps de repos (secondes) — optionnel</label>
        <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" id="modalRest" class="form-input"
               value="${ex?.rest || ''}" placeholder="Défaut : ${data.defaultRest}s">
        <label class="form-label">Objectif poids (${unitLbl()}) — optionnel</label>
        <input type="text" inputmode="decimal" autocomplete="off" id="modalTarget" class="form-input"
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

// Données du programme de la séance passée (une séance d'un autre programme reste modifiable)
function addProgData() {
  return data.programmes[addProg] || { exercises: {}, timers: {}, cooldowns: {} };
}

// Valeurs vides : la dernière séance sert de placeholder (bouton « Reprendre la dernière séance »)
function initAddSets(cat) {
  addSets   = {};
  addPrev   = {};
  addExtras = [];
  (addProgData().exercises[cat] || []).forEach(ex => {
    const prevSets = lastPerf(addProg, cat, ex)?.ex.sets || [];
    addPrev[ex.id] = prevSets;
    addSets[ex.id] = Array.from({ length: ex.sets }, () => ({ weight: '', reps: '' }));
  });
}

function addHasReps() {
  return Object.values(addSets).some(sets => (sets || []).some(s => String(s.reps ?? '').trim() !== ''));
}

function renderAddSession() {
  const exercises = addProgData().exercises[addCat] || [];
  const today     = localISO();
  const keys      = sessionKeys(addProg);
  const hasPrev   = !editSessionId && exercises.some(ex => addPrev[ex.id]?.length);

  const catBtns = keys.map(c => {
    const meta    = sessionMeta(c, addProg);
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
    const prev = addPrev[ex.id] || [];
    const setsHtml = sets.map((s, si) => `
      <div class="set-row set-row--active">
        <span class="set-num">S${si + 1}</span>
        <div class="input-group">
          <input type="text" inputmode="decimal" autocomplete="off" class="set-input" placeholder="${prev[si]?.weight ? dispW(prev[si].weight) : '—'}" aria-label="Charge série ${si + 1}"
                 value="${dispW(s.weight)}" data-action="add-weight" data-exid="${ex.id}" data-si="${si}">
          <span class="input-unit">${unitLbl()}</span>
        </div>
        <div class="input-group">
          <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" class="set-input set-input--required" placeholder="${prev[si] ? esc(prev[si].reps) : '0'}" aria-label="Répétitions série ${si + 1}"
                 value="${esc(s.reps)}" data-action="add-reps" data-exid="${ex.id}" data-si="${si}">
          <span class="input-unit">reps</span>
        </div>
      </div>`).join('');

    return `
      <div class="exercise-block">
        <div class="exercise-header">
          <span class="exercise-name">${esc(ex.name)}</span>
          <div style="display:flex;gap:6px">
            <button class="sets-adj" data-action="add-set-row" data-exid="${ex.id}">+</button>
            <button class="sets-adj" data-action="rem-set-row" data-exid="${ex.id}"
                    ${sets.length <= 1 ? 'disabled' : ''} style="opacity:${sets.length <= 1 ? .3 : 1}">−</button>
          </div>
        </div>
        ${setsHtml}
      </div>`;
  }).join('');

  const extrasHtml = addExtras.map(({ key, name }) => {
    const sets = addSets[key] || [];
    const setsHtml = sets.map((s, si) => `
      <div class="set-row set-row--active">
        <span class="set-num">S${si + 1}</span>
        <div class="input-group">
          <input type="text" inputmode="decimal" autocomplete="off" class="set-input" placeholder="—" aria-label="Charge série ${si + 1}"
                 value="${dispW(s.weight)}" data-action="add-weight" data-exid="${key}" data-si="${si}">
          <span class="input-unit">${unitLbl()}</span>
        </div>
        <div class="input-group">
          <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" class="set-input set-input--required" placeholder="0" aria-label="Répétitions série ${si + 1}"
                 value="${esc(s.reps)}" data-action="add-reps" data-exid="${key}" data-si="${si}">
          <span class="input-unit">reps</span>
        </div>
      </div>`).join('');

    return `
      <div class="exercise-block">
        <div class="exercise-header">
          <span class="exercise-name">${esc(name)}</span>
          <div style="display:flex;gap:6px">
            <button class="sets-adj" data-action="add-set-row" data-exid="${key}">+</button>
            <button class="sets-adj" data-action="rem-set-row" data-exid="${key}"
                    ${sets.length <= 1 ? 'disabled' : ''} style="opacity:${sets.length <= 1 ? .3 : 1}">−</button>
            <button class="sets-adj" data-action="rem-extra-ex" data-exid="${key}" title="Retirer">✕</button>
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
        <button class="btn--finish" data-action="save-past-session" ${addHasReps() ? '' : 'disabled'}>Enregistrer</button>
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
        ${hasPrev ? `<button class="btn btn--secondary btn--full add-copy-prev" data-action="add-copy-prev">Reprendre la dernière séance</button>` : ''}
        ${exHtml}
        ${extrasHtml}
        <button class="session-add-ex-btn" data-action="add-session-ex">
          + Ajouter un exercice
        </button>
        <div class="session-notes-block">
          <div class="session-notes-label">Notes</div>
          <textarea class="session-notes-input" data-action="add-notes-input"
                    placeholder="Comment s'est passée la séance ? (optionnel)">${esc(addNotes)}</textarea>
        </div>
      </div>
    </div>
    ${addExModal ? renderAddExModal() : ''}`;
}

// ═══════════════════════════════════════════════════════════
//  Stats / Progression
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  Settings
// ═══════════════════════════════════════════════════════════

function renderSettings() {
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
          <div class="setting-row setting-row--segmented">
            <span class="setting-label">Thème</span>
            <div class="segmented">
              ${[['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) =>
                `<button class="segmented__btn ${themePref() === v ? 'segmented__btn--active' : ''}" data-action="set-theme" data-val="${v}">${l}</button>`).join('')}
            </div>
          </div>
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
            <span class="setting-label">Rechercher une mise à jour</span>
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
        const found = s.exercises.find(e => sameEx(e, ex));
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
        <div class="stats-card__name">${esc(ex.name)}</div>
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
        return `<span class="last-set">S${i+1} : ${w}${esc(s.reps)} reps</span>`;
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

    const exData    = ex;
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
          <span class="stats-card__name">${esc(ex.name)}</span>
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
    history.some(s => s.category === statsCat && s.exercises?.find(e => sameEx(e, ex)))
  );

  const modeDescs = {
    volume: 'Somme poids × reps de toutes les séries',
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
                  ${s.duration ? ` · ⏱ ${fmtDuration(s.duration)}` : ''}
                </div>
                ${s.notes ? `<div class="history-notes">« ${esc(s.notes)} »</div>` : ''}
                <div class="history-item__exercises">
                  ${s.exercises.map(ex => `
                    <div class="history-ex">
                      <span class="history-ex__name">${esc(ex.name)}</span>
                      <span class="history-ex__sets">${ex.sets.map(set => `${set.weight ? dispW(set.weight) + '×' : ''}${esc(set.reps)}`).join(' / ')}</span>
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

document.addEventListener('click', async e => {
  const el     = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  try { await handleAction(e, el, action); }
  finally { persistSession(); }
});

async function handleAction(e, el, action) {

  switch (action) {

    // ── Navigation ─────────────────────────────────────────
    case 'back': {
      if (view === 'session') releaseWakeLock(); // la séance reste en cours, reprise depuis l'accueil
      view = 'dashboard'; render(); startTicker();
      break;
    }
    case 'resume-session': {
      if (!activeSession) break;
      view = 'session'; render(); requestWakeLock();
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
      addProg       = data.activeProgramme;
      addCat        = firstSession();
      addDate       = localISO();
      editSessionId = null;
      addNotes      = '';
      initAddSets(addCat);
      view = 'add-session'; render(); break;
    }
    case 'edit-session': {
      const session = (data.history || []).find(h => h.id === el.dataset.id);
      if (!session) break;
      editSessionId = session.id;
      addProg = session.programme || 'ppl';
      addCat  = session.category;
      addDate = localISO(session.date);
      initAddSets(addCat);
      session.exercises.forEach(ex => {
        const exData = (addProgData().exercises[addCat] || []).find(e => sameEx(e, ex));
        const sets   = ex.sets.map(s => ({ weight: s.weight, reps: s.reps }));
        if (exData) { addSets[exData.id] = sets; return; }
        const key = 'x_' + uid();
        addExtras.push({ key, name: ex.name, exId: ex.exId || null });
        addSets[key] = sets.length ? sets : [{ weight: '', reps: '' }];
      });
      addNotes = session.notes || '';
      view = 'add-session'; render(); break;
    }
    case 'delete-session': {
      if (!(await confirmSheet('Supprimer cette séance ?', 'Elle sera retirée de l\'historique et des statistiques.', 'Supprimer la séance'))) break;
      data.history = (data.history || []).filter(h => h.id !== el.dataset.id);
      syncTimersFromHistory();
      recomputePRFromHistory();
      save(); render(); break;
    }
    case 'go-settings': {
      view = 'settings'; render(); break;
    }
    case 'set-theme': {
      applyTheme(el.dataset.val); render(); break;
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
      const v = await askNumber({ title: 'Repos par défaut', message: 'Durée entre deux séries, en secondes.', value: data.defaultRest, unit: 's', min: 10, max: 600 });
      if (v !== null) { data.defaultRest = v; save(); render(); }
      break;
    }
    case 'force-update': {
      await checkForUpdate();
      break;
    }
    case 'cooldown-edit': {
      const cat = el.dataset.cat;
      if (!cat) break;
      const val = await askNumber({ title: `Récupération ${rawLabel(cat)}`, message: 'Délai avant de pouvoir refaire cette séance (1 à 168 h).', value: getCooldown(cat), unit: 'h', min: 1, max: 168 });
      if (val === null) break;
      prog().cooldowns[cat] = val;
      save(); render();
      break;
    }
    case 'skip-cooldown': {
      const cat = el.dataset.cat;
      if (!cat || !prog().timers[cat]) break;
      if (!(await confirmSheet(`Passer la récupération de ${rawLabel(cat)} ?`, 'La séance sera disponible tout de suite.', 'Passer le délai', false))) break;
      prog().timers[cat] = null;
      save(); render();
      break;
    }
    case 'add-cat': {
      addCat = el.dataset.cat;
      const extras = addExtras.map(x => ({ ...x, sets: addSets[x.key] }));
      initAddSets(addCat);
      extras.forEach(({ key, name, exId, sets }) => { addExtras.push({ key, name, exId }); addSets[key] = sets; });
      render(); break;
    }
    case 'add-copy-prev': {
      Object.entries(addPrev).forEach(([id, prev]) => {
        if (!prev.length) return;
        addSets[id] = prev.map(s => ({ weight: s.weight, reps: s.reps }));
      });
      render(); break;
    }
    case 'add-date': { addDate = el.value; break; }
    case 'add-set-row': {
      const exid = el.dataset.exid;
      if (!addSets[exid]) addSets[exid] = [];
      addSets[exid].push({ weight: '', reps: '' });
      render(); break;
    }
    case 'rem-extra-ex': {
      const exid = el.dataset.exid;
      addExtras = addExtras.filter(x => x.key !== exid);
      delete addSets[exid];
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

      if (!/^\d{4}-\d{2}-\d{2}$/.test(addDate || '') || addDate > localISO()) {
        flagInvalid(dateEl, 'Choisis une date');
        break;
      }
      // Séries saisies : reps entre 1 et 100, charge vide ou entre 0 et 1000
      const bad = [...document.querySelectorAll('[data-action="add-reps"], [data-action="add-weight"]')].find(inp => {
        const v = inp.value.trim();
        if (inp.dataset.action === 'add-weight') return !weightOk(v);
        return v !== '' && num(v, 1, 100, true) === null;
      });
      if (bad) { flagInvalid(bad, bad.dataset.action === 'add-reps' ? 'Reps entre 1 et 100' : weightMsg()); break; }

      const pData = addProgData();
      const clean = sets => (sets || []).filter(s => String(s.reps ?? '').trim() !== '')
        .map(s => ({ weight: s.weight, reps: String(parseInt(s.reps)) }));
      const sessionExercises = (pData.exercises[addCat] || [])
        .map(ex => {
          const sets = clean(addSets[ex.id]);
          return sets.length ? { exId: ex.id, name: ex.name, sets } : null;
        })
        .filter(Boolean);
      addExtras.forEach(({ key, name, exId }) => {
        const sets = clean(addSets[key]);
        if (sets.length) sessionExercises.push({ exId: exId || resolveExId(addProg, addCat, name), name, sets });
      });

      if (!sessionExercises.length) { showToast('Entre au moins un exercice avec poids et reps !'); return; }

      const [y, m, d] = addDate.split('-').map(Number);
      const timestamp = new Date(y, m - 1, d, 12, 0, 0).getTime();
      const wasEdit   = !!editSessionId;
      let   savedDate = timestamp;

      if (!data.history) data.history = [];
      if (wasEdit) {
        const idx = data.history.findIndex(h => h.id === editSessionId);
        if (idx !== -1) {
          const old = data.history[idx];
          // Même jour : on garde l'heure d'origine
          const sameDay = localISO(old.date) === addDate;
          savedDate = sameDay ? old.date : timestamp;
          data.history[idx] = { ...old, programme: addProg, category: addCat, date: savedDate, notes: addNotes.trim(), exercises: sessionExercises };
        }
      } else {
        data.history.push({ id: uid(), programme: addProg, category: addCat, date: timestamp, notes: addNotes.trim(), exercises: sessionExercises });
        addNotes = '';
      }
      data.history.sort((a, b) => b.date - a.date);
      editSessionId = null;

      // Le délai de récupération ne bouge que si cette séance est plus récente
      if (!data.programmes[addProg]) data.programmes[addProg] = pData;
      const timers = data.programmes[addProg].timers;
      if (savedDate > (timers[addCat] || 0)) timers[addCat] = savedDate;

      recomputePRFromHistory();
      save();
      showToast(wasEdit ? 'Séance modifiée' : 'Séance ajoutée');
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

      const wasEdit = csEditId !== null;
      csModal = false; csEditId = null;
      // Update nav state
      if (!editorCat || !sessionKeys().includes(editorCat)) editorCat = firstSession();
      if (!statsCat  || !sessionKeys().includes(statsCat))  statsCat  = firstSession();
      if (!addCat    || !sessionKeys().includes(addCat))    addCat    = firstSession();

      save();
      showToast(wasEdit ? 'Séance modifiée !' : 'Séance créée !');
      render(); break;
    }
    case 'delete-custom-session': {
      const id = csEditId;
      const running = activeSession && activeSession.programme === 'custom' && activeSession.category === id;
      if (running && !(await confirmSheet('Cette séance est en cours', 'Elle sera abandonnée.', 'Supprimer'))) break;
      const n = (data.history || []).filter(h => h.category === id && h.programme === 'custom').length;
      const msg = n ? `Ses exercices seront supprimés et ${n} séance${n > 1 ? 's' : ''} de l'historique ser${n > 1 ? 'ont effacées' : 'a effacée'}.`
                    : 'Ses exercices seront supprimés.';
      if (!(await confirmSheet('Supprimer cette séance ?', msg, 'Supprimer'))) break;
      if (running) endSession();
      if (id && data.customSessions) {
        delete data.customSessions[id];
        if (data.programmes.custom) {
          delete data.programmes.custom.exercises[id];
          delete data.programmes.custom.timers[id];
          delete data.programmes.custom.cooldowns?.[id];
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
      const cat = el.dataset.cat;
      if (!(prog().exercises[cat] || []).length) {
        await dialog({ title: 'Aucun exercice', message: 'Ajoute des exercices à cette séance avant de la démarrer.', actions: [{ label: 'OK', style: 'preferred' }] });
        break;
      }
      if (activeSession) {
        const choice = await dialog({ type: 'sheet', title: 'Une séance est déjà en cours',
          message: `${rawLabel(activeSession.category, activeSession.programme)} a commencé il y a ${fmtDuration(Date.now() - activeSession.startedAt)}.`,
          actions: [
            { label: 'Reprendre la séance en cours', value: 'resume', style: 'preferred' },
            { label: `Abandonner et démarrer ${rawLabel(cat)}`, value: 'replace', style: 'destructive' },
            { label: 'Annuler', style: 'cancel' },
          ] });
        if (choice === 'resume') { view = 'session'; render(); requestWakeLock(); break; }
        if (choice !== 'replace') break;
        endSession();
      }
      if (data.soundOn !== false) beep(440, .08);
      haptic();
      startSession(cat);
      break;
    }

    // ── Session ─────────────────────────────────────────────
    case 'validate-set': {
      validateSet(parseInt(el.dataset.ei), parseInt(el.dataset.si));
      break;
    }
    case 'edit-set': {
      // Série validée rouverte sur place, avec ses champs et le ✓
      if (swipeBlockClick) break;
      editingSet = { ei: parseInt(el.dataset.ei), si: parseInt(el.dataset.si) };
      render();
      setTimeout(() => { $('#editSetReps')?.focus(); }, 50);
      break;
    }
    case 'close-edit-set': {
      editingSet = null; render(); break;
    }
    case 'save-edit-set': {
      if (!editingSet) break;
      const { ei: eei, si: esi } = editingSet;
      const ex  = activeSession.exercises[eei];
      const s   = ex?.sets[esi];
      if (!s) { editingSet = null; render(); break; }
      const wIn = $('#editSetWeight'), rIn = $('#editSetReps');
      if (!weightOk(wIn?.value)) { flagInvalid(wIn, weightMsg()); break; }
      const reps = num(rIn?.value, 1, 100, true);
      if (reps === null) { flagInvalid(rIn, 'Reps entre 1 et 100'); break; }
      // Les records ne sont recalculés qu'à l'enregistrement de la séance
      s.weight = storeW(wIn?.value ?? '');
      s.reps   = String(reps);
      editingSet = null;
      document.activeElement?.blur?.();
      haptic();
      render();
      showToast('Série modifiée');
      break;
    }
    case 'delete-set': {
      const ei = parseInt(el.dataset.ei), si = parseInt(el.dataset.si);
      const ex = activeSession?.exercises[ei];
      if (!ex?.sets[si]) break;
      if (ex.sets.length === 1) { closeSwipes(); showToast('Dernière série : retire l\'exercice avec ⋯'); break; }
      ex.sets.splice(si, 1);
      editingSet = null;
      haptic();
      render();
      break;
    }
    case 'add-set': {
      const ex = activeSession?.exercises[parseInt(el.dataset.ei)];
      if (!ex || ex.sets.length >= 20) break;
      const last = ex.sets.at(-1);
      const pex  = lastPerf(activeSession.programme, activeSession.category, ex)?.ex;
      const prev = pex?.sets[ex.sets.length];
      ex.sets.push({ weight: last?.weight ?? '', reps: last?.reps ?? '', plannedWeight: last?.weight ?? '',
                     prev: prev ? { weight: prev.weight, reps: prev.reps } : null, done: false });
      openDone.add(ex);
      haptic();
      render();
      break;
    }
    case 'toggle-ex': {
      const ex = activeSession?.exercises[parseInt(el.dataset.ei)];
      if (!ex) break;
      if (openDone.has(ex)) openDone.delete(ex); else openDone.add(ex);
      render();
      break;
    }
    case 'bump-weight': {
      const ex = activeSession?.exercises[parseInt(el.dataset.ei)];
      if (!ex) break;
      const step = data.unit === 'lbs' ? 5 : 2.5;
      ex.sets.forEach(s => {
        if (s.done) return;
        const cur = parseFloat(dispW(s.weight || s.prev?.weight)) || 0;
        s.weight = storeW(String(Math.round((cur + step) * 100) / 100));
        s.plannedWeight = s.weight;
      });
      ex.bumped = true;
      haptic();
      render();
      showToast(`Charge augmentée : ${bumpLabel()}`);
      break;
    }
    case 'ex-menu': {
      await exerciseMenu(parseInt(el.dataset.ei));
      break;
    }
    case 'set-ex-rest': {
      const ei = parseInt(el.dataset.ei);
      if (!activeSession?.exercises[ei]) break;
      restEditEi = ei;
      openSessSheet({ cls: 'sess-sheet--exrest', label: 'Repos', html: exRestSheetHtml(ei), onClose: () => { restEditEi = null; render(); } });
      break;
    }
    case 'ex-rest-set': {
      if (restEditEi !== null) setExRest(restEditEi, parseInt(el.dataset.secs));
      break;
    }
    case 'ex-rest-adj': {
      if (restEditEi !== null) setExRest(restEditEi, exRest(activeSession.exercises[restEditEi]) + parseInt(el.dataset.d));
      break;
    }
    case 'sheet-done': {
      el.closest('.sess-sheet')?._close?.();
      break;
    }
    case 'skip-rest': {
      clearRest(); restActive = false;
      closeRestSheet();
      removeRestUI();
      persistSession();
      break;
    }
    case 'expand-rest': {
      if (restActive) openRestSheet();
      break;
    }
    case 'rest-adjust': {
      adjustRest(parseInt(el.dataset.d));
      break;
    }
    case 'set-rest': {
      const secs = parseInt(el.dataset.secs);
      clearRest(); restTimeLeft = secs; restTotal = secs; startRestCountdown();
      updateRestUI(); haptic();
      break;
    }
    case 'ax-sets': {
      axSets = Math.min(10, Math.max(1, axSets + parseInt(el.dataset.d)));
      const n = $('#axSets');
      if (n) n.textContent = axSets;
      break;
    }
    case 'ax-pick': {
      pickExercise(el.dataset.name);
      break;
    }
    case 'summary-done': {
      const ta = $('#summaryNotes');
      if (ta) summaryNotesInput(ta.value);
      clearTimeout(summaryNotesTimer);
      save();
      lastSummary = null;
      view = 'dashboard'; render(); startTicker();
      break;
    }
    case 'add-session-ex': {
      if (view === 'session') { openAddExSheet(); break; }
      addExModal = true; addExName = ''; addExSets = 3; render();
      setTimeout(() => document.getElementById('addExNameInput')?.focus(), 80);
      break;
    }
    case 'add-ex-overlay': {
      if (e.target !== el) break; // clic dans la modale, pas sur le fond
      addExModal = false; render(); break;
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
      if (view === 'add-session') {
        const key = 'x_' + uid();
        addExtras.push({ key, name, exId: null });
        addSets[key] = Array.from({ length: addExSets }, () => ({ weight: '', reps: '' }));
        addExModal = false; addExName = ''; render();
        setTimeout(() => {
          const blocks = document.querySelectorAll('.exercise-block');
          blocks[blocks.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
        break;
      }
      activeSession.exercises.push({
        exId: null,
        name,
          sets: Array.from({ length: addExSets }, () => ({ weight: '', reps: '', plannedWeight: '', prev: null, done: false })),
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
      closeSessSheets();
      const total = activeSession.exercises.reduce((a, ex) => a + ex.sets.length, 0);
      const done  = activeSession.exercises.reduce((a, ex) => a + ex.sets.filter(st => st.done).length, 0);
      const dur   = fmtDuration(Date.now() - activeSession.startedAt);
      const choice = await dialog({ type: 'sheet',
        title: done ? 'Terminer la séance ?' : 'Aucune série validée',
        message: done ? `${done} / ${total} séries · ${dur}` : 'Valide au moins une série pour enregistrer la séance.',
        actions: [
          ...(done ? [{ label: 'Enregistrer la séance', value: 'save', style: 'preferred' }] : []),
          { label: 'Abandonner la séance', value: 'discard', style: 'destructive' },
          { label: done ? 'Continuer' : 'Continuer la séance', style: 'cancel' },
        ] });
      if (choice === 'discard') {
        if (done && !(await confirmSheet('Abandonner la séance ?', `Les ${done} séries validées seront perdues.`, 'Abandonner'))) break;
        endSession();
        view = 'dashboard'; render(); startTicker();
        showToast('Séance abandonnée');
        break;
      }
      if (choice !== 'save') break;

      // La séance Perso a pu être supprimée entre-temps
      const sp = activeSession.programme, sc = activeSession.category;
      if (sp === 'custom' ? !data.customSessions[sc] : !PROGRAMMES[sp]?.sessions[sc]) {
        endSession();
        view = 'dashboard'; render(); startTicker();
        showToast('Cette séance n\'existe plus');
        break;
      }
      if (!data.programmes[sp]) data.programmes[sp] = { exercises: {}, timers: {}, cooldowns: {} };
      const timers    = data.programmes[sp].timers;
      const prevTimer = timers[sc] ?? null;
      const entry = {
        id:         uid(),
        programme:  sp,
        category:   sc,
        date:       Date.now(),
        duration:   Date.now() - activeSession.startedAt,
        notes:      sessionNotes.trim(),
        exercises:  activeSession.exercises
          .map(ex => ({
            exId: ex.exId || resolveExId(sp, sc, ex.name),
            name: ex.name,
            sets: ex.sets.filter(s => s.done).map(s => ({ weight: s.weight, reps: s.reps })),
          }))
          .filter(ex => ex.sets.length),
      };
      timers[sc] = entry.date;
      data.history.unshift(entry);
      recomputePRFromHistory();
      if (!save(true)) {
        // Rien n'est perdu : la séance reste active, on propose d'exporter (séance comprise)
        const act = await dialog({ title: 'Espace de stockage plein',
          message: 'Exporte tes données pour ne pas perdre cette séance.',
          actions: [
            { label: 'Plus tard', style: 'cancel' },
            { label: 'Exporter', value: 'export', style: 'preferred' },
          ] });
        if (act === 'export') await exportData();
        data.history = data.history.filter(h => h !== entry);
        timers[sc] = prevTimer;
        recomputePRFromHistory();
        break;
      }
      // Bilan : records comparés à ceux d'avant la séance
      lastSummary = buildSummary(entry, activeSession.baseline || {});
      if (lastSummary.records.length) recordSound(); else finishSound();
      haptic();
      endSession();
      view = 'summary'; render(); window.scrollTo(0, 0);
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
      if (!(await confirmSheet(`Supprimer « ${name} » ?`, 'L\'historique de cet exercice est conservé.', 'Supprimer l\'exercice'))) break;
      prog().exercises[editorCat].splice(i, 1); save(); render(); break;
    }
    case 'add-ex': {
      editExIdx = null; modalOpen = true; render();
      setTimeout(() => $('#modalName')?.focus(), 50);
      break;
    }
    case 'save-ex': {
      const name = $('#modalName')?.value.trim();
      if (!name) { showToast('Entre un nom !'); return; }
      const setsIn = $('#modalSets'), restIn = $('#modalRest'), targetIn = $('#modalTarget');
      const sets = num(setsIn?.value, 1, 10, true);
      if (sets === null) { flagInvalid(setsIn, 'Séries entre 1 et 10'); break; }
      const restRaw = restIn?.value.trim() || '';
      const rest    = restRaw ? num(restRaw, 10, 600, true) : null;
      if (restRaw && rest === null) { flagInvalid(restIn, 'Repos entre 10 et 600 s'); break; }
      const targetRaw = targetIn?.value.trim() || '';
      if (targetRaw && (!weightOk(targetRaw) || !(parseFloat(storeW(targetRaw)) > 0))) { flagInvalid(targetIn, weightMsg()); break; }
      const target = targetRaw ? parseFloat(storeW(targetRaw)) : null;
      const list = prog().exercises[editorCat] || (prog().exercises[editorCat] = []);
      if (editExIdx !== null) {
        const ex = list[editExIdx];
        if (ex.name !== name) {
          // L'exId garde le lien avec l'historique ; on propose aussi d'y reprendre le nouveau nom
          const progKey = data.activeProgramme;
          const touched = (data.history || []).filter(h => (h.programme || 'ppl') === progKey && h.category === editorCat
            && (h.exercises || []).some(e => sameEx(e, ex)));
          if (touched.length) {
            const n = touched.length;
            const all = await confirmSheet('Renommer aussi dans l\'historique ?',
              `${n} séance${n > 1 ? 's contiennent' : ' contient'} cet exercice.`, 'Renommer partout', false);
            if (all) touched.forEach(h => h.exercises.forEach(e => { if (sameEx(e, ex)) e.name = name; }));
          }
          if (activeSession) activeSession.exercises.forEach(e => { if (e.exId === ex.id) e.name = name; });
          ex.name = name;
        }
        ex.sets   = sets;
        ex.target = target;
        ex.rest   = rest;
      } else {
        const ex = makeExercise(name, sets);
        // Un exercice déjà présent dans l'historique (supprimé puis recréé) retrouve son identifiant
        const known = resolveExId(data.activeProgramme, editorCat, name);
        if (!list.some(e => e.id === known)) ex.id = known;
        ex.target = target;
        ex.rest   = rest;
        list.push(ex);
        recomputePRFromHistory();
      }
      modalOpen = false; editExIdx = null; save(); render(); break;
    }
    case 'close-modal': {
      modalOpen = false; editExIdx = null; render(); break;
    }

    // ── Data ────────────────────────────────────────────────
    case 'export': {
      await exportData();
      break;
    }
    case 'import': {
      if (!(await confirmSheet('Importer une sauvegarde ?', 'Les données actuelles seront remplacées par celles du fichier.', 'Choisir un fichier', false))) break;
      const inp = document.createElement('input');
      inp.type  = 'file'; inp.accept = '.json,application/json';
      inp.onchange = ev => {
        const file = ev.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = re => importText(String(re.target.result));
        reader.readAsText(file);
      };
      inp.click(); break;
    }
  }
}

// Importe une sauvegarde : tout est vérifié sur une copie, `data` n'est remplacé qu'à la fin
function importText(text) {
  let next, theme;
  try {
    const d = JSON.parse(text);
    if (!d || typeof d !== 'object') throw new Error('format');
    theme = d._theme;
    let candidate;
    if (d.exercises && !d.programmes) {
      // Ancien format (ppl_v1)
      candidate = makeDefaultData();
      candidate.programmes.ppl.exercises = clone(d.exercises);
      candidate.programmes.ppl.timers    = clone(d.timers || {});
      candidate.defaultRest = d.defaultRest || 90;
      candidate.history     = (Array.isArray(d.history) ? clone(d.history) : []).map(h => ({ ...h, programme: 'ppl' }));
    } else if (d.programmes && typeof d.programmes === 'object' && d.activeProgramme) {
      candidate = clone(d);
      delete candidate._theme;
    } else throw new Error('format');
    const given = Array.isArray(candidate.history) ? candidate.history.length : 0;
    next = sanitizeData(normalizeData(candidate));
    recomputePRFromHistory(next);
    // Un fichier dont aucune séance n'est lisible est refusé
    if (given > 0 && next.history.length === 0) throw new Error('history');
    next._skipped = given - next.history.length;
  } catch {
    showToast('Fichier invalide : rien n\'a été modifié', { duration: 4000 });
    return false;
  }
  const skipped = next._skipped; delete next._skipped;
  const previous = JSON.stringify(data);
  try { localStorage.setItem(BACKUP_KEY, previous); } catch {}
  data = next;
  if (!save()) { data = JSON.parse(previous); return false; }
  if (theme) applyTheme(theme);
  editorCat = statsCat = addCat = firstSession();
  syncTimersFromHistory();
  render();
  const n = data.history.length;
  showToast(`Import réussi : ${n} séance${n > 1 ? 's' : ''}${skipped ? ` (${skipped} ignorée${skipped > 1 ? 's' : ''})` : ''}`, {
    action: 'Annuler', duration: 6000,
    onAction: () => {
      data = normalizeData(JSON.parse(previous));
      save();
      editorCat = statsCat = addCat = firstSession();
      render(); showToast('Import annulé');
    },
  });
  return true;
}

// Exporte la donnée en JSON (feuille de partage si disponible, sinon téléchargement)
async function exportData() {
  const payload = { ...data, _theme: themePref() };
  const json  = JSON.stringify(payload, null, 2);
  const fname = `muscu-backup-${localISO()}.json`;
  const file  = typeof File === 'function' ? new File([json], fname, { type: 'application/json' }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Sauvegarde PPL Training' }); return; }
    catch (err) { if (err?.name === 'AbortError') return; }
  }
  downloadText(json, fname);
}

function downloadText(text, fname) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a   = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Live input capture
document.addEventListener('input', e => {
  const action = e.target.dataset.action;
  // Une saisie corrige l'erreur signalée
  if (e.target.getAttribute?.('aria-invalid') === 'true') {
    e.target.removeAttribute('aria-invalid');
    e.target.classList.remove('set-input--error');
  }

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
      const saveBtn = $('[data-action="save-past-session"]');
      if (saveBtn) saveBtn.disabled = !addHasReps();
    }
    if (action === 'add-date')        addDate  = e.target.value;
    if (action === 'add-notes-input') addNotes = e.target.value;
  }
  if (action === 'session-notes') sessionNotes = e.target.value;
  if (activeSession) persistSession();
});

// iOS peut tuer l'app en arrière-plan : on sauvegarde au moment où elle disparaît
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistSession(); });
window.addEventListener('pagehide', persistSession);

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
  if (document.visibilityState === 'visible' && view === 'session') {
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

// ═══════════════════════════════════════════════════════════
//  Écran de secours (donnée illisible)
// ═══════════════════════════════════════════════════════════

function renderRescue() {
  dataBroken = true;
  clearInterval(ticker);
  let hasBackup = false;
  try { hasBackup = !!localStorage.getItem(BACKUP_KEY); } catch {}
  $('#app').innerHTML = `
    <div class="rescue" role="alert">
      <div class="rescue__title">Données illisibles</div>
      <p class="rescue__msg">L'app n'arrive pas à lire tes données. Rien n'a été effacé : choisis quoi faire.</p>
      ${hasBackup ? '<button class="btn btn--primary btn--full" id="rescueRestore">Restaurer la sauvegarde précédente</button>' : ''}
      <button class="btn btn--secondary btn--full" id="rescueExport">Exporter les données brutes</button>
      <button class="btn btn--danger btn--full" id="rescueReset">Réinitialiser</button>
    </div>`;
  $('#rescueRestore')?.addEventListener('click', () => {
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      normalizeData(JSON.parse(raw)); // vérifie qu'elle se lit avant de l'écrire
      localStorage.setItem(KEY, raw);
      location.reload();
    } catch { showToast('La sauvegarde est illisible elle aussi', { duration: 4000 }); }
  });
  $('#rescueExport').addEventListener('click', () => {
    let raw = '';
    try { raw = localStorage.getItem(KEY) || ''; } catch {}
    downloadText(raw, `muscu-donnees-brutes-${localISO()}.json`);
  });
  $('#rescueReset').addEventListener('click', async () => {
    if (!(await confirmSheet('Tout réinitialiser ?', 'Ton historique et tes exercices seront effacés. Exporte d\'abord les données brutes si tu veux les garder.', 'Réinitialiser'))) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) localStorage.setItem(BACKUP_KEY, raw);
      const d = makeDefaultData(); d.schema = SCHEMA;
      localStorage.setItem(KEY, JSON.stringify(d));
      localStorage.removeItem(SESSION_KEY);
    } catch {}
    location.reload();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (loadError) { renderRescue(); return; }
  try {
    syncTimersFromHistory();
    if (restoreSession()) { view = 'session'; requestWakeLock(); }
    render();
    startTicker();
  } catch (err) {
    console.error(err);
    renderRescue();
    return;
  }
  // Demande au navigateur de ne pas effacer les données en cas de manque d'espace
  try { navigator.storage?.persisted?.().then(p => { if (!p) navigator.storage.persist?.(); }).catch(() => {}); } catch {}
  registerServiceWorker();
});

// ═══════════════════════════════════════════════════════════
//  Mises à jour (service worker)
// ═══════════════════════════════════════════════════════════

let swReg = null;
let swReloading = false;

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').then(reg => {
    swReg = reg;
    maybeShowUpdateBanner();
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => { if (sw.state === 'installed') maybeShowUpdateBanner(); });
    });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swReloading) location.reload();
  });
  // Vérifie au retour au premier plan
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') swReg?.update().catch(() => {});
  });
}

// Bannière « Nouvelle version disponible », jamais pendant une séance
function maybeShowUpdateBanner() {
  if (!swReg?.waiting || !navigator.serviceWorker.controller || activeSession || $('.update-banner')) return;
  const el = document.createElement('div');
  el.className = 'update-banner';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>Nouvelle version disponible</span><button class="update-banner__btn" type="button">Mettre à jour</button>`;
  el.querySelector('button').addEventListener('click', () => applyUpdate());
  document.body.appendChild(el);
}

function applyUpdate() {
  const waiting = swReg?.waiting;
  if (!waiting) { location.reload(); return; }
  swReloading = true;
  waiting.postMessage('skipWaiting');
  setTimeout(() => location.reload(), 3000); // filet si controllerchange n'arrive pas
}

async function checkForUpdate() {
  if (!('serviceWorker' in navigator) || !swReg) { location.reload(); return; }
  try { await swReg.update(); }
  catch { showToast('Impossible de vérifier : pas de connexion ?', { duration: 4000 }); return; }
  const pending = swReg.waiting || swReg.installing;
  if (!pending) { showToast('Tu as la dernière version'); return; }
  showToast('Mise à jour…');
  // Repart de zéro : caches vidés, service worker désinscrit, puis rechargement
  try { await Promise.all((await caches.keys()).map(k => caches.delete(k))); } catch {}
  try { await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.unregister())); } catch {}
  location.reload();
}
