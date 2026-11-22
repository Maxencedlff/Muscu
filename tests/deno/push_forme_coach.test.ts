// push-send, accord de la coach (docs/COACH_FORME.md) : « Commentaire de la coach » quand push_actor_forms rend 'elle'
// pour la ligne ; fonction absente (migration pas appliquée) ou en erreur : texte d'avant, la notification part quand
// même. Clé de signature générée pour le test (jamais une vraie clé APNs), jetons d'appareil faux et évidents.
import assert from 'node:assert/strict';
import { call, jsonResponse, request } from './fake.ts';
import { handler as pushSend } from '../../supabase/functions/push-send/index.ts';

const PUSH_SECRET = 'faux-secret-push-de-test-0123456789';   // faux, pour les tests gitleaks:allow
const FAKE_DEVICE = '6'.repeat(64);

async function fakeP8(): Promise<string> {
  const { privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
}
const row = (o: Record<string, unknown>) => ({ id: 1, kind: 'coach_note', ref: 's-1', token: FAKE_DEVICE, env: 'production', actor_name: 'lea', wanted: true, ...o });

async function sendWith(rows: Record<string, unknown>[], forms: (body: string) => Response) {
  const p8 = await fakeP8();
  let claimed = false;
  const asked: unknown[] = [];
  const { res, calls } = await call(pushSend, request('POST', { headers: { 'x-push-secret': PUSH_SECRET } }), {
    env: { PUSH_CRON_SECRET: PUSH_SECRET, APNS_KEY_P8: p8, APNS_KEY_ID: 'FAUXKEY123', APNS_TEAM_ID: 'FAUXTEAM12' },
    routes: {
      'POST /rest/v1/rpc/push_claim': () => { const r = claimed ? [] : rows; claimed = true; return jsonResponse(r); },
      'POST /rest/v1/rpc/push_actor_forms': (c) => { asked.push(JSON.parse(c.body)); return forms(c.body); },
      'POST /rest/v1/rpc/push_auth_get': () => jsonResponse(null),
      'POST /rest/v1/rpc/push_auth_swap': (c) => { const b = JSON.parse(c.body); return jsonResponse({ token: b.token, iat: b.iat, key_id: b.key_id }); },
      'POST /rest/v1/rpc/push_done': () => jsonResponse(null),
    },
  });
  assert.equal(res.status, 200);
  return { asked, sent: calls.filter((c) => c.url.startsWith('https://api.push.apple.com/3/device/')).map((c) => JSON.parse(c.body)) };
}

Deno.test('push-send : commentaire de la coach accordé, demandé pour les commentaires seulement', async () => {
  const { asked, sent } = await sendWith([row({ id: 1 }), row({ id: 2 }), row({ id: 3, kind: 'reaction', reaction: 'like' })],
    () => jsonResponse({ 1: 'elle', 2: 'il' }));
  assert.deepEqual(asked, [{ ids: [1, 2] }]);
  assert.deepEqual(sent.map((p) => p.aps.alert.title), ['Commentaire de la coach', 'Commentaire du coach', 'Nouvelle réaction']);
});

Deno.test('push-send : sans push_actor_forms (serveur d\'avant), texte d\'avant et envoi quand même', async () => {
  const { sent } = await sendWith([row({ id: 1 })], () => jsonResponse({ code: 'PGRST202', message: 'Could not find the function' }, 404));
  assert.deepEqual(sent.map((p) => p.aps.alert.title), ['Commentaire du coach']);
});
