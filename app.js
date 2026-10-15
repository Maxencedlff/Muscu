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
let restEditEi    = null;
let editSetModal  = null; // { ei, si } — édition d'une série validée
let editExIdx     = null;
let statsCat      = firstSession();
let statsMode     = 'volume';   // 'volume' | 'charge' | '1rm'
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
  else if (view === 'history-detail') app.innerHTML = renderHistoryDetail(); // ROUTE-LOT3
  else if (view === 'stats-ex')       app.innerHTML = renderStatsExercise(); // ROUTE-LOT3
  else if (view === 'stats-overview') app.innerHTML = renderStatsOverview(); // ROUTE-LOT3
  else if (view === 'prog-picker')    app.innerHTML = renderProgPicker();    // ROUTE-LOT3
  else if (view === 'ex-edit')        app.innerHTML = renderExEdit();        // ROUTE-LOT3
  else if (view === 'cs-edit')        app.innerHTML = renderCsEdit();        // ROUTE-LOT3

  if (view === 'stats-ex') drawCharts();
  if (view === 'settings') fillAppVersion();

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

// TEMP-LOT2 début
// Version minimale de icon() et fmtNum() en attendant le sprite et les formats du lot 2
function fmtNum(v) { return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v); }
function icon(name, size = 22) {
  return `<svg class="ico" width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}
(function injectTempSprite() {
  if (document.getElementById('i-chevron.right')) return;
  const p = { 'chevron.left': '<path d="M15 5l-7 7 7 7"/>', 'chevron.right': '<path d="M9 5l7 7-7 7"/>',
    'plus': '<path d="M12 5v14M5 12h14"/>', 'minus': '<path d="M5 12h14"/>', 'checkmark': '<path d="M5 12.5l4.5 4.5L19 7"/>',
    'line.3.horizontal': '<path d="M4 7h16M4 12h16M4 17h16"/>', 'chart': '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' };
  const svg = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${Object.entries(p).map(([k, d]) =>
    `<symbol id="i-${k}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</symbol>`).join('')}</svg>`;
  document.body.insertAdjacentHTML('afterbegin', svg);
})();
// TEMP-LOT2 fin

// ═══════════════════════════════════════════════════════════
//  Onglet Programme (lot 5)
// ═══════════════════════════════════════════════════════════

// En-tête provisoire des écrans du lot 5 (le lot 3 le remplacera par navBar)
// left / right : HTML des boutons ; parent : vue où ramène le bouton retour
function screenHeader(title, { parent = null, left = null, right = '' } = {}) {
  const back = left ?? `
    <button class="icon-btn nav-back" data-action="back" ${parent ? `data-parent="${parent}"` : ''} aria-label="Retour">
      ${icon('chevron.left', 24)}
    </button>`;
  return `
    <header class="header scr-header">
      <div class="scr-header__side">${back}</div>
      <span class="header__title scr-header__title">${title}</span>
      <div class="scr-header__side scr-header__side--right">${right}</div>
    </header>`;
}

// Pastille de séance : rond coloré avec l'initiale (intégrées) ou emoji choisi (Perso)
function sessionBadge(cat, progId, size = 28) {
  const meta = sessionMeta(cat, progId);
  if (progId === 'custom') {
    return `<span class="sbadge sbadge--emoji" style="--c:${meta.color};width:${size}px;height:${size}px">${meta.icon}</span>`;
  }
  return `<span class="sbadge" style="--c:${meta.color};width:${size}px;height:${size}px">${esc(String(meta.label).charAt(0))}</span>`;
}

// Poids affiché à la française (« 32,5 »), quel que soit le format renvoyé par dispW
function wFr(kg) {
  const s = dispW(kg);
  if (s === '') return '';
  const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
  return isNaN(v) ? s : fmtNum(v);
}

function exSetsCount(cat, progId) {
  const list = data.programmes[progId]?.exercises?.[cat] || [];
  return { n: list.length, sets: list.reduce((a, e) => a + (parseInt(e.sets) || 0), 0) };
}

function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }

function renderProgrammes() {
  const pid  = data.activeProgramme;
  const pm   = progMeta(pid);
  const cell = (cat, progId, action) => {
    const c = exSetsCount(cat, progId);
    return `
      <button class="cell cell--nav" data-action="${action}" data-cat="${esc(cat)}" data-id="${esc(cat)}">
        ${sessionBadge(cat, progId)}
        <span class="cell__body">
          <span class="cell__title">${sessionMeta(cat, progId).label}</span>
          <span class="cell__sub">${plural(c.n, 'exercice', 'exercices')} · ${plural(c.sets, 'série', 'séries')}</span>
        </span>
        ${icon('chevron.right', 16)}
      </button>`;
  };
  const builtin = pid !== 'custom' ? `
      <div class="group-title">Séances</div>
      <div class="group">${sessionKeys(pid).map(c => cell(c, pid, 'open-prog-session')).join('')}</div>` : '';
  const customKeys = Object.keys(data.customSessions || {});
  const customAction = pid === 'custom' ? 'open-prog-session' : 'edit-custom-session';
  const custom = `
      <div class="group-title">Séances perso</div>
      <div class="group">
        ${customKeys.map(c => cell(c, 'custom', customAction)).join('')}
        <button class="cell cell--action" data-action="add-custom-session">${icon('plus', 20)}<span>Ajouter une séance</span></button>
      </div>
      ${pid !== 'custom' && customKeys.length ? `<div class="group-foot">Choisis le programme Perso pour t'entraîner avec ces séances.</div>` : ''}`;

  return `
    <div class="view programmes lot5">
      ${screenHeader('Programme', { right: `<button class="nav-txt" data-action="go-settings">Réglages</button>` })}
      <div class="scr">
        <div class="group">
          <button class="cell cell--nav" data-action="go-prog-picker">
            <span class="cell__body"><span class="cell__title">Programme actif</span></span>
            <span class="cell__value">${pm.name}</span>
            ${icon('chevron.right', 16)}
          </button>
        </div>
        ${builtin}
        ${custom}
      </div>
    </div>`;
}

// Sélecteur de programme façon iOS : liste groupée, coche sur le programme actif
function renderProgPicker() {
  const rows = Object.entries(PROGRAMMES).map(([id, pm]) => {
    const keys  = sessionKeys(id);
    const color = id === 'custom' ? 'var(--label3)' : sessionMeta(keys[0], id).color;
    const names = id === 'custom'
      ? (Object.values(data.customSessions || {}).map(s => esc(s.label)).join(' · ') || pm.desc)
      : Object.values(pm.sessions).map(s => s.label).join(' · ');
    const on = data.activeProgramme === id;
    return `
      <button class="cell cell--pick" data-action="select-prog" data-id="${id}" aria-pressed="${on}">
        <span class="psq" style="--c:${color}">${esc(pm.name.charAt(0))}</span>
        <span class="cell__body">
          <span class="cell__title">${pm.name}</span>
          <span class="cell__sub cell__sub--1">${names}</span>
        </span>
        <span class="cell__check">${on ? icon('checkmark', 20) : ''}</span>
      </button>`;
  }).join('');
  return `
    <div class="view prog-picker lot5">
      ${screenHeader('Programme actif', { parent: 'programmes' })}
      <div class="scr">
        <div class="group-title">Programmes</div>
        <div class="group">${rows}</div>
        <div class="group-foot">Ton historique reste disponible quand tu changes de programme.</div>
      </div>
    </div>`;
}

let editorEditing = false;   // mode Modifier de la liste d'exercices
let exDraft       = null;    // brouillon de l'écran Programme › Exercice
let csReturn      = 'programmes';
let csIcon        = '🏋️';
const CS_ICONS  = ['🏋️','💪','🦾','🦵','🔥','⚡','🏃','🧘','🥊','🚴','🤸','🎯'];
const CS_COLORS = [['#FF9500','Orange'],['#FF3B30','Rouge'],['#FFCC00','Jaune'],['#34C759','Vert'],['#30B0C7','Turquoise'],
                   ['#007AFF','Bleu'],['#5856D6','Indigo'],['#AF52DE','Violet'],['#FF2D55','Rose'],['#8E8E93','Gris']];

