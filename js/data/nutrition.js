// ═══════════════════════════════════════════════════════════
//  Nutrition (Nutrition V1, contrat docs/NUTRITION_V1.md) : plan diète, repas cochés, macros. Logique pure.
//
//  - Chargé avant store.js : sanitizeData appelle sanitizeDiet (données bornées comme à la saisie).
//  - Un plan est autonome : chaque aliment garde ses valeurs pour 100 g (per), relevées dans la base
//    Ciqual au moment du choix (js/data/food-swap.js) ou saisies par la personne (aliment perso). Un plan
//    reçu d'un coach s'affiche donc sans la base, et une nouvelle version de Ciqual ne le change pas.
//  - data.dietPlans (fusion par union comme les programmes ; un plan supprimé est archivé, jamais effacé),
//    data.dietActive (plan suivi), data.dietFoods (mes aliments perso) : copiés sur le compte SEULEMENT avec
//    l'accord de la personne (data.dietConsent = { on, at }, donnée de santé au sens de la CNIL : article 9 du
//    RGPD), sinon sur l'iPhone seulement (profilePayload, js/data/sync.js). Retirer l'accord les efface du serveur.
//  - data.dietLog (repas cochés et remplacements du jour) : sur l'appareil seulement (SYNC_LOCAL_ONLY).
//  - Réglages de l'appareil : dietHideNumbers (masquer calories et grammes de macros), dietStreakOff (série
//    masquée), dietConsentAsked (la question de l'accord a été posée).
//  - Aucun calcul de besoins : les objectifs viennent du coach ou de la personne ; sans objectif, le
//    total du plan sert de repère.
// ═══════════════════════════════════════════════════════════
'use strict';

const DIET_PLAN_MAX   = 20;      // plans vivants qu'on peut créer (création refusée au-delà, avec un message)
const DIET_PLAN_MAX_COACH = 100; // pour un coach, qui prépare les plans de ses élèves
const DIET_ARCHIVED_MAX = 50;    // plans supprimés gardés (archivés), à part : les plus anciens partent
const DIET_MEAL_MAX   = 8;       // repas par plan
const DIET_ITEM_MAX   = 25;      // aliments par repas
const DIET_NAME_MAX   = 40;      // nom d'un plan ou d'un repas
const DIET_FOOD_NAME_MAX = 80;   // nom d'un aliment (les noms Ciqual vont jusqu'à 140 : coupés au mot)
const DIET_NOTE_MAX   = 300;     // consigne d'un repas (coach)
const DIET_G_MAX      = 2000;    // quantité d'un aliment, en grammes
const DIET_LOG_DAYS   = 120;     // jours de cochage gardés sur l'appareil
const DIET_FOODS_MAX  = 200;     // aliments perso
const DIET_ID_RE      = /^d[A-Za-z0-9_-]{1,44}$/;   // d_xxxxxxxx (créé ici), dc_<coach>_<envoi> (reçu)
const DIET_PART_RE    = /^(?!(?:__proto__|constructor|prototype|toString|valueOf|hasOwnProperty)$)[A-Za-z0-9_-]{1,24}$/;   // repas ou aliment du plan (jamais un nom d'Object)
const DIET_DAY_RE     = /^\d{4}-\d{2}-\d{2}$/;
const DIET_FAMS       = ['v', 'f', 'l', 'g', 'r', 'e', 's', 'b', 'p', 'a'];   // familles (scripts/prepare-foods.py)
const DIET_TARGET_KEYS = ['kcal', 'p', 'c', 'f'];
const DIET_TARGET_MAX = { kcal: 10000, p: 600, c: 1500, f: 600 };
// Repas d'un plan neuf : les noms seuls, la personne les remplit
const DIET_DEFAULT_MEALS = ['Petit-déjeuner', 'Déjeuner', 'Collation', 'Dîner'];
// Repère de santé (NICE NG246, 2025) : sous 1 200 kcal par jour, un régime relève d'un suivi médical.
// L'app le dit sans rien bloquer (dietLowKcal)
const DIET_LOW_KCAL = 1200;
const DIET_SRC = ['ciqual-2025', 'perso'];   // origine des valeurs d'un aliment du plan

const dietIsObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const dietR1 = v => Math.round(v * 10) / 10;
const dietText = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max).trim();
// Nom long coupé au dernier mot entier (« Pâtes sèches, standard, cuites, sans sel ajouté » tient)
function dietCutName(v, max = DIET_FOOD_NAME_MAX) {
  const t = dietText(String(v ?? ''), 400);
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1).replace(/[\s,;(]+\S*$/, '');
  return (cut.length >= max / 2 ? cut : t.slice(0, max)).replace(/[\s,;]+$/, '');
}

// ── Nettoyage (sanitizeData, réception d'un plan de coach) ──

// Valeurs pour 100 g : kcal 0 à 900, macros 0 à 100 g et 101 g au plus à elles trois (arrondis de Ciqual)
function cleanDietPer(per) {
  if (!dietIsObj(per)) return null;
  const k = num(per.k, 0, 900), p = num(per.p, 0, 100), c = num(per.c, 0, 100), f = num(per.f, 0, 100);
  if ([k, p, c, f].includes(null) || p + c + f > 101) return null;
  return { k: Math.round(k), p: dietR1(p), c: dietR1(c), f: dietR1(f) };
}
// Famille d'équivalence d'un aliment perso, tirée de ses macros (part de l'énergie) : protéines d'abord
function dietFamOf(per) {
  const e = 4 * per.p + 4 * per.c + 9 * per.f;
  if (!(e > 0)) return 'a';
  if (4 * per.p / e >= 0.5) return 'v';
  if (9 * per.f / e >= 0.6) return 'g';
  if (4 * per.c / e >= 0.5) return 'f';
  return 'p';
}
// Aliment du plan : { id, name, food (code Ciqual) | null, fam, g, per }, null s'il est inutilisable
function cleanDietItem(it) {
  if (!dietIsObj(it)) return null;
  const name = dietCutName(it.name), per = cleanDietPer(it.per), g = num(it.g, 1, DIET_G_MAX);
  if (!name || !per || g === null) return null;
  const food = Number.isInteger(it.food) && it.food > 0 && it.food < 1e7 ? it.food : null;
  // src : valeurs de Ciqual 2025 ou saisies (aliment perso) ; ecalc : énergie calculée par l'app (Ciqual sans énergie)
  const src = DIET_SRC.includes(it.src) ? it.src : food ? 'ciqual-2025' : 'perso';
  return { id: typeof it.id === 'string' && DIET_PART_RE.test(it.id) ? it.id : uid(), name, food,
    fam: DIET_FAMS.includes(it.fam) ? it.fam : dietFamOf(per), g: Math.round(g), per, src, ...(it.ecalc === true ? { ecalc: true } : {}) };
}
function cleanDietMeal(m) {
  if (!dietIsObj(m)) return null;
  const ids = new Set();
  const items = (Array.isArray(m.items) ? m.items : []).slice(0, DIET_ITEM_MAX).map(cleanDietItem).filter(Boolean)
    .map(it => { while (ids.has(it.id)) it.id = uid(); ids.add(it.id); return it; });
  const out = { id: typeof m.id === 'string' && DIET_PART_RE.test(m.id) ? m.id : uid(), name: dietText(m.name, DIET_NAME_MAX) || 'Repas', items };
  const note = dietText(m.note, DIET_NOTE_MAX);
  if (note) out.note = note;
  return out;
}
// Objectifs du jour fixés par la personne ou son coach : chaque valeur facultative, null si aucune
function cleanDietTargets(t) {
  if (!dietIsObj(t)) return null;
  const out = {};
  for (const k of DIET_TARGET_KEYS) {
    const v = num(t[k], 1, DIET_TARGET_MAX[k]);
    if (v !== null) out[k] = Math.round(v);
  }
  return Object.keys(out).length ? out : null;
}
// Plan : { name, meals, targets?, consigne?, archived?, fromCoach? }, null s'il est inutilisable
function cleanDietPlan(p) {
  if (!dietIsObj(p)) return null;
  const ids = new Set();
  const meals = (Array.isArray(p.meals) ? p.meals : []).slice(0, DIET_MEAL_MAX).map(cleanDietMeal).filter(Boolean)
    .map(m => { while (ids.has(m.id)) m.id = uid(); ids.add(m.id); return m; });
  const out = { name: dietText(p.name, DIET_NAME_MAX) || 'Plan diète', meals };
  const targets = cleanDietTargets(p.targets);
  if (targets) out.targets = targets;
  const consigne = cleanConsigne(p.consigne);   // store.js (résolu à l'appel)
  if (consigne) out.consigne = consigne;
  if (p.archived === true) out.archived = true;
  if (Number.isFinite(p.updatedAt) && p.updatedAt > 0) out.updatedAt = p.updatedAt;
  const fc = p.fromCoach;
  if (dietIsObj(fc) && typeof fc.coachId === 'string' && fc.coachId && fc.coachId.length <= 64) {
    out.fromCoach = { coachId: fc.coachId, name: typeof fc.name === 'string' && /^[a-z0-9._]{3,20}$/.test(fc.name) ? fc.name : null,
      sentAt: Number.isFinite(fc.sentAt) && fc.sentAt >= 0 ? fc.sentAt : 0 };
  }
  return out;
}
function cleanDietPlans(v) {
  if (!dietIsObj(v)) return {};
  const out = {};
  // Plafonds séparés : vivants (jamais retirés en silence : la création est refusée avant, DIET_PLAN_MAX),
  // archivés (les plus anciens partent). Le plafond des vivants est celui d'un coach : jamais atteint ici
  const keys = Object.keys(v).filter(k => DIET_ID_RE.test(k) && dietIsObj(v[k]));
  const alive = keys.filter(k => v[k].archived !== true).slice(0, DIET_PLAN_MAX_COACH);
  const archived = keys.filter(k => v[k].archived === true)
    .sort((a, b) => (Number(v[b].updatedAt) || 0) - (Number(v[a].updatedAt) || 0)).slice(0, DIET_ARCHIVED_MAX);
  for (const k of [...alive, ...archived]) { const p = cleanDietPlan(v[k]); if (p) out[k] = p; }
  return out;
}
// Mes aliments perso : [{ id, name, fam, per }] (pour les retrouver dans la recherche)
function cleanDietFoods(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.slice(0, DIET_FOODS_MAX).map(x => {
    if (!dietIsObj(x)) return null;
    const name = dietCutName(x.name), per = cleanDietPer(x.per);
    if (!name || !per || seen.has(normName(name))) return null;
    seen.add(normName(name));
    return { id: typeof x.id === 'string' && DIET_PART_RE.test(x.id) ? x.id : uid(), name, fam: DIET_FAMS.includes(x.fam) ? x.fam : dietFamOf(per), per };
  }).filter(Boolean);
}
// Journal : { 'AAAA-MM-JJ': { plan, done: [id repas], swaps: { [id aliment]: aliment } } }, 120 jours au plus
function cleanDietLog(v, now = Date.now()) {
  if (!dietIsObj(v)) return {};
  const oldest = localISO(now - DIET_LOG_DAYS * 86400000), newest = localISO(now + 2 * 86400000);
  const out = {};
  for (const [day, e] of Object.entries(v)) {
    if (!DIET_DAY_RE.test(day) || day < oldest || day > newest || !dietIsObj(e) || !DIET_ID_RE.test(e.plan || '')) continue;
    const done = [...new Set((Array.isArray(e.done) ? e.done : []).filter(id => typeof id === 'string' && DIET_PART_RE.test(id)))].slice(0, DIET_MEAL_MAX);
    const swaps = {};
    if (dietIsObj(e.swaps)) {
      for (const [id, it] of Object.entries(e.swaps).slice(0, DIET_MEAL_MAX * DIET_ITEM_MAX)) {
        const c = DIET_PART_RE.test(id) ? cleanDietItem(it) : null;
        if (c) swaps[id] = { ...c, id };
      }
    }
    // Repas du plan ce jour-là (instantané) : un jour passé reste jugé avec le plan de ce jour
    const meals = Array.isArray(e.meals) ? [...new Set(e.meals.filter(id => typeof id === 'string' && DIET_PART_RE.test(id)))].slice(0, DIET_MEAL_MAX) : null;
    if (done.length || Object.keys(swaps).length) out[day] = { plan: e.plan, done, swaps, ...(meals ? { meals } : {}) };
  }
  return out;
}
// Appelé par sanitizeData : clés retirées quand il n'en reste rien de valable
function sanitizeDiet(d, now = Date.now()) {
  if (d.dietPlans !== undefined) { d.dietPlans = cleanDietPlans(d.dietPlans); if (!Object.keys(d.dietPlans).length) delete d.dietPlans; }
  const p = d.dietPlans?.[d.dietActive];
  if (d.dietActive !== undefined && (!p || p.archived)) delete d.dietActive;
  if (d.dietFoods !== undefined) { d.dietFoods = cleanDietFoods(d.dietFoods); if (!d.dietFoods.length) delete d.dietFoods; }
  if (d.dietLog !== undefined) { d.dietLog = cleanDietLog(d.dietLog, now); if (!Object.keys(d.dietLog).length) delete d.dietLog; }
  // Accord pour copier les plans sur le compte : { on, at (date ISO du choix) }, retiré s'il est illisible
  if (d.dietConsent !== undefined) {
    const c = d.dietConsent, ok = dietIsObj(c) && typeof c.on === 'boolean' && typeof c.at === 'string' && c.at.length <= 40 && Number.isFinite(Date.parse(c.at));
    if (ok) d.dietConsent = { on: c.on, at: c.at }; else delete d.dietConsent;
  }
  for (const k of ['dietConsentAsked', 'dietHideNumbers', 'dietStreakOff']) if (d[k] !== undefined && d[k] !== true) delete d[k];
  // Accord « recevoir les plans de mon coach » gardé sur l'appareil (serveur pas encore à jour) : même forme
  if (d.dietCoachConsent !== undefined) {
    const c = d.dietCoachConsent;
    if (dietIsObj(c) && typeof c.on === 'boolean' && typeof c.at === 'string' && c.at.length <= 40 && Number.isFinite(Date.parse(c.at))) d.dietCoachConsent = { on: c.on, at: c.at, ...(c.local === true ? { local: true } : {}) };
    else delete d.dietCoachConsent;
  }
  return d;
}
// Accord donné (plans copiés sur le compte et plans du coach reçus)
function dietConsentOn(d) { return d.dietConsent?.on === true; }
function dietSetConsent(d, on, now = new Date()) {
  d.dietConsent = { on: !!on, at: now.toISOString() };
  d.dietConsentAsked = true;
}
// Objectif ou total très bas (moins de 1 200 kcal, mais pas vide) : message de santé, jamais bloquant
function dietLowKcal(plan) {
  const k = plan ? dietGoal(plan).goal.kcal : 0;
  return k > 0 && k < DIET_LOW_KCAL;
}

