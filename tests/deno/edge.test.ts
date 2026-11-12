// Tests de comportement des 11 fonctions Edge (audit du 12/11, M7) : chaque handler exporté par
// supabase/functions/*/index.ts est appelé pour de vrai, avec un faux réseau et de fausses variables
// d'environnement (tests/deno/fake.ts). Ils vérifient les refus d'entrée (méthode, CORS, jeton de session,
// secret partagé, signature d'Apple, corps invalide) et, pour delete-account, la règle de connexion récente.
// Lancement : deno test --config supabase/functions/deno.json --frozen --allow-env tests/deno (en CI, --allow-env
// limité à la liste ENV_KEYS de fake.ts : .github/workflows/tests.yml, job edge)
import assert from 'node:assert/strict';
import { call, fakeJwt, fakeUser, jsonResponse, nowS, request, USER_ID, type Handler } from './fake.ts';

import { handler as appstoreNotify } from '../../supabase/functions/appstore-notify/index.ts';
import { handler as coachPhotosPurge } from '../../supabase/functions/coach-photos-purge/index.ts';
import { handler as coachRequestAlert } from '../../supabase/functions/coach-request-alert/index.ts';
import { handler as deleteAccount } from '../../supabase/functions/delete-account/index.ts';
import { handler as pushSend } from '../../supabase/functions/push-send/index.ts';
import { handler as report } from '../../supabase/functions/report/index.ts';
import { handler as revokeApple } from '../../supabase/functions/revoke-apple/index.ts';
import { handler as stravaConnect } from '../../supabase/functions/strava-connect/index.ts';
import { handler as stravaDisconnect } from '../../supabase/functions/strava-disconnect/index.ts';
import { handler as stravaExport } from '../../supabase/functions/strava-export/index.ts';
import { handler as verifyPurchase } from '../../supabase/functions/verify-purchase/index.ts';

const ALL: Record<string, Handler> = {
  'appstore-notify': appstoreNotify, 'coach-photos-purge': coachPhotosPurge, 'coach-request-alert': coachRequestAlert,
  'delete-account': deleteAccount, 'push-send': pushSend, report, 'revoke-apple': revokeApple,
  'strava-connect': stravaConnect, 'strava-disconnect': stravaDisconnect, 'strava-export': stravaExport,
  'verify-purchase': verifyPurchase,
};
// Appelées par l'app avec un jeton de session (caller, _shared/http.ts)
const WITH_SESSION: Record<string, Handler> = {
  'coach-request-alert': coachRequestAlert, 'delete-account': deleteAccount, report, 'revoke-apple': revokeApple,
  'strava-connect': stravaConnect, 'strava-disconnect': stravaDisconnect, 'strava-export': stravaExport,
  'verify-purchase': verifyPurchase,
};
// Appelées par la planification de la base, avec un secret partagé
const PUSH_SECRET = 'faux-secret-push-de-test-0123456789';   // faux, pour les tests gitleaks:allow
const PURGE_SECRET = 'faux-secret-purge-de-test-0123456789'; // faux, pour les tests gitleaks:allow
const WITH_SECRET = {
  'push-send': { handler: pushSend, env: 'PUSH_CRON_SECRET', header: 'x-push-secret', secret: PUSH_SECRET },
  'coach-photos-purge': { handler: coachPhotosPurge, env: 'PHOTOS_PURGE_SECRET', header: 'x-purge-secret', secret: PURGE_SECRET },
};

const GOOD = fakeJwt({ sub: USER_ID, role: 'authenticated', exp: nowS() + 3600 });
const bearer = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });
const onlyAuthServer = (calls: { method: string; path: string }[]) =>
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /auth/v1/user'], 'seul le serveur d\'authentification est appelé');

Deno.test('toutes : mauvaise méthode → 405, sans rien appeler', async () => {
  for (const [name, handler] of Object.entries(ALL)) {
    const s = (WITH_SECRET as Record<string, { env: string; header: string; secret: string }>)[name];
    const { res, body, calls } = await call(handler, request('PUT', { headers: s ? { [s.header]: s.secret } : {} }), {
      env: s ? { [s.env]: s.secret } : {},
    });
    assert.equal(res.status, 405, `${name} : PUT accepté (${res.status})`);
    assert.deepEqual(body, { error: 'method' }, name);
    assert.equal(calls.length, 0, `${name} : appel réseau avant le refus`);
  }
  // DELETE et PATCH aussi, pour une fonction de chaque famille
  for (const m of ['DELETE', 'PATCH']) {
    assert.equal((await call(deleteAccount, request(m))).res.status, 405, `delete-account ${m}`);
    assert.equal((await call(appstoreNotify, request(m))).res.status, 405, `appstore-notify ${m}`);
  }
  // GET : seule strava-connect le sert (retour de Strava) ; les autres le refusent
  for (const [name, handler] of Object.entries(WITH_SESSION)) {
    if (name === 'strava-connect') continue;
    assert.equal((await call(handler, request('GET'))).res.status, 405, `${name} : GET accepté`);
  }
});

