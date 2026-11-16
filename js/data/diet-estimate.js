// ═══════════════════════════════════════════════════════════
//  Objectifs du jour : proposition estimée et protéines en g/kg (fonctions pures, docs/NUTRITION_V1.md,
//  « Objectifs du jour »)
//
//  - La saisie reste au centre : la proposition est un point de départ, jamais imposée (la personne la
//    retouche ou l'ignore ; un plan reçu d'un coach garde les objectifs du coach).
//  - Métabolisme de base : Mifflin-St Jeor (1990), homme 10 P + 6,25 T − 5 A + 5, femme … − 161.
//  - Dépense du jour : métabolisme × facteur d'activité (1,2 / 1,375 / 1,55 / 1,725).
//  - Objectif : prise de masse + 10 %, maintien, sèche − 15 % ; jamais sous le métabolisme de base ni sous
//    1 200 kcal (DIET_LOW_KCAL).
//  - Protéines 1,8 g/kg (2,2 en sèche), lipides 0,9 g/kg et au moins 20 % de l'énergie, glucides : le reste.
//  - Entrées hors bornes (adulte de 18 à 80 ans, 130 à 220 cm, 35 à 250 kg) : null, rien n'est proposé.
// ═══════════════════════════════════════════════════════════
'use strict';

const DIET_EST_ACTIVITY = {
  low: { f: 1.2, label: 'Peu ou pas de sport' },
  light: { f: 1.375, label: '1 à 3 séances par semaine' },
  mid: { f: 1.55, label: '3 à 5 séances par semaine' },
  high: { f: 1.725, label: '6 séances ou plus par semaine' },
};
const DIET_EST_GOALS = {
  gain: { k: 0.10, p: 1.8, label: 'Prise de masse' },
  keep: { k: 0, p: 1.8, label: 'Maintien' },
  cut: { k: -0.15, p: 2.2, label: 'Sèche' },
};
const DIET_EST_FAT_PER_KG = 0.9;
const DIET_EST_FAT_MIN_SHARE = 0.2;
const DIET_EST_BOUNDS = { age: [18, 80], cm: [130, 220], kg: [35, 250] };
// Ratio de protéines saisi en g/kg : de 0,5 à 4 g/kg (au-delà, une faute de frappe plus qu'un choix)
const DIET_PKG_BOUNDS = [0.5, 4];

// Métabolisme de base (kcal/jour), Mifflin-St Jeor ; null si une entrée est hors bornes
function dietBmr(o) {
  const { sex, kg, cm, age } = o || {};
  const ok = (v, [lo, hi]) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (sex !== 'male' && sex !== 'female') return null;
  if (!ok(kg, DIET_EST_BOUNDS.kg) || !ok(cm, DIET_EST_BOUNDS.cm) || !ok(age, DIET_EST_BOUNDS.age)) return null;
  return 10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161);
}

// Proposition complète : { kcal, p, c, f, bmr, tdee, why } (valeurs arrondies : kcal à 10 près, grammes à l'unité),
// null si une entrée manque ou sort des bornes. why, whyMacros : l'explication (calories, puis macros), affichée telle quelle
function dietEstimate(o) {
  const { sex, kg, cm, age, activity, goal } = o || {};
  const bmr = dietBmr({ sex, kg, cm, age });
  const act = Object.hasOwn(DIET_EST_ACTIVITY, activity ?? '') ? DIET_EST_ACTIVITY[activity] : null;
  const g = Object.hasOwn(DIET_EST_GOALS, goal ?? '') ? DIET_EST_GOALS[goal] : null;
  if (bmr === null || !act || !g) return null;
  const tdee = bmr * act.f;
  const kcal = Math.round(Math.max(tdee * (1 + g.k), bmr, DIET_LOW_KCAL) / 10) * 10;
  const p = Math.round(kg * g.p);
  const f = Math.round(Math.max(kg * DIET_EST_FAT_PER_KG, (kcal * DIET_EST_FAT_MIN_SHARE) / 9));
  const c = Math.max(0, Math.round((kcal - 4 * p - 9 * f) / 4));
  const tdeeR = Math.round(tdee / 10) * 10;
  const change = g.k > 0 ? ` + ${Math.round(g.k * 100)} %` : g.k < 0 ? ` − ${Math.round(-g.k * 100)} %` : '';
  const why = `${fmtNum(kcal)} kcal = besoins estimés (${fmtNum(tdeeR)} kcal)${change}`;
  const whyMacros = `Protéines ${fmtNum(g.p, 1)} g/kg · lipides ${fmtNum(DIET_EST_FAT_PER_KG, 1)} g/kg · glucides : le reste`;
  return { kcal, p, c, f, bmr: Math.round(bmr), tdee: tdeeR, why, whyMacros };
}

// Protéines : g/kg → grammes (arrondis à l'unité), null si le ratio ou le poids est invalide
function dietProteinGrams(perKg, kg) {
  const r = num(perKg, DIET_PKG_BOUNDS[0], DIET_PKG_BOUNDS[1]);
  if (r === null || !(typeof kg === 'number' && kg >= DIET_EST_BOUNDS.kg[0] && kg <= DIET_EST_BOUNDS.kg[1])) return null;
  return Math.round(r * kg);
}
// Grammes → g/kg à 0,1 près (affichage), null sans poids ou sans grammes
function dietProteinPerKg(g, kg) {
  if (!(g > 0) || !(typeof kg === 'number' && kg >= DIET_EST_BOUNDS.kg[0] && kg <= DIET_EST_BOUNDS.kg[1])) return null;
  return Math.round((g / kg) * 10) / 10;
}
