// Essai rattaché à l'identifiant Apple (Payant V1, docs/PAYANT_V1.md, règle du 28/10/2026). Appelée par
// l'app iOS au lancement, tant que son compte n'a aucun identifiant Apple lié, et juste avant de
// refuser une séance.
//
// Entrée : POST { jws } (AppTransaction.shared de StoreKit 2, rendu par MdlfStore.appTransaction()).
// Sortie : { ok: true, access } (« access » = la charge utile de my_access(), à jour).
//
// 1. L'appelant est identifié par son jeton de session (_shared/http.ts, auth.getUser) : une preuve ne
//    peut être rattachée qu'au compte dont on a la session.
// 2. La signature d'Apple est VRAIMENT vérifiée, par la même fonction que les achats
//    (_shared/apple-jws.js, Apple Root CA G3 épinglée). Le détail du refus reste dans les journaux.
// 3. La charge utile est jugée par app-transaction-policy.js : bundleId com.mdlf.training,
//    environnement Production (Sandbox seulement avec APPLE_ALLOW_SANDBOX=1), appTransactionId présent.
// 4. Écriture par public.srv_link_store_install('apple', …) (clé serveur, seul rôle qui peut l'exécuter) : la
//    base retient la date du premier essai de cet identifiant Apple et rattache le compte.
//
// Pas de relecture chez Apple (contrairement à verify-purchase) : l'App Store Server API n'a pas de
// point d'accès pour un AppTransaction, et rien ici ne donne d'accès. Une preuve ne peut que
// RAPPROCHER la fin de l'essai : présenter celle d'un autre ne rapporte rien.
import { adminClient, bodyJws, caller, CORS, env, json } from '../_shared/http.ts';
import { verifyAppleJws } from '../_shared/apple-jws.js';
import { appTransactionDecision, appTxStatus, linkFailure } from './app-transaction-policy.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await caller(req);
  if (!who) return json({ error: 'auth' }, 401);

  const signed = await verifyAppleJws(await bodyJws(req), { nowMs: Date.now() });
  if (!signed.ok) {
    console.error('verify-app-transaction: JWS refusé', signed.error);
    return json({ error: 'invalid_jws' }, 400);
  }
  const proof = appTransactionDecision(signed.payload, { allowSandbox: env('APPLE_ALLOW_SANDBOX') === '1' });
  if (!proof.ok) return json({ error: proof.error }, appTxStatus(proof.error));

  const { data, error } = await adminClient().rpc('srv_link_store_install', {
    p_user: who.user.id,
    p_store: 'apple',
    p_install_id: proof.value.app_transaction_id,
    p_environment: proof.value.environment,
    p_bundle: proof.value.bundle_id,
  });
  if (error) {
    const f = linkFailure(error.message);
    if (f.error === 'write') console.error('verify-app-transaction: écriture refusée', error.code, error.message);
    return json({ error: f.error }, f.status);
  }
  return json({ ok: true, access: data });
});
