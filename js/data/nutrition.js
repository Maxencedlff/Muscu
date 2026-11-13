// ═══════════════════════════════════════════════════════════
//  Nutrition (Nutrition V1, contrat docs/NUTRITION_V1.md) : plan diète, repas cochés, macros. Logique pure.
//
//  - Chargé avant store.js : sanitizeData appelle sanitizeDiet (données bornées comme à la saisie).
//  - Un plan est autonome : chaque aliment garde ses valeurs pour 100 g (per), relevées dans la base
//    Ciqual au moment du choix (js/data/food-swap.js) ou saisies par la personne (aliment perso). Un plan
//    reçu d'un coach s'affiche donc sans la base, et une nouvelle version de Ciqual ne le change pas.
//  - data.dietPlans (fusion par union comme les programmes ; un plan supprimé est archivé, jamais effacé),
//    data.dietActive (plan suivi), data.dietFoods (mes aliments perso, dietFoodsGone : ceux retirés) : copiés sur le compte SEULEMENT avec
//    l'accord de la personne (data.dietConsent = { on, at }, donnée de santé au sens de la CNIL : article 9 du
//    RGPD), sinon sur l'iPhone seulement (profilePayload, js/data/sync.js). Retirer l'accord les efface du serveur.
//  - data.dietLog (repas cochés et remplacements du jour) : sur l'appareil seulement (SYNC_LOCAL_ONLY).
//  - Réglages de l'appareil : dietHideNumbers (masquer calories et grammes de macros), dietStreakOff (série
//    masquée), dietConsentAsked (la question de l'accord a été posée), dietEmptyDays (repas du jour vides : chaque
//    jour commence sans aliment prévu, on note ce qu'on mange ; absent : pré-remplis par le plan, comme avant).
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
const DIET_FOODS_GONE_MAX = 300; // aliments perso retirés gardés (identifiants) : la synchro ne les fait pas revenir
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
const DIET_SRC = ['ciqual-2025', 'perso', 'off'];   // origine des valeurs d'un aliment du plan (off : Open Food Facts, produit scanné)

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
// Aliment du plan : { id, name, food (code Ciqual) | null, fam, g, per, por? }, null s'il est inutilisable
function cleanDietItem(it) {
  if (!dietIsObj(it)) return null;
  const name = dietCutName(it.name), per = cleanDietPer(it.per), g = num(it.g, 1, DIET_G_MAX);
  if (!name || !per || g === null) return null;
  const food = Number.isInteger(it.food) && it.food > 0 && it.food < 1e7 ? it.food : null;
  // src : valeurs de Ciqual 2025 ou saisies (aliment perso) ; ecalc : énergie calculée par l'app (Ciqual sans énergie)
  const src = DIET_SRC.includes(it.src) ? it.src : food ? 'ciqual-2025' : 'perso';
  const por = cleanDietPortion(it.por, Math.round(g));
  return { id: typeof it.id === 'string' && DIET_PART_RE.test(it.id) ? it.id : uid(), name, food,
    fam: DIET_FAMS.includes(it.fam) ? it.fam : dietFamOf(per), g: Math.round(g), per, src, ...(it.ecalc === true ? { ecalc: true } : {}),
    ...(por ? { por } : {}) };
}
// Unité choisie pour afficher la quantité (« 2 œufs ») : { n, u, pl, g } (n unités de g grammes, js/data/food-portions.js).
// Gardée seulement si elle redonne la quantité en grammes (à 1 g près) : it.g fait toujours foi
function cleanDietPortion(por, grams) {
  if (!dietIsObj(por)) return null;
  const p = cleanFoodPortion(por), n = typeof por.n === 'number' && Number.isFinite(por.n) ? Math.round(por.n * 2) / 2 : NaN;
  if (!p || !(n >= 0.5 && n <= PORTION_N_MAX) || Math.abs(Math.round(n * p.g) - grams) > 1) return null;
  return { n, u: p.u, pl: p.pl, g: p.g };
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
  const out = { name: dietText(p.name, DIET_NAME_MAX) || 'Plan de nutrition', meals };
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
// Mes aliments perso : [{ id, name, fam, per, code?, src?, ecalc?, salt?, portion? }] (pour les retrouver dans la recherche).
// DIET_FOODS_MAX : plafond de sécurité des données lues (synchro, sauvegarde). À l'ajout, jamais un aliment retiré en
// silence : dietFoodsFull le dit avant, la personne choisit (Mes aliments, js/features/diet-foods.js)
function cleanDietFoods(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.slice(0, DIET_FOODS_MAX).map(x => {
    if (!dietIsObj(x)) return null;
    const name = dietCutName(x.name), per = cleanDietPer(x.per);
    if (!name || !per || seen.has(normName(name))) return null;
    seen.add(normName(name));
    // code : code-barres du produit (js/data/food-scan.js), pour le retrouver au scan suivant sans réseau ;
    // src 'off' : valeurs d'Open Food Facts ; salt : sel pour 100 g, affiché sur la fiche du produit
    const code = typeof x.code === 'string' && /^\d{8}$|^\d{13}$/.test(x.code) ? x.code : null;
    const salt = num(x.salt, 0, 100), portion = cleanFoodPortion(x.portion);   // portion : unité du paquet ou portion saisie
    return { id: typeof x.id === 'string' && DIET_PART_RE.test(x.id) ? x.id : uid(), name, fam: DIET_FAMS.includes(x.fam) ? x.fam : dietFamOf(per), per,
      ...(code ? { code } : {}), ...(code && x.src === 'off' ? { src: 'off' } : {}), ...(x.ecalc === true ? { ecalc: true } : {}),
      ...(salt !== null && typeof x.salt === 'number' ? { salt: Math.round(salt * 100) / 100 } : {}), ...(portion ? { portion } : {}) };
  }).filter(Boolean);
}
// Ajouter cet aliment à Mes aliments ferait-il partir le plus ancien ? Faux s'il en remplace un (même nom ou même
// code-barres : mis à jour sur place)
function dietFoodsFull(list, food) {
  const l = Array.isArray(list) ? list : [];
  if (l.length < DIET_FOODS_MAX) return false;
  const n = normName(food?.name || '');
  return !l.some(x => normName(x?.name || '') === n || (food?.code && x?.code === food.code));
}
// Retire un aliment de Mes aliments ; renvoie l'aliment retiré (pour Annuler) et sa place, ou null.
// Les plans gardent leurs propres valeurs : rien n'y change
// L'identifiant part dans d.dietFoodsGone : un autre appareil qui l'a encore ne le fait pas revenir (mergeDietProfile)
function dietRemoveFood(d, id) {
  const list = Array.isArray(d.dietFoods) ? d.dietFoods : [];
  const i = list.findIndex(x => x?.id === id);
  if (i < 0) return null;
  const [food] = list.splice(i, 1);
  if (!list.length) delete d.dietFoods;
  d.dietFoodsGone = cleanDietFoodsGone([...(Array.isArray(d.dietFoodsGone) ? d.dietFoodsGone : []), id]);
  return { food, index: i };
}
// Identifiants des aliments perso retirés : uniques, valides, les plus récents gardés (en fin de liste)
function cleanDietFoodsGone(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const id of v) if (typeof id === 'string' && DIET_PART_RE.test(id) && !out.includes(id)) out.push(id);
  return out.slice(-DIET_FOODS_GONE_MAX);
}
// Remet un aliment retiré à sa place (Annuler) ; false si Mes aliments s'est rempli entre-temps
function dietRestoreFood(d, { food, index }) {
  const list = Array.isArray(d.dietFoods) ? d.dietFoods : [];
  if (dietFoodsFull(list, food)) return false;
  const rest = list.filter(x => x.id !== food.id && normName(x.name) !== normName(food.name));
  rest.splice(Math.min(index, rest.length), 0, food);
  d.dietFoods = cleanDietFoods(rest);
  const gone = cleanDietFoodsGone(d.dietFoodsGone).filter(id => id !== food.id);
  if (gone.length) d.dietFoodsGone = gone; else delete d.dietFoodsGone;
  return true;
}
// Repas de la carte de l'accueil : tous jusqu'à max (4), sinon max − 1 autour du prochain ; more : ceux qui ne sont
// pas listés (« et 2 autres »). Seuls les repas qui ont des aliments, prévus ou ajoutés (repas retiré ou jour vide : listé,
// sans rond à cocher ; collation libre restée vide : pas listée)
function dietHomeMeals(pr, max = 4) {
  const list = (pr?.meals || []).filter(x => x.meal.items.length || x.extras?.length);
  if (list.length <= max) return { shown: list, more: 0 };
  const n = max - 1, i = pr.next ? list.indexOf(pr.next) : 0;
  const start = Math.max(0, Math.min(i - 1, list.length - n));
  return { shown: list.slice(start, start + n), more: list.length - n };
}
// Journal : { 'AAAA-MM-JJ': { plan, done: [id repas], swaps: { [id aliment]: aliment }, extras: { [id repas]: [aliment] }, removed: [id aliment] } },
// 120 jours au plus. extras : aliments ajoutés à un repas pour ce jour seulement, hors plan (le plan ne change pas).
// swaps : remplaçant d'un aliment du plan, ou le même aliment à une autre quantité (« Changer la quantité »).
// removed : aliments du plan pas mangés ce jour-là (« Retirer pour aujourd'hui »).
// off : repas retirés pour ce jour (« Retirer ce repas pour aujourd'hui ») : ni à cocher, ni comptés.
// blank : jour commencé vide (réglage dietEmptyDays) : les aliments prévus d'un repas n'y sont que s'il est dans copied
// (« Copier le plan de ce repas »), même si le plan change ensuite. Gardé avec le jour : changer le réglage ne réécrit
// jamais un jour passé. Champs facultatifs : un ancien client les ignore (aliments prévus affichés, comptés à la coche)
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
    const extras = cleanDietExtras(e.extras);
    const removed = cleanDietRemoved(e.removed);
    // Repas du plan ce jour-là (instantané) : un jour passé reste jugé avec le plan de ce jour
    const meals = Array.isArray(e.meals) ? [...new Set(e.meals.filter(id => typeof id === 'string' && DIET_PART_RE.test(id)))].slice(0, DIET_MEAL_MAX) : null;
    const blank = e.blank === true, off = cleanDietMealIds(e.off), copied = cleanDietMealIds(e.copied);
    if (done.length || Object.keys(swaps).length || Object.keys(extras).length || removed.length || off.length || copied.length || blank) {
      out[day] = { plan: e.plan, done, swaps, ...(Object.keys(extras).length ? { extras } : {}), ...(removed.length ? { removed } : {}), ...(meals ? { meals } : {}),
        ...(off.length ? { off } : {}), ...(copied.length ? { copied } : {}), ...(blank ? { blank } : {}) };
    }
  }
  return out;
}
// Repas d'un jour (off, copied) : ids uniques et valides
function cleanDietMealIds(v) {
  return Array.isArray(v) ? [...new Set(v.filter(id => typeof id === 'string' && DIET_PART_RE.test(id)))].slice(0, DIET_MEAL_MAX) : [];
}
// Aliments du plan retirés pour ce jour : ids uniques et valides
function cleanDietRemoved(v) {
  return Array.isArray(v) ? [...new Set(v.filter(id => typeof id === 'string' && DIET_PART_RE.test(id)))].slice(0, DIET_MEAL_MAX * DIET_ITEM_MAX) : [];
}
// Ajouts du jour : { [id repas]: [aliment] }, DIET_ITEM_MAX par repas, ids uniques ; repas sans ajout : oubliés
function cleanDietExtras(v) {
  const out = {};
  if (!dietIsObj(v)) return out;
  for (const [mealId, list] of Object.entries(v).slice(0, DIET_MEAL_MAX)) {
    if (!DIET_PART_RE.test(mealId) || !Array.isArray(list)) continue;
    const seen = new Set();
    const items = list.map(cleanDietItem).filter(it => it && !seen.has(it.id) && seen.add(it.id)).slice(0, DIET_ITEM_MAX);
    if (items.length) out[mealId] = items;
  }
  return out;
}
// Appelé par sanitizeData : clés retirées quand il n'en reste rien de valable
function sanitizeDiet(d, now = Date.now()) {
  if (d.dietPlans !== undefined) { d.dietPlans = cleanDietPlans(d.dietPlans); if (!Object.keys(d.dietPlans).length) delete d.dietPlans; }
  const p = d.dietPlans?.[d.dietActive];
  if (d.dietActive !== undefined && (!p || p.archived)) delete d.dietActive;
  if (d.dietFoods !== undefined) { d.dietFoods = cleanDietFoods(d.dietFoods); if (!d.dietFoods.length) delete d.dietFoods; }
  if (d.dietFoodsGone !== undefined) { d.dietFoodsGone = cleanDietFoodsGone(d.dietFoodsGone); if (!d.dietFoodsGone.length) delete d.dietFoodsGone; }
  if (d.dietLog !== undefined) { d.dietLog = cleanDietLog(d.dietLog, now); if (!Object.keys(d.dietLog).length) delete d.dietLog; }
  // Accord pour copier les plans sur le compte : { on, at (date ISO du choix) }, retiré s'il est illisible
  if (d.dietConsent !== undefined) {
    const c = d.dietConsent, ok = dietIsObj(c) && typeof c.on === 'boolean' && typeof c.at === 'string' && c.at.length <= 40 && Number.isFinite(Date.parse(c.at));
    if (ok) d.dietConsent = { on: c.on, at: c.at }; else delete d.dietConsent;
  }
  for (const k of ['dietConsentAsked', 'dietHideNumbers', 'dietStreakOff']) if (d[k] !== undefined && d[k] !== true) delete d[k];
  // Repas du jour : true (vides) ou false (pré-remplis) choisis ; absent = selon le plan (dietEmptyDaysFor)
  if (d.dietEmptyDays !== undefined && typeof d.dietEmptyDays !== 'boolean') delete d.dietEmptyDays;
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
// Objectif ou total très bas (moins de 1 200 kcal, mais pas vide) : message de santé, jamais bloquant.
// Sans objectif de calories, le total ne compte qu'une fois chaque repas rempli : un plan en cours de
// remplissage (215 kcal sur un repas de quatre) n'est pas un régime très bas (panel du 06/11)
// Part d'une jauge (0 à 1) calculée sur les valeurs telles qu'affichées, arrondies à l'unité
function dietShownRatio(v, goal) {
  const g = Math.round(Number(goal) || 0), x = Math.round(Number(v) || 0);
  return g > 0 ? Math.max(0, Math.min(1, x / g)) : 0;
}

function dietLowKcal(plan) {
  if (!plan) return false;
  const own = plan.targets?.kcal;
  if (!own && !(plan.meals?.length && plan.meals.every(m => m.items.length))) return false;
  const k = own || dietGoal(plan).goal.kcal;
  return k > 0 && k < DIET_LOW_KCAL;
}

// Écart de plus de 10 % entre les repas prévus et l'objectif fixé (calories, protéines) : une phrase, sinon ''.
// « 1 425 kcal prévues » à côté de « objectif 2 000 kcal » passait inaperçu, à l'envoi du coach comme chez
// l'élève (panel du 07/11) ; rien n'est bloqué, c'est un signal
function dietTargetGap(plan) {
  const t = plan?.targets;
  if (!t || !plan.meals?.some(m => m.items?.length)) return '';
  const total = dietPlanMacros(plan);
  const parts = [['kcal', 'kcal'], ['p', 'g de protéines']].flatMap(([k, unit]) => {
    const goal = Number(t[k]) || 0, diff = Math.round(total[k]) - goal;
    if (!goal || Math.abs(diff) <= goal * 0.1) return [];
    return [`${fmtNum(Math.abs(diff))} ${unit} de ${diff < 0 ? 'moins' : 'plus'}`];
  });
  return parts.length ? `Les repas prévus font ${parts.join(' et ')} que l'objectif du jour.` : '';
}

// ── Macros ──────────────────────────────────────────────────

const DIET_ZERO = () => ({ kcal: 0, p: 0, c: 0, f: 0 });
// Apport d'un aliment à sa quantité (non arrondi : on arrondit à l'affichage)
function dietItemMacros(it) {
  const r = (it?.g || 0) / 100, per = it?.per || {};
  return { kcal: (per.k || 0) * r, p: (per.p || 0) * r, c: (per.c || 0) * r, f: (per.f || 0) * r };
}
// Quantité affichée : « 2 œufs · 100 g » (unité choisie) ou « 100 g » ; spoken : « 2 œufs, 100 grammes »
function dietQtyText(it) { return it?.por ? `${portionText(it.por.n, it.por)} · ${it.g}\u00a0g` : `${it?.g}\u00a0g`; }
function dietQtySpoken(it) { return it?.por ? `${portionSpoken(it.por.n, it.por)}, ${it.g} grammes` : `${it?.g} grammes`; }
function dietAdd(a, b) { return { kcal: a.kcal + b.kcal, p: a.p + b.p, c: a.c + b.c, f: a.f + b.f }; }
// Aliment tel qu'il sera mangé ce jour-là : le remplaçant choisi, sinon celui du plan
function dietEffectiveItem(it, swaps) { return swaps && Object.hasOwn(swaps, it.id) ? swaps[it.id] : it; }
// Même aliment à une autre quantité (« Changer la quantité »), pas un remplaçant
function dietIsQtyChange(it, swap) { return !!swap && swap.name === it.name && (swap.food ?? null) === (it.food ?? null); }
// removed : ids des aliments retirés ce jour-là, comptés pour rien
function dietMealMacros(meal, swaps = null, removed = null) {
  return (meal?.items || []).reduce((a, it) => (removed?.includes(it.id) ? a : dietAdd(a, dietItemMacros(dietEffectiveItem(it, swaps)))), DIET_ZERO());
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
// Jour affiché par l'écran Nutrition : aujourd'hui, sauf le jour passé choisi dans la frise (pick : { day, today, at })
// le jour même où il l'a été et s'il est dans la frise (week : ses 7 jours)
const DIET_PICK_MS = 5 * 60000;
function dietPickedDay(pick, day, week, now = Date.now()) {
  const today = dietDayKey(now);
  return pick && pick.day === day && pick.today === today && week.includes(day) ? day : today;
}
// Retour dans l'app : le choix d'un jour passé tombe au lendemain ou s'il date de plus de DIET_PICK_MS
function dietPickStale(pick, now = Date.now()) { return !!pick && (pick.today !== dietDayKey(now) || now - pick.at > DIET_PICK_MS); }
// Entrée du journal de ce jour pour ce plan. Jour pas encore noté (ou noté avec un autre plan) : pré-rempli par le
// plan, ou vide (blank) si le réglage « Repas du jour : Vides » est choisi
// Repas du jour vides ? Choix de la personne s'il existe ; sinon son propre plan commence vide (le plan donne les
// objectifs, personne ne mange la même chose tous les jours : retour de Maxence, 13/11) et un plan envoyé par un
// coach reste pré-rempli (c'est un menu à suivre, on coche chaque repas)
function dietEmptyDaysFor(d, planId) {
  if (typeof d.dietEmptyDays === 'boolean') return d.dietEmptyDays;
  return !d.dietPlans?.[planId]?.fromCoach;
}
function dietDay(d, planId, day) {
  const e = d.dietLog?.[day];
  if (e && e.plan === planId) return { ...e, extras: e.extras || {}, removed: e.removed || [], off: e.off || [], copied: e.copied || [] };
  return { plan: planId, done: [], swaps: {}, extras: {}, removed: [], off: [], copied: [], ...(dietEmptyDaysFor(d, planId) ? { blank: true } : {}) };
}
// Aliments prévus encore au menu de ce jour : ni retirés, ni dans un repas retiré, ni dans un repas d'un jour vide dont
// le plan n'a pas été copié. C'est ce qu'on coche
function dietMealLive(meal, e) {
  if (!meal || e?.off?.includes(meal.id) || (e?.blank === true && !e.copied?.includes(meal.id))) return [];
  return meal.items.filter(it => !e?.removed?.includes(it.id));
}
// Repas à faire ce jour-là (pour « Journée complète ») : jour pré-rempli, ceux qui ont des aliments à cocher ; jour vide,
// tous les repas du plan qui ont des aliments, sauf ceux retirés
function dietDayRequired(meals, e) {
  return (meals || []).filter(m => (e.blank === true ? m.items.length > 0 && !e.off?.includes(m.id) : dietMealLive(m, e).length > 0)).map(m => m.id);
}
// Repas fait : coché ; jour vide, un repas dont le plan n'a pas été copié est fait dès qu'un aliment y est noté
function dietMealSatisfied(e, id) {
  return e.blank === true && !e.copied?.includes(id) ? (e.extras?.[id] || []).length > 0 : e.done.includes(id);
}
function dietWriteDay(d, day, e) {
  const plan = d.dietPlans?.[e.plan];
  // Repas et aliments qui n'existent plus dans le plan : oubliés
  const meals = new Set((plan?.meals || []).map(m => m.id));
  const items = new Set((plan?.meals || []).flatMap(m => m.items.map(it => it.id)));
  const done = e.done.filter(id => meals.has(id));
  const swaps = Object.fromEntries(Object.entries(e.swaps || {}).filter(([id]) => items.has(id)));
  const extras = Object.fromEntries(Object.entries(e.extras || {}).filter(([id, list]) => meals.has(id) && list?.length));
  const removed = (e.removed || []).filter(id => items.has(id));
  const off = (e.off || []).filter(id => meals.has(id)), copied = (e.copied || []).filter(id => meals.has(id)), blank = e.blank === true;
  d.dietLog ||= {};
  // Instantané : les repas à faire ce jour-là (un repas retiré n'en est plus, « Journée complète » sans lui)
  const snapshot = dietDayRequired(plan?.meals, { removed, off, copied, blank });
  const hasExtras = Object.keys(extras).length > 0;
  // Jour vide (blank) gardé même sans rien d'autre : sinon il redeviendrait « pré-rempli » ou « vide » selon le réglage du moment
  if (done.length || Object.keys(swaps).length || hasExtras || removed.length || off.length || copied.length || blank) {
    d.dietLog[day] = { plan: e.plan, done, swaps, ...(hasExtras ? { extras } : {}), ...(removed.length ? { removed } : {}), meals: snapshot,
      ...(off.length ? { off } : {}), ...(copied.length ? { copied } : {}), ...(blank ? { blank } : {}) };
  }
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
// Change la quantité d'un aliment du plan pour ce jour (q : { g, por }, por null en grammes) : gardée comme un
// remplacement par le même aliment (le remplaçant choisi garde son nom). La quantité prévue remet le plan
function dietSetPlanQty(d, planId, itemId, q, day = dietDayKey()) {
  const it = d.dietPlans?.[planId]?.meals.flatMap(m => m.items).find(x => x.id === itemId);
  if (!it || !q) return false;
  const cur = dietEffectiveItem(it, dietDay(d, planId, day).swaps);
  const back = dietIsQtyChange(it, cur) && Math.round(q.g) === it.g && (q.por?.n ?? null) === (it.por?.n ?? null);
  const c = cleanDietItem({ ...cur, id: itemId, g: q.g, por: q.por || undefined });
  if (!c) return false;
  return back ? (dietSetSwap(d, planId, itemId, null, day), true) : dietSetSwap(d, planId, itemId, c, day);
}
// Retire un aliment du plan pour ce jour (off false : le remet) ; le plan ne change pas
function dietSetRemoved(d, planId, itemId, off = true, day = dietDayKey()) {
  const e = dietDay(d, planId, day);
  const removed = e.removed.filter(id => id !== itemId);
  if (off) removed.push(itemId);
  dietWriteDay(d, day, { ...e, removed });
  return off;
}
// Retire un repas entier pour ce jour (« Retirer ce repas pour aujourd'hui ») : plus à cocher, plus compté. Sa coche
// et ses ajouts partent avec lui (pas mangés) ; renvoie de quoi Annuler (dietUndoMealOff), null si le repas n'existe pas.
// Ce qu'on y ajoute ensuite (on a mangé autre chose) compte tout de suite. Le plan ne change pas
function dietSetMealOff(d, planId, mealId, day = dietDayKey()) {
  const meal = d.dietPlans?.[planId]?.meals.find(m => m.id === mealId);
  if (!meal) return null;
  const e = dietDay(d, planId, day);
  const gone = { extras: e.extras[mealId] || [], done: e.done.includes(mealId) };
  const extras = { ...e.extras };
  delete extras[mealId];
  dietWriteDay(d, day, { ...e, extras, off: [...e.off.filter(id => id !== mealId), mealId], done: e.done.filter(id => id !== mealId) });
  return gone;
}
// « Remettre le repas prévu » : ses aliments prévus reviennent, à cocher (les ajouts partis restent partis)
function dietSetMealOn(d, planId, mealId, day = dietDayKey()) {
  if (!d.dietPlans?.[planId]?.meals.some(m => m.id === mealId)) return false;
  const e = dietDay(d, planId, day);
  dietWriteDay(d, day, { ...e, off: e.off.filter(id => id !== mealId) });
  return true;
}
// Annuler un retrait : seulement lui (une coche ou un ajout faits entre-temps restent) ; ses ajouts et sa coche reviennent
function dietUndoMealOff(d, planId, mealId, gone, day = dietDayKey()) {
  if (!dietSetMealOn(d, planId, mealId, day) || !gone) return false;
  const e = dietDay(d, planId, day), now = e.extras[mealId] || [];
  const extras = { ...e.extras, [mealId]: [...gone.extras.filter(x => !now.some(y => y.id === x.id)), ...now].slice(0, DIET_ITEM_MAX) };
  dietWriteDay(d, day, { ...e, extras, done: gone.done && !e.done.includes(mealId) ? [...e.done, mealId] : e.done });
  return true;
}
// Jour vide : « Copier le plan de ce repas » (ses aliments prévus, à cocher ; ce qui est déjà noté reste compté)
function dietCopyMealPlan(d, planId, mealId, day = dietDayKey()) {
  if (!d.dietPlans?.[planId]?.meals.some(m => m.id === mealId)) return false;
  const e = dietDay(d, planId, day);
  dietWriteDay(d, day, { ...e, copied: [...e.copied.filter(id => id !== mealId), mealId], off: e.off.filter(id => id !== mealId) });
  return true;
}
// Réglage « Repas du jour » (blank true : vides). Les jours pas encore notés suivent le réglage ; aujourd'hui, déjà
// noté, change aussi sans rien perdre. Vers « Vides » : les repas cochés gardent leur plan (copié), les autres se vident.
// Vers « Pré-remplis » : les repas sans ajout reprennent le plan ; un repas où l'on a noté ce qu'on a mangé est retiré
// (pas de double compte, ses ajouts comptent). Un repas retiré le reste. Les jours passés ne changent jamais
function dietSetEmptyDays(d, blank, day = dietDayKey()) {
  d.dietEmptyDays = !!blank;
  const e = d.dietLog?.[day], plan = e && d.dietPlans?.[e.plan];
  if (!plan || (e.blank === true) === !!blank) return;
  const cur = dietDay(d, e.plan, day);
  if (blank) { dietWriteDay(d, day, { ...cur, blank: true, copied: [...cur.done] }); return; }
  const off = [...cur.off];
  for (const m of plan.meals) {
    if (m.items.length && !cur.copied.includes(m.id) && !off.includes(m.id) && (cur.extras[m.id] || []).length) off.push(m.id);
  }
  const next = { ...cur, off, copied: [] };
  delete next.blank;
  dietWriteDay(d, day, next);
}
// Ajoute un aliment à un repas pour ce jour seulement (repas coché ou non : il reste dans son état) ;
// renvoie l'aliment ajouté (id neuf), null si illisible ou si le repas est plein
function dietAddExtra(d, planId, mealId, newItem, day = dietDayKey()) {
  const meal = d.dietPlans?.[planId]?.meals.find(m => m.id === mealId);
  const e = dietDay(d, planId, day), list = e.extras[mealId] || [];
  const c = meal ? cleanDietItem({ ...newItem, id: uid() }) : null;
  if (!c || list.length >= DIET_ITEM_MAX) return null;
  dietWriteDay(d, day, { ...e, extras: { ...e.extras, [mealId]: [...list, c] } });
  return c;
}
// Change la quantité d'un aliment ajouté (g, ou { g, por }) ou le retire (g null) ; renvoie true si fait
function dietSetExtra(d, planId, mealId, extraId, g, day = dietDayKey()) {
  const e = dietDay(d, planId, day), list = e.extras[mealId] || [];
  const i = list.findIndex(x => x.id === extraId);
  if (i < 0) return false;
  // g : grammes, ou { g, por } (quantité choisie à l'unité) ; une quantité en grammes seule retire l'unité
  const q = dietIsObj(g) ? g : { g, por: undefined };
  const c = g == null ? null : cleanDietItem({ ...list[i], g: q.g, por: q.por });
  if (g != null && !c) return false;
  const next = c ? list.map((x, j) => (j === i ? c : x)) : list.filter((_, j) => j !== i);
  dietWriteDay(d, day, { ...e, extras: { ...e.extras, [mealId]: next } });
  return true;
}
// Bilan d'une journée : mangé (repas cochés, remplacements compris), prévu, repère, repas.
// Un repas sans aliment prévu ce jour-là (plan neuf, repas pas encore rempli, repas retiré pour la journée, jour
// commencé vide) ne se coche pas : il ne compte ni dans « n repas cochés sur N » (nMeals), ni pour la journée
// complète, et n'est jamais proposé comme prochain repas. Un aliment prévu ne compte dans le mangé qu'une fois son
// repas coché ; les ajouts d'un repas sans aliment prévu comptent tout de suite (on note ce qu'on a mangé).
// Repère sans objectif fixé : le total prévu ce jour-là, remplacements compris (un équivalent de 217 kcal
// pour 215 prévues ne fait pas « 217 sur 215 »)
function dietDayProgress(d, planId, day = dietDayKey()) {
  const plan = d.dietPlans?.[planId];
  if (!plan) return null;
  const e = dietDay(d, planId, day);
  // Ajouts du jour : comptés dans le repas (mangé une fois coché), jamais dans le prévu ni le repère
  const blank = e.blank === true;
  const meals = plan.meals.map(m => {
    const extras = e.extras[m.id] || [], live = dietMealLive(m, e);
    const base = live.length ? dietMealMacros(m, e.swaps, e.removed) : DIET_ZERO(), added = extras.reduce((a, it) => dietAdd(a, dietItemMacros(it)), DIET_ZERO());
    // Repère : le plan du jour, remplaçants compris ; jamais baissé par un aliment retiré ou une quantité changée
    const plannedSwaps = Object.fromEntries(m.items.filter(it => e.swaps[it.id] && !dietIsQtyChange(it, e.swaps[it.id])).map(it => [it.id, e.swaps[it.id]]));
    const off = e.off.includes(m.id), copyable = blank && !off && m.items.length > 0 && !e.copied.includes(m.id);
    return { meal: m, live, extras, base, added, off, copyable, plan: dietMealMacros(m, plannedSwaps), macros: dietAdd(base, added), done: live.length > 0 && e.done.includes(m.id) };
  });
  const toEat = meals.filter(x => x.live.length);
  // Mangé : un repas coché (aliments prévus et ajouts) ; les ajouts seuls tout de suite dans un jour vide (on note ce
  // qu'on mange, plan copié ou non) et dans un repas sans aliment prévu (collation libre, repas retiré puis autre chose)
  const eaten = meals.reduce((a, x) => dietAdd(a, x.done ? x.macros : x.extras.length && (blank || !x.live.length) ? x.added : DIET_ZERO()), DIET_ZERO());
  const planned = meals.reduce((a, x) => dietAdd(a, x.plan), DIET_ZERO());
  const req = dietDayRequired(plan.meals, e), nDone = req.filter(id => dietMealSatisfied(e, id)).length;
  const { goal, own } = dietGoal(plan);
  for (const k of DIET_TARGET_KEYS) if (!own[k]) goal[k] = Math.round(planned[k]);
  return { plan, day, swaps: e.swaps, removed: e.removed, blank, meals, eaten, planned, goal, own, nDone, nMeals: req.length,
    complete: req.length > 0 && nDone === req.length, next: toEat.find(x => !x.done) || null };
}
// Jour complet : tous les repas du plan suivi ce jour-là cochés. planId : seulement si ce jour a été coché
// avec ce plan (aujourd'hui après un changement de plan : les coches de l'ancien ne comptent plus, comme à l'écran)
function dietDayComplete(d, day, planId = null) {
  const e = d.dietLog?.[day];
  if (!e || (planId && e.plan !== planId)) return false;
  // Instantané du jour (repas à faire ce jour-là) ; journal d'avant l'instantané : le plan actuel, repas retirés exclus
  const ids = Array.isArray(e.meals) ? e.meals : dietDayRequired(d.dietPlans?.[e.plan]?.meals, e);
  return ids.length > 0 && ids.every(id => dietMealSatisfied(e, id));
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
    // En partie : un repas coché ou un aliment noté (jour vide : on note sans cocher)
    return { day, ts: t.getTime(), complete: dietDayComplete(d, day, only), some: mine && (e.done.length > 0 || Object.keys(e.extras || {}).length > 0) };
  });
}

// ── Plans : création, suivi, suppression ────────────────────

// Plan neuf. Sans plan suivi, le premier créé le devient, sauf pour un coach (isCoach) : il prépare là les
// plans de ses élèves, qui ne doivent pas s'afficher sur son propre accueil (« Plan suivi » pour le sien)
function dietNewPlan(d, name = 'Mon plan', { isCoach = false } = {}) {
  let id;
  do { id = 'd_' + uid(); } while (d.dietPlans?.[id]);
  (d.dietPlans ||= {})[id] = { name: dietText(name, DIET_NAME_MAX) || 'Mon plan',
    meals: DIET_DEFAULT_MEALS.map(n => ({ id: uid(), name: n, items: [] })), updatedAt: Date.now() };
  if (!isCoach && !dietActivePlan(d)) d.dietActive = id;
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
    items: m.items.map(it => ({ id: it.id, name: it.name, food: it.food, fam: it.fam, g: it.g, per: it.per, src: it.src, ...(it.ecalc ? { ecalc: true } : {}),
      ...(it.por ? { por: it.por } : {}) })) })) };
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
