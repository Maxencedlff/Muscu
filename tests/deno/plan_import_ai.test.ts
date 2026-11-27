// Fonction plan-import-ai (import aidé par l'IA, docs/IMPORT_IA.md), appelée pour de vrai SANS réseau :
// - le cœur (core.ts) avec un faux client d'Anthropic et un faux magasin : quotas, plafond, taille, validation de la
//   sortie, cascade, cache, bornes de l'appel (max_tokens, délai, aucune nouvelle tentative) ;
// - le point d'entrée de production (index.ts) avec le faux réseau de fake.ts : refus sans jeton, clé absente, et
//   aucune fuite de la clé (FAUSSE, évidente) dans les journaux ni dans les réponses.
import assert from 'node:assert/strict';
import { call, fakeJwt, fakeUser, FAKE_URL, jsonResponse, nowS, request, USER_ID } from './fake.ts';
import { makeHandler, type ModelClient, type Store } from '../../supabase/functions/plan-import-ai/core.ts';
import { LIBRARY_NAMES, LIMITS, MODEL_FIRST, MODEL_SECOND } from '../../supabase/functions/plan-import-ai/plan-ai-policy.js';
import { handler as prodHandler } from '../../supabase/functions/plan-import-ai/index.ts';

const FAKE_KEY = 'sk-ant-FAUSSE-CLE-DE-TEST-0000';
const DC = LIBRARY_NAMES.indexOf('Développé couché barre');
const item = (o: Record<string, unknown> = {}) => ({ exercise_id: null, sets: null, rep_min: null, rep_max: null, seconds: null, rest_s: null, load_kg: null,
  pct: null, rpe: null, rir: null, tempo: null, amrap: false, per_side: false, weighted: false, technique: null, technique_where: null, confidence: 'sure', ...o });
