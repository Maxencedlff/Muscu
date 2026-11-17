// Règles pures de la fonction coach-promo-offer (testées sans Deno par tests/unit/promo-coach.mjs).
// Contrat : docs/PAYANT_V1.md, section « Essai coach pour qui a déjà eu un essai ».
//
// Signature d'une offre promotionnelle d'Apple au format JWS (StoreKit 2,
// Product.PurchaseOption.promotionalOffer(_:compactJWS:)) :
// https://developer.apple.com/documentation/storekit/generating-jws-to-sign-app-store-requests
// - en-tête { alg: 'ES256', kid: <Key ID de la clé In-App Purchase>, typ: 'JWT' } ;
// - charge utile { iss: <Issuer ID>, iat: <secondes>, aud: 'promotional-offer', bid, nonce (UUID minuscule),
//   productId, offerIdentifier } ; PAS de champ exp (« including it makes the request fail ») ;
// - signée avec la clé In-App Purchase (.p8), la même que la relecture de verify-purchase.

export const BUNDLE_ID = 'com.mdlf.training';
export const PROMO_AUDIENCE = 'promotional-offer';
export const PROMO_SUFFIX = '.essai2mois';
// Les huit abonnements coach (mêmes identifiants que private.coach_promo_product)
export const COACH_PRODUCTS = Object.freeze(['coach10', 'coach20', 'coach30', 'coachmax']
  .flatMap((t) => [`com.mdlf.training.${t}.monthly`, `com.mdlf.training.${t}.yearly`]));

// Corps de la requête : { productId, introEligible } → { ok, productId, introEligible } ou { ok: false, error }.
// introEligible doit être un booléen : l'app le lit chez StoreKit (isEligibleForIntroOffer).
export function promoRequest(body) {
  const productId = body?.productId;
  if (typeof productId !== 'string' || !COACH_PRODUCTS.includes(productId)) return { ok: false, error: 'unknown_product' };
  if (typeof body?.introEligible !== 'boolean') return { ok: false, error: 'bad_request' };
  return { ok: true, productId, introEligible: body.introEligible };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Charge utile à signer. nonce : UUID en minuscules, un nouveau pour chaque signature.
export function promoClaims({ issuerId, productId, offerId, nonce, nowMs }) {
  if (!issuerId || !COACH_PRODUCTS.includes(productId) || offerId !== productId + PROMO_SUFFIX) throw new Error('promo_claims');
  if (typeof nonce !== 'string' || !UUID.test(nonce)) throw new Error('promo_nonce');
  return {
    iss: issuerId,
    iat: Math.floor(nowMs / 1000),
    aud: PROMO_AUDIENCE,
    bid: BUNDLE_ID,
    nonce,
    productId,
    offerIdentifier: offerId,
  };
}
export const promoHeader = (kid) => ({ alg: 'ES256', kid, typ: 'JWT' });

// Refus de la base (srv_coach_promo_grant) → statut HTTP. L'app ne propose alors que l'achat normal.
const STATUS = { unknown_product: 400, bad_request: 400, not_coach: 403, had_coach: 403, too_many: 403,
  intro_eligible: 409, rate_limited: 429, apple_api_unconfigured: 503 };
export const promoStatus = (error) => STATUS[error] ?? 500;
