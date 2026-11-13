// Faux environnement des fonctions Edge pour les tests de comportement (tests/deno/*.test.ts).
//
// Rien ne sort de la machine : globalThis.fetch est remplacé par un faux serveur Supabase qui note chaque
// appel et répond selon des routes déclarées par le test ; toute autre adresse est refusée (et notée, pour
// que le test la voie). Les variables d'environnement sont de FAUSSES valeurs évidentes, jamais un vrai
// secret. Lancé sans --allow-net : un vrai appel réseau échouerait de toute façon.

export const FAKE_URL = 'https://faux-projet.supabase.invalid';
export const FAKE_ENV: Record<string, string> = {
  SUPABASE_URL: FAKE_URL,
  SUPABASE_ANON_KEY: 'faux-anon-de-test',
  SUPABASE_SERVICE_ROLE_KEY: 'faux-service-role-de-test',
};
// Toutes les variables lues par les fonctions : effacées avant chaque test, pour qu'aucune valeur de la
// machine (ni un vrai secret) ne fausse un refus
export const ENV_KEYS = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS', 'SUPABASE_PUBLISHABLE_KEYS',
  'PUSH_CRON_SECRET', 'PHOTOS_PURGE_SECRET', 'APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_TOPIC',
  'RESEND_API_KEY', 'APPLE_PRIVATE_KEY', 'APPLE_KEY_ID', 'APPLE_TEAM_ID', 'APPLE_CLIENT_ID',
  'APPLE_IAP_KEY_ID', 'APPLE_IAP_PRIVATE_KEY', 'APPLE_ISSUER_ID',
  'STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_TOKEN_KEY', 'STRAVA_RETURN_URL',
];

export type Call = { method: string; url: string; path: string; auth: string | null; body: string };
type Route = (call: Call) => Response | Promise<Response>;

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// Jeton de session factice : lisible par decodeJwt (claims), jamais signé ; seul le faux serveur
// d'authentification décide s'il est « valable »
export const fakeJwt = (claims: Record<string, unknown>) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.faux-signature`;

export const nowS = () => Math.floor(Date.now() / 1000);
export const USER_ID = '00000000-0000-4000-8000-000000000001';
// Compte e-mail créé il y a deux jours, identité créée avec le compte (aucune identité récente)
export function fakeUser(over: Record<string, unknown> = {}) {
  const created = new Date(Date.now() - 2 * 86400_000).toISOString();
  return {
    id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'test@exemple.invalid',
    created_at: created, app_metadata: {}, user_metadata: {},
    identities: [{ id: 'identite-email', identity_id: 'identite-email', user_id: USER_ID, provider: 'email', created_at: created, identity_data: {} }],
    ...over,
  };
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Faux réseau. users : jeton → utilisateur que le serveur d'authentification reconnaît ;
// routes : « MÉTHODE /chemin » (chemin exact, ou préfixe terminé par *) → réponse.
export function installFakeNetwork({ users = {}, routes = {} }: { users?: Record<string, unknown>; routes?: Record<string, Route> } = {}) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const call: Call = {
      method: req.method, url: req.url, path: url.origin === FAKE_URL ? url.pathname : req.url,
      auth: req.headers.get('Authorization'), body: req.body ? await req.text() : '',
    };
    calls.push(call);
    if (url.origin !== FAKE_URL) throw new TypeError(`réseau interdit en test : ${url.origin}`);
    if (call.method === 'GET' && call.path === '/auth/v1/user') {
      const jwt = (call.auth ?? '').replace(/^Bearer /, '');
      const user = users[jwt];
      return user ? jsonResponse(user) : jsonResponse({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }, 401);
    }
    const key = `${call.method} ${call.path}`;
    const route = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith('*') && key.startsWith(k.slice(0, -1)))?.[1];
    if (route) return await route(call);
    return jsonResponse({ message: `route absente du faux serveur : ${key}` }, 599);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

export function resetEnv(extra: Record<string, string> = {}) {
  for (const k of ENV_KEYS) Deno.env.delete(k);
  for (const [k, v] of Object.entries({ ...FAKE_ENV, ...extra })) Deno.env.set(k, v);
}

export type Handler = (req: Request) => Promise<Response>;

// Un appel à la fonction, avec son faux réseau et son environnement ; rend la réponse, son corps et les appels sortis
export async function call(handler: Handler, req: Request, opts: { env?: Record<string, string>; users?: Record<string, unknown>; routes?: Record<string, Route> } = {}) {
  resetEnv(opts.env);
  const net = installFakeNetwork({ users: opts.users, routes: opts.routes });
  try {
    const res = await handler(req);
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* corps non JSON (OPTIONS, redirection) */ }
    return { res, body, calls: net.calls };
  } finally {
    net.restore();
    for (const k of ENV_KEYS) Deno.env.delete(k);
  }
}

export const request = (method: string, { headers = {}, body, query = '' }: { headers?: Record<string, string>; body?: unknown; query?: string } = {}) =>
  new Request(`${FAKE_URL}/functions/v1/test${query}`, {
    method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
