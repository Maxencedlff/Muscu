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

// Nombres à la française : « 32,5 » (virgule, espace fine pour les milliers)
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
function fmtNum(v, digits) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  if (!isFinite(n)) return '';
  if (digits != null) return n.toLocaleString('fr-FR', { maximumFractionDigits: digits });
  return nf.format(n);
}

// Repos : « 1:30 », « 0:45 » (pas de zéro devant les minutes)
function fmtRest(secs) {
  secs = Math.max(0, Math.round(secs || 0));
  return `${Math.floor(secs / 60)}:${pad(secs % 60)}`;
}

// Chrono de séance : « 42:07 », puis « 1:02:07 » au-delà d'une heure
function fmtClock(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

// « Aujourd'hui », « Hier », sinon « jeu. 9 oct. » (l'année seulement si ce n'est pas l'année en cours)
function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  const day0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day0 - dd) / 86400000);
  if (diff === 0) return 'Aujourd\'hui';
  if (diff === 1) return 'Hier';
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('fr-FR', opts);
}

// Durées : « 42 min », « 1 h 09 »
function fmtDuration(ms) {
  const totalMin = Math.floor(Math.max(0, ms || 0) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}\u00a0h\u00a0${pad(m)}`;
  return `${m}\u00a0min`;
}

// Icône du sprite de index.html (style SF Symbols), décorative : le libellé vient du bouton
function icon(name, size = 22) {
  return `<svg class="icon icon--${name.replace(/\./g, '-')}" width="${size}" height="${size}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}

// Valeur d'un token CSS (« var(--orange) » → « #FF9F0A ») : le canvas ne comprend pas var()
function cssColor(c) {
  const m = /^var\((--[\w-]+)\)$/.exec(String(c || '').trim());
  if (!m) return c;
  return getComputedStyle(document.body).getPropertyValue(m[1]).trim() || c;
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
    name: 'PPL', desc: 'Push · Pull · Legs', icon: icon('dumbbell'),
    sessions: {
      push: { label: 'Push', icon: '💪', desc: 'Pectoraux · Épaules · Triceps', color: 'var(--orange)' },
      pull: { label: 'Pull', icon: '🦾', desc: 'Dos · Biceps · Trapèzes',       color: 'var(--indigo)' },
      legs: { label: 'Legs', icon: '🦵', desc: 'Quadriceps · Ischio · Mollets', color: 'var(--teal)' },
    },
    defaults: {
      push: [['Développé couché haltères',4],['Développé incliné haltères',3],['Écarté haltères plat',3],['Développé militaire haltères',4],['Élévations latérales',4],['Extension triceps poulie',3]],
      pull: [['Rowing haltère unilatéral',4],['Tirage vertical prise large',4],['Tirage horizontal câble',3],['Curl biceps haltères',3],['Curl marteau',3]],
      legs: [['Squat barre',4],['Presse à cuisses',4],['Fentes marchées haltères',3],['Leg curl machine',3],['Extension quadriceps',3],['Mollets debout',4]],
    },
  },
  upper_lower: {
    name: 'Upper / Lower', desc: 'Haut · Bas du corps', icon: icon('dumbbell'),
    sessions: {
      upper: { label: 'Upper', icon: '💪', desc: 'Pecs · Dos · Épaules · Bras',              color: 'var(--orange)' },
      lower: { label: 'Lower', icon: '🦵', desc: 'Quadriceps · Ischio · Mollets · Fessiers', color: 'var(--indigo)' },
    },
    defaults: {
      upper: [['Développé couché haltères',4],['Tirage vertical prise large',4],['Rowing haltère unilatéral',3],['Développé militaire haltères',3],['Curl biceps haltères',3],['Extension triceps poulie',3]],
      lower: [['Squat barre',4],['Presse à cuisses',4],['Fentes marchées haltères',3],['Leg curl machine',3],['Extension quadriceps',3],['Mollets debout',4]],
    },
  },
  fullbody: {
    name: 'Full Body', desc: 'Corps entier · 3×/semaine', icon: icon('dumbbell'),
    sessions: {
      fullbody: { label: 'Full Body', icon: '⚡', desc: 'Corps entier', color: 'var(--teal)' },
    },
    defaults: {
      fullbody: [['Squat barre',3],['Développé couché haltères',3],['Rowing haltère unilatéral',3],['Développé militaire haltères',3],['Curl biceps haltères',3],['Extension triceps poulie',3],['Mollets debout',3]],
    },
  },
  bro: {
    name: 'Bro Split', desc: 'Chest · Back · Shoulders · Arms · Legs', icon: icon('dumbbell'),
    sessions: {
      chest:     { label: 'Chest',     icon: '💪', desc: 'Pectoraux',           color: 'var(--orange)' },
      back:      { label: 'Back',      icon: '🦾', desc: 'Dos · Trapèzes',       color: 'var(--indigo)' },
      shoulders: { label: 'Shoulders', icon: '🏔️', desc: 'Épaules',             color: 'var(--yellow)' },
      arms:      { label: 'Arms',      icon: '🦾', desc: 'Biceps · Triceps',    color: 'var(--purple)' },
      legs:      { label: 'Legs',      icon: '🦵', desc: 'Quadriceps · Ischio', color: 'var(--teal)' },
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
    name: 'Arnold Split', desc: 'Pecs+Dos · Épaules+Bras · Jambes', icon: icon('dumbbell'),
    sessions: {
      chest_back:     { label: 'Chest & Back',     icon: '💪', desc: 'Pectoraux · Dos',              color: 'var(--orange)' },
      shoulders_arms: { label: 'Shoulders & Arms', icon: '🤙', desc: 'Épaules · Biceps · Triceps',   color: 'var(--yellow)' },
      legs:           { label: 'Legs',             icon: '🦵', desc: 'Quadriceps · Ischio · Mollets', color: 'var(--teal)' },
    },
    defaults: {
      chest_back:     [['Développé couché haltères',4],['Écarté haltères plat',3],['Tirage vertical prise large',4],['Rowing haltère unilatéral',4],['Pull-ups',3]],
      shoulders_arms: [['Développé militaire haltères',4],['Élévations latérales',4],['Curl biceps haltères',3],['Curl marteau',3],['Extension triceps poulie',3]],
      legs:           [['Squat barre',4],['Presse à cuisses',4],['Fentes marchées haltères',3],['Leg curl machine',3],['Mollets debout',4]],
    },
  },
  custom: {
    name: 'Perso', desc: 'Séances personnalisées', icon: icon('pencil'),
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

// Pastille ronde de 28 px : initiale blanche sur la couleur de la séance,
// ou l'emoji choisi par l'utilisateur (séances Perso) dans un carré fixe
function catBadge(label, color, emoji, size = 28) {
  const sz = size !== 28 ? `--badge:${size}px;` : '';
  if (emoji) return `<span class="cat-badge cat-badge--emoji" ${sz ? `style="${sz}"` : ''} aria-hidden="true">${emoji}</span>`;
  const initial = String(label || '?').trim().charAt(0).toUpperCase();
  return `<span class="cat-badge" style="${sz}--cat-color:${color}" aria-hidden="true">${esc(initial)}</span>`;
}

function sessionMeta(cat, progId) {
  progId = progId || data.activeProgramme;
  if (progId === 'custom') {
    const cs = data.customSessions[cat];
    if (!cs) return { label: esc(cat), icon: catBadge(cat, 'var(--label2)'), emoji: '', desc: '', color: '#8E8E93' };
    return { ...cs, label: esc(cs.label), icon: catBadge(cs.label, cs.color, esc(cs.icon)), emoji: esc(cs.icon), desc: esc(cs.desc) };
  }
  const m = PROGRAMMES[progId]?.sessions[cat];
  if (!m) return { label: esc(cat), icon: catBadge(cat, 'var(--label2)'), emoji: '', desc: '', color: '#8E8E93' };
  return { ...m, emoji: m.icon, icon: catBadge(m.label, m.color) };
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
    return lbs >= 1000 ? fmtNum(lbs / 1000, 1) + ' k lbs' : fmtNum(Math.round(lbs)) + ' lbs';
  }
  return kg >= 1000 ? fmtNum(kg / 1000, 1) + ' t' : fmtNum(Math.round(kg)) + ' kg';
}

// Charge affichée en texte : « 32,5 » (dispW reste au point pour les champs de saisie)
function fmtW(kg) {
  const v = dispW(kg);
  return v === '' ? '' : fmtNum(v);
}

function historyColor(h) {
  const progId = h.programme || 'ppl';
  return sessionMeta(h.category, progId).color || 'var(--label2)';
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
  if (meta) meta.content = light ? '#F2F2F7' : '#000000';
  const bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (bar) bar.content = light ? 'default' : 'black-translucent';
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
}

function validationSound() { if (data.soundOn !== false) beep(660, .1); }
function finishSound()     { if (data.soundOn !== false) { beep(880, .1); setTimeout(() => beep(1320, .25), 160); } }

// ═══════════════════════════════════════════════════════════
//  Navigation : onglets, piles, historique du navigateur
// ═══════════════════════════════════════════════════════════

let renderedView = null;

// Racine de chaque onglet : les fonctions renderXxx gardent leur nom de vue historique
const TABS = {
  train:    { root: 'dashboard', label: 'Entraînement', icon: 'dumbbell',      action: 'go-home' },
  history:  { root: 'history',   label: 'Historique',   icon: 'clock.history', action: 'go-history' },
  progress: { root: 'stats',     label: 'Progrès',      icon: 'chart',         action: 'go-stats' },
  program:  { root: 'programmes', label: 'Programme',    icon: 'list.bullet',   action: 'go-program' },
};
const TAB_OF_ROOT = Object.fromEntries(Object.entries(TABS).map(([t, v]) => [v.root, t]));

let nav = { tab: 'train', stacks: { train: ['dashboard'], history: ['history'], progress: ['stats'], program: ['programmes'] } };
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
  document.querySelectorAll('.sess-sheet').forEach(el => el._close?.());
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
  else if (view === 'summary')     app.innerHTML = renderSummary(); // ROUTE-LOT3 : bilan de fin (#train/summary)
  else if (view === 'history-detail') app.innerHTML = renderHistoryDetail(); // ROUTE-LOT3
  else if (view === 'stats-ex')       app.innerHTML = renderStatsExercise(); // ROUTE-LOT3
  else if (view === 'stats-overview') app.innerHTML = renderStatsOverview(); // ROUTE-LOT3
  else if (view === 'prog-picker')    app.innerHTML = renderProgPicker();    // ROUTE-LOT3
  else if (view === 'ex-edit')        app.innerHTML = renderExEdit();        // ROUTE-LOT3
  else if (view === 'cs-edit')        app.innerHTML = renderCsEdit();        // ROUTE-LOT3
  else app.innerHTML = renderDashboard();

  if (view === 'stats-ex') drawCharts();
  if (view === 'settings') fillAppVersion();
  document.body.classList.toggle('first-paint', firstPaint);
  if (firstPaint) setTimeout(() => document.body.classList.remove('first-paint'), 600);
  firstPaint = false;
  updateChrome();
  observeLargeTitle();
  window.scrollTo(0, scrollY);
  // Entrée dans la séance : centre la série courante (lot 4)
  if (view === 'session' && activeSession) afterSessionRender(renderedView !== 'session');
  renderedView = view;
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

function sessionCounts(sess = activeSession) {
  const total = sess.exercises.reduce((a, ex) => a + ex.sets.length, 0);
  const done  = sess.exercises.reduce((a, ex) => a + ex.sets.filter(st => st.done).length, 0);
  return { total, done };
}

function updateChrome() {
  ensureChrome();
  const route = currentRoute();
  const inSession = route === 'session' && !!activeSession;
  // Séance et bilan en plein écran, sans tab bar
  const full = inSession || route === 'summary';
  const bar = $('.tabbar');
  bar.hidden = full;
  bar.querySelectorAll('.tabbar__btn').forEach(b => {
    const on = b.dataset.tab === nav.tab;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.classList.toggle('tabbar__btn--active', on);
  });
  const live = $('.livebar');
  const showLive = !!activeSession && !inSession;
  live.hidden = !showLive;
  document.body.classList.toggle('has-tabbar', !full);
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
    dashboard: 'Entraînement', history: 'Historique', stats: 'Progrès',
    editor: sessionKeys().includes(editorCat) ? rawLabel(editorCat) : 'Séance',
    programmes: 'Programme', settings: 'Réglages', session: 'Séance', summary: 'Bilan',
    'history-detail': 'Séance', 'stats-ex': 'Exercice', 'stats-overview': 'Vue d\'ensemble',
    'prog-picker': 'Programme actif', 'ex-edit': 'Exercice', 'cs-edit': 'Séance perso',
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
  return catBadge(rawLabel(cat, progId), meta.color, progId === 'custom' ? meta.emoji : '', size);
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
      const ck = $('#session-clock'); // lot 4 : chrono de la séance en m:ss
      if (ck) ck.textContent = fmtClock(Date.now() - activeSession.startedAt);
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
//  Onglet Programme (lot 5)
// ═══════════════════════════════════════════════════════════

// Pastille de séance : rond coloré avec l'initiale (intégrées) ou emoji choisi (Perso)
function sessionBadge(cat, progId, size = 28) { return catDot(cat, progId, size); }

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
      ${navBar({ title: 'Programme', right: `<button class="navbar__text" data-action="go-settings">Réglages</button>`  })}
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
      ${navBar({ title: 'Programme actif' })}
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
        ${navBar({ title: 'Séance' })}
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
      ${navBar({ title: meta.label, right: list.length ? `<button class="navbar__text ${editorEditing ? 'navbar__text--bold' : ''}" data-action="toggle-edit-mode">${editorEditing ? 'OK' : 'Modifier'}</button>` : '' })}
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
      ${navBar({ title: isEdit ? 'Exercice' : 'Nouvel exercice',
          left: `<button class="navbar__text" data-action="back">Annuler</button>`,
          right: `<button class="navbar__text navbar__text--bold" data-action="save-ex">OK</button>` })}
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
      ${navBar({ title: isEdit ? 'Modifier la séance' : 'Nouvelle séance',
          left: `<button class="navbar__text" data-action="close-cs-modal">Annuler</button>`,
          right: `<button class="navbar__text navbar__text--bold" data-action="save-cs-modal">OK</button>` })}
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

// Durée de repos : « 1:30 »
function fmtSecs(secs) { return fmtRest(secs); }

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
      ${navBar({ large: false,
        title: `<span class="navbar__title-main">${meta.label}</span>
                <span class="header__sub navbar__title-sub session-sub num"><span id="session-count">${doneSets}/${totalSets}</span> · <span id="session-clock">${fmtClock(Date.now() - activeSession.startedAt)}</span></span>`,
        left: `<button class="navbar__icon" data-action="back" aria-label="Réduire la séance">${icon('chevron.down', 24)}</button>`,
        right: `<button class="navbar__text navbar__text--bold session-finish" data-action="finish-session">Terminer</button>`,
        extra: `<div class="progress-bar session-progress" role="progressbar" aria-label="Séries validées" aria-valuemin="0" aria-valuemax="${totalSets}" aria-valuenow="${doneSets}">
          <div class="progress-bar__fill" style="width:${pct}%"></div>
        </div>` })}
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

function summaryBestSet(sets) {
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
    const b = summaryBestSet(ex.sets), pb = summaryBestSet(pex?.sets);
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
              style="${isActive ? `border-color:${meta.color};color:${meta.color};background:color-mix(in srgb, ${meta.color} 10%, transparent)` : ''}">
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
            <button class="sets-adj" data-action="rem-extra-ex" data-exid="${key}" title="Retirer" aria-label="Retirer l'exercice">${icon('xmark', 16)}</button>
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
//  Réglages (organisation : lot 5 ; visuel : lot 2)
// ═══════════════════════════════════════════════════════════

function agoText(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'aujourd\'hui';
  if (days === 1) return 'hier';
  return `il y a ${days} jours`;
}

function renderSettings() {
  // Interrupteur iOS (le bouton de la rangée porte l'état pour VoiceOver)
  const tog = (on) => `<span class="switch ${on ? 'switch--on' : ''}" aria-hidden="true"><span class="switch__thumb"></span></span>`;
  const last  = data.lastExport;
  const stale = !last || Date.now() - last > 14 * 86400000;
  const nSess = (data.history || []).length;
  return `
    <div class="view settings-view lot5">
      ${navBar({ title: 'Réglages' })}
      <div class="scr">

        <div class="group-title">Séance</div>
        <div class="group">
          <button class="cell cell--nav setting-row" data-action="setting-rest">
            <span class="cell__body"><span class="cell__title">Repos par défaut</span></span>
            <span class="cell__value num">${fmtRest(data.defaultRest)}</span>
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell setting-row" data-action="setting-sound" role="switch" aria-checked="${data.soundOn !== false}">
            <span class="cell__body"><span class="cell__title">Sons</span></span>
            ${tog(data.soundOn !== false)}
          </button>
          <button class="cell setting-row" data-action="setting-vibrate" role="switch" aria-checked="${data.vibrateOn !== false}">
            <span class="cell__body"><span class="cell__title">Vibrations</span></span>
            ${tog(data.vibrateOn !== false)}
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
          <button class="cell cell--action setting-row" data-action="export"><span class="cell__title">Exporter les données</span></button>
          <button class="cell cell--action setting-row" data-action="import"><span class="cell__title">Importer une sauvegarde</span></button>
          <button class="cell cell--destructive cell--left setting-row" data-action="wipe-data"><span class="cell__title">Supprimer toutes les données</span></button>
        </div>
        <div class="group-foot">Exporte régulièrement : les données ne sont stockées que sur cet appareil.</div>

        <div class="group-title">À propos</div>
        <div class="group">
          <div class="cell setting-row">
            <span class="cell__body"><span class="cell__title">MDLF Training<span id="appVersion"></span> · ${plural(nSess, 'séance', 'séances')}</span></span>
          </div>
          <button class="cell cell--action setting-row" data-action="force-update"><span class="cell__title">Rechercher une mise à jour</span></button>
        </div>
        <div class="settings-footer">MDLF Training</div>

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
      ${navBar({ title: 'Progrès' })}
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
    return `<div class="view stats-ex lot5">${navBar({ title: 'Exercice' })}
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
      ${navBar({ title: '' })}
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
      ${navBar({ title: 'Vue d\'ensemble' })}
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
      ${navBar({ title: 'Historique', right: `<button class="navbar__icon" data-action="go-add-session" aria-label="Ajouter une séance passée">${icon('plus', 24)}</button>`  })}
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
    return `<div class="view history-detail lot5">${navBar({ title: 'Séance' })}
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
      ${navBar({ title: '', right: `<button class="navbar__text" data-action="edit-session" data-id="${esc(h.id)}">Modifier</button>`  })}
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
    // Retour : la séance reste en cours, joignable par la mini-barre
    case 'back': {
      exDraft = null; // brouillon de Programme › Exercice abandonné
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
      if (view === 'history-detail') view = 'history';
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
      view = 'history'; render(); break;
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
    try { await navigator.share({ files: [file], title: 'Sauvegarde MDLF Training' }); done(); return; }
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
