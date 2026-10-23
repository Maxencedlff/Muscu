// ═══════════════════════════════════════════════════════════
//  Mesures d'un exercice : répétitions, durée, cardio
// ═══════════════════════════════════════════════════════════
'use strict';

// Une série garde ses deux champs historiques, lus selon la mesure de l'exercice :
//  - reps   : charge (weight, unité de l'app) × répétitions (reps)
//  - time   : lest facultatif (weight) et durée en secondes (reps) : gainage, chaise, suspension…
//  - cardio : distance en km (dist, jamais convertie en livres) et durée en minutes (reps)
// Les données restent lisibles par une version précédente (reps reste un entier), et le volume en kg
// comme les records ne comptent que les exercices en répétitions.
const MEASURES = {
  reps:   { label: 'Répétitions', load: () => unitLbl(), count: 'Reps', max: 100,  unit: 'reps', spoken: 'répétitions', msg: 'Reps entre 1 et 100' },
  time:   { label: 'Durée',       load: () => 'Lest',    count: 'Sec.', max: 3600, unit: 's',    spoken: 'secondes',    msg: 'Durée entre 1 et 3600 secondes' },
  cardio: { label: 'Cardio',      load: () => 'km',      count: 'Min',  max: 600,  unit: 'min',  spoken: 'minutes',     msg: 'Durée entre 1 et 600 minutes' },
};
const MAX_DIST_KM = 500;
function isMeasure(m) { return m === 'time' || m === 'cardio'; }

// Exercices de la bibliothèque qui se tiennent dans le temps (les cardio sont ceux de la famille « cardio »)
const TIMED_EXERCISES = new Set(['Gainage (planche)', 'Gainage latéral', 'Gainage creux', 'L-sit', 'Chaise contre le mur',
  'Suspension passive', 'Front lever']);
// Noms saisis librement : maintiens et cardio reconnus par mots-clés (sur ruleKey)
const TIMED_RE  = /gainage|planche|plank|chaise (contre le|au) mur|wall sit|suspension|dead hang|\bl sit|hollow|front lever|back lever|maintien|isometri/;
const CARDIO_RE = /course|courir|footing|jogging|running|tapis|\bvelo\b|bike|spinning|cycl|elliptique|corde a sauter|marche rapide|stepper|rameur|natation/;

// Mesure d'un exercice : choix enregistré (séance, historique, programme), sinon bibliothèque, sinon nom
function measureOf(ex) {
  if (isMeasure(ex?.measure)) return ex.measure;
  if (ex?.measure === 'reps') return 'reps';
  const entry = catalogueEntry(ex?.name || '');
  if (entry) return entry.equip === 'cardio' ? 'cardio' : TIMED_EXERCISES.has(entry.name) ? 'time' : 'reps';
  const k = ruleKey(ex?.name || '');
  return CARDIO_RE.test(k) ? 'cardio' : TIMED_RE.test(k) ? 'time' : 'reps';
}

// Texte d'une série selon la mesure : « 32,5 kg × 8 », « 8 reps », « 45 s », « 45 s · +10 kg », « 5 km · 30 min »
function measureSetTxt(s, measure) {
  if (!s) return '';
  const w = parseFloat(s.weight) || 0, r = parseInt(s.reps) || 0;
  if (measure === 'time')   return `${fmtSeconds(r)}${w > 0 ? ` · +${fmtW(s.weight)} ${unitLbl()}` : ''}`;
  if (measure === 'cardio') return `${parseFloat(s.dist) > 0 ? `${fmtNum(s.dist)} km · ` : ''}${r} min`;
  return w > 0 ? `${fmtW(s.weight)} ${unitLbl()} × ${r}` : `${r} reps`;
}
// « 45 s », « 1 min 30 »
function fmtSeconds(sec) {
  const n = Math.max(0, parseInt(sec) || 0);
  if (n < 60) return `${n} s`;
  const m = Math.floor(n / 60), s = n % 60;
  return s ? `${m} min ${String(s).padStart(2, '0')}` : `${m} min`;
}
