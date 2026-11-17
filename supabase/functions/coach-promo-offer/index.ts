// Essai coach de 2 mois pour qui a déjà eu un essai (docs/PAYANT_V1.md, « Essai coach pour qui a déjà eu un
// essai ») : signe l'offre promotionnelle d'Apple « <produit>.essai2mois » pour un coach validé qui n'a jamais
// eu d'abonnement coach et que StoreKit dit non éligible à l'offre de lancement.
//
// Entrée : POST { productId, introEligible }. Sortie : { ok: true, offerId, jws } ou { error }.
// 1. L'appelant est identifié par son jeton de session (caller → _shared/auth-guard.js), 401 sinon.
// 2. Le droit est décidé ET compté par la base (public.srv_coach_promo_grant, clé serveur seulement) :
//    rôle coach, jamais d'abonnement coach, non éligible au lancement, 5 signatures par 24 h et 10 en tout.
// 3. La signature (JWS ES256) est faite avec la clé In-App Purchase : rien n'est signé si un secret manque
//    (503) ; la base ne compte la signature qu'APRÈS cette vérification.
// L'app passe le JWS à StoreKit (Product.PurchaseOption.promotionalOffer). Apple vérifie la signature et
// l'éligibilité (client qui a ou a eu un abonnement du groupe) ; la transaction revient par verify-purchase,
// comme tout achat.
//
// Secrets (les mêmes que verify-purchase) : APPLE_IAP_KEY_ID, APPLE_IAP_PRIVATE_KEY, APPLE_ISSUER_ID.
import { adminClient, caller, CORS, env, json } from '../_shared/http.ts';
import { promoClaims, promoHeader, promoRequest, promoStatus } from './promo-policy.js';
import { importPKCS8, SignJWT } from 'npm:jose@5.9.6';

type Signer = { key: CryptoKey; kid: string; iss: string };
async function signer(): Promise<Signer | null> {
  const pem = env('APPLE_IAP_PRIVATE_KEY');
  const kid = env('APPLE_IAP_KEY_ID');
  const iss = env('APPLE_ISSUER_ID');
  if (!pem || !kid || !iss) return null;
  try {
    return { key: await importPKCS8(pem.replace(/\\n/g, '\n'), 'ES256'), kid, iss };
  } catch (e) {
    console.error('coach-promo-offer: clé In-App Purchase illisible', e instanceof Error ? e.name : 'erreur');
    return null;
  }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await caller(req);
  if (!who) return json({ error: 'auth' }, 401);

  let body: unknown = null;
  try { body = await req.json(); } catch { /* corps illisible */ }
  const asked = promoRequest(body);
  if (!asked.ok) return json({ error: asked.error }, promoStatus(asked.error));

  const sign = await signer();
  if (!sign) return json({ error: 'apple_api_unconfigured' }, 503);

  const { data, error } = await adminClient().rpc('srv_coach_promo_grant', {
    p_user: who.user.id, p_product: asked.productId, p_intro_eligible: asked.introEligible,
  });
  if (error) {
    if (/rate_limited/.test(error.message)) return json({ error: 'rate_limited' }, 429);
    console.error('coach-promo-offer: base', error.code);
    return json({ error: 'server' }, 500);
  }
  if (!data?.ok) {
    const why = typeof data?.error === 'string' ? data.error : 'server';
    return json({ error: why }, promoStatus(why));
  }
  try {
    const claims = promoClaims({ issuerId: sign.iss, productId: asked.productId, offerId: data.offer_id,
      nonce: crypto.randomUUID().toLowerCase(), nowMs: Date.now() });
    const jws = await new SignJWT(claims).setProtectedHeader(promoHeader(sign.kid)).sign(sign.key);
    return json({ ok: true, offerId: data.offer_id, jws });
  } catch (e) {
    console.error('coach-promo-offer: signature', e instanceof Error ? e.message : 'erreur');
    return json({ error: 'server' }, 500);
  }
}

// Toujours servi en production ; les tests Deno (tests/deno, MDLF_EDGE_TESTS=1) importent le handler sans serveur
if (!Deno.env.get('MDLF_EDGE_TESTS')) Deno.serve(handler);
