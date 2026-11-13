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
        .filter(h => entryProg(h) === progKey && h.category === cat)
        .sort((a, b) => a.date - b.date);
      sessions.forEach(session => {
        (session.exercises || []).forEach(histEx => {
          const exData = exercises.find(e => sameEx(e, histEx));
          // Records : répétitions seulement. Mesure lue sur l'entrée (toujours enregistrée hors répétitions) :
          // ce calcul tourne au chargement, avant js/data/measures.js
          if (!exData || histEx.measure === 'time' || histEx.measure === 'cardio') return;
          if (/assist/i.test(histEx.name) && /machine/i.test(histEx.name)) return;   // aide : pas de record de charge
          workSets(histEx.sets).forEach(s => {   // échauffement (js/data/warmup.js) : ni record ni dernière série
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
    if (entryProg(h) !== progKey || h.category !== cat) continue;
    const ex = (h.exercises || []).find(e => sameEx(e, exLike));
    if (ex && ex.sets?.length) return { h, ex };
  }
  // Jamais fait dans cette séance : sa dernière fois ailleurs, par le nom (nouveau programme créé avec des
  // exercices déjà faits, séance libre, autre jour). Avant le 05/11/2026, la colonne « Avant » restait vide.
  const key = exerciseNameKey(exLike?.name);
  if (!key) return null;
  for (const h of d.history || []) {
    const ex = (h.exercises || []).find(e => exerciseNameKey(e.name) === key);
    if (ex && ex.sets?.length) return { h, ex };
  }
  return null;
}

// Identifiant stable pour un exercice connu par son seul nom (exercice ajouté en cours de route)
function resolveExId(progKey, cat, name, d = data) {
  if (progKey === FREE) return resolveFreeExId(name, d);
  // Par le nom, renommages de la bibliothèque compris (sameExerciseName, js/data/exercise-catalogue.js)
  const inProg = (d.programmes[progKey]?.exercises?.[cat] || []).find(e => sameExerciseName(e.name, name));
  if (inProg) return inProg.id;
  for (const h of d.history || []) {
    if (entryProg(h) !== progKey || h.category !== cat) continue;
    const ex = (h.exercises || []).find(e => e.exId && sameExerciseName(e.name, name));
    if (ex) return ex.exId;
  }
  return nameKey(name);
}

// Séance libre : l'exercice reprend l'identifiant du même nom ailleurs (programme actif d'abord,
// puis les autres, puis l'historique) pour partager sa courbe de progrès ; sinon un identifiant de nom
function resolveFreeExId(name, d = data) {
  const n = exerciseNameKey(name);
  const progs = [d.activeProgramme, ...Object.keys(d.programmes).filter(k => k !== d.activeProgramme)];
  for (const k of progs) {
    for (const list of Object.values(d.programmes[k]?.exercises || {})) {
      const ex = (list || []).find(e => exerciseNameKey(e.name) === n);
      if (ex) return ex.id;
    }
  }
  const past = (d.history || []).flatMap(h => h.exercises || []).find(e => e.exId && exerciseNameKey(e.name) === n);
  return past ? past.exId : nameKey(name);
}

// Volume (kg) : Σ charge × reps d'une liste de séries, puis d'une liste d'exercices.
// Les séries d'échauffement (warmup: true, js/data/warmup.js) n'en font jamais partie ; les sous-séries
// d'un drop set, d'un rest-pause ou d'un cluster en font partie (volumeSets, js/data/intensif.js).
function setsVolume(sets) {
  return volumeSets(sets).reduce((a, s) => a + (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0), 0);
}
// Volume d'un exercice : seulement en répétitions (un lest × des secondes n'est pas un tonnage).
// Au poids du corps, la charge effective compte (poids × part soulevée ± lest) : bodyKg est le poids
// enregistré avec la séance (h.bodyKg), sinon le poids actuel ; inconnu, seul le lest compte.
function exVolume(ex, sets = ex?.sets, bodyKg = null) {
  if (measureOf(ex) !== 'reps') return 0;
  if (!bodyShare(ex)) return setsVolume(sets);
  return volumeSets(sets).reduce((a, s) => a + effectiveLoad(s, ex, bodyKg) * (parseInt(s.reps) || 0), 0);
}
function sessionVolume(exercises, bodyKg = null) {
  return exercises.reduce((total, ex) => total + exVolume(ex, ex.sets, bodyKg), 0);
}
function entryBodyKg(h) { return h?.bodyKg || currentBodyKg(); }

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
    myProgrammes: ['ppl'], // Mes programmes : ids dans l'ordre choisi (intégrés gardés et programmes créés)
    defaultRest: 90,
    unit: 'kg',
    soundOn: true,
    soundLevel: 'fort',   // volume des bips (js/core/haptics-audio.js, SOUND_LEVELS)
    vibrateOn: true,
    healthOn: false,   // app iOS : Apple Santé
    bodyWeightKg: null, // app iOS : poids de secours pour les calories
    musicOn: false,    // app iOS : Apple Music
    exEquip: 'all',    // feuille d'ajout d'exercice : filtre de matériel (id d'EQUIPMENT ou 'all')
    rirOn: true,       // sélecteur RIR après chaque série validée (js/data/rir.js) ; data.plates (barre et disques, js/data/plates.js) absent = jeu standard
    onboarded: false,  // questions du premier lancement répondues (ou « Plus tard ») : js/features/onboarding.js
    healthKgPurged: true, // migration des pesées de Santé (normalizeData) : rien à faire sur une donnée neuve
    history: [],
    trash: [],          // { entry, deletedAt } : séances supprimées, récupérables TRASH_DAYS jours
  };
}

const BACKUP_KEY = 'ppl_v2_backup';
const SCHEMA     = 6;
// Schéma de la donnée lue au lancement (avant migration) : restoreSession (js/data/active-session.js)
// en déduit si la séance en cours vient d'une version d'avant
let loadedSchema = SCHEMA;

// Clés des séances perso : celles que crée l'app (uid, push, legs…) passent toutes
const SESSION_CAT_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MUSCLE_ID_RE   = /^[a-z_]{1,24}$/;
const MAX_MUSCLES    = 16;
const MAX_LOAD_KG    = 1000;   // mêmes bornes que la saisie en séance
const MAX_COUNT      = 4000;   // champ reps d'une série : répétitions, ou secondes d'un maintien (≤ 3600)
const TRASH_DAYS     = 30;     // durée de vie d'une séance dans « Supprimés récemment »

// Nettoie une donnée venue du stockage ou d'un import : retire ce qui ferait planter l'app,
// sans toucher aux champs valides (idempotent).
// Pesées saisies dans l'app (Réglages › Poids du corps, bilan) : [{ date, kg }] du plus récent au plus
// ancien, une par jour au plus (la dernière du jour), BODY_LOG_MAX au plus. Jamais sur le serveur
// (SYNC_LOCAL_ONLY, js/data/sync.js) ; gardées dans l'export comme bodyWeightKg, pas dans la copie iCloud (règle 5.1.3(ii), Native.backup).
// Les pesées de Santé n'y entrent jamais (règle 5.1.3) : elles sont relues dans Santé.
const BODY_LOG_MAX = 400;
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function cleanBodyWeightLog(log) {
  if (!Array.isArray(log)) return [];
  const seen = new Set();
  return log
    .filter(p => p && Number.isFinite(p.date) && p.date > 0 && Number.isFinite(p.kg) && p.kg >= 25 && p.kg <= 300)
    .map(p => ({ date: p.date, kg: p.kg }))
    .sort((a, b) => b.date - a.date)
    .filter(p => { const k = dayKey(p.date); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, BODY_LOG_MAX);
}
// Nouvelle pesée saisie : remplace celle du même jour
function logBodyWeight(kg, now = Date.now()) {
  data.bodyWeightLog = cleanBodyWeightLog([{ date: now, kg }, ...(data.bodyWeightLog || []).filter(p => dayKey(p.date) !== dayKey(now))]);
}

function sanitizeData(d) {
  const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
  if (d.bodyWeightLog !== undefined) {
    d.bodyWeightLog = cleanBodyWeightLog(d.bodyWeightLog);
    if (!d.bodyWeightLog.length) delete d.bodyWeightLog;
  }
  // Mensurations (js/data/body-measures.js) : clés connues, valeurs bornées, une par jour
  if (d.bodyMeasures !== undefined) {
    d.bodyMeasures = cleanBodyMeasures(d.bodyMeasures);
    if (!Object.keys(d.bodyMeasures).length) delete d.bodyMeasures;
  }
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
        // Champs facultatifs : bornés comme à la saisie (ils sont réinjectés dans les formulaires)
        if (ex.repMax !== undefined) { const r = num(ex.repMax, 1, 100, true); if (r === null) delete ex.repMax; else ex.repMax = r; }
        // Bas de fourchette (« 8 à 12 ») : facultatif, toujours sous le haut
        if (ex.repMin !== undefined) { const r = num(ex.repMin, 1, 99, true); if (r === null || r >= (ex.repMax ?? 12)) delete ex.repMin; else ex.repMin = r; }
        // Technique prescrite (js/data/intensif.js) : une clé connue ou rien
        if (ex.intens !== undefined) { const v = cleanIntens(ex.intens); if (v) ex.intens = v; else delete ex.intens; }
        if (ex.rest   != null) ex.rest   = num(ex.rest, 10, 600, true);
        if (ex.target != null) ex.target = num(ex.target, 0, 1000);
        // Identifiants de muscles : leur validité exacte est vérifiée à la lecture (chosenMuscles)
        if (ex.muscles != null) {
          if (!Array.isArray(ex.muscles)) delete ex.muscles;
          else ex.muscles = [...new Set(ex.muscles.filter(m => typeof m === 'string' && MUSCLE_ID_RE.test(m)))].slice(0, MAX_MUSCLES);
        }
        if (ex.measure != null && !['reps', 'time', 'cardio'].includes(ex.measure)) delete ex.measure;
        // Tempo (js/data/tempo.js) : chaîne normalisée « 3-1-1-0 », écartée si illisible
        if (ex.tempo != null) { const t = parseTempo(ex.tempo); if (t) ex.tempo = formatTempo(t); else delete ex.tempo; }
        // Guidage au son (option, le rappel seul étant le défaut) et temps de préparation choisi
        if (ex.tempoGuide !== undefined && (ex.tempoGuide !== true || !ex.tempo)) delete ex.tempoGuide;
        if (ex.tempoPrep !== undefined && (!ex.tempoGuide || !TEMPO_PREP_CHOICES.includes(ex.tempoPrep))) delete ex.tempoPrep;
        if (ex.ss !== undefined && !ssId(ex)) delete ex.ss;   // superset (js/data/supersets.js)
        // Prise (js/data/grips.js) : valeurs connues seulement, retirée s'il n'en reste aucune
        if (ex.grip !== undefined) { const g = cleanGrip(ex.grip); if (g) ex.grip = g; else delete ex.grip; }
        // Consigne du coach (js/data/coach.js) : texte court, retirée si vide
        if (ex.consigne !== undefined) { const c = cleanConsigne(ex.consigne); if (c) ex.consigne = c; else delete ex.consigne; }
        if (ex.musclesSecondary != null) {
          if (!Array.isArray(ex.musclesSecondary)) delete ex.musclesSecondary;
          else ex.musclesSecondary = [...new Set(ex.musclesSecondary.filter(m => typeof m === 'string' && MUSCLE_ID_RE.test(m)))].slice(0, MAX_MUSCLES);
        }
      });
    });
    Object.values(p.exercises).forEach(ssNormalize);
    // Consigne d'un programme que je coache (programme intégré : pas de userProgrammes, js/data/coach.js)
    if (p.consigne !== undefined) { const c = cleanConsigne(p.consigne); if (c) p.consigne = c; else delete p.consigne; }
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
      if (typeof cs.icon !== 'string') cs.icon = '';   // gardée pour les anciennes données, plus affichée
      if (typeof cs.desc !== 'string') cs.desc = '';
      if (!/^(#[0-9a-f]{6}|var\(--[a-z]+\))$/i.test(cs.color || '')) cs.color = '#8E8E93';
      if (cs.retired !== undefined && cs.retired !== true) delete cs.retired;   // retirée par un coach (js/data/coach.js)
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
    up.order = userSessionOrder(up);   // ordre des séances (voir userSessionOrder)
    cleanFromCoach(up);   // programme reçu d'un coach (js/data/coach.js)
  });
  // Muscles déclarés par l'utilisateur pour un exercice, par nom normalisé (tous programmes,
  // séances libres et historique) : { nom: [identifiants] }
  // exerciseMusclesSecondary : même forme, muscles secondaires (une demi-série chacun)
  ['exerciseMuscles', 'exerciseMusclesSecondary'].forEach(field => {
    if (!isObj(d[field])) { delete d[field]; return; }
    Object.keys(d[field]).forEach(k => {
      const v = d[field][k];
      const list = Array.isArray(v) ? [...new Set(v.filter(m => typeof m === 'string' && MUSCLE_ID_RE.test(m)))].slice(0, MAX_MUSCLES) : [];
      if (!k || k.length > 80 || !list.length) delete d[field][k]; else d[field][k] = list;
    });
  });
  const okProg = id => PROGRAMMES[id] || (d.userProgrammes[id] && !d.userProgrammes[id].archived);
  if (!okProg(d.activeProgramme)) d.activeProgramme = 'ppl';
  const rest = parseInt(d.defaultRest);
  d.defaultRest = rest >= 10 && rest <= 600 ? rest : 90;
  // Objectif de séances par semaine (accueil) : absent = nombre de séances du programme
  if (d.weeklyGoal != null) { const g = num(d.weeklyGoal, 1, 7, true); if (g === null) delete d.weeklyGoal; else d.weeklyGoal = g; }
  if (d.unit !== 'kg' && d.unit !== 'lbs') d.unit = 'kg';
  // Barre et disques de la personne (js/data/plates.js) : réglage retiré s'il n'en reste rien de valable
  if (d.plates !== undefined) { const p = cleanPlates(d.plates); if (p) d.plates = p; else delete d.plates; }
  // Carte « Ta semaine » de l'accueil coupée (js/features/recap.js) : true ou absent
  if (d.recapCardOff !== undefined && d.recapCardOff !== true) delete d.recapCardOff;
  // Séances visibles par défaut (Réglages › Social et coach, js/data/social.js) : booléen ou absent (= oui)
  if (d.sessionVisibleDefault !== undefined && typeof d.sessionVisibleDefault !== 'boolean') delete d.sessionVisibleDefault;
  // Version de l'app et date où elle a été vue (noteAppVersion, js/data/sync.js) : envoyées au profil, bornées
  if (d.appVersion !== undefined && !(typeof d.appVersion === 'string' && d.appVersion && d.appVersion.length <= 40)) delete d.appVersion;
  if (d.appSeenAt !== undefined && !(typeof d.appSeenAt === 'string' && d.appSeenAt.length <= 40
    && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(d.appSeenAt) && Number.isFinite(Date.parse(d.appSeenAt)))) delete d.appSeenAt;
  // Silhouette des muscles (bodySilhouette) : absente = homme ; valeur inconnue retirée
  if (d.silhouette !== undefined && d.silhouette !== 'female' && d.silhouette !== 'male') delete d.silhouette;
  // Sexe des repères de force (Réglages › Entraînement, js/data/strength-levels.js) : male, female, none ou absent
  if (d.strengthSex !== undefined && !STRENGTH_SEXES.includes(d.strengthSex)) delete d.strengthSex;
  // Niveau du premier lancement (trainingLevel) : valeur inconnue retirée
  if (d.level !== undefined && !TRAINING_LEVELS.includes(d.level)) delete d.level;
  // Dernier compte connecté sur l'appareil (cleanLastAccount) : retiré s'il est illisible
  if (d.lastAccount !== undefined) { const a = cleanLastAccount(d.lastAccount); if (a) d.lastAccount = a; else delete d.lastAccount; }
  if (!Array.isArray(d.history)) d.history = [];
  d.history = d.history.filter(cleanHistoryEntry);
  // Identifiants uniques (un fichier importé retouché à la main peut en répéter un)
  const ids = new Set();
  for (const h of d.history) { while (ids.has(h.id)) h.id = uid(); ids.add(h.id); }
  // Supprimés récemment : séances gardées TRASH_DAYS jours, absentes des stats tant qu'elles y sont
  if (!Array.isArray(d.trash)) d.trash = [];
  const kept = new Set(d.history.map(h => h.id));
  const limit = Date.now() - TRASH_DAYS * 86400000;
  d.trash = d.trash.filter(t => isObj(t) && Number.isFinite(t.deletedAt) && t.deletedAt > limit
    && cleanHistoryEntry(t.entry) && !kept.has(t.entry.id));
  d.myProgrammes = cleanMyProgrammes(d);   // après l'historique : la migration le lit
  // Nutrition (js/data/nutrition.js, chargé avant) : plans, plan suivi, aliments perso, repas cochés
  sanitizeDiet(d);
  return d;
}

