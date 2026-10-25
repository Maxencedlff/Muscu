// Compte : premier écran, pseudo, avatar, identités, connexion récente, erreurs de Supabase
// (js/data/account-auth.js), fonction serveur delete-account (recent-auth.js), pont natif Google,
// cohérence avec la migration, Info.plist, project.pbxproj et le manifeste de confidentialité.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, assert, sameJSON, nativeContext, ROOT }) {
  const call = (expr, vars = {}) => run(`(() => { ${Object.entries(vars).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join(' ')} return ${expr}; })()`);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = claims => `${b64({ alg: 'ES256' })}.${b64(claims)}.signature`;
  const migration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261026000000_profils.sql'), 'utf8');
  // Dernière migration qui fixe la liste blanche des avatars (une migration plus récente peut la remplacer)
  const AVATAR_SQL = 'avatar_emoji = any (array[';
  const avatarMigration = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).sort().reverse()
    .map(f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8')).find(t => t.includes(AVATAR_SQL));
  // Emojis ajoutés dans l'app avant la migration du serveur (refusés proprement d'ici là : USERNAME_TEXT.avatar).
  // À vider quand la migration qui les ajoute est dans supabase/migrations.
  const AVATARS_PENDING_SERVER = [];
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

  test('compte : écran Bienvenue au tout premier lancement seulement', () => {
    const base = { accountAvailable: true, hasHistory: false, onboarded: false, restored: false, welcomeSeen: false, signedIn: false };
    const first = s => call('firstScreen(s)', { s: { ...base, ...s } });
    assert.equal(first({}), 'welcome', 'premier lancement');
    assert.equal(first({ accountAvailable: false }), 'app', 'navigateur ou build sans le module');
    assert.equal(first({ welcomeSeen: true }), 'app', 'déjà montré (quel que soit le choix)');
    assert.equal(first({ hasHistory: true }), 'app', 'utilisateur existant');
    assert.equal(first({ onboarded: true }), 'app', 'carte « Où t\'entraînes-tu ? » déjà passée');
    assert.equal(first({ restored: true }), 'app', 'copie Documents ou iCloud restaurée');
    assert.equal(first({ signedIn: true }), 'app', 'session du Trousseau (réinstallation)');
  });

  test('compte : carte de l\'accueil pour qui n\'a pas vu Bienvenue, fermable', () => {
    const base = { accountAvailable: true, ready: true, signedIn: false, welcomeSeen: false, cardClosed: false };
    const shown = s => call('accountCardShown(s)', { s: { ...base, ...s } });
    assert.equal(shown({}), true);
    assert.equal(shown({ reconnect: true }), false, 'carte de reconnexion à la place');
    assert.equal(shown({ welcomeSeen: true }), false, 'Bienvenue déjà vu : pas de deuxième proposition');
    assert.equal(shown({ cardClosed: true }), false, 'fermée');
    assert.equal(shown({ signedIn: true }), false, 'connecté');
    assert.equal(shown({ ready: false }), false, 'compte pas encore chargé');
    assert.equal(shown({ accountAvailable: false }), false, 'navigateur');
  });

  test('compte : carte de reconnexion (iPhone restauré sans session), jamais après une déconnexion voulue', () => {
    const base = { accountAvailable: true, ready: true, signedIn: false, owner: 'u1', signedOut: false };
    const shown = s => call('reconnectCardShown(s)', { s: { ...base, ...s } });
    assert.equal(shown({}), true, 'compte de l\'appareil sans session');
    assert.equal(shown({ signedOut: true }), false, '« Se déconnecter »');
    assert.equal(shown({ owner: null }), false, 'aucun compte sur cet appareil');
    assert.equal(shown({ signedIn: true }), false, 'connecté');
    assert.equal(shown({ ready: false }), false, 'session pas encore lue');
    assert.equal(shown({ accountAvailable: false }), false, 'navigateur');
  });

  test('compte : code demandé repris 10 min après l\'envoi seulement', () => {
    const now = 10_000_000;
    const ok = p => call('pendingCodeValid(p, now)', { p, now });
    assert.equal(ok({ email: 'max@exemple.fr', sentAt: now - 60_000 }), true);
    assert.equal(ok({ email: 'max@exemple.fr', sentAt: now - 11 * 60_000 }), false, 'code expiré');
    assert.equal(ok({ email: 'max@exemple.fr', sentAt: now + 60_000 }), false, 'heure future');
    assert.equal(ok({ email: 'pas une adresse', sentAt: now }), false);
    assert.equal(ok(null), false);
  });

  test('compte : pseudo normalisé (accents, minuscules, espaces) puis validé', () => {
    const norm = s => call('normalizeUsername(s)', { s });
    assert.equal(norm('  Maxence  '), 'maxence');
    assert.equal(norm('Hélène Œuvre'), 'helene_oeuvre');
    assert.equal(norm('@Jean-Pierre'), 'jean_pierre');
    assert.equal(norm('Straße'), 'strasse');
    assert.equal(norm('ÇA.VA'), 'ca.va');
    const bad = s => call('usernameProblem(s)', { s });
    assert.equal(bad('max.dlf_92'), null);
    assert.equal(bad('abc'), null, '3 caractères');
    assert.equal(bad('a'.repeat(20)), null, '20 caractères');
    assert.equal(bad(''), 'empty');
    assert.equal(bad('ab'), 'short');
    assert.equal(bad('a'.repeat(21)), 'long');
    assert.equal(bad('max!'), 'chars');
    assert.equal(bad('max💪'), 'chars');
    assert.equal(bad('Max'), 'chars', 'majuscule non normalisée');
    assert.equal(bad('.max'), 'edge');
    assert.equal(bad('max_'), 'edge');
    assert.equal(bad('ma..x'), 'dots');
    assert.equal(call('Object.keys(USERNAME_TEXT).length') >= 10, true);
    for (const k of ['empty', 'short', 'long', 'chars', 'edge', 'dots', 'taken', 'taken_first', 'forbidden', 'too_soon', 'avatar', 'offline', 'server']) {
      assert.ok(call(`USERNAME_TEXT[k]`, { k }), `message ${k}`);
    }
    assert.ok(call('Object.values(USERNAME_TEXT).every(t => /[.?!]$/.test(t))'), 'chaque message finit par un point');
  });

  test('compte : règle du pseudo identique au serveur (migration)', () => {
    assert.ok(migration.includes(`'${call('USERNAME_RE.source')}'`), 'même expression que user_profiles_username_format');
    assert.ok(migration.includes("position('..' in username) = 0"), 'deux points refusés côté serveur aussi');
  });

  test('compte : délai de 30 jours et compte tout neuf', () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    assert.equal(call('usernameNextChange(p, now)', { p: { username: 'max', changedAt: null }, now }), 0, 'premier pseudo : changement libre');
    assert.equal(call('usernameNextChange(p, now)', { p: { username: 'max', changedAt: '2026-10-01T12:00:00Z' }, now }), Date.parse('2026-10-31T12:00:00Z'));
    assert.equal(call('usernameNextChange(p, now)', { p: { username: 'max', changedAt: '2026-09-01T12:00:00Z' }, now }), 0);
    const user = { created_at: '2026-10-25T11:58:00Z' };
    assert.equal(call('isNewAccount(u, null, now)', { u: user, now }), true);
    assert.equal(call('isNewAccount(u, p, now)', { u: user, p: { username: null }, now }), false, 'profil déjà créé');
    assert.equal(call('isNewAccount(u, undefined, now)', { u: user, now }), false, 'profil illisible : on ne redemande pas');
    assert.equal(call('isNewAccount(u, null, now)', { u: { created_at: '2026-10-20T10:00:00Z' }, now }), false, 'ancien compte');
  });

  test('compte : erreurs d\'enregistrement du profil → messages', () => {
    const kind = e => call('profileErrorKind(e)', { e });
    assert.equal(kind({ code: '23505', message: 'duplicate key value violates unique constraint "user_profiles_username_key"' }), 'taken');
    assert.equal(kind({ code: 'P0001', message: 'username_forbidden' }), 'forbidden');
    assert.equal(kind({ code: 'P0001', message: 'username_too_soon' }), 'too_soon');
    assert.equal(kind({ code: 'P0001', message: 'username_required' }), 'required');
    assert.equal(kind({ code: '23514', message: 'violates check constraint "user_profiles_username_format"' }), 'chars');
    assert.equal(kind({ code: '23514', message: 'violates check constraint "user_profiles_avatar_emoji"' }), 'avatar', 'emoji pas encore accepté par le serveur');
    assert.equal(kind({ message: 'Failed to fetch' }), 'offline');
    assert.equal(kind({ code: '42501', message: 'permission denied' }), 'server');
  });

  test('compte : 30 emojis d\'avatar, sans personnage, identiques à la liste blanche du serveur', () => {
    const list = run('AVATAR_EMOJIS.map(a => a.emoji)');
    assert.equal(list.length, 30);
    assert.equal(new Set(list).size, 30, 'aucun doublon');
    assert.ok(run('AVATAR_EMOJIS.every(a => a.name && a.name.length > 2)'), 'un nom pour VoiceOver');
    assert.ok(list.includes(run('DEFAULT_AVATAR')), 'emoji par défaut dans la liste');
    assert.ok(list.every(e => [...e].length === 1 || ([...e].length === 2 && e.endsWith('\uFE0F'))), 'un point de code, plus U+FE0F au besoin');
    sameJSON(list.slice(0, 6), ['🔥', '⚡', '🥇', '🏆', '👟', '🥊'], 'énergie et récompenses en tête');
    // Ni personne, ni partie du corps, ni geste de main (blocs Unicode des personnages)
    assert.ok(list.every(e => { const c = e.codePointAt(0); return !(c >= 0x1F466 && c <= 0x1F487) && !(c >= 0x1F574 && c <= 0x1F57A) && !(c >= 0x1F645 && c <= 0x1F64F) && !(c >= 0x1F90C && c <= 0x1F93E) && !(c >= 0x1F9B5 && c <= 0x1F9DF) && c !== 0x1F4AA && ![0x1F3C2, 0x1F3C3, 0x1F3C4, 0x1F3C7, 0x1F3CA, 0x1F3CB, 0x1F3CC].includes(c); }), 'aucune image de corps');
    const at = avatarMigration.indexOf(AVATAR_SQL);
    const server = [...avatarMigration.slice(at, avatarMigration.indexOf('])', at)).matchAll(/'([^']+)'/g)].map(m => m[1]);
    const missing = list.filter(e => !server.includes(e));
    if (missing.length) {
      // Migration du serveur pas encore écrite : seuls les emojis annoncés manquent, et rien n'est en trop
      sameJSON(missing.sort(), [...AVATARS_PENDING_SERVER].sort(), 'seuls les emojis en attente du serveur manquent');
    } else sameJSON(server, list, 'même liste et même ordre que la contrainte SQL');
    assert.ok(migration.includes(`avatar_emoji        text not null default '${run('DEFAULT_AVATAR')}'`), 'même défaut que le serveur');
    assert.equal(call('validAvatar(e)', { e: '🦊' }), '🦊');
    assert.equal(call('validAvatar(e)', { e: '<img>' }), run('DEFAULT_AVATAR'));
    assert.equal(call('validAvatar(e)', { e: null }), run('DEFAULT_AVATAR'));
    assert.equal(call('avatarName(e)', { e: '🦊' }), 'Renard');
  });

  test('compte : e-mail et code saisis', () => {
    const ok = s => call('emailLooksValid(normalizeEmail(s))', { s });
    assert.equal(ok(' Max@Exemple.FR '), true);
    assert.equal(ok('prenom.nom+mdlf@sous.domaine.com'), true);
    assert.equal(ok('max@exemple'), false);
    assert.equal(ok('max exemple.fr'), false);
    assert.equal(ok('@exemple.fr'), false);
    assert.equal(ok('max@.fr'), false);
    assert.equal(call('normalizeEmail(s)', { s: ' Max@Exemple.FR ' }), 'max@exemple.fr');
    assert.equal(call('codeDigits(s)', { s: '123 456' }), '123456');
    assert.equal(call('codeDigits(s)', { s: 'Code : 98-76-54-32' }), '987654', '6 chiffres au plus');
    assert.equal(call('codeDigits(s)', { s: 'abc' }), '');
  });

  test('compte : identités (Apple, Google, e-mail), retrait seulement s\'il en reste une', () => {
    const apple = { provider: 'apple', id: 'apple-sub', identity_data: { sub: '001234.abc' }, created_at: '2026-10-01T00:00:00Z' };
    const google = { provider: 'google', id: '1093', identity_data: { sub: '1093', full_name: 'Nom Réel' }, created_at: '2026-10-10T00:00:00Z' };
    const email = { provider: 'email', identity_data: { email: 'max@exemple.fr' }, created_at: '2026-10-12T00:00:00Z' };
    const u = (...ids) => ({ identities: ids });
    assert.equal(call('hasApple(x)', { x: u(apple) }), true);
    assert.equal(call('hasApple(x)', { x: u(google, email) }), false);
    assert.equal(call('hasApple(x)', { x: null }), false);
    assert.equal(call('hasApple(x)', { x: {} }), false, 'utilisateur sans identités');
    assert.equal(call('appleUserOf(x)', { x: u(apple) }), '001234.abc', 'credentialState : sub d\'Apple');
    assert.equal(call('appleUserOf(x)', { x: u(google) }), null, 'pas d\'Apple : credentialState jamais appelé');
    assert.equal(call('canUnlink(x, "apple")', { x: u(apple) }), false, 'dernier moyen');
    assert.equal(call('canUnlink(x, "apple")', { x: u(apple, google) }), true);
    assert.equal(call('canUnlink(x, "email")', { x: u(apple, google) }), false, 'pas relié');
    assert.equal(call('googleSubOf(x)', { x: u(apple, google) }), '1093');
    assert.equal(call('primaryProvider(x)', { x: u(email, google, apple) }), 'apple', 'le plus ancien');
    assert.equal(call('signInEmailOf(x)', { x: { email: 'max@exemple.fr', email_confirmed_at: '2026-10-12', identities: [google] } }), 'max@exemple.fr');
    assert.equal(call('signInEmailOf(x)', { x: { email: 'max@exemple.fr', identities: [apple] } }), null, 'e-mail non confirmé');
    assert.equal(call('signInEmailOf(x)', { x: { identities: [apple] } }), null);
    // Ajout d'une adresse : seulement pour un compte qui n'en a pas (Apple)
    assert.equal(call('canAddEmail(x)', { x: { identities: [apple] } }), true);
    assert.equal(call('canAddEmail(x)', { x: { email: 'max@gmail.com', email_confirmed_at: '2026-10-10', identities: [google] } }), false, 'Google : adresse déjà là');
    assert.equal(call('canAddEmail(x)', { x: { email: 'max@exemple.fr', identities: [apple] } }), false, 'adresse en attente');
    assert.equal(call('canAddEmail(x)', { x: null }), false);
  });

  test('compte : ajout d\'une adresse e-mail (refusé à un compte Google, validé seulement une fois l\'adresse sur le compte)', async () => {
    const apple = { provider: 'apple', id: 'apple-sub', identity_data: { sub: 'apple-sub' } };
    const google = { provider: 'google', id: 'g', identity_data: { sub: 'g' } };
    // Faux client : updateUser et verifyOtp enregistrés, getUser renvoie l'utilisateur choisi par le test
    const setup = (user, after) => run(`(() => {
      globalThis.__calls = [];
      account.user = ${JSON.stringify(user)};
      sb = { auth: {
        updateUser: async (x) => { __calls.push(['updateUser', x.email]); return { data: { user: account.user }, error: null }; },
        verifyOtp: async (x) => { __calls.push(['verify', x.type]); return { data: { user: ${JSON.stringify(after)} }, error: null }; },
        getUser: async () => ({ data: { user: ${JSON.stringify(after)} }, error: null }),
      } };
    })()`);
    try {
      setup({ id: 'u1', email: 'max@gmail.com', email_confirmed_at: '2026-10-10', identities: [google] }, null);
      sameJSON(await run(`accountLinkEmailStart('autre@exemple.fr')`), { ok: false, kind: 'has_email' }, 'compte Google : refusé');
      sameJSON(await run(`accountLinkEmailStart('max@gmail.com')`), { ok: false, kind: 'same_email' });
      sameJSON(run('__calls'), [], 'aucun changement d\'e-mail demandé à Supabase');
      assert.match(call('authErrorText("has_email")'), /déjà une adresse/);

      // Compte Apple : une confirmation, puis l'adresse doit être sur le compte relu
      const done = { id: 'u1', email: 'max@exemple.fr', identities: [apple, { provider: 'email', identity_data: { email: 'max@exemple.fr' } }] };
      setup({ id: 'u1', email: null, identities: [apple] }, done);
      assert.equal((await run(`accountLinkEmailStart('max@exemple.fr')`)).ok, true);
      sameJSON(await run(`accountLinkEmailVerify('max@exemple.fr', '123456', Date.now())`), { ok: true });
      sameJSON(run('__calls'), [['updateUser', 'max@exemple.fr'], ['verify', 'email_change']]);
      // Code accepté mais adresse pas encore portée par le compte (confirmation manquante) : pas « ajoutée »
      const pending = { id: 'u1', email: null, identities: [apple] };
      setup(pending, pending);
      sameJSON(await run(`accountLinkEmailVerify('max@exemple.fr', '123456', Date.now())`), { ok: false, kind: 'email_unconfirmed' });
    } finally { run('sb = null; account.user = null; delete globalThis.__calls;'); }
  });

  test('compte : connexion récente lue dans le claim amr (client)', () => {
    const now = Date.parse('2026-10-25T12:00:00Z'), s = now / 1000;
    const recent = (amr, at = now) => call('isRecentAuth(t, at)', { t: jwt({ amr }), at });
    assert.equal(recent([{ method: 'otp', timestamp: s - 120 }]), true, 'code e-mail il y a 2 min');
    assert.equal(recent([{ method: 'oauth', timestamp: s - 120 }]), true, 'Google il y a 2 min');
    assert.equal(recent([{ method: 'otp', timestamp: s - 11 * 60 }]), false, 'il y a 11 min');
    assert.equal(recent([{ method: 'token_refresh', timestamp: s - 10 }]), false, 'rafraîchissement : pas une connexion');
    assert.equal(recent([{ method: 'otp', timestamp: s - 3600 }, { method: 'oauth', timestamp: s - 60 }]), true, 'la plus récente compte');
    assert.equal(recent([]), false);
    assert.equal(call('isRecentAuth(t)', { t: 'pas-un-jwt' }), false);
    assert.equal(call('isRecentAuth(null)'), false);
    assert.equal(call('lastAuthAt(t)', { t: jwt({ amr: [{ method: 'otp', timestamp: 1761393600 }] }) }), 1761393600000);
    assert.equal(call('jwtPayload(t).sub', { t: jwt({ sub: 'é-ü' }) }), 'é-ü', 'UTF-8 décodé');
  });

  test('compte : connexion récente exigée par delete-account (serveur)', async () => {
    const { isRecentAuth, lastAuthAt, RECENT_AUTH_MAX_AGE_S } = await import(path.join(ROOT, 'supabase/functions/delete-account/recent-auth.js'));
    const s = 1_800_000_000;
    assert.equal(RECENT_AUTH_MAX_AGE_S, 600);
    assert.equal(isRecentAuth({ amr: [{ method: 'otp', timestamp: s - 599 }] }, s), true);
    assert.equal(isRecentAuth({ amr: [{ method: 'oauth', timestamp: s - 601 }] }, s), false, 'plus de 10 min');
    assert.equal(isRecentAuth({ amr: [{ method: 'token_refresh', timestamp: s }] }, s), false);
    assert.equal(isRecentAuth({ amr: [{ method: 'otp', timestamp: s + 3600 }] }, s), false, 'date dans le futur');
    assert.equal(isRecentAuth({}, s), false, 'sans amr');
    assert.equal(isRecentAuth(null, s), false);
    assert.equal(isRecentAuth({ amr: [{ method: 'otp', timestamp: '1800000000' }] }, s), false, 'timestamp non numérique');
    assert.equal(lastAuthAt({ amr: [{ method: 'otp', timestamp: 5 }, { method: 'magiclink', timestamp: 9 }] }), 9);
    // Le client garde 30 s de marge : jamais « récent » côté app et refusé côté serveur
    const c = call('RECENT_AUTH_MS') / 1000;
    assert.equal(c, RECENT_AUTH_MAX_AGE_S);
  });

  test('compte : delete-account, preuve Apple ou connexion récente, aucun moyen relié ni retiré depuis moins de 24 h', async () => {
    const { deleteDecision, linkedIdentityHold, identityChangeHold, LINKED_IDENTITY_MIN_AGE_S, ACCOUNT_CREATION_SLACK_S } = await import(path.join(ROOT, 'supabase/functions/delete-account/delete-policy.js'));
    const nowS = 1_800_000_000, iso = s => new Date(s * 1000).toISOString(), day = 86400;
    const id = (provider, at) => ({ provider, id: `${provider}-sub`, created_at: iso(at) });
    const user = (createdAt, ...ids) => ({ id: 'u1', created_at: iso(createdAt), identities: ids });
    const fresh = { sub: 'u1', amr: [{ method: 'oauth', timestamp: nowS - 60 }] };
    const old = { sub: 'u1', amr: [{ method: 'oauth', timestamp: nowS - 30 * day }] };
    const decide = (u, claims, appleProof = false, identityChangeAt = null) => deleteDecision({ user: u, claims, nowS, appleProof, identityChangeAt });
    const appleOld = user(nowS - 30 * day, id('apple', nowS - 30 * day));

    // Compte Apple : un corps vide (pas de code) avec une session ancienne est refusé
    sameJSON(decide(appleOld, old), { ok: false, status: 401, error: 'apple' }, 'Apple sans code : refusé');
    sameJSON(decide(appleOld, old, true), { ok: true, via: 'apple' }, 'code Apple prouvé');
    sameJSON(decide(appleOld, fresh), { ok: true, via: 'recent' }, 'échange impossible mais connexion Apple récente');
    // Compte créé avec Google (identité du même instant que le compte) : accepté si connexion récente
    const googleNew = user(nowS - 120, id('google', nowS - 119));
    sameJSON(decide(googleNew, fresh), { ok: true, via: 'recent' }, 'compte créé avec Google il y a 2 min');
    sameJSON(decide(googleNew, old), { ok: false, status: 401, error: 'reauth' }, 'session ancienne');
    sameJSON(decide(googleNew, { ...fresh, sub: 'autre' }), { ok: false, status: 401, error: 'reauth' }, 'jeton d\'un autre compte');
    // Google relié il y a 1 h à un vieux compte e-mail : la session « oauth » de la liaison ne suffit pas
    const linked = user(nowS - 30 * day, id('email', nowS - 30 * day), id('google', nowS - 3600));
    const r = decide(linked, fresh);
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.equal(r.error, 'identity_recent');
    assert.equal(Date.parse(r.retryAt) / 1000, nowS - 3600 + LINKED_IDENTITY_MIN_AGE_S, 'date de fin de l\'attente');
    assert.equal(decide(user(nowS - 30 * day, id('apple', nowS - 30 * day), id('google', nowS - 3600)), old, true).error, 'identity_recent', 'même avec la preuve Apple');
    sameJSON(decide(user(nowS - 30 * day, id('email', nowS - 30 * day), id('google', nowS - 2 * day)), fresh), { ok: true, via: 'recent' }, 'relié il y a 2 jours');
    assert.equal(linkedIdentityHold(user(nowS - 30 * day, { provider: 'google', created_at: 'n/a' }), nowS), null, 'date illisible : ignorée');
    sameJSON(decide(null, fresh), { ok: false, status: 401, error: 'auth' });

    // Journal du serveur (ajouts ET retraits) : relier son Google puis le retirer aussitôt ne laisse
    // aucune identité récente, mais le retrait d'il y a 5 min bloque la suppression 24 h
    const emailOld = user(nowS - 30 * day, id('email', nowS - 30 * day));
    sameJSON(decide(emailOld, fresh), { ok: true, via: 'recent' }, 'sans changement récent');
    const removed = decide(emailOld, fresh, false, iso(nowS - 300));
    assert.equal(removed.status, 403, 'retrait récent refusé');
    assert.equal(removed.error, 'identity_recent');
    assert.equal(Date.parse(removed.retryAt) / 1000, nowS - 300 + LINKED_IDENTITY_MIN_AGE_S, 'retry_at : 24 h après le retrait');
    assert.equal(decide(appleOld, old, true, iso(nowS - 300)).error, 'identity_recent', 'retrait récent : refusé même avec la preuve Apple');
    // Date au format de PostgREST (microsecondes, +00:00)
    const pg = new Date((nowS - 300) * 1000).toISOString().replace('Z', '123+00:00');
    assert.equal(decide(emailOld, fresh, false, pg).error, 'identity_recent', 'date PostgREST lue');
    sameJSON(decide(emailOld, fresh, false, iso(nowS - day - 1)), { ok: true, via: 'recent' }, 'changement de plus de 24 h');
    // La plus tardive des deux sources fixe retry_at
    assert.equal(identityChangeHold(iso(nowS - 300), nowS), nowS - 300 + LINKED_IDENTITY_MIN_AGE_S);
    assert.equal(Date.parse(decide(linked, fresh, false, iso(nowS - 7200)).retryAt) / 1000, nowS - 3600 + LINKED_IDENTITY_MIN_AGE_S, 'identité présente plus récente');
    assert.equal(Date.parse(decide(linked, fresh, false, iso(nowS - 60)).retryAt) / 1000, nowS - 60 + LINKED_IDENTITY_MIN_AGE_S, 'journal plus récent');
    // Journal injoignable ou illisible : refus, jamais d'accord par défaut
    for (const bad of [undefined, 'n/a', 42, {}]) {
      sameJSON(deleteDecision({ user: emailOld, claims: fresh, nowS, appleProof: false, identityChangeAt: bad }), { ok: false, status: 500, error: 'identity_check' }, `journal ${JSON.stringify(bad)}`);
    }

    // Même règle côté app (l'écran prévient avant de demander une nouvelle connexion)
    for (const u of [appleOld, googleNew, linked, user(nowS - 300, id('email', nowS - 290), id('google', nowS - 200))]) {
      const server = linkedIdentityHold(u, nowS);
      assert.equal(call('linkedIdentityHoldUntil(u, now)', { u, now: nowS * 1000 }), server === null ? 0 : server * 1000, JSON.stringify(u.identities));
    }
    assert.equal(call('LINKED_IDENTITY_MIN_AGE_MS') / 1000, LINKED_IDENTITY_MIN_AGE_S);

    // La fonction décide avant de révoquer ou de supprimer, et ne révoque qu'après une décision favorable
    const fn = read('supabase/functions/delete-account/index.ts');
    const at = k => fn.indexOf(k);
    assert.ok(at('exchangeAppleCode(') > 0 && at('exchangeAppleCode(') < at('deleteDecision('), 'échange (preuve) avant la décision');
    assert.ok(at('if (!decision.ok)') < at('revokeAppleToken(') && at('revokeAppleToken(') < at('deleteUser('), 'refus avant révocation et suppression');
    assert.ok(/rpc\('recent_identity_change'/.test(fn) && fn.includes('identityChangeAt: changeAt'), 'journal des identités consulté et transmis à la décision');
    // Migration du journal : ajout ET retrait journalisés, fonction réservée à la clé serveur, même
    // tolérance de création du compte que ACCOUNT_CREATION_SLACK_S
    const journal = read('supabase/migrations/20261026020000_journal_identites.sql');
    assert.ok(journal.includes('after insert or delete on auth.identities'));
    assert.ok(/revoke all on function public\.recent_identity_change\(uuid, interval\) from public, anon, authenticated;/.test(journal));
    assert.ok(/grant execute on function public\.recent_identity_change\(uuid, interval\) to service_role;/.test(journal));
    assert.ok(journal.includes(`<= ${ACCOUNT_CREATION_SLACK_S}`), 'tolérance de création alignée');
    const apple = read('supabase/functions/_shared/apple.ts');
    assert.ok(/expectedSub && sub !== expectedSub\)+ return null/.test(apple), 'code d\'un autre identifiant Apple refusé');
    const revoke = read('supabase/functions/revoke-apple/index.ts');
    assert.ok(revoke.includes("'still_linked'"), 'revoke-apple : jamais tant qu\'Apple est encore relié');
    assert.ok(read('supabase/config.toml').includes('[functions.revoke-apple]'));
  });

  test('compte : erreurs de Supabase Auth → messages français', () => {
    const kind = e => call('authErrorKind(e)', { e });
    assert.equal(kind({ code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' }), 'code');
    assert.equal(kind({ code: 'over_email_send_rate_limit', status: 429 }), 'rate');
    assert.equal(kind({ status: 429 }), 'rate');
    assert.equal(kind({ code: 'email_address_invalid' }), 'email');
    assert.equal(kind({ code: 'validation_failed', message: 'Unable to validate email address: invalid format' }), 'email');
    assert.equal(kind({ code: 'identity_already_exists' }), 'identity_exists');
    assert.equal(kind({ code: 'email_exists' }), 'identity_exists');
    assert.equal(kind({ code: 'single_identity_not_deletable' }), 'last_identity');
    assert.equal(kind({ code: 'manual_linking_disabled' }), 'linking_disabled');
    assert.equal(kind({ code: 'email_address_not_authorized' }), 'not_authorized', 'SMTP par défaut de Supabase');
    assert.equal(kind({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }), 'offline');
    assert.equal(kind({ message: 'Load failed' }), 'offline', 'WebKit hors ligne');
    assert.equal(kind({ code: 'unexpected_failure', status: 500 }), 'server');
    assert.equal(kind(null), null);
    // Code faux ou expiré : même erreur côté Supabase, l'heure d'envoi les distingue
    const sent = 1_000_000;
    assert.equal(call('otpErrorKind(e, sent, now)', { e: { code: 'otp_expired' }, sent, now: sent + 60_000 }), 'invalid');
    assert.equal(call('otpErrorKind(e, sent, now)', { e: { code: 'otp_expired' }, sent, now: sent + 11 * 60_000 }), 'expired');
    assert.equal(call('otpErrorKind(e, sent, now)', { e: { code: 'over_email_send_rate_limit' }, sent, now: sent }), 'rate');
    assert.match(call('authErrorText("identity_exists")'), /déjà son propre compte MDLF/);
    assert.equal(call('identityExistsText("google")'), 'Ce compte Google a déjà son propre compte MDLF. Connecte-toi avec Google, supprime ce compte-là (Réglages › Compte), puis reviens l\'ajouter ici.');
    assert.match(call('identityExistsText("apple")'), /^Cet identifiant Apple .* Connecte-toi avec Apple/);
    assert.ok(call('Object.values(AUTH_ERROR_TEXT).every(t => /[.?!]$/.test(t))'), 'chaque message finit par un point');
    assert.match(call('authErrorText("invalid")'), /Code incorrect/);
    assert.match(call('authErrorText("expired")'), /expiré/);
    assert.equal(call('authErrorText("inconnu")'), call('authErrorText("server")'), 'repli');
    assert.ok(call('Object.values(AUTH_ERROR_TEXT).every(t => !/[A-Z]{3,}|undefined|_/.test(t.replace("MDLF", "")))'), 'aucun code technique affiché');
  });

  test('native : connexion Google (bouton masqué sans client configuré, annulation silencieuse)', async () => {
    const web = nativeContext({ native: false }).Native;
    assert.equal(await web.account.googleAvailable(), false, 'navigateur');
    const plugins = (status, signIn) => ({ MdlfAccount: { googleStatus: status, signInGoogle: signIn } });
    let n = nativeContext({ plugins: plugins(async () => ({ available: true }), async ({ nonce }) => ({ idToken: `jeton:${nonce}` })), available: ['MdlfAccount'] }).Native;
    assert.equal(await n.account.googleAvailable(), true);
    sameJSON(await n.account.signInGoogle('abc'), { idToken: 'jeton:abc' }, 'nonce brut passé au module natif');
    n = nativeContext({ plugins: plugins(async () => ({ available: false }), async () => { const e = new Error('annulée'); e.code = 'CANCELED'; throw e; }), available: ['MdlfAccount'] }).Native;
    assert.equal(await n.account.googleAvailable(), false, 'client ID de remplacement');
    assert.equal(await n.account.signInGoogle('abc'), null, 'fenêtre fermée : null');
    n = nativeContext({ plugins: plugins(async () => { const e = new Error('absente'); e.code = 'UNIMPLEMENTED'; throw e; }, async () => { throw new Error('réseau'); }), available: ['MdlfAccount'] }).Native;
    assert.equal(await n.account.googleAvailable(), false, 'build antérieure sans la méthode');
    await assert.rejects(() => n.account.signInGoogle('abc'), /réseau/, 'autre échec : exception');
  });

  test('iOS : Google prêt à configurer (Info.plist, paquet SPM, schéma d\'URL, manifeste de confidentialité)', () => {
    const plist = read('ios/App/App/Info.plist');
    const clientId = plist.match(/<key>GIDClientID<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    assert.ok(clientId?.endsWith('.apps.googleusercontent.com'), 'GIDClientID présent');
    const reversed = clientId.split('.').reverse().join('.');
    assert.ok(plist.includes(`<string>${reversed}</string>`), 'schéma d\'URL = client ID inversé');
    assert.ok(/^[A-Za-z][A-Za-z0-9+.-]*$/.test(reversed), 'schéma d\'URL valide (RFC 3986 : pas de tiret bas)');
    const swift = read('ios/App/App/AccountPlugin.swift');
    if (clientId.includes('REMPLACER')) assert.ok(swift.includes('"REMPLACER"'), 'valeur de remplacement reconnue par le module (bouton masqué)');
    assert.ok(swift.includes('CAPPluginMethod(name: "signInGoogle"') && swift.includes('CAPPluginMethod(name: "googleStatus"'), 'méthodes déclarées à Capacitor');
    assert.ok(read('ios/App/App/SceneDelegate.swift').includes('GIDSignIn.sharedInstance.handle('), 'retour de la fenêtre Google');
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    assert.ok(pbx.includes('repositoryURL = "https://github.com/google/GoogleSignIn-iOS";'), 'paquet GoogleSignIn-iOS');
    assert.match(pbx, /kind = upToNextMajorVersion;\s*minimumVersion = 10\.1\.0;/, 'version 10.1 au moins');
    const appTarget = pbx.slice(pbx.indexOf('/* App */ = {\n\t\t\tisa = PBXNativeTarget;'), pbx.indexOf('/* End PBXNativeTarget section */'));
    assert.ok(/packageProductDependencies = \([^)]*GoogleSignIn/.test(appTarget.split('RestActivity */ = {')[0]), 'lié à la cible App (pas à l\'extension)');
    assert.ok(/GoogleSignIn in Frameworks \*\/,/.test(pbx), 'dans la phase Frameworks');
    const privacy = read('ios/App/App/PrivacyInfo.xcprivacy');
    assert.ok(/NSPrivacyCollectedDataTypeEmailAddress<\/string>\s*<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>\s*<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<false\/>\s*<key>NSPrivacyCollectedDataTypePurposes<\/key>\s*<array>\s*<string>NSPrivacyCollectedDataTypePurposeAppFunctionality<\/string>/.test(privacy), 'e-mail déclaré : lié, sans suivi, fonctionnement de l\'app');
    // Nom donné par Google, gardé par Supabase Auth (raw_user_meta_data) même si l'app ne l'utilise pas
    assert.ok(/NSPrivacyCollectedDataTypeName<\/string>\s*<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>\s*<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<false\/>\s*<key>NSPrivacyCollectedDataTypePurposes<\/key>\s*<array>\s*<string>NSPrivacyCollectedDataTypePurposeAppFunctionality<\/string>/.test(privacy), 'nom déclaré : lié, sans suivi, fonctionnement de l\'app');
    const page = read('privacy.html');
    assert.ok(page.includes('photo de profil Google') && page.includes('Google profile picture'), 'privacy.html : URL de la photo Google citée (FR et EN)');
  });

  test('compte : le nom donné par Google n\'est jamais affiché ni copié', () => {
    // Code seulement (les commentaires expliquent justement pourquoi ces champs sont ignorés)
    const js = ['js/data/account.js', 'js/data/account-auth.js', 'js/features/account-ui.js', 'js/features/auth-flow.js']
      .map(read).join('\n').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/ .*$/, '')).join('\n');
    assert.ok(!/full_name|\.name\b.*identity_data|identity_data\??\.(full_)?name|given_name|picture|avatar_url/.test(js), 'identity_data : ni nom ni photo de Google');
  });
}
