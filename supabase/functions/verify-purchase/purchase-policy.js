// Règles de verify-purchase (logique pure, sans réseau), appliquées par index.ts (Deno) et testées par
// tests/unit/payant.mjs (Node). Contrat : docs/PAYANT_V1.md, Edge Function verify-purchase.
//
// La signature d'Apple est vérifiée avant (../_shared/apple-jws.js) : ici on décide seulement ce que la
// transaction donne comme droit d'accès.
//
// 1. Le bundleId doit être le nôtre (bad_bundle) : un JWS signé par Apple pour une AUTRE app est
//    parfaitement valable, il ne doit simplement rien ouvrir chez nous.
// 2. Le produit doit être un des deux abonnements d'App Store Connect (unknown_product), et son type
//    doit être « Auto-Renewable Subscription » (bad_type). L'« Accès offert » (non consommable) a été
//    supprimé le 28/10 (modèle B) : il est inconnu, donc refusé.
// 3. inAppOwnershipType : PURCHASED seulement. Le partage familial n'est pas activé sur ces produits
//    (App Store Connect) : une transaction FAMILY_SHARED est refusée (not_purchased) plutôt que crue.
// 4. Production ET Sandbox sont acceptés (modèle B, 28/10), l'environnement est renvoyé pour être
//    enregistré. L'équipe d'examen d'Apple achète en Sandbox sur la version de production : refuser le
//    Sandbox serait un refus quasi certain. Ce que ça ouvre (TestFlight tourne toujours en Sandbox) est
//    dans docs/PAYANT_V1.md. Xcode (fichier StoreKit local) et tout le reste : bad_environment.
// 5. Une période déjà échue est acceptée (c'est une vraie transaction) : elle écrit un droit d'accès
//    qui est tout de suite « expiré ». C'est le serveur qui compare les dates, jamais l'app.
// 6. Remboursée ou révoquée (revocationDate) : la transaction est écrite comme révoquée, donc sans
//    accès. On ne l'ignore pas : si elle était connue, son accès doit tomber.
// 7. event_at = date de l'évènement, pour que le serveur ignore ce qui arrive en retard : on prend
//    purchaseDate (la date d'achat de CETTE période), pas signedDate. signedDate d'une relecture par
//    l'App Store Server API est l'heure de notre appel, donc toujours la plus récente : elle ne dirait
//    rien de l'ancienneté de la période. purchaseDate, lui, est stable d'une relecture à l'autre et
//    croissant d'un renouvellement au suivant, donc une transaction du mois N parcourue après celle du
//    mois N+1 (Transaction.unfinished, ordre non garanti) est bien reconnue comme la plus ancienne.
// 8. Essai gratuit d'Apple (offre de lancement gratuite) : intro_offer vaut true seulement quand la
//    transaction signée porte offerType = 1 (INTRODUCTORY_OFFER, App Store Server Library : OfferType)
//    ET offerDiscountType = 'FREE_TRIAL'. Une offre de lancement PAYANTE (PAY_AS_YOU_GO, PAY_UP_FRONT)
//    ne s'affiche donc jamais comme « Essai gratuit ». Champ absent : false (renouvellement payé, achat
//    sans offre).

export const BUNDLE_ID = 'com.mdlf.training';
export const PRODUCT_MONTHLY = 'com.mdlf.training.pro.monthly';
export const PRODUCT_YEARLY = 'com.mdlf.training.pro.yearly';
// Offre de lancement chez Apple (OfferType.INTRODUCTORY_OFFER) et remise « essai gratuit »
export const OFFER_INTRODUCTORY = 1;
export const OFFER_FREE_TRIAL = 'FREE_TRIAL';

