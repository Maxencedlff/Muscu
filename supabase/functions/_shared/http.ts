// Briques communes des fonctions serveur (delete-account, revoke-apple, verify-purchase,
// verify-app-transaction) : CORS, réponse JSON, clés
// du projet et lecture de l'appelant.
import { createClient, type User } from 'npm:@supabase/supabase-js@2.118.0';
import { decodeJwt } from 'npm:jose@5.9.6';
import { requireCaller } from './auth-guard.js';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export const env = (k: string) => Deno.env.get(k) ?? '';
// Clé serveur : nouveau format (SUPABASE_SECRET_KEYS, JSON { nom: clé }) ou ancienne service_role
export function secretKey(): string {
  try { const keys = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}'); const k = keys.default ?? Object.values(keys)[0]; if (k) return String(k); } catch { /* format ancien */ }
  return env('SUPABASE_SERVICE_ROLE_KEY');
}
function publishableKey(): string {
  try { const keys = JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS') || '{}'); const k = keys.default ?? Object.values(keys)[0]; if (k) return String(k); } catch { /* format ancien */ }
  return env('SUPABASE_ANON_KEY');
}

// Appelant identifié par son jeton de session, relu sur le serveur d'authentification (auth.getUser :
// jeton vérifié, utilisateur et identités à jour), par la garde pure _shared/auth-guard.js (testée
// sans Deno). claims : charge utile de ce même jeton (amr…). null = l'appelant doit recevoir 401.
export async function caller(req: Request): Promise<{ user: User; claims: Record<string, unknown> } | null> {
  const found = await requireCaller(req, (jwt: string) => {
    const asUser = createClient(env('SUPABASE_URL'), publishableKey(), { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
    return asUser.auth.getUser(jwt);
  });
  if (!found) return null;
  let claims: Record<string, unknown> = {};
  try { claims = decodeJwt(found.jwt); } catch { /* illisible : aucune connexion récente reconnue */ }
  return { user: found.user as User, claims };
}

export const adminClient = () => createClient(env('SUPABASE_URL'), secretKey(), { auth: { persistSession: false } });

// Corps JSON { code } (code d'autorisation Apple), '' s'il est absent ou illisible
export async function bodyCode(req: Request): Promise<string> {
  try { const c = (await req.json())?.code; return typeof c === 'string' ? c.slice(0, 512) : ''; } catch { return ''; }
}

// Corps JSON { jws } (preuve signée par Apple : transaction ou AppTransaction), '' s'il est absent ou
// illisible ; 64 Ko au plus, comme ce que _shared/apple-jws.js accepte
export async function bodyJws(req: Request): Promise<string> {
  try { const j = (await req.json())?.jws; return typeof j === 'string' ? j.slice(0, 65536) : ''; } catch { return ''; }
}
