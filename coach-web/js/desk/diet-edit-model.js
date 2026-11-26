// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : logique pure de l'éditeur des plans diète (docs/COACH_WEB.md, « Plans diète »)
//
//  Format : exactement celui de l'app iPhone. Le brouillon est un plan de js/data/nutrition.js (cleanDietPlan) : repas,
//  aliments aux valeurs pour 100 g recopiées (foodToItem), quantités en grammes avec l'unité choisie à côté (por),
//  objectifs (cleanDietTargets), jours d'entraînement et de repos ou semaine (dietSetDayMode, dietCopyMealToDays…).
//  Il repart par coachDietPayload (js/data/coach-diet.js, même nettoyage et même limite de 200 Ko que l'app) : un plan
//  créé ici est identique à un plan créé sur l'iPhone.
//  Mes plans et Mes aliments vivent sur le compte du coach (profiles.doc : dietPlans, dietFoods, dietFoodsGone), comme
//  ceux que l'iPhone y copie, et SEULEMENT avec son accord « Copier mes plans sur mon compte » (dietConsent, RGPD
//  article 9). Une écriture n'est qu'une opération (deskDtOp…) rejouée sur le document relu juste avant : les autres
//  clés du profil ne sont jamais touchées, et une écriture de l'iPhone arrivée entre-temps n'est pas écrasée
//  (deskWriteDiet, js/desk/api.js : mise à jour conditionnée par updated_at, puis relecture et nouvel essai).
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_DT_UNDO_MAX = 80;
const DESK_DT_SYNC_V = 1;                     // version de la fusion des plans que l'iPhone doit connaître (DIET_SYNC_V)                  // gestes qu'on peut annuler
// Profil au-delà duquel le site n'écrit plus : 800 Ko, une marge sous les 900 Ko où l'iPhone n'enverrait plus aucun de
// ses plans (SYNC_PROFILE_MAX_BYTES, js/data/sync.js) : il lui reste la place d'y ajouter les siens
const DESK_DT_DOC_MAX = 800 * 1024;
const DESK_DT_MODES = [['one', 'Tous les jours pareils'], ['session', 'Entraînement et repos'], ['week', 'Semaine']];

// Partie diète de mon compte : { consent, dietPlans, dietFoods, dietFoodsGone } (nettoyée comme l'app la lit)
function deskDtAcc(doc) {
  const d = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  // syncOk : l'iPhone qui a écrit le profil connaît la fusion à trois voies des plans (dietSyncV, js/data/sync.js)
  return { consent: d.dietConsent?.on === true, syncOk: Number(d.dietSyncV) >= DESK_DT_SYNC_V, dietPlans: cleanDietPlans(d.dietPlans), dietFoods: cleanDietFoods(d.dietFoods),
    dietFoodsGone: cleanDietFoodsGone(d.dietFoodsGone) };
}
// Mes plans listés (archivés et plans reçus d'un coach exclus), du plus récemment modifié
function deskDtPlanIds(acc) {
  const ps = acc?.dietPlans || {};
  return Object.keys(ps).filter(id => !ps[id].archived && !ps[id].fromCoach)
    .sort((a, b) => (ps[b].updatedAt || 0) - (ps[a].updatedAt || 0) || ps[a].name.localeCompare(ps[b].name, 'fr'));
}
// Organisation des jours en deux mots (liste des plans)
function deskDtDaysWord(plan) { return (DESK_DT_MODES.find(([m]) => m === (plan?.days?.mode || 'one')) || DESK_DT_MODES[0])[1]; }

// ── Brouillon ──

