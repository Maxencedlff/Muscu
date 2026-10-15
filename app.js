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
      rest: restActive ? { endTime: restEndTime, minimized: restMinimized } : null,
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
let restEditEi    = null;
let editSetModal  = null; // { ei, si } — édition d'une série validée
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
  const flash = document.createElement('div');
  flash.className = 'timer-flash';
  document.body.appendChild(flash);
  flash.addEventListener('animationend', () => flash.remove());
}

function validationSound() { if (data.soundOn !== false) beep(660, .1); }
function finishSound()     { if (data.soundOn !== false) { beep(880, .1); setTimeout(() => beep(1320, .25), 160); } }

// ═══════════════════════════════════════════════════════════
//  Navigation : onglets, piles, historique du navigateur
// ═══════════════════════════════════════════════════════════

// TEMP-LOT2 début
// Version minimale de icon() en attendant le sprite du lot 2 (mêmes noms)
const TEMP_ICONS = {
  'chevron.left':  '<path d="M15 4l-8 8 8 8"/>',
  'chevron.right': '<path d="M9 4l8 8-8 8"/>',
  'chevron.down':  '<path d="M4 9l8 8 8-8"/>',
  'plus':          '<path d="M12 5v14M5 12h14"/>',
  'dumbbell':      '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  'clock.history': '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/><path d="M12 7.5V12l3 2"/>',
  'chart':         '<path d="M4 20h16"/><path d="M7 16v-4M12 16V7M17 16v-6"/>',
  'list.bullet':   '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".6"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="18" r=".6"/>',
  'gear':          '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  'flame':         '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.4-5.5 3.6-8.3.5 1.7 1.4 2.8 2.6 3.4.3-2.7 1.7-5 3.6-6.4-.2 2.8 3.2 5.6 3.2 10.3 0 4.3-2.7 7.2-6.5 7.2z"/>',
};
function icon(name, size = 22) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TEMP_ICONS[name] || ''}</svg>`;
}
// TEMP-LOT2 fin

// Racine de chaque onglet : les fonctions renderXxx gardent leur nom de vue historique
const TABS = {
  train:    { root: 'dashboard', label: 'Entraînement', icon: 'dumbbell',      action: 'go-home' },
  history:  { root: 'history',   label: 'Historique',   icon: 'clock.history', action: 'go-history' },
  progress: { root: 'stats',     label: 'Progrès',      icon: 'chart',         action: 'go-stats' },
  program:  { root: 'editor',    label: 'Programme',    icon: 'list.bullet',   action: 'go-program' },
};
const TAB_OF_ROOT = Object.fromEntries(Object.entries(TABS).map(([t, v]) => [v.root, t]));

let nav = { tab: 'train', stacks: { train: ['dashboard'], history: ['history'], progress: ['stats'], program: ['editor'] } };
let navIndex   = 0;     // position dans l'historique du navigateur
let navHist    = [];    // copie des états poussés, pour savoir si history.back() mène au bon écran
let ignorePop  = 0;     // popstate provoqués par l'app elle-même
let firstPaint = true;
let skipTransition = false;
const scrollMem = {};   // défilement par écran (clé = onglet + pile)
const snapMem   = {};   // dernier rendu de chaque écran, montré sous le geste de retour
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// Le défilement de chaque écran est géré par l'app, pas par le navigateur
try { history.scrollRestoration = 'manual'; } catch {}
// Navigateur piloté par les tests : pas de transitions, sauf demande explicite (window.__pplTransitions)
const transitionsOff = () => navigator.webdriver && !window.__pplTransitions;

function currentRoute(n = nav) { const s = n.stacks[n.tab]; return s[s.length - 1]; }
function navKey(n = nav) { return n.tab + '/' + n.stacks[n.tab].join('/'); }
function navClone(n) { return { tab: n.tab, stacks: Object.fromEntries(Object.entries(n.stacks).map(([k, v]) => [k, v.slice()])) }; }
function navSame(a, b) { return !!a && !!b && JSON.stringify(a) === JSON.stringify(b); }
function navHash(n) { const s = n.stacks[n.tab]; return '#' + n.tab + (s.length > 1 ? '/' + s.slice(1).join('/') : ''); }

// Retire les écrans qui n'ont plus de sens (séance terminée entre-temps)
function navSanitize(n) {
  const out = navClone(n);
  if (!TABS[out.tab]) out.tab = 'train';
  for (const t of Object.keys(TABS)) {
    let s = Array.isArray(out.stacks[t]) ? out.stacks[t] : [];
    s = s.filter((r, i) => i === 0 || (r !== TABS[t].root && (r !== 'session' || activeSession)));
    if (s[0] !== TABS[t].root) s.unshift(TABS[t].root);
    out.stacks[t] = s;
  }
  return out;
}

function navWrite(mode) {
  const st = { idx: navIndex, nav: navClone(nav) };
  try {
    if (mode === 'push') history.pushState(st, '', navHash(nav));
    else history.replaceState(st, '', navHash(nav));
  } catch {}
  navHist[navIndex] = navClone(nav);
}

// Change d'état de navigation. mode : 'push' (nouvelle entrée), 'replace', 'back' (retour d'un cran)
function navCommit(next, dir, mode = 'push') {
  saveScroll();
  next = navSanitize(next);
  if (mode === 'back' && navIndex > 0 && navSame(navHist[navIndex - 1], next)) {
    // Le retour système et le bouton retour restent synchronisés : on recule vraiment dans l'historique
    ignorePop++;
    navIndex--;
    nav = next;
    history.back();
  } else if (mode === 'push') {
    navIndex++;
    navHist.length = navIndex;
    nav = next;
    navWrite('push');
  } else {
    nav = next;
    navWrite('replace');
  }
  show(dir);
}

function navigate(route, { replace = false } = {}) {
  const next = navClone(nav);
  const s = next.stacks[next.tab];
  if (replace) s[s.length - 1] = route; else s.push(route);
  navCommit(next, route === 'session' ? 'up' : 'push', replace ? 'replace' : 'push');
}

function goBack() {
  const s = nav.stacks[nav.tab];
  if (s.length < 2) return;
  const next = navClone(nav);
  next.stacks[next.tab].pop();
  navCommit(next, currentRoute() === 'session' ? 'down' : 'pop', 'back');
}

// Revient à un écran déjà dans la pile, sinon à la racine d'un onglet, sinon empile
function routeTo(route) {
  const s = nav.stacks[nav.tab];
  const i = s.lastIndexOf(route);
  if (i >= 0) {
    if (i === s.length - 1) { show('none'); return; }
    const next = navClone(nav);
    next.stacks[next.tab] = s.slice(0, i + 1);
    navCommit(next, currentRoute() === 'session' ? 'down' : 'pop', i === s.length - 2 ? 'back' : 'replace');
    return;
  }
  const tab = TAB_OF_ROOT[route];
  if (tab) { switchTab(tab, { reset: true, mode: nav.stacks[nav.tab].includes('session') ? 'replace' : 'push' }); return; }
  navigate(route);
}

function switchTab(tab, { reset = false, mode = 'push' } = {}) {
  const next = navClone(nav);
  if (tab === nav.tab) {
    // Toucher l'onglet actif : retour à la racine, puis en haut de page
    if (next.stacks[tab].length > 1) {
      next.stacks[tab] = [TABS[tab].root];
      navCommit(next, 'pop', 'replace');
    }
    window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    return;
  }
  next.tab = tab;
  if (reset) next.stacks[tab] = [TABS[tab].root];
  navCommit(next, 'fade', mode);
}

window.addEventListener('popstate', e => {
  if (ignorePop > 0) { ignorePop--; return; }
  const st = e.state;
  if (!st || !st.nav) return;
  saveScroll();
  const prev = nav;
  nav = navSanitize(st.nav);
  navIndex = st.idx || 0;
  navHist[navIndex] = navClone(nav);
  // Écran devenu invalide (séance terminée) : on corrige l'entrée courante
  if (!navSame(nav, st.nav)) navWrite('replace');
  const dir = prev.tab !== nav.tab ? 'fade'
    : nav.stacks[nav.tab].length < prev.stacks[prev.tab].length ? (currentRoute(prev) === 'session' ? 'down' : 'pop')
    : nav.stacks[nav.tab].length > prev.stacks[prev.tab].length ? (currentRoute() === 'session' ? 'up' : 'push') : 'none';
  closeTransientUI();
  show(dir);
});

// Une feuille ou un dialogue ouvert ne doit pas survivre à un changement d'écran
function closeTransientUI() {
  document.querySelectorAll('.sheet-root').forEach(el => el._close?.(null));
}

function saveScroll() { scrollMem[navKey()] = window.scrollY; }

// ═══════════════════════════════════════════════════════════
//  Rendu
// ═══════════════════════════════════════════════════════════

// render() garde son rôle historique : réafficher l'écran courant en gardant le défilement.
// Si du code a changé `view` directement, on traduit ce changement en navigation.
function render() {
  if (view !== currentRoute()) { routeTo(view); return; }
  paint();
}

function paint(scrollY = window.scrollY) {
  const app = $('#app');
  view = currentRoute();
  if      (view === 'dashboard')   app.innerHTML = renderDashboard();
  else if (view === 'programmes')  app.innerHTML = renderProgrammes();
  else if (view === 'session')     app.innerHTML = activeSession ? renderSession() : renderDashboard();
  else if (view === 'editor')      app.innerHTML = renderEditor();
  else if (view === 'history')     app.innerHTML = renderHistory();
  else if (view === 'stats')       app.innerHTML = renderStats();
  else if (view === 'settings')    app.innerHTML = renderSettings();
  else if (view === 'add-session') app.innerHTML = renderAddSession();
  else app.innerHTML = renderDashboard();

  if (view === 'stats') setTimeout(drawCharts, 0);
  document.body.classList.toggle('first-paint', firstPaint);
  if (firstPaint) setTimeout(() => document.body.classList.remove('first-paint'), 600);
  firstPaint = false;
  updateChrome();
  observeLargeTitle();
  window.scrollTo(0, scrollY);
}

// Affiche l'écran courant après un changement de navigation, avec la transition qui va avec
function show(dir = 'none') {
  const prevKey = show.lastKey;
  if (prevKey && dir === 'push') snapMem[prevKey] = $('#app').innerHTML;
  const key = navKey();
  show.lastKey = key;
  const target = (dir === 'pop' || dir === 'down' || dir === 'fade') ? (scrollMem[key] || 0) : 0;
  const route = currentRoute();

  if (route === 'add-session' && (dir === 'push' || dir === 'up')) addSnapshot = addState();
  if (route !== 'add-session') { addSnapshot = null; try { sessionStorage.removeItem(ADD_DRAFT_KEY); } catch {} }
  if (route === 'session') requestWakeLock(); else releaseWakeLock();

  const update = () => { paint(target); startTicker(); };
  const animate = dir !== 'none' && !skipTransition && !transitionsOff() && !reduceMotion.matches && typeof document.startViewTransition === 'function' && !document.hidden;
  if (!animate) { update(); return; }
  document.documentElement.dataset.navDir = dir;
  try {
    const vt = document.startViewTransition(update);
    vt.finished.finally(() => { delete document.documentElement.dataset.navDir; });
  } catch { update(); }
}

// ── Tab bar et mini-barre de séance (hors de #app, posées une fois) ──
function ensureChrome() {
  if ($('.tabbar')) return;
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Sections');
  bar.innerHTML = Object.entries(TABS).map(([t, v]) => `
    <button class="tabbar__btn" role="tab" data-action="${v.action}" data-tab="${t}" aria-selected="false">
      ${icon(v.icon, 25)}<span class="tabbar__label">${v.label}</span>
    </button>`).join('');
  const live = document.createElement('button');
  live.className = 'livebar';
  live.dataset.action = 'resume-session';
  live.hidden = true;
  document.body.append(live, bar);
}

function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

function sessionCounts(sess = activeSession) {
  const total = sess.exercises.reduce((a, ex) => a + ex.sets.length, 0);
  const done  = sess.exercises.reduce((a, ex) => a + ex.sets.filter(st => st.done).length, 0);
  return { total, done };
}

function updateChrome() {
  ensureChrome();
  const route = currentRoute();
  const inSession = route === 'session' && !!activeSession;
  const bar = $('.tabbar');
  bar.hidden = inSession;
  bar.querySelectorAll('.tabbar__btn').forEach(b => {
    const on = b.dataset.tab === nav.tab;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.classList.toggle('tabbar__btn--active', on);
  });
  const live = $('.livebar');
  const showLive = !!activeSession && !inSession;
  live.hidden = !showLive;
  document.body.classList.toggle('has-tabbar', !inSession);
  document.body.classList.toggle('has-livebar', showLive);
  if (showLive) {
    const lm = sessionMeta(activeSession.category, activeSession.programme);
    const { total, done } = sessionCounts();
    live.style.setProperty('--cat-color', lm.color);
    live.setAttribute('aria-label', `Séance ${rawLabel(activeSession.category, activeSession.programme)} en cours, ${done} séries sur ${total}. Ouvrir la séance`);
    live.innerHTML = `
      <span class="livebar__dot" aria-hidden="true"></span>
      <span class="livebar__title">${lm.label} · <span class="num">${done}/${total}</span></span>
      <span class="livebar__time num" id="livebar-elapsed">${fmtClock(Date.now() - activeSession.startedAt)}</span>
      <span class="livebar__rest num" id="livebar-rest" ${restActive ? '' : 'hidden'}>${fmtRest(restTimeLeft)}</span>
      <span class="livebar__chev" aria-hidden="true">${icon('chevron.right', 16)}</span>`;
  }
}

// ── Barre de navigation ──
// title : titre ; large : grand titre (racine d'onglet) ; back : libellé du retour (auto) ;
// left / right : HTML des actions ; sub : ligne sous le grand titre
function navBar({ title = '', large, back, left = '', right = '', sub = '', extra = '' } = {}) {
  const s = nav.stacks[nav.tab];
  const isRoot = s.length < 2;
  if (large === undefined) large = isRoot;
  if (back === undefined && !isRoot && !left) back = routeTitle(s[s.length - 2], s.length - 2 === 0);
  const backBtn = back ? `
    <button class="navbar__back" data-action="back" aria-label="Retour : ${esc(back)}">
      ${icon('chevron.left', 22)}<span class="navbar__back-label">${esc(back)}</span>
    </button>` : left;
  return `
    <header class="navbar ${large ? 'navbar--large' : 'navbar--compact'}">
      <div class="navbar__bar">
        <div class="navbar__side navbar__side--left">${backBtn}</div>
        <div class="navbar__title header__title" ${large ? 'aria-hidden="true"' : ''}>${title}</div>
        <div class="navbar__side navbar__side--right">${right}</div>
      </div>
      ${extra}
    </header>
    ${large ? `<div class="navbar__largewrap"><h1 class="t-large navbar__large">${title}</h1>${sub}</div>` : ''}`;
}

function routeTitle(route, isRoot) {
  if (isRoot && TAB_OF_ROOT[route]) return TABS[TAB_OF_ROOT[route]].label;
  return {
    dashboard: 'Entraînement', history: 'Historique', stats: 'Progrès', editor: 'Exercices',
    programmes: 'Programmes', settings: 'Réglages', session: 'Séance',
    'add-session': editSessionId ? 'Modifier la séance' : 'Séance passée',
  }[route] || 'Retour';
}

// Grand titre : quand il sort de l'écran, le titre compact et le filet apparaissent
let largeObserver = null;
function observeLargeTitle() {
  largeObserver?.disconnect();
  const h1 = $('.navbar__large');
  const bar = $('.navbar');
  if (!h1 || !bar || !('IntersectionObserver' in window)) return;
  const top = bar.getBoundingClientRect().height;
  largeObserver = new IntersectionObserver(([en]) => {
    bar.classList.toggle('navbar--collapsed', !en.isIntersecting);
  }, { rootMargin: `-${Math.round(top)}px 0px 0px 0px`, threshold: 0 });
  largeObserver.observe(h1);
}

// ═══════════════════════════════════════════════════════════
//  Feuille modale
// ═══════════════════════════════════════════════════════════

// sheet({ title, cancel, confirm, body, onConfirm }) → Promise (valeur de onConfirm, ou null si annulée)
// onConfirm(panel) peut renvoyer false pour garder la feuille ouverte.
function sheet({ title = '', cancel = 'Annuler', confirm = 'OK', body = '', onConfirm = null, onCancel = null } = {}) {
  return new Promise(resolve => {
    const root = document.createElement('div');
    const id = 'sheet-' + uid();
    root.className = 'sheet-root';
    root.innerHTML = `
      <div class="sheet__backdrop"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${id}">
        <div class="sheet__grabber" aria-hidden="true"></div>
        <div class="sheet__bar">
          <button class="sheet__btn sheet__btn--cancel">${cancel ? esc(cancel) : ''}</button>
          <div class="sheet__title" id="${id}">${esc(title)}</div>
          <button class="sheet__btn sheet__btn--confirm">${confirm ? esc(confirm) : ''}</button>
        </div>
        <div class="sheet__body">${body}</div>
      </div>`;
    const panel = $('.sheet', root);
    if (!cancel) $('.sheet__btn--cancel', root).style.visibility = 'hidden';
    if (!confirm) $('.sheet__btn--confirm', root).style.visibility = 'hidden';
    const prevFocus = document.activeElement;
    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      root.classList.add('sheet-root--out');
      setTimeout(() => { root.remove(); prevFocus?.focus?.(); }, reduceMotion.matches ? 0 : 220);
      resolve(val);
    };
    const tryCancel = async () => {
      if (onCancel && (await onCancel(panel)) === false) return;
      close(null);
    };
    root._close = close;
    $('.sheet__backdrop', root).addEventListener('click', tryCancel);
    $('.sheet__btn--cancel', root).addEventListener('click', tryCancel);
    $('.sheet__btn--confirm', root).addEventListener('click', async () => {
      const v = onConfirm ? await onConfirm(panel) : true;
      if (v !== false) close(v);
    });
    root.addEventListener('keydown', ev => { if (ev.key === 'Escape') tryCancel(); });

    // Glisser vers le bas pour fermer (au-delà de 120 px ou à plus de 0,5 px/ms)
    let y0 = null, t0 = 0, dy = 0;
    const grab = $('.sheet__grabber', root), barEl = $('.sheet__bar', root);
    const startDrag = ev => { if (ev.target.closest('button')) return; y0 = ev.touches[0].clientY; t0 = Date.now(); dy = 0; panel.style.transition = 'none'; };
    [grab, barEl].forEach(h => h.addEventListener('touchstart', startDrag, { passive: true }));
    root.addEventListener('touchmove', ev => {
      if (y0 === null) return;
      dy = Math.max(0, ev.touches[0].clientY - y0);
      panel.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    root.addEventListener('touchend', () => {
      if (y0 === null) return;
      const v = dy / Math.max(1, Date.now() - t0);
      y0 = null;
      panel.style.transition = '';
      panel.style.transform = '';
      if (dy > 120 || v > 0.5) tryCancel();
    });

    document.body.appendChild(root);
    setTimeout(() => $('.sheet__btn--confirm', root)?.focus({ preventScroll: true }), 50);
  });
}

// ═══════════════════════════════════════════════════════════
//  Séance passée : brouillon et modifications non enregistrées
// ═══════════════════════════════════════════════════════════

const ADD_DRAFT_KEY = 'ppl_add_draft';
let addSnapshot = null;
function addState() {
  return JSON.stringify({ addCat, addDate, addSets, addExtras, addNotes, addProg, editSessionId });
}
function addDirty() { return addSnapshot !== null && addState() !== addSnapshot; }

// Les saisies sont gardées dans sessionStorage tant que l'écran est ouvert
document.addEventListener('input', () => {
  if (view !== 'add-session') return;
  try { sessionStorage.setItem(ADD_DRAFT_KEY, addState()); } catch {}
});

function restoreAddDraft() {
  try {
    const raw = sessionStorage.getItem(ADD_DRAFT_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || typeof d.addSets !== 'object') return false;
    ({ addCat, addDate, addSets, addExtras, addNotes, addProg } = d);
    editSessionId = d.editSessionId || null;
    addExtras = Array.isArray(addExtras) ? addExtras : [];
    return true;
  } catch { return false; }
}

// Démarrage : #train, ou #train/session (avec l'accueil dessous) si une séance est restaurée
function navBoot(sessionRestored) {
  navIndex = 0; navHist = [];
  navWrite('replace');
  let draft = false;
  if (sessionRestored) {
    nav.stacks.train.push('session');
  } else if (restoreAddDraft()) {
    draft = true;
    nav.tab = 'history';
    navWrite('replace');
    nav.stacks.history.push('add-session');
  }
  if (nav.stacks[nav.tab].length > 1) { navIndex = 1; navWrite('push'); }
  show('none');
  if (draft) addSnapshot = '';  // brouillon repris : toute sortie demande confirmation
}

// ═══════════════════════════════════════════════════════════
//  Geste de retour depuis le bord (app installée sur iOS)
// ═══════════════════════════════════════════════════════════

function isStandalone() {
  return navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

(function edgeSwipe() {
  let x0 = null, t0 = 0, dx = 0, layer = null, cur = null, tracking = false;
  const W = () => window.innerWidth;
  const reset = () => { x0 = null; tracking = false; dx = 0; };

  document.addEventListener('touchstart', ev => {
    if (!isStandalone() || ev.touches.length !== 1) return;
    const x = ev.touches[0].clientX;
    if (x >= 24 || nav.stacks[nav.tab].length < 2) return;
    if (currentRoute() === 'session' || document.querySelector('.sheet-root, .ios-dialog, .modal-overlay, .rest-overlay')) return;
    const fe = document.activeElement;
    if (fe && /^(INPUT|TEXTAREA|SELECT)$/.test(fe.tagName)) return;
    x0 = x; t0 = Date.now(); dx = 0; tracking = true;
  }, { passive: true });

  document.addEventListener('touchmove', ev => {
    if (!tracking) return;
    dx = Math.max(0, ev.touches[0].clientX - x0);
    if (!layer && dx > 6) {
      // Écran précédent, figé, glissé dessous
      const s = nav.stacks[nav.tab];
      const prevKey = nav.tab + '/' + s.slice(0, -1).join('/');
      layer = document.createElement('div');
      layer.className = 'edge-layer';
      layer.setAttribute('aria-hidden', 'true');
      layer.inert = true;
      layer.innerHTML = `<div style="transform:translateY(${-(scrollMem[prevKey] || 0)}px)">${snapMem[prevKey] || ''}</div>`;
      document.body.appendChild(layer);
      cur = $('#app');
      cur.classList.add('edge-current');
    }
    if (!layer) return;
    const p = Math.min(1, dx / W());
    cur.style.transform = `translateX(${dx}px)`;
    layer.style.transform = `translateX(${-30 * (1 - p)}%)`;
  }, { passive: true });

  const end = () => {
    if (!tracking) return;
    const v = dx / Math.max(1, Date.now() - t0);
    const ok = layer && (dx > W() * 0.35 || v > 0.5);
    const l = layer, c = cur;
    layer = null; cur = null;
    reset();
    if (!l) return;
    c.style.transition = l.style.transition = 'transform .25s cubic-bezier(.2,.8,.2,1)';
    if (ok) {
      c.style.transform = `translateX(${W()}px)`;
      l.style.transform = 'translateX(0)';
      setTimeout(() => {
        c.style.transition = c.style.transform = '';
        c.classList.remove('edge-current');
        skipTransition = true; // le geste a déjà animé
        try { goBack(); } finally { skipTransition = false; }
        l.remove();
      }, 250);
    } else {
      c.style.transform = 'translateX(0)';
      l.style.transform = 'translateX(-30%)';
      setTimeout(() => { c.style.transition = c.style.transform = ''; c.classList.remove('edge-current'); l.remove(); }, 250);
    }
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
})();

// ═══════════════════════════════════════════════════════════
//  Dashboard
// ═══════════════════════════════════════════════════════════

// Pastille de séance : initiale sur la couleur de la séance, ou l'emoji choisi pour une séance Perso
function catDot(cat, progId, size = 28) {
  progId = progId || data.activeProgramme;
  const meta = sessionMeta(cat, progId);
  const label = rawLabel(cat, progId);
  const inner = progId === 'custom' ? meta.icon : esc(label.trim().charAt(0).toUpperCase());
  return `<span class="cat-dot ${progId === 'custom' ? 'cat-dot--emoji' : ''}" style="--cat-color:${meta.color};--dot:${size}px" aria-hidden="true">${inner}</span>`;
}

// « dans 1 j 18 h », « dans 14 h », « dans 35 min » (jamais de secondes)
function fmtWait(ms) {
  const min = Math.max(1, Math.ceil(ms / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d) return `${d} j${h ? ` ${h} h` : ''}`;
  if (h) return `${h} h${h < 3 && m ? ` ${pad(m)}` : ''}`;
  return `${m} min`;
}

// État de récupération d'une séance du programme affiché
function catStatus(cat) {
  const last = prog().timers[cat];
  const cd = getCooldown(cat) * 3600_000;
  const remaining = last ? last + cd - Date.now() : 0;
  return { last, remaining, ready: remaining <= 0, progress: last ? Math.min(1, 1 - remaining / cd) : 1 };
}

// Anneau de récupération (28 px)
function recoveryRing(p) {
  const c = 2 * Math.PI * 11;
  return `<svg class="ring" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
    <circle cx="14" cy="14" r="11" class="ring__track"/>
    <circle cx="14" cy="14" r="11" class="ring__fill" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}"/>
  </svg>`;
}

// Prochaine séance : la séance prête faite il y a le plus longtemps (ou jamais faite),
// sinon celle qui sera prête la première
function nextSessionCat(keys) {
  if (!keys.length) return null;
  const ready = keys.filter(k => catStatus(k).ready);
  if (ready.length) return ready.sort((a, b) => (prog().timers[a] || 0) - (prog().timers[b] || 0))[0];
  return keys.slice().sort((a, b) => catStatus(a).remaining - catStatus(b).remaining)[0];
}

function lastEntryOf(cat) {
  const p = data.activeProgramme;
  return (data.history || []).find(h => h.category === cat && (h.programme || 'ppl') === p) || null;
}

function cellStatusHtml(cat) {
  const st = catStatus(cat);
  if (activeSession && activeSession.category === cat && activeSession.programme === data.activeProgramme) {
    return `<span class="home-cell__status home-cell__status--live">En cours</span>`;
  }
  return st.ready
    ? `<span class="home-cell__status home-cell__status--ready">Prête</span>`
    : `<span class="home-cell__status">dans ${fmtWait(st.remaining)}</span>${recoveryRing(st.progress)}`;
}

function renderDashboard() {
  const keys = sessionKeys();
  const pm   = progMeta();
  const liveHere = activeSession && activeSession.programme === data.activeProgramme && keys.includes(activeSession.category);
  const next = liveHere ? activeSession.category : nextSessionCat(keys);

  let hero = '';
  if (next) {
    const meta = sessionMeta(next);
    const st   = catStatus(next);
    const last = lastEntryOf(next);
    let info, btn;
    if (liveHere) {
      info = `<div class="hero__info hero__info--live">En cours · <span class="num" id="hero-elapsed">${fmtClock(Date.now() - activeSession.startedAt)}</span></div>`;
      btn  = `<button class="hero__btn" data-action="resume-session">Reprendre</button>`;
    } else {
      info = last
        ? `<div class="hero__info">Dernière fois : ${fmtDate(last.date)} · ${fmtVolume(sessionVolume(last.exercises))}</div>`
        : `<div class="hero__info">Jamais faite</div>`;
      if (!st.ready) info += `<div class="hero__wait" id="hero-wait">Prochaine séance prête dans ${fmtWait(st.remaining)}</div>`;
      btn = st.ready
        ? `<button class="hero__btn" data-action="start-session" data-cat="${next}">Démarrer ${meta.label}</button>`
        : `<button class="hero__btn hero__btn--gray" data-action="start-session" data-cat="${next}">Démarrer quand même</button>`;
    }
    hero = `
      <section class="hero" aria-label="Prochaine séance" style="--cat-color:${meta.color}">
        <div class="hero__eyebrow">${liveHere ? 'Séance en cours' : 'Prochaine séance'}</div>
        <div class="hero__head">
          ${catDot(next)}
          <div class="hero__name">${meta.label}</div>
        </div>
        ${meta.desc ? `<div class="hero__desc">${meta.desc}</div>` : ''}
        ${info}
        ${btn}
        <button class="hero__link" data-action="go-editor" data-cat="${next}">Modifier les exercices</button>
      </section>`;
  }

  const others = keys.filter(k => k !== next).map(cat => {
    const meta = sessionMeta(cat);
    return `
      <button class="home-cell" data-action="session-actions" data-cat="${cat}" id="cell-${cat}">
        ${catDot(cat)}
        <span class="home-cell__name">${meta.label}</span>
        <span class="home-cell__right" id="status-${cat}">${cellStatusHtml(cat)}</span>
      </button>`;
  }).join('');

  const streak = computeStreak();
  const streakCell = streak > 0 ? `
    <div class="list-group">
      <button class="home-cell home-cell--streak" data-action="go-stats">
        <span class="home-cell__icon" aria-hidden="true">${icon('flame', 22)}</span>
        <span class="home-cell__name">Régularité</span>
        <span class="home-cell__value">${streak} semaine${streak > 1 ? 's' : ''} d'affilée</span>
        <span class="home-cell__chev" aria-hidden="true">${icon('chevron.right', 14)}</span>
      </button>
    </div>` : '';

  const emptyCustom = data.activeProgramme === 'custom' && keys.length === 0
    ? `<div class="empty-state">
         <div>Programme vide</div>
         <div class="empty-state__sub">Ajoute des séances dans l'onglet Programme</div>
       </div>`
    : '';

  const right = `<button class="navbar__icon" data-action="go-settings" aria-label="Réglages">${icon('gear', 24)}</button>`;
  const sub = `<button class="navbar__sub" data-action="go-programmes" aria-label="Programme ${esc(pm.name)}, changer de programme">Programme ${esc(pm.name)} ${icon('chevron.right', 12)}</button>`;

  return `
    <div class="view dashboard">
      ${navBar({ title: 'Entraînement', right, sub })}
      <div class="home">
        ${hero || emptyCustom}
        ${others ? `<div class="list-title">Autres séances</div><div class="list-group">${others}</div>` : ''}
        ${streakCell}
      </div>
    </div>`;
}

// Feuille d'actions d'une séance de l'accueil
async function sessionActions(cat) {
  const st = catStatus(cat);
  const choice = await dialog({ type: 'sheet', title: rawLabel(cat), actions: [
    { label: 'Démarrer', value: 'start', style: 'preferred' },
    ...(!st.ready ? [{ label: 'Passer le délai de récupération', value: 'skip' }] : []),
    { label: 'Voir les exercices', value: 'see' },
    { label: 'Annuler', style: 'cancel' },
  ] });
  if (choice === 'start') return handleAction(null, { dataset: { cat } }, 'start-session');
  if (choice === 'skip') {
    prog().timers[cat] = null;
    save(); render();
    showToast(`${rawLabel(cat)} est disponible`);
    return;
  }
  if (choice === 'see') {
    const list = (prog().exercises[cat] || []).map(ex => `
      <li class="sheet-list__row"><span>${esc(ex.name)}</span><span class="sheet-list__meta num">${ex.sets} série${ex.sets > 1 ? 's' : ''}</span></li>`).join('');
    await sheet({ title: rawLabel(cat), cancel: '', confirm: 'OK',
      body: list ? `<ul class="sheet-list">${list}</ul>` : '<p class="sheet-empty">Aucun exercice</p>' });
  }
}

// Mise à jour légère : chronos chaque seconde, délais de récupération à la minute
let tickerMinute = -1;
function startTicker() {
  clearInterval(ticker);
  tickerMinute = -1;
  const tick = () => {
    if (activeSession) {
      const el = $('#session-elapsed');
      if (el) el.textContent = fmtDuration(Date.now() - activeSession.startedAt);
      const clock = fmtClock(Date.now() - activeSession.startedAt);
      const le = $('#livebar-elapsed'); if (le) le.textContent = clock;
      const he = $('#hero-elapsed');    if (he) he.textContent = clock;
      const lr = $('#livebar-rest');
      if (lr) { lr.hidden = !restActive; if (restActive) lr.textContent = fmtRest(restTimeLeft); }
    }
    if (view !== 'dashboard') return;
    const minute = Math.floor(Date.now() / 60000);
    if (minute === tickerMinute) return;
    const first = tickerMinute === -1;
    tickerMinute = minute;
    if (first) return;
    // Une séance devient prête : on redessine l'accueil (la carte « Prochaine séance » peut changer)
    const keys = sessionKeys();
    if (keys.some(k => { const s = $(`#status-${k}`); return s && catStatus(k).ready && !s.querySelector('.home-cell__status--ready'); })
        || ($('#hero-wait') && catStatus(nextSessionCat(keys)).ready)) { render(); return; }
    keys.forEach(k => { const s = $(`#status-${k}`); if (s) s.innerHTML = cellStatusHtml(k); });
    const hw = $('#hero-wait');
    if (hw) hw.textContent = `Prochaine séance prête dans ${fmtWait(catStatus(nextSessionCat(keys)).remaining)}`;
  };
  tick();
  ticker = setInterval(tick, 1000);
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
      ${navBar({ title: 'Programmes' })}
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

