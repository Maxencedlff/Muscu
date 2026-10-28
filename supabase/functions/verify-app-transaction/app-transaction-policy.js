// Règles de verify-app-transaction (logique pure, sans réseau), appliquées par index.ts (Deno) et
// testées par tests/unit/app-transaction.mjs (Node). Contrat : docs/PAYANT_V1.md, « Essai rattaché à
// l'identifiant Apple ».
//
// La signature d'Apple est vérifiée avant, par la MÊME fonction que les achats
// (../_shared/apple-jws.js : chaîne jusqu'à Apple Root CA G3 épinglée, dates, contraintes, marqueurs
// d'Apple, trois signatures ECDSA). Ici on décide seulement ce que la preuve permet de lier.
//
// Charge utile d'un AppTransaction signé (champs d'Apple, App Store Server Library) : bundleId,
// receiptType (l'environnement : « Production », « Sandbox », « Xcode »…), appTransactionId,
// originalPurchaseDate, receiptCreationDate, appAppleId… Attention, ce n'est PAS la forme d'une
// transaction d'achat : l'environnement y est dans receiptType, pas dans environment.
//
// 1. Le bundleId doit être le nôtre (bad_bundle) : une preuve signée par Apple pour une AUTRE app ne
//    lie rien chez nous.
// 2. receiptType : Production, ou Sandbox seulement avec APPLE_ALLOW_SANDBOX=1 (même règle que
//    verify-purchase : bad_environment). Xcode (preuve signée par Xcode, pas par Apple) n'arrive
//    jamais jusqu'ici : la chaîne est refusée avant.
// 3. appTransactionId : identifiant unique et stable du téléchargement de l'app par un identifiant
//    Apple (le même après réinstallation, sur un autre iPhone, après un remboursement). Absent ou mal
//    formé : no_app_transaction_id (la preuve ne sert à rien, l'app reste « sans preuve »).
// 4. Une transaction d'ACHAT signée (qui porte aussi appTransactionId) est refusée (not_app_transaction) :
//    on n'accepte que ce que l'app est censée envoyer, pour ne pas ouvrir une seconde porte d'entrée.

import { BUNDLE_ID } from '../verify-purchase/purchase-policy.js';

export const APP_TX_ENVIRONMENTS = Object.freeze(['Production', 'Sandbox']);
const ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Charge utile vérifiée → { ok: true, value: { app_transaction_id, environment, bundle_id } } ou { ok: false, error }
export function appTransactionDecision(payload, { allowSandbox = false } = {}) {
  if (!isObject(payload)) return { ok: false, error: 'invalid_jws' };
  if (payload.bundleId !== BUNDLE_ID) return { ok: false, error: 'bad_bundle' };
  // Une transaction d'achat a productId et environment ; un AppTransaction a receiptType
  if (payload.productId !== undefined || payload.receiptType === undefined) return { ok: false, error: 'not_app_transaction' };
  if (!APP_TX_ENVIRONMENTS.includes(payload.receiptType)) return { ok: false, error: 'bad_environment' };
  if (payload.receiptType === 'Sandbox' && !allowSandbox) return { ok: false, error: 'bad_environment' };
  const id = typeof payload.appTransactionId === 'string' && ID_RE.test(payload.appTransactionId) ? payload.appTransactionId : null;
  if (!id) return { ok: false, error: 'no_app_transaction_id' };
  return { ok: true, value: { app_transaction_id: id, environment: payload.receiptType, bundle_id: payload.bundleId } };
}

// Refus → réponse HTTP. Tout ce qui touche à la signature ne rend qu'invalid_jws à l'app.
const STATUS = Object.freeze({
  invalid_jws: 400,
  bad_bundle: 400,
  not_app_transaction: 400,
  bad_environment: 400,
  no_app_transaction_id: 400,
  invalid_app_transaction: 400,
  not_found: 404,
  rate_limited: 429,
});
export function appTxStatus(error) {
  return Object.prototype.hasOwnProperty.call(STATUS, error) ? STATUS[error] : 500;
}

// Erreur rendue par la base (message exact de 20261029000000_payant_apple.sql) → réponse HTTP.
// Un message inconnu ne passe jamais pour un succès : 500 { error: 'write' }.
export function linkFailure(message) {
  const known = ['not_found', 'bad_bundle', 'invalid_app_transaction', 'rate_limited'];
  const m = typeof message === 'string' ? message.trim() : '';
  return known.includes(m) ? { status: appTxStatus(m), error: m } : { status: 500, error: 'write' };
}
