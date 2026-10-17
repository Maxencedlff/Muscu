// ═══════════════════════════════════════════════════════════
//  Séries par muscle : charge de travail tirée de l'historique
// ═══════════════════════════════════════════════════════════
'use strict';

// Périodes proposées par Progrès. La charge s'exprime toujours en séries par semaine, pour que
// les seuils restent les mêmes d'une période à l'autre.
const MUSCLE_SPANS = {
  week:  { days: 7,  weeks: 1, label: 'Semaine' },
  month: { days: 28, weeks: 4, label: '4 semaines' },
};

// Séries par semaine qui ouvrent chaque palier de couleur (1 : entretien, 2 : travaillé,
// 3 : 10 séries et plus). Repère des 10 séries hebdomadaires par muscle : méta-analyse
// dose-réponse de Schoenfeld, Ogborn et Krieger (J Sports Sci, 2017).
const MUSCLE_LEVEL_FROM = [0, 4, 10];
const MUSCLE_LEVEL_MAX  = MUSCLE_LEVEL_FROM.length;

// Une série compte entière pour les muscles principaux de l'exercice, pour moitié pour les secondaires
const SECONDARY_WEIGHT = 0.5;

function emptyMuscleCounts() { return Object.fromEntries(MUSCLES.map(m => [m.id, 0])); }

// Séries faites (reps > 0) par muscle dans les séances de [from, to[
function muscleSetCounts(history, from = -Infinity, to = Infinity, index = chosenMusclesIndex()) {
  const counts = emptyMuscleCounts();
  let sessions = 0;
  (history || []).forEach(h => {
    if (!(h?.date >= from && h.date < to)) return;
    sessions++;
    (h.exercises || []).forEach(e => {
      const n = (e.sets || []).filter(s => (parseInt(s?.reps) || 0) > 0).length;
      if (!n) return;
      const m = exerciseMuscles(e, index);
      m.primary.forEach(id => { counts[id] += n; });
      m.secondary.forEach(id => { if (!m.primary.includes(id)) counts[id] += n * SECONDARY_WEIGHT; });
    });
  });
  return { counts, sessions };
}

// Palier de couleur (0 à MUSCLE_LEVEL_MAX) d'un nombre de séries par semaine
function muscleLevel(perWeek) {
  if (!(perWeek > 0)) return 0;
  let lvl = 1;
  MUSCLE_LEVEL_FROM.forEach((from, i) => { if (perWeek >= from) lvl = i + 1; });
  return lvl;
}

// Charge de la période qui se termine à `now`, par muscle : séries de la période (sets), séries par
// semaine, palier et intensité 0..1 (celle que reçoit bodyMapSvg) ; muscles peu travaillés
// (palier ≤ 1, hors petits groupes), du moins au plus travaillé.
function muscleLoad(spanKey = 'week', now = Date.now(), history = data.history) {
  const span = MUSCLE_SPANS[spanKey] || MUSCLE_SPANS.week;
  const { counts, sessions } = muscleSetCounts(history, now - span.days * 86_400_000, now + 1);
  const perWeek = {}, levels = {}, intensity = {};
  MUSCLES.forEach(({ id }) => {
    perWeek[id]   = counts[id] / span.weeks;
    levels[id]    = muscleLevel(perWeek[id]);
    intensity[id] = levels[id] / MUSCLE_LEVEL_MAX;
  });
  const low = MUSCLES.filter(m => !m.minor && levels[m.id] <= 1).map(m => m.id)
    .sort((a, b) => perWeek[a] - perWeek[b]);
  return { span: MUSCLE_SPANS[spanKey] ? spanKey : 'week', sessions, sets: counts, perWeek, levels, intensity, low };
}

// Muscles d'une seule séance (image partagée) : intensité 0..1 rapportée au muscle le plus
// travaillé de la séance, qui prend la couleur pleine. Les paliers hebdomadaires n'ont pas de sens
// pour une séance seule (10 séries sur un muscle en une fois sont rares). Muscles non travaillés absents.
function sessionMuscleLevels(entry, index = chosenMusclesIndex()) {
  const { counts } = muscleSetCounts([entry], -Infinity, Infinity, index);
  const max = Math.max(0, ...Object.values(counts));
  if (!max) return {};
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0).map(([id, n]) => [id, n / max]));
}

// Muscles les plus travaillés d'une séance (identifiants, du plus au moins travaillé, ordre de
// MUSCLES à égalité) : pour décrire l'image à VoiceOver
function sessionTopMuscles(entry, max = 3, index = chosenMusclesIndex()) {
  const lv = sessionMuscleLevels(entry, index);
  return MUSCLES.map(m => m.id).filter(id => lv[id] > 0)
    .sort((a, b) => lv[b] - lv[a]).slice(0, max);
}

// Nombre de séries à afficher : entier (les demi-séries des muscles secondaires sont arrondies)
function roundSets(v) { return Math.round(v); }
