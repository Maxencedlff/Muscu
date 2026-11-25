// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : logique pure de l'onglet Programme (docs/COACH_WEB.md, vague 4 ; maquette 4-programme)
//
//  Format : exactement celui de l'app iPhone. Le brouillon est un programme envoyé (cleanSentProgramme, js/data/coach.js)
//  que le coach modifie champ par champ avec les règles de l'app : séries 1 à 10, fourchette (repMin < repMax) ou reps
//  fixes (repFixed), charge prescrite pour toutes les séries (load) ou série par série (loads, js/data/coach-presc.js),
//  repos 10 à 600 s, technique et séries visées (intens, intensOn : intensFieldsFor, js/data/intensif.js), consigne
//  (cleanConsigne, 500 caractères). Il repart par coachSentPayload (même nettoyage et même limite de 200 Ko que l'app),
//  donc l'élève reçoit ce que l'app lui aurait envoyé.
//  Sources du brouillon : ce que l'élève a reçu (coach_student_programmes), sinon la version du programme gardée sur mon
//  compte (profiles.doc : programmeToSent, comme l'écran Envoyer de l'app).
//  « La dernière fois » : studentLastLoads (js/data/coach-presc.js) sur les séances reçues par le coach.
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_PG_RESTS = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300];   // repos proposés (s) ; '' : celui de l'élève
const DESK_PG_TECHS = [['', 'Aucune'], ['drop', 'Drop set'], ['rp', 'Rest-pause'], ['cluster', 'Cluster'], ['topback', INTENS_PLANS.topback.label]];
const DESK_PG_SETS_MAX = 10;   // séries d'un exercice (cleanSentProgramme)
const DESK_PG_EX_MAX = 40;     // exercices d'une séance
let deskPgSeq = 0;

// Document de mon compte gardé au strict nécessaire : mes programmes (lus par programmeToSent) et mes plans diète
// (cleanDietPlans de js/data/nutrition.js)
function deskDocClean(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return { programmes: obj(raw.programmes), userProgrammes: obj(raw.userProgrammes), customSessions: obj(raw.customSessions),
    myProgrammes: Array.isArray(raw.myProgrammes) ? raw.myProgrammes.filter(x => typeof x === 'string').slice(0, 200) : [],
    dietPlans: cleanDietPlans(raw.dietPlans) };
}
// Mes programmes que je peux envoyer (même règle que l'app : coachSendableProgrammes) : [{ id, name, sessions }]
function deskSendableProgs(doc) {
  if (!doc) return [];
  return coachSendableProgrammes(doc).map(id => {
    const v = coachSentPayload(programmeToSent(doc, id), id);
    return v.ok ? { id, name: v.data.name, sessions: v.data.sessions.length, data: v.data } : null;
  }).filter(Boolean);
}

// Brouillon modifiable : copie du programme envoyé, une clé d'écran par exercice (_k, jamais envoyée)
function deskPgDraft(sent) {
  const d = JSON.parse(JSON.stringify(sent));
  for (const s of d.sessions) for (const e of s.exercises) e._k = `x${++deskPgSeq}`;
  return d;
}
// Programme tel qu'il partira (sans les clés d'écran), passé par le nettoyage de l'app
function deskPgPayload(draft, progId) {
  const raw = JSON.parse(JSON.stringify(draft, (k, v) => (k === '_k' ? undefined : v)));
  return coachSentPayload(raw, progId);
}
// Empreinte comparable (changements pas encore envoyés)
function deskPgSnapshot(draft, progId) { const v = deskPgPayload(draft, progId); return v.ok ? JSON.stringify(v.data) : ''; }

const deskPgInt = (v, lo, hi) => { const n = parseInt(String(v).trim(), 10); return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : null; };

