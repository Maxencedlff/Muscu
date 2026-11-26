// Règles de coach-web-orphan (logique pure, sans réseau ni Deno), appliquées par index.ts et testées par
// tests/unit/coach-web-orphan.mjs (Node). La décision finale est prise par la base
// (public.coach_web_orphan_claim, migration 20261128010000_compte_vide_site_coach.sql) : ce tri préalable évite
// seulement d'interroger la base pour un compte qui n'a visiblement rien d'un compte tout neuf.
//
// Candidat : jeton du même compte que l'utilisateur relu par le serveur d'authentification (claim sub), claim
// session_id présent (uuid), une seule identité Google ou Apple, compte créé il y a moins de 10 minutes.

export const ORPHAN_MAX_AGE_S = 10 * 60;
export const ORPHAN_PROVIDERS = Object.freeze(['google', 'apple']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// { sid, provider } ou null (rien à supprimer, la base n'est pas interrogée)
export function orphanCandidate({ user, claims, nowS }) {
  if (!user || typeof user.id !== 'string' || !claims || claims.sub !== user.id) return null;
  const sid = claims.session_id;
  if (typeof sid !== 'string' || !UUID.test(sid)) return null;
  const ids = Array.isArray(user.identities) ? user.identities : [];
  if (ids.length !== 1 || !ORPHAN_PROVIDERS.includes(ids[0]?.provider)) return null;
  const created = Date.parse(user.created_at ?? '');
  if (!Number.isFinite(created)) return null;
  const age = nowS - Math.floor(created / 1000);
  if (age < -60 || age > ORPHAN_MAX_AGE_S) return null;
  return { sid, provider: ids[0].provider };
}

// Réponse de la base (texte) → réponse de la fonction { status, body }. Seul 'orphan' autorise la suppression.
export function claimOutcome(data, error) {
  if (error) return { status: 503, body: { error: 'claim' }, remove: false };
  if (data === 'orphan') return { status: 200, body: { deleted: true }, remove: true };
  if (data === 'limit') return { status: 429, body: { error: 'rate_limited' }, remove: false };
  return { status: 200, body: { deleted: false }, remove: false };
}
