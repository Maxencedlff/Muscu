// ═══════════════════════════════════════════════════════════
//  Courses et sorties vélo lues dans Apple Santé (Apple Watch, Strava…)
//  Logique pure : lecture et cache dans js/features/apple-services.js
// ═══════════════════════════════════════════════════════════
'use strict';

// Ces entraînements ne vont JAMAIS dans data.history : l'historique part dans la copie iCloud et sur le
// compte (règle Apple 5.1.3 : aucune donnée de Santé sur un serveur). Ils sont relus dans Santé et
// convertis ici en lignes au format d'une séance, fusionnées seulement à l'affichage (Historique) et
// dans le calcul de la récupération (accueil). Leur id commence par HEALTH_ID_PREFIX : jamais modifiables.
//
// Entraînement reçu du module natif (HealthPlugin.swift, workouts) :
//   { id, activity: 'running' | 'cycling', start, end (ms), duration (s), km, source, productType, indoor, own }

const HEALTH_PROG      = 'health';   // « programme » des lignes de Santé (aucun programme réel ne porte ce nom)
const HEALTH_ID_PREFIX = 'hk:';
const HEALTH_MIN_SEC   = 60;         // en dessous : entraînement lancé par erreur
// En dessous : affiché dans l'Historique, mais sans effet sur la récupération (trajet à vélo ou course
// pour attraper un bus, que l'Apple Watch détecte et enregistre d'elle-même)
const HEALTH_RECOVERY_MIN_SEC = 20 * 60;

// Nom d'exercice (bibliothèque : muscles, allure) et titre de la ligne, en extérieur et en intérieur
const HEALTH_ACTIVITIES = {
  running: { name: 'Course à pied', title: 'Course', indoorName: 'Tapis de course', indoorTitle: 'Course sur tapis' },
  cycling: { name: 'Vélo', title: 'Vélo', indoorName: 'Vélo d\'appartement', indoorTitle: 'Vélo d\'appartement' },
};

function isHealthEntry(h) { return String(h?.id || '').startsWith(HEALTH_ID_PREFIX); }

// Entraînement exploitable : activité connue, dates cohérentes, au moins une minute, et pas écrit par
// MDLF Training (own). La lecture ne porte que sur les courses et le vélo et l'app n'écrit que de la
// musculation : own ne devrait jamais être vrai, la vérification protège d'un changement futur de
// l'un ou de l'autre (une séance de l'app relue comme une sortie compterait deux fois).
function validHealthWorkout(w) {
  return !!w && !w.own && !!HEALTH_ACTIVITIES[w.activity] && typeof w.id === 'string' && w.id !== ''
    && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && (w.duration || 0) >= HEALTH_MIN_SEC;
}

// Source affichée : « Apple Watch » (le nom de l'appareil est souvent un prénom), sinon l'app (« Strava »)
function healthSourceLabel(w) {
  if (/^Watch/.test(w?.productType || '')) return 'Apple Watch';
  return String(w?.source || '').trim().slice(0, 40) || 'Santé';
}

// Même sortie enregistrée deux fois (Apple Watch et Strava, par exemple) : même activité, et le plus
// court des deux recouvert à plus de moitié par l'autre. On garde celui qui a une distance, puis le plus long.
function sameHealthWorkout(a, b) {
  if (a.activity !== b.activity) return false;
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  return overlap > 0.5 * Math.min(a.end - a.start, b.end - b.start);
}
function dedupeHealthWorkouts(list) {
  const ranked = list.slice().sort((a, b) => ((b.km > 0) - (a.km > 0)) || (b.duration - a.duration));
  const kept = [];
  ranked.forEach(w => { if (!kept.some(k => sameHealthWorkout(k, w))) kept.push(w); });
  return kept;
}

// Sortie déjà notée à la main dans MDLF (exercice cardio de la même famille : course ou vélo) : la ligne
// de Santé ferait doublon dans l'historique et compterait deux fois pour la récupération. Même jour ne
// suffit pas (vélo pour aller à la salle, puis vélo d'appartement à la séance) :
//  - séance chronométrée : elle recouvre la sortie, comme deux enregistrements d'une même sortie
//    (sameHealthWorkout : le plus court des deux recouvert à plus de moitié) ;
//  - séance saisie après coup (sans durée, datée à midi) : durée notée comparable, à 30 % près.
const HEALTH_FAMILY = { running: 'pace', cycling: 'speed' };
const LOGGED_DURATION_TOLERANCE = 0.3;
function loggedInHistory(w, history) {
  const day = new Date(w.end).toDateString(), family = HEALTH_FAMILY[w.activity];
  return (history || []).some(h => {
    if (new Date(h.date).toDateString() !== day) return false;
    const minutes = (h.exercises || []).filter(e => paceKind(e) === family)
      .reduce((a, e) => a + (e.sets || []).reduce((b, s) => b + (parseInt(s.reps) || 0), 0), 0);
    if (!minutes) return false;
    if (h.duration > 0) {
      const start = h.date - h.duration;
      const overlap = Math.min(w.end, h.date) - Math.max(w.start, start);
      return overlap > 0.5 * Math.min(w.end - w.start, h.duration);
    }
    return Math.abs(minutes - w.duration / 60) <= LOGGED_DURATION_TOLERANCE * (w.duration / 60);
  });
}

// Ligne de Santé prise en compte dans la récupération (accueil) : assez longue pour fatiguer les jambes
function healthCountsForRecovery(h) { return (h?.health?.sec || 0) >= HEALTH_RECOVERY_MIN_SEC; }

// Ligne au format d'une séance : { id, date, duration, programme, category, exercises, health }
// (une série cardio : minutes dans reps, km dans dist, comme une saisie dans l'app)
function healthWorkoutEntry(w) {
  const a = HEALTH_ACTIVITIES[w.activity];
  const km = Math.round((parseFloat(w.km) || 0) * 100) / 100;
  const set = { weight: '', reps: String(Math.max(1, Math.round(w.duration / 60))), ...(km > 0 ? { dist: String(km) } : {}) };
  return {
    id: HEALTH_ID_PREFIX + w.id, date: w.end, duration: Math.round(w.duration * 1000),
    programme: HEALTH_PROG, category: w.activity,
    exercises: [{ name: w.indoor ? a.indoorName : a.name, measure: 'cardio', sets: [set] }],
    health: { title: w.indoor ? a.indoorTitle : a.title, source: healthSourceLabel(w), km, sec: w.duration },
  };
}

// Entraînements lus → lignes affichées, de la plus récente à la plus ancienne
function healthHistoryEntries(workouts, history) {
  const valid = (workouts || []).filter(validHealthWorkout);
  return dedupeHealthWorkouts(valid).filter(w => !loggedInHistory(w, history))
    .map(healthWorkoutEntry).sort((a, b) => b.date - a.date);
}

// « 5,2 km · 27 min · 5:12 /km · Apple Watch » (texte brut : échappé à l'affichage)
function healthEntryLine(h) {
  const { km, sec, source } = h.health;
  const ex = h.exercises[0], kind = paceKind(ex);
  const pace = fmtPace(cardioPace(km, sec / 60, kind), kind);
  return [km > 0 ? `${fmtNum(km, 1)} km` : '', fmtDuration(h.duration), pace, source].filter(Boolean).join(' · ');
}
