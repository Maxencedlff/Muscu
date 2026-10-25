// Suppression du compte MDLF (règle Apple 5.1.1(v)), appelée par js/data/account.js (accountDelete).
//
// 1. L'appelant est identifié par son jeton de session (JWT vérifié par Supabase et relu ici).
// 2. Compte relié à Apple : le code d'autorisation Apple tout frais (nouvelle connexion avec Apple dans
//    l'app) est d'abord échangé auprès d'Apple (_shared/apple.ts). Échange réussi et même identifiant
//    Apple que le compte (claim sub) : identité prouvée. L'échange seul ne supprime rien.
// 3. Décision (delete-policy.js) : preuve Apple, ou sinon connexion de moins de 10 minutes (claim amr,
//    recent-auth.js : nouveau code e-mail ou nouvelle connexion Google ou Apple) ; et aucun moyen de
//    connexion ajouté ni retiré depuis moins de 24 h hors création du compte : identités présentes, et
//    journal du serveur (public.recent_identity_change, clé serveur) qui voit aussi les retraits.
//    Refus : 401 { error: 'reauth' | 'apple' }, 403 { error: 'identity_recent', retry_at }, ou 500
//    { error: 'identity_check' } si le journal est illisible. Un jeton volé, une session restée
//    ouverte, un corps vide, ou relier puis retirer aussitôt son propre Google ne suffisent pas.
// 4. Révocation de l'accès Apple, au mieux, seulement une fois la suppression décidée : MDLF disparaît
//    de « Se connecter avec Apple ». Impossible (code périmé, Apple injoignable) : le compte est
//    supprimé quand même et la réponse le dit (revoked: false) ; l'app explique alors comment retirer
//    l'accès à la main.
// 5. L'utilisateur est supprimé ; ses séances, son profil et son pseudo partent avec lui (on delete cascade).
import { adminClient, bodyCode, caller, CORS, json } from '../_shared/http.ts';
import { exchangeAppleCode, revokeAppleToken } from '../_shared/apple.ts';
import { deleteDecision, LINKED_IDENTITY_MIN_AGE_S } from './delete-policy.js';

// Dernier ajout ou retrait d'un moyen de connexion dans les 24 h : date ISO, null si aucun,
// undefined si le journal est injoignable (la décision refuse alors).
async function identityChangeAt(userId: string): Promise<string | null | undefined> {
  const { data, error } = await adminClient().rpc('recent_identity_change', { uid: userId, since: `${LINKED_IDENTITY_MIN_AGE_S} seconds` });
  if (error) return undefined;
  return typeof data === 'string' || data === null ? data : undefined;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await caller(req);
  if (!who) return json({ error: 'auth' }, 401);
  const { user, claims } = who;

  const appleSub = user.identities?.find((i) => i.provider === 'apple')?.id ?? '';
  const [grant, changeAt] = await Promise.all([
    appleSub ? bodyCode(req).then((code) => exchangeAppleCode(code, appleSub)) : null,
    identityChangeAt(user.id),
  ]);
  const decision = deleteDecision({ user, claims, nowS: Math.floor(Date.now() / 1000), appleProof: !!grant, identityChangeAt: changeAt });
  if (!decision.ok) return json({ error: decision.error, ...(decision.retryAt ? { retry_at: decision.retryAt } : {}) }, decision.status);

  const revoked = grant ? await revokeAppleToken(grant) : false;
  const { error: delErr } = await adminClient().auth.admin.deleteUser(user.id);
  if (delErr) return json({ error: 'delete' }, 500);
  return json({ deleted: true, revoked });
});
