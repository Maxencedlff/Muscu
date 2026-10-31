// App Store Server Notifications V2 (Payant V1, docs/PAYANT_V1.md) : Apple prévient le serveur des
// renouvellements, coupures de renouvellement, échecs de paiement, expirations, remboursements et
// révocations. L'accès tombe donc tout seul, même si l'app n'est jamais rouverte.
//
// ⚠ Cette fonction est appelée par Apple, PAS par l'app : elle doit être déployée sans vérification de
// jeton (supabase functions deploy appstore-notify --no-verify-jwt). Sa seule preuve d'identité est la
// SIGNATURE d'Apple sur le signedPayload, vérifiée ici (_shared/apple-jws.js, chaîne jusqu'à Apple
// Root CA G3 épinglée). Une notification dont la signature ne vérifie pas est rejetée en 401 et n'écrit
// rien : c'est la règle du contrat. L'URL est à donner à App Store Connect › App › Server URL.
//
// Codes de réponse, et seulement ceux-là :
//  - 401 : la signature n'est pas celle d'Apple (ou la transaction signée à l'intérieur ne l'est pas).
//  - 500 : NOTRE écriture a échoué. C'est le seul cas où le réessai d'Apple (jusqu'à 3 jours) sert.
//  - 200 : tout le reste, traité ou non. Une notification sans `data`, d'un autre bundleId, d'un
//    environnement non autorisé, d'un produit qui n'est pas des nôtres ou d'un type qu'on ne traite pas
//    repart en 200 { handled: false } : sinon Apple la rejouerait cinq fois pour rien.
//
// 1. Corps { signedPayload } : signature vérifiée.
// 2. data.signedTransactionInfo et data.signedRenewalInfo : vérifiés de la même façon (chacun a sa
//    propre chaîne de certificats Apple). Le renewalInfo porte gracePeriodExpiresDate, la seule source
//    de la période de grâce de facturation. Les champs ne sont jamais crus sur parole.
// 3. notify-policy.js décide : type traité, bundleId, environnement, date de fin, révocation.
// 4. public.srv_access_event (clé serveur) dédoublonne par notificationUUID, retrouve le compte par la
//    transaction d'origine (ou par appAccountToken), et met le droit d'accès à jour. Le tout dans une
//    seule transaction de base de données : une écriture qui échoue ne consomme pas la notification.
import { adminClient, CORS, json } from '../_shared/http.ts';
import { verifyAppleJws } from '../_shared/apple-jws.js';
import { notificationDecision } from './notify-policy.js';


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

  // 2. La transaction et le renewalInfo sont signés à part, et vérifiés à part
  const inner: Record<string, unknown> = {};
  for (const key of ['signedTransactionInfo', 'signedRenewalInfo']) {
    if (typeof data[key] !== 'string') continue;
    const v = await verifyAppleJws(data[key] as string, { nowMs });
    if (!v.ok) {
      console.error('appstore-notify: charge utile non signée par Apple', key, v.error);
      return json({ error: 'invalid_signature' }, 401);
    }
    inner[key] = v.payload;
  }

  // 3. Décision : rien ne repart en erreur, tout est 200
  const decided = notificationDecision({
    notification,
    transaction: inner.signedTransactionInfo ?? null,
    renewal: inner.signedRenewalInfo ?? null,
    nowMs,
  });
  if (!decided.handled) {
    console.log('appstore-notify: ignorée', decided.type, decided.reason, notification.notificationUUID);
    return json({ ok: true, handled: false, type: decided.type, reason: decided.reason });
  }

  // 4. Déduplication et mise à jour du droit d'accès, dans une seule transaction
  const { data: res, error } = await adminClient().rpc('srv_access_event', {
    p_original_tx: decided.value.original_transaction_id,
    p_product: decided.value.product_id,
    p_expires: decided.value.expires_at,
    p_revoked: decided.value.revoked,
    p_event_at: decided.value.event_at,
    p_force: decided.value.force,
    p_uuid: typeof notification.notificationUUID === 'string' ? notification.notificationUUID.slice(0, 64) : null,
    p_account_token: decided.value.account_token,
    p_intro: decided.value.intro_offer,
    p_environment: decided.value.environment,
  });
  if (error) {
    // Panne de notre côté : 500, Apple réessaiera (la notification n'est pas marquée vue)
    console.error('appstore-notify: écriture refusée', decided.type, error.code, error.message);
    return json({ error: 'write' }, 500);
  }
  const out = (res ?? {}) as { matched?: boolean; duplicate?: boolean };
  if (out.duplicate) console.log('appstore-notify: doublon ignoré', notification.notificationUUID);
  // Jamais l'identifiant de transaction dans les journaux (donnée rattachable à une personne)
  else if (!out.matched) console.log('appstore-notify: transaction inconnue', decided.type);
  return json({ ok: true, handled: true, type: decided.type, matched: !!out.matched, duplicate: !!out.duplicate });
});