// ── Macros ──────────────────────────────────────────────────

const DIET_ZERO = () => ({ kcal: 0, p: 0, c: 0, f: 0 });
// Apport d'un aliment à sa quantité (non arrondi : on arrondit à l'affichage)
function dietItemMacros(it) {
  const r = (it?.g || 0) / 100, per = it?.per || {};
  return { kcal: (per.k || 0) * r, p: (per.p || 0) * r, c: (per.c || 0) * r, f: (per.f || 0) * r };
}
function dietAdd(a, b) { return { kcal: a.kcal + b.kcal, p: a.p + b.p, c: a.c + b.c, f: a.f + b.f }; }
// Aliment tel qu'il sera mangé ce jour-là : le remplaçant choisi, sinon celui du plan
function dietEffectiveItem(it, swaps) { return swaps && Object.hasOwn(swaps, it.id) ? swaps[it.id] : it; }
function dietMealMacros(meal, swaps = null) {
  return (meal?.items || []).reduce((a, it) => dietAdd(a, dietItemMacros(dietEffectiveItem(it, swaps))), DIET_ZERO());
}
function dietPlanMacros(plan, swaps = null) { return (plan?.meals || []).reduce((a, m) => dietAdd(a, dietMealMacros(m, swaps)), DIET_ZERO()); }
// Repère du jour : objectif fixé, sinon total prévu par le plan. own : objectif fixé (true) ou total (false)
function dietGoal(plan) {
  const total = dietPlanMacros(plan), t = plan?.targets || {};
  const goal = {}, own = {};
  for (const k of DIET_TARGET_KEYS) { goal[k] = t[k] ?? Math.round(total[k]); own[k] = t[k] != null; }
  return { goal, own };
}

