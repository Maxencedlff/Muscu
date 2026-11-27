// Import d'un programme aidé par l'IA (docs/IMPORT_IA.md), appelé par l'app (js/features/plan-import-ui.js) quand le
// moteur gratuit hésite ou que le coach touche « Lire avec l'aide de l'IA ».
//
// Ce fichier ne fait que brancher les vraies dépendances sur core.ts :
// - appelant : jeton de session relu sur le serveur d'authentification (_shared/http.ts, caller ; verify_jwt = false
//   dans config.toml, comme les autres fonctions) ;
// - magasin : les fonctions SQL de 20261130010000_import_ia.sql, avec la clé serveur (quotas, dépense, cache) ;
// - modèle : SDK officiel d'Anthropic, clé lue dans le secret ANTHROPIC_API_KEY (Deno.env), jamais écrite ailleurs ;
//   sans clé, l'aide est coupée (503 ai_off) et l'app garde le moteur gratuit.
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { adminClient, caller, env } from '../_shared/http.ts';
import { makeHandler, type ModelClient, type Store } from './core.ts';

const store: Store = {
  async reserve({ user, importId, model, worstUsd }) {
    const { data, error } = await adminClient().rpc('plan_ai_reserve', { p_user: user, p_import: importId, p_model: model, p_worst_usd: worstUsd });
    if (error) {
      if (error.message === 'quota_user' || error.message === 'quota_global') return { ok: false, reason: error.message };
      console.error('plan-import-ai: réservation refusée', error.code);
      return { ok: false, reason: 'store' };
    }
    return { ok: true, id: Number(data) };
  },
  async settle(id, { ok, usage }) {
    const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);
    const { data, error } = await adminClient().rpc('plan_ai_settle', {
      p_id: id, p_ok: ok, p_input: n(usage?.input_tokens), p_output: n(usage?.output_tokens),
      p_cache_write: n(usage?.cache_creation_input_tokens), p_cache_read: n(usage?.cache_read_input_tokens),
    });
    if (error) { console.error('plan-import-ai: règlement refusé', error.code); return null; }
    return data === null ? null : Number(data);
  },
  async cacheGet(keys) {
    const { data, error } = await adminClient().rpc('plan_ai_cache_get', { p_keys: keys });
    if (error) { console.error('plan-import-ai: cache illisible', error.code); return new Map(); }
    return new Map((data as Array<{ key: string; value: unknown }> ?? []).map((r) => [r.key, r.value]));
  },
  async cachePut(entries) {
    const { error } = await adminClient().rpc('plan_ai_cache_put', { p_entries: entries });
    if (error) console.error('plan-import-ai: cache non écrit', error.code);
  },
};

export const handler = makeHandler({
  caller: async (req) => { const who = await caller(req); return who ? { id: who.user.id } : null; },
  store,
  client: () => {
    const apiKey = env('ANTHROPIC_API_KEY');
    if (!apiKey) { console.error('plan-import-ai: ANTHROPIC_API_KEY absente, aide coupée'); return null; }
    // Adresse et journal fixés ici, pas par l'environnement : une variable ANTHROPIC_BASE_URL ou ANTHROPIC_LOG posée par
    // erreur n'envoie pas la clé ailleurs et ne journalise rien de la requête
    return new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com', logLevel: 'off', maxRetries: 0, timeout: 55_000 }) as unknown as ModelClient;
  },
});

// Toujours servi en production ; les tests Deno (tests/deno, MDLF_EDGE_TESTS=1) importent le handler sans serveur
if (!Deno.env.get('MDLF_EDGE_TESTS')) Deno.serve(handler);