// Mes programmes : liste ordonnée choisie par la personne (programmes intégrés gardés, programmes créés).
// Absente (données d'avant le 26/10/2026) : programme actif, programmes créés non archivés, puis
// programmes intégrés ayant au moins une séance dans l'historique, dans cet ordre (rien ne disparaît).
// Toujours : ids existants, sans doublon, l'actif dedans (ajouté en fin s'il manque), chaque programme
// créé non archivé dedans (créé sur un autre appareil, il arrive par la synchro du profil sans que la
// liste du compte le cite encore). « Perso » (ancien programme unique) seulement s'il est utilisé.
function cleanMyProgrammes(d) {
  const created = Object.keys(d.userProgrammes || {}).filter(id => !d.userProgrammes[id].archived);
  const used = id => id !== 'custom' || Object.keys(d.customSessions || {}).length > 0 || d.activeProgramme === 'custom';
  const known = id => typeof id === 'string' && (PROGRAMMES[id] ? used(id) : created.includes(id));
  const base = Array.isArray(d.myProgrammes) ? d.myProgrammes
    : [d.activeProgramme, ...created, ...Object.keys(PROGRAMMES).filter(id => (d.history || []).some(h => entryProg(h) === id))];
  return [...new Set([...base, d.activeProgramme, ...created])].filter(known);
}

