// Cœur de la fonction plan-import-ai (docs/IMPORT_IA.md), sans dépendance cachée : l'appelant, le magasin (quotas,
// dépense, cache) et le client d'Anthropic sont fournis par index.ts en production, par des faux dans les tests
// (tests/deno/plan_import_ai.test.ts) et par le serveur local de mesure (tools/plan-import-ia/serveur.ts).
//
// Déroulé d'une demande :
// 1. appelant connecté (jeton vérifié, 401 sinon) ; corps borné (413) et validé (400, plan-ai-policy.js) ;
// 2. cache de résultats : une ligne ou un plan déjà lus ne coûtent rien et ne comptent pas dans le quota ;
// 3. cascade : le modèle le moins cher (Claude Haiku 5.5) lit tout ce qui manque ; seules les lignes dont la réponse
//    échoue à la validation (nombre absent de la ligne, borne, fiche inexistante) montent au modèle supérieur
//    (Claude Sonnet 5.5), 30 au plus, comme une réponse entière inutilisable ;
// 4. chaque appel est réservé puis réglé au coût réel (store) : 20 imports par jour et par compte, plafond du mois
//    en euros ; au-delà : 429 quota_user ou 503 quota_global, et l'app garde le résultat du moteur gratuit ;
// 5. réponse : le brouillon (mode plan, image) ou les lignes corrigées (mode lines), et l'usage réel (tokens, dollars).
// Un appel : max_tokens borné, délai de 55 s, AUCUNE nouvelle tentative (maxRetries 0). La clé d'Anthropic n'est
// jamais lue ici : le client est déjà construit ; aucune erreur du client n'est recopiée dans un journal ni une réponse.
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import {
  buildDraft, cacheMaterial, checkItem, checkLines, checkPlan, LIMITS, lineResult, MODEL_FIRST, MODEL_SECOND, needsEscalation,
  normLine, parseModelJson, schemaFor, systemBlocks, userPrompt, validateInput, worstCaseUsd,
} from './plan-ai-policy.js';
import { CORS, json } from '../_shared/http.ts';

