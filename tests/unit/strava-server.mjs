// Strava côté serveur : règles pures (supabase/functions/_shared/strava-policy.js) et chiffrement des
// jetons (strava-crypto.js), chargés tels quels par les fonctions Edge. Jetons et clés : faux évidents.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, assert, sameJSON, ROOT }) {
  const policy = () => import(path.join(ROOT, 'supabase/functions/_shared/strava-policy.js'));
  const cryptoLib = () => import(path.join(ROOT, 'supabase/functions/_shared/strava-crypto.js'));
  const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
  const base = { session_id: 'abc12345', name: 'Push', sport_type: 'WeightTraining', start_date_local: '2026-10-31T10:05:00', elapsed_time: 3120 };
  // Clé de test : 32 octets connus, jamais une vraie clé
  const FAKE_KEY = Buffer.alloc(32, 7).toString('base64');
  const FAKE_TOKENS = { access: 'faux-jeton-acces-0000', refresh: 'faux-jeton-renouvellement-0000' };

  test('strava serveur : adresse d\'autorisation (droit activity:write seul, état, retour, écran d\'accord toujours montré)', async () => {
    const { authorizeUrl } = await policy();
    const u = new URL(authorizeUrl({ clientId: '12345', redirectUri: 'https://exemple.supabase.co/functions/v1/strava-connect', state: 'etat-factice' }));
    assert.equal(u.origin + u.pathname, 'https://www.strava.com/oauth/authorize');
    sameJSON(Object.fromEntries(u.searchParams), { client_id: '12345', redirect_uri: 'https://exemple.supabase.co/functions/v1/strava-connect',
      response_type: 'code', approval_prompt: 'force', scope: 'activity:write', state: 'etat-factice' });
    // auto sauterait l'écran d'accord de Strava : un lien tiré par un autre compte relierait sans rien montrer
    assert.equal(u.searchParams.get('approval_prompt'), 'force', 'jamais auto (CSRF OAuth, docs/STRAVA.md)');
  });

  test('strava serveur : droit accordé lu exactement (virgules ou espaces, jamais un nom voisin)', async () => {
    const { hasWriteScope } = await policy();
    assert.equal(hasWriteScope('read,activity:write'), true);
    assert.equal(hasWriteScope('read activity:write'), true);
    assert.equal(hasWriteScope('activity:write'), true);
    assert.equal(hasWriteScope('read'), false, 'case décochée');
    assert.equal(hasWriteScope('activity:write_all'), false);
    assert.equal(hasWriteScope('xactivity:write'), false);
    assert.equal(hasWriteScope(null), false);
  });

  test('strava serveur : réponse des jetons (prénom seul, une ligne, 40 caractères)', async () => {
    const { parseTokens, athleteName } = await policy();
    const t = parseTokens({ token_type: 'Bearer', access_token: 'faux-a', refresh_token: 'faux-r', expires_at: 1793450000, expires_in: 21600,
      scope: 'read,activity:write', athlete: { id: 4242, firstname: ' Léa\n', lastname: 'Nom-de-famille' } });
    sameJSON(t, { access: 'faux-a', refresh: 'faux-r', expiresAt: 1793450000, scope: 'read,activity:write', athleteId: 4242, athleteName: 'Léa' });
    assert.equal(parseTokens({ access_token: 'faux-a', expires_at: 1 }), null, 'sans jeton de renouvellement');
    assert.equal(parseTokens({ access_token: 'faux-a', refresh_token: 'faux-r' }), null, 'sans expiration');
    assert.equal(parseTokens(null), null);
    assert.equal(athleteName({ firstname: 'x'.repeat(60) }).length, 40);
    assert.equal(athleteName({ firstname: '   ' }), null);
    assert.equal(athleteName({}), null);
  });

  test('strava serveur : renouvellement 5 minutes avant l\'expiration', async () => {
    const { needsRefresh } = await policy();
    assert.equal(needsRefresh(new Date(NOW + 3600_000).toISOString(), NOW), false);
    assert.equal(needsRefresh(new Date(NOW + 299_000).toISOString(), NOW), true);
    assert.equal(needsRefresh(new Date(NOW - 1).toISOString(), NOW), true);
    assert.equal(needsRefresh('pas une date', NOW), true);
  });

  test('strava serveur : identifiant de l\'activité créée, jamais arrondi, jamais celui de l\'athlète', async () => {
    const { activityIdFrom } = await policy();
    assert.equal(activityIdFrom('{"id": 12345678901234567, "resource_state": 3, "athlete": {"id": 99, "resource_state": 1}}'), '12345678901234567');
    assert.equal(activityIdFrom('{"resource_state": 3, "athlete": {"id": 99}, "name": "Push", "id": 16000000001}'), '16000000001', 'id après athlete');
    assert.equal(activityIdFrom('{"athlete": {"id": 99}}'), null);
    assert.equal(activityIdFrom('[{"id": 1}]'), null);
    assert.equal(activityIdFrom('{"id": 0}'), null);
    assert.equal(activityIdFrom('{"id": "12"}'), null, 'texte : pas la forme de Strava');
    assert.equal(activityIdFrom('pas du json'), null);
  });

  test('strava serveur : séance envoyée validée et ramenée aux champs de Strava', async () => {
    const { validateExport } = await policy();
    const r = validateExport({ ...base, description: 'Push · 52 min\nDéveloppé couché : 80 kg × 8   \n', user_id: 'pirate', private: true }, NOW);
    assert.equal(r.ok, true);
    assert.equal(r.sessionId, 'abc12345');
    sameJSON(r.fields, { name: 'Push', sport_type: 'WeightTraining', start_date_local: '2026-10-31T10:05:00', elapsed_time: '3120',
      description: 'Push · 52 min\nDéveloppé couché : 80 kg × 8' }, 'clés inconnues jamais recopiées');
    const c = validateExport({ ...base, sport_type: 'Run', distance: 10234.56, trainer: true, name: '  Course\ndu  soir ' }, NOW);
    sameJSON(c.fields, { name: 'Course du soir', sport_type: 'Run', start_date_local: '2026-10-31T10:05:00', elapsed_time: '3120', distance: '10234.6', trainer: '1' });
    assert.equal(validateExport({ ...base, trainer: false }, NOW).fields.trainer, undefined);
    // Fuseau en avance (Nouvelle-Zélande, UTC+13) : l'heure locale dépasse l'heure UTC du serveur
    assert.equal(validateExport({ ...base, start_date_local: '2026-11-01T00:30:00' }, NOW).ok, true);
  });

  test('strava serveur : séance refusée (champ en cause)', async () => {
    const { validateExport, NAME_MAX, DESCRIPTION_MAX } = await policy();
    const field = (b) => { const r = validateExport(b, NOW); assert.equal(r.ok, false, JSON.stringify(b)); assert.equal(r.error, 'invalid'); return r.field; };
    assert.equal(field(null), 'body');
    assert.equal(field([base]), 'body');
    assert.equal(field({ ...base, session_id: 'hk:santé' }), 'session_id', 'sortie de Santé');
    assert.equal(field({ ...base, session_id: 'x'.repeat(65) }), 'session_id');
    assert.equal(field({ ...base, name: '   ' }), 'name');
    assert.equal(field({ ...base, name: 'x'.repeat(NAME_MAX + 1) }), 'name');
    assert.equal(field({ ...base, sport_type: 'Swim' }), 'sport_type', 'hors de la liste de l\'app');
    assert.equal(field({ ...base, sport_type: 'toString' }), 'sport_type');
    assert.equal(field({ ...base, start_date_local: '2026-10-31T10:05:00Z' }), 'start_date_local', 'avec fuseau');
    assert.equal(field({ ...base, start_date_local: '2026-02-30T10:00:00' }), 'start_date_local', 'date impossible');
    assert.equal(field({ ...base, start_date_local: '2026-11-02T10:00:00' }), 'start_date_local', 'futur');
    assert.equal(field({ ...base, start_date_local: '2025-09-01T10:00:00' }), 'start_date_local', 'plus de 400 jours');
    assert.equal(field({ ...base, elapsed_time: 59 }), 'elapsed_time');
    assert.equal(field({ ...base, elapsed_time: 86401 }), 'elapsed_time');
    assert.equal(field({ ...base, elapsed_time: 600.5 }), 'elapsed_time');
    assert.equal(field({ ...base, elapsed_time: '3120' }), 'elapsed_time');
    assert.equal(field({ ...base, description: 42 }), 'description');
    assert.equal(field({ ...base, description: 'x'.repeat(DESCRIPTION_MAX + 1) }), 'description');
    assert.equal(field({ ...base, distance: -1 }), 'distance');
    assert.equal(field({ ...base, distance: 2_000_000 }), 'distance');
    assert.equal(field({ ...base, distance: '10' }), 'distance');
    assert.equal(field({ ...base, trainer: 1 }), 'trainer');
  });

  test('strava serveur : retour dans Safari, résultat en ancre seulement', async () => {
    const { returnUrl } = await policy();
    assert.equal(returnUrl('https://mdlf.app/strava.html', 'ok'), 'https://mdlf.app/strava.html#ok');
    assert.equal(returnUrl('https://mdlf.app/strava.html', 'droits'), 'https://mdlf.app/strava.html#droits');
    assert.equal(returnUrl('https://mdlf.app/strava.html', 'deja'), 'https://mdlf.app/strava.html#deja', 'athlète relié à un autre compte');
    assert.equal(returnUrl('https://mdlf.app/strava.html', '<script>'), 'https://mdlf.app/strava.html#erreur');
  });

  test('strava serveur : chaque résultat du retour a son texte sur la page publique', async () => {
    const { RETURN_RESULTS } = await policy();
    const html = fs.readFileSync(path.join(ROOT, 'web-public/strava.html'), 'utf8');
    for (const r of RETURN_RESULTS) assert.ok(html.includes(`<section class="result" id="${r}">`), `#${r} sans texte sur strava.html`);
  });

  test('strava serveur : athlète déjà relié, liaison du détenteur périmée ou valable (holderVerdict)', async () => {
    const { holderVerdict } = await policy();
    const HOLDER = { userId: 'compte-a', tokens: 'chiffre-factice-a' };
    const OLD = { access: 'faux-acces-a', refresh: 'faux-renouv-a' };
    const FRESH = { access: 'faux-acces-b', refresh: 'faux-renouv-b' };
    // Faux réseau : journal des appels, réponse de Strava au renouvellement choisie par le test
    const io = (answer, opened = OLD) => {
      const calls = [];
      return { calls, open: async (uid, sealed) => { calls.push(['open', uid, sealed]); return opened; },
        refresh: async (r) => { calls.push(['refresh', r]); return answer; },
        saveTokens: async (uid, t) => { calls.push(['save', uid, t.refresh]); } };
    };
    // MDLF Training retiré dans strava.com/settings/apps : Strava refuse le jeton du détenteur (400 ou 401)
    let x = io({ revoked: true });
    assert.equal(await holderVerdict(HOLDER, FRESH, x), 'revoked', 'accès retiré chez Strava : athlète libéré');
    sameJSON(x.calls, [['open', 'compte-a', 'chiffre-factice-a'], ['refresh', 'faux-renouv-a']], 'testé avec le jeton du détenteur, jamais celui reçu');
    // Accès toujours valable : refus (#deja), les jetons renouvelés du détenteur sont gardés (l'ancien ne vaut plus)
    x = io({ tokens: { access: 'faux-acces-a2', refresh: 'faux-renouv-a2', expiresAt: 1793450000 } });
    assert.equal(await holderVerdict(HOLDER, FRESH, x), 'alive');
    sameJSON(x.calls.at(-1), ['save', 'compte-a', 'faux-renouv-a2'], 'jeton tourné réenregistré pour le détenteur');
    // Strava injoignable : on ne sait pas, rien n'est libéré
    assert.equal(await holderVerdict(HOLDER, FRESH, io({ down: true })), 'unknown');
    assert.equal(await holderVerdict(HOLDER, FRESH, io(null)), 'unknown');
    // Même accord que celui reçu à l'instant : valable, sans appel à Strava
    x = io({ revoked: true }, { access: 'faux-acces-a', refresh: 'faux-renouv-b' });
    assert.equal(await holderVerdict(HOLDER, FRESH, x), 'alive');
    assert.ok(!x.calls.some((c) => c[0] === 'refresh'), 'pas de renouvellement inutile');
    // Jetons du détenteur indéchiffrables (clé changée) : il ne peut plus rien envoyer
    x = io({ tokens: OLD }, null);
    assert.equal(await holderVerdict(HOLDER, FRESH, x), 'revoked');
    assert.ok(!x.calls.some((c) => c[0] === 'refresh'));
    // Plus de détenteur (déconnecté entre-temps)
    assert.equal(await holderVerdict(null, FRESH, io({ revoked: true })), 'free');
  });

  test('strava serveur : la page #deja donne une sortie sans l\'autre compte (strava.com/settings/apps)', () => {
    const html = fs.readFileSync(path.join(ROOT, 'web-public/strava.html'), 'utf8');
    const deja = html.slice(html.indexOf('<section class="result" id="deja">'));
    const section = deja.slice(0, deja.indexOf('</section>'));
    assert.ok(section.includes('https://www.strava.com/settings/apps'), 'retirer MDLF Training chez Strava, puis réessayer');
    assert.ok(section.includes('réessaie'));
  });

  test('strava serveur : jetons chiffrés (aller-retour, liés au compte, altération, autre clé)', async () => {
    const { tokenKey, sealTokens, openTokens } = await cryptoLib();
    const key = await tokenKey(FAKE_KEY);
    const sealed = await sealTokens(key, 'compte-a', FAKE_TOKENS);
    assert.match(sealed, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    assert.ok(!sealed.includes('faux-jeton'), 'jeton lisible dans le chiffré');
    assert.notEqual(await sealTokens(key, 'compte-a', FAKE_TOKENS), sealed, 'vecteur tiré à chaque fois');
    sameJSON(await openTokens(key, 'compte-a', sealed), FAKE_TOKENS);
    assert.equal(await openTokens(key, 'compte-b', sealed), null, 'recopié sur un autre compte');
    const [v, iv, ct] = sealed.split('.');
    const flipped = ct.slice(0, -2) + (ct.at(-2) === 'A' ? 'B' : 'A') + ct.at(-1);
    assert.equal(await openTokens(key, 'compte-a', `${v}.${iv}.${flipped}`), null, 'altéré');
    const other = await tokenKey(Buffer.alloc(32, 9).toString('base64'));
    assert.equal(await openTokens(other, 'compte-a', sealed), null, 'autre clé');
    assert.equal(await openTokens(key, 'compte-a', 'v2.x.y'), null);
    assert.equal(await openTokens(key, 'compte-a', null), null);
  });

  test('strava serveur : clé du secret (32 octets, base64 ou base64url), sinon refusée', async () => {
    const { tokenKey } = await cryptoLib();
    assert.ok(await tokenKey(FAKE_KEY));
    assert.ok(await tokenKey(Buffer.alloc(32, 250).toString('base64url')));
    assert.equal(await tokenKey(''), null);
    assert.equal(await tokenKey(undefined), null);
    assert.equal(await tokenKey(Buffer.alloc(16, 7).toString('base64')), null, '16 octets');
    assert.equal(await tokenKey('pas*du*base64'), null);
  });

  test('strava serveur : état OAuth aléatoire, empreinte SHA-256 seule en base', async () => {
    const { newState, stateHash, stateLooksValid } = await cryptoLib();
    const a = newState(), b = newState();
    assert.notEqual(a, b);
    assert.equal(stateLooksValid(a), true);
    assert.equal(stateLooksValid(a + 'x'), false);
    assert.equal(stateLooksValid('etat/avec+signes'), false);
    assert.equal(stateLooksValid(null), false);
    const h = await stateHash(a);
    assert.match(h, /^[0-9a-f]{64}$/, 'forme attendue par private.strava_states');
    assert.equal(await stateHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 connu');
  });
}
