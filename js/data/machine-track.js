// ═══════════════════════════════════════════════════════════
//  Machines de cardio : réglage noté au fil du chrono (escaliers, tapis, vélos, elliptique)
//  Logique pure ; la feuille du chrono est dans js/features/effort-machine.js. Chargé avant store.js
//  (cleanMachine sert au nettoyage des séances dès le chargement) : rien d'autre n'est appelé à ce moment.
//  Plages et sources : docs/CARDIO_MACHINES.md
// ═══════════════════════════════════════════════════════════
'use strict';

// Une série cardio faite au chrono garde, en plus de ses champs habituels (dist en km, reps en minutes) :
//   machine = { end: 1832,                         durée exacte en secondes
//               lvl: [[0, 8, 'level'], [125, 10, 'level']],   une liste par grandeur suivie :
//               incl: [[0, 1, 'pct']],                         [seconde du chrono, valeur, unité]
//               floors: 42, damper: 5 }            saisis en fin d'exercice, facultatifs
// Une valeur vaut jusqu'à la suivante de la même liste (ou jusqu'à end). Une version précédente de l'app qui
// LIT ou SYNCHRONISE la séance garde ce champ tel quel (cleanHistoryEntry ne fait que corriger les champs
// qu'elle connaît) ; seule une version précédente qui MODIFIE la séance (Historique › Modifier, add-session.js
// réécrit les séries depuis son formulaire) le perd : les km et minutes restent, la moyenne et les étages non.
// Les niveaux ne sont jamais convertis : un niveau 10 n'a pas le même sens d'une marque à l'autre (aucun
// constructeur ne publie de table niveau → vitesse), ils ne se comparent que sur la même machine.

// Unités : bornes de saisie larges (aucune machine relevée hors plage), pas des −/+ ; max : plus haut que
// toutes les fiches lues, une machine non relevée ne doit pas être bloquée (sources : docs/CARDIO_MACHINES.md)
const MACHINE_UNITS = {
  // Niveau : borne propre à chaque machine (range de la grandeur, MACHINES)
  level: { label: 'Niveau', short: 'niveau', min: 0, max: 100, step: 1, digits: 0, spoken: 'niveau' },
  // Marches/min : 12-185 relevés (Life Fitness PowerMill 12-185, StepMill 24-162, Technogym Climb 24-165)
  spm:   { label: 'Marches/min', short: 'marches/min', min: 0, max: 200, step: 5, digits: 0, spoken: 'marches par minute' },
  // Tapis : jusqu'à 25,5 km/h (Precor TRM 885) et 30 km/h (Technogym Skillrun) ; pas de 0,1 (Life Fitness Integrity)
  kmh:   { label: 'km/h', short: 'km/h', min: 0, max: 30, step: 0.1, digits: 1, spoken: 'kilomètres heure' },
  mph:   { label: 'mph', short: 'mph', min: 0, max: 19, step: 0.1, digits: 1, spoken: 'miles heure' },
  // Inclinaison : −3 % à 15 % (Precor TRM 885, pas de 0,5 %), jusqu'à 25 % (Skillrun), 20 % (Matrix, Star Trac)
  pct:   { label: '%', short: '%', min: -5, max: 30, step: 0.5, digits: 1, spoken: 'pour cent' },
};

// Machines de la bibliothèque (nom de la fiche) : grandeurs suivies au chrono (slots, dans l'ordre de la
// feuille ; range : bornes du niveau propres à la machine) et champs facultatifs de fin d'exercice (extras)
const MACHINES = {
  // Niveaux 1-20 (StairMaster StepMill), 0-25 (Life Fitness PowerMill), 1-30 (Technogym Climb, Matrix ClimbMill)
  'Escaliers':          { slots: [{ id: 'lvl', label: 'Allure', units: ['level', 'spm'], range: { level: [0, 30] } }], extras: ['floors'] },
  'Tapis de course':    { slots: [{ id: 'speed', label: 'Vitesse', units: ['kmh', 'mph'] }, { id: 'incl', label: 'Inclinaison', units: ['pct'] }] },
  // 24 à 50 niveaux relevés (Keiser M3i 24, Technogym Excite 25, Life Fitness 26, Matrix 30, Precor UBK 885 50) :
  // 0-100 pour les vélos de biking à molette graduée en %. Cadence affichée par les consoles : notée à la fin
  'Vélo d\'appartement': { slots: [{ id: 'lvl', label: 'Résistance', units: ['level'], range: { level: [0, 100] } }], extras: ['cadence'] },
  // 20 à 30 niveaux (Precor EFX 20, Matrix 25-30, Technogym et Life Fitness 25) ; rampe souvent fixe et
  // affichée en niveaux, degrés ou % selon la marque : pas suivie
  'Vélo elliptique':    { slots: [{ id: 'lvl', label: 'Résistance', units: ['level'], range: { level: [0, 50] } }] },
  // Rameur : résistance réglée une fois (Concept2 damper 1-10, Skillrow 10 + 3, Row HX 5) ; l'allure /500 m
  // se calcule depuis la distance et la durée (paceKind 'split')
  'Rameur':             { slots: [], extras: ['damper'] },
};
// Champs de fin d'exercice : entiers bornés, tapés tels que la machine les affiche (jamais calculés)
const MACHINE_EXTRAS = {
  floors:  { label: 'Étages', hint: 'Tel que la machine l\'affiche', min: 0, max: 2000, unit: 'étages', spoken: 'étages' },
  cadence: { label: 'Cadence', hint: 'Tours par minute affichés', min: 0, max: 200, unit: 'tr/min', spoken: 'tours par minute' },
  damper:  { label: 'Résistance', hint: 'Damper Concept2 de 1 à 10, ou niveau', min: 0, max: 13, unit: '', spoken: 'résistance' },
};
const MACHINE_MAX_SEC   = 600 * 60;   // MEASURES.cardio.max (600 min)
const MACHINE_MAX_STEPS = 300;        // changements gardés par grandeur (taille de la séance sur le serveur)
const MACHINE_MERGE_SEC = 4;          // −/+ touchés coup sur coup : un seul changement daté

