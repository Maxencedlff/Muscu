// Serveur LOCAL de mesure de plan-import-ai (docs/IMPORT_IA.md, « Mesure ») : le vrai cœur de la fonction
// (supabase/functions/plan-import-ai/core.ts) et le vrai client d'Anthropic, avec un appelant fixe et un magasin en
// mémoire qui applique la même règle de plafond que la base : la campagne s'arrête net à PLAN_IA_PLAFOND_USD
// (3 $ par défaut). Écoute sur 127.0.0.1 seulement, port choisi par le système, écrit « PORT <n> » au démarrage.
//
// La clé est lue dans le fichier PLAN_IA_CLE (défaut ~/.config/mdlf/anthropic_key), jamais affichée ni écrite.
// Lancé par tools/plan-import-ia/mesure.mjs :
//   deno run --allow-net=127.0.0.1,api.anthropic.com --allow-read=<clé>,<dépôt>,<journal> --allow-write=<journal> --allow-env tools/plan-import-ia/serveur.ts
// Journal de dépense de la campagne : PLAN_IA_DEPENSE (défaut ~/.local/share/mdlf/import-ia/depense.json).
// Chemins : /cascade (réglage de production), /seul (Claude Haiku 5.5 seul, sans montée), /sans-cache (cascade sans
// cache de résultats), /doute (montée aussi sur une réponse incertaine : réglage de la première mesure). Aucun n'est déployé.
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { makeHandler, type ModelClient, type Store } from '../../supabase/functions/plan-import-ai/core.ts';
import { costUsd, MODEL_FIRST } from '../../supabase/functions/plan-import-ai/plan-ai-policy.js';

const home = Deno.env.get('HOME') ?? '';
const keyFile = Deno.env.get('PLAN_IA_CLE') || `${home}/.config/mdlf/anthropic_key`;
const apiKey = (await Deno.readTextFile(keyFile)).trim();
if (!apiKey) throw new Error('clé vide');
const cap = Number(Deno.env.get('PLAN_IA_PLAFOND_USD') || 3);
// Dépense de toute la campagne, gardée d'un lancement à l'autre (fichier local, hors dépôt)
const ledger = Deno.env.get('PLAN_IA_DEPENSE') || `${home}/.local/share/mdlf/import-ia/depense.json`;
let before = 0;
try { before = Number(JSON.parse(await Deno.readTextFile(ledger)).usd) || 0; } catch { /* première campagne */ }
const effort = (Deno.env.get('PLAN_IA_EFFORT') || 'low') as 'low' | 'medium' | 'high';

// Magasin en mémoire : réservation au pire cas, règlement au coût réel (mêmes prix que la base), cache de résultats
const calls = new Map<number, { worst: number; cost: number | null; model: string }>();
let seq = 0;
const spent = () => before + [...calls.values()].reduce((n, c) => n + (c.cost ?? c.worst), 0);
const saveLedger = () => Deno.writeTextFile(ledger, JSON.stringify({ usd: spent(), at: new Date().toISOString() }));
const cache = new Map<string, unknown>();
const memory = (useCache: boolean): Store => ({
  reserve: ({ model, worstUsd }) => {
    if (spent() + worstUsd > cap) return Promise.resolve({ ok: false, reason: 'quota_global' });
    calls.set(++seq, { worst: worstUsd, cost: null, model });
    return Promise.resolve({ ok: true, id: seq });
  },
  settle: (id, { usage }) => {
    const c = calls.get(id)!;
    c.cost = usage ? costUsd(c.model, usage) : c.worst;
    return saveLedger().then(() => c.cost);
  },
  cacheGet: (keys) => Promise.resolve(new Map(useCache ? keys.filter((k) => cache.has(k)).map((k) => [k, cache.get(k)]) : [])),
  cachePut: (entries) => { if (useCache) for (const e of entries) cache.set(e.key, JSON.parse(JSON.stringify(e.value))); return Promise.resolve(); },
});
const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 55_000 }) as unknown as ModelClient;
const caller = () => Promise.resolve({ id: '00000000-0000-4000-8000-00000000be0c' });
const routes: Record<string, (r: Request) => Promise<Response>> = {
  '/cascade': makeHandler({ caller, store: memory(true), client: () => client, options: { effort } }),
  '/seul': makeHandler({ caller, store: memory(false), client: () => client, options: { cascade: false, effort } }),
  '/sans-cache': makeHandler({ caller, store: memory(false), client: () => client, options: { effort } }),
  '/doute': makeHandler({ caller, store: memory(false), client: () => client, options: { effort, doubt: true } }),
};

Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: ({ port }) => console.log(`PORT ${port}`) }, async (req) => {
  const path = new URL(req.url).pathname;
  if (path === '/depense') return Response.json({ usd: spent(), cap, model: MODEL_FIRST });
  if (path === '/vider-cache') { cache.clear(); return Response.json({ ok: true }); }
  const h = routes[path];
  return h ? await h(req) : new Response('absent', { status: 404 });
});
