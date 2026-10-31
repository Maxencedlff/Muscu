// Envoi des notifications push en file (contrat : docs/NOTIFICATIONS.md, règles : push-policy.js).
//
// 1. Appelée par la planification de la base (pg_cron + pg_net, chaque minute, docs/BUILD.md), jamais par
//    l'app : l'en-tête x-push-secret doit valoir le secret PUSH_CRON_SECRET (comparaison en temps
//    constant), sinon 401. Pas de jeton de session (verify_jwt = false dans config.toml).
// 2. Secrets APNs, posés dans le projet Supabase, jamais dans le dépôt : APNS_KEY_P8 (contenu du fichier
//    AuthKey_XXXXXXXXXX.p8), APNS_KEY_ID, APNS_TEAM_ID ; APNS_TOPIC facultatif (com.mdlf.training).
//    Un secret absent : 503 { error: 'not_configured' } AVANT de prendre la file (rien n'est perdu).
// 3. File prise par public.push_claim (clé serveur), 100 lignes par tour, 5 tours au plus par appel ;
//    une ligne par appareil. Lignes plus voulues (type éteint, blocage) ou sans appareil : soldées sans
//    envoi. Envoi à APNs 10 par 10 (HTTP/2, fetch de Deno), suite donnée par apnsOutcome.
// 4. public.push_done solde les notifications traitées et retire les jetons morts. Les « nouvel essai »
//    restent en file (reprises 5 minutes plus tard, 5 essais au plus).
// 5. Réponse : { sent, dead, retry, dropped, skipped } ; aucun jeton ni contenu dans les journaux.
import { adminClient, env, json } from '../_shared/http.ts';
import { apnsOutcome, apnsRequest, providerToken, pushMessage, PROVIDER_TOKEN_TTL_S, sameSecret, settledIds } from './push-policy.js';

type ClaimRow = { id: number; kind: string; ref: string; token: string | null; env: string | null; actor_name: string | null; wanted: boolean };
type Result = { id: number; outcome: 'sent' | 'dead_token' | 'retry' | 'drop' | 'skip'; token?: string };

const BATCH = 100;
const ROUNDS = 5;
const PARALLEL = 10;

// Jeton du fournisseur gardé entre deux appels tant que l'instance vit (Apple : pas plus d'un toutes les 20 min)
let cached: { token: string; at: number } | null = null;
async function apnsAuth(): Promise<string> {
  const now = Date.now() / 1000;
  if (cached && now - cached.at < PROVIDER_TOKEN_TTL_S) return cached.token;
  const token = await providerToken({ keyP8: env('APNS_KEY_P8'), keyId: env('APNS_KEY_ID'), teamId: env('APNS_TEAM_ID'), nowS: now });
  cached = { token, at: now };
  return token;
}

async function sendOne(row: ClaimRow, topic: string): Promise<Result> {
  const msg = pushMessage(row);
  if ('skip' in msg) return { id: row.id, outcome: 'skip' };
  try {
    const { url, init } = apnsRequest(row, msg, { topic, providerToken: await apnsAuth(), nowS: Date.now() / 1000 });
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    let reason = '';
    if (res.status !== 200) { try { reason = String((await res.json())?.reason ?? ''); } catch { /* corps vide */ } }
    else await res.body?.cancel();
    const outcome = apnsOutcome(res.status, reason);
    if (res.status === 403) cached = null;   // jeton du fournisseur refusé : refait au prochain envoi
    if (outcome === 'drop' || outcome === 'retry') console.error('push-send: APNs', res.status, reason, row.kind);
    return { id: row.id, outcome, token: row.token ?? undefined };
  } catch (e) {
    console.error('push-send: APNs injoignable', e instanceof Error ? e.name : 'erreur');
    return { id: row.id, outcome: 'retry' };
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const secret = env('PUSH_CRON_SECRET');
  if (!secret || !sameSecret(req.headers.get('x-push-secret'), secret)) return json({ error: 'auth' }, 401);
  if (!env('APNS_KEY_P8') || !env('APNS_KEY_ID') || !env('APNS_TEAM_ID')) {
    console.error('push-send: secrets APNs absents, file laissée en attente');
    return json({ error: 'not_configured' }, 503);
  }
  const topic = env('APNS_TOPIC') || 'com.mdlf.training';
  const admin = adminClient();
  const total = { sent: 0, dead: 0, retry: 0, dropped: 0, skipped: 0 };

  for (let round = 0; round < ROUNDS; round++) {
    const { data, error } = await admin.rpc('push_claim', { max_rows: BATCH });
    if (error) { console.error('push-send: push_claim', error.code); return json({ error: 'claim' }, 500); }
    const rows = (Array.isArray(data) ? data : []) as ClaimRow[];
    if (!rows.length) break;
    const results: Result[] = [];
    for (let i = 0; i < rows.length; i += PARALLEL) {
      results.push(...await Promise.all(rows.slice(i, i + PARALLEL).map((r) => sendOne(r, topic))));
    }
    for (const r of results) {
      if (r.outcome === 'sent') total.sent++;
      else if (r.outcome === 'dead_token') total.dead++;
      else if (r.outcome === 'retry') total.retry++;
      else if (r.outcome === 'drop') total.dropped++;
      else total.skipped++;
    }
    const dead = [...new Set(results.filter((r) => r.outcome === 'dead_token' && r.token).map((r) => r.token as string))];
    const { error: doneErr } = await admin.rpc('push_done', { ids: settledIds(results), dead_tokens: dead });
    if (doneErr) { console.error('push-send: push_done', doneErr.code); return json({ error: 'done' }, 500); }
    if (rows.length < BATCH) break;
  }
  return json(total);
});