// Programme › Séance : exercices, récupération, repos, mode Modifier (glisser pour réordonner)
function renderEditor() {
  const cat  = editorCat;
  const list = prog().exercises[cat] || [];
  const meta = sessionMeta(cat);
  if (!cat || !sessionKeys().includes(cat)) {
    return `
      <div class="view editor lot5">
        ${screenHeader('Séance', { parent: 'programmes' })}
        <div class="scr"><div class="empty-note">Programme vide. Crée des séances dans Programme.</div></div>
      </div>`;
  }
  const rows = list.map((ex, i) => {
    const last = lastPerf(data.activeProgramme, cat, ex);
    const best = last ? bestSet(last.ex.sets) : null;
    const sub  = `${plural(ex.sets, 'série', 'séries')}${best ? ` · dernier ${setTxt(best)}` : ''}`;
    if (editorEditing) {
      return `
        <div class="cell ed-row ed-row--edit" data-i="${i}">
          <button class="ed-minus" data-action="ed-reveal" data-i="${i}" aria-label="Supprimer ${esc(ex.name)}">${icon('minus', 14)}</button>
          <span class="cell__body">
            <span class="cell__title ed-name">${esc(ex.name)}</span>
            <span class="cell__sub">${sub}</span>
          </span>
          <button class="ed-del" data-action="del-ex" data-i="${i}">Supprimer</button>
          <span class="ed-handle" data-i="${i}" role="button" aria-label="Déplacer ${esc(ex.name)}">${icon('line.3.horizontal', 22)}</span>
        </div>`;
    }
    return `
      <button class="cell cell--nav ed-row" data-action="edit-ex" data-i="${i}">
        <span class="cell__body">
          <span class="cell__title ed-name">${esc(ex.name)}</span>
          <span class="cell__sub">${sub}</span>
        </span>
        ${icon('chevron.right', 16)}
      </button>`;
  }).join('');
  const cd = getCooldown(cat);
  return `
    <div class="view editor lot5">
      ${screenHeader(meta.label, { parent: 'programmes',
          right: list.length ? `<button class="nav-txt ${editorEditing ? 'nav-txt--bold' : ''}" data-action="toggle-edit-mode">${editorEditing ? 'OK' : 'Modifier'}</button>` : '' })}
      <div class="scr">
        <div class="group-title">Exercices</div>
        <div class="group ed-list">
          ${rows || '<div class="cell"><span class="cell__sub">Aucun exercice pour l\'instant</span></div>'}
          ${editorEditing ? '' : `<button class="cell cell--action" data-action="add-ex">${icon('plus', 20)}<span>Ajouter un exercice</span></button>`}
        </div>
        <div class="group-title">Réglages de la séance</div>
        <div class="group">
          <div class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Récupération</span></span>
            <div class="segmented seg-sm" role="group" aria-label="Récupération">
              ${[24, 48, 72, 96].map(h => `<button class="segmented__btn ${cd === h ? 'segmented__btn--active' : ''}" aria-pressed="${cd === h}" data-action="set-cooldown" data-h="${h}">${h} h</button>`).join('')}
            </div>
          </div>
          <button class="cell cell--nav" data-action="setting-rest">
            <span class="cell__body"><span class="cell__title">Repos par défaut</span></span>
            <span class="cell__value num">${fmtRest(data.defaultRest)}</span>
            ${icon('chevron.right', 16)}
          </button>
          ${data.activeProgramme === 'custom' ? `
          <button class="cell cell--nav" data-action="edit-custom-session" data-id="${esc(cat)}">
            <span class="cell__body"><span class="cell__title">Nom, icône et couleur</span></span>
            ${icon('chevron.right', 16)}
          </button>` : ''}
        </div>
        <div class="group-foot">La récupération règle le délai avant que la séance soit de nouveau prête.</div>
      </div>
    </div>`;
}

// Meilleure série d'une liste : la plus lourde, puis le plus de reps
function bestSet(sets) {
  let best = null;
  (sets || []).forEach(s => {
    const w = parseFloat(s.weight) || 0, r = parseInt(s.reps) || 0;
    if (r <= 0) return;
    if (!best || w > best.w || (w === best.w && r > best.r)) best = { w, r, weight: s.weight, reps: s.reps };
  });
  return best;
}
function setTxt(b) {
  if (!b) return '';
  return b.w > 0 ? `${wFr(b.weight)} ${unitLbl()} × ${b.r}` : `${b.r} reps`;
}

