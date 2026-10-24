// Suppression du compte MDLF (règle Apple 5.1.1(v)), appelée par js/data/account.js (accountDelete).
//
// 1. L'appelant est identifié par son jeton de session (JWT vérifié par Supabase et relu ici).
// 2. Le code d'autorisation Apple tout frais (nouvelle connexion avec Apple dans l'app) est échangé
//    contre un jeton, puis ce jeton est révoqué (POST appleid.apple.com/auth/revoke) : MDLF disparaît
//    de « Se connecter avec Apple » dans l'identifiant Apple. Le code doit appartenir au même
//    identifiant Apple que le compte (claim sub), sinon il est ignoré.
// 3. L'utilisateur est supprimé ; ses séances et son profil partent avec lui (on delete cascade).
// Révocation impossible (code périmé, Apple injoignable) : le compte est supprimé quand même et la
// réponse le dit (revoked: false) ; l'app explique alors comment retirer l'accès à la main.
//
// Secrets (Management API, jamais dans le dépôt) : APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY
// (contenu du .p8 « Sign in with Apple »), APPLE_CLIENT_ID (com.mdlf.training).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { importPKCS8, SignJWT, decodeJwt } from 'npm:jose@5.9.6';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const env = (k: string) => Deno.env.get(k) ?? '';
// Clé serveur : nouveau format (SUPABASE_SECRET_KEYS, JSON { nom: clé }) ou ancienne service_role
function secretKey(): string {
  try { const keys = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}'); const k = keys.default ?? Object.values(keys)[0]; if (k) return String(k); } catch { /* format ancien */ }
  return env('SUPABASE_SERVICE_ROLE_KEY');
}
function publishableKey(): string {
  try { const keys = JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS') || '{}'); const k = keys.default ?? Object.values(keys)[0]; if (k) return String(k); } catch { /* format ancien */ }
  return env('SUPABASE_ANON_KEY');
}

// Client secret Apple : JWT ES256 signé avec la clé .p8, valable 5 minutes
async function appleClientSecret(): Promise<string> {
  const key = await importPKCS8(env('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n'), 'ES256');
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env('APPLE_KEY_ID') })
    .setIssuer(env('APPLE_TEAM_ID')).setIssuedAt().setExpirationTime('5m')
    .setAudience('https://appleid.apple.com').setSubject(env('APPLE_CLIENT_ID'))
    .sign(key);
}

// Échange du code puis révocation ; true si Apple a confirmé la révocation
async function revokeApple(code: string, appleSub: string): Promise<boolean> {
  if (!code || !appleSub || !env('APPLE_PRIVATE_KEY')) return false;
  const secret = await appleClientSecret();
  const form = (o: Record<string, string>) => new URLSearchParams(o);
  const tok = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: env('APPLE_CLIENT_ID'), client_secret: secret, code, grant_type: 'authorization_code' }),
  });
  if (!tok.ok) return false;
  const t = await tok.json();
  // Le code doit venir du même identifiant Apple que le compte supprimé
  if (!t.id_token || decodeJwt(t.id_token).sub !== appleSub) return false;
  const token = t.refresh_token ?? t.access_token;
  const rev = await fetch('https://appleid.apple.com/auth/revoke', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: env('APPLE_CLIENT_ID'), client_secret: secret, token,
                 token_type_hint: t.refresh_token ? 'refresh_token' : 'access_token' }),
  });
  return rev.ok;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'auth' }, 401);

  const url = env('SUPABASE_URL');
  const asUser = createClient(url, publishableKey(), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: { user }, error } = await asUser.auth.getUser(auth.slice(7));
  if (error || !user) return json({ error: 'auth' }, 401);

  let code = '';
  try { code = String((await req.json())?.code ?? ''); } catch { /* corps vide : suppression sans révocation */ }
  const appleSub = user.identities?.find((i) => i.provider === 'apple')?.id ?? '';

  let revoked = false;
  try { revoked = await revokeApple(code, appleSub); } catch { revoked = false; }

  const admin = createClient(url, secretKey(), { auth: { persistSession: false } });
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) return json({ error: 'delete' }, 500);
  return json({ deleted: true, revoked });
});
