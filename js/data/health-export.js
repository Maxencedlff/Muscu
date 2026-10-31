// ═══════════════════════════════════════════════════════════
//  Écriture des séances dans Apple Santé : découpage en entraînements, durée active, énergie
//  Logique pure ; l'envoi est dans js/features/apple-services.js, l'écriture dans HealthPlugin.swift
//  (saveWorkouts). Une seule règle pour la fin de séance et l'envoi de l'historique.
// ═══════════════════════════════════════════════════════════
'use strict';

// Une séance devient un ou plusieurs entraînements Santé, sans se recouvrir :
//  - le cardio fait au chrono d'une machine (série avec machine.at, heure de départ du chrono, et
//    machine.end, sa durée exacte) devient un entraînement de son vrai type (course ou marche sur tapis,
//    vélo, elliptique, rameur, escaliers), à son heure ;
//  - le reste (musculation, cardio saisi à la main) devient un entraînement « Musculation » qui couvre
//    la séance, mis en pause pendant ces blocs de cardio : sa durée active exclut le temps déjà compté
//    ailleurs, et Santé ne compte jamais deux fois la même minute.
// Séance saisie après coup (sans chrono) : aucune heure de série n'est connue. Si elle ne contient que du
// cardio de machines, ses séries sont posées bout à bout depuis l'heure de la séance (chacune à sa durée) ;
// sinon tout reste dans la « Musculation » (le cardio n'y est pas situé, il n'est pas inventé).
//
// Énergie active (kcal) : seulement avec un poids du corps connu (Santé, sinon Réglages), et toujours
// NETTE (Santé compte l'énergie au-dessus du repos, comme l'Apple Watch) : (MET − 1) × kg × heures.
//  - Musculation : MET 5 (Compendium of Physical Activities 2011, code 02054, « resistance training,
//    multiple exercises, 8-15 reps », 5,0 MET), sur sa durée active seulement.
//  - Tapis : équations de l'ACSM (Guidelines for Exercise Testing and Prescription, chap. 7) avec la
//    vitesse et l'inclinaison notées au chrono (marche : VO2 = 3,5 + 0,1·v + 1,8·v·pente ; course :
//    3,5 + 0,2·v + 0,9·v·pente, v en m/min) ; MET = VO2 / 3,5. Sans vitesse notée ni distance : pas
//    d'énergie (on ne la devine pas).
//  - Autres machines (les niveaux ne se convertissent pas en watts, voir machine-track.js) : valeur
//    « général » du Compendium 2011 : vélo d'appartement 7,0 (02010), elliptique 5,0 (02048), rameur
//    4,8 (02071, effort modéré), escaliers 9,0 (02065, stair-treadmill ergometer).
// Distance : celle de la série (km), écrite seulement pour le tapis (marche et course), le vélo et le rameur.

const HEALTH_STRENGTH_MET = 5;
const HEALTH_MACHINE_ACTIVITY = {
  'Escaliers':           { activity: 'stairClimbing', met: 9.0 },
  'Vélo d\'appartement': { activity: 'cycling', met: 7.0, distance: true },
  'Vélo elliptique':     { activity: 'elliptical', met: 5.0 },
  'Rameur':              { activity: 'rowing', met: 4.8, distance: true },
  // Tapis : course ou marche selon la vitesse, énergie par l'ACSM (healthTreadmill)
  'Tapis de course':     { activity: 'running', met: null, distance: true },
};
const HEALTH_RUN_KMH      = 8;          // ACSM : équation de la course au-delà de 8 km/h (5 mph), marche en dessous
const HEALTH_BLOCK_MIN_MS = 60_000;     // bloc de cardio plus court : laissé dans la musculation
const HEALTH_MERGE_GAP_MS = 2 * 60_000; // deux séries de la même machine à moins de 2 min : un seul entraînement
const HEALTH_MPH_KMH      = 1.609344;

