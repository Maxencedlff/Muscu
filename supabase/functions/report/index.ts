// Signalement d'un profil ou d'une séance (Social V1, docs/SOCIAL_V1.md), appelé par l'app depuis le
// profil d'un autre ou une carte du fil.
//
// 1. L'appelant est identifié par son jeton de session (JWT vérifié par Supabase et relu ici,
//    _shared/http.ts) : un signalement anonyme est impossible.
// 2. Entrée validée par report-policy.js (logique pure, testée par tests/unit/report.mjs) : 400
//    { error: 'invalid', field } si elle est fausse. On ne se signale pas soi-même.
// 3. Insertion avec la clé serveur (seul rôle qui peut écrire dans public.reports). Le déclencheur
//    private.report_before_insert impose 10 signalements par 24 h et par compte (429 { error:
//    'rate_limited' }), pose la date et le pseudo signalé, et purge les signalements de plus de 12 mois.
//    Compte visé inconnu (clé étrangère) : 404 { error: 'not_found' }.
// 4. Alerte par e-mail à contact@mdlf.app (API Resend, secret RESEND_API_KEY, jamais dans le dépôt).
//    Au mieux : si Resend est injoignable ou la clé absente, le signalement reste enregistré
//    (notified_at nul, requête de rattrapage en bas de la migration 20261026050000_social.sql) et
//    l'app reçoit quand même { ok: true } ; sinon notified_at est posé.
// 5. Réponse : { ok: true }.
import { adminClient, caller, CORS, env, json } from '../_shared/http.ts';
import { reportEmail, validateReport } from './report-policy.js';

const ALERT_TO = 'contact@mdlf.app';
const ALERT_FROM = 'MDLF Training <noreply@mdlf.app>';

type ReportRow = {
  id: number; reporter_id: string; target_user: string; target_username: string | null;
  kind: string; target_ref: string | null; reason: string; details: string | null; created_at: string;
};

// Envoi par l'API Resend : true si accepté
async function sendAlert(report: ReportRow): Promise<boolean> {
  const key = env('RESEND_API_KEY');
  if (!key) { console.error('report: RESEND_API_KEY absente, alerte non envoyée', report.id); return false; }
  const { subject, text } = reportEmail(report);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ALERT_FROM, to: [ALERT_TO], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error('report: Resend a refusé l\'alerte', report.id, res.status);
    return res.ok;
  } catch (e) {
    console.error('report: Resend injoignable', report.id, e instanceof Error ? e.name : 'erreur');
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await caller(req);
  if (!who) return json({ error: 'auth' }, 401);

  let body: unknown = null;
  try { body = await req.json(); } catch { /* corps illisible : refusé par la validation */ }
  const input = validateReport(body, who.user.id);
  if (!input.ok) return json({ error: input.error, field: input.field }, 400);

  const admin = adminClient();
  const { data, error } = await admin.from('reports')
    .insert({ reporter_id: who.user.id, ...input.value })
    .select('id, reporter_id, target_user, target_username, kind, target_ref, reason, details, created_at')
    .single();
  if (error) {
    if (error.message === 'rate_limited') return json({ error: 'rate_limited' }, 429);
    if (error.code === '23503') return json({ error: 'not_found' }, 404);
    if (error.code === '23514') return json({ error: 'invalid' }, 400);
    console.error('report: insertion refusée', error.code);
    return json({ error: 'report' }, 500);
  }

  const report = data as ReportRow;
  if (await sendAlert(report)) {
    const { error: upErr } = await admin.from('reports').update({ notified_at: new Date().toISOString() }).eq('id', report.id);
    if (upErr) console.error('report: notified_at non posé', report.id, upErr.code);
  }
  return json({ ok: true });
});
