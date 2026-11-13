// ═══════════════════════════════════════════════════════════
//  Base d'aliments et équivalences (Nutrition V1, docs/NUTRITION_V1.md) : logique pure, sans affichage
//
//  - Base : data/foods.json, tirée de la table Ciqual 2025 de l'Anses par scripts/prepare-foods.py
//    (Licence Ouverte Etalab 2.0, source et version citées dans l'app). Lue à la première ouverture d'un
//    écran de nutrition (loadFoods), jamais au démarrage ; en cache hors ligne (sw.js).
//  - Recherche : chaque mot tapé doit commencer un mot du nom (accents et casse ignorés) ; mes aliments
//    perso d'abord, puis les noms courts (« Riz blanc, cuit » avant les plats préparés).
//  - Équivalence d'un aliment (règle unique, testée par tests/unit/nutrition.mjs) :
//      1. même famille d'aliments (viandes et poissons, féculents, laitiers, fruits…) ;
//      2. quantité recalculée pour garder la même chose que l'original : les protéines pour une source
//         de protéines (viandes, poissons, œufs, laitiers), les calories pour tout le reste ;
//      3. gardé seulement si les macros restent proches à cette quantité : calories à 15 % près (30 kcal
//         au moins), protéines, glucides et lipides chacun à 25 % près (5 g au moins), quantité entre le
//         quart et le quadruple de l'original ;
//      4. classé par écart pondéré par l'énergie (1 kcal, 4 par g de protéines ou glucides, 9 par g de
//         lipides, 2 par g de sucres quand la base les connaît), avec des pénalités fixes : autre rayon
//         de Ciqual (riz contre céréales soufflées), l'un cru et l'autre cuit ; un aliment courant
//         (SWAP_COMMON : poulet, riz, flocons d'avoine…) passe devant, les abats et les variantes (bio, sans gluten) après, puis les noms courts ;
//      5. dix au plus, deux par premier mot du nom (variété : riz, pâtes, puis semoule, pommes de terre…).
// ═══════════════════════════════════════════════════════════
'use strict';

const FOODS_URL = 'data/foods.json';
const SWAP_LIMIT = 10;
const SWAP_PER_WORD = 2;
const SWAP_KCAL_TOL = { rel: 0.15, abs: 30 };
const SWAP_MACRO_TOL = { rel: 0.25, abs: 5 };
const SWAP_RATIO = { min: 0.25, max: 4 };
const SWAP_STATE_PENALTY = 60;
const SWAP_GROUP_PENALTY = 25;
const SWAP_ALCOHOL_GRP = 603;   // boissons alcoolisées
const SWAP_COMMON_BONUS = 15;
// Premiers mots (sans accents) des aliments qu'on trouve partout : proposés avant les plus rares
const SWAP_COMMON = ['poulet', 'dinde', 'boeuf', 'veau', 'porc', 'jambon', 'thon', 'saumon', 'cabillaud', 'colin', 'merlu', 'crevette', 'oeuf',
  'riz', 'pates', 'pomme de terre', 'patate douce', 'pain', 'avoine', 'flocons d avoine', 'quinoa', 'semoule', 'boulgour', 'lentille', 'pois chiche',
  'haricot', 'galette', 'banane', 'pomme', 'poire', 'orange', 'fraise', 'kiwi', 'fromage blanc', 'yaourt', 'lait', 'skyr', 'mozzarella', 'emmental',
  'amande', 'noix', 'noisette', 'cacahuete', 'beurre de cacahuete', 'huile d olive', 'huile de colza', 'beurre', 'avocat', 'brocoli',
  'haricots verts', 'courgette', 'tomate', 'carotte', 'epinard', 'salade', 'tofu'];
const swapCommon = key => SWAP_COMMON.some(w => key === w || key.startsWith(w + ' '));
// Abats et morceaux rares : proposés après les autres
const SWAP_RARE = /\b(queue|pied|gesier|ris|langue|cervelle|rognon|tripes?|joue|coeur|hachage|tete|oreille|museau|abats?)\b/;
const SWAP_RARE_PENALTY = 20;
// Variantes (sans gluten, bio, label rouge, enrichi) : après le produit de base
const SWAP_VARIANT = /\b(sans gluten|bio|label rouge|enrichie?s?)\b/;
const SWAP_VARIANT_PENALTY = 12;
// Familles dont on garde les protéines (sinon les calories) ; aides culinaires jamais remplacées
const SWAP_PROTEIN_FAMS = ['v', 'l'];
const SWAP_NONE_FAMS = ['a'];
const FOOD_FAM_LABEL = { v: 'Viandes, poissons, œufs', f: 'Féculents', l: 'Produits laitiers', g: 'Matières grasses',
  r: 'Fruits', e: 'Légumes', s: 'Produits sucrés', b: 'Boissons', p: 'Plats composés', a: 'Aides culinaires' };

