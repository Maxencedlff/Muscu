// Règles d'appstore-notify (logique pure, sans réseau), appliquées par index.ts (Deno) et testées par
// tests/unit/payant.mjs (Node). Contrat : docs/PAYANT_V1.md, Edge Function appstore-notify.
//
// Les App Store Server Notifications V2 arrivent sans jeton de session : la SEULE preuve qu'elles
// viennent d'Apple est la signature du signedPayload, vérifiée avant (../_shared/apple-jws.js). Une
// notification dont la signature ne vérifie pas est rejetée en 401 et n'écrit rien.
//
// 1. Le bundleId de data doit être le nôtre (bad_bundle), et l'environnement doit être autorisé (le
//    Sandbox est refusé par défaut, comme pour verify-purchase).
// 2. Types traités (contrat) : SUBSCRIBED, DID_RENEW, DID_CHANGE_RENEWAL_STATUS, EXPIRED,
//    GRACE_PERIOD_EXPIRED, REFUND, REVOKE. Tout le reste (TEST, DID_FAIL_TO_RENEW, PRICE_INCREASE,
//    CONSUMPTION_REQUEST…) est accepté et ignoré : on répond 200 pour qu'Apple n'essaie pas en boucle
//    pendant des heures.
// 3. REFUND et REVOKE : la transaction est marquée révoquée, l'accès tombe.
// 4. EXPIRED et GRACE_PERIOD_EXPIRED : la fin est ramenée au plus tôt entre la date d'Apple et
//    maintenant. Apple envoie parfois EXPIRED avec une expiresDate encore dans le futur de quelques
//    secondes ; on ne laisse pas un accès ouvert alors qu'Apple dit qu'il est fermé.
// 5. DID_CHANGE_RENEWAL_STATUS (le renouvellement automatique a été coupé ou remis) ne change PAS la
//    date de fin : la période déjà payée reste due. On réécrit donc la transaction telle quelle, ce qui
//    remet aussi l'état au propre si une notification avait été perdue.
// 6. Le compte n'est jamais dans la notification : public.srv_access_event retrouve le compte par la
//    transaction d'origine. Transaction inconnue (achat pas encore remonté par l'app) : rien à faire,
//    et l'app écrira le droit d'accès à son prochain verify-purchase.

import { BUNDLE_ID, transactionDecision } from '../verify-purchase/purchase-policy.js';

export const HANDLED_TYPES = Object.freeze([
  'SUBSCRIBED', 'DID_RENEW', 'DID_CHANGE_RENEWAL_STATUS',
  'EXPIRED', 'GRACE_PERIOD_EXPIRED', 'REFUND', 'REVOKE',
]);
// Types qui ferment l'accès tout de suite
export const REVOKING_TYPES = Object.freeze(['REFUND', 'REVOKE']);
export const EXPIRING_TYPES = Object.freeze(['EXPIRED', 'GRACE_PERIOD_EXPIRED']);

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Notification vérifiée (+ sa transaction vérifiée) → ce qu'il faut écrire.
// { ok: true, handled: true, type, value: { original_transaction_id, product_id, expires_at, revoked } }
// { ok: true, handled: false, type, reason } : accepté et ignoré (200)
// { ok: false, error } : refusé (bad_bundle, bad_environment, invalid_jws…)
export function notificationDecision({ notification, transaction, nowMs = Date.now(), allowSandbox = false } = {}) {
  if (!isObject(notification) || typeof notification.notificationType !== 'string') return { ok: false, error: 'invalid_jws' };
  const data = notification.data;
  const type = notification.notificationType;
  if (!isObject(data)) return { ok: false, error: 'invalid_jws' };
  if (data.bundleId !== undefined && data.bundleId !== BUNDLE_ID) return { ok: false, error: 'bad_bundle' };
  if (data.environment === 'Sandbox' && !allowSandbox) return { ok: false, error: 'bad_environment' };
  if (!HANDLED_TYPES.includes(type)) return { ok: true, handled: false, type, reason: 'type_ignored' };
  // Les types traités portent tous une transaction signée
  const decided = transactionDecision(transaction, { nowMs, allowSandbox });
  if (!decided.ok) {
    // Un produit qui n'est pas des nôtres (autre app du même compte Apple) : accepté et ignoré
    if (decided.error === 'unknown_product' || decided.error === 'bad_type') {
      return { ok: true, handled: false, type, reason: decided.error };
    }
    return { ok: false, error: decided.error };
  }
  const v = decided.value;
  const revoked = v.revoked || REVOKING_TYPES.includes(type);
  let expires = v.expires_at;
  if (EXPIRING_TYPES.includes(type) && expires !== null) {
    expires = new Date(Math.min(Date.parse(expires), nowMs)).toISOString();
  }
  return {
    ok: true,
    handled: true,
    type,
    value: {
      original_transaction_id: v.original_transaction_id,
      product_id: v.product_id,
      expires_at: expires,
      revoked,
    },
  };
}
