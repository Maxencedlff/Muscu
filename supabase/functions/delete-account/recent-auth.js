// Connexion récente, lue dans le claim amr du jeton de session Supabase (logique pure, sans réseau).
// Utilisé par index.ts (Deno) et par les tests unitaires (Node : tests/unit/account.mjs).
//
// Supabase écrit dans amr la liste des authentifications de la session : [{ method, timestamp }],
// timestamp en secondes. Une connexion par code e-mail donne 'otp' (ou 'magiclink'), une connexion
// Google ou Apple par jeton d'identité 'oauth'. Le rafraîchissement du jeton ne change pas ces dates :
// une session vieille d'un mois rafraîchie à l'instant reste vieille d'un mois.

// Méthodes qui prouvent que la personne vient de se reconnecter (pas un simple rafraîchissement)
export const FRESH_METHODS = ['otp', 'magiclink', 'oauth', 'email/signup'];
export const RECENT_AUTH_MAX_AGE_S = 10 * 60;

// Date (secondes) de la dernière vraie connexion de la session, ou null
export function lastAuthAt(claims) {
  const amr = Array.isArray(claims?.amr) ? claims.amr : [];
  let best = null;
  for (const a of amr) {
    if (!a || !FRESH_METHODS.includes(a.method) || !Number.isFinite(a.timestamp)) continue;
    if (best === null || a.timestamp > best) best = a.timestamp;
  }
  return best;
}

// Connexion de moins de maxAge secondes (une date dans le futur, horloge décalée de plus d'une minute, est refusée)
export function isRecentAuth(claims, nowS, maxAge = RECENT_AUTH_MAX_AGE_S) {
  const t = lastAuthAt(claims);
  return t !== null && nowS - t <= maxAge && t - nowS <= 60;
}
