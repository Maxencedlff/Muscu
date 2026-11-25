// ═══════════════════════════════════════════════════════════
//  Pas, sommeil et cardio de Santé, un résumé par jour (docs/SANTE_COACH.md)
//  Deux usages, tous deux sur l'iPhone de l'élève :
//   - partage avec son coach, s'il coche « Pas, sommeil et cardio » (js/data/coach-share.js, kind 'health') ;
//   - préremplissage des bilans (js/data/checkin-student.js, checkinReadHealth).
//  Logique pure (healthDaysBuild, healthPeriodSummary) et lecture par le module natif (healthDaysRead).
// ═══════════════════════════════════════════════════════════
'use strict';

// Règles :
//  - Rien n'est jamais écrit dans data (copie iCloud et compte : règle Apple 5.1.3(ii)) : la lecture reste en
//    mémoire ; seul le résumé du jour part, vers le coach, avec l'accord (student_share_health_days).
//  - Un jour = trois nombres : pas (total du jour), sommeil (minutes endormi de la nuit qui se termine ce jour-là,
//    phases « endormi » d'iOS 16 et plus : asleepUnspecified, core, deep, rem ; jamais le temps « au lit » seul) et
//    cardio (minutes d'entraînements cardio du jour, union des intervalles : la même sortie enregistrée par l'Apple
//    Watch et par Strava compte une fois). Jamais l'heure, le lieu, la source ni la fréquence cardiaque.
//  - iOS ne dit pas si la lecture est refusée : tout vide = rien à envoyer, jamais des zéros inventés. Le cardio
//    vaut 0 un jour qui a des pas ou une nuit seulement si au moins un entraînement a été lu sur la fenêtre (sinon
//    la lecture des entraînements est sans doute refusée : null).

const HEALTH_DAYS_MAX = 90;               // jours gardés par le serveur (90 glissants)
const HEALTH_DAYS_READ = 92;              // jours lus (marge du fuseau) ; le serveur écarte le reste
const HEALTH_DAYS_TTL = 10 * 60_000;      // relecture de Santé au plus toutes les 10 minutes
const HEALTH_DAYS_FAIL_TTL = 60_000;      // après un échec : nouvel essai une minute plus tard
const HEALTH_CARDIO_MIN_SEC = 60;         // en dessous : entraînement lancé par erreur
const HEALTH_STEPS_MAX = 100000;
const HEALTH_MIN_MAX = 1440;

// État en mémoire seulement : { supported: null | bool, list: [jour] | null, at, failedAt, reading }
const healthDays = { supported: null, probing: null, list: null, at: 0, failedAt: 0, reading: null };

// ── Logique pure ────────────────────────────────────────────

// Jour local d'un instant (ms) ; décalage de n jours
const healthDayKey = ms => localISO(ms);
function healthDayShift(day, n) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localISO(d.getTime());
}

// Minutes de cardio par jour : intervalles actifs [fin − durée, fin] des entraînements valides, unis par jour (jour
// de la fin). → { 'AAAA-MM-JJ': minutes }
function healthCardioByDay(workouts) {
  const by = new Map();
  (Array.isArray(workouts) ? workouts : []).forEach(w => {
    const end = Number(w?.end), start = Number(w?.start), sec = Number(w?.duration);
    if (!Number.isFinite(end) || !Number.isFinite(start) || end <= start) return;
    const active = Number.isFinite(sec) && sec > 0 ? Math.min(end - start, sec * 1000) : end - start;
    if (active < HEALTH_CARDIO_MIN_SEC * 1000) return;
    const k = healthDayKey(end);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push([end - active, end]);
  });
  const out = {};
  by.forEach((list, k) => { out[k] = Math.min(HEALTH_MIN_MAX, Math.round(unionMs(list) / 60_000)); });
  return out;
}

