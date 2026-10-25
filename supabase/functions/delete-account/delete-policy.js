// Règles de la suppression du compte (logique pure, sans réseau), appliquées par index.ts (Deno) et
// testées par tests/unit/account.mjs (Node). Même règle côté app : recentlyLinkedIdentity dans
// js/data/account-auth.js (l'écran prévient avant de demander une nouvelle connexion).
//
// 1. Preuve d'identité, l'une ou l'autre :
//    - compte relié à Apple : un code d'autorisation Apple tout frais, échangé par le serveur auprès
//      d'Apple, du même identifiant Apple que le compte (claim sub, vérifié par index.ts) ;
//    - sinon (ou si l'échange a échoué) : une connexion de moins de 10 minutes (claim amr, recent-auth.js).
//    Un compte Apple sans code (corps vide) n'a donc plus de passe-droit.
// 2. Aucun moyen de connexion ajouté depuis moins de 24 h, sauf ceux créés avec le compte. Relier un
//    compte Google donne une session « oauth » toute neuve (link_identity de Supabase Auth) : sans
//    cette règle, un jeton volé suffirait (relier son propre Google, puis supprimer).
import { isRecentAuth } from './recent-auth.js';

export const LINKED_IDENTITY_MIN_AGE_S = 24 * 3600;
// Identités créées avec le compte : même instant que le compte, à quelques minutes près
// (inscription puis confirmation du premier code, par exemple)
export const ACCOUNT_CREATION_SLACK_S = 10 * 60;

const seconds = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? Math.floor(t / 1000) : null; };

// Moyen de connexion ajouté depuis moins de 24 h (hors création du compte) : date (s) à partir de
// laquelle la suppression redevient possible, ou null. Une date illisible n'est pas comptée.
export function linkedIdentityHold(user, nowS) {
  const created = seconds(user?.created_at);
  let until = null;
  for (const i of Array.isArray(user?.identities) ? user.identities : []) {
    const at = seconds(i?.created_at);
    if (at === null) continue;
    if (created !== null && Math.abs(at - created) <= ACCOUNT_CREATION_SLACK_S) continue;
    const end = at + LINKED_IDENTITY_MIN_AGE_S;
    if (end > nowS && (until === null || end > until)) until = end;
  }
  return until;
}

// Décision : { ok: true, via: 'apple' | 'recent' } ou { ok: false, status, error, retryAt? }.
// appleProof : code Apple échangé avec succès, même identifiant Apple que le compte.
export function deleteDecision({ user, claims, nowS, appleProof = false }) {
  if (!user?.id) return { ok: false, status: 401, error: 'auth' };
  const hold = linkedIdentityHold(user, nowS);
  if (hold !== null) return { ok: false, status: 403, error: 'identity_recent', retryAt: new Date(hold * 1000).toISOString() };
  const apple = (user.identities || []).some((i) => i?.provider === 'apple');
  if (apple && appleProof) return { ok: true, via: 'apple' };
  if (claims?.sub === user.id && isRecentAuth(claims, nowS)) return { ok: true, via: 'recent' };
  // Compte Apple : l'app redemande une connexion avec Apple ; sinon un code e-mail ou Google
  return { ok: false, status: 401, error: apple ? 'apple' : 'reauth' };
}