Deno.test('appelées par l\'app : OPTIONS (pré-vol CORS) → 200 avec les en-têtes CORS, sans rien appeler', async () => {
  for (const [name, handler] of Object.entries({ ...WITH_SESSION, 'appstore-notify': appstoreNotify })) {
    const { res, calls } = await call(handler, request('OPTIONS'));
    assert.equal(res.status, 200, name);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*', name);
    assert.match(res.headers.get('Access-Control-Allow-Methods') ?? '', /\bPOST\b/, name);
    assert.match(res.headers.get('Access-Control-Allow-Headers') ?? '', /\bauthorization\b/, name);
    assert.equal(calls.length, 0, `${name} : appel réseau sur OPTIONS`);
  }
  // Les fonctions de la planification ne servent pas le pré-vol : refus
  assert.equal((await call(pushSend, request('OPTIONS'))).res.status, 405);
  assert.equal((await call(coachPhotosPurge, request('OPTIONS'))).res.status, 401);
});

Deno.test('jeton de session absent ou mal formé → 401, serveur d\'authentification jamais appelé', async () => {
  const BAD_HEADERS: Record<string, string>[] = [
    {}, { Authorization: '' }, { Authorization: 'Bearer' }, { Authorization: 'Bearer    ' },
    { Authorization: `Basic ${btoa('faux:faux')}` }, { Authorization: `bearer ${GOOD}` }, { Authorization: GOOD },
  ];
  for (const [name, handler] of Object.entries(WITH_SESSION)) {
    for (const headers of BAD_HEADERS) {
      const { res, body, calls } = await call(handler, request('POST', { headers, body: { code: 'faux-code', jws: 'a.b.c' } }), { users: { [GOOD]: fakeUser() } });
      assert.equal(res.status, 401, `${name} : ${JSON.stringify(headers)} accepté (${res.status})`);
      assert.deepEqual(body, { error: 'auth' }, name);
      assert.equal(calls.length, 0, `${name} : appel réseau sans jeton`);
    }
  }
});

Deno.test('jeton de session refusé par le serveur d\'authentification → 401, et rien d\'autre', async () => {
  const forged = fakeJwt({ sub: USER_ID, role: 'authenticated', exp: nowS() + 3600, amr: [{ method: 'otp', timestamp: nowS() }] });
  for (const [name, handler] of Object.entries(WITH_SESSION)) {
    for (const jwt of [forged, 'pas-un-jwt', fakeJwt({ sub: USER_ID, exp: nowS() - 60 })]) {
      const { res, body, calls } = await call(handler, request('POST', { headers: bearer(jwt), body: { code: 'faux-code' } }), { users: { [GOOD]: fakeUser() } });
      assert.equal(res.status, 401, `${name} : jeton refusé mais accepté (${res.status})`);
      assert.deepEqual(body, { error: 'auth' }, name);
      onlyAuthServer(calls);
      assert.equal(calls[0].auth, `Bearer ${jwt}`, `${name} : le jeton présenté est celui vérifié`);
    }
  }
});

Deno.test('jeton valable mais serveur d\'authentification en panne → 401 (jamais accepté par défaut)', async () => {
  for (const [name, handler] of Object.entries(WITH_SESSION)) {
    const { res } = await call(handler, request('POST', { headers: bearer(GOOD) }), {
      routes: {}, users: {},
    });
    assert.equal(res.status, 401, name);
  }
  // Utilisateur rendu sans id : refusé aussi
  const { res } = await call(deleteAccount, request('POST', { headers: bearer(GOOD) }), { users: { [GOOD]: { ...fakeUser(), id: '' } } });
  assert.equal(res.status, 401);
});