let foodDb = null;          // { meta, foods: [{ code, name, fam, per, key }], byCode }
let foodDbPromise = null;

const foodKey = name => normName(String(name ?? '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae')).replace(/[^a-z0-9%]+/g, ' ').trim();

// Fichier de la base nettoyé : chaque ligne invalide est ignorée seule
function cleanFoodDb(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.foods)) return null;
  const foods = [], byCode = new Map();
  for (const r of raw.foods) {
    if (!Array.isArray(r) || r.length < 7) continue;
    const [code, name, fam, k, p, c, f, sugar, grp, ecalc] = r;
    const per = cleanDietPer({ k, p, c, f });
    if (!Number.isInteger(code) || code <= 0 || typeof name !== 'string' || !name.trim() || !DIET_FAMS.includes(fam) || !per || byCode.has(code)) continue;
    const food = { code, name: name.trim(), fam, per, key: foodKey(name),
      sugar: typeof sugar === 'number' && sugar >= 0 && sugar <= 100 ? sugar : null, grp: Number.isInteger(grp) ? grp : null,
      ...(ecalc === 1 ? { ecalc: true } : {}) };
    foods.push(food);
    byCode.set(code, food);
  }
  const s = v => (typeof v === 'string' ? v.slice(0, 200) : '');
  return { meta: { source: s(raw.source), version: s(raw.version), licence: s(raw.licence), url: /^https:\/\//.test(raw.url || '') ? s(raw.url) : '' }, foods, byCode };
}
function setFoodDb(raw) { foodDb = cleanFoodDb(raw); return foodDb; }
// Chargée une fois ; renvoie la base, ou null si le fichier manque (l'écran le dit, les plans restent lisibles)
function loadFoods() {
  if (foodDb) return Promise.resolve(foodDb);
  foodDbPromise ||= fetch(FOODS_URL).then(r => (r.ok ? r.json() : null)).then(setFoodDb)
    .catch(() => null).finally(() => { foodDbPromise = null; });
  return foodDbPromise;
}

// ── Recherche ───────────────────────────────────────────────

// Score d'un nom pour des mots tapés (0 : aucun lien). Chaque mot doit commencer un mot du nom
function foodMatchScore(key, words) {
  if (!words.length) return 0;
  const parts = key.split(' ');
  let score = 0;
  for (const w of words) {
    const i = parts.findIndex(p => p.startsWith(w));
    if (i < 0) return 0;
    score += (parts[i] === w ? 3 : 2) + (i === 0 ? 4 : 0);
  }
  return score * 100 - key.length;
}
// [{ food, own }] : mes aliments perso (own) puis ceux de la base, les meilleurs d'abord
function searchFoods(query, { limit = 40, own = [] } = {}) {
  const words = foodKey(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  // Mes aliments d'abord, seulement s'ils correspondent (avant : tous listés à chaque recherche, « Skyr » pour « riz »)
  const mine = own.map(x => { const m = foodMatchScore(foodKey(x.name), words); return { food: dietOwnPick(x), own: true, score: m > 0 ? m + 100000 : 0 }; });
  const base = (foodDb?.foods || []).map(f => ({ food: f, own: false, score: foodMatchScore(f.key, words) }));
  return [...mine, ...base].filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name, 'fr')).slice(0, limit);
}
// Aliment choisi → aliment du plan (valeurs pour 100 g recopiées)
function foodToItem(food, g, por = null) {
  return cleanDietItem({ name: food.name, food: food.code || null, fam: food.fam, g, per: food.per,
    src: food.code ? 'ciqual-2025' : food.src === 'off' ? 'off' : 'perso', ecalc: food.ecalc === true, ...(por ? { por } : {}) });
}

// ── Équivalences ────────────────────────────────────────────