type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
type ModelMessage = { content: Array<{ type: string; text?: string }>; stop_reason: string | null; usage: Usage };
export type ModelClient = { messages: { create: (body: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<ModelMessage> } };
export type Store = {
  reserve: (a: { user: string; importId: string; model: string; worstUsd: number }) => Promise<{ ok: true; id: number } | { ok: false; reason: 'quota_user' | 'quota_global' | 'store' }>;
  settle: (id: number, a: { ok: boolean; usage: Usage | null }) => Promise<number | null>;
  cacheGet: (keys: string[]) => Promise<Map<string, unknown>>;
  cachePut: (entries: Array<{ key: string; value: unknown }>) => Promise<void>;
};
export type Deps = {
  caller: (req: Request) => Promise<{ id: string } | null>;
  store: Store;
  client: () => ModelClient | null;   // null : clé absente (aide coupée, 503 ai_off)
  // promptCache : cache d'Anthropic sur la consigne et la bibliothèque du premier modèle ; promptCacheSecond : aussi
  // pour le second (rarement appelé : l'écriture du cache coûterait plus qu'elle ne rend) ; unknownSure : faire monter
  // aussi une ligne lue sûrement comme hors bibliothèque ; doubt : faire monter aussi une réponse incertaine ou illisible ;
  // modelImage : premier modèle pour une photo (défaut MODEL_FIRST ; MODEL_SECOND si l'utilisateur choisit la lecture
  // renforcée de la photo, docs/IMPORT_IA.md « Recommandation »)
  options?: { modelImage?: string; cascade?: boolean; promptCache?: boolean; promptCacheSecond?: boolean; doubt?: boolean; unknownSure?: boolean; resultCache?: boolean;
    effort?: 'low' | 'medium' | 'high'; effortSecond?: 'low' | 'medium' | 'high'; timeoutMs?: number };
};
type Call = { model: string; mode: string; usage: Usage; usd: number | null; ok: boolean };
type Checked = { name: string | null; presc: Record<string, unknown>; confidence: string; flags: string[] };
class Stop extends Error { constructor(public status: number, public code: string) { super(code); } }

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeHandler(deps: Deps) {
  const opt = { modelImage: MODEL_FIRST, cascade: true, promptCache: true, promptCacheSecond: false, doubt: false, unknownSure: false, resultCache: true, effort: 'low' as const,
    effortSecond: 'low' as const, timeoutMs: 55_000, ...deps.options };

  return async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    const who = await deps.caller(req);
    if (!who) return json({ error: 'auth' }, 401);
    if (Number(req.headers.get('content-length') || 0) > LIMITS.bodyBytes) return json({ error: 'too_large' }, 413);
    let raw = '';
    try { raw = await req.text(); } catch { /* corps illisible : refusé ci-dessous */ }
    if (raw.length > LIMITS.bodyBytes) return json({ error: 'too_large' }, 413);
    let body: unknown = null;
    try { body = JSON.parse(raw); } catch { /* refusé par la validation */ }
    const checked = validateInput(body);
    if (!checked.ok) return json({ error: 'invalid', field: checked.field }, 400);
    const input = checked.value;

    const calls: Call[] = [];
    const importId = crypto.randomUUID();
    let client: ModelClient | null = null;
    // Un appel au modèle : réservé, envoyé une seule fois, réglé au coût réel. null : réponse inutilisable
    const ask = async (model: string, inp: typeof input, required: boolean): Promise<Record<string, unknown> | null> => {
      client ??= deps.client();
      if (!client) throw new Stop(503, 'ai_off');
      const imageChars = inp.mode === 'image' ? 0 : JSON.stringify(inp).length;
      const maxTokens = inp.mode === 'lines' ? LIMITS.maxTokensLines : LIMITS.maxTokensPlan;
      const res = await deps.store.reserve({ user: who.id, importId, model, worstUsd: worstCaseUsd(model, imageChars, maxTokens, inp.mode === 'image') });
      if (!res.ok) {
        if (!required) return null;   // montée au second modèle refusée : le résultat du premier reste
        throw new Stop(res.reason === 'store' ? 500 : res.reason === 'quota_user' ? 429 : 503, res.reason === 'store' ? 'server' : res.reason);
      }
      const content = inp.mode === 'image'
        ? [{ type: 'image', source: { type: 'base64', media_type: inp.image.media_type, data: inp.image.data } }, { type: 'text', text: userPrompt(inp) }]
        : userPrompt(inp);
      let msg: ModelMessage | null = null, failure: Stop | null = null;
      try {
        msg = await client.messages.create({
          model, max_tokens: maxTokens,
          system: systemBlocks({ cache: opt.promptCache && (model === MODEL_FIRST || opt.promptCacheSecond) }),
          messages: [{ role: 'user', content }],
          output_config: { effort: model === MODEL_FIRST ? opt.effort : opt.effortSecond, format: { type: 'json_schema', schema: schemaFor(inp.mode) } },
        }, { timeout: opt.timeoutMs, maxRetries: 0 });
      } catch (e) {
        failure = e instanceof Anthropic.APIConnectionTimeoutError ? new Stop(504, 'ai_timeout') : new Stop(502, 'ai_failed');
        const status = e instanceof Anthropic.APIError ? e.status : undefined;
        console.error('plan-import-ai: appel au modèle en échec', model, e instanceof Error ? e.constructor.name : 'erreur', status ?? '');
      }
      const usd = await deps.store.settle(res.id, { ok: !!msg, usage: msg?.usage ?? null });
      calls.push({ model, mode: inp.mode, usage: msg?.usage ?? {}, usd, ok: !!msg });
      if (failure) { if (required) throw failure; return null; }
      const parsed = parseModelJson(msg);
      if (!parsed) console.error('plan-import-ai: réponse inutilisable', model, msg?.stop_reason ?? '');
      return parsed;
    };

    try {
      const key = (kind: string, parts: string[]) => sha256(cacheMaterial(kind, parts));
      const getCache = async (keys: string[]) => (opt.resultCache ? await deps.store.cacheGet(keys).catch(() => new Map()) : new Map());
      const putCache = async (entries: Array<{ key: string; value: unknown }>) => { if (opt.resultCache && entries.length) await deps.store.cachePut(entries).catch(() => {}); };

      // Lignes à relire au second modèle (mode lines), avec leur réponse brute ; rend les réponses brutes finales
      const escalate = async (targets: Array<{ text: string; prev: string; next: string; session: string }>, first: Array<unknown>, checkedFirst: Checked[]) => {
        const finalRaw = [...first];
        if (!opt.cascade) return { finalRaw, escalated: 0 };
        const up = checkedFirst.map((r: Checked, i: number) => (needsEscalation(r, { doubt: opt.doubt, unknownSure: opt.unknownSure }) ? i : -1)).filter((i: number) => i >= 0).slice(0, LIMITS.escalateMax);
        if (!up.length) return { finalRaw, escalated: 0 };
        const ans = await ask(MODEL_SECOND, { mode: 'lines', targets: up.map((i) => targets[i]) }, false);
        const byId = new Map<number, unknown>();
        for (const a of Array.isArray(ans?.answers) ? ans!.answers as Array<{ id?: number }> : []) if (Number.isInteger(a?.id)) byId.set(a.id as number, a);
        up.forEach((i, k) => { if (byId.has(k)) finalRaw[i] = byId.get(k); });
        return { finalRaw, escalated: ans ? up.length : 0 };
      };

      if (input.mode === 'lines') {
        const keys = await Promise.all(input.targets.map((t) => key('line', [normLine(t.text)])));
        const cached = await getCache(keys);
        const todo = input.targets.map((_, i) => i).filter((i) => !cached.has(keys[i]));
        const raw: unknown[] = input.targets.map((_, i) => { const c = (cached.get(keys[i]) as { a?: object } | undefined)?.a; return c ? { ...c, id: i } : null; });
        let escalated = 0;
        if (todo.length) {
          const targets = todo.map((i) => input.targets[i]);
          const ans = await ask(MODEL_FIRST, { mode: 'lines', targets }, true);
          const first = targets.map((_, k) => (Array.isArray(ans?.answers) ? (ans!.answers as Array<{ id?: number }>).find((a) => a?.id === k) ?? null : null));
          const e = await escalate(targets, first, checkLines({ answers: first.filter(Boolean) }, targets));
          escalated = e.escalated;
          todo.forEach((i, k) => { raw[i] = e.finalRaw[k] ? { ...(e.finalRaw[k] as object), id: i } : null; });
          await putCache(todo.filter((i) => raw[i]).map((i) => ({ key: keys[i], value: { a: { ...(raw[i] as object), id: 0 } } })));
        }
        const results = checkLines({ answers: raw.filter(Boolean) }, input.targets).map(lineResult);
        return json({ ok: true, mode: 'lines', results, usage: usageOf(calls, input.targets.length - todo.length, escalated) });
      }

      // Plan ou image : lecture complète au premier modèle (au second si la réponse est inutilisable), puis montée
      // des seules lignes douteuses
      const planKey = input.mode === 'plan' ? await key('plan', [who.id, ...input.lines.map(normLine)]) : null;
      const hit = planKey ? (await getCache([planKey])).get(planKey) as { plan: Record<string, unknown>; fixes: Record<string, unknown> } | undefined : undefined;
      let planAnswer = hit?.plan ?? null, fixes: Record<string, unknown> = hit?.fixes ?? {}, escalated = 0;
      if (!planAnswer) {
        planAnswer = await ask(input.mode === 'image' ? opt.modelImage : MODEL_FIRST, input, true);
        if ((!planAnswer || !checkPlan(planAnswer, input)) && opt.cascade) { planAnswer = await ask(MODEL_SECOND, input, false); escalated = -1; }
        if (!planAnswer || !checkPlan(planAnswer, input)) throw new Stop(502, 'ai_failed');
        const plan0 = checkPlan(planAnswer, input)!;
        const flat = plan0.sessions.flatMap((s) => s.items.map((it) => ({ it, s })));
        if (opt.cascade && escalated === 0) {
          const ctx = flat.map(({ it, s }, k) => ({
            text: it.src.slice(0, LIMITS.lineChars),
            prev: input.mode === 'plan' && it.line! > 0 ? input.lines[it.line! - 1].slice(0, LIMITS.contextChars) : (flat[k - 1]?.it.src ?? '').slice(0, LIMITS.contextChars),
            next: input.mode === 'plan' && it.line! + 1 < input.lines.length ? input.lines[it.line! + 1].slice(0, LIMITS.contextChars) : (flat[k + 1]?.it.src ?? '').slice(0, LIMITS.contextChars),
            session: s.label.slice(0, LIMITS.sessionChars),
          }));
          const firstRaw = flat.map(({ it }) => it.a);
          const e = await escalate(ctx, firstRaw, flat.map(({ it }) => it.r));
          escalated = e.escalated;
          e.finalRaw.forEach((a, k) => { if (a !== firstRaw[k]) fixes[k] = a; });
        }
        if (planKey) await putCache([{ key: planKey, value: { plan: planAnswer, fixes } }]);
      }
      const plan = checkPlan(planAnswer, input)!;
      applyFixes(plan, fixes);
      return json({ ok: true, mode: input.mode, draft: buildDraft(plan, input), usage: usageOf(calls, hit ? 1 : 0, Math.max(0, escalated)) });
    } catch (e) {
      if (e instanceof Stop) return json({ error: e.code, usage: usageOf(calls, 0, 0) }, e.status);
      console.error('plan-import-ai: erreur interne', e instanceof Error ? e.constructor.name : 'erreur');
      return json({ error: 'server' }, 500);
    }
  };
}

// Corrections du second modèle, par rang dans le plan validé (checkPlan écarte les éléments sans ligne valable)
function applyFixes(plan: NonNullable<ReturnType<typeof checkPlan>>, fixes: Record<string, unknown>) {
  let k = 0;
  for (const s of plan.sessions) for (const it of s.items) { const f = fixes[k++]; if (f) it.r = checkItem(f, it.src); }
}

function usageOf(calls: Call[], cached: number, escalated: number) {
  const usd = calls.reduce((n, c) => n + (c.usd ?? 0), 0);
  return {
    calls: calls.map((c) => ({ model: c.model, mode: c.mode, ok: c.ok, input_tokens: c.usage.input_tokens ?? 0, output_tokens: c.usage.output_tokens ?? 0,
      cache_write: c.usage.cache_creation_input_tokens ?? 0, cache_read: c.usage.cache_read_input_tokens ?? 0, usd: c.usd })),
    cached, escalated, usd: Math.round(usd * 1e6) / 1e6,
  };
}
