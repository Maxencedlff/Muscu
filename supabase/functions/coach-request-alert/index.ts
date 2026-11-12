// Alerte e-mail d'une nouvelle demande du rôle coach (docs/PAYANT_V1.md, « Rôle coach »), appelée
// par l'app juste après public.coach_request_submit.
//
// 1. Appelant identifié par son jeton de session (_shared/http.ts, caller) : 401 sinon.
// 2. On lit SA demande avec la clé serveur (colonnes de l'alerte seulement, voir la migration
//    20261030000000_payant_tarifs.sql) : un compte ne peut déclencher d'e-mail que pour sa propre
//    demande, et une seule fois tant qu'elle n'est pas modifiée (notified_at, alert-policy.js).
// 3. E-mail à contact@mdlf.app par l'API Resend (secret RESEND_API_KEY, le même que report). Au mieux :
//    Resend injoignable ou clé absente, la demande reste en attente, visible dans
//    private.coach_requests_pending ; l'app reçoit { ok: true, notified: false }.
import { adminClient, caller, CORS, env, json } from '../_shared/http.ts';
import { requestEmail, shouldAlert } from './alert-policy.js';

const ALERT_TO = 'contact@mdlf.app';
const ALERT_FROM = 'MDLF Training <noreply@mdlf.app>';

async function send(subject: string, text: string): Promise<boolean> {
  const key = env('RESEND_API_KEY');
  if (!key) { console.error('coach-request-alert: RESEND_API_KEY absente'); return false; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ALERT_FROM, to: [ALERT_TO], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error('coach-request-alert: Resend a refusé l\'alerte', res.status);
    return res.ok;
  } catch (e) {
    console.error('coach-request-alert: Resend injoignable', e instanceof Error ? e.name : 'erreur');
    return false;
  }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await caller(req);
  if (!who) return json({ error: 'auth' }, 401);

  const admin = adminClient();
  const { data: row, error } = await admin.from('coach_requests')
    .select('user_id, card_name, card_number, diploma, status, created_at, notified_at')
    .eq('user_id', who.user.id).maybeSingle();
  if (error) { console.error('coach-request-alert: lecture refusée', error.code); return json({ error: 'read' }, 500); }
  if (!shouldAlert(row)) return json({ ok: true, notified: false });

  const { data: prof } = await admin.from('user_profiles').select('username').eq('user_id', who.user.id).maybeSingle();
  const { subject, text } = requestEmail(row, prof?.username ?? null);
  if (!(await send(subject, text))) return json({ ok: true, notified: false });
  const { error: upErr } = await admin.from('coach_requests').update({ notified_at: new Date().toISOString() })
    .eq('user_id', who.user.id).is('notified_at', null);
  if (upErr) console.error('coach-request-alert: notified_at non posé', upErr.code);
  return json({ ok: true, notified: true });
}

// Toujours servi en production ; les tests Deno (tests/deno, MDLF_EDGE_TESTS=1) importent le handler sans serveur
if (!Deno.env.get('MDLF_EDGE_TESTS')) Deno.serve(handler);
