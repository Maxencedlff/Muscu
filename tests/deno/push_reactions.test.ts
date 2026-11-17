// push-send, notification d'une réaction (décision du 17/11, docs/NOTIFICATIONS.md) : le handler est appelé pour de
// vrai avec une file simulée (push_claim) et la requête partie vers APNs est relue dans les appels notés par le faux
// réseau (qui la refuse ensuite : rien ne sort, la notification reste en file pour un nouvel essai).
// Clé de signature générée pour le test (jamais une vraie clé APNs), jetons d'appareil faux et évidents.
import assert from 'node:assert/strict';
import { call, jsonResponse, request } from './fake.ts';
import { handler as pushSend } from '../../supabase/functions/push-send/index.ts';
import { pushMessage, REACTION_EMOJI } from '../../supabase/functions/push-send/push-policy.js';

const PUSH_SECRET = 'faux-secret-push-de-test-0123456789';   // faux, pour les tests gitleaks:allow
const FAKE_DEVICE = '5'.repeat(64);

async function fakeP8(): Promise<string> {
  const { privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
}

const claimRow = (o: Record<string, unknown>) => ({ id: 1, kind: 'reaction', ref: 's-1', token: FAKE_DEVICE, env: 'production', actor_name: 'lea', wanted: true, ...o });

// Une passe de push-send avec ces lignes en file ; rend les charges utiles parties vers APNs
async function sendWith(rows: Record<string, unknown>[]) {
  const p8 = await fakeP8();
  let claimed = false;
  const { res, calls } = await call(pushSend, request('POST', { headers: { 'x-push-secret': PUSH_SECRET } }), {
    env: { PUSH_CRON_SECRET: PUSH_SECRET, APNS_KEY_P8: p8, APNS_KEY_ID: 'FAUXKEY123', APNS_TEAM_ID: 'FAUXTEAM12' },
    routes: {
      'POST /rest/v1/rpc/push_claim': () => { const r = claimed ? [] : rows; claimed = true; return jsonResponse(r); },
      'POST /rest/v1/rpc/push_auth_get': () => jsonResponse(null),
      'POST /rest/v1/rpc/push_auth_swap': (c) => { const b = JSON.parse(c.body); return jsonResponse({ token: b.token, iat: b.iat, key_id: b.key_id }); },
      'POST /rest/v1/rpc/push_done': () => jsonResponse(null),
    },
  });
  assert.equal(res.status, 200);
  return calls.filter((c) => c.url.startsWith('https://api.push.apple.com/3/device/')).map((c) => JSON.parse(c.body));
}

Deno.test('push-send : réaction → emoji de la réaction et nom de ma séance, jamais « bravo »', async () => {
  const [p] = await sendWith([claimRow({ reaction: 'like', label: 'Push' })]);
  assert.deepEqual(p.aps.alert, { title: 'Nouvelle réaction', body: 'lea a réagi ❤️ à ta séance Push' });
  assert.deepEqual(p.mdlf, { kind: 'reaction', ref: 's-1' });
  const all = await sendWith([
    claimRow({ id: 2, reaction: 'fire' }),                          // séance sans nom
    claimRow({ id: 3 }),                                            // réaction retirée, ou push_claim d'avant le 17/11
    claimRow({ id: 4, reaction: '<script>', label: 'Push' }),       // sorte inconnue : jamais recopiée
  ]);
  assert.deepEqual(all.map((x) => x.aps.alert.body), ['lea a réagi 🔥 à ta séance', 'lea a aimé ta séance', 'lea a aimé ta séance']);
  assert.ok(!/bravo/i.test(JSON.stringify(all)), 'plus de « bravo »');
});

Deno.test('push-policy : un emoji pour chaque réaction de la liste fermée, rien d\'autre', () => {
  assert.deepEqual(Object.keys(REACTION_EMOJI), ['like', 'clap', 'fire', 'strong', 'trophy', 'wow']);
  for (const [kind, emoji] of Object.entries(REACTION_EMOJI)) {
    assert.equal(pushMessage(claimRow({ reaction: kind, label: 'Legs' })).body, `lea a réagi ${emoji} à ta séance Legs`);
  }
  for (const odd of ['toString', '__proto__', 'LIKE', '❤️', 42, null]) {
    assert.equal(pushMessage(claimRow({ reaction: odd })).body, 'lea a aimé ta séance', `sorte ${String(odd)}`);
  }
  // Nom de séance : une ligne, 40 caractères au plus
  assert.equal(pushMessage(claimRow({ reaction: 'wow', label: `A\n${'b'.repeat(80)}` })).body, `lea a réagi 😮 à ta séance A${'b'.repeat(39)}`);
});