// Machine de l'exercice (fiche de la bibliothèque, nom ou alias), null hors de ces machines ou hors cardio
function machineOf(ex) {
  if (measureOf(ex) !== 'cardio') return null;
  const name = catalogueEntry(ex?.name || '')?.name;
  return name && MACHINES[name] ? { name, ...MACHINES[name] } : null;
}
// Chrono proposé sur la série cardio : toutes les machines de MACHINES (le rameur pour la durée exacte)
function hasMachineClock(ex) { return !!machineOf(ex); }

// Valeur saisie ramenée à la plage et au pas de l'unité (pas de faute de frappe hors plage) ; null si vide
// slot : grandeur de MACHINES, dont les bornes du niveau peuvent être plus étroites que l'unité
function machineRange(u, slot) {
  const U = MACHINE_UNITS[u];
  return slot?.range?.[u] || [U.min, U.max];
}
function clampMachineValue(v, u, slot) {
  const U = MACHINE_UNITS[u];
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').trim().replace(',', '.'));
  if (!U || !Number.isFinite(n)) return null;
  const [lo, hi] = machineRange(u, slot), f = 10 ** U.digits;
  return Math.round(Math.min(hi, Math.max(lo, n)) * f) / f;
}
// −/+ : un pas, depuis la valeur en cours ; sans valeur, le premier toucher pose le point de départ des
// consoles (niveau 1, le premier niveau de presque toutes les marques ; 0 %, 0 km/h) : la personne ajuste de là
function stepMachineValue(cur, u, dir, slot) {
  const U = MACHINE_UNITS[u], [lo] = machineRange(u, slot);
  if (cur == null) return clampMachineValue(u === 'level' ? Math.max(lo, 1) : Math.max(lo, 0), u, slot);
  // Valeur hors du pas (saisie directe 7,25) : le pas suivant retombe sur la grille
  const k = Math.round(cur / U.step * 1e6) / 1e6;
  const next = (dir > 0 ? Math.floor(k) + 1 : Math.ceil(k) - 1) * U.step;
  return clampMachineValue(next, u, slot);
}

// Valeur en cours d'une liste [[t, v, u]] (dernière entrée) : { v, u, t } ou null
function machineCurrent(log) {
  const last = Array.isArray(log) && log.length ? log[log.length - 1] : null;
  return last ? { t: last[0], v: last[1], u: last[2] } : null;
}
// Nouvelle valeur à la seconde t : ajoutée à la liste, ou remplace la précédente si elle date de moins
// de MACHINE_MERGE_SEC (plusieurs −/+ d'affilée) ; une valeur égale à celle en cours n'ajoute rien.
// Renvoie la liste modifiée en place.
function machineLogSet(log, t, v, u) {
  const sec = Math.max(0, Math.round(t)), last = machineCurrent(log);
  if (last && last.v === v && last.u === u) return log;
  if (last && sec - last.t < MACHINE_MERGE_SEC) {
    log.pop();
    const before = machineCurrent(log);
    // Retour à la valeur d'avant : le changement est annulé, la valeur d'avant continue
    if (before && before.v === v && before.u === u) return log;
    log.push([last.t, v, u]);
    return log;
  }
  if (log.length >= MACHINE_MAX_STEPS) log.splice(1, 1);   // très longue séance : les plus anciens changements fusionnent
  log.push([sec, v, u]);
  return log;
}

