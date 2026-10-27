// Règles de verify-purchase (logique pure, sans réseau), appliquées par index.ts (Deno) et testées par
// tests/unit/payant.mjs (Node). Contrat : docs/PAYANT_V1.md, Edge Function verify-purchase.
//
// La signature d'Apple est vérifiée avant (../_shared/apple-jws.js) : ici on décide seulement ce que la
// transaction donne comme droit d'accès.
//
// 1. Le bundleId doit être le nôtre (bad_bundle) : un JWS signé par Apple pour une AUTRE app est
//    parfaitement valable, il ne doit simplement rien ouvrir chez nous.
// 2. Le produit doit être un des trois d'App Store Connect (unknown_product), et son type doit
//    correspondre (bad_type) : un abonnement renouvelable pour les deux formules, un non consommable
//    pour l'accès offert. Un consommable ou un abonnement non renouvelable ne donne rien.
// 3. inAppOwnershipType : PURCHASED seulement. Le partage familial n'est pas activé sur ces produits
//    (App Store Connect) : une transaction FAMILY_SHARED est refusée (not_purchased) plutôt que crue.
// 4. L'environnement Sandbox est REFUSÉ par défaut (bad_environment). Un testeur Sandbox s'obtient
//    gratuitement : sans cette règle, n'importe qui aurait l'app à vie. Pendant les essais d'achat,
//    poser le secret APPLE_ALLOW_SANDBOX=1, et le retirer avant la mise en vente.
// 5. Une période déjà échue est acceptée (c'est une vraie transaction) : elle écrit un droit d'accès
//    qui est tout de suite « expiré ». C'est le serveur qui compare les dates, jamais l'app.
// 6. Remboursée ou révoquée (revocationDate) : la transaction est écrite comme révoquée, donc sans
//    accès. On ne l'ignore pas : si elle était connue, son accès doit tomber.

export const BUNDLE_ID = 'com.mdlf.training';
export const PRODUCT_MONTHLY = 'com.mdlf.training.pro.monthly';
export const PRODUCT_YEARLY = 'com.mdlf.training.pro.yearly';
export const PRODUCT_GIFT = 'com.mdlf.training.access.gift';

// Mêmes produits et mêmes natures que private.access_product_kind (migration 20261028000000_payant.sql)
export const PRODUCT_KINDS = Object.freeze({
  [PRODUCT_MONTHLY]: 'sub',
  [PRODUCT_YEARLY]: 'sub',
  [PRODUCT_GIFT]: 'gift',
});
// Type de transaction attendu par nature de produit (champ « type » d'Apple)
export const EXPECTED_TYPES = Object.freeze({ sub: 'Auto-Renewable Subscription', gift: 'Non-Consumable' });
export const ENVIRONMENTS = Object.freeze(['Production', 'Sandbox']);
export const TRANSACTION_ID_MAX = 64;

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// Identifiant de transaction : Apple envoie des nombres sous forme de texte ; la base accepte 64 caractères
const txId = (v) => (typeof v === 'string' && v.length >= 1 && v.length <= TRANSACTION_ID_MAX && /^[A-Za-z0-9._-]+$/.test(v) ? v : null);
const msDate = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e15 ? Math.floor(v) : null);

// Charge utile d'une transaction vérifiée → droit d'accès à écrire, ou refus.
// { ok: true, value: { product_id, kind, expires_at (ISO|null), original_transaction_id,
//   transaction_id, revoked, environment, expired } } ou { ok: false, error }.
export function transactionDecision(payload, { nowMs = Date.now(), allowSandbox = false } = {}) {
  if (!isObject(payload)) return { ok: false, error: 'invalid_jws' };
  if (payload.bundleId !== BUNDLE_ID) return { ok: false, error: 'bad_bundle' };
  if (!ENVIRONMENTS.includes(payload.environment)) return { ok: false, error: 'bad_environment' };
  if (payload.environment === 'Sandbox' && !allowSandbox) return { ok: false, error: 'bad_environment' };
  if (typeof payload.productId !== 'string' || !own(PRODUCT_KINDS, payload.productId)) return { ok: false, error: 'unknown_product' };
  const kind = PRODUCT_KINDS[payload.productId];
  if (payload.type !== EXPECTED_TYPES[kind]) return { ok: false, error: 'bad_type' };
  // Absent sur de vieilles transactions : on ne refuse que ce qui est explicitement partagé
  if (payload.inAppOwnershipType !== undefined && payload.inAppOwnershipType !== 'PURCHASED') return { ok: false, error: 'not_purchased' };
  const original = txId(payload.originalTransactionId);
  const transaction = txId(payload.transactionId) ?? original;
  if (!original || !transaction) return { ok: false, error: 'invalid_transaction' };
  const expires = kind === 'sub' ? msDate(payload.expiresDate) : null;
  // Un abonnement sans date de fin n'est pas exploitable
  if (kind === 'sub' && expires === null) return { ok: false, error: 'invalid_transaction' };
  const revoked = msDate(payload.revocationDate) !== null;
  return {
    ok: true,
    value: {
      product_id: payload.productId,
      kind,
      expires_at: expires === null ? null : new Date(expires).toISOString(),
      original_transaction_id: original,
      transaction_id: transaction,
      revoked,
      environment: payload.environment,
      expired: expires !== null && expires <= nowMs,
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