const deskDtClone = o => JSON.parse(JSON.stringify(o));
// Plan neuf (4 repas de base, comme « Créer un plan » de l'app pour un coach : jamais suivi par lui) → { id, plan }
// ou { kind: 'plans_full' } (100 plans vivants au plus)
function deskDtNew(acc, name) {
  const d = { dietPlans: { ...(acc?.dietPlans || {}) } };
  if (!dietCanCreate(d, true)) return { kind: 'plans_full' };
  const id = dietNewPlan(d, name, { isCoach: true });
  return { id, plan: d.dietPlans[id] };
}
// Copie d'un de mes plans (nouvel identifiant, « (copie) ») → { id, plan } ou { kind }
function deskDtDuplicate(acc, srcId, src = acc?.dietPlans?.[srcId]) {
  const d = { dietPlans: { ...(acc?.dietPlans || {}), [srcId]: src } };
  if (!src || !dietCanCreate(d, true)) return { kind: src ? 'plans_full' : 'server' };
  const id = dietDuplicatePlan(d, srcId);
  return id ? { id, plan: d.dietPlans[id] } : { kind: 'server' };
}
// Identifiant de mon plan pour un envoi (diet_<x> → d_<x>, l'inverse de dietSentId)
function deskDtPlanIdOfSent(sentId) {
  const id = `d_${String(sentId).slice(DIET_SENT_PREFIX.length)}`;
  return DIET_ID_RE.test(id) && dietSentId(id) === sentId ? id : null;
}
// Brouillon modifiable : une copie nettoyée (identifiants des repas et aliments gardés)
function deskDtDraft(plan) {
  const p = cleanDietPlan(deskDtClone(plan));
  if (p) { delete p.fromCoach; delete p.archived; delete p.dropped; }
  return p;
}
// Empreinte comparable (changements pas encore enregistrés), sans la date de modification
function deskDtSnap(plan) {
  const p = plan ? cleanDietPlan(deskDtClone(plan)) : null;
  if (p) delete p.updatedAt;
  return p ? JSON.stringify(p) : '';
}

// ── Annuler, rétablir ──

function deskDtHistory() { return { past: [], future: [] }; }
// Après un geste : l'état d'avant (before, JSON) est gardé ; key : gestes fusionnés (la frappe dans un même champ ne
// fait qu'un retour en arrière), rétablir n'est plus possible
function deskDtPush(h, before, key = null) {
  if (!key || h.key !== key) {
    h.past.push(before);
    if (h.past.length > DESK_DT_UNDO_MAX) h.past.shift();
  }
  h.future = [];
  h.key = key;
}
function deskDtUndo(h, plan) {
  if (!h.past.length) return null;
  h.future.push(JSON.stringify(plan));
  h.key = null;
  return JSON.parse(h.past.pop());
}
function deskDtRedo(h, plan) {
  if (!h.future.length) return null;
  h.past.push(JSON.stringify(plan));
  h.key = null;
  return JSON.parse(h.future.pop());
}

// ── Repas d'un jour (day : dietDayObj(plan, i), le plan lui-même pour le jour 1) ──

const deskDtMeal = (day, mealId) => day?.meals.find(m => m.id === mealId) || null;
const deskDtItem = (day, mealId, itemId) => deskDtMeal(day, mealId)?.items.find(x => x.id === itemId) || null;

// Nouveau repas (nom obligatoire, pas en double, 8 au plus) → { ok, id } ou { kind: 'empty' | 'taken' | 'full' }
function deskDtAddMeal(day, name) {
  const n = dietText(name, DIET_NAME_MAX);
  if (!n || !hasVisible(n)) return { kind: 'empty' };
  if (day.meals.length >= DIET_MEAL_MAX) return { kind: 'full' };
  if (dietMealNameTaken(day, n)) return { kind: 'taken' };
  const id = uid();
  day.meals.push({ id, name: n, items: [] });
  return { ok: true, id };
}
function deskDtRenameMeal(day, mealId, name) {
  const m = deskDtMeal(day, mealId), n = dietText(name, DIET_NAME_MAX);
  if (!m) return { kind: 'server' };
  if (!n || !hasVisible(n)) return { kind: 'empty' };
  if (dietMealNameTaken(day, n, mealId)) return { kind: 'taken' };
  m.name = n;
  return { ok: true };
}
function deskDtSetMealNote(day, mealId, note) {
  const m = deskDtMeal(day, mealId);
  if (!m) return;
  const t = dietText(note, DIET_NOTE_MAX);
  if (t) m.note = t; else delete m.note;
}
// Repas de base (Petit-déjeuner, Déjeuner, Collation, Dîner) : masqué, jamais supprimé (règle de l'app) ; repas ajouté :
// supprimé. → 'hidden' | 'deleted' | null
function deskDtRemoveMeal(day, mealId) {
  const i = day.meals.findIndex(m => m.id === mealId);
  if (i < 0) return null;
  if (day.meals[i].base) { day.meals[i].hidden = true; return 'hidden'; }
  day.meals.splice(i, 1);
  return 'deleted';
}
function deskDtShowMeal(day, mealId) { const m = deskDtMeal(day, mealId); if (m) delete m.hidden; }
// Repas copié juste après lui (nouveaux identifiants) → identifiant de la copie, ou null (8 repas)
function deskDtCopyMeal(day, mealId) { return dietCopyMeal(day, mealId); }
// Déplace un repas à la place `to` parmi les repas affichés (glisser-déposer, flèches) → nouvelle position (1…n) ou 0
function deskDtMoveMeal(day, mealId, to) {
  const shown = dietShownMeals(day), from = shown.findIndex(m => m.id === mealId);
  const t = Math.max(0, Math.min(shown.length - 1, to));
  if (from < 0 || t === from) return 0;
  const [m] = shown.splice(from, 1);
  shown.splice(t, 0, m);
  // Les repas masqués gardent leur place relative : à la fin, dans leur ordre
  day.meals = [...shown, ...day.meals.filter(x => x.hidden)];
  return t + 1;
}

