// ═══════════════════════════════════════════════════════════
//  Portions courantes : « 2 œufs » plutôt que « 100 g » (docs/NUTRITION_V1.md, « Quantités à l'unité »). Logique pure.
//
//  - La quantité reste TOUJOURS stockée en grammes (it.g : macros, coach, synchro, anciennes versions de l'app) ;
//    l'unité choisie s'ajoute à côté, pour l'affichage seulement : it.por = { n, u, pl, g } (n unités de g grammes,
//    nettoyée par cleanDietPortion dans js/data/nutrition.js). Une version qui ignore it.por affiche « 100 g ».
//  - Aliments de la table Ciqual : portions usuelles ci-dessous, reliées par motif de nom (FOOD_PORTIONS). Poids
//    moyens « environ » : tailles de portions usuelles de l'Anses et poids courants du commerce.
//  - Produit scanné (Open Food Facts) : unité du paquet (« 1 pot (125 g) », « 4 x 125 g ») tirée de serving_size,
//    quantity et serving_quantity (offPortion), gardée dans l'aliment perso (food.portion).
//  - Aliment perso créé à la main : « poids d'une portion » facultatif (food.portion, unité « portion »).
// ═══════════════════════════════════════════════════════════
'use strict';

const PORTION_N_MAX = 50;   // unités au plus dans une quantité (50 œufs : déjà hors de tout repas)
const PORTION_U_MAX = 30;   // longueur d'un nom d'unité (« cuillère à soupe »)

