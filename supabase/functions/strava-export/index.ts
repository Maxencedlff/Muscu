// Envoi d'une séance terminée vers Strava (activité manuelle), contrat : docs/STRAVA.md.
//
// 1. L'appelant est identifié par son jeton de session. Corps validé par validateExport
//    (_shared/strava-policy.js) : { session_id, name, sport_type, start_date_local, elapsed_time,
//    description?, distance?, trainer? }, sinon 400 { error: 'invalid', field }.
// 2. Réservation (strava_export_begin) : déjà envoyée → { ok: true, activity_id, already: true } ;
//    envoi en cours → 409 { error: 'busy' } ; pas relié → 409 { error: 'not_connected' } ;
//    30 par 24 h → 429 { error: 'rate_limited' }.
// 3. Jeton d'accès valable (renouvelé au besoin, _shared/strava.ts) ; droit activity:write absent →
//    403 { error: 'scope' } ; Strava injoignable → 503 { error: 'strava_down' } ; secrets absents →
//    503 { error: 'not_configured' }.
// 4. POST /api/v3/activities. 201 → envoi noté, { ok: true, activity_id } (texte). 401 : accès retiré chez
//    Strava, liaison effacée, 409 { error: 'not_connected' }. 429 : quota de l'app atteint, 503
//    { error: 'strava_busy' }. Autre refus : 502 { error: 'strava' }. Tout échec lève la réservation.
import { adminClient, caller, CORS, json } from '../_shared/http.ts';
import { activityIdFrom, hasWriteScope, validateExport } from '../_shared/strava-policy.js';
import { createActivity, forgetLink, stravaAccess } from '../_shared/strava.ts';

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await caller(req);
  if (!who) return json({ error: 'auth' }, 401);
  let body: unknown = null;
  try { body = await req.json(); } catch { /* refusé par la validation */ }
  const input = validateExport(body);
  if (!input.ok) return json({ error: input.error, field: input.field }, 400);

  const admin = adminClient();
  const userId = who.user.id;
  const { data: claim, error: claimErr } = await admin.rpc('strava_export_begin', { p_user: userId, p_session_id: input.sessionId });
  if (claimErr) {
    if (claimErr.message === 'not_connected') return json({ error: 'not_connected' }, 409);
    if (claimErr.message === 'rate_limited') return json({ error: 'rate_limited' }, 429);
    console.error('strava-export: réservation refusée', claimErr.code);
    return json({ error: 'server' }, 500);
  }
  if (claim?.status === 'done') return json({ ok: true, activity_id: String(claim.activity_id), already: true });
  if (claim?.status !== 'go') return json({ error: 'busy' }, 409);

  const release = async () => {
    const { error } = await admin.rpc('strava_export_finish', { p_user: userId, p_session_id: input.sessionId, p_activity_id: null });
    if (error) console.error('strava-export: réservation non levée', error.code);
  };
  const access = await stravaAccess(admin, userId);
  if (!access.ok) {
    await release();
    return json({ error: access.error }, access.error === 'not_connected' ? 409 : 503);
  }
  if (!hasWriteScope(access.scope)) { await release(); return json({ error: 'scope' }, 403); }

  const res = await createActivity(access.access, input.fields);
  if (res.status === 201) {
    const id = activityIdFrom(res.text);
    if (!id) { console.error('strava-export: activité créée sans identifiant lisible'); await release(); return json({ error: 'strava' }, 502); }
    const { error } = await admin.rpc('strava_export_finish', { p_user: userId, p_session_id: input.sessionId, p_activity_id: id });
    if (error) console.error('strava-export: envoi non noté', error.code);
    return json({ ok: true, activity_id: id });
  }
  await release();
  if (res.status === 401) { await forgetLink(admin, userId); return json({ error: 'not_connected' }, 409); }
  if (res.status === 429) return json({ error: 'strava_busy' }, 503);
  if (res.status === 0) return json({ error: 'strava_down' }, 503);
  console.error('strava-export: Strava a refusé l\'activité', res.status);
  return json({ error: 'strava' }, 502);
}

// Toujours servi en production ; les tests Deno (tests/deno, MDLF_EDGE_TESTS=1) importent le handler sans serveur
if (!Deno.env.get('MDLF_EDGE_TESTS')) Deno.serve(handler);