// ── Aliments ──

// Aliment choisi (recherche, aliment perso, produit scanné) et sa quantité → { ok, item } ou { kind: 'full' | 'server' }
function deskDtAddItem(day, mealId, food, g, por = null) {
  const m = deskDtMeal(day, mealId);
  if (!m) return { kind: 'server' };
  if (m.items.length >= DIET_ITEM_MAX) return { kind: 'full' };
  const it = foodToItem(food, g, por);
  if (!it) return { kind: 'server' };
  while (m.items.some(x => x.id === it.id)) it.id = uid();
  m.items.push(it);
  return { ok: true, item: it };
}
// Quantité tapée (grammes, ou nombre d'unités : mode = index de l'unité) → { ok } ou { err } (règles de dietQtyValue)
function deskDtSetQty(it, units, mode, raw) {
  const q = dietQtyValue(units, mode, raw);
  if (q.err) return q;
  it.g = q.g;
  if (q.por) it.por = q.por; else delete it.por;
  return { ok: true };
}
function deskDtRemoveItem(day, mealId, itemId) {
  const m = deskDtMeal(day, mealId), i = m ? m.items.findIndex(x => x.id === itemId) : -1;
  if (i < 0) return null;
  return m.items.splice(i, 1)[0];
}
// Vers un autre repas du même jour (« Déplacer vers… » de l'app) → { ok } ou { kind: 'full' | 'server' }
function deskDtMoveItem(day, fromId, itemId, toId) {
  const a = deskDtMeal(day, fromId), b = deskDtMeal(day, toId), i = a ? a.items.findIndex(x => x.id === itemId) : -1;
  if (!a || !b || a === b || i < 0) return { kind: 'server' };
  if (b.items.length >= DIET_ITEM_MAX) return { kind: 'full' };
  const [it] = a.items.splice(i, 1);
  while (b.items.some(x => x.id === it.id)) it.id = uid();
  b.items.push(it);
  return { ok: true };
}
// Remplacé par un équivalent (swapCandidates de js/data/food-swap.js : même règle, même liste que l'app) dans le plan
function deskDtSwap(day, mealId, itemId, cand) {
  const m = deskDtMeal(day, mealId), j = m ? m.items.findIndex(x => x.id === itemId) : -1;
  const nu = j >= 0 ? dietSwapItem(m.items[j], cand) : null;
  if (!nu) return null;
  m.items[j] = nu;
  return nu;
}

// ── Jours et objectifs ──