// ── Journée : repas cochés, remplacements ───────────────────

const dietDayKey = (ts = Date.now()) => localISO(ts);
// Entrée du journal de ce jour pour ce plan (vide si rien, ou si le jour a été coché avec un autre plan)
function dietDay(d, planId, day) {
  const e = d.dietLog?.[day];
  return e && e.plan === planId ? e : { plan: planId, done: [], swaps: {} };
}
function dietWriteDay(d, day, e) {
  const plan = d.dietPlans?.[e.plan];
  // Repas et aliments qui n'existent plus dans le plan : oubliés
  const meals = new Set((plan?.meals || []).map(m => m.id));
  const items = new Set((plan?.meals || []).flatMap(m => m.items.map(it => it.id)));
  const done = e.done.filter(id => meals.has(id));
  const swaps = Object.fromEntries(Object.entries(e.swaps || {}).filter(([id]) => items.has(id)));
  d.dietLog ||= {};
  const snapshot = (plan?.meals || []).filter(m => m.items.length).map(m => m.id);
  if (done.length || Object.keys(swaps).length) d.dietLog[day] = { plan: e.plan, done, swaps, meals: snapshot };
  else delete d.dietLog[day];
  if (!Object.keys(d.dietLog).length) delete d.dietLog;
}
// Coche ou décoche un repas ; renvoie le nouvel état (true : coché)
function dietToggleMeal(d, planId, mealId, day = dietDayKey()) {
  const e = dietDay(d, planId, day);
  const on = !e.done.includes(mealId);
  dietWriteDay(d, day, { ...e, done: on ? [...e.done, mealId] : e.done.filter(id => id !== mealId) });
  return on;
}
// Remplace un aliment du plan pour ce jour (newItem null : remet l'aliment prévu)
function dietSetSwap(d, planId, itemId, newItem, day = dietDayKey()) {
  const e = dietDay(d, planId, day);
  const swaps = { ...e.swaps };
  const c = newItem ? cleanDietItem({ ...newItem, id: itemId }) : null;
  if (c) swaps[itemId] = c; else delete swaps[itemId];
  dietWriteDay(d, day, { ...e, swaps });
  return !!c;
}
// Bilan d'une journée : mangé (repas cochés, remplacements compris), prévu, repère, repas.
// Un repas sans aliment (plan neuf, repas pas encore rempli) ne se coche pas : il ne compte ni dans
// « n repas cochés sur N » (nMeals), ni pour la journée complète, et n'est jamais proposé comme prochain repas.
// Repère sans objectif fixé : le total prévu ce jour-là, remplacements compris (un équivalent de 217 kcal
// pour 215 prévues ne fait pas « 217 sur 215 »)
function dietDayProgress(d, planId, day = dietDayKey()) {
  const plan = d.dietPlans?.[planId];
  if (!plan) return null;
  const e = dietDay(d, planId, day);
  const meals = plan.meals.map(m => ({ meal: m, macros: dietMealMacros(m, e.swaps), done: m.items.length > 0 && e.done.includes(m.id) }));
  const toEat = meals.filter(x => x.meal.items.length);
  const eaten = meals.filter(x => x.done).reduce((a, x) => dietAdd(a, x.macros), DIET_ZERO());
  const planned = meals.reduce((a, x) => dietAdd(a, x.macros), DIET_ZERO());
  const nDone = toEat.filter(x => x.done).length;
  const { goal, own } = dietGoal(plan);
  for (const k of DIET_TARGET_KEYS) if (!own[k]) goal[k] = Math.round(planned[k]);
  return { plan, day, swaps: e.swaps, meals, eaten, planned, goal, own, nDone, nMeals: toEat.length,
    complete: toEat.length > 0 && nDone === toEat.length, next: toEat.find(x => !x.done) || null };
}
// Jour complet : tous les repas du plan suivi ce jour-là cochés. planId : seulement si ce jour a été coché
// avec ce plan (aujourd'hui après un changement de plan : les coches de l'ancien ne comptent plus, comme à l'écran)
function dietDayComplete(d, day, planId = null) {
  const e = d.dietLog?.[day];
  if (!e || (planId && e.plan !== planId)) return false;
  // Instantané du jour (repas qui avaient des aliments) ; journal d'avant l'instantané : le plan actuel
  const ids = Array.isArray(e.meals) ? e.meals : (d.dietPlans?.[e.plan]?.meals || []).filter(m => m.items.length).map(m => m.id);
  return ids.length > 0 && ids.every(id => e.done.includes(id));
}
// Jours complets d'affilée jusqu'à aujourd'hui (aujourd'hui pas encore fini : la série court jusqu'à hier).
// Aujourd'hui est jugé avec le plan suivi ; les jours passés, avec le plan de ce jour-là
function dietStreak(d, now = Date.now()) {
  let n = 0;
  const day = i => { const t = new Date(now); t.setHours(12, 0, 0, 0); t.setDate(t.getDate() - i); return dietDayKey(t.getTime()); };
  let i = dietDayComplete(d, day(0), d.dietActive || null) ? 0 : 1;
  while (i <= DIET_LOG_DAYS && dietDayComplete(d, day(i))) { n++; i++; }
  return n;
}
// Les 7 derniers jours (le plus ancien d'abord) : { day, complete, some } pour la frise de l'écran.
// Aujourd'hui : coches du plan suivi seulement (celles d'un plan quitté dans la journée ne s'affichent plus)
function dietWeek(d, now = Date.now()) {
  return Array.from({ length: 7 }, (_, j) => {
    const t = new Date(now); t.setHours(12, 0, 0, 0); t.setDate(t.getDate() - (6 - j));
    const day = dietDayKey(t.getTime()), only = j === 6 ? d.dietActive || null : null;
    const e = d.dietLog?.[day], mine = !!e && (!only || e.plan === only);
    return { day, ts: t.getTime(), complete: dietDayComplete(d, day, only), some: mine && e.done.length > 0 };
  });
}

