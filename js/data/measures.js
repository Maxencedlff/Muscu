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
// load : en-tête de la colonne de charge (« +kg » : charge ajoutée au poids du corps, comme « 45 s · +10 kg »)
// count : en-tête de la colonne des reps ou de la durée (« Durée » : « Secondes » ne tient pas sur 360 px ;
//         l'unité est dite par VoiceOver, voir spoken)
// goal : objectif d'une série sans séance précédente (répétitions : haut de fourchette, voir defaultGoal)
const MEASURES = {
  reps:   { label: 'Répétitions', load: () => unitLbl(),       count: 'Reps',     max: 100,  goal: 12, unit: 'reps', spoken: 'répétitions', msg: 'Reps entre 1 et 100' },
  time:   { label: 'Durée',       load: () => `+${unitLbl()}`, count: 'Durée',    max: 3600, goal: 30, unit: 's',    spoken: 'secondes',    msg: 'Durée entre 1 et 3600 secondes' },
  cardio: { label: 'Cardio',      load: () => 'km',            count: 'Durée',    max: 600,  goal: 20, unit: 'min',  spoken: 'minutes',     msg: 'Durée entre 1 et 600 minutes' },
};
const MAX_DIST_KM = 500;
function isMeasure(m) { return m === 'time' || m === 'cardio'; }

// Objectif d'une série qu'on n'a jamais faite : haut de fourchette de l'exercice en répétitions
// (12 sans réglage), 30 s de maintien, 20 min de cardio. Affiché en gris dans la case et pris tel quel
// si la case reste vide à la validation : ce que l'on voit est ce qui s'enregistre.
function defaultGoal(measure, repMax) {
  if (measure === 'time' || measure === 'cardio') return MEASURES[measure].goal;
  return num(repMax, 1, MEASURES.reps.max, true) ?? MEASURES.reps.goal;
}

// Exercices de la bibliothèque qui se tiennent dans le temps (les cardio sont ceux de la famille « cardio »)
const TIMED_EXERCISES = new Set(['Gainage (planche)', 'Gainage latéral', 'Gainage creux', 'L-sit', 'Chaise contre le mur',
  'Suspension passive', 'Front lever']);
// Noms saisis librement : maintiens et cardio reconnus par mots-clés (sur ruleKey)
const TIMED_RE  = /gainage|planche|plank|chaise (contre le|au) mur|wall sit|suspension|dead hang|\bl sit|hollow|front lever|back lever|maintien|isometri/;
const CARDIO_RE = /course|courir|footing|jogging|running|tapis|\bvelo\b|bike|spinning|cycl|elliptique|corde a sauter|marche rapide|stepper|escalier|stair|stepmill|step mill|climbmill|powermill|rameur|natation/;
// Mots qui l'emportent : « Crunch vélo », « Relevés de jambes en suspension », « Rowing rameur » restent en répétitions
const NOT_TIMED_RE  = /releve|traction|crunch|curl|rowing|tirage|pompe|squat/;
const NOT_CARDIO_RE = /crunch|abdo|rowing|tirage|releve|curl|squat|fente|pompe|gainage/;