// Organisation des jours ('one', 'session', 'week') : dietSetDayMode de l'app (copies du jour 1, mêmes identifiants)
function deskDtSetMode(plan, mode) {
  if ((plan.days?.mode || 'one') === mode) return false;
  dietSetDayMode(plan, mode);
  return true;
}
// Semaine : jour d'entraînement (t) ou de repos (r)
function deskDtSetKind(plan, i, kind) {
  if (plan.days?.mode !== 'week' || i < 0 || i > 6 || !['t', 'r'].includes(kind)) return false;
  plan.days.kinds[i] = kind;
  return true;
}
// Objectifs saisis (dietTargetsFromForm : mêmes règles et mêmes messages que la feuille de l'app, sans g/kg : le poids
// du coach ne vaut pas pour ses élèves) → { ok } ou { err, field }
function deskDtSetTargets(day, raw) {
  const r = dietTargetsFromForm(raw);
  if (r.err) return r;
  if (r.targets) day.targets = r.targets; else delete day.targets;
  return { ok: true };
}
// Bilan d'un jour : total prévu, objectifs, écart dit en clair (dietTargetGap), repère très bas (dietLowKcal)
function deskDtDaySummary(plan, i) {
  const o = dietDayObj(plan, i), view = { ...plan, meals: o.meals, targets: o.targets };
  if (!o.targets) delete view.targets;
  return { total: dietPlanMacros(o), targets: o.targets || null, gap: dietTargetGap(view, 'Les repas prévus'), low: dietLowKcal(view),
    meals: dietShownMeals(o).filter(m => m.items.length).length };
}
function deskDtSetConsigne(plan, text) {
  const c = cleanConsigne(text);
  if (c) plan.consigne = c; else delete plan.consigne;
}
function deskDtRename(plan, name) {
  const n = dietText(name, DIET_NAME_MAX);
  if (!n || !hasVisible(n)) return false;
  plan.name = n;
  return true;
}

// ── Envoi ──

// Plan prêt à partir, au format de l'app : coachDietPayload sur ce seul plan → { ok, progId, data } ou { ok: false, kind }
function deskDtPayload(id, plan) { return coachDietPayload({ dietPlans: { [id]: plan } }, id); }
// Jours loin de leur objectif (confirmation d'envoi, comme l'aperçu de l'app) : ['Mercredi : …']
function deskDtFarDays(plan) {
  return dietPlanDays(plan).map((o, i) => {
    const v = { ...plan, meals: o.meals, targets: o.targets };
    if (!o.targets) delete v.targets;
    const g = dietTargetGap(v, 'Les repas prévus', 0.05);
    return g ? (plan.days ? `${dietDayName(plan, i)} : ${g}` : g) : '';
  }).filter(Boolean);
}

// ── Écritures sur mon compte : opérations rejouées sur le document relu (deskDtApply) ──
// Chaque opération reçoit d = { dietPlans, dietFoods, dietFoodsGone } (comme data de l'app) et rend { ok, … } ou { kind }

// expectAt : date du plan à l'ouverture du brouillon ; si le plan du compte en a une autre, il a été modifié ailleurs
// entre-temps (brouillon périmé) : { kind: 'stale', current } et rien n'est écrit
function deskDtOpSave(id, plan, now = Date.now(), { expectAt } = {}) {
  return d => {
    if (!DIET_ID_RE.test(id)) return { kind: 'server' };
    const cur = d.dietPlans[id];
    if (expectAt !== undefined && expectAt !== null && (Number(cur?.updatedAt) || 0) !== expectAt) return { kind: 'stale', current: cur || null };
    const alive = Object.keys(d.dietPlans).filter(k => k !== id && d.dietPlans[k] && d.dietPlans[k].archived !== true);
    if (!d.dietPlans[id] || d.dietPlans[id].archived) { if (alive.length >= DIET_PLAN_MAX_COACH) return { kind: 'plans_full' }; }
    const p = cleanDietPlan(deskDtClone(plan));
    if (!p) return { kind: 'server' };
    delete p.fromCoach; delete p.archived; delete p.dropped;
    // Toujours au-delà de la date d'avant (horloge du PC en retard sur l'iPhone) : comme dietTouch de l'app
    p.updatedAt = Math.max(now, (Number(d.dietPlans[id]?.updatedAt) || 0) + 1);
    d.dietPlans[id] = p;
    return { ok: true, plan: p };
  };
}
// Supprimer = archiver (dietArchivePlan de l'app : la synchro par union ne le fait pas revenir), daté
function deskDtOpArchive(id, now = Date.now()) {
  return d => {
    if (!d.dietPlans[id]) return { kind: 'server' };
    d.dietPlans[id] = deskDtClone(d.dietPlans[id]);
    dietArchivePlan(d, id);
    dietTouch(d.dietPlans[id], now);
    return { ok: true };
  };
}
// Aliment perso créé : gardé (dietKeepOwnFood) ; plein → { kind: 'foods_full' } (le plan le garde quand même)
function deskDtOpKeepFood(food) { return d => (dietKeepOwnFood(d, food) ? { ok: true, food: d.dietFoods.find(x => x.id === food.id) || food } : { kind: 'foods_full' }); }
// Produit trouvé sur Open Food Facts : gardé comme un produit scanné (dietSaveScanned)
function deskDtOpKeepScanned(food) { return d => { const f = dietSaveScanned(d, food); return f ? { ok: true, food: f } : { kind: 'foods_full' }; }; }
// Retiré de Mes aliments (dietRemoveFood) : les plans gardent leurs valeurs
function deskDtOpRemoveFood(id) { return d => (dietRemoveFood(d, id) ? { ok: true } : { kind: 'server' }); }