// Bilan d'une liste sur end secondes : par unité, moyenne pondérée par le temps et temps passé à chaque
// valeur (de la plus haute à la plus basse) ; untracked : secondes sans valeur notée (avant la première,
// ou après un changement d'unité sans valeur : [t, null, u]).
//   { units: [{ u, sec, avg, values: [{ v, sec }] }], untracked }
function machineSummary(log, end) {
  const list = (Array.isArray(log) ? log : []).filter(e => Array.isArray(e) && Number.isFinite(e[0]) && (e[1] === null || Number.isFinite(e[1])) && MACHINE_UNITS[e[2]]);
  const total = Math.max(0, Math.round(end) || 0);
  const byUnit = new Map();
  list.forEach(([t, v, u], i) => {
    const from = Math.min(total, Math.max(0, t)), to = Math.min(total, i + 1 < list.length ? list[i + 1][0] : total);
    const d = Math.max(0, to - from);
    if (!d || v === null) return;
    if (!byUnit.has(u)) byUnit.set(u, { u, sec: 0, sum: 0, values: new Map() });
    const g = byUnit.get(u);
    g.sec += d; g.sum += v * d;
    g.values.set(v, (g.values.get(v) || 0) + d);
  });
  const units = [...byUnit.values()].sort((a, b) => b.sec - a.sec).map(g => ({
    u: g.u, sec: g.sec, avg: g.sum / g.sec,
    values: [...g.values].map(([v, sec]) => ({ v, sec })).sort((a, b) => b.v - a.v),
  }));
  return { units, untracked: total - units.reduce((a, g) => a + g.sec, 0) };
}

// « 9,4 » : valeur d'une unité à la française, avec ses décimales (moyenne : une décimale de plus au plus)
function fmtMachineValue(v, u, { avg = false } = {}) {
  const U = MACHINE_UNITS[u];
  if (!U || !Number.isFinite(v)) return '';
  return fmtNum(v, avg ? Math.max(1, U.digits) : U.digits);
}
// « niveau 9,4 », « 82 marches/min », « 10,5 km/h », « 2,5 % »
function machineValueTxt(v, u, opts) {
  const U = MACHINE_UNITS[u], val = fmtMachineValue(v, u, opts);
  if (!val) return '';
  return u === 'level' ? `niveau ${val}` : `${val} ${U.short}`;
}

// Texte court ajouté à la série (historique, Progrès, séance) : « niveau moy. 9,4 · 42 étages »,
// « 10,2 km/h moy. · 2,5 % moy. », « damper 5 ». Une seule valeur tout du long : sans « moy. ».
// Deux unités dans le même exercice (niveau puis marches/min) : chacune à part, jamais convertie.
function machineTxt(m) {
  if (!m || typeof m !== 'object') return '';
  const end = Number.isFinite(m.end) ? m.end : 0, parts = [];
  for (const log of Object.values(m)) {
    if (!Array.isArray(log)) continue;
    machineSummary(log, end).units.forEach(g => {
      const single = g.values.length === 1;
      const v = single ? g.values[0].v : g.avg;
      const txt = machineValueTxt(v, g.u, { avg: !single });
      if (!txt) return;
      parts.push(single ? txt : g.u === 'level' ? txt.replace('niveau ', 'niveau moy. ') : `${txt} moy.`);
    });
  }
  if (Number.isInteger(m.floors)) parts.push(`${m.floors} étage${m.floors > 1 ? 's' : ''}`);
  if (Number.isInteger(m.cadence)) parts.push(`${m.cadence} tr/min`);
  if (Number.isInteger(m.damper)) parts.push(`résistance ${m.damper}`);
  return parts.join(' · ');
}

// Série nettoyée pour l'historique (cleanHistoryEntry, store.js) : machine valide gardée, le reste retiré.
// Renvoie la machine propre ou null.
function cleanMachine(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const end = num(m.end, 1, MACHINE_MAX_SEC, true);
  if (end === null) return null;
  const out = { end };
  const slotIds = new Set(Object.values(MACHINES).flatMap(x => x.slots.map(s => s.id)));
  for (const id of slotIds) {
    if (!Array.isArray(m[id])) continue;
    const log = [];
    m[id].slice(0, MACHINE_MAX_STEPS).forEach(e => {
      if (!Array.isArray(e) || !MACHINE_UNITS[e[2]]) return;
      const t = num(e[0], 0, end, true), U = MACHINE_UNITS[e[2]], v = e[1] === null ? null : num(e[1], U.min, U.max);
      if (t === null || (v === null && e[1] !== null) || (log.length && t < log[log.length - 1][0])) return;
      log.push([t, v, e[2]]);
    });
    if (log.some(x => x[1] !== null)) out[id] = log;
  }
  for (const [k, X] of Object.entries(MACHINE_EXTRAS)) {
    const v = num(m[k], X.min, X.max, true);
    if (v !== null) out[k] = v;
  }
  return out;
}

// Valeurs de départ d'un nouveau chrono : celles du début de la dernière fois (même exercice), unité
// comprise : le choix « Marches/min » ou « mph » reste d'une séance à l'autre. Sans dernière fois :
// première unité de la grandeur, sans valeur (rien n'est supposé : « — » jusqu'au premier toucher).
//   { [slotId]: { u, v } }
function machineStart(machine, prevMachine) {
  const out = {};
  machine.slots.forEach(slot => {
    const prev = Array.isArray(prevMachine?.[slot.id]) ? prevMachine[slot.id] : null;
    // Unité : la dernière utilisée la dernière fois (changée en cours de route : c'est la nouvelle)
    const lastU = [...(prev || [])].reverse().find(e => slot.units.includes(e?.[2]))?.[2];
    const u = lastU || slot.units[0];
    const first = prev?.find(e => e?.[2] === u);
    out[slot.id] = { u, v: first ? clampMachineValue(first[1], u, slot) : null };
  });
  return out;
}