function startSession(cat) {
  sessionNotes  = '';
  persistWarned = false;
  const progKey = data.activeProgramme;
  const exList  = prog().exercises[cat] || [];
  activeSession = {
    category:  cat,
    programme: progKey,
    startedAt: Date.now(),
    // Chaque série reprend la série correspondante de la dernière fois (sinon la dernière série faite)
    exercises: exList.map(ex => {
      const prevEx = lastPerf(progKey, cat, ex)?.ex;
      return {
        exId: ex.id,
        name: ex.name,
        sets: Array.from({ length: ex.sets }, (_, i) => {
          const src  = prevEx?.sets[i] ?? prevEx?.sets.at(-1) ?? { weight: ex.lastWeight || '', reps: ex.lastReps || '' };
          const prev = prevEx?.sets[i];
          return {
            weight: src.weight ?? '',
            reps:   src.reps   ?? '',
            plannedWeight: src.weight ?? '',
            prev:   prev ? { weight: prev.weight, reps: prev.reps } : null,
            done:   false,
          };
        }),
      };
    }),
  };
  activeSession.baseline = computeBaseline(activeSession);
  view = 'session';
  persistSession();
  render();
  requestWakeLock();
}

function endSession() {
  clearRest(); restActive = false; restMinimized = false;
  activeSession = null;
  sessionNotes  = '';
  persistWarned = false;
  persistSession();
  releaseWakeLock();
  maybeShowUpdateBanner();
}

