// Règles d'appstore-notify (logique pure, sans réseau), appliquées par index.ts (Deno) et testées par
// tests/unit/payant.mjs (Node). Contrat : docs/PAYANT_V1.md, Edge Function appstore-notify.
//
// Les App Store Server Notifications V2 arrivent sans jeton de session : la SEULE preuve qu'elles
// viennent d'Apple est la signature du signedPayload, vérifiée avant (../_shared/apple-jws.js). Une
// notification dont la signature ne vérifie pas est rejetée en 401 et n'écrit rien.
//
// 1. **Tout ce qui est signé par Apple repart en 200**, traité ou non. Apple réessaie une notification
//    jusqu'à 3 jours quand la réponse n'est pas un 2xx : refuser en 400 ce qu'on ne sait pas traiter
//    ferait tourner Apple pour rien et noierait les vraies pannes. Seuls cas particuliers : 401 si la
//    signature est fausse, 500 si NOTRE écriture échoue (là, le réessai est utile).
//    Conséquence : `data` est facultatif et exclusif de `summary`, `appData` et
//    `externalPurchaseToken` (RENEWAL_EXTENSION, RESCIND_CONSENT…) ; une notification sans `data`
//    repart donc en 200 { handled: false }, pas en 400. Pareil pour un autre bundleId, un
//    environnement inconnu (ni Production ni Sandbox, tous deux acceptés depuis le modèle B), un
//    produit qui n'est pas des nôtres, une charge utile inattendue.
// 2. Types traités (contrat) : SUBSCRIBED, DID_RENEW, DID_CHANGE_RENEWAL_STATUS, EXPIRED,
//    GRACE_PERIOD_EXPIRED, REFUND, REVOKE, plus DID_FAIL_TO_RENEW (ajouté le 28/10 : c'est LUI qui
//    porte la période de grâce de facturation, sans quoi une carte qui échoue couperait un abonné
//    qu'Apple considère toujours abonné). Le type est regardé AVANT le bundleId et l'environnement,
//    pour ne pas transformer un type ignoré en refus.
// 3. **Période de grâce** : `gracePeriodExpiresDate` n'existe que dans `signedRenewalInfo`, jamais dans
//    la transaction. La fin d'accès est donc le plus lointain des deux (`expiresDate`,
//    `gracePeriodExpiresDate`).
// 4. REFUND et REVOKE : la transaction est marquée révoquée, l'accès tombe.
// 5. EXPIRED et GRACE_PERIOD_EXPIRED : la fin est ramenée au plus tôt entre la date d'Apple et
//    maintenant, et `force` est posé pour que le serveur accepte de faire RECULER la date de fin (seul
//    cas où il l'accepte). Apple envoie parfois EXPIRED avec une date encore à quelques secondes dans
//    le futur : on ne laisse pas un accès ouvert alors qu'Apple dit qu'il est fermé.
// 6. DID_CHANGE_RENEWAL_STATUS (renouvellement automatique coupé ou remis) et DID_FAIL_TO_RENEW ne
//    raccourcissent PAS la période déjà payée : la transaction est réécrite telle quelle, ce qui remet
//    aussi l'état au propre si une notification avait été perdue.
// 7. `event_at` = `signedDate` de la notification (l'heure de l'évènement chez Apple) : le serveur
//    ignore un évènement plus ancien que le dernier appliqué, donc une notification rejouée ou arrivée
//    dans le désordre ne défait pas un renouvellement déjà connu.
// 8. Le compte n'est jamais dans la notification : public.srv_access_event le retrouve par la
//    transaction d'origine, et à défaut par l'appAccountToken de la transaction.
// 9. Offre de lancement (offerType 1 de la transaction signée) et environnement : remontés au serveur,
//    qui les enregistre (intro_offer, environment).

import { BUNDLE_ID, ENVIRONMENTS, transactionDecision } from '../verify-purchase/purchase-policy.js';

export const HANDLED_TYPES = Object.freeze([
  'SUBSCRIBED', 'DID_RENEW', 'DID_CHANGE_RENEWAL_STATUS', 'DID_FAIL_TO_RENEW',
  'EXPIRED', 'GRACE_PERIOD_EXPIRED', 'REFUND', 'REVOKE',
]);
// Types qui ferment l'accès tout de suite
export const REVOKING_TYPES = Object.freeze(['REFUND', 'REVOKE']);
// Types où Apple ferme l'accès lui-même : la date de fin peut reculer
export const EXPIRING_TYPES = Object.freeze(['EXPIRED', 'GRACE_PERIOD_EXPIRED']);

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const msDate = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e15 ? Math.floor(v) : null);
const ignore = (type, reason) => ({ handled: false, type, reason });

// Notification vérifiée (+ sa transaction et son renewalInfo vérifiés) → ce qu'il faut écrire.
// { handled: true, type, value: { original_transaction_id, product_id, expires_at, revoked, force,
//   event_at, account_token, intro_offer, environment } } ou { handled: false, type, reason } : accepté et ignoré (200).
// Ne renvoie JAMAIS de refus : tout ce qui est signé par Apple repart en 200 (voir la règle 1).
export function notificationDecision({ notification, transaction, renewal = null, nowMs = Date.now() } = {}) {
  if (!isObject(notification) || typeof notification.notificationType !== 'string') return ignore(null, 'malformed');
  const type = notification.notificationType;
  if (!HANDLED_TYPES.includes(type)) return ignore(type, 'type_ignored');
  // data est facultatif : certaines notifications portent summary, appData ou externalPurchaseToken
  const data = notification.data;
  if (!isObject(data)) return ignore(type, 'no_data');
  if (data.bundleId !== undefined && data.bundleId !== BUNDLE_ID) return ignore(type, 'bad_bundle');
  if (data.environment !== undefined && !ENVIRONMENTS.includes(data.environment)) return ignore(type, 'bad_environment');

  const decided = transactionDecision(transaction, { nowMs });
  if (!decided.ok) return ignore(type, decided.error);
  const v = decided.value;

  // La période de grâce de facturation ne vit que dans le renewalInfo
  const grace = isObject(renewal) ? msDate(renewal.gracePeriodExpiresDate) : null;
  let until = Date.parse(v.expires_at);
  if (grace !== null) until = until === null ? grace : Math.max(until, grace);
  const force = EXPIRING_TYPES.includes(type);
  if (force && until !== null) until = Math.min(until, nowMs);

  return {
    handled: true,
    type,
    value: {
      original_transaction_id: v.original_transaction_id,
      product_id: v.product_id,
      expires_at: until === null ? null : new Date(until).toISOString(),
      revoked: v.revoked || REVOKING_TYPES.includes(type),
      force,
      event_at: msDate(notification.signedDate) !== null
        ? new Date(msDate(notification.signedDate)).toISOString()
        : v.event_at,
      account_token: v.account_token,
      intro_offer: v.intro_offer,
      environment: v.environment,
    },
  };
}
