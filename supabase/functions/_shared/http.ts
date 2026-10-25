// Briques communes des fonctions serveur (delete-account, revoke-apple) : CORS, réponse JSON, clés
// du projet et lecture de l'appelant.
import { createClient, type User } from 'npm:@supabase/supabase-js@2.118.0';
import { decodeJwt } from 'npm:jose@5.9.6';

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
// jeton vérifié, utilisateur et identités à jour). claims : charge utile de ce même jeton (amr…).
export async function caller(req: Request): Promise<{ user: User; claims: Record<string, unknown> } | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const jwt = auth.slice(7);
  const asUser = createClient(env('SUPABASE_URL'), publishableKey(), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: { user }, error } = await asUser.auth.getUser(jwt);
  if (error || !user) return null;
  let claims: Record<string, unknown> = {};
  try { claims = decodeJwt(jwt); } catch { /* illisible : aucune connexion récente reconnue */ }
  return { user, claims };
}

export const adminClient = () => createClient(env('SUPABASE_URL'), secretKey(), { auth: { persistSession: false } });

// Corps JSON { code } (code d'autorisation Apple), '' s'il est absent ou illisible
export async function bodyCode(req: Request): Promise<string> {
  try { const c = (await req.json())?.code; return typeof c === 'string' ? c.slice(0, 512) : ''; } catch { return ''; }
}