// Mêmes produits et mêmes natures que private.access_product_kind (20261029000000_payant_modele_b.sql)
export const PRODUCT_KINDS = Object.freeze({
  [PRODUCT_MONTHLY]: 'sub',
  [PRODUCT_YEARLY]: 'sub',
});
// Type de transaction attendu par nature de produit (champ « type » d'Apple)
export const EXPECTED_TYPES = Object.freeze({ sub: 'Auto-Renewable Subscription' });
export const ENVIRONMENTS = Object.freeze(['Production', 'Sandbox']);
export const TRANSACTION_ID_MAX = 64;

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// Identifiant de transaction : Apple envoie des nombres sous forme de texte ; la base accepte 64 caractères
const txId = (v) => (typeof v === 'string' && v.length >= 1 && v.length <= TRANSACTION_ID_MAX && /^[A-Za-z0-9._-]+$/.test(v) ? v : null);
const msDate = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e15 ? Math.floor(v) : null);

// Charge utile d'une transaction vérifiée → droit d'accès à écrire, ou refus.
// { ok: true, value: { product_id, kind, expires_at (ISO|null), original_transaction_id,
//   transaction_id, revoked, environment, expired, event_at, account_token, intro_offer } } ou
// { ok: false, error }.
export function transactionDecision(payload, { nowMs = Date.now() } = {}) {
  if (!isObject(payload)) return { ok: false, error: 'invalid_jws' };
  if (payload.bundleId !== BUNDLE_ID) return { ok: false, error: 'bad_bundle' };
  if (!ENVIRONMENTS.includes(payload.environment)) return { ok: false, error: 'bad_environment' };
  if (typeof payload.productId !== 'string' || !own(PRODUCT_KINDS, payload.productId)) return { ok: false, error: 'unknown_product' };
  const kind = PRODUCT_KINDS[payload.productId];
  if (payload.type !== EXPECTED_TYPES[kind]) return { ok: false, error: 'bad_type' };
  // Absent sur de vieilles transactions : on ne refuse que ce qui est explicitement partagé
  if (payload.inAppOwnershipType !== undefined && payload.inAppOwnershipType !== 'PURCHASED') return { ok: false, error: 'not_purchased' };
  const original = txId(payload.originalTransactionId);
  const transaction = txId(payload.transactionId) ?? original;
  if (!original || !transaction) return { ok: false, error: 'invalid_transaction' };
  const expires = msDate(payload.expiresDate);
  // Un abonnement sans date de fin n'est pas exploitable
  if (expires === null) return { ok: false, error: 'invalid_transaction' };
  const revoked = msDate(payload.revocationDate) !== null;
  const eventAt = msDate(payload.purchaseDate) ?? msDate(payload.signedDate);
  return {
    ok: true,
    value: {
      product_id: payload.productId,
      kind,
      expires_at: new Date(expires).toISOString(),
      original_transaction_id: original,
      transaction_id: transaction,
      revoked,
      environment: payload.environment,
      expired: expires <= nowMs,
      event_at: eventAt === null ? null : new Date(eventAt).toISOString(),
      account_token: typeof payload.appAccountToken === 'string' ? payload.appAccountToken.slice(0, 64) : null,
      intro_offer: payload.offerType === OFFER_INTRODUCTORY && payload.offerDiscountType === OFFER_FREE_TRIAL,
    },
  };
}

// Refus de la validation → réponse HTTP. invalid_jws est le seul code que l'app voit pour tout ce qui
// touche à la signature : rien n'est appris à qui cherche à fabriquer un JWS.
const STATUS = Object.freeze({
  invalid_jws: 400,
  bad_bundle: 400,
  bad_environment: 400,
  unknown_product: 400,
  bad_type: 400,
  not_purchased: 400,
  invalid_transaction: 400,
  not_found: 404,
  transaction_taken: 409,
  rate_limited: 429,
  apple_unreachable: 503,
  apple_api_unconfigured: 503,
});
export function httpStatus(error) {
  return own(STATUS, error) ? STATUS[error] : 500;
}

// Erreur rendue par la base (message exact de la migration) → réponse HTTP.
// Un message inconnu ne doit jamais passer pour un succès : 500 { error: 'write' }.
export function purchaseFailure(message) {
  const known = ['transaction_taken', 'unknown_product', 'invalid_transaction', 'not_found', 'rate_limited'];
  const m = typeof message === 'string' ? message.trim() : '';
  return known.includes(m) ? { status: httpStatus(m), error: m } : { status: 500, error: 'write' };
}
