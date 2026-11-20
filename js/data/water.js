// ═══════════════════════════════════════════════════════════
//  Eau (docs/EAU.md) : objectif en litres, verres notés d'un toucher, journal par jour. Logique pure.
//
//  - Chargé avant store.js : sanitizeData appelle sanitizeWater (données bornées comme à la saisie).
//  - Objectif du jour, dans cet ordre : celui du plan de nutrition (targets.water, en litres, fixé par le coach),
//    sinon celui choisi à la main (data.waterGoalL, pas de 0,25 L), sinon le repère calculé (waterAutoGoal) :
//    boissons de l'EFSA (2010) selon le sexe, + 0,5 L un jour d'entraînement (ACSM 2007 : 0,5 à 2 L de sueur par heure).
//  - data.waterLog : ce qui a été bu, jour par jour ({ 'AAAA-MM-JJ': [{ id, ml, at }] }), 120 jours. Sur l'appareil
//    seulement, comme le journal des repas (SYNC_LOCAL_ONLY, hors de la copie iCloud : règle 5.1.3(ii) d'Apple).
//  - Réglages de l'appareil : waterOn (suivi activé), waterGoalL (objectif choisi), waterCups (contenants perso),
//    waterTrainOff (+0,5 L les jours de séance coupé ; absent : allumé, sur le repère et sur l'objectif choisi).
//  - Aucune finalité médicale : des repères, jamais d'alerte ni de rouge.
// ═══════════════════════════════════════════════════════════
'use strict';

const WATER_LOG_DAYS   = 120;     // jours gardés, comme le journal des repas (DIET_LOG_DAYS)
const WATER_DAY_MAX    = 60;      // ajouts par jour
const WATER_ML_MIN     = 10;      // un ajout : de 1 cl…
const WATER_ML_MAX     = 3000;    // … à 3 L
const WATER_STEP_L     = 0.25;    // pas de l'objectif choisi à la main
const WATER_GOAL_MIN_L = 0.5;
const WATER_GOAL_MAX_L = 6;
const WATER_CUPS_MAX   = 4;       // contenants perso
const WATER_CUP_NAME_MAX = 24;
const WATER_ID_RE      = /^[a-z0-9]{1,12}$/;
// Repères de l'EFSA (Scientific Opinion on Dietary Reference Values for water, EFSA Journal 2010;8(3):1459) : apport
// adéquat de 2,5 L par jour pour un homme et 2,0 L pour une femme, eau des aliments comprise, qui en apporte environ
// 20 % (« drinking water and beverages (80%) plus water contained in food (20%) », section 3.1). Boissons : 80 %.
// Sexe non renseigné : le milieu des deux. Valeurs pour une activité modérée et un climat tempéré (PAL 1,6)
const WATER_EFSA_TOTAL_L = { male: 2.5, female: 2.0 };
const WATER_DRINK_SHARE  = 0.8;
// Jour d'entraînement : ACSM, Exercise and Fluid Replacement (Med Sci Sports Exerc 2007;39(2):377-90) : 0,5 à 2,0 L de
// sueur par heure d'effort. Une séance d'environ une heure, bas de la fourchette : + 0,5 L
const WATER_TRAIN_L = 0.5;
// Contenants proposés d'office (boutons rapides)
const WATER_CUPS_BASE = [
  { id: 'verre', name: 'Verre', ml: 250 },
  { id: 'bouteille', name: 'Bouteille', ml: 500 },
  { id: 'litre', name: '1 L', ml: 1000 },
];

const waterIsObj = o => !!o && typeof o === 'object' && !Array.isArray(o);

// ── Nettoyage ───────────────────────────────────────────────