Deno.test('secret partagé (push-send, coach-photos-purge) : absent, faux ou non configuré → 401, sans rien appeler', async () => {
  for (const [name, s] of Object.entries(WITH_SECRET)) {
    const cases: { env?: string; header?: string; why: string }[] = [
      { env: s.secret, why: 'en-tête absent' },
      { env: s.secret, header: '', why: 'en-tête vide' },
      { env: s.secret, header: 'faux', why: 'mauvais secret' },
      { env: s.secret, header: s.secret.slice(0, -1) + 'X', why: 'mauvais secret de même longueur' },
      { env: s.secret, header: s.secret + 'X', why: 'secret allongé' },
      { env: s.secret, header: s.secret.toUpperCase(), why: 'casse différente' },
      { header: s.secret, why: 'secret absent du projet' },
      { header: '', why: 'secret absent du projet, en-tête vide' },
    ];
    for (const c of cases) {
      const headers = c.header === undefined ? {} : { [s.header]: c.header };
      const { res, body, calls } = await call(s.handler, request('POST', { headers }), { env: c.env === undefined ? {} : { [s.env]: c.env } });
      assert.equal(res.status, 401, `${name} : ${c.why} accepté (${res.status})`);
      assert.deepEqual(body, { error: 'auth' }, name);
      assert.equal(calls.length, 0, `${name} : appel réseau avant le refus (${c.why})`);
    }
    // L'autre secret ne vaut pas pour cette fonction
    const other = name === 'push-send' ? WITH_SECRET['coach-photos-purge'] : WITH_SECRET['push-send'];
    const { res } = await call(s.handler, request('POST', { headers: { [other.header]: s.secret } }), { env: { [s.env]: s.secret } });
    assert.equal(res.status, 401, `${name} : secret accepté sous un autre en-tête`);
  }
});

Deno.test('push-send : bon secret mais clés APNs absentes → 503 avant de prendre la file', async () => {
  const { res, body, calls } = await call(pushSend, request('POST', { headers: { 'x-push-secret': PUSH_SECRET } }), { env: { PUSH_CRON_SECRET: PUSH_SECRET } });
  assert.equal(res.status, 503);
  assert.deepEqual(body, { error: 'not_configured' });
  assert.equal(calls.length, 0, 'file prise alors que l\'envoi est impossible');
});

