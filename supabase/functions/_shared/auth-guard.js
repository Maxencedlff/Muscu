// Garde de l'appelant des fonctions Edge (logique pure, sans réseau ni Deno), utilisée par
// _shared/http.ts (caller) et testée par tests/unit/auth-guard.mjs (Node).
//
// Les fonctions déployées avec verify_jwt = false (supabase/config.toml : delete-account,
// revoke-apple, report, verify-purchase) ne sont PAS protégées par la
// passerelle de Supabase : c'est ce code qui refuse un appel sans jeton valable. Le jeton est relu
// sur le serveur d'authentification (auth.getUser), qui en vérifie la signature et l'expiration ;
// décoder le jeton ne prouverait rien.
//
// requireCaller(req, getUser) → { user, jwt } ou null. null pour : pas d'en-tête Authorization, autre
// schéma que Bearer, jeton vide, refus du serveur d'authentification, réponse sans utilisateur, panne.

export function bearerToken(req) {
  const auth = req?.headers?.get?.('Authorization') ?? '';
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return null;
  const jwt = auth.slice(7).trim();
  return jwt ? jwt : null;
}

export async function requireCaller(req, getUser) {
  const jwt = bearerToken(req);
  if (!jwt) return null;
  try {
    const res = await getUser(jwt);
    const user = res?.data?.user;
    if (res?.error || !user || typeof user.id !== 'string' || !user.id) return null;
    return { user, jwt };
  } catch {
    return null;
  }
}