// Mesure d'un exercice : choix enregistré (séance, historique, programme), sinon bibliothèque, sinon nom
function measureOf(ex) {
  if (isMeasure(ex?.measure)) return ex.measure;
  if (ex?.measure === 'reps') return 'reps';
  const entry = catalogueEntry(ex?.name || '');
  if (entry) return entry.equip === 'cardio' ? 'cardio' : TIMED_EXERCISES.has(entry.name) ? 'time' : 'reps';
  return measureByRules(ex?.name);
}
// Nom hors bibliothèque : mots-clés seulement
function measureByRules(name) {
  const k = ruleKey(name || '');
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
// « 45 s », « 45 s · +10 kg », « 5 km · 30 min », « 5 km · 30 min · 6:00 /km ».
// kind : setKind() de l'exercice (loadKind() en répétitions, paceKind() en cardio : allure ajoutée)
function measureSetTxt(s, measure, kind = 'charge') {
  if (!s) return '';
  const w = parseFloat(s.weight) || 0, r = parseInt(s.reps) || 0;
  if (measure === 'time')   return `${fmtSeconds(r)}${w > 0 ? ` · +${fmtW(s.weight)} ${unitLbl()}` : ''}`;
  if (measure === 'cardio') {
    // Réglage de la machine noté au chrono (js/data/machine-track.js) : « niveau moy. 9,4 », « 42 étages »
    const pace = paceTxt(s, kind), mach = typeof machineTxt === 'function' ? machineTxt(s.machine) : '';
    return `${parseFloat(s.dist) > 0 ? `${fmtNum(s.dist)} km · ` : ''}${r} min${pace ? ` · ${pace}` : ''}${mach ? ` · ${mach}` : ''}`;
  }
  if (kind === 'lest') return `${r} reps${w > 0 ? ` · +${fmtW(s.weight)} ${unitLbl()}` : ''}`;
  if (kind === 'aide') return `${r} reps${w > 0 ? ` · aide ${fmtW(s.weight)} ${unitLbl()}` : ''}`;
  return w > 0 ? `${fmtW(s.weight)} ${unitLbl()} × ${r}` : `${r} reps`;
}
// Séries d'un exercice, texte brut : poids mis en facteur s'il ne change pas (« 30 kg × 10 · 10 · 9 »),
// sinon série par série (« 30 × 10 · 32,5 × 8 ») ; durée ou cardio série par série (measureSetTxt).
// kind : setKind() de l'exercice. unitEach : unité à chaque série quand la charge change
// (« 30 kg × 10 · 32,5 kg × 8 », image partagée) ; l'historique (setsLine, échappé) s'en passe.
// Séries de travail seulement ; l'échauffement a sa ligne (warmupText).
function setsText(sets, measure = 'reps', kind = 'charge', { unitEach = false } = {}) {
  const ok = workSets(sets).filter(s => String(s.reps ?? '') !== '');
  if (!ok.length) return '—';
  if (measure !== 'reps') return ok.map(s => measureSetTxt(s, measure, kind)).join(' · ');
  const ws = ok.map(s => parseFloat(s.weight) || 0);
  if (ws.every(w => w === 0)) return `${ok.map(s => s.reps).join(' · ')} reps`;
  if (ws.every(w => w === ws[0])) return `${fmtW(ok[0].weight)} ${unitLbl()} × ${ok.map(s => s.reps).join(' · ')}`;
  const unit = unitEach ? ` ${unitLbl()}` : '';
  return ok.map(s => `${parseFloat(s.weight) > 0 ? fmtW(s.weight) + unit + ' × ' : ''}${s.reps}`).join(' · ');
}
// Séries d'échauffement d'un exercice (js/data/warmup.js) : « Échauffement 20 kg × 8 · 30 kg × 5 », '' sans
function warmupText(sets) {
  const ws = (sets || []).filter(isWarmupSet).filter(s => String(s.reps ?? '') !== '');
  return ws.length ? `Échauffement ${ws.map(s => measureSetTxt(s, 'reps')).join(' · ')}` : '';
}
// « 45 s », « 1 min 30 »
function fmtSeconds(sec) {
  const n = Math.max(0, parseInt(sec) || 0);
  if (n < 60) return `${n} s`;
  const m = Math.floor(n / 60), s = n % 60;
  return s ? `${m} min ${String(s).padStart(2, '0')}` : `${m} min`;
}

// ── Cardio : allure ─────────────────────────────────────────
// Ce qui se court ou se marche s'affiche en min/km, le vélo en km/h, le rameur en temps aux 500 m (ce
// qu'affichent les consoles Concept2, WaterRower, Life Fitness Row HX) ; le reste n'a pas d'allure
// (elliptique, escaliers, corde à sauter : la distance d'une machine n'y vaut pas d'un modèle à l'autre).
// Bornes : une allure hors de ce qu'un humain tient vient d'une faute de frappe, elle n'est pas affichée.
const SPEED_RE   = /\bvelo\b|bike|biking|spinning|cycl|vtt|home trainer|\brpm\b/;
const PACE_RE    = /course|courir|footing|jogging|running|tapis|trail|fractionne|marche|randonnee/;
const SPLIT_RE   = /rameur|rower|ergometre|rowing ergo/;
const NO_PACE_RE = /elliptique|corde|escalier|stair|stepper|stepmill/;
const PACE_RANGE  = [2, 30];    // min/km : du sprint à la marche lente
const SPEED_RANGE = [3, 80];    // km/h
const SPLIT_RANGE = [1, 10];    // min /500 m : record du monde vers 1:10, rameur débutant au-delà de 3:00
function paceKind(ex) {
  if (measureOf(ex) !== 'cardio') return null;
  const k = ruleKey(catalogueEntry(ex?.name || '')?.name || ex?.name || '');
  if (SPLIT_RE.test(k)) return 'split';
  if (NO_PACE_RE.test(k)) return null;
  return SPEED_RE.test(k) ? 'speed' : PACE_RE.test(k) ? 'pace' : null;
}
// Ce qui précise la série d'un exercice : allure en cardio, charge / lest / aide sinon (measureSetTxt)
function setKind(ex) { return measureOf(ex) === 'cardio' ? paceKind(ex) : loadKind(ex); }

// Allure : minutes par km ('pace'), km/h ('speed') ou minutes aux 500 m ('split') ; null sans distance,
// sans durée ou hors bornes. minutes : durée en minutes, décimales acceptées (Santé et le chrono des
// machines donnent la durée à la seconde)
function cardioPace(km, minutes, kind) {
  const d = parseFloat(km), t = parseFloat(minutes);
  if (!['pace', 'speed', 'split'].includes(kind) || !(d > 0) || !(t > 0)) return null;
  const v = kind === 'speed' ? d / (t / 60) : kind === 'split' ? t / (d * 2) : t / d;
  const [lo, hi] = kind === 'speed' ? SPEED_RANGE : kind === 'split' ? SPLIT_RANGE : PACE_RANGE;
  return v >= lo && v <= hi ? v : null;
}
// Allure en min/km découpée en minutes et secondes arrondies : 4,999 donne 5:00, jamais « 4:60 »
function paceParts(v) {
  let m = Math.floor(v), sec = Math.round((v - m) * 60);
  if (sec === 60) { m++; sec = 0; }
  return { m, sec };
}
// « 5:12 /km » (comme Strava et l'app Exercice), « 24,5 km/h », « 2:05 /500 m » (comme le moniteur Concept2)
function fmtPace(v, kind) {
  if (v == null || !isFinite(v)) return '';
  if (kind === 'speed') return `${fmtNum(v, 1)} km/h`;
  const { m, sec } = paceParts(v);
  return `${m}:${String(sec).padStart(2, '0')} ${kind === 'split' ? '/500 m' : '/km'}`;
}
// Même allure pour VoiceOver : « 5 minutes 12 au kilomètre », « 24,5 kilomètres heure »
function spokenPace(v, kind) {
  if (v == null || !isFinite(v)) return '';
  if (kind === 'speed') return `${fmtNum(v, 1)} kilomètres heure`;
  const { m, sec } = paceParts(v);
  return `${m} minute${m > 1 ? 's' : ''}${sec ? ` ${sec}` : ''} ${kind === 'split' ? 'aux 500 mètres' : 'au kilomètre'}`;
}
// Durée d'une série cardio en minutes : exacte (décimales) quand le chrono d'une machine l'a mesurée
// (machine.end, js/data/machine-track.js) et que les minutes n'ont pas été modifiées depuis, sinon les
// minutes entières saisies. Le temps aux 500 m d'un 2 000 m en 7:32 vaut 1:53, pas 2:00 (8 min).
function setMinutes(s) {
  const r = parseInt(s?.reps) || 0, end = s?.machine?.end;
  return Number.isFinite(end) && end > 0 && Math.max(1, Math.round(end / 60)) === r ? end / 60 : r;
}
// Allure d'une série cardio (distance dans dist, minutes dans reps) : texte, '' si elle n'a pas de sens
function paceTxt(s, kind) { return fmtPace(cardioPace(s?.dist, setMinutes(s), kind), kind); }

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

// Série au-delà de l'habituel (faute de frappe : « 180 » au lieu de « 8 ») : texte à faire confirmer, '' sinon.
// Références : la même série la dernière fois, le record, les séries déjà faites dans la séance et le haut de
// fourchette. Charge vérifiée seulement en vraie charge (pas de lest ni d'aide), avec un écart minimal pour
// ne pas alerter sur les petites charges (haltères de 4 à 7 kg).
//   { reps, weight } : saisie (kg) ; ref : { prevReps, prevW, prW, doneReps: [], doneW: [], repMax, kind }
function unusualSetValue({ reps, weight }, ref) {
  const r = parseInt(reps) || 0, w = parseFloat(weight) || 0;
  const refReps = Math.max(ref.prevReps || 0, ref.repMax || 12, ...(ref.doneReps || []));
  if (r > Math.max(30, refReps * 2)) return `${r} répétitions`;
  if (ref.kind !== 'charge') return '';
  const refW = Math.max(ref.prevW || 0, ref.prW || 0, ...(ref.doneW || []));
  if (refW > 0 && w - refW > Math.max(refW * 0.5, 20)) return `${fmtW(weight)} (d'habitude ${fmtW(refW)})`;
  return '';
}

// Poids du corps connu : dernière pesée de Santé déjà lue, sinon celui saisi dans Réglages
function currentBodyKg() {
  const fromHealth = typeof lastBodyMassKg === 'function' ? lastBodyMassKg() : null;
  return fromHealth || data.bodyWeightKg || null;
}
// Poids gardé avec une séance (h.bodyKg) : seulement celui saisi à la main, jamais une pesée de Santé
// (règle Apple 5.1.3(ii) : pas de donnée de Santé copiée dans iCloud ni envoyée sur un serveur)
function storableBodyKg() {
  const fromHealth = typeof lastBodyMassKg === 'function' ? lastBodyMassKg() : null;
  return fromHealth ? null : data.bodyWeightKg || null;
}
// Charge effective d'une série (kg) ; bodyKg inconnu : le lest seul (0 pour une aide)
function effectiveLoad(s, ex, bodyKg) {
  const w = parseFloat(s?.weight) || 0, share = bodyShare(ex);
  if (!share) return w;
  const base = bodyKg ? bodyKg * share : 0;
  if (isAssisted(ex)) return bodyKg ? Math.max(0, base - w) : 0;
  return base + w;
}