// Dernier compte connecté sur cet appareil (data.lastAccount) : { method, username, signedOut? }.
// Copié avec ppl_v2 dans la sauvegarde iCloud de l'app : un nouvel iPhone restauré seulement depuis
// cette copie (sans le stockage web ni le Trousseau) propose quand même de se reconnecter
// (accountReconnectInfo, js/data/account.js). Reste sur l'appareil (SYNC_LOCAL_ONLY, js/data/sync.js).
const LAST_ACCOUNT_METHODS = ['apple', 'google', 'email'];
const LAST_ACCOUNT_NAME_RE = /^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$/;   // forme du pseudo (USERNAME_RE)
function cleanLastAccount(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const method = LAST_ACCOUNT_METHODS.includes(v.method) ? v.method : null;
  const username = typeof v.username === 'string' && LAST_ACCOUNT_NAME_RE.test(v.username) ? v.username : null;
  if (!method && !username) return null;
  return { method, username, ...(v.signedOut === true ? { signedOut: true } : {}) };
}

// ── Noms dont la mesure a changé : gardés en répétitions ──
// Un exercice enregistré sans mesure suit la détection par le nom (measureOf). Quand la bibliothèque
// apprend un nom qui était en répétitions et devient cardio ou durée, « Trail · 10 reps » deviendrait
// « 10 min » : un exercice à ce nom sans mesure enregistrée garde donc 'reps'.
// - 25/10/2026 (cardio) : « Trail », alias « treadmill », « fractionné », « vtt », « home trainer » ;
// - 26/10/2026 (alias anglais et argot) : cardio « rower », « elliptical », « cross trainer »,
//   « skipping rope » ; durée « la chaise », « chaise murale », « wall squat ».
// Liste figée : noms en répétitions pour la version d'avant et cardio ou durée pour la suivante
// (comparaison de measureOf avant et après, refaite par tests/unit/measures.mjs avec
// tests/unit/mesures-avant.json : un nouvel alias qui change une mesure fait échouer les tests tant
// qu'il n'est pas ajouté ici). Clé souple comme looseKey (js/data/muscles.js, chargé après ce fichier :
// recopiée sans ses abréviations, qui ne touchent aucun de ces noms) : « Rowers », « wall-squats » et
// « Home trainer » sont retrouvés comme la bibliothèque les retrouve.
// Par schéma de la version qui a appris le nom (les programmes ne sont figés qu'une fois, normalizeData)
const LEGACY_REPS_BY_SCHEMA = {
  4: ['treadmill', 'trail', 'fractionne', 'vtt', 'home trainer'],
  5: ['rower', 'elliptical', 'cross trainer', 'skipping rope', 'la chaise', 'chaise murale', 'wall squat'],
};
const LEGACY_REPS_NAMES = Object.values(LEGACY_REPS_BY_SCHEMA).flat();
// Clé exacte des versions d'avant la clé souple (séparateurs en espaces) et clé souple (schéma 5)
const legacyExactKey = name => normName(name).replace(/[-_/.]+/g, ' ').replace(/\s+/g, ' ').trim();
function legacyKey(name) {
  return legacyExactKey(name).replace(/[()'\u2019]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').map(w => w.replace(/s$/, '')).join('');
}
const LOOSE_KEY_SCHEMA = 5;
const LEGACY_REPS_KEYS = Object.entries(LEGACY_REPS_BY_SCHEMA).map(([v, names]) =>
  ({ schema: Number(v), loose: new Set(names.map(legacyKey)), exact: new Set(names.map(legacyExactKey)) }));
// fromSchema : schéma des données (historique : 0, tous les noms). Figé si le nom a été appris après ce
// schéma, ou si c'est une variante (« Trails », « Treadmills ») que seule la clé souple reconnaît
function pinLegacyReps(ex, fromSchema = 0) {
  if (ex.measure != null) return;
  const key = legacyKey(ex.name), exact = legacyExactKey(ex.name);
  const pin = LEGACY_REPS_KEYS.some(l => l.loose.has(key)
    && (l.schema > fromSchema || (fromSchema < LOOSE_KEY_SCHEMA && !l.exact.has(exact))));
  if (pin) ex.measure = 'reps';
}

// ── Mots de cardio appris le 29/10/2026 (schéma 6) : noms d'avant gardés en répétitions ──
// CARDIO_RE (js/data/measures.js) reconnaît depuis « escalier », « stair », « stepmill », « step mill »,
// « climbmill » et « powermill » (chrono des machines, Escaliers). Un exercice perso sans mesure à l'un de
// ces mots (« Montées d'escaliers lestées », 20 kg × 12) était en répétitions : sans cette règle il
// deviendrait « 12 min », volume 0, record perdu, et storedMeasure écrirait 'cardio' pour de bon.
// Copies figées (règle d'avant, mots ajoutés, exceptions) : la comparaison ne dépend ni de la bibliothèque
// (« Escaliers » y est entré le même jour) ni de CARDIO_RE, qui peut encore grandir. Tout est autonome : ce
// fichier nettoie l'historique dès son chargement, avant muscles.js (ruleKey) et measures.js (CARDIO_RE) ;
// tests/unit/measures.mjs vérifie que les copies et les règles vivantes concordent.
const LEGACY_CARDIO_RE     = /course|courir|footing|jogging|running|tapis|\bvelo\b|bike|spinning|cycl|elliptique|corde a sauter|marche rapide|stepper|rameur|natation/;
const CARDIO_WORDS_ADDED   = /escalier|stair|stepmill|step mill|climbmill|powermill/;   // ajoutés à CARDIO_RE le 29/10/2026
const LEGACY_NOT_CARDIO_RE = /crunch|abdo|rowing|tirage|releve|curl|squat|fente|pompe|gainage/;
// Clé des mots-clés sans les abréviations de salle (ruleKey, muscles.js) : aucune ne contient ces mots
const legacyRuleKey = name => normName(name).replace(/[-_/.]+/g, ' ').replace(/\s+/g, ' ').trim();
// Mesure que les mots-clés d'avant donnaient à un nom (tests, hors chargement : ruleKey et TIMED_RE existent)
function legacyMeasureByRules(name) {
  const k = ruleKey(name || '');
  if (LEGACY_CARDIO_RE.test(k) && !LEGACY_NOT_CARDIO_RE.test(k)) return 'cardio';
  return TIMED_RE.test(k) && !NOT_TIMED_RE.test(k) ? 'time' : 'reps';
}
const CARDIO_WORDS_SCHEMA = 6;
// fromSchema : schéma des données (historique, séance reçue d'un autre : 0, toujours ; programmes : une
// fois, au passage au schéma 6). Figé seulement si ce sont les mots ajoutés qui rendent le nom cardio.
function pinLegacyCardioWords(ex, fromSchema = 0) {
  if (ex.measure != null || fromSchema >= CARDIO_WORDS_SCHEMA) return;
  const k = legacyRuleKey(ex.name || '');
  if (!LEGACY_CARDIO_RE.test(k) && CARDIO_WORDS_ADDED.test(k) && !LEGACY_NOT_CARDIO_RE.test(k)) ex.measure = 'reps';
}

// Ordre des séances d'un programme perso : liste explicite up.order. L'ordre des clés d'un objet ne survit
// pas au serveur (profiles.doc est en jsonb, qui trie les clés) : sans cette liste, un deuxième appareil
// voyait les séances dans l'ordre alphabétique. Migration douce : absente, elle reprend l'ordre des clés
// de l'appareil ; sinon ses clés existantes d'abord, puis les séances qu'elle ne cite pas encore.
function userSessionOrder(up) {
  const keys = Object.keys(up?.sessions || {});
  const ord = Array.isArray(up?.order) ? up.order.filter(k => typeof k === 'string' && keys.includes(k)) : [];
  return [...new Set([...ord, ...keys])];
}

// Coach (js/data/coach.js, docs/COACH_V1.md) : consigne d'un programme ou d'un exercice (500 caractères
// au plus, null si vide) et marque fromCoach d'un programme reçu { coachId, name, sentAt, hash?, keptAt? }.
// Ici et non dans coach.js : sanitizeData s'exécute au chargement de ce fichier.
const CONSIGNE_MAX = 500;
function cleanConsigne(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, CONSIGNE_MAX).trim();
  return t || null;
}
function cleanFromCoach(up) {
  if (up.consigne !== undefined) { const c = cleanConsigne(up.consigne); if (c) up.consigne = c; else delete up.consigne; }
  if (up.fromCoach === undefined) return;
  const f = up.fromCoach;
  if (!f || typeof f !== 'object' || typeof f.coachId !== 'string' || f.coachId.length > 64) { delete up.fromCoach; return; }
  const out = { coachId: f.coachId, name: typeof f.name === 'string' && LAST_ACCOUNT_NAME_RE.test(f.name) ? f.name : null,
    sentAt: Number.isFinite(f.sentAt) && f.sentAt >= 0 ? f.sentAt : 0 };
  if (typeof f.hash === 'string' && f.hash.length <= 16) out.hash = f.hash;
  if (Number.isFinite(f.keptAt)) out.keptAt = f.keptAt;
  up.fromCoach = out;
}