// Un ajout : { id, ml, at } (ml entier de 10 à 3 000, at : heure de l'ajout)
function cleanWaterEntry(e) {
  if (!waterIsObj(e)) return null;
  const ml = num(e.ml, WATER_ML_MIN, WATER_ML_MAX);
  if (ml === null) return null;
  return { id: typeof e.id === 'string' && WATER_ID_RE.test(e.id) ? e.id : uid(), ml: Math.round(ml), at: Number.isFinite(e.at) && e.at > 0 ? Math.round(e.at) : 0 };
}
// Journal : 120 jours au plus (2 jours d'avance tolérés : fuseau, horloge), jours vides oubliés
function cleanWaterLog(v, now = Date.now()) {
  if (!waterIsObj(v)) return {};
  const oldest = localISO(now - WATER_LOG_DAYS * 86400000), newest = localISO(now + 2 * 86400000);
  const out = {};
  for (const [day, list] of Object.entries(v)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < oldest || day > newest || !Array.isArray(list)) continue;
    const ids = new Set();
    const items = list.slice(0, WATER_DAY_MAX).map(cleanWaterEntry).filter(Boolean)
      .map(x => { while (ids.has(x.id)) x.id = uid(); ids.add(x.id); return x; });
    if (items.length) out[day] = items;
  }
  return out;
}
// Objectif en litres, au pas de 0,05 L (2,35 L venu d'un coach reste 2,35), null hors bornes
function cleanWaterLitres(v) {
  const l = num(v, WATER_GOAL_MIN_L, WATER_GOAL_MAX_L);
  return l === null ? null : Math.round(l * 20) / 20;
}
// Contenants perso : nom (24 caractères), 50 ml à 3 L, 4 au plus, noms uniques (sans casse ni accents)
function cleanWaterCups(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(WATER_CUPS_BASE.map(c => waterNameKey(c.name)));
  const out = [];
  for (const c of list) {
    if (!waterIsObj(c) || out.length >= WATER_CUPS_MAX) continue;
    const name = typeof c.name === 'string' ? c.name.replace(/\s+/g, ' ').trim().slice(0, WATER_CUP_NAME_MAX).trim() : '';
    const ml = num(c.ml, 50, WATER_ML_MAX);
    if (!name || ml === null || seen.has(waterNameKey(name))) continue;
    seen.add(waterNameKey(name));
    out.push({ id: typeof c.id === 'string' && WATER_ID_RE.test(c.id) && !WATER_CUPS_BASE.some(b => b.id === c.id) ? c.id : uid(), name, ml: Math.round(ml) });
  }
  return out;
}
function waterNameKey(n) { return String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// Appelé par sanitizeData : clés retirées quand il n'en reste rien de valable
function sanitizeWater(d, now = Date.now()) {
  if (d.waterOn !== undefined && d.waterOn !== true) delete d.waterOn;
  if (d.waterTrainOff !== undefined && d.waterTrainOff !== true) delete d.waterTrainOff;   // bonus de séance coupé (absent : allumé)
  if (d.waterGoalL !== undefined) { const l = cleanWaterLitres(d.waterGoalL); if (l === null) delete d.waterGoalL; else d.waterGoalL = l; }
  if (d.waterCups !== undefined) { d.waterCups = cleanWaterCups(d.waterCups); if (!d.waterCups.length) delete d.waterCups; }
  if (d.waterLog !== undefined) { d.waterLog = cleanWaterLog(d.waterLog, now); if (!Object.keys(d.waterLog).length) delete d.waterLog; }
  return d;
}

// ── Objectif ────────────────────────────────────────────────

// Repère calculé : boissons de l'EFSA selon le sexe (homme 2,0 L, femme 1,6 L, non précisé 1,8 L), + 0,5 L un jour
// d'entraînement. { l, base, plus }
function waterAutoGoal({ sex = null, training = false } = {}) {
  const total = sex === 'male' || sex === 'female' ? WATER_EFSA_TOTAL_L[sex] : (WATER_EFSA_TOTAL_L.male + WATER_EFSA_TOTAL_L.female) / 2;
  const base = Math.round(total * WATER_DRINK_SHARE * 100) / 100;
  const plus = training ? WATER_TRAIN_L : 0;
  return { l: Math.round((base + plus) * 100) / 100, base, plus };
}
// Séance ce jour-là : une séance enregistrée à cette date, ou (aujourd'hui) une séance en cours
function waterTrainingDay(d, day, { live = false } = {}) {
  if (live && day === localISO()) return true;
  return (Array.isArray(d.history) ? d.history : []).some(h => Number.isFinite(h?.date) && localISO(h.date) === day);
}
// Objectif du jour : { l, src, base, plus, coach } ; src : 'plan' (plan de nutrition, coach compris), 'me' (choisi
// à la main) ou 'auto' (repère calculé). plan : le plan de nutrition suivi (ou null)
// Bonus d'un jour de séance (« +0,5 L les jours de séance », allumé par défaut, vote du 17/11 : option C) : sur le repère
// comme sur l'objectif choisi (3 L choisis = 3,5 L un jour de séance), jamais sur celui du coach (il décide)
function waterTrainBonusOn(d) { return d?.waterTrainOff !== true; }
// Fourchette du plan (18/11, « entre 3 et 5 L en sèche ») : l = le haut, min = le bas ; atteint dès le bas
function waterGoalFor(d, { plan = null, sex = null, training = false } = {}) {
  const fromPlan = cleanWaterLitres(plan?.targets?.water);
  if (fromPlan !== null) {
    const min = cleanWaterLitres(plan.targets.waterMin);
    return { l: fromPlan, src: 'plan', base: fromPlan, plus: 0, coach: plan.fromCoach?.name || (plan.fromCoach ? '' : null), ...(min !== null && min < fromPlan ? { min } : {}) };
  }
  const bonus = training && waterTrainBonusOn(d);
  const own = cleanWaterLitres(d.waterGoalL);
  if (own !== null) { const plus = bonus ? WATER_TRAIN_L : 0; return { l: Math.round((own + plus) * 100) / 100, src: 'me', base: own, plus, coach: null }; }
  return { ...waterAutoGoal({ sex, training: bonus }), src: 'auto', coach: null };
}
// Litres qui suffisent à l'objectif : le bas de la fourchette, sinon l'objectif
function waterGoalLow(g) { return g.min ?? g.l; }
// « 3 à 5 L » ou « 2,5 L »
function waterGoalText(g) { return g.min != null ? `${fmtNum(g.min, 2)} à ${fmtNum(g.l, 2)}\u00a0L` : `${fmtNum(g.l, 2)}\u00a0L`; }
function waterGoalSpoken(g) { return g.min != null ? `entre ${fmtNum(g.min, 2)} et ${fmtNum(g.l, 2)} litres` : `${fmtNum(g.l, 2)} litres`; }
// Verres à cocher : contenant de 1 L si la fourchette est large (1 L ou plus entre le bas et le haut), sinon le verre de
// 25 cl ; jamais plus de 16 verres (au-delà, 50 cl puis 1 L). { ml, n } : n verres pour atteindre le haut
const WATER_GLASSES_MAX = 16;
function waterGlassPlan(g) {
  let ml = g.min != null && g.l - g.min >= 1 ? 1000 : 250;
  while (Math.ceil(g.l * 1000 / ml) > WATER_GLASSES_MAX && ml < 1000) ml *= 2;
  return { ml, n: Math.max(1, Math.ceil(Math.round(g.l * 1000) / ml)) };
}
// Pas de 0,25 L : depuis 2,3 L, « + » donne 2,5 et « − » 2,25 (la grille de 0,25), bornés de 0,5 à 6 L
function waterStepGoal(l, dir) {
  const k = l / WATER_STEP_L;
  const next = dir > 0 ? (Math.floor(k + 1e-9) + 1) * WATER_STEP_L : (Math.ceil(k - 1e-9) - 1) * WATER_STEP_L;
  return Math.min(WATER_GOAL_MAX_L, Math.max(WATER_GOAL_MIN_L, Math.round(next * 100) / 100));
}

// ── Journée ─────────────────────────────────────────────────

function waterDay(d, day) { return Array.isArray(d.waterLog?.[day]) ? d.waterLog[day] : []; }
function waterDayMl(d, day) { return waterDay(d, day).reduce((s, x) => s + (Number(x?.ml) || 0), 0); }
// Ajoute ml au jour ; renvoie l'ajout (pour Annuler), null si refusé (quantité hors bornes, jour plein)
function waterAdd(d, ml, day = localISO(), now = Date.now()) {
  dietShareGesture();   // suivi de la diète partagé : envoi 5 s après le dernier geste (js/data/diet-share.js)
  const e = cleanWaterEntry({ ml, at: now });
  if (!e || waterDay(d, day).length >= WATER_DAY_MAX) return null;
  if (!waterIsObj(d.waterLog)) d.waterLog = {};
  d.waterLog[day] = [...waterDay(d, day), e];
  // Journal borné à l'écriture aussi (un iPhone jamais relancé garde 120 jours)
  d.waterLog = cleanWaterLog(d.waterLog, now);
  return e;
}
// Retire un ajout (Annuler, ou depuis la liste du jour) ; true s'il existait
function waterRemove(d, day, id) {
  dietShareGesture();   // suivi de la diète partagé : envoi 5 s après le dernier geste (js/data/diet-share.js)
  const list = waterDay(d, day);
  if (!list.some(x => x.id === id)) return false;
  const rest = list.filter(x => x.id !== id);
  if (rest.length) d.waterLog[day] = rest; else delete d.waterLog[day];
  if (d.waterLog && !Object.keys(d.waterLog).length) delete d.waterLog;
  return true;
}
// Contenants des boutons rapides : ceux d'office puis les perso
function waterCups(d) { return [...WATER_CUPS_BASE, ...cleanWaterCups(d.waterCups)]; }
// Ajoute un contenant perso ; { ok, error? } (error : 'name', 'ml', 'taken', 'full')
function waterAddCup(d, name, ml) {
  const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  // Invisibles seuls (U+200B, U+FEFF) : pas un nom, comme des espaces seuls
  if (!n || !hasVisible(n) || n.length > WATER_CUP_NAME_MAX) return { ok: false, error: 'name' };
  if (num(ml, 50, WATER_ML_MAX) === null) return { ok: false, error: 'ml' };
  if (waterCups(d).some(c => waterNameKey(c.name) === waterNameKey(n))) return { ok: false, error: 'taken' };
  const mine = cleanWaterCups(d.waterCups);
  if (mine.length >= WATER_CUPS_MAX) return { ok: false, error: 'full' };
  d.waterCups = cleanWaterCups([...mine, { id: uid(), name: n, ml: Math.round(Number(ml)) }]);
  return { ok: true };
}
function waterRemoveCup(d, id) {
  const mine = cleanWaterCups(d.waterCups), i = mine.findIndex(c => c.id === id);
  if (i < 0) return null;
  const [cup] = mine.splice(i, 1);
  if (mine.length) d.waterCups = mine; else delete d.waterCups;
  return { cup, index: i };
}

// ── Textes ──────────────────────────────────────────────────

// Litres à la française : 1200 ml → « 1,2 », 2250 → « 2,25 », 2000 → « 2 »
function waterLitres(ml) { return fmtNum(Math.round(ml / 10) / 100, 2); }
// Quantité d'un contenant : « 25 cl », « 1 L », « 1,5 L », « 75 cl »
function waterQtyText(ml) { return ml >= 1000 ? `${waterLitres(ml)}\u00a0L` : `${fmtNum(ml / 10, 1)}\u00a0cl`; }
function waterQtySpoken(ml) { return ml >= 1000 ? `${waterLitres(ml)} litre${ml >= 2000 ? 's' : ''}` : `${fmtNum(ml / 10, 1)} centilitres`; }
// Quantité tapée : « 33 » ou « 33 cl » (cl), « 330 ml », « 0,5 l » ou « 1,5 L » (litres), « 0,5 » seul (5 ou moins
// avec une virgule : des litres). Renvoie des ml, null si illisible ou hors bornes
function waterParseQty(raw) {
  const s = String(raw ?? '').toLowerCase().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  const m = s.match(/^(\d+(?:\.\d+)?|\.\d+)(ml|cl|l)?$/);
  if (!m) return null;
  const v = Number(m[1]);
  const unit = m[2] || (v <= 5 ? 'l' : 'cl');
  const ml = Math.round(unit === 'ml' ? v : unit === 'cl' ? v * 10 : v * 1000);
  return ml >= WATER_ML_MIN && ml <= WATER_ML_MAX ? ml : null;
}
// Explication de l'objectif en une phrase (feuille de l'objectif)
// bonus : réglage « +0,5 L les jours de séance » allumé (la règle est dite, séance ou non ce jour-là)
function waterGoalWhy(g, { sex = null, bonus = true } = {}) {
  if (g.src === 'plan') return g.coach != null ? `Fixé par ${g.coach || 'ton coach'} dans ton plan de nutrition.` : 'Fixé dans ton plan de nutrition.';
  const plus = bonus ? ', plus 0,5 L les jours de séance' : '';
  if (g.src === 'me') return `Choisi par toi${plus}.`;
  const who = sex === 'male' ? '2 L de boissons par jour pour un homme' : sex === 'female' ? '1,6 L de boissons par jour pour une femme'
    : '1,8 L de boissons par jour, entre les repères homme (2 L) et femme (1,6 L)';
  return `Repère de l'EFSA : ${who}${plus}.`;
}

// ── Santé (HealthKit) : préparé, pas branché ────────────────
// Échantillon « Eau » (HKQuantityTypeIdentifier.dietaryWater, en millilitres) d'un ajout, pour le module natif quand il
// saura l'écrire (docs/EAU.md, « Santé ») : un échantillon par ajout, daté de l'ajout, identifiant de synchro stable
// (mdlf:eau:<id>) pour qu'un nouvel envoi remplace au lieu de doubler, et qu'Annuler le retire
function waterHealthSample(e) {
  const c = cleanWaterEntry(e);
  if (!c || !c.at) return null;
  return { type: 'dietaryWater', unit: 'mL', value: c.ml, start: c.at, end: c.at, syncId: `mdlf:eau:${c.id}` };
}
