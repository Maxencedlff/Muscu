// Suppression du compte MDLF (règle Apple 5.1.1(v)), appelée par js/data/account.js (accountDelete).
//
// 1. L'appelant est identifié par son jeton de session (JWT vérifié par Supabase et relu ici).
// 2. Compte relié à Apple : le code d'autorisation Apple tout frais (nouvelle connexion avec Apple dans
//    l'app) est d'abord échangé auprès d'Apple (_shared/apple.ts). Échange réussi et même identifiant
//    Apple que le compte (claim sub) : identité prouvée. L'échange seul ne supprime rien.
// 3. Décision (delete-policy.js) : preuve Apple, ou sinon connexion de moins de 10 minutes (claim amr,
//    recent-auth.js : nouveau code e-mail ou nouvelle connexion Google ou Apple) ; et aucun moyen de
//    connexion ajouté depuis moins de 24 h hors création du compte. Refus : 401 { error: 'reauth' |
//    'apple' }, ou 403 { error: 'identity_recent', retry_at }. Un jeton volé, une session restée
//    ouverte ou un corps vide ne suffisent pas.
// 4. Révocation de l'accès Apple, au mieux, seulement une fois la suppression décidée : MDLF disparaît
//    de « Se connecter avec Apple ». Impossible (code périmé, Apple injoignable) : le compte est
//    supprimé quand même et la réponse le dit (revoked: false) ; l'app explique alors comment retirer
//    l'accès à la main.
// 5. L'utilisateur est supprimé ; ses séances, son profil et son pseudo partent avec lui (on delete cascade).
import { adminClient, bodyCode, caller, CORS, json } from '../_shared/http.ts';
import { exchangeAppleCode, revokeAppleToken } from '../_shared/apple.ts';
import { deleteDecision } from './delete-policy.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await caller(req);
  if (!who) return json({ error: 'auth' }, 401);
  const { user, claims } = who;

  const appleSub = user.identities?.find((i) => i.provider === 'apple')?.id ?? '';
  const grant = appleSub ? await exchangeAppleCode(await bodyCode(req), appleSub) : null;
  const decision = deleteDecision({ user, claims, nowS: Math.floor(Date.now() / 1000), appleProof: !!grant });
  if (!decision.ok) return json({ error: decision.error, ...(decision.retryAt ? { retry_at: decision.retryAt } : {}) }, decision.status);

  const revoked = grant ? await revokeAppleToken(grant) : false;
  const { error: delErr } = await adminClient().auth.admin.deleteUser(user.id);
  if (delErr) return json({ error: 'delete' }, 500);
  return json({ deleted: true, revoked });
});
