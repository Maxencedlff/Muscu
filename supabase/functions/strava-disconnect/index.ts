// Déconnexion de Strava (Réglages › Strava › Déconnecter), contrat : docs/STRAVA.md.
//
// L'appelant est identifié par son jeton de session. Sa liaison, ses jetons chiffrés, ses envois notés
// et ses états en attente sont effacés (strava_link_delete), puis l'accès de l'app est révoqué chez
// Strava au mieux (_shared/strava.ts, disconnectStrava). Les activités déjà créées restent sur Strava :
// elles appartiennent à la personne.
// Réponse : { ok: true, revoked } (revoked faux : Strava n'a pas confirmé, l'app explique comment retirer
// l'accès dans strava.com/settings/apps). 401 { error: 'auth' }, 500 { error: 'server' }.
import { adminClient, caller, CORS, json } from '../_shared/http.ts';
import { disconnectStrava } from '../_shared/strava.ts';

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await caller(req);
  if (!who) return json({ error: 'auth' }, 401);
  const r = await disconnectStrava(adminClient(), who.user.id);
  return r.ok ? json({ ok: true, revoked: r.revoked }) : json({ error: 'server' }, 500);
}

// Toujours servi en production ; les tests Deno (tests/deno, MDLF_EDGE_TESTS=1) importent le handler sans serveur
if (!Deno.env.get('MDLF_EDGE_TESTS')) Deno.serve(handler);