function renderSession() {
  const { category: cat } = activeSession;
  const meta = sessionMeta(cat, activeSession.programme);

  const totalSets = activeSession.exercises.reduce((a, ex) => a + ex.sets.length, 0);
  const doneSets  = activeSession.exercises.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0);
  const pct       = totalSets ? Math.round(doneSets / totalSets * 100) : 0;

  const curVolTotal = activeSession.exercises.reduce((a, ex) => a + setsVolume(ex.sets.filter(s => s.done)), 0);
  const baseline    = activeSession.baseline || {};

  const exHtml = activeSession.exercises.map((ex, ei) => {
    const exData  = sessProg().exercises[cat]?.find(e => e.id === ex.exId);
    const prText  = exData?.pr ? `PR : ${dispW(exData.pr.weight)} ${unitLbl()} × ${esc(exData.pr.reps)}` : '';
    const allDone = ex.sets.every(s => s.done);

    const last        = lastPerf(activeSession.programme, cat, ex);
    const prevSession = last?.h;
    const prevSets    = last?.ex.sets || [];

    // Volume par exercice, comparé au même nombre de séries que la dernière fois :
    // gris tant que l'exercice n'est pas fini, vert s'il progresse, jamais rouge en cours de séance
    const doneSets  = ex.sets.filter(s => s.done);
    const exCurVol  = setsVolume(doneSets);
    const exPrevVol = setsVolume(prevSets.slice(0, doneSets.length));
    const exDelta   = exCurVol - exPrevVol;
    const deltaCls  = allDone && exDelta > 0 ? 'ex-vol__delta--up' : '';
    const exVolHtml = exCurVol > 0
      ? `<span class="ex-vol">${fmtVolume(exCurVol)}${exPrevVol > 0 ? ` <span class="ex-vol__delta ${deltaCls}">(${exDelta >= 0 ? '+' : '−'}${fmtVolume(Math.abs(exDelta))})</span>` : ''}</span>`
      : '';

    const setsHtml = ex.sets.map((s, si) => {
      if (s.done) {
        const record      = recordLabel(s, baseline[ex.exId]);
        const weightLabel = s.weight ? `${dispW(s.weight)} ${unitLbl()} × ` : '';
        return `
          <div class="set-row set-row--done">
            <span class="set-num">Série ${si + 1}</span>
            <span class="set-val">${weightLabel}${esc(s.reps)} reps${record ? `<span class="pr-badge">${record}</span>` : ''}</span>
            <button class="rest-btn" data-action="start-rest" data-ei="${ei}">⏱ Repos</button>
            <button class="edit-set-btn" data-action="edit-set" data-ei="${ei}" data-si="${si}" title="Modifier">✏</button>
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
            <input type="text" inputmode="decimal" autocomplete="off" class="set-input" placeholder="—" aria-label="Charge série ${si + 1}"
                   value="${dispW(s.weight)}" data-action="set-weight" data-ei="${ei}" data-si="${si}">
            <span class="input-unit">${unitLbl()}</span>
          </div>
          <div class="input-group">
            <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" class="set-input set-input--required" placeholder="0" aria-label="Répétitions série ${si + 1}"
                   value="${esc(s.reps)}" data-action="set-reps" data-ei="${ei}" data-si="${si}">
            <span class="input-unit">reps</span>
          </div>
          <button class="btn btn--success btn--sm" data-action="validate-set" data-ei="${ei}" data-si="${si}">✓</button>
        </div>`;
    }).join('');

    const prevHtml = prevSets.length ? `
      <div class="prev-session">
        <div class="prev-session__label">Séance du ${fmtDate(prevSession.date)}</div>
        <div class="prev-session__sets">
          ${prevSets.map((s, i) => `<span class="prev-set">S${i+1} : ${dispW(s.weight)} ${unitLbl()} × ${esc(s.reps)}</span>`).join('')}
        </div>
      </div>` : '';

    const restSecs = exData?.rest ?? data.defaultRest;
    const restLabel = restSecs >= 60 ? `${restSecs / 60}min` : `${restSecs}s`;

    return `
      <div class="exercise-block ${allDone ? 'exercise-block--done' : ''}">
        <div class="exercise-header">
          <span class="exercise-name">${esc(ex.name)}</span>
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
      ${navBar({ large: false,
        title: `<span class="navbar__title-main">${meta.label}</span>
                <span class="header__sub navbar__title-sub"><span class="num">${doneSets}/${totalSets}</span> séries${curVolTotal > 0 ? ` · ${fmtVolume(curVolTotal)}` : ''} · <span id="session-elapsed" class="num">${fmtDuration(Date.now() - activeSession.startedAt)}</span></span>`,
        left: `<button class="navbar__icon" data-action="back" aria-label="Réduire la séance">${icon('chevron.down', 24)}</button>`,
        right: `<button class="navbar__text navbar__text--bold" data-action="finish-session">Terminer</button>`,
        extra: `<div class="progress-bar" role="progressbar" aria-label="Séries validées" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-bar__fill" style="width:${pct}%;background:${meta.color}"></div>
        </div>` })}
      <div class="session-content">
        ${exHtml}
        <button class="session-add-ex-btn" data-action="add-session-ex">
          + Ajouter un exercice
        </button>
        <div class="session-notes-block">
          <div class="session-notes-label">Notes de séance</div>
          <textarea class="session-notes-input" data-action="session-notes"
                    placeholder="Comment s'est passée la séance ? (optionnel)">${esc(sessionNotes)}</textarea>
        </div>
      </div>
    </div>
    ${renderRestOverlay()}
    ${renderRestEditModal()}
    ${renderEditSetModal()}
    ${addExModal ? renderAddExModal() : ''}`;
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
  const s   = ex.sets[si];
  const row = document.querySelector(`[data-action="set-reps"][data-ei="${ei}"][data-si="${si}"]`);
  const wIn = document.querySelector(`[data-action="set-weight"][data-ei="${ei}"][data-si="${si}"]`);
  if (wIn && !weightOk(wIn.value)) { flagInvalid(wIn, weightMsg()); return; }
  if (num(s.reps, 1, 100, true) === null) { flagInvalid(row, 'Reps entre 1 et 100'); return; }
  s.reps = String(parseInt(s.reps));

  s.done = true;
  validationSound();
  haptic();

  // La série suivante garde sa valeur prévue, sauf si la charge vient d'être modifiée
  const nextSet = ex.sets[si + 1];
  if (nextSet && !nextSet.done && (parseFloat(s.weight) || 0) !== (parseFloat(s.plannedWeight) || 0)) {
    nextSet.weight = s.weight;
  }

  const cat    = activeSession.category;
  const exData = sessProg().exercises[cat]?.find(e => e.id === ex.exId);

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
  restEndTime = Date.now() + restTimeLeft * 1000;
  resumeRestCountdown();
}

// Relance l'affichage du chrono sans toucher à l'heure de fin (retour au premier plan, restauration)
function resumeRestCountdown() {
  clearInterval(restInterval);
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
      persistSession();
      setTimeout(removeRestUI, 350);
    }
  }, 500);
}

