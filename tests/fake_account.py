"""Coquille iOS et serveur Supabase simulés pour tester le compte sans réseau ni iPhone.

FAKE_ACCOUNT est injecté avant le chargement de l'app (page.add_init_script) :
- window.Capacitor factice : native.js voit Native.isNative = true ; le module MdlfAccount répond
  (Apple, Google, Trousseau en mémoire), les autres modules répondent {} sans rien faire.
- window.supabase factice : createClient() renvoie un client qui imite supabase-js pour ce que
  js/data/account.js utilise (auth, from(table), rpc, functions.invoke), avec ses vraies formes de
  réponse et ses vrais codes d'erreur (otp_expired, identity_already_exists, 23505…), et son vrai
  comportement là où il compte pour la sécurité : changement d'e-mail confirmé deux fois si le compte a
  déjà une adresse (mailer_secure_email_change_enabled) et qui remplace l'adresse ; nouvelle session
  « oauth » à la liaison d'une identité (link_identity) ; delete-account qui refuse un compte Apple
  sans code Apple frais (sauf connexion récente) et un moyen de connexion ajouté depuis moins de 24 h
  (supabase/functions/delete-account/delete-policy.js) ; code Apple à usage unique.
L'état du faux serveur est dans window.__sb (codes envoyés, comptes, profils, appels) ; les tests le
lisent et le modifient (ex. __sb.google = false pour un client Google non configuré ; __sb.remoteRows :
séances déjà sur le compte ; __sb.endSession() : session finie ailleurs, comme supabase-js quand le
jeton de rafraîchissement est refusé).
"""

