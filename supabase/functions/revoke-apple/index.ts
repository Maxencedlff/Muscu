// Révocation de l'accès Apple après le retrait de l'identité Apple d'un compte (écran Compte ›
// Moyens de connexion › Apple › Retirer), appelée par js/data/account.js (accountUnlink).
//
// L'app demande une connexion avec Apple (code tout frais), retire l'identité Apple du compte
// (unlinkIdentity), puis envoie le code ici. Dans cet ordre : révoquer avant le retrait laisserait un
// compte relié à un accès Apple révoqué, et l'app déconnecterait ce compte au lancement suivant.
//
// Le code est échangé auprès d'Apple (_shared/apple.ts) puis le jeton obtenu est révoqué. Seul celui
// qui vient de se connecter avec cet identifiant Apple possède un tel code : il ne peut révoquer que son
// propre accès. Refusé si cet identifiant Apple est encore relié au compte appelant (retrait pas fait ou
// échoué). Au mieux : { revoked: false } si Apple refuse ; l'app explique alors la marche à suivre.
import { bodyCode, caller, CORS, json } from '../_shared/http.ts';
import { exchangeAppleCode, revokeAppleToken } from '../_shared/apple.ts';

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await caller(req);
  if (!who) return json({ error: 'auth' }, 401);

  const grant = await exchangeAppleCode(await bodyCode(req));
  if (!grant) return json({ revoked: false });
  if (who.user.identities?.some((i) => i.provider === 'apple' && i.id === grant.sub)) return json({ error: 'still_linked', revoked: false }, 409);
  return json({ revoked: await revokeAppleToken(grant) });
}

// Toujours servi en production ; les tests Deno (tests/deno, MDLF_EDGE_TESTS=1) importent le handler sans serveur
if (!Deno.env.get('MDLF_EDGE_TESTS')) Deno.serve(handler);
