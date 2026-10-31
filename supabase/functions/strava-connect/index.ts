// Liaison du compte MDLF à Strava (OAuth), contrat : docs/STRAVA.md.
//
// POST (jeton de session de l'app) : début. L'appelant est identifié (_shared/http.ts), un état de
//   32 octets aléatoires est tiré, seule son empreinte est gardée en base (strava_state_create : 10 minutes,
//   usage unique, 10 par heure). Réponse { url } : page d'autorisation de Strava, que l'app ouvre dans
//   Safari. 401 { error: 'auth' }, 429 { error: 'rate_limited' }, 503 { error: 'not_configured' } tant
//   que les secrets STRAVA_* ne sont pas posés.
// GET (retour de Strava dans Safari, sans jeton de session : c'est l'état qui désigne le compte) :
//   ?code&scope&state ou ?error=access_denied&state. L'état est consommé (une seule fois) ; le code est
//   échangé contre les jetons, le droit activity:write vérifié (décoché : accès révoqué aussitôt), les
//   jetons chiffrés puis enregistrés (strava_link_save). Une liaison précédente à un autre athlète est
//   révoquée. Un athlète déjà relié à un AUTRE compte MDLF est refusé (#deja) : les jetons reçus sont
//   oubliés sans être révoqués, car une révocation chez Strava couperait aussi l'accès du compte qui le
//   détient déjà (un seul accord par athlète et par application). Réponse : redirection vers la page
//   publique STRAVA_RETURN_URL (par défaut https://mdlf.app/strava.html) avec le résultat en ancre :
//   #ok, #refuse, #droits, #deja, #expire, #erreur. La passerelle des fonctions Supabase ne sert pas de
//   page HTML : d'où la page publique.
//   Limite connue (docs/STRAVA.md, « Liaison et CSRF ») : rien ne lie l'état au téléphone qui l'a tiré.
//   approval_prompt=force montre toujours l'écran d'accord de Strava ; la vraie correction (code rendu à
//   l'app, envoyé avec sa session) demande une build.
import { adminClient, caller, CORS, env, json } from '../_shared/http.ts';
import { authorizeUrl, hasWriteScope, returnUrl } from '../_shared/strava-policy.js';
import { newState, openTokens, sealTokens, stateHash, stateLooksValid } from '../_shared/strava-crypto.js';
import { exchangeCode, key, revokeAtStrava, stravaConfigured } from '../_shared/strava.ts';

const DEFAULT_RETURN = 'https://mdlf.app/strava.html';
const redirectUri = () => `${env('SUPABASE_URL').replace(/\/+$/, '')}/functions/v1/strava-connect`;

function back(result: string) {
  return new Response(null, { status: 302, headers: {
    Location: returnUrl(env('STRAVA_RETURN_URL') || DEFAULT_RETURN, result),
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  } });
}

async function start(req: Request) {
  const who = await caller(req);
  if (!who) return json({ error: 'auth' }, 401);
  if (!stravaConfigured()) return json({ error: 'not_configured' }, 503);
  const state = newState();
  const { error } = await adminClient().rpc('strava_state_create', { p_user: who.user.id, p_state_hash: await stateHash(state) });
  if (error) {
    if (error.message === 'rate_limited') return json({ error: 'rate_limited' }, 429);
    console.error('strava-connect: état non enregistré', error.code);
    return json({ error: 'server' }, 500);
  }
  return json({ url: authorizeUrl({ clientId: env('STRAVA_CLIENT_ID'), redirectUri: redirectUri(), state }) });
}

async function finish(url: URL) {
  const state = url.searchParams.get('state') ?? '';
  if (!stateLooksValid(state)) return back('expire');
  const admin = adminClient();
  const { data: userId, error } = await admin.rpc('strava_state_consume', { p_state_hash: await stateHash(state) });
  if (error) { console.error('strava-connect: état illisible', error.code); return back('erreur'); }
  if (typeof userId !== 'string' || !userId) return back('expire');
  if (url.searchParams.get('error')) return back('refuse');
  const code = url.searchParams.get('code') ?? '';
  if (!code || code.length > 512 || !stravaConfigured()) return back('erreur');

  const t = await exchangeCode(code);
  if (!t || !t.athleteId) return back('erreur');
  if (!hasWriteScope(t.scope ?? url.searchParams.get('scope'))) {
    await revokeAtStrava({ access: t.access, refresh: t.refresh });
    return back('droits');
  }
  const k = await key();
  if (!k) return back('erreur');
  const sealed = await sealTokens(k, userId, { access: t.access, refresh: t.refresh });
  const { data: previous, error: saveErr } = await admin.rpc('strava_link_save', {
    p_user: userId, p_athlete_id: t.athleteId, p_athlete_name: t.athleteName, p_scope: t.scope ?? url.searchParams.get('scope') ?? '',
    p_tokens: sealed, p_expires_at: new Date(t.expiresAt * 1000).toISOString(),
  });
  if (saveErr?.message === 'athlete_taken') return back('deja');
  if (saveErr) {
    console.error('strava-connect: liaison non enregistrée', saveErr.code);
    await revokeAtStrava({ access: t.access, refresh: t.refresh });
    return back('erreur');
  }
  if (typeof previous === 'string' && previous) {
    const old = await openTokens(k, userId, previous);
    if (old) await revokeAtStrava(old);
  }
  return back('ok');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method === 'POST') return start(req);
  if (req.method === 'GET') return finish(new URL(req.url));
  return json({ error: 'method' }, 405);
});
