// Vérification d'un achat (Payant V1, docs/PAYANT_V1.md), appelée par l'app iOS après un achat, une
// restauration ou toute transaction remontée par l'écouteur Transaction.updates de StoreKit 2.
//
// Entrée : POST { jws } (la transaction signée rendue par StoreKit). Sortie : { ok: true, access }
// (« access » = la charge utile de my_access(), pour que l'app se rafraîchisse d'un seul appel).
//
// 1. L'appelant est identifié par son jeton de session (JWT vérifié par Supabase et relu ici,
//    _shared/http.ts) : un achat ne peut pas être rattaché à un compte sans en avoir la session.
// 2. La signature d'Apple est VRAIMENT vérifiée (_shared/apple-jws.js) : chaîne de certificats jusqu'à
//    Apple Root CA G3 épinglée dans le dépôt, dates, contraintes, marqueurs d'Apple, puis les trois
//    signatures ECDSA. Décoder la charge utile ne prouverait rien.
// 3. La charge utile est jugée par purchase-policy.js : bundleId com.mdlf.training, un de nos deux
//    abonnements, type cohérent, achat personnel, environnement Production ou Sandbox (accepté et
//    enregistré : l'équipe d'examen d'Apple achète en Sandbox), offre de lancement (offerType 1).
// 4. La transaction est RELUE auprès de l'App Store Server API
//    (GET /inApps/v1/transactions/{id}, jeton ES256 signé avec la clé In-App Purchase), et c'est cette
//    relecture qui fait foi : un JWS valable mais vieux, remboursé ou révoqué entre-temps ne passe pas.
//    Apple injoignable ou clé absente : 503, aucun droit écrit (l'app réessaiera).
// 5. Écriture par public.srv_access_purchase (clé serveur, seul rôle qui peut l'exécuter). La base
//    refuse une transaction déjà au nom d'un autre compte : 409 { error: 'transaction_taken' }.
//
// Secrets (Management API, jamais dans le dépôt) : APPLE_IAP_KEY_ID, APPLE_IAP_PRIVATE_KEY (contenu du
// .p8 « In-App Purchase »), APPLE_ISSUER_ID (App Store Connect › Clés › Issuer ID).
import { adminClient, bodyJws, caller, CORS, env, json } from '../_shared/http.ts';
import { verifyAppleJws } from '../_shared/apple-jws.js';
import { BUNDLE_ID, httpStatus, purchaseFailure, transactionDecision } from './purchase-policy.js';
import { importPKCS8, SignJWT } from 'npm:jose@5.9.6';

const HOSTS: Record<string, string> = {
  Production: 'https://api.storekit.itunes.apple.com',
  Sandbox: 'https://api.storekit-sandbox.itunes.apple.com',
};

// Jeton d'accès à l'App Store Server API : JWT ES256 signé avec la clé In-App Purchase, 10 minutes.
// null si un des trois secrets manque (la relecture est alors impossible, et rien n'est écrit).
async function appStoreToken(): Promise<string | null> {
  const pem = env('APPLE_IAP_PRIVATE_KEY');
  const kid = env('APPLE_IAP_KEY_ID');
  const iss = env('APPLE_ISSUER_ID');
  if (!pem || !kid || !iss) return null;
  try {
    const key = await importPKCS8(pem.replace(/\\n/g, '\n'), 'ES256');
    return await new SignJWT({ bid: BUNDLE_ID })
      .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
      .setIssuer(iss).setIssuedAt().setExpirationTime('10m')
      .setAudience('appstoreconnect-v1')
      .sign(key);
  } catch (e) {
    console.error('verify-purchase: clé In-App Purchase illisible', e instanceof Error ? e.name : 'erreur');
    return null;
  }
}

// La transaction telle qu'Apple la donne MAINTENANT (source qui fait foi), elle-même signée et
// vérifiée comme le JWS de l'app : { payload } ou { error }.
type Fresh = { error: string; payload?: undefined } | { error?: undefined; payload: unknown };
async function freshTransaction(transactionId: string, environment: string, nowMs: number): Promise<Fresh> {
  const host = HOSTS[environment];
  if (!host) return { error: 'bad_environment' };
  const token = await appStoreToken();
  if (!token) return { error: 'apple_api_unconfigured' };
  try {
    const res = await fetch(`${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return { error: 'not_found' };
    if (!res.ok) {
      console.error('verify-purchase: App Store Server API a refusé', res.status);
      return { error: 'apple_unreachable' };
    }
    const body = await res.json();
    const v = await verifyAppleJws(body?.signedTransactionInfo, { nowMs });
    if (!v.ok) {
      console.error('verify-purchase: relecture non signée par Apple', v.error);
      return { error: 'invalid_jws' };
    }
    return { payload: v.payload };
  } catch (e) {
    console.error('verify-purchase: App Store Server API injoignable', e instanceof Error ? e.name : 'erreur');
    return { error: 'apple_unreachable' };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await caller(req);
  if (!who) return json({ error: 'auth' }, 401);

  const nowMs = Date.now();
  const jws = await bodyJws(req);
  // 2. Signature d'Apple. Le détail reste dans les journaux : l'app ne reçoit qu'invalid_jws.
  const signed = await verifyAppleJws(jws, { nowMs });
  if (!signed.ok) {
    console.error('verify-purchase: JWS refusé', signed.error);
    return json({ error: 'invalid_jws' }, 400);
  }
  // 3. Ce que la transaction dit
  const claimed = transactionDecision(signed.payload, { nowMs });
  if (!claimed.ok) return json({ error: claimed.error }, httpStatus(claimed.error));

  // 4. Relecture chez Apple : c'est elle qui fait foi
  const fresh = await freshTransaction(claimed.value.transaction_id, claimed.value.environment, nowMs);
  if (fresh.error) return json({ error: fresh.error }, httpStatus(fresh.error));
  const sure = transactionDecision(fresh.payload, { nowMs });
  if (!sure.ok) return json({ error: sure.error }, httpStatus(sure.error));
  // La relecture doit parler de la même transaction d'origine que ce que l'app a présenté
  if (sure.value.original_transaction_id !== claimed.value.original_transaction_id) {
    console.error('verify-purchase: la relecture ne correspond pas', claimed.value.transaction_id);
    return json({ error: 'invalid_jws' }, 400);
  }

  // 5. Écriture du droit d'accès
  const { data, error } = await adminClient().rpc('srv_access_purchase', {
    p_user: who.user.id,
    p_product: sure.value.product_id,
    p_expires: sure.value.expires_at,
    p_original_tx: sure.value.original_transaction_id,
    p_revoked: sure.value.revoked,
    // purchaseDate de la période : le serveur ignore une transaction plus ancienne que ce qu'il sait
    // déjà (Transaction.unfinished est parcouru dans un ordre non garanti)
    p_event_at: sure.value.event_at,
    // Offre de lancement (essai gratuit d'Apple) et environnement, lus dans la relecture signée
    p_intro: sure.value.intro_offer,
    p_environment: sure.value.environment,
  });
  if (error) {
    const f = purchaseFailure(error.message);
    if (f.error === 'write') console.error('verify-purchase: écriture refusée', error.code, error.message);
    return json({ error: f.error }, f.status);
  }
  return json({ ok: true, access: data });
});
