// ═══════════════════════════════════════════════════════════
//  Formules d'abonnement (Payant V1, tarifs du 30/10/2026) : catalogue et calculs, sans affichage
//
//  - Contrat : docs/PAYANT_V1.md. Tous les produits sont dans le MÊME groupe d'abonnement d'App Store
//    Connect : passer d'un palier coach à l'autre, ou du particulier au coach, est une montée ou une
//    descente chez Apple (pas un second abonnement), et l'essai de 3 mois ne sert qu'une fois par
//    identifiant Apple pour tout le groupe.
//  - Ce fichier ne contient AUCUN PRIX des formules : ils sont lus chez StoreKit (displayPrice). Seule
//    exception, assumée : le prix de l'offre élève (−25 % pendant 12 mois). C'est un CODE D'OFFRE
//    d'Apple, et StoreKit ne donne jamais le prix d'un code d'offre avant qu'on le saisisse. Le texte
//    vient donc d'un repli par devise (PLAN_STUDENT_PRICE), aux prix posés dans App Store Connect ; la
//    feuille d'Apple affiche ensuite le vrai prix avant toute confirmation.
//  - « soit 8,5 mois » est CALCULÉ (prix annuel / prix mensuel lus chez StoreKit, au demi-mois près).
//  - Paliers coach : limite d'élèves suivis (10, 20, 30, illimité). Le serveur fait foi
//    (coach_tier_state, refus tier_full) ; ici on ne fait que choisir quoi montrer.
// ═══════════════════════════════════════════════════════════
'use strict';

const PLAN_PREFIX = 'com.mdlf.training.';
// Particulier, puis les paliers coach du plus petit au plus grand. limit null : élèves illimités.
const PLAN_TIERS = Object.freeze([
  Object.freeze({ key: 'pro',      coach: false, limit: null, label: 'Particulier' }),
  Object.freeze({ key: 'coach10',  coach: true,  limit: 10,   label: '10 élèves' }),
  Object.freeze({ key: 'coach20',  coach: true,  limit: 20,   label: '20 élèves' }),
  Object.freeze({ key: 'coach30',  coach: true,  limit: 30,   label: '30 élèves' }),
  Object.freeze({ key: 'coachmax', coach: true,  limit: null, label: 'Élèves illimités' }),
]);
const PLAN_COACH_TIERS = PLAN_TIERS.filter(t => t.coach);
const planId = (key, period) => `${PLAN_PREFIX}${key}.${period === 'year' ? 'yearly' : 'monthly'}`;
// Tous les identifiants, dans l'ordre d'affichage (le même que ios/App/App/StorePlugin.swift)
const PLAN_IDS = Object.freeze(PLAN_TIERS.flatMap(t => [planId(t.key, 'month'), planId(t.key, 'year')]));

// Offre élève : code d'offre d'Apple sur le mensuel particulier (App Store Connect, offre « Eleve de
// coach -25 pct 12 mois »), 12 mois, nouveaux abonnés seulement, sans essai gratuit
const PLAN_STUDENT_MONTHS = 12;
const PLAN_STUDENT_PRICE = Object.freeze({ EUR: '4,89 €', USD: '$3.99', CAD: '4,99 $ CA', CHF: 'CHF 3.00' });
// Page d'Apple qui ouvre la saisie du code d'offre avec le code déjà rempli (identifiant de l'app)
const PLAN_APP_STORE_ID = '6823561962';
function planRedeemUrl(code) {
  return `https://apps.apple.com/redeem?ctx=offercodes&id=${PLAN_APP_STORE_ID}&code=${encodeURIComponent(code)}`;
}

// Identifiant → { tier, period: 'month' | 'year' }, null si ce n'est pas une de nos formules
function planOf(id) {
  if (typeof id !== 'string' || !PLAN_IDS.includes(id)) return null;
  const [key, per] = id.slice(PLAN_PREFIX.length).split('.');
  return { tier: PLAN_TIERS.find(t => t.key === key), period: per === 'yearly' ? 'year' : 'month' };
}
function planIsCoach(id) { return !!planOf(id)?.tier.coach; }
// Palier coach conseillé pour n élèves : le plus petit qui les contient
function planTierFor(students) {
  const n = Number.isInteger(students) && students > 0 ? students : 0;
  return PLAN_COACH_TIERS.find(t => t.limit === null || n <= t.limit);
}
// Palier coach suivant (montée de palier), null au plafond ou hors coach
function planNextTier(id) {
  const p = planOf(id);
  if (!p || !p.tier.coach) return PLAN_COACH_TIERS[0];
  const i = PLAN_COACH_TIERS.indexOf(p.tier);
  return PLAN_COACH_TIERS[i + 1] || null;
}

// « soit 8,5 mois » : combien de mois de la formule mensuelle paie l'annuel, au demi-mois près.
// null si les prix ne sont pas des nombres utilisables (StoreKit rend price en nombre).
function planYearMonths(monthly, yearly) {
  const m = Number(monthly?.amount), y = Number(yearly?.amount);
  if (!Number.isFinite(m) || !Number.isFinite(y) || m <= 0 || y <= 0) return null;
  const n = Math.round((y / m) * 2) / 2;
  return n > 0 && n < 12 ? n : null;
}
// 8.5 → « 8,5 mois », 10 → « 10 mois »
function planMonthsText(n) {
  return `${String(n).replace('.', ',')} mois`;
}

// Prix de l'offre élève dans la devise de la boutique (lue sur le mensuel StoreKit), null si inconnue
function planStudentPrice(currency) {
  return typeof currency === 'string' && Object.prototype.hasOwnProperty.call(PLAN_STUDENT_PRICE, currency)
    ? PLAN_STUDENT_PRICE[currency] : null;
}