function renderRestEditModal() {
  if (restEditEi === null) return '';
  const ex     = activeSession?.exercises[restEditEi];
  const cat    = activeSession?.category;
  const exData = sessProg().exercises[cat]?.find(e => e.id === ex?.exId);
  const cur    = exData?.rest ?? data.defaultRest;
  return `
    <div class="modal-overlay">
      <div class="modal" style="max-width:320px;">
        <div class="modal__title">Repos — ${esc(ex?.name)}</div>
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

function renderEditSetModal() {
  if (!editSetModal) return '';
  const { ei, si } = editSetModal;
  const ex = activeSession?.exercises[ei];
  const s  = ex?.sets[si];
  if (!s) return '';
  return `
    <div class="modal-overlay">
      <div class="modal" style="max-width:320px;">
        <div class="modal__title">Modifier — ${esc(ex.name)} S${si + 1}</div>
        <label class="form-label">Charge (${unitLbl()})</label>
        <input type="text" inputmode="decimal" autocomplete="off" id="editSetWeight" class="form-input"
               value="${dispW(s.weight)}" placeholder="—">
        <label class="form-label">Répétitions</label>
        <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" id="editSetReps" class="form-input"
               value="${esc(s.reps)}" placeholder="0">
        <div class="modal__actions">
          <button class="btn btn--secondary" data-action="close-edit-set">Annuler</button>
          <button class="btn btn--primary"   data-action="save-edit-set">Enregistrer</button>
        </div>
      </div>
    </div>`;
}

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

function clearRest() { clearInterval(restInterval); restInterval = null; }

function removeRestUI() {
  document.querySelectorAll('.rest-overlay, .rest-mini').forEach(el => el.remove());
}

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
      persistSession();
      timerDone();
      setTimeout(removeRestUI, 350);
    } else {
      restTimeLeft = remaining;
      resumeRestCountdown();
    }
  }
});

// ═══════════════════════════════════════════════════════════
//  Editor
// ═══════════════════════════════════════════════════════════

// En-tête de l'éditeur : racine de l'onglet Programme, ou écran empilé depuis l'accueil
function editorNavBar() {
  if (nav.stacks[nav.tab].length > 1) return navBar({ title: 'Exercices' });
  const pm = progMeta();
  return navBar({ title: 'Programme',
    right: `<button class="navbar__text" data-action="go-settings">Réglages</button>`,
    sub: `<button class="navbar__sub" data-action="go-programmes" aria-label="Programme ${esc(pm.name)}, changer de programme">Programme ${esc(pm.name)} ${icon('chevron.right', 12)}</button>` });
}

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
      ${editorNavBar()}
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
      ${navBar({ title: editSessionId ? 'Modifier la séance' : 'Séance passée', large: false,
        left: `<button class="navbar__text" data-action="cancel-add-session">Annuler</button>`,
        right: `<button class="navbar__text navbar__text--bold" data-action="save-past-session" ${addHasReps() ? '' : 'disabled'}>Enregistrer</button>` })}
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
      ${navBar({ title: 'Réglages' })}
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
      ${navBar({ title: 'Progrès' })}
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
      ${navBar({ title: 'Progrès' })}
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
      ${navBar({ title: 'Historique',
        right: `<button class="navbar__icon" data-action="go-add-session" aria-label="Ajouter une séance passée">${icon('plus', 24)}</button>` })}
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
    // Retour : la séance reste en cours, joignable par la mini-barre
    case 'back': {
      goBack(); break;
    }
    case 'resume-session': {
      if (!activeSession) break;
      if (currentRoute() !== 'session') navigate('session');
      break;
    }
    case 'session-actions': {
      await sessionActions(el.dataset.cat); break;
    }
    // Onglets (tab bar) et écrans empilés dans l'onglet courant
    case 'go-home': {
      switchTab('train'); break;
    }
    case 'go-program': {
      editorCat = sessionKeys().includes(editorCat) ? editorCat : firstSession();
      switchTab('program'); break;
    }
    case 'go-editor': {
      const c = el.dataset.cat;
      editorCat = c && sessionKeys().includes(c) ? c : sessionKeys().includes(editorCat) ? editorCat : firstSession();
      navigate('editor'); break;
    }
    case 'go-history': {
      if (el.closest('.tabbar')) switchTab('history'); else navigate('history');
      break;
    }
    case 'go-stats': {
      statsCat = sessionKeys().includes(statsCat) ? statsCat : firstSession();
      if (el.closest('.tabbar')) switchTab('progress'); else navigate('stats');
      break;
    }
    case 'go-programmes': {
      navigate('programmes'); break;
    }
    case 'cancel-add-session': {
      if (addDirty()) {
        const choice = await dialog({ type: 'sheet', actions: [
          { label: 'Ignorer les modifications', value: 'discard', style: 'destructive' },
          { label: 'Continuer la modification', style: 'cancel' },
        ] });
        if (choice !== 'discard') break;
      }
      addSnapshot = null;
      goBack(); break;
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
      navigate('add-session'); break;
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
      navigate('settings'); break;
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
      view = 'history'; render(); break;
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
        if (choice === 'resume') { navigate('session'); break; }
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
      editSetModal = { ei: parseInt(el.dataset.ei), si: parseInt(el.dataset.si) };
      render();
      setTimeout(() => { $('#editSetReps')?.focus(); $('#editSetReps')?.select(); }, 50);
      break;
    }
    case 'close-edit-set': {
      editSetModal = null; render(); break;
    }
    case 'save-edit-set': {
      if (!editSetModal) break;
      const { ei: eei, si: esi } = editSetModal;
      const ex  = activeSession.exercises[eei];
      const s   = ex.sets[esi];
      const wIn = $('#editSetWeight'), rIn = $('#editSetReps');
      if (!weightOk(wIn?.value)) { flagInvalid(wIn, weightMsg()); break; }
      const reps = num(rIn?.value, 1, 100, true);
      if (reps === null) { flagInvalid(rIn, 'Reps entre 1 et 100'); break; }
      // Les records ne sont recalculés qu'à l'enregistrement de la séance
      s.weight = storeW(wIn?.value ?? '');
      s.reps   = String(reps);
      editSetModal = null;
      render();
      showToast('Série modifiée');
      break;
    }
    case 'start-rest': {
      const eiRest = el.dataset.ei !== undefined ? parseInt(el.dataset.ei) : null;
      if (eiRest !== null) {
        const cat    = activeSession.category;
        const exData = sessProg().exercises[cat]?.find(e => e.id === activeSession.exercises[eiRest]?.exId);
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
      const secs = num($('#restEditInput')?.value, 10, 600, true);
      if (secs === null) { flagInvalid($('#restEditInput'), 'Repos entre 10 et 600 s'); break; }
      {
        const ex     = activeSession.exercises[restEditEi];
        const cat    = activeSession.category;
        const exData = sessProg().exercises[cat]?.find(e => e.id === ex?.exId);
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
      const val = num($('#customRest')?.value, 10, 600, true);
      if (val !== null) {
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
      const notesEl = $('.session-notes-input');
      if (notesEl) sessionNotes = notesEl.value;
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
      finishSound();
      haptic();
      endSession();
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
    navBoot(restoreSession());
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
