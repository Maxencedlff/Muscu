// ═══════════════════════════════════════════════════════════
//  Donnée ppl_v2 : création, nettoyage, migrations, chargement et écriture
// ═══════════════════════════════════════════════════════════
'use strict';

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

// Volume (kg) : Σ charge × reps d'une liste de séries, puis d'une liste d'exercices
function setsVolume(sets) {
  return (sets || []).reduce((a, s) => a + (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0), 0);
}
function sessionVolume(exercises) {
  return exercises.reduce((total, ex) => total + setsVolume(ex.sets), 0);
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
    userProgrammes: {},   // { id: { name, sessions: { cat: { label, icon, desc, color } }, archived } }
    defaultRest: 90,
    unit: 'kg',
    soundOn: true,
    vibrateOn: true,
    healthOn: false,   // app iOS : Apple Santé
    bodyWeightKg: null, // app iOS : poids de secours pour les calories
    musicOn: false,    // app iOS : Apple Music
    history: [],
  };
}

const BACKUP_KEY = 'ppl_v2_backup';
const SCHEMA     = 3;

// Clés des séances perso : celles que crée l'app (uid, push, legs…) passent toutes
const SESSION_CAT_RE = /^[A-Za-z0-9_-]{1,40}$/;

// Nettoie une donnée venue du stockage ou d'un import : retire ce qui ferait planter l'app,
// sans toucher aux champs valides (idempotent).
function sanitizeData(d) {
  const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
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
    // Délai passé à la main : n'a de sens que tant qu'aucune séance plus récente n'a été faite
    if (p.skipped !== undefined) {
      if (isObj(p.skipped)) {
        Object.keys(p.skipped).forEach(cat => {
          const t = p.skipped[cat];
          if (!Number.isFinite(t) || t < (p.timers[cat] || 0)) delete p.skipped[cat];
        });
      }
      if (!isObj(p.skipped) || !Object.keys(p.skipped).length) delete p.skipped;
    }
  });
  // Clé de séance : écrite telle quelle dans les attributs et les sélecteurs, d'où un alphabet restreint
  const cleanSessions = sessions => {
    Object.keys(sessions).forEach(k => {
      const cs = sessions[k];
      if (!isObj(cs) || !SESSION_CAT_RE.test(k)) { delete sessions[k]; return; }
      if (typeof cs.label !== 'string' || !cs.label.trim()) cs.label = 'Séance';
      if (typeof cs.icon !== 'string') cs.icon = '🏋️';
      if (typeof cs.desc !== 'string') cs.desc = '';
      if (!/^(#[0-9a-f]{6}|var\(--[a-z]+\))$/i.test(cs.color || '')) cs.color = '#8E8E93';
    });
  };
  if (!isObj(d.customSessions)) d.customSessions = {};
  cleanSessions(d.customSessions);
  if (!isObj(d.userProgrammes)) d.userProgrammes = {};
  Object.keys(d.userProgrammes).forEach(k => {
    const up = d.userProgrammes[k];
    if (!isObj(up) || !k.startsWith('u_')) { delete d.userProgrammes[k]; return; }
    if (typeof up.name !== 'string' || !up.name.trim()) up.name = 'Programme';
    if (!isObj(up.sessions)) up.sessions = {};
    cleanSessions(up.sessions);
    up.archived = !!up.archived;
  });
  const okProg = id => PROGRAMMES[id] || (d.userProgrammes[id] && !d.userProgrammes[id].archived);
  if (!okProg(d.activeProgramme)) d.activeProgramme = 'ppl';
  const rest = parseInt(d.defaultRest);
  d.defaultRest = rest >= 10 && rest <= 600 ? rest : 90;
  if (d.unit !== 'kg' && d.unit !== 'lbs') d.unit = 'kg';
  if (!Array.isArray(d.history)) d.history = [];
  d.history = d.history.filter(h => {
    if (!isObj(h)) return false;
    if (typeof h.date === 'string') { const t = Number(h.date) || Date.parse(h.date); if (Number.isFinite(t)) h.date = t; }
    if (!Number.isFinite(h.date) || !Array.isArray(h.exercises) || typeof h.category !== 'string') return false;
    if (!h.id) h.id = uid();
    if (h.healthSaved !== undefined && h.healthSaved !== true) delete h.healthSaved;   // app iOS : déjà envoyée à Santé
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
  if (!d.userProgrammes)  d.userProgrammes = {};
  if (!d.defaultRest)     d.defaultRest = 90;
  if (!d.unit)            d.unit = 'kg';
  if (d.soundOn   == null) d.soundOn   = true;
  if (d.vibrateOn == null) d.vibrateOn = true;
  d.healthOn = d.healthOn === true;   // app iOS : Apple Santé (désactivé par défaut)
  // Poids de secours (kg) pour estimer les calories quand Santé n'a aucune pesée
  d.bodyWeightKg = Number.isFinite(d.bodyWeightKg) && d.bodyWeightKg >= 25 && d.bodyWeightKg <= 300 ? d.bodyWeightKg : null;
  d.musicOn  = d.musicOn === true;    // app iOS : Apple Music (désactivé par défaut)
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
  try {
    const json = JSON.stringify(data);
    localStorage.setItem(KEY, json);
    Native.backup(json);   // app iOS : copie de sécurité dans les fichiers de l'app
    return true;
  }
  catch {
    if (!quiet) showToast('Stockage plein : exporte tes données', { error: true });
    return false;
  }
}

// Date de la dernière séance d'une catégorie d'un programme, null s'il n'y en a aucune
function latestSessionDate(progKey, cat, d = data) {
  return (d.history || [])
    .filter(h => h.category === cat && (h.programme || 'ppl') === progKey)
    .reduce((best, h) => (best === null || h.date > best ? h.date : best), null);
}

// Délais de récupération du programme actif : avancés jusqu'à la dernière séance de l'historique.
// Une séance plus ancienne ne recule jamais un délai ; « Passer le délai » est gardé à part (skipped).
function syncTimersFromHistory() {
  const p = prog();
  sessionKeys().forEach(cat => {
    const latest = latestSessionDate(data.activeProgramme, cat);
    if (latest !== null && latest > (p.timers[cat] || 0)) p.timers[cat] = latest;
  });
  save();
}

// Séance retirée de l'historique : si c'est elle qui fixait le délai, il recule à la précédente
function releaseTimer(entry) {
  const p = data.programmes[entry.programme || 'ppl'];
  if (!p?.timers || p.timers[entry.category] !== entry.date) return;
  p.timers[entry.category] = latestSessionDate(entry.programme || 'ppl', entry.category);
}

// Donnée illisible : l'app démarre sur une donnée vide sans rien écrire, puis affiche l'écran de secours
let loadError = null;
let data;
try { data = loadData(); }
catch (err) { loadError = err; dataBroken = true; data = makeDefaultData(); }