// ── Plans : création, suivi, suppression ────────────────────

function dietNewPlan(d, name = 'Mon plan') {
  let id;
  do { id = 'd_' + uid(); } while (d.dietPlans?.[id]);
  (d.dietPlans ||= {})[id] = { name: dietText(name, DIET_NAME_MAX) || 'Mon plan',
    meals: DIET_DEFAULT_MEALS.map(n => ({ id: uid(), name: n, items: [] })), updatedAt: Date.now() };
  return id;
}
// Création possible ? (plans vivants sous la limite : 20, ou 100 pour un coach)
function dietCanCreate(d, isCoach = false) { return dietPlanIds(d).length < (isCoach ? DIET_PLAN_MAX_COACH : DIET_PLAN_MAX); }
// Copie d'un plan (le mien ou celui d'un coach) : nouvel identifiant, jamais « reçu d'un coach », pas suivi
function dietDuplicatePlan(d, id) {
  const src = d.dietPlans?.[id];
  if (!src || src.archived) return null;
  const copy = cleanDietPlan(JSON.parse(JSON.stringify(src)));
  delete copy.fromCoach;
  let nid;
  do { nid = 'd_' + uid(); } while (d.dietPlans[nid]);
  copy.name = dietText(`${src.name} (copie)`, DIET_NAME_MAX);
  copy.updatedAt = Date.now();
  d.dietPlans[nid] = copy;
  return nid;
}
// Copie d'un repas dans le même plan, juste après lui (nouveaux identifiants)
function dietCopyMeal(plan, mealId) {
  const i = plan?.meals.findIndex(m => m.id === mealId) ?? -1;
  if (i < 0 || plan.meals.length >= DIET_MEAL_MAX) return null;
  const m = plan.meals[i];
  const copy = { ...m, id: uid(), name: dietText(`${m.name} (copie)`, DIET_NAME_MAX), items: m.items.map(it => ({ ...it, id: uid() })) };
  plan.meals.splice(i + 1, 0, copy);
  return copy.id;
}

