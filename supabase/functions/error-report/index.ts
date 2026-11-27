// Réception des rapports d'erreur de l'app (docs/ERREURS_PROD.md), appelée par js/data/error-report.js.
//
// 1. Appel ANONYME : aucun jeton de session lu ni vérifié (verify_jwt = false dans config.toml, en-tête
//    Authorization ignoré) ; un rapport n'est jamais rattaché à un compte.
// 2. Corps de BODY_MAX octets au plus (413), JSON validé par error-policy.js (logique pure, testée par
//    tests/unit/error-report.mjs) : 400 { error: 'invalid', field } s'il sort de la liste blanche.
// 3. Limite par appareil (makeLimiter) : 20 rapports par 10 minutes et par empreinte salée de l'adresse IP,
//    en mémoire seulement (429). L'adresse IP n'est ni enregistrée ni journalisée.
// 4. Insertion avec la clé serveur (seul rôle qui écrit dans public.error_reports). Le déclencheur
//    private.error_report_before_insert calcule l'empreinte, regroupe la même erreur de la même version
//    (compteur hits), tient la limite globale (200 erreurs nouvelles par heure : 429) et purge après 90 jours.
// 5. Réponse : 202 { ok: true }. Toute réponse non 2xx coupe la remontée dans l'app jusqu'au prochain lancement.
import { adminClient, CORS, json } from '../_shared/http.ts';
import { BODY_MAX, clientAddress, makeLimiter, validateErrorReport } from './error-policy.js';

const limiter = makeLimiter();
const SALT = crypto.randomUUID();   // propre à cette instance, jamais écrit

async function deviceKey(req: Request): Promise<string> {
  const ip = clientAddress(req.headers);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${SALT}|${ip}`));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (Number(req.headers.get('content-length') || 0) > BODY_MAX) return json({ error: 'too_large' }, 413);
  let raw = '';
  try { raw = await req.text(); } catch { /* corps illisible : refusé ci-dessous */ }
  if (new TextEncoder().encode(raw).length > BODY_MAX) return json({ error: 'too_large' }, 413);
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* refusé par la validation */ }
  const checked = validateErrorReport(body);
  if (!('value' in checked)) return json({ error: 'invalid', field: checked.field }, 400);
  if (!limiter.hit(await deviceKey(req))) return json({ error: 'rate_limited' }, 429);

  const { error } = await adminClient().from('error_reports').insert(checked.value);
  if (error) {
    if (error.message?.includes('rate_limited')) return json({ error: 'rate_limited' }, 429);
    console.error('error-report: insertion refusée', error.code);
    return json({ error: 'server' }, 500);
  }
  return json({ ok: true }, 202);
}

// Toujours servi en production ; les tests Deno (tests/deno, MDLF_EDGE_TESTS=1) importent le handler sans serveur
if (!Deno.env.get('MDLF_EDGE_TESTS')) Deno.serve(handler);
