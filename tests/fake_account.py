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
séances déjà sur le compte ; __sb.upserted : séances envoyées ; __sb.endSession() : session finie hors
de l'app, comme supabase-js quand le jeton de rafraîchissement est refusé).

Amis (docs/SOCIAL_V1.md et supabase/migrations/…_social.sql) : les RPC social_state, social_enable,
social_disable, search_profiles, request_follow, cancel_follow, respond_follow, remove_follower,
block_user, unblock_user, feed, toggle_bravo, my_bravos et la fonction Edge report suivent les règles
du contrat (comptes privés, blocage jamais révélé, limites par jour, liste blanche des séances, mon
social désactivé → fil et recherche vides). État dans __sb.so ; __sb.addPerson({ username, avatar,
social, sessions }) crée un autre compte, __sb.follow(a, b, status) une relation, __sb.block(a, b) un
blocage ; __sb.meId() : compte connecté. Appels dans __sb.calls sous ['social', fonction, arguments].
__sb.fail.social = 'offline' : toutes les RPC du social échouent comme supabase-js hors ligne.

Coach (docs/COACH_V1.md) : coach_state, coach_create_invite, coach_revoke_invite, coach_preview, coach_join,
coach_leave, coach_remove_student, coach_student_sessions (liste blanche session_for_coach, 30 par page),
coach_mark_seen, coach_send_programme, coach_set_note, student_inbox, student_mark_seen, avec leurs erreurs
(not_coach, invalid_code, already_coached, not_found sur son propre code, team_full, rate_limited, too_long,
invalid_programme, username_required sans pseudo), comme supabase/migrations/20261027100000_coach.sql : badge_coach et
badge_student (badge = leur somme), new_sessions depuis le lien tant que le coach n'a rien ouvert, 10 aperçus ou
adhésions réussis par heure, rejoindre le même coach renvoie le coach, coach_preview avec since null. Élève retiré :
listé dans removed, ses codes de ce coach répondent invalid_code jusqu'à coach_allow_student(student).
students[].sent : programmes que je lui ai envoyés, { id, sent_at, seen }.
État dans __sb.co ; __sb.makeCoach(id) pose coach_at, __sb.link(coach, élève) relie deux comptes. Appels dans
__sb.calls sous ['coach', fonction, arguments] ; __sb.fail.coach = 'offline' pour le hors ligne.
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
  // Compte supprimé ou jeton refusé : supabase-js retire la session et émet SIGNED_OUT
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
      // Lignes envoyées gardées (__sb.upserted) : les tests vérifient ce qui part, suppressions comprises
      if (q.op === 'upsert') { log('upsert', q.patch.length); (sb.upserted ||= []).push(...q.patch); }
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
      const next = { username: null, avatar_emoji: null, username_changed_at: null, ...(row || {}), ...q.patch };
      if (next.username && (sb.taken.includes(next.username) || Object.entries(sb.profiles).some(([k, p]) => k !== id && p.username === next.username)))
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "user_profiles_username_key"' } };
      if (row?.username && next.username !== row.username) next.username_changed_at = new Date().toISOString();
      sb.profiles[id] = next;
      return { data: { ...next }, error: null };
    }
    return { data: null, error: null };
  };

  // ── Amis ──
  const so = sb.so = { at: {}, follows: [], blocks: [], bravos: [], posts: {}, reports: [], day: {} };
  sb.meId = () => sb.session?.user.id || null;
  sb.addPerson = ({ username, avatar = null, social = true, sessions = [] } = {}) => {
    const u = newUser({ identities: [] });
    sb.profiles[u.id] = { username, avatar_emoji: avatar, username_changed_at: null };
    if (social) so.at[u.id] = now();
    so.posts[u.id] = sessions.map(x => ({ id: x.id, data: x, deleted_at: x.deleted ? 'x' : null }));
    return u.id;
  };
  sb.follow = (follower, followee, status = 'accepted') => { so.follows.push({ follower, followee, status, at: now() }); };
  sb.block = (blocker, blocked) => { so.blocks.push({ blocker, blocked, at: now() }); };
  const pgErr = message => ({ data: null, error: { code: 'P0001', message, details: null, hint: null } });
  const blockedBetween = (a, b) => so.blocks.some(k => (k.blocker === a && k.blocked === b) || (k.blocker === b && k.blocked === a));
  const rel = (a, b) => so.follows.find(f => f.follower === a && f.followee === b);
  const person = (id, since) => ({ user_id: id, username: sb.profiles[id]?.username || null, avatar: sb.profiles[id]?.avatar_emoji || null, since: new Date(since).toISOString() });
  const canSee = (viewer, owner) => rel(viewer, owner)?.status === 'accepted' && !!so.at[owner] && !!so.at[viewer] && !blockedBetween(viewer, owner);
  // Mes séances côté serveur : dernière version envoyée de chaque séance (__sb.upserted)
  const myPosts = id => { const m = new Map(); for (const r of sb.upserted || []) m.set(r.id, { id: r.id, data: r.data, deleted_at: r.deleted_at }); return [...m.values()]; };
  const postsOf = id => (id === sb.meId() ? myPosts(id) : so.posts[id] || []);
  const shown = p => !p.deleted_at && p.data && p.data.hidden !== true && Number.isFinite(p.data.date);
  // private.session_public : liste blanche, rien d'autre ne sort. records (private.session_records), warmup et rir
  // par série : migration 20261031100000_records_series.sql
  const pubSet = st => {
    const sc = v => (['string', 'number', 'boolean'].includes(typeof v) ? v : undefined);
    return { weight: sc(st.weight), reps: sc(st.reps), dist: sc(st.dist), warmup: st.warmup === true ? true : undefined,
      rir: Number.isInteger(st.rir) && st.rir >= 0 && st.rir <= 4 ? st.rir : undefined };
  };
  const pubRecords = v => {
    if (!Array.isArray(v)) return undefined;
    const n = x => typeof x === 'number' && x >= 0 && x <= 100000, D = [0.5, 1, 2, 5, 10];
    return v.slice(0, 20).filter(r => r && typeof r === 'object' && typeof r.ex === 'string' && r.ex.trim()
      && ['charge', 'reps', 'lest', 'aide', 'temps', 'duree', 'distance', 'allure'].includes(r.kind) && n(r.before) && n(r.after)
      && (r.kind !== 'allure' || D.includes(r.d)))
      .map(r => ({ ex: r.ex.slice(0, 80), kind: r.kind, before: r.before, after: r.after, w: n(r.w) ? r.w : undefined, d: D.includes(r.d) ? r.d : undefined }));
  };
  const sessionPublic = d => {
    const sc = v => (['string', 'number', 'boolean'].includes(typeof v) ? v : undefined);
    const strip = o => JSON.parse(JSON.stringify(o));
    return strip({ date: sc(d.date), duration: sc(d.duration), programme: sc(d.programme), category: sc(d.category), label: sc(d.label),
      records: pubRecords(d.records),
      exercises: (d.exercises || []).map(e => ({ name: sc(e.name), measure: sc(e.measure), sets: (e.sets || []).map(pubSet) })) });
  };
  const limit = (me, action, max) => { const k = me + action; so.day[k] = (so.day[k] || 0) + 1; return so.day[k] > max; };
  const bravoCount = (owner, sid) => so.bravos.filter(b => b.owner === owner && b.sid === sid).length;
  const norm = q => String(q || '').trim().replace(/^@+/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const socialRpc = {
    social_state: me => {
      const pr = sb.profiles[me] || {};
      const pend = so.follows.filter(f => f.followee === me && f.status === 'pending');
      return { enabled: !!so.at[me], username: pr.username || null, avatar: pr.avatar_emoji || null,
        pending_in: pend.map(f => person(f.follower, f.at)),
        following: so.follows.filter(f => f.follower === me && f.status === 'accepted').map(f => person(f.followee, f.at)),
        followers: so.follows.filter(f => f.followee === me && f.status === 'accepted').map(f => person(f.follower, f.at)),
        requested: so.follows.filter(f => f.follower === me && (f.status === 'pending' || f.status === 'ghost')).map(f => person(f.followee, f.at)),
        // Bloqué sans social : pseudo et avatar non renvoyés
        blocked: so.blocks.filter(k => k.blocker === me).map(k => (so.at[k.blocked] ? person(k.blocked, k.at) : { ...person(k.blocked, k.at), username: null, avatar: null })), badge: pend.length };
    },
    social_enable: (me, { age_ok }) => {
      if (!sb.profiles[me]?.username) return pgErr('username_required');
      if (age_ok !== true) return pgErr('age_required');
      so.at[me] ||= now(); return null;
    },
    social_disable: me => { delete so.at[me]; return null; },
    search_profiles: (me, { q }) => {
      const n = norm(q);
      if (n.length < 2 || !so.at[me]) return [];
      return Object.entries(sb.profiles).filter(([id, p]) => id !== me && so.at[id] && p.username?.startsWith(n) && !blockedBetween(me, id))
        .slice(0, 20).map(([id, p]) => ({ user_id: id, username: p.username, avatar: p.avatar_emoji || null,
          relation: rel(me, id)?.status === 'accepted' ? 'following' : rel(me, id) ? 'requested' : rel(id, me)?.status === 'accepted' ? 'follows_you' : 'none' }));
    },
    request_follow: (me, { target }) => {
      if (!so.at[me]) return pgErr('social_not_enabled');
      if (target === me || !sb.users[target]) return pgErr('not_found');
      const r = rel(me, target);
      if (r) return r.status === 'accepted' ? 'following' : 'requested';
      if (limit(me, 'follow', 30)) return pgErr('rate_limited');
      // Bloquée, bloquante ou sans social : demande fantôme (jamais vue par la cible, jamais acceptée)
      sb.follow(me, target, !blockedBetween(me, target) && so.at[target] ? 'pending' : 'ghost');
      return 'requested';
    },
    cancel_follow: (me, { target }) => { so.follows = so.follows.filter(f => !(f.follower === me && f.followee === target)); return null; },
    respond_follow: (me, { follower, accept }) => {
      const r = !blockedBetween(me, follower) && so.follows.find(f => f.follower === follower && f.followee === me && f.status === 'pending');
      if (r && accept) { r.status = 'accepted'; r.at = now(); } else if (r) so.follows.splice(so.follows.indexOf(r), 1);
      return null;
    },
    remove_follower: (me, { follower }) => { so.follows = so.follows.filter(f => !(f.follower === follower && f.followee === me)); return null; },
    block_user: (me, { target }) => {
      if (target === me) return pgErr('not_found');
      if (!sb.users[target]) return null;   // identifiant inconnu : sans effet, sans erreur
      if (!so.blocks.some(k => k.blocker === me && k.blocked === target)) sb.block(me, target);
      // Mes demandes et abonnements vers lui, son abonnement vers moi : retirés ; sa demande en attente devient fantôme
      so.follows = so.follows.filter(f => !((f.follower === me && f.followee === target) || (f.follower === target && f.followee === me && f.status === 'accepted')));
      so.follows.forEach(f => { if (f.follower === target && f.followee === me) f.status = 'ghost'; });
      so.bravos = so.bravos.filter(b => !((b.user === me && b.owner === target) || (b.user === target && b.owner === me)));
      return null;
    },
    unblock_user: (me, { target }) => {
      so.blocks = so.blocks.filter(k => !(k.blocker === me && k.blocked === target));
      so.follows = so.follows.filter(f => !(f.status === 'ghost' && ((f.follower === me && f.followee === target) || (f.follower === target && f.followee === me))));
      return null;
    },
    // Curseur complet : (done_at, owner, id) décroissant, page suivante strictement après la dernière carte
    feed: (me, { before_at = null, before_owner = null, before_id = null, only_user = null }) => {
      if (!so.at[me]) return [];
      const owners = so.follows.filter(f => f.follower === me && canSee(me, f.followee) && (!only_user || f.followee === only_user)).map(f => f.followee);
      const key = (at, o, id) => [at, o, id];
      const cmp = (a, b) => (a[0] - b[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
      const cur = before_at == null ? null : key(before_at, before_owner || '', before_id || '');
      return owners.flatMap(o => postsOf(o).filter(shown).filter(p => p.data.date <= now() + 86400_000).map(p => ({ o, p, k: key(p.data.date, o, p.id) })))
        .filter(x => !cur || cmp(x.k, cur) < 0)
        .sort((a, b) => cmp(b.k, a.k)).slice(0, 20)
        .map(({ o, p }) => ({ owner: o, username: sb.profiles[o]?.username, avatar: sb.profiles[o]?.avatar_emoji || null, id: p.id, done_at: p.data.date,
          s: sessionPublic(p.data), bravos: bravoCount(o, p.id), my_bravo: so.bravos.some(b => b.owner === o && b.sid === p.id && b.user === me) }));
    },
    toggle_bravo: (me, { owner, session_id }) => {
      const p = postsOf(owner).find(x => x.id === session_id);
      if (owner === me || !so.at[me] || !canSee(me, owner) || !p || !shown(p)) return pgErr('not_found');
      if (limit(me, 'bravo', 200)) return pgErr('rate_limited');
      const i = so.bravos.findIndex(b => b.owner === owner && b.sid === session_id && b.user === me);
      if (i >= 0) so.bravos.splice(i, 1); else so.bravos.push({ owner, sid: session_id, user: me });
      return { bravos: bravoCount(owner, session_id), mine: i < 0 };
    },
    my_bravos: me => [...new Set(so.bravos.filter(b => b.owner === me).map(b => b.sid))].map(sid => ({ session_id: sid, bravos: bravoCount(me, sid) })),
  };
  const callSocial = async (fn, args = {}) => {
    log('social', fn, JSON.stringify(args));
    if (sb.fail.social === 'offline') return { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
    if (sb.fail.social === 'hang') return new Promise(() => {});
    const me = sb.meId();
    if (!me) return { data: null, error: { code: '42501', message: 'permission denied' } };
    const out = socialRpc[fn](me, args);
    return out && out.error !== undefined && out.data === null ? out : { data: out, error: null };
  };

  // ── Coach (docs/COACH_V1.md) ──
  // État dans __sb.co : coachs (coach_at), codes, liens élève → coach (coach_seen_at), programmes envoyés, commentaires
  const co = sb.co = { coachAt: {}, invites: [], links: [], progs: [], notes: [], tries: {}, sends: {}, codeN: 0, bans: [] };
  sb.makeCoach = id => { co.coachAt[id] = now(); };
  // seen : coach_seen_at (null tant que le coach n'a rien ouvert : new_sessions comptées depuis le lien)
  sb.link = (coachId, student, at = now()) => { co.links.push({ coach: coachId, student, at, seen: null }); };
  const linkOf = student => co.links.find(l => l.student === student);
  // L'élève de ce coach, et je suis encore coach (private.coach_require_student)
  const coachOf = (me, student) => { const l = linkOf(student); return l && l.coach === me && co.coachAt[me] ? l : null; };
  const cperson = (id, since) => ({ ...person(id, since || 0), since: since == null ? null : new Date(since).toISOString() });
  const validInvite = code => co.invites.find(i => i.code === code && i.expires > now());
  const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // private.session_for_coach : liste blanche du social + notes, hidden, id (jamais bodyKg ni healthSaved)
  const sessionForCoach = (id, d) => {
    const sc = v => (['string', 'number', 'boolean'].includes(typeof v) ? v : undefined);
    return JSON.parse(JSON.stringify({ ...sessionPublic(d), notes: sc(d.notes), hidden: sc(d.hidden), id,
      exercises: (d.exercises || []).map(e => ({ name: sc(e.name), measure: sc(e.measure), ss: sc(e.ss), sets: (e.sets || []).map(pubSet) })) }));
  };
  const noteAlive = n => livePosts(n.student).some(p => p.id === n.sid);
  const livePosts = id => postsOf(id).filter(p => !p.deleted_at && p.data && Number.isFinite(p.data.date));
  // Limite de 10 par heure (aperçus et adhésions ensemble) : Postgres annule l'écriture d'une fonction
  // en erreur, seuls les essais réussis restent comptés. Rejoindre le coach qu'on a déjà : renvoie le coach
  const joinCheck = (me, code) => {
    if (!sb.profiles[me]?.username) return 'username_required';
    if ((co.tries[me] || []).filter(t => t > now() - 3600_000).length >= 10) return 'rate_limited';
    const c = String(code || '').toUpperCase().replace(/[\s-]/g, '');
    const inv = validInvite(c);
    if (!inv || !co.coachAt[inv.coach]) return 'invalid_code';
    if (inv.coach === me) return 'not_found';
    // Retiré par ce coach : ses codes ne marchent plus pour moi (rien n'est révélé : code invalide)
    if (co.bans.some(b => b.coach === inv.coach && b.student === me)) return 'invalid_code';
    const cur = linkOf(me);
    if (cur && cur.coach !== inv.coach) return 'already_coached';
    if (!cur && co.links.filter(l => l.coach === inv.coach).length >= 50) return 'team_full';
    (co.tries[me] ||= []).push(now());
    return inv;
  };
  const coachRpc = {
    coach_state: me => {
      const l = linkOf(me), isCoach = !!co.coachAt[me];
      const students = isCoach ? co.links.filter(x => x.coach === me).map(x => {
        const ps = livePosts(x.student).sort((a, b) => b.data.date - a.data.date);
        const last = ps[0];
        return { ...cperson(x.student, x.at), last_session_at: last ? last.data.date : null, sessions_7d: ps.filter(p => p.data.date > now() - 7 * 86400_000).length,
          new_sessions: ps.filter(p => p.data.date > (x.seen ?? x.at)).length,
          sent: co.progs.filter(p => p.coach === me && p.student === x.student).sort((a, b) => (b.sent_at > a.sent_at ? 1 : -1)).map(p => ({ id: p.id, sent_at: p.sent_at, seen: p.seen })), last_session: last ? { done_at: last.data.date, label: last.data.label || 'Séance', programme: last.data.programme } : null };
      }) : [];
      // Commentaires des séances supprimées : exclus (comme student_inbox)
      const unseen = l ? co.progs.filter(p => p.student === me && p.coach === l.coach && !p.seen).length
        + co.notes.filter(n => n.student === me && n.coach === l.coach && !n.seen && noteAlive(n)).length : 0;
      const badgeCoach = students.reduce((a, s) => a + s.new_sessions, 0);
      return { is_coach: isCoach, coach: l ? cperson(l.coach, l.at) : null, students,
        invites: isCoach ? co.invites.filter(i => i.coach === me && i.expires > now()).map(i => ({ code: i.code, expires_at: new Date(i.expires).toISOString() })) : [],
        removed: isCoach ? co.bans.filter(b => b.coach === me).sort((a, b) => b.at - a.at).map(b => cperson(b.student, b.at)) : [],
        badge_coach: badgeCoach, badge_student: unseen, badge: badgeCoach + unseen };
    },
    coach_create_invite: me => {
      if (!co.coachAt[me]) return pgErr('not_coach');
      const mine = co.invites.filter(i => i.coach === me && i.expires > now());
      if (mine.length >= 5) co.invites.splice(co.invites.indexOf(mine[0]), 1);
      let code = ''; const n = ++co.codeN;
      for (let i = 0; i < 8; i++) code += CODE_ABC[(n * 7 + i * 13 + i * i) % CODE_ABC.length];
      co.invites.push({ code, coach: me, expires: now() + 7 * 86400_000 });
      return code;
    },
    coach_revoke_invite: (me, { code }) => { co.invites = co.invites.filter(i => !(i.coach === me && i.code === code)); return null; },
    coach_preview: (me, { code }) => { const r = joinCheck(me, code); return typeof r === 'string' ? pgErr(r) : cperson(r.coach, null); },
    coach_join: (me, { code }) => {
      const r = joinCheck(me, code); if (typeof r === 'string') return pgErr(r);
      if (!linkOf(me)) sb.link(r.coach, me);
      return cperson(r.coach, linkOf(me).at);
    },
    coach_leave: me => { co.links = co.links.filter(l => l.student !== me); co.progs = co.progs.filter(p => p.student !== me); co.notes = co.notes.filter(n => n.student !== me); return null; },
    // Retirer un accès est toujours permis, même si mon rôle de coach a été retiré
    coach_remove_student: (me, { student }) => {
      const l = linkOf(student);
      if (!l || l.coach !== me) return null;
      if (!co.bans.some(b => b.coach === me && b.student === student)) co.bans.push({ coach: me, student, at: now() });
      co.links = co.links.filter(l => l.student !== student); co.progs = co.progs.filter(p => p.student !== student); co.notes = co.notes.filter(n => n.student !== student); return null;
    },
    coach_student_sessions: (me, { student, before_at = null, before_id = null }) => {
      if (!coachOf(me, student)) return pgErr('not_found');
      const key = p => [p.data.date, p.id];
      const cmp = (a, b) => (a[0] - b[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
      return livePosts(student).filter(p => before_at == null || cmp(key(p), [before_at, before_id || '']) < 0)
        .sort((a, b) => cmp(key(b), key(a))).slice(0, 30)
        .map(p => ({ id: p.id, done_at: p.data.date, s: sessionForCoach(p.id, p.data), note: co.notes.find(n => n.student === student && n.sid === p.id)?.text || null }));
    },
    coach_allow_student: (me, { student }) => { co.bans = co.bans.filter(b => !(b.coach === me && b.student === student)); return null; },
    coach_mark_seen: (me, { student }) => { const l = coachOf(me, student); if (!l) return pgErr('not_found'); l.seen = now(); return null; },
    coach_send_programme: (me, { student, prog_id, data }) => {
      if (!co.coachAt[me]) return pgErr('not_coach');
      if (!coachOf(me, student)) return pgErr('not_found');
      if (typeof prog_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(prog_id) || !data || typeof data !== 'object' || Array.isArray(data)) return pgErr('invalid_programme');
      if (JSON.stringify(data).length > 200 * 1024) return pgErr('too_long');
      co.sends[me] = (co.sends[me] || 0) + 1;
      if (co.sends[me] > 30) return pgErr('rate_limited');
      co.progs = co.progs.filter(p => !(p.student === student && p.id === prog_id));
      co.progs.push({ coach: me, student, id: prog_id, data: JSON.parse(JSON.stringify(data)), sent_at: new Date(now()).toISOString(), seen: false });
      return null;
    },
    coach_set_note: (me, { student, session_id, text }) => {
      if (!co.coachAt[me]) return pgErr('not_coach');
      if (!coachOf(me, student)) return pgErr('not_found');
      const t = String(text ?? '').trim();   // btrim, comme le serveur
      if (t.length > 1000) return pgErr('too_long');
      if (t && !livePosts(student).some(p => p.id === session_id)) return pgErr('not_found');
      co.notes = co.notes.filter(n => !(n.student === student && n.sid === session_id));
      if (t) co.notes.push({ coach: me, student, sid: session_id, text: t, updated_at: new Date(now()).toISOString(), seen: false });
      return null;
    },
    // Seulement ce qui vient du coach actuel
    student_inbox: me => ({
      programmes: co.progs.filter(p => p.student === me && p.coach === linkOf(me)?.coach).map(p => ({ id: p.id, data: p.data, sent_at: p.sent_at, seen: p.seen })),
      notes: co.notes.filter(n => n.student === me && n.coach === linkOf(me)?.coach && noteAlive(n)).map(n => ({ session_id: n.sid, text: n.text, updated_at: n.updated_at, seen: n.seen })),
    }),
    student_mark_seen: (me, { kind, ref }) => {
      const x = kind === 'programme' ? co.progs.find(p => p.student === me && p.id === ref) : co.notes.find(n => n.student === me && n.sid === ref);
      if (x) x.seen = true; return null;
    },
  };
  const callCoach = async (fn, args = {}) => {
    log('coach', fn, JSON.stringify(args));
    if (sb.fail.coach === 'offline') return { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
    const me = sb.meId();
    if (!me) return { data: null, error: { code: '42501', message: 'permission denied' } };
    const out = coachRpc[fn](me, args);
    return out && out.error !== undefined && out.data === null ? out : { data: out, error: null };
  };
  const REPORT_REASONS = ['spam', 'harcelement', 'sexuel', 'violence', 'haine', 'autre'];

  window.supabase = {
    createClient: (url, key, o) => {
      sb.storage = o?.auth?.storage; sb.storageKey = o?.auth?.storageKey;
      return {
        auth, from,
        rpc: async (fn, args) => { if (socialRpc[fn]) return callSocial(fn, args); if (coachRpc[fn]) return callCoach(fn, args); log('rpc', fn, args?.name); return { data: !sb.taken.includes(args.name) && !Object.values(sb.profiles).some(p => p.username === args.name), error: null }; },
        functions: { invoke: async (fn, { body } = {}) => {
          log('invoke', fn, JSON.stringify(body || {}));
          const fail = (status, b) => ({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => b } } });
          if (fn === 'report') {
            if (sb.fail.social === 'offline') throw new TypeError('Failed to fetch');
            if (!sb.session) return fail(401, { error: 'auth' });
            const b = body || {};
            if (!sb.users[b.target_user]) return fail(404, { error: 'not_found' });
            if (b.target_user === sb.meId() || !['profile', 'session'].includes(b.kind) || !REPORT_REASONS.includes(b.reason)
              || (b.details != null && String(b.details).length > 500)) return fail(400, { error: 'invalid' });
            if (so.reports.filter(r => r.by === sb.meId()).length >= 10) return fail(429, { error: 'rate_limited' });
            so.reports.push({ ...b, by: sb.meId() });
            return { data: { ok: true }, error: null };
          }
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