// Grandeur gardée par le remplacement : 'p' (protéines) ou 'kcal'
function swapAnchor(item) {
  return SWAP_PROTEIN_FAMS.includes(item.fam) && item.per.p >= 5 ? 'p' : 'kcal';
}
const swapAnchorOf = (per, anchor) => (anchor === 'p' ? per.p : per.k);
// Quantité arrondie comme on la pèse : au gramme sous 50 g, aux 5 g au-dessus
function swapRoundG(g) { return g < 50 ? Math.max(1, Math.round(g)) : Math.round(g / 5) * 5; }
// Cru ou cuit d'après le nom Ciqual, null si le nom ne le dit pas
function foodState(name) {
  const k = foodKey(name).replace(/\bble dur\b/g, 'ble');   // « Semoule de blé dur, crue » : « dur » d'un œuf, pas du blé
  if (/\b(cuit|cuite|cuits|cuites|bouilli|bouillie|roti|rotie|grille|grillee|poele|poelee|vapeur|frit|frite|frites|braise|appertise|appertisee|dur|mollet|poche|brouille)\b/.test(k)) return 'cuit';
  // « Pâtes sèches, cuites » : cuites ; « Polenta précuite, à cuire », « Banane sèche » : pas encore cuites ou séchées
  if (/\ba cuire\b|\b(cru|crue|crus|crues|sec|seche|secs|seches|deshydrate|deshydratee|deshydrates)\b/.test(k)) return 'cru';
  return null;
}
// Étiquette « cru » ou « cuit » d'un résultat de recherche (pâtes, riz, viandes…), null quand le nom ne le dit pas.
// « Sec » ne vaut « cru » que pour un féculent (lentilles, pâtes sèches) : une banane sèche n'est pas crue
function foodCookTag(food) {
  const st = foodState(food?.name);
  if (st !== 'cru') return st;
  return /\ba cuire\b|\b(cru|crue|crus|crues)\b/.test(foodKey(food.name)) || food.fam === 'f' ? 'cru' : null;
}
// Nom sans les mots de la cuisson : « Riz blanc, cru » et « Riz blanc, cuit, sans sel ajouté » donnent « riz blanc »
const FOOD_COOK_WORDS = /\b(sans sel ajoute|a l eau|au four|a cuire|cuit|cuite|cuits|cuites|bouilli|bouillie|roti|rotie|grille|grillee|poele|poelee|vapeur|braise|cru|crue|crus|crues|sec|seche|secs|seches)\b/g;
const foodCookBase = name => foodKey(name).replace(/\bble dur\b/g, 'ble').replace(FOOD_COOK_WORDS, ' ').replace(/\s+/g, ' ').trim();
// Recherche qui nomme déjà la cuisson (« riz blanc cuit », « poulet cru ») : l'aliment choisi est la version voulue
const FOOD_COOK_WORD = new RegExp(FOOD_COOK_WORDS.source);   // sans /g : test() sans état
const foodQuerySaysCook = q => FOOD_COOK_WORD.test(foodKey(q || ''));
// Version crue d'un aliment cuit de la base, ou l'inverse (même nom sans la cuisson, même famille), null sans elle.
// Plusieurs (faux-filet grillé, rôti) : le nom le plus court. Sert au rappel « Pesé cuit ? » de la feuille de quantité
function foodCookTwin(food) {
  const tag = food?.code ? foodCookTag(food) : null;
  if (!tag || !foodDb) return null;
  const base = foodCookBase(food.name);
  if (!base) return null;
  let best = null;
  for (const f of foodDb.foods) {
    if (f.code === food.code || f.fam !== food.fam || foodCookTag(f) === tag || !foodCookTag(f) || foodCookBase(f.name) !== base) continue;
    if (!best || f.name.length < best.name.length) best = f;
  }
  return best;
}
// La recherche a-t-elle trouvé pile ce qui est tapé ? Un résultat contient chaque mot tapé en entier (« huile olive » :
// « Huile d'olive vierge extra » ; « riz bl », mot pas fini, ou « whey », absent : non)
function foodSearchExact(query, results) {
  const words = foodKey(query).split(' ').filter(Boolean);
  return words.length > 0 && results.some(x => { const parts = foodKey(x.food.name).split(' '); return words.every(w => parts.includes(w)); });
}
// Écarts du remplaçant (à sa quantité) avec l'original : { kcal, p, c, f }
function swapDelta(a, b) { return { kcal: b.kcal - a.kcal, p: b.p - a.p, c: b.c - a.c, f: b.f - a.f }; }
const swapWithin = (delta, ref, tol) => Math.abs(delta) <= Math.max(tol.abs, tol.rel * ref);
// Remplaçants proposés pour un aliment du plan : [{ food, g, macros, delta, score }], les meilleurs d'abord
function swapCandidates(item, { limit = SWAP_LIMIT, own = [] } = {}) {
  if (!item?.per || SWAP_NONE_FAMS.includes(item.fam)) return [];
  const anchor = swapAnchor(item), ref = dietItemMacros(item);
  const aRef = swapAnchorOf(item.per, anchor);
  if (!(aRef > 0) || !(ref.kcal > 0)) return [];
  const state = foodState(item.name), name = foodKey(item.name);
  // Sucres et rayon de l'original : ceux de la base quand il en vient (un aliment perso n'en a pas)
  const base = item.food ? foodDb?.byCode.get(item.food) : null;
  const refSugar = base?.sugar != null ? base.sugar * item.g / 100 : null, grp = base?.grp ?? null;
  const pool = [...own.map(x => ({ code: null, name: x.name, fam: x.fam, per: x.per, key: foodKey(x.name), ownId: x.id })), ...(foodDb?.foods || [])];
  const out = [];
  for (const f of pool) {
    if (f.fam !== item.fam || (item.food && f.code === item.food) || f.key === name) continue;
    // Boissons alcoolisées (sous-groupe Ciqual 603) : jamais croisées avec les autres boissons, dans aucun sens
    if ((grp === SWAP_ALCOHOL_GRP) !== (f.grp === SWAP_ALCOHOL_GRP)) continue;
    const a = swapAnchorOf(f.per, anchor);
    if (!(a >= (anchor === 'p' ? 5 : 10))) continue;
    const g = swapRoundG(item.g * aRef / a);
    if (g < 5 || g > DIET_G_MAX || g < item.g * SWAP_RATIO.min || g > item.g * SWAP_RATIO.max) continue;
    const macros = dietItemMacros({ g, per: f.per }), delta = swapDelta(ref, macros);
    if (!swapWithin(delta.kcal, ref.kcal, SWAP_KCAL_TOL)) continue;
    if (!['p', 'c', 'f'].every(k => swapWithin(delta[k], ref[k], SWAP_MACRO_TOL))) continue;
    const fs = foodState(f.name);
    const sugar = refSugar != null && f.sugar != null ? 2 * Math.abs(f.sugar * g / 100 - refSugar) : 0;
    const score = Math.abs(delta.kcal) + 4 * Math.abs(delta.p) + 4 * Math.abs(delta.c) + 9 * Math.abs(delta.f) + sugar
      + (state && fs && state !== fs ? SWAP_STATE_PENALTY : 0) + (grp && f.grp && grp !== f.grp ? SWAP_GROUP_PENALTY : 0)
      - (swapCommon(f.key) ? SWAP_COMMON_BONUS : 0) + (SWAP_RARE.test(f.key) ? SWAP_RARE_PENALTY : 0)
      + (SWAP_VARIANT.test(f.key) && !SWAP_VARIANT.test(name) ? SWAP_VARIANT_PENALTY : 0) + f.name.length / 10;
    out.push({ food: f, g, macros, delta, score });
  }
  // Variété : deux au plus par premier mot (« Riz… », « Pâtes… »), pour proposer aussi semoule ou pommes de terre
  const perWord = new Map();
  return out.sort((x, y) => x.score - y.score).filter(x => {
    const w = x.food.key.split(' ')[0], n = perWord.get(w) || 0;
    perWord.set(w, n + 1);
    return n < SWAP_PER_WORD;
  }).slice(0, limit);
}
// Texte d'un écart : « +12 kcal », « −3 g » (signe moins typographique), « = » à l'arrondi près
function swapDeltaText(v, unit) {
  const r = Math.round(v);
  return r === 0 ? '=' : `${r > 0 ? '+' : '−'}${Math.abs(r)} ${unit}`;
}
function swapRuleText(item) {
  return swapAnchor(item) === 'p' ? 'Même quantité de protéines' : 'Mêmes calories';
}