Deno.test('coach-photos-purge : bon secret, file vide → 200, une seule demande à la base avec la clé serveur', async () => {
  const { res, body, calls } = await call(coachPhotosPurge, request('POST', { headers: { 'x-purge-secret': PURGE_SECRET } }), {
    env: { PHOTOS_PURGE_SECRET: PURGE_SECRET },
    routes: { 'POST /rest/v1/rpc/srv_coach_photo_purge_claim': () => jsonResponse([]) },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(body, { removed: 0, failed: false });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['POST /rest/v1/rpc/srv_coach_photo_purge_claim']);
  assert.equal(calls[0].auth, 'Bearer faux-service-role-de-test');
  // Base en panne : 500, rien d'effacé
  const down = await call(coachPhotosPurge, request('POST', { headers: { 'x-purge-secret': PURGE_SECRET } }), {
    env: { PHOTOS_PURGE_SECRET: PURGE_SECRET },
    routes: { 'POST /rest/v1/rpc/srv_coach_photo_purge_claim': () => jsonResponse({ code: 'XX000', message: 'panne' }, 500) },
  });
  assert.equal(down.res.status, 500);
  assert.ok(!down.calls.some((c) => c.path.startsWith('/storage/')), 'stockage touché malgré la panne');
});

Deno.test('appstore-notify : signature d\'Apple absente ou fausse → 401, rien d\'écrit', async () => {
  const header = btoa(JSON.stringify({ alg: 'ES256', x5c: ['faux', 'faux', 'faux'] }));
  for (const body of [undefined, '', 'pas du JSON', {}, { signedPayload: '' }, { signedPayload: 42 }, { signedPayload: 'a.b.c' },
    { signedPayload: `${header}.${btoa('{"notificationType":"REFUND"}')}.faux` }]) {
    const { res, body: out, calls } = await call(appstoreNotify, request('POST', { body }));
    assert.equal(res.status, 401, `corps ${JSON.stringify(body)} accepté (${res.status})`);
    assert.deepEqual(out, { error: 'invalid_signature' });
    assert.equal(calls.length, 0, 'appel réseau malgré une signature fausse');
  }
});

Deno.test('verify-purchase : appelant valable, transaction non signée par Apple → 400 invalid_jws, rien d\'écrit', async () => {
  for (const body of [undefined, {}, { jws: '' }, { jws: 'a.b.c' }, { jws: 12 }]) {
    const { res, body: out, calls } = await call(verifyPurchase, request('POST', { headers: bearer(GOOD), body }), { users: { [GOOD]: fakeUser() } });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(out, { error: 'invalid_jws' });
    onlyAuthServer(calls);
  }
});

Deno.test('report : appelant valable, corps invalide → 400 { error: invalid, field }, rien d\'inséré', async () => {
  const cases: [unknown, string][] = [
    [undefined, 'body'], ['[]', 'body'], [{ target_user: 'pas-un-uuid' }, 'target_user'],
    [{ target_user: USER_ID, kind: 'profile', reason: 'spam' }, 'target_user'],   // se signaler soi-même
    [{ report_id: 0 }, 'report_id'], [{ report_id: 1, extra: true }, 'report_id'],
  ];
  for (const [body, field] of cases) {
    const { res, body: out, calls } = await call(report, request('POST', { headers: bearer(GOOD), body }), { users: { [GOOD]: fakeUser() } });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(out, { error: 'invalid', field }, JSON.stringify(body));
    onlyAuthServer(calls);
  }
});

Deno.test('strava-export : appelant valable, corps invalide → 400, aucune réservation', async () => {
  for (const [body, field] of [[undefined, 'body'], [{}, 'session_id'], [{ session_id: '../x' }, 'session_id']] as [unknown, string][]) {
    const { res, body: out, calls } = await call(stravaExport, request('POST', { headers: bearer(GOOD), body }), { users: { [GOOD]: fakeUser() } });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(out, { error: 'invalid', field });
    onlyAuthServer(calls);
  }
});

Deno.test('strava-connect : retour de Strava sans état valable → #expire, sans base ; POST sans secrets Strava → 503', async () => {
  for (const query of ['', '?code=faux', '?state=court&code=faux', `?state=${'a'.repeat(44)}&code=faux`]) {
    const { res, calls } = await call(stravaConnect, request('GET', { query }));
    assert.equal(res.status, 302, query);
    assert.match(res.headers.get('Location') ?? '', /^https:\/\/mdlf\.app\/strava\.html#expire$/, query);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(calls.length, 0, `${query} : base consultée sans état valable`);
  }
  const { res, body, calls } = await call(stravaConnect, request('POST', { headers: bearer(GOOD) }), { users: { [GOOD]: fakeUser() } });
  assert.equal(res.status, 503);
  assert.deepEqual(body, { error: 'not_configured' });
  onlyAuthServer(calls);
});

Deno.test('revoke-apple : appelant valable sans code Apple → { revoked: false }, Apple jamais appelé', async () => {
  const { res, body, calls } = await call(revokeApple, request('POST', { headers: bearer(GOOD), body: {} }), { users: { [GOOD]: fakeUser() } });
  assert.equal(res.status, 200);
  assert.deepEqual(body, { revoked: false });
  onlyAuthServer(calls);
});

Deno.test('coach-request-alert : appelant valable sans demande en attente → aucun e-mail', async () => {
  const { res, body, calls } = await call(coachRequestAlert, request('POST', { headers: bearer(GOOD) }), {
    users: { [GOOD]: fakeUser() }, env: { RESEND_API_KEY: 'faux-resend-de-test' },
    routes: { 'GET /rest/v1/coach_requests': () => jsonResponse([]) },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(body, { ok: true, notified: false });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /auth/v1/user', 'GET /rest/v1/coach_requests']);
  assert.equal(new URL(calls[1].url).searchParams.get('user_id'), `eq.${USER_ID}`, 'demande lue pour l\'appelant seulement');
});

// delete-account : la règle de connexion récente (claim amr), puis le chemin complet quand elle est remplie
const deleteRoutes = (journal: () => Response = () => jsonResponse(null)) => ({
  'POST /rest/v1/rpc/recent_identity_change': journal,
  'POST /rest/v1/rpc/strava_link_delete': () => jsonResponse(null),
  [`DELETE /auth/v1/admin/users/${USER_ID}`]: () => jsonResponse({}),
  'POST /storage/v1/object/list/coach-photos': () => jsonResponse([]),
});
const deleted = (calls: { method: string; path: string }[]) => calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/auth/v1/admin/users/'));

Deno.test('delete-account : sans connexion récente (amr) → 401 reauth, compte jamais supprimé', async () => {
  const t = nowS();
  const claimsCases: [string, Record<string, unknown>][] = [
    ['sans amr', {}],
    ['amr vide', { amr: [] }],
    ['code e-mail d\'il y a 11 minutes', { amr: [{ method: 'otp', timestamp: t - 11 * 60 }] }],
    ['mot de passe récent (pas une reconnexion reconnue)', { amr: [{ method: 'password', timestamp: t - 30 }] }],
    ['rafraîchissement récent', { amr: [{ method: 'token_refresh', timestamp: t - 30 }] }],
    ['date dans le futur', { amr: [{ method: 'otp', timestamp: t + 3600 }] }],
    ['amr d\'un autre compte', { sub: '00000000-0000-4000-8000-000000000002', amr: [{ method: 'otp', timestamp: t - 30 }] }],
  ];
  for (const [why, extra] of claimsCases) {
    const jwt = fakeJwt({ sub: USER_ID, role: 'authenticated', exp: t + 3600, ...extra });
    const { res, body, calls } = await call(deleteAccount, request('POST', { headers: bearer(jwt), body: {} }), {
      users: { [jwt]: fakeUser() }, routes: deleteRoutes(),
    });
    assert.equal(res.status, 401, `${why} : ${res.status}`);
    assert.deepEqual(body, { error: 'reauth' }, why);
    assert.ok(!deleted(calls), `${why} : compte supprimé`);
    assert.ok(!calls.some((c) => c.path.includes('strava_link_delete') || c.path.startsWith('/storage/')), `${why} : Strava ou photos touchés avant la décision`);
  }
});

Deno.test('delete-account : compte Apple sans code frais → 401 apple, Apple jamais appelé', async () => {
  const jwt = fakeJwt({ sub: USER_ID, exp: nowS() + 3600 });
  const user = fakeUser();
  user.identities.push({ ...user.identities[0], id: 'faux-sub-apple', identity_id: 'faux-sub-apple', provider: 'apple' });
  const { res, body, calls } = await call(deleteAccount, request('POST', { headers: bearer(jwt), body: {} }), { users: { [jwt]: user }, routes: deleteRoutes() });
  assert.equal(res.status, 401);
  assert.deepEqual(body, { error: 'apple' });
  assert.ok(!deleted(calls));
  assert.ok(calls.every((c) => c.url.startsWith('https://faux-projet.supabase.invalid/')), 'appel hors du projet');
});

Deno.test('delete-account : journal des identités illisible → 500, moyen de connexion récent → 403', async () => {
  const t = nowS();
  const jwt = fakeJwt({ sub: USER_ID, exp: t + 3600, amr: [{ method: 'otp', timestamp: t - 30 }] });
  const broken = await call(deleteAccount, request('POST', { headers: bearer(jwt) }), {
    users: { [jwt]: fakeUser() }, routes: deleteRoutes(() => jsonResponse({ code: 'XX000', message: 'panne' }, 500)),
  });
  assert.equal(broken.res.status, 500);
  assert.deepEqual(broken.body, { error: 'identity_check' });
  assert.ok(!deleted(broken.calls));
  const recent = new Date(Date.now() - 3600_000).toISOString();
  const held = await call(deleteAccount, request('POST', { headers: bearer(jwt) }), {
    users: { [jwt]: fakeUser() }, routes: deleteRoutes(() => jsonResponse(recent)),
  });
  assert.equal(held.res.status, 403);
  assert.equal((held.body as { error: string }).error, 'identity_recent');
  assert.ok(!deleted(held.calls));
});

Deno.test('delete-account : connexion de moins de 10 minutes → compte supprimé, puis ses fichiers', async () => {
  const t = nowS();
  const jwt = fakeJwt({ sub: USER_ID, exp: t + 3600, amr: [{ method: 'otp', timestamp: t - 60 }] });
  const { res, body, calls } = await call(deleteAccount, request('POST', { headers: bearer(jwt) }), { users: { [jwt]: fakeUser() }, routes: deleteRoutes() });
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.deepEqual(body, { deleted: true, revoked: false });
  const order = calls.map((c) => `${c.method} ${c.path}`);
  assert.ok(order.indexOf(`DELETE /auth/v1/admin/users/${USER_ID}`) > order.indexOf('POST /rest/v1/rpc/strava_link_delete'), 'Strava avant le compte');
  assert.ok(order.indexOf('POST /storage/v1/object/list/coach-photos') > order.indexOf(`DELETE /auth/v1/admin/users/${USER_ID}`), 'fichiers après le compte');
  // La suppression passe par la clé serveur, jamais par le jeton de l'appelant
  assert.equal(calls.find((c) => c.method === 'DELETE')?.auth, 'Bearer faux-service-role-de-test');
});