// Ce que rend le module natif → un résumé par jour, du plus récent au plus ancien, sur les `days` derniers jours
// (aujourd'hui compris). raw : { steps: [{ day, steps }], workouts: [...], sleep: [échantillons] }.
// → [{ day, steps?, sleep?, cardio? }] (clés absentes plutôt que null : c'est ce qui part au serveur)
function healthDaysBuild(raw, { days = HEALTH_DAYS_MAX, now = Date.now() } = {}) {
  const today = healthDayKey(now), first = healthDayShift(today, -(days - 1));
  const inWindow = k => typeof k === 'string' && /^\d{4}-\d\d-\d\d$/.test(k) && k >= first && k <= today;
  const steps = {};
  (Array.isArray(raw?.steps) ? raw.steps : []).forEach(x => {
    const n = Math.round(Number(x?.steps));
    if (inWindow(x?.day) && Number.isFinite(n) && n > 0) steps[x.day] = Math.min(HEALTH_STEPS_MAX, (steps[x.day] || 0) + n);
  });
  const sleep = {};
  Object.entries(sleepNights(raw?.sleep)).forEach(([k, v]) => {
    if (inWindow(k) && !v.inBedOnly) sleep[k] = Math.min(HEALTH_MIN_MAX, Math.round(v.ms / 60_000));
  });
  const workouts = Array.isArray(raw?.workouts) ? raw.workouts : [];
  const cardio = healthCardioByDay(workouts);
  const anyWorkout = workouts.length > 0;
  const keys = new Set([...Object.keys(steps), ...Object.keys(sleep), ...Object.keys(cardio).filter(inWindow)]);
  return [...keys].sort().reverse().map(day => {
    const out = { day };
    if (steps[day] !== undefined) out.steps = steps[day];
    if (sleep[day] !== undefined) out.sleep = sleep[day];
    if (cardio[day] !== undefined) out.cardio = cardio[day];
    else if (anyWorkout) out.cardio = 0;
    return out;
  }).filter(d => d.steps !== undefined || d.sleep !== undefined || d.cardio > 0);
}

// Sur une période (jours 'AAAA-MM-JJ') : moyenne des pas par jour (jours qui en ont), heures endormi par nuit
// (nuits qui en ont, au centième : « 7,27 » s'accorde avec « 7 h 16 » de l'aide, audit m1), minutes de cardio de la période (somme ; null si aucun jour n'a de cardio lu).
// → { steps, sleepH, sleepMin, cardioMin, stepDays, nights } (null pour chaque mesure absente)
function healthPeriodSummary(list, keys) {
  const set = new Set(keys || []);
  const days = (list || []).filter(d => set.has(d.day));
  const st = days.filter(d => Number.isFinite(d.steps)), sl = days.filter(d => Number.isFinite(d.sleep)), ca = days.filter(d => Number.isFinite(d.cardio));
  const avg = l => l.reduce((a, b) => a + b, 0) / l.length;
  const sleepMin = sl.length ? Math.round(avg(sl.map(d => d.sleep))) : null;
  return {
    steps: st.length ? Math.round(avg(st.map(d => d.steps))) : null,
    sleepMin, sleepH: sleepMin === null ? null : Math.round(sleepMin / 0.6) / 100,
    cardioMin: ca.length ? ca.reduce((a, d) => a + d.cardio, 0) : null,
    stepDays: st.length, nights: sl.length,
  };
}

// ── Lecture (module natif) ──────────────────────────────────

// La coquille sait-elle lire les pas et le cardio ? null tant que ce n'est pas su : la première question lance la
// vérification (rien n'est montré à l'élève), et l'écran du partage se redessine quand la réponse arrive.
function healthDaysSupported() {
  if (healthDays.supported === null) healthDaysProbe();
  return healthDays.supported === true;
}
function healthDaysProbe() {
  if (healthDays.supported !== null) return Promise.resolve(healthDays.supported);
  const fn = typeof Native === 'object' ? Native.health?.daysSupported : null;
  if (typeof fn !== 'function') { healthDays.supported = false; return Promise.resolve(false); }
  return (healthDays.probing ||= fn.call(Native.health).then(ok => {
    healthDays.supported = ok === true;
    healthDays.probing = null;
    if (healthDays.supported && typeof notifyCoach === 'function') notifyCoach();
    return healthDays.supported;
  }, () => { healthDays.supported = false; healthDays.probing = null; return false; }));
}

// Relit les 92 derniers jours dans Santé (au plus toutes les 10 minutes, sauf force) → la liste, ou null si la
// lecture a échoué (la liste d'avant est gardée en mémoire). Jamais gardée ailleurs qu'en mémoire.
async function healthDaysRead({ force = false, now = Date.now() } = {}) {
  if (!(await healthDaysProbe())) return null;
  if (!force && healthDays.list && now - healthDays.at < HEALTH_DAYS_TTL) return healthDays.list;
  if (!force && now - healthDays.failedAt < HEALTH_DAYS_FAIL_TTL) return healthDays.list;
  return (healthDays.reading ||= (async () => {
    try {
      const [act, sleep] = await Promise.all([Native.health.activityDays(HEALTH_DAYS_READ), Native.health.sleep(HEALTH_DAYS_READ)]);
      if (!act || !sleep) { healthDays.failedAt = Date.now(); return healthDays.list; }
      healthDays.list = healthDaysBuild({ ...act, sleep }, { days: HEALTH_DAYS_MAX });
      healthDays.at = Date.now();
      healthDays.failedAt = 0;
      return healthDays.list;
    } finally { healthDays.reading = null; }
  })());
}

// Changement de compte : rien de l'élève d'avant ne reste en mémoire
function healthDaysReset() { Object.assign(healthDays, { list: null, at: 0, failedAt: 0 }); }