// Plans listés (archivés exclus) : le plan suivi d'abord, puis les miens, puis ceux reçus d'un coach
function dietPlanIds(d) {
  return Object.keys(d.dietPlans || {}).filter(id => !d.dietPlans[id].archived)
    .sort((a, b) => (b === d.dietActive) - (a === d.dietActive) || !!d.dietPlans[a].fromCoach - !!d.dietPlans[b].fromCoach
      || d.dietPlans[a].name.localeCompare(d.dietPlans[b].name, 'fr'));
}
function dietActivePlan(d) { const p = d.dietPlans?.[d.dietActive]; return p && !p.archived ? p : null; }
// Supprimer = archiver (la synchro par union ne le ferait pas revenir) ; plus suivi s'il l'était
function dietArchivePlan(d, id) {
  const p = d.dietPlans?.[id];
  if (!p) return;
  p.archived = true;
  p.meals = [];
  delete p.targets;
  if (d.dietActive === id) delete d.dietActive;
}
function dietTouch(plan) { plan.updatedAt = Date.now(); }

// ── Plan envoyé par un coach (canal des programmes : coach_send_programme) ──
// data = { kind: 'diet', v: 1, diet: { name, consigne?, targets?, meals } }, sans « name » au premier niveau :
// une version de l'app d'avant la nutrition l'écarte (cleanSentProgramme exige un nom). prog_id = diet_<…>.
const DIET_SENT_PREFIX = 'diet_';
const isDietSentId = id => typeof id === 'string' && id.startsWith(DIET_SENT_PREFIX);
function dietSentId(planId) { return DIET_SENT_PREFIX + String(planId).replace(/^d_?/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30); }
function dietToSent(plan) {
  const c = cleanDietPlan(plan);
  if (!c) return null;
  const diet = { name: c.name, meals: c.meals.map(m => ({ id: m.id, name: m.name, ...(m.note ? { note: m.note } : {}),
    items: m.items.map(it => ({ id: it.id, name: it.name, food: it.food, fam: it.fam, g: it.g, per: it.per, src: it.src, ...(it.ecalc ? { ecalc: true } : {}) })) })) };
  if (c.targets) diet.targets = c.targets;
  if (c.consigne) diet.consigne = c.consigne;
  return { kind: 'diet', v: 1, diet };
}
// Ce que l'app accepte d'un envoi : { name, consigne?, targets?, meals } nettoyé, null sinon
function cleanSentDiet(raw) {
  if (!dietIsObj(raw) || raw.kind !== 'diet' || raw.v !== 1 || !dietIsObj(raw.diet)) return null;
  const p = cleanDietPlan({ ...raw.diet, archived: false, fromCoach: undefined, updatedAt: undefined });
  if (!p || !p.meals.length) return null;
  delete p.archived;
  // Aliments envoyés mais illisibles (forme, bornes) : écartés et comptés, l'élève le voit
  const sentItems = (Array.isArray(raw.diet.meals) ? raw.diet.meals : []).slice(0, DIET_MEAL_MAX)
    .reduce((n, m) => n + (dietIsObj(m) && Array.isArray(m.items) ? Math.min(m.items.length, DIET_ITEM_MAX) : 0), 0);
  const kept = p.meals.reduce((n, m) => n + m.items.length, 0);
  if (sentItems > kept) p.dropped = sentItems - kept;
  return p;
}
// Envoi d'une version plus récente du format (v > 1) : l'app le dit (« Mets l'app à jour ») sans le lire
function dietSentTooNew(raw) { return dietIsObj(raw) && raw.kind === 'diet' && Number.isInteger(raw.v) && raw.v > 1; }
// Identifiant local d'un plan reçu : dc_<8 caractères du coach>_<envoi> (deux coachs ne s'écrasent jamais)
function dietLocalId(sentId, coachId) {
  const tag = String(coachId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'x';
  return `dc_${tag}_${String(sentId).slice(DIET_SENT_PREFIX.length)}`;
}
// Plan reçu déjà pris : 'new', 'update' (nouvel envoi), 'current'
function dietReceivedStatus(d, item, coachId) {
  const id = dietLocalId(item.id, coachId), p = d.dietPlans?.[id];
  if (!p || p.archived) return { status: 'new', id };
  return { status: item.sentAt > (p.fromCoach?.sentAt || 0) ? 'update' : 'current', id };
}
// Prend le plan reçu (item de la boîte : { id, data = plan déjà nettoyé par cleanSentDiet, sentAt }) ou sa
// mise à jour, et le suit. Les repas gardent leur identifiant : les repas cochés aujourd'hui le restent.
// Renvoie l'identifiant local, null si l'envoi est illisible
function importCoachDiet(d, item, coachPerson) {
  const plan = cleanDietPlan({ ...item?.data, archived: false, fromCoach: undefined, updatedAt: undefined, dropped: undefined });
  if (!plan || !plan.meals.length || !isDietSentId(item.id)) return null;
  delete plan.archived;
  const id = dietLocalId(item.id, coachPerson?.user_id);
  (d.dietPlans ||= {})[id] = { ...plan, updatedAt: Date.now(),
    fromCoach: { coachId: coachPerson?.user_id || '', name: coachPerson?.username || null, sentAt: item.sentAt || 0 } };
  d.dietActive = id;
  return id;
}