// Reps d'un exercice pour l'écran : { fixed, lo, hi } (lo null en reps fixes)
function deskPgReps(e) {
  const f = fixedReps(e);
  if (f) return { fixed: true, lo: null, hi: f };
  const span = repSpanOf(e);
  return { fixed: false, lo: span ? span[0] : null, hi: parseInt(e.repMax) || 12 };
}
// Charge prescrite pour l'écran : { mode: 'one' | 'sets', load, loads: [kg | null] × séries }
function deskPgLoads(e) {
  const n = e.sets || 3, f = prescLoadFields(e, n);
  const perSet = Array.isArray(f.loads) && f.loads.length > 0;
  return { mode: perSet ? 'sets' : 'one', load: f.load ?? null, loads: Array.from({ length: n }, (_, i) => prescKgAt(f, i)) };
}
// Technique pour l'écran : { tech: '' | drop | rp | cluster | topback, where: 'last' | 'all' | [n] }
function deskPgTech(e) {
  return { tech: canTech(e) ? intensTechOf(e) || '' : '', where: intensWhereOf(e) || 'last' };
}

// Un champ changé par le coach, ramené aux règles de l'app. Rend true si l'exercice a changé.
function deskPgPatch(e, field, value) {
  const before = JSON.stringify(e);
  const reps = deskPgReps(e), loads = deskPgLoads(e), tech = deskPgTech(e);
  if (field === 'sets') {
    const n = deskPgInt(value, 1, DESK_PG_SETS_MAX);
    if (n === null) return false;
    e.sets = n;
    // Charge commune gardée en repli (prescKgAt : loads[i], sinon load) : une série ajoutée la reprend
    const f = prescLoadFields(e, n);
    delete e.load; delete e.loads;
    Object.assign(e, f);
    deskPgSetTech(e, tech.tech, Array.isArray(tech.where) ? tech.where.filter(x => x <= n) : tech.where);
  } else if (field === 'repMax' || field === 'repMin') {
    const hi = field === 'repMax' ? deskPgInt(value, 1, 100) : reps.hi;
    if (hi === null) return false;
    e.repMax = hi;
    if (reps.fixed || hi < 2) { e.repFixed = true; delete e.repMin; }
    else {
      // Fourchette : le bas reste écrit (un haut seul hors 12 se lirait en reps fixes, fixedReps) ; bas refusé (vide,
      // au-dessus du haut) : celui d'avant, ramené sous le haut
      delete e.repFixed;
      const typed = field === 'repMin' ? deskPgInt(value, 1, 99) : null;
      const lo = typed !== null && typed < hi ? typed : reps.lo ?? Math.max(1, hi - 4);
      e.repMin = Math.min(lo, hi - 1);
    }
  } else if (field === 'repsMode') {
    if (value === 'fixed') { e.repFixed = true; delete e.repMin; }
    else { delete e.repFixed; const lo = Math.max(1, reps.hi - 4); if (lo < reps.hi) e.repMin = lo; }
  } else if (field === 'load') {
    deskPgSetLoads(e, 'one', cleanPrescKg(String(value).replace(',', '.')), []);
  } else if (field.startsWith('loads.')) {
    const n = e.sets || 3, i = parseInt(field.slice(6), 10);
    if (!(i >= 0 && i < n)) return false;
    const own = Array.from({ length: n }, (_, j) => (Array.isArray(e.loads) ? cleanPrescKg(e.loads[j]) : null));
    own[i] = cleanPrescKg(String(value).replace(',', '.'));
    const f = prescLoadFields({ load: e.load, loads: own }, n);
    delete e.load; delete e.loads;
    Object.assign(e, f);
    if (!e.loads && e.load === undefined && own.some(x => x !== null)) e.loads = own;
  } else if (field === 'loadMode') {
    const common = loads.load ?? loads.loads.find(x => x !== null) ?? null;
    if (value === 'sets') {
      // Série par série : chaque série écrite (la charge commune gardée en repli)
      delete e.load; delete e.loads;
      Object.assign(e, prescLoadFields({ load: common, loads: loads.loads }, e.sets || 3));
      if (!Array.isArray(e.loads) && common !== null) e.loads = Array.from({ length: e.sets || 3 }, () => common);
    } else deskPgSetLoads(e, 'one', common, []);
  } else if (field === 'rest') {
    const v = String(value) === '' ? null : deskPgInt(value, 10, 600);
    if (v === null) delete e.rest; else e.rest = v;
  } else if (field === 'tech') {
    deskPgSetTech(e, value, tech.where);
  } else if (field === 'where') {
    deskPgSetTech(e, tech.tech, value);
  } else if (field === 'consigne') {
    const c = cleanConsigne(value);
    if (c) e.consigne = c; else delete e.consigne;
  } else return false;
  return JSON.stringify(e) !== before;
}
function deskPgSetLoads(e, mode, load, list) {
  delete e.load; delete e.loads;
  if (mode === 'sets') Object.assign(e, prescLoadFields({ loads: list }, e.sets));
  else if (load !== null && load !== undefined) e.load = load;
}
function deskPgSetTech(e, tech, where) {
  delete e.intens; delete e.intensOn;
  if (!tech || !canTech(e)) return;
  Object.assign(e, intensFieldsFor(tech, where, e.sets));
}
// Séries visées après un toucher sur « Série n » (plusieurs séries possibles, au moins une)
function deskPgToggleSet(where, n, sets) {
  const cur = Array.isArray(where) ? where.slice() : where === 'all' ? Array.from({ length: sets }, (_, i) => i + 1) : [sets];
  const next = cur.includes(n) ? cur.filter(x => x !== n) : [...cur, n].sort((a, b) => a - b);
  return next.length ? next : cur;
}

