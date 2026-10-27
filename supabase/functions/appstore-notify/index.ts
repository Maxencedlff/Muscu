// App Store Server Notifications V2 (Payant V1, docs/PAYANT_V1.md) : Apple prévient le serveur des
// renouvellements, coupures de renouvellement, expirations, remboursements et révocations. L'accès
// tombe donc tout seul, même si l'app n'est jamais rouverte.
//
// ⚠ Cette fonction est appelée par Apple, PAS par l'app : elle doit être déployée sans vérification de
// jeton (supabase functions deploy appstore-notify --no-verify-jwt). Sa seule preuve d'identité est la
// SIGNATURE d'Apple sur le signedPayload, vérifiée ici (_shared/apple-jws.js, chaîne jusqu'à Apple
// Root CA G3 épinglée). Une notification dont la signature ne vérifie pas est rejetée en 401 et n'écrit
// rien : c'est la règle du contrat. L'URL est à donner à App Store Connect › App › Server URL.
//
// 1. Corps { signedPayload } : signature vérifiée, sinon 401 { error: 'invalid_signature' }.
// 2. data.signedTransactionInfo : vérifié de la même façon (sa propre chaîne de certificats Apple),
//    sinon 401. Les champs ne sont jamais crus sur parole.
// 3. notify-policy.js décide : bundleId, environnement, type traité ou non.
// 4. public.srv_access_event (clé serveur) retrouve le compte par la transaction d'origine et met le
//    droit d'accès à jour. Transaction inconnue : { matched: false }, et on répond quand même 200.
// 5. Réponse 200 dès que la notification est comprise, pour qu'Apple arrête de la renvoyer. Seule une
//    panne de notre côté renvoie 500, pour qu'Apple réessaie.
import { adminClient, CORS, env, json } from '../_shared/http.ts';
import { verifyAppleJws } from '../_shared/apple-jws.js';
import { httpStatus } from '../verify-purchase/purchase-policy.js';
import { notificationDecision } from './notify-policy.js';

const allowSandbox = () => env('APPLE_ALLOW_SANDBOX') === '1';

// Corps JSON { signedPayload }, '' s'il est absent ou illisible
async function bodyPayload(req: Request): Promise<string> {
  try { const p = (await req.json())?.signedPayload; return typeof p === 'string' ? p.slice(0, 65536) : ''; } catch { return ''; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const nowMs = Date.now();
  // 1. Signature d'Apple : la seule identification de l'appelant
  const signed = await verifyAppleJws(await bodyPayload(req), { nowMs });
  if (!signed.ok) {
    console.error('appstore-notify: signature refusée', signed.error);
    return json({ error: 'invalid_signature' }, 401);
  }
  const notification = signed.payload as Record<string, unknown>;
  const data = (notification.data ?? {}) as Record<string, unknown>;

  // 2. La transaction est signée à part, et vérifiée à part
  let transaction: unknown = null;
  if (typeof data.signedTransactionInfo === 'string') {
    const tx = await verifyAppleJws(data.signedTransactionInfo, { nowMs });
    if (!tx.ok) {
      console.error('appstore-notify: transaction non signée par Apple', tx.error);
      return json({ error: 'invalid_signature' }, 401);
    }
    transaction = tx.payload;
  }

  // 3. Décision
  const decided = notificationDecision({ notification, transaction, nowMs, allowSandbox: allowSandbox() });
  if (!decided.ok) {
    console.error('appstore-notify: notification refusée', decided.error, notification.notificationUUID);
    return json({ error: decided.error }, httpStatus(decided.error));
  }
  if (!decided.handled) {
    console.log('appstore-notify: type ignoré', decided.type, decided.reason);
    return json({ ok: true, handled: false, type: decided.type });
  }

  // 4. Mise à jour du droit d'accès
  const { data: res, error } = await adminClient().rpc('srv_access_event', {
    p_original_tx: decided.value.original_transaction_id,
    p_product: decided.value.product_id,
    p_expires: decided.value.expires_at,
    p_revoked: decided.value.revoked,
  });
  if (error) {
    // Panne de notre côté : 500, Apple réessaiera (jusqu'à 3 jours)
    console.error('appstore-notify: écriture refusée', decided.type, error.code, error.message);
    return json({ error: 'write' }, 500);
  }
  const matched = !!(res as { matched?: boolean } | null)?.matched;
  if (!matched) console.log('appstore-notify: transaction inconnue', decided.type, decided.value.original_transaction_id);
  return json({ ok: true, handled: true, type: decided.type, matched });
});