// Programme › Exercice : nom, séries, repos, objectif, haut de fourchette
function renderExEdit() {
  const isEdit = editExIdx !== null;
  const d = exDraft || { name: '', sets: 3, rest: null, target: null, repMax: 12 };
  const restVal = d.rest ?? data.defaultRest;
  return `
    <div class="view ex-edit lot5">
      ${screenHeader(isEdit ? 'Exercice' : 'Nouvel exercice', {
          left: `<button class="nav-txt" data-action="back" data-parent="editor">Annuler</button>`,
          right: `<button class="nav-txt nav-txt--bold" data-action="save-ex">OK</button>` })}
      <div class="scr">
        <div class="group-title">Nom</div>
        <div class="group">
          <div class="cell cell--field">
            <input type="text" id="exName" class="field" value="${esc(d.name)}" placeholder="Ex : Curl biceps haltères"
                   autocomplete="off" enterkeyhint="done" aria-label="Nom de l'exercice">
          </div>
        </div>
        <div class="group-title">Séance</div>
        <div class="group">
          <div class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Séries</span></span>
            <span class="cell__value num" id="exSetsVal">${d.sets}</span>
            <div class="stepper" role="group" aria-label="Séries">
              <button data-action="ex-sets" data-d="-1" aria-label="Une série de moins">${icon('minus', 18)}</button>
              <button data-action="ex-sets" data-d="1" aria-label="Une série de plus">${icon('plus', 18)}</button>
            </div>
          </div>
          <div class="cell cell--ctl cell--wrap">
            <span class="cell__body">
              <span class="cell__title">Repos</span>
              <span class="cell__sub" id="exRestSub">${d.rest == null ? `Par défaut (${fmtRest(data.defaultRest)})` : 'Propre à cet exercice'}</span>
            </span>
            <span class="cell__value num" id="exRestVal">${fmtRest(restVal)}</span>
            <div class="stepper" role="group" aria-label="Ajuster le repos">
              <button data-action="ex-rest-step" data-d="-15" aria-label="Moins 15 secondes">${icon('minus', 18)}</button>
              <button data-action="ex-rest-step" data-d="15" aria-label="Plus 15 secondes">${icon('plus', 18)}</button>
            </div>
            <div class="segmented seg-full" role="group" aria-label="Préréglages de repos">
              ${[60, 90, 120, 180].map(s => `<button class="segmented__btn ${d.rest === s ? 'segmented__btn--active' : ''}" aria-pressed="${d.rest === s}" data-action="ex-rest" data-s="${s}">${fmtRest(s)}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="group-title">Progression</div>
        <div class="group">
          <label class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Objectif</span></span>
            <span class="field-suffix">
              <input type="text" inputmode="decimal" id="exTarget" class="field field--num" autocomplete="off"
                     value="${d.target ? wFr(d.target) : ''}" placeholder="—" aria-label="Objectif en ${unitLbl()}">
              <span>${unitLbl()}</span>
            </span>
          </label>
          <label class="cell cell--ctl">
            <span class="cell__body"><span class="cell__title">Haut de fourchette de reps</span></span>
            <span class="field-suffix">
              <input type="text" inputmode="numeric" id="exRepMax" class="field field--num" autocomplete="off"
                     value="${d.repMax ?? 12}" aria-label="Haut de fourchette de reps">
              <span>reps</span>
            </span>
          </label>
        </div>
        <div class="group-foot">Quand toutes tes séries atteignent ce nombre de reps, l'app te propose d'augmenter la charge.</div>
        ${isEdit ? `
        <div class="group">
          <button class="cell cell--destructive" data-action="del-ex" data-i="${editExIdx}">Supprimer l'exercice</button>
        </div>
        <div class="group-foot">L'historique de cet exercice est conservé.</div>` : ''}
      </div>
    </div>`;
}

// Séance Perso : nom, description, icône (grille), couleur
function renderCsEdit() {
  const isEdit   = csEditId !== null;
  const existing = isEdit ? (data.customSessions[csEditId] || {}) : {};
  const icons    = CS_ICONS.includes(csIcon) ? CS_ICONS : [csIcon, ...CS_ICONS.slice(0, 11)];
  return `
    <div class="view cs-edit lot5">
      ${screenHeader(isEdit ? 'Modifier la séance' : 'Nouvelle séance', {
          left: `<button class="nav-txt" data-action="close-cs-modal">Annuler</button>`,
          right: `<button class="nav-txt nav-txt--bold" data-action="save-cs-modal">OK</button>` })}
      <div class="scr">
        <div class="group-title">Nom</div>
        <div class="group">
          <div class="cell cell--field"><input type="text" id="csName" class="field" value="${esc(existing.label)}"
               placeholder="Ex : Séance A" autocomplete="off" aria-label="Nom de la séance"></div>
          <div class="cell cell--field"><input type="text" id="csDesc" class="field" value="${esc(existing.desc)}"
               placeholder="Description (optionnel)" autocomplete="off" aria-label="Description"></div>
        </div>
        <div class="group-title">Icône</div>
        <div class="group group--pad">
          <div class="emoji-grid" role="radiogroup" aria-label="Icône">
            ${icons.map(ic => `<button class="emoji-btn ${ic === csIcon ? 'is-on' : ''}" role="radio" aria-checked="${ic === csIcon}" data-action="pick-cs-icon" data-icon="${esc(ic)}">${esc(ic)}</button>`).join('')}
          </div>
        </div>
        <div class="group-title">Couleur</div>
        <div class="group group--pad">
          <div class="color-grid" role="radiogroup" aria-label="Couleur">
            ${CS_COLORS.map(([c, n]) => `<button class="color-swatch2 ${c.toLowerCase() === String(csColor).toLowerCase() ? 'is-on' : ''}" role="radio" aria-checked="${c.toLowerCase() === String(csColor).toLowerCase()}" aria-label="${n}" data-action="pick-cs-color" data-color="${c}" style="--c:${c}"></button>`).join('')}
          </div>
        </div>
        ${isEdit ? `
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="delete-custom-session">Supprimer la séance</button>
        </div>` : ''}
      </div>
    </div>`;
}

// Glisser pour réordonner (poignée ≡ du mode Modifier)
let edDrag = null;
document.addEventListener('pointerdown', e => {
  const h = e.target.closest?.('.ed-handle');
  if (!h || view !== 'editor') return;
  e.preventDefault();
  const row = h.closest('.ed-row');
  const rows = [...document.querySelectorAll('.ed-list .ed-row')];
  edDrag = { row, rows, from: rows.indexOf(row), idx: rows.indexOf(row), y0: e.clientY, h: row.offsetHeight, id: e.pointerId };
  row.classList.add('is-dragging');
  try { h.setPointerCapture(e.pointerId); } catch {}
});
document.addEventListener('pointermove', e => {
  if (!edDrag || e.pointerId !== edDrag.id) return;
  e.preventDefault();
  const dy = e.clientY - edDrag.y0;
  const n  = edDrag.rows.length;
  const idx = Math.max(0, Math.min(n - 1, edDrag.from + Math.round(dy / edDrag.h)));
  if (idx !== edDrag.idx) { edDrag.idx = idx; haptic(); }
  edDrag.row.style.transform = `translateY(${dy}px)`;
  edDrag.rows.forEach((r, i) => {
    if (r === edDrag.row) return;
    let shift = 0;
    if (edDrag.from < idx && i > edDrag.from && i <= idx) shift = -edDrag.h;
    if (edDrag.from > idx && i < edDrag.from && i >= idx) shift = edDrag.h;
    r.style.transform = shift ? `translateY(${shift}px)` : '';
  });
});
function endEdDrag(e) {
  if (!edDrag || e.pointerId !== edDrag.id) return;
  const { from, idx } = edDrag;
  edDrag = null;
  const arr = prog().exercises[editorCat];
  if (arr && from !== idx) {
    const [moved] = arr.splice(from, 1);
    arr.splice(idx, 0, moved);
    save();
  }
  render();
}
document.addEventListener('pointerup', endEdDrag);
document.addEventListener('pointercancel', endEdDrag);
// iOS : sans ce preventDefault, le glisser de la poignée ferait défiler la liste
document.addEventListener('touchmove', e => { if (edDrag) e.preventDefault(); }, { passive: false });

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
      <header class="header header--session">
        <button class="icon-btn" data-action="back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <div class="header__center">
          <div class="header__title">${meta.icon} ${meta.label}</div>
          <div class="header__sub">${doneSets} / ${totalSets} séries${curVolTotal > 0 ? ` · ${fmtVolume(curVolTotal)}` : ''} · <span id="session-elapsed">${fmtDuration(Date.now() - activeSession.startedAt)}</span></div>
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
//  Réglages (organisation : lot 5 ; visuel : lot 2)
// ═══════════════════════════════════════════════════════════

function agoText(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'aujourd\'hui';
  if (days === 1) return 'hier';
  return `il y a ${days} jours`;
}

function renderSettings() {
  const tog = (on, label) => `<span class="setting-toggle ${on ? 'setting-toggle--on' : ''}" role="switch" aria-checked="${on}" aria-label="${label}"><span class="setting-toggle__thumb"></span></span>`;
  const last  = data.lastExport;
  const stale = !last || Date.now() - last > 14 * 86400000;
  const nSess = (data.history || []).length;
  return `
    <div class="view settings-view lot5">
      ${screenHeader('Réglages', { parent: 'programmes' })}
      <div class="scr">

        <div class="group-title">Séance</div>
        <div class="group">
          <button class="cell cell--nav setting-row" data-action="setting-rest">
            <span class="cell__body"><span class="cell__title">Repos par défaut</span></span>
            <span class="cell__value num">${fmtRest(data.defaultRest)}</span>
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell setting-row" data-action="setting-sound">
            <span class="cell__body"><span class="cell__title">Sons</span></span>
            ${tog(data.soundOn !== false, 'Sons')}
          </button>
          <button class="cell setting-row" data-action="setting-vibrate">
            <span class="cell__body"><span class="cell__title">Vibrations</span></span>
            ${tog(data.vibrateOn !== false, 'Vibrations')}
          </button>
        </div>

        <div class="group-title">Affichage</div>
        <div class="group">
          <div class="cell cell--ctl setting-row">
            <span class="cell__body"><span class="cell__title">Thème</span></span>
            <div class="segmented seg-sm" role="group" aria-label="Thème">
              ${[['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) =>
                `<button class="segmented__btn ${themePref() === v ? 'segmented__btn--active' : ''}" aria-pressed="${themePref() === v}" data-action="set-theme" data-val="${v}">${l}</button>`).join('')}
            </div>
          </div>
          <div class="cell cell--ctl setting-row">
            <span class="cell__body"><span class="cell__title">Unité</span></span>
            <div class="segmented seg-sm" role="group" aria-label="Unité de poids">
              ${['kg', 'lbs'].map(u => `<button class="segmented__btn ${data.unit === u ? 'segmented__btn--active' : ''}" aria-pressed="${data.unit === u}" data-action="setting-unit" data-val="${u}">${u}</button>`).join('')}
            </div>
          </div>
        </div>

        <div class="group-title">Données</div>
        <div class="group">
          <div class="cell setting-row">
            <span class="cell__body"><span class="cell__title ${stale ? 'txt-warn' : ''}" id="lastExportTxt">Dernière sauvegarde : ${last ? agoText(last) : 'jamais'}</span></span>
          </div>
          <button class="cell cell--action setting-row" data-action="export"><span>Exporter les données</span></button>
          <button class="cell cell--action setting-row" data-action="import"><span>Importer une sauvegarde</span></button>
          <button class="cell cell--destructive cell--left setting-row" data-action="wipe-data">Supprimer toutes les données</button>
        </div>
        <div class="group-foot">Exporte régulièrement : les données ne sont stockées que sur cet appareil.</div>

        <div class="group-title">À propos</div>
        <div class="group">
          <div class="cell setting-row">
            <span class="cell__body"><span class="cell__title">MDLF Training<span id="appVersion"></span> · ${plural(nSess, 'séance', 'séances')}</span></span>
          </div>
          <button class="cell cell--action setting-row" data-action="force-update"><span>Rechercher une mise à jour</span></button>
        </div>

      </div>
    </div>`;
}

// Version affichée dans À propos : lue dans le nom du cache du service worker (ppl-vNN)
function fillAppVersion() {
  const el = $('#appVersion');
  if (!el || !window.caches) return;
  caches.keys().then(keys => {
    const v = keys.map(k => (k.match(/v(\d+)$/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => b - a)[0];
    if (v && $('#appVersion')) $('#appVersion').textContent = ` · v${v}`;
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════
//  Progrès (lot 5) : index des exercices tiré de l'historique
// ═══════════════════════════════════════════════════════════

let statsExId   = null;
let ovMonth     = null; // { y, m } du calendrier de la vue d'ensemble

// Mesures d'un exercice dans une séance
function exPoint(h, e) {
  const sets = (e.sets || []).filter(s => (parseInt(s.reps) || 0) > 0);
  if (!sets.length) return null;
  const wts = sets.map(s => parseFloat(s.weight) || 0);
  const hasWeight = wts.some(w => w > 0);
  const totalReps = sets.reduce((a, s) => a + (parseInt(s.reps) || 0), 0);
  const volume    = hasWeight ? setsVolume(sets) : totalReps;
  const maxLoad   = hasWeight ? Math.max(...wts) : 0;
  const best1RM   = hasWeight ? Math.max(0, ...sets.map(s => calc1RM(s.weight, s.reps)).filter(v => v !== null)) : 0;
  const maxReps   = Math.max(...sets.map(s => parseInt(s.reps) || 0));
  return { date: h.date, hid: h.id, sets, hasWeight, totalReps, volume, maxLoad, best1RM, maxReps, best: bestSet(sets) };
}

// Tous les exercices de l'historique, tous programmes confondus, regroupés par exId
function exerciseIndex() {
  const map = new Map();
  const hist = (data.history || []).slice().sort((a, b) => a.date - b.date);
  hist.forEach(h => (h.exercises || []).forEach(e => {
    const key = exIdOf(e) || 'n:' + normName(e.name);
    const p = exPoint(h, e);
    if (!p) return;
    let it = map.get(key);
    if (!it) { it = { exId: key, name: e.name, points: [], cat: h.category, prog: h.programme || 'ppl' }; map.set(key, it); }
    it.name = e.name; it.cat = h.category; it.prog = h.programme || 'ppl';
    it.points.push(p);
  }));
  return map;
}

// Section d'un exercice : séance du programme actif, d'un autre programme, ou « Autres »
function exSection(it) {
  const match = (list) => (list || []).some(x => x.id === it.exId || (String(it.exId).startsWith('n:') && normName(x.name) === normName(it.name)));
  const pid = data.activeProgramme;
  for (const cat of sessionKeys(pid)) if (match(data.programmes[pid]?.exercises?.[cat])) return { key: pid + ':' + cat, cat, prog: pid };
  for (const [p, pd] of Object.entries(data.programmes)) {
    if (p === pid) continue;
    for (const cat of Object.keys(pd.exercises || {})) {
      if (match(pd.exercises[cat]) && (p !== 'custom' || data.customSessions?.[cat])) return { key: p + ':' + cat, cat, prog: p };
    }
  }
  return { key: 'other', cat: null, prog: null };
}

function isBodyweight(it) { return it.points.every(p => !p.hasWeight); }
function mainMetric(it, p) { return isBodyweight(it) ? p.maxReps : p.maxLoad; }

// Tendance : moyenne des 3 dernières séances contre les 3 premières
function trendPct(vals) {
  const n = vals.length;
  if (n < 2) return null;
  const k = Math.min(3, Math.floor(n / 2));
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const a = avg(vals.slice(0, k)), b = avg(vals.slice(-k));
  if (!(a > 0)) return null;
  return Math.round((b - a) / a * 100);
}
function pctTxt(p) { return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %`; }

function sparkline(vals) {
  const W = 60, H = 24;
  if (vals.length < 2) return `<svg class="spark" width="${W}" height="${H}" aria-hidden="true"></svg>`;
  const min = Math.min(...vals), max = Math.max(...vals), r = (max - min) || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * (W - 4) + 2).toFixed(1)},${(H - 3 - (v - min) / r * (H - 6)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(',');
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.2" fill="currentColor"/></svg>`;
}

function weekStart(ts = Date.now()) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

function renderStats() {
  const idx  = exerciseIndex();
  const now  = new Date();
  const monthCount = (data.history || []).filter(h => { const d = new Date(h.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
  const streak = computeStreak();
  const ws = weekStart();
  let records = 0;
  idx.forEach(it => {
    if (isBodyweight(it)) return;
    const before = it.points.filter(p => p.date < ws).map(p => p.maxLoad);
    const week   = it.points.filter(p => p.date >= ws).map(p => p.maxLoad);
    if (before.length && week.length && Math.max(...week) > Math.max(...before)) records++;
  });

  // Sections : programme actif d'abord, puis autres programmes, puis Autres
  const sections = new Map();
  sessionKeys().forEach(c => sections.set(data.activeProgramme + ':' + c, { cat: c, prog: data.activeProgramme, items: [] }));
  idx.forEach(it => {
    const s = exSection(it);
    if (!sections.has(s.key)) sections.set(s.key, { cat: s.cat, prog: s.prog, items: [] });
    sections.get(s.key).items.push(it);
  });
  if (sections.has('other')) { const o = sections.get('other'); sections.delete('other'); sections.set('other', o); }
  // Ordre du programme à l'intérieur de chaque section
  sections.forEach(sec => {
    if (!sec.cat) return;
    const order = (data.programmes[sec.prog]?.exercises?.[sec.cat] || []).map(x => x.id);
    sec.items.sort((a, b) => (order.indexOf(a.exId) + 1 || 999) - (order.indexOf(b.exId) + 1 || 999));
  });

  const row = it => {
    const bw   = isBodyweight(it);
    const vals = it.points.map(p => mainMetric(it, p));
    const last = it.points[it.points.length - 1];
    const tp   = trendPct(vals);
    const cls  = tp > 0 ? 'txt-up' : tp < 0 ? 'txt-down' : 'txt-flat';
    return `
      <button class="cell cell--nav prow" data-action="open-stats-ex" data-ex="${esc(it.exId)}">
        <span class="cell__body">
          <span class="cell__title prow__name">${esc(it.name)}</span>
          <span class="cell__sub num">${bw ? `${last.maxReps} reps` : setTxt(last.best)}</span>
        </span>
        <span class="prow__spark ${cls}">${sparkline(vals.slice(-12))}</span>
        <span class="prow__trend num ${cls}">${tp === null ? '' : pctTxt(tp)}</span>
        ${icon('chevron.right', 16)}
      </button>`;
  };

  let list = '';
  sections.forEach((sec, key) => {
    if (!sec.items.length) return;
    const title = key === 'other' ? 'Autres'
      : sec.prog === data.activeProgramme ? sessionMeta(sec.cat, sec.prog).label
      : `${sessionMeta(sec.cat, sec.prog).label} · ${progMeta(sec.prog).name}`;
    list += `<div class="group-title">${title}</div><div class="group">${sec.items.map(row).join('')}</div>`;
  });
  const empty = !idx.size;

  return `
    <div class="view stats lot5">
      ${screenHeader('Progrès')}
      <div class="scr">
        <div class="tiles">
          <div class="tile"><span class="tile__val num">${monthCount}</span><span class="tile__lbl">${monthCount > 1 ? 'séances' : 'séance'} ce mois-ci</span></div>
          <div class="tile"><span class="tile__val num">${streak}</span><span class="tile__lbl">${streak > 1 ? 'semaines' : 'semaine'} d'affilée</span></div>
          <div class="tile"><span class="tile__val num">${records}</span><span class="tile__lbl">${records > 1 ? 'records' : 'record'} cette semaine</span></div>
        </div>
        <div class="group">
          <button class="cell cell--nav" data-action="go-stats-overview">
            ${icon('chart', 22)}
            <span class="cell__body"><span class="cell__title">Vue d'ensemble</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>
        ${empty ? `<div class="empty-note">Termine des séances pour voir ta progression ici.</div>` : list}
      </div>
    </div>`;
}

// ── Progrès › Exercice ──────────────────────────────────────

let chartState = null; // { vals, dates, points, mode, unit, color, xLabels, sel }

function cvtW(kg) { return data.unit === 'lbs' ? Math.round(kg * KG_TO_LBS * 10) / 10 : kg; }

function metricOf(p, bw) {
  if (statsMode === 'charge') return bw ? p.maxReps : cvtW(p.maxLoad);
  if (statsMode === '1rm')    return bw ? p.maxReps : cvtW(p.best1RM || p.maxLoad);
  return bw ? p.totalReps : cvtW(p.volume);
}
function fmtMetricVal(v, bw) {
  if (bw) return `${Math.round(v)} reps`;
  if (statsMode === 'volume') return fmtVolume(data.unit === 'lbs' ? v / KG_TO_LBS : v);
  return `${statsMode === '1rm' ? '~' : ''}${fmtNum(Math.round(v * 10) / 10)} ${unitLbl()}`;
}

function renderStatsExercise() {
  const it = exerciseIndex().get(statsExId);
  if (!it) {
    return `<div class="view stats-ex lot5">${screenHeader('Exercice', { parent: 'stats' })}
      <div class="scr"><div class="empty-note">Aucune donnée pour cet exercice.</div></div></div>`;
  }
  const bw     = isBodyweight(it);
  const pts    = it.points;
  const sec    = exSection(it);
  const color  = sec.cat ? sessionMeta(sec.cat, sec.prog).color : sessionMeta(it.cat, it.prog).color;
  const vals   = pts.map(p => metricOf(p, bw));
  chartState   = { vals, dates: pts.map(p => p.date), points: pts, bw, mode: statsMode, color, xLabels: [], sel: null };

  // Record charge (poids puis reps) et 1RM estimé : record et dernière séance
  const prBest = bestSet(pts.flatMap(p => p.sets));
  const rec1RM = Math.max(0, ...pts.map(p => p.best1RM));
  const last   = pts[pts.length - 1];
  const progEx = Object.values(data.programmes).flatMap(p => Object.values(p.exercises || {}).flat()).find(x => x.id === it.exId);
  const target = progEx?.target;
  const tp     = trendPct(vals);

  const targetBar = (statsMode === 'charge' && target && !bw) ? (() => {
    const pct = Math.min(100, Math.round(last.maxLoad / target * 100));
    return `
      <div class="group-title">Objectif</div>
      <div class="group group--pad">
        <div class="target-row"><span>${fmtNum(cvtW(target))} ${unitLbl()}</span><span class="${pct >= 100 ? 'txt-up' : ''}">${pct >= 100 ? 'Atteint' : pct + ' %'}</span></div>
        <div class="tbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="tbar__fill" style="width:${pct}%"></div></div>
      </div>`;
  })() : '';

  const sessions = pts.slice().reverse().map(p => `
      <button class="cell cell--nav" data-action="open-history" data-id="${esc(p.hid)}">
        <span class="cell__body"><span class="cell__title cell__title--reg">${fmtDate(p.date)}</span></span>
        <span class="cell__value num">${bw ? `${p.sets.map(s => parseInt(s.reps)).join(' · ')} reps` : setTxt(p.best)}</span>
        ${icon('chevron.right', 16)}
      </button>`).join('');

  const modes = [['volume', 'Volume'], ['charge', 'Charge max'], ['1rm', '1RM est.']];
  return `
    <div class="view stats-ex lot5">
      ${screenHeader('', { parent: 'stats' })}
      <div class="scr">
        <h1 class="scr-title">${esc(it.name)}</h1>
        <div class="segmented seg-full" role="group" aria-label="Mesure affichée">
          ${modes.map(([m, l]) => `<button class="segmented__btn ${statsMode === m ? 'segmented__btn--active' : ''}" aria-pressed="${statsMode === m}" data-action="stats-mode" data-mode="${m}">${l}</button>`).join('')}
        </div>
        <div class="chart-head">
          <span class="chart-head__val num">${fmtMetricVal(vals[vals.length - 1], bw)}</span>
          ${tp === null ? '' : `<span class="chart-head__trend num ${tp > 0 ? 'txt-up' : tp < 0 ? 'txt-down' : 'txt-flat'}">${pctTxt(tp)}</span>`}
          ${statsMode === '1rm' ? `<button class="info-btn" data-action="info-1rm" aria-label="Comment est calculé le 1RM estimé ?">i</button>` : ''}
        </div>
        <div class="chart" id="exChart">
          <canvas class="stats-canvas" role="img" aria-label=""></canvas>
          <div class="chart-bubble num" hidden></div>
        </div>
        <div class="group">
          <div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">Record</span></span>
            <span class="cell__value num">${prBest ? setTxt(prBest) : '—'}</span></div>
          ${!bw && rec1RM ? `
          <div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">Record 1RM est.</span></span>
            <span class="cell__value num">~${fmtNum(cvtW(rec1RM))} ${unitLbl()}</span></div>
          <div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">1RM est. dernière séance</span></span>
            <span class="cell__value num">${last.best1RM ? `~${fmtNum(cvtW(last.best1RM))} ${unitLbl()}` : '—'}</span></div>` : ''}
          <div class="cell"><span class="cell__body"><span class="cell__title cell__title--reg">Séances</span></span>
            <span class="cell__value num">${pts.length}</span></div>
        </div>
        ${targetBar}
        <div class="group-title">Séances</div>
        <div class="group">${sessions}</div>
      </div>
    </div>`;
}

// Couleur CSS résolue (accepte un hex comme une var(--x))
function resolveColor(el, c) {
  el.style.color = c;
  const v = getComputedStyle(el).color;
  el.style.color = '';
  return v;
}

function axisFmt(v) {
  if (chartState.bw) return String(Math.round(v));
  if (chartState.mode === 'volume') return v >= 1000 ? fmtNum(Math.round(v / 100) / 10) + ' t' : fmtNum(Math.round(v));
  return fmtNum(Math.round(v * 10) / 10);
}

function drawCharts() {
  const box = $('#exChart');
  if (!box || !chartState) return;
  const canvas = box.querySelector('canvas');
  const st = chartState;
  const { vals, dates } = st;
  const n = vals.length;
  const W = box.clientWidth, H = 200;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const color = resolveColor(canvas, st.color);
  const cs    = getComputedStyle(box);
  const sepC  = cs.getPropertyValue('--sep').trim() || 'rgba(128,128,128,.4)';
  const lblC  = cs.getPropertyValue('--label2').trim() || '#8e8e93';
  const bgC   = cs.getPropertyValue('--cell').trim() || '#1c1c1e';
  const font  = '-apple-system, system-ui, sans-serif';

  // Axe Y : depuis 0 pour le volume, tronqué (mais gradué) pour la charge et le 1RM
  const vMax = Math.max(...vals), vMin = Math.min(...vals);
  let lo = (st.mode === 'volume' || st.bw) ? 0 : vMin - (vMax - vMin) * 0.15 - (vMax === vMin ? vMax * 0.1 : 0);
  if (lo < 0) lo = 0;
  let hi = vMax + (vMax - lo) * 0.08 || 1;
  const ticks = [lo, (lo + hi) / 2, hi];
  ctx.font = `11px ${font}`;
  const tickW = Math.max(...ticks.map(t => ctx.measureText(axisFmt(t)).width));
  const pL = 4, pR = tickW + 10, pT = 44, pB = 22; // bande du haut réservée à la bulle
  const cW = W - pL - pR, cH = H - pT - pB;
  const xp = i => pL + (n === 1 ? cW / 2 : i / (n - 1) * cW);
  const yp = v => pT + cH - (v - lo) / ((hi - lo) || 1) * cH;
  st.geom = { xp, yp, pL, pR, cW, W, H };

  // Grille et graduations à droite
  ctx.lineWidth = 0.5; ctx.strokeStyle = sepC; ctx.fillStyle = lblC;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ticks.forEach(t => {
    const y = Math.round(yp(t)) + 0.25;
    ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + cW, y); ctx.stroke();
    ctx.fillText(axisFmt(t), pL + cW + 6, y);
  });

  // Courbe : segments droits
  ctx.beginPath();
  vals.forEach((v, i) => i ? ctx.lineTo(xp(i), yp(v)) : ctx.moveTo(xp(i), yp(v)));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.stroke();

  // Points : dernier et maximum seulement
  const iMax = vals.lastIndexOf(vMax);
  [...new Set([iMax, n - 1])].forEach(i => {
    ctx.beginPath(); ctx.arc(xp(i), yp(vals[i]), 4, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = bgC; ctx.stroke();
  });

  // Sélection au doigt : ligne verticale
  if (st.sel !== null && st.sel < n) {
    const x = Math.round(xp(st.sel)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, pT); ctx.lineTo(x, pT + cH);
    ctx.strokeStyle = lblC; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(xp(st.sel), yp(vals[st.sel]), 5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = bgC; ctx.stroke();
  }

  // Étiquettes X sans chevauchement (espacées d'au moins leur largeur + 6)
  ctx.fillStyle = lblC; ctx.textBaseline = 'alphabetic';
  const lbl = i => new Date(dates[i]).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '');
  const rect = i => {
    const w = ctx.measureText(lbl(i)).width;
    const x = Math.max(pL, Math.min(pL + cW - w, xp(i) - w / 2));
    return { i, x, w };
  };
  const placed = [];
  const lastR = rect(n - 1);
  const free = r => placed.every(p => r.x >= p.x + p.w + 6 || r.x + r.w + 6 <= p.x);
  placed.push(lastR);
  for (let i = 0; i < n - 1; i++) { const r = rect(i); if (free(r)) placed.push(r); }
  ctx.textAlign = 'left';
  placed.forEach(r => ctx.fillText(lbl(r.i), r.x, H - 6));
  st.xLabels = placed.map(r => ({ x: r.x, w: r.w }));

  // Description pour VoiceOver
  const mName = st.mode === 'volume' ? 'Volume' : st.mode === 'charge' ? 'Charge max' : '1RM estimé';
  const tp = trendPct(vals);
  const d = i => new Date(dates[i]).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  canvas.setAttribute('aria-label', n > 1
    ? `${mName} : de ${fmtMetricVal(vals[0], st.bw)} le ${d(0)} à ${fmtMetricVal(vals[n - 1], st.bw)} le ${d(n - 1)}${tp === null ? '' : ', ' + pctTxt(tp)}`
    : `${mName} : ${fmtMetricVal(vals[0], st.bw)} le ${d(0)}`);
}

function chartSelect(clientX) {
  const st = chartState, box = $('#exChart');
  if (!st || !box || !st.geom) return;
  const r = box.getBoundingClientRect();
  const x = clientX - r.left;
  let best = 0, bd = Infinity;
  st.vals.forEach((_, i) => { const dd = Math.abs(st.geom.xp(i) - x); if (dd < bd) { bd = dd; best = i; } });
  if (best !== st.sel) { st.sel = best; haptic(); }
  drawCharts();
  const p = st.points[best];
  const b = box.querySelector('.chart-bubble');
  const date = new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const set  = st.bw ? `${p.maxReps} reps` : `${wFr(p.best.weight)} ${unitLbl()} × ${p.best.r}`;
  b.textContent = `${date} · ${set} · ${st.bw ? p.totalReps + ' reps' : fmtVolume(p.volume)}`;
  b.dataset.i = best;
  b.hidden = false;
  const bx = st.geom.xp(best);
  const bw = b.offsetWidth;
  b.style.left = Math.max(0, Math.min(r.width - bw, bx - bw / 2)) + 'px';
}
function chartRelease() {
  const st = chartState;
  if (!st) return;
  clearTimeout(st.hideT);
  st.hideT = setTimeout(() => {
    if (!chartState || chartState !== st) return;
    st.sel = null;
    const b = $('#exChart .chart-bubble');
    if (b) b.hidden = true;
    drawCharts();
  }, 2500);
}
let chartDown = false;
document.addEventListener('pointerdown', e => {
  if (!e.target.closest?.('#exChart')) return;
  chartDown = true; clearTimeout(chartState?.hideT); chartSelect(e.clientX);
});
document.addEventListener('pointermove', e => {
  if (!e.target.closest?.('#exChart') && !chartDown) return;
  if (e.pointerType !== 'mouse' && !chartDown) return;
  if (!$('#exChart')) return;
  chartSelect(e.clientX);
});
document.addEventListener('pointerup', () => { if (chartDown) { chartDown = false; chartRelease(); } });
document.addEventListener('pointercancel', () => { if (chartDown) { chartDown = false; chartRelease(); } });

// Nouveau dessin au redimensionnement, à la rotation et au changement de thème
let chartRaf = null;
function redrawChartSoon() {
  clearTimeout(chartRaf);
  chartRaf = setTimeout(() => { if ($('#exChart')) drawCharts(); }, 120);
}
window.addEventListener('resize', redrawChartSoon);
window.addEventListener('orientationchange', redrawChartSoon);
new MutationObserver(redrawChartSoon).observe(document.body, { attributes: true, attributeFilter: ['class'] });

// ── Progrès › Vue d'ensemble ────────────────────────────────

function renderStatsOverview() {
  const now  = new Date();
  if (!ovMonth) ovMonth = { y: now.getFullYear(), m: now.getMonth() };
  const { y, m } = ovMonth;
  const hist = data.history || [];

  // Calendrier du mois : lundi en premier
  const first = new Date(y, m, 1);
  const days  = new Date(y, m + 1, 0).getDate();
  const lead  = (first.getDay() + 6) % 7;
  const byDay = {};
  hist.forEach(h => {
    const d = new Date(h.date);
    if (d.getFullYear() === y && d.getMonth() === m) (byDay[d.getDate()] ||= []).push(h);
  });
  const today = (now.getFullYear() === y && now.getMonth() === m) ? now.getDate() : 0;
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cal__d cal__d--empty"></span>';
  for (let d = 1; d <= days; d++) {
    const hs = byDay[d] || [];
    const lbl = hs.length ? `, ${hs.map(h => sessionMeta(h.category, h.programme || 'ppl').label).join(', ')}` : '';
    cells += `<span class="cal__d ${d === today ? 'cal__d--today' : ''}" aria-label="${d}${lbl}"><span class="num">${d}</span>
      <span class="cal__dots">${hs.slice(0, 3).map(h => `<i style="background:${historyColor(h)}"></i>`).join('')}</span></span>`;
  }
  const monthName = first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const monthCount = Object.values(byDay).reduce((a, l) => a + l.length, 0);
  const isCur = y === now.getFullYear() && m === now.getMonth();

  // Séances par semaine sur 12 semaines (objectif : 3)
  const ws = weekStart();
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = ws - (11 - i) * 7 * 86400000;
    return { start, n: hist.filter(h => h.date >= start && h.date < start + 7 * 86400000).length };
  });
  const top = Math.max(4, ...weeks.map(w => w.n));
  const bars = weeks.map(w => `
      <span class="wk" aria-label="Semaine du ${new Date(w.start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} : ${plural(w.n, 'séance', 'séances')}">
        <span class="wk__bar ${w.n >= 3 ? 'wk__bar--ok' : ''}" style="height:${w.n / top * 100}%"></span>
      </span>`).join('');

  // Tuiles
  const vol  = hist.reduce((a, h) => a + sessionVolume(h.exercises || []), 0);
  const durs = hist.filter(h => h.duration > 0).map(h => h.duration);
  const avgD = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0;
  const streak = computeStreak();

  return `
    <div class="view stats-overview lot5">
      ${screenHeader('Vue d\'ensemble', { parent: 'stats' })}
      <div class="scr">
        <div class="tiles">
          <div class="tile"><span class="tile__val num">${fmtVolume(vol)}</span><span class="tile__lbl">volume total</span></div>
          <div class="tile"><span class="tile__val num">${avgD ? fmtDuration(avgD) : '—'}</span><span class="tile__lbl">durée moyenne</span></div>
          <div class="tile"><span class="tile__val num">${streak}</span><span class="tile__lbl">${streak > 1 ? 'semaines' : 'semaine'} d'affilée</span></div>
        </div>
        <div class="group group--pad cal" id="ovCal">
          <div class="cal__head">
            <button class="cal__nav" data-action="ov-month" data-d="-1" aria-label="Mois précédent">${icon('chevron.left', 20)}</button>
            <span class="cal__title">${monthName.charAt(0).toUpperCase() + monthName.slice(1)}<span class="cal__count num">${plural(monthCount, 'séance', 'séances')}</span></span>
            <button class="cal__nav" data-action="ov-month" data-d="1" ${isCur ? 'disabled' : ''} aria-label="Mois suivant">${icon('chevron.right', 20)}</button>
          </div>
          <div class="cal__grid">
            ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<span class="cal__wd" aria-hidden="true">${d}</span>`).join('')}
            ${cells}
          </div>
        </div>
        <div class="group-title">Séances par semaine</div>
        <div class="group group--pad">
          <div class="wks" role="img" aria-label="Séances par semaine sur 12 semaines, objectif 3">
            <span class="wks__goal" style="bottom:${3 / top * 100}%"><span>3</span></span>
            ${bars}
          </div>
          <div class="wks__axis"><span>il y a 12 sem.</span><span>cette semaine</span></div>
        </div>
      </div>
    </div>`;
}

// Balayage horizontal du calendrier : mois précédent / suivant
let calSwipe = null;
document.addEventListener('pointerdown', e => {
  if (!e.target.closest?.('#ovCal .cal__grid')) return;
  calSwipe = { x: e.clientX, y: e.clientY };
});
document.addEventListener('pointerup', e => {
  if (!calSwipe) return;
  const dx = e.clientX - calSwipe.x, dy = e.clientY - calSwipe.y;
  calSwipe = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) changeOvMonth(dx < 0 ? 1 : -1);
});
function changeOvMonth(d) {
  const now = new Date();
  let { y, m } = ovMonth;
  m += d;
  if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
  if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())) return;
  ovMonth = { y, m };
  render();
}

// ═══════════════════════════════════════════════════════════
//  Historique (lot 5)
// ═══════════════════════════════════════════════════════════

let historyId  = null;
let histFilter = 'all';
let histQuery  = '';
let histMonths = 3;

function historySorted() {
  return (data.history || []).slice().sort((a, b) => b.date - a.date);
}

function historyMatches(h, q) {
  if (histFilter !== 'all' && !(h.category === histFilter && (h.programme || 'ppl') === data.activeProgramme)) return false;
  if (!q) return true;
  if (normName(h.notes).includes(q)) return true;
  return (h.exercises || []).some(e => normName(e.name).includes(q));
}

function historyCell(h) {
  const progId = h.programme || 'ppl';
  const meta   = sessionMeta(h.category, progId);
  const vol    = sessionVolume(h.exercises || []);
  // Séance d'un autre programme : la mention remplace le nombre d'exercices (cellule sur 2 lignes)
  const other  = progId !== data.activeProgramme;
  const parts  = [other ? `Programme ${progMeta(progId).name}` : plural((h.exercises || []).length, 'exercice', 'exercices')];
  if (vol > 0) parts.push(fmtVolume(vol));
  if (h.duration) parts.push(fmtDuration(h.duration));
  return `
    <div class="hrow" data-id="${esc(h.id)}">
      <button class="hrow__del" data-action="swipe-delete-session" data-id="${esc(h.id)}" tabindex="-1">Supprimer</button>
      <button class="hcell" data-action="open-history" data-id="${esc(h.id)}">
        <span class="hcell__dot" style="background:${meta.color}"></span>
        <span class="hcell__body">
          <span class="hcell__top"><span class="hcell__title">${meta.label}</span><span class="hcell__date">${fmtDate(h.date)}</span></span>
          <span class="hcell__sub num">${parts.join(' · ')}</span>
        </span>
        ${icon('chevron.right', 16)}
      </button>
    </div>`;
}

function historyListHTML() {
  const q   = normName(histQuery);
  const all = historySorted().filter(h => historyMatches(h, q));
  if (!all.length) {
    return (data.history || []).length
      ? `<div class="empty-note">Aucune séance ne correspond.</div>`
      : `<div class="empty-note">Aucune séance enregistrée.<br>Termine ta première séance pour la voir ici.</div>`;
  }
  let out = '', months = 0, curKey = null, buf = '', i = 0;
  const flush = () => { if (curKey) out += `<section class="hmonth" data-month="${curKey}"><h2 class="hmonth__title">${buf.title}</h2><div class="group">${buf.rows}</div></section>`; };
  for (; i < all.length; i++) {
    const h = all[i], d = new Date(h.date);
    const key = d.getFullYear() + '-' + d.getMonth();
    if (key !== curKey) {
      flush();
      months++;
      if (months > histMonths) break;
      curKey = key;
      const t = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      buf = { title: t.charAt(0).toUpperCase() + t.slice(1), rows: '' };
    }
    buf.rows += historyCell(h);
  }
  if (i >= all.length) flush();
  if (i < all.length) out += `<button class="btn-more" data-action="hist-more">Afficher plus</button>`;
  return out;
}

function renderHistory() {
  const keys = sessionKeys();
  if (histFilter !== 'all' && !keys.includes(histFilter)) histFilter = 'all';
  return `
    <div class="view history lot5">
      ${screenHeader('Historique', { right: `<button class="icon-btn nav-icon" data-action="go-add-session" aria-label="Ajouter une séance passée">${icon('plus', 24)}</button>` })}
      <div class="scr" id="histScroll">
        <div class="hist-tools">
          <input type="search" id="histSearch" class="search" placeholder="Rechercher un exercice ou une note" value="${esc(histQuery)}"
                 autocomplete="off" enterkeyhint="search" aria-label="Rechercher dans l'historique">
          <div class="segmented seg-full seg-scroll" role="group" aria-label="Filtrer par séance">
            ${[['all', 'Toutes'], ...keys.map(k => [k, sessionMeta(k).label])].map(([k, l]) =>
              `<button class="segmented__btn ${histFilter === k ? 'segmented__btn--active' : ''}" aria-pressed="${histFilter === k}" data-action="hist-filter" data-cat="${esc(k)}">${l}</button>`).join('')}
          </div>
        </div>
        <div id="histList">${historyListHTML()}</div>
      </div>
    </div>`;
}

function refreshHistoryList() {
  const el = $('#histList');
  if (el) el.innerHTML = historyListHTML();
}

// Séries d'un exercice : poids mis en facteur s'il ne change pas
function setsLine(sets) {
  const ok = (sets || []).filter(s => String(s.reps ?? '') !== '');
  if (!ok.length) return '—';
  const ws = ok.map(s => parseFloat(s.weight) || 0);
  if (ws.every(w => w === 0)) return `${ok.map(s => esc(s.reps)).join(' · ')} reps`;
  if (ws.every(w => w === ws[0])) return `${wFr(ok[0].weight)} ${unitLbl()} · ${ok.map(s => esc(s.reps)).join(' · ')}`;
  return ok.map(s => `${parseFloat(s.weight) > 0 ? wFr(s.weight) + ' × ' : ''}${esc(s.reps)}`).join(' · ');
}

function renderHistoryDetail() {
  const h = (data.history || []).find(x => x.id === historyId);
  if (!h) {
    return `<div class="view history-detail lot5">${screenHeader('Séance', { parent: 'history' })}
      <div class="scr"><div class="empty-note">Cette séance n'existe plus.</div></div></div>`;
  }
  const progId = h.programme || 'ppl';
  const meta   = sessionMeta(h.category, progId);
  const d      = new Date(h.date);
  let when = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  when = when.charAt(0).toUpperCase() + when.slice(1);
  // L'heure n'a de sens que pour une séance chronométrée (une séance passée n'a pas d'heure)
  if (h.duration) when += ` · ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  const vol  = sessionVolume(h.exercises || []);
  const nSets = (h.exercises || []).reduce((a, e) => a + (e.sets || []).length, 0);
  return `
    <div class="view history-detail lot5">
      ${screenHeader('', { parent: 'history', right: `<button class="nav-txt" data-action="edit-session" data-id="${esc(h.id)}">Modifier</button>` })}
      <div class="scr">
        <h1 class="scr-title"><span class="hcell__dot hcell__dot--lg" style="background:${meta.color}"></span>${meta.label}</h1>
        <p class="scr-sub">${when}${progId !== data.activeProgramme ? ` · Programme ${progMeta(progId).name}` : ''}</p>
        <div class="tiles">
          <div class="tile"><span class="tile__val num">${h.duration ? fmtDuration(h.duration) : '—'}</span><span class="tile__lbl">durée</span></div>
          <div class="tile"><span class="tile__val num">${vol > 0 ? fmtVolume(vol) : '—'}</span><span class="tile__lbl">volume</span></div>
          <div class="tile"><span class="tile__val num">${nSets}</span><span class="tile__lbl">${nSets > 1 ? 'séries' : 'série'}</span></div>
        </div>
        <div class="group-title">Exercices</div>
        <div class="group">
          ${(h.exercises || []).map(e => `
            <div class="cell hex">
              <span class="cell__body">
                <span class="hex__name">${esc(e.name)}</span>
                <span class="hex__sets num">${setsLine(e.sets)}</span>
              </span>
            </div>`).join('')}
        </div>
        ${h.notes ? `<div class="group-title">Notes</div><div class="group group--pad"><p class="hnotes">${esc(h.notes)}</p></div>` : ''}
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="delete-session" data-id="${esc(h.id)}">Supprimer la séance</button>
        </div>
      </div>
    </div>`;
}

// Supprime une séance de la liste sans re-rendu complet, avec « Annuler » pendant 5 s
function deleteSessionWithUndo(id) {
  const list = data.history || [];
  const idx  = list.findIndex(h => h.id === id);
  if (idx < 0) return;
  const [removed] = list.splice(idx, 1);
  syncTimersFromHistory();
  recomputePRFromHistory();
  save();
  const row = document.querySelector(`.hrow[data-id="${CSS.escape(id)}"]`);
  if (row) {
    const sec = row.closest('.hmonth');
    row.remove();
    if (sec && !sec.querySelector('.hrow')) sec.remove();
  }
  showToast('Séance supprimée', {
    action: 'Annuler', duration: 5000,
    onAction: () => {
      data.history.splice(Math.min(idx, data.history.length), 0, removed);
      syncTimersFromHistory();
      recomputePRFromHistory();
      save();
      if (view === 'history') refreshHistoryList();
    },
  });
}

// Balayage vers la gauche sur une cellule de l'historique : révèle « Supprimer »
let hSwipe = null;
let suppressClick = false;
const SWIPE_W = 88;
function closeOpenRows(except) {
  document.querySelectorAll('.hrow.is-open').forEach(r => { if (r !== except) { r.classList.remove('is-open'); r.querySelector('.hcell').style.transform = ''; } });
}
document.addEventListener('pointerdown', e => {
  const cell = e.target.closest?.('.hcell');
  if (!cell || view !== 'history') { if (!e.target.closest?.('.hrow__del')) closeOpenRows(); return; }
  const row = cell.parentElement;
  closeOpenRows(row);
  hSwipe = { row, cell, x: e.clientX, y: e.clientY, base: row.classList.contains('is-open') ? -SWIPE_W : 0, axis: null, dx: 0, id: e.pointerId };
});
document.addEventListener('pointermove', e => {
  if (!hSwipe || e.pointerId !== hSwipe.id) return;
  const dx = e.clientX - hSwipe.x, dy = e.clientY - hSwipe.y;
  if (!hSwipe.axis) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    hSwipe.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (hSwipe.axis === 'x') { hSwipe.cell.classList.add('is-swiping'); hSwipe.row.classList.add('is-swipe'); try { hSwipe.cell.setPointerCapture(e.pointerId); } catch {} }
  }
  if (hSwipe.axis !== 'x') return;
  hSwipe.dx = dx;
  const t = Math.max(-SWIPE_W * 1.3, Math.min(0, hSwipe.base + dx));
  hSwipe.cell.style.transform = `translateX(${t}px)`;
});
function endHSwipe(e) {
  if (!hSwipe || e.pointerId !== hSwipe.id) return;
  const s = hSwipe; hSwipe = null;
  s.cell.classList.remove('is-swiping');
  s.row.classList.remove('is-swipe');
  if (s.axis !== 'x') return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 50);
  const open = s.base + s.dx < -SWIPE_W / 2;
  s.row.classList.toggle('is-open', open);
  s.cell.style.transform = open ? `translateX(${-SWIPE_W}px)` : '';
}
document.addEventListener('pointerup', endHSwipe);
document.addEventListener('pointercancel', endHSwipe);
// Le clic qui suit un balayage n'ouvre pas la séance ; une cellule ouverte se referme au tap
document.addEventListener('click', e => {
  const cell = e.target.closest?.('.hcell');
  if (!cell) return;
  if (suppressClick || cell.parentElement.classList.contains('is-open')) {
    e.stopImmediatePropagation(); e.preventDefault();
    if (!suppressClick) { cell.parentElement.classList.remove('is-open'); cell.style.transform = ''; }
  }
}, true);

// Recherche dans l'historique : seule la liste est redessinée (le champ garde le focus)
document.addEventListener('input', e => {
  if (e.target.id === 'histSearch') { histQuery = e.target.value; histMonths = 3; refreshHistoryList(); }
  if (e.target.id === 'exName' && exDraft) exDraft.name = e.target.value;
});

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
      if (el.dataset.parent) { view = el.dataset.parent; exDraft = null; render(); break; } // ROUTE-LOT3
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
    case 'open-stats-ex': {
      statsExId = el.dataset.ex; view = 'stats-ex'; render(); break; // ROUTE-LOT3
    }
    case 'go-stats-overview': {
      ovMonth = null; view = 'stats-overview'; render(); break; // ROUTE-LOT3
    }
    case 'ov-month': {
      changeOvMonth(parseInt(el.dataset.d)); break;
    }
    case 'info-1rm': {
      await dialog({ title: '1RM estimé', message: 'Charge maximale estimée pour une seule répétition, calculée avec la formule d\'Epley : poids × (1 + reps / 30). Elle n\'est fiable que jusqu\'à 12 reps : au-delà, la courbe reprend la charge max de la séance.',
        actions: [{ label: 'OK', value: true, style: 'preferred' }] });
      break;
    }
    case 'open-history': {
      historyId = el.dataset.id; view = 'history-detail'; render(); break; // ROUTE-LOT3
    }
    case 'hist-filter': {
      histFilter = el.dataset.cat; histMonths = 3;
      document.querySelectorAll('[data-action="hist-filter"]').forEach(b => {
        const on = b.dataset.cat === histFilter;
        b.classList.toggle('segmented__btn--active', on); b.setAttribute('aria-pressed', on);
      });
      refreshHistoryList(); break;
    }
    case 'hist-more': {
      histMonths += 3; refreshHistoryList(); break;
    }
    case 'swipe-delete-session': {
      deleteSessionWithUndo(el.dataset.id); break;
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
      if (view === 'history-detail') view = 'history';
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
    case 'wipe-data': {
      if (!(await confirmSheet('Supprimer toutes les données ?', 'Séances, programmes et réglages seront effacés de cet appareil.', 'Tout supprimer'))) break;
      const n = (data.history || []).length;
      if (!(await dialog({ title: 'Es-tu sûr ?', message: `${n} séance${n > 1 ? 's' : ''} seront perdue${n > 1 ? 's' : ''} définitivement. Pense à exporter avant.`,
        actions: [{ label: 'Annuler', value: false, style: 'cancel' }, { label: 'Supprimer', value: true, style: 'destructive' }] }))) break;
      try { localStorage.setItem(BACKUP_KEY, JSON.stringify(data)); } catch {}
      if (activeSession) endSession();
      data = makeDefaultData();
      editorCat = statsCat = addCat = firstSession();
      save(); render(); showToast('Données supprimées'); break;
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

    // ── Onglet Programme ───────────────────────────────────
    case 'go-prog-picker': {
      view = 'prog-picker'; render(); break; // ROUTE-LOT3
    }
    case 'open-prog-session': {
      editorCat = el.dataset.cat; editorEditing = false; view = 'editor'; render(); break; // ROUTE-LOT3
    }
    case 'select-prog': {
      const id = el.dataset.id;
      if (id === data.activeProgramme) { view = 'programmes'; render(); break; }
      if (!(await confirmSheet(`Passer à ${PROGRAMMES[id].name} ?`, 'Ton historique reste disponible.', 'Changer de programme', false))) break;
      data.activeProgramme = id;
      // Données du programme créées à la première utilisation
      if (!data.programmes[id]) {
        data.programmes[id] = makeProgData(id);
        if (id === 'custom') {
          Object.keys(data.customSessions || {}).forEach(cat => {
            data.programmes.custom.timers[cat]    = null;
            data.programmes.custom.exercises[cat] = [];
          });
        }
      }
      editorCat = firstSession();
      statsCat  = firstSession();
      addCat    = firstSession();
      histFilter = 'all';
      syncTimersFromHistory();
      save();
      view = 'programmes'; render();
      showToast(`Programme : ${progMeta().name}`);
      break;
    }

    // ── Séance Perso ────────────────────────────────────────
    case 'add-custom-session': {
      csEditId = null; csColor = '#FF9500'; csIcon = '🏋️';
      csReturn = view; view = 'cs-edit'; render(); break; // ROUTE-LOT3
    }
    case 'edit-custom-session': {
      const id = el.dataset.id;
      const cs = data.customSessions[id] || {};
      csEditId = id; csColor = cs.color || '#FF9500'; csIcon = cs.icon || '🏋️';
      csReturn = view; view = 'cs-edit'; render(); break; // ROUTE-LOT3
    }
    case 'close-cs-modal': {
      csEditId = null; view = csReturn; render(); break;
    }
    case 'pick-cs-color': {
      csColor = el.dataset.color;
      document.querySelectorAll('.color-swatch2').forEach(b => {
        const on = b.dataset.color === csColor;
        b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on);
      });
      break;
    }
    case 'pick-cs-icon': {
      csIcon = el.dataset.icon;
      document.querySelectorAll('.emoji-btn').forEach(b => {
        const on = b.dataset.icon === csIcon;
        b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on);
      });
      break;
    }
    case 'save-cs-modal': {
      const name = $('#csName')?.value.trim();
      const desc = $('#csDesc')?.value.trim() || '';
      if (!name) { flagInvalid($('#csName'), 'Entre un nom'); break; }

      const id = csEditId || uid();
      if (!data.customSessions) data.customSessions = {};
      data.customSessions[id] = { label: name, icon: csIcon || '🏋️', desc, color: csColor };

      // Emplacements exercices / chrono / récupération
      if (!data.programmes.custom) data.programmes.custom = { exercises: {}, timers: {}, cooldowns: {} };
      if (!data.programmes.custom.cooldowns) data.programmes.custom.cooldowns = {};
      if (!data.programmes.custom.exercises[id])  data.programmes.custom.exercises[id]  = [];
      if (!data.programmes.custom.timers[id])     data.programmes.custom.timers[id]     = null;
      if (data.programmes.custom.cooldowns[id] == null) data.programmes.custom.cooldowns[id] = 72;

      const wasEdit = csEditId !== null;
      csEditId = null;
      if (!editorCat || !sessionKeys().includes(editorCat)) editorCat = firstSession();
      if (!statsCat  || !sessionKeys().includes(statsCat))  statsCat  = firstSession();
      if (!addCat    || !sessionKeys().includes(addCat))    addCat    = firstSession();

      save();
      showToast(wasEdit ? 'Séance modifiée' : 'Séance créée');
      view = csReturn; render(); break;
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
      csEditId = null; view = 'programmes';
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
    case 'toggle-edit-mode': {
      editorEditing = !editorEditing; render(); break;
    }
    case 'ed-reveal': {
      const row = el.closest('.ed-row');
      const open = !row.classList.contains('is-del');
      document.querySelectorAll('.ed-row.is-del').forEach(r => r.classList.remove('is-del'));
      row.classList.toggle('is-del', open);
      break;
    }
    case 'set-cooldown': {
      prog().cooldowns[editorCat] = parseInt(el.dataset.h);
      save();
      document.querySelectorAll('[data-action="set-cooldown"]').forEach(b => {
        const on = b === el;
        b.classList.toggle('segmented__btn--active', on); b.setAttribute('aria-pressed', on);
      });
      break;
    }
    case 'edit-ex': {
      editExIdx = parseInt(el.dataset.i);
      const ex = (prog().exercises[editorCat] || [])[editExIdx];
      if (!ex) break;
      exDraft = { name: ex.name, sets: ex.sets, rest: ex.rest ?? null, target: ex.target ?? null, repMax: ex.repMax ?? 12 };
      view = 'ex-edit'; render(); break; // ROUTE-LOT3
    }
    case 'add-ex': {
      editExIdx = null;
      exDraft = { name: '', sets: 3, rest: null, target: null, repMax: 12 };
      view = 'ex-edit'; render(); // ROUTE-LOT3
      setTimeout(() => $('#exName')?.focus(), 50);
      break;
    }
    case 'ex-sets': {
      if (!exDraft) break;
      exDraft.sets = Math.max(1, Math.min(10, exDraft.sets + parseInt(el.dataset.d)));
      $('#exSetsVal').textContent = exDraft.sets;
      haptic(); break;
    }
    case 'ex-rest':
    case 'ex-rest-step': {
      if (!exDraft) break;
      const v = action === 'ex-rest' ? parseInt(el.dataset.s)
        : Math.max(10, Math.min(600, (exDraft.rest ?? data.defaultRest) + parseInt(el.dataset.d)));
      exDraft.rest = v;
      $('#exRestVal').textContent = fmtRest(v);
      $('#exRestSub').textContent = 'Propre à cet exercice';
      document.querySelectorAll('[data-action="ex-rest"]').forEach(b => {
        const on = parseInt(b.dataset.s) === v;
        b.classList.toggle('segmented__btn--active', on); b.setAttribute('aria-pressed', on);
      });
      break;
    }
    case 'del-ex': {
      const i    = parseInt(el.dataset.i);
      const name = prog().exercises[editorCat][i].name;
      if (!(await confirmSheet(`Supprimer « ${name} » ?`, 'L\'historique de cet exercice est conservé.', 'Supprimer l\'exercice'))) break;
      prog().exercises[editorCat].splice(i, 1);
      save();
      if (view === 'ex-edit') { view = 'editor'; exDraft = null; editExIdx = null; }
      render(); break;
    }
    case 'save-ex': {
      const nameIn = $('#exName'), targetIn = $('#exTarget'), repIn = $('#exRepMax');
      const name = nameIn?.value.trim();
      if (!name) { flagInvalid(nameIn, 'Entre un nom'); break; }
      const sets = exDraft?.sets ?? 3;
      const rest = exDraft?.rest ?? null;
      const targetRaw = targetIn?.value.trim() || '';
      if (targetRaw && (!weightOk(targetRaw) || !(parseFloat(storeW(targetRaw)) > 0))) { flagInvalid(targetIn, weightMsg()); break; }
      const target = targetRaw ? parseFloat(storeW(targetRaw)) : null;
      const repRaw = repIn?.value.trim() || '';
      const repMax = repRaw ? num(repRaw, 1, 100, true) : 12;
      if (repMax === null) { flagInvalid(repIn, 'Reps entre 1 et 100'); break; }
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
        ex.repMax = repMax;
      } else {
        const ex = makeExercise(name, sets);
        // Un exercice déjà présent dans l'historique (supprimé puis recréé) retrouve son identifiant
        const known = resolveExId(data.activeProgramme, editorCat, name);
        if (!list.some(e => e.id === known)) ex.id = known;
        ex.target = target;
        ex.rest   = rest;
        ex.repMax = repMax;
        list.push(ex);
        recomputePRFromHistory();
      }
      exDraft = null; editExIdx = null; save();
      view = 'editor'; render(); break;
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
  // Date de la dernière sauvegarde, affichée dans Réglages › Données
  const done = () => { data.lastExport = Date.now(); save(true); const t = $('#lastExportTxt'); if (t) { t.textContent = 'Dernière sauvegarde : aujourd\'hui'; t.classList.remove('txt-warn'); } };
  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Sauvegarde PPL Training' }); done(); return; }
    catch (err) { if (err?.name === 'AbortError') return; }
  }
  downloadText(json, fname);
  done();
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