// Séance de l'historique (ou de la corbeille) : corrigée en place, false si elle est inutilisable
function cleanHistoryEntry(h) {
  const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
  if (!isObj(h)) return false;
  if (typeof h.date === 'string') { const t = Number(h.date) || Date.parse(h.date); if (Number.isFinite(t)) h.date = t; }
  if (!Number.isFinite(h.date) || !Array.isArray(h.exercises) || typeof h.category !== 'string') return false;
  // Identifiant texte court (clé de la synchro du compte : 64 caractères au plus côté serveur)
  if (typeof h.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(h.id)) h.id = uid();
  if (h.healthSaved !== undefined && h.healthSaved !== true) delete h.healthSaved;   // app iOS : déjà envoyée à Santé
  if (h.hidden !== undefined && h.hidden !== true) delete h.hidden;   // masquée aux abonnés (social), absent sinon
  // Poids du corps au moment de la séance (volume des exercices au poids du corps)
  if (h.bodyKg !== undefined && !(Number.isFinite(h.bodyKg) && h.bodyKg >= 25 && h.bodyKg <= 300)) delete h.bodyKg;
  h.exercises = h.exercises.filter(ex => isObj(ex) && typeof ex.name === 'string');
  h.exercises.forEach(ex => {
    if (!Array.isArray(ex.sets)) ex.sets = [];
    ex.sets = ex.sets.filter(st => isObj(st) && num(st.reps, 0, MAX_COUNT, true) !== null);
    // Mesure (js/data/measures.js) : absente = répétitions ; 'time' (secondes) ou 'cardio' (minutes, km)
    // 'reps' n'est gardé que s'il corrige la détection par le nom (« Crunch vélo » choisi en répétitions).
    // Noms devenus cardio ou durée (pinLegacyReps) : à chaque nettoyage, pas une seule fois. Sans risque :
    // l'app enregistre toute mesure autre que répétitions (storedMeasure), une séance sans mesure à ces noms vient donc
    // d'une version précédente (copie importée, séance reçue d'un autre appareil par la synchro)
    if (!['reps', 'time', 'cardio'].includes(ex.measure)) delete ex.measure;
    pinLegacyReps(ex);
    pinLegacyCardioWords(ex);
    // Prise faite ce jour-là (js/data/grips.js) : indication, ne change ni records ni « Avant »
    if (ex.grip !== undefined) { const g = cleanGrip(ex.grip); if (g) ex.grip = g; else delete ex.grip; }
    ex.sets.forEach(st => {
      st.reps = String(num(st.reps, 0, MAX_COUNT, true) ?? 0);
      if (st.weight == null || st.weight === '' || !Number.isFinite(parseFloat(st.weight))) st.weight = '';
      if (st.dist != null) { const km = num(st.dist, 0, 500); if (km === null || km === 0) delete st.dist; else st.dist = String(km); }
      // Réglage d'une machine noté au chrono (js/data/machine-track.js, chargé avant ce fichier)
      if (st.machine !== undefined) { const m = cleanMachine(st.machine); if (m) st.machine = m; else delete st.machine; }
      // Échauffement (js/data/warmup.js) : true ou absent ; RIR (js/data/rir.js) : entier 0 à 4 ou absent
      if (st.warmup !== undefined && st.warmup !== true) delete st.warmup;
      if (st.rir !== undefined) { const r = cleanRir(st.rir); if (r === null) delete st.rir; else st.rir = r; }
      // Technique d'intensification et sous-séries (js/data/intensif.js) : bornées, absentes sinon
      cleanTechSet(st);
    });
    // Charge aberrante (ex. 1e308) : série écartée plutôt que comptée en tonnes
    ex.sets = ex.sets.filter(st => st.weight === '' || num(st.weight, 0, MAX_LOAD_KG) !== null);
  });
  return true;
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
  if (!['fort', 'normal', 'bas'].includes(d.soundLevel)) d.soundLevel = 'fort';
  if (d.vibrateOn == null) d.vibrateOn = true;
  d.healthOn = d.healthOn === true;   // app iOS : Apple Santé (désactivé par défaut)
  // Poids de secours (kg) pour estimer les calories quand Santé n'a aucune pesée
  d.bodyWeightKg = Number.isFinite(d.bodyWeightKg) && d.bodyWeightKg >= 25 && d.bodyWeightKg <= 300 ? d.bodyWeightKg : null;
  d.musicOn  = d.musicOn === true;    // app iOS : Apple Music (désactivé par défaut)
  d.rirOn    = d.rirOn === 'auto' ? 'auto' : d.rirOn !== false;   // choix explicite, sinon 'auto' (donnée neuve) ou montré
  // Liste écrite en dur : muscles.js (EQUIPMENT) est chargé après ce fichier ; concordance vérifiée par les tests
  if (!EQUIP_IDS.includes(d.exEquip)) d.exEquip = 'all';
  d.onboarded = d.onboarded === true;
  if (!Array.isArray(d.history)) d.history = [];
  // Règle Apple 5.1.3(ii) : aucune donnée de Santé dans iCloud (copie CloudBackupPlugin) ni sur le serveur.
  // Avant le 25/10/2026, la pesée lue dans Santé était écrite dans chaque séance : une seule fois, toute
  // valeur qui n'est pas le poids saisi à la main est retirée (le volume reprend le poids actuel).
  if (!d.healthKgPurged) {
    if (d.healthOn) d.history.forEach(h => { if (h && h.bodyKg !== undefined && h.bodyKg !== d.bodyWeightKg) delete h.bodyKg; });
    d.healthKgPurged = true;
  }
  sanitizeData(d);

  // Toute migration de schéma : texte d'avant gardé dans ppl_v2_backup (écran de secours)
  if ((d.schema || 2) < SCHEMA && rawJson) { try { localStorage.setItem(BACKUP_KEY, rawJson); } catch {} }
  // Schéma 3 : identifiant stable (exId) sur chaque exercice de l'historique
  if ((d.schema || 2) < 3) {
    d.history.forEach(h => {
      const list = d.programmes[entryProg(h)]?.exercises?.[h.category] || [];
      h.exercises.forEach(ex => {
        if (ex.exId) return;
        const found = list.find(e => normName(e.name) === normName(ex.name));
        ex.exId = found ? found.id : nameKey(ex.name);
      });
    });
    // Les PR ont pu être écrits par une séance non terminée (versions précédentes)
    try { recomputePRFromHistory(d); } catch {}
    delete d._prRecomputed;
  }
  // Schémas 4 (25/10/2026) et 5 (26/10/2026, alias) : exercices des programmes aux noms devenus cardio
  // ou durée (pinLegacyReps), une seule fois : dans l'app actuelle, un exercice de programme sans mesure
  // suit son nom (« Rameur » ou « Wall squat » ajouté depuis la bibliothèque n'est pas en répétitions).
  // Seuls les noms appris après le schéma des données sont figés : au schéma 4, « Trail » sans mesure
  // vient de la bibliothèque du 25/10 (cardio) et le reste. L'historique est traité par cleanHistoryEntry.
  const from = d.schema || 2;
  if (from < 5) {
    Object.values(d.programmes).forEach(p => Object.values(p.exercises).forEach(list => list.forEach(ex => pinLegacyReps(ex, from))));
  }
  // Schéma 6 (29/10/2026) : mots de cardio appris (pinLegacyCardioWords), même règle pour les programmes.
  // Les séances perso (customSessions) n'ont que nom et couleur : leurs exercices sont dans d.programmes.custom.
  if (from < CARDIO_WORDS_SCHEMA) {
    Object.values(d.programmes).forEach(p => Object.values(p.exercises).forEach(list => list.forEach(ex => pinLegacyCardioWords(ex, from))));
  }
  d.schema = SCHEMA;
  d.history.sort((a, b) => b.date - a.date);
  return d;
}

