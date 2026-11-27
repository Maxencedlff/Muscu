// ═══════════════════════════════════════════════════════════
//  Formules d'abonnement (Payant V1, tarifs du 30/10/2026) : catalogue et calculs, sans affichage
//
//  - Contrat : docs/PAYANT_V1.md. Tous les produits sont dans le MÊME groupe d'abonnement d'App Store
//    Connect : passer d'un palier coach à l'autre, ou du particulier au coach, est une montée ou une
//    descente chez Apple (pas un second abonnement), et l'essai de 3 mois ne sert qu'une fois par
//    identifiant Apple pour tout le groupe.
//  - Ce fichier ne contient AUCUN PRIX : ils sont lus chez StoreKit (displayPrice). Depuis le 16/11/2026,
//    les élèves d'un coach ne paient rien (l'abonnement coach les comprend, docs/PAYANT_V1.md) : il n'y a
//    plus d'offre élève ni de prix écrit dans l'app.
//  - « soit <prix> par mois » et « <n> % moins cher » sont CALCULÉS (prix lus chez StoreKit). Avant le 27/11 :
//    « soit 8,5 mois », que les juges ne comprenaient pas.
//  - Paliers coach (grille du 17/11/2026) : limite d'élèves suivis 10, 25, 50, 100 ; au-delà de 100, pas
//    d'achat : « Plus de 100 élèves : écris-nous » (PLAN_COACH_CONTACT). Le serveur fait foi
//    (coach_tier_state, refus tier_full) ; ici on ne fait que choisir quoi montrer.
// ═══════════════════════════════════════════════════════════
'use strict';

const PLAN_PREFIX = 'com.mdlf.training.';
// Particulier (limit null : sans objet), puis les paliers coach du plus petit au plus grand.
const PLAN_TIERS = Object.freeze([
  Object.freeze({ key: 'pro',      coach: false, limit: null, label: 'Particulier' }),
  Object.freeze({ key: 'coach10',  coach: true,  limit: 10,   label: '10 élèves' }),
  Object.freeze({ key: 'coach20',  coach: true,  limit: 25,   label: '25 élèves' }),
  Object.freeze({ key: 'coach30',  coach: true,  limit: 50,   label: '50 élèves' }),
  Object.freeze({ key: 'coachmax', coach: true,  limit: 100,  label: '100 élèves' }),
]);
// Au-delà du plus haut palier : pas de formule, on écrit (même phrase dans l'app et le contrat)
const PLAN_COACH_MAX = 100;
const PLAN_COACH_CONTACT = 'Plus de 100 élèves : écris-nous à contact@mdlf.app';
const PLAN_COACH_TIERS = PLAN_TIERS.filter(t => t.coach);
const planId = (key, period) => `${PLAN_PREFIX}${key}.${period === 'year' ? 'yearly' : 'monthly'}`;
// Tous les identifiants, dans l'ordre d'affichage (le même que ios/App/App/StorePlugin.swift)
const PLAN_IDS = Object.freeze(PLAN_TIERS.flatMap(t => [planId(t.key, 'month'), planId(t.key, 'year')]));

// Identifiant de l'app sur l'App Store (fiche de l'app, écran « Mets à jour l'app »)
const PLAN_APP_STORE_ID = '6823561962';

// Identifiant → { tier, period: 'month' | 'year' }, null si ce n'est pas une de nos formules
function planOf(id) {
  if (typeof id !== 'string' || !PLAN_IDS.includes(id)) return null;
  const [key, per] = id.slice(PLAN_PREFIX.length).split('.');
  return { tier: PLAN_TIERS.find(t => t.key === key), period: per === 'yearly' ? 'year' : 'month' };
}
function planIsCoach(id) { return !!planOf(id)?.tier.coach; }
// Palier coach conseillé pour n élèves : le plus petit qui les contient ; null au-delà de 100 (on écrit)
function planTierFor(students) {
  const n = Number.isInteger(students) && students > 0 ? students : 0;
  return PLAN_COACH_TIERS.find(t => n <= t.limit) || null;
}
// Palier coach suivant (montée de palier), null au plafond ou hors coach
function planNextTier(id) {
  const p = planOf(id);
  if (!p || !p.tier.coach) return PLAN_COACH_TIERS[0];
  const i = PLAN_COACH_TIERS.indexOf(p.tier);
  return PLAN_COACH_TIERS[i + 1] || null;
}

// Prix par mois de l'annuel, dans la devise de StoreKit : le prix annuel divisé par 12 (2e tour des juges du 27/11 :
// « soit 8,5 mois » ne se comprenait pas). null si le prix ou la devise manquent
function planPerMonthText(yearly) {
  const y = Number(yearly?.amount), cur = yearly?.currency;
  if (!Number.isFinite(y) || y <= 0 || typeof cur !== 'string' || !/^[A-Z]{3}$/.test(cur)) return null;
  try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur }).format(y / 12); } catch { return null; }
}
// Économie de l'annuel sur 12 mois du mensuel, en pour cent entiers (arrondi vers le bas : jamais plus que la vérité) ;
// null si les prix manquent ou si l'écart est sous 5 %
function planYearSaving(monthly, yearly) {
  const m = Number(monthly?.amount), y = Number(yearly?.amount);
  if (!Number.isFinite(m) || !Number.isFinite(y) || m <= 0 || y <= 0) return null;
  const pct = Math.floor((1 - y / (12 * m)) * 100);
  return pct >= 5 ? pct : null;
}
