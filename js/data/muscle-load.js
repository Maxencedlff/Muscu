// ═══════════════════════════════════════════════════════════
//  Séries par muscle : charge de travail tirée de l'historique
// ═══════════════════════════════════════════════════════════
'use strict';

// Périodes proposées par Progrès. La charge s'exprime toujours en séries par semaine, pour que
// les seuils restent les mêmes d'une période à l'autre. « Cette semaine » part du lundi, comme la
// carte de l'accueil (repart de zéro chaque lundi) ; « 4 semaines » couvre les 28 derniers jours.
const MUSCLE_SPANS = {
  week:  { days: 7,  weeks: 1, label: 'Cette semaine', calendar: true },
  month: { days: 28, weeks: 4, label: '4 semaines' },
};


// Séries par semaine qui ouvrent chaque palier de couleur : 1 à 4 entretien, 5 à 9 travaillé,
// 10 à 19 objectif atteint, 20 et plus gros volume (0 : pas travaillé). Sources :
// - Schoenfeld, Ogborn et Krieger (J Sports Sci, 2017), méta-analyse dose-réponse : 10 séries
//   hebdomadaires et plus par muscle donnent plus d'hypertrophie que moins de 10 (le repère « objectif ») ;
// - Pelland et al. (SportRxiv, 2024), méta-régression sur 67 études : l'hypertrophie continue de croître
//   avec le nombre de séries, à rendement décroissant, sans plafond net à 10 (d'où un palier au-delà).
// Les paliers sont les mêmes pour tous ; seul le repère de la bulle suit le niveau (muscleTarget).
const MUSCLE_LEVEL_FROM = [0, 5, 10, 20];
const MUSCLE_LEVEL_MAX  = MUSCLE_LEVEL_FROM.length;
// Nom de chaque palier (légende, bulle, VoiceOver), du palier 0 au palier MUSCLE_LEVEL_MAX
const MUSCLE_LEVEL_WORDS = ['Pas travaillé', 'Entretien', 'Travaillé', 'Objectif atteint', 'Gros volume'];

// Bornes d'un palier en séries par semaine, pour la légende : « 0 », « 1–4 », « 5–9 », « 10–19 », « 20+ »
function muscleLevelRange(lvl) {
  const from = MUSCLE_LEVEL_FROM;
  if (lvl <= 0) return '0';
  if (lvl >= from.length) return `${from.at(-1)}+`;
  return `${lvl === 1 ? 1 : from[lvl - 1]}–${from[lvl] - 1}`;
}

// Repère de séries par semaine annoncé par la bulle : 10 pour qui débute (premier lancement), sinon 10 à 20
function muscleTarget(level = trainingLevel()) {
  return level === 'debutant' ? '10 par semaine' : '10 à 20 par semaine';
}

// Une série compte entière pour les muscles principaux de l'exercice, pour moitié pour les secondaires
const SECONDARY_WEIGHT = 0.5;

function emptyMuscleCounts() { return Object.fromEntries(MUSCLES.map(m => [m.id, 0])); }

// Séries faites (reps > 0, échauffement exclu : js/data/warmup.js) par muscle dans les séances de [from, to[
function muscleSetCounts(history, from = -Infinity, to = Infinity, index = chosenMusclesIndex()) {
  const counts = emptyMuscleCounts();
  let sessions = 0;
  (history || []).forEach(h => {
    if (!(h?.date >= from && h.date < to)) return;
    sessions++;
    (h.exercises || []).forEach(e => {
      const n = workSets(e.sets).filter(s => (parseInt(s?.reps) || 0) > 0).length;
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
// semaine, palier et intensité 0..1 (celle que reçoit bodyMapHtml) ; muscles peu travaillés
// (palier ≤ 1, hors petits groupes), du moins au plus travaillé. Le palier se calcule sur le nombre de
// séries affiché (demi-séries arrondies, roundSets) : la couleur ne contredit jamais le chiffre lu.
function muscleLoad(spanKey = 'week', now = Date.now(), history = data.history) {
  const span = MUSCLE_SPANS[spanKey] || MUSCLE_SPANS.week;
  const from = span.calendar ? weekStart(now) : now - span.days * 86_400_000;
  const { counts, sessions } = muscleSetCounts(history, from, now + 1);
  const perWeek = {}, levels = {}, intensity = {};
  MUSCLES.forEach(({ id }) => {
    perWeek[id]   = roundSets(counts[id]) / span.weeks;
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