// Lève une exception si la donnée stockée est illisible (écran de secours)
function loadData() {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    loadedSchema = Number(parsed?.schema) || 2;
    return sanitizeData(normalizeData(parsed, raw));
  }

  // Migration depuis ppl_v1
  try {
    const rawV1 = localStorage.getItem('ppl_v1');
    if (rawV1) {
      const old = JSON.parse(rawV1);
      if (old.exercises) {
        loadedSchema = 0;
        const d = makeDefaultData();
        d.programmes.ppl.exercises = old.exercises;
        d.programmes.ppl.timers   = old.timers || { push: null, pull: null, legs: null };
        d.defaultRest = old.defaultRest || 90;
        d.history     = (old.history || []).map(h => ({ ...h, programme: 'ppl' }));
        return normalizeData(d);
      }
    }
  } catch {}

  return freshData();
}

// Donnée vide au schéma courant : ne déclenche aucune migration au lancement suivant
// (une migration écraserait ppl_v2_backup). makeDefaultData seul sert de base aux migrations.
function freshData() {
  const d = makeDefaultData();
  d.schema = SCHEMA;
  // Donnée neuve (nouvel utilisateur, mais aussi réinstallation ou nouvel appareil : rirOn reste sur
  // l'appareil) : 'auto', le sélecteur se montre dès que l'historique (synchronisé, importé) a des reps en
  // réserve notées (rirShown, js/data/rir.js) ; une donnée existante sans le champ le garde (absent = montré)
  d.rirOn = 'auto';
  return d;
}