// kcal nettes d'un effort de `ms` millisecondes à `met` MET pour `kg` kg (0 sans poids, durée ou MET)
function netKcal(met, kg, ms) {
  if (!(kg > 0) || !(ms > 0) || !(met > 1)) return 0;
  return Math.round((met - 1) * kg * (ms / 3_600_000));
}

// Moyenne pondérée par le temps d'une grandeur du chrono, ramenée à une unité (vitesse en km/h,
// inclinaison en %) ; null si moins de la moitié du temps a une valeur notée
function machineAverage(log, end, convert) {
  const { units } = machineSummary(log, end);
  let sec = 0, sum = 0;
  units.forEach(u => { const k = convert(u.u); if (k !== null) { sec += u.sec; sum += u.avg * k * u.sec; } });
  return sec > 0 && sec >= end / 2 ? sum / sec : null;
}
const toKmh = u => (u === 'kmh' ? 1 : u === 'mph' ? HEALTH_MPH_KMH : null);
const toPct = u => (u === 'pct' ? 1 : null);

// Tapis : vitesse (chrono, sinon distance / durée), course ou marche, MET de l'ACSM (null sans vitesse)
function healthTreadmill(set, sec) {
  const m = set.machine || {};
  let kmh = machineAverage(m.speed, sec, toKmh);
  const km = parseFloat(set.dist);
  if (kmh === null && km > 0 && sec > 0) kmh = km / (sec / 3600);
  if (!(kmh > 0) || kmh > MACHINE_UNITS.kmh.max) return { activity: 'running', met: null };
  const grade = Math.max(0, (machineAverage(m.incl, sec, toPct) ?? 0) / 100);   // descente : comptée à plat
  const v = kmh * 1000 / 60;
  const run = kmh >= HEALTH_RUN_KMH;
  const vo2 = run ? 3.5 + 0.2 * v + 0.9 * v * grade : 3.5 + 0.1 * v + 1.8 * v * grade;
  return { activity: run ? 'running' : 'walking', met: vo2 / 3.5 };
}

// Durée d'une série cardio en ms : chrono exact, sinon les minutes saisies
function cardioSetMs(set) {
  const sec = set.machine?.end;
  if (sec > 0) return sec * 1000;
  const min = parseFloat(set.reps);
  return min > 0 ? min * 60_000 : 0;
}

// Bloc de cardio d'une série de machine : { activity, start, end, kcal, km } (km seulement s'il s'écrit)
function cardioBlock(ex, set, start, kg) {
  const machine = machineOf(ex), spec = machine && HEALTH_MACHINE_ACTIVITY[machine.name];
  if (!spec) return null;
  const ms = cardioSetMs(set);
  if (!(ms > 0)) return null;
  const { activity, met } = machine.name === 'Tapis de course' ? healthTreadmill(set, ms / 1000) : spec;
  const km = parseFloat(set.dist);
  return { activity, start, end: start + ms, kcal: met ? netKcal(met, kg, ms) : 0,
    km: spec.distance && km > 0 ? Math.round(km * 1000) / 1000 : 0, exKey: ex.exId || ex.name };
}

// Blocs consécutifs de la même machine (séries d'un même exercice, moins de 2 min entre deux) : un seul
// entraînement, en pause entre les séries (le repos n'est pas du cardio)
function mergeBlocks(blocks) {
  const out = [];
  blocks.slice().sort((a, b) => a.start - b.start).forEach(b => {
    const last = out[out.length - 1];
    if (last && last.exKey === b.exKey && last.activity === b.activity && b.start >= last.end && b.start - last.end <= HEALTH_MERGE_GAP_MS) {
      if (b.start > last.end) last.pauses.push([last.end, b.start]);
      last.end = b.end; last.kcal += b.kcal; last.km = Math.round((last.km + b.km) * 1000) / 1000;
    } else out.push({ ...b, pauses: [] });
  });
  return out.map(({ exKey, ...b }) => b);
}