// Nouvel exercice : valeurs de l'app (3 séries, 8 à 12 reps, repos de l'élève)
function deskPgNewExercise(name) {
  const n = String(name || '').trim().slice(0, 80);
  if (!n) return null;
  const e = { name: currentExerciseName(n), sets: 3, repMin: 8, repMax: 12, _k: `x${++deskPgSeq}` };
  if (measureOf(e) !== 'reps') { delete e.repMin; delete e.repMax; }
  return e;
}
// Déplace l'exercice k de la séance s de delta (−1, +1) ; rend sa nouvelle position (1 = la première), null sinon
function deskPgMove(s, k, delta) {
  const i = s.exercises.findIndex(e => e._k === k), j = i + delta;
  if (i < 0 || j < 0 || j >= s.exercises.length) return null;
  const [e] = s.exercises.splice(i, 1);
  s.exercises.splice(j, 0, e);
  return j + 1;
}

// « La dernière fois » : séries de travail de la dernière séance qui a cet exercice, en texte (« 45 × 7 · 40 × 9, 9, 8 »)
// et face à la fourchette prescrite. rows : séances reçues (cleanCoachSessionRow). → { text, status, word, doneAt } | null
function deskPgLast(rows, e) {
  if (!e || measureOf(e) !== 'reps') return null;
  const last = studentLastLoads(rows, e.name);
  if (!last) return null;
  const runs = [];
  last.kg.forEach((kg, i) => { const r = runs[runs.length - 1]; if (r && r.kg === kg) r.reps.push(last.reps[i]); else runs.push({ kg, reps: [last.reps[i]] }); });
  const text = runs.map(r => `${fmtNum(r.kg, 2)} × ${r.reps.join(', ')}`).join(' · ');
  const p = prescReps(e);
  let status = null;
  if (p) status = last.reps.some(n => n < p.lo) ? 'under' : last.reps.every(n => n >= p.hi) ? 'top' : 'in';
  const fixed = !!fixedReps(e);
  const word = { under: fixed ? 'Sous les reps prévues' : 'Sous la fourchette', top: fixed ? 'Reps atteintes : monter' : 'Haut de fourchette : monter', in: 'Dans la fourchette' }[status] || '';
  return { text, status, word, doneAt: last.doneAt };
}

// Programme pour un autre élève (Envoyer à plusieurs) : la même séance, mais SES charges prescrites. Charge d'un
// exercice reprise de ce qu'il a reçu (même séance, même exercice), sinon aucune ; reps, séries, technique : celles-ci.
function deskPgForOther(draft, theirs) {
  const out = JSON.parse(JSON.stringify(draft));
  for (const s of out.sessions) {
    const ts = theirs?.sessions?.find(x => x.key === s.key);
    for (const e of s.exercises) {
      const te = ts?.exercises.find(x => sameExerciseName(x.name, e.name));
      deskPgSetLoads(e, 'one', null, []);
      if (te) Object.assign(e, prescLoadFields(te, e.sets));
    }
  }
  return out;
}
// Texte de l'envoi : « envoyé le 26 oct., vu par Léa » / « pas encore ouvert »
function deskPgSentText(p, name) {
  if (!p?.sentAt) return '';
  return `envoyé le ${fmtDate(p.sentAt, 'short')} · ${p.seen ? `vu par ${name}` : 'pas encore ouvert'}`;
}
