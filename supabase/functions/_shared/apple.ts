// « Se connecter avec Apple » côté serveur, partagé par delete-account et revoke-apple.
//
// Deux étapes séparées :
// 1. exchangeAppleCode : le code d'autorisation tout frais (nouvelle connexion avec Apple dans l'app,
//    valable 5 minutes, une seule fois) est échangé auprès d'Apple (POST appleid.apple.com/auth/token).
//    Le jeton d'identité renvoyé, signé par Apple et reçu directement d'Apple en TLS, dit à quel
//    identifiant Apple il appartient (claim sub). Échange réussi et sub attendu = preuve que la
//    personne vient de se connecter avec cet identifiant Apple.
// 2. revokeAppleToken : révocation du jeton obtenu (POST appleid.apple.com/auth/revoke) : MDLF disparaît
//    de « Se connecter avec Apple » dans l'identifiant Apple. Au mieux : un échec ne bloque rien.
//
// Secrets (Management API, jamais dans le dépôt) : APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY
// (contenu du .p8 « Sign in with Apple »), APPLE_CLIENT_ID (com.mdlf.training).
import { importPKCS8, SignJWT, decodeJwt } from 'npm:jose@5.9.6';

const env = (k: string) => Deno.env.get(k) ?? '';
const form = (o: Record<string, string>) => new URLSearchParams(o);
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

export type AppleGrant = { sub: string; token: string; hint: 'refresh_token' | 'access_token'; secret: string };

// Client secret Apple : JWT ES256 signé avec la clé .p8, valable 5 minutes
async function appleClientSecret(): Promise<string> {
  const key = await importPKCS8(env('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n'), 'ES256');
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env('APPLE_KEY_ID') })
    .setIssuer(env('APPLE_TEAM_ID')).setIssuedAt().setExpirationTime('5m')
    .setAudience('https://appleid.apple.com').setSubject(env('APPLE_CLIENT_ID'))
    .sign(key);
}

// Code → jeton Apple, ou null (code absent, périmé ou déjà utilisé, Apple injoignable, secrets absents).
// expectedSub : identifiant Apple attendu ; un code d'un autre identifiant Apple est refusé (null).
// Sans expectedSub, le sub est seulement renvoyé (l'appelant décide).
export async function exchangeAppleCode(code: string, expectedSub = ''): Promise<AppleGrant | null> {
  if (!code || !env('APPLE_PRIVATE_KEY')) return null;
  try {
    const secret = await appleClientSecret();
    const res = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST', headers: FORM,
      body: form({ client_id: env('APPLE_CLIENT_ID'), client_secret: secret, code, grant_type: 'authorization_code' }),
    });
    if (!res.ok) return null;
    const t = await res.json();
    const sub = t.id_token ? String(decodeJwt(t.id_token).sub ?? '') : '';
    if (!sub || (expectedSub && sub !== expectedSub)) return null;
    const token = t.refresh_token ?? t.access_token;
    if (!token) return null;
    return { sub, token, hint: t.refresh_token ? 'refresh_token' : 'access_token', secret };
  } catch { return null; }
}

// Révocation au mieux : true si Apple l'a confirmée
export async function revokeAppleToken(grant: AppleGrant): Promise<boolean> {
  try {
    const res = await fetch('https://appleid.apple.com/auth/revoke', {
      method: 'POST', headers: FORM,
      body: form({ client_id: env('APPLE_CLIENT_ID'), client_secret: grant.secret, token: grant.token, token_type_hint: grant.hint }),
    });
    return res.ok;
  } catch { return false; }
}