// Entraînements Santé d'une séance de l'historique.
//   kg : poids pour l'énergie (null : aucune énergie) ; typicalMs : durée retenue sans chrono.
//   → [{ activity, start, end, pauses: [[début, fin]…], kcal, km, indoor: true, part }] triés par début,
//     part : rang de l'entraînement dans la séance (identifiant de synchro de Santé : mdlf:<id>:<part>)
function healthWorkoutPlan(h, { kg = null, typicalMs = 60 * 60_000 } = {}) {
  const exercises = (h?.exercises || []).filter(ex => workSets(ex.sets || []).length);
  if (!exercises.length) return [];
  const timed = h.duration > 0;
  const dur = timed ? h.duration : typicalMs;
  const start = timed ? h.date - dur : h.date, end = start + dur;

  const isMachineCardio = ex => measureOf(ex) === 'cardio' && !!HEALTH_MACHINE_ACTIVITY[machineOf(ex)?.name];
  let blocks = [];
  let strengthLeft = false;   // reste-t-il une série hors des blocs (musculation, cardio non situé) ?
  if (timed) {
    exercises.forEach(ex => workSets(ex.sets).forEach(s => {
      const at = s.machine?.at;
      const b = isMachineCardio(ex) && Number.isFinite(at) ? cardioBlock(ex, s, at, kg) : null;
      // Bloc tenu dans la séance (marge d'une minute : horloges arrondies), assez long, sans chevaucher
      if (b && b.start >= start - 60_000 && b.end <= end + 60_000 && b.end - b.start >= HEALTH_BLOCK_MIN_MS) {
        b.start = Math.max(b.start, start); b.end = Math.min(b.end, end);
        blocks.push(b);
      } else strengthLeft = true;
    }));
  } else if (exercises.every(isMachineCardio)) {
    let t = start;
    exercises.forEach(ex => workSets(ex.sets).forEach(s => {
      const b = cardioBlock(ex, s, t, kg);
      if (b) { blocks.push(b); t = b.end; }
    }));
    if (!blocks.length) strengthLeft = true;
  } else strengthLeft = true;

  // Chevauchements (deux chronos lancés en même temps) : le plus tardif est écarté et reste en musculation
  let lastEnd = -Infinity;
  blocks = blocks.sort((a, b) => a.start - b.start).filter(b => {
    if (b.start < lastEnd) { strengthLeft = true; return false; }
    lastEnd = b.end;
    return true;
  });
  const merged = mergeBlocks(blocks);

  const out = [];
  if (strengthLeft) {
    // Musculation : toute la séance, en pause pendant chaque bloc de cardio (repos entre deux séries d'une
    // même machine compris : la musculation ne reprend qu'après le dernier). Bloc au tout début ou à la toute fin : la musculation commence après ou finit avant (pas de pause
    // au bord d'un entraînement) ; les autres blocs sont des pauses
    let sStart = start, sEnd = end;
    const pauses = merged.map(b => [b.start, b.end]);
    while (pauses.length && pauses[0][0] <= sStart) sStart = Math.max(sStart, pauses.shift()[1]);
    while (pauses.length && pauses[pauses.length - 1][1] >= sEnd) sEnd = Math.min(sEnd, pauses.pop()[0]);
    const activeMs = (sEnd - sStart) - pauses.reduce((a, [s, e]) => a + (e - s), 0);
    // Séance presque toute en cardio : la musculation restante (moins d'une minute) n'est pas écrite
    if (activeMs >= HEALTH_BLOCK_MIN_MS) {
      out.push({ activity: 'traditionalStrengthTraining', start: sStart, end: sEnd, pauses,
        kcal: netKcal(HEALTH_STRENGTH_MET, kg, activeMs), km: 0, indoor: true });
    }
  }
  merged.forEach(b => out.push({ ...b, indoor: true }));
  return out.sort((a, b) => a.start - b.start || (a.activity === 'traditionalStrengthTraining' ? -1 : 1))
    .map((w, part) => ({ ...w, part }));
}