// Clé de comparaison d'un nom : minuscules, sans accents, œ → oe, ponctuation → espace
const portionKey = name => String(name ?? '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

// Unités usuelles : u (singulier), pl (pluriel), g (poids d'une unité, partie mangée), half (½ permis).
// re : motif sur la clé du nom (portionKey) ; not : exclusions. Première ligne qui correspond : la bonne
// s : nom court du bouton (« c. à soupe »), le nom entier reste dans la quantité affichée
const U = (u, pl, g, half = false, s = '') => ({ u, pl, g, ...(half ? { half: true } : {}), ...(s ? { s } : {}) });
const FOOD_PORTIONS = [
  // Œufs (calibre moyen, sans coquille)
  { re: /^oeuf (blanc|jaune) .*(cru|cuit)$/, units: m => [m[1] === 'blanc' ? U('blanc d’œuf', 'blancs d’œufs', 30) : U('jaune d’œuf', 'jaunes d’œufs', 18)] },
  { re: /^oeuf (cru|dur|poche|a la coque|au plat|brouille)/, units: [U('œuf', 'œufs', 50)] },
  { re: /^oeufs? (frais|extra frais|plein air|bio|de poules?|fermiers?|moyens?|gros|label)\b|^(\d+ )?oeufs?$/, units: [U('œuf', 'œufs', 50)] },
  // Laitages en pot
  { re: /\ba boire\b/, units: [] },
  { re: /petit suisse/, units: [U('petit-suisse', 'petits-suisses', 60)] },
  { re: /^fromage blanc(?! fondu)/, units: [U('pot', 'pots', 100)] },
  { re: /^(yaourt|lait fermente type yaourt|specialite laitiere|skyr)\b|\bskyr\b/, units: [U('pot', 'pots', 125)] },
  { re: /^compote\b|^puree de (pommes|fruits)/, units: [U('pot', 'pots', 100)] },
  // Viennoiseries et pains
  { re: /^croissant (sans precision|ordinaire|pur beurre)/, units: [U('croissant', 'croissants', 60)] },
  { re: /^croissant aux amandes/, units: [U('croissant', 'croissants', 90)] },
  { re: /^pain au chocolat/, units: [U('pain au chocolat', 'pains au chocolat', 70)] },
  { re: /^pain aux raisins/, units: [U('pain aux raisins', 'pains aux raisins', 100)] },
  { re: /^pain au lait/, units: [U('pain au lait', 'pains au lait', 35)] },
  { re: /^brioche/, units: [U('brioche individuelle', 'brioches individuelles', 50, false, 'brioche'), U('tranche', 'tranches', 35)] },
  { re: /^madeleine/, units: [U('madeleine', 'madeleines', 25)] },
  { re: /^pain de mie(?! .*sandwich)/, units: [U('tranche', 'tranches', 25)] },
  { re: /^pain (aliment moyen|blanc|de tradition)/, units: [U('baguette', 'baguettes', 250, true), U('tranche', 'tranches', 30)] },
  { re: /^pain (de campagne|complet|bis|au levain|aux cereales|au son|de seigle)/, units: [U('tranche', 'tranches', 30)] },
  { re: /^baguette\b/, units: [U('baguette', 'baguettes', 250, true)] },
  // Sandwichs
  { re: /^sandwich (baguette|grec ou kebab baguette)|^jambon beurre/, units: [U('sandwich', 'sandwichs', 280)] },
  { re: /^sandwich panini|^panini\b/, units: [U('panini', 'paninis', 200)] },
  { re: /^pain panini/, units: [U('pain panini', 'pains panini', 90)] },
  { re: /^sandwich pain de mie/, units: [U('sandwich', 'sandwichs', 130)] },
  { re: /^wrap\b/, units: [U('wrap', 'wraps', 180)] },
  // Fruits (partie mangée)
  { re: /^banane chair/, units: [U('banane', 'bananes', 120)] },
  { re: /^pomme chair/, units: [U('pomme', 'pommes', 150)] },
  { re: /^poire chair/, units: [U('poire', 'poires', 150)] },
  { re: /^orange chair/, units: [U('orange', 'oranges', 150)] },
  { re: /^kiwi\b/, units: [U('kiwi', 'kiwis', 75)] },
  { re: /^clementine|^mandarine/, units: [U('clémentine', 'clémentines', 60)] },
  // Viandes
  { re: /^jambon cuit/, units: [U('tranche', 'tranches', 40)] },
  { re: /^jambon (cru|sec|de bayonne|de parme)/, units: [U('tranche', 'tranches', 15)] },
  { re: /steak hache/, units: [U('steak de 100 g', 'steaks de 100 g', 100, false, 'steak 100 g'), U('steak de 125 g', 'steaks de 125 g', 125, false, 'steak 125 g')] },
  { re: /^poulet filet|^filet de poulet/, units: [U('filet', 'filets', 150)] },
  { re: /^dinde escalope|^escalope de dinde/, units: [U('escalope', 'escalopes', 120)] },
  // Divers
  { re: /^chocolat (noir|au lait|blanc|tablette)/, units: [U('carré', 'carrés', 5)] },
  { re: /^huile(?! ou beurre)/, units: [U('cuillère à soupe', 'cuillères à soupe', 10, false, 'c. à soupe'), U('cuillère à café', 'cuillères à café', 5, false, 'c. à café')] },
  { re: /\bwhey\b|proteines? en poudre|poudre de proteines?/, units: [U('dose', 'doses', 30)] },
];

// Unités d'un aliment ([] si aucune) : celle gardée avec l'aliment (paquet scanné, portion saisie) d'abord,
// puis celles de la table. food : { name, portion? } (aliment de la recherche, aliment perso ou aliment du plan)
function foodPortions(food) {
  const own = cleanFoodPortion(food?.portion);
  // « Marque · Nom » (produit scanné) : le nom seul, sans la marque
  const key = portionKey(String(food?.name ?? '').split(' · ').pop());
  let table = [];
  for (const row of FOOD_PORTIONS) {
    const m = key.match(row.re);
    if (m) { table = typeof row.units === 'function' ? row.units(m) : row.units; break; }
  }
  const out = own ? [own] : [];
  // about : poids moyen de la table (« environ 50 g ») ; l'unité d'un paquet ou saisie est exacte
  for (const u of table) if (out.length < 2 && !out.some(x => x.u === u.u)) out.push({ ...u, about: true });
  return out;
}

// Unité gardée avec un aliment perso : { u, pl, g, half? }, null si illisible
function cleanFoodPortion(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const t = v => (typeof v === 'string' ? v.replace(/[ \t\r\n]+/g, ' ').trim() : '');   // espaces insécables gardés
  const u = t(p.u), pl = t(p.pl) || u, g = typeof p.g === 'number' && Number.isFinite(p.g) ? Math.round(p.g * 10) / 10 : NaN;
  if (!u || u.length > PORTION_U_MAX || pl.length > PORTION_U_MAX + 4 || !(g >= 1 && g <= 2000) || /[<>]/.test(u + pl)) return null;
  return { u, pl, g, ...(p.half === true ? { half: true } : {}) };
}

// Nombre d'unités affiché : « ½ », « 1 », « 1 ½ », « 2,5 » ne sort pas (pas de ½ : entier)
function portionNText(n) {
  const whole = Math.floor(n), half = Math.abs(n - whole - 0.5) < 0.01;
  if (half) return whole ? `${whole} ½` : '½';
  return String(Math.round(n));
}
// Nom de l'unité accordé : pluriel à partir de 2 (règle française : « 1 ½ baguette », « 2 baguettes »)
const portionUnitWord = (n, p) => (n >= 2 ? p.pl : p.u);
// « 2 œufs », « ½ baguette »
function portionText(n, p) { return `${portionNText(n)} ${portionUnitWord(n, p)}`; }
// Lu par VoiceOver : « 2 œufs », « une demie baguette » ; « 1 ½ baguette » → « 1 baguette et demie »
function portionSpoken(n, p) {
  const whole = Math.floor(n), half = Math.abs(n - whole - 0.5) < 0.01;
  if (!half) return `${Math.round(n)} ${portionUnitWord(n, p)}`;
  return whole ? `${whole} ${portionUnitWord(n, p)} et demie` : `une demie ${p.u}`;
}
// Grammes de n unités (arrondis au gramme, comme it.g)
const portionGrams = (n, p) => Math.round(n * p.g);
// Pas d'une unité : ½ pour la baguette, 1 sinon ; n ramené au pas, entre un pas et PORTION_N_MAX
function portionStep(p) { return p?.half ? 0.5 : 1; }
function portionClampN(n, p) {
  const s = portionStep(p);
  return Math.min(PORTION_N_MAX, Math.max(s, Math.round(n / s) * s));
}

// ── Open Food Facts : unité du paquet ───────────────────────

const OFF_UNIT_WORD_RE = /^[a-zà-ÿœ' -]{2,24}$/i;
// Nombre écrit « 12,5 » ou « 12.5 »
const offPortionNum = s => Number(String(s).replace(',', '.'));
// Mot du paquet ramené au singulier (« 2 biscuits » → « biscuit ») ; pluriel simple pour l'affichage
function offUnitWords(word, n) {
  let u = word.toLowerCase().replace(/\s+/g, ' ').trim();
  if (n >= 2) u = u.replace(/(?<=\w)(s|x)$/, '');
  return { u, pl: /[sxz]$/.test(u) ? u : `${u}s` };
}
// { u, pl, g } ou null. pr : produit d'Open Food Facts (serving_size, serving_quantity, quantity, nom)
function offPortion(pr, name = '') {
  const t = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const ok = p => cleanFoodPortion(p);
  // 1. « 1 pot (125 g) », « 2 biscuits (25g) », « 1 tranche (40 g) »
  const ss = t(pr?.serving_size).match(/^(\d+(?:[.,]\d+)?)?\s*([a-zà-ÿœ' -]+?)\s*\(\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\s*\)/i);
  if (ss && OFF_UNIT_WORD_RE.test(ss[2]) && !/^(g|ml|portion de)$/i.test(ss[2].trim())) {
    const n = ss[1] ? offPortionNum(ss[1]) : 1, g = offPortionNum(ss[3]);
    if (n >= 1 && n <= 20 && g > 0) { const p = ok({ ...offUnitWords(ss[2], n), g: g / n }); if (p) return p; }
  }
  // 2. Paquet de plusieurs unités : « 4 x 125 g » ; l'unité prend le nom de la table (pot, croissant), sinon « unité »
  const mp = t(pr?.quantity).match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i);
  if (mp && Number(mp[1]) >= 2) {
    const g = offPortionNum(mp[2]), known = foodPortions({ name })[0];
    const p = ok(known ? { u: known.u, pl: known.pl, g } : { u: 'unité', pl: 'unités', g });
    if (p) return p;
  }
  // 3. Nom connu de la table (« 6 œufs frais » : l'œuf moyen)
  const known = foodPortions({ name })[0];
  if (known) return ok(known);
  // 4. Portion indiquée (« 30 g ») ; 100 g n'en est pas une (valeur par défaut de beaucoup de fiches)
  const sq = typeof pr?.serving_quantity === 'number' ? pr.serving_quantity : offPortionNum(t(pr?.serving_quantity) || 'x');
  if (Number.isFinite(sq) && sq >= 1 && sq <= 2000 && sq !== 100) return ok({ u: 'portion', pl: 'portions', g: sq });
  return null;
}
