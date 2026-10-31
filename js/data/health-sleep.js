// ═══════════════════════════════════════════════════════════
//  Sommeil lu dans Apple Santé (Apple Watch, iPhone, apps de sommeil)
//  Logique pure : lecture et cache dans js/features/apple-services.js, ligne de l'accueil dans dashboard.js
// ═══════════════════════════════════════════════════════════
'use strict';

// Comme les courses et le poids, le sommeil n'est JAMAIS copié dans data (copie iCloud, compte : règle
// Apple 5.1.3) ni envoyé à qui que ce soit : relu dans Santé, affiché sur l'iPhone seulement.
//
// Échantillon reçu du module natif (HealthPlugin.swift, sleep) :
//   { start, end (ms), stage: 'inBed' | 'asleep' | 'core' | 'deep' | 'rem' | 'awake' }
// asleep : « endormi » sans phase (iPhone, apps tierces) ; core, deep, rem : phases de l'Apple Watch.
// Plusieurs sources se recouvrent souvent (Apple Watch et une app de sommeil, ou la même nuit en phases
// et en « endormi ») : on prend l'UNION des intervalles, jamais la somme.

const SLEEP_ASLEEP = new Set(['asleep', 'core', 'deep', 'rem']);
const SLEEP_SHIFT_MS = 6 * 3_600_000;    // nuit du jour J : terminée entre J−1 18 h et J 18 h
const SLEEP_MIN_MS   = 30 * 60_000;      // moins : sieste ou capteur, pas une nuit
const SLEEP_MAX_MS   = 16 * 3_600_000;   // plus : donnée aberrante (montre oubliée au lit)
const SLEEP_AVG_NIGHTS = 7;              // moyenne sur les 7 dernières nuits connues…
const SLEEP_AVG_MIN    = 3;              // …affichée à partir de 3

// Durée de l'union d'intervalles [début, fin]
function unionMs(intervals) {
  const list = intervals.filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s).sort((a, b) => a[0] - b[0]);
  let total = 0, cs = null, ce = null;
  list.forEach(([s, e]) => {
    if (ce === null || s > ce) { if (ce !== null) total += ce - cs; cs = s; ce = e; }
    else ce = Math.max(ce, e);
  });
  return ce === null ? total : total + (ce - cs);
}

// Nuit d'un échantillon : la date (locale) du réveil, décalée de 6 h (18 h → minuit du lendemain)
function sleepNightKey(end) { return localISO(end + SLEEP_SHIFT_MS); }

// Nuits par date de réveil : { 'AAAA-MM-JJ': { ms, inBedOnly } }. Sans aucun échantillon « endormi » pour
// une nuit (horaires de sommeil de l'iPhone seul), le temps au lit est retenu et signalé (inBedOnly).
function sleepNights(samples) {
  const by = new Map();
  (Array.isArray(samples) ? samples : []).forEach(x => {
    if (!x || !Number.isFinite(x.start) || !Number.isFinite(x.end) || x.end <= x.start) return;
    const kind = SLEEP_ASLEEP.has(x.stage) ? 'asleep' : x.stage === 'inBed' ? 'inBed' : null;
    if (!kind) return;
    const k = sleepNightKey(x.end);
    if (!by.has(k)) by.set(k, { asleep: [], inBed: [] });
    by.get(k)[kind].push([x.start, x.end]);
  });
  const out = {};
  by.forEach((v, k) => {
    const asleep = unionMs(v.asleep);
    const ms = asleep || unionMs(v.inBed);
    if (ms >= SLEEP_MIN_MS && ms <= SLEEP_MAX_MS) out[k] = { ms, inBedOnly: !asleep };
  });
  return out;
}

// Ligne de l'accueil : la nuit qui se termine aujourd'hui, et la moyenne des 7 dernières nuits connues
// (aujourd'hui compris) dès qu'il y en a 3. null sans nuit aujourd'hui (rien n'est affiché : une vieille
// nuit ne dit rien de la récupération du jour).
//   → { ms, inBedOnly, avgMs | null, nights }
function sleepSummary(samples, now = Date.now()) {
  const nights = sleepNights(samples);
  const today = nights[localISO(now)];
  if (!today) return null;
  const keys = Object.keys(nights).filter(k => k <= localISO(now)).sort().reverse().slice(0, SLEEP_AVG_NIGHTS);
  const avgMs = keys.length >= SLEEP_AVG_MIN ? Math.round(keys.reduce((a, k) => a + nights[k].ms, 0) / keys.length) : null;
  return { ms: today.ms, inBedOnly: today.inBedOnly, avgMs, nights: keys.length };
}

// Texte : « Cette nuit : 7 h 12 de sommeil · moyenne 6 h 58 sur 7 nuits » (« au lit » sans phases)
function sleepLine(sum) {
  if (!sum) return '';
  const what = sum.inBedOnly ? 'au lit' : 'de sommeil';
  const avg = sum.avgMs ? ` · moyenne ${fmtDuration(sum.avgMs)} sur ${sum.nights} nuits` : '';
  return `Cette nuit : ${fmtDuration(sum.ms)} ${what}${avg}`;
}
