// Fonction error-report (remontée des erreurs, docs/ERREURS_PROD.md) appelée pour de vrai avec un faux réseau
// (tests/deno/fake.ts) : anonyme (aucun appel au serveur d'authentification, même avec un jeton), corps refusé
// avant toute écriture, rien d'autre que les champs connus inséré, jamais l'adresse IP, limite par appareil.
import assert from 'node:assert/strict';
import { call, fakeJwt, jsonResponse, nowS, request, USER_ID } from './fake.ts';
import { handler } from '../../supabase/functions/error-report/index.ts';

const GOOD = {
  v: 1, kind: 'error', name: 'TypeError', message: "Cannot read properties of undefined (reading '<s>')",
  frames: [{ f: 'render', file: 'js/features/session.js', l: 12, c: 3 }], build: '2026.11.29-abc1234', platform: 'ios',
};
const insertRoute = { 'POST /rest/v1/error_reports': () => jsonResponse(null, 201) };

Deno.test('error-report : rapport valable → 202, une insertion des seuls champs connus, sans IP ni jeton', async () => {
  const jwt = fakeJwt({ sub: USER_ID, role: 'authenticated', exp: nowS() + 3600 });
  const { res, body, calls } = await call(handler, request('POST', {
    body: GOOD, headers: { Authorization: `Bearer ${jwt}`, 'x-forwarded-for': '198.51.100.23' },
  }), { routes: insertRoute });
  assert.equal(res.status, 202);
  assert.deepEqual(body, { ok: true });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['POST /rest/v1/error_reports'], 'aucun appel au serveur d\'authentification');
  const row = JSON.parse(calls[0].body);
  assert.deepEqual(Object.keys(Array.isArray(row) ? row[0] : row).sort(), ['build', 'frames', 'kind', 'message', 'name', 'platform']);
  assert.ok(!calls[0].body.includes('198.51.100.23'), 'adresse IP insérée');
  assert.ok(!calls[0].body.includes(USER_ID), 'compte inséré');
});

Deno.test('error-report : corps invalide ou trop gros → 400 / 413, rien d\'écrit', async () => {
  for (const [b, status] of [[{ ...GOOD, email: 'x@exemple.invalid' }, 400], [{ ...GOOD, message: 'poids 82,5' }, 400], ['{pas du json', 400],
    [{ ...GOOD, message: 'x'.repeat(9000) }, 413]] as const) {
    const { res, calls } = await call(handler, request('POST', { body: b }), { routes: insertRoute });
    assert.equal(res.status, status, JSON.stringify(b).slice(0, 60));
    assert.equal(calls.length, 0, 'écriture malgré le refus');
  }
});

Deno.test('error-report : limite par appareil (20 par 10 minutes), un autre appareil passe', async () => {
  const from = (ip: string) => request('POST', { body: GOOD, headers: { 'x-forwarded-for': ip } });
  let last = 0;
  for (let i = 0; i < 21; i++) last = (await call(handler, from('192.0.2.50'), { routes: insertRoute })).res.status;
  assert.equal(last, 429);
  assert.equal((await call(handler, from('192.0.2.51'), { routes: insertRoute })).res.status, 202);
});

Deno.test('error-report : limite globale de la base (rate_limited) → 429', async () => {
  const { res } = await call(handler, request('POST', { body: GOOD, headers: { 'x-forwarded-for': '192.0.2.60' } }), {
    routes: { 'POST /rest/v1/error_reports': () => jsonResponse({ code: 'P0001', message: 'rate_limited' }, 400) },
  });
  assert.equal(res.status, 429);
});