// Rejoue op sur le document relu : → { ok, doc, result } ou { ok: false, kind }. Seules dietPlans, dietFoods et
// dietFoodsGone changent ; sans l'accord « Copier mes plans sur mon compte », rien n'est écrit (no_consent)
function deskDtApply(rawDoc, op) {
  if (!rawDoc || typeof rawDoc !== 'object' || Array.isArray(rawDoc)) return { ok: false, kind: 'no_doc' };
  if (rawDoc.dietConsent?.on !== true) return { ok: false, kind: 'no_consent' };
  if (!(Number(rawDoc.dietSyncV) >= DESK_DT_SYNC_V)) return { ok: false, kind: 'old_phone' };
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const d = { dietPlans: { ...obj(rawDoc.dietPlans) }, dietFoods: Array.isArray(rawDoc.dietFoods) ? rawDoc.dietFoods.slice() : [],
    dietFoodsGone: Array.isArray(rawDoc.dietFoodsGone) ? rawDoc.dietFoodsGone.slice() : [] };
  const result = op(d);
  if (!result?.ok) return { ok: false, kind: result?.kind || 'server', ...(result?.current !== undefined ? { current: result.current } : {}) };
  const doc = { ...rawDoc, dietPlans: d.dietPlans };
  if (Array.isArray(d.dietFoods) && d.dietFoods.length) doc.dietFoods = d.dietFoods; else delete doc.dietFoods;
  if (Array.isArray(d.dietFoodsGone) && d.dietFoodsGone.length) doc.dietFoodsGone = d.dietFoodsGone; else delete doc.dietFoodsGone;
  if (new TextEncoder().encode(JSON.stringify(doc)).length > DESK_DT_DOC_MAX) return { ok: false, kind: 'doc_too_big' };
  return { ok: true, doc, result };
}

// Textes des erreurs propres à l'éditeur (les autres : coachErrorText, deskErrorText)
const DESK_DT_ERRORS = {
  no_consent: 'Tes plans ne sont pas copiés sur ton compte : active « Copier mes plans sur mon compte » dans l\'app (Nutrition › Réglages de la nutrition) pour les enregistrer ici. Tu peux quand même envoyer ce plan.',
  no_doc: 'Ton compte n\'a pas encore été synchronisé depuis l\'app iPhone : ouvre l\'app une fois, puis réessaie.',
  conflict: 'Ton compte vient d\'être modifié depuis un autre appareil : réessaie dans un instant.',
  plans_full: `${DIET_PLAN_MAX_COACH} plans au plus : supprimes-en un d'abord.`,
  foods_full: `Mes aliments est plein (${DIET_FOODS_MAX}) : l'aliment va au repas sans y être gardé.`,
  doc_too_big: 'Ton compte approche de sa taille limite : supprime des plans dont tu ne te sers plus avant d\'en garder un nouveau (sinon l\'iPhone ne pourrait plus y copier les siens).',
  old_phone: 'Mets l\'app à jour sur ton iPhone (et ouvre-la une fois) avant de modifier tes plans ici : une version plus ancienne pourrait remettre ses anciens plans. Tu peux déjà composer et envoyer un plan.',
  stale: 'Ce plan a été modifié depuis un autre appareil.',
  empty: 'Entre un nom.',
  taken: 'Un repas porte déjà ce nom.',
  full: `${DIET_ITEM_MAX} aliments au plus par repas.`,
};
