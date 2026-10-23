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
// Mots qui l'emportent : « Crunch vélo », « Relevés de jambes en suspension », « Rowing rameur » restent en répétitions
const NOT_TIMED_RE  = /releve|traction|crunch|curl|rowing|tirage|pompe|squat/;
const NOT_CARDIO_RE = /crunch|abdo|rowing|tirage|releve|curl|squat|fente|pompe|gainage/;

// Mesure d'un exercice : choix enregistré (séance, historique, programme), sinon bibliothèque, sinon nom
function measureOf(ex) {
  if (isMeasure(ex?.measure)) return ex.measure;
  if (ex?.measure === 'reps') return 'reps';
  const entry = catalogueEntry(ex?.name || '');
  if (entry) return entry.equip === 'cardio' ? 'cardio' : TIMED_EXERCISES.has(entry.name) ? 'time' : 'reps';
  const k = ruleKey(ex?.name || '');
  if (CARDIO_RE.test(k) && !NOT_CARDIO_RE.test(k)) return 'cardio';
  return TIMED_RE.test(k) && !NOT_TIMED_RE.test(k) ? 'time' : 'reps';
}
// Mesure à enregistrer dans l'historique : toujours hors répétitions, et en répétitions seulement si ce
// n'est pas ce que le nom donnerait (le choix doit survivre à une détection différente)
function storedMeasure(ex) {
  const m = measureOf(ex);
  return m !== 'reps' || measureOf({ name: ex?.name }) !== 'reps' ? m : null;
}

// Texte d'une série selon la mesure : « 32,5 kg × 8 », « 8 reps », « 8 reps · +10 kg », « 8 reps · aide 20 kg »,
// « 45 s », « 45 s · +10 kg », « 5 km · 30 min ». kind : loadKind() de l'exercice (répétitions seulement)
function measureSetTxt(s, measure, kind = 'charge') {
  if (!s) return '';
  const w = parseFloat(s.weight) || 0, r = parseInt(s.reps) || 0;
  if (measure === 'time')   return `${fmtSeconds(r)}${w > 0 ? ` · +${fmtW(s.weight)} ${unitLbl()}` : ''}`;
  if (measure === 'cardio') return `${parseFloat(s.dist) > 0 ? `${fmtNum(s.dist)} km · ` : ''}${r} min`;
  if (kind === 'lest') return `${r} reps${w > 0 ? ` · +${fmtW(s.weight)} ${unitLbl()}` : ''}`;
  if (kind === 'aide') return `${r} reps${w > 0 ? ` · aide ${fmtW(s.weight)} ${unitLbl()}` : ''}`;
  return w > 0 ? `${fmtW(s.weight)} ${unitLbl()} × ${r}` : `${r} reps`;
}
// « 45 s », « 1 min 30 »
function fmtSeconds(sec) {
  const n = Math.max(0, parseInt(sec) || 0);
  if (n < 60) return `${n} s`;
  const m = Math.floor(n / 60), s = n % 60;
  return s ? `${m} min ${String(s).padStart(2, '0')}` : `${m} min`;
}

// ── Exercices au poids du corps : lest, aide et part du poids soulevée ──
// Part du poids du corps réellement soulevée (charge effective = poids × part + lest, ou − aide) :
// pompes mesurées sur plateforme de force (Ebben 2011, Suprak 2011), tractions, dips et squats calculés
// d'après la masse des segments (de Leva 1996 : avant-bras ou jambes qui ne montent pas). Exercices sans
// valeur établie (abdos, gainage, noms inconnus) : 0, rien n'est inventé ; seul le lest compte alors.
const BODYWEIGHT_SHARE = {
  'Tractions pronation': 0.95, 'Tractions supination': 0.95, 'Tractions prise serrée': 0.95, 'Tractions archer': 0.95,
  'Tractions négatives': 0.95, 'Muscle-up': 0.95, 'Dips': 0.95, 'Dips négatifs': 0.95,
  'Tractions assistées (machine)': 0.95, 'Dips assistés (machine)': 0.95,
  'Pompes': 0.65, 'Pompes diamant': 0.65, 'Pompes sur les genoux': 0.5, 'Pompes inclinées': 0.45, 'Pompes déclinées': 0.72,
  'Squat poids du corps': 0.88, 'Squat sauté': 0.88, 'Squat sur chaise': 0.88, 'Pistol squat': 0.94, 'Shrimp squat': 0.94,
  'Fentes': 0.85, 'Fentes sautées': 0.85, 'Tractions australiennes': 0.6, 'Rowing sous une table': 0.6,
};
// Noms saisis librement (« Tractions lestées », « Dips lestés ») : mêmes familles reconnues par le nom
const BODYWEIGHT_RULES = [[/traction|pull up|chin up|muscle up/, 0.95], [/^dips?\b(?!.*(chaise|banc|machine))/, 0.95], [/^pompes?\b|push up/, 0.65]];
const ASSISTED_RE = /assist(e|ee|es|ees)?\b.*machine|machine.*assist/;

function bodyShare(ex) {
  if (measureOf(ex) !== 'reps') return 0;
  const entry = catalogueEntry(ex?.name || '');
  if (entry) return BODYWEIGHT_SHARE[entry.name] || 0;
  const k = ruleKey(ex?.name || '');
  if (/machine|poulie|elastique/.test(k) && !ASSISTED_RE.test(k)) return 0;
  return BODYWEIGHT_RULES.find(([re]) => re.test(k))?.[1] || 0;
}
// Machine d'assistance : le kg saisi est une aide, retirée du poids du corps (moins d'aide = progrès)
function isAssisted(ex) { return bodyShare(ex) > 0 && ASSISTED_RE.test(ruleKey(ex?.name || '')); }
// Ce que contient la colonne de charge : 'charge' (barre, haltères), 'lest' ou 'aide'
function loadKind(ex) { return !bodyShare(ex) ? 'charge' : isAssisted(ex) ? 'aide' : 'lest'; }

// Poids du corps connu : dernière pesée de Santé déjà lue, sinon celui saisi dans Réglages
function currentBodyKg() {
  const fromHealth = typeof lastBodyMassKg === 'function' ? lastBodyMassKg() : null;
  return fromHealth || data.bodyWeightKg || null;
}
// Charge effective d'une série (kg) ; bodyKg inconnu : le lest seul (0 pour une aide)
function effectiveLoad(s, ex, bodyKg) {
  const w = parseFloat(s?.weight) || 0, share = bodyShare(ex);
  if (!share) return w;
  const base = bodyKg ? bodyKg * share : 0;
  if (isAssisted(ex)) return bodyKg ? Math.max(0, base - w) : 0;
  return base + w;
}