const msg = (answer: unknown, usage = { input_tokens: 300, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 7000 }) =>
  ({ content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', usage });

// Faux client : répond selon le modèle, note chaque appel (corps et options)
function fakeClient(answers: Record<string, (body: Record<string, unknown>) => unknown>) {
  const sent: Array<{ body: Record<string, unknown>; opts?: Record<string, unknown> }> = [];
  const client: ModelClient = { messages: { create: (body, opts) => { sent.push({ body, opts }); const f = answers[body.model as string]; return f ? Promise.resolve(f(body) as never) : Promise.reject(new Error('modèle inattendu')); } } };
  return { client, sent };
}
// Faux magasin : quota, plafond, cache en mémoire
function fakeStore({ refuse = null as null | 'quota_user' | 'quota_global', refuseSecond = false } = {}) {
  const reserved: string[] = [], settled: unknown[] = [], cache = new Map<string, unknown>();
  const store: Store = {
    reserve: ({ model }) => {
      if (refuse) return Promise.resolve({ ok: false, reason: refuse });
      if (refuseSecond && model === MODEL_SECOND) return Promise.resolve({ ok: false, reason: 'quota_global' });
      reserved.push(model); return Promise.resolve({ ok: true, id: reserved.length });
    },
    settle: (_id, a) => { settled.push(a); return Promise.resolve(0.001); },
    cacheGet: (keys) => Promise.resolve(new Map(keys.filter((k) => cache.has(k)).map((k) => [k, cache.get(k)]))),
    cachePut: (entries) => { for (const e of entries) cache.set(e.key, e.value); return Promise.resolve(); },
  };
  return { store, reserved, settled, cache };
}
const who = () => Promise.resolve({ id: USER_ID });
const post = (body: unknown) => new Request(`${FAKE_URL}/functions/v1/plan-import-ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const LINES = { mode: 'lines', targets: [{ text: 'DC 4x8-10 2min', prev: '', next: 'Squat 5x5', session: 'Push' }] };

Deno.test('plan-import-ai : lignes douteuses lues par le premier modèle, bornes de l\'appel', async () => {
  const { client, sent } = fakeClient({ [MODEL_FIRST]: () => msg({ answers: [{ id: 0, ...item({ exercise_id: DC, sets: 4, rep_min: 8, rep_max: 10, rest_s: 120 }) }] }) });
  const s = fakeStore();
  const res = await makeHandler({ caller: who, store: s.store, client: () => client })(post(LINES));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.results[0], { i: 0, name: 'Développé couché barre', presc: { sets: 4, repMin: 8, repMax: 10, rest: 120 }, confidence: 'sure', level: 'sure', why: [] });
  assert.equal(sent.length, 1, 'un seul appel : rien n\'a monté');
  assert.equal(sent[0].body.model, MODEL_FIRST);
  assert.equal(sent[0].body.max_tokens, LIMITS.maxTokensLines);
  assert.deepEqual(sent[0].opts, { timeout: 55_000, maxRetries: 0 }, 'délai borné, aucune nouvelle tentative');
  const oc = sent[0].body.output_config as { effort: string; format: { type: string } };
  assert.equal(oc.effort, 'low'); assert.equal(oc.format.type, 'json_schema');
  const sys = sent[0].body.system as Array<{ cache_control?: unknown }>;
  assert.deepEqual(sys[1].cache_control, { type: 'ephemeral' }, 'consigne et bibliothèque en cache');
  assert.ok(!JSON.stringify(sent[0].body).includes(USER_ID), 'aucun identifiant du compte envoyé au modèle');
  assert.deepEqual(s.reserved, [MODEL_FIRST]);
  assert.equal(s.settled.length, 1);
});

Deno.test('plan-import-ai : nombre absent de la ligne → refusé, la ligne monte au second modèle (sans cache d\'écriture)', async () => {
  const { client, sent } = fakeClient({
    [MODEL_FIRST]: () => msg({ answers: [{ id: 0, ...item({ exercise_id: DC, sets: 5, rep_min: 8, rep_max: 10 }) }] }),
    [MODEL_SECOND]: () => msg({ answers: [{ id: 0, ...item({ exercise_id: DC, sets: 4, rep_min: 8, rep_max: 10, rest_s: 120 }) }] }),
  });
  const res = await makeHandler({ caller: who, store: fakeStore().store, client: () => client })(post(LINES));
  const body = await res.json();
  assert.deepEqual(sent.map((x) => x.body.model), [MODEL_FIRST, MODEL_SECOND]);
  assert.equal((sent[1].body.system as Array<{ cache_control?: unknown }>)[1].cache_control, undefined);
  assert.equal(body.results[0].presc.sets, 4);
  assert.equal(body.usage.escalated, 1);
  // Montée refusée par le plafond : le résultat du premier reste, nombre faux retiré et ligne à vérifier
  const r2 = await makeHandler({ caller: who, store: fakeStore({ refuseSecond: true }).store, client: () => fakeClient({
    [MODEL_FIRST]: () => msg({ answers: [{ id: 0, ...item({ exercise_id: DC, sets: 5, rep_min: 8, rep_max: 10 }) }] }) }).client })(post(LINES));
  const b2 = await r2.json();
  assert.equal(r2.status, 200);
  assert.equal(b2.results[0].presc.sets, undefined);
  assert.equal(b2.results[0].level, 'check');
});

Deno.test('plan-import-ai : sortie hors schéma (fiche inexistante, réponse coupée) validée par le serveur', async () => {
  const { client } = fakeClient({
    [MODEL_FIRST]: () => msg({ answers: [{ id: 0, ...item({ exercise_id: 99999, sets: 4, rep_min: 8, rep_max: 10 }) }] }),
    [MODEL_SECOND]: () => ({ content: [{ type: 'text', text: '{"answers": [' }], stop_reason: 'max_tokens', usage: { input_tokens: 10, output_tokens: 4000 } }),
  });
  const body = await (await makeHandler({ caller: who, store: fakeStore().store, client: () => client })(post(LINES))).json();
  assert.equal(body.results[0].name, null, 'fiche inexistante : inconnu');
  assert.equal(body.results[0].level, 'unknown');
});

Deno.test('plan-import-ai : quota du compte (429) et plafond du mois (503), aucun appel au modèle', async () => {
  for (const [refuse, status] of [['quota_user', 429], ['quota_global', 503]] as const) {
    const { client, sent } = fakeClient({ [MODEL_FIRST]: () => msg({ answers: [] }) });
    const res = await makeHandler({ caller: who, store: fakeStore({ refuse }).store, client: () => client })(post(LINES));
    assert.equal(res.status, status);
    assert.equal((await res.json()).error, refuse);
    assert.equal(sent.length, 0);
  }
});

Deno.test('plan-import-ai : taille et entrée refusées avant tout appel ; méthode ; sans jeton', async () => {
  const { client, sent } = fakeClient({});
  const h = makeHandler({ caller: (req) => Promise.resolve(req.headers.get('x-ok') ? { id: USER_ID } : null), store: fakeStore().store, client: () => client });
  const ok = (b: unknown) => { const r = post(b); r.headers.set('x-ok', '1'); return r; };
  assert.equal((await h(post(LINES))).status, 401);
  assert.equal((await h(ok('x'.repeat(LIMITS.bodyBytes + 1)))).status, 413);
  assert.equal((await h(ok({ mode: 'lines', targets: [{ text: 'DC', nom_eleve: 'Julie' }] }))).status, 400);
  assert.equal((await h(ok({ mode: 'image', image: { media_type: 'image/jpeg', data: 'A'.repeat(400) } }))).status, 400, 'photo sans accord');
  assert.equal((await h(ok('{pas du json'))).status, 400);
  assert.equal((await h(new Request(`${FAKE_URL}/x`, { method: 'GET' }))).status, 405);
  assert.equal(sent.length, 0);
});

Deno.test('plan-import-ai : même plan deux fois → la seconde ne coûte rien (cache, sans texte gardé)', async () => {
  const plan = { mode: 'plan', lines: ['Lundi', 'DC 4x8 2 min', 'Zorglub 3x12'] };
  const { client, sent } = fakeClient({ [MODEL_FIRST]: () => msg({ title_line: null, sessions: [{ header_line: 0, items: [
    { ...item({ exercise_id: DC, sets: 4, rep_min: 8, rep_max: 8, rest_s: 120 }), line: 1, line_end: 1, superset: null },
    { ...item({ sets: 3, rep_min: 12, rep_max: 12 }), line: 2, line_end: 2, superset: null }] }] }) });
  const s = fakeStore();
  const h = makeHandler({ caller: who, store: s.store, client: () => client });
  const a = await (await h(post(plan))).json();
  const b = await (await h(post(plan))).json();
  assert.equal(sent.length, 1);
  assert.equal(b.usage.calls.length, 0);
  assert.deepEqual(b.draft, a.draft);
  assert.deepEqual(a.draft.sessions[0].items.map((i: { name: string | null; level: string }) => [i.name, i.level]), [['Développé couché barre', 'sure'], [null, 'unknown']]);
  const stored = JSON.stringify([...s.cache.values()]);
  assert.ok(!/DC 4x8|Zorglub|Lundi/.test(stored), 'le cache ne garde aucun texte importé');
});

Deno.test('plan-import-ai : photo envoyée seulement avec accord, puis jamais gardée', async () => {
  const { client, sent } = fakeClient({ [MODEL_FIRST]: () => msg({ title: null, sessions: [{ label: 'Push', items: [{ ...item({ exercise_id: DC, sets: 4, rep_min: 8, rep_max: 8 }), line_text: 'DC 4x8', superset: null }] }] }) });
  const s = fakeStore();
  const res = await makeHandler({ caller: who, store: s.store, client: () => client })(post({ mode: 'image', consent: true, image: { media_type: 'image/jpeg', data: 'A'.repeat(400) } }));
  assert.equal(res.status, 200);
  const content = (sent[0].body.messages as Array<{ content: Array<{ type: string }> }>)[0].content;
  assert.equal(content[0].type, 'image');
  assert.equal(s.cache.size, 0, 'aucune image ni résultat de photo gardé');
  assert.equal((await res.json()).draft.sessions[0].items[0].name, 'Développé couché barre');
});

// ── Point d'entrée de production, faux réseau : jeton, clé absente, aucune fuite de la clé ──
const jwt = fakeJwt({ sub: USER_ID, role: 'authenticated', exp: nowS() + 3600 });
const routes = {
  'POST /rest/v1/rpc/plan_ai_cache_get': () => jsonResponse([]),
  'POST /rest/v1/rpc/plan_ai_cache_put': () => jsonResponse(null),
  'POST /rest/v1/rpc/plan_ai_reserve': () => jsonResponse(1),
  'POST /rest/v1/rpc/plan_ai_settle': () => jsonResponse(null),
};

Deno.test('plan-import-ai (production) : sans jeton → 401, rien d\'appelé', async () => {
  const { res, calls } = await call(prodHandler, request('POST', { body: LINES }), { env: { ANTHROPIC_API_KEY: FAKE_KEY }, routes });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

Deno.test('plan-import-ai (production) : clé absente → 503 ai_off, rien de réservé', async () => {
  const { res, body, calls } = await call(prodHandler, request('POST', { body: LINES, headers: { Authorization: `Bearer ${jwt}` } }), { users: { [jwt]: fakeUser() }, routes });
  assert.equal(res.status, 503);
  assert.equal((body as { error: string }).error, 'ai_off');
  assert.ok(!calls.some((c) => c.path.includes('plan_ai_reserve')));
});

Deno.test('plan-import-ai (production) : la clé ne sort jamais (journaux, réponse, erreur réseau)', async () => {
  const logs: string[] = [];
  const orig = { error: console.error, log: console.log, warn: console.warn };
  for (const k of ['error', 'log', 'warn'] as const) console[k] = (...a: unknown[]) => { logs.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  try {
    const { res, body, calls } = await call(prodHandler, request('POST', { body: LINES, headers: { Authorization: `Bearer ${jwt}` } }), { env: { ANTHROPIC_API_KEY: FAKE_KEY }, users: { [jwt]: fakeUser() }, routes });
    assert.equal(res.status, 502, 'Anthropic injoignable (réseau interdit en test)');
    assert.ok(calls.some((c) => c.url.startsWith('https://api.anthropic.com')), 'le vrai SDK a tenté l\'appel');
    assert.equal(calls.filter((c) => c.url.startsWith('https://api.anthropic.com')).length, 1, 'une seule tentative');
    assert.ok(calls.some((c) => c.path.includes('plan_ai_settle')), 'appel en échec réglé (compté au pire cas)');
    assert.ok(!JSON.stringify(body).includes(FAKE_KEY), 'clé dans la réponse');
    assert.ok(!logs.join('\n').includes(FAKE_KEY), 'clé dans les journaux');
    assert.ok(!logs.join('\n').includes('FAUSSE-CLE'), 'morceau de la clé dans les journaux');
    assert.ok(!calls.filter((c) => c.url.startsWith(FAKE_URL)).some((c) => c.body.includes(FAKE_KEY)), 'clé envoyée à Supabase');
  } finally {
    Object.assign(console, orig);
  }
});