// Renvoie false si l'écriture échoue (stockage plein) ; quiet = pas de toast
const EQUIP_IDS = ['all', 'aucun', 'halteres', 'barre', 'elastique', 'kettlebell', 'cardio', 'salle'];
let dataBroken = false;
// Version des données : +1 à chaque save(). Les caches calculés sur l'historique (legacyRecords,
// js/data/records.js) l'intègrent à leur empreinte : une séance passée modifiée ou un exercice renommé
// dans l'historique ne changent ni le nombre de séances ni la plus récente, mais passent par save().
let dataVersion = 0;
function save(quiet = false) {
  dataVersion++;
  if (dataBroken) return false;
  try {
    Object.values(data.userProgrammes || {}).forEach(up => { if (up && typeof up === 'object') up.order = userSessionOrder(up); });
    const json = JSON.stringify(data);
    localStorage.setItem(KEY, json);
    Native.backup(json);   // app iOS : copie de sécurité dans les fichiers de l'app
    if (typeof scheduleSync === 'function') scheduleSync();   // compte connecté : envoi groupé (js/data/account.js)
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
    .filter(h => h.category === cat && entryProg(h) === progKey)
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
  const p = data.programmes[entryProg(entry)];
  if (!p?.timers || p.timers[entry.category] !== entry.date) return;
  p.timers[entry.category] = latestSessionDate(entryProg(entry), entry.category);
}

// Niveaux possibles du premier lancement (data.level, trainingLevel) : déclarés avant le chargement
// ci-dessous, qui les vérifie (sanitizeData)
const TRAINING_LEVELS = ['debutant', 'confirme'];

// Donnée illisible : l'app démarre sur une donnée vide sans rien écrire, puis affiche l'écran de secours
let loadError = null;
let data;
try { data = loadData(); }
catch (err) { loadError = err; dataBroken = true; data = makeDefaultData(); }