FAKE_ACCOUNT = r"""
(() => {
  const opts = Object.assign({ google: true, backup: null }, window.__fakeOpts || {});
  const b64 = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = () => Date.now();
  const sb = window.__sb = {
    google: opts.google, calls: [], users: {}, profiles: {}, taken: ['pris', 'coach'],
    code: '123456', codes: [], session: null, fail: {}, keychain: {}, appleUser: 'apple-sub-1', googleSub: 'google-sub-1',
    appleCodes: {}, appleN: 0, pendingEmail: null,
  };
  const log = (...a) => sb.calls.push(a);
  const err = (code, message = code, status = 400) => ({ name: 'AuthApiError', code, message, status });

  // ── Coquille iOS ──
  window.Capacitor = {
    isNativePlatform: () => true,
    isPluginAvailable: name => name === 'MdlfAccount',
    registerPlugin: name => {
      if (name === 'MdlfAccount') return {
        signIn: async ({ nonce }) => { log('apple', nonce); if (sb.fail.apple === 'cancel') { const e = new Error('annulée'); e.code = 'CANCELED'; throw e; }
          // Code d'autorisation : nouveau à chaque connexion, à usage unique, lié à l'identifiant Apple
          const code = 'code-apple-' + (++sb.appleN); sb.appleCodes[code] = sb.appleUser;
          return { identityToken: 'apple.' + b64({ sub: sb.appleUser, nonce }) + '.sig', authorizationCode: code, user: sb.appleUser }; },
        signInGoogle: async ({ nonce }) => { log('google', nonce); if (sb.fail.google === 'cancel') { const e = new Error('annulée'); e.code = 'CANCELED'; throw e; }
          return { idToken: 'g.' + b64({ sub: sb.googleSub, nonce }) + '.sig' }; },
        googleStatus: async () => ({ available: !!sb.google }),
        credentialState: async () => ({ state: 'authorized' }),
        getItem: async ({ key }) => ({ value: sb.keychain[key] ?? null }),
        setItem: async ({ key, value }) => { sb.keychain[key] = value; },
        removeItem: async ({ key }) => { delete sb.keychain[key]; },
      };
      if (name === 'Filesystem') return {
        readFile: async () => { if (!opts.backup) throw new Error('absent'); return { data: opts.backup }; },
        writeFile: async () => ({ uri: 'file:///x' }),
      };
      return new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) });
    },
  };

  // ── Supabase ──
  const listeners = [];
  const emit = (ev, s) => listeners.forEach(fn => fn(ev, s));
  let uid = 0;
  // Identités du compte créées avec lui (même date), celles reliées ensuite datées du moment
  const newUser = (fields) => {
    const id = '00000000-0000-0000-0000-' + String(++uid).padStart(12, '0');
    const u = { id, created_at: new Date(now() - (opts.oldAccounts ? 30 * 86400_000 : 0)).toISOString(), identities: [], email: null, ...fields };
    u.identities.forEach(i => { i.created_at = u.created_at; });
    sb.users[id] = u;
    return u;
  };
  const identity = (provider, data) => ({ identity_id: 'idt-' + provider + '-' + (++uid), provider, id: data.sub || data.email, identity_data: data, created_at: new Date(now() + uid).toISOString() });
  const findBy = (provider, key) => Object.values(sb.users).find(u => u.identities.some(i => i.provider === provider && i.id === key));
  const startSession = (user, method) => {
    const access_token = 'h.' + b64({ sub: user.id, amr: [{ method, timestamp: Math.floor(now() / 1000) }] }) + '.s';
    sb.session = { access_token, refresh_token: 'r', user: JSON.parse(JSON.stringify(user)) };
    if (sb.storage) sb.storage.setItem(sb.storageKey, JSON.stringify(sb.session));
    emit('SIGNED_IN', sb.session);
    return { data: { user: sb.session.user, session: sb.session }, error: null };
  };
  const me = () => sb.session && sb.users[sb.session.user.id];
  // Compte supprimé ou déconnecté sur un autre appareil : supabase-js retire la session et émet SIGNED_OUT
  sb.endSession = () => { sb.session = null; if (sb.storage) sb.storage.removeItem(sb.storageKey); emit('SIGNED_OUT', null); };
  const refreshMe = () => { if (sb.session) sb.session.user = JSON.parse(JSON.stringify(me())); };
  const tokenSub = t => { try { return JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))).sub; } catch { return null; } };

  const auth = {
    onAuthStateChange: fn => { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => ({ data: { session: sb.session }, error: null }),
    getUser: async () => (sb.session ? { data: { user: JSON.parse(JSON.stringify(me())) }, error: null } : { data: { user: null }, error: err('session_not_found') }),
    startAutoRefresh() {}, stopAutoRefresh() {},
    signOut: async () => { log('signOut'); sb.session = null; if (sb.storage) sb.storage.removeItem(sb.storageKey); emit('SIGNED_OUT', null); return { error: null }; },
    signInWithIdToken: async ({ provider, token, nonce }) => {
      log('idtoken', provider, !!nonce);
      const sub = tokenSub(token);
      const user = findBy(provider, sub) || newUser({ identities: [identity(provider, { sub, ...(provider === 'google' ? { email: 'max@gmail.com', full_name: 'Nom Google' } : {}) })], ...(provider === 'google' ? { email: 'max@gmail.com', email_confirmed_at: new Date().toISOString() } : {}) });
      return startSession(user, 'oauth');
    },
    signInWithOtp: async ({ email, options }) => {
      log('otp', email, options?.shouldCreateUser);
      if (sb.fail.send) return { data: {}, error: err(sb.fail.send, sb.fail.send, 429) };
      sb.codes.push({ email, at: now() });
      return { data: { user: null, session: null }, error: null };
    },
    verifyOtp: async ({ email, token, type }) => {
      log('verify', email, token, type);
      if (token !== sb.code || sb.fail.expired) return { data: { user: null, session: null }, error: err('otp_expired', 'Token has expired or is invalid', 403) };
      if (type === 'email_change') {
        // Une confirmation par adresse : l'ancienne (s'il y en a une) et la nouvelle. L'adresse ne
        // change qu'après la dernière, et remplace l'ancienne (pas d'ajout)
        const u = me(), p = sb.pendingEmail;
        if (!p || p.email !== email) return { data: { user: null, session: null }, error: err('otp_expired', 'Token has expired or is invalid', 403) };
        if (--p.left > 0) { refreshMe(); return { data: { user: sb.session.user, session: sb.session }, error: null }; }
        sb.pendingEmail = null;
        u.email = email; u.email_confirmed_at = new Date().toISOString();
        u.identities = u.identities.filter(i => i.provider !== 'email');
        u.identities.push(identity('email', { email, sub: email }));
        refreshMe();
        emit('USER_UPDATED', sb.session);
        return { data: { user: sb.session.user, session: sb.session }, error: null };
      }
      const user = Object.values(sb.users).find(u => u.email === email) || newUser({ email, email_confirmed_at: new Date().toISOString(), identities: [identity('email', { email, sub: email })] });
      return startSession(user, 'otp');
    },
    updateUser: async ({ email }) => {
      log('updateUser', email);
      if (Object.values(sb.users).some(u => u.email === email && u.id !== me()?.id)) return { data: { user: null }, error: err('email_exists', 'A user with this email address has already been registered', 422) };
      sb.pendingEmail = { email, left: me().email ? 2 : 1 };
      return { data: { user: sb.session.user }, error: null };
    },
    linkIdentity: async ({ provider, token }) => {
      log('link', provider);
      const sub = tokenSub(token);
      if (sb.fail.link || findBy(provider, sub)) return { data: { user: null, session: null }, error: err('identity_already_exists', 'Identity is already linked to another user', 422) };
      me().identities.push(identity(provider, { sub }));
      // Supabase Auth émet une nouvelle session (link_identity : amr « oauth » de maintenant)
      return startSession(me(), 'oauth');
    },
    unlinkIdentity: async ({ identity_id }) => {
      log('unlink', identity_id);
      const u = me();
      if (u.identities.length < 2) return { data: null, error: err('single_identity_not_deletable', 'User must have at least 1 identity after unlinking', 422) };
      u.identities = u.identities.filter(i => i.identity_id !== identity_id);
      refreshMe();
      return { data: {}, error: null };
    },
  };

  // Requêtes PostgREST : enchaînement libre, résultat calculé à l'await
  const from = table => {
    const q = { table, op: 'select', patch: null, single: false };
    const chain = new Proxy({}, {
      get: (_, m) => {
        if (m === 'then') return (res, rej) => Promise.resolve(execute(q)).then(res, rej);
        return (...args) => {
          if (m === 'insert' || m === 'update' || m === 'upsert') { q.op = m; q.patch = args[0]; }
          if (m === 'maybeSingle' || m === 'single') q.single = m;
          return chain;
        };
      },
    });
    return chain;
  };
  const execute = q => {
    log('db', q.table, q.op);
    if (!sb.session) return { data: null, error: { code: '42501', message: 'permission denied' } };
    const id = sb.session.user.id;
    if (q.table === 'sessions') {
      if (q.op === 'upsert') log('upsert', q.patch.length);
      return { data: q.op === 'select' ? (sb.remoteRows || []) : null, error: null };
    }
    if (q.table === 'profiles') return q.op === 'select' ? { data: null, error: null } : { data: { updated_at: new Date().toISOString() }, error: null };
    if (q.table === 'user_profiles') {
      const row = sb.profiles[id];
      if (q.op === 'select') return { data: row || null, error: null };
      if (q.op === 'insert' && row) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "user_profiles_pkey"' } };
      if (q.op === 'update' && !row) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      // Liste blanche du serveur pas encore à jour (opts.refuseAvatars) : contrainte CHECK
      if ((opts.refuseAvatars || []).includes(q.patch?.avatar_emoji)) return { data: null, error: { code: '23514', message: 'new row for relation "user_profiles" violates check constraint "user_profiles_avatar_emoji"' } };
      const next = { username: null, avatar_emoji: '🔥', username_changed_at: null, ...(row || {}), ...q.patch };
      if (next.username && (sb.taken.includes(next.username) || Object.entries(sb.profiles).some(([k, p]) => k !== id && p.username === next.username)))
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "user_profiles_username_key"' } };
      if (row?.username && next.username !== row.username) next.username_changed_at = new Date().toISOString();
      sb.profiles[id] = next;
      return { data: { ...next }, error: null };
    }
    return { data: null, error: null };
  };

  window.supabase = {
    createClient: (url, key, o) => {
      sb.storage = o?.auth?.storage; sb.storageKey = o?.auth?.storageKey;
      return {
        auth, from,
        rpc: async (fn, args) => { log('rpc', fn, args?.name); return { data: !sb.taken.includes(args.name) && !Object.values(sb.profiles).some(p => p.username === args.name), error: null }; },
        functions: { invoke: async (fn, { body } = {}) => {
          log('invoke', fn, JSON.stringify(body || {}));
          const fail = (status, b) => ({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => b } } });
          const u = me(), nowS = now() / 1000;
          const amr = JSON.parse(atob(sb.session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).amr;
          const recent = amr.some(a => a.timestamp > nowS - 600);
          // Code Apple : échangé une seule fois, identifiant Apple renvoyé par « Apple »
          const appleSubOf = code => { const s = sb.appleCodes[code]; delete sb.appleCodes[code]; return s || null; };
          if (fn === 'revoke-apple') {
            const s = appleSubOf(body?.code);
            if (!s) return { data: { revoked: false }, error: null };
            if (u.identities.some(i => i.provider === 'apple' && i.id === s)) return fail(409, { error: 'still_linked', revoked: false });
            return { data: { revoked: true }, error: null };
          }
          // delete-account (delete-policy.js) : moyen ajouté depuis moins de 24 h, preuve Apple ou connexion récente
          const created = Date.parse(u.created_at) / 1000;
          const holds = u.identities.map(i => Date.parse(i.created_at) / 1000).filter(t => Math.abs(t - created) > 600 && t + 86400 > nowS);
          if (holds.length) return fail(403, { error: 'identity_recent', retry_at: new Date((Math.max(...holds) + 86400) * 1000).toISOString() });
          const apple = u.identities.find(i => i.provider === 'apple');
          const proof = !!apple && appleSubOf(body?.code) === apple.id;
          if (!proof && !recent) return fail(401, { error: apple ? 'apple' : 'reauth' });
          delete sb.users[u.id];
          return { data: { deleted: true, revoked: proof }, error: null };
        } },
      };
    },
  };
})();
"""
